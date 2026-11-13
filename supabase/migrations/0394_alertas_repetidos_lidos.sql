-- supabase/migrations/0394_alertas_repetidos_lidos.sql
-- -----------------------------------------------------------------------------
-- PONTE PEDIDOS (5/5): O SINO PARA DE EMPILHAR O MESMO ALARME (13/11/2026).
--
-- POR QUÊ
--   Auditoria de 13/11: 180 avisos de alarme da gestão (origem qs_alertas,
--   api/qs-alertas.js) e 0 lidos. Investigado:
--     • a tela MARCA leitura (clicar no aviso ou "Marcar todos" chama
--       qs_avisos_marcar_lidos) — não é bug de leitura;
--     • o cron repete o alarme a cada 6 h (aviso baixo: 24 h) com uma chave
--       nova, e o aviso anterior, idêntico, continuava não lido: 18 alarmes
--       viraram 180 linhas (10 pessoas × repetições) e o sino virou ruído;
--     • iam pra TODO admin e TODO gestor, inclusive os gestores do Financeiro,
--       Operações e Relacionamento, que nem abrem o Comercial.
--   O api/qs-alertas.js agora (a) manda só pro admin + gestor do setor do alarme
--   e (b) antes de repetir, dá como lido o aviso anterior do mesmo alarme. Esta
--   migration limpa o que já está empilhado, pela mesma regra (b).
--
-- O QUE FAZ
--   Para cada pessoa e cada alarme (origem_id), mantém não lido SÓ o aviso mais
--   recente; os anteriores ganham lido_em = now(). Não apaga nada.
--
-- COMO CONFERIR
--   select origem_id, count(*) filter (where lido_em is null) nao_lidos, count(*)
--     from qs_avisos where origem = 'qs_alertas' group by 1 order by 2 desc;
--   -- no máximo 1 não lido por pessoa e alarme.
--
-- COMO VOLTAR
--   Não há como distinguir depois quem leu de verdade; se precisar, antes de
--   aplicar guarde: create table _bkp_0394 as select id from qs_avisos
--   where origem = 'qs_alertas' and lido_em is null;  e depois
--   update qs_avisos set lido_em = null where id in (select id from _bkp_0394);
-- Idempotente.
-- -----------------------------------------------------------------------------

update public.qs_avisos a
   set lido_em = now()
 where a.origem = 'qs_alertas'
   and a.lido_em is null
   and exists (
     select 1 from public.qs_avisos b
      where b.user_id = a.user_id
        and b.origem = 'qs_alertas'
        and b.origem_id is not distinct from a.origem_id
        and b.lido_em is null
        and (b.criado_em, b.id) > (a.criado_em, a.id)
   );
