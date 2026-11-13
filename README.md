# SRDs — Sistema de Reservas de Recursos Didáticos

A v0.2 usa Supabase Auth e Postgres. Cada usuário tem um papel por unidade. Professores consultam o catálogo, a disponibilidade agregada e as próprias reservas. Administradores da unidade gerenciam recursos e podem consultar e cancelar reservas da unidade.

## Executar localmente

Use Node.js 22 ou superior. Copie `.env.example` para `.env.local` na raiz e preencha as duas variáveis com a URL e a chave publicável do projeto. Execute `npm install`, `npm run build` e `npm run dev`. A chave publicável é enviada ao navegador. Mantenha chaves administrativas fora das variáveis VITE e do Git.

## Preparar o Supabase

1. Revise a migração em `supabase/migrations/` e confira se o projeto já possui tabelas com os mesmos nomes. Aplique primeiro em um projeto de teste, por meio do SQL Editor ou de uma migração revisada pela equipe.
2. Habilite autenticação por e-mail e senha. Crie os usuários em Authentication → Users. A aplicação usa contas provisionadas. Para um ambiente fechado, desabilite cadastro público.
3. Como administrador do banco, cadastre as escolas e vincule cada UUID de Authentication → Users à escola correspondente. Exemplo para o SQL Editor, substituindo os UUIDs.

```sql
insert into public.schools (name) values ('Nome da escola') returning id;
insert into public.school_members (school_id, user_id, role)
values ('UUID_DA_ESCOLA', 'UUID_DO_USUARIO', 'admin');
```

Repita o vínculo com papel `teacher` para professores. Os registros fictícios do navegador da v0.1 ficam fora do banco.

## Validar antes de publicar

- Acesse com duas contas em escolas diferentes e confirme que a escola, os recursos e as reservas da outra conta ficam inacessíveis.
- Na mesma escola, confirme que professores só podem consultar e cancelar as próprias reservas, e que somente administradores cadastram ou ativam recursos.
- Crie um recurso de capacidade 1. Envie duas reservas simultâneas para a mesma data e aula em sessões diferentes. Confira que apenas uma é confirmada. Cancele e confira que a vaga volta a ficar disponível.
- Para capacidade maior do que 1, teste reservas parciais, uma soma acima da capacidade e outra aula independente.

## Publicar

### Calendário escolar

Em um banco que já tem as tabelas da v0.2, revise e aplique apenas
`supabase/migrations/202611130002_school_calendar.sql` no Supabase de teste.
No SRDs, entre como administrador da escola, abra **Calendário escolar**,
selecione o ano e clique em **Abrir ano**.

O PDF original de 2026 da EBM Vitor Miguel de Souza carrega 45 sugestões
(feriados, pontos facultativos e recessos). Para outros arquivos, baixe o modelo
CSV e preencha `data;periodo;motivo` em UTF-8. Use datas no formato
`AAAA-MM-DD` e período 0 para dia inteiro ou 1 a 5 para uma aula.
Confira as datas e clique em **Publicar restrições**. A agenda mostra os motivos,
e a lista de reservas sinaliza os registros já confirmados nas datas afetadas.

Em teste, confirme o bloqueio em 20/11/2026 e 23/12/2026, uma reserva em
11/02/2026 com recurso disponível e o funcionamento de uma segunda escola
sem restrições publicadas. Para testar a validação no servidor, deixe a agenda
aberta em outra sessão antes de publicar um bloqueio e tente confirmar uma
reserva nessa sessão depois da publicação.

### GitHub Pages

Após validar o banco de teste, revise e aplique a migração no projeto de destino. Em Settings → Secrets and variables → Actions → Variables, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Em Settings → Pages, selecione GitHub Actions como origem, se o plano permitir publicar a partir do repositório privado. A atualização da `main` aciona a publicação. A branch `srds-v0.2` executa apenas a compilação.

