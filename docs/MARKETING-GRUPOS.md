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
   - **Não existe mais** `MKT_GRUPOS_PRIVADO`: o chip é SÓ de grupos (09/11/2026).
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
| Celular: conversas, mensagens, responder, citar, reagir | Celular do MKT | `chat/findChats`, `chat/findMessages`, `sendText` + `quoted`, `sendReaction` | SÓ GRUPO. Conversa particular do número (lead que manda mensagem) não sai do servidor, não aparece e não é respondida — pessoa vai pela API oficial |

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

---

# Link inteligente + criar/gerenciar grupos (0342) — 09/11/2026

> Estado: **commits locais na branch `mkt-grupos-sendflow`, não pushados. 0342 NÃO
> aplicada.** Nenhuma chamada real à Evolution foi feita (testes usam fetch falso).
> O envio de campanhas continua DESLIGADO (nada aqui liga `MKT_GRUPOS_ENVIO` nem
> `envio_ligado`).

## O que é

A função de lançamento do SendFlow: **um endereço só** pra divulgar
(`https://qs.setuforeuvouviagens.com.br/g/japao-2027`). Cada pessoa cai no
**primeiro grupo da fila que ainda tem vaga**; quando ele lota, o próximo começa
a receber. Todos lotados: página "grupos lotados" (com a mensagem do link) **ou**,
se o link estiver em "criar o próximo grupo sozinho", o QS cria o próximo grupo
pela Evolution (nome numerado `Japão 2027 #{n}`, descrição, foto, admins, "só
admins mandam/editam") e põe no fim da fila.

Tela: **Marketing › Grupos › aba Links** (lista, editor e relatório) e, na aba
**Grupos**, os botões **+ Criar grupo** e **⚙ Gerenciar** (dados, pessoas,
convite, sair).

## Onde está

| Parte | Arquivo |
|---|---|
| Banco | `supabase/migrations/0342_mkt_grupos_link_inteligente.sql` |
| Rota pública `/g/<slug>` (sem login) | `api/mkt-grupos-link.js` + rewrite no `vercel.json` |
| Contagem de membros + criar o próximo grupo (cron) | `api/_mktGruposLink.js` |
| Criar/editar grupo, participantes, convite, sair (Evolution) | `api/_mktGruposGestao.js` |
| Regras puras | `api/_mktGruposLinkRegras.js` (espelho da tela: `src/mkt/grupos/linkRegras.ts`) |
| Ações novas | `api/mkt-grupos.js`: `criar_grupo`, `editar_grupo`, `participantes`, `participante`, `renovar_convite`, `sair_grupo`, `link_contar`, `link_criar_grupo` |
| Telas | `src/mkt/grupos/Links.tsx`, `GerenciarGrupo.tsx`, `linkLib.ts` |
| Testes | `tests/mkt-grupos/link.test.ts`, `tests/mkt-grupos/gestao.test.ts` |

## Como o "cheio" é calculado

`ocupação = membros (última contagem) + pendentes` — pendentes são cliques
**únicos** mandados pro grupo desde a última contagem. Superestima de propósito:
numa enxurrada o próximo grupo abre um pouco antes; na contagem seguinte os
pendentes zeram e o grupo volta a receber. Quem clica de novo (cookie de 24 h só
com um hash do grupo, nunca o jid) volta pro mesmo grupo sem ocupar vaga nova.
Robôs de prévia (WhatsApp, Instagram, Telegram…) não contam clique. A escolha é
atômica no banco (RPC `mkt_grupos_link_escolher` com `for update` no link).

## Contagem de membros (sem estourar a Evolution)

No cron que já existe (`GET /api/mkt-grupos`, a cada minuto), **antes** do motor,
com intervalo próprio por grupo (`mkt_grupos.contado_em`): link "quente" (clique
nos últimos 15 min) a cada 2 min, os outros a cada `MKT_GRUPOS_LINK_CONTAGEM_MIN`
(padrão 5); no máximo 8 grupos por rodada, uma chamada leve `group/participants`
por grupo, 0,8 s entre elas. O link de convite é relido a cada 6 h (se alguém
trocou no celular, o `/g/` não quebra). Tudo pela `evoMkt` (trava de instância).

## Evolution API v2 — endpoints usados

Conferidos no código-fonte oficial (github.com/EvolutionAPI/evolution-api:
`src/api/routes/group.router.ts`, `src/validate/group.schema.ts`,
`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`):

| Função | Endpoint | Corpo / resposta |
|---|---|---|
| Criar | `POST group/create/{inst}` | `{ subject, description?, participants[] (mín. 1) }` → metadados (`id`). `profilePicture` é ignorado no create → foto vai depois |
| Foto | `POST group/updateGroupPicture/{inst}?groupJid=` | `{ image: url https ou base64 }` |
| Nome | `POST group/updateGroupSubject/{inst}?groupJid=` | `{ subject }` |
| Descrição | `POST group/updateGroupDescription/{inst}?groupJid=` | `{ description }` (não aceita vazio) |
| Regras | `POST group/updateSetting/{inst}?groupJid=` | `{ action: announcement \| not_announcement \| locked \| unlocked }` |
| Pessoas | `POST group/updateParticipant/{inst}?groupJid=` | `{ action: add \| remove \| promote \| demote, participants[] }` → `{ updateParticipants: [{ status, jid }] }` (403 privacidade, 408 saiu há pouco, 409 já está) |
| Listar pessoas | `GET group/participants/{inst}?groupJid=` | `{ participants: [{ id, phoneNumber?, admin }] }` |
| Convite | `GET group/inviteCode/{inst}?groupJid=` | `{ inviteUrl, inviteCode }` |
| Link novo | `POST group/revokeInviteCode/{inst}?groupJid=` | `{ revoked, inviteCode }` (o antigo morre) |
| Sair | `DELETE group/leaveGroup/{inst}?groupJid=` | `{ groupJid, leave: true }` |
| Entradas/saídas | webhook `GROUP_PARTICIPANTS_UPDATE` | `{ id, action: add \| remove \| promote \| demote, participants[] }` |

## O que o Bruno precisa fazer

1. **Aplicar a 0342** (depois da 0243) e rodar a "CONFERÊNCIA" do fim do arquivo.
2. **Push/deploy** (o rewrite `/g/:slug` está no `vercel.json`).
3. Logado no QS: **Grupos › Chip do Marketing › "Apontar webhook"** de novo — a
   lista de eventos ganhou `GROUP_PARTICIPANTS_UPDATE` (sem isso, "Entraram/Saíram"
   do relatório fica zerado; a ocupação continua certa pela contagem).
4. Variáveis na Vercel (opcionais):
   - `MKT_GRUPOS_LINK_AUTO=1` — só se quiser que o QS **crie grupos sozinho** quando
     o link lotar (o link também precisa estar em "criar o próximo grupo"). Sem
     ela, o botão "Criar o próximo pelo modelo" faz na mão;
   - `MKT_GRUPOS_LINK_CONTAGEM_MIN` — intervalo da contagem (padrão 5, mínimo 2).
5. O chip do Marketing precisa ser **admin** dos grupos do link (só admin lê o
   link de convite). Hoje nenhum dos 24 grupos migrados tem `eu_admin` lido:
   abra ⚙ Gerenciar › Pessoas (ou "Ler dados no WhatsApp") pra atualizar.

## Como testar com segurança

1. Crie um grupo de teste em **Grupos › + Criar grupo** com 1 admin (você).
2. **Links › + Novo link** → `teste-link`, 2 vagas por grupo, "Mostrar grupos lotados".
3. No link, adicione o grupo de teste; abra `…/g/teste-link` no celular: cai no
   convite. Com "Contar membros agora" a ocupação aparece.
4. Abra numa janela anônima mais vezes: ao passar de 2 (membros + cliques), vira
   "Grupos lotados".
5. "Link novo" (renovar convite) e "Sair do grupo" só no grupo de teste.

Nada disso envia mensagem. Criar grupo e adicionar pessoa são ações do WhatsApp
(a pessoa adicionada vê que entrou num grupo) — use números do time.

## Limites conhecidos

- Abuso (alguém clicando sem parar sem cookie) enche os pendentes e pode abrir o
  próximo grupo antes; a contagem seguinte corrige. Criação automática tem teto
  (`limite_auto`) e, se falhar, a tentativa conta no teto e trava 5 min.
- A página "abrindo um grupo novo" recarrega a cada 30 s e cada recarga conta como
  clique em "lotado".
- Fora do escopo: rodízio entre chips, "lido por participante".
