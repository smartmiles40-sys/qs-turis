# Auditoria do WhatsApp — 20/08/2026

Revisão completa do caminho de WhatsApp do QS: entrada (webhook), saída (envio),
sincronização, vigia e banco. Método: forense nos dados primeiro (o banco sabe o
que de fato falhou), leitura de código depois, só nos caminhos que a forense
apontou.

## A pergunta principal: está faltando mensagem?

**Não em bloco.** Os ids de mensagem do Chatwoot são sequenciais, então todo
salto na sequência é algo que o QS não gravou. Em 9 dias:

| | |
|---|---|
| ids no intervalo | 8222 → 11683 |
| saltos | 311 |
| ids ausentes | 404 |
| explicados por descarte registrado | 219 |
| **maior buraco contíguo** | **11 ids, ao longo de 8 horas da madrugada** |

O formato importa mais que o total: **267 dos saltos são de UM id** e 25 são de
dois. Não existe bloco contíguo — que é a assinatura de um apagão de webhook.
Os avulsos batem com o que o `ingestMessage` ignora por desenho: nota privada e
evento de sistema do Chatwoot.

**Ponto cego conhecido:** nota privada e evento de sistema não deixam linha em
`qs_wa_descartadas`, então não dá pra distinguir "ignorado de propósito" de
"perdido" só pelo id. Quem fecha essa conta é a `conferirRecebimento`, que
pergunta ao Chatwoot — e que estava com o defeito nº 2 abaixo.

Outras conferências de integridade, todas limpas: 0 mensagens sem thread,
0 ids duplicados, 0 mensagens sem id do Chatwoot, 0 ponteiros de thread
apontando pra caixa errada, 2 bolhas repetidas (import antigo do ChatApp).

## Os 6 defeitos encontrados

### 1. `wa-sync` só puxava UMA conversa — e o ponto cego se alimentava sozinho

**Gravidade: alta.** É o pior deles, e o mais difícil de perceber.

Abrir o lead no QS é o conserto que a gente ensina pro time quando "sumiu
mensagem": o `wa-sync` puxa o histórico do Chatwoot. Só que ele sincronizava
**uma** conversa — a escolhida por `escolherConversaDoLead`, que decide pela
última mensagem do cliente **que o QS já tem**.

O círculo: se a mensagem do outro número nunca entrou, o QS acha que a conversa
do cliente é a antiga → sincroniza a antiga → a nova continua invisível. Abrir o
lead não conserta nada, e não há sintoma nenhum.

Hoje quase não morde (só 1 lead tem conversa em duas caixas). Passa a morder no
dia em que o closer atender pelo número dele: aí **todo** lead transferido tem
duas conversas.

**Conserto:** `conversasDeWhatsAppDoContato()` traz todas as conversas de
WhatsApp do contato; o `wa-sync` sincroniza até 5 (teto do tempo da Vercel), da
mais recente pra mais antiga, e uma que falhe não derruba as outras. O ponteiro
da thread passa a ser decidido **depois** de tudo entrar — antes o
`saveThreadMeta` gravava a escolha velha por cima do conserto que o próprio
ingest tinha acabado de fazer.

### 2. A conferência só olhava as 25 conversas mais ativas

**Gravidade: média.** O Chatwoot pagina de 25 em 25 e a `conferirRecebimento`
não paginava. Num dia movimentado passam bem mais de 25 conversas em 90 minutos
— então o ponto cego era exatamente o **horário de pico**: quanto mais mensagem,
menos ela enxergava.

**Conserto:** pagina até 8 páginas por caixa e para naturalmente quando a página
já sai da janela (a lista vem ordenada por atividade).

### 3. A janela de 24h era do LEAD, não da CAIXA

**Gravidade: média (alta depois das linhas por papel).** A trava que impede
mensagem recusada em silêncio pela Meta contava as entradas do lead **em
qualquer número**. Uma resposta dele no número comum "abria" a janela do número
oficial, onde ele nunca escreveu — e a Meta recusa calada, que é exatamente o
buraco que essa função existe pra fechar.

**Conserto:** o filtro passa a incluir a caixa (possível agora que a `0056`
carimba `cw_inbox_id` na mensagem). Mensagem antiga sem caixa carimbada fica de
fora: ela não prova janela nenhuma.

