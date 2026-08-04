# Agenda do QS ↔ Google Meet

Implementa o briefing "Agenda de reuniões no QS". O Supabase é a fonte de verdade
de disponibilidade, reserva e desfecho; o Google entra só para gerar a sala do
Meet e disparar o convite.

## A decisão que muda tudo: nada de tabela nova

O briefing propunha criar `closers`, `disponibilidade`, `bloqueios` e
`agendamentos`. Essas quatro **já existem** no QS como `qs_closer_config`,
`qs_closer_availability`, `qs_closer_blocks` e `qs_meetings` (migration 0027).

Criar as tabelas do briefing em paralelo faria **duas agendas concorrentes no
mesmo banco**: a reunião nascida no Painel (botão Ganho → `qs_meetings`) não
apareceria na agenda nova, o sync do Bitrix continuaria lendo a antiga, e as
métricas somariam dois universos diferentes. Por isso o desenho do briefing foi
aplicado SOBRE as tabelas existentes.

| Briefing | No QS |
|---|---|
| `agendamentos` | `qs_meetings` |
| `closers` | `qs_users` (role `closer`) + `qs_closer_config` |
| `disponibilidade` | `qs_closer_availability` |
| `bloqueios` | `qs_closer_blocks` |
| `inicio` / `fim` | `scheduled_at` / `ends_at` |
| `google_event_id` / `meet_url` | `calendar_event_id` / `meeting_link` |
| `sal_marcado_em` | `sal_at` |
| `deal_id` | `qs_leads.bitrix_id` (pelo lead) |

## Como o pedido caminha

```
QS  ─ reserva no Supabase PRIMEIRO (a exclusion constraint aceita ou rejeita)
    └─ POST /api/agenda-meet ......... valida sessão + dono do lead, guarda o segredo
         └─ POST webhook do n8n ...... criar | reagendar | cancelar
              └─ Google Calendar API . cria/move/apaga o evento e envia o convite
         ←─ { ok, event_id, meet_link } → gravado em qs_meetings
```

Ordem invertida (Google primeiro) geraria Meet órfão sem reserva. **Não inverta.**

### O detalhe que mais engana

O webhook responde **HTTP 200 sempre**. Sucesso e falha se distinguem pelo campo
`ok` do corpo — tratar o status HTTP como sinal de sucesso faria o QS gravar link
vazio e dar a reunião por marcada quando o Google recusou. Quem cuida disso é
`src/lib/qs/agendaMeet.ts`; as telas só olham `ok`.

### Códigos que exigem reação

| Campo | Significado | O que o QS faz |
|---|---|---|
| `duplicado: true` | mesmo `meeting_id` reenviado | sucesso — é a proteção contra clique duplo |
| `sem_meet: true` | evento criado, Google não devolveu sala | grava assim mesmo e avisa "mande o link na mão" |
| `codigo: "nao_encontrado"` | evento apagado no Google por fora | `reagendarEvento` recria sozinho com `criar` |
| `convidados_descartados` | e-mails malformados removidos | avisa quem agendou (senão o cliente não recebe e ninguém nota) |
| `ja_estava_apagado` | cancelar algo que já não existia | sucesso — cancelar é idempotente |

## Migration 0032 — e um buraco que ela fecha

A trava anti-overbooking já existia (0027), mas valia só para `status =
'agendada'`. A 0030 criou `'confirmada'` — e reunião confirmada é a que MAIS
ocupa horário. Do jeito que estava, **bastava confirmar uma reunião para o
horário voltar a ser oferecido**. A 0032 recria a constraint com a regra do
briefing: ocupa horário tudo que não foi cancelado nem reagendado.

Também entram: `realizada_em` (ancora o SAL no mês da reunião, não no mês em que
alguém preencheu), `sal_motivo` com CHECK (recusado sem motivo é dado sujo por
construção) e `reagendado_de` (é o que separa reagendamento de no-show).

Se a migration avisar que a trava não entrou, a base tem sobreposição: a consulta
comentada no fim do arquivo lista os pares para resolver.

## Ligar (4 passos)

1. **Migrations.** Cole `0031_agenda_google_meet.sql` e `0032_agenda_desfecho.sql`
   no SQL Editor do Supabase. As duas são idempotentes.
2. **Credencial Google no n8n** — Google Calendar OAuth2, na conta que será dona
   da agenda da operação.
3. **Workflow.** Importe `n8n/agenda-google-meet.workflow.json`, ligue a
   credencial nos nós do Google e o Header Auth (`x-qs-agenda-secret`) no
   webhook, **ative** e copie a URL de **produção** (`/webhook/`).
4. **Envs na Vercel** (Production + Preview) e redeploy:
   ```
   N8N_AGENDA_URL    = https://SEU-N8N/webhook/qs-agenda-meet
   N8N_AGENDA_SECRET = o mesmo valor do Header Auth
   ```

Sem as envs, `/api/agenda-meet` responde 501 e o QS segue funcionando sem o
Google — nenhuma tela quebra.

## Ainda falta (do briefing)

- Botões de desfecho ligados às ações: **No-show** → `cancelar`, **Reagendar** →
  linha nova com `reagendado_de` + `reagendar`
- Seletor de motivo da recusa do SAL (lista em `qs_settings.sal_motivos`)
- Modal de agendamento com slots livres (disponibilidade − bloqueios − reuniões)
- Espelhamento do desfecho no Bitrix (tabela da seção 5.3 do briefing)
- Jobs de auditoria (n8n, cron horário — seção 7)
- Views de métrica com o corte `dt_inicio_medicao`

## Pendências fora do código

- Trocar `CALENDAR_PADRAO` no nó "Validar entrada" de `primary` para uma agenda
  dedicada (ex.: `Meets · Operação`)
- Testar no Google Admin se convidado externo entra no Meet sem sala de espera —
  a conta organizadora nunca estará na reunião
- Fechar a lista de motivos de recusa com o comercial
- Definir teto de reagendamentos (sugestão do briefing: 3)
- **Cadastrar os closers** (`qs_users`, papel `closer`, com e-mail): hoje não há
  nenhum, e é o e-mail deles que recebe o convite do Google
