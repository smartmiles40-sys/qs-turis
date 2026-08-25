# A voz da Glória — o que o time faz de verdade

Base: **150 conversas inteiras** (as 50 mais recentes de cada SDR que tiveram ida
e volta de verdade — mínimo 3 mensagens de cada lado), das quais **31 terminaram
em reunião agendada**, mais **3.258 mensagens enviadas** por Yanca, Victor Hugo e
Mariana. Extraído de `qs_wa_messages` em 24/08/2026.

Este arquivo existe porque "está parecendo uma IA" não é um defeito de opinião:
dá para medir. Cada regra do prompt novo sai de um número ou de uma frase que
apareceu literalmente na conversa de alguém que agendou.

## O que a régua diz

| | Yanca | Victor Hugo | Mariana |
|---|---|---|---|
| mensagens medidas | 1.296 | 1.322 | 640 |
| tamanho (q1 / mediana / p90) | 47 / **77** / 177 | 34 / **66** / 167 | 49 / **103** / 270 |
| com emoji | **41%** | 34% | **58%** |
| termina em pergunta | 58% | 42% | 40% |
| espaço antes do `?` (` ?`) | **43%** | 0% | 0% |
| textão (>300 caracteres) | 0% | 2% | 9% |

Emojis da casa, por frequência: ✈️ (558) 💚 (427) 😊 (371) 😁 (215) 🌎 (179)
🙂 (152) 😄 (137) 🚀 (88) 👀 (43) 📍 (25).

Primeira palavra do balão, por frequência: **Oiie / Olá / Oii** (769 somados),
Muito, Estou, Tudo, Boa, Bom, Você, **Maravilha** (70), **Perfeito** (52),
Podemos, Consegue, Essa, Sem, Certo, Qual, Faz, **Poxa** (23), **Excelente** (22),
Dito, **Showw** (16).

## Segunda rodada (24/08, depois do Bruno estressar ela)

Quatro achados que só aparecem conversando com ela de verdade:

6. **Ela escrevia tudo numa linha só.** Medido no corpus: **35% das mensagens de
   60 caracteres pra cima têm quebra de linha DENTRO do balão** (404 de 2.233 no
   total). É o que dá a leitura limpa — saudação numa linha, link na outra,
   pergunta na terceira. O prompt falava de balão e nunca de linha, então ela
   entregava parágrafo corrido.

   Isso tinha **metade de bug**: o nó `Quebrar em balões` só respeitava a quebra
   até 320 caracteres; acima disso ele recolava por frase com espaço e **apagava
   as quebras que o modelo tinha escrito**. Corrigido — agora a divisão respeita
   a linha primeiro e só quebra por frase a linha que sozinha estoura.

7. **Ela não sentia nada.** Reconhecer ("Perfeito", "Entendi") não é sentir.
   Ganhou seção própria com as reações reais do time: `Pooxa que legal!`,
   `Poxa vida, torço pra que dessa vez eles realmente queiram ir`, `Eu imagino,
   o Egito é estar literalmente dentro da história`, `Aí complicou kkkkk`. Regra
   nova: a reação tem que **provar que ela leu** — reação que serve pra qualquer
   frase não vale.

8. **Ninguém compra sem passar pela reunião.** Não estava escrito em lugar
   nenhum. Quem chega dizendo "quero fechar, manda o link" agora é comemorado e
   levado pro agendamento, não atendido no atalho.

