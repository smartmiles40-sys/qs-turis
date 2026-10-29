# QS Turis · Redesign de Expedições

Spec de implementação para o Claude Code. Referências visuais: `ref-expedicoes.dc.html` (central) e `ref-expedicao.dc.html` (cockpit da expedição). São HTML com estilos inline, use para layout, hierarquia e comportamento, não para copiar código.

Esta spec complementa `qs-redesign-ficha-solicitacoes.md`. **Tokens de cor, tema claro e noite e componentes compartilhados (StatCard, StatusChip, SegmentedControl, FilterPill, Timeline etc.) são os mesmos de lá.** Se aquela etapa já foi implementada, reaproveite. Se não, implemente a seção 1 e 2 daquela spec primeiro.

## 0. Antes de começar

1. Mapeie as rotas atuais de Expedições (lista e detalhe) e todas as abas do detalhe: Visão Geral, Passageiros, Valores, Rooming, Checklist, Documentos, Links, Divisões, ExpedAmigo, Roteiro do Líder.
2. Para cada aba, liste a origem dos dados (tabelas, queries, hooks) e as ações que ela permite. Me mostre esse mapa antes de codar.
3. **Nenhuma ação existente pode sumir.** O redesign reorganiza, não remove. Onde uma aba for absorvida por outra, as ações vão junto.
4. Não altere schema nesta tarefa, exceto onde marcado **[SCHEMA]**. Nesses casos proponha a migration e pare para eu aprovar.
5. Branch `feat/redesign-expedicoes`, commits pequenos por etapa (seção 6).

## 1. Conceito central: fase da expedição

Toda a tela muda conforme a fase. Crie uma função pura e testada:

```ts
type Fase = 'vendendo' | 'preparacao' | 'embarque' | 'em_viagem' | 'concluida'

function getFase(inicio: Date, fim: Date, hoje: Date): Fase
// concluida    -> hoje > fim
// em_viagem    -> inicio <= hoje <= fim
// embarque     -> faltam 1 a 30 dias para o início
// preparacao   -> faltam 31 a 120 dias
// vendendo     -> faltam mais de 120 dias
```

- Datas comparadas em `America/Sao_Paulo`, só a parte de data.
- Os limites 30 e 120 ficam numa constante de configuração, não espalhados no código.
- Se hoje existir um campo de status manual (Vendas Abertas, Em andamento, Concluída), mantenha, mas a **fase calculada** é o que dirige o visual. Se os dois divergirem, mostrar um aviso discreto no cockpit.

Cores das fases (usar tokens do tema):

| Fase | Cor |
|---|---|
| Em viagem | `--primary` (preto no claro) |
| Embarque em até 30 dias | amber `#D97706` |
| Preparação | azul `#2563EB` |
| Vendas abertas | cinza `#71717A` |
| Concluída | verde `#067647` |

## 2. Central de Expedições (`/expedicoes`)

Referência: `ref-expedicoes.dc.html`.

### 2.1 Cabeçalho e indicadores
- Título, total de expedições e data de hoje. Botões `Exportar` e `Nova expedição`.
- 5 `StatCard`: **Em viagem** (nº e passageiros fora do Brasil), **Embarcam em 30 dias** (nº e "x de y aptos"), **Vendas abertas** (nº e "vendidas de total de vagas", somando preparação e vendendo), **Vagas para vender**, **Concluídas** (12 meses). Cada card com ponto na cor da fase.

### 2.2 "Precisa de atenção"
Card logo abaixo dos indicadores, com contador de itens não informativos. Gerado por regras, ordenado por severidade e depois por data. Cada item: tag (Crítico, Atenção, Info), título, subtítulo e um link que leva para a aba certa do cockpit.

Regras iniciais (centralize num arquivo `lib/expedicoes/alertas.ts`):

| Regra | Severidade |
|---|---|
| Fase `embarque` e aptos < 50% | Crítico |
| Fase `preparacao` e aptos < 20% faltando menos de 60 dias | Atenção |
| Ação do Roteiro do Líder com status Crítico nos próximos 3 dias | Atenção |
| Ação do Roteiro do Líder de dia já passado sem baixa | Atenção |
| Em viagem ou embarque com passageiros sem valor lançado | Atenção |
| Em viagem ou embarque com seguro sem apólice | Atenção |
| Vendendo com ocupação < 30% faltando menos de 365 dias | Info |

