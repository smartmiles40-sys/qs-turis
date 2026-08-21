# Glória — a IA que atende no WhatsApp

Dois workflows, duas migrations, um script e duas rotas no QS. A Glória responde
o lead no WhatsApp, tira dúvida com o conteúdo das expedições, faz as 5 perguntas
de qualificação e devolve a conversa pro time.

| Arquivo | Para quê |
|---|---|
| `gloria-atendimento.workflow.json` | O atendimento. Fica **ativo**, o QS chama a cada mensagem. |
| `gloria-base-conhecimento.workflow.json` | Transforma as fichas em memória de busca. Roda quando você clica. |
| `../scripts/gloria-fichas.mjs` | Escreve as fichas a partir dos dados das LPs. |
| `../supabase/migrations/0053_gloria_ia.sql` | As tabelas, as regras e o interruptor. |
| `../supabase/migrations/0059_gloria_pronta.sql` | A tabela das fichas + as duas travas que faltavam. |
| `../supabase/migrations/0060_gloria_pipeline.sql` | O pipeline dela (o sandbox) e a cadência de follow-up. |
| `../api/gloria-responder.js` | O n8n manda o que ela escreveu; **quem envia é o QS**. |
| `../api/gloria-transferir.js` | Ela sai da conversa e o time entra (nota + tarefa). |
| `../api/gloria-toques.js` | Roda a cadência: quem está devendo toque leva toque. |
| `../src/components/sdr/gloria/PipelineIAPage.tsx` | A tela **Atendimento IA** (menu Execução). |

## Segunda-feira, na ordem

Sete passos. Os quatro primeiros podem ser feitos antes, com calma; do quinto em
diante já é com cliente de verdade do outro lado.

**1. Banco.** SQL Editor do Supabase → cole `0059_gloria_pronta.sql` inteiro → Run.
Depois `0060_gloria_pipeline.sql` → Run. (A 0053 já está aplicada.)

**2. Vercel.** Settings → Environment Variables → crie as duas e **redeploy**:

```
GLORIA_SECRET=<segredo longo, ex.: openssl rand -hex 24>
GLORIA_WEBHOOK_URL=https://SEU-N8N/webhook/gloria-atendimento
```

> Hoje elas **não existem** em produção — as duas rotas da Glória respondem 503,
> que é o jeito delas dizerem "sem segredo eu não trabalho". Enquanto isso não
> for feito, nada mais adianta: toda resposta dela seria recusada pelo QS.

**3. As fichas.** No repo do QS:

```bash
node scripts/gloria-fichas.mjs            # confira: 102 seções, 15 páginas
node scripts/gloria-fichas.mjs --apply
```

**4. n8n.** Apague a versão antiga dos workflows da Glória (inclusive a que
juntou os dois num canvas só) e importe os dois arquivos deste diretório.
Confira que a credencial `Header Auth account` tem o header `x-gloria-secret`
com **exatamente** o `GLORIA_SECRET` do passo 2. Rode o workflow **carregar a
base de conhecimento** e confira o nó *Resumo da carga*. Ative o de atendimento.

**5. Teste com o `MODO_TESTE = true`** (é como o Config já vem). Umas dez
conversas pelo nó *Testar à mão* — inclusive uma pergunta de preço, para conferir
se o valor que ela cita é o da expedição certa.

**6. Ligue.** `MODO_TESTE = false` no Config, e no banco:

```sql
update qs_settings set value = 'true'::jsonb where key = 'gloria_ativa';
```

**Nada acontece ainda**, e é esse o ponto: com `gloria_so_pipeline = true` (o
padrão da 0060) ela só atende quem está no pipeline dela — e o pipeline está
vazio.

**7. Abra o sandbox.** No menu **Execução → Atendimento IA**, procure um lead de
teste e clique em *Colocar na IA*. Mande mensagem do seu celular para o número
oficial e acompanhe a conversa entrar no quadro. É esse quadro que responde
"como foi o atendimento da IA hoje" sem abrir conversa por conversa.

