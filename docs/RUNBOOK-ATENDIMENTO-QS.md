# Runbook — ligar o Atendimento de WhatsApp dentro do QS

Guia pra você seguir clicando. Cada passo diz **onde ir**, **o que fazer** e
**como saber que deu certo**. Se um passo não der o resultado esperado, pare ali
e vá na seção *Se der errado* no fim — não siga adiante.

> **Por que isso existe:** o Chatwoot community não sabe limitar um atendente às
> conversas dele (é recurso pago). O QS sabe, porque já separa lead por dono no
> banco. Então a conversa passa a acontecer dentro do QS: cada SDR enxerga só a
> carteira dele, e o Chatwoot continua atrás como motor do WhatsApp.

---

## ✅ Estado em 28/07/2026 — só falta o Passo 4

Conferido **por fora**, contra a produção, nesta data:

| Passo | Estado | Como foi verificado |
|---|---|---|
| 1 — segredo do webhook | ✅ **feito** | `POST /api/wa-webhook` com o segredo que está na URL do Chatwoot → **200**. Se não batesse, seria 401. |
| 2 — variáveis da Vercel | ✅ **feito** | Payload de teste com `inbox_id` 1 e 2 → aceito; com 7 → `inbox-fora-do-whatsapp`. Ou seja, `CHATWOOT_WA_INBOX_IDS` está `1,2`. |
| 3 — chave virada no QS | ✅ **feito** | Configurações → Atendimento mostra **"Atendimento no QS ✅"** selecionado, e a tela do SDR traz "Minhas conversas". |
| 4 — teste com dois celulares | ⬜ **falta** | Só você consegue fazer — precisa mandar mensagem de um número de fora. |
| 5 — `signMsg` da Evolution | ✅ **feito** | Desligado nas **duas** instâncias via API; `chatwoot/find` confirma `signMsg=false`. |

Também já estavam prontos: migration `0024` aplicada, webhook cadastrado
(`message_created`), caixa "Comercial - Closers" (id 2) no número 11 95125-1935,
e o código no ar.

> Os testes de diagnóstico usaram um telefone inexistente (`+5500000000000`) e um
> evento que a rota ignora — nenhuma conversa real foi tocada.

---

## Passo 1 — Igualar o segredo do webhook ✅ (feito em 27/07)

**Onde:** vercel.com → projeto **qs-turis** → Settings → Environment Variables →
`WA_WEBHOOK_SECRET` → **Edit**.

**O que fazer:** apagar o que está lá e colar **exatamente** o mesmo texto que
aparece depois de `?secret=` na URL do webhook cadastrado no Chatwoot
(Configurações → Integrações → Webhooks). Sem espaço antes nem depois.

> Como a variável é "Sensitive", a Vercel não deixa você conferir o valor atual —
> só sobrescrever. Então não tente comparar: apague e cole de novo.

Depois: Deployments → três pontinhos do último → **Redeploy**.

**Como saber que deu certo:** me avise. Eu chamo o webhook por fora e digo em 5
segundos se voltou `200` (certo), `401` (ainda diferente) ou `503` (variável
sumiu). — *Feito em 28/07: voltou `200`.*

---

## Passo 2 — Conferir as outras 3 variáveis na Vercel ✅ (feito em 27/07)

**Onde:** vercel.com → projeto **qs-turis** → Settings → **Environment Variables**.

| Variável | O que fazer | Valor |
|---|---|---|
| `CHATWOOT_AGENT_TOKEN` | já existe → deixar | — |
| `CHATWOOT_WA_INBOX_IDS` | **editar** | `1,2` |
| `CHATWOOT_DEFAULT_INBOX_ID` | criar (se ainda não existir) | `2` |

Três avisos que evitam dor de cabeça:

- O `CHATWOOT_WA_INBOX_IDS` foi criado em 23/jul, quando só existia a caixa 1. Se
  ficar `1`, **todo o número novo (caixa 2) é ignorado em silêncio** — tela vazia,
  zero mensagem de erro. Tem que virar `1,2`.
- Essas variáveis são "Sensitive": a Vercel não deixa você **ler** o valor atual,
  só sobrescrever. Então edite digitando o valor novo, sem medo.
