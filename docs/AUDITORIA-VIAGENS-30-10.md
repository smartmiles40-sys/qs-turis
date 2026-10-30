# Auditoria de Viagens — Partidas, Pacotes e Serviços (30/10/2026)

Leitura feita só com SELECT no banco de produção (`eabfjomrnucymduqnbci`) em 30/10/2026.
"Ativas" = `rel_viagens` com status `ativa`, fase `antes` ou `em_viagem` e acompanhamento `expedicao`, `completo` ou `leve`, ou seja, o que aparece no Painel de Viagens.
Total: **535 viagens**, sendo 481 de expedição e 54 de pacote, aéreo ou hotel. Delas, **76 estão "em viagem"** hoje.
Também foram lidas as **25 expedições** da tabela `expedicoes` que ainda não voltaram.

Correções de dado recomendadas: `docs/correcoes-dados-0227.sql` (não rodado).
Lógica e tela nova: migration `0227_viagens_correcao_manual.sql`, `src/rel/lib/statusViagem.ts` e `src/rel/viagens/VoosDaViagem.tsx`.

---

## 1. O caso do Vinícius Barbosa de Melo

| | |
|---|---|
| Viagem | `a57b84fa-49b9-4ed2-b4cf-7adec4b6afa9`: "Turquia & Grécia G2 - 2027 (Junho)", **05 a 17/06/2027**, Bitrix #521, ligada à expedição TURGRE-2027-06 |
| Serviço | `pacote`. No Bitrix, o "Tipo de venda" está como "Pacotes de Viagens", mas é expedição |
| Voos | 2 trechos `voo_internacional`, `fonte = 'bitrix'`, `ref_externa = bx-pv:ida:2026-03-21` e `bx-pv:volta:2026-03-29` |

**De onde vem o 21/03/2026**
1. O card **#8759 do funil Pós-Venda** está ligado a essa viagem em `rel_viagem_deals` (motivo: "card do pós-venda da mesma viagem").
2. Nele, "Data de Ida" está como 21/03/2026 e "Data de Volta" como 29/03/2026. São datas de outra viagem ou foram preenchidas errado.
3. A função `rel_trechos_do_posvenda` (0134b/0154) transforma essas datas em dois "voos" sem horário.
4. A view `rel_viagens_v` (0152) **já descartava** esses voos, porque estão fora da janela de embarque −10 dias a volta +60. Por isso `proximo_voo_em` é nulo.
5. O erro estava no **front**. Em `PainelViagens.tsx`, o quadro "Partidas · Pacotes e serviços" escolhia o voo de cada linha assim: "o próximo da view; **sem voo futuro, o 1º da viagem**". Esse "1º da viagem" vinha de todos os trechos, sem filtro nenhum. Resultado: a coluna PRÓXIMO VOO mostrava 21/03/2026.

**Por que aparecia "pendente de checagem"**
- O "PENDENTE CHECAGEM" do quadro só quer dizer "ninguém marcou a viagem como revisada" (`rel_viagens.revisado_em` vazio).
- A viagem caiu no quadro de **pacotes**, e não no de expedições, porque `servico = pacote` vem do Bitrix.

**Histórico.** Em 20/10 o Bruno já tinha apontado esse mesmo caso. Isso gerou a fila "Conferir voos" (0154), mas ninguém conferiu: `voos_conferidos_em` continua vazio. A fila existia, só que a tela de partidas continuava mostrando o voo errado.

**Corrigido no código.** O quadro usa a régua nova (`statusViagem.ts`). Sem voo futuro válido, não mostra voo nenhum. Viagem com voo fora das datas mostra a situação **"VOOS A CONFERIR"** em vermelho, no lugar de "PENDENTE CHECAGEM".

**Dado.** O bloco 1 do SQL marca os 2 trechos como cancelados e põe `servico_manual = 'expedicao'`. Fora do QS, é preciso corrigir o card #8759 no Bitrix.

---

## 2. Inconsistências por categoria

