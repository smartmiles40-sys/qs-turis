# Glória — a IA que atende no WhatsApp

Dois workflows, uma migration e duas rotas novas no QS. A Glória responde o lead
no WhatsApp, tira dúvida com o conteúdo do site, faz as 5 perguntas de
qualificação e devolve a conversa pro time.

| Arquivo | Para quê |
|---|---|
| `gloria-atendimento.workflow.json` | O atendimento. Fica **ativo**, o QS chama a cada mensagem. |
| `gloria-base-conhecimento.workflow.json` | Carrega o site na cabeça dela. Roda quando você clica. |
| `../supabase/migrations/0053_gloria_ia.sql` | As tabelas, as regras e o interruptor. |
| `../api/gloria-responder.js` | O n8n manda o que ela escreveu; **quem envia é o QS**. |
| `../api/gloria-transferir.js` | Ela sai da conversa e o time entra (nota + tarefa). |

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

## Ordem de instalação

**1. Banco.** Supabase (projeto `eabfjomrnucymduqnbci`) → SQL Editor → cole
`supabase/migrations/0053_gloria_ia.sql` inteiro → Run.

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
hoje e o QS nem tenta chamar a IA. Dá pra subir o código antes de estar pronto.

**3. Credenciais no n8n.** São quatro. Nenhuma vai dentro do JSON — os arquivos
trazem `SUBSTITUA_...` no lugar do id e você escolhe a credencial na tela.

| Nome | Tipo | Conteúdo |
|---|---|---|
| `Glória (x-gloria-secret)` | Header Auth | Header `x-gloria-secret`, valor = o `GLORIA_SECRET` |
| `Supabase QS (service_role)` | Supabase API | Host `https://eabfjomrnucymduqnbci.supabase.co`, Service Role Key do `.env` |
| `Postgres QS (Supabase pooler)` | Postgres | ver abaixo |
| `OpenAI account` | OpenAI | a que você já tem |

A do Postgres (só a memória da conversa usa) sai do Supabase → Project Settings →
Database → **Connection string → Session pooler**:

```
Host      aws-0-<região>.pooler.supabase.com
Port      5432
Database  postgres
User      postgres.eabfjomrnucymduqnbci
Password  a senha do banco
SSL       require
```

Use o **pooler**, não a conexão direta: o n8n abre e fecha conexão o tempo todo e
a direta tem limite baixo — o sintoma é a memória falhar de vez em quando, que é
o pior jeito de falhar.

**4. Importe os dois workflows** (n8n → ⋯ → Import from File), escolha as
credenciais em cada nó marcado e **Save**.

No workflow de atendimento, confira que o nó **Config** aponta pro seu QS
(`https://qs.setuforeuvouviagens.com.br`).

**5. Carregue a base de conhecimento.** Abra
`Glória — carregar a base de conhecimento` e clique em **Test workflow**.

Ele tenta o `sitemap.xml` do site; se não achar, abra o nó **Lista de páginas** e
cole os endereços das LPs na `LISTA_MANUAL`. No fim, o nó
**Páginas que não carregaram** mostra o que ficou de fora — cada item ali é uma
expedição que a IA não vai saber responder.

Confira:

```sql
select metadata->>'url' as pagina, count(*) as pedacos
from gloria_documents group by 1 order by 2 desc;
```

**Rode este workflow de novo toda vez que mudar preço, data ou roteiro numa LP.**
Ele apaga a versão antiga daquela página antes de gravar a nova, então rodar duas
vezes não duplica nada.

**6. Ative** o workflow de atendimento (o botão Active, no topo).

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

### O que dá para testar assim

Objeção de preço, lead pedindo para falar com humano (a IA chama
`transferir_para_humano` e você vê o que ela transferiria), pergunta fora da
base, três mensagens seguidas, lead sem nome. Rode quantas vezes quiser: como
nada é gravado, não há o que limpar depois.

### Quando for para produção

`MODO_TESTE = false` no nó **Config**. Continue no piloto (abaixo) antes de
soltar para a base inteira — as duas travas são independentes.

## Ligar

Nada acontece até você ligar a chave. Recomendado: comece pelo piloto, com o seu
próprio número.

