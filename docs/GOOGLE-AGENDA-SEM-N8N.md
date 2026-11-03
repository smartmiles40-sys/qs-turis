# Google Agenda + Meet sem n8n (03/11/2026)

Desde 03/11 o QS fala **direto** com a Google Calendar API: cria o evento com a
sala do Meet, reagenda, cancela e lê o livre/ocupado dos closers. O webhook
`qs-agenda-meet` do n8n não é mais chamado.

- Código: `api/_google.js` (token) e `api/_googleAgenda.js` (o workflow do n8n,
  nó por nó). Quem usa: `api/agenda-meet.js` (tela), `criarSalaDoMeet` e
  `ocupacaoGoogle` em `api/_agenda.js` (Glória, autoagendamento, reparo).
- O contrato de resposta é o mesmo do n8n. O front não mudou.
- Os eventos continuam nascendo na agenda **da conta que organiza as reuniões**
  (`primary` dessa conta) e com o **mesmo id** que o n8n gerava. Por isso, recriar
  uma reunião antiga cai no 409 e devolve a mesma sala.

## Envs na Vercel

| Env | O que é |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID do OAuth client (Google Cloud) |
| `GOOGLE_CLIENT_SECRET` | Client secret do mesmo client |
| `GOOGLE_REFRESH_TOKEN` | Refresh token da conta que organiza as reuniões, gerado **com esse client** |
| `GOOGLE_CALENDAR_ID` | *Opcional.* Agenda dedicada (`c_xxx@group.calendar.google.com`). Sem ela: `primary` |

**Saem** (só a agenda usava): `N8N_AGENDA_URL`. A `N8N_AGENDA_SECRET` pode sair
quando a frente do Bitrix também sair do n8n (o `api/bitrix-sync.js` ainda a usa
como reserva do `N8N_SYNC_SECRET`).

Sem as três envs, a reunião é marcada normalmente, mas sem link do Meet (o motivo
fica em `calendar_error`), e a grade ignora a agenda pessoal do closer.

## Caminho A: copiar a credencial do n8n (mais rápido)

Dá, sim. O refresh token que o n8n usa vale fora dele, **desde que você use o
client ID e o client secret dessa mesma credencial** (o refresh token fica preso
ao client que o gerou).

A tela do n8n não mostra o refresh token. Ele fica criptografado no banco do n8n.
Na VPS (Hostinger), no container do n8n:

```bash
n8n export:credentials --all --decrypted --output=/tmp/cred.json
```

No `cred.json`, ache a credencial do tipo `googleCalendarOAuth2Api` e copie:
`data.clientId` → `GOOGLE_CLIENT_ID`, `data.clientSecret` → `GOOGLE_CLIENT_SECRET`
e `data.oauthTokenData.refresh_token` → `GOOGLE_REFRESH_TOKEN`.
**Apague o `/tmp/cred.json` logo depois**: ele tem todas as senhas do n8n em texto puro.

Atenção: se o app OAuth estiver em modo **"Testing"** no Google Cloud, o refresh
token vence a cada 7 dias. Se o n8n nunca pediu reconexão, o app já está em
produção (ou é "Internal" do Workspace), e não há esse problema.

## Caminho B: gerar do zero (10 min)

1. **Google Cloud Console** (console.cloud.google.com), no projeto da agência:
   - *APIs e serviços › Biblioteca*: ative a **Google Calendar API**.
   - *Tela de consentimento OAuth*: tipo **Interno** se a conta é do Google
     Workspace da agência. Se for **Externo**, publique o app ("Em produção"),
     senão o token vence em 7 dias. Escopo: `https://www.googleapis.com/auth/calendar`.
   - *Credenciais › Criar credenciais › ID do cliente OAuth*, tipo **Aplicativo da
     Web**. Em "URIs de redirecionamento autorizados", adicione
     `https://developers.google.com/oauthplayground`. Guarde o Client ID e o Secret.
2. **OAuth Playground** (developers.google.com/oauthplayground):
   - Engrenagem (canto superior direito): marque **Use your own OAuth credentials**
     e cole o Client ID e o Secret. Deixe "Access type: Offline".
   - Step 1: no campo de baixo, digite `https://www.googleapis.com/auth/calendar`,
     clique em **Authorize APIs** e entre com **a conta que organiza as reuniões**
     (a mesma que o n8n usava; é nela que os eventos aparecem).
   - Step 2: **Exchange authorization code for tokens**. Copie o **Refresh token**.
3. **Vercel** › projeto do QS › Settings › Environment Variables (Production):
   cole `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REFRESH_TOKEN`, sem
   espaço nem quebra de linha. Faça um **Redeploy**, porque env nova só vale em deploy novo.

## Conferir

- QS › Glória › Saúde das integrações › **Testar**: a porta "Google — agenda / Meet"
  tem que ficar verde ("Token renovado e a agenda abriu"). Esse teste não cria
  evento nenhum.
- Marque uma reunião de teste: o link do Meet aparece e o evento entra na agenda.
- Livre/ocupado: cada closer precisa **compartilhar o livre/ocupado** da agenda
  pessoal com a conta organizadora (já era assim com o n8n). Quem não compartilhou
  aparece no log da Vercel como `o Google não deixou ler estas agendas: …`, e a
  grade segue sem a agenda dele, nunca vazia.

## Erros comuns

| Aparece | Causa |
|---|---|
| `agenda do Google não configurada (GOOGLE_… ausente)` | Env faltando, ou não teve redeploy |
| `o Google recusou o refresh token…` (`invalid_grant`) | Token revogado ou vencido (app em "Testing"), ou gerado com outro client |
| `o Google não reconheceu o client OAuth` | Client ID/Secret errado ou com espaço sobrando |
| HTTP 403 `Insufficient Permission` | Token gerado sem o escopo `…/auth/calendar`, ou Calendar API desativada |
| evento sem Meet (`sem_meet`) | A conta não pode criar Meet (política do Workspace) |

## Depois: botão "Conectar Google" (planejado)

O desenho já está pronto pra isso: a função `carregarCredencial()` em `api/_google.js`
é o único lugar que sabe de onde vem o refresh token. O botão vai gravar o token
numa tabela (migration nova) e essa função passa a ler de lá primeiro, com a env
de reserva. Mais nada muda.