| # | Categoria | Contagem | Exemplos | Causa |
|---|---|---|---|---|
| 1 | **Voo no passado mostrado como próximo** | Banco: 0. Quadro de pacotes: **1** | Vinícius (acima) | O fallback "1º voo da viagem" no `PainelViagens`. Corrigido |
| 2 | **Voo fora das datas da viagem** (outra viagem ou ano errado) | **22 trechos em 21 viagens**. Ninguém conferiu (fila 0154) | Vinícius 21/03/26 numa viagem de jun/27; Cleusa, Gislea e Lidiane (Tailândia nov/27) com volta 21/11/**2026**; Waldo (Japão out/27) com volta 30/10/**2025**; Patrícia (Turquia G4 jun/27) com volta 08/07/**2026** | **Todos** vêm do card do Pós-Venda do Bitrix (`bx-pv:`), menos 1, que veio da IA. Em 10 casos o ano está errado (a data +1 ou +2 anos cai certinho na turma); nos outros 12, a data é de outra viagem |
| 3 | **"Em viagem" sem voo ou com datas que não batem** | **10 em viagem sem nenhum voo**. 4 com o fim da viagem depois da volta da venda. 2 sem data de embarque | Família Sobreira: 8 vendas "Negócio #5xxxx", "Madri" e outras, todas em viagem sem voo; Marlon Sobreira "Madri" **29/08 → 08/11** (em viagem desde agosto) | Os pacotes PAC-ESP-SOBREIRA e PAC-EURO-LUANA estão no módulo Expedições, com voos, mas **não estão ligados** às vendas do Rel (`expedicoes_id` vazio). Do Marlon, o mês da ida está errado |
| 4 | **Volta antes da ida** (`data_retorno < data_embarque`) | **0** | — | No trecho, o banco já impede chegada antes da partida. Mas há **7 voltas do Pós-Venda antes do embarque** (Bruna 02/11 × 17/11; Marina 07/11 × 18/11; Massako 11/03 × 26/03; Mirian Sobreira 08/11 × ida 29/11 …), que já estão contadas na linha 2 |
| 5 | **Datas com o ano errado** | **9 viagens com o ano do nome ≠ o ano da data**, mais 10 voos com o ano errado (linha 2) | "Japão e China/ Out **2027**" viajando agora, em 26/10/**2026** (3 pessoas); "Tailandia/ Nov **2027**" com data 17/11/**2026** (4); "Japão/ Out 2026" e "Egito/ Out 2026" com datas de **2027** | O nome do grupo vem do Bitrix (campo da expedição). Corrigir lá |
| 6 | **Sem trechos** | **88 viagens sem trecho nenhum** (75 de expedição, 13 de pacote). **12 pacotes ou aéreos sem voo**. **285 só com as datas genéricas do Bitrix** (sem horário e sem nº do voo) | Família Sobreira; Islândia (João da Costa) em viagem sem voo | Falta subir o bilhete ou a IA não leu (memória 15/10: falta `OPENAI_API_KEY`) |
| 7 | **Voo interno não identificado** | **8 viagens com 19 voos do meio da viagem marcados como "internacional"**. **33 viagens com 41 voos da ida ou da volta marcados como "interno"** | Krabi→Chiang Mai marcado como internacional; FOR→GRU (conexão nacional) marcado como "interno" | Não havia regra: o tipo era o que a fonte dissesse. 47 viagens têm voo interno de verdade (83 trechos), pela regra nova |
| 8 | **Check-in pendente de trecho já voado** | 228 voos passados sem check-in marcado, em 75 viagens. **Na tela: 0**, porque o front já ignora voo que decolou. **Check-in marcado no Rel: 0 até hoje.** Nas Expedições, `passageiros.checkin_online_feito` está marcado em 1 pax, e 79 pax estão com a janela aberta | — | O check-in nunca foi usado. **Há duas marcações separadas**: por trecho, no Rel, e por passageiro, nas Expedições |
| 9 | **Duplicados** | **75 viagens** (mesma pessoa, mesma data de embarque). 14 pares são Bitrix + Expedições (esperado: o painel conta uma vez só). **13 pares são 2 vendas do Bitrix iguais**. 4 pares de pacotes da família Sobreira. 1 trecho repetido | Ana Claudia Greco "Itália/ Set 2027" ×2; Adriana Palhano: Bitrix "Turquia **G3**" × Expedições "**G2**" | Card copiado no Bitrix. Turma divergente entre os dois sistemas |
| 10 | **Expedição classificada como pacote** | 1 | Vinícius | "Tipo de venda" do Bitrix |
| 11 | **Status da expedição (tabela `expedicoes`) × datas** | **4** "Em andamento" antes do embarque | TAI-G1/G2/G3/G4-2026-11 (embarcam 13 e 17/11) | Status manual do Ops. O cockpit já avisa (`divergenciaStatus`) |
| 12 | **Viagem longa (mais de 60 dias)** | 2 | Marlon Sobreira (71 dias); Mayara "Fortaleza" (95 dias) | Data digitada errada |
| 13 | **Sem data de volta** | 27 (23 de expedição e 4 de pacote) | Livia "Japão" 26/10 sem volta | Bitrix |

**O que está certo hoje.** As 4 expedições que estão de fato em viagem estão com o status certo: JAPCHI-2026-10-A e B, PAC-ESP-SOBREIRA e PAC-EURO-LUANA. Os 89 voos das expedições ativas têm data com ano e todos caem nas datas da turma (12 estão sem horário, os internos da Tailândia).

---

## 3. A lógica nova (`src/rel/lib/statusViagem.ts` = `rel_viagens_v` da 0227)

- **Voo que vale.**
  - Está dentro da janela da viagem (embarque −10 dias, volta +60).
  - Não foi cancelado à mão.
  - O mesmo voo repetido, um por passageiro, conta uma vez.
  - O ida/volta genérico do Bitrix é ignorado quando há o voo de verdade.
  - O que não vale continua **visível, apagado e com o motivo** ("fora das datas da viagem", "data genérica do Bitrix", "repetido", "cancelado").
- **Próximo voo.** É o 1º voo que vale com partida ≥ agora e que não foi marcado como voado. Voo sem horário (do Bitrix ou às 00:00) continua "próximo" **até o fim do dia dele**.
- **Ida e volta reais.**
  - A ida real é o 1º voo, quando ele sai até 2 dias depois do embarque da venda. Senão, vale o embarque da venda.
  - A volta real é o último voo, quando ele chega a partir de 2 dias antes da volta da venda. Senão, vale a volta da venda.
  - **"Em viagem" = hoje entre a ida e a volta reais.**
  - Antes, a regra era `LEAST/GREATEST(venda, voos)`, que esticava o "em viagem". Testado na base de hoje: nenhuma das 1.482 viagens ativas muda de fase, e 1 "próximo voo" muda (o voo de hoje sem horário, que antes sumia à meia-noite).
- **Voo interno.**
  - Os voos se juntam em blocos: menos de 24h entre a chegada de um e a partida do seguinte é conexão.
  - **1º bloco = ida internacional, último bloco = volta, os do meio = VOO INTERNO.**
  - Perna Brasil→Brasil dentro da ida ou da volta é "nacional de conexão", não voo interno.
  - Na tela aparece "Tem voo interno: **sim (2 trechos)**" ou "**não**". O quadro de pacotes ganhou a coluna **INTERNO** ("SIM · 2" ou "NÃO").
- **Check-in a fazer.** Só para voo **futuro**, ainda não feito, com a janela aberta (48h antes, ou o horário que a companhia informou). Voo que já decolou nunca pede check-in.
- **Estado de cada trecho na linha do tempo:** a voar, check-in a fazer, check-in feito, voado ou cancelado.
- **A correção manual manda.** Trecho marcado voado ou cancelado à mão e status forçado prevalecem sobre o cálculo. O status forçado vale até a data escolhida, ou até alguém voltar ao automático.

Testes: `tests/viagens/statusViagem.test.ts`, 11 casos, entre eles o do Vinícius, check-in, voo interno, repetido, status manual e cancelado.

---

## 4. Correção pela tela (supervisor, quem tem `relacionamento.editar_viagens`)

O bloco **"Voos e check-ins"** fica no card da viagem, logo abaixo de "Tudo da viagem". Ele tem:

- **Resumo:** status real (com a etiqueta "manual" quando foi forçado, e o motivo), próximo voo, "tem voo interno: sim (n) / não" mais os voos nacionais de conexão, e os check-ins a fazer.
- **"Não bate"**, com as inconsistências da viagem e o botão **Ignorar alerta** (pede motivo; dá para voltar a mostrar).
- **Linha do tempo de todos os voos:** quando (hora local), trecho, papel (ida, interno, volta, nacional) e situação. Por trecho:
  - **Check-in feito** ou **Desfazer check-in**;
  - **Editar** (data e hora local mais fuso, rota, nº do voo, companhia, localizador e tipo);
  - **Voado**, **Cancelado** e **Automático** (este último volta ao cálculo).
- **Forçar status** (antes, em viagem ou concluída, até uma data opcional) e **Voltar ao automático**.
- **Corrigir datas** da viagem. As datas ficam travadas: o Bitrix não volta com as antigas.
- **Histórico de correções:** quem, quando, o valor anterior → o novo e o motivo. Tem **Desfazer** na correção mais recente de cada item.

Como o automático respeita a correção:
- Um gatilho em `rel_viagem_trechos` impede o automático de mexer em trecho corrigido. O automático aqui é a sincronização do Bitrix, `importar-expedicoes.mjs` e a IA, todos com a chave `service_role`.
- Num trecho corrigido, o gatilho não deixa mudar data, rota, tipo nem situação, e não deixa apagar.
- Pessoa logada edita normalmente.

---

## 5. O que fica para depois

- **Unificar o check-in.** Hoje há o do Rel (`rel_viagem_trechos.checkin_feito_em`, por trecho) e o das Expedições (`passageiros.checkin_online_feito`, por passageiro). Precisa decidir qual é a fonte única.
- **Corrigir no Bitrix os cards do Pós-Venda** com as datas erradas. Senão, o `rel_trechos_do_posvenda` não reinsere (há `ref_externa` e descartados), mas a confusão continua no Bitrix.
- **Ligar automaticamente** os pacotes do módulo Expedições (`PAC-*`) às vendas do Rel. Hoje é à mão: bloco 5 do SQL.
- **Supervisor de Operações.** A permissão das funções da 0227 é a do Relacionamento (`relacionamento.editar_viagens`). Se o Ops também tiver que corrigir, é preciso abrir para `ops_tem_acesso()` mais alguma permissão do Ops.
