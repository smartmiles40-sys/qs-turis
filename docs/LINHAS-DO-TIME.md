# Linhas do time — cada papel com o seu número, dentro do QS

> Configurações → Atendimento → **Linhas do time**
> Migration `0056_linhas_do_time.sql` · agosto/2026

## O problema que isto resolve

O QS tinha **um** número para a empresa inteira, vindo de uma variável da Vercel
(`CHATWOOT_DEFAULT_INBOX_ID`). Enquanto só a SDR falava, funcionava.

Na virada pro closer, não. Ele recebe o lead depois da reunião marcada, precisa
continuar a conversa — e não tinha número no QS. Atendia pelo **celular dele**:

- a conversa não entra no histórico do lead (o closer seguinte começa do zero);
- não conta atividade nenhuma;
- vai embora junto com a pessoa no dia em que ela sair;
- e o cliente fica com dois interlocutores sem saber que são a mesma empresa.

## O estado medido em 20/08/2026

| | |
|---|---|
| Caixa 3 (API oficial da Meta) | **921 enviadas / 529 recebidas** nos últimos 4 dias — é por onde a operação inteira fala hoje, SDRs e closers |
| Caixa 2 (Evolution) | 50 enviadas, **nenhuma recebida**; última atividade 19/08 22:15 |
| Instância `WhatsApp - Api teste` | no ar |
| Instância `Comercial - SDRs (1595)` | **desconectada** |
| Instância `Comercial - Closers (1935)` | **desconectada** ← é esta que precisa voltar |

Ou seja: hoje os closers mandam mensagem pelo mesmo número das SDRs, ou pelo
celular. O 1935 existe e está fora do ar.

## Ligar o 1935 — passo a passo

**1. Conferir se o 1935 tem caixa no Chatwoot.** Abra a tela de Linhas. Se o
1935 aparecer na lista **"Número ligado que o QS não usa"**, ele existe na
Evolution mas não tem caixa — e sem caixa o QS não envia nem recebe por ele.
Nesse caso, no Chatwoot: Configurações → Caixas de entrada → Adicionar → **API**
(não "WhatsApp"; a Evolution entra como canal API), e depois aponte a integração
Chatwoot da instância `Comercial - Closers (1935)` para essa caixa.

**2. Amarrar a caixa à instância.** Na linha da caixa nova, escolha
`Comercial - Closers (1935)` no seletor *"WhatsApp na Evolution"*. Sem esse
vínculo o QS envia às cegas: a checagem de "número caído" não tem o que
conferir, e a mensagem morre entre o Chatwoot e o celular **sem erro nenhum** —
foi exatamente o que aconteceu no teste de 17/08.

**3. Conectar.** Botão **conectar (QR)** → escaneie no celular do 1935
(WhatsApp → Aparelhos conectados). A tela fecha sozinha quando pareia; o QR
expira em menos de um minuto, e o botão *gerar outro código* está ali do lado.

**4. Dizer quem fala por qual.**

| Papel | Número |
|---|---|
| SDRs | caixa **3** — a API oficial |
| Closers | a caixa do **1935** |
| Gestor / Admin | o que fizer sentido (em branco = padrão do servidor) |

**5. Salvar.** Vale na mensagem seguinte — o servidor guarda o mapa por até 1
minuto.

## A regra de roteamento

Nesta ordem:

1. **O atendente escolheu um número no topo do chat** → é esse, sem discussão.
2. **O cliente escreveu nas últimas 24h** → responde **na linha em que ele
   escreveu**, seja de quem for. Responder de outro número quem acabou de falar
   com a gente é o pior dos dois mundos: ele não vê resposta na conversa dele e
   recebe mensagem de um número estranho.
3. **Conversa nova, ou cliente calado há mais de um dia** → a linha de **quem
   está escrevendo**. É aqui que o closer assume o lead.
4. **Mapa vazio** → tudo como antes, pelo `CHATWOOT_DEFAULT_INBOX_ID`.

O passo 4 é a garantia de que subir este código não muda nada sozinho: enquanto
ninguém salvar o mapa, o comportamento é idêntico ao de hoje.

## Os três defeitos que a tela mostra sem ninguém procurar

- **Instância no ar sem caixa no Chatwoot** → o número funciona, mas o QS não
  recebe nem envia por ele; mensagem de cliente cai no vazio.
- **Caixa sem instância mapeada** → o QS envia às cegas (item 2 acima).
- **Instância `close`** → o número está fora do ar. Antes disso só se descobria
  pelo vigia, ou quando um cliente reclamava.

## Detalhes que custaram bug

- **O QR é o segredo mais forte deste módulo.** Quem vê o QR de um número pareia
  aquele WhatsApp no próprio celular e lê a conversa inteira do comercial — sem
  deixar rastro no QS. Por isso a rota só responde para **admin/gestor**.
- **`source_id` estrito.** Ao abrir conversa numa caixa escolhida, o QS agora
  exige a linha *daquela* caixa; se o contato ainda não tem uma, ele cria. O
  código antigo caía em `payload[0]` — com um número só era inofensivo, com dois
  viraria justamente o bug que estamos evitando: o closer manda pelo 1935 e a
  conversa nasce com o `source_id` do número da SDR.
- **`cw_inbox_id` na mensagem** (0056). Sem isso, com duas linhas no mesmo lead
  a bolha do 1935 e a do oficial ficam idênticas na tela e ninguém responde "o
  cliente respondeu pra quem?". Backfill sem chute: só carimbou onde dava para
  afirmar (9.156 mensagens); as 8.224 antigas ficam sem selo, que é honesto.
- **O mapa caixa→instância saiu da env.** Era `EVOLUTION_INSTANCES`, na Vercel:
  ligar um número novo exigia editar variável e redeployar, e até alguém fazer
  isso o QS achava que a caixa nova era a instância antiga — a checagem de
  "número caído" olhava o número errado. A env continua valendo como padrão.

## O que continua igual

- A janela de 24h da Meta vale **só** na caixa oficial. O 1935 é Evolution: não
  tem janela, e por isso o closer consegue abrir conversa sem template.
- Quem quiser trocar de número numa conversa específica continua podendo, no
  seletor do topo do chat.
- Toda a visibilidade segue governada pela RLS: linha nova não abre lead para
  ninguém que já não pudesse ver.
