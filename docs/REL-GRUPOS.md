# Grupos do WhatsApp no Relacionamento

Grupos do número do Relacionamento (+55 11 98012-4183) entram por uma instância
da Evolution **só de grupos** (`relacionamento-grupos-4183`, QR). Regra do
Bruno, sem exceção: **por essa ligação só GRUPO**. Nada sai pra pessoa:
"Conversar no privado" abre o número oficial; o convite é só um link copiado
(o `/group/sendInvite`, que manda no privado, não é usado).

## Onde está

| Parte | Arquivo |
|---|---|
| Rota (webhook, cron, ações antigas) | `api/rel-grupos.js` |
| Miolo: chamada à Evolution e travas (`grupoLiberado`) | `api/_relGruposEvo.js` |
| Lista, informações e participantes (rodízio) | `api/_relGruposSync.js` |
| Ações novas (info, participantes, convite, encaminhar, vínculo, agendadas) | `api/_relGruposMais.js` |
| Banco | migrations 0137, 0138, 0142, 0143, 0144, **0219** |
| Tela | `src/rel/atendimento/GruposPage.tsx`, `ConversaGrupo.tsx`, `InfoGrupo.tsx`, `GrupoExtras.tsx`, `VinculoGrupo.tsx` |
| Dentro da viagem | `src/rel/viagens/GruposDaViagem.tsx` |
| Front → servidor | `src/rel/lib/grupos.ts` |

Toda ação passa por `POST /api/rel-grupos` com login do Relacionamento ou admin
(`quemChama`). Toda chamada que manda ou muda algo no WhatsApp passa por
`grupoLiberado(jid)` (só `…@g.us` já conhecido e sem `saiu_em`).

## Antes de subir (ordem)

1. **Aplicar a 0219** no Supabase (`supabase/migrations/0219_rel_grupos_completo.sql`).
   O código aguenta o banco sem ela (lista e envio continuam), mas foto, fixar,
   vínculo, ✓✓ e agendadas só aparecem depois.
2. Na Evolution Manager → instância `relacionamento-grupos-4183` → Webhook:
   ligar também o evento **MESSAGES_UPDATE** (é ele que traz ✓✓ / azul).
3. **Agendadas**: só saem com `REL_GRUPOS_AGENDADAS=1` na Vercel. A regra antiga
   do Bruno era "nada de aviso automático em grupo nesse número" — por isso vem
   desligado. Desligado, a mensagem fica na fila (a tela avisa) e não sai.
4. O cron `/api/rel-grupos?cron=1` passou a rodar **a cada 5 min** (vercel.json).

## Por que o cron estourava 60 s

`/group/fetchAllGroups` busca a foto de cada um dos ~185 grupos, um depois do
outro, antes de responder. O cron agora **não chama mais** essa rota: manda as
agendadas vencidas e lê **4 grupos** por rodada com `/group/findGroupInfos`
(os de `info_em` mais antigo). Volta inteira em ~4 h, cada rodada < 45 s.
"Atualizar lista" (botão) ainda usa `fetchAllGroups` — sem participantes, com
prazo — pra descobrir grupo novo/saído; se a lista não vier no prazo, atualiza
um a um e avisa. Trava: lista vazia ou "saiu de mais da metade" não marca ninguém
como saído.

## Funções e teste manual

Teste num grupo de teste (ex.: "Teste") em que o número é admin. Abra
**Relacionamento → Grupos**.