9. **Qualificar passou na frente de agendar.** Isto **reverte a decisão de
   21/08** ("o foco dela é agendar em massa, o SDR confirma depois"). Motivo do
   Bruno: lead varado no comercial vira no-show, e no-show alto custa mais que
   agenda vazia. Entrou junto: "resposta desviada não é resposta" (desviou duas
   vezes de data ou investimento = é não), a lista do que **não** se agenda, e
   uma seção "Reunião que acontece" com o que o time faz pra pessoa aparecer
   (dois horários nunca uma lista, e-mail antes de fechar, "Podemos contar com a
   sua presença?", dizer que dura 30 a 40 min, quem decide junto na call).

## Os cinco diagnósticos — por que ela soava artificial

1. **Emoji de menos.** O prompt antigo limitava a 2 emojis na conversa inteira.
   O time põe emoji em **1 de cada 3 mensagens**. Nada denuncia mais um robô
   educado do que texto limpo demais.
2. **Faltava o balão de reconhecimento.** O time manda `Perfeito` sozinho, e só
   no balão seguinte vem o assunto. Ela respondia tudo num balão só, completo e
   bem construído — que é exatamente o que humano não faz no WhatsApp.
3. **Português certo demais.** Ninguém no time escreve "Oi". Escrevem `Oii`,
   `Oiie`, `Showw`, `muuito`, `Poxa`, `hahah`. E balão curto **não leva ponto
   final**.
4. **Os rituais não estavam escritos.** Abertura, preço, data e agendamento são
   quase o mesmo texto em toda conversa que deu certo. Estavam no prompt como
   ideia ("ofereça a reunião"), não como frase.
5. **Faltava exemplo.** Regra em prosa vira redação escolar. Conversa real
   colada no prompt vira imitação.

## Os rituais (verbatim, das conversas que agendaram)

**Abertura** — três balões, nessa ordem:
```
Oii {Apelido}, aqui é a Glória da Se Tu For Eu Vou Viagens 😄
Estou entrando em contato referente à expedição para {Destino}.
Vi no seu formulário que você já fez outras viagens, para {Destino} será a primeira vez ?
```

**Alinhamento de expectativa** — a melhor frase do acervo para segurar quem só
quer preço, sem parecer que está fugindo (apareceu 44 vezes):
```
Esse meu primeiro contato com você é mais pra fazermos um alinhamento de expectativa
e entender se a data e a faixa de investimento fazem sentido pra você
```

**Preço** — três balões, o terceiro obrigatório:
```
Ah certo, antes de te passar a faixa de investimento quero que você saiba que está incluso
aéreo, hospedagem, passeios, guias, tradutores, roteiro personalizado, suporte antes,
durante e depois da viagem
Dito isso a faixa de investimento fica em torno de R$ X a R$ Y
Faz sentido pra você esse valor?
```

**Data** — o pin é artefato da casa:
```
📍 Expedição {Destino} - {dd/mm} a {dd/mm}
Essa data faz sentido para você?
```

**Próximo passo** — três balões:
```
Bacana {Nome}, nosso próximo passo aqui seria agendar uma reunião com nosso especialista de viagem
Ele vai te apresentar o nosso roteiro, tirar suas dúvidas e apresentar todas as formas de pagamento
Em qual período você estaria mais livre entre amanhã e sexta-feira ?
```
E o funil de horário, sempre em dois degraus:
```
Manhã, tarde ou noite?
Qual horário faz mais sentido para você entre 14:00 e 17:00?
```

**Forma de pagamento**, quando insistem (sem abrir número):
```
Temos as formas de pagamento tradicionais, como no site: PIX e cartão de crédito
E dentro da reunião o especialista ainda te apresenta uma condição especial de pagamento 😉
```

## Duas decisões que mudaram (o Bruno pode vetar)

- **Emoji: de "2 na conversa inteira" para ~1 a cada 3 mensagens.** É o número
  medido do time. Era a trava principal do "parece IA".
- **` ?` com espaço antes.** Tique da Yanca (43% das mensagens dela), zero nos
  outros dois. Não é erro de digitação: é a marca de quem digita no celular com
  pressa, e é o detalhe que mais rápido tira a cara de robô. Adotado porque a
  persona da Glória é a da Yanca — acolhedora, puxa papo, comemora a viagem.

Se qualquer uma incomodar, é uma linha no prompt.

## Onde o prompt novo está

A verdade é o `systemMessage` do nó **Glória (IA)** dentro de
`gloria-atendimento.workflow.json`. Como o canvas do n8n já divergiu do repo
duas vezes (e custou horas nas duas), o mesmo texto está solto em
**`gloria-prompt.txt`**, só para abrir e colar no nó — é cópia gerada, não
edite lá. Para regerar depois de mexer no JSON:

```bash
node -e "const w=require('./n8n/gloria-atendimento.workflow.json');require('fs').writeFileSync('n8n/gloria-prompt.txt',w.nodes.find(n=>n.name==='Glória (IA)').parameters.options.systemMessage+'\n')"
```

## Como refazer esta medição

```bash
node scripts/gloria-corpus.mjs          # números + fraseário no terminal
node scripts/gloria-corpus.mjs --dump   # despeja as conversas inteiras em ./tmp
```

Vale repetir quando o time mudar de script, entrar SDR novo, ou quando ela
começar a soar estranha de novo. O corpus é a fonte da verdade; este arquivo é
só o resumo do que ele disse em 24/08/2026.
