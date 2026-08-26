-- 0063_gloria_primeiro_contato.sql
-- ---------------------------------------------------------------------------
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New
--    query → cole este arquivo INTEIRO → Run. Pode rodar mais de uma vez.
--
-- Depende da 0053, 0060 e 0061.
--
-- O QUE FALTAVA PRA LIGAR TRÁFEGO NELA
--
-- Duas coisas, e as duas são a mesma: a Glória só sabia RESPONDER.
--
--   1. Ela nunca falava primeiro. Isso basta pra quem chega pelo WhatsApp ("vi
--      o anúncio, quero saber da Antártida") e é inútil pra quem chega pelo
--      FORMULÁRIO — que é quase todo mundo em tráfego pago. Essa pessoa
--      preencheu o form e foi embora: não existe mensagem pra responder.
--   2. Entrar no pipeline dela era trabalho de gente, um lead por vez, na tela.
--      Serve pra testar com cinco. Não serve pra 120 por dia.
--
-- ── A REGRA DA META, QUE É QUEM MANDA AQUI ────────────────────────────────
--
-- Texto livre só é entregue pra quem falou com a gente nas últimas 24 horas.
-- Fora dessa janela, SÓ TEMPLATE APROVADO. Não tem contorno: mensagem livre
-- fora da janela simplesmente não chega.
--
-- Por isso o primeiro contato tem duas portas (api/_abordagem.js):
--
--   janela ABERTA  → a última mensagem dele volta pro fluxo normal, como se
--                    tivesse acabado de chegar. Ela responde do jeito de sempre.
--   janela FECHADA → template aprovado, escolhido em Atendimento IA →
--                    Primeiro contato.
--
-- Depois do primeiro passo, tudo é igual: a resposta do cliente abre a janela e
-- cai no `wa-webhook`, que já chama a Glória há semanas.
--
-- ── O QUE ESTE ARQUIVO FAZ ────────────────────────────────────────────────
--
--   (1) Cria as duas chaves de configuração, DESLIGADAS: sem template escolhido
--       ela não puxa assunto com ninguém. Ligar é decisão de tela, não de SQL.
--   (2) Cria o apelido de webhook `ia`, que é a porta de entrada automática.
--   (3) Um índice pro contador do teto não varrer o log inteiro.
-- ---------------------------------------------------------------------------

-- ── (1) As duas chaves ─────────────────────────────────────────────────────

-- QUAL TEMPLATE. Objeto VAZIO de propósito, e não null: qs_settings.value é
-- NOT NULL no banco, então "ainda não escolhi" se escreve {}.
--
-- Enquanto estiver assim, ela se comporta EXATAMENTE como se comportava até
-- 26/08: só responde quem escrever primeiro. Nenhum lead recebe mensagem por
-- causa desta migration.
--
-- Formato, quando preenchido pela tela:
--   { "nome": "boas_vindas_expedicao", "idioma": "pt_BR",
--     "params": { "1": "{{primeiro_nome}}", "2": "{{expedicao}}" } }
--
-- As chaves de `params` são as variáveis DO TEMPLATE (a Meta numera {{1}},
-- {{2}}); os valores são apelidos que `montarParams` traduz por lead.
insert into qs_settings(key, value)
values ('gloria_template_abertura', '{}'::jsonb)
on conflict (key) do nothing;

-- QUANTOS POR DIA. Este número é o freio, e ele existe por duas razões que só
-- aparecem depois que a campanha está no ar:
--
--   CUSTO   — cada conversa iniciada por template é cobrada pela Meta, e cada
--             resposta gasta modelo. Campanha que escala às 3 da manhã não
--             pede licença.
--   ESTRAGO — se ela estiver falando besteira, o teto é a diferença entre 30
--             conversas ruins e 400.
--
-- 30 é um começo deliberadamente pequeno: dá pra ler as 30 no dia seguinte.
-- Bater o teto NÃO PERDE O LEAD — ele fica no quadro esperando, e a abordagem
-- sai no dia seguinte ou na mão, pelo botão "falar" do card.
--
-- Em 0, ninguém é abordado. É o freio de mão: para de puxar assunto sem
-- desligar a IA das conversas que já estão de pé.
insert into qs_settings(key, value)
values ('gloria_teto_dia', '30'::jsonb)
on conflict (key) do nothing;

-- ── (2) A porta de entrada automática ──────────────────────────────────────
--
-- O `lead-inbound` já roteava por apelido (`?lista=resgate`). Aqui o apelido
-- `ia` passa a apontar pra cadência da Glória, e `api/_gloriaEntrada.js` faz o
-- resto: quem cai nessa cadência entra no pipeline dela e é abordado.
--
-- A automação da landing page passa a postar em:
--
--   POST /api/lead-inbound?lista=ia
--
-- A lista antiga continua existindo ao lado — e é exatamente assim que se
-- testa: manda UMA campanha pra `ia` e o resto pro time, e compara. Trocar
-- tudo de uma vez transforma "a IA converte melhor?" numa pergunta sem
-- resposta.
--
-- Lead que JÁ EXISTE não é puxado pra IA (ver `_gloriaEntrada.js`): ele pode
-- estar no meio de uma negociação com um humano, e o dedupe não sabe disso.
update qs_settings
   set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
         'ia', (select id::text from qs_cadences
                 where execution_mode = 'ia' and status <> 'congelada'
                 order by created_at asc limit 1)
       ),
       updated_at = now()
 where key = 'webhook_listas'
   -- Só se a cadência existir (senão gravaria "ia": null e o webhook devolveria
   -- 400 pra sempre, com um erro que não explica nada).
   and exists (select 1 from qs_cadences where execution_mode = 'ia' and status <> 'congelada');

-- Se a chave nem existir ainda, cria com o apelido `ia` dentro.
insert into qs_settings(key, value)
select 'webhook_listas',
       jsonb_build_object('ia', (select id::text from qs_cadences
                                  where execution_mode = 'ia' and status <> 'congelada'
                                  order by created_at asc limit 1))
where not exists (select 1 from qs_settings where key = 'webhook_listas')
  and exists (select 1 from qs_cadences where execution_mode = 'ia' and status <> 'congelada');

-- ── (3) O contador do teto ─────────────────────────────────────────────────
--
-- `abordagensDeHoje()` conta as linhas de hoje com motivo 'primeiro_contato'.
-- O log já passa de 200 linhas e cresce a cada mensagem dela; sem índice, essa
-- contagem vira uma varredura completa a cada lead que entra — e ela roda no
-- caminho de criação do lead, que é onde menos se pode gastar tempo.
--
-- Índice PARCIAL de propósito: só interessa a saída dela, que é uma fração
-- pequena do log. Assim ele fica minúsculo e cabe em memória.
create index if not exists idx_qs_gloria_log_abordagem
  on qs_gloria_log (criado_em desc)
  where direcao = 'out' and motivo = 'primeiro_contato';

-- ── Conferência depois de colar ────────────────────────────────────────────
--   select key, value from qs_settings
--    where key in ('gloria_template_abertura','gloria_teto_dia','webhook_listas');
--
-- O esperado logo depois de rodar:
--   gloria_template_abertura  →  {}            (ela ainda não puxa assunto)
--   gloria_teto_dia           →  30
--   webhook_listas            →  { ..., "ia": "0fd6a8de-..." }
--
-- E o teste da porta nova, sem criar lead nenhum:
--   curl -s -H "x-lead-secret: $LEAD_INBOUND_SECRET" \
--        "https://<o-qs>/api/lead-inbound" | jq .listas
--   → precisa aparecer "ia" na lista.
-- ---------------------------------------------------------------------------