Agrupar alertas iguais de expedições irmãs (ex.: "Tailândia G1 e G2 embarcam em 15 dias com 0 de 44 aptos").

### 2.3 Barra de controles
- `SegmentedControl`: **Por fase** (padrão), **Linha do tempo**, **Tabela**.
- Busca por código, nome ou destino. Filtros de Destino e Responsável operacional.
- Visualização, busca e filtros vão para a URL.

### 2.4 Visão "Por fase"
- Uma seção por fase, na ordem: Em viagem, Embarque em até 30 dias, Preparação, Vendas abertas, Concluídas. Seção vazia não aparece.
- Cabeçalho da seção clicável para recolher/expandir, com ponto da cor, título, contador e dica. **Concluídas começa recolhida.** Estado de recolhido persiste em `localStorage`.
- Cada expedição é **uma linha** (não card), em grid com colunas:
  1. Nome, chip do grupo (G1, G2...) e código em monoespaçada.
  2. Datas.
  3. Saída: chip "em Nd" (amber se fase embarque), "Dia X de Y" (preto se em viagem) ou "Voltou" (verde).
  4. Ocupação: "pax/cap" com barra.
  5. Métrica da fase, com título de coluna que muda por seção:
     - Em viagem: "Volta em N dias" com barra de progresso da viagem.
     - Embarque e Preparação: "x de y aptos" com barra (vermelha se embarque e < 50%).
     - Vendendo: "N vagas" ou "esgotada", sem barra.
     - Concluída: quantos embarcaram, sem barra.
  6. Alertas: chip vermelho com a contagem ou "Em dia".
- A linha inteira é link para o cockpit. Dentro da seção, ordenar por data de início.
- **Grupos de uma mesma expedição** (G1, G2, G3...) aparecem como linhas separadas, mas com o mesmo nome base e o chip de grupo. Use o nome sem o sufixo de grupo no título.

### 2.5 Visão "Linha do tempo"
- Gantt com coluna fixa de nomes (280px) e eixo de meses do mês atual até o fim do ano seguinte.
- Uma linha por expedição não concluída, barra posicionada pelas datas e colorida pela fase. Linha vertical vermelha em hoje. Legenda das fases no topo.
- Scroll horizontal interno. Linha clicável para o cockpit.
- Opcional (TODO, não agora): agrupar por destino e marcar sobreposição de líderes.

### 2.6 Visão "Tabela"
Expedição, Código, Datas, Fase (chip), Pax, Aptos. Ordenável por coluna.

## 3. Cockpit da Expedição (`/expedicoes/[id]`)

Referência: `ref-expedicao.dc.html`.

### 3.1 Cabeçalho
- Link de volta para Expedições.
- Nome base, chip do grupo e chip de status da fase (ex.: "Em viagem · Dia 4 de 18" em preto, "Embarca em 15 dias" em amber).
- Linha de metadados: código, destinos, datas, líderes.
- Botões `Portal do líder` e `Editar`.
- **Barra de fases**: 5 segmentos (Vendas, Preparação, Embarque, Em viagem, Pós-viagem). Concluídas em preto, atual em accent, futuras em cinza.
- **Remover** o degradê laranja e os três anéis de Ocupação, Checklist e Prontidão do topo. Essas métricas vão para o bloco "Saúde" da Visão geral.

### 3.2 Abas (de 10 para 6)

| Nova aba | Absorve | Badge |
|---|---|---|
| Visão geral | Visão Geral | — |
| Passageiros | Passageiros, status de documentos por passageiro, formulário | nº de pendências (amber) |
| Logística | Rooming, Roteiro do Líder, Divisões, Checklist | — |
| Financeiro | Valores | "!" vermelho se houver passageiro sem valor |
| Arquivos | Documentos (Drive), Links | nº de arquivos |
| Portal | ExpedAmigo, Documentos da área do líder | — |