- O `WA_WEBHOOK_SECRET` tem que ser **idêntico**, caractere por caractere, ao que
  está depois de `?secret=` na URL do webhook no Chatwoot. Um caractere diferente
  = nenhuma mensagem entra.

**Depois de salvar:** Deployments → nos três pontinhos do último → **Redeploy**.
Variável nova só vale em deploy novo.

**Como saber que deu certo:** me avise que eu testo o webhook por fora — ele
responde `200` se o segredo bateu, `401` se estiver diferente e `503` se a
variável nem existir. Descubro qual dos três em 5 segundos.

---

## Passo 3 — Virar a chave no QS ✅ (feito)

**Onde:** QS → **Configurações** → aba **Atendimento (WhatsApp)**.
**O que fazer:** escolher **"Atendimento no QS ✅"**.

> ⚠️ **Não faça este passo antes do Passo 1.** O app que está no ar hoje não
> conhece a opção nova — se a chave virar antes do deploy, os SDRs caem no
> **ChatApp antigo** sem aviso nenhum.

**Como saber que deu certo:** recarregue o QS. O botão verde de WhatsApp continua
no mesmo canto, mas ao abrir aparece **"Minhas conversas"** (lista), e não mais o
painel do Chatwoot dentro de um quadro.

---

## Passo 4 — Testar de verdade (o teste que importa) ⬜ **É O ÚNICO QUE FALTA**

Faça nesta ordem, com dois celulares ou um celular e um colega:

1. **De um celular de fora**, mande uma mensagem pro número **11 95125-1935**.
   Use um número que já seja **lead de um SDR específico** no QS — é isso que
   estamos testando.
2. **No QS, logado como aquele SDR**: em segundos o botão verde deve ganhar uma
   **bolinha com o número de não lidas**, e a conversa aparece no topo da lista.
3. **Abra e responda pelo QS.** A resposta tem que chegar no celular.
4. **Agora o teste de verdade:** entre com **outro SDR** e confirme que aquela
   conversa **não aparece** pra ele.

Se os 4 passarem, está no ar.

> Lead que ainda não existe no QS, ou com telefone diferente do que ele usou pra
> te chamar, não casa — a conversa fica só no Chatwoot. Isso é de propósito.

---

## Passo 5 — Desligar a assinatura automática do Chatwoot ✅ (feito em 28/07)

A caixa assinava cada mensagem com o nome do agente do Chatwoot. Como o QS envia
por um usuário técnico único, **o cliente via sempre o mesmo nome**, que não era o
do SDR que escreveu. E desde 28/07 **quem assina é o QS**, com o nome certo de
cada um — com os dois ligados o cliente receberia **duas** assinaturas.

Desligado nas duas instâncias (`Comercial - Closers (1935)` e
`Comercial - 1 (SDRs)`); `chatwoot/find` confirma `signMsg=false` nas duas.

Se algum dia precisar refazer (instância recriada, por exemplo): a Evolution
**sobrescreve a config inteira** neste POST, então leia a atual, mude só o campo
e devolva o resto igual — mandar só `{"signMsg": false}` apaga o resto.

```bash
# 1) ler:  GET  /chatwoot/find/<instancia>   (header apikey)
# 2) POST /chatwoot/set/<instancia> com o MESMO corpo + "signMsg": false
curl -X POST "https://evo.setuforeuvouviagens.com.br/chatwoot/set/<instancia>" \
  -H "apikey: $AUTHENTICATION_API_KEY" -H "Content-Type: application/json" \
  -d '{ ...o mesmo corpo de antes..., "signMsg": false }'
```

> Pegadinha: `daysLimitImportMessages` volta do GET como `""` e o POST exige
> **número** — mande `0`. Sem isso a API responde 400 e nada muda.
>
> O nome da instância tem espaço e parênteses: precisa vir URL-encoded na rota.

---

## Assinatura do SDR na mensagem (2026-07-28)

O time inteiro escreve pelo mesmo número, então sem assinatura o cliente não
sabe com quem está falando. Toda mensagem enviada pelo QS agora sai assim:

```
*Victor Hugo*
Oi João, tudo bem? Vi que você se interessou pela expedição…
```

