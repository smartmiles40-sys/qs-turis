# Monitor dos números de WhatsApp

Avisa no WhatsApp do Bruno quando um número da agência cai, volta ou some do
servidor da Evolution.

**Por que existe.** Em 06/08/2026 o número dos Closers (+55 11 95125-1935 — o
mesmo que está nos CTAs das landing pages) ficou deslogado e ninguém percebeu.
Lead mandando mensagem pra um número morto, sem nada no sistema gritando.

## Como funciona

Duas camadas, de propósito — uma cobre o buraco da outra:

| Camada | Gatilho | Pega | Não pega |
|---|---|---|---|
| Webhook | evento `CONNECTION_UPDATE` da Evolution | queda na hora que acontece | Evolution/VPS fora (não há quem emita o evento) |
| Carona no tráfego | cada mensagem que entra pelo `wa-webhook` | queda enquanto o WhatsApp está sendo usado | tudo parado (sem mensagem, sem pulso) |
| Batimento do app | o QS aberto na tela das SDRs chama `/api/wa-vigia` a cada 5 min | justamente o caso acima: nada chegando | madrugada, com ninguém logado |
| Varredura | agendador externo bate em `/api/wa-monitor` | tudo, inclusive servidor fora | nada — mas só descobre no próximo ciclo |

⚠️ **A lição de 17/08.** Até essa data só existiam a 1ª e a última camada. O
agendador externo parou de disparar às 15:13 e o vigia ficou **dois dias mudo**
sem ninguém perceber — vigia morto é pior que vigia nenhum, porque o silêncio
passa por "está tudo bem". As duas camadas do meio existem para que o vigia
dependa de o QS estar sendo usado, e não de um serviço de fora que morre calado.

E há um caso em que o alerta por WhatsApp nunca vai chegar: quando o problema é
o próprio servidor de WhatsApp. Por isso o aviso também sai por um canal que não
depende dele — uma **faixa vermelha no topo do QS** (`AvisoDoVigia`), que o time
vê mesmo com todos os números fora.

As duas chamam a mesma função (`verificar()` em `api/_waAlerta.js`), então a
regra de "quando avisar" mora num lugar só.

**Anti-spam:** o aviso sai na *transição* (estava no ar → caiu), não a cada
verificação. Enquanto segue caído, repete no máximo de 6 em 6 horas. Sem isso o
monitor viraria o incômodo e acabaria silenciado — que é como um alerta morre.

O estado da última verificação fica em `qs_settings.wa_monitor_estado`. Nenhuma
migration nova: a tabela já existe desde a 0005.

## Variáveis na Vercel (projeto qs-turis)

| Variável | Valor |
|---|---|
| `EVOLUTION_URL` | `https://evo.setuforeuvouviagens.com.br` |
| `EVOLUTION_APIKEY` | a `AUTHENTICATION_API_KEY` da Evolution (48 caracteres, está no `.env` de `WorkFlows/whatsapp-times`) |
| `WA_ALERTA_NUMEROS` | pra quem avisar, só dígitos com DDI, vírgula entre eles: `5511999999999` |
| `WA_MONITOR_SECRET` | invente uma senha longa — é o que protege a URL |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já estão configuradas.

> ⚠️ `EVOLUTION_APIKEY` é a chave **global da Evolution** (a mesma de entrar no
> Evolution Manager) — **não** é o `CHATWOOT_AGENT_TOKEN`. São coisas
> diferentes que vivem perto uma da outra.

## Ligar a varredura

O agendador precisa ser **externo ao VPS**: se o problema for o próprio
servidor, um monitor rodando lá dentro morre junto.

**Recomendado — UptimeRobot (grátis, 5 em 5 minutos):** novo monitor tipo HTTP(s),
URL `https://qs.setuforeuvouviagens.com.br/api/wa-monitor?secret=<WA_MONITOR_SECRET>`,
intervalo 5 min. Serve `cron-job.org` igual.

Isso dá um **canal de reserva de graça**: a rota responde `503` quando não
consegue trabalhar (Evolution fora) ou quando não consegue mandar o WhatsApp
(nenhum número no ar). O UptimeRobot vê o erro e manda e-mail sozinho — ou seja,
mesmo com todos os números caídos o aviso chega.

Se a conta da Vercel for **Pro**, dá pra usar o cron nativo em vez do serviço
externo (no Hobby o cron só roda 1x por dia, o que não serve). Bastam 3 linhas
no `vercel.json`:

```json
"crons": [{ "path": "/api/wa-monitor", "schedule": "*/10 * * * *" }]
```

Nesse caso a autenticação sai pelo header `Authorization: Bearer $CRON_SECRET`
da Vercel, então a rota precisaria aceitar esse formato também — hoje ela só lê
`?secret=`.

## Ligar o aviso instantâneo (opcional)

No Evolution Manager, em **cada instância** → Webhook:

- URL: `https://qs.setuforeuvouviagens.com.br/api/wa-evolution-webhook?secret=<EVOLUTION_WEBHOOK_SECRET>`
- Eventos: `MESSAGES_UPSERT` (reações, já usado) e `CONNECTION_UPDATE` (o monitor)

Sem isso o monitor continua funcionando — só descobre a queda na varredura
seguinte em vez de na hora.

## Testar

```bash
curl -i "https://qs.setuforeuvouviagens.com.br/api/wa-monitor?secret=<WA_MONITOR_SECRET>"
```

A resposta lista as instâncias e o que foi avisado:

```json
{ "ok": true, "instancias": [{ "nome": "Comercial - SDRs (1595)", "status": "open" }],
  "avisos": [], "enviados": 0 }
```

Como a primeira execução não tem estado anterior, um número que já esteja caído
gera aviso na hora — é o teste mais fácil.

Diagnóstico rápido pelos códigos: `401` = segredo errado · `503` com
`EVOLUTION_URL / EVOLUTION_APIKEY não configurados` = falta variável na Vercel ·
`503` com `sem-instancia-no-ar` = está tudo caído mesmo.