A aba ativa vai para a URL (`?aba=logistica`). Mantenha redirects das abas antigas (`?aba=rooming` abre Logística na seção de rooming).

### 3.3 Visão geral

O conteúdo **muda por fase**.

**Em viagem**
- Card **Hoje** (fundo `--primary`, texto invertido): "Hoje · dia da semana, data · Dia N", cidade e fuso em relação a Brasília, título do dia vindo do roteiro e três mini cards (hotel atual com data de check-out, tamanho do grupo separando pagantes e líderes, líderes em campo).
- Card **Próximos dias**: os 2 próximos dias do roteiro, com tag de severidade quando houver ação. Botão "Roteiro completo" abre Logística.

**Embarque e Preparação**
- No lugar do card Hoje: card **Contagem para o embarque** com dias restantes, % de aptos e as 3 maiores pendências agregadas (ex.: "18 sem seguro", "7 sem formulário"), com botão "Cobrar todos".

**Vendendo**
- Card **Vendas**: ocupação, vagas, ritmo de vendas dos últimos 30 dias se o dado existir.

**Comum a todas as fases**
- **A viagem inteira**: faixa com uma coluna por dia (D1, data), o dia de hoje destacado em accent e dias passados apagados. Abaixo, os hotéis desenhados como barras que ocupam as colunas da estadia (check-in até check-out), alternando em duas linhas para não sobrepor. Trechos sem hotel (em voo) também aparecem. Texto à direita do título: "N dias · N hotéis · x/y alocados".
- **Saúde da expedição**: 4 cards clicáveis que levam à aba certa.
  - Ocupação (pax/cap, "líderes não contam").
  - Seguro viagem (apólices anexadas/total).
  - Financeiro (valor vendido e quantos sem valor).
  - Checklist (concluídas/total e %).
  Cada um com tag OK, Pendente, Atrasado ou Sem dados.
- **Ações da operação**: lista as ações do Roteiro do Líder (campo "Ação" hoje dentro do dia) que estão abertas. Cada item: tag (Crítico, Atenção, Sem baixa para dia já passado), "Dia N · data · título", descrição, setor responsável, botão `Dar baixa`. **[SCHEMA]** se a ação não tiver campo de status/baixa hoje, proponha (`resolvida_em`, `resolvida_por`).

### 3.4 Passageiros (matriz única)
- Barra superior: filtros em pills com contagem (Todos, Com pendência, Formulário pendente, Líderes) e ações em lote (`Cobrar formulário (N)`, `Cobrar apólice de seguro (N)`). As ações em lote reaproveitam o disparo de mensagem que já existir. Se não existir, só deixe o botão preparado com TODO.
- Tabela com uma linha por passageiro: avatar com iniciais, nome, tipo (Líder ou Pagante) e "Nª expedição".
- Colunas de requisito, cada célula um chip com tom: **Passaporte** (válido + mês/ano, vermelho se vencer menos de 6 meses após a volta), **Visto**, **Seguro**, **Formulário**, **Quarto**, **Pagamento** (líder aparece como "Isento").
- **No cabeçalho de cada coluna, o placar** daquela coluna (ex.: "0/25", "18/25"), colorido pelo tom.
- Clicar no passageiro abre a ficha do cliente (a mesma da outra spec).
- Mantém as ações atuais (Importar, Adicionar existente, Adicionar) no topo da aba.
- Os líderes continuam separados na contagem de ocupação, mas na matriz ficam juntos, primeiro, com o chip Líder.

### 3.5 Logística
- **Hospedagem e rooming**: uma linha por hotel (cidade, nome, datas, nº de quartos, chip "x/y alocados"). Botões `Exportar Excel` e `Abrir rooming`, que abre o editor atual de quartos com drag and drop (manter como está, só ajustar ao tema). Chips de "duplas que viajam juntas" e "acompanhantes indicados".
- **Roteiro do líder**: lista de dias com bloco DIA N, título, meta (data, cidade, nº pax, líderes) e tag (OK, Verificar, Atenção, Crítico, Hoje). Dia de hoje com fundo accent suave. Manter edição, reordenação e exclusão atuais.
- **Divisões** e **Checklist**: mover para esta aba como seções recolhíveis, mantendo o comportamento atual.

