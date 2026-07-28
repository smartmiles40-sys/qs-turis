# Revisão completa do QS — 28/07/2026

Revisão feita por 15 revisores em paralelo (3 críticos, 7 backend por área,
3 frontend, 2 na pele dos SDRs), com consolidação e verificação por cima.
Regra da casa: **achado sem `arquivo:linha` foi descartado**.

O que dá para medir, foi medido contra o banco de produção (leitura apenas, pela
service_role do `.env` local).

---

## 0. Estado verificado do sistema em 28/07

| Fato | Como foi medido |
|---|---|
| Migrations 0001→0028 **todas aplicadas** | teste de existência de tabela/coluna, uma a uma |
| 6 usuários: 3 admin, 3 sdr, **0 closer** | `qs_users` |
| 815 leads · 407 em prospecção · 188 não iniciados · 159 perdidos · 61 ganhos | `qs_leads` |
| 61 reuniões, **todas** com status "agendada" — e **45 delas já com data no passado** | `qs_meetings` |
| 42 reuniões sem `closer_id`; as 19 com closer apontam para **admins**, não closers | `qs_meetings` + `qs_users` |
| `qs_closer_config` / `_availability` / `_blocks`: **vazias** | consulta direta |
| **Zero** sobreposições de agenda | comparação de `scheduled_at`/`ends_at` por closer |

> Correção de um erro meu: em algum momento reportei "91 sobreposições". Era bug
> do meu script de medição (comparei horários sem ter buscado a coluna
> `scheduled_at`). O número real é **zero** — e, como a migration só pula a trava
> anti-choque quando encontra conflito preexistente, o mais provável é que a
> constraint tenha entrado. Confirme com:
> ```sql
> select conname from pg_constraint where conname = 'qs_meetings_closer_no_overlap';
> ```

---

## 1. Já corrigido nesta revisão

**A tela de Reuniões estava quebrada em produção** (commit `5d42a18`). A 0027 deu
à `qs_meetings` um segundo vínculo com `qs_users` (`closer_id`), o que tornou o
embed `owner:qs_users(*)` ambíguo → PGRST201 → aba Reuniões vazia com banner de
erro, desfecho de reunião pelo card do lead falhando, e o bloco "Reuniões por SDR"
derrubando o painel do gestor. Mesmo defeito que a `qs_wa_pins` causou nos leads
de manhã. Causa: minha migration. Reproduzido contra produção antes e depois.

---

## 2. AÇÃO SUA, HOJE — segredo de produção exposto

**`n8n/bitrix-inbound-to-qs.CORRIGIDO.workflow.json:12-13`** tem o
`LEAD_INBOUND_SECRET` **em texto puro**, commitado e presente no histórico do git.
O repositório tem **dois remotes** (`origin` smartmiles40-sys e `upstream`
atendimentoaocliente-cyber). O `.gitignore:31` cobre `n8n/*.local.*` — pegou o
arquivo de credenciais e não pegou o workflow. O `n8n/README.md:372` promete
"segredos nunca ficam nos workflows"; é este arquivo que quebra a promessa.

Com esse segredo + a URL (que está na linha 7 do mesmo arquivo), um terceiro
consegue, contra a base real:

1. **Reescrever o cadastro de qualquer lead.** `api/_leads.js:335-347` faz PATCH
   de `email`, `phone`, `full_name` quando o `bitrix_id` já existe. IDs do Bitrix
   são sequenciais. Trocar o telefone dos 815 leads faz **os SDRs ligarem para o
   atacante** achando que ligam para o cliente. A rota responde `success: true`.
2. **Confirmar se uma pessoa é cliente de vocês** (manda telefone, recebe
   `lead_id` + `owner_id`) — consulta de titulares por terceiro, problema de LGPD.
3. **Entupir a fila de um SDR específico** — a rota aceita `owner_id` e
   `cadence_id` do chamador.

**Ordem:** (1) rotacionar o `LEAD_INBOUND_SECRET` na Vercel e a credencial no n8n
— o valor atual é público; (2) trocar a linha 13 por referência de credencial,
como os outros workflows já fazem; (3) ampliar o `.gitignore`; (4) confirmar que
os dois repositórios são privados e auditar acessos desde 14/07.

---

## 3. Os achados que mais de um revisor encontrou

Convergência independente = alta confiança. Estes são os que eu levaria primeiro.

### 3.1 "Ganho" marca o lead como ganho mesmo quando a reunião não foi gravada
*(4 revisores: painel, reuniões, os dois SDRs)*
`TasksPanel.tsx:1140-1147` empilha o erro numa lista de avisos e **segue**:
conclui a tarefa, marca `status='ganho'`, encerra as demais atividades. Fica lead
ganho, sem reunião, sem tarefa, fora da fila de todos. O cliente aparece e não tem
ninguém. Conserto: abortar antes de tocar em tarefa/lead. **Esforço: P.**

