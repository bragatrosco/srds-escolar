import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Period = { period: number; segment: string; shift: string; label: string; starts: string; ends: string; active: boolean };

export const legacyPeriods: Period[] = Array.from({ length: 5 }, (_, i) => ({
  period: i + 1, segment: '', shift: '', label: (i + 1) + 'ª aula', starts: '', ends: '', active: true,
}));

export function periodLabel(slot: Period) {
  return slot.shift
    ? slot.shift + ' · ' + slot.segment + ' · ' + slot.label + ' (' + slot.starts.slice(0, 5) + '–' + slot.ends.slice(0, 5) + ')'
    : slot.label;
}

export function SchoolPeriods({ client, school, periods, reload }: {
  client: SupabaseClient; school: string; periods: Period[]; reload: () => Promise<void>;
}) {
  const [initial, setInitial] = useState(legacyPeriods);
  const [draft, setDraft] = useState({ segment: '', shift: '', label: '', starts: '', ends: '' });
  const [batch, setBatch] = useState('');
  const [preview, setPreview] = useState<(typeof draft)[]>([]);

  function parseBatch() {
    setPreview([]);
    const lines = batch.trim().split(/\r?\n/).filter(line => line.trim());
    const rows = lines.map(line => {
      const [segment, shift, label, starts, ends, ...extra] = line.split(';').map(value => value.trim());
      const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      if (extra.length || [segment, shift, label].some(value => !value || value.length > 40)
          || !time.test(starts) || !time.test(ends) || starts >= ends) return null;
      return { segment, shift, label, starts, ends };
    });
    if (!rows.length || rows.some(row => row === null) || rows.length > 100) {
      setMessage('Confira as linhas. Use até 100 aulas no formato segmento;turno;aula;HH:MM;HH:MM.');
      return;
    }
    setMessage('');
    setPreview(rows.filter(row => row !== null));
  }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save(rows: unknown[]) {
    setBusy(true);
    setMessage('');
    try {
      const { error } = await client.rpc('save_school_periods', {
        p_school: school, p_rows: rows, p_initialize: periods.length === 0,
      });
      if (error) {
        setMessage(error.code === 'P0001' ? error.message : 'Confira os horários e as permissões da escola.');
        return;
      }
      await reload();
      setMessage('Grade atualizada.');
      setBatch('');
      setPreview([]);
      setDraft({ segment: '', shift: '', label: '', starts: '', ends: '' });
    } catch {
      setMessage('Confira a grade antes de repetir a operação.');
    } finally {
      setBusy(false);
    }
  }

  const fields = (row: typeof draft, update: (patch: Partial<typeof draft>) => void) => <>
    <label>Segmento<input required maxLength={40} value={row.segment} onChange={e => update({ segment: e.target.value })} placeholder="Ex. Anos Iniciais" /></label>
    <label>Turno<input required maxLength={40} value={row.shift} onChange={e => update({ shift: e.target.value })} placeholder="Ex. Matutino" /></label>
    <label>Aula<input required maxLength={40} value={row.label} onChange={e => update({ label: e.target.value })} /></label>
    <label>Início<input type="time" required value={row.starts} onChange={e => update({ starts: e.target.value })} /></label>
    <label>Fim<input type="time" required value={row.ends} onChange={e => update({ ends: e.target.value })} /></label>
  </>;

  function submit(event: FormEvent) {
    event.preventDefault();
    const rows = periods.length ? [draft] : initial;
    if (rows.some(row => row.starts >= row.ends)) {
      setMessage('O fim de cada aula deve ser posterior ao início.');
      return;
    }
    void save(rows);
  }

  return <section className="panel">
    <h2>Turnos e horários</h2>
    {periods.map(slot => <div className="booking" key={slot.period}>
      <span>{periodLabel(slot)} · Código {slot.period}{!slot.active && ' · Inativo'}</span>
      <button disabled={busy} onClick={() => void save([{ period: slot.period, active: !slot.active }])}>
        {slot.active ? 'Desativar' : 'Reativar'}
      </button>
    </div>)}
    {!periods.length && <p>Vincule cada código original à aula correspondente. Confira as reservas e os bloqueios existentes antes de salvar.</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>{periods.length ? 'Adicionar aula' : 'Configurar as cinco aulas existentes'}</legend>
        {periods.length ? fields(draft, patch => setDraft(current => ({ ...current, ...patch })))
          : initial.map((row, i) => <div className="booking calendar-row" key={row.period}>
            <strong>{row.period}ª aula original</strong>
            {fields(row, patch => setInitial(current => current.map((slot, j) => i === j ? { ...slot, ...patch } : slot)))}
          </div>)}
        <button className="primary">Salvar horários</button>
      </fieldset>
    </form>
    {!!periods.length && <fieldset disabled={busy}>
      <legend>Adicionar aulas em lote</legend>
      <label>Uma aula por linha, sem cabeçalho
        <textarea rows={6} value={batch} onChange={e => { setBatch(e.target.value); setPreview([]); }}
          placeholder="Anos Finais;Matutino;1ª aula;07:30;08:15" />
      </label>
      <button onClick={parseBatch}>Revisar lote</button>
      {!!preview.length && <>
        <ul>{preview.map((row, index) => <li key={index}>{periodLabel({ ...row, period: 0, active: true })}</li>)}</ul>
        <button className="primary" onClick={() => void save(preview)}>Salvar {preview.length} aulas</button>
      </>}
    </fieldset>}
    {message && <p role="status">{message}</p>}
  </section>;
}


