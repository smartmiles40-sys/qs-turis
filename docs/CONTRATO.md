# Contrato e pagamento no cartão do closer (sem n8n)

**22/10/2026. Branch `closer-contrato-v3`. Migrations 0180 e 0181.**

O contrato agora sai **100% pelo código do QS**. O n8n não participa mais.
O caminho é este:

```
Cartão do closer → "Gerar contrato" → prévia dos campos (o closer corrige)
  → /api/closer?acao=contrato-enviar (servidor, Vercel)
      1. copia o modelo do Google Docs (pacote ou expedição), já convertendo pra Doc
      2. troca as tags {{...}} (MESMO mapa do n8n)
      3. TRAVA: se sobrou "{{" no documento, para e mostra quais tags faltaram
      4. exporta PDF → sobe na pasta de contratos do Drive → apaga o Doc temporário
      5. cria o documento no ZapSign (cliente + assinante da agência, external_id = id do cartão)
  → qs_contratos guarda cada envio; o cartão vai pra "Contrato enviado"
ZapSign → /api/closer?acao=zapsign-webhook → confere no ZapSign → visualizado / assinado / recusado
  → assinado: cartão vai pra "Contrato assinado" e o PDF assinado é arquivado na mesma pasta
```

Se faltar alguma configuração, o cartão entra em **modo manual**. Nesse modo o
closer cola o link do contrato que mandou por fora e marca "Assinou" à mão.

---

## 1. Aplicar as migrations (nesta ordem)

1. `0174`, `0175` e `0176` (área do closer, que vem da branch `closer-area-v2`), se ainda não estiverem aplicadas.
2. `0180_closer_contrato.sql`: tabelas `qs_contratos`, `qs_contrato_config`, `qs_contrato_google`, `qs_contrato_webhooks` e as funções do status.
3. `0181_closer_pagamento_manual.sql`: link e pagamento no cartão, além do tipo de solicitação `fin_link_pagamento`.

Os dois arquivos foram ensaiados com `BEGIN … ROLLBACK`. Cole no SQL Editor do Supabase.

## 2. Cliente OAuth do Google (uma vez)

O próprio QS faz o login no Google. Pode reaproveitar o projeto do Google Cloud que o n8n já usava.

1. Abra o Google Cloud Console, vá em **APIs e serviços → Biblioteca** e ative a **Google Drive API** e a **Google Docs API**.
2. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha o tipo **Aplicativo da Web**.
3. Em **URIs de redirecionamento autorizados**, cadastre exatamente esta URL:
   `https://<domínio do QS>/api/closer?acao=google-callback`
   A tela *Closer → Gestão → Configurar contrato* mostra essa URL pronta pra copiar.
4. Na **Tela de consentimento OAuth**, deixe o app em produção, para o token não vencer em 7 dias. Os escopos usados são `drive` e `documents`.

## 3. Envs na Vercel (projeto do QS)

| Env | Pra quê |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | ID do cliente OAuth (passo 2) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Segredo do cliente OAuth. Também assina o `state` do login |
| `ZAPSIGN_API_TOKEN` | Token **novo** da API do ZapSign (veja o passo 6) |
| `ZAPSIGN_WEBHOOK_SECRET` | Um texto aleatório longo, inventado por você. O mesmo valor vai no header do webhook |
| `QS_URL_PUBLICA` *(opcional)* | Ex.: `https://qs.seudominio.com.br`. Fixa a URL de retorno do Google. Sem ela, o QS usa o domínio da requisição |
| `ZAPSIGN_API_URL` *(opcional)* | Só pra testar no sandbox: `https://sandbox.api.zapsign.com.br`. Em produção, não defina |

Nenhum segredo fica no código nem no navegador. O refresh token do Google fica
na tabela `qs_contrato_google`, que só o servidor (service role) lê.

## 4. Conectar a conta Google

