# Relacionamento × Expedições, Pacotes e Inscrições — varredura e proposta (03/11/2026)

> Pedido do Bruno: "Expedições, pacotes e Inscrições, vamos ter que mexer em quase tudo! Ainda não está
> de uma forma visual e bem distribuída… Faz uma varredura mais a fundo do que podemos unificar e
> facilitar a vida deles! O relacionamento é a ponte entre a agência e a experiência do cliente."
>
> Números medidos no banco de PRODUÇÃO em 03/11/2026 (só leitura). "Futura" = embarca hoje ou depois,
> sem as canceladas.

## 1. Mapa atual — por onde o time do Rel anda

| Menu do Rel | Tela | Fonte | O que mostra |
|---|---|---|---|
| Pós-venda › Viagens | `#rel/viagens` (`rel/viagens/ViagensPage`) | `rel_viagens_v` (Bitrix) | Toda venda: aéreo, seguro, pacote, **e uma linha por passageiro de expedição** |
| Pós-venda › Viagens › (ficha) | `#rel/viagem/<id>` (`ViagemPage`) | `rel_viagens` + trechos + etapas + componentes | Ficha de UMA venda; botão "Abrir expedição" leva pro cockpit |
| Pós-venda › Prioridades | `#rel/prioridades` | `rel_prioridade_viagens` | Pacotes prioritários + check do dia |
| Pós-venda › Alertas | `#rel/alertas` | `rel_viagens` | Passaporte vencendo, etapa atrasada… |
| Atendimento › Grupos | `#rel/grupos` | `rel_wa_grupos` | Grupos de WhatsApp (todos, sem vínculo com a viagem) |
| Expedições › Expedições | `#rel/exp-expedicoes` (`CentralExpedicoes`) | `expedicoes` + `passageiros` | Grade de cartões: datas, fase, ocupação. **Sem pendência nenhuma no cartão** |
| Expedições › (cockpit) | `#rel/exp-expedicoes/<id>` (`ExpedicaoDetalhe`) | idem | 7 abas: Visão geral · Passageiros · Logística · Checklist · Financeiro · Arquivos · ExpedAmigo |
| Expedições › Pacotes | `#rel/exp-pacotes` (`PacotesPersonalizados`) | `rel_viagens_v` (servico=pacote) **+** `expedicoes` (tipo=pacote) | Duas listas empilhadas, de fontes diferentes |
| Expedições › Inscrições | `#rel/exp-inscricoes` (`Inscricoes`) | `inscricoes_pendentes` | 2 abas: "Quem falta responder" (abre nela) e "Aguardando aprovação" |
| Expedições › Saúde · médico | `#rel/exp-saude` (`Saude`) | `passageiros.saude` + `cad_laudos_medicos` | Fila do médico |
| Expedições › Avisos | `#rel/exp-avisos` | prontidão | Exigências vencendo |
| Carteira › Clientes › ficha | `#rel/cliente/<id>` | `rel_clientes` + abas Expedições/Saúde/Documentos | O cliente e TUDO dele |

### Tarefas do dia a dia: quantos cliques hoje

| Tarefa | Caminho hoje | Cliques |
|---|---|---|
| Quem viaja esta semana / próximos 30 dias | Expedições (rolar por ano) + Pacotes (outra tela) + Viagens (outra tela) | 3 telas |
| Pendências de inscrição de UMA expedição | Inscrições → trocar de aba (abre em "Quem falta") → achar o grupo | 3 |
| Quem está sem passaporte numa expedição | Expedições → cartão → aba Passageiros → olhar coluna | 3 + varrer |
| Saúde pendente de uma viagem | Saúde · médico → filtrar pela expedição | 2–3 |
| Checklist atrasado | Expedições → cartão → aba Checklist | 3 |
| Grupo de WhatsApp da viagem | Grupos → buscar pelo nome (não há vínculo) | 2 + busca |
| "Essa viagem está em dia?" | Não existe resposta numa tela só | — |

## 2. Uso real (banco, 03/11)

