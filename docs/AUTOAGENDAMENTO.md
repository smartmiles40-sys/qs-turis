# Autoagendamento — o cliente marca o próprio horário

> O que é: uma página pública onde o cliente escolhe dia e hora, preenche nome,
> WhatsApp e e-mail, e a reunião nasce dentro do QS — com especialista, sala do
> Meet, card no Bitrix, lead transferido e as tarefas de confirmar presença e
> registrar desfecho. Feito em 08/09/2026.

- **Página:** `https://qs-turis.vercel.app/agendar/`
- **Rota:** `api/agendar.js` (`GET` devolve a grade, `POST` marca)
- **Motor:** `api/_agenda.js` — o mesmo da Glória, sem cópia
- **Configuração:** `qs_settings.autoagendamento` (não precisa de deploy)
- **Migration:** `supabase/migrations/0077_autoagendamento.sql`

---

## O fluxo, em 4 passos

```
1. Cliente abre /agendar/  ──GET /api/agendar──▶  gradePublica()
                                                  lê qs_meetings + qs_closer_blocks
                                                  devolve só DIAS e HORAS livres
                                                  (nunca o nome do especialista)

2. Cliente escolhe 14:00 de quinta e preenche os dados

3. POST /api/agendar  ──▶  reconfere TUDO no servidor (janela, dia, antecedência,
                           hora cheia, fuso) ──▶ escolherCloserLivre() aplica o
                           rodízio ──▶ createInboundLead() cria/reaproveita o lead
                           ──▶ marcarReuniao()

4. marcarReuniao() (o mesmo código da Glória, sem uma linha nova):
     ├─ grava em qs_meetings  ← a trava anti-choque do banco (0027) mora aqui
     ├─ n8n → Google Calendar → link do Meet     (N8N_AGENDA_URL)
     ├─ n8n → Bitrix, atualiza o card            (N8N_SYNC_BASE/qs-reuniao)
     ├─ encerra a prospecção (lead vira "ganho", cadência fechada)
     ├─ transfere o lead pro especialista        (+ handover no histórico)
     ├─ tarefa pro SDR: confirmar presença 24h antes
     └─ tarefa pro closer: registrar o desfecho + SAL depois da reunião
```

**O n8n é reaproveitado, não reescrito.** Os dois webhooks que a Glória já usa —
`agenda-google-meet.workflow.json` (cria o evento e devolve o link do Meet) e o
`qs-reuniao` do `qs-bitrix-completo.workflow.json` — atendem o autoagendamento
sem nenhuma alteração. Não existe workflow novo pra importar.

### Por que o agendamento não passa pelo n8n

Foi uma decisão, não um esquecimento. O n8n continua fazendo o que só ele sabe
fazer (falar com o Google e com o Bitrix, porque as credenciais estão lá), mas a
**reserva do horário** fica no QS. Motivo: a trava que impede dois clientes na
mesma hora do mesmo especialista é uma constraint `EXCLUDE` do Postgres — ela só
funciona no `INSERT`. Se a reserva fosse feita pelo n8n, dois cliques
simultâneos passariam pelos dois lados da automação e a colisão só apareceria
depois, na agenda de alguém. Reservar primeiro no banco e avisar o mundo depois
é a mesma ordem que a tela e a Glória já usam.

---

## Como embutir no STFV Forms (ou em qualquer LP)

Cole isto na página. Troque `expedicao` e `origem` conforme o caso.

