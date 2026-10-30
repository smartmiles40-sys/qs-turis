# Inventário da Ficha do Cliente (30/10/2026)

Pedido do Bruno: "a ficha tem que ter TUDO que foi feito com o cliente — todos os contratos, todos os laudos, todo o passaporte, todos os dados que ele já passou — pra numa próxima viagem a gente não pedir de novo". E tem que ser fácil de preencher por telefone.

Este documento lista **todo dado de cliente que existe no banco** (`eabfjomrnucymduqnbci`, lido em 30/10 só com SELECT), de onde vem, e se a ficha mostrava **antes** (commit 79ef3b0) e **agora** (branch `v2-ficha`).

Legenda: ✅ mostra · ➕ passou a mostrar agora · ⚠️ mostra em parte · ❌ não mostra (motivo).

A pessoa é **uma** linha de `rel_clientes` (cadastro único, 0172/0213). Cada linha de `passageiros` é **uma ida** dela numa expedição/pacote e aponta pra ficha em `passageiros.cliente_id`. Em 30/10: 977 fichas vivas e 930 passageiros, 922 deles ligados a uma ficha.

---

## 1. Cadastro: `rel_clientes`

Preenchimento em 30/10, contando só fichas vivas (977):

| Campo | Fichas | Antes | Agora |
|---|---|---|---|
| nome, telefone (757), e-mail (619) | — | ✅ | ✅ (+ Preencher por telefone) |
| cpf (726), nascimento (696) | — | ✅ | ✅ (+ Preencher por telefone) |
| passaporte (476), passaporte_validade (464) | — | ✅ (só o atual) | ➕ aba Documentos › **Passaportes** junta o da ficha com o de cada ida e mostra o alerta dos 6 meses |
| endereco_* (228 com CEP) | — | ✅ card Endereço | ✅ (+ Preencher por telefone, CEP via ViaCEP) |
| lgpd_consentimento_em (0) | — | ✅ lateral LGPD | ✅ |
| titular_id / parentesco | — | ✅ Pessoas ligadas | ✅ |
| observacoes | — | ✅ lateral | ✅ |
| bitrix_contato_id | — | ✅ Origem | ✅ |
| arquivado_* / mesclado_em_id | — | ✅ avisos | ✅ |
| origem | — | ✅ | ✅ |
| `bitrix_dados` (835) | — | ❌ | ❌ **não mostra** — ver §9 |
| `dados_expedicoes` (280) | — | ⚠️ aba Viagens (ExpedicoesDaFicha) | ⚠️ igual |
| **`perfil` (0228, nova)** | — | — | ➕ abas Preferências e Saúde + Preencher por telefone |

`dados_expedicoes` é o retrato importado em 13/10. Desde a 0220, o gatilho `_exp_trg_pax_cad_extras` também grava ali o contato de emergência, o endereço e a restrição alimentar da ida mais recente.

## 2. Idas: `passageiros` (930)

Preenchimento das colunas pessoais em 30/10:

| Coluna | Linhas | Antes | Agora |
|---|---|---|---|
| cpf, passaporte, validade_passaporte, data_nascimento, email, telefone, endereco_* | sincronizadas com a ficha pelo banco (0172/0213) | ✅ via ficha | ✅ |
| passaporte_arquivo_id (413), foto_arquivo_id (206) | | ✅ Documentos › Arquivos das expedições | ✅ |
| contato_emergencia_nome / fone / vinculo (328) | | ⚠️ aba Viagens (resumo da ida) | ➕ aba Preferências, Preencher por telefone, completude |
| saude jsonb (317), com 24 chaves (ver §3) | | ⚠️ aba Viagens (resumo) | ➕ aba **Saúde**: declarado + histórico por viagem |
| restricoes_alimentares (0), condicoes_medicas (0) | | ⚠️ | ➕ Saúde (vazias hoje; o dado real está em `saude`) |
| perfil_viajante jsonb (226): camiseta, profissao, instagram, musica, descricao_grupo, anima_expedicao, significado, confirmou_veracidade | | ❌ | ➕ Preferências: **camiseta, profissão, Instagram**. ❌ musica, descricao_grupo, anima_expedicao, significado (texto livre da inscrição, sem uso operacional) |
| pref_marcar_assento (175), pref_upgrade_classe (175) | | ❌ | ➕ Preferências |
| ja_viajou_internacional (328), paises_visitados (311) | | ❌ | ➕ Preferências |
| acompanhante_nome (137), acompanhante_vinculo, acompanhante_divide_quarto, acompanhante_dividir_com | | ⚠️ Pessoas ligadas (só os casados em `cad_acompanhantes`) | ➕ Preferências › "Com quem já viajou" |
| contrato_assinado (14 true) | | ⚠️ status da próxima viagem | ➕ aba **Contratos** (uma linha por ida) |
| receita_pendente / receita_enviada_em / receita_enviada_por (0223; 0 marcadas hoje) | | ❌ (tela solta Receitas) | ➕ aba **Saúde › Receitas**, com Marcar enviada / Não precisa / Desfazer / "Precisa de receita em…" |
| valor_contratado/pago/saldo, status_financeiro, condicao_pagamento | | ✅ aba Viagens / Expedições | ✅ |
| status_reserva, localizador, companhia_aerea, quarto, check-in | | ✅ aba Viagens (ExpedicoesDaFicha) | ✅ |
| created_at (quando entrou na expedição) | | ❌ | ➕ Histórico ("Entrou na expedição X") |

## 3. Saúde: `passageiros.saude` (jsonb) e a inscrição

- **Chaves de `saude`** (mesmas de `SaudePassageiro`, com o nº de linhas em 30/10):
  - problema_saude (317) e _qual (49);
  - medicamento_diario (317), _qual (172) e medicamento_refrigeracao (132);
  - alergia_medicamento (317) e _qual (52);
  - anafilaxia_emergencia (301);
  - alergia_alimentar (317) e _qual (40);
  - restricao_alimentar (317) e _qual (67);
  - limitacao_fisica (317) e _qual (9);
  - cirurgia_importante (317) e cirurgia_qual (44);
  - gravidez (301);
  - enjoo_transporte (301);
  - medo_altura (301);
  - ronca_cpap (301) e _qual (62);
  - vacina_febre_amarela (317) e _arquivo_id (129).
- **Antes:** só aparecia o resumo da ida na aba Viagens.
- **Agora:**
  - aba Saúde, card "Saúde declarada": vem do perfil da ficha ou da inscrição mais recente, dizendo de onde veio;
  - card "Histórico por viagem": o que foi declarado em cada inscrição;
  - Preencher por telefone: o questionário inteiro em Sim/Não + detalhe.
- **`inscricoes_pendentes`** (41 pendentes): `dados` jsonb (36 chaves: tudo do formulário público), `comentario_saude` e `receita_pendente` (0223).
  - ❌ **A ficha não mostra.** É inscrição ainda não aprovada.
  - A aprovação (`exp_inscricao_aprovar`) cria o passageiro e apaga a pendente. O `comentario_saude` **some na aprovação**, por desenho da 0223.
  - Decisão a confirmar: guardar o comentário de triagem no passageiro.

## 4. Laudos médicos

- A tabela `cad_laudos_medicos` **não existe no banco** em 30/10. Ela vem da migration 0225 do agente v2-saude, que não foi aplicada.
- A ficha segue o contrato `docs/CONTRATO-LAUDOS.md` do worktree `qs-turis-v2-saude`:
  - 1 laudo por passageiro (viagem), com `cliente_id`;
  - `status` a_fazer / em_andamento / emitido / dispensado;
  - `apto` sim / nao / ressalvas, mais `ressalvas` e `parecer`;
  - PDF no bucket privado `laudos-medicos`;
  - `emitido_em` e `emitido_por_nome`.
- Como a ficha mostra:
  - laudo **válido = `status = 'emitido'`**, com selo Apto / Apto com ressalvas / Não apto;
  - os outros aparecem como "em curso com o médico";
  - quem não passa em `exp_pode_ver_saude()` recebe a lista vazia;
  - sem a tabela, a seção mostra "ainda não disponível".
