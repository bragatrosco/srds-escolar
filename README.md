# SRDs — Sistema de Reservas de Recursos Didáticos

Protótipo **v0.1** para gestão de reservas de espaços, equipamentos e materiais pedagógicos em múltiplas escolas.

## Executar
Requer Node.js 22+.

```bash
npm install
npm run dev
```

## Publicar
O workflow em `.github/workflows/deploy.yml` prepara o GitHub Pages. Em Settings → Pages, selecionar **GitHub Actions**. O repositório está privado; a disponibilidade de Pages depende do plano GitHub.

## Limitações
A v0.1 usa dados fictícios no `localStorage`. Não existe login real nem sincronização entre dispositivos. **Não usar para reservas oficiais.**

## Próximas versões
Supabase/PostgreSQL, autenticação, isolamento seguro por escola, transações atômicas de reserva, calendário configurável, auditoria e LGPD.

Veja `docs/requisitos.md`.