```html
<div id="qs-agendar" style="max-width:560px;margin:0 auto">
  <iframe
    src="https://qs-turis.vercel.app/agendar/?embed=1&expedicao=Jap%C3%A3o&origem=live-japao"
    title="Agende sua conversa"
    style="width:100%;height:660px;border:0;display:block"
    loading="lazy"
    referrerpolicy="strict-origin-when-cross-origin"></iframe>
</div>
<script>
(function () {
  var quadro = document.querySelector('#qs-agendar iframe');
  var ORIGEM_QS = 'https://qs-turis.vercel.app';
  window.addEventListener('message', function (e) {
    // Conferir a origem é o que impede outro site embutido na mesma página de
    // se passar pelo agendamento e mexer no seu layout.
    if (e.origin !== ORIGEM_QS || !e.data || typeof e.data !== 'object') return;

    // O iframe cresce e encolhe sozinho conforme o passo. Sem isto, o embed
    // vira uma caixa com rolagem interna e a pessoa não vê o botão de confirmar.
    if (e.data.tipo === 'qs-agendar:altura' && e.data.altura) {
      quadro.style.height = e.data.altura + 'px';
    }

    // Reunião marcada: o gancho pro seu evento de conversão.
    if (e.data.tipo === 'qs-agendar:concluido') {
      // dataLayer.push({ event: 'reuniao_agendada' });
    }
  });
})();
</script>
```

### Preenchimento automático (quem já digitou não digita de novo)

A página de fora pode mandar os dados que já coletou. Vai por `postMessage`,
**não pela URL**: endereço de iframe fica no histórico do navegador e em log
pelo caminho, e nome/e-mail/telefone não têm por que passear por ali.

O aperto de mão tem dois tempos — o iframe avisa `qs-agendar:pronto` quando
carregou, e só então o pai responde:

```js
if (e.data.tipo === 'qs-agendar:pronto') {
  quadro.contentWindow.postMessage({
    tipo: 'qs-agendar:preencher',
    nome: 'Ana Paula', email: 'ana@exemplo.com',
    telefone: '+5511987654321',      // E.164 ou nacional, tanto faz
    expedicao: 'Egito', origem: '[Egito] - Live',
    ja_no_bitrix: true               // ver abaixo
  }, 'https://qs-turis.vercel.app');
}
```

⚠️ **`ja_no_bitrix`** diz "o negócio no Bitrix JÁ existe, não crie outro". É o
caso dos formulários de live: o `/api/save-lead` do STFV Forms cria contato e
negócio antes de a pessoa ver a agenda. Sem essa flag, a mesma pessoa vira dois
cards no funil de Pré-Vendas.

Repare que **não é o id do negócio**, de propósito: id de negócio é inteiro
sequencial, e aceitar um vindo do navegador deixaria qualquer um sobrescrever
nome e telefone de lead alheio chutando números. Mentir na flag só deixa a
própria pessoa sem card — o que não é ataque.

A origem que manda o preenchimento é conferida contra uma lista curta dentro da
própria página (`ORIGENS_QUE_PODEM_PREENCHER`).

**O telefone pode vir em qualquer formato.** A máscara da página é nacional, e
o formulário manda em E.164 — sem tratar, `+5511987654321` virava
`(55) 11987-6543`, com o código do país lido como DDD e os dois últimos dígitos
comidos pelo corte. O código tira o `55` antes de mascarar; conferido nos cinco
formatos que aparecem na prática, fixo de 10 dígitos incluído.

### Os parâmetros da URL

| Parâmetro   | Para que serve                                                            |
|-------------|---------------------------------------------------------------------------|
| `embed=1`   | Tira fundo e moldura, pra encaixar no visual da página de fora            |
| `expedicao` | Vira o **título da reunião** (`Expedição Japão`) e o interesse na nota     |
| `origem`    | Vira a **Fonte** do lead (`qs_leads.segment`) — é por ela que se separa    |

`origem` é o campo que responde "quantas reuniões vieram da live do Japão".
Sem ele, a fonte fica só `Autoagendamento`.

### ⚠️ Domínio novo precisa entrar em DOIS lugares

Um site só consegue embutir a página se estiver nas duas listas. Falta em
qualquer uma delas = **tela em branco, sem mensagem de erro** (o recado fica só
no console do navegador), e é o jeito mais rápido de perder uma tarde.

