# Bitrix → QS sem o n8n (corte de 03/11/2026)

Até hoje o Bitrix chamava o n8n (`https://n8n-mowr.srv1758620.hstgr.cloud/webhook/...`)
e o n8n chamava o QS. Agora o Bitrix chama o QS **direto**, numa rota só:

```
https://qs-turis.vercel.app/api/bitrix-entrada?evento=<evento>&secret=<BITRIX_ENTRADA_SECRET>
```

A rota entende o Bitrix do jeito que ele fala: parâmetros na URL (`&Telefone=...`),
corpo form-urlencoded (`document_id[]`, `data[FIELDS][ID]`, `auth[application_token]`)
ou JSON — e **não diferencia maiúscula**: `Telefone`, `telefone` e `TELEFONE` são o
mesmo campo; `E-mail` e `email` também. Depois de traduzir, chama a mesma lógica de
sempre (`/api/lead-inbound` e `/api/primeiro-contato`): dedupe, porteiro do 1935,
listas, vídeo de primeiro contato e nota de origem continuam iguais.

---

## 0. Antes de tudo: as variáveis na Vercel

Vercel → projeto **qs-turis** → Settings → Environment Variables → Production.

| Variável | Nova? | Para quê |
|---|---|---|
| `BITRIX_ENTRADA_SECRET` | **sim** | O segredo que vai no `&secret=` das URLs dos robôs. Gere um valor longo e aleatório (ex.: 40 letras/números, **sem** `&`, `#`, `?`, `%` ou espaço). |
| `BITRIX_APP_TOKEN` | **sim** (opcional) | O *application token* do **webhook de saída** do Bitrix (eventos). Só precisa se for usar o evento `atividade` sem `&secret=` na URL. Dá pra reaproveitar o token que já estava no nó Config do n8n. |
| `LEAD_INBOUND_SECRET` | já existe | Continua obrigatório — a rota nova repassa pro `/api/lead-inbound` com ele. |
| `BITRIX_WEBHOOK_BASE` | já existe | Usado pra **ler** o negócio/atividade no Bitrix (eventos `atividade` e `lead` quando só vem o ID). |
| `PRIMEIRO_CONTATO_SECRET` | já existe (opcional) | Se não existir, vale o `LEAD_INBOUND_SECRET`, como antes. |

Sem `BITRIX_ENTRADA_SECRET` **e** sem `BITRIX_APP_TOKEN`, a rota recusa tudo (503) —
nada entra aberto. Depois de cadastrar, faça **Redeploy** (variável nova só vale em
deploy novo).

> Por que um segredo novo e não o `LEAD_INBOUND_SECRET`? Porque este fica escrito na
> URL dos robôs, à vista de qualquer um que edite automação no Bitrix. Se vazar, você
> troca só ele, e o header do site/stfv-forms continua de pé.

Nos exemplos abaixo, troque `SEGREDO` pelo valor do `BITRIX_ENTRADA_SECRET`.

---

## 1. Lead novo do Bitrix → card no QS

**Era:** robô "Webhook" no funil Pré-Vendas (25) chamando
`https://n8n-mowr.srv1758620.hstgr.cloud/webhook/qs-lead-inbound?Nome=...&Telefone=...`
(workflows `qs-bitrix-completo`, `bitrix-inbound-to-qs`, `qs-inbound-leads`).

**Onde trocar:** Bitrix → CRM → Negócios → funil **Pré-Vendas - Comercial** →
**Automação** (Robôs) → coluna **Novo Lead - Aguardando resposta** → o robô
**Webhook** (ou "Enviar webhook") cuja URL começa com `n8n-mowr...`.
Confira também os outros funis/colunas: qualquer robô com `qs-lead-inbound` na URL.

**URL nova** (cole inteira, numa linha só; os `{{...}}` você escolhe pelo botão
"..." do Bitrix, como já estava):