### 3.2 A reunião do Ganho quase nunca chega na agenda de um closer
*(4 revisores)*
O "Responsável pela reunião" é uma lista de **nomes em texto** hardcoded em
`qsSettings.ts:38` (Talita, Victor Maldonado, Bruno Matheus, John Italo).
`findUserIdByName` procura esse nome em `qs_users`, não acha, e grava
`closer_id = null` — daí as 42 órfãs. Conserto: trocar o textarea pela lista real
de closers. **Esforço: M.**

### 3.3 Escrita que falha em silêncio — uma classe inteira, ~20 pontos
*(5 revisores)*
`UPDATE`/`DELETE` recusado por RLS devolve **0 linhas sem erro**. Sem `.select()`
para medir, a tela comemora. Casos confirmados: marcar perdido e handover
disparam o Bitrix mesmo sem gravar (`LeadDetailPage.tsx:624-650`, `:715-731`);
excluir campo personalizado/produto some da tela e volta no F5
(`SettingsPage.tsx:300`, `:863`); e o `saveAvailability`
(`closerAgenda.ts:463-468`) apaga-e-insere sem medir, o que **duplica** a agenda
do closer a cada salvamento. Conserto estrutural: um helper `mustAffect(query)` e
passar as ~20 chamadas por ele. **Esforço: M** (resolve a classe toda).

### 3.4 "Atrasada" tem três réguas diferentes em três telas
*(3 revisores)*
Painel usa **dia útil** (`TasksPanel.tsx:1453`); o sino
(`NotificationsPanel.tsx:336`), a Retrospectiva (`RetrospectivaModal.tsx:145`) e
o card "Taxa de Atrasadas" do dashboard (`SdrDashboard.tsx:1153`) usam **dia
corrido**. Segunda de manhã: o Painel diz "0 atrasadas", o sino diz "3d em
atraso" e a Retrospectiva manda limpar. Conserto: extrair `isOverdue()` para
`workHours.ts` e usar nos quatro. **Esforço: P.**

### 3.5 Consultas sem paginação — o teto de 1000 do PostgREST
*(4 revisores)*
A base está em 815 leads (82% do teto). Quando passar, **corta em silêncio**:
a lista de leads perde registros e o dedupe do CSV passa a duplicar a base
(`LeadsPage.tsx:141`, `:212`, `:1456`); os selos "sem contato" e "N obs." do
painel voltam a piscar em lead já trabalhado (`TasksPanel.tsx:392`, `:445`).
O helper certo (`fetchAllRows`) já existe e é usado só na fila. **Esforço: P–M.**

### 3.6 Abrir um lead destrói o contexto de quem estava trabalhando
*(2 revisores, dores independentes)*
`SdrLayout.tsx:616-636` renderiza por condicional: navegar **desmonta** a tela
anterior. Da lista, perde filtro, busca e página (82 páginas com 10 por página);
do painel, perde a observação digitada, o card fixado e o desfecho pendente — e o
"Voltar" ainda joga em Leads, não na fila. Acontece a cada lead trabalhado.
**Esforço: M.**

### 3.7 Escalada de privilégio por `qs_handovers`
*(2 revisores)*
`0007_rls_papeis.sql:133-134` é `with check (true)`, e a 0025 passou a usar essa
tabela para conceder acesso. Qualquer SDR insere uma linha apontando para um lead
alheio e passa a **ler a conversa inteira e responder ao cliente** do colega.
Conserto: `with check (from_user_id = auth.uid() and qs_owns_lead(lead_id))`.
**Esforço: P.**

---

## 4. Outros P0 confirmados, por área

**Segurança**
- `/api/chatapp-send` dispara WhatsApp pelo número da empresa para **qualquer
  telefone**, sem checar posse do lead (`chatapp-send.js:80`, `:141`).
- `/api/bitrix-sync` move o negócio de **qualquer** lead no Bitrix a pedido de
  qualquer logado — o `lead_id` nunca é validado (`bitrix-sync.js:61-64`).
- A trava de "usuário desativado" (0017) só cobre tabelas que existiam em 16/07:
  ficaram de fora `qs_wa_messages`, `qs_wa_threads`, `qs_call_logs`,
  `qs_closer_*`. Um SDR desligado com sessão viva ainda lê as conversas.

**Integrações**
- Lead que entra pelo n8n e falha é **descartado em silêncio**: os nós usam
  `onError: continueRegularOutput` sem retry nem dead-letter.
- Três workflows disputam o mesmo path `qs-lead-inbound` — só uma fonte de leads
  pode estar ativa por vez.
- `/api/bitrix-sync` responde `success: true` **antes** de o Bitrix ver qualquer
  coisa (`responseMode: onReceived` nos 5 webhooks).