Depois de ver umas 20 conversas reais, é só ir colocando mais gente no pipeline
(ou soltar de vez com `gloria_so_pipeline = false`, e aí valem as travas
`gloria_so_conversa_nova` e `gloria_leads_piloto`).

Se der ruim em qualquer ponto: `update qs_settings set value = 'false'::jsonb
where key = 'gloria_ativa';` — vale na mensagem seguinte, sem deploy.

## O caminho da mensagem

```
cliente escreve
  → Chatwoot → /api/wa-webhook (QS)         grava a mensagem no card, como sempre
      → avisa o n8n (POST /webhook/gloria-atendimento)
          → n8n responde "recebi" em 200ms  (o QS não fica esperando)
          → espera 8s                        (o cliente costuma mandar 3 mensagens seguidas)
          → pergunta ao banco: posso responder?
          → pensa (GPT + base de conhecimento)
          → POST /api/gloria-responder (QS)
              → sai pelo número oficial, cai na conversa certa,
                aparece na tela do SDR com o nome "Glória"
```

O ponto que importa: **o n8n nunca fala com o cliente**. Ele escreve, o QS envia.
É o que faz a mensagem da IA existir no card, na thread e na métrica, em vez de
existir só dentro de uma execução do n8n.

---

## O pipeline dela (e por que ele é o sandbox)

Um lead pertence ao atendimento por IA quando a **cadência dele** é a cadência
"Atendimento IA" — uma cadência de verdade do QS, com `execution_mode = 'ia'`
(a coluna existe desde a 0001 e nunca tinha sido usada). Isso resolve três
coisas de uma vez:

- **É o sandbox.** Só quem você colocar no pipeline é atendido pela IA
  (`gloria_so_pipeline = true`). Melhor que a lista de telefones do modo piloto:
  fica visível na tela, tem entrada e saída registradas, e o lead de teste vive
  separado da operação.
- **Não suja a fila do SDR.** A cadência de IA nasce **sem dias e sem
  atividades**, de propósito. Nenhuma tarefa de humano é criada, então esses
  leads não entram na fila do dia, não contam na métrica de toques e não
  empurram o rodízio.
- **Dá o acompanhamento.** Com todo mundo na mesma cadência, dá para olhar o
  funil da IA sozinho.

A tela é **Execução → Atendimento IA**. O quadro tem sete colunas, e **nenhuma
delas é um campo no banco**: a coluna é calculada pela view `qs_gloria_pipeline`
a partir do estado real (sessão ativa? quantas respostas? quantos toques? quem
falou por último?). Guardar a coluna seria guardar a mesma verdade em dois
lugares, e os dois divergem no primeiro caso estranho.

| Coluna | O que é |
|---|---|
| Nova | Ela entrou na conversa, nenhuma das 5 respondida |
| Qualificando | 1 a 4 das 5 |
| Em follow-up | O lead sumiu; a cadência está tocando |
| Qualificada | As 5 respostas |
| Devolvida ao time | Ela saiu e deixou nota + tarefa |
| Assumida por gente | Alguém do time respondeu e ela se desligou |
| Sem resposta | A cadência terminou e o lead não voltou |

Colocar um lead no pipeline **encerra as atividades pendentes do plano humano**
— é exatamente o que se está pedindo ao mover o lead. Reunião marcada e cliente
ganho não entram.

## A cadência dela

O que ela faz quando o lead some no meio da conversa. Antes disso, se o cliente
parava de responder depois de "quanto custa?", a conversa morria ali e ninguém
ficava sabendo.

| Quando | O que ela faz |
|---|---|
| +3h de silêncio | Retoma de onde parou, curto e leve |
| +8h | Traz **uma** informação nova da expedição e pergunta algo de sim ou não |
| +20h | Encerra com elegância e oferece falar com o time |
| passou de 24h | Devolve pro time, com nota e tarefa |

