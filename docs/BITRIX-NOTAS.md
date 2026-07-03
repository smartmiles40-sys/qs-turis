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
