# Disparo em massa (Comercial) e remarketing (Relacionamento) — 28/10/2026

Um motor só pros dois setores: `api/disparos.js` + `api/_disparo.js`, tabelas da
migration `0217_disparo_em_massa.sql`.

- **Comercial** → Gestão › **Disparo em massa** (admin e gestor). Público de leads
  com filtros. Cada lead recebe pelo **número do SDR dono** (Cloud API por
  Coexistência). O disparo é o **passo 1 de uma cadência**.
- **Relacionamento** → Mais › **Disparos e remarketing**. Público de clientes
  (viagem passada, data de volta, sem viagem futura, nível do clube). Sai pelo
  número do Relacionamento e pode levar o **link do grupo da expedição**.

## Regras que não mudam

1. Massa **só pela API oficial da Meta** e **só com modelo aprovado**. Nada de
   Evolution/QR. A Meta bloqueia por 24 h quem manda primeira mensagem pra quem
   nunca escreveu, ou texto igual em massa, fora de modelo.
2. **Teto por número** (por hora e por dia) e **só no horário comercial**. A fila
   anda sozinha, de 5 em 5 minutos (cron), espalhando a hora: nada sai em rajada.
3. Saem da lista sozinhos: quem pediu pra parar, telefone inválido, número
   proibido (1935 e `NUMEROS_PROIBIDOS`), número do time, quem está em conversa
   nas últimas 24 h (o SDR fala direto), quem recebeu disparo nos últimos N dias,
   lead ganho (cliente é do Rel) e lead cujo SDR não tem número conectado.
4. **Começa em simulação.** A fila, o ritmo e o painel funcionam, mas nada sai,
   nenhuma tarefa é criada e nenhum lead muda.

## Como anda uma campanha do Comercial

1. Escolhe o modelo aprovado e diz de onde vem cada `{{n}}` (nome, nome do SDR,
   destino, texto fixo).
2. Filtra o público (fonte, SDR, etapa, cadência atual, data de entrada, tags,
   já respondeu ou nunca respondeu) e vê a prévia: quantos recebem, quantos por
   número e quem sai, com o motivo.
3. Escolhe a cadência e cria (rascunho). **Iniciar** monta a fila.
4. A cada envio real: a bolha aparece no WhatsApp do QS, o lead entra na
   cadência com o 1º WhatsApp já feito (as pendentes da cadência antiga são
   encerradas e perdido ou não iniciado volta pra "em prospecção").
   **O Bitrix não é tocado.**
5. Quem **responde** ganha uma atividade de WhatsApp pra hoje com o SDR dono.
   Quem não responde segue os próximos passos da cadência.
6. O painel mostra o funil: na fila, enviados, entregues, lidos e responderam,
   por SDR, mais as últimas respostas e os pulados/erros.

Pausar, retomar e cancelar ficam na lista. Cancelar tira da fila quem ainda não
recebeu.

## Ritmo (aba "Ritmo e janela", só admin)

Padrão: 30/hora e 150/dia **por número**, de 09:30 às 18:30, de segunda a sexta,
e 7 dias de intervalo mínimo pra mesma pessoa. Número de Coexistência começa com
limite baixo na Meta, e qualidade baixa trava o atendimento também. Suba aos
poucos, olhando a qualidade em Configurações › WhatsApp (Meta).

## Sugestões de modelo

Todos com o botão **"Parar de receber"**: a pessoa que não quer clica no botão
em vez de bloquear, e bloqueio é o que derruba a qualidade do número. Os quatro
são **Marketing**. Exemplos das variáveis entre parênteses.

### 1. `retomada_lead_frio` (Comercial, lead que sumiu)
> Oi, {{1}}! Aqui é {{2}}, da Se Tu For, Eu Vou! 😊 Você chegou a olhar a
> viagem pro {{3}} com a gente e a conversa ficou pela metade. Ainda faz sentido
> pra você? Se quiser, te mando as próximas datas e o que está incluso.

(`{{1}}` Maria = nome · `{{2}}` Victor = SDR · `{{3}}` Japão = destino)