```
https://qs-turis.vercel.app/api/bitrix-entrada?evento=lead&secret=SEGREDO&ID={{ID}}&Nome={{Contato: Nome}}&Sobrenome={{Contato: Sobrenome}}&Telefone={{Contato: Telefone}}&E-mail={{Contato: E-mail}}&Fonte={{Fonte}}&LeadScoring={{LeadScoring}}
```

- Os nomes dos parâmetros podem ficar **exatamente como estão hoje** no robô
  (`Nome`, `Telefone`, `E-mail`, `Fonte`, `LeadScoring`/`Temperatura`/`Pontuacao`/`Score`,
  `ID`). Na prática: **troque só o começo da URL** —
  `https://n8n-mowr.srv1758620.hstgr.cloud/webhook/qs-lead-inbound?` vira
  `https://qs-turis.vercel.app/api/bitrix-entrada?evento=lead&secret=SEGREDO&` — e
  mantenha o resto.
- `ID` é o que impede o mesmo negócio virar dois cards. Se esquecer, a rota tenta o
  `document_id` que o robô manda sozinho (`DEAL_123`).
- A nota "📥 Origem Bitrix" continua sendo gravada uma vez só (quem grava agora é o
  próprio QS, não o n8n).

Uma URL por cadência continua valendo: acrescente `&lista=<apelido>` (os apelidos de
`qs_settings.webhook_listas`). `&duplicar=1` e `&mover=1` funcionam igual ao
`/api/lead-inbound`.

### 1b. Webhook de saída ONCRMDEALADD (workflow `bitrix-to-qs`, path `qs-bitrix-inbound`)

Só se ele existir: Bitrix → **Aplicativos → Webhooks** (ou Desenvolvedor → Outros →
Webhook de saída) → o que tem o evento **"Criação de negócio" (ONCRMDEALADD)** e
URL `.../webhook/qs-bitrix-inbound`. Troque a URL do manipulador por:

```
https://qs-turis.vercel.app/api/bitrix-entrada?evento=lead&secret=SEGREDO&funil=25
```

O evento só manda o ID; o QS lê o negócio e o contato (`crm.deal.get` +
`crm.contact.get`), como o n8n fazia. O `&funil=25` é novo: ignora negócio criado em
outro funil (Ops, Rel...). Se o robô do item 1 já está ligado, **não precisa** dos
dois — o dedupe por ID segura, mas é chamada à toa.

---

## 2. Lista de resgate

**Era:** `https://n8n-mowr.srv1758620.hstgr.cloud/webhook/qs-resgate` (workflow
`qs-resgate-webhook`), que repassava para `/api/lead-inbound?lista=resgate&duplicar=1`.

**URL nova:**

```
https://qs-turis.vercel.app/api/bitrix-entrada?evento=resgate&secret=SEGREDO&Nome={{Contato: Nome}}&Telefone={{Contato: Telefone}}&E-mail={{Contato: E-mail}}&Fonte={{Fonte}}
```

`evento=resgate` **fixa** `lista=resgate` e `duplicar=1` (card próprio, sem negócio
novo no Bitrix, o card antigo não é tocado). Fonte vazia vira "Resgate" e o telefone
é padronizado com 55, como no nó "Padronizar o lead". Não mande `ID` aqui se não
quiser: no modo `duplicar` o vínculo com o negócio fica no card original.

**A carga de lista** (`qs-resgate-carga-lista`, o "Test workflow" manual) não tem
substituto no Bitrix. Sem o n8n, mande a lista direto pro QS (o mesmo endereço que o
n8n usava), com o header `x-lead-secret: <LEAD_INBOUND_SECRET>`:

```
POST https://qs-turis.vercel.app/api/lead-inbound?lista=resgate&duplicar=1
{ "full_name": "Maria Silva", "phone": "5562999990001", "email": "maria@x.com", "segment": "Lista resgate agosto" }
```

---

## 3. Primeiro contato (vídeo de apresentação) — plano B

**Era:** robô chamando `https://n8n-mowr.srv1758620.hstgr.cloud/webhook/lead-apresentacao?Telefone=...`
(workflow `primeiro-contato`). Desde 31/08 o QS dispara sozinho quando o lead nasce;
este robô só importa se em Configurações → Mensagem Automática → "Quando disparar"
estiver em **"Só quando o Bitrix mandar"**. Os dois ligados não mandam duas vezes
(dedupe por lead e por telefone).

