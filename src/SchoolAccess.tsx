import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Request = { user_id: string; registration: string; job_title: string; job_function: string; email: string; status: string };
const functional = /^[^@\s]+@prof\.pmf\.sc\.gov\.br$/i;

export function AccessForm({ client, mode, back }: {
  client: SupabaseClient; mode: 'signup' | 'reset' | 'password'; back: () => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('email') ?? '').trim().toLowerCase();
    const password = String(fields.get('password') ?? '');
    if (mode !== 'password' && !functional.test(email)) {
      setMessage('Use seu e-mail funcional @prof.pmf.sc.gov.br.');
      return;
    }
    if (mode !== 'reset' && !/^[0-9]{8}$/.test(password)) {
      setMessage('Use exatamente oito algarismos na senha.');
      return;
    }
    const redirectTo = window.location.origin + window.location.pathname;
    setBusy(true);
    try {
      const result = mode === 'signup'
        ? await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
        : mode === 'reset'
          ? await client.auth.resetPasswordForEmail(email, { redirectTo })
          : await client.auth.updateUser({ password });
      if (result.error) setMessage('Não foi possível concluir. Confira os dados ou tente novamente mais tarde.');
      else if (mode === 'password') {
        await client.auth.signOut();
        back();
      } else setMessage(mode === 'signup'
        ? 'Confira seu e-mail funcional. Após confirmar, entre para solicitar acesso à escola.'
        : 'Se houver uma conta para esse e-mail, você receberá o link de recuperação.');
    } finally { setBusy(false); }
  }
  return <form className="panel" onSubmit={submit}>
    <h1>{mode === 'signup' ? 'Criar conta' : mode === 'reset' ? 'Recuperar senha' : 'Definir nova senha'}</h1>
    {mode !== 'password' && <label>E-mail funcional<input name="email" type="email" autoComplete="username" required /></label>}
    {mode !== 'reset' && <label>Senha de oito algarismos<input name="password" type="password"
      autoComplete="new-password" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required /></label>}
    <button className="primary" disabled={busy}>Confirmar</button>
    {mode !== 'password' && <button type="button" onClick={back}>Voltar ao login</button>}
    {message && <p role="status">{message}</p>}
  </form>;
}

export function SchoolAccess({ client, logout }: { client: SupabaseClient; logout: () => Promise<void> }) {
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [request, setRequest] = useState<Request | null>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [choices, existing] = await Promise.all([
      client.rpc('access_school_choices'),
      client.from('access_requests').select('status').maybeSingle(),
    ]);
    if (choices.error || existing.error) {
      setMessage('Não foi possível consultar seu acesso.');
      return;
    }
    setSchools(choices.data);
    setRequest(existing.data as Request | null);
  }
  useEffect(() => { void load(); }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const { error } = await client.rpc('request_school_access', {
        p_school: data.get('school'), p_registration: data.get('registration'),
        p_title: data.get('title'), p_function: data.get('function'),
      });
      if (error) setMessage(error.code === '23505'
        ? 'Já existe um pedido para esta conta ou matrícula.' : 'Não foi possível enviar o pedido. Confira os campos.');
      else { setMessage(''); await load(); }
    } finally { setBusy(false); }
  }

  return <main><section className="panel">
    <h1>Acesso à escola</h1>
    {request ? <p>{request.status === 'pending' ? 'Seu pedido aguarda aprovação da escola.'
      : request.status === 'rejected' ? 'A escola recusou o pedido. Entre em contato com a administração.'
      : 'Pedido aprovado. Atualize a página para carregar a escola.'}</p>
      : request === null && (schools.length ? <form onSubmit={submit}>
        <label>Escola<select name="school" required defaultValue=""><option value="" disabled>Selecione</option>
          {schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
        </select></label>
        <label>Matrícula funcional<input name="registration" inputMode="numeric" pattern="[0-9]{1,30}" required maxLength={30} /></label>
        <label>Cargo<input name="title" required maxLength={80} /></label>
        <label>Função<input name="function" required maxLength={80} /></label>
        <button className="primary" disabled={busy}>Solicitar acesso</button>
      </form> : <p>Confirme o e-mail funcional e confira se sua escola já está cadastrada.</p>)}
    {message && <p role="status">{message}</p>}
    <button onClick={logout}>Sair</button>
  </section></main>;
}

export function AccessReview({ client, school }: { client: SupabaseClient; school: string }) {
  const [rows, setRows] = useState<Request[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void client.from('access_requests').select('user_id,registration,job_title,job_function,email,status')
      .eq('school_id', school).eq('status', 'pending').abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) setMessage('Não foi possível carregar os pedidos.');
        else setRows(data);
      });
    return () => controller.abort();
  }, [client, school]);

  async function review(id: string, approve: boolean) {
    if (!window.confirm(approve ? 'Aprovar acesso a esta escola?' : 'Recusar este pedido?')) return;
    setBusy(true);
    try {
      const { error } = await client.rpc('review_school_access', { p_school: school, p_user: id, p_approve: approve });
      setMessage(error ? 'Não foi possível analisar o pedido. Atualize a página.' : approve ? 'Acesso aprovado.' : 'Pedido recusado.');
      if (!error) setRows(current => current.filter(row => row.user_id !== id));
    } finally { setBusy(false); }
  }

  return <section className="panel"><h2>Pedidos de acesso</h2>
    {rows.length === 0 && !message && <p>Nenhum pedido pendente.</p>}
    {rows.map(row => <div className="booking" key={row.user_id}>
      <div><strong>{row.email}</strong><p>Matrícula {row.registration} · {row.job_title} · {row.job_function}</p></div>
      <div><button disabled={busy} onClick={() => void review(row.user_id, true)}>Aprovar</button>
        <button disabled={busy} onClick={() => void review(row.user_id, false)}>Recusar</button></div>
    </div>)}
    {message && <p role="status">{message}</p>}
  </section>;
}


