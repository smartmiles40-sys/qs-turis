# Roteiro de validação: Expedições no QS × sistema atual

Escrito em 06/11/2026 para o time do Operacional.

**Objetivo:** confirmar, tela por tela, que o QS mostra **exatamente** o que o sistema atual mostra, antes de o QS virar o sistema oficial.

## Como funciona agora

- O **sistema atual** (sistema-expedicoes) continua sendo o oficial: **é nele que se edita**.
- O **QS** recebe uma cópia a cada **5 minutos** e fica em **"Em validação"**: dá para olhar tudo, mas não dá para editar. A faixa amarela no topo mostra a hora da última cópia.
- Se você mudou algo no sistema atual e não apareceu no QS, espere 5 minutos e recarregue a página. Se depois de 10 minutos ainda estiver diferente, **anote no formulário de divergência** (abaixo).

## Onde fica cada coisa

| O quê | Sistema atual | QS (Operações → Expedições → abrir a expedição) |
|---|---|---|
| Lista de expedições | `/expedicoes` | menu **Expedições** (as de pacote ficam em **Pacotes**) |
| Dados gerais (datas, status, pax planejados, responsáveis) | detalhe da expedição (cabeçalho) | aba **Visão geral** |
| Passageiros (lista, status da reserva, tipo, contatos) | aba **Passageiros** | aba **Passageiros** |
| Prontidão (passaporte, visto, seguro, contrato…) | coluna **Prontidão** da aba Passageiros (gaveta do passageiro) | aba **Passageiros** → clicar no passageiro → seção Prontidão |
| Quartos / rooming | aba **Rooming** | aba **Logística** → seção **Rooming** |
| Divisão G1/G2 (grupos) | aba Passageiros (coluna Grupo) | aba **Logística** → seção **Divisões** |
| Roteiro do líder | aba **Roteiro do Líder** | aba **Logística** → seção **Roteiro** |
| Roteiro dia a dia, voos de grupo, passeios, informações do destino, avisos, voucher da hospedagem, extensões | aba **ExpedAmigo** (editor do portal) | aba **ExpedAmigo** |
| Checklist (processos por fase) | aba **Checklist** | aba **Checklist** |
| Arquivos (documentos, vouchers, fotos) | aba **Documentos** / Drive do passageiro | aba **Arquivos** → **Drive** |
| Links úteis | aba ExpedAmigo → Links | aba **Arquivos** → **Links** |
| Custos e pagamentos a fornecedor | abas **Custos** / **Pagamentos** | aba **Financeiro** |
| Inscrições (fila e recusadas) | `/inscricoes` | menu **Inscrições** |
| Novas vendas | `/novas-vendas` | menu **Novas vendas** |
| Acessos ao portal (registro, link de acesso, masters) | `/acessos-expedamigo` | ficha do cliente → **Acessos ExpedAmigo** (aba **Masters do portal** dentro dela) |
| Usuários e papéis | `/configuracoes` | grupo **Time** → **Usuários (Expedições)** |
| Fornecedores | `/fornecedores` | menu **Fornecedores** |

> Custos e Pagamentos estão **vazios nos dois sistemas** hoje (0 linhas). Basta conferir que a aba abre sem erro.

## Expedições para validar (embarque próximo)

Use estas três. Os números abaixo são do QS em 06/11 às 21h e devem bater com o sistema atual.

| Código | Embarque → retorno | Pax ativos | Quartos / alocações | Voos | Dias de roteiro | Checklist (concluídos) | Arquivos |
|---|---|---|---|---|---|---|---|
| **TAI-G1-2026-11** (Tailândia G1) | 13/11 → 28/11 | 21 (2 líderes) | 44 / 84, 4 hotéis | 7 | 16 (+6 do roteiro do líder) | 74 (66) | 108 |
| **TAI-G3-2026-11** (Tailândia G3) | 17/11 → 02/12 | 22 (2 líderes) | 44 / 96, 4 hotéis | 7 | 16 | 74 (0) | 111 |
| **PAC-TAI-GABI** (pacote Tailândia, 2 pax) | 12/11 → 27/11 | 2 | — | 3 | 16 | — | 15 |

Outras com embarque próximo, se sobrar tempo: TAI-G2-2026-11 (13/11), TAI-G3/G4-2026-11 (17/11), PAC-JAP-LUADEMEL (16/11), PAC-ASIA-MARINA (18/11).

## Checklist por tela

Para cada expedição, abra o sistema atual numa aba e o QS na outra. Marque ✅ ou anote a diferença.

