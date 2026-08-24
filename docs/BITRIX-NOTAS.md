# Observações da atividade → Bitrix (itens 1 e 4 do sprint)

Durante o contato, o SDR anota observações no card da **Próxima atividade** (Painel de
Execução). Essas anotações são salvas como **notas do lead** na tabela `qs_notes` do
Supabase e devem ser espelhadas no Bitrix.

## O que o QS já faz (pronto)

Toda observação vira uma linha em `qs_notes`:

```
qs_notes {
  lead_id    -> qual lead
  author_id  -> qual SDR anotou
  body       -> o texto (no desfecho, vem como resumo: "Ligação — Pediu retorno: <obs>")
  tags       -> ["bitrix","observacao"]  ou  ["bitrix","desfecho","<resultado>"]
  created_at
}
```

- **Botão "Salvar no Bitrix"** (avulso) → grava a observação na hora.
- **Ao finalizar um desfecho** → grava um resumo (`canal — desfecho: observação`) automaticamente.

Todas levam a tag `bitrix`, então dá pra filtrar exatamente o que precisa subir.

## O que falta ligar (n8n — quando você quiser)

O QS **não** fala direto com o Bitrix (não temos o webhook REST nem o ID do negócio/contato
mapeado). O caminho recomendado, que combina com o fluxo `form → n8n → Bitrix` que já existe:

1. **Gatilho no n8n** — um workflow que escuta novas linhas em `qs_notes` com a tag `bitrix`.
   Opções: Supabase Trigger (Realtime), ou um Schedule que consulta a cada X min
   `select ... from qs_notes where 'bitrix' = any(tags) and bitrix_synced is not true`.
   (Se for por Schedule, dá pra adicionar uma coluna `bitrix_synced boolean default false`
   e marcar como `true` após enviar — me avisa que eu incluo na migration.)

2. **Achar o registro no Bitrix** — casar o lead pelo **telefone/e-mail** (pega em `qs_leads`
   pelo `lead_id`), usando `crm.deal.list` / `crm.contact.list`.

3. **Postar a nota** — `crm.timeline.comment.add` no negócio/contato encontrado, com o `body`.

> Se preferir o caminho **direto** (rota `/api/bitrix-note` chamando um webhook de entrada do
> Bitrix), me passe a URL do webhook REST + como localizar o lead lá, que eu implemento.

## Resumo

- ✅ Captura + persistência das observações: **feito**.
- ⏳ Entrega ao Bitrix: **1 workflow n8n** lendo `qs_notes` (tag `bitrix`) → `crm.timeline.comment.add`.

---

# Mapa REAL do funil comercial (categoria 25) — conferido em 2026-07-28

Lido de `crm.dealcategory.stage.list?id=25` no portal de produção. **Não confie na
convenção**: neste funil os IDs padrão do Bitrix foram reaproveitados fora de ordem.

| STATUS_ID | Nome no kanban |
|---|---|
| `C25:PREPAYMENT_INVOIC` | **Novo Lead - Aguardando resposta** ← é a primeira coluna |
| `C25:UC_271QUB` | **Follow-up 1** |
| `C25:EXECUTING` | Follow-up 2 |
| `C25:FINAL_INVOICE` | Follow-up 3 |
| `C25:UC_RYOCP0` … `C25:UC_U4L0WD` | Follow up 4 → 18 |
| `C25:NEW` | **Ajuste** (⚠️ NÃO é "Novo lead") |
| `C25:WON` | Reunião Agendada |
| `C25:LOSE` | Leads perdidos |
| `C25:UC_BYL4GG` | Proposta Pacote / Aéreo |

Ou seja: `C25:WON` (ganho/reunião) e `C25:LOSE` (perdido) usados no
`qs-to-bitrix-webhook` estão corretos; `C25:NEW` **não** serve como "Novo lead".

## Três pegadinhas que custaram tempo (2026-07-28)

1. **Webhook de entrada sem escopo.** Dá pra criar um webhook REST no Bitrix sem
   marcar nenhuma permissão. Ele autentica (`profile.json` responde!), mas todo
   `crm.*` volta `insufficient_scope`. Diagnóstico em 1 segundo:
   `BASE/scope.json` — se vier `{"result":[""]}`, falta marcar **CRM** em
   *Aplicativos → Integrações → (o webhook) → Editar → Atribuir permissões*.
