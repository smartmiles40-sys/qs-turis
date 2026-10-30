# Menu do Relacionamento — V2 (30/10/2026)

Branch `v2-relmenu`. O menu do Rel virou catálogo (`src/rel/menu.tsx`). Quem monta o menu é o `RelApp`. A prévia "o menu dela fica assim", na tela Time e cargos, usa a mesma função `montarMenuRel`.

## Antes → depois (menu completo: gestão, admin e quem não tem papel)

| Antes (29/10) | Depois (V2) |
|---|---|
| Início | **Topo:** Início, Minhas atividades |
| **Atendimento:** Conversas, Grupos @, Solicitações, Propostas, Pipeline de vendas | **Atendimento:** Conversas, Grupos @, Chamados |
| — | **Entre setores:** Solicitações, Propostas |
| **Carteira:** Viagens, Clientes, Alertas | **Pós-venda:** Viagens, Alertas, Pipeline de vendas, **Campanhas** (nova página-hub) |
| — | **Expedições:** Expedições, Pacotes, Inscrições, Avisos das expedições |
| — | **Carteira:** Clientes (com a aba "Arrumar cadastros" dentro) |
| — | **Acompanhamento:** Agenda do time, Desempenho (antes "KPIs"; só quem o cargo deixa) |
| **Supervisão:** Faxina das viagens, Modelos de mensagem, Time | **Supervisão:** Faxina das viagens, Modelos de mensagem, **Time e cargos** |
| **Mais ▸** (recolhido): Minhas atividades, Chamados, Agenda do time, Expedições, Pacotes, Inscrições, Receitas, Avisos das expedições, Disparos e remarketing, Automações, Pesquisas, Recompra, KPIs, Configurações | **O "Mais" deixou de existir.** Os itens dele foram para as linhas acima. |

O que foi para onde:
- **Campanhas** (`#rel/campanhas`): uma página com 4 cartões grandes, cada um com um número vivo:
  - Disparos e remarketing: campanhas enviando agora, mais as que estão em rascunho;
  - Automações: quantas estão ligadas;
  - Pesquisas: respostas dos últimos 90 dias, mais as que esperam resposta;
  - Recompra: viagens que voltaram de 1 a 13 meses atrás.
  Abrir uma dessas 4 telas acende "Campanhas" no menu.
- **Receitas** saiu do menu porque vai morar na ficha do cliente. A rota `#rel/exp-receitas` continua abrindo, e a bolinha de receitas saiu do menu do Rel.
- **Configurações** continua na engrenagem ao lado do nome, no rodapé. A rota `#rel/config` não mudou.
- **`#rel/mais`** (o endereço antigo do Mais) agora abre "Outros painéis". Sem menu por papel, ele mostra "Todos os painéis".
- Rotas, telas e tabelas não mudaram de nome. Só os rótulos mudaram: KPIs → Desempenho, Time → Time e cargos.

## Menu por papel (0229)

- O mapa papel → itens mora em `qs_menu_papel`. A chave que liga e desliga o filtro do setor mora em `qs_menu_setor.por_papel`, que **nasce desligada**.
- O padrão fica no código, em `MENU_PADRAO` (`src/rel/equipe/menuPorPapel.ts`). Um papel sem linha no banco usa o padrão.
- Todo mundo vê sempre: Início, Minhas atividades, Solicitações e Agenda do time.
- Padrão de cada papel:
  - **CX:** Conversas, Grupos, Clientes, Viagens, Alertas.
  - **CS:** Conversas, Chamados, Clientes, Viagens, Pesquisas.
  - **Hunter:** Conversas, Clientes, Propostas, Pipeline de vendas, Campanhas, Recompra.
- Quem tem dois papéis vê a soma dos dois.
- Gestor, admin e quem não tem papel veem o menu completo.
- Com o filtro ligado, o que ficou de fora vai para **"Outros painéis"**, no fim do menu. Os links também continuam abrindo, então ninguém perde acesso (regra 3 da spec).
- O front aguenta a 0229 não aplicada: se a leitura falhar, mostra o menu completo. A aba "Menus por papel" fica só leitura e avisa que falta a migration.

## Tela Time e cargos (`#rel/equipe`)

Por pessoa:
- **cargo** e **papel**: os chips CX/CS/Hunter da 0222;
- **Solicitações que chegam pra ela**: os tipos ligados ao papel. Segue a mesma regra do rodízio da 0222: papel sem ninguém cai na gestão, e tipo sem papel vai para o setor todo;
- **"O menu dela fica assim"**: a prévia, que diz se já está valendo ou se ainda é só prévia.

A aba nova **Menus por papel** tem:
- a chave Ligar/Desligar;
- as caixas de marcar de cada papel, com "Salvar" e "Voltar ao padrão".

O Financeiro e Operações usam a mesma tela, sem as partes novas.