### 2. `pos_live_convite` (Comercial, quem assistiu a live)
> Oi, {{1}}! Obrigado por ter acompanhado a nossa live sobre {{2}}. Aqui é
> {{3}}, da Se Tu For, Eu Vou! Separei um horário pra tirar as suas dúvidas
> sobre roteiro, datas e valores. Quer que eu te explique como funciona?

(`{{1}}` Maria · `{{2}}` Japão = destino · `{{3}}` Victor = SDR)

### 3. `recompra_cliente` (Relacionamento, quem já viajou)
> Oi, {{1}}! Que saudade da nossa viagem pro {{2}}! 🌍 Estamos montando as
> próximas expedições e quem já viajou com a gente fica sabendo primeiro. Quer
> receber as datas e os destinos de 2027?

(`{{1}}` Maria · `{{2}}` Islândia = destino da última viagem)

### 4. `convite_grupo_expedicao` (Relacionamento, alimentar o grupo)
> Oi, {{1}}! Criamos um grupo no WhatsApp com quem já viajou com a gente pra
> trocar fotos, dicas e ver em primeira mão as próximas expedições. Pra entrar,
> é só tocar no link: {{2}} Vai ser ótimo ter você lá!

(`{{1}}` Maria · `{{2}}` https://chat.whatsapp.com/… = link do grupo)

## Passo a passo pra aprovar um modelo (Bruno)

1. No QS, aba **Modelos** → **+ Novo modelo**. Cole o texto, preencha os
   exemplos das variáveis e salve. A tela já confere as regras da Meta: nome em
   minúsculas com `_`, variáveis em sequência `{{1}}, {{2}}…` e o texto não
   começa nem termina com variável.
2. Abra o **WhatsApp Manager** (business.facebook.com › WhatsApp Manager ›
   Gerenciar modelos) da conta de **cada número que vai disparar**. Cada SDR com
   Coexistência tem a conta dele: o modelo precisa existir e estar aprovado
   **em cada uma**. O número do Rel tem o botão "Copiar modelos do Comercial"
   (Rel › Configurações › WhatsApp), que leva os modelos que já existem no oficial.
3. **Criar modelo** → categoria **Marketing** → idioma **Português (BR)** → mesmo
   nome → título, texto, rodapé e o botão de resposta rápida "Parar de
   receber". Use os mesmos exemplos das variáveis. O pacote JSON que a tela
   mostra é exatamente o que a API recebe, se preferir criar por API.
4. Envie. Na tela do QS, mude a situação pra **"na análise da Meta"**.
5. Quando a Meta aprovar (de minutos a 24 h), mude pra **"aprovado"**. Só aí ele
   aparece pra campanha. Recusado? Leia o motivo na Meta, ajuste e reenvie com
   outro nome.

## Ligar o envio de verdade (quando o Bruno decidir)

Hoje o envio está **duplamente travado**:

1. `qs_settings.disparo_simulacao = true` (o padrão da 0217);
2. `ENVIO_REAL_PLUGADO = false` em `api/_disparo.js`. A função
   `enviarTemplate()` só registra. O TODO no código diz onde plugar a chamada
   real (`enviarTemplate` de `_meta.js`, conferindo antes que o modelo está
   aprovado **no número que envia**).

Pra ligar: (a) aplicar o TODO e fazer o deploy; (b) rodar uma campanha pequena
(5 a 10 leads) e conferir no painel; (c) só então:

```sql
update qs_settings set value = 'false'::jsonb where key = 'disparo_simulacao';
```

Pra desligar na hora: o mesmo `update` com `'true'`. A fila para na próxima
rodada.

## Permissão

Admin, gestor do setor (gestor sem setor marcado conta como Comercial) ou
cargo com `comercial.disparos` / `relacionamento.disparos` (0135). A RLS só
deixa **ler**. Escrever é só pela rota, com o service_role.

## O que ficou de fora

- A tela antiga de Disparos do Rel (`rel_campanhas`, 0 usos) saiu do menu. As
  **Automações** (aniversário, antes do embarque…) continuam em
  `api/rel-disparos.js`.
- Modelo com imagem ou vídeo no topo: ainda não, só texto.
- Respostas do Rel: o painel conta, mas não cria atividade (o Rel atende pela
  caixa de Atendimento).