### 4. O resgate da corrida nunca era retomado

**Gravidade: média.** Quando a mensagem chega antes de o lead existir (o cliente
responde no mesmo minuto em que o Bitrix cria o negócio), o webhook registra o
descarte e segue. O resgate existe — mas só pendurado na **criação** do lead pelo
webhook de entrada. Lead que nasce pelo Bitrix ou cadastrado na mão não dispara
nada, e o descarte fica pendente pra sempre.

Medido: **12 descartes pendentes cujo lead já existe hoje** — e 3 desses leads
estão como `ganho`.

**Conserto:** migration `0057` + varredura de carona no vigia. O casamento é
feito **no banco**, não em JS: a varredura ingênua ("pega os N mais recentes e
pergunta se tem lead") passaria fome — dos 222 pendentes a maioria é gente que
realmente não é lead, e eles ocupariam as vagas em toda rodada, pra sempre.

### 5. `sourceIdFor` caía na caixa errada

**Gravidade: baixa hoje, alta com duas linhas.** Ao abrir conversa numa caixa,
o código caía em `|| payload[0]` quando o contato não tinha linha naquela caixa
— pegando o `source_id` de outra. Com um número só era inofensivo; com dois vira
o próprio bug que as linhas por papel existem pra evitar (o closer manda pelo
1935 e a conversa nasce com o `source_id` da SDR).

**Conserto:** caixa escolhida exige a linha daquela caixa, criando via
`POST /contacts/{id}/contact_inboxes` se faltar.

### 6. O trabalho pesado rodava dentro do webhook

**Gravidade: alta — e foi introduzida pelos consertos 2 e 4.** A conferência e a
varredura rodavam penduradas no `verificarSeVencido`, que é **awaited dentro do
`wa-webhook`**. Esse tempo entrava no caminho da mensagem: a função da Vercel tem
~10s pra tudo, e estourar ali não atrasa um relatório — faz a mensagem do cliente
não ser gravada.

**Conserto:** ronda leve x completa. O webhook só confere o status dos números
(uma chamada); a conferência e a varredura ficam com `/api/wa-vigia` (o QS aberto
na tela, de 5 em 5 min) e `/api/wa-monitor`, que não têm ninguém esperando.

E um segundo relógio, senão o conserto viraria outro bug: o webhook carimba
`verificadoEm` o tempo todo (mensagem chega sempre), então a ronda completa
encontraria o carimbo fresco e **nunca rodaria**. A conferência ganhou o carimbo
dela (`conferidoEm`), que só avança quando ela realmente rodou.

## O que foi conferido e está certo

- **Casamento de telefone.** A `waKey` (DDD + 8 dígitos, sem 55 e sem o nono)
  está correta: cruzei TODOS os descartes "sem lead" pendentes contra TODOS os
  leads, reimplementando a regra em SQL. Nenhum caso de lead que existia e não
  foi encontrado — os 12 que casam são corrida (o lead nasceu depois). E as duas
  implementações batem em 13 de 14 números de teste (a exceção, telefone grudado,
  está documentada na `0057`).
- **Máscara no telefone.** 0 leads com parênteses/traço/espaço — o filtro
  `ilike` do `findLeadByPhone` casa no campo cru, então máscara quebraria a
  busca. Está limpo, mas é uma fragilidade a lembrar.
- **Envio pelo número oficial.** 18/08: 454 enviadas, 28 falhas. 19/08: 404 e 6.
  20/08: 118 e **0**. As falhas de 18/08 eram quase todas primeira abordagem fora
  da janela de 24h — o que a trava de 19/08 passou a barrar antes de enviar.
- **Ingestão sob duas linhas.** Testado com insert + rollback: o `qs_wa_ingest`
  carimba a caixa certa e não quebra.

## O que NÃO é bug, mas está doendo

- **222 descartes pendentes na triagem**, 18 deles na caixa oficial desde 13/08
  (12 pessoas). O sistema fez o certo — pegou, registrou e pôs na fila. Ninguém
  abre a fila. Fica em WhatsApp (tela cheia) → triagem.
- **88 conversas em que o cliente falou por último há mais de um dia** e ninguém
  respondeu.
- **51 mensagens enviadas pela caixa 2 depois de 17/08**, quando o número já
  estava fora do ar — ver o relatório separado dos 31 leads.