| Medida | Número | Leitura |
|---|---|---|
| Expedições cadastradas | 47 (43 expedição + 4 pacote) | 21 futuras |
| Expedições futuras **sem responsável operacional** | **17 de 21** | Ninguém nomeado |
| Passageiros (todas) / de viagens futuras | 930 / **350** | |
| Futuros **sem passaporte** | **116 de 350 (33%)** | |
| Futuros com passaporte vencendo antes de embarque + 6 meses | **15** | |
| Futuros com alguma resposta "Sim" na saúde | **115** | Laudos emitidos: **0** (`cad_laudos_medicos` vazia) |
| `status_financeiro` dos futuros | 350 de 350 "Em aberto" | Campo não é usado |
| Inscrições aguardando aprovação | **41** | Todas com mais de 7 dias |
| …de viagens que **já embarcaram** | **26 de 41** (Japão & China G1 9, G2 16, Peru Márcio & Renato 1) | Fila velha, ninguém limpa |
| Viagens do Rel (`rel_viagens`) | 1.892 | 1.076 delas são `servico=expedicao` |
| Viagens do Rel ativas e futuras | 495 | 427 são expedição (≈ 1 por passageiro) |
| …com **dono** (`responsavel_id`) | **0 de 495** — e 0 em toda a tabela | O "dono do Rel" nunca foi preenchido |
| Viagens-expedição futuras **sem ligação** com a expedição | **101 de 427** | Nome de texto livre ("Turquia e Grécia G1/ Jun 2027") × código (`TURGRE-2027-05`) |
| Pacotes personalizados (Bitrix) ativos | 119 (22 futuros) | Pacotes cadastrados como expedição: 4 |
| Grupos de WhatsApp | 187 | **0** ligados a expedição ou viagem (`expedicao_id`/`viagem_id` vazios) |
| Expedições futuras sem grupo ligado | **21 de 21** | |
| Pacotes prioritários (`rel_prioridade_viagens`) | **0** | Tela nova, ainda sem uso |
| Voos de expedição / trechos do Rel | 111 / 2.781 | Duas tabelas de voo |
| Itens de checklist | 1.360 | |

## 3. Problemas (do maior pro menor)

1. **Não existe "essa viagem está em dia?" numa tela só.** A Central de Expedições mostra datas e
   ocupação, mas nenhuma pendência. Pra saber se a Tailândia G1 (embarca em 10 dias) está pronta o time
   abre o cockpit, Passageiros, Checklist, Inscrições e Saúde — 5 lugares.
2. **A mesma viagem mora em 2 lugares.** Cada passageiro de expedição é também uma "viagem" do Rel
   (427 futuras × 350 passageiros). Documentos, saúde e voos existem dos dois lados
   (`passageiros` × `rel_viagens`/`rel_viagem_trechos`; `expedicao_voos` × `rel_viagem_trechos`), e 101
   viagens nem estão ligadas à expedição.
3. **Dono ninguém.** 0 viagens do Rel com responsável; 17 de 21 expedições futuras sem responsável
   operacional; e a expedição não tem campo de "quem do Rel cuida".
4. **Fila de inscrição envelhecendo.** 41 pendentes, 26 de viagens que já saíram. O selo do menu (41)
   leva pra aba "Quem falta responder" — outra lista; quem clica no número não vê o número.
5. **Pacotes em duas fontes.** 119 pacotes do Bitrix (`rel_viagens`) + 4 em `expedicoes`; a tela empilha
   as duas listas com visuais diferentes.
6. **Grupo de WhatsApp solto.** 187 grupos, nenhum ligado à viagem — o vínculo já existe no banco
   (`rel_wa_grupos.expedicao_id`/`viagem_id`, 0219), só não é usado.
7. **Saúde sem fechamento.** 115 passageiros futuros declararam algo; 0 laudos.
8. **Campos mortos:** `status_financeiro` 100% "Em aberto"; prioridades com 0 linhas.

## 4. Proposta de estrutura unificada