- ➕ Os laudos aparecem na aba Saúde › Laudos médicos, com o nome da viagem e "Abrir PDF". No Histórico entram só os emitidos.

## 5. Contratos

| Fonte | Linhas | Liga com a pessoa por | Antes | Agora |
|---|---|---|---|---|
| `qs_contratos` (ZapSign automático e manual/PDF, 0180) | **0** | `negocio_id` → `qs_closer_negocios.viagem_id` → `rel_viagens.cliente_id`; `rel_viagens.closer_negocio_id`; `lead_id` → `qs_leads.cliente_id`; CPF em `campos->>'cpf'` | ❌ (RLS: só closer/gestor) | ➕ aba Contratos via RPC **`cad_contratos_do_cliente`** (0228). Sem a 0228: aviso. |
| `qs_closer_negocios.status_contrato / contrato_enviado_em / contrato_assinado_em` | 296 (todas null) | idem | ❌ | ➕ idem (linha "Cartão do closer" quando não há envio) |
| `rel_documentos` tipo `contrato` ou nome/descrição com "contrat" | 41 | `cliente_id` | ⚠️ perdido no meio de Documentos | ➕ aba Contratos com "Abrir PDF" (link assinado, bucket `rel-documentos`) |
| `passageiros.contrato_assinado` | 14 true | `cliente_id` | ⚠️ só a próxima viagem | ➕ uma linha por ida |
| bucket `contratos` (0212) | 0 objetos | — | — | coberto por `qs_contratos.drive_pdf_url/pdf_assinado_url` |

`qs_leads.cliente_id` está **vazio em todos os leads** (0 de 5.580). Por isso a ligação lead → pessoa não acha nada hoje, e a RPC também casa pelo CPF e pela viagem.

## 6. Documentos e arquivos

| Fonte | Linhas | Antes | Agora |
|---|---|---|---|
| `rel_documentos` (bucket `rel-documentos`): passaporte, rg_cnh, visto, vacina, seguro, voucher, bilhete, contrato, comprovante, foto, outro | 9.775, todas com cliente_id | ✅ DocumentosPainel + Arquivos e fotos | ✅ (+ contratos na aba própria) |
| `arquivos` (bucket `arquivos-expedicoes`), por passageiro, nas categorias Documentos pessoais 421, Bilhetes 446, Vouchers 227, Aéreos 149, Cartão de embarque 171, Seguros 65, Hospedagem 4, Outros 540 | 2.023 | ✅ Arquivos das expedições | ✅ |
| `rel_bitrix_arquivos` (9.144: 9.106 ok, 6 erro, 32 ignorado) | 9.144 | ✅ (os ok viraram rel_documentos) | ✅ |
| `passageiro_requisitos` (2.312: Passaporte 754, Seguro 447, Aéreo Int. 454, Vacina 205…), com numero/validade quase sempre vazio | 2.312 | ✅ prontidão da próxima viagem | ✅ |
| `documentos` (visto/seguro por passageiro) | — | ⚠️ prontidão | ⚠️ |

## 7. Viagens, vendas, financeiro

| Fonte | Linhas | Antes | Agora |
|---|---|---|---|
| `rel_viagens` (1.868 / 1.846 com cliente), `rel_viagem_passageiros` (1.856) | | ✅ aba Viagens + Histórico (venda) | ✅ |
| `rel_viagens.necessidades` (306), `preferencias` jsonb (vazio) | | ✅ na tela da viagem | ⚠️ não repetido na ficha |
| `qs_venda_itens` (0) / `qs_vendas` (0) | | ❌ | ➕ Histórico ("Item de venda: …") quando houver |
| `compras_bitrix` | | ✅ aba Compras | ✅ |
| `fin_atendimentos` (42/26 com cliente), `fin_planos` (0) | | ✅ Atendimento › Status no Financeiro | ✅ |
| `qs_propostas` (6) | | ❌ | ❌ **não mostra** (fica na tela Propostas; candidato pro Histórico) |
| `rel_oportunidades` (2) | | ⚠️ pipeline do Rel | ⚠️ |
| `exp_valor_historico` (0), `passeio_opcional_compras` (89) | | ⚠️ na expedição | ⚠️ |

