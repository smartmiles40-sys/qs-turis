> **STATUS 05/08/2026 — A AGENDA ESTÁ LIGADA E VALIDADA DE PONTA A PONTA.**
> Passos 1, 2, 5, 6 e 7 concluídos e provados: evento criado no Google, sala do
> Meet gerada e convite entregue no e-mail do convidado.
> **Passo 3 dispensado por decisão do Bruno**: fica em `primary` mesmo — a conta
> `especialista@agenciasetuforeuvou.com` é fixa da empresa, e é exatamente a
> agenda que o QS já embute (`qs_settings.google_calendar_embed`), então as
> reuniões aparecem na aba Agenda sem configuração nenhuma.
> **Único passo em aberto: o 4** (acesso rápido do Meet).

# Ligar a agenda com Google Meet — passo a passo

Checklist pra fazer de uma sentada. São ~25 minutos. Cada passo tem **como
conferir** antes de ir pro próximo — se um falhar, você descobre ali e não três
passos depois.

Ordem importa: o passo 5 depende do 4, que depende do 1.

---

## Antes de começar: o que JÁ está pronto

Não refaça isto.

- [x] Migrations `0031` a `0035` aplicadas no Supabase
- [x] 2 closers cadastrados (Bruno Matheus, Talita Carvalho) com e-mail, agendáveis, 10 janelas de atendimento
- [x] App OAuth `n8n Automações` criado no Google Cloud
- [x] Credencial `Google Calendar OAuth2 API` conectada no n8n
- [x] Código do QS: rota `/api/agenda-meet`, as 3 ações (criar/reagendar/cancelar), miniatura da agenda no Ganho, cobrança de desfecho

**O que falta é ligar os fios.** Hoje a rota responde `501 — Agenda Google não
configurada`, e por isso existem 0 eventos no Google.

---

## Passo 1 — Google Cloud: a API está ligada?

`console.cloud.google.com` → selecione o projeto do `n8n Automações`

1. **APIs e serviços → Biblioteca**
2. Busque **Google Calendar API**
3. Tem que estar **Ativada**. Se o botão disser "Ativar", clique.

> **Conferir:** em *APIs e serviços → APIs ativadas*, o Google Calendar API
> aparece na lista.

**Se pular este passo:** o n8n autentica normalmente e toma `403` na primeira
tentativa de criar evento. O sintoma no QS é "o convite do Google não foi criado
(403)".

---

## Passo 2 — Google Cloud: o escopo é de escrita?

**APIs e serviços → Tela de permissão OAuth → Escopos**

Precisa existir `https://www.googleapis.com/auth/calendar` (ou
`.../auth/calendar.events`).

> **Se só tiver `calendar.readonly`:** adicione o de escrita, salve, e **reconecte
> a credencial do Google no n8n**. Token antigo carrega o escopo antigo — sem
> reconectar, continua falhando com a mesma cara.

---

## Passo 3 — Criar a agenda da operação

Hoje o workflow está apontado pra `primary`, que é a **agenda pessoal** da conta
conectada. Todo evento da empresa cairia lá.

1. `calendar.google.com` → **Outras agendas → + → Criar agenda**
2. Nome: `Meets · Operação`
3. Abra **Configurações da agenda** → role até **Integrar agenda** → copie o
   **ID da agenda** (`c_xxxxx@group.calendar.google.com`)
4. No n8n, workflow `QS · Agenda · Google Meet`, nó **Validar entrada**, primeira
   linha do código:

```js
const CALENDAR_PADRAO = 'primary';   // ← troque pelo ID que você copiou
```

5. **Salve o workflow.**

---

## Passo 4 — Google Admin: o cliente não pode ficar na sala de espera

**Este é o passo que ninguém lembra e que estraga a primeira reunião real.**

A conta que cria o evento **nunca vai estar na reunião** — quem entra é o closer,
como convidado. Com a configuração padrão, cliente externo fica preso na sala de
espera esperando um host que não vem.

`admin.google.com` → **Apps → Google Workspace → Google Meet → Configurações de
vídeo do Meet** → selecione a UO da conta organizadora → **Acesso rápido:
ATIVADO**.

> **Conferir (vale os 2 minutos):** crie um evento de teste no Google Agenda com
> Meet, convide um Gmail pessoal seu, e entre por ele numa aba anônima. Se cair
> direto na sala, está certo. Se aparecer "aguardando ser admitido", o acesso
> rápido não pegou.

---

## Passo 5 — n8n: ativar o workflow e pegar a URL

1. Abra o workflow `QS · Agenda · Google Meet`
2. Nó **Webhook QS (qs-agenda-meet)** → **Authentication: Header Auth**
   - Crie/edite a credencial com **Name:** `x-qs-agenda-secret`
   - **Value:** invente um segredo longo e aleatório — **anote, você vai usar no
     passo 6**