**Os três toques cabem dentro de 24 horas, e isso não é escolha de estilo.**
Pelo número oficial, texto livre só é entregue se o cliente falou nas últimas
24h; fora disso a Meta só aceita template aprovado — e template é decisão
comercial, não de IA. (A tabela `qs_gloria_passos` já aceita `tipo = 'template'`
para quando você quiser estender a cadência para os dias seguintes.)

Detalhes que valem saber:

- **O relógio conta do silêncio do lead**, não do toque anterior. Quem responde
  e some de novo recomeça a régua do zero.
- **Toque só sai entre 8h e 21h** (`gloria_toque_inicio` / `gloria_toque_fim`).
  Quem escreveu às 23h não recebe o "+3h" às duas da manhã.
- **Nada de cobrança.** O prompt proíbe "vi que você não respondeu", "ainda está
  aí?" e pedido de desculpa por insistir.
- **Quem decide QUANDO tocar é o banco** (`qs_gloria_fila_de_toques`); quem
  escreve o texto é a Glória, com o contexto da conversa na mão. O texto nunca é
  decorado — mensagem pronta em cima de conversa real soa pronta.

### Quem aciona a cadência (e por que não tem agendador)

O vigia dos números dependia de um agendador externo. Ele parou de disparar em
17/08 e ficou **dois dias sem ninguém notar**, porque silêncio parece "está tudo
bem". A cadência aqui não repete o erro: ela pega carona em duas coisas que já
acontecem.

1. **O webhook de cada mensagem que entra** (limite 2 por vez — o caminho do
   webhook não pode engordar).
2. **O QS aberto na tela de alguém**, de 5 em 5 minutos, na mesma batida do
   vigia — essa roda a fila inteira.

A trava de 5 minutos mora no banco, então mil abas abertas não viram mil
rodadas. Se quiser pendurar um agendador externo em `/api/gloria-toques` (com o
header `x-gloria-secret`), ele é a **terceira** perna — nunca a única. E nem faz
falta: os toques só saem das 8h às 21h.

---

## A base de conhecimento não vem do site

Vale a pena entender isto antes de mexer em qualquer coisa, porque é o que mudou
em 21/08 e é o que decide se ela sabe ou não responder.

O plano original era ela **ler o site**: baixar cada LP, tirar as tags e guardar
o texto. Não funciona. As LPs são React: o HTML que o servidor entrega é uma
casca vazia e o conteúdo só aparece depois que o navegador roda o JavaScript.
Medido nas 11 páginas do sitemap — **todas devolvem ~40 caracteres de texto**.
Nenhum preço, nenhuma data, nenhum roteiro.

A carga marcaria as 11 como "página curta demais" e a Glória entraria em produção
sabendo exatamente nada, respondendo "vou confirmar com o time" para toda
pergunta de valor, data ou roteiro. Que é o oposto do motivo de ela existir.

A fonte de verdade das LPs não é o HTML: é o `src/data/expedicao.ts` de cada uma.
Datas, faixa de investimento, incluso, não incluso, roteiro dia a dia e FAQ estão
todos lá, estruturados. O caminho passou a ser:

```
Setur Unificado (os dados das LPs)
  → scripts/gloria-fichas.mjs        escreve as fichas em texto
      → gloria_fontes (banco do QS)  dá pra ler e corrigir à mão, sem deploy
          → workflow "carregar a base de conhecimento"
              → gloria_documents     com embedding, é o que a IA busca
```