## 8. Atendimento e relacionamento

| Fonte | Linhas | Antes | Agora |
|---|---|---|---|
| `qs_solicitacoes` (21 / 16 com cliente) | | ✅ Atendimento + Histórico | ✅ |
| `rel_contatos` (0), `rel_chamados` (1), `rel_wa_conversas` (212/178) | | ✅ Atendimento (só Rel) | ✅ |
| `rel_bitrix_comentarios` (2.793) | | ❌ | ❌ **não mostra** (fica na viagem; volume alto) |
| `rel_notas` (0) | | ✅ Observações | ✅ |
| `rel_auditoria` (rel_clientes, cad_acompanhantes) | | ✅ Histórico | ✅ + entende mudanças do `perfil` (0228) |
| `cad_acompanhantes` (43) | | ✅ Pessoas ligadas | ✅ |
| `cad_divergencias` (107 abertas) | | ✅ FilaDivergencias | ✅ |
| `app_cliente_acessos` (0), `rel_pesquisas` (0), `rel_envios` (0), `rel_agenda` (0), `qs_disparo_envios` | | ❌ | ❌ (vazias) |

## 9. O que continua fora da ficha (e por quê)

1. **`rel_clientes.bitrix_dados`** (835 fichas): o contato inteiro do Bitrix (~90 campos).
   - Contém saúde (gravidez, anafilaxia, enjoo, CPAP, medicamento), emergência, profissão, preferência de voo e países.
   - Não entrou porque são rótulos livres do Bitrix, com valores em formato de lista/ID, e duplicam o que a inscrição já tem estruturado.
   - **Proposta:** um "Importar do Bitrix" no Preencher por telefone, que sugere e não grava sozinho. Pede ok do Bruno.
2. **`perfil_viajante`** musica / descricao_grupo / anima_expedicao / significado: texto de conexão do formulário, sem uso operacional.
3. **`inscricoes_pendentes`**: dado não aprovado. O comentário de triagem some na aprovação (ver §3).
4. **`rel_bitrix_comentarios`** e **`qs_propostas`**: candidatos ao Histórico numa próxima rodada.

---

## 10. O que foi feito (branch `v2-ficha`)

**Ficha (`src/rel/clientes/ClienteFicha.tsx` + `src/rel/clientes/ficha/`)**
- Abas novas:
  - **Contratos** (`AbaContratos.tsx`);
  - **Saúde** (`AbaSaude.tsx`): declarado, laudos, receitas e histórico por viagem;
  - **Preferências** (`AbaPreferencias.tsx`): emergência, alimentação, camiseta, profissão, Instagram, voo, países e "com quem já viajou". O botão "Usar na ficha" grava o valor da inscrição.
- **Documentos** ganhou o card **Passaportes** (`Passaportes.tsx`):
  - todo número já informado, com validade e a fonte;
  - alerta: vencido, ou vence menos de 6 meses depois da **volta** da próxima viagem.
- **Histórico** ganhou entrada em expedição, contratos, laudos, receitas enviadas, itens de venda e mudanças do perfil (`eventosDaFichaCompleta` em `fontes.ts`).
- **Preencher por telefone** (`PreencherPorTelefone.tsx`): botão no cabeçalho, na faixa de completude e no "Preencher agora".
  - Um formulário só: dados pessoais, passaporte, endereço com CEP, viagem e saúde.
  - Salva **campo a campo** ao sair do campo ou ao clicar Sim/Não. Mostra "salvando… / salvo ✓ / erro" em cada campo.
  - Indicador "Ficha X% completa · falta: …" ao vivo, com o filtro "Só o que falta".
  - Valor vindo da inscrição só vai pra ficha com "Confirmar" ou se for alterado.
