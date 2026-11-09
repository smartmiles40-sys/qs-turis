# Marketing › Automações ("igual ManyChat")

Frente: automações do WhatsApp do **número novo do Marketing** + Instagram.
Migration: **0244** (`supabase/migrations/0244_mkt_automacoes.sql`, rollback comentado no fim).
**Depende da 0242** (cria `mkt_contatos` e `mkt_contato_eventos`). Ordem: 0242 → 0244.

## O que muda em produção

| Peça | Antes | Depois |
|---|---|---|
| `api/_metaEntrada.js` | toda mensagem da Meta ia pro Comercial (ou Rel, se `setor='relacionamento'`) | **igual**, exceto número com `setor='marketing'`: esse vai pro motor do Marketing (`_mktAutoEntrada.js`, import dinâmico) e **não** passa pelo Comercial |
| `qs_wa_numeros_meta.setor` | `comercial` \| `relacionamento` | + `marketing` (check trocado na 0244) |
| Conexão da Meta (`_metaConexao.js`, `wa-config.js`) | setor comercial/rel | aceita `marketing` (sem dono). Telas do Comercial não listam o número MKT |
| `vercel.json` | — | cron `/api/mkt-automacoes?cron=1` **a cada minuto** + 2 funções novas |

Enquanto **nenhum número** tiver `setor='marketing'`, o desvio nunca dispara: Comercial e Relacionamento ficam byte a byte no caminho de antes. Isso é provado em `tests/mkt/roteamento.test.ts` (um `fetch` falso registra cada tabela tocada: número Comercial, número sem setor e número do Rel **nunca** tocam `mkt_*`; número do Marketing **não** toca `qs_*`/`rel_*` além de ler o número e o token).

O cron sem a 0244 aplicada: a consulta falha e ele devolve erro silencioso (não envia nada).

## Como funciona

- **Gatilhos** (`mkt_fluxo_gatilhos`): link de referência (`[ref:codigo]` no texto do wa.me/QR) > anúncio clique-para-WhatsApp (`referral.source_id`) > palavra-chave (prioridade) > boas-vindas (1ª mensagem) > resposta padrão (com intervalo). Clique em botão é roteado pelo id (`f:<execução>:<bloco>:<saída>`), e resposta esperada (Pergunta) vem antes de qualquer gatilho.
- **Blocos**: Mensagem (texto/mídia + botões/lista/link), Pergunta → campo, Template, Aguardar (com faixa horária de SP), Condição, Ações (tag, campo, lista = tag `lista:<nome>`, avisar humano → `qs_avisos`, pausar, webhook, opt-out), Teste A/B, Ir para, Fim.
- **Janela de 24 h**: texto/botões só com a janela aberta (margem de 2 min); fechada, a Mensagem sai pela saída "Janela de 24 h fechada" — ligue nela um Template.
- **Esperas** (`mkt_fluxo_execucoes.acordar_em`) acordadas pelo cron.
- **Idempotência**: `mkt_wa_mensagens.wamid` único — a Meta reenvia, o motor responde uma vez só.
- **Humano**: responder à mão em Conversas (ou pelo celular, na Coexistência = eco) **pausa o robô 12 h** naquela conversa. "PARAR" descadastra (`mkt_contatos.optout_whatsapp_em`).
- **Simular** (editor): roda o mesmo plano puro do motor e mostra o que sairia — **não envia**. **Testar no meu WhatsApp**: envia de verdade pro `whatsapp_number` do perfil de quem testa (com confirmação).
- **Webhook de LP**: `POST /api/mkt-automacoes?lp=<token>` com `{ telefone, nome?, email?, tags?, campos? }`. Comece esse fluxo por um **Template** (a pessoa ainda não escreveu).

Acesso: `mkt_auto_acesso()` = admin, papel `marketing`, gestor com setor comercial. As tabelas `mkt_*` têm RLS própria (a trava "marketing é só leitura" da 0036/0126 vale só para `qs_*`).

## Checklist do Bruno para ligar

1. Aplicar **0242** e depois **0244** (com ok).
2. Conectar o número novo: Marketing › Automações › "Número e robô" › Conectar pela Meta (perfil admin/gestor). Ele entra com `setor='marketing'`. **Não** escolher o número do Comercial nem o do Rel.
3. Conferir que o app da Meta já assina `messages` (é o mesmo webhook `/api/wa-calls` do Comercial — não precisa mudar nada no webhook).
4. Criar os modelos (templates) do número do Marketing na Meta, se for usar LP/Template.
5. Montar um fluxo, **Simular**, **Testar no meu WhatsApp**, ativar, criar o gatilho.
6. Plano da Vercel precisa aceitar cron por minuto (Pro). No Hobby, trocar o `schedule` para o que o plano deixar — as esperas atrasam até a próxima rodada.

