# Modo aparelho — o WhatsApp volta pro celular do SDR (03/09/2026)

## O que aconteceu

A API oficial do WhatsApp (Cloud API da Meta) caiu. A decisão do Bruno foi não
esperar: **um celular para cada SDR**, com WhatsApp comum.

Um WhatsApp comum não tem API. Nenhum servidor manda mensagem por ele. Então o
QS parou de tentar enviar e voltou a fazer a única coisa que sempre funcionou —
**entregar o SDR dentro da conversa certa, com o texto certo já escrito, no
aparelho dele.** É o `wa.me`, que o WhatsApp abre direto no app instalado.

## O que NÃO mudou: o closer

O closer atende pelo **1935**, que é Evolution conectada por QR. Essa linha não
passa pela Meta e não caiu. Por isso o modo é **por papel**, não uma chave
global: virar tudo de uma vez derrubaria o atendimento de quem está trabalhando
bem. Ver `docs/LINHAS-DO-TIME.md`.

## Onde mora a regra

`src/lib/qs/waApp.ts` — um módulo só, e todas as telas perguntam pra ele.

Config em `qs_settings.wa_modo_app`:

```json
{ "ativo": true, "papeis": ["sdr"], "usuarios": [], "excecoes": [] }
```

- `papeis` — quem fala pelo aparelho.
- `usuarios` — uuids que vão pro aparelho **mesmo fora** dos papéis.
- `excecoes` — uuids que ficam no inbox do QS **mesmo dentro** dos papéis.
  Exceção vence tudo.

**Sem linha no banco, vale esse mesmo padrão.** É de propósito: a API caiu antes
de alguém poder configurar nada, e o SDR não pode ficar sem caminho pro cliente
esperando um admin abrir uma tela.

Edita em **Configurações → Atendimento → "Conversar pelo WhatsApp do celular"**.
Quando a API oficial voltar, é um clique pra desligar — não um deploy.

## O que muda na tela de quem está no modo aparelho

| Onde | Antes | Agora |
|---|---|---|
| Atividade de WhatsApp na fila | abria o inbox do QS com o roteiro escrito | abre a conversa **no celular** com o roteiro escrito |
| Botão WhatsApp no Painel / ficha do lead | modal com "Enviar pelo QS" | mesmo modal, com **"Abrir no WhatsApp"** — templates e edição continuam |
| Atividade "Ligar no WhatsApp" | discava pela Cloud API Calling | abre a conversa no celular; o botão de ligar do WhatsApp fica a um toque |
| Convite de reunião (pós-agendamento) | ia pro dock com o texto | vai pro celular com o texto |
| Aba/dock de WhatsApp | conversa completa | **histórico (só leitura)** + botão "Responder no WhatsApp" |
| Bloco de ligação e pedido de permissão | visível | **escondido** — sai pela mesma API que caiu |

## Três decisões que não são óbvias

**1. A atividade "Ligar no WhatsApp" voltou a aparecer pra todo mundo.**
A fila escondia essa atividade de quem não tinha autorizado a Meta a ligar
(regra de 01/09). No modo aparelho a ligação sai do celular do SDR — a
autorização da Meta não se aplica. Continuar escondendo seria sumir com trabalho
executável por causa de uma regra de um canal que não está mais em uso.
Contador e lista continuam usando a **mesma** função (`atividadeVisivel`), então
não volta o defeito de 13/08 (o contador cobrando o que a fila não mostra).

**2. O log grava `pending`, não `sent`.**
Quem aperta enviar é a pessoa, no aparelho dela. O QS só sabe que ela foi levada
até lá. Gravar "enviada" seria inventar um envio que pode nunca ter acontecido.

**3. `abrirConversaNoApp` é síncrona.**
`window.open` depois de um `await` perde o gesto do clique e o navegador do
celular bloqueia a janela — justamente onde este botão importa. Por isso a
assinatura do SDR chega **pronta por parâmetro** (o hook carrega na montagem da
tela) em vez de ser buscada na hora do clique. Nos poucos caminhos que não dão
pra ser síncronos (o convite de reunião monta o texto no banco antes), há um
fallback: janela bloqueada → navega na própria aba.

## O que ficou de fora e precisa de decisão

**A mensagem automática de primeiro contato continua saindo pela Cloud API**
(`api/_primeiroContato.js` → `enviarTemplate`). Com a API fora, todo lead novo
tenta, falha, e a linha em `qs_primeiro_contato` fica marcada como `falhou` — o
índice único do telefone bloqueia a retentativa depois. Ou seja: **cada lead que
chegar enquanto a API estiver fora queima o disparo pra sempre.**

Conserto imediato, sem código: **Configurações → Mensagem Automática → desligar.**
Com ela desligada, a função devolve `desligado` *antes* de reservar, e nada é
queimado. O primeiro contato passa a ser a atividade da cadência, na mão, pelo
celular — que é o que o resto deste documento acabou de habilitar.
