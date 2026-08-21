# A conversa de WhatsApp aparece no card do Bitrix (20/08/2026)

## O pedido

"Queria salvar todas as mensagens que os SDRs mandam no WhatsApp dentro do
Bitrix, no card do cliente." Quem trabalha no Bitrix — Comercial e gestão — abre
o card e não vê uma linha do que foi conversado.

## Exige muito do sistema? Não. Mas o problema não era carga.

Medido em 20/08 sobre os últimos 14 dias:

| | |
|---|---|
| Mensagens enviadas | **287/dia** |
| Mensagens recebidas | **127/dia** |
| Leads tocados em 14 dias | 738 |

O Bitrix aceita ~2 requisições/s. 414/dia é **0,005/s** — carga não é problema
nenhum. Os dois problemas reais são outros:

1. **Latência no envio.** A função da Vercel tem 10s e o envio da SDR divide
   esse orçamento. Uma chamada ao Bitrix pendurada em cada mensagem faria o QS
   parecer lento no único lugar onde lentidão dói. Por isso o trabalho é
   **assíncrono e em lote**, fora do caminho do envio — a regra que já tinha
   saído da auditoria de WhatsApp ("nada pesado no caminho do webhook").
2. **Ruído.** 414 comentários soltos por dia tornam o card ilegível, e o
   histórico comercial (proposta, reunião, valor) se perde no meio dos "oi, tudo
   bem?".

## Como ficou: um resumo por lead por dia

`api/wa-bitrix-digest.js` — `POST /api/wa-bitrix-digest?secret=<WA_WEBHOOK_SECRET>`

Cada lead que conversou no dia ganha **um** comentário na timeline do negócio.
Conferido contra o dia 19/08 real: **572 mensagens → 143 comentários** (em vez de
572), com 403 caracteres em média e 3.107 no maior.

```
💬 WhatsApp — 19/08/2026 · Milena Beltrao

[11:29] Cliente: Vcs que nao responderam kkkkk
[11:32] Nós (Victor Hugo): Milena mil desculpas, tivemos problemas com o WhatsApp Meta
[11:42] Cliente: Quantas pessoas sao no grupo?
[11:43] Nós (Victor Hugo): São cerca de 20 pessoas
[11:51] Nós (Victor Hugo): Dito isso a faixa de investimento fica em torno de R$ 27.000,00 a R$ 34.000,00

— enviado automaticamente pelo QS
```

Detalhes que importam:

- **Idempotente.** A UNIQUE `(lead_id, dia)` da migration 0058 faz chamar duas
  vezes ser inofensivo — igual ao vigia, que também tem mais de uma perna
  porque agendador externo morre calado (aconteceu em 17/08, dois dias mudo).
- **Retomável.** Processa um lote e devolve `restantes`; sobrou, chama de novo.
  Para em 45s por conta própria em vez de ser morta no meio — ser morta antes de
  MARCAR o envio renderia comentário repetido no card.
- **Fuso de São Paulo**, não UTC. Um "resumo de terça" que começa às 21h de
  segunda não é o resumo de terça para ninguém do time.
- **Anexo vira `[N anexo(s)]`.** O arquivo mora no QS; duplicar mídia no CRM não
  ajuda e pesa.
- **A assinatura não sai duplicada.** O QS prefixa a mensagem com `*Yanca*` para
  o cliente; aqui o nome já está no `Nós (Yanca)`.

### Parâmetros

| | |
|---|---|
| `?dia=YYYY-MM-DD` | reprocessa um dia específico (padrão: ontem) |
| `?dia=hoje` | conferir na hora, sem esperar a virada |
| `?limite=N` | tamanho do lote (1–60, padrão 25) |

## Para ligar

1. Colar `supabase/migrations/0058_conversa_no_card_do_bitrix.sql` no SQL Editor
   (projeto `eabfjomrnucymduqnbci`).
2. Conferir que `BITRIX_WEBHOOK_BASE` existe nas envs da Vercel. Sem ela a rota
   responde `{ok:false, motivo:...}` e não faz nada.
3. `git push origin main` → deploy.
4. Apontar o agendador externo para a URL, uma vez por dia de madrugada.
5. Teste seguro antes de soltar: `?dia=hoje&limite=1` cria **um** comentário.
   Confere no card antes de liberar o resto.

## Limite conhecido: 126 conversas não têm para onde ir

No dia 19/08, dos 269 leads que conversaram, **126 não têm `bitrix_id`** — e sem
negócio não existe timeline onde comentar. Não é falha deste job: são leads que
vieram do Bitrix (o `segment` deles é nome de origem de lá: `[Tailândia] -
Tráfego`, `[Peru] - Orgânico`…) mas chegaram ao QS **sem o id do negócio**.

Ou seja: existem nos dois sistemas e não estão ligados. Além do resumo, isso
também impede o "primeiro contato move o card" de funcionar para eles.

O conserto é um backfill que casa os dois lados pelo telefone — a função
`procurarNegocioPorTelefone` (`api/_bitrixLead.js`) já faz exatamente essa busca,
em 4 formatos. **Não foi feito**: mexer em 137 vínculos de uma vez é decisão do
Bruno, não efeito colateral desta entrega.
