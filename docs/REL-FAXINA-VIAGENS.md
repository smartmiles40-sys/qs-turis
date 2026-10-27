# Faxina das viagens do Relacionamento

Medido em **27/10/2026** no banco de produção, só com leitura. Os números mudam com o tempo. Para medir de novo, rode `scripts/rel-faxina/diagnostico.sql` (só SELECT) no SQL Editor do Supabase.

O pedido do Bruno: *"ajustar todas as viagens antes de subir qualquer coisa, já adaptado pra receber as novas vendas, com um modelo pra aéreo, pacote, seguro… visualização fácil e rápida, sem ficar consultando nada"*.

---

## 1. Como está hoje

| | viagens |
|---|---:|
| Viagens no QS | 1.854 (1.807 ativas) |
| Ativas **para classificar** (o Bitrix não diz o que foi vendido) | **198**. Dessas, 45 ainda vão acontecer ou estão acontecendo |
| Ativas **sem data de embarque gravada** | **426** no total. Na fila "Sem data" (com acompanhamento) ficam **325** |
| …e que já têm voo cadastrado | 59 (4 vão acontecer) |
| Pacote, aéreo ou hotel **a acontecer sem dono** | **50** (44 embarcam em até 120 dias) |
| …e sem nenhuma preferência anotada (até 120 dias) | 44 |
| Marcadas **"CONFERIR: possível viagem repetida"** | **19**, todas a acontecer |
| Pares novos de possível repetida (mesma pessoa, ida a ≤ 3 dias) | 28 (2 a acontecer) |
| **Vendas soltas** (seguro, hotel ou passeio que é parte de outra viagem) | 14 pares, 12 vendas (1 a acontecer) |
| Ativas **sem cliente** ligado | **22**. Nenhuma tem contato no card do Bitrix |
| Expedições a acontecer | 477 |
| Etapas da Esteira concluídas | **0** |
| Viagens com responsável | **0** de 1.854 |

Os componentes que já existem e entram na nova tela:

- **2.677 voos** em 881 viagens.
- **805 viagens** ligadas a uma expedição.
- 23 passeios, 18 hotéis, 4 transfers e 2 trens.

Itens de venda (`qs_venda_itens`) ainda não existem: chegam com a 0207 da frente Venda.

---

## 2. O que dá pra arrumar automático

Tudo passa por uma função do banco (0208) que confere quem está pedindo e grava o histórico da viagem. **Nada roda sozinho**: alguém marca, confere e clica.

| Fila | Regra | Quantas pega | Quem clica | Onde |
|---|---|---:|---|---|
| **Classificar** | **R1 (alta):** "Venda realizada - Tipo" diz o serviço e o "Tipo de venda" diz "Outros" | 1 (seguro) | qualquer um do Rel | Lista → Classificar → "Marcar as com sugestão" → "Usar a sugestão" (ou "usar" em cada linha) |
| | **R2 (alta):** Bitrix "Tipo de Viagem" = Expedição | 1 | | |
| | **R3 (média):** o nome do card ou a Observação diz "Exp …", pacote, lua de mel, cruzeiro, seguro, passeio, Civitatis, tour, transfer, hotel ou passagem | 28 (5 a acontecer: 3 pacotes e 2 passeios) | | |
| | **R4 (média):** os trechos já cadastrados. Voo + hotel = pacote; só voo = aéreo; só hotel = hotel; só passeio = passeio | 51 (3 a acontecer, todos aéreo) | | |
| | **Total com sugestão** | **81 de 198**. Só **8 das 45** que vão acontecer; as outras 73 já voltaram | | |
| **Sem data** | Já tem voo: ida e volta = primeiro e último voo que valem. A data fica travada contra o Bitrix (função da 0154) | **59** (4 a acontecer) | qualquer um do Rel | Lista → Sem data → "Marcar as que têm voo" → "Datas pelos voos" |
| | Venda há mais de 12 meses ou sem data de venda, e sem voo → **arquivar** com motivo (dá pra desfazer) | **236** | gestão | Lista → Sem data → "Marcar as sugeridas" → Arquivar |
| **Sem dono** | Distribuir as marcadas entre as pessoas escolhidas. Quem tem menos viagens a acontecer recebe primeiro. O mesmo cliente com a mesma ida fica com a mesma pessoa | **50** | gestão | Lista → Sem dono → Marcar todas → "distribuir entre…" |
| **Repetidas** | Mesma pessoa, as duas vendas ativas, ida a ≤ 3 dias, mesmo nível de acompanhamento. Fica de fora a expedição ligada ao sistema de Expedições (a mesma pessoa vem do Bitrix e de Expedições de propósito) | **28 pares** para **marcar**; quem junta é a gestora | gestão | Faxina → Repetidas? → "Ver pares novos" → Marcar → "Conferir lado a lado" |
| **Vendas soltas** | Seguro, hotel, passeio ou "para classificar" da mesma pessoa, com ida a ≤ 3 dias de um pacote, aéreo, cruzeiro ou expedição. A venda solta **vira item** da viagem principal e é arquivada (dá pra desfazer) | **12 vendas** | gestão | Faxina → Vendas soltas → Juntar |

