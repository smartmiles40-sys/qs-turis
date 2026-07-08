# Integrações n8n do QS Turis

4 workflows prontos pra importar (menu **⋮ → Import from File** no n8n):

| Arquivo | O que faz | Gatilho |
|---|---|---|
| `qs-inbound-leads.workflow.json` | Formulário/LP → QS (cria o card e as tarefas) | Webhook (form) |
| `bitrix-to-qs.workflow.json` | Bitrix → QS via `crm.deal.get`/`crm.contact.get` (Etapa 1.1) | Webhook do Bitrix |
| `bitrix-inbound-to-qs.workflow.json` | **⭐ Bitrix → QS pelos dados do próprio webhook** (querystring; NÃO chama o Bitrix de volta) → `/api/lead-inbound` | Webhook do Bitrix |
| `qs-to-bitrix-webhook.workflow.json` | **⭐ QS → Bitrix por EVENTO**: cada botão (perdido/ganho/reunião/nota) dispara na hora | Webhook (por botão) |
| `qs-to-bitrix-sync.workflow.json` | ⚠️ **APOSENTADO** — versão antiga por polling. Substituído pelo de cima. **Não deixe os dois ativos.** | A cada 1 min |
| `chatapp-token-refresh.workflow.json` | **Valida/renova o token do ChatApp** e grava no banco (Etapa 2.4) | A cada 6 h |

Antes de ativar qualquer um: aplique o `supabase/APLICAR-PENDENTES.sql` no SQL
Editor do Supabase (cria `bitrix_id`, flags de sync, `qs_settings` etc.).

---

## Credenciais (criar 1 vez no n8n)

### 1. `QS Lead Secret (x-lead-secret)` — tipo **Header Auth**
- **Header Name:** `x-lead-secret`
- **Header Value:** valor de `LEAD_INBOUND_SECRET` (está no `.env` do projeto e
  no `CREDENCIAIS.local.md`, que não vai pro git)
- Usada por: *qs-inbound-leads* e *bitrix-to-qs* (nó "Enviar ao QS").

### 2. `Supabase QS (apikey service_role)` — tipo **Header Auth**
- **Header Name:** `apikey`
- **Header Value:** valor de `SUPABASE_SERVICE_ROLE_KEY` (está no `.env` do projeto —
  ⚠️ chave poderosa, ignora RLS; só dentro do n8n, nunca no navegador)
- Usada por: *qs-to-bitrix-sync* (todos os nós Supabase) e *chatapp-token-refresh*
  (nó "Gravar em qs_settings").

Depois de importar cada workflow, abra os nós que pedem credencial e selecione a
credencial certa (o JSON traz o nome, mas o ID muda por instância).

---

## `bitrix-to-qs` — Bitrix → QS (Etapa 1.1)

**Fluxo:** webhook do Bitrix (negócio criado) → busca o negócio (`crm.deal.get`)
→ busca o contato (`crm.contact.get`) → mapeia → `POST /api/lead-inbound` com
`bitrix_id` (**não duplica**: o mesmo negócio nunca cria dois cards; e é esse
vínculo que permite a volta QS→Bitrix mover a coluna certa).

**Configurar (2 lugares):**

1. **No workflow (2 nós de busca):** troque `PREENCHA_BITRIX_WEBHOOK_BASE` pela
   URL do seu **webhook de entrada** do Bitrix (Recursos p/ desenvolvedores →
   Outros → Webhook de entrada). Formato:
   `https://SEUPORTAL.bitrix24.com.br/rest/USERID/CODIGO`
   (precisa de permissão **CRM**). É a mesma base que seus workflows atuais de
   `crm.contact.add`/`crm.deal.add` já usam.

2. **No Bitrix (webhook de saída):** Recursos p/ desenvolvedores → Outros →
   **Webhook de saída** → evento **`ONCRMDEALADD`** (negócio criado) → URL =
   a **Production URL** do nó "Webhook Bitrix" deste workflow (aparece depois de
   ativar o workflow; termina com `/webhook/qs-bitrix-inbound`).
   - Quiser também leads do módulo Leads? Adicione outro webhook de saída com
     `ONCRMLEADADD` apontando pra mesma URL (o fluxo usa `crm.deal.get`; pra
     leads seria `crm.lead.get` — me avise que eu adapto).

**Teste:** crie um negócio de teste no Bitrix → em ~5 s o card aparece no QS
(distribuído pro SDR com menos carga + tarefas da cadência criadas).

---

## ⭐ `bitrix-inbound-to-qs` — Bitrix → QS (o lead entra no QS)

