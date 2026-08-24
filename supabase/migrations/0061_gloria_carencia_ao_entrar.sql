-- 0061_gloria_carencia_ao_entrar.sql
-- ---------------------------------------------------------------------------
-- O LEAD QUE ENTRA NO PIPELINE DA IA ERA EXPULSO ANTES DE CONSEGUIR FALAR.
--
-- Medido em 24/08, no lead de teste do Bruno:
--
--   16:22:15  entrou no pipeline de atendimento por IA
--   16:23:28  sem_resposta - "72h de silencio"        <- devolvido ao time
--   16:24:39  entrou no pipeline de novo
--
-- Setenta e tres segundos. A causa e que `qs_gloria_fila_bruta` mede o silencio
-- a partir da ULTIMA MENSAGEM DO LEAD, e a fila roda de 5 em 5 minutos (mais em
-- cada webhook). Quem entra no pipeline calado ha mais de 24h - ou seja,
-- qualquer lead antigo, que e exatamente com quem se testa - bate na regra
-- `p.silencio >= 24 * 60` e sai como 'devolver' na primeira batida.
--
-- Duas correcoes, e as duas sao sobre a mesma ideia: COLOCAR ALGUEM NO PIPELINE
-- E UMA DECLARACAO DE INTENCAO. A pessoa acabou de ser posta ali porque se
-- espera que ela escreva. Julgar o silencio dela no minuto seguinte e julgar um
-- silencio anterior a propria decisao.
--
--   1. Carencia de 30 minutos ao entrar. Ninguem e avaliado pela fila enquanto
--      `entrou_em` for recente. Passados os 30 min o comportamento volta a ser
--      exatamente o de antes - lead real calado ha 3 dias continua sendo
--      devolvido ao time, que e o certo: fora da janela de 24h da Meta so passa
--      template aprovado, e a Gloria nao tem nenhum.
--
--   2. `entrou_em` passa a ser a entrada DESTA passagem, nao a primeira de
--      todas. Antes era `coalesce(entrou_em, now())`, que preservava a data
--      original - entao quem ja tinha entrado uma vez nunca mais teria
--      carencia. Quem sai e volta comeca uma estadia nova.
--
-- Bonus da mesma familia: `entrar_no_pipeline` nao limpava `etapa`. Um lead
-- devolvido voltava ao pipeline ainda marcado 'transferida' - ficava na coluna
-- "Devolvida ao time" do quadro e sumia da fila de toques (que filtra
-- `etapa <> 'transferida'`). A etapa volta a ser derivada do que ele ja
-- respondeu, e nao do que aconteceu na estadia anterior.
-- ---------------------------------------------------------------------------

-- 1. Entrar no pipeline: estadia nova, etapa coerente ------------------------
create or replace function public.qs_gloria_entrar_no_pipeline(p_lead uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead    qs_leads%rowtype;
  v_cad     uuid;
  v_fechou  int := 0;
begin
  if auth.uid() is not null and not qs_owns_lead(p_lead) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into v_lead from qs_leads where id = p_lead;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'lead_inexistente'); end if;
  if v_lead.status = 'ganho' then return jsonb_build_object('ok', false, 'motivo', 'lead_ganho'); end if;

  if exists (select 1 from qs_meetings
              where lead_id = p_lead and status in ('agendada')
                and scheduled_at >= now()) then
    return jsonb_build_object('ok', false, 'motivo', 'tem_reuniao_marcada');
  end if;

  select id into v_cad from qs_cadences where execution_mode = 'ia' and status <> 'congelada'
   order by created_at asc limit 1;
  if v_cad is null then return jsonb_build_object('ok', false, 'motivo', 'sem_cadencia_de_ia'); end if;

  update qs_tasks
     set status = 'ignorada',
         skip_reason = 'Lead entrou no atendimento por IA'
   where lead_id = p_lead and status in ('pendente', 'atrasada');
  get diagnostics v_fechou = row_count;

  update qs_leads
     set cadence_id = v_cad,
         cadence_started_at = now(),
         status = case when status = 'nao_iniciado' then 'em_prospeccao' else status end
   where id = p_lead;

  insert into qs_gloria_sessoes(lead_id) values (p_lead) on conflict (lead_id) do nothing;
  update qs_gloria_sessoes
     set ativa = true, motivo = null, pausada_em = null,
         toques = 0, ultimo_toque_em = null,
         -- A estadia e NOVA: e daqui que a carencia da fila conta.
         entrou_em = now(),
         -- Volta a ser o que o lead ja respondeu. Manter 'transferida' o
         -- deixava fora da fila de toques e na coluna errada do quadro.
         etapa = case
                   when etapa = 'transferida' then
                     case when coalesce(respondidas, 0) >= 5 then 'qualificada'
                          when coalesce(respondidas, 0) >  0 then 'qualificando'
                          else 'abertura' end
                   else etapa
                 end
   where lead_id = p_lead;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo, payload)
  values (p_lead, 'evento', 'entrou no pipeline de atendimento por IA', 'entrou_no_pipeline',
          jsonb_build_object('tarefas_encerradas', v_fechou));

  return jsonb_build_object('ok', true, 'lead_id', p_lead, 'cadencia_id', v_cad, 'tarefas_encerradas', v_fechou);
