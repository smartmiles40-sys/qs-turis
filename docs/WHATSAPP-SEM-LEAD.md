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
