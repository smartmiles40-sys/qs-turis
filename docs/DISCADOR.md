# Discador (ligações em massa) — 27/10/2026

Pedido do Bruno: "liga pra 10 pessoas de uma vez; se ninguém atender, liga pra mais 10, e assim
vai até alguém atender". Decisão dele: se 2 ou mais atenderem ao mesmo tempo, as que sobrarem
**só desligam**, e o lead ganha um retorno urgente.

**Estado: código pronto, DESLIGADO.** Falta aplicar a migration `0209` e a VoxFree responder
sobre canais simultâneos (pergunta no fim). Nada foi testado contra a central de verdade.

## Onde está

| Arquivo | O que faz |
|---|---|
| `src/lib/discador/motor.ts` | Lógica pura: estados do lote, classificação SIP, limite da central, decisão de N, montagem do lote. Sem rede. |
| `src/lib/discador/controlador.ts` | Executa o motor: abre as chamadas, manda CANCEL/BYE, promove quem atendeu, grava as tentativas, chama os desfechos da Fila. |
| `src/lib/webphone.ts` | Ganhou `prepararDiscador` / `abrirPerna` / `promoverPerna` / `encerrarDiscador`: várias chamadas no MESMO ramal (mesmo UA JsSIP). |
| `src/components/sdr/telefone/DiscadorPainel.tsx` | Painel na Fila de hoje: lote atual, status de cada número, contadores, N, botões. |
| `src/components/sdr/tasks/TasksPanel.tsx` | Botão "Iniciar discagem", fila do discador, desfechos (mesma função do lote em massa), retorno urgente. |
| `src/components/sdr/settings/DiscadorConfig.tsx` | Configurações → Discador (liga/desliga + números). |
| `supabase/migrations/0209_discador.sql` | Tabela `qs_discador_tentativas` + RLS. **Só escrita, não aplicada.** |
| `scripts/discador-simular.mjs` | Testes do motor + simulação de sessões inteiras: `node scripts/discador-simular.mjs`. |

## Como o SDR usa

1. Na **Fila de hoje**, clica **Iniciar discagem** (o botão só aparece com o discador ligado
   e o ramal do webfone configurado).
2. O QS registra o ramal, pede o microfone uma vez e monta a fila: só as atividades de
   **ligação** (`ligacao` e `ligacao_whatsapp`) **dele**, pendentes/atrasadas e já vencidas, na
   ordem da Fila de hoje (respeita os filtros que estiverem na tela), só leads com telefone
   discável (`normalizePhoneBR`), um lead por vez e nenhum lead que o discador já ligou hoje.
3. Sai o lote (5 por padrão). Cada número toca até 20 s.
4. **Alguém atendeu** → a chamada vem pro SDR (áudio, widget do webfone, cronômetro, mudo), o
   card do lead abre como ativo, as outras que tocavam são canceladas. O discador **pausa**.
5. O SDR conversa, desliga e dá o desfecho **como hoje** (classificação, ganho, retorno…).
6. Clica **Continuar** (ou Pausar / Parar). Parar fica sempre visível.

> Atenção: `ligacao_whatsapp` também entra na fila, como pedido, mas pelo discador a ligação sai
> pela **telefonia (VoxFree)**, não pelo WhatsApp.

## Cenários

| Cenário | O que acontece | Tarefa do lead |
|---|---|---|
| **Ninguém atende** em 20 s | CANCEL em todas, próximo lote em 1,5 s | "Não atendeu" (mesma função do lote em massa: follow-up da cadência, Bitrix 1º contato) |
| **1 atende** | Vira a chamada do SDR; as que tocavam → CANCEL | A dele: o SDR dá o desfecho. As canceladas **voltam pro fim da fila** sem desfecho (tocaram pouco; não é "não atendeu"). Volta no máx. 2 vezes; depois fica na fila pra ligar na mão. |
| **2+ atendem** (corrida) | A 1ª é do SDR; a 2ª recebe **BYE na hora** ("só desliga") | A 2ª ganha **extra urgente** agora (tag `discador-abandonada`, prioridade alta) e as outras atividades do lead são encerradas, igual à extra manual. Conta como abandono. |
| Corrida CANCEL × atendeu | A pessoa atende no instante do nosso CANCEL; a JsSIP manda ACK+BYE sozinha | Detectado (interceptamos `_acceptAndTerminate`) → conta como derrubada + retorno urgente. |
| **Caixa postal** atende antes de 20 s | Para o sistema é "atendeu" (200 OK) — vem pro SDR | O SDR marca "caixa postal". Por isso o toque padrão é 20 s (a caixa postal das operadoras costuma entrar depois de ~25–30 s). Não há AMD. |
| **Ocupado** (486/600) | Sai do lote | "Não atendeu" (detalhe "ocupado") |
| **Inválido** (404/604/484/424) | Sai do lote | "Nº errado" → o follow-up vira pesquisa de contato (regra existente) |
| **Indisponível** (480/408/410/430) | Sai do lote | "Não atendeu" |
| **Central recusa por limite** | As primeiras X tocam e as que saíram depois voltam recusadas em < 1,2 s sem tocar | Voltam pra fila sem desfecho; N cai pra X e o painel avisa "a central aceitou só X ao mesmo tempo". |
| **Central recusa tudo** | Todas recusadas na hora | N = 1; se recusar de novo com N = 1 (403/503), o discador **para** ("pode ser bloqueio/crédito"). |
| Erro técnico (WebRTC, SDP…) | Volta pra fila | Sem desfecho. |
| Fora do horário (`workHours`) | Não começa lote novo | — |

## Proteções

