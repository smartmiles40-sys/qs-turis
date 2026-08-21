# WhatsApp de quem não é lead — o que mudou (13/08/2026)

## O sintoma

`qs_wa_descartadas` acumulou **313 linhas em uma semana**: mensagens que chegaram
no webhook e não puderam ser vinculadas a nenhum lead. Nenhuma tela do app lia
essa tabela.

## O diagnóstico (medido na base de produção, não estimado)

Dos **50 números reais** com motivo `sem-lead-correspondente`:

| Quantos | O que era | Situação |
|---|---|---|
| 32 | **Corrida**: o cliente respondeu no mesmo minuto em que o Bitrix criou o negócio; a mensagem bateu no webhook segundos antes do lead existir no QS | A conversa acabou entrando — mas só porque alguém abriu o lead depois. Ninguém foi avisado em nenhum dos 32 |
| 13 | Existem no **Bitrix**, não no QS: cliente antigo do Comercial, pós-venda e três números do **próprio time** | Escreveram e ninguém viu |
| 5 | Não existem em lugar nenhum — gente nova de verdade | Escreveram e ninguém viu |

O motivo `inbox-fora-do-whatsapp` (caixa nova do Chatwoot) **parou sozinho em
10/08 19:29**, com o deploy do `892e095`. Aquele buraco está fechado.

## O que foi feito

**1. O nascimento do lead fecha a corrida.**
`resgatarConversaPerdida()` (em `api/_wa.js`) roda pendurada na criação do lead
em `createInboundLead`: se havia mensagem descartada esperando por aquele
telefone, a conversa é puxada do Chatwoot na hora e a thread é criada — sem
depender de alguém abrir o card.

É **best-effort de propósito**: Chatwoot fora do ar, migration não aplicada ou
contato inexistente devolvem `{resgatadas: 0, motivo}` e o lead entra igual.
Resgate que derruba a entrada de leads seria pior que a doença.

**2. Caixa de triagem** (aba WhatsApp → botão laranja "N sem lead", só gestão).
Lista quem escreveu sem ser lead, agrupado por número: nome que o WhatsApp
mostra, quantas mensagens, quando, por qual caixa. Duas saídas:

- **Criar lead** — nome editável, cadência opcional. O dono sai do rodízio
  (`owner_id` nulo → gatilho 0028), o `arrived_at` é a data em que a pessoa
  **escreveu**, e a conversa vem junto (`wa-sync`). Registra nota de origem.
- **Ignorar** — some da fila pra sempre.

Não vira lead automático de propósito: dos 18 de hoje, três são do próprio time
e vários são clientes antigos. Um card de prospecção pra cada colega ensinaria o
time a ignorar a tela inteira.

**3. O webhook passou a gravar o nome do contato** (`contato_nome`), pra triagem
ser uma lista de pessoas e não de telefones. O **conteúdo** da mensagem continua
não sendo guardado — a decisão de LGPD da 0038 vale.

## O que fazer pra ligar

1. Colar `supabase/migrations/0047_wa_triagem_desconhecidos.sql` no SQL Editor
   (projeto `eabfjomrnucymduqnbci`). **Sem isso nada disto funciona**: o resgate
   se desliga sozinho (loga "aplique a migration 0047") e a tela avisa que falta.
2. `git push origin main` → deploy.
3. Abrir a aba WhatsApp e tratar os 18.

Testado antes de entregar: a migration rodou contra uma **cópia da base real** em
Postgres (PGlite) — 1.386 leads, 313 descartes, 7.185 mensagens. Resultado:
38 linhas fechadas como resolvidas, 96 do healthcheck (`123456`) arquivadas,
**18 números na caixa de triagem**. Rodando duas vezes, zero linhas mudam.

O resgate em si só pode ser provado em produção: depende do
`CHATWOOT_AGENT_TOKEN`, que existe só na Vercel. O que foi verificado aqui é que
ele nunca lança exceção — testado sem telefone, com telefone inválido, sem
Chatwoot e sem a migration.

