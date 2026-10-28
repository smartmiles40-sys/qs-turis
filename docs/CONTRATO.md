# Contrato e pagamento no cartão do closer (sem n8n, sem Google)

**22/10/2026, revisto em 27/10/2026. Migrations 0180, 0181 e 0212.**

O contrato sai **100% pelo código do QS**. Desde 27/10 o QS não usa mais
Google Docs, Drive nem Cloud Console. Os dois modelos, pacote e expedição,
moram em `api/_contratoModelo.js`.

O texto jurídico desses modelos foi transcrito **sem nenhuma alteração** dos
PDFs aprovados. As duplicidades e os erros de digitação continuam lá, porque é
decisão do jurídico. O closer só mexe nos **dados**, e o QS deixa esses dados
num formato padrão.

```
Cartão do closer → "Enviar contrato" → prévia dos campos (o closer corrige; "Ver PDF" mostra como sai)
  → /api/closer?acao=contrato-enviar (servidor, Vercel)
      1. padroniza os dados (CPF, telefone, e-mail, valor, datas) e valida
      2. monta o PDF pelo modelo do QS (pdfmake; fontes Tinos/Roboto e logo em api/_contrato_assets/)
      3. guarda o PDF no Storage (bucket privado `contratos`); se falhar, só avisa e segue
      4. cria o documento no ZapSign (cliente + assinante da agência, external_id = id do cartão)
  → qs_contratos guarda cada envio; o cartão vai pra "Contrato enviado"
ZapSign → /api/closer?acao=zapsign-webhook&s=<segredo> → confere no ZapSign → visualizado / assinado / recusado
  → assinado: cartão vai pra "Contrato assinado" e o PDF assinado é arquivado no bucket
```

Se faltar alguma configuração, o cartão entra em **modo manual**. Nesse modo o
closer cola o link do contrato que mandou por fora e marca "Assinou" à mão.
O botão "Ver PDF" da prévia funciona também no modo manual.

**Mudar o texto do contrato:** só com o jurídico. O texto fica em
`api/_contratoModelo.js` e muda no código, com um commit novo.

---

## 1. Aplicar as migrations (nesta ordem)

1. `0174`, `0175` e `0176` (área do closer), se ainda não estiverem aplicadas.
2. `0180_closer_contrato.sql`: tabelas `qs_contratos`, `qs_contrato_config`, `qs_contrato_webhooks` e as funções do status. A tabela `qs_contrato_google` ficou sem uso.
3. `0181_closer_pagamento_manual.sql`: link e pagamento no cartão.
4. `0212_contratos_storage.sql`: cria o bucket privado `contratos`, onde ficam o PDF enviado e o assinado. Sem ela o envio funciona igual, mas não fica cópia no QS.

## 2. Envs na Vercel (projeto do QS)

| Env | Pra quê |
|---|---|
| `ZAPSIGN_API_TOKEN` | Token **novo** da API do ZapSign (veja o passo 5) |
| `ZAPSIGN_WEBHOOK_SECRET` | Um texto aleatório longo. O mesmo valor vai no fim da URL do webhook (`&s=`) |
| `QS_URL_PUBLICA` *(opcional)* | Ex.: `https://qs.seudominio.com.br`. Fixa a URL do webhook mostrada na tela |
| `ZAPSIGN_API_URL` *(opcional)* | Só pra testar no sandbox: `https://sandbox.api.zapsign.com.br` |

Nenhum segredo fica no código nem no navegador. As envs do Google OAuth não são mais usadas.

## 3. Configurar no QS

1. Abra o QS e vá em **Closer → Gestão → Configurar contrato**. Só a gestão do Comercial e o admin veem essa tela.
2. Confira o assinante da agência: Luís Antonio Caetano, contato@setuforeuvou.com, 5585987660748.
3. Clique em **Testar o token do ZapSign**. Quando a lista "Falta pra ligar o envio automático" sumir, o envio automático está ligado.

## 4. Webhook do ZapSign

No ZapSign, vá em **Configurações → Integração → Webhooks**:

- **URL:** a da tela *Configurar contrato*, que já vem com o segredo no fim:
  `https://<domínio do QS>/api/closer?acao=zapsign-webhook&s=<ZAPSIGN_WEBHOOK_SECRET>`
