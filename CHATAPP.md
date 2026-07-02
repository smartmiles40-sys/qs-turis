# Integração ChatApp — enviar mensagem a um lead

Envia uma mensagem de texto para **um lead específico** via [ChatApp](https://api.chatapp.online),
de forma **nativa pela API REST** (sem iframe/embed do app deles).

## Arquitetura

```
Botão "Enviar mensagem" (front)
   └─ src/lib/chatapp.ts  →  POST /api/chatapp-send   (serverless, guarda o token)
                                   └─ api/_chatapp.js  →  API do ChatApp
                                        1. POST /v1/tokens            (autentica, token cacheado)
                                        2. GET  .../phones/{tel}/check (telefone → chatId)
                                        3. POST .../chats/{id}/messages-text (envia)
```

O token **fica só no servidor** (não no browser) e é **cacheado** para respeitar o
limite de **100 tokens/dia**. Header de auth é o token cru: `Authorization: <accessToken>`.

## Configurar

1. Copie `.env.chatapp.example` → `.env.chatapp.local` e preencha
   (`CHATAPP_EMAIL`, `CHATAPP_PASSWORD`, `CHATAPP_APP_ID`, `CHATAPP_LICENSE_ID`,
   `CHATAPP_MESSENGER`, e opcionalmente `INTERNAL_API_SECRET`).
2. Na **Vercel**, cadastre as mesmas variáveis em *Settings → Environment Variables*.

## Testar localmente (ver o resultado)

```bash
# diagnóstico + ping de conectividade (funciona sem credenciais):
node scripts/chatapp-test.mjs

# com credenciais em .env.chatapp.local, envio real:
node scripts/chatapp-test.mjs --to 5511999998888 --text "Olá! Aqui é da agência…"
```

## Usar no app

```ts
import { sendLeadMessage } from './lib/chatapp';
const r = await sendLeadMessage({ phone: lead.telefone, text: 'Olá! ...' });
if (!r.success) console.error(r.error);
```

## Único ponto a confirmar

A doc renderizada não mostrou o **corpo** do endpoint `messages-text`. Assumi o campo
`text` (convenção do endpoint). Se o envio real retornar erro de validação, edite a
constante `MESSAGE_TEXT_FIELD` em `api/_chatapp.js` (troque `"text"` por `"body"`/`"message"`).
É o **único** lugar que muda.

## Produção / robustez (opcional)

- **Cache do token entre cold starts:** hoje o token fica em memória (some quando a
  instância serverless esfria). Para tráfego alto, persista o token numa tabela do
  Supabase (o app já usa Supabase) e leia de lá antes de pedir um novo.
- **Proteção da rota:** setar `INTERNAL_API_SECRET` exige o header `x-internal-secret`.
- **Respostas do lead (2 vias):** a API tem `PUT .../callbackUrl` (webhook). Aponte
  para um fluxo no n8n para receber as respostas e gravar no lead.
