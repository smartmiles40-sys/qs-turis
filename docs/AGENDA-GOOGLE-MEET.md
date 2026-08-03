# Google Meet automático no "Ganho / Agendou"

Quando o SDR confirma o ganho e agenda a reunião, o QS cria o evento no **Google
Calendar** com sala do **Meet**, convida o **closer** e o **cliente**, e grava o
link na reunião. O closer passa a ver tudo na agenda dele, com lembrete.

## Como o pedido caminha

```
Painel (Ganho/Agendou)
   └─ createMeeting → qs_meetings  ......... a reunião já existe aqui
        └─ POST /api/meet-create  ......... valida sessão + dono do lead
             └─ POST webhook do n8n  ...... leva o segredo, que nunca vai ao navegador
                  └─ Google Calendar API .. cria evento + Meet, envia os convites
             ←─ { event_id, meet_link } ... gravado em qs_meetings
```

**Nada disso pode derrubar o Ganho.** A reunião já está gravada antes da chamada;
integração desligada não diz nada, e falha vira aviso na tela ("mande o link na
mão") com o registro em `qs_meetings.calendar_error`.

## Ligar (4 passos)

1. **Migration.** Cole `supabase/migrations/0031_agenda_google_meet.sql` no SQL
   Editor do Supabase. É idempotente.

2. **Credencial do Google no n8n.** Credentials → New → **Google Calendar
   OAuth2 API**, conectando a conta que vai ser **dona da agenda da operação**
   (não a pessoal de ninguém). É essa conta que aparece como organizadora.

3. **Workflow.** Importe `n8n/agenda-google-meet.workflow.json`.
   - No nó **Webhook QS**, crie/escolha a credencial **Header Auth** com nome
     `x-qs-agenda-secret` e um valor secreto qualquer (anote).
   - No nó **Criar evento no Google**, escolha a credencial do passo 2.
   - **Ative** o workflow e copie a URL de **produção** (`/webhook/...`).
     A de teste (`/webhook-test/...`) só vive uma execução.

4. **Envs na Vercel** (Production + Preview) e redeploy:
   ```
   N8N_AGENDA_URL    = https://SEU-N8N/webhook/qs-agenda-meet
   N8N_AGENDA_SECRET = o mesmo valor do Header Auth
   ```

## Decisões que valem explicação

**Por que uma conta só cria os eventos, em vez de criar direto na agenda de cada
closer.** Escrever na agenda de outra pessoa exige Google Workspace com
*delegação em todo o domínio* — configuração de administrador do domínio. Com uma
conta só, o closer entra como **convidado**: recebe o convite e o compromisso
aparece na agenda dele ao aceitar. Mesmo resultado prático, sem depender de TI.
Se um dia a agência tiver a delegação, basta trocar `CALENDAR_ID` no nó *Config
da agenda* pelo e-mail do closer.

**`conferenceDataVersion=1` é obrigatório.** Sem esse parâmetro na URL, o Google
**ignora em silêncio** o pedido de criar a sala: o evento nasce certinho e sem
Meet nenhum. O sintoma seria "cadê o link?" sem nenhum erro em lugar algum.

**`requestId` derivado do id da reunião.** Reenviar o mesmo `requestId` devolve a
*mesma* sala em vez de criar outra — então repetir a chamada não multiplica
salas.

**A rota é idempotente.** Se a reunião já tem `calendar_event_id`, ela devolve o
que existe e não cria um segundo evento. Isso cobre duplo clique no botão e o
Ganho sendo refeito.

## Quando algo não funcionar

| Sintoma | Causa provável |
|---|---|
| Nada acontece, nenhum aviso | `N8N_AGENDA_URL` vazia (rota responde 501 de propósito) |
| "o convite do Google não foi criado (n8n HTTP 404)" | URL de teste em vez da de produção, ou workflow inativo |
| "…(n8n HTTP 403)" | `N8N_AGENDA_SECRET` diferente do Header Auth do n8n |
| Evento criado, mas **sem link do Meet** | faltou `conferenceDataVersion=1`, ou a conta Google não pode criar conferência |
| Convite não chega no cliente | reunião sem e-mail do cliente — o campo é preenchido no modal do Ganho |

O último erro fica guardado em `qs_meetings.calendar_error`.