3. Confirme que os nós do Google (**Criar evento**, **Atualizar evento**,
   **Cancelar evento**) estão com a credencial `Google Calendar account`
4. **Ative o workflow** (chave no canto superior direito)
5. No nó de webhook, copie a **Production URL**

> A URL tem que conter **`/webhook/`**. Se contiver `/webhook-test/`, é a de
> teste: ela vive uma execução só e depois some. Sintoma no QS: `404`.

---

## Passo 6 — Vercel: as duas variáveis

Vercel → projeto **qs-turis** → **Settings → Environment Variables**

| Nome | Valor |
|---|---|
| `N8N_AGENDA_URL` | a Production URL do passo 5 (`https://SEU-N8N/webhook/qs-agenda-meet`) |
| `N8N_AGENDA_SECRET` | o segredo do passo 5.2 — **idêntico**, sem espaço sobrando |

- Marque **Production** e **Preview** nas duas
- **Save**
- **Deployments → ⋯ no último → Redeploy**

> **Sem o redeploy nada muda.** A função serverless só enxerga a variável no
> build seguinte. É o erro mais comum desta lista.

**Conferir** — e **não** abrindo a URL no navegador: um GET devolve `405` sempre,
ligado ou desligado (o método é checado antes da variável). O teste que
distingue de verdade é um POST:

```powershell
Invoke-WebRequest -Uri https://qs.setuforeuvouviagens.com.br/api/agenda-meet `
  -Method POST -Body '{"acao":"criar","meeting_id":"x"}' -ContentType 'application/json'
```

- `501` → ainda desligado (variável não salva, ou faltou o redeploy)
- `400` → **ligou** ← é isto que você quer ver

---

## Passo 7 — Teste de ponta a ponta

1. No QS, abra o Painel e conclua uma atividade qualquer com **Ganho / Agendou**
2. Escolha um responsável — **a agenda dele aparece ali embaixo**
3. Clique num horário livre (ele preenche a data e a hora sozinho)
4. Confirme

**O que tem que acontecer:**
- toast verde: *"Reunião criada com sala do Google Meet — convite enviado ao closer e ao cliente"*
- na agenda `Meets · Operação`, o evento existe com link do Meet
- o closer recebe o convite por e-mail
- em **Reuniões**, a reunião aparece com o link

Depois apague o evento de teste no Google e a reunião no QS.

---

## Passo 8 (opcional, independente) — papel Marketing

Cole `supabase/migrations/0036_papel_marketing.sql` no SQL Editor. Depois crie o
usuário em **Configurações → Usuários** com o papel **Marketing (só visualiza)**.

**Teste de 30 segundos:** logado como ele, tente editar qualquer lead. Tem que
aparecer *"Perfil Marketing é somente leitura"*. Se conseguir editar, me avise
na hora — significa que tem policy escapando.

---

## Se der errado: sintoma → causa

| O que aparece | Onde olhar |
|---|---|
| `nao_configurado` / 501 | as envs não foram salvas, ou faltou o **redeploy** (passo 6) |
| `n8n respondeu HTTP 404` | URL de teste em vez da de produção, ou workflow **inativo** (passo 5) |
| `n8n respondeu HTTP 403` | `N8N_AGENDA_SECRET` diferente do Header Auth do n8n |
| `403` vindo do Google | Calendar API desativada (passo 1) ou escopo somente leitura (passo 2) |
| Evento criado **sem link do Meet** | a conta Google não tem permissão de criar conferência — confira no Admin |
| Cliente preso em "aguardando ser admitido" | acesso rápido desligado (passo 4) |
| Convite não chega no cliente | a reunião ficou sem e-mail do cliente — é o campo do modal de Ganho |

O último erro de cada reunião fica gravado em `qs_meetings.calendar_error`. Pra
ver os problemas recentes:

```sql
select scheduled_at, lead_name, calendar_error
  from qs_meetings
 where calendar_error is not null
 order by updated_at desc;
```

---

## Depois disto, o que continua pendente

Não é pra amanhã, é pra saber que existe:

- **Espelhar o desfecho no Bitrix** (seção 5.3 do briefing). Bloqueado do seu
  lado: os webhooks `qs-ganho` e `qs-reuniao` estão **desativados** no n8n, e os
  campos seguem como `PREENCHA_UF_*`. Me mande a lista dos `UF_CRM_*` do funil.
- **Jobs de auditoria** (seção 7): o cron que varre reunião vencida sem desfecho
  e escala pro gestor em 48h.
- **Fechar a lista de motivos de recusa** com o comercial (hoje são 6 provisórios
  em `qs_settings.sal_motivos`, editáveis sem deploy).
- **Teto de reagendamentos** — o briefing sugere 3, depois vai pra Perdidos.
