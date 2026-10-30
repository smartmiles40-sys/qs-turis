# Marketing › E-mail marketing (0245)

E-mail marketing nativo no QS, "tipo ActiveCampaign", com envio pelo **Resend**.
Campanhas com editor por blocos, segmentos E/OU, score do contato, automações simples
(gatilho → e-mails com esperas) e relatórios por campanha.

## O que o Bruno precisa fazer (nesta ordem)

1. **Aplicar a migration `0245_mkt_email.sql`** — DEPOIS da 0242 (contatos da frente Disparos).
   Ela gera sozinha a chave HMAC dos links no Vault (`mkt_email_hmac`). **Nunca troque essa chave**:
   todo link de clique já enviado foi assinado com ela.
2. **Env na Vercel `QS_URL_PUBLICA`** = endereço público DEFINITIVO do QS, com https e sem barra no fim
   (ex.: `https://qs.setuforeuvouviagens.com.br`).
   ⚠️ Esse endereço vai **embutido em cada e-mail enviado** (pixel, cliques, descadastro). Mudar depois
   quebra os e-mails antigos sem conserto — inclusive o descadastro, que é obrigação legal.
   Sem essa env o motor **para de propósito** (a fila espera intacta).
   `CRON_SECRET` já existe no QS e é o mesmo usado pelo cron daqui.
3. **Conta no Resend** (resend.com). Plano grátis: 3 mil e-mails/mês, 100/dia, 2 por segundo.
   Para campanha de verdade, plano pago (Pro: 50 mil/mês). Ajuste o "Ritmo" em Conexão ao limite do plano.
4. **Marketing › E-mail › Conexão** (admin ou papel marketing):
   1. Colar a chave da API (**Full access**, começa com `re_`). Vai pro Vault; não volta pra tela.
   2. Escolher o domínio. Use um **subdomínio só de marketing** (ex.: `mail.setuforeuvouviagens.com.br`) —
      se a reputação do marketing cair, o e-mail do dia a dia (Google/cPanel) não cai junto.
   3. Publicar no DNS os registros que a tela mostra (no painel onde está o DNS do domínio):
      - **MX** e **TXT (SPF)** em `send.<subdomínio>` (retorno de bounce do Resend);
      - **TXT (DKIM)** `resend._domainkey.<subdomínio>`;
      - recomendado: **DMARC** — TXT `_dmarc.setuforeuvouviagens.com.br` = `v=DMARC1; p=none; rua=mailto:<seu e-mail>`
        (Gmail/Yahoo exigem DMARC para quem manda volume).
      Depois "Conferir DNS agora" até ficar `verified` (pode levar de minutos a 48 h).
      **Não mexa nos MX do domínio principal** (memória: MX no Google repassa pro cPanel).
   4. "Criar webhook no Resend". Se a tela pedir, copie o *Signing secret* (`whsec_…`) do painel
      do Resend (Webhooks) e cole. Endereço do webhook: `QS_URL_PUBLICA/api/mkt-email-publico?r=webhook`.
   5. Remetente: nome, e-mail **@ do domínio verificado**, responder-para, rodapé (CNPJ e endereço já
      vêm preenchidos: Se Tu For, Eu Vou! Viagens · CNPJ 53.545.815/0001-12 · Av. Dr. Chucri Zaidan, 1550).
5. Push (= deploy) quando a área de Marketing estiver integrada.

## Como funciona

| Peça | Onde |
|---|---|
| Banco (tabelas, segmentos→SQL, score, gatilhos, RPCs) | `supabase/migrations/0245_mkt_email.sql` |
| Rota logada + cron (a cada 5 min) | `api/mkt-email.js` |
| Rotas públicas: pixel, clique, descadastro, webhook | `api/mkt-email-publico.js` |
| Motor (fila, 429, automações, score diário) | `api/_mktEmailMotor.js` |
| Montagem do e-mail (HMAC, links, pixel, List-Unsubscribe, Svix) | `api/_mktEmailMontar.js` |
| Regras puras (segmentos, fila, automação, pesos) | `api/_mktEmailRegras.js` |
| Resend por `fetch` + config/Vault | `api/_mktEmailResend.js` |
| Telas | `src/mkt/email/` (`ROTAS_EMAIL` em `rotas.ts`) |
| Editor de blocos → HTML de e-mail | `src/mkt/email/lib/blocos.ts` |
| Testes | `tests/mkt-email/*.test.ts` |

- **Fila por destinatário** (`mkt_email_envios`): uma linha por pessoa por campanha (ou por passo de
  automação). Pausar segura a fila; cancelar marca o que falta como `cancelado`.
- **Público** = listas ∩ tags ∩ segmento, menos quem descadastrou (`optout_email_em`) e menos a
  **supressão** (`mkt_email_supressao`: descadastro, bounce, spam — por e-mail, vale mesmo se o contato for
  reimportado). Público vazio = erro, nunca "todo mundo". Segmento apagado = campanha dá erro.
- **429 do Resend**: a tentativa é devolvida e o motor respeita o `Retry-After` (antes, no SendFlow, o 429
  queimava a campanha inteira). 4xx = falha definitiva; 5xx/rede = até 3 tentativas.
- **Clique**: link assinado com HMAC (sem isso o domínio vira redirecionador aberto). Só http(s).
- **Descadastro**: o link do rodapé abre uma página com botão (GET não descadastra — antivírus corporativo
  abre os links sozinho); o POST descadastra. `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` no
  cabeçalho (botão "cancelar inscrição" do Gmail).
- **Webhook** falha FECHADO: sem segredo, 503 (senão qualquer um marcaria a base como bounce).
- **Abertura** é do pixel do QS; clique conta como abertura. O rastreio de abertura/clique do Resend
  deve ficar **desligado** no painel do Resend (senão conta em dobro e reescreve os links).
- **Score**: soma dos pesos dos eventos do contato (`mkt_contato_eventos`) na janela (padrão 90 dias).
  Sobe na hora (abriu/clicou); 1x por dia (horário de SP) o cron recalcula a base inteira para descer o que
  saiu da janela. Pesos editáveis em Segmentos › Pontuação.
- **Automações**: gatilhos no banco — inserir em `mkt_lista_contatos` (entrou na lista), ganhar tag em
  `mkt_contatos.tags`, ou evento `formulario` em `mkt_contato_eventos` (com `dados.formulario` = nome).
  Cada pessoa passa uma vez por automação. Descadastro/bounce/spam cancelam a sequência.
- **Papel marketing**: as tabelas `mkt_email_*` têm RLS própria (não entram no gatilho de "somente leitura"
  das `qs_*`). Marketing/admin escrevem modelos, segmentos, automações e campanhas em rascunho; agendar,
  pausar, configuração e segredos passam pela rota com `service_role`.

## Testes

```bash
node --import ./tests/registrar-ts.mjs --test tests/mkt-email/*.test.ts
```

## Conferência depois de aplicar a 0245 (SQL, só leitura)

```sql
select public.mkt_seg_sql('{"combinar":"todas","condicoes":[{"campo":"tag","op":"tem","valor":"x''; drop table y; --"}]}');
select count(*) from vault.secrets where name = 'mkt_email_hmac';   -- 1
```