### 3.6 Financeiro
- Se houver passageiro sem valor, banner amber no topo: "Nenhum dos N passageiros tem valor lançado" com botão `Definir preço padrão` (aplica o preço de referência a todos, depois ajusta exceções).
- 4 `StatCard`: Vendido, Recebido, A receber, Preço por pessoa (com e sem aéreo).
- Abaixo, a tabela atual de Valores com os filtros atuais (Sem valor, Em aberto, Parcial, Quitado), ajustada ao tema.

### 3.7 Arquivos
- Grade de pastas por categoria (Aéreos, Documentos pessoais, Contrato, Bilhetes, Vistos, Seguros, Hospedagem, Vouchers, Cartão de embarque, Outros) com contagem. Pasta vazia com borda tracejada.
- Se mais de 50% dos arquivos estiverem em "Outros", banner amber sugerindo classificar.
- Abaixo, a lista atual de arquivos com busca, upload e ações. Links da aba antiga entram aqui como uma seção.

### 3.8 Portal
- Lista de itens de configuração do portal com tag de status e ação:
  - Acesso dos passageiros (botão "Liberar portal para todos" no topo da aba).
  - Roteiro dia a dia.
  - Documentos do líder.
  - Voucher da hospedagem.
  - Extensões da viagem.
- Cada item abre o editor que já existe hoje.

## 4. Correções de lógica encontradas

1. **Checklist inconsistente**: o topo mostra "78% concluído" e o Resumo mostra "18/74 concluídos" (24%). Encontre os dois cálculos, unifique numa função só e use em todos os lugares.
2. **Prontidão depois do embarque**: hoje uma expedição em viagem mostra "0/25 aptos, 25 bloqueados". Em `em_viagem` e `concluida`, a prontidão não deve gerar alerta nem aparecer como bloqueio. Mostre só o que ficou pendente de documento (ex.: apólice), como pendência administrativa.
3. **Nomes com sufixo de grupo**: padronize a extração de nome base e grupo ("Japão & China - 2026 (Out/Nov) — G1" vira nome base + chip G1). Crie `parseExpedicaoNome(raw)` com testes cobrindo os formatos que aparecem (" - G1", " — G1", " G1", "G1 - 2027").

## 5. Critérios de aceite

- [ ] Nenhuma ação das 10 abas antigas foi perdida.
- [ ] `getFase`, `parseExpedicaoNome` e as regras de alerta têm testes unitários.
- [ ] Central abre em "Por fase", com Concluídas recolhida, e alterna para Linha do tempo e Tabela.
- [ ] Alertas agrupam expedições irmãs e levam para a aba certa do cockpit.
- [ ] Cockpit muda o bloco principal conforme a fase.
- [ ] Faixa "A viagem inteira" desenha hotéis pelas datas reais de check-in e check-out.
- [ ] Matriz de passageiros mostra o placar por coluna e os filtros funcionam.
- [ ] Links antigos de aba (`?aba=rooming`, `?aba=valores` etc.) continuam funcionando.
- [ ] Modo claro e noite, sem cor fixa fora dos tokens. Sem degradê laranja.
- [ ] Funciona em 390px sem scroll horizontal na página, exceto dentro de tabela, Gantt e faixa da viagem.
- [ ] `tsc` e lint passam.

## 6. Ordem sugerida de commits

1. `getFase`, `parseExpedicaoNome`, regras de alerta e testes.
2. Central: cabeçalho, indicadores e "Precisa de atenção".
3. Central: visão Por fase.
4. Central: Linha do tempo e Tabela.
5. Cockpit: cabeçalho, barra de fases e nova estrutura de abas com redirects.
6. Cockpit: Visão geral (blocos por fase, viagem inteira, saúde, ações).
7. Cockpit: Passageiros em matriz.
8. Cockpit: Logística, Financeiro, Arquivos e Portal.
9. Correções da seção 4.
10. Propostas de migration [SCHEMA], sem aplicar.

Ao terminar cada etapa, me mostre o que mudou e o que ficou pendente.