### 1. Visão geral
- [ ] Nome, código, destino, status, datas de embarque e retorno iguais.
- [ ] Pax planejados, cortesias e responsáveis (operacional/comercial) iguais.
- [ ] Contagem de passageiros ativos igual (TAI-G1 = 21, TAI-G3 = 22, PAC-TAI-GABI = 2).

### 2. Passageiros
- [ ] Mesma quantidade de linhas e os mesmos nomes (confira os 3 primeiros e os 3 últimos em ordem alfabética).
- [ ] Para **2 passageiros**: CPF, telefone, e-mail, data de nascimento, passaporte e validade, status da reserva, tipo (Pagante/Líder/Cortesia).
- [ ] Contato de emergência, restrições alimentares e condições médicas dos mesmos 2.
- [ ] Prontidão (Apto/Atenção/Bloqueado) igual para os mesmos 2, item por item (passaporte, visto, seguro, contrato…).
- [ ] Foto e anexo do passaporte aparecem (abrir o arquivo nos dois).
- [ ] Quem está **liberado no ExpedAmigo**: TAI-G1 21, TAI-G3 22, PAC-TAI-GABI 2.

### 3. Quartos / rooming
- [ ] Mesmos hotéis (4 nas Tailândias), mesmas datas de check-in/check-out por hotel.
- [ ] Mesmo número de quartos e mesmo tipo (Single/Duplo/Twin…).
- [ ] Para **1 hotel**: quem está em cada quarto, igual.
- [ ] "Viajam juntas" (casais/família) no mesmo quarto nos dois.

### 4. Voos
- [ ] Mesma quantidade de voos (TAI-G1 7, TAI-G3 7, PAC-TAI-GABI 3).
- [ ] Para cada voo: trecho, companhia, número, origem/destino, partida/chegada, localizador.
- [ ] Voo de grupo × voo individual: o voucher de voo **de grupo** existe no editor, mas não aparece para o viajante (regra de 05/11).

### 5. Roteiro
- [ ] Mesmos 16 dias, na mesma ordem, com título, cidade, hospedagem e refeições.
- [ ] Fotos do roteiro aparecem nos mesmos dias (TAI-G1 e TAI-G3 têm 16 fotos cada).
- [ ] Roteiro do líder (TAI-G1: 6 dias) igual, com os alertas.
- [ ] Informações do destino (11 blocos nas Tailândias, 4 no pacote) e avisos (7 nas Tailândias).
- [ ] Passeios (pacote: 7) com voucher anexado, quando houver.

### 6. Checklist
- [ ] Mesmos 74 itens por fase (TAI-G1 e TAI-G3).
- [ ] Mesmo status de cada item (TAI-G1: 66 concluídos; TAI-G3: 0).
- [ ] Prazo e responsável de 3 itens quaisquer iguais.

### 7. Documentos e arquivos
- [ ] Mesma quantidade de arquivos da expedição (TAI-G1 108, TAI-G3 111, PAC-TAI-GABI 15).
- [ ] Abrir 3 arquivos de categorias diferentes (passaporte, voucher, contrato) nos dois. O arquivo tem que abrir no QS.
- [ ] Documentos do líder (Área do Líder) aparecem.

### 8. Custos e pagamentos
- [ ] A aba Financeiro abre sem erro (hoje vazio nos dois sistemas).

### 9. Inscrições
- [ ] Fila de pendentes com a mesma quantidade (hoje: 0 nos dois).
- [ ] Recusadas: mesma lista e o mesmo motivo.
- [ ] Histórico de decisões (só admin): TAI-G1 30 e TAI-G3 37 decisões.

### 10. Portal e links (ExpedAmigo)
- [ ] Na aba ExpedAmigo, o conteúdo é o mesmo do editor do portal no sistema atual (roteiro, voos, passeios, info, avisos, voucher da hospedagem).
- [ ] Links úteis iguais (as 3 de exemplo não têm nenhum link: confira que as duas telas mostram vazio).
- [ ] Acessos ExpedAmigo: no registro de acessos, os últimos logins de hoje aparecem nos dois.
- [ ] Masters do portal: a lista do QS (11 pessoas) é igual à do sistema atual.
- [ ] **Não gere link nem libere acesso pelo QS.** Em validação, esses botões ficam desligados de propósito: o portal ainda lê o sistema atual.

## Formulário de divergência

Para cada diferença, anote:

1. Código da expedição.
2. Tela e seção.
3. O que aparece no sistema atual e o que aparece no QS.
4. Hora em que você olhou. A faixa amarela mostra "atualizado há X min": anote esse valor também.

Mande para o Bruno. Quem não tiver login no QS: Carolina, Larissa, Glaucia e contato@ já têm login desde 06/11. Peça ao Bruno a senha, que ele gera na tela **Usuários (Expedições)** em **Resetar senha**.