```sql
-- só estes telefones são atendidos pela IA
update qs_settings set value = '["5562999990001"]'::jsonb where key = 'gloria_leads_piloto';
update qs_settings set value = 'true'::jsonb            where key = 'gloria_ativa';
```

Quando estiver bom, esvazie o piloto e ela vale pra todo mundo:

```sql
update qs_settings set value = '[]'::jsonb where key = 'gloria_leads_piloto';
```

## Desligar no susto

```sql
update qs_settings set value = 'false'::jsonb where key = 'gloria_ativa';
```

Vale na mensagem seguinte, sem deploy e sem mexer no n8n. Para um lead só:

```sql
update qs_gloria_sessoes set ativa = false, motivo = 'desligada na mão'
 where lead_id = '<uuid>';
```

## As travas que já estão de pé

- **Humano respondeu, ela cala a boca.** No instante em que sai uma mensagem
  nossa que não é dela, a sessão daquele lead é desligada por gatilho no banco.
  Ninguém precisa lembrar de desligar nada.
- **Nunca responde duas vezes.** Se já saiu qualquer mensagem nossa depois da
  fala do lead, a execução para sozinha. É o que segura as três execuções que
  nascem quando o cliente manda três mensagens seguidas.
- **Não fala fora da janela de 24h.** Template aprovado é decisão comercial; a
  conversa volta pro time com tarefa.
- **Não baixa a tarefa do SDR.** A atividade do dia continua sendo do humano —
  se a IA a concluísse, o toque apareceria feito e ninguém olharia a conversa.
- **Áudio e imagem não são dela.** Mensagem sem texto nem chega no n8n.
- **Se der erro, chama gente.** OpenAI fora do ar vira tarefa pro dono do lead,
  não silêncio.

## O que ela não faz (está no prompt, e é de propósito)

Não inventa valor, data ou vaga · não promete desconto · não confirma reserva ·
não pede CPF, documento ou pagamento · não nega ser uma assistente virtual se o
lead perguntar direto.

Essa última mudou em relação ao rascunho: o texto original mandava ela nunca
dizer que é uma IA. Quem pergunta "isso é um robô?" já desconfiou, e ser pego
mentindo custa mais caro do que assumir — agora ela assume e oferece passar pra
uma pessoa na hora.

## O que estava quebrado no rascunho

Ficou registrado porque quase tudo aqui é armadilha que só aparece com cliente de
verdade do outro lado.

| O que | Por que quebrava |
|---|---|
| Resposta síncrona (`responseNode` no fim) | A função do QS na Vercel morre em 10s e o modelo leva de 10 a 40s. A resposta chegaria depois de ninguém estar mais ouvindo. |
| Memória Postgres sem credencial | O nó estava sem conexão nenhuma — primeira execução, erro. |
| Base de conhecimento apontando pra `documents` / `match_documents` | Tabela e função que não existem no banco do QS. Toda dúvida factual voltaria vazia e a IA responderia de cabeça. |
| Bitrix com `SEU_PORTAL/SEU_TOKEN` | A qualificação ia pro nada. Agora ela é gravada primeiro no QS, que é onde o SDR trabalha. |
| `deal_id` escolhido pelo modelo | Modelo que escolhe id escreve no card de outra pessoa — e isso não dá erro, só estraga o dado alheio. Agora vem do workflow. |
| Qualificação num JSON montado pelo modelo | Uma aspa na fala do lead quebrava o corpo inteiro. Agora é um parâmetro por campo. |
| `.slice(0, 3)` nos balões | Descartava o resto da resposta em silêncio, e o que sumia costumava ser a pergunta da qualificação, que vem no fim. Agora sobra colada no último balão. |
| Sem trava de duplicidade | Três mensagens do cliente = três respostas por cima uma da outra. |
| Sem saber se um humano assumiu | A IA respondia por cima do SDR. |
| Sem tratamento de erro no agente | Erro no meio = lead falando sozinho, sem ninguém saber. |
| `NECESSARIO_TEMPLATE` como texto de resposta | Depender de o modelo escrever uma palavra mágica exata. Agora quem sabe da janela é o banco. |
| `temperature: 0.4` no gpt-5 | A família gpt-5 recusa valor diferente de 1 e devolve 400. |
| Webhook sem autenticação | Qualquer um com a URL faria a IA escrever pros seus leads. Agora é Header Auth. |