No total, **cerca de 430 viagens saem das filas só com cliques** (81 + 59 + 236 + 50 + 12). Repetidas sempre passam pelo olho da gestora.

---

## 3. O que precisa de olho humano

### 3.1 O que precisa de gente

- **117 para classificar sem regra.** 37 vão acontecer. A maioria é **"Cotação (Operações) — #nnnnn"**: cards do funil Operações sem Tipo de venda. O resto tem só o destino no nome ("Japão", "Tailândia", "Dubai e Catar").
- **30 sem data, recentes e sem voo.** 24 são de expedição. No Bitrix, 26 delas têm o "Nome da expedição" (ex.: "Japão/ Out 2026", "Egito/ Out 2026"), mas o nome não bate exatamente com o cadastro de Expedições. O time escolhe a saída.
- **22 sem cliente.** É preciso achar ou criar a ficha e ligar.
- **19 repetidas já marcadas** (mais as que forem marcadas): juntar, ou dizer que são viagens diferentes.
- **44 viagens a acontecer em até 120 dias sem preferências:** ligar para o cliente.
- **Esteira:** 0 etapas feitas. Começa quando cada viagem tiver dono.

### 3.2 Lista priorizada: quem embarca primeiro

Gerada pelo §7 do diagnóstico. Só pacote, aéreo, hotel e o que falta classificar (expedição tem fluxo próprio).

**Já em viagem (fase "em viagem"), sem dono:**

| Ida | Viagem | Cliente | Serviço | Bitrix | Falta |
|---|---|---|---|---|---|
| 21/03/26 | Cotação (Operações) | Reginaldo Albuquerque | ? | #43423 | classificar; a data parece errada (ida em março e ainda "em viagem") |
| 29/08 | Madri | Marlon Marcelo Rodrigues | pacote | #28919 | dono; a volta parece longe demais, conferir |
| 29/09 | Japão (5 cards: Allan, Jessie, Joe Bruno, Rafael, Camila) | — | hotel | #35915 #36605 #35975 #34767 #33443 | dono |
| 15/10 | Dubai e Catar | Jenefe | ? | #33845 | classificar |
| 23/10 | Luana – EuroTrip **+** Roma-Paris-Londres | Luana | ? + pacote | #41827 + #41029 | classificar; **é a mesma viagem**: duas fichas "Luana" (juntar os cadastros, depois juntar como componente) |
| 26/10 | PEK/BKK | Consuelo de Oliveira | aéreo | #37997 | dono |
| 26/10 | Japão | Glória Keiko | ? | #33857 | classificar |

**Embarcam nos próximos 30 dias:**

| Ida | Viagem | Cliente | Serviço | Bitrix | Falta |
|---|---|---|---|---|---|
| **27/10 (hoje)** | SDU | Werner Fábrica de Tecidos | aéreo | #47937 | dono |
| 28/10 | Japão | Elisabeth Dantas Araujo | ? | #51965 | classificar |
| 29/10 | **Família Sobreira / Almeida Rodrigues**, Madri e Barcelona: 7 cards (Mirian, Ana Márcia ×2, Manoel, Marcos, Marlon, Emmanuelle, Felipe ×2) **+** "Cotação (Operações) #39263" (Manoel) | | pacote + ? | #27929 #27943 #27937 #40193 #27933 #40191 #40287 #41283 #33035 #39263 | dono (**um dono só para a família**); 2 pares de repetida (Ana Márcia, Felipe); classificar a cotação |
| 29/10 | Islândia | João da Costa Neto Junior | pacote | #50519 | dono |
| 30/10 | Madri/Barcelona | Francisco Marcio Cazimiro | pacote | #28203 | dono |
| 01/11 | Japão | Angela Cristina Nazareth | pacote | #28223 | dono |
| 09/11 | São Paulo – GRU | Maria Samara Marinho | pacote | #49655 | dono |
| 12/11 | Seoul | Hely Braga | pacote | #50357 | dono |
| 12/11 | Tailândia | Bianca Teodoro · Gabriela Pimenta | pacote | #47737 · #44341 | dono |
| 12/11 | Guarulhos | Adma Geane Menegazzo | hotel | #50425 | dono |
| 13/11 | GRU | Alessandra Noronha · Danielle Torres · Christianne Damasceno | aéreo | #34431 · #43161 · #43159 | dono |
| 13/11 | Cotação (Operações) | Jéssica | ? | #40499 | classificar |
| 14/11 | Negócio #49145 | Angela Cristina Nazareth | pacote | #49145 | dono |
| 16/11 | Tóquio · Rio de Janeiro | Julia Trianda · Werner | hotel · pacote | #40237 · #49453 | dono |
| 18/11 | Tailândia + Cotação (Operações) | Marina Almeida · Lucimeire | pacote · ? | #28735 · #37885 | dono · classificar |
| 19–26/11 | Gru · Cotação #40769 · Tailândia · Cotação #40689 | Carlos Henrique · Roana · Marina Almeida · Laile | | #49179 #40769 #30465 #40689 | dono · classificar |