2. **`/webhook-test/` vs `/webhook/`.** A URL de teste do n8n só existe enquanto
   você clica em "Test workflow" — uma execução e morre. O handler do webhook de
   **saída** do Bitrix tem que apontar pra `/webhook/` (produção), e o workflow
   precisa estar **ativo**.
3. **Erro do Bitrix vira execução verde.** Com `onError: continueRegularOutput`
   nos nós HTTP + `if (!r) return []` nos nós de código, qualquer recusa do CRM
   some sem rastro. Por isso os Code nodes agora dão `throw` quando a resposta
   traz `error` — ver os dois workflows em `n8n/`.

## Canal aberto NÃO move o card (de propósito)

`PROVIDERS_IGNORADOS = IMOPENLINES_SESSION,CRM_WEBFORM,CRM_EMAIL` no workflow
`bitrix-atividade-concluida`. Conversa de WhatsApp/canal aberto do Bitrix cria
atividade `IMOPENLINES_SESSION` — se ela movesse o card, **a mensagem do próprio
lead** promoveria o negócio sem o SDR ter feito nada. Só ligação/tarefa/reunião
concluída pelo SDR move.

Consequência: se o 1º contato acontece pelo canal aberto, quem move o card é o
lado do **QS** (`qs-primeiro-contato`), não este workflow.

---

## Os 403 do n8n, e por que 3 eventos saíram de lá (24/08/2026)

Sintoma: o card nunca saía de "Novo Lead" quando a SDR concluía a primeira
atividade. Nos logs da Vercel, em 17 dias:

| evento | 403 do n8n | chegou no Bitrix? |
|---|---|---|
| `primeiro-contato` | 227 | nunca |
| `nota` | 257 | nunca |
| `perdido` | 33 | nunca |
| `reuniao` | 2 | sim — 71 reuniões sincronizadas |

**A pista é a linha da reunião.** Os cinco eventos saem do MESMO código, na
mesma rota, com os MESMOS headers — `bitrix-sync.js` não diferencia um do outro.
Header igual com resultado diferente não é credencial errada: é **outro dono do
endereço**. Existiam dois workflows declarando `qs-nota`, `qs-primeiro-contato`,
`qs-perdido`, `qs-ganho` e `qs-reuniao`; o n8n registra UM dono por path, e as
cópias antigas ficaram com três deles, com outra credencial.

Diagnóstico em 1 minuto: se um evento passa e outro não, **não mexa na
credencial** — procure workflow duplicado (n8n → Workflows, e Executions pra ver
sob QUAL workflow a execução aparece).

Havia ainda um segundo defeito no ramo da nota: o nó `Config Nota` é um Set sem
"Include Other Input Fields", então descartava o corpo do webhook, e o
`Comentario da nota` lia `$json.body.bitrix_id` — sempre `undefined`. Mesmo com
o 403 resolvido, a nota não chegaria.

### O que mudou

`primeiro-contato`, `nota` e `perdido` agora vão **direto ao Bitrix** pelo
`/api/bitrix-sync` (`BITRIX_WEBHOOK_BASE`), sem n8n — mesma decisão do
`reuniao-campos` desde 14/08. Regras preservadas: o 1º contato só move quem
ainda está em `C25:PREPAYMENT_INVOIC`, e o perdido só mexe na coluna se o
negócio estiver mesmo no funil 25 (mandar `C25:LOSE` pra um card de outro funil
o arrasta pra fora do kanban de quem cuida dele).

`ganho` e `reuniao` continuam no n8n: o ganho depende de uma coluna que ninguém
decidiu (STAGE_GANHO vazio) e a reunião depende do catálogo de campos (0042).

**Observabilidade:** `qs_leads.bitrix_status_synced` (coluna da 0006, sem uso
desde que o sync virou por evento) passa a guardar o último evento de funil
espelhado. É o que permite CONTAR quantos cards o robô moveu — a falta disso é a
razão de 17 dias de 403 passarem despercebidos.
