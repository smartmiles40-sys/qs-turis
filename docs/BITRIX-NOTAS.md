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