- **Desligado por padrão** (`qs_settings.discador_ativo`).
- **Abandono** = derrubadas ÷ atendidas, medido na sessão. Se um lote teve derrubada e a taxa
  passou do limite (3%), o lote cai pela metade (mín. 1). Com 1 por vez não existe abandono.
  Quando a taxa volta pra dentro, N volta ao configurado (sem passar do limite da central).
- **Teto duro de 10** no código, mesmo que o admin peça mais.
- **Não repete lead no mesmo dia** pelo discador: lê `qs_discador_tentativas` de hoje (e, se a
  tabela ainda não existir, o que este navegador lembra).
- Sair da Fila de hoje (desmontar o painel) = **Parar**.
- Desfechos aplicados **um a um** (mesmo motivo do lote em massa: corrida no banco e limite do Bitrix).

## Configuração (`qs_settings`)

| Chave | Padrão | Faixa |
|---|---|---|
| `discador_ativo` | ausente = desligado | `true`/`false` |
| `discador_config.lote` | 5 | 1 … `loteMax` |
| `discador_config.loteMax` | 10 | 1 … 10 |
| `discador_config.toqueSeg` | 20 | 8 … 45 |
| `discador_config.abandonoMax` | 0.03 | 0 … 0.5 |
| `discador_config.intervaloMs` | 1500 | 0 … 30000 |
| `discador_config.recusaRapidaMs` | 1200 | 0 … 5000 |

Pela tela: **Configurações → Discador** (só gestor/admin salva). **Sugestão pra estreia: lote 3**
até a VoxFree responder.

## Simulação (sem rede)

`node scripts/discador-simular.mjs` roda 12 cenários (asserts) e 5 sessões simuladas de 300
leads (atende 15%, ocupado 8%, inválido 5%, indisponível 7%; corrida CANCEL×200 com janela de
150 ms). Resultado com a semente padrão (42):

```
lote 5, central sem limite     lotes  76 · discadas 378 · atendidas 27 · abandonadas  0 (0.0%) · N final 5
lote 5, central aceita só 3    lotes 227 · discadas 317 · atendidas 34 · abandonadas  1 (2.9%) · N final 3
lote 10, central sem limite    lotes  58 · discadas 580 · atendidas 45 · abandonadas  0 (0.0%) · N final 10
lote 1 (sem paralelo)          lotes 300 · discadas 300 · atendidas 33 · abandonadas  0 (0.0%) · N final 1
central fora (limite 0)        lotes   2 · recusas central 5 · BLOQUEADA
```

Leitura: com lote 5 o SDR passa por ~4× menos "esperas de toque" que ligando 1 a 1. O preço é
o "toque curto": quem tocava quando outro atendeu leva CANCEL (chamada perdida no celular dele)
e volta pra fila — com lote 10 isso tira muitos leads da sessão (voltam pra fila manual).

## Riscos conhecidos

1. **Limite de canais desconhecido.** O código descobre e baixa sozinho, mas a heurística
   (recusa < 1,2 s, sem tocar, nas últimas a sair) pode confundir com ocupado de verdade.
2. **Caixa postal antes de 20 s** vira "atendeu" e interrompe o SDR. Sem AMD.
3. **Toque curto / chamada perdida** pros leads cancelados quando outro atende.
4. **Áudio**: as pernas compartilham o mesmo microfone; só a promovida liga o áudio remoto.
   Nunca testado com várias sessões simultâneas no box da VoxFree.
5. **Pane de 25/09** (central atende tudo em ~3 s com "sem permissão"): o discador acharia que
   o 1º atendeu e passaria a ligação pro SDR, que ouviria a mensagem. Ele percebe na hora e para.
6. A ligação de canal `ligacao_whatsapp` sai pela telefonia comum.
7. **ANATEL**: discagem automática com abandono alto é o que gera reclamação de "ligação muda".
   Manter lote baixo e abandono ≤ 3%.

## Pra ligar de verdade

1. Aplicar `supabase/migrations/0209_discador.sql`.
2. Resposta da VoxFree (abaixo). Se for "1 canal por ramal", o discador não tem como funcionar
   em paralelo — só com mais canais/troncos no plano.
3. Testar com o Bruno: lote 2, números internos/de teste, ver o painel e o log.
4. Ligar em Configurações → Discador com lote 3.

## Pergunta pra mandar à VoxFree / BravoTech

> Olá! Estamos montando um discador dentro do nosso CRM usando o WebRTC de vocês (JsSIP, WSS no
> box do ramal, ex.: ramal 2272_2002 no box30). Precisamos confirmar 5 pontos antes de ligar:
>
> 1. **Canais simultâneos por ramal**: quantas chamadas de SAÍDA ao mesmo tempo um único ramal
>    WebRTC pode ter (ex.: o 2272_2002 com 5 chamadas tocando juntas)?
> 2. **Canais simultâneos por conta/tronco**: qual o limite total da nossa conta (tenant 2272 e
>    2295) somando todos os ramais? Dá pra aumentar e qual o custo?
> 3. **Vários INVITE do mesmo ramal**: a central aceita vários INVITE em paralelo do mesmo
>    registro? Quando passa do limite, qual código vocês devolvem (486, 503, 403, 480)?
> 4. **CANCEL rápido**: se mandarmos CANCEL alguns segundos depois do 180, a ligação é encerrada
>    na operadora sem cobrança? Há cobrança mínima por tentativa ou só por chamada atendida?
>    Existe alguma regra anti-discador (limite de chamadas por minuto, bloqueio por muitas
>    chamadas curtas)?
> 5. **AMD**: vocês têm detecção de secretária eletrônica/caixa postal (AMD) na central ou
>    alguma forma de saber que quem atendeu foi a caixa postal?
>
> Obrigado!
