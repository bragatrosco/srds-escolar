# SRDs — Requisitos v0.1

## Objetivo
Agendar recursos didáticos compartilhados de uma ou mais unidades escolares.

## Perfis futuros
Professor, responsável pelos recursos e administrador.

## Requisitos da demonstração
- Seleção de unidade escolar e isolamento lógico por schoolId.
- Catálogo de espaços, equipamentos e materiais.
- Cadastro e ativação/desativação de recursos.
- Reservas por data e período, com quantidade.
- Bloqueio local de reservas conflitantes.
- Consulta e cancelamento de reservas.
- Persistência local e layout responsivo.

## Limitações explícitas
Sem autenticação, autorização, servidor, sincronização, auditoria ou garantia de concorrência entre navegadores. Não utilizar com dados pessoais reais.

## v0.2
PostgreSQL/Supabase, autenticação, políticas RLS por unidade, verificação transacional de capacidade, configuração de turnos e horários, LGPD e testes integrados.
