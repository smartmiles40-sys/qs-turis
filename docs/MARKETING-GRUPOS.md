# Grupos do WhatsApp do Marketing (0243) — 30/10/2026

A Meta **não envia para grupo**. Por isso grupo fica no **chip do Marketing**, pela
Evolution (QR). Regra do Bruno: **grupo só por chip; massa para pessoa só pela API
oficial**. Esta frente traz para o QS o que o SendFlow (`~/sendflow`) já fazia com
grupos: conexão do chip, grupos com tags, campanhas agendadas, cadências,
recorrências e a caixa "Celular".

> Estado: **commit local, não pushado. 0243 NÃO aplicada.** Nada foi enviado a
> grupo nem a pessoa, e nenhuma rota de escrita da Evolution foi chamada.

## Onde está

| Parte | Arquivo |
|---|---|
| Banco | `supabase/migrations/0243_mkt_grupos.sql` (aditiva; rollback comentado no fim) |
| Rota (cron, webhook, ações) | `api/mkt-grupos.js` |
| Porta única da Evolution + trava | `api/_mktGruposEvo.js` |
| Motor (fila, agendamento, recorrência) | `api/_mktGruposMotor.js` |
| Regras puras (testadas) | `api/_mktGruposRegras.js` |
| Testes | `tests/mkt-grupos/regras.test.ts`, `tests/mkt-grupos/trava-evo.test.ts` |
| Telas | `src/mkt/grupos/` — `GruposPage`, `CampanhasPage`, `CadenciasPage`, `CelularPage`, `ConexaoPage` |
| Menu | `src/mkt/grupos/rotas.ts` → `ROTAS_GRUPOS` (grupo `disparos`) |

```bash
node --import ./tests/registrar-ts.mjs --test tests/mkt-grupos/*.test.ts
```

## A trava de instância (a regra que não pode falhar)

O Bruno: pela instância do Relacionamento **"de forma alguma deve sair mensagem"**.

**Como o QS identifica a instância do Rel:** pelo nome `relacionamento-grupos-4183`
(env `REL_GRUPOS_INSTANCIA`, padrão em `api/_relGruposEvo.js`) e pelo número
`5511980124183` (env `REL_GRUPOS_NUMERO`). As instâncias de SDR ficam em
`qs_wa_linhas.instancia` (hoje vazia). Não existe outra Evolution no QS.

A mesma regra mora em três lugares:

1. **JS, colada no fetch** — `evoMkt()` (`api/_mktGruposEvo.js`) é a única função do
   Marketing que chama a Evolution. Antes de cada chamada ela lê a instância
   configurada e roda `motivoBloqueioInstancia()`. Quem chama **não escolhe a
   instância**: passa só a rota (`message/sendText`), e o caminho é montado com a
   instância do MKT e conferido (`caminhoDaInstancia`). Mesmo uma "conexão"
   passada de fora é reconferida ali.
2. **Banco** — `mkt_grupos_motivo_bloqueio()` no gatilho de `mkt_grupos_conexao`
   (não deixa nem GRAVAR instância de outro setor), no gatilho da fila (linha não
   vai pra "enviando" por instância diferente da configurada ou proibida) e na RPC
   `mkt_grupos_reivindicar` (o motor só recebe a próxima linha se a trava passar).
3. **Webhook** — eventos de qualquer outra instância são ignorados.

É recusado:
- nome **sem** "marketing" ou "mkt";
- nome com outro setor: `relacionamento`, `comercial`, `closer`, `sdr`, `financeiro`,
  `operac…`, ou `rel` como palavra (`rel-x`, `x_rel`; `mkt-relampago` passa);
- `relacionamento-grupos-4183`, o que estiver em `REL_GRUPOS_INSTANCIA`,
  `MKT_GRUPOS_PROIBIDAS` (lista separada por vírgula), `mkt_grupos_bloqueios` e
  `qs_wa_linhas`;
- número do Rel (com ou sem o 9), `NUMEROS_PROIBIDOS`, números de `qs_wa_linhas` e
  `mkt_grupos_bloqueios`;
- opcional: com `MKT_GRUPOS_INSTANCIA` definida na Vercel, **só ela** passa.

Trocar a instância desliga o envio (`envio_ligado = false`) até alguém religar.

## Dois interruptores (os dois ligados = sai)

1. `MKT_GRUPOS_ENVIO=1` na Vercel — a chave do Bruno. Sem ela a fila fica parada.
2. "Ligar envios" na tela **Chip do Marketing** (só admin) — pausa operacional.

## O que o Bruno precisa fazer (ordem)

1. **Aplicar a 0243** no Supabase (`supabase/migrations/0243_mkt_grupos.sql`) e rodar
   a "CONFERÊNCIA" do fim do arquivo.
2. **Decidir a instância do MKT.** Hoje o chip do SendFlow é
   `numero-para-o-marketing--edmg0` (+55 11 5306-6577, 38 grupos em 18/09) e em
   06/10 apareceu outro chip "Marketing (consolidado)" (5511951757602) — confira na
   Evolution Manager qual é o NOME da instância desse segundo (o nome exibido não é
   o nome da instância). O nome precisa ter "marketing" ou "mkt".
