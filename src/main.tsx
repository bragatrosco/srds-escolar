import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session } from '@supabase/supabase-js';
import './style.css';
import { version } from '../package.json';
import { CalendarAdmin, restrictionFor, type Restriction } from './CalendarAdmin';
import { SchoolLogoAdmin } from './SchoolLogoAdmin';
import { SchoolPeriods, legacyPeriods, periodLabel, type Period } from './SchoolPeriods';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const db = url && key ? createClient(url, key) : null;

type School = { id: string; name: string };
type Resource = { id: string; name: string; category: string; quantity: number; active: boolean };
type Booking = { id: string; resource_id: string; date: string; period: number; quantity: number; class_group: string | null; calendar_conflict?: string | null };
type Slot = { period: number; used: number };

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!db) return;
    const { data } = db.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => data.subscription.unsubscribe();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setNotice('');
    try {
      const { error } = await db.auth.signInWithPassword({
        email: String(fields.get('email')).trim(),
        password: String(fields.get('password')),
      });
      if (error) setNotice('Não foi possível entrar. Confira o e-mail e a senha.');
    } catch {
      setNotice('Não foi possível conectar ao serviço de autenticação.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const result = await db?.auth.signOut();
    setNotice(result?.error ? 'Não foi possível sair. Tente novamente.' : '');
  }

  if (!db) return <main><p role="alert">Configure a URL e a chave publicável do Supabase para acessar o SRDs.</p></main>;
  if (session === undefined) return <main><p role="status">Carregando sessão…</p></main>;
  if (session) return <Workspace key={session.user.id} client={db} logout={logout} authNotice={notice} />;
  return <main><form className="panel" onSubmit={login}>
    <h1>Entrar no SRDs</h1>
    <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
    <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
    <button className="primary" disabled={busy}>Entrar</button>
    {notice && <p role="status">{notice}</p>}
  </form></main>;
}

function Workspace({ client, logout, authNotice }: {
  client: NonNullable<typeof db>;
  logout: () => Promise<void>;
  authNotice: string;
}) {
  const [schools, setSchools] = useState<School[]>();
  const [admins, setAdmins] = useState<string[]>([]);
  const [school, setSchool] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      client.from('schools').select('id,name').order('name').abortSignal(controller.signal),
      client.from('school_members').select('school_id').eq('role', 'admin').abortSignal(controller.signal),
    ]).then(([units, membership]) => {
      if (controller.signal.aborted) return;
      if (units.error || membership.error) {
        setNotice('Falha ao carregar as escolas. Recarregue a página para tentar novamente.');
        return;
      }
      setSchools(units.data);
      setAdmins(membership.data.map(row => row.school_id));
      setSchool(units.data[0]?.id ?? '');
    });
    return () => controller.abort();
  }, [client]);

  const status = authNotice || notice;
  if (!schools?.length) return <main>
    <p role="status">{status || (schools ? 'Seu usuário ainda não está vinculado a uma escola.' : 'Carregando escolas…')}</p>
    <button onClick={logout}>Sair</button>
  </main>;
  return <SchoolWorkspace key={school} {...{ client, logout, authNotice, schools, school, setSchool }} isAdmin={admins.includes(school)} />;
}

