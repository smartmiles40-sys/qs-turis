# Workflows n8n — lista de resgate

Dois workflows prontos para importar no n8n. Os dois entregam na cadência
**"Resgate — Base Fria"**, separada da Cadência SDR de propósito: quem está sendo
trabalhado hoje não é tocado.

| Arquivo | Para quê |
|---|---|
| `qs-resgate-carga-lista.json` | Subir de uma vez a lista que você já tem. Roda quando você clica. |
| `qs-resgate-webhook.json` | Deixar ligado: cada lead que chegar nesse endereço entra no resgate. |

## Como importar (vale para os dois)

1. n8n → menu **⋯** no canto superior direito → **Import from File**
2. Escolha o `.json`
3. Abra o nó **"Enviar para o QS (lista resgate)"** → aba **Headers** → troque
   `SEU_LEAD_INBOUND_SECRET_AQUI` pelo valor real do `LEAD_INBOUND_SECRET`
   (o mesmo que a sua automação do Bitrix já usa)
4. **Save**

Esse passo 3 é o único obrigatório. Se esquecer, o workflow responde
*"Segredo recusado"* — nada quebra, nada entra.

## Subir a sua lista (`qs-resgate-carga-lista.json`)

Abra o nó **"A sua lista de leads"** e cole as pessoas dentro dos colchetes:

```js
const LISTA = [
  { nome: "Maria Silva", telefone: "62 99999-0001", email: "maria@x.com", fonte: "Lista resgate agosto" },
  { nome: "João Souza",  telefone: "5562999990002",                        fonte: "Lista resgate agosto" },
];
```

O telefone pode vir como estiver — `(62) 99999-0001`, `062 99999 0003`, `+55 11 98888-0005`
viram todos o formato que o QS entende. Isso importa porque é pelo telefone que o QS
descobre se a pessoa já está na base.

Clique em **Test workflow**. No fim, o nó **"Resumo da carga"** mostra:

```
total_enviado, criados_no_resgate, ja_existiam_no_qs, falharam, primeiros_erros
```

Manda 5 por vez com 1 segundo entre as levas — dá para rodar milhares sem derrubar nada.

## Webhook contínuo (`qs-resgate-webhook.json`)

Depois de salvar e **ativar**, o n8n te dá a URL de produção (algo como
`https://SEU-N8N/webhook/qs-resgate`). Aponte a origem para ela mandando POST com:

```json
{ "nome": "Maria Silva", "telefone": "62 99999-0001", "email": "maria@x.com" }
```

Também aceita `full_name` / `phone` / `email`, e ainda `cidade`, `estado`, `empresa`,
`fonte`, `bitrix_id`.

## Três coisas que valem saber

**Quem já está no QS não muda de cadência.** O QS deduplica por telefone, e-mail e
bitrix_id. Se a pessoa já existe, a resposta volta `ja_existia` e ela **continua na
cadência em que estava** — nada é sobrescrito. É de propósito: assim uma carga de resgate
nunca atropela quem está sendo trabalhado. O resumo avisa quantos caíram nesse caso.

**Nada some em silêncio.** Linhas incompletas são enviadas do mesmo jeito e o QS recusa
com o motivo; elas aparecem em `falharam` / `primeiros_erros`. Se fossem descartadas antes,
você acharia que subiu a lista inteira.

**O endereço é que decide a cadência.** É o `?lista=resgate` no fim da URL. Se alguém
escrever errado, a resposta é erro — o lead **não** cai na cadência do tráfego por engano.
Os apelidos disponíveis ficam em `qs_settings.webhook_listas`.

## O plano da cadência de resgate

4 toques em 10 dias, só em dias úteis:

| Dia | Canal | Horário |
|---|---|---|
| 1 | WhatsApp | manhã |
| 3 | Ligação | tarde |
| 7 | WhatsApp | manhã |
| 10 | Ligação | tarde |

Quem não responder volta a "perdido" sozinho em 14 dias, para a lista não empilhar.
Dá para mudar tudo isso em **Cadências → Resgate — Base Fria**; mexer no plano não
altera quem já entrou.
