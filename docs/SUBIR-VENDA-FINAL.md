# Subir venda — sprint final (11/11/2026)

Contrato comum entre as 4 frentes (Banco, API/Bitrix, Tela, Análise). **Nenhuma frente
muda nomes daqui sem atualizar este arquivo.** Contexto: `qs_vendas` tem 0 linhas em
produção — pode mudar o modelo sem migrar dado antigo (mas migrations aditivas e
idempotentes; nada de `drop` de coluna usada por outras telas).

## Decisões do Bruno (fechadas)
1. Família logo de cara: o closer cadastra quem vai junto **no cartão, ainda em negociação**;
   cada pessoa ganha o card filho no Bitrix na hora; toda mudança de etapa move **todos** juntos.
2. Pessoas com **vínculo** (cônjuge, filho, pai/mãe, irmão, amigo, outro) — já existe `VINCULOS_VIAJANTE`.
3. **Reservar vaga**: ocupa a vaga, **conta como venda no Dashboard** e o card vai pra
   "Em emissão" (pré-venda da 0207). **Não expira** (só sai se alguém cancelar).
4. **Consolidar**: só com tudo preenchido (pessoas + vínculo, itens, detalhes, pagamento
   cuja soma = total). Gera viagem do Rel + contas a receber do Fin (hoje isso só nasce
   via `closer_consolidar` pela ficha — passar a nascer da venda).
5. **Pagamento em linhas**: cada linha = forma, valor, data, nº de parcelas; soma das linhas
   = total da venda; + observação livre pro Financeiro.
6. **Proposta anexada OPCIONAL** (nunca bloqueia).
7. Voucher fica DEPOIS de "O que vendeu" (dentro de Detalhes); voltar/fechar/cair a
   internet não perde nada (rascunho da tela inteira).
8. Venda em blocos: Closer / Marketing / SDR / Pós-venda (preenchidos sozinhos do lead).
9. Análise pós-venda com revisão da IA (OpenAI, já existe em `api/venda-analise.js`).

## Furos da revisão de 10/11 que TÊM que sumir
- 0338 `_pax_valor_na_venda_trg`: Ops muda valor de 1 passageiro → item vira soma só de quem
  tem valor (R$20k → R$7k). **Regra nova: o valor do ITEM é a fonte; pessoas são rateio.**
  Mudar valor de pessoa NÃO reescreve o item; se o rateio não fecha, marca pendência.
- closer.js espelhar: pai reduzido ANTES dos filhos existirem; `carregarFamilia().catch→null`
  → pai sem desconto (dobra). **Ordem: filhos → pai; erro ao carregar família = erro, não ok.**
- `SubirVenda.tsx` conta vagas com quem já está na venda → reabrir em expedição quase
  lotada trava. **Vagas livres = vagas + quem já é desta venda.**
- Editar venda consolidada chama `marcarPreVenda` → erro "já consolidada". **Não chamar.**
- Remover pessoa/item não cancela o passageiro (vaga presa). **Quem sai = passageiro cancelado.**
- Comissão conta venda desfeita/cancelada → só `estado in ('reservada','consolidada')`.

## Modelo (Banco — migrations 0356, 0357, 0358)
`qs_vendas` ganha:
- `estado text not null default 'negociacao' check (estado in ('negociacao','reservada','consolidada','cancelada'))`
- `reservada_em timestamptz`, `consolidada_em timestamptz`, `cancelada_em timestamptz`, `cancelada_motivo text`
- `obs_financeiro text`
- `rascunho jsonb` (estado da tela inteira do Subir venda; a tela grava com debounce)

Uma venda por cartão do closer continua (`qs_vendas_negocio_unico`). A venda **nasce em
`negociacao`** quando o closer cadastra a família no cartão (ou abre o Subir venda).

Nova tabela `qs_venda_pagamentos` (id, venda_id fk cascade, ordem int, forma text
(`pix|cartao|boleto|transferencia|dinheiro|link|outro`), valor numeric(12,2) > 0,
data date, parcelas int ≥1 default 1, obs text). RLS igual à de `qs_vendas`.

