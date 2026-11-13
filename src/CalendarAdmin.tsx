import { periodLabel, type Period } from './SchoolPeriods';
import { useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Restriction = { date: string; period: number; reason: string };

const approvedPdf = '2e93eed2b95a57b726ac173a18e454f68ce0e851be043870cd102d8cdeab9113';
const knownDates = [
  ['02-16,02-17', 'Carnaval'], ['03-23', 'Emancipação de Florianópolis'],
  ['04-03', 'Sexta-feira da Paixão'], ['04-20', 'Ponto facultativo'],
  ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalhador'],
  ['06-04', 'Corpus Christi'], ['06-05', 'Ponto facultativo'],
  ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Senhora Aparecida'],
  ['10-30', 'Dia do Servidor Público'], ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'], ['11-20', 'Consciência Negra'],
];
const recesses = [[2, 1, 8], [7, 18, 31], [12, 23, 31]];
const pad = (n: number) => String(n).padStart(2, '0');

export function restrictionFor(rows: Restriction[], date: string, period: number) {
  return rows.find(row => row.date === date && row.period === 0)
    ?? rows.find(row => row.date === date && row.period === period);
}

async function importRows(file: File): Promise<Restriction[]> {
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== approvedPdf) throw new Error('PDF ainda sem leitura automática. Use o modelo CSV com as datas aprovadas.');
    return [
      ...knownDates.flatMap(([days, reason]) => days.split(',').map(day => ({
        date: '2026-' + day, period: 0, reason,
      }))),
      ...recesses.flatMap(([month, start, end]) => Array.from({ length: end - start + 1 }, (_, i) => ({
        date: '2026-' + pad(month) + '-' + pad(start + i), period: 0, reason: 'Recesso escolar',
      }))),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }
  const [header, ...lines] = (await file.text()).trim().split(/\r?\n/);
  if (header !== 'data;periodo;motivo') throw new Error('Use o cabeçalho data;periodo;motivo do modelo CSV.');
  return lines.filter(line => line.trim()).map(line => {
    const [date, period, ...reason] = line.split(';');
    return { date: date.trim(), period: period?.trim() ? Number(period) : NaN, reason: reason.join(';').trim() };
  });
}

function validRows(rows: Restriction[], year: number) {
  const keys = new Set<string>();
  return rows.every(({ date, period, reason }) => {
    const key = date + ':' + period;
    const parsed = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(year + '-') ||
      Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
      !Number.isInteger(period) || period < 0 || period > 2147483647 || !reason.trim() ||
      reason.trim().length > 200 || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

export function CalendarAdmin({ client, school, periods, onPublish }: {
  client: SupabaseClient;
  school: string;
  periods: Period[];
  onPublish: () => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [loaded, setLoaded] = useState<{ year: number; revision: number }>();
  const [rows, setRows] = useState<Restriction[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  }

  function open() {
    void run(async () => {
      setLoaded(undefined);
      const unit = await client.from('schools').select('calendar_revision').eq('id', school).single();
      if (unit.error) throw new Error('Não foi possível abrir o calendário. Confira se a migração foi aplicada.');
      const next: Restriction[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await client.from('calendar_restrictions').select('date,period,reason').eq('school_id', school)
          .gte('date', year + '-01-01').lt('date', (year + 1) + '-01-01')
          .order('date').order('period').range(offset, offset + 499);
        if (page.error) throw new Error('Falha ao consultar o calendário.');
        next.push(...page.data);
        if (page.data.length < 500) break;
      }
      setRows(next);
      setLoaded({ year, revision: unit.data.calendar_revision });
    });
  }

  function publish() {
    if (!loaded || !validRows(rows, loaded.year)) {
      setMessage('Confira o ano, os motivos e as datas ou aulas duplicadas.');
      return;
    }
    if (!window.confirm('Substituir as restrições publicadas para este ano?')) return;
    void run(async () => {
      const { error } = await client.rpc('publish_school_calendar', {
        p_school: school, p_year: loaded.year, p_rows: rows, p_revision: loaded.revision,
      });
      if (error) throw new Error(error.code === 'P0001' ? error.message : 'Falha ao publicar. Reabra o calendário para confirmar o estado.');
      setLoaded({ ...loaded, revision: loaded.revision + 1 });
      setMessage('Calendário publicado.');
      onPublish();
    });
  }

  function edit(index: number, patch: Partial<Restriction>) {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  return <section className="panel">
    <h2>Calendário escolar</h2>
    <label>Ano letivo<input type="number" min={1900} max={9998} value={year || ''} disabled={busy}
      onChange={event => { setYear(Number(event.target.value)); setLoaded(undefined); }} /></label>
    <button disabled={busy || !Number.isInteger(year) || year < 1900 || year > 9998} onClick={open}>Abrir ano</button>
    {loaded && <>
      <p>Importe as datas do calendário aprovado e revise os bloqueios antes de publicar.</p>
      <a href={'data:text/csv;charset=utf-8,' + encodeURIComponent('data;periodo;motivo\n' + loaded.year + '-11-20;0;Consciência Negra\n')}
        download="modelo-calendario.csv">Baixar modelo CSV</a>
      <label>Importar calendário<input ref={importInput} type="file" accept=".pdf,.csv" disabled={busy}
        onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          void run(async () => {
            try {
              const imported = await importRows(file);
              if (!validRows(imported, loaded.year)) throw new Error('O arquivo tem datas fora do ano, registros inválidos ou duplicados.');
              const importedKeys = new Set(imported.map(row => row.date + ':' + row.period));
              setRows(current => [...current.filter(row => !importedKeys.has(row.date + ':' + row.period)), ...imported]
                .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period));
              setMessage(imported.length + ' restrições importadas para revisão.');
            } finally { if (importInput.current) importInput.current.value = ''; }
          });
        }} /></label>
      <fieldset disabled={busy}>
        <legend>Restrições para {loaded.year}</legend>
        {rows.map((row, index) => <div className="booking calendar-row" key={index}>
          <label>Data<input type="date" value={row.date} onChange={event => edit(index, { date: event.target.value })} /></label>
          <label>Abrangência<select value={row.period} onChange={event => edit(index, { period: Number(event.target.value) })}>
            <option value={0}>Dia inteiro</option>
            {periods.map(slot => <option key={slot.period} value={slot.period}>{periodLabel(slot)}</option>)}
          </select></label>
          <label>Motivo<input value={row.reason} maxLength={200} onChange={event => edit(index, { reason: event.target.value })} /></label>
          <button onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remover</button>
        </div>)}
        <button onClick={() => setRows(current => [...current, { date: '', period: 0, reason: '' }])}>Adicionar data</button>
        <button className="primary" onClick={publish}>Publicar restrições</button>
      </fieldset>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}


