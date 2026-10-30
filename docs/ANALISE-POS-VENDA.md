# Análise pós-venda (V2, 30/10/2026)

Pedido do Bruno: toda venda que sobe no QS (Closer, Rel, Ops) passa por uma análise **antes de concluir**.
A análise cruza o pacote **apresentado** ao cliente (a proposta) com o que foi **emitido** (vouchers,
bilhetes, reservas) e entrega um **extrato do que falta emitir**. Também avalia o **risco** da venda.
Se falta algo, o Relacionamento recebe uma solicitação interna. A venda ganha um **status**.

## Onde está

| Peça | Arquivo |
|---|---|
| Motor determinístico (cruzamento + riscos por regra) | `api/_vendaConferencia.js` |
| Rota (rascunho, venda gravada, IA, gravação) | `api/venda-analise.js` |
| Banco (status, histórico, tipo de solicitação, RPCs, view) | `supabase/migrations/0230_venda_analise_pos_venda.sql` (**não aplicada**) |
| Etapa 5 "Análise pós-venda" no Subir venda | `src/venda/SubirVenda.tsx` |
| Extrato (tela) | `src/venda/ExtratoAnalise.tsx` |
| Painel "Vendas com pendência" | `src/venda/VendasComPendencia.tsx`: no Ops, em Subir venda; no Rel, no topo de Pipeline de vendas |
| Chamadas do front | `src/venda/analise.ts` |
| Testes | `node scripts/teste-conferencia.mjs` (motor, 44) · `node scripts/teste-venda-analise-rota.mjs` (rota com banco/OpenAI falsos, 9) · `scripts/local-postgres/teste-analise-0230.mjs` (0230 num Postgres local, 14) |

## Fluxo

1. A pessoa preenche os 4 passos do Subir venda e toca em **Continuar** no passo "Valores e pagamento".
2. O passo 5, **Análise pós-venda**, chama `POST /api/venda-analise { rascunho }` e mostra "Revisando a venda…" enquanto espera.
   - Nada é gravado nesse momento.
   - Na tela aparece o extrato: OK, falta emitir, divergente e fora do apresentado, mais o risco.
3. A pessoa pode **concluir mesmo com pendência**. Nesse caso o botão vira "Concluir com pendência".
4. Depois do `venda_subir`, a tela chama `POST /api/venda-analise { venda_id, motivo:'subir_venda', ia_previa }`.
   - A chamada reaproveita a leitura da IA do passo 2, então não paga a IA duas vezes.
   - O servidor confere de novo, agora com os dados gravados, e chama `venda_analise_gravar`. Essa função:
     - grava a análise no histórico (`qs_venda_analises`);
     - põe o status na venda (`qs_vendas.analise_status`);
     - se falta emitir ou há divergência, abre a solicitação **"Emissões pendentes (venda)"** pro Relacionamento. É uma por venda, entra no rodízio da 0222 e acende a bolinha.
5. A **reanálise** pode rodar a qualquer momento no painel.
   - Enquanto o pedido estiver aberto, ela comenta no mesmo pedido.
   - Quando tudo bate, comenta "tudo emitido ✓ — pode concluir".
6. **Corrigir** no painel: "Marcar emitido" grava o localizador no item (`venda_item_marcar_emitido`) e reanalisa na hora.

Venda lançada pelo **próprio Relacionamento** não abre solicitação, porque a Central recusa pedido do setor pra ele mesmo (`de_setor <> para_setor`). Ela fica só no painel.

## Regra de cruzamento (determinística)

**Os três lados**
- **Apresentado**: itens da **opção aprovada** da proposta mais recente ligada à venda, por viagem, cliente, lead do cartão ou solicitação do lead. Sem proposta, a base passa a ser o **vendido**, e isso vira risco.
- **Vendido**: `qs_venda_itens` da venda (ou o rascunho da tela).
- **Emitido**: as evidências, que vêm de quatro lugares:
  - trechos da viagem (`rel_viagem_trechos`);
  - itens com `status='emitido'` ou com localizador, apólice ou bilhete. Isso inclui o que a IA leu do voucher no passo 1;
  - documentos da viagem (`rel_documentos`): voucher, bilhete, seguro e visto;
  - vaga na expedição (`passageiros` da venda em Pré-reserva ou Confirmado).

**Cada evidência cobre um item só.**

