import { useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function SchoolLogoAdmin({ client, school, logo, onChange }: {
  client: SupabaseClient;
  school: string;
  logo: string | null;
  onChange: (logo: string | null) => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function save(file: File | null) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (!file) {
        const { error } = await client.from('school_logos').delete().eq('school_id', school).select('school_id').single();
        if (error) throw new Error('Não foi possível remover o logotipo.');
        onChange(null);
        setMessage('Logotipo removido.');
        return;
      }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        throw new Error('Escolha um arquivo PNG, JPEG ou WebP de até 2 MB.');
      }
      const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error('Não foi possível ler a imagem.');
      });
      const canvas = document.createElement('canvas');
      try {
        if (bitmap.width > 512 || bitmap.height > 512) {
          throw new Error('O logotipo deve ter no máximo 512 × 512 pixels.');
        }
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Não foi possível preparar a imagem.');
        context.drawImage(bitmap, 0, 0);
      } finally {
        bitmap.close();
      }

      const source = canvas.toDataURL('image/png');
      const bytes = atob(source.split(',')[1]);
      if (bytes.length > 262144) throw new Error('A imagem ficou acima de 256 KB após a conversão. Envie uma versão mais leve.');
      const hex = Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      const { error } = await client.from('school_logos').upsert({ school_id: school, png: '\\x' + hex });
      if (error) throw new Error('Não foi possível salvar. Confira se a migração de logotipos foi aplicada e se você é administrador da escola.');
      onChange(source);
      setMessage('Logotipo salvo.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o logotipo.');
    } finally {
      if (input.current) input.current.value = '';
      setBusy(false);
    }
  }

  return <section className="panel">
    <h2>Logotipo da escola</h2>
    {logo && <img className="school-logo" src={logo} alt="Logotipo atual" />}
    <label>Arquivo do logotipo<input ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} /></label>
    <p className="muted">PNG, JPEG ou WebP. Até 512 × 512 pixels e 2 MB no envio. Limite de 256 KB após conversão para PNG.</p>
    <button className="primary" disabled={busy} onClick={() => {
      const file = input.current?.files?.[0];
      if (file) void save(file);
      else setMessage('Selecione uma imagem.');
    }}>Salvar logotipo</button>
    {logo && <button disabled={busy} onClick={() => void save(null)}>Remover logotipo</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}


