# Tráfego › Meta Ads (verba e travas) — 0265

Marketing › Tráfego › **Meta Ads**. Uma página com cinco abas:

| Aba | O que mostra |
|---|---|
| **Verba** | Período (ex.: R$ 15.000 de 01/11 a 15/11), gasto, saldo, % do tempo × % da verba, ritmo ideal, projeção até o fim, diária máxima segura, orçamento **programado** na Meta (e em que dia estoura), divisão por destino/campanha, quem recebe os avisos. |
| **Funil** | Por destino·canal e por campanha: gasto, leads, CPL, agendamentos, custo/agendamento, reuniões, custo/reunião, vendas, CAC, faturamento, ROAS. Mostra o gasto sem destino e os leads sem campanha. |
| **Travas** | As regras, como estão agora ("Agora: R$ 1.000 > R$ 300 · pausaria 2 campanhas"), criar/editar/ligar/desligar. |
| **Campanhas** | Status, orçamento diário valendo, gasto, destino lido do nome — com correção à mão. |
| **Histórico** | Avisos, alertas, pausas, "pausaria" (simulação), reativações e erros. Botão **Reativar** nas pausas. |

Código: `api/_metaAds.js` (Graph API), `api/_mktTrafegoCalc.js` (contas puras, testadas em
`tests/mkt-trafego/`), `api/_mktTrafegoMotor.js` (banco + travas), `api/mkt-trafego.js` (rota + cron),
`src/mkt/trafego/` (tela). Banco: `supabase/migrations/0265_mkt_trafego.sql`.

## 1. Gerar o token (usuário do sistema no Business Manager)

Token de **usuário do sistema** não vence como o de pessoa (o do Dashboard caía de tempos em tempos).

1. business.facebook.com → **Configurações do negócio** → **Usuários** → **Usuários do sistema** → **Adicionar**.
   Nome: `QS Tráfego`. Função: **Admin** (precisa pra gerar token com ads_management).
2. Com o usuário selecionado → **Atribuir ativos** → **Contas de anúncios** → a conta da agência →
   marcar **Gerenciar campanhas** (controle total não é necessário). Salvar.
3. **Gerar novo token** → escolher o app da agência (o mesmo do WhatsApp serve; se não houver, crie um app
   do tipo "Empresa" em developers.facebook.com e associe ao Business) → validade **Nunca** →
   permissões **`ads_read`** e **`ads_management`** → Gerar. Copie (só aparece uma vez).
4. O id da conta: Gerenciador de Anúncios → menu da conta → o número (`act_793056632610839` é o que o
   Dashboard lê hoje — confirme que é a mesma).
5. Teste rápido (opcional), no navegador:
   `https://graph.facebook.com/v23.0/act_<ID>?fields=name,currency,timezone_name&access_token=<TOKEN>`
   tem que devolver o nome da conta.

## 2. Envs na Vercel (projeto do QS)

| Env | Obrigatória | O que é |
|---|---|---|
| `META_ADS_TOKEN` | sim | o token do passo 1 |
| `META_AD_ACCOUNT_ID` | sim | `act_…` (aceita só o número) |
| `MKT_TRAFEGO_PAUSA_LIGADA` | não | **chave geral da pausa**. Sem ela (ou ≠ `1`/`true`), nenhuma trava pausa de verdade: vira "pausaria" no histórico. |
| `META_GRAPH_VERSION` | não | padrão `v23.0` |
| `CRON_SECRET` | já existe | o cron `/api/mkt-trafego?cron=1` roda às :07 e :37 de toda hora |

Sem as duas primeiras, a tela explica o que falta e nada quebra (dá pra cadastrar período e travas antes).

## 3. Ordem pra ligar

1. Aplicar a `0265_mkt_trafego.sql` (cria as tabelas, as colunas `utm_*` em `qs_leads` e as funções).
2. Pôr `META_ADS_TOKEN` e `META_AD_ACCOUNT_ID`, redeploy. Na tela, **Atualizar agora** (Tráfego/gestor).
3. Gestor cadastra o período (Verba › + Novo período). O QS cria junto a trava "Verba" (avisa em 80% e em 100%) **só avisando**.
4. Aba Campanhas: marcar o destino das campanhas sem destino no nome (ex.: "[STFV] [sem vídeo] | ABO |" → *Vários destinos (rateio)*).
5. Criar as travas (modelos prontos: custo por reunião, agendamento, CAC, CPL, gasto sem lead, teto do dia). Os
   valores dos modelos são só ponto de partida — o Bruno e o Arthur definem os de verdade.
6. Deixar uns dias em simulação e conferir no Histórico o que o QS **pausaria**.
7. **Ligar a pausa de verdade**: em cada trava que deve pausar, escolher "Pausar"; depois pôr
   `MKT_TRAFEGO_PAUSA_LIGADA=1` na Vercel e fazer redeploy. A aba Travas mostra em vermelho quando está ligada.
   Desligar = tirar a env (ou pôr `0`) e redeploy.

