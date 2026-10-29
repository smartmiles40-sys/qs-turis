# QS Turis · Redesign da Ficha do Cliente e de Solicitações

Spec de implementação para o Claude Code. Os mockups de referência estão nos arquivos `ref-ficha-cliente.dc.html` e `ref-solicitacoes.dc.html` (HTML com estilos inline; use como referência visual de layout, espaçamento e hierarquia, não como código para copiar).

## 0. Antes de começar

1. Leia a estrutura do projeto e identifique: as rotas atuais da Ficha do Cliente (`/clientes/[id]` ou equivalente) e de Solicitações, os componentes de UI existentes (shadcn/ui, se houver), o tema/tokens de cor e a camada de dados (queries, hooks, tipos).
2. **Reaproveite** componentes e queries existentes. Não crie uma segunda fonte de dados nem duplique tipos.
3. Não altere schema do banco nesta tarefa, exceto onde estiver marcado como **[SCHEMA]**. Nesses casos, proponha a migration e pare para eu aprovar antes de aplicar.
4. Trabalhe numa branch `feat/redesign-ficha-solicitacoes` e faça commits pequenos por etapa (ver seção 6).

## 1. Direção visual

- CRM neutro, preto e branco. Cor só para **status e alertas**, nunca decorativa.
- Precisa funcionar em **modo claro e modo noite**. Todos os tokens abaixo existem nos dois temas.
- Fonte Inter. Cards com borda de 1px, sem sombra (sombra só em modal e dropdown).
- Raio: card 16px, botão 10px, chip 6px, pill 999px.
- Alvo de toque mínimo de 44px em botões primários e secundários.
- Contraste mínimo de 4.5:1 em todo texto, inclusive labels cinzas pequenos.

### Tokens

| Token | Claro | Noite | Uso |
|---|---|---|---|
| `--bg` | `#F6F6F3` | `#0F0F11` | fundo da página |
| `--surface` | `#FFFFFF` | `#18181B` | cards |
| `--surface-muted` | `#F8F8F6` | `#1F1F23` | blocos internos, coluna do kanban |
| `--border` | `#E7E5E0` | `#2A2A30` | bordas |
| `--border-strong` | `#DAD8D2` | `#3A3A42` | borda de botão secundário e input |
| `--text` | `#18181B` | `#F4F4F5` | texto principal |
| `--text-muted` | `#5B5B63` | `#A1A1AA` | labels, metadados |
| `--primary` | `#18181B` | `#F4F4F5` | botão primário (texto invertido) |
| `--accent` | `#0F766E` | `#2DD4BF` | ação positiva principal, links |
| `--warn-bg` / `--warn-fg` | `#FEF3C7` / `#92400E` | `#3A2A0A` / `#FCD34D` | faltando, vence hoje |
| `--danger-bg` / `--danger-fg` | `#FEE4E2` / `#B42318` | `#3B1514` / `#FCA5A5` | atrasada, urgente |
| `--ok-bg` / `--ok-fg` | `#DCFAE6` / `#067647` | `#0F2E1D` / `#6EE7B7` | concluída, preenchido |

Cores de setor (só em ponto e chip):

| Setor | Ponto | Chip bg / fg claro |
|---|---|---|
| Comercial | `#2563EB` | `#E8EFFE` / `#1D4ED8` |
| Financeiro | `#4F46E5` | `#ECEBFE` / `#4338CA` |
| Operações | `#C2410C` | `#FFEDE3` / `#9A3412` |
| Relacionamento | `#0F766E` | `#E3F1EF` / `#0F766E` |

Se o projeto já tem um sistema de tema (CSS variables do shadcn, `next-themes` etc.), mapeie esses tokens nele em vez de criar outro.

## 2. Componentes compartilhados

Crie (ou adapte os existentes) em `components/qs/`:

- `StatCard` com label, valor grande e subtítulo; aceita `tone` (default, warn, ok).
- `StatusChip` com `tone` (warn, danger, ok, neutral) e variante `sector`.
- `SectorDot` e `SectorChip` recebendo o setor e resolvendo cor pela tabela acima.
- `Avatar` com iniciais. **Bug atual:** as iniciais saem como "[(" porque o nome vem com prefixo "[V4] (STFV)". Crie `parseClientName(raw)` que retorna `{ name, tags }`, extraindo os trechos entre colchetes e parênteses do início como tags (`["V4", "STFV"]`) e o resto como nome. Use em todo lugar que mostra nome de cliente.
- `SegmentedControl` (abas tipo "Quadro | Lista | Prazos").
- `FilterPill` com contador opcional.
- `Timeline` vertical com ponto colorido, data, título e subtítulo.
- `ChecklistItem` com estado preenchido ou faltando e ação opcional ("Pedir").

## 3. Ficha do Cliente

Referência: `ref-ficha-cliente.dc.html`.

### Layout

Container `max-w-[1280px]`. Abaixo do cabeçalho e dos indicadores, duas colunas: conteúdo principal (flexível, mínimo 640px) e lateral (320px). No mobile, a lateral desce para baixo do conteúdo.