A lista completa, até 100 linhas, sai no §7 do diagnóstico.

---

## 4. Passo a passo para o time

**Antes de tudo (Bruno):** aplicar a **0207** (frente Venda) e depois a **0208**. Sem elas, a tela "Tudo da viagem" já mostra o roteiro e a expedição, mas os botões novos de lote respondem "falta aplicar a 0208".

1. **Dono (gestora, 10 min).** Viagens → Lista → faixa "Faxina das viagens" → **Sem dono**. Marque todas, abra "distribuir entre…", escolha Tainara, Mariane e Paulo e clique em **Distribuir**. Cada um passa a ver as suas em **Minhas**.
2. **Classificar (todo o time).** Faxina → **Classificar** → "Marcar as com sugestão". Confira as que dizem "confira" e clique em **Usar a sugestão**. Nas que sobrarem, comece pelas que embarcam primeiro: abra o card no Bitrix e escolha o serviço na própria linha.
3. **Sem data.**
   - "Marcar as que têm voo" → **Datas pelos voos** (qualquer um do time).
   - Gestão: "Marcar as sugeridas", confira e **Arquivar** com o motivo. Dá pra desfazer em **Arquivadas**.
   - As que sobrarem: preencher a ida e a volta no card do Bitrix.
4. **Repetidas (gestora).** Faxina → **Repetidas?** → "Ver pares novos" → **Marcar pra conferir** → "Conferir lado a lado". Para cada par, **Juntar** ou **São diferentes**. Família comprando em cards separados = são diferentes.
5. **Vendas soltas (gestora).** Faxina → **Vendas soltas** → **Juntar**. O seguro ou hotel passa a aparecer dentro da viagem principal.
6. **Sem cliente.** Faxina → **Sem cliente** → abra cada uma e ligue a ficha (busque em Clientes ou crie).
7. **Cada dono, nas suas viagens.** Abra a viagem e trabalhe o bloco **Tudo da viagem** de cima para baixo:
   - **O que falta:** os pontos vermelhos primeiro.
   - **Lançar item:** em venda antiga do Bitrix, lance o aéreo, o hotel e o seguro com localizador, voucher ou apólice e marque **Emitido**.
   - **Preferências do cliente.**
   - **Esteira:** as etapas.

---

## 5. A tela "Tudo da viagem"

O bloco fica no topo do card da viagem, logo abaixo do cabeçalho. Ele tem três partes:

- **O que falta**, com os pontos ordenados por gravidade:
  - **Venda:** serviço, data, cliente, possível repetida.
  - **Relacionamento:** dono.
  - **Emissão:** item "a emitir", voo sem localizador, nenhum voo no roteiro.
  - **Documentos:** passaporte ausente ou que vence antes de 6 meses da volta; passageiro vendido sem ficha; documento recusado ou a conferir; sem seguro.
  - **Pagamento:** atraso, ou quanto falta receber e a próxima parcela (resumo da 0175, sem detalhe por parcela).
- **Próximas datas:** embarque, volta, check-in, passeio e vencimento.
- **Componentes, um cartão por tipo:**
  - **Aéreo:** voos com horário local, companhia, localizador, bagagem, classe e assento.
  - **Hotel**, **seguro**, **passeio**, **trem**, **carro**, **cruzeiro**, **visto**, **pacote**.
  - **Expedição:** botão "Abrir expedição".

  Os rótulos dos campos vêm do catálogo único `TIPOS` (`src/propostas/lib.ts`). Cada item da venda mostra a situação **A emitir / Emitido / Cancelado**. Em **Editar**, o Rel completa os campos do tipo, mais localizador, voucher e anotação, e muda a situação. Pelo contrato, o Rel grava só `status`, `dados` e `viagem_id`. O nome, as datas e o valor são do Comercial.