**Uma ficha por seção**, e não por página: resumo, investimento, incluso, não
incluso, roteiro, FAQ, por que ir com a agência. O pedaço que a busca devolve
chega sozinho no prompt — uma seção fechada ("Islândia 2027 — investimento: de
R$ 40.000 a R$ 44.000") se explica; um pedaço cortado no meio de uma página não
diz nem de qual expedição está falando, e é assim que a IA responde o preço da
viagem errada com toda a confiança do mundo. Por isso também toda seção começa
repetindo o nome e o ano.

Hoje são **102 seções, 15 páginas**: 10 expedições ativas, 4 pacotes e uma ficha
da agência com o catálogo (incluindo as saídas **esgotadas**, para ela não
oferecer turma que já fechou).

### Quando mudar preço, data ou roteiro numa LP

```bash
node scripts/gloria-fichas.mjs            # simula, mostra o que mudaria
node scripts/gloria-fichas.mjs --ver=islandia   # lê a ficha inteira antes
node scripts/gloria-fichas.mjs --apply    # grava em gloria_fontes
```

Depois abra o workflow **Glória — carregar a base de conhecimento** e clique em
*Test workflow*. Ele apaga a versão antiga de cada ficha antes de gravar a nova,
então rodar duas vezes não duplica nada.

O script lê o repo das LPs em `../Setur Unificado` (ou `--setur=CAMINHO`). Se um
arquivo estiver com conflito de merge pela metade, ele avisa e usa a última
versão commitada — a que está no ar — em vez de derrubar a carga inteira.

---

## Ordem de instalação

**1. Banco.** Supabase (projeto `eabfjomrnucymduqnbci`) → SQL Editor → cole
`0053_gloria_ia.sql` inteiro → Run. Depois `0059_gloria_pronta.sql` e
`0060_gloria_pipeline.sql`, nesta ordem.

Confira com um lead qualquer:

```sql
select qs_gloria_contexto('<uuid-de-um-lead>');
```

Tem que vir `pode_responder: false`, motivo `ia_desligada_no_qs_settings`. É o
comportamento certo — ela nasce desligada.

**2. Envs na Vercel** (Settings → Environment Variables) e no `.env` local:

```
GLORIA_SECRET=<gere um segredo longo, ex.: openssl rand -hex 24>
GLORIA_WEBHOOK_URL=https://SEU-N8N/webhook/gloria-atendimento
```

Enquanto `GLORIA_WEBHOOK_URL` estiver vazia, o WhatsApp funciona exatamente como
hoje e o QS nem tenta chamar a IA.

**3. Credenciais no n8n.** São três:

| Nome | Tipo | Conteúdo |
|---|---|---|
| `Header Auth account` | Header Auth | Header `x-gloria-secret`, valor = o `GLORIA_SECRET` |
| `Supabase account 2` | Supabase API | Host do projeto + **Service Role Key** |
| `OpenAI account` | OpenAI | a que você já tem |

Os arquivos já vêm com os ids das suas credenciais preenchidos — a importação
sai ligada. Não existe mais credencial de Postgres: a memória da conversa passou
a ser a Simple Memory, que não precisa de conexão.

**4. Importe os dois workflows** (n8n → ⋯ → Import from File) e **Save**.

Se você já tinha uma versão importada, **apague a antiga** — inclusive aquela em
que os dois workflows ficaram no mesmo canvas. Naquele arranjo a metade da carga
ficou sem gatilho nenhum e nunca rodaria.

No workflow de atendimento, confira que o nó **Config** aponta pro seu QS
(`https://qs.setuforeuvouviagens.com.br`).

**5. Carregue a base de conhecimento.**

```bash
node scripts/gloria-fichas.mjs --apply
```

Depois rode o workflow **Glória — carregar a base de conhecimento** (*Test
workflow*). No fim, o nó **Resumo da carga** diz quantas fichas entraram.

Confira:

```sql
select metadata->>'slug' as pagina, count(*) as pedacos
from gloria_documents group by 1 order by 1;
```

**6. Ative** o workflow de atendimento (o botão Active, no topo).

---

## Testar antes de ligar (modo teste)

O `Config` do workflow nasce com **`MODO_TESTE = true`**. Com ele ligado, a
Glória pensa, consulta a base, decide tudo — e **nada sai**: nenhum WhatsApp
para o cliente, nenhuma nota, nenhuma tarefa, nenhuma sessão pausada. As rotas
do QS devolvem o que *teriam* feito.

A trava mora nas rotas (`api/gloria-responder.js` e `api/gloria-transferir.js`),
não num desvio do workflow — e isso é de propósito: quem chama
`transferir_para_humano` é o **modelo**, no meio do raciocínio. Um IF no n8n não
seguraria essa chamada; a trava tem que estar em quem executa.

### Como rodar

1. Abra o nó **Lead de teste** e troque `COLE_AQUI_O_UUID_DE_UM_LEAD` pelo uuid
   de um lead de verdade (qualquer um — nada será enviado a ele).
2. Mude a mensagem para o que você quiser testar.
3. Clique em **Testar à mão** → *Execute workflow*.

O caminho manual passa pelos mesmos nós do caminho real. O único desvio é o
`Veio do webhook?`, que pula a resposta ao webhook — execução manual não tem
webhook para responder.

No nó **Enviar pelo QS** você vê a resposta:

```json
{
  "teste": true,
  "aviso": "MODO TESTE — nada foi enviado ao cliente e nada foi gravado.",
  "janela_de_24h_aberta": true,
  "baloes": [{ "ordem": 1, "texto": "Oi Ana! ...", "delay_ms": 2320 }]
}
```

Vale testar: objeção de preço, pergunta de roteiro (confira se o valor que ela
citou é o da expedição certa), lead pedindo para falar com humano, pergunta fora
da base, três mensagens seguidas, lead sem nome, e uma data esgotada.

---

## Ligar

São dois interruptores, e o segundo é o que importa no começo.

```sql
update qs_settings set value = 'true'::jsonb where key = 'gloria_ativa';
```

Com `gloria_so_pipeline = true` (o padrão da 0060), ligar a chave **não faz nada
sozinho**: ela só atende quem está no pipeline dela. Quem coloca é você, na tela
**Atendimento IA**. É esse o sandbox — e ele continua útil depois do sandbox,
porque é como se escolhe que fatia da base a IA atende.

Quando quiser soltar pra base inteira:

```sql
update qs_settings set value = 'false'::jsonb where key = 'gloria_so_pipeline';
```

Aí valem as outras duas travas: `gloria_so_conversa_nova` (não entra em conversa
que já tem SDR dentro) e, se quiser afunilar mais, `gloria_leads_piloto` com
telefones **só com dígitos**, do jeito que estão gravados no lead.

### O painel, numa consulta só

```sql
select
  (select count(*) from gloria_fontes where ativo)                              as fichas,
  (select count(*) from gloria_documents)                                       as pedacos_com_embedding,
  (select value #>> '{}' from qs_settings where key = 'gloria_ativa')           as ligada,
  (select value::text    from qs_settings where key = 'gloria_leads_piloto')    as piloto,
  (select value #>> '{}' from qs_settings where key = 'gloria_so_conversa_nova') as so_conversa_nova,
  (select value #>> '{}' from qs_settings where key = 'gloria_so_pipeline')       as so_pipeline,
  (select count(*) from qs_gloria_pipeline where no_pipeline)                    as no_pipeline;
```

`pedacos_com_embedding = 0` significa que ela não sabe preço nenhum. Não ligue
assim.

## Desligar no susto

```sql
update qs_settings set value = 'false'::jsonb where key = 'gloria_ativa';
```

Vale na mensagem seguinte, sem deploy e sem mexer no n8n. Para um lead só:

```sql
update qs_gloria_sessoes set ativa = false, motivo = 'desligada na mão'
 where lead_id = '<uuid>';
```

---

## As travas que estão de pé

- **Ela só atende quem está no pipeline dela.** (0060) É a trava do sandbox, e a
  única que se mexe pela tela: `gloria_so_pipeline`.
- **A cadência dela nunca passa das 24h.** Três toques e a conversa vira trabalho
  de gente, com nota e tarefa. Template quem dispara é humano.
- **Ela não entra em conversa que já tem gente do time dentro.** (0059) Se a
  primeira fala dela seria num lead onde alguém do time já respondeu, ela não
  começa. Sem isto, no minuto em que a chave é ligada, todo cliente que responde
  uma SDR ganha a IA por cima — inclusive negociação em andamento. Controlado por
  `gloria_so_conversa_nova`.
- **Humano respondeu, ela cala a boca.** No instante em que sai uma mensagem
  nossa que não é dela, a sessão daquele lead é desligada por gatilho no banco.
  A 0059 ensinou o gatilho a ignorar a assinatura `*Glória*` ao reconhecer o eco
  dela mesma — antes disso ela se desligava sozinha quando o webhook do Chatwoot
  chegava antes da nossa gravação.
- **Nunca responde duas vezes.** Se já saiu qualquer mensagem nossa depois da
  fala do lead, a execução para sozinha. É o que segura as três execuções que
  nascem quando o cliente manda três mensagens seguidas.
- **Não fala fora da janela de 24h.** Template aprovado é decisão comercial; a
  conversa volta pro time com tarefa.
- **Não baixa a tarefa do SDR.** A atividade do dia continua sendo do humano.
- **Áudio e imagem não são dela.** Mensagem sem texto nem chega no n8n.
- **Se der erro, chama gente.** OpenAI fora do ar, resposta vazia ou envio
  recusado pelo QS viram tarefa pro dono do lead, não silêncio.

## O que ela não faz (está no prompt, e é de propósito)

Não inventa valor, data ou vaga · não promete desconto · não confirma reserva ·
não pede CPF, documento ou pagamento · não oferece data esgotada · não nega ser
uma assistente virtual se o lead perguntar direto.

---

## O que estava quebrado (e por quê)

Ficou registrado porque quase tudo aqui é armadilha que só aparece com cliente de
verdade do outro lado.

### Do rascunho original

| O que | Por que quebrava |
|---|---|
| Resposta síncrona (`responseNode` no fim) | A função do QS na Vercel morre em 10s e o modelo leva de 10 a 40s. |
| Base apontando pra `documents` / `match_documents` | Tabela e função que não existem no banco do QS. |
| Bitrix com `SEU_PORTAL/SEU_TOKEN` | A qualificação ia pro nada. |
| `deal_id` escolhido pelo modelo | Modelo que escolhe id escreve no card de outra pessoa — e isso não dá erro, só estraga o dado alheio. |
| Qualificação num JSON montado pelo modelo | Uma aspa na fala do lead quebrava o corpo inteiro. |
| `.slice(0, 3)` nos balões | Descartava o resto da resposta em silêncio, e o que sumia costumava ser a pergunta da qualificação. |
| Sem trava de duplicidade / sem saber se um humano assumiu | A IA respondia por cima do SDR. |
| `temperature: 0.4` no gpt-5 | A família gpt-5 recusa valor diferente de 1 e devolve 400. |
| Webhook sem autenticação | Qualquer um com a URL faria a IA escrever pros seus leads. |

### Achado na revisão de 21/08

| O que | Por que quebrava |
|---|---|
| **Base de conhecimento lida do site** | As LPs são React: ~40 caracteres de HTML por página. Ela entraria em produção sem saber preço nenhum. |
| **`Enviar pelo QS` sem credencial** | O nó que entrega a resposta ao cliente ia sem o `x-gloria-secret`. O QS responde 401, o `neverError` deixa a execução VERDE e o lead nunca recebe nada. A falha mais silenciosa do workflow. |
| **`Wait` sem unidade** | O padrão do nó é **horas**. Um export que perca esse campo faz a Glória responder o lead 8 horas depois, sem erro em lugar nenhum. |
| **Memória sem chave de sessão** | A Simple Memory procurava um campo `sessionId` que não existe na entrada do agente: ou erro na primeira execução, ou uma memória só para todos os leads. |
| **Os dois workflows no mesmo canvas** | A metade da carga ficou sem gatilho nenhum — nunca rodaria. |
| **`topK: 20`** | 20 pedaços de expedições diferentes no mesmo prompt. É assim que ela cita o preço da viagem errada. |
| **Resposta vazia / envio recusado** | Iam para o nada: o lead esperando uma resposta que nunca vem, e ninguém sabendo. Agora viram tarefa. |
| **Erro da IA ignorava o modo teste** | Um teste criava tarefa de verdade na fila de alguém. |
| **IA entrando em conversa em andamento** | Ver a trava nova, acima. |
