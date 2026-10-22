# Avisos na tela (sino, bip e bolinha flutuante)

Migration **0196_avisos.sql** · cron **/api/avisos** (a cada 5 min) · código em **src/avisos/**.

Pedido do Bruno (22/10/2026): "um widget pra notificar toda atualização — um bip na tela; toda vez
que a pessoa tiver uma nova solicitação aparece na tela do computador dela; ícone bem pequeno que a
pessoa arrasta pela tela".

## O que gera aviso

Cada pessoa só recebe o que é dela. Quem fez a ação nunca recebe o aviso da própria ação.
O mesmo aviso nunca chega 2 vezes: cada um tem uma chave única por pessoa.

### Central de Solicitações (na hora, por gatilho no banco)

| Acontece | Quem é avisado |
|---|---|
| Pedido novo para um setor | Quem é do setor de destino (`qs_users.setores`), **menos os admins** (eles têm os 4 setores e virariam spam) e menos o Marketing (só assiste, não tem a Central no menu). Se o setor só tiver admin, aí avisa os admins. Quem criou não recebe. |
| Pedido passado para alguém | A pessoa que recebeu o pedido |
| Alguém pegou o pedido | Quem pediu ("Pegaram sua solicitação") |
| Concluída / cotação entregue | Quem pediu (na cotação: "dê o desfecho") |
| Recusada | Quem pediu |
| Pediram ajuste ("aguardando quem pediu") | Quem pediu |
| Quem pediu ajustou | O dono do pedido (ou o setor, se ainda não tem dono) |
| Reaberta | O dono do pedido (ou o setor, se não tem dono) |
| Cancelada por quem pediu | O dono do pedido |
| Comentário | Quem pediu e o dono, menos quem escreveu |

### Pelo relógio (cron /api/avisos, a cada 5 min)

| Acontece | Quem é avisado |
|---|---|
| Prazo da solicitação vence em até 30 min | O dono; sem dono, o setor de destino |
| Prazo estourou (nas últimas 2 horas) | O dono; sem dono, o setor de destino |
| Reunião começa em ~10 min (agendada/confirmada) | O SDR que agendou e o closer |
| Etapas da Esteira do Relacionamento que vencem HOJE | O responsável pela viagem — **um aviso por pessoa por dia** ("3 etapas da Esteira vencem hoje"), a partir das 8h |
| Tarefas atrasadas do SDR | **Um resumo por dia** às 9h ("Você tem N tarefas atrasadas"). Nunca tarefa por tarefa. |

Limpeza: avisos lidos há mais de 30 dias (e não lidos há mais de 90) são apagados pelo mesmo cron.

## Onde aparece

- **Sino com número**: no Comercial é o sino que já existia (a seção "Avisos" fica no topo dele).
  No Relacionamento, Financeiro, Operações e Área do Closer o sino fica ao lado do nome da área
  (no celular, na barra do topo).
- Clicar num aviso marca como lido e abre a tela certa. Se o aviso for de outra área da pessoa
  (ex.: está no Comercial e o aviso é do Relacionamento), o QS troca de área sozinho.
- "Marcar todos como lidos" limpa a lista.
- **Bip**: dois toquinhos curtos quando chega aviso. Dá pra desligar em *Ajustes* (no painel do sino).
- **Aviso do Windows**: em *Ajustes* → "Ativar avisos do Windows". Só aparece quando o QS está
  escondido/minimizado (e a bolinha está fechada). Clicar nele traz o QS pra frente e abre o aviso.

## Como abrir a bolinha flutuante

1. Clique no sino → **Abrir bolinha flutuante** (ou *Ajustes* → Abrir bolinha flutuante).
   No Comercial também tem no menu do seu nome (canto de cima, à direita).
2. Abre uma janelinha redonda com o número de avisos, que fica **por cima de tudo**, até de outros
   programas. Arraste pela barrinha de cima pra onde quiser.
3. Quando chega aviso novo ela pulsa, toca o bip e mostra o título do último aviso.
4. Clicar nela traz o QS pra frente e abre o aviso mais novo.

Se você fechar a bolinha no X, o QS entende que não quer mais. Se o QS recarregar com a bolinha
aberta, ele oferece "Reabrir" no topo da tela (o navegador só deixa abrir com um clique).

## Limitações

- A bolinha só funciona no **Chrome ou Edge atualizados** (versão 116 ou mais nova). Em outros
  navegadores aparece o recado "use Chrome ou Edge atualizado" — o sino, o bip e o aviso do Windows
  continuam funcionando.
- A bolinha **fecha junto com o QS**: ela é uma janelinha da aba do QS.
- **Com o QS fechado não chega nada.** O aviso fica guardado e aparece no sino quando a pessoa abrir
  o QS. Avisar com o navegador fechado (Web Push) fica pra fase 2.
- O bip só toca depois que a pessoa clicou alguma vez no QS (regra dos navegadores pra som).
- Com o QS aberto em várias abas, só uma toca o bip.

## Pra quem mexe no código

- Tabela `qs_avisos` (RLS: cada um lê só os seus; "lido" pela RPC `qs_avisos_marcar_lidos`).
- O front faz **1 consulta** ao abrir (não lidos, índice `(user_id, lido_em, criado_em)`) e escuta
  o **Realtime filtrado por `user_id=eq.<eu>`**. Nada de recontar de tempos em tempos.
- `AvisosProvider` é montado uma vez no `App.tsx`, por fora das cascas (a bolinha não fecha ao trocar
  de área). Rotas usadas nos links: `#rel/...`, `#fin/...`, `#ops/...`, `#closer/...` e
  `#comercial/<lead|solicitacoes|painel|minha-agenda>/<id>` (o Comercial lê e limpa o endereço).
- Gatilhos nunca derrubam a ação principal: erro vira só `warning` no log do banco.
- Aviso novo de outro tipo: chame `qs_aviso_criar(user, tipo, area, titulo, texto, link, origem,
  origem_id, chave)` de dentro de uma função `security definer` — a `chave` impede repetir.
