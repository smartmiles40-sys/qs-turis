# Figurinhas + Reações no WhatsApp do QS — o que foi feito e o que falta ligar

Pedido do Bruno em 06/08: (a) figurinha "como no WhatsApp", com galeria e ícone
de salvar/enviar; (b) reagir às mensagens e ver a reação do lead — em vez do
emoji solto que parece mensagem.

## O que já funciona SÓ com a migration (sem configurar nada)

Cole `supabase/migrations/0041_wa_figurinhas_reacoes.sql` no SQL Editor
(projeto `eabfjomrnucymduqnbci`) **antes do deploy** e:

- **Figurinha na conversa vira figurinha de verdade na tela**: imagem solta,
  sem bolha, como no celular.
- **Salvar figurinha**: passe o mouse numa figurinha da conversa → botão de
  salvar (ícone de marcador) → entra na SUA galeria.
- **Galeria**: botão novo de figurinha no rodapé da conversa (entre o emoji e o
  clipe). Um clique envia. O "+ Adicionar imagem" converte qualquer png/jpg em
  figurinha (512px, webp) no próprio navegador.
- **Reagir**: passe o mouse numa mensagem → carinha com "+" → 👍❤️😂😮😢🙏.
  A reação fica pendurada na bolha (pill), com o nome de quem reagiu no hover.
  Reagir de novo troca; o mesmo emoji remove. Todo mundo que abre a conversa vê
  (tempo real).

⚠️ Sem os passos abaixo, a reação do SDR fica **só no QS** (a tela avisa com
honestidade: "falta ligar a Evolution") e a reação do LEAD não chega.

## Ligar a reação de verdade (Evolution) — ~10 minutos

O Chatwoot não tem API de reação; quem fala com o WhatsApp é a **Evolution**
(a mesma do VPS que já move os números).

### 1. Envs na Vercel (projeto qs-turis → Settings → Environment Variables)

| Nome | Valor |
|---|---|
| `EVOLUTION_URL` | a URL da sua Evolution, ex.: `https://evo.setuforeuvouviagens.com.br` |
| `EVOLUTION_APIKEY` | a apikey global (Evolution Manager → Settings) |
| `EVOLUTION_INSTANCE` | o nome da instância (se só tem 1 número) |
| `EVOLUTION_INSTANCES` | **em vez** da de cima, se tem 2+ números: mapa caixa-do-Chatwoot → instância, ex.: `{"2":"setufor-01","5":"setufor-02"}` |
| `EVOLUTION_WEBHOOK_SECRET` | invente um segredo longo (pra reação do lead entrar) |

Marque Production + Preview, **Save** e **Redeploy** (sem redeploy nada muda).

> Os ids das caixas do Chatwoot são os mesmos do `CHATWOOT_WA_INBOX_IDS`.

### 2. Webhook na Evolution (a reação do LEAD entrando)

No Evolution Manager, **em cada instância** → Webhook:

- URL: `https://qs.setuforeuvouviagens.com.br/api/wa-evolution-webhook?secret=<o segredo do passo 1>`
- Evento: **MESSAGES_UPSERT** (só este — mensagem comum continua entrando pelo
  Chatwoot; o QS ignora tudo que não for reação)

### 3. Teste de 2 minutos

1. Mande uma mensagem pro lead de teste pelo QS.
2. No celular do lead, **reaja** a ela com ❤️ → a pill tem que aparecer na
   bolha do QS em segundos.
3. No QS, reaja a uma mensagem do lead com 👍 → tem que aparecer **no celular
   do lead** como reação (não como mensagem).
4. Anexe um `.webp` de figurinha → salve pela conversa → reenvie pela galeria.

## Como funciona por dentro (pra quem for mexer depois)

- `qs_wa_messages.source_id` = id da mensagem NO WhatsApp (o Chatwoot repassa;
  o webhook `message_updated` completa quando vem atrasado). É a chave que casa
  a reação com a mensagem.
- `qs_wa_messages.reactions` = jsonb `[{emoji, autor, nome}]`; `autor` é
  `'lead'` ou o uuid do usuário. Troca atômica via `qs_wa_react` (uma reação
  por autor, igual ao WhatsApp).
- `qs_wa_figurinhas` = galeria por SDR (RLS por dono). `dado` é data-url (subiu
  imagem) ou URL do Chatwoot (salvou da conversa). Enviar figurinha salva de
  conversa passa pelo servidor (`stickerUrl` no `/api/wa-send-media`) porque o
  CORS impede o navegador de baixar do Chatwoot — e o servidor só aceita URL do
  NOSSO Chatwoot (senão viraria proxy aberto).
- Reação nossa ecoa de volta no webhook da Evolution com `fromMe=true` e é
  ignorada (o QS já gravou na hora do clique).
- Mensagens de ANTES da 0041 não têm `source_id` → reagir nelas fica só no QS
  (a rota explica no `motivo`). Vai se resolvendo sozinho: toda mensagem nova
  entra com o id.

## Limites conhecidos (aceitos por ora)

- Reação feita pelo **celular da empresa** (não pelo QS) não aparece no QS —
  seria preciso distinguir o eco da nossa própria reação; raro e inofensivo.
- A pill mostra no máximo o resumo por emoji (👍 2) — sem tela de "quem reagiu"
  além do hover.
- Se a figurinha enviada chegar como IMAGEM no celular (limitação da ponte
  Evolution↔Chatwoot, pendência antiga da revisão de 05/08), o caminho é enviar
  figurinha pelo endpoint `sendSticker` da Evolution — as envs do passo 1 já
  deixam isso a um passo; me chama que eu ligo.
