# Integrações n8n do QS Turis

Workflows prontos pra importar (menu **⋮ → Import from File** no n8n):

| Arquivo | O que faz | Gatilho |
|---|---|---|
| `qs-inbound-leads.workflow.json` | Formulário/LP → QS (cria o card e as tarefas) | Webhook (form) |
| `bitrix-to-qs.workflow.json` | Bitrix → QS via `crm.deal.get`/`crm.contact.get` (Etapa 1.1) | Webhook do Bitrix |
| `bitrix-inbound-to-qs.workflow.json` | **⭐ Bitrix → QS pelos dados do próprio webhook** (querystring; NÃO chama o Bitrix de volta) → `/api/lead-inbound` | Webhook do Bitrix |
| `qs-to-bitrix-webhook.workflow.json` | **⭐ QS → Bitrix por EVENTO**: cada botão (perdido/ganho/reunião/nota/**1º contato**) dispara na hora | Webhook (por botão) |
| `bitrix-atividade-concluida-move-stage.workflow.json` | **⭐ Dentro do Bitrix**: SDR conclui a 1ª atividade → o negócio anda sozinho de **Novo lead → Follow-up 1** | Evento do Bitrix (`ONCRMACTIVITYUPDATE`) |
| `qs-to-bitrix-sync.workflow.json` | ⚠️ **APOSENTADO — NÃO RELIGAR** (reenviaria TODO o histórico; ver seção do legado). Substituído pelo de cima. | A cada 1 min |
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
Bitrix muda na hora certa. São **5 webhooks** (um "por botão"), cada um numa
linha do canvas:

| Evento | Path do webhook | O que faz no Bitrix |
|---|---|---|
| Perdido | `/webhook/qs-perdido` | acha o deal → move pra coluna de **Perdido** (+ motivo) |
| Ganho | `/webhook/qs-ganho` | acha o deal → move pra coluna de **Ganho** |
| Reunião | `/webhook/qs-reuniao` | acha o deal → move pra **Reunião agendada** + comentário com todos os campos (+ nó de UF desativado) |
| Nota | `/webhook/qs-nota` | comentário na timeline do negócio |
| **1º contato** 🆕 | `/webhook/qs-primeiro-contato` | acha o deal → **só se ainda estiver em "Novo lead"** → move pra **Follow-up 1** + comentário |

**Fluxo de cada branch:** Webhook (recebe `bitrix_id` + dados do body do app) →
`crm.deal.get` (acha o deal) → `crm.deal.update` (move a coluna / preenche) →
o **Bitrix faz o resto** pelas automações dele. Nota é só `crm.timeline.comment.add`.

### Configurar (4 coisas)

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
3. **Segurança (obrigatório desde 2026-07-13):** os **5** nós Webhook exigem
   **Header Auth**. No n8n, crie uma credencial "Header Auth" chamada
   `QS Sync Secret (x-qs-sync-secret)` com:
   - **Name:** `x-qs-sync-secret`
   - **Value:** um segredo forte (ex.: saída de `openssl rand -hex 24`)
   e selecione-a nos 5 nós Webhook depois de importar. Sem o header certo o n8n
   responde 403 — ninguém "de fora" move negócio no Bitrix.
4. **App (Vercel):** o navegador NÃO chama mais o n8n direto (a URL saiu do
   bundle). O front chama **`/api/bitrix-sync`** (autenticado pelo login do SDR)
   e a rota encaminha pro n8n com o segredo. Defina as envs **server-side** na
   Vercel e faça redeploy:
   - `N8N_SYNC_BASE` = base dos webhooks **SEM barra final** (ex.: `https://SEU-N8N/webhook`)
   - `N8N_SYNC_SECRET` = o MESMO valor da credencial Header Auth do passo 3
   - `VITE_N8N_SYNC_BASE` ficou **obsoleta** — remova se tiver setado.
   Depois **ative** o workflow (é aí que os paths passam a existir).

### 🆕 5ª faixa: `qs-primeiro-contato` — a coluna anda quando o SDR trabalha NO QS

**O par que faltava (28/07).** O workflow `bitrix-atividade-concluida-move-stage`
move **Novo lead → Follow-up 1** quando a atividade é concluída **dentro do
Bitrix**. Só que o SDR trabalha no QS: ali o evento do Bitrix nunca dispara e o
card ficava parado em Novo lead. Esta faixa fecha o outro lado — **a mesma ação,
registrada nos dois lugares, dá o mesmo resultado**.

**Fluxo:** `/api/bitrix-sync` → webhook `qs-primeiro-contato` → `Config 1o contato`
→ `crm.deal.get` → *"ainda está em Novo lead?"* → `crm.deal.update` (move) →
comentário na timeline (canal, desfecho e SDR).

**Por que "primeiro contato" sai de graça (de novo):** não há contador nem flag —
a regra é **só move quem AINDA está em Novo lead**. Da 2ª atividade em diante o
evento chega, olha e não faz nada. Isso torna o disparo **idempotente** (repetir
não estraga), impede o robô de **puxar pra trás** um negócio que já avançou, e dá
uma rede de segurança de graça: se um disparo se perder (rede caiu, n8n fora), a
próxima atividade concluída conserta sozinha.

**Configurar (só o nó `Config 1o contato`):**
- `BITRIX_BASE` → mesma base REST (o mesmo `PREENCHA_BITRIX_WEBHOOK_BASE` do passo 1).
- `STAGE_DE` → coluna "Novo lead" (chute inicial: `C25:NEW`).
- `STAGE_PARA` → coluna "Follow-up 1" (**`PREENCHA_STAGE_FOLLOWUP_1`** — descubra
  em `BASE/crm.status.list.json?filter[ENTITY_ID]=DEAL_STAGE_25`). **É o mesmo
  valor que você vai preencher no workflow do lado do Bitrix.**
- `SO_ALCANCOU` → `nao` (padrão: qualquer atividade concluída move, igual ao
  workflow gêmeo) ou `sim` (move **só** quando o SDR falou mesmo com a pessoa).

**Onde o QS dispara** (`TasksPanel`), e o que vai em `alcancou`:

| Ação do SDR | Dispara? | `alcancou` |
|---|---|---|
| Desfecho da tarefa: atendeu / desligou | sim | `true` |
| Desfecho: não atendeu / caixa postal / nº errado | sim | `false` |
| Desfecho **Ganho** ou **Sem interesse** | **não** — ganho/perdido já movem a coluna | — |
| Ligação classificada (sem avanço, gatekeeper, sem conexão…) | sim | `meta.reached` |
| Ligação **"Com avanço"** | **não** — vai pra Reunião Agendada, coluna à frente | — |
| "Concluir atividade" (WhatsApp, e-mail, pesquisa…) | sim | `true` |
| "Pediu retorno" (atividade extra) | sim | `true` |

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
  o Bitrix é espelho). **NÃO use o `qs-to-bitrix-sync` como "rede de segurança"**
  — ver o aviso na seção do legado abaixo: religá-lo reenvia TODO o histórico.
  Se um dia precisar de reconciliação, é preciso construir um fluxo novo que
  filtre por data/flag (o de eventos não marca `bitrix_synced`).
- **CORS:** os webhooks vêm com `allowedOrigins: "*"`. Se o navegador reclamar de
  CORS, troque `*` pelo domínio do app (`https://qs-turis.vercel.app`) nos nós de
  webhook (aba **Options → Allowed Origins**).
- **`bitrix_id`:** lead que não veio do Bitrix não tem `bitrix_id` → o app
  **pula** o disparo (não há deal pra mover). Todo lead que entra pelo
  `bitrix-to-qs` já nasce vinculado.
- **Onde os botões disparam:** `LeadDetailPage` (marcar ganho/perdido, agendar
  reunião, nota) e `TasksPanel` (desfecho da tarefa, "Ganho = agendar reunião",
  observação "Salvar no Bitrix", **conclusão de atividade → 1º contato**). Um botão
  **novo** no futuro não sincroniza sozinho — é preciso chamar `notifyBitrix(...)`
  nele (`src/lib/qs/bitrixSync.ts`).
- **"Desfazer" não desfaz no Bitrix:** o toast de ~10 s devolve a atividade pra
  pendente **no QS**, mas o negócio já foi pra Follow-up 1 lá. É de propósito —
  o contato aconteceu de verdade; quem some é só a tarefa.

---

## ⭐ `bitrix-atividade-concluida-move-stage` — a coluna anda sozinha no Bitrix

**O problema (pedido do Bruno, 27/07):** o SDR conclui a atividade do lead e
**depois** precisa abrir o kanban do Bitrix só pra arrastar o card de **Novo lead**
pra **Follow-up 1**. Trabalho manual puro — e quando esquecem, o funil mente.

**A ideia:** o Bitrix avisa o n8n toda vez que uma atividade muda; o n8n confere
se ela foi **concluída**, se é de um **negócio**, e se esse negócio **ainda está
em Novo lead** — só aí move. Ninguém abre o kanban.

**Fluxo:** evento `ONCRMACTIVITYUPDATE` → `crm.activity.get` (o evento manda só o
ID) → filtro (concluída + dona é negócio) → `crm.deal.get` → filtro (está em
`STAGE_DE`?) → `crm.deal.update` (move) → comentário na timeline (nó opcional,
vem desativado).

### Por que "primeira atividade" sai de graça

Não existe contador nem flag: a regra é **"só move quem ainda está em Novo lead"**.
Depois do 1º move o negócio saiu dessa coluna, então concluir a 2ª, 3ª, 10ª
atividade não faz nada. Isso também protege contra o robô **puxar pra trás** um
negócio que já avançou pra Reunião Agendada.

### Configurar (só o nó `Config` + 1 tela no Bitrix)

1. **Nó `Config`** (é o único que você edita):
   - `BITRIX_BASE` → a mesma base REST dos outros workflows
     (`https://SEUPORTAL.bitrix24.com.br/rest/USERID/CODIGO`, **sem barra no fim**).
   - `STAGE_DE` → coluna "Novo lead" (chute inicial: `C25:NEW`).
   - `STAGE_PARA` → coluna "Follow-up 1" (**`PREENCHA_STAGE_FOLLOWUP_1`**).
   - Descubra os dois colando no navegador (logado no Bitrix):
     `BASE/crm.status.list.json?filter[ENTITY_ID]=DEAL_STAGE_25` — vem `STATUS_ID`
     (o que vai no config) + `NAME` (o nome que você vê no kanban).
   - `APP_TOKEN` → o "token do aplicativo" do webhook de saída (passo 2).
   - `ENTIDADE` → `deal` (mude pra `lead` **só** se essas colunas estiverem na
     seção **Leads** do Bitrix, não em Negócios — o workflow troca sozinho para
     `crm.lead.*` e `STATUS_ID`).
   - `SO_TIPOS` → vazio = qualquer atividade. Pra restringir, lista de tipos:
     `1`=reunião, `2`=ligação, `3`=tarefa, `4`=e-mail (ex.: `2,3`).
2. **Registrar o evento no Bitrix:** Aplicativos → Desenvolvedor →
   **Webhook de saída**. Marque **`ONCRMACTIVITYUPDATE`** (e, se quiser pegar
   ligação já lançada como concluída, também `ONCRMACTIVITYADD`), cole em
   "endereço do manipulador" a URL de **produção** do webhook do n8n
   (`https://SEU-N8N/webhook/bitrix-atividade-concluida`) e salve. Copie o
   **token do aplicativo** que aparece e cole no `APP_TOKEN`.
   *Alternativa por REST (mesma coisa, sem a tela):*
   `BASE/event.bind.json?event=ONCRMACTIVITYUPDATE&handler=https://SEU-N8N/webhook/bitrix-atividade-concluida`
3. **Ative o workflow** (antes de ativar, a URL de produção não existe e o Bitrix
   leva 404).

### Segurança

O webhook **não** usa Header Auth como os `qs-*` — o Bitrix não deixa mandar
header custom. Quem autentica é o `APP_TOKEN`: o Bitrix assina todo evento com
ele e o nó "Ler evento do Bitrix" recusa o que não bater. **Preencha o
`APP_TOKEN`** — deixando o placeholder, a validação fica desligada e qualquer um
que descubra a URL move negócio no seu CRM.

### Coisas que você precisa saber

- **Não tem gatilho nativo genérico de "atividade concluída"** nas automações do
  Bitrix (há gatilhos por *tipo* de comunicação: ligação, e-mail, formulário).
  Se você encontrar um "Atividade concluída" na sua conta, dá pra fazer o mesmo
  sem n8n — este workflow é o caminho que funciona em qualquer plano com REST.
- **Isto é Bitrix→Bitrix.** Não mexe no QS: as abas Novo/FUP/Atrasada do QS
  continuam saindo da cadência do Supabase. Se o SDR conclui a tarefa **no QS**
  (e não no Bitrix), este evento nunca dispara — esse outro lado agora existe:
  **`qs-primeiro-contato`**, a 5ª faixa do `qs-to-bitrix-webhook` (feita em
  28/07). Os dois usam a **mesma regra** ("só move quem ainda está em Novo lead")
  e o **mesmo `STAGE_PARA`** — podem ficar ligados juntos sem se atrapalhar:
  quem chegar primeiro move, o outro olha e não faz nada.
- **Sem loop:** mover a coluna não cria atividade; e atividade nova entra como
  não-concluída, que o filtro descarta.
- **Execuções "vazias" são normais:** todo salvamento de atividade dispara o
  evento; o que não passa nos filtros para no nó de Code com 0 itens.

---

## `qs-to-bitrix-sync` — QS → Bitrix por polling (LEGADO / aposentado)

Versão antiga: um Schedule de 1 min varria o Supabase em 3 faixas
(perdido/ganho, reuniões, notas). **Substituído pelo `qs-to-bitrix-webhook`.**

**⚠️ NÃO RELIGUE este workflow — nem "de vez em quando", nem como rede de
segurança.** O polling seleciona pelo flag `bitrix_synced = false`, e o fluxo
novo por evento **não marca esse flag** (ele nem toca nessas colunas). Ou seja:
religar o polling hoje faria ele enxergar TODO o histórico como "não sincronizado"
e **reenviar tudo em massa pro Bitrix** — mover colunas de negócios antigos e
duplicar comentários na timeline. O arquivo fica no repo **só como referência
de código**. Se um dia precisar de reconciliação de verdade, construa um fluxo
novo com filtro por data/flag próprio.

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

### ⚠️ Pendência de validação: o campo do texto (`MESSAGE_TEXT_FIELD`)

O envio usa `POST /v1/licenses/{id}/messengers/{m}/chats/{chatId}/messages-text`
com o corpo `{ "text": "..." }`. O nome do campo (`text`) foi deduzido pelo nome
do endpoint — a doc renderizada do ChatApp não mostrou o corpo, e **nunca foi
confirmado com um envio real** (as credenciais estavam vazias). Como validar,
assim que o token estiver ativo no `qs_settings` (este workflow rodando):

1. Envie **1 mensagem de teste pro seu próprio número** via rota do app:
   `POST https://qs-turis.vercel.app/api/chatapp-send` com header
   `x-internal-secret: <INTERNAL_API_SECRET>` e body
   `{ "phone": "55DDDNUMERO", "text": "teste QS" }`.
2. **Chegou no WhatsApp** → campo certo, nada a fazer.
3. **Veio erro de validação** (HTTP 400/422 reclamando de campo) → troque a
   constante `MESSAGE_TEXT_FIELD` em `api/_chatapp.js` (linha ~37) por `"body"`
   ou `"message"` e repita o teste. É o ÚNICO lugar que muda.

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
- **Headers de segurança (`vercel.json`, 2026-07-16):** o app manda
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` (ninguém embeda o QS; os iframes de TERCEIROS dentro
  do QS — ChatApp, Google Agenda — não são afetados por esse header) e HSTS
  moderado. **CSP ficou de fora DE PROPÓSITO** (o `vercel.json` não aceita
  comentário, então o registro é aqui): antes de ligar uma CSP enforce é preciso
  mapear todas as origens — CDN do Wavoip, `*.supabase.co` (REST/Auth/Realtime
  WSS), avatares/imagens externas, iframes do ChatApp e Google — senão o webfone
  e o chat quebram em produção. Começar por `Content-Security-Policy-Report-Only`.
