# Integrações n8n do QS Turis

4 workflows prontos pra importar (menu **⋮ → Import from File** no n8n):

| Arquivo | O que faz | Gatilho |
|---|---|---|
| `qs-inbound-leads.workflow.json` | Formulário/LP → QS (cria o card e as tarefas) | Webhook (form) |
| `bitrix-to-qs.workflow.json` | **Tudo que cai no Bitrix vira card no QS** (Etapa 1.1) | Webhook do Bitrix |
| `qs-to-bitrix-sync.workflow.json` | **QS → Bitrix**: perdido/ganho move a coluna, reunião e notas viram comentário (Etapas 1.2/1.3) | A cada 1 min |
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

## `qs-to-bitrix-sync` — QS → Bitrix (Etapas 1.2 e 1.3)

**Fluxo (a cada 1 min, 3 faixas):**

- **Perdido/Ganho (item 3):** leads com `status` ≠ `bitrix_status_synced` e com
  `bitrix_id` → `crm.deal.update` movendo a coluna → marca sincronizado.
  - Stage usados: `LOSE` (perdido) e `WON` (ganho) — são os do **funil padrão**.
    Se o funil for outro (ex.: `C5:LOSE`), ajuste no nó **"Mover coluna no
    Bitrix"** (CRM → Configurações → Funis e etapas mostra os IDs; ou chame
    `crm.dealcategory.stage.list`).
- **Reuniões (item 2):** reuniões novas → comentário na timeline do negócio com
  TODOS os campos (quando, quem agendou, responsável, e-mail, data do
  agendamento, observações) → marca sincronizada.
  - Há também um nó **"Preencher campos do negocio (AJUSTAR UF_*)"** que vem
    **DESATIVADO**: quando o Bruno listar os campos do Bitrix que devem ser
    preenchidos automaticamente, troque os `PREENCHA_UF_*` pelos códigos reais
    (ex.: `UF_CRM_1234567890`) e ative o nó. Os dados já estão estruturados
    (`scheduled_by`, `meeting_owner`, `client_email`, `booking_date`).
- **Notas:** observações do SDR com a tag `bitrix` → comentário na timeline.

**Configurar:** troque `PREENCHA_BITRIX_WEBHOOK_BASE` (3 nós Bitrix) e selecione
a credencial Supabase nos nós de banco. Ative.

**Importante:** leads antigos (sem `bitrix_id`) não têm como mover coluna — o
workflow marca `bitrix_error: 'lead sem bitrix_id'` e segue. Todo lead novo que
entrar pelo `bitrix-to-qs` já nasce vinculado.

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