### 4.1 Uma entrada: "Painel das viagens" (FEITO hoje, ver §5)
Primeiro item do grupo Expedições no Rel. Expedições + pacotes cadastrados + pacotes personalizados
numa tela, por data, cada cartão com as pendências que importam e o atalho direto pra resolver.

### 4.2 "Central da viagem" = o cockpit, com as abas do Rel (próximo passo)
O cockpit da expedição (`ExpedicaoDetalhe`) já é a "central". Falta trazer pra dentro o que hoje mora fora:

| Aba | Hoje | Proposta |
|---|---|---|
| Visão geral | existe | + bloco "Pendências" (o mesmo do Painel) |
| Passageiros | existe | + coluna "viagem do Rel" (link pra ficha) |
| **Inscrições** | tela global | aba com a fila SÓ desta expedição (mesmos componentes de `Inscricoes.tsx`) |
| **Saúde** | tela global | aba com os casos desta expedição (`carregarFila` filtrado) |
| Voos / Logística | existe (`expedicao_voos`) | + trechos do Rel dos passageiros |
| Rooming · Checklist · Financeiro · Arquivos | existe | — |
| **Grupo** | inexistente | grupo de WhatsApp ligado (`rel_wa_grupos.expedicao_id`) com botão "ligar grupo" |

### 4.3 Pacote personalizado = mesma ficha
`ViagemPage` já é a central do pacote do Bitrix. Decidir se os 4 pacotes em `expedicoes` continuam lá
ou viram viagens do Rel (ver §6).

## 5. O que foi feito hoje (03/11)

- **Painel das viagens** (`src/expedicoes/lista/painel/PainelViagens.tsx`, rota `#rel/exp-painel`,
  também `#ops/painel`): números grandes no topo (embarcam em 30 dias, em viagem, inscrições,
  sem passaporte, saúde p/ médico), filtros rápidos (30 / 90 dias, com pendência, só pacotes, busca), e
  cada expedição/pacote como cartão com contagem regressiva, ocupação, responsável e chips de pendência
  clicáveis (inscrições → fila, passaporte → aba Passageiros, saúde → fila do médico, checklist → aba
  Checklist), além de "sem grupo de WhatsApp ligado" e "sem responsável". Embaixo, os pacotes
  personalizados do Bitrix dos próximos 90 dias, com tarefas atrasadas e dono.
- **Inscrições**: abre direto em "Aguardando aprovação" quando há fila (o selo do menu bate com o que se
  vê), aceita `?aba=aprovacao|falta`, filtro rápido "Viagem já saiu" e aviso destacado nos grupos de
  viagens que já embarcaram.
- Nenhuma rota antiga mudou; nenhuma regra de negócio ou schema mudou.

## 6. Fica pra depois — Bruno decide

1. **Dono do Rel por expedição**: criar `expedicoes.responsavel_relacionamento_id` (migration nova) ou
   usar o `responsavel_id` das viagens do Rel (hoje 0 preenchidos)? Sem isso não dá pra ter "minhas
   viagens" no Painel.
2. **Ligar as 101 viagens-expedição soltas** à expedição (casar texto livre × código; precisa de
   conferência manual — gerar a lista pra aprovar).
3. **Ligar grupos de WhatsApp às expedições** (21 futuras sem grupo): tela de "ligar grupo" no cockpit.
4. **Limpar as 26 inscrições de viagens que já saíram** — aprovar/recusar/excluir em lote? (não feito: é
   decisão de negócio).
5. **Pacotes**: os 4 pacotes em `expedicoes` ficam lá (têm passageiros/rooming) ou viram viagens do Rel?
6. **Um passageiro = uma viagem do Rel?** A longo prazo, a viagem-expedição do Rel deveria LER do
   passageiro (documento, saúde, voo) em vez de ter cópia. Proposta de schema separada.
7. Abas Inscrições / Saúde / Grupo dentro do cockpit (§4.2).
8. Campos mortos: `status_financeiro` (350/350 "Em aberto") — esconder ou alimentar pelo Financeiro.