## Achado de lado, NÃO corrigido: 68 pessoas com card repetido

A chave canônica do telefone revelou **68 telefones com mais de um lead** no QS
(alguns com três). Vários em estados contraditórios:

```
Herica Carvalho   → um card "ganho", outro "perdido"
Andrea Bressan    → "nao_iniciado" num, "ganho" no outro
Rachel Paiva      → "perdido" num, "ganho" no outro
```

Quando isso acontece, a conversa de WhatsApp cai em **um** dos cards e o SDR pode
estar trabalhando o outro, que aparece mudo. Foi o que houve com 2 dos 32 da
corrida.

Não foi mexido porque juntar dois cards é decisão de negócio: qual nome fica,
qual dono, qual status vale, o que fazer com as tarefas e o histórico de cada
metade. A lista completa sai com a consulta no fim da 0047.

---

# ATUALIZAÇÃO 20/08/2026 — pergunta-se ao Bitrix antes de decidir

A regra deste documento (nunca criar automático, tudo pra triagem) **mudou**. O
que estava acima descreve o estado de 13–18/08; o que vale agora é isto.

## Por que mudou

A triagem manual resolvia a sujeira, mas criou um buraco pior: em 20/08 havia
**38 pessoas pendentes**, a mais antiga de 06/08, e a última tratada foi em
17/08. Elas escreveram para a agência e não existiam em lugar nenhum — nem no
QS, nem no Bitrix. Fila que ninguém trata é o mesmo que descartar, só que devagar.

## A regra nova

O erro era a pergunta, não a resposta. Não é "crio ou descarto?", é **"essa
pessoa já existe no Bitrix?"** — e quem sabe isso é o Bitrix. Quando um número
desconhecido escreve (`api/wa-webhook.js`, função `nascerDoWhatsApp`):

| Situação | O que acontece |
|---|---|
| Tem negócio no Bitrix | Lead nasce no QS **amarrado** a ele. Sem card novo, **sem cadência** — é cliente, não prospect |
| Não tem nada no Bitrix | Lead nasce no QS **e** ganha card (é gente nova de verdade) |
| Número do time | Ignorado |
| Mensagem **enviada** por nós | Ignorada — quem começou fomos nós |
| **Bitrix fora do ar** | Cai na triagem de sempre |

A última linha é a que segura o resto: sem resposta do Bitrix, "não achei" e
"não consegui perguntar" seriam a mesma coisa, e o QS voltaria a criar card às
cegas justamente quando não dá pra conferir. Ver `procurarNegocioPorTelefone`
em `api/_bitrixLead.js`, que devolve `{achou}` e `{indisponivel}` separados.

Isso cobre os dois grupos medidos em 13/08 — os **13 que já estavam no Bitrix**
(entram ligados, sem duplicar) e os **5 novos** (ganham card) — sem repetir os
~18 cards-lixo que motivaram o desligamento de 18/08.

O telefone é procurado em **4 formatos** (`55DDD9XXXXXXXX`, `55DDDXXXXXXXX`,
`DDD9XXXXXXXX`, `DDDXXXXXXXX`), porque "cliente já cadastrado com telefone em
outro formato" foi uma das causas da sujeira. Testado: os 4 formatos do mesmo
número convergem para o mesmo conjunto.

**A triagem continua existindo** e as 38 pendentes **não foram tocadas** —
decisão do Bruno em 20/08: a regra nova vale daqui pra frente, o passivo é
tratado à mão.

## Números do time

Vêm de `qs_users.whatsapp_number` mais a chave `wa_ignorar_numeros` em
`qs_settings` (lista de telefones em texto, para acrescentar exceção sem
deploy). **Hoje só 2 dos 9 usuários têm o número preenchido** — enquanto os
outros 7 não estiverem, um colega que escrever para a linha oficial vira lead.
Preencher na tela de usuários fecha isso.
