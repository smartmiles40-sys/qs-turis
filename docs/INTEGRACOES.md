# Integrações — leads automáticos, distribuição e login

## 1. Receber leads automaticamente (webhook)

Endpoint serverless que cria o lead, **distribui automaticamente** para um SDR
(round-robin por menor carga) e **gera as tarefas da cadência**.

- **URL (produção):** `https://SEU-APP.vercel.app/api/lead-inbound`
- **URL (dev):** `http://localhost:3000/api/lead-inbound`
- **Método:** `POST` (JSON)
- **Header obrigatório:** `x-lead-secret: <LEAD_INBOUND_SECRET>`
  (o valor está no seu `.env`, chave `LEAD_INBOUND_SECRET` — mantenha secreto, é server-to-server)

### Corpo (todos os campos são opcionais, menos ter algum identificador)
```json
{
  "full_name": "Maria Souza",
  "email": "maria@exemplo.com",
  "phone": "11999998888",
  "company_name": "Agência X",
  "segment": "Turismo",
  "city": "São Paulo",
  "state": "SP",
  "source": "integracao",
  "cadence_id": null,
  "owner_id": null,
  "estimated_value": null
}
```
Também aceita `first_name`/`last_name` no lugar de `full_name`, e `company` como
apelido de `company_name`.

### O que acontece
1. **Responsável:** se `owner_id` vier, usa ele; senão escolhe o SDR ativo com
   **menos leads em aberto** (distribuição equilibrada).
2. **Cadência:** se `cadence_id` vier, usa ela; senão pega a primeira cadência
   com status `disponível`. Se houver cadência, gera as **tarefas** (uma por
   atividade, agendadas conforme os dias da cadência).
3. Responde `{ success, lead_id, owner_id, cadence_id, tasks_created }`.

### Duas formas de ligar o n8n

**Opção A (recomendada) — n8n → este webhook.** Nó **HTTP Request**: `POST` na URL acima,
header `x-lead-secret`, body mapeando os campos do formulário/LP para o JSON. Vantagem: já
faz **distribuição round-robin + gera as tarefas da cadência** automaticamente.

**Opção B — n8n grava direto na tabela `qs_leads` do Supabase.** Se você preferir inserir o
lead direto (nó Supabase/Postgres do n8n), rode antes o gatilho
[`supabase/migrations/0003_auto_assign.sql`](../supabase/migrations/0003_auto_assign.sql):
ele **distribui automaticamente** todo lead inserido sem responsável para o SDR com menos
leads em aberto. (As tarefas da cadência, nesse caso, são geradas quando o lead entra numa
cadência pelo app — ou use a Opção A para já vir com tarefas.)

> Não chame o webhook direto do navegador do lead — o segredo ficaria exposto.
> O caminho certo é: formulário → n8n (guarda o segredo) → webhook/Supabase.

## 2. Login (mudou para Supabase Auth)

A autenticação agora é **Supabase Auth** de verdade (não mais senha em texto puro).
- Admin inicial: **admin@qsturis.com / admin123** (troque a senha em Configurações).
- Novos usuários criados em **Configurações → Usuários** já ganham a conta de login
  automaticamente (a tela cria a conta de autenticação + o perfil juntos).
- Para **blindar os dados** (LGPD): rode o bloco **(B)** de
  [`supabase/migrations/0002_features.sql`](../supabase/migrations/0002_features.sql).
  Depois disso, sem login ninguém acessa os dados.

## 3. Variáveis de ambiente na Vercel

No deploy (Vercel → Project Settings → Environment Variables), cadastre:

| Variável | Para quê |
|---|---|
| `VITE_SUPABASE_URL` | front (público) |
| `VITE_SUPABASE_ANON_KEY` | front (público) |
| `SUPABASE_URL` | funções /api (server) |
| `SUPABASE_SERVICE_ROLE_KEY` | funções /api (server) — **secreto**, nunca no front |
| `LEAD_INBOUND_SECRET` | proteção do webhook de leads |
| `CHATAPP_EMAIL` / `CHATAPP_PASSWORD` / `CHATAPP_APP_ID` / `CHATAPP_LICENSE_ID` | envio de WhatsApp |
| `INTERNAL_API_SECRET` | proteção da rota de envio de WhatsApp |

Os valores estão no seu `.env` e `.env.chatapp.local` locais (que **não** vão pro git).