function SchoolWorkspace({ client, logout, authNotice, schools, school, setSchool, isAdmin }: {
  client: NonNullable<typeof db>;
  logout: () => Promise<void>;
  authNotice: string;
  schools: School[];
  school: string;
  setSchool: (id: string) => void;
  isAdmin: boolean;
}) {
  const [logo, setLogo] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void client.from('school_logos').select('png').eq('school_id', school)
      .abortSignal(controller.signal).maybeSingle().then(({ data }) => {
        if (controller.signal.aborted) return;
        const hex = typeof data?.png === 'string' && data.png.startsWith('\\x') ? data.png.slice(2) : '';
        if (hex) {
          const bytes = hex.match(/../g) ?? [];
          setLogo('data:image/png;base64,' + btoa(bytes.map(byte => String.fromCharCode(parseInt(byte, 16))).join('')));
        }
        setLogoLoading(false);
      });
    return () => controller.abort();
  }, [client, school]);
  const [local, setResources] = useState<Resource[]>([]);
  const [active, setBookings] = useState<Booking[]>([]);
  const [tab, setTab] = useState('agenda');
  const [resourceId, setResourceId] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [chosenPeriod, setPeriod] = useState(1);
  const [periods, setPeriods] = useState<Period[]>();
  const [periodError, setPeriodError] = useState('');
  const allPeriods = periods?.length ? periods : legacyPeriods;
  const [chosenGroup, setGroup] = useState('');
  const groups = [...new Map(allPeriods.filter(slot => slot.active && slot.shift).map(slot => [
    JSON.stringify([slot.shift, slot.segment]), slot.shift + ' · ' + slot.segment,
  ])).entries()];
  const group = groups.some(([value]) => value === chosenGroup) ? chosenGroup : groups[0]?.[0];
  const activePeriods = allPeriods.filter(slot => slot.active && (!group || JSON.stringify([slot.shift, slot.segment]) === group));
  const period = activePeriods.find(slot => slot.period === chosenPeriod)?.period ?? activePeriods[0]?.period ?? 0;

  async function reloadPeriods() {
    const { data, error } = await client.from('school_periods').select('period,segment,shift,label,starts,ends,active')
      .eq('school_id', school).order('starts').order('period');
    if (error) {
      setPeriodError('Não foi possível carregar os horários. Confira a migração da v0.4.1.');
      return;
    }
    setPeriodError('');
    setPeriods(data);
  }

  useEffect(() => { void reloadPeriods(); }, [client, school]);
  const [classGroup, setClassGroup] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Equipamentos');
  const [count, setCount] = useState(1);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [calendar, setCalendar] = useState<{ date: string; refresh: number; rows: Restriction[] }>();
  const restrictions = calendar?.date === date && calendar.refresh === refresh ? calendar.rows : [];
  const blocked = restrictionFor(restrictions, date, period);

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    void client.from('calendar_restrictions').select('date,period,reason')
      .eq('school_id', school).eq('date', date).abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (!controller.signal.aborted && !error) setCalendar({ date, refresh, rows: data });
      });
    return () => controller.abort();
  }, [client, school, date, refresh]);
  const [snapshot, setSnapshot] = useState<{ key: string; slots: Slot[] }>();
  const selected = local.find(row => row.id === resourceId && row.active) ?? local.find(row => row.active);
  const selectedId = selected?.id;
  const availabilityKey = JSON.stringify([selectedId, date, refresh]);
  const availability = snapshot?.key === availabilityKey ? snapshot.slots : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      client.from('resources').select('id,name,category,quantity,active').eq('school_id', school).order('name').abortSignal(controller.signal),
      client.from('reservations').select('id,resource_id,date,period,quantity,class_group,calendar_conflict').eq('school_id', school)
        .is('cancelled_at', null).order('date').order('period').abortSignal(controller.signal),
    ]).then(([resources, bookings]) => {
      if (controller.signal.aborted) return;
      setLoadError(resources.error || bookings.error ? 'Falha ao atualizar recursos ou reservas.' : '');
      if (!resources.error) setResources(resources.data);
      if (!bookings.error) setBookings(bookings.data);
    });
    return () => controller.abort();
  }, [client, school, refresh]);

  useEffect(() => {
    if (!selectedId || !date) return;
    const controller = new AbortController();
    void client.rpc('resource_availability', {
      p_school: school, p_resource: selectedId, p_date: date,
    }).abortSignal(controller.signal).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      if (error) setNotice('Falha ao consultar a disponibilidade.');
      else setSnapshot({ key: availabilityKey, slots: data });
    });
    return () => controller.abort();
  }, [client, school, selectedId, date, availabilityKey]);

  async function change(
    request: () => PromiseLike<{ error: { code: string; message: string } | null; status: number }>,
    success: string,
    onSuccess?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      const { error, status } = await request();
      if (!error) {
        setNotice(success);
        onSuccess?.();
      } else if (error.code === 'P0001') setNotice(error.message);
      else if (error.code === '40001') setNotice('Houve uma alteração simultânea. Consulte a disponibilidade e tente novamente.');
      else if (!status || status >= 500) setNotice('Resultado incerto. Confira a lista de reservas antes de repetir.');
      else setNotice('Não foi possível concluir a operação. Confira os dados e suas permissões.');
    } catch {
      setNotice('Resultado incerto. Confira a lista de reservas antes de repetir.');
    } finally {
      setRefresh(value => value + 1);
      setBusy(false);
    }
  }

  function reserve() {
    if (!classGroup.trim()) { setNotice('Informe a turma que usará o recurso.'); return; }
    if (!selected || !date || !Number.isInteger(quantity) || quantity < 1 || quantity > selected.quantity) {
      setNotice('Informe uma data e uma quantidade válida para o recurso.');
      return;
    }
    const id = selected.id;
    void change(() => client.rpc('reserve_resource_for_class', {
      p_school: school, p_resource: id, p_date: date, p_period: period, p_quantity: quantity, p_class_group: classGroup.trim(),
    }), 'Reserva confirmada.');
  }

  function add() {
    if (!name.trim() || !Number.isInteger(count) || count < 1 || count > 2147483647) {
      setNotice('Informe nome e quantidade válida.');
      return;
    }
    void change(() => client.from('resources').insert({
      school_id: school, name: name.trim(), category, quantity: count,
    }), 'Recurso cadastrado.', () => setName(''));
  }

  function cancel(id: string) {
    void change(() => client.rpc('cancel_reservation', {
      p_school: school, p_reservation: id,
    }), 'Reserva cancelada.');
  }

  function toggle(resource: Resource) {
    void change(() => client.from('resources').update({ active: !resource.active })
      .eq('school_id', school).eq('id', resource.id).select('id').single(), 'Recurso atualizado.');
  }

