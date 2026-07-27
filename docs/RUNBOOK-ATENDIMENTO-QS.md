# Runbook — ligar o Atendimento de WhatsApp dentro do QS

Guia pra você seguir clicando. Cada passo diz **onde ir**, **o que fazer** e
**como saber que deu certo**. Se um passo não der o resultado esperado, pare ali
e vá na seção *Se der errado* no fim — não siga adiante.

> **Por que isso existe:** o Chatwoot community não sabe limitar um atendente às
> conversas dele (é recurso pago). O QS sabe, porque já separa lead por dono no
> banco. Então a conversa passa a acontecer dentro do QS: cada SDR enxerga só a
> carteira dele, e o Chatwoot continua atrás como motor do WhatsApp.

---

## Já está pronto (não precisa refazer)

- ✅ **Migration `0024`** aplicada no Supabase — testei as tabelas, as funções e a
  regra de privacidade; tudo respondendo certo.
- ✅ **Webhook cadastrado** no Chatwoot apontando pro QS (`message_created`).
- ✅ **Caixa "Comercial - Closers"** (id 2) criada e ligada ao número 11 95125-1935.

## O que falta — 4 passos

---

## Passo 1 — Subir o código (eu faço)

**Onde:** aqui na conversa.
**O que fazer:** me dar o ok pra commitar e pushar. O push na `main` dispara o
deploy de produção na Vercel sozinho (~2 min).

**Como saber que deu certo:** eu te confirmo que `/api/wa-webhook` parou de
responder 404. Enquanto estiver 404, **nada** do resto funciona — o webhook que
você cadastrou está batendo numa porta que ainda não existe.

---

## Passo 2 — Conferir as 4 variáveis na Vercel

**Onde:** vercel.com → projeto **qs-turis** → Settings → **Environment Variables**.

| Variável | O que fazer | Valor |
|---|---|---|
| `CHATWOOT_AGENT_TOKEN` | já existe → deixar | — |
| `CHATWOOT_WA_INBOX_IDS` | **editar** | `1,2` |
| `CHATWOOT_DEFAULT_INBOX_ID` | criar | `2` |
| `WA_WEBHOOK_SECRET` | criar | o mesmo segredo que está no fim da URL do webhook no Chatwoot |

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

## Passo 3 — Virar a chave no QS

**Onde:** QS → **Configurações** → aba **Atendimento (WhatsApp)**.
**O que fazer:** escolher **"Atendimento no QS ✅"**.

> ⚠️ **Não faça este passo antes do Passo 1.** O app que está no ar hoje não
> conhece a opção nova — se a chave virar antes do deploy, os SDRs caem no
> **ChatApp antigo** sem aviso nenhum.

**Como saber que deu certo:** recarregue o QS. O botão verde de WhatsApp continua
no mesmo canto, mas ao abrir aparece **"Minhas conversas"** (lista), e não mais o
painel do Chatwoot dentro de um quadro.

---

## Passo 4 — Testar de verdade (o teste que importa)

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

## Passo 5 (recomendado, não urgente) — Desligar a assinatura automática

Hoje a caixa assina cada mensagem com o nome do agente do Chatwoot. Como o QS
envia por um usuário técnico único, **o cliente veria sempre o mesmo nome**, que
não é o do SDR que escreveu. Pra desligar, rode no terminal do VPS (ou me peça):

```bash
curl -X POST "https://evo.setuforeuvouviagens.com.br/chatwoot/set/<instancia>" \
  -H "apikey: $AUTHENTICATION_API_KEY" -H "Content-Type: application/json" \
  -d '{ ...o mesmo corpo de antes..., "signMsg": false }'
```

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