**Aéreo: confere trecho a trecho**
- Mesma rota (IATA) e mesma data = **OK**.
- Mesma rota com data até 7 dias diferente = **divergente** ("data diferente").
- Mesmo dia saindo ou chegando no mesmo aeroporto = **divergente** ("rota diferente").
- Bilhete com menos passageiros que a venda = **divergente**. Emitido sem localizador também.
- PDF de bilhete sem trecho estruturado cobre um trecho, com a nota "rota e data não conferidas".
- Trecho sem nada = **falta**. É **voo interno** quando as duas pontas ficam no mesmo país.

**Outros tipos** (hotel, seguro, transfer, passeio, trem, carro, cruzeiro, pacote)
- O casamento usa o tipo e uma pontuação: data de início igual vale +3, até 3 dias +1. Data de fim igual vale +2. Nome parecido vale até +2.
- Início ou fim diferente vira **divergente**. Hotel com outro nome também. Seguro, passeio, transfer ou trem com menos pessoas que a quantidade também.
- Voucher em PDF cobre hotel, transfer, passeio etc., com a nota "datas não conferidas".

**Expedição**
- A "emissão" é a vaga. O aéreo do grupo é do Ops.
- Concierge não entra no extrato.

**Fora do apresentado**
- Emitido estruturado que não casou com nada = **extra**.
- Vendido de um tipo que não estava na proposta = **divergente**.

**Status** (prioridade): `risco_alto` > `divergencia` > `faltam_emissoes` > `tudo_emitido`. `em_analise` é o valor de quem ainda não foi analisado.

## Riscos (nível e motivo)

| Categoria | Alto | Médio | Baixo |
|---|---|---|---|
| sem proposta | pacote vendido sem proposta no QS | outro item sem proposta (expedição pura não conta) | |
| voo interno | voo interno sem bilhete | | |
| prazo | embarque em até 15 dias com algo por emitir | até 45 dias | |
| passaporte | vence antes da volta, ou menos de 6 meses depois dela (viagem internacional) | sem validade no cadastro | |
| nome | nome emitido que não bate com ninguém do cadastro | nome abreviado ou parcial | |
| conexão | menos de 45 min | menos de 60 min (nacional) ou de 90 min (internacional) | |
| pagamento | falta receber na expedição e embarque em até 30 dias | sem forma de pagamento; entrada sem valor ou data | entrada com data passada (confirmar); saldo a receber |
| margem | custo maior que a venda | margem abaixo de 8% (só itens com custo) | |
| valor | | venda abaixo do total da proposta (mais de 1%) | venda acima |
| seguro | | internacional sem seguro; seguro que não cobre as datas | |
| cadastro | | | venda pra N pessoas com menos cadastros |

**IA (complementa, não substitui)**
- Recebe o material sem CPF, passaporte, telefone ou e-mail, a conferência pronta e os riscos das regras.
- Devolve **só riscos adicionais** e um parecer curto. Usa o schema JSON estrito `RISCOS_IA`: `nivel` baixo/médio/alto, `categoria`, `motivo`.
- O que for parecido com um risco das regras é descartado.
- Um risco **alto** da IA também deixa a venda em `risco_alto`. Fica marcado "IA" na tela.

## O que precisa pra ligar

1. **Aplicar a 0230** (idempotente, rollback no fim do arquivo).
   - Sem ela, a análise do passo 5 funciona igual, mas nada fica guardado.
   - Nesse caso, ao concluir com pendência, a tela abre o pedido pelo caminho antigo (`qs_sol_criar`, tipo "Outro" do Rel).
   - O painel avisa "falta aplicar a 0230".
2. **`OPENAI_API_KEY` na Vercel** (opcional; `OPENAI_MODEL` padrão `gpt-4o-mini`, a mesma da leitura de voucher).
   - Sem a chave, roda o **modo regras** e a tela mostra "Análise por IA indisponível".
3. Deploy do front e de `api/venda-analise.js`. O `vercel.json` já tem `maxDuration: 60`.

## Decisões a confirmar

- Pedido do tipo "Emissões pendentes" vai pro **setor todo** (`papel` null). É pra ir só pra CX?
- Divergência também abre pedido, não só falta.
- Risco alto da IA muda o status.
- Venda do próprio Rel não abre pedido.
- Expedição sem proposta não é risco.
- A data do embarque define a prioridade do pedido: até 15 dias é urgente, até 45 dias é alta.