| Função | Como testar | Evolution |
|---|---|---|
| Lista estilo WhatsApp (foto, não lidas, @, última msg, busca) | A lista mostra foto do grupo (depois do rodízio ou de abrir os dados), bolinha verde e "@". Busque pelo nome. | `findGroupInfos` (foto) |
| Filtros | Clique em Não lidas / Com viagem / Sem viagem. | — |
| Fixar no topo | Botão direito no grupo → Fixar. Vai pro topo com o alfinete, pra todo o time. | — (só QS) |
| Marcar como lida / não lida | Botão direito no grupo. Só no QS — o celular não muda. | — (só QS) |
| Texto | Escreva e Enter. Sai `*Seu Nome:*` na primeira linha. | `sendText` |
| Responder citando | Botão direito na msg → Responder → escreva. No celular aparece a citação. Funciona também com foto/arquivo. | `sendText`/`sendMedia` + `quoted` |
| @pessoa | Digite `@` e escolha. No celular a pessoa recebe a marcação. | `mentioned` |
| @todos | Digite `@` → primeira opção **@todos**. Todo mundo recebe notificação. | `mentionsEveryOne` (⚠️ testar) |
| Emoji / figurinha | Botão 😊. | `sendSticker` |
| Reagir | Botão direito → emoji. Tirar: clique de novo no mesmo. | `sendReaction` |
| Foto/vídeo/documento | 📎 → escolha. Foto abre o editor. > 3 MB sobe no storage e vai por URL. | `sendMedia` |
| Gravar áudio | Microfone → fala → enviar. | `sendWhatsAppAudio` |
| Apagar pra todos | Botão direito numa msg do número → Apagar para todos. | `DELETE chat/deleteMessageForEveryone` |
| Editar (até 15 min) | Botão direito numa msg de texto do número → Editar. | `chat/updateMessage` |
| Encaminhar | Botão direito → Encaminhar → até 5 grupos. Sai "↪ Encaminhada" assinado. Arquivo vai pela URL guardada. | `sendText`/`sendMedia`/`sendSticker` |
| Status ✓ / ✓✓ / azul | Mande uma msg: ✓ na hora; ✓✓ e azul quando a Evolution mandar `MESSAGES_UPDATE` (precisa ligar o evento). | webhook `messages.update` (⚠️ testar) |
| Ver mídias | Abra os dados do grupo (clique no topo) → "Mídia e documentos": grade de fotos/vídeos e lista de docs. Na conversa, foto abre o visualizador, áudio toca e transcreve. | — |
| Dados do grupo | Clique no topo da conversa (ou no ⓘ). Mostra foto, nome, descrição, participantes, admins. "Atualizar" lê de novo. | `findGroupInfos` |
| Mudar nome / descrição / foto | Nos dados do grupo: ✏️ no nome, "Editar" na descrição, clique na foto. Só aparece se o número é admin ou o grupo deixa todos editarem. | `updateGroupSubject` / `updateGroupDescription` / `updateGroupPicture` |
| Adicionar participante | Dados → Participantes → "+ Adicionar" → telefone com DDD. Se a pessoa bloqueia convites, vem o aviso pra mandar o link pelo número oficial. | `updateParticipant` add |
| Remover / promover / tirar admin | Clique no participante → opções (só se o número é admin). | `updateParticipant` remove/promote/demote |
| Link de convite | Dados → "Ver link de convite" → Copiar. "Gerar link novo" revoga o antigo. | `inviteCode` / `revokeInviteCode` (POST) |
| Ajustes do grupo | Dados → "Só admins mandam mensagens" / "Só admins mudam…". | `updateSetting` |
| Vínculo grupo ↔ viagem | Dados → Viagem: sugestões pelo nome do grupo (destino, G1/G2, ano, mês) ou busca por expedição/viagem/cliente. Na lista: **Ligar às viagens** mostra todos os grupos sem vínculo com a melhor sugestão (as fortes já vêm marcadas). | — |
| Grupo dentro da viagem | Abra a viagem: card "Grupos do WhatsApp" (os ligados à viagem ou à expedição dela). Clique abre o grupo. | — |
| Agendar mensagem | ⏰ no topo da conversa (ou Dados → Mensagens agendadas → + Agendar): texto, dia/hora, arquivo opcional, @todos. A lista mostra fila/enviada/erro e "Cancelar". Sai no cron (até 5 min de atraso) **se** `REL_GRUPOS_AGENDADAS=1`. | `sendText`/`sendMedia` |
| Conversar no privado | Clique no nome de quem escreveu (ou no participante). Abre o número OFICIAL. | — (nada pela Evolution) |

### O que a Evolution v2 não faz

- **Fixar mensagem** dentro do grupo: não existe rota (`sendPin` testado em 16/10 → não existe na 2.3.7).
- **Marcar como lida no celular**: existe (`chat/markMessageAsRead`), mas a instância foi criada com `readMessages=false` de propósito — não ligamos.
- **"Encaminhada" oficial** (a etiqueta cinza do WhatsApp): a Evolution não expõe `isForwarded`; vai como texto "↪ Encaminhada".

## Teste rápido do servidor (sem WhatsApp)

```bash
# cron (precisa do CRON_SECRET)
curl -H "Authorization: Bearer $CRON_SECRET" "https://qs-turis.vercel.app/api/rel-grupos?cron=1"
# → {"agendadas":"desligadas","lidos":4,"falhas":0}  (ou {"enviadas":n,"erros":n,…} com REL_GRUPOS_AGENDADAS=1)
```