## Instagram (vem DESLIGADO)

O webhook `/api/mkt-instagram` responde à Meta mas não grava nem responde nada enquanto `mkt_auto_config.instagram.ligado = false`. Para ligar:

1. Variáveis na Vercel: `MKT_IG_VERIFY_TOKEN` (qualquer texto longo, você inventa) e `MKT_IG_APP_SECRET` (o "segredo do app" do app do Instagram; sem ele usa `META_CALLS_APP_SECRET`).
2. App da Meta › produto **Instagram** › "API com login do Instagram":
   - Permissões: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.
   - Webhook: URL `https://<domínio do QS>/api/mkt-instagram`, token de verificação = `MKT_IG_VERIFY_TOKEN`.
   - Assinar: `comments`, `messages`, `messaging_postbacks`, `messaging_referral` (links ig.me), `mentions`.
   - A conta precisa ser Business ou Creator; em "Mensagens" do app do Instagram, ligar "Permitir acesso às mensagens".
3. Gerar o token da conta e colar em Marketing › Instagram › Situação (vai pro Vault `qs_mkt_ig_<id>`, nunca volta pra tela).
4. Criar as automações e clicar "Ligar o Instagram".

Regras da Meta: resposta privada a comentário = 1 DM por comentário, em até 7 dias; DM fora da janela de 24 h não sai.

### Fluxos no Instagram (09/11/2026, migration 0343)

- Cada automação do Instagram é um **fluxo** (`mkt_fluxos.canal = 'instagram'`), no mesmo editor do WhatsApp. Gatilhos: `ig_comentario` (palavra ou qualquer, todos os posts ou os escolhidos, resposta pública opcional), `ig_dm_palavra`, `ig_story_resposta`, `ig_story_mencao`, `ig_boas_vindas`, `ig_ref` (link ig.me).
- Tradução (`api/_mktIgRegras.js`): botões/lista → quick replies (até 13, título 20); link → button template (web_url); texto até 1000 bytes; mídia vira anexo (legenda vira 2ª mensagem). Template não existe no Instagram.
- Comentário: a 1ª mensagem do fluxo vai como resposta privada (`recipient.comment_id`); o resto só sai quando a pessoa responder (janela de 24 h). Se a Meta recusar os botões na privada, sai só o texto e a pessoa pode digitar o título do botão.
- As regras simples antigas (`mkt_ig_automacoes`) continuam como reserva quando nenhum fluxo combina; a tela tem "Converter em fluxo".
- Token: o cron (`/api/mkt-automacoes?cron=1`) renova o token longo quando faltam < 15 dias (`ig_refresh_token`); a tela mostra aviso quando vence em < 7 dias, venceu ou deu erro, e tem "Renovar agora".
- Links e QR: aba nas páginas WhatsApp e Instagram. O link divulgado é `<site>/e/<código>` (rewrite no `vercel.json` → `/api/mkt-automacoes?e=`), que conta o clique (robôs de prévia não contam; `?q=1` = veio do QR) e redireciona pro wa.me/ig.me.
- Relatório por fluxo: menu "⋯ › Relatório" no cartão e botão no editor (`mkt_auto_relatorio`).

## Arquivos

- Servidor: `api/_mktAutoRegras.js` (puro, testado), `api/_mktMotor.js`, `api/_mktAutoEntrada.js`, `api/_mktInstagram.js`, `api/mkt-automacoes.js`, `api/mkt-instagram.js`.
- Tela: `src/mkt/automacoes/` — `rotas.ts` (`ROTAS_AUTOMACOES`), `AutomacoesPage.tsx`, `EditorFluxo.tsx` (canvas à mão; no celular vira lista), `PainelBloco.tsx`, `Simulacao.tsx`, `ConversasPage.tsx`, `InstagramPage.tsx`.
- Testes: `tests/mkt/regras.test.ts`, `roteamento.test.ts`, `instagram.test.ts`, `instagram-fluxos.test.ts`.
- `saidasDoNo` existe em `api/_mktAutoRegras.js` **e** `src/mkt/automacoes/tipos.ts` — o teste de paridade quebra se divergirem.

## Limitações conhecidas

- QR Code: gerado no navegador com `qrcode-generator` (PNG/SVG para baixar).
- Conversas atualiza a cada 10 s (sem Realtime, de propósito, por egress).
- O link do aviso "avisar humano" é `#mkt/whatsapp?aba=conversas&c=<id>` (desde 30/10: Automações e Conversas viraram abas da página WhatsApp).
