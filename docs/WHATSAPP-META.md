# WhatsApp do QS — só Cloud API da Meta (23/09/2026)

Desde 23/09/2026 o QS fala com o WhatsApp por **um caminho só**: a Cloud API da
Meta, pelo **número oficial**. Chatwoot e Evolution saíram do sistema. A Evolution
era a suspeita de derrubar os números, e o Chatwoot já não entregava nada ao QS
desde 02/09. O Wavoip tinha saído antes.

Os chips dos SDRs (distribuidor das landing pages) **não passam pelo QS**: são
WhatsApp comum, no celular ou no WhatsApp Web de cada SDR. Ver
`Configurações → Números do WhatsApp`.

## Como a mensagem anda

| O quê | Por onde |
|---|---|
| Cliente escreve | Meta → `POST /api/wa-calls` (webhook) → `_metaEntrada.js` → `qs_wa_messages` |
| SDR/closer responde texto | `/api/wa-send` → Meta (`enviarTexto`) → bolha gravada com o `wamid` |
| Arquivo, áudio, figurinha | `/api/wa-send-media` → sobe pra Meta (`/media`) → envia → cópia no bucket `wa-midia` |
| Modelo aprovado | `/api/wa-send` com `modelo` → Meta (`enviarTemplate`) |
| Reação | `/api/wa-react` → Meta |
| "Apagar" | só esconde no QS — **a Meta não tem apagar para todos** |
| Recibos (✓ ✓✓ ✗) | chegam no mesmo webhook e acham a bolha pelo `wamid` |
| Glória (IA) responde | n8n → `/api/gloria-responder` → Meta |
| Primeiro contato (vídeo) | `_primeiroContato.js` → Meta. Lead de LP não recebe (ver `pularPorSerLp`) |

## A regra da Meta que o time sente

**Texto livre só sai se o cliente escreveu nas últimas 24 horas** pelo número
oficial. Fora disso, só **modelo aprovado**. O QS confere antes de enviar e
responde "use um modelo"; se o nosso banco errar, a Meta devolve o erro 131047
e a tela mostra o mesmo aviso.

## Variáveis na Vercel (projeto qs-turis)

| Variável | Para quê | Situação em 23/09 |
|---|---|---|
| `META_CALLS_TOKEN` | token permanente do usuário de sistema | ✅ existe |
| `META_PHONE_NUMBER_ID` | o número oficial | ✅ existe |
| `META_WABA_ID` | conta do WhatsApp Business (modelos) | opcional — o QS descobre pelo token |
| `META_CALLS_APP_SECRET` | confere a assinatura de todo webhook | ✅ existe |
| `META_CALLS_VERIFY_TOKEN` | cadastro do webhook | ✅ existe |
| `META_CALLS_APP_ID` | diagnóstico | ✅ existe |

Podem ser **apagadas** da Vercel depois do deploy (nada mais lê):
`CHATWOOT_DEFAULT_INBOX_ID`, `CHATWOOT_WA_INBOX_IDS`, `EVOLUTION_URL`,
`EVOLUTION_APIKEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_INSTANCES`,
`EVOLUTION_WEBHOOK_SECRET`, `WA_MONITOR_SECRET`, `WA_ALERTA_NUMEROS`,
`CHATAPP_MESSENGER`, `VITE_CHATAPP_URL`. Deixe o `CHATWOOT_AGENT_TOKEN` até as
respostas prontas terem sido copiadas (primeira abertura do chat — ver abaixo);
depois pode apagar também.

## No painel da Meta (developers.facebook.com → o app → WhatsApp → Configuração)

1. **Webhook**: URL `https://qs-turis.vercel.app/api/wa-calls`, token de
   verificação = `META_CALLS_VERIFY_TOKEN`.
2. **Campos assinados**: `messages` (obrigatório) e `calls` (ligações).
   `smb_message_echoes` e `history` só existem com Coexistence (número também no
   app WhatsApp Business).
3. O **token** tem que ser de **usuário de sistema** com as permissões
   `whatsapp_business_messaging` e `whatsapp_business_management`. Token de
   usuário comum expira em horas e o envio para sem aviso.

## Respostas prontas (/atalho)

Moravam no Chatwoot. Agora ficam no QS (`qs_settings.wa_respostas`), editáveis
em Configurações por admin/gestor. Na **primeira abertura do chat** depois do
deploy, o QS copia sozinho as que existiam no Chatwoot (usa o
`CHATWOOT_AGENT_TOKEN` uma única vez). Essa ponte está em `api/wa-config.js`
(`importarRespostasDoChatwoot`) e pode ser apagada depois.

## Glória (IA)

Ela responde pela Meta, mas **só ouve** mensagem nova com a chave ligada:

```sql
insert into qs_settings (key, value) values ('gloria_ouve_meta', 'true')
on conflict (key) do update set value = excluded.value;
```

Em 23/09 havia 11 conversas com a sessão da IA "ativa", paradas desde 29/08.
Ligar a chave faz ela voltar a responder essas pessoas na hora. Por isso a chave
nasceu desligada.

## Saúde

A faixa de aviso do QS (`/api/wa-vigia` → `_waSaude.js`) acende quando a Meta
para de entregar mensagem, e diz se é "não chega", "assinatura recusada" ou
"chega e é ignorada". O alerta por WhatsApp que existia (via Evolution) saiu.