1. Abra o QS e vá em **Closer → Gestão → Configurar contrato**. Só a gestão do Comercial e o admin veem essa tela.
2. Clique em **Conectar conta Google** e entre com a conta que é dona (ou editora) dos modelos e da pasta. Marque Drive e Docs.
3. Confira os IDs, que já vêm preenchidos:
   - Modelo PACOTE: `1vRh_zQHh-Q2rD8g0FsGIHRxAwqwtPY7X`
   - Modelo EXPEDIÇÃO: `1FbKqTW5ysiFbKQI_9eM0xDPJ123Zz0UG`
   - Pasta dos contratos: `14sJB-IOUEBjcyq0R6JxF5ZO1AaY0exQ8`
   - Assinante da agência: Luís Antonio Caetano, contato@setuforeuvou.com, 5585987660748
4. Clique em **Testar o token do ZapSign**. Quando a lista "Falta pra ligar o envio automático" sumir, o envio automático está ligado.

## 5. Webhook do ZapSign

No ZapSign, vá em **Configurações → Integração → Webhooks**:

- **URL:** `https://<domínio do QS>/api/closer?acao=zapsign-webhook`
- **Header:** `X-QS-Secret: <o mesmo valor de ZAPSIGN_WEBHOOK_SECRET>`
- **Eventos:** documento assinado, signatário assinou, documento recusado e, se o plano tiver, documento visualizado.

O que o QS faz quando um aviso chega:

- recusa o aviso se o header estiver errado (401);
- responde 503 enquanto a env não existir;
- ignora avisos repetidos (idempotente, pelo hash do corpo);
- **não confia no corpo do aviso**: com o token do documento, consulta de novo `GET /api/v1/docs/{token}/` no ZapSign e usa o status de lá;
- o status só anda pra frente (enviado → visualizado → assinado);
- se der erro, responde 500 pra o ZapSign tentar de novo.

Além do webhook, o botão **Atualizar status** no cartão consulta o ZapSign na hora.

## 6. Desligar o caminho antigo (OBRIGATÓRIO, depois do 1º contrato pelo QS)

1. **Revogar o token antigo do ZapSign.** Ele estava escrito dentro do workflow do n8n.
   No ZapSign, gere um token novo pra `ZAPSIGN_API_TOKEN` e **apague o antigo**.
   Não copie o token antigo pra lugar nenhum.
2. **Desligar o robô do Bitrix que chama o n8n de contrato.** É o robô da etapa de contrato no funil Comercial, o que dispara o webhook do n8n.
   Se ficar ligado, **o cliente recebe dois contratos**.
3. Desativar o workflow de contrato no n8n.

## 7. Como os campos são preenchidos

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

Campo vazio que não é obrigatório entra no contrato como `-`, igual ao n8n.
O valor sai no formato `26.990,00`.

Enviar de novo pelo mesmo cartão pede confirmação. O envio anterior é
cancelado no ZapSign e marcado como "cancelado" no histórico.

## 8. Pagamento (sem gateway, por decisão)

Pagar.me e Asaas **não** entram agora. No cartão:

- **Colar link de pagamento:** o closer cola o link que mandou ao cliente e o status vira "Pagamento enviado".
- **Marcar como pago:** o status vira "Pago". Se a venda já tem plano (`fin_parcelas`), o closer pode escolher a parcela, e ela recebe baixa junto.
- **Pedir link ao Financeiro** (crédito recorrente ou pagamento futuro): cria uma solicitação na Central (tipo *Gerar link de pagamento*, prazo de 4h, 2h na alta, 1h na urgente). Quando o Financeiro **conclui colando o link na resolução**, o link aparece sozinho no cartão do closer.
- **Desfazer:** tira o status de pagamento. Isso não desfaz a baixa de parcela, que é com o Financeiro.

## 9. Testar (roteiro curto)

1. Sem envs: o cartão mostra "modo manual". Cole um link e marque "Assinou"; o cartão anda.
2. Com sandbox (`ZAPSIGN_API_URL`) e Google conectado, gere um contrato num cartão de teste. Confira:
   - o PDF aparece na pasta;
   - o Doc temporário foi apagado;
   - o documento existe no ZapSign.
3. Assine no sandbox. Pelo webhook (ou pelo botão "Atualizar status"), o cartão vai pra "Contrato assinado".
4. Num modelo com tag desconhecida, o envio para com "sobraram tags" e nada vai pro ZapSign.
5. Peça um link ao Financeiro, conclua a solicitação com `https://...` na resolução e veja o link no cartão.