### RPCs (security definer, conferem permissão como as de hoje)
| RPC | Entrada | Faz | Retorno |
|---|---|---|---|
| `venda_familia_salvar(p jsonb)` | `{negocio_id, pessoas:[{chave, nome, vinculo, cpf, nascimento, email, telefone, cliente_id?, valor?, removida?}]}` | Cria a venda em `negociacao` se não existir; sincroniza `qs_venda_pessoas` (reusa `_venda_pessoas_sincronizar`); pessoa removida = `removida_em` + passageiro cancelado se houver. | `{venda_id, pessoas:int, ids:[{chave, pessoa_id}]}` |
| `venda_subir(p jsonb)` (existente) | igual hoje + `pagamentos:[{forma,valor,data,parcelas,obs}]`, `obs_financeiro`, `acao:'salvar'|'reservar'` | Grava tudo. `acao='reservar'` → `estado='reservada'`, ocupa vaga (passageiros ativos). `salvar` em venda `negociacao` não ocupa vaga. Reabrir não conta vagas próprias. Quem sai = passageiro cancelado. Venda consolidada: aceita edição (Ops/Rel revisam) sem erro. | igual hoje + `estado` |
| `venda_consolidar(p_venda uuid)` | — | Confere completude (lista de faltas em PT-BR, ex.: "Maria: falta o vínculo", "Pagamento: soma R$ 15.000 ≠ total R$ 17.000"); se ok → `estado='consolidada'`, cria/atualiza `rel_viagens` + contas a receber das linhas de pagamento (mesmas tabelas que `closer_consolidar` usa) e marca `qs_closer_negocios.consolidada_em`. | `{ok:true}` ou `{ok:false, faltas:[text]}` |
| `venda_cancelar(p_venda uuid, p_motivo text)` | — | `estado='cancelada'`, passageiros cancelados (vaga volta). | `{ok}` |
| `venda_blocos(p_venda uuid)` | — | Os 4 blocos a partir do lead/negócio: `{marketing:{origem,utm_source,utm_campaign,utm_content,lp}, sdr:{nome, agendou_em}, closer:{nome}, pos_venda:{nome}}` (o que não existir = null). | jsonb |
| `venda_do_contrato(p_negocio uuid)` | — | Pessoas (nome, cpf, nascimento, e-mail, vínculo se houver) e tipo (expedição/aéreo + expedicao_id/valor) dos contratos já enviados do cartão, pra pré-preencher. | jsonb |

## API/Bitrix (`api/closer.js`, `api/_closerBitrixFamilia.js`)
- `POST /api/closer { acao:'espelhar', negocioId }` passa a ser chamado **também** depois de
  `venda_familia_salvar` (a tela chama). Cria/atualiza os cards filhos já em negociação,
  na mesma coluna do pai.
- Toda mudança de etapa do pai (espelhar, pré-venda, ganho, perdido) aplica a MESMA etapa
  em todos os filhos ativos.
- `acao:'pre-venda'` = o que a tela chama em **Reservar vaga** (Dashboard + "Em emissão").
  Não chamar em venda já consolidada (devolve ok "já consolidada", não erro).
- Ordem: filhos → pai; falha ao carregar família = status `erro` com mensagem.

## Tela (`src/venda/*`, `src/closer/*`)
- Cartão do closer (NegocioPainel): bloco **"Quem vai"** — adicionar/remover pessoas com
  vínculo → `venda_familia_salvar` → `espelhar`.
- Subir venda, passos: **Quem comprou** (família + pré-preenchido de `venda_do_contrato`) →
  **O que vendeu** (tipo pré-selecionado do contrato) → **Detalhes** (voucher/IA aqui dentro)
  → **Pagamento** (linhas + soma = total, obs pro Financeiro) → **Análise**.
- Botões finais: **Salvar** · **Reservar vaga** (estado negociacao) · **Consolidar venda**
  (mostra as `faltas` se não der). Proposta: campo opcional.
- Rascunho: estado inteiro em `qs_vendas.rascunho` (debounce ~1,5 s) + `localStorage`
  como rede; reabrir restaura; voltar entre passos nunca limpa nada.
- Resumo da venda mostra os 4 blocos (`venda_blocos`).

## Análise (`api/venda-analise.js`, `api/_vendaConferencia.js`)
- Regras novas: soma dos pagamentos × total; pessoa sem vínculo/CPF/nascimento; nome no
  bilhete/voucher × nome da ficha; datas do item × datas da expedição; pessoa sem item.
- Prompt da IA mais rigoroso, saída em PT-BR simples, cada risco aponta pessoa/item.
- Sem `OPENAI_API_KEY` continua "modo regras".
