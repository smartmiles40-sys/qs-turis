# Ligar pelo WhatsApp: a permissão do cliente

Runbook da ligação pelo número oficial (Cloud API Calling) no QS.
Escrito em 01/09/2026, quando a Wavoip saiu e a ligação passou a ser 100% pela Meta.

---

## O que muda em relação a mandar mensagem

São coisas diferentes, e confundir as duas custa tempo:

| | Mensagem | Ligação |
|---|---|---|
| O que libera | janela de 24h (o cliente escreveu) | **permissão explícita** do cliente |
| Fora disso | dá pra usar template | **não tem template que resolva** |
| Erro quando falta | 131047 | **138006** |

Não existe "ligar assim mesmo". Se a pessoa não autorizou, a Meta recusa — e o
SDR só descobria isso depois de clicar, liberar o microfone e esperar. Foi pra
matar essa espera que a permissão virou dado no QS.

---

## Como a permissão entra no QS (três fontes)

Tudo cai na tabela `qs_call_permissions`, com **chave no telefone** — a permissão
é da pessoa com o número da empresa, não do cadastro. Dois leads duplicados com o
mesmo telefone compartilham a mesma permissão, e têm que compartilhar.

**1. O cliente respondeu ao pedido** — `fonte: resposta-do-cliente`
O evento `call_permission_reply`. Chega sozinho, por webhook, em `/api/wa-calls`.
Diz se foi "Permitir" (permanente, não expira) ou "Permitir por enquanto"
(temporária, 7 dias).

> ⚠️ Esse evento **não viaja no campo `calls`**. Ele é uma mensagem interativa e
> viaja no campo **`messages`**. Por isso o app `qs_call` assina os dois campos no
> App Dashboard da Meta. Se alguém desmarcar `messages`, o QS para de saber quem
> liberou — e não dá erro nenhum, só silêncio.

**2. O cliente ligou pra empresa** — `fonte: ligacao-do-cliente`
Com `callback_permission_status: ENABLED` (que é como o número está), quem liga
pra empresa autoriza a empresa a ligar de volta. É a permissão mais barata que
existe, e o lead que liga é o mais quente da fila. Gravada como **inferência**
(`confirmado: false`, 7 dias): a doc afirma a regra mas não publica a validade.

**3. Perguntando pra Meta** — `fonte: api`
`GET /{phone_number_id}/call_permissions?user_wa_id=...`. É a verdade, mas custa
uma ida à Graph API por lead: serve pra decidir **uma** ligação, nunca pra varrer
a fila.

### A divisão de trabalho entre elas

As fontes 1 e 2 chegam sozinhas e mantêm a fila pintada **de graça**.
A fonte 3 é a conferência do clique, dentro do `/api/wa-config`.

É isso que deixa o botão ser **otimista** sem mentir: a tabela é sempre uma foto
(a pessoa pode revogar nas configurações do WhatsApp e a Meta não avisa ninguém),
então quem decide de verdade é o servidor, na hora de discar.

**E "não consegui ler" nunca vira "sem permissão".** Se a consulta falhar, o botão
continua liberado. O custo de um falso "pode" é um erro tratado; o de um falso
"não pode" é a operação inteira sem telefone.

---

## O que o SDR vê

Na **fila** e no **modal do lead**, o botão de ligar tem três estados:

- **verde "Ligar no WhatsApp"** + o prazo colado (`6 dias`) → pode ligar;
- **âmbar "Pedir permissão pra ligar"** → clicar manda a pergunta no WhatsApp;
- **cinza "Permissão pedida — aguardando"** → já pedimos nas últimas 24h.

O cinza não é frescura: **a Meta só aceita 1 pedido por 24h por pessoa**.
Insistir queima o limite sem chegar a lugar nenhum.

Quando a Meta recusa com 138006, o botão vira âmbar **na hora** — sem esperar
recarregar a tela.

---

## A cadência de quem liberou

**Configurações → Ligação pelo WhatsApp → "Cadência de quem liberou a ligação".**

