# Revisão de 04/08 — o que mudou e como validar

Documento pra você conferir de manhã. Cada item tem **o que era**, **o que foi
feito** e **como testar** — se algum teste falhar, o problema está isolado.

---

## Antes de tudo: aplique isto

Cole `supabase/APLICAR-REVISAO.sql` no SQL Editor do Supabase. São as três
migrations novas (0036, 0037, 0038) numa transação só.

**A 0037 é a que faz o WhatsApp voltar a funcionar** para 57 leads. Sem ela, o
código novo já resolve as mensagens que chegarem daqui pra frente, mas o telefone
gravado continua torto.

Procure no fim: `[0037] telefones desgrudados: 57`.

---

## 1. WhatsApp — "mensagens não estão chegando"

**Não era o realtime.** Testei de ponta a ponta: criei um usuário temporário,
assinei o canal, inseri uma mensagem e o evento chegou. A ingestão também estava
viva (última mensagem 12 minutos antes do teste).

**Era o telefone.** O Bitrix manda telefone como lista, e o nosso normalizador
fazia `replace(/\D/g,'')` na string inteira — **grudando os números**:

```
" 5519993152056,  551993152056"   →  55199931520565 51993152056
"5547999689893554799689893"        (dois números, 25 dígitos)
```

Para esses leads a chave do telefone dava `null`, o webhook não achava o lead e
**a mensagem era descartada em silêncio**. Medido: **57 leads**.

Corrigido nos dois lados (leitura e gravação), validado contra a base real:
**de 57 telefones ilegíveis para 0, sem nenhuma regressão** — nenhum telefone que
já funcionava mudou de chave. Inclui número estrangeiro (Portugal, Alemanha,
Paraguai), que a regra brasileira rejeitava.

**Como testar:** peça pra alguém de um desses números mandar mensagem. Ela tem
que aparecer na conversa do lead. A lista dos 57:

```sql
select id, full_name, phone from qs_leads where phone !~ '^\d{10,15}$';
```

Depois da 0037 essa consulta deve voltar quase vazia (só estrangeiros).

### O que mais foi feito no WhatsApp

**Rede de segurança do tempo real.** O realtime funciona, mas é um websocket numa
aba aberta o dia inteiro: notebook dorme, wi-fi troca, proxy derruba conexão
ociosa — e quando volta, ele **não reenvia o que passou**. Agora a conversa e a
lista recarregam ao voltar o foco e em intervalo curto com a aba visível. "Sumiu
uma mensagem" vira "apareceu 45 segundos depois".

**Descarte deixou de ser invisível.** O webhook responde 200 e segue a vida
quando não consegue tratar a mensagem (é proposital: erro ali vira retentativa
eterna do Chatwoot). Agora cada descarte vira uma linha em `qs_wa_descartadas`.

**Isso te dá uma lista comercial de graça** — quem falou com a agência pelo
WhatsApp e não está no CRM:

```sql
select phone, count(*) as mensagens, max(created_at) as ultima
  from qs_wa_descartadas
 where motivo = 'sem-lead-correspondente'
   and created_at > now() - interval '30 days'
 group by phone order by ultima desc;
```

---

## 2. Agendamento — "a tela fica piscando"

**Bug meu, de ontem.** A miniatura da agenda recebia `dia={new Date(...)}` — um
objeto novo a cada render do formulário — e o formulário re-renderiza **a cada
tecla digitada**. Cada tecla disparava uma recarga completa da agenda (4
consultas) e trocava a lista por "Carregando…".

Medido com um pai que re-renderiza a cada 500ms:

| | requisições em 6 segundos |
|---|---|
| antes | **50** |
| depois | **6** |

O horário parou de fugir do clique.

**Como testar:** Painel → concluir uma atividade com **Ganho / Agendou** →
escolher o responsável → digitar no campo de e-mail ou valor. A agenda embaixo
tem que ficar **parada**, e o horário livre continuar clicável.

---

## 3. UX — atividades em massa

O SDR dispara 20 WhatsApps num intervalo e depois fecha 20 atividades uma a uma:
40 cliques. Agora tem **"Selecionar várias"** no topo da fila — marca as pílulas
e resolve tudo de uma vez: **Concluir**, **Não atendeu**, **Caixa postal**.

Ganho e Perdido ficam **fora** de propósito: exigem reunião e motivo, decisão
caso a caso.

**Como testar:** Painel → "Selecionar várias" → marque 2 ou 3 → "Concluir". Tem
que pedir confirmação com o número, mostrar o progresso e sumir da fila só o que
o banco aceitou.

### O detalhe que quase passou

Na primeira versão, o lote chamava a conclusão direto — e **furava a invariante
anti-lead-órfão**: no caminho normal, "não atendeu" cria a próxima atividade, e
sem ela o lead some de todas as filas. Vinte leads sumiriam de uma vez, em
silêncio. Corrigido: o lote usa o mesmo caminho do um-a-um (follow-up,
`markContacted` e aviso ao Bitrix), e no fim **pergunta ao banco** quais leads
ficaram sem nada pendente — se algum ficou, você é avisado na hora.

---

## 4. Papel Marketing

Criado o papel **espectador**: vê Leads, Cobertura, Cadências, Reuniões,
Dashboard e Análises do time inteiro, e **não executa nada**.

A trava está no **banco** (migration 0036), não na tela: esconder botão não
impede ninguém — todo login fala com o PostgREST usando o próprio token.

**Como testar:** crie um usuário com papel "Marketing (só visualiza)", logue com
ele e tente editar qualquer lead. Tem que aparecer *"Perfil Marketing é somente
leitura"*. **Se conseguir editar, me avise na hora.**

---

## O que continua pendente (não é regressão)

- **A agenda com Google Meet ainda está desligada**: faltam `N8N_AGENDA_URL` e
  `N8N_AGENDA_SECRET` na Vercel. O passo a passo está em
  `docs/LIGAR-AGENDA-AMANHA.md`.
- **Espelhamento do desfecho no Bitrix**: os webhooks `qs-ganho` e `qs-reuniao`
  estão desativados no n8n e os campos seguem como `PREENCHA_UF_*`.
- **57 leads duplicados por telefone** (o mesmo número em dois cadastros). A
  mensagem cai no cadastro mais recente. Não mexi — juntar cadastro é decisão de
  negócio, não de código:

```sql
select phone, count(*), string_agg(full_name, ' | ')
  from qs_leads where phone is not null
 group by phone having count(*) > 1 order by 2 desc;
```

---

## O que eu não consegui testar

Sou honesto sobre o limite: **não tenho login no QS**, então validei por medição
no banco, testes automatizados de lógica e simulação no navegador com dados de
mentira. O que **não** foi exercitado com sessão real:

- a barra de seleção em massa clicada de verdade (a lógica foi revisada linha a
  linha e o build passa, mas ninguém clicou nela);
- a miniatura da agenda dentro do modal de Ganho logado;
- o papel Marketing com um usuário real.

São os três primeiros testes que eu faria de manhã.