### Blocos, de cima para baixo

1. **Breadcrumb** "Clientes / Nome".
2. **Cabeçalho**
   - Avatar com iniciais, nome limpo (via `parseClientName`) e as tags como chips cinzas ao lado.
   - Linha de chips: nível (Bronze, com ponto), clube e número de viagens, "Lead desde dd/mm/aaaa".
   - Linha de alertas (`warn`): "Sem consentimento LGPD", "Nunca teve contato". Só aparecem se a condição for verdadeira.
   - Ações à direita: `WhatsApp` (secundário), `Pedir a outro setor` (secundário), `Registrar contato` (primário) e `Mais ações` (dropdown).
   - Dropdown "Mais ações" agrupado: **Vendas** (Nova oportunidade de venda, Subir venda), **Financeiro** (Pedir pagamento, Enviar ao Financeiro), **Atendimento** (Abrir chamado), **Cadastro** (Editar ficha). Todas as ações que hoje existem na ficha precisam continuar acessíveis.
3. **Indicadores** (grid responsivo de `StatCard`): LTV e nº de compras, Próximo embarque e expedição, Cadastro % (tom warn se < 100), Solicitações abertas, Último contato (tom warn se nunca).
4. **"Pronta para embarcar?"**
   - Anel de progresso com o % do cadastro (mesma regra de cálculo que existe hoje).
   - Dois grupos de checklist: **Cadastro** (CPF, Telefone, E-mail, Nascimento, Nº do passaporte, Validade do passaporte, Foto do passaporte) e **Contrato e embarque** (Endereço, Consentimento LGPD). Cada grupo mostra "x de y".
   - Item preenchido mostra o valor resumido (CPF mascarado). Item faltando mostra uma dica curta e botão "Pedir".
   - Botões do bloco: `Preencher agora` (abre edição) e `Pedir tudo à cliente`.
   - **"Pedir" e "Pedir tudo" criam uma Solicitação** para Relacionamento, já vinculada a esta cliente, do tipo "Falar com o cliente", com título gerado ("Solicitar endereço da passageira" etc.). Reaproveite a função que cria solicitação hoje.
5. **Abas** em pills: Visão geral, Viagens (contador), Compras (contador), Documentos (contador de faltantes em warn), ExpedAmigo, Atendimento, Histórico. A aba ativa vai para a URL (`?aba=documentos`) para poder compartilhar link.
6. **Aba Visão geral**
   - Card **Documentos**: CPF mascarado com botão Mostrar/Ocultar, Nascimento, Passaporte e Validade (chip "Faltando" quando vazio), e área de upload da foto do passaporte.
   - Card **Endereço**: em modo leitura por padrão. Se vazio, mostra texto explicativo e botões `Adicionar endereço` e `Pedir à cliente`. O formulário (CEP, Rua, Número, Complemento, Bairro, Cidade, UF) só abre ao clicar. CEP preenche rua, bairro, cidade e UF automaticamente (manter a integração atual, ou ViaCEP se não houver).
   - Card **Viagem**: nome da expedição, grupo, datas e uma trilha de etapas (Venda, Contrato, Pagamento, Documentos, Embarque) com tom por status.
   - Card **Linha do tempo** com os 4 eventos mais recentes e link "Histórico completo" que troca para a aba Histórico.
7. **Demais abas**: Viagens (card da viagem com status de Contrato, Pagamento, Documentos, Aéreo, Seguro, Grupo de WhatsApp), Documentos (grade de slots, faltantes com borda tracejada), Compras (tabela), ExpedAmigo e Atendimento (estado vazio com CTA quando não houver dados), Histórico (timeline completa).
8. **Lateral**
   - **Contato**: telefone com botões de WhatsApp e ligar, e-mail, link para o contato no Bitrix.
   - **Pessoas ligadas**: **unifica** os blocos atuais "Família" e "Quem viaja junto", que hoje estão duplicados. Cada pessoa tem relação (cônjuge, filho, amigo etc.) e um marcador "viaja junto" por viagem. **[SCHEMA]** se hoje forem duas tabelas ou dois campos, proponha a unificação.
   - **Origem**: de onde o lead veio, data, canal, responsável. Mostrar alerta (`warn`) quando o lead estiver como "perdido" no Comercial mas existir venda para o cliente.
   - **LGPD**: status do consentimento e botão `Enviar termo para aceite`.
   - **Observações**: lista e campo para nova observação.

## 4. Solicitações

Referência: `ref-solicitacoes.dc.html`.

### Estrutura