- **Faixa de completude** abaixo dos indicadores: "Ficha X% completa pra próxima viagem · falta: …".
  - O que conta: nome completo, CPF, nascimento, telefone, e-mail, passaporte, validade, foto do passaporte, endereço, emergência, camiseta e questionário de saúde (`completudeProximaViagem`).
  - O StatCard "Cadastro" continua com a regra antiga (7 itens), como pede a spec de 29/10.

**Receitas**
- O item "Receitas" saiu do menu de Ops (`src/expedicoes/menu.ts`).
- O alerta **"Receitas a enviar (N)"** fica no topo das **Inscrições** (`ficha/ReceitasAEnviar.tsx`). Cada linha tem "Abrir ficha ›" pra `#ops/ficha/<id>?aba=saude` (ou `#rel/cliente/<id>?aba=saude` no Rel).
- Rota antiga `#ops/receitas` e `#rel/exp-receitas`: viram Inscrições. `…/receitas/<passageiroId>` vira a ficha da pessoa, aba Saúde (`src/expedicoes/paginas/Receitas.tsx`).
- `listarReceitas` passou a trazer `clienteId`.
- O contador `useContagensExp().receitas` continua calculado. O item de menu que o mostrava saiu.

**Migration `supabase/migrations/0228_ficha_completa.sql`** (NÃO aplicada)
- `rel_clientes.perfil jsonb`:
  - herda RLS e auditoria (`rel_audita` → `rel_auditoria`, que o Ops já lê pra `rel_clientes`);
  - **sem backfill**: o front completa com a última inscrição.
- `cad_salvar_perfil(p, p_campos)`:
  - lista branca de chaves (`cad_campos_perfil`, `cad_campos_saude`) e `cad_pode_editar`;
  - "" ou null apaga a chave;
  - leva emergência, alimentação e saúde (em **mescla**) pras idas que ainda não voltaram.
- `cad_contratos_do_cliente(p)`: security definer, leitura pra Rel/Ops/Fin/gestor.

## 11. Como conferir (revisores)

```sql
-- quantas fichas teriam algo a mostrar em cada aba nova
select count(distinct cliente_id) from passageiros where saude is not null and saude <> '{}'::jsonb;        -- Saúde declarada
select count(distinct cliente_id) from passageiros where contato_emergencia_nome is not null;                -- Preferências
select count(*) from rel_documentos where tipo = 'contrato' or arquivo_nome ilike '%contrat%' or descricao ilike '%contrat%';  -- Contratos (arquivo)
select count(*) from passageiros where contrato_assinado;                                                     -- Contratos (expedição)
select count(*) from passageiros where receita_pendente;                                                      -- Receitas
-- pessoa com passaporte diferente na ficha e numa ida (aparece 2x em Passaportes)
select c.id, c.passaporte, p.passaporte from rel_clientes c join passageiros p on p.cliente_id = c.id
 where p.passaporte is not null and c.passaporte is not null and upper(p.passaporte) <> upper(c.passaporte) limit 20;
```

## 12. Decisões a confirmar com o Bruno

1. Aplicar a 0228.
2. A propagação de saúde e emergência da ficha pras idas futuras: está ligada na 0228.
3. Onde fica o contador de receitas:
   - hoje: só dentro de Inscrições, sem número no menu;
   - alternativa: badge no item Inscrições.
4. Guardar o `comentario_saude` da triagem no passageiro na aprovação. Hoje some.
5. Ops subir PDF de contrato na ficha: hoje `rel_documentos` só aceita insert do Rel.
6. "Importar do Bitrix" (`bitrix_dados`) como sugestão no Preencher por telefone.
7. Ao juntar com o v2-saude, vai dar conflito em `src/expedicoes/menu.ts` e `src/expedicoes/paginas/Inscricoes.tsx`.
   - Lá as Inscrições viraram abas, e o item "Saúde · médico" entrou no menu.
   - Manter o item Receitas **fora** do menu.
   - Colocar `<ReceitasAEnviar />` acima das abas das Inscrições, ou na tela Saúde · médico.