- **Eventos:** "Todos (documentos)".
- **Header:** não precisa, porque o painel do ZapSign não tem esse campo. O header `X-QS-Secret` continua aceito.

O que o QS faz quando um aviso chega:

- recusa o aviso se o segredo estiver errado (401);
- responde 503 enquanto a env não existir;
- ignora avisos repetidos (idempotente, pelo hash do corpo);
- **não confia no corpo do aviso**: com o token do documento, consulta de novo `GET /api/v1/docs/{token}/` no ZapSign e usa o status de lá;
- o status só anda pra frente (enviado → visualizado → assinado);
- se der erro, responde 500 pra o ZapSign tentar de novo.

Além do webhook, o botão **Atualizar status** no cartão consulta o ZapSign na hora.

## 5. Desligar o caminho antigo (OBRIGATÓRIO, depois do 1º contrato pelo QS)

1. **Revogar o token antigo do ZapSign.** Ele estava escrito dentro do workflow do n8n.
   No ZapSign, gere um token novo pra `ZAPSIGN_API_TOKEN` e **apague o antigo**.
   Não copie o token antigo pra lugar nenhum.
2. **Desligar o robô do Bitrix que chama o n8n de contrato.** É o robô da etapa de contrato no funil Comercial, o que dispara o webhook do n8n.
   Se ficar ligado, **o cliente recebe dois contratos**.
3. Desativar o workflow de contrato no n8n.

## 6. Como os campos são preenchidos

A prévia busca cada campo na primeira fonte que tiver valor, nesta ordem:

1. o último envio deste cartão (o que o closer já corrigiu);
2. a ficha / proposta aprovada / cadastro do cliente (`rel_clientes`);
3. o negócio e o contato do Bitrix (mesmos campos `UF_CRM_*` do n8n);
4. o lead do QS;
5. o nome do closer e a data de hoje.

Cada campo mostra de onde veio. O closer corrige o que precisar antes de enviar.

Campos obrigatórios:
- nome;
- CPF válido;
- e-mail;
- telefone;
- valor total;
- forma de pagamento;
- data da venda;
- **destino** (pacote) ou **nome da expedição** (expedição).
- no pacote, **o que está incluso**: um item por linha, e o que vem antes dos dois-pontos sai em negrito;
- datas válidas em dd/mm/aaaa, com a volta depois da ida.

Campo vazio que não é obrigatório entra no contrato como `-`.
Padronização automática: CPF `000.000.000-00`, telefone `(85) 98766-0748`, e-mail em minúsculas, valor `R$ 26.990,00`, datas `dd/mm/aaaa` e espaços repetidos removidos do nome.

Enviar de novo pelo mesmo cartão pede confirmação. O envio anterior é
cancelado no ZapSign e marcado como "cancelado" no histórico.

## 7. Pagamento (sem gateway, por decisão)

Pagar.me e Asaas **não** entram agora. No cartão:

- **Colar link de pagamento:** o closer cola o link que mandou ao cliente e o status vira "Pagamento enviado".
- **Marcar como pago:** o status vira "Pago". Se a venda já tem plano (`fin_parcelas`), o closer pode escolher a parcela, e ela recebe baixa junto.
- **Pedir link ao Financeiro** (crédito recorrente ou pagamento futuro): cria uma solicitação na Central (tipo *Gerar link de pagamento*, prazo de 4h, 2h na alta, 1h na urgente). Quando o Financeiro **conclui colando o link na resolução**, o link aparece sozinho no cartão do closer.
- **Desfazer:** tira o status de pagamento. Isso não desfaz a baixa de parcela, que é com o Financeiro.

## 8. Testar (roteiro curto)

1. Sem envs: o cartão mostra "modo manual". Cole um link e marque "Assinou"; o cartão anda.
2. Na prévia, clique em **Ver PDF** e compare com o contrato aprovado (pacote e expedição).
3. Com sandbox (`ZAPSIGN_API_URL`), envie um contrato num cartão de teste. Confira:
   - o documento existe no ZapSign;
   - o botão "Ver PDF enviado" abre o PDF (precisa da 0212).
4. Assine no sandbox. Pelo webhook (ou pelo botão "Atualizar status"), o cartão vai pra "Contrato assinado" e aparece "Ver PDF assinado".
5. Peça um link ao Financeiro, conclua a solicitação com `https://...` na resolução e veja o link no cartão.
