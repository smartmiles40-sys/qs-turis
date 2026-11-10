-- supabase/migrations/0353_sla_conta_ligacao_e_whatsapp.sql
-- -----------------------------------------------------------------------------
-- SLA DO 1º CONTATO CONTA LIGAÇÃO E WHATSAPP (Bruno, 10/11/2026)
--   "queria que quando eles ligassem ou mandassem mensagem, já constasse como
--    o SLA concluído"
--
-- Antes (0322): o relógio parava só na 1ª TAREFA CONCLUÍDA da fila. Em 14 dias,
-- 302 de 421 leads tiveram ligação/WhatsApp ANTES de o SDR concluir a tarefa
-- (mediana 214 min → 140 min contando o 1º toque).
--
-- Agora o relógio para no que vier PRIMEIRO, sempre depois da chegada do lead:
--   • tarefa concluída (como era);
--   • ligação feita pelo webfone (qs_call_logs — atendida ou não: tentou, contou);
--   • WhatsApp ENVIADO pela linha de um SDR (qs_wa_messages direction='out' com
--     linha_user_id). Fora: mensagem automática (sem linha), apagada ou que falhou.
--
-- Só muda o `min_1o` (SLA). "Trabalhou" e o resto do funil continuam iguais.
-- Feita por troca de texto na função VIGENTE (não pela cópia da 0322), com
-- trava: se algum trecho não estiver lá, nada muda e a migration falha.
--
-- Volta: rodar de novo o create da 0322 (ou trocar o texto de volta).
-- -----------------------------------------------------------------------------

do $mig$
declare
  v_def  text := pg_get_functiondef('public.qs_desempenho(date,date)'::regprocedure);
  v_min_velho text := $t$case when t.primeira is not null
                then greatest(0, qs_horas_uteis(c.chegou_em, t.primeira, v_hor)) * 60 end as min_1o$t$;
  v_min_novo  text := $t$case when least(t.primeira, tq.toque) is not null
                then greatest(0, qs_horas_uteis(c.chegou_em, least(t.primeira, tq.toque), v_hor)) * 60 end as min_1o$t$;
  v_join_velho text := $t$from c left join t using (lead_id) left join mm using (lead_id)$t$;
  v_join_novo  text := $t$from c left join t using (lead_id) left join mm using (lead_id)
      -- 0353: 1º toque do SDR (ligação ou WhatsApp enviado) depois da chegada.
      left join lateral (
        select least(
          (select min(l.created_at) from qs_call_logs l
            where l.lead_id = c.lead_id and l.created_at >= c.chegou_em),
          (select min(coalesce(m.sent_at, m.created_at)) from qs_wa_messages m
            where m.lead_id = c.lead_id and m.direction = 'out'
              and m.linha_user_id is not null and m.deleted_at is null
              and coalesce(m.status, '') <> 'failed'
              and coalesce(m.sent_at, m.created_at) >= c.chegou_em)
        ) as toque
      ) tq on true$t$;
begin
  if position('0353: 1º toque' in v_def) > 0 then
    raise notice '0353 já aplicada — nada a fazer';
    return;
  end if;
  if position(v_min_velho in v_def) = 0 or position(v_join_velho in v_def) = 0 then
    raise exception '0353: a qs_desempenho vigente não tem o trecho esperado — conferir antes';
  end if;
  v_def := replace(v_def, v_min_velho, v_min_novo);
  v_def := replace(v_def, v_join_velho, v_join_novo);
  execute v_def;
end
$mig$;

comment on function public.qs_desempenho(date, date) is
  'Spec 06/11 (views 1–14): desempenho SDR + produto + cotações numa chamada. Páginas 1 e 2 do Desempenho leem daqui. 0353: SLA do 1º contato = 1ª tarefa concluída, ligação ou WhatsApp enviado pelo SDR (o que vier primeiro).';

-- Índices: já existem idx_qs_call_logs_lead_created (lead_id, created_at) e
-- idx_qs_wa_messages_lead (lead_id, sent_at desc) — não precisa criar.
