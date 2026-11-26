-- 0427_exp_espelho_desligar.sql
-- -----------------------------------------------------------------------------
-- ESPELHO DO SISTEMA ANTIGO DESLIGADO + FILA DE TESTE (migration de DADOS, 26/11/2026).
-- Autorizado pelo dono (Bruno) em 26/11.
--
-- Contexto: com ops_config 'exp_espelho'.ligado = true, o gatilho
-- aa_exp_venda_pax_segurar (BEFORE INSERT/UPDATE em passageiros) DESVIA o que o
-- venda_subir grava pra fila exp_venda_pax_pendentes e devolve NULL/OLD — o
-- passageiro não nasce na hora. Por isso, no venda_subir:
--   · v_pax fica nulo → o bloco do par de quarto (quarto_par_id /
--     acompanhante_dividir_com) pula a pessoa;
--   · o json qs_venda_itens.passageiros não é montado (o "if exists passageiros
--     ... venda_item_id" não acha ninguém).
-- Conferido 26/11 na definição vigente do _exp_venda_pax_segurar: com
-- ligado = false ele faz "return new" logo de cara → o insert/update vai direto
-- e o par de quarto + o json do item são gravados normalmente. Ou seja, o
-- problema (c) era SÓ da fila: nenhuma função precisa mudar.
--
-- O que esta migration faz:
--   a) desliga o espelho: ops_config 'exp_espelho' valor.ligado = false
--      (o resto do json — rodada_em, sincronizado_em… — fica). O cron
--      (api/_expEspelho.js) lê essa flag e para de copiar na próxima rodada.
--   b) as 2 linhas de TESTE na fila (venda 4eb996dc-…, "TESTE CLAUDE - NAO LIGAR"
--      e "teste 1", de 12/11) são marcadas descartadas — aplicado_em = now(),
--      erro = 'descartado: teste' — em vez de apagadas. exp_venda_pax_aplicar só
--      pega aplicado_em is null, então elas nunca viram passageiro.
--      Eram as ÚNICAS linhas da fila em 26/11 (nada real fica pendurado).
--
-- ATENÇÃO (fora do banco): a Vercel ainda tem EXP_ESPELHO_LIGADO=1. Com a flag
-- do banco desligada o cron já não copia nada, mas api/expedicoes.js e
-- api/_expAcesso.js continuam respondendo 423 ("modo validação") pra algumas
-- gravações enquanto essa env for 1. Desligar a env junto.
--
-- Idempotente (where só pega o que ainda está ligado / pendente).
-- Volta:
--   update ops_config set valor = valor || '{"ligado": true}'::jsonb, atualizado_em = now() where chave = 'exp_espelho';
--   update exp_venda_pax_pendentes set aplicado_em = null, erro = null
--    where id in ('25e94779-8988-4032-9254-7a890a7306d3', '2bd10282-def5-41d3-bbb0-3a5feccec0a9');
-- -----------------------------------------------------------------------------

-- a) espelho desligado
update ops_config
   set valor = coalesce(valor, '{}'::jsonb) || '{"ligado": false}'::jsonb, atualizado_em = now()
 where chave = 'exp_espelho'
   and coalesce((valor ->> 'ligado')::boolean, false);

-- b) fila de teste descartada (marca, não apaga)
update exp_venda_pax_pendentes
   set aplicado_em = now(), erro = 'descartado: teste'
 where aplicado_em is null
   and venda_id = '4eb996dc-7435-4cc8-8335-d8ab442f03e4'
   and id in ('25e94779-8988-4032-9254-7a890a7306d3', '2bd10282-def5-41d3-bbb0-3a5feccec0a9')
   and linha ->> 'nome_completo' in ('TESTE CLAUDE - NAO LIGAR', 'teste 1');