**Onde se configura:** Configurações → **Atendimento (WhatsApp)** → *Assinatura
da mensagem*. Há um interruptor geral e um campo por pessoa (SDR, closer, gestor
e admin). Deixar em branco usa o nome sugerido, tirado do cadastro: os dois
primeiros nomes, ignorando conectivos — "Victor Hugo Silva Santos" vira
"Victor Hugo", "Mariana de Souza" vira "Mariana". Preencha só quem precisa de um
nome diferente do cadastrado.

**Como ficou configurado em 28/07** (interruptor ligado):

| Cadastro | Assina como | Origem |
|---|---|---|
| Victor Hugo | `Victor Hugo` | automático |
| Mariana | `Mariana` | automático |
| Yanca Manuella Ruivo | `Yanca` | preenchido à mão |
| John Italo | `John Italo` | automático |
| Master / Administrador (contas suas) | `Master` / `Administrador` | automático — **decida se quer trocar** |

> As duas contas de admin assinariam com o nome da conta. Se você usa alguma
> delas pra falar com cliente, preencha um nome de gente nesses dois campos.

**Onde o carimbo acontece:** no servidor (`api/_wa.js`), no momento do envio. O
navegador manda só o texto — um SDR **não consegue** enviar mensagem assinada com
o nome de outro. A configuração fica em cache de 60s por instância da função, então
uma mudança leva até um minuto pra valer em todos os envios.

**Onde vale:**

| Caminho | Assina? |
|---|---|
| Atendimento no QS — texto | sim |
| Atendimento no QS — foto/arquivo (na legenda) | sim |
| Atendimento no QS — **nota de voz** | não (o WhatsApp não mostra legenda de áudio) |
| Modal de WhatsApp — envio pelo ChatApp | sim |
| Modal de WhatsApp — texto copiado / link wa.me | sim |
| Disparos do **n8n** (automação) | não — não é uma pessoa falando |

Reenviar um texto que já está assinado não empilha duas assinaturas.

---

## Se der errado

| O que você vê | Causa provável | O que fazer |
|---|---|---|
| Lista "Minhas conversas" vazia, mesmo com mensagem nova chegando | webhook batendo em 404 (código não subiu) ou segredo diferente | Confirmar o Passo 1; depois eu testo o segredo por fora |
| Conversas do número novo não aparecem, as do antigo sim | `CHATWOOT_WA_INBOX_IDS` ficou `1` | Editar pra `1,2` e **redeploy** |
| Abre a conversa mas o histórico antigo não vem | token do Chatwoot inválido | Sobrescrever `CHATWOOT_AGENT_TOKEN` com o Access Token do agente admin |
| "Não consegui abrir a conversa" ao enviar pra um lead novo | falta `CHATWOOT_DEFAULT_INBOX_ID` | Criar com valor `2` e redeploy |
| Abriu o ChatApp velho em vez do novo | chave virada antes do deploy | Esperar o deploy e recarregar |
| Mensagem enviada chega assinada com nome errado | `signMsg` ligado | Passo 5 |
| Mensagem chega com **duas** assinaturas (nome do bot + nome do SDR) | `signMsg` ligado junto com a assinatura do QS | Passo 5 |
| Mensagem chega **sem** o nome do SDR | interruptor desligado, ou nome mapeado em branco | Configurações → Atendimento → Assinatura da mensagem |
| SDR trocou de nome e a mensagem saiu com o antigo | cache de 60s do servidor | Esperar um minuto |

## Como voltar atrás

**Rollback instantâneo, sem deploy:** Configurações → Atendimento → escolher
**"Chatwoot (embedado)"**. Volta exatamente ao comportamento de antes. As tabelas
novas ficam lá paradas, sem atrapalhar nada.

## Duas coisas que deixaram de ser necessárias

Como o SDR agora atende sem sair do QS, **ele não precisa mais de conta no
Chatwoot**. Isso derruba duas pendências antigas: criar senha/confirmar os 3 SDRs
no super_admin e configurar SMTP só pra mandar convite. Se você ainda quiser que
alguém use o Chatwoot direto (você, pra auditar), aí sim mantém a conta.

## Pendência separada (não bloqueia nada disso)

O número **11 92029-4441** (caixa 1) está **desconectado** desde antes de hoje.
Decidir se reconecta ou aposenta — e lembrando que conversa **não passa de um
número pro outro** no Chatwoot, então a recomendação segue sendo **um número só
com os 4 Times**.