**URL nova:**

```
https://qs-turis.vercel.app/api/bitrix-entrada?evento=primeiro-contato&secret=SEGREDO&Telefone={{Contato: Telefone}}
```

---

## 4. Atividade concluída no Bitrix → card anda para Follow-up 1

**Era:** webhook de **saída** do Bitrix com os eventos **ONCRMACTIVITYADD** e
**ONCRMACTIVITYUPDATE** apontando para
`https://n8n-mowr.srv1758620.hstgr.cloud/webhook/bitrix-atividade-concluida`
(workflow `bitrix-atividade-concluida-move-stage` / faixa 3 do `qs-bitrix-completo`).
Esse não chamava o QS: o n8n lia a atividade e movia o negócio no próprio Bitrix.
Agora quem faz isso é o QS.

**Onde trocar:** Bitrix → Aplicativos → Webhooks → o webhook de saída com esses
eventos → **URL do manipulador**:

```
https://qs-turis.vercel.app/api/bitrix-entrada?evento=atividade&secret=SEGREDO
```

(Se preferir não pôr segredo na URL: deixe só `?evento=atividade` e cadastre na
Vercel `BITRIX_APP_TOKEN` = o *token de aplicação* que aparece nesse webhook de saída.)

Regras, iguais às do n8n: só atividade de **negócio**, **concluída**, que **não** seja
de robô (`IMOPENLINES_SESSION`, `CRM_WEBFORM`, `CRM_EMAIL`, `CRM_NOTIFICATION`), e só
se o negócio **ainda** está em `C25:PREPAYMENT_INVOIC` (Novo Lead). Aí move para
`C25:UC_271QUB` (Follow-up 1) e comenta `[robô] Movido de Novo lead para Follow-up 1…`
na timeline. A resposta da rota diz o motivo quando não move
(`nao_concluida`, `atividade_de_robo`, `fora_de_novo_lead`...).

---

## 5. Como conferir que trocou certo (1 minuto)

1. No navegador (GET também é aceito), com um negócio de teste:
   `https://qs-turis.vercel.app/api/bitrix-entrada?evento=lead&secret=SEGREDO`
   → deve responder **400** "Nenhum dado do lead veio na chamada" com
   `campos_recebidos: []`. Isso prova que o segredo e o deploy estão certos **sem
   criar lead**. Com segredo errado: 401. Sem a env: 503.
2. No Bitrix, crie um negócio de teste no Pré-Vendas e veja o card nascer no QS.
3. Vercel → Logs → filtre por `bitrix-entrada`: cada chamada loga o evento e **as
   chaves** que chegaram (sem dados pessoais). Se aparecer `telefone` faltando, o
   robô está sem o parâmetro.
4. Só depois de ver chegar, **desative** os workflows correspondentes no n8n.

---

## 6. O que NÃO foi portado (e por quê)

| Workflow / nó | Situação |
|---|---|
| `gloria-*` (Glória, IA de atendimento) | Desligada. Não portado. |
| Faixa 4 do `qs-bitrix-completo` — renovar token do ChatApp a cada 3 h | ChatApp foi removido do QS em 10/08 (não existe mais `/api/chatapp-send`). Pode desligar. |
| `qs-bitrix-completo` — webhooks `qs-perdido`, `qs-nota`, `qs-ganho`, `qs-primeiro-contato`, `qs-reuniao` | São **saída** QS → Bitrix (`bitrix-sync.js`), outra frente. |
| `qs-agenda-meet` (Google Meet) | Agenda/Meet, outra frente. |
| `qs-sync-catalogo-bitrix`, `qs-to-bitrix-webhook`, `qs-wa-to-bitrix` | Saída QS → Bitrix, outra frente. |
| Nó "Nota: origem Bitrix" | Não precisa: o `/api/lead-inbound` já grava a nota, uma vez só, quando o card nasce. |