1. **`frame-ancestors`** no `vercel.json` → autoriza o `<iframe>`
   (a regra é `/agendar(.*)` — medido em produção em 08/09: `/agendar/:path*`
   **não casa com a barra final**, então `/agendar/` saía sem CSP nenhum e
   qualquer site conseguia embutir. Confira com
   `curl -sI .../agendar/ | grep -i content-security`)
2. **`qs_settings.lp_origins`** → autoriza o `fetch` (CORS)

Hoje as duas cobrem: `setuforeuvouviagens.com.br` e subdomínios (incluindo
`forms.` e `live.`) e `stfv-forms-geral.vercel.app`.

---

## Configuração — mexer sem deploy

Tudo mora em `qs_settings.autoagendamento`. O servidor relê a cada minuto.

```sql
update qs_settings
   set value = value || jsonb_build_object('janela', jsonb_build_object('primeira', 9, 'ultima', 18)),
       updated_at = now()
 where key = 'autoagendamento';
```

| Chave             | Padrão                    | O que faz                                        |
|-------------------|---------------------------|--------------------------------------------------|
| `ativo`           | `true`                    | `false` desliga a página e mostra o recado        |
| `janela.primeira` | `11`                      | Primeira hora oferecida                           |
| `janela.ultima`   | `17`                      | **Última hora de COMEÇO** (17 = termina 18h)      |
| `dias`            | `[1,2,3,4,5]`             | 0 = domingo … 6 = sábado                          |
| `duracaoMin`      | `60`                      | Duração da reunião                                |
| `antecedenciaMin` | `180`                     | Nada com menos de 3h a partir de agora            |
| `diasAFrente`     | `14`                      | Até onde a grade mostra                           |
| `titulo`          | `Fale com um especialista`| Título no topo da página                          |
| `subtitulo`       | …                         | Linha abaixo do título                            |
| `encerrado`       | …                         | O que aparece quando não há horário nenhum        |

**Por que o padrão é apertado (11h–18h, 3h de antecedência).** São as regras que
a Glória usa desde 25/08, escolhidas contra no-show: reunião marcada às 10h50
para as 11h vira falta, e falta custa mais caro que agenda vazia. Abrir mais é
uma decisão comercial legítima — só não é de graça.

---

## A agenda pessoal do closer (Google freeBusy)

Um horário só é oferecido se, além de livre no QS, o closer também estiver livre
na **agenda dele no Google**. Sem isso, compromisso que existisse só lá (médico,
almoço, reunião interna) não bloqueava nada e o cliente marcava por cima.

```
QS  ──POST N8N_AGENDA_URL { acao: "ocupacao", de, ate, emails }──▶  n8n
                                                                     │
                                            Google Calendar freeBusy ◀┘
                                                                     │
     ◀── { ok, ocupado: { email: [{inicio,fim}] }, avisos } ──────────┘
```

**Usa `freeBusy`, não a listagem de eventos.** A API devolve só intervalos
ocupado/livre — sem título, sem convidado, sem descrição. A agenda pessoal de
quem trabalha aqui não precisa passear pelo nosso servidor para a gente saber
que às 15h tem alguém ocupado.

**Falha aberta, sempre.** Google fora, n8n fora, workflow ainda sem a ação — tudo
devolve "não sei" e a grade sai como saía antes. O contrário (grade vazia porque
o Google não respondeu) trocaria um problema raro por um prejuízo diário.
Timeout de 4,5s e cache de 60s por conjunto de e-mails.

### Ligar (uma vez)

O QS **já chama**. Falta o n8n saber responder:

```bash
node n8n/adicionar-acao-ocupacao.mjs
# -> n8n/qs-agenda-meet.COM-OCUPACAO.workflow.json
```

Importar esse arquivo no n8n (Import from File), conferir que a credencial
*Google Calendar account* continua ligada nos 4 nós HTTP, e ativar. Enquanto o
workflow antigo estiver no ar, ele responde "acao invalida" e o QS segue com a
agenda só do banco — sem erro, sem sintoma.