## 4. Como os números são contados

- **Gasto**: insights diários da Meta por campanha (`level=campaign&time_increment=1`), dia no fuso da conta.
- **Safra**: o lead que **entrou** no período (`qs_leads.created_at`, horário de Brasília) leva junto tudo que
  aconteceu com ele depois. Só entram leads com Fonte `[Destino] - Tráfego` ou `[Destino] - Live`.
- **Agendamento**: lead com ≥ 1 reunião (`qs_meetings`, menos `arquivada`). Remarcada não conta 2×.
- **Reunião realizada**: reunião `realizada` (ou com `realizada_em`).
- **Venda**: `qs_meetings.venda_valor > 0` (o valor que o closer informa no desfecho), **sem Passagens aéreas**
  (tipo 71, igual ao Dashboard) e sem reunião reagendada/cancelada/arquivada. `qs_closer_negocios` ainda não tem
  nenhuma pré-venda nem venda consolidada (0 em 03/11), por isso não é a fonte.
- **Faturamento** = soma dessas vendas; **CAC** = gasto ÷ vendas; **ROAS** = faturamento ÷ gasto.
- **Destino**: o `[Destino]` da Fonte do lead × o destino que aparece no nome da campanha (sem emoji, acento,
  caixa, pontuação; "Costa Amalfitana" = Itália; "[JAPÃO+CHINA]" = Japão + China). Campanha com LIVE/INSCRIÇÃO
  paga o lead "- Live"; as outras, o "- Tráfego". Campanha marcada "vários destinos" tem o gasto rateado pelos
  leads de cada destino do mesmo canal (estimativa, marcada na tela).
- **Por campanha**: só com `utm_campaign` no lead (ver 6). Sem UTM, a linha mostra o lead que a Meta conta.
- **Orçamento programado**: soma dos orçamentos diários ativos (CBO = campanha, ABO = conjuntos ativos) ×
  dias que faltam, mais o que falta do de hoje. Orçamento vitalício fica fora (a tela avisa quantos).
- **Diária máxima segura** = saldo ÷ dias que faltam (contando hoje).
- **Projeção** = gasto + a média dos dias completos × dias que faltam.

## 5. Travas

- Medidas: % da verba, gasto do período, gasto de hoje, CPL, custo por agendamento, custo por reunião, CAC,
  "gastou R$ X sem nenhum lead em N horas" (pela fotografia de gasto/lead da Meta tirada a cada leitura).
- Escopo: período inteiro, um destino ou uma campanha. Pausar alcança as campanhas **ativas** do escopo.
- **Gasto mínimo antes de julgar**: abaixo dele a trava fica "amostra pequena" e não age.
- "Sem dado" (ex.: campanha sem UTM pra medir reunião) **nunca** pausa.
- Com a Meta sem leitura há mais de 2 h, as travas **não são julgadas** (só sai o alerta "sem leitura").
- Cada trava avisa no máximo 1× por dia por situação; pausa cada campanha no máximo 1× por dia por trava.
- **Nunca reativa sozinho.** Reativar pelo Histórico (pede confirmação): a campanha volta e, até o fim do dia,
  as travas só avisam sobre ela (pra não pausar de novo meia hora depois).
- Alertas extras: orçamento diário que **subiu por fora** do QS, campanha **nova** ativa (e "fora do plano" quando
  o período tem divisão e ela não está nela), **Meta sem leitura há > 2 h** (token vencido?), **programado estoura**
  e **verba acaba antes da data** no ritmo atual.
- Os avisos vão pro sino de quem está marcado em Verba › "Quem recebe" (vazio = papel Tráfego + gestores de Marketing + admins).

## 6. UTM no lead (preparado)

`qs_leads` ganhou `utm_source/medium/campaign/content/term` (0265). O QS grava o **primeiro toque** (não sobrescreve) quando a entrada traz:

- `/api/lead-site` e `/api/lead-inbound`: campos `utm_*` no corpo.
- Bitrix (`/api/bitrix-entrada`): parâmetro no robô (`&utm_campaign={{UTM_CAMPAIGN}}` etc.) ou os campos padrão
  `UTM_CAMPAIGN…` do negócio, quando o QS lê o negócio (evento sem dados da pessoa ou com `&funil=`).

Hoje (03/11) nenhum lead do QS tem UTM: as LPs mandam o lead direto pro Bitrix e o robô não repassa UTM. Pra
ligar o funil por campanha: (a) o robô do Bitrix que chama o QS passar `&utm_campaign={{UTM_CAMPAIGN}}&utm_content={{UTM_CONTENT}}`;
(b) os anúncios usarem `utm_campaign={{campaign.name}}` (ou `{{campaign.id}}`, que sobrevive a renomeação — o QS aceita os dois).
