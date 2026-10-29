# Proposta de schema: Solicitações (redesign 29/10)

Este documento só propõe mudanças. **Nada daqui foi aplicado.** Spec: `docs/ref/qs-redesign-ficha-solicitacoes.md`, seção 4, "Regras de negócio".

## 1. [SCHEMA] Vínculo com a cliente obrigatório na criação

**Problema.** Na tela nova aparecem pedidos com "Sem cliente vinculado" (ex.: #39, "Passar a informação para a família sobreira"). Quem recebe precisa adivinhar de quem é o pedido, e a solicitação não aparece na ficha da cliente.

**Proposta (migration nova, por exemplo `0223_sol_cliente_obrigatorio.sql`):**

1. Coluna nova `qs_solicitacoes.sem_cliente_confirmado boolean not null default false`, para registrar que quem pediu confirmou que o pedido é interno.
2. Em `qs_sol_criar`, um parâmetro novo `p_sem_cliente boolean default false`. A função recusa a criação quando `p_cliente`, `p_viagem`, `p_lead` e `p_conversa` vêm todos nulos **e** `p_sem_cliente` é falso:
   ```sql
   if p_cliente is null and p_viagem is null and p_lead is null and p_conversa is null and not coalesce(p_sem_cliente, false) then
     raise exception 'Diga de qual cliente é o pedido, ou marque "é um pedido interno, sem cliente".';
   end if;
   ```
   Grava `sem_cliente_confirmado = p_sem_cliente`.
3. Expor `sem_cliente_confirmado` em `qs_solicitacoes_v` (recriar a view a partir da versão **vigente**, que é a da 0222/0158, e não da 0149).
4. **Sem backfill obrigatório.** Os pedidos antigos sem cliente continuam válidos. Opcionalmente, marcar como `sem_cliente_confirmado = true` os que já foram concluídos.

**Front (depois de aplicar):**
- `NovaSolicitacao.tsx`: o `EscolherClienteVenda` passa a ser obrigatório, com a caixa "É um pedido interno, sem cliente". `criarSolicitacao` em `lib.ts` ganha `semCliente?: boolean`.
- No cartão e no modal, "Sem cliente vinculado" fica em `warn` só quando `!sem_cliente_confirmado`. Quando confirmado, mostra "Pedido interno" em cinza.
- A ficha ("Pedir", em `src/rel/clientes/ficha/pedirACliente.ts`) já manda `clienteId`, então não muda nada.

**Risco.** Algum fluxo automático (n8n, triggers, 0222) que chame `qs_sol_criar` sem alvo passaria a falhar. Antes de aplicar, conferir com `grep -rn "qs_sol_criar" supabase/ src/` e nos workflows do n8n. Esses fluxos devem passar `p_sem_cliente => true`.

## 2. TODO: tipo "Aviso de encomenda"

Pedidos repetidos do mesmo jeito (#37, #38: "Avisar que ela precisa retirar/pegar a encomenda no correio"). A ideia é avaliar um tipo próprio em `qs_solicitacao_tipos` (setor `relacionamento`, papel `cx`), com uma **mensagem padrão** para o WhatsApp da cliente (modelo em Modelos de mensagem) e prazo curto. **Não implementar agora**: só medir quantos pedidos assim aparecem por semana antes de decidir.