⚠️ **A conta do n8n precisa enxergar o livre/ocupado de cada closer.** Em
Workspace isso costuma valer para o domínio inteiro; se não valer, o Google
devolve `errors: [{reason: "notFound"}]` para aquela agenda e ela **sai da
conta** (tratada como livre, e o motivo vai em `avisos`). Nunca derruba a
consulta das outras.

### Desligar (sem deploy)

Basta um evento de dia inteiro na agenda pessoal — férias marcadas como
"ocupado", um "fora do escritório" — para o freeBusy devolver o dia todo
ocupado e a grade nascer vazia. Nesse dia não dá para esperar deploy:

```sql
update qs_settings
   set value = value || '{"google_freebusy": false}'::jsonb,
       updated_at = now()
 where key = 'autoagendamento';
```

Vale em até um minuto (o cache do interruptor).

## Quando "não aparece horário nenhum"

Na ordem, do mais provável pro menos:

1. **Não existe closer ativo.**
   `select id, name from qs_users where role = 'closer' and is_active;`
   Lista vazia = a página nasce vazia, e é o primeiro lugar pra olhar.
2. **A agenda do Google de todos eles está ocupada** — um evento de dia inteiro
   basta. É a causa mais provável desde 08/09; o log da Vercel mostra
   `[agenda] agenda do Google indisponível` só quando a consulta FALHA, não
   quando ela responde "ocupado". Para descartar em 10 segundos, desligue o
   `google_freebusy` (ver acima) e recarregue: se os horários voltarem, é isso.
3. **As agendas estão cheias ou bloqueadas** — confira `qs_closer_blocks`.
4. **`ativo` está `false`** em `qs_settings.autoagendamento`.
5. **A janela ficou impossível** (ex.: `primeira` maior que `ultima`, ou `dias`
   com um dia que não existe).

Pra ver a grade exatamente como o cliente vê, sem abrir o navegador:

```bash
curl -s https://qs-turis.vercel.app/api/agendar | head -c 800
```

---

## As contenções (a página é pública)

Ela roda no navegador de um desconhecido, então não carrega segredo nenhum.
O que segura:

- **CORS por allowlist** (`qs_settings.lp_origins`) + o próprio domínio do QS
- **Campo-armadilha** (`site`) — robô de formulário preenche, gente não vê
- **Teto por IP por hora** (`qs_lp_rate_bump`, compartilhado com as LPs mas com
  chave própria `agendar:<hash>`, então um não gasta a cota do outro)
- **A agenda nunca sai inteira**: o `GET` devolve horas, nunca o especialista —
  ninguém de fora mapeia a agenda de uma pessoa do time
- **Quem já tem reunião marcada no futuro não marca outra** — em vez de recusar,
  a página mostra quando é a que já existe
- **Toda regra de horário é reconferida no `POST`**. O que o navegador manda é
  palpite; quem decide é o servidor
- **A trava do banco** (constraint `EXCLUDE` da 0027) é a última palavra sobre
  dois clientes no mesmo horário

O pior estrago possível é reunião falsa na agenda — nada destrutivo, nada que
apague dado, e reunião falsa aparece na Agenda pro time cancelar.

---

## Como medir se valeu a pena

A assinatura é `qs_meetings.scheduled_by = 'Autoagendamento (site)'`
(a da Glória é `Glória (IA)`; a do time é o nome de quem marcou).

```sql
-- quantas por semana, por origem
select date_trunc('week', scheduled_at) as semana,
       count(*) filter (where scheduled_by = 'Autoagendamento (site)') as self_book,
       count(*) filter (where scheduled_by = 'Glória (IA)')            as gloria,
       count(*)                                                        as total
  from qs_meetings
 where scheduled_at >= now() - interval '60 days'
 group by 1 order by 1 desc;

-- e no que deram (o número que decide de verdade)
select status, count(*) from qs_meetings
 where scheduled_by = 'Autoagendamento (site)' group by 1 order by 2 desc;
```

Se o self-book trouxer volume mas com no-show muito acima da média, o botão a
girar é `antecedenciaMin` — não a janela.