Escolhida a cadência, todo cliente que autorizar recebe as atividades dela no
instante da resposta. Nasce **desligada** (opção "Desligado — só registra a
permissão").

**As atividades são ACRESCENTADAS — o lead não sai da cadência em que está.**
Ele continua com o mesmo dono e a mesma cadência de prospecção; só ganha a
atividade de ligar por cima. É isso que permite tirar o "Ligar no WhatsApp" da
cadência do SDR (onde poluía a métrica com trabalho que quase ninguém podia
executar) sem tirar o lead de ninguém.

As duas travas:

- lead **ganho ou perdido** não recebe;
- lead que **já tem atividade dessa cadência em aberto** não recebe de novo — uma
  segunda autorização (a pessoa reabre o pedido, a Meta reentrega o webhook) não
  duplica a fila.

> Como a permissão temporária dura 7 dias, vale a cadência ser curta e começar no
> mesmo dia. Quem não ligar dentro da janela precisa pedir permissão de novo.

> ⚠️ Tirar a atividade da cadência do SDR **não apaga as que já foram geradas**.
> As tarefas antigas continuam pendentes no banco; some da cadência quem ainda
> não passou por ela.

---

## Os limites da Meta, na ordem em que atrapalham

1. **Pedido exige conversa aberta de 24h.** Quem nunca respondeu **não pode nem
   receber** o pedido — e é justamente o lead de formulário que a SDR mais quer
   ligar. Primeiro faz o lead responder; depois pede permissão.
2. **1 pedido por 24h e 2 por semana**, por pessoa.
3. **Permissão temporária: 7 dias.** "Permitir" é permanente.
4. **5 chamadas atendidas por 24h** com a mesma pessoa. Estourou, o QS diz que é
   limite — e **não** oferece pedir permissão de novo (ver o sintoma abaixo).
5. **4 não atendidas seguidas revogam** a permissão sozinhas.
6. A pessoa revoga quando quiser, e **a Meta não avisa**.

---

## Quando alguma coisa não funcionar

**"Deu erro dizendo que o limite das últimas 24h foi atingido"**
Não é falta de permissão — é o **teto de 5 chamadas atendidas por 24h** com aquela
pessoa. O botão continua verde de propósito: pedir permissão a quem já autorizou
não conserta nada e ainda **queima o limite de 1 pedido por dia**, que é a bala
que você vai querer amanhã. O conserto é esperar.

> Essa distinção é feita no servidor: a Meta responde `can_perform_action: false`
> para as duas situações, e só o `status` da permissão separa uma da outra.

**"O botão está âmbar mas eu sei que o cliente liberou"**
A tabela é uma foto. Abra o lead: o modal consulta a Meta ao ligar e regrava.
Se persistir, `Configurações → Ligação pelo WhatsApp → "Posso ligar pra esse
número?"` pergunta direto pra Meta.

**"Ninguém aparece como liberado"**
Confira em `Configurações → Ligação pelo WhatsApp` a linha de campos assinados:
tem que listar **`calls` e `messages`**. Sem `messages`, a fonte 1 nunca chega.

**"A ligação conecta e ninguém ouve"**
É rede. A Meta é `ice-lite` (só responde, nunca procura caminho) e não temos TURN:
o navegador precisa alcançar `157.240.x.x:3480/UDP`. O widget avisa e sugere 4G.
Testar pelo 4G do celular confirma em 30 segundos.

**"Chegou webhook? A porta recebeu alguma coisa?"**
O log da Vercel em `/api/wa-calls` diz, em cada linha, **quais campos vieram**.
Um `POST 200` **sem linha nenhuma** é o caso normal: mensagem comum que não é
resposta de permissão, ignorada de propósito (quem cuida de conversa é o
`wa-webhook`).

> O log da Vercel estoura o tempo em consulta filtrada de janela larga. Use
> janelas de 10–15 minutos.

---

## Onde está cada coisa

| Arquivo | Papel |
|---|---|
| `supabase/migrations/0070_permissao_de_ligacao.sql` | tabela, função `qs_permissao_vale`, chave da cadência |
| `api/_permissaoLigacao.js` | a regra inteira no servidor (as 3 fontes, a cadência) |
| `api/wa-calls.js` | a porta da Meta: eventos de chamada **e** respostas de permissão |
| `api/_meta.js` | fala com a Graph API (`call_permissions`, `calls`, pedido) |
| `api/wa-config.js` | ações `calling-*`; confere a permissão antes de discar |
| `src/lib/qs/permissaoLigacao.ts` | a mesma regra no navegador, em lote pra fila |
| `src/lib/qs/waCall.ts` | a ligação em si (SDP, áudio, estado) |
| `src/components/sdr/tasks/TasksPanel.tsx` | os botões da fila |
| `src/components/sdr/whatsapp/WhatsAppModal.tsx` | o botão e o selo no modal do lead |
| `src/components/sdr/settings/LigacaoWhatsApp.tsx` | diagnóstico, teste e a cadência |