3. Vercel (projeto do QS), variáveis:
   - `MKT_GRUPOS_SECRET` = texto aleatório com 16+ caracteres (assina o webhook);
   - `MKT_GRUPOS_INSTANCIA` = nome da instância (recomendado: fixa a trava);
   - se o MKT usar uma Evolution separada (plano do SendFlow, `evolution-mkt` em
     `/mkt`): `MKT_EVOLUTION_URL` e `MKT_EVOLUTION_APIKEY`. Sem elas, usa a mesma
     `EVOLUTION_URL`/`EVOLUTION_APIKEY` do QS;
   - `MKT_GRUPOS_ENVIO=1` **só quando for liberar o envio**;
   - opcional `MKT_GRUPOS_PRIVADO=1` (ver "Celular").
4. Push (deploy) e, logado como admin: **Marketing › Chip do Marketing** → nome da
   instância + número → Salvar → "Apontar webhook" → "Mostrar QR code" se
   desconectado.
5. **Grupos** → "Sincronizar com o WhatsApp". Criar tags, marcar grupos, aplicar.
6. Primeiro teste: campanha de texto para **um** grupo de teste em que o chip é
   admin, agendada para daqui a 2 min, com `MKT_GRUPOS_ENVIO=1` e envio ligado.

### Migração do SendFlow → QS (documentada, NÃO executada)

O SendFlow e o QS **não podem mandar pelo mesmo chip ao mesmo tempo** sem
coordenação (os dois motores não se enxergam; intervalo e janela viram a soma).

1. No SendFlow: pausar/cancelar as campanhas e recorrências de grupo pendentes
   (anotar quais eram, pra recriar no QS).
2. Exportar a lista de tags de grupo (`group_tags` + `group_tag_links`) se quiser
   levar: recriar no QS (tela Grupos) — não há importação automática.
3. A instância é a mesma: só apontar o **webhook** dela pro QS ("Apontar webhook"
   na tela). ⚠️ Isso tira o webhook do SendFlow (Evolution guarda 1 URL por
   instância) — o SendFlow para de ver "chegou" e o Celular dele continua lendo
   ao vivo.
4. Depois de uma semana rodando no QS, desligar a parte de grupos no SendFlow.

## Funções e como testar

| Função | Tela | Evolution | Observação |
|---|---|---|---|
| Estado / QR / webhook / desconectar | Chip do Marketing | `connectionState`, `instance/connect`, `webhook/set`, `instance/logout` | só admin; criar a instância é na Evolution Manager (rota sem instância no caminho é bloqueada pela trava) |
| Sincronizar | Grupos | `group/fetchAllGroups?getParticipants=false` | "saiu" só marca se a lista veio e não sumiram mais da metade |
| Tags com cor, filtro, aplicar/tirar em massa | Grupos | — | grava direto no banco (RLS) |
| Dados do grupo (nome, descrição, foto, participantes, admins, eu_admin) | Grupos → clicar | `group/findGroupInfos` | |
| Link de convite | Grupos → "Ver link de convite" | `group/inviteCode` (GET) | só lê; não há "gerar novo" aqui |
| Campanha: texto, imagem, vídeo, documento, áudio, enquete, @todos | Campanhas | `sendText`, `sendMedia`, `sendWhatsAppAudio`, `sendPoll` + `mentionsEveryOne` | arquivo vai pro bucket público `mkt-grupos` |
| Escolher grupos por tag ou um a um | Campanhas | — | destino vazio é ERRO (nunca "todos") |
| Agendar dia/hora; intervalo entre grupos | Campanhas | — | motor a cada minuto; janela do chip |
| Fila e "chegou ao grupo" | Campanhas → clicar | webhook `MESSAGES_UPDATE`/`SEND_MESSAGE` | não existe lido por participante em grupo |
| Pausar / retomar / cancelar | Campanhas → clicar | — | cancelar tira da fila quem não recebeu |
| Cadência (destino fixo + passos datados) | Cadências | — | cada passo é uma campanha |
| Recorrência (dias da semana + hora, de/até) | Cadências | — | gera campanha 24 h antes; cancela-se em Campanhas |
| Celular: conversas, mensagens, responder, citar, reagir | Celular do MKT | `chat/findChats`, `chat/findMessages`, `sendText` + `quoted`, `sendReaction` | resposta só em GRUPO; pessoa só com `MKT_GRUPOS_PRIVADO=1` e se ela escreveu primeiro |

### Comportamentos de segurança

- Linha presa em "enviando" (função caiu) vira **falha** depois de 5 min, com o
  aviso "confira no grupo" — **não reenvia** (repetida em grupo todo mundo vê).
- Erro permanente (não é admin, grupo não existe) não é repetido; erro passageiro
  tenta até 3 vezes.
- Grupo "só admins mandam" em que o chip não é admin fica de fora, com aviso.
- O conteúdo de uma campanha não muda depois que a fila foi montada (gatilho).
- O navegador não consegue pôr campanha em "enviando"/"concluída" (gatilho).

## O que a Evolution não faz (herdado do SendFlow)

- Lido/entregue por participante em grupo: não vem (`MessageUpdate` vazio na 2.3.7).
- Fixar mensagem: não existe na Evolution oficial (o SendFlow tem um fork `2.3.7-pin`).
- Votos da enquete: não são contados aqui.

## Cron

`vercel.json`: `/api/mkt-grupos` a **cada minuto** (`* * * * *`) — o QS já roda
crons de 3 e 5 min, então o plano é pago (no Hobby o cron é 1x/dia). Rodada de até
45 s (`maxDuration` 60). Teste:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://qs.setuforeuvouviagens.com.br/api/mkt-grupos"
# → {"parado":"MKT_GRUPOS_ENVIO desligado na Vercel — nada sai.",...}  enquanto não liberar
```