- Mensagem de WhatsApp que falha na gravação some para sempre: o webhook devolve
  200 e o Chatwoot nunca reenvia.

**Leads / Cadências**
- Lead sem cadência não gera tarefa **e não é varrido pelo sweep** — entra e
  morre. Os 188 "não iniciado" são candidatos.
- Dedupe por telefone compara dígitos contra base gravada **formatada** — o lead
  do site duplica o cadastrado à mão.
- Lead que chega fora do expediente ganha **Dia 1 e Dia 2 no mesmo minuto**.
- Desativar um SDR **congela a carteira**: os leads somem da operação e ele
  desaparece do seletor de handover — não há como redistribuir pela tela.

**WhatsApp**
- Mensagem do cliente **some** quando o telefone do lead foi digitado com
  formatação — e o descarte não gera log nenhum.
- Número estrangeiro: `toE164BR` prefixa `55` em qualquer coisa ≤11 dígitos, então
  **a mensagem sai para um brasileiro aleatório**.
- A conversa mostra as 200 mensagens **mais antigas** (`.order(asc).limit(200)`) —
  depois de "baixar histórico completo", o SDR abre no passado.

**Frontend**
- Números dos KPIs **invisíveis no modo escuro** (cor fixa inline dentro de card
  que escurece) — `SdrDashboard.tsx:433`.
- Modais do Painel não rolam: no celular o **botão de salvar fica fora da tela**
  (`TasksPanel.tsx:3375`, `:3496`).
- Dois sistemas de toast no mesmo canto: o verde de sucesso **cobre** o vermelho
  de erro, justamente quando o erro importa.
- A fila ordena por lead mais novo — as 736 atrasadas nunca aparecem
  espontaneamente, embora o cabeçalho as anuncie em vermelho.

---

## 5. O que os SDRs pediram (ordenado por dor)

**Victor Hugo (volume):** consultar histórico custa 12–18s e destrói o que ele
digitou; ligação e mensagem são gravadas em tabelas que **nenhuma tela lê**;
classificar ligação obriga a soltar o teclado (4–7 min/dia); escreve a mensagem e
depois redigita a observação (7–12 min/dia); o botão "Ligar" faz ~15 idas ao banco
antes de tocar.

**Mariana (atendimento):** **hoje ela não consegue agendar pela Agenda** — sem
closer, o seletor não oferece nada e o encaixe manual é só para gestor; quem
espera há mais tempo fica no **fim** da lista; a confirmação de reunião que o
sistema promete criar nunca aparece na fila dela (o filtro descarta tarefa de lead
ganho); rascunho some ao trocar de conversa; PDF de roteiro quase sempre estoura
o limite de 3 MB.

---

## 6. Ordem sugerida

**Onda 1 — hoje/amanhã (P, alto impacto)**
1. Rotacionar o segredo vazado (seção 2)
2. Ganho não pode marcar lead sem gravar reunião (3.1)
3. `qs_handovers` com `with check` (3.7)
4. Posse do lead em `/api/chatapp-send` e `/api/bitrix-sync`
5. Régua única de "atrasada" (3.4)
6. Toast de erro por cima do de sucesso

**Onda 2 — esta semana (M)**
7. Cadastrar os closers e trocar o textarea pela lista real (3.2)
8. Helper `mustAffect` nas ~20 escritas silenciosas (3.3)
9. Paginação onde falta (3.5)
10. Não desmontar a tela ao abrir um lead (3.6)
11. Retry + dead-letter na entrada de leads
12. Modo escuro dos KPIs e modais roláveis no celular

**Onda 3 — quando der**
13. Outbox durável para o Bitrix (resolve 4 P0 de uma vez)
14. Chave de telefone normalizada no banco (resolve dedupe + WhatsApp)
15. Code-split e `jssip` sob demanda (~1,07 MB → ~450 kB)
16. Timeline do lead incluindo mensagens e ligações

---

## 7. Descartado / não é bug

Verificado e **correto**, não mexer: a distribuição da 0028 (advisory lock por
fila, ponteiro no banco); o contador de não lidas do WhatsApp (soma dentro da RPC,
numa transação); idempotência de `completeTask`/`skipTask` (duplo clique e duas
abas cobertos); `insertFollowUp` com anti-duplicação e dia útil; rollback
compensatório na criação de usuário; guardas de auto-desativação nos três níveis;
nenhum segredo server-side no bundle do navegador. Os 2 P0 da auditoria de 14/07
(`full_name` e "com avanço + cancelar") **estão corrigidos**.

`agenda/AgendaPage.tsx` (embed antigo do Google) é código morto — nenhum import.
`createQsCadence`, `fetchLeadsCoverage` e `fetchLossReasonsStats` idem.