end;
$function$;

-- 2. A fila respeita a carencia de quem acabou de entrar ---------------------
create or replace function public.qs_gloria_fila_bruta()
returns table(lead_id uuid, nome text, telefone text, acao text, passo integer,
              tipo text, instrucao text, silencio_min integer, motivo text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with vivos as (
    select
      s.lead_id, s.toques, s.ultimo_toque_em, s.entrou_em,
      l.phone, l.first_name, l.full_name, l.cadence_id,
      (select max(m.sent_at) from qs_wa_messages m where m.lead_id = s.lead_id and m.direction = 'in')  as ult_in,
      (select max(m.sent_at) from qs_wa_messages m where m.lead_id = s.lead_id and m.direction = 'out') as ult_out
    from qs_gloria_sessoes s
    join qs_leads l    on l.id = s.lead_id
    join qs_cadences c on c.id = l.cadence_id and c.execution_mode = 'ia'
    where s.ativa
      and s.etapa <> 'transferida'
      and l.status not in ('ganho', 'perdido')
      -- CARENCIA: quem acabou de ser posto no pipeline tem 30 minutos antes de
      -- ser julgado pelo silencio. Sem isto, todo lead antigo - que e com quem
      -- se testa - era devolvido ao time na batida seguinte, em menos de 5 min.
      and (s.entrou_em is null or s.entrou_em < now() - interval '30 minutes')
  ),
  -- A bola precisa estar com o LEAD: a ultima fala e nossa e ele nao respondeu.
  parados as (
    select v.*, floor(extract(epoch from (now() - v.ult_in)) / 60)::int as silencio
      from vivos v
     where v.ult_in is not null
       and v.ult_out is not null
       and v.ult_out > v.ult_in
  )
  select
    p.lead_id,
    coalesce(nullif(trim(p.first_name), ''),
             nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'lead') as nome,
    regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') as telefone,
    case when devido.id is not null and p.silencio < 24 * 60 then 'tocar' else 'devolver' end as acao,
    devido.ordem     as passo,
    devido.tipo      as tipo,
    devido.instrucao as instrucao,
    p.silencio       as silencio_min,
    case
      when devido.id is not null and p.silencio < 24 * 60 then 'toque_' || devido.ordem::text
      when p.silencio >= 24 * 60                          then 'janela_de_24h_fechou'
      else 'cadencia_esgotada'
    end as motivo
  from parados p
  -- O passo mais adiantado que ja venceu e que ainda nao foi dado.
  left join lateral (
    select x.id, x.ordem, x.tipo, x.instrucao
      from qs_gloria_passos x
     where x.ativo
       and x.ordem > coalesce(p.toques, 0)
       and x.atraso_min <= p.silencio
       and (x.cadencia_id is null or x.cadencia_id = p.cadence_id)
     order by x.ordem desc
     limit 1
  ) devido on true
  -- Ainda resta algum passo pela frente? (mesmo que nao tenha vencido)
  left join lateral (
    select 1 as tem
      from qs_gloria_passos x
     where x.ativo
       and x.ordem > coalesce(p.toques, 0)
       and (x.cadencia_id is null or x.cadencia_id = p.cadence_id)
     limit 1
  ) resta on true
  where
    (
      devido.id is not null
      and p.silencio < 24 * 60
      and (p.ultimo_toque_em is null or p.ultimo_toque_em < now() - interval '30 minutes')
    )
    or p.silencio >= 24 * 60
    or (resta.tem is null and p.silencio >= 60)
  order by p.silencio desc;
$function$;

-- 3. Consertar quem ja foi expulso -------------------------------------------
-- Quem esta no pipeline agora e ficou marcado 'transferida' pela expulsao que
-- esta migration corrige volta pra etapa certa e ganha a carencia.
update qs_gloria_sessoes s
   set etapa = case when coalesce(s.respondidas, 0) >= 5 then 'qualificada'
                    when coalesce(s.respondidas, 0) >  0 then 'qualificando'
                    else 'abertura' end,
       entrou_em = now(),
       ativa = true,
       motivo = null,
       toques = 0,
       ultimo_toque_em = null
  where s.etapa = 'transferida'
    and exists (
      select 1 from qs_leads l
      join qs_cadences c on c.id = l.cadence_id and c.execution_mode = 'ia'
     where l.id = s.lead_id
    );