return <><header><div className="school-brand">{logo && <img className="school-logo" src={logo} alt={schools.find(unit => unit.id === school)?.name ?? "Logotipo da escola"} />}<div><strong>SRDs</strong><small>Sistema de Reservas de Recursos Didáticos</small></div></div><span className="version">v{version}</span><button onClick={logout}>Sair</button></header><main><section className="hero"><div><h1>Gestão de recursos escolares</h1><p>Reserve espaços, equipamentos e materiais pedagógicos.</p></div><label>Unidade escolar<select value={school} onChange={e=>{const id=e.target.value;setSchool(id)}}>{schools.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></section><nav>{[['agenda','Agenda e reserva'],['recursos','Recursos'],['minhas','Reservas'],['admin','Administração'],['calendar','Calendário escolar']].filter(([id])=>(id!=='admin'&&id!=='calendar')||isAdmin).map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setNotice('')}}>{label}</button>)}</nav>{periodError && <p role="alert">{periodError}</p>}{(authNotice || notice || loadError) && <p role="status" className="notice">{authNotice || notice || loadError}</p>}
{tab==='agenda'&&<div className="columns"><section className="panel"><h2>Nova reserva</h2><label>Recurso<select value={selected?.id||''} onChange={e=>setResourceId(e.target.value)}>{local.filter(x=>x.active).map(x=><option value={x.id} key={x.id}>{x.name} ({x.quantity} un.)</option>)}</select></label><label>Data<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>{group && <label>Turno e segmento<select value={group} onChange={e=>setGroup(e.target.value)}>{groups.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}<label>Período<select value={period} onChange={e=>setPeriod(Number(e.target.value))}>{activePeriods.map(slot=><option value={slot.period} key={slot.period}>{periodLabel(slot)}</option>)}</select></label><label>Turma<input value={classGroup} maxLength={40} onChange={e=>setClassGroup(e.target.value)} placeholder="Ex. 61" required /></label><label>Quantidade<input type="number" min="1" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label><button className="primary" disabled={busy||!selected||!date||!!blocked||!period||!periods||!!periodError||!classGroup.trim()} onClick={reserve}>Confirmar reserva</button>{blocked && <p role="status">{blocked.reason}</p>}</section><section className="panel"><h2>Disponibilidade do dia</h2><p className="muted">{date} · {selected?.name}</p>{activePeriods.map(slot=>{const x=slot.period;const restriction=restrictionFor(restrictions,date,x);const used=availability?.find(slot=>slot.period===x)?.used ?? 0;return <div className="slot" key={x}><strong>{periodLabel(slot)}</strong><span className={restriction||used>=(selected?.quantity||1)?'busy':'free'}>{restriction?.reason ?? (availability && selected ? used + "/" + selected.quantity + " reservados" : "—")}</span></div>})}</section></div>}
{tab==='recursos'&&<section className="panel"><h2>Catálogo</h2><div className="cards">{local.map(x=><article className="resource" key={x.id}><span className="tag">{x.category}</span><h3>{x.name}</h3><p>{x.quantity} unidade(s)</p><span>{x.active?'Ativo':'Inativo'}</span></article>)}</div></section>}
{tab==='minhas'&&<section className="panel"><h2>{isAdmin ? "Reservas da unidade" : "Minhas reservas"}</h2>{active.length===0?<p>Nenhuma reserva ativa.</p>:active.map(x=><div className="booking" key={x.id}><div><strong>{local.find(r=>r.id===x.resource_id)?.name}</strong><p>{x.date} · {periodLabel(allPeriods.find(slot=>slot.period===x.period) ?? { ...legacyPeriods[0], label: x.period + "ª aula" })} · {x.quantity} un. · {x.class_group ? "Turma " + x.class_group : "Turma não informada"}</p>{x.calendar_conflict && <p className="busy">Conflito com o calendário · {x.calendar_conflict}</p>}</div><button disabled={busy} onClick={()=>cancel(x.id)}>Cancelar</button></div>)}</section>}
{tab==='admin'&&isAdmin&&<div className="columns"><section className="panel"><h2>Cadastrar recurso</h2><label>Nome<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Categoria<select value={category} onChange={e=>setCategory(e.target.value)}>{['Espaços','Equipamentos','Materiais'].map(x=><option key={x}>{x}</option>)}</select></label><label>Quantidade<input type="number" min="1" value={count} onChange={e=>setCount(Number(e.target.value))}/></label><button className="primary" disabled={busy} onClick={add}>Adicionar recurso</button></section><section className="panel"><h2>Gerenciar recursos</h2>{local.map(x=><div className="booking" key={x.id}><div><strong>{x.name}</strong><p>{x.quantity} un. · {x.category}</p></div><button disabled={busy} onClick={()=>toggle(x)}>{x.active?'Desativar':'Ativar'}</button></div>)}</section></div>}
{tab==='admin'&&isAdmin&&!logoLoading&&<SchoolLogoAdmin client={client} school={school} logo={logo} onChange={setLogo} />}
{tab==='admin'&&isAdmin&&periods&&<SchoolPeriods client={client} school={school} periods={periods} reload={reloadPeriods} />}
{tab==='calendar'&&isAdmin&&<CalendarAdmin client={client} school={school} periods={allPeriods} onPublish={()=>setRefresh(value=>value+1)} />}
</main></>}

createRoot(document.getElementById('root')!).render(<App />);


