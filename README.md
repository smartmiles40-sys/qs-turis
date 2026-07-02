# QS Turis — Sistema de Qualificação de Leads (SDR)

CRM de prospecção/qualificação: leads, cadências de contato, painel de tarefas do dia
(com follow-up automático), reuniões, metas, dashboard e WhatsApp integrado.

**Stack:** React 19 + Vite + TypeScript + Tailwind + Supabase. Funções serverless em `/api`
(Vercel) para a integração de WhatsApp (ChatApp).

## Rodar localmente

```bash
npm install
cp .env.example .env        # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev                 # http://localhost:3000
```

Primeiro acesso: **admin@qsturis.com / admin123** (troque a senha depois).

## Configuração

- **Banco (obrigatório):** crie o projeto Supabase e aplique o schema — passo a passo em
  [`docs/SUPABASE.md`](docs/SUPABASE.md). Schema: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
- **WhatsApp (opcional):** para enviar mensagem pelo sistema, preencha `.env.chatapp.local`
  (ver `.env.chatapp.example`). Detalhes e o que dá pra fazer com ligação em
  [`docs/WHATSAPP.md`](docs/WHATSAPP.md).

## Estrutura

```
src/
  components/sdr/     páginas do CRM (leads, cadences, tasks, meetings, goals, dashboard, settings)
  components/sdr/whatsapp/  modal reutilizável de WhatsApp
  contexts/          autenticação (QsAuthContext)
  lib/               supabase, chatapp, whatsapp, qs/queries
api/                 funções serverless (chatapp-send)
supabase/            migrations + seed
docs/                guias (Supabase, WhatsApp)
```

## Scripts

- `npm run dev` — servidor de desenvolvimento (com ponte de `/api`)
- `npm run build` — type-check + build de produção
- `npm run preview` — pré-visualiza o build
- `npm run lint` — oxlint