O Bitrix (webhook de saída/robô) já manda os campos do lead na **querystring**
(`?Nome=&telefone=&E-mail=&Fonte=&Score=&ID=`), então **não precisa chamar o
Bitrix de volta**. Fluxo: `Webhook` → `Normalizar` (querystring → campos) →
`POST /api/lead-inbound` (header `x-lead-secret`, dedupe por `bitrix_id`).

**Validado em produção (2026-07-08):** POST no `/api/lead-inbound` cria o lead em
`qs_leads` e o **dedupe por `bitrix_id` funciona** (reenviar o mesmo ID não
duplica). O QS é o espelho do Supabase → o card aparece assim que a linha entra.

**⚠️ Bug no workflow atual do Bruno:** o nó **"Enviar ao Supabase"** grava na
tabela **`qs_settings`** (config, colunas `key/value`) — os campos do lead não
existem lá, então **o lead não entra**. Conserto (2 opções):

- **Mais simples — edita 1 nó no seu workflow:** no nó "Enviar ao Supabase" troque
  a URL para `https://qs-turis.vercel.app/api/lead-inbound`, a credencial para
  **Header Auth `QS Lead Secret (x-lead-secret)`**, e o corpo para
  `full_name` = `{{ $json.full_name }}`, `phone` = `{{ $json.phone }}`,
  `email` = `{{ $json.email }}`, **`bitrix_id` = `{{ $json.ID }}`**,
  `segment` = `{{ $json.Fonte }}`, `source` = `{{ $json.source }}`.
- **Ou importe** `bitrix-inbound-to-qs.workflow.json` (já pronto) e **desative o
  branch antigo** — os dois usam o path `qs-lead-inbound`, e o n8n não deixa dois
  webhooks ativos no mesmo path.

Depois selecione a credencial `x-lead-secret` no nó e **ative**.

> **Sem SDR/cadência**, o lead entra **sem dono e sem tarefas** (mas aparece — o
> admin vê tudo). Pra distribuir + gerar tarefas: crie ≥1 SDR (Config → Usuários)
> e 1 cadência "Disponível" com atividades.

---

## ⭐ `qs-to-bitrix-webhook` — QS → Bitrix por EVENTO (novo padrão)

Em vez de varrer o banco a cada 1 min, **o próprio botão no QS dispara** um
webhook na hora que o SDR age. Menos execução ociosa no n8n, e a coluna do
Bitrix muda na hora certa. São **4 webhooks** (um "por botão"), cada um numa
linha do canvas:

| Evento | Path do webhook | O que faz no Bitrix |
|---|---|---|
| Perdido | `/webhook/qs-perdido` | acha o deal → move pra coluna de **Perdido** (+ motivo) |
| Ganho | `/webhook/qs-ganho` | acha o deal → move pra coluna de **Ganho** |
| Reunião | `/webhook/qs-reuniao` | acha o deal → move pra **Reunião agendada** + comentário com todos os campos (+ nó de UF desativado) |
| Nota | `/webhook/qs-nota` | comentário na timeline do negócio |

**Fluxo de cada branch:** Webhook (recebe `bitrix_id` + dados do body do app) →
`crm.deal.get` (acha o deal) → `crm.deal.update` (move a coluna / preenche) →
o **Bitrix faz o resto** pelas automações dele. Nota é só `crm.timeline.comment.add`.

### Configurar (3 coisas)

1. **`PREENCHA_BITRIX_WEBHOOK_BASE`** (nos nós HTTP do Bitrix): a mesma base REST
   dos outros workflows (`https://SEUPORTAL.bitrix24.com.br/rest/USERID/CODIGO`).
2. **IDs das colunas (stages)** — já preenchidos p/ o funil comercial (categoria 25):
   - Perdido → **`C25:LOSE`** ("Leads perdidos")
   - Reunião agendada → **`C25:WON`** ("Reunião Agendada")
   - Ganho → **`C25:WON`** (nesse funil o positivo do SDR **é** a Reunião Agendada;
     não há coluna "Ganho" separada)
   - Conferidos via `crm.status.list?filter[ENTITY_ID]=DEAL_STAGE_25` em 2026-07.
     Se mudar o funil, reliste (CRM → Configurações → Funis e etapas; ou
     `crm.dealcategory.stage.list?id=25`).
3. **App (Vercel):** defina `VITE_N8N_SYNC_BASE` = a base dos webhooks **SEM barra
   final** (ex.: `https://SEU-N8N/webhook`). O app acrescenta `/qs-<evento>`.
   Depois **ative** o workflow (é aí que os paths passam a existir) e faça um
   **redeploy** do app pra env var entrar no bundle.

**Opcional — preencher campos do negócio na reunião:** o nó
**"Preencher campos da reunião (AJUSTAR UF_*)"** vem **DESATIVADO**. Quando você
listar os campos do Bitrix, troque os `PREENCHA_UF_*` pelos códigos reais
(ex.: `UF_CRM_1234567890`) e ative. Os dados já chegam no body
(`scheduled_at`, `meeting_owner`, `scheduled_by`, `client_email`, `booking_date`).