1. **Cabeçalho**: título, subtítulo com o setor atual do usuário (ponto colorido), botões `Tipos e prazos` e `Pedir a outro setor`.
2. **Indicadores**: Abertas, Vencem hoje (warn), Atrasadas, Sem dono, Concluídas nos últimos 14 dias (ok). Todos calculados para o setor atual.
3. **Barra de controles** num único card:
   - Escopo (SegmentedControl): Recebidas, Pedidas por nós, Histórico.
   - Busca por cliente, viagem ou número.
   - Visualização (SegmentedControl): Quadro, Lista, Prazos.
   - Linha de filtros: Setor de origem (Todos, Comercial, Financeiro, Operações, com contador de abertas) e Dono (Todas, Comigo, Sem dono).
   - Escopo, visualização e filtros vão para a URL (query params).
4. **Visão Quadro**: 4 colunas (Novas, Aguardando ajustes, Em andamento, Concluídas), com scroll horizontal no mobile. Coluna vazia mostra um bloco tracejado pequeno "Nada por aqui".
   - **Card**: número, chip do setor, tipo, chip "Urgente" (só se aberta), título, avatar e nome da cliente com a viagem, rodapé com chip de prazo e "Responsável · de Quem pediu".
   - Sem cliente vinculado: no lugar da cliente mostra "Sem cliente vinculado" em warn.
   - Card concluído com título em `--text-muted`.
5. **Visão Lista**: tabela com Pedido (número, tipo e título), Cliente · viagem, Setor, Prazo, Dono, Status. Clicar no pedido abre o detalhe.
6. **Visão Prazos**: seções Atrasadas, Vencem hoje, Próximos 7 dias e Concluídas (14 dias), cada uma com contador e linhas clicáveis.

### Detalhe da solicitação (modal central)

Abre ao clicar num card, linha ou item. **Não usar painel lateral.**

- Overlay escuro em tela cheia. Clique fora, botão X e tecla Esc fecham. Foco vai para o modal ao abrir e volta para o card ao fechar.
- Largura máxima 940px, altura máxima da viewport com scroll interno. No mobile ocupa a tela.
- O id da solicitação vai para a URL (`?s=40`) para abrir direto por link.
- **Cabeçalho**: número, chip do setor, tipo, status, "Urgente" quando for o caso. À direita, contador "1 de 5" com setas anterior e próximo (navegam na lista filtrada atual, em loop) e o X. Título grande. Faixa de prazo com tom: warn se vence hoje, danger se atrasada, ok se concluída.
- **Coluna esquerda**: "O que foi pedido" com avatar e setor de quem pediu e a descrição completa. "Andamento" com o histórico de eventos e campo de comentário.
- **Coluna direita**: card da cliente com `Abrir ficha da cliente` (ou `Vincular cliente` quando não houver), lista de Prazo, Prioridade, Pediu e Com. Ações no rodapé: `Concluir solicitação` (accent), `Esperando cliente`, `Pedir ajuste a quem pediu`, `Passar para outra pessoa`. Se concluída, só `Reabrir`.
- Atalhos opcionais dentro do modal: setas esquerda e direita para navegar.

### Regras de negócio

- "Vence hoje" e "Atrasada" são calculados pelo prazo comparado com o horário atual, no fuso `America/Sao_Paulo`.
- "Urgente" vem da prioridade da solicitação.
- **[SCHEMA]** tornar o vínculo com cliente obrigatório na criação (ou exigir confirmação explícita "sem cliente"). Proponha e aguarde aprovação.
- Avaliar um tipo de solicitação "Aviso de encomenda" com mensagem padrão, porque aparecem pedidos repetidos desse tipo. Só registrar como TODO, não implementar agora.

## 5. Critérios de aceite

- [ ] Nenhuma ação existente da ficha ou de solicitações foi perdida.
- [ ] Nome do cliente aparece limpo e as iniciais estão corretas em todas as telas.
- [ ] Modo claro e modo noite funcionam nas duas telas, sem cor fixa fora dos tokens.
- [ ] Layout funciona em 390px de largura (mobile) sem scroll horizontal na página, exceto dentro do quadro e da tabela.
- [ ] "Pedir" na ficha cria a solicitação vinculada e ela aparece em Solicitações de Relacionamento.
- [ ] Modal de solicitação abre por clique e por URL, fecha por X, Esc e clique fora, e navega com as setas.
- [ ] Filtros, escopo, visualização e aba da ficha persistem na URL.
- [ ] Botões e campos são elementos acessíveis de verdade (`button`, `a`, `input` com `label`), ícones com `aria-label`.
- [ ] `tsc` e lint passam sem erro.

## 6. Ordem sugerida de commits

1. Tokens de tema (claro e noite) e componentes compartilhados da seção 2, incluindo `parseClientName`.
2. Ficha: cabeçalho, indicadores e "Pronta para embarcar?".
3. Ficha: abas, Visão geral e lateral.
4. Ficha: demais abas e integração do "Pedir" com Solicitações.
5. Solicitações: cabeçalho, indicadores, barra de controles e filtros na URL.
6. Solicitações: Quadro, Lista e Prazos.
7. Solicitações: modal de detalhe com navegação.
8. Propostas de migration marcadas como [SCHEMA], sem aplicar.

Ao terminar cada etapa, me mostre um resumo do que mudou e o que ficou pendente.