### ⚠️ Ao ligar este, DESLIGUE o `qs-to-bitrix-sync` (1 min)

Os dois fazem a mesma coisa por caminhos diferentes. Rodando juntos, a coluna
seria movida duas vezes (uma pelo webhook, outra pelo polling). Deixe **só o
webhook ativo**.

### Coisas que você precisa saber (trade-offs do disparo pelo navegador)

- **Sem retry:** se a chamada falhar (rede caiu, n8n fora), aquele espelhamento
  se perde — o QS **não** re-tenta (a gravação no Supabase é a fonte da verdade;
  o Bitrix é espelho). Se um dia quiser rede de segurança, dá pra reativar o
  `qs-to-bitrix-sync` numa frequência baixa (ex.: 1×/dia) só como reconciliação.
- **CORS:** os webhooks vêm com `allowedOrigins: "*"`. Se o navegador reclamar de
  CORS, troque `*` pelo domínio do app (`https://qs-turis.vercel.app`) nos nós de
  webhook (aba **Options → Allowed Origins**).
- **`bitrix_id`:** lead que não veio do Bitrix não tem `bitrix_id` → o app
  **pula** o disparo (não há deal pra mover). Todo lead que entra pelo
  `bitrix-to-qs` já nasce vinculado.
- **Onde os botões disparam:** `LeadDetailPage` (marcar ganho/perdido, agendar
  reunião, nota) e `TasksPanel` (desfecho da tarefa, "Ganho = agendar reunião",
  observação "Salvar no Bitrix"). Um botão **novo** no futuro não sincroniza
  sozinho — é preciso chamar `notifyBitrix(...)` nele (`src/lib/qs/bitrixSync.ts`).

---

## `qs-to-bitrix-sync` — QS → Bitrix por polling (LEGADO / aposentado)

Versão antiga: um Schedule de 1 min varria o Supabase em 3 faixas
(perdido/ganho, reuniões, notas). **Substituído pelo `qs-to-bitrix-webhook`.**
Mantido no repo só como referência / possível rede de segurança de baixa
frequência. **Não deixe ativo junto com o webhook.**

---

## `chatapp-token-refresh` — token do ChatApp sempre válido (Etapa 2.4)

**O problema:** o token da API do ChatApp expira (24 h) e há limite de
**100 tokens/dia**. Por isso o envio direto pelo QS quebrava.

**A solução:** a cada 6 h o n8n gera um token novo (`POST v1/tokens` — só 4/dia)
e grava em `qs_settings` (chave `chatapp_token`). O QS lê dali na hora de enviar
("Enviar pelo ChatApp" tenta a API primeiro; sem token válido, cai no
comportamento antigo de abrir o cabinet com a mensagem copiada).

**Configurar (nós 2 e 3):**
- Nó **"Gerar token"**: troque `PREENCHA_CHATAPP_EMAIL`, `PREENCHA_CHATAPP_SENHA`
  e `PREENCHA_CHATAPP_APP_ID` pelos dados da conta ChatApp
  (cabinet.chatapp.online → perfil/API).
- Nó **"Validar e montar registro"**: troque `PREENCHA_CHATAPP_LICENSE_ID` pelo
  licenseId da licença do WhatsApp.
- Selecione a credencial Supabase no último nó. Ative e rode 1x manual
  (**Execute workflow**) pra já deixar o token gravado.

---

## `qs-inbound-leads` — Formulário/LP → QS (já existia)

Fluxo de teste form → QS. Pra ligar no fluxo real, copie o nó **"Enviar ao QS"**
pro seu workflow do Bitrix e puxe uma segunda seta do nó que tem os dados do
lead (bifurcação: o lead vai pro Bitrix E pro QS). Detalhes/mapeamento de campos:
ver histórico deste README no git.

> Com o `bitrix-to-qs` ativo, a bifurcação fica **opcional** — o caminho
> LP → Bitrix → (webhook) → QS já cobre, e com `bitrix_id` vinculado (melhor).
> Use a bifurcação só se quiser o lead no QS mesmo quando o Bitrix estiver fora.

---

## Segurança

- Segredos **nunca** ficam nos workflows: `x-lead-secret` e a service key do
  Supabase moram em **credenciais** do n8n; e-mail/senha do ChatApp ficam dentro
  do nó na SUA instância (não neste repositório — aqui só `PREENCHA_*`).
- Se algo vazar: troque `LEAD_INBOUND_SECRET` na Vercel + credencial no n8n;
  gere outra service key no Supabase; troque a senha do ChatApp.
