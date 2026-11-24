-- 0416 (24/11/2026) — AFASTAR NA MESA: NA AUSÊNCIA, SÓ OS LEADS NÃO ATENDIDOS
-- Pedido do Bruno: "afastar a pessoa por um tempo e não cair mais leads pra
-- ela; quem caiu pra ela e ela não atendeu, já dividir igualmente pros SDRs
-- que estão trabalhando no dia". Decisões (24/11): tempo em DIAS (como já era),
-- só os NÃO ATENDIDOS, recebe quem é SDR ativo e não afastado.
--
-- Não atendido = nenhum toque desde a última chegada do lead: tarefa concluída,
-- ligação (qs_call_logs) ou WhatsApp enviado pela linha do SDR — a mesma regra
-- do 1º toque do SLA (0400/0405).
--
-- Muda só a AUSÊNCIA com "passar os leads": antes passava todo lead aberto e
-- todas as atividades; agora passa só os não atendidos (com as atividades
-- DELES). O que ela já está trabalhando fica esperando ela voltar.
-- DESATIVAR continua passando tudo, igual antes.
-- A prévia ganha `leads_nao_atendidos`.
-- Volta: reaplicar as funções da 0215 e `drop function qs_lead_sem_atendimento(uuid)`.
-- -----------------------------------------------------------------------------

create or replace function public.qs_lead_sem_atendimento(p_lead uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  with desde as (
    select coalesce(
      (select max(e.chegou_em) from qs_lead_entradas e where e.lead_id = p_lead and not coalesce(e.reconstruido, false)),
      (select l.created_at from qs_leads l where l.id = p_lead)
    ) as t
  )
  select not exists (select 1 from qs_tasks k, desde d
                      where k.lead_id = p_lead and k.status = 'concluida' and k.completed_at >= d.t)
     and not exists (select 1 from qs_call_logs c, desde d
                      where c.lead_id = p_lead and c.created_at >= d.t)
     and not exists (select 1 from qs_wa_messages m, desde d
                      where m.lead_id = p_lead and m.direction = 'out'
                        and m.linha_user_id is not null and m.deleted_at is null
                        and coalesce(m.status, '') <> 'failed'
                        and coalesce(m.sent_at, m.created_at) >= d.t);
$$;
revoke all on function public.qs_lead_sem_atendimento(uuid) from public, anon;
grant execute on function public.qs_lead_sem_atendimento(uuid) to authenticated;

create or replace function public.qs_comercial_afastar(p_user uuid, p_modo text, p_ausente_ate date DEFAULT NULL::date, p_motivo text DEFAULT NULL::text, p_destino uuid DEFAULT NULL::uuid, p_mover boolean DEFAULT false, p_reunioes jsonb DEFAULT '[]'::jsonb, p_negocios_para uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ator      uuid := auth.uid();
  v_u         qs_users;
  v_hoje      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_pool      uuid[];
  v_n         int;
  v_leads     int := 0;
  v_tarefas   int := 0;
  v_reservas  int := 0;
  v_reun      int := 0;
  v_neg       int := 0;
  v_faltam    int;
  r           record;
  v_nome      text;
  v_resumo    jsonb;
  v_mover     boolean;
  v_so_nao_atendidos boolean := p_modo = 'ausencia';
begin
  if not qs_is_manager() then
    raise exception 'Só admin ou gestor do Comercial pode fazer isso.' using errcode = '42501';
  end if;
  if p_modo not in ('desativar','ausencia','reativar') then
    raise exception 'Modo inválido: %', p_modo;
  end if;
  select * into v_u from qs_users where id = p_user for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if p_user = v_ator and p_modo <> 'reativar' then
    raise exception 'Você não pode desativar nem afastar a própria conta.';
  end if;

  perform pg_advisory_xact_lock(hashtext('qs_assign_equilibrio'));

  if p_modo = 'reativar' then
    update qs_users set is_active = true, ausente_ate = null, ausente_motivo = null where id = p_user;
    v_resumo := jsonb_build_object('antes', jsonb_build_object('ativo', v_u.is_active, 'ausente_ate', v_u.ausente_ate));
    insert into qs_comercial_afastamentos (user_id, feito_por, modo, resumo) values (p_user, v_ator, 'reativar', v_resumo);
    return v_resumo;
  end if;

  if p_modo = 'ausencia' then
    if p_ausente_ate is null or p_ausente_ate < v_hoje then
      raise exception 'Informe até quando a pessoa fica ausente (hoje ou depois).';
    end if;
    update qs_users set ausente_ate = p_ausente_ate, ausente_motivo = nullif(trim(p_motivo), '') where id = p_user;
  else
    update qs_users set is_active = false, ausente_motivo = coalesce(nullif(trim(p_motivo), ''), ausente_motivo) where id = p_user;
  end if;

  v_mover := p_modo = 'desativar' or coalesce(p_mover, false);

  if v_mover then
    -- Os leads que vão sair: na ausência, só os não atendidos (0416).
    create temp table _alvo on commit drop as
      select l.id, row_number() over (order by l.created_at, l.id) as rn
        from qs_leads l
       where l.owner_id = p_user and l.status in ('nao_iniciado','em_prospeccao')
         and (not v_so_nao_atendidos or qs_lead_sem_atendimento(l.id));

    if p_destino is not null then
      if p_destino = p_user or not exists (select 1 from qs_users where id = p_destino and is_active) then
        raise exception 'O destino escolhido não está ativo.';
      end if;
      v_pool := array[p_destino];
    else
      select array_agg(u.id order by c.n, u.created_at, u.id) into v_pool
        from qs_users u
        cross join lateral (select count(*) as n from qs_leads l where l.owner_id = u.id and l.status in ('nao_iniciado','em_prospeccao')) c
       where u.role = 'sdr' and u.is_active and u.id <> p_user and not qs_sdr_ausente(u.id);
    end if;
    v_n := coalesce(cardinality(v_pool), 0);

    if v_n = 0 and (exists (select 1 from _alvo)
                    or (not v_so_nao_atendidos and exists (select 1 from qs_tasks where owner_id = p_user and status in ('pendente','atrasada')))) then
      raise exception 'Não há SDR ativo (e sem ausência) pra receber os leads. Escolha uma pessoa específica.';
    end if;

    if v_n > 0 then
      update qs_leads l set owner_id = v_pool[((a.rn - 1) % v_n) + 1]
        from _alvo a where l.id = a.id;
      get diagnostics v_leads = row_count;

      -- As atividades abertas dos leads que mudaram de dono vão junto.
      update qs_tasks t set owner_id = l.owner_id
        from qs_leads l, qs_users nu
       where t.owner_id = p_user and t.status in ('pendente','atrasada')
         and l.id = t.lead_id and l.owner_id <> p_user
         and nu.id = l.owner_id and nu.is_active;
      get diagnostics v_tarefas = row_count;

      if not v_so_nao_atendidos then
        with resto as (
          select t.id, row_number() over (order by t.scheduled_at, t.id) as rn
            from qs_tasks t where t.owner_id = p_user and t.status in ('pendente','atrasada')
        )
        update qs_tasks t set owner_id = v_pool[((r2.rn - 1) % v_n) + 1]
          from resto r2 where t.id = r2.id;
        get diagnostics v_faltam = row_count;
        v_tarefas := v_tarefas + v_faltam;
      end if;

      if p_modo = 'desativar' then
        update sdr_reservas s set sdr_id = coalesce(
                 (select l.owner_id from qs_leads l join qs_users nu on nu.id = l.owner_id and nu.is_active
                   where l.id = s.lead_id and l.owner_id <> p_user),
                 v_pool[1])
         where s.sdr_id = p_user and s.created_at > now() - interval '30 days';
        get diagnostics v_reservas = row_count;
      end if;
    end if;
  end if;

  for r in
    select (e->>'id')::uuid as mid, nullif(e->>'closer_id', '')::uuid as cid
      from jsonb_array_elements(coalesce(p_reunioes, '[]'::jsonb)) e
  loop
    if r.cid is null then continue; end if;
    select name into v_nome from qs_users where id = r.cid and is_active and role in ('closer','admin','gestor');
    if v_nome is null then raise exception 'O closer escolhido para uma das reuniões não está ativo.'; end if;
    if r.cid = p_user then raise exception 'Escolha outro closer (não a pessoa que está saindo).'; end if;
    if exists (
      select 1 from qs_meetings a, qs_meetings b
       where a.id = r.mid and b.closer_id = r.cid and b.id <> a.id
         and b.status in ('agendada','confirmada','realizada') and b.ends_at is not null and a.ends_at is not null
         and tstzrange(a.scheduled_at, a.ends_at, '[)') && tstzrange(b.scheduled_at, b.ends_at, '[)')
    ) then
      raise exception '% já tem reunião no horário de %.', v_nome,
        (select to_char(scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') from qs_meetings where id = r.mid);
    end if;
    update qs_meetings set closer_id = r.cid, meeting_owner = v_nome
     where id = r.mid and closer_id = p_user and status in ('agendada','confirmada');
    if found then v_reun := v_reun + 1; end if;
  end loop;

  if p_modo = 'desativar' then
    select count(*) into v_faltam from qs_meetings
     where closer_id = p_user and status in ('agendada','confirmada') and scheduled_at >= now();
    if v_faltam > 0 then
      raise exception 'Ainda há % reunião(ões) futura(s) sem novo closer. Escolha um closer para cada uma.', v_faltam;
    end if;
  end if;

  if p_negocios_para is not null then
    if p_negocios_para = p_user or not exists (select 1 from qs_users where id = p_negocios_para and is_active) then
      raise exception 'Quem herda os cartões do pipeline não está ativo.';
    end if;
    update qs_closer_negocios set closer_id = p_negocios_para
     where closer_id = p_user and arquivado_em is null and not closer_etapa_final(etapa);
    get diagnostics v_neg = row_count;
  end if;

  v_resumo := jsonb_build_object(
    'leads', v_leads, 'tarefas', v_tarefas, 'reservas', v_reservas, 'reunioes', v_reun, 'negocios', v_neg,
    'so_nao_atendidos', v_mover and v_so_nao_atendidos,
    'destino', case when not v_mover then null when p_destino is null then 'rodizio' else p_destino::text end,
    'rodizio', case when v_mover and p_destino is null then to_jsonb(v_pool) end,
    'antes', jsonb_build_object('ativo', v_u.is_active, 'ausente_ate', v_u.ausente_ate, 'ausente_motivo', v_u.ausente_motivo)
  );
  insert into qs_comercial_afastamentos (user_id, feito_por, modo, ausente_ate, motivo, resumo)
  values (p_user, v_ator, p_modo, case when p_modo = 'ausencia' then p_ausente_ate end, nullif(trim(p_motivo), ''), v_resumo);
  return v_resumo;
end;
$function$;

create or replace function public.qs_comercial_afastar_previa(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_u qs_users;
begin
  if not qs_is_manager() then
    raise exception 'Só admin ou gestor do Comercial.' using errcode = '42501';
  end if;
  select * into v_u from qs_users where id = p_user;
  if not found then raise exception 'Pessoa não encontrada.'; end if;

  return jsonb_build_object(
    'pessoa', jsonb_build_object('id', v_u.id, 'nome', v_u.name, 'papel', v_u.role, 'ativo', v_u.is_active,
                                 'ausente_ate', v_u.ausente_ate, 'ausente_motivo', v_u.ausente_motivo),
    'leads_abertos',   (select count(*) from qs_leads where owner_id = p_user and status in ('nao_iniciado','em_prospeccao')),
    'leads_nao_atendidos', (select count(*) from qs_leads where owner_id = p_user and status in ('nao_iniciado','em_prospeccao') and qs_lead_sem_atendimento(id)),
    'tarefas_abertas', (select count(*) from qs_tasks where owner_id = p_user and status in ('pendente','atrasada')),
    'reservas_30d',    (select count(*) from sdr_reservas where sdr_id = p_user and created_at > now() - interval '30 days'),
    'negocios_abertos',(select count(*) from qs_closer_negocios where closer_id = p_user and arquivado_em is null and not closer_etapa_final(etapa)),
    'reunioes_futuras', (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'em', m.scheduled_at, 'ate', m.ends_at,
                                                   'lead_nome', coalesce(m.lead_name, l.full_name), 'titulo', m.title)
                                order by m.scheduled_at), '[]'::jsonb)
        from qs_meetings m left join qs_leads l on l.id = m.lead_id
       where m.closer_id = p_user and m.status in ('agendada','confirmada') and m.scheduled_at >= now()),
    'rodizio', (
      select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.name, 'leads_abertos', c.n) order by c.n, u.created_at), '[]'::jsonb)
        from qs_users u
        cross join lateral (select count(*) as n from qs_leads l where l.owner_id = u.id and l.status in ('nao_iniciado','em_prospeccao')) c
       where u.role = 'sdr' and u.is_active and u.id <> p_user and not qs_sdr_ausente(u.id)),
    'closers', (
      select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.name) order by u.name), '[]'::jsonb)
        from qs_users u where u.role = 'closer' and u.is_active and u.id <> p_user),
    'pessoas', (
      select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.name, 'papel', u.role) order by u.name), '[]'::jsonb)
        from qs_users u where u.is_active and u.id <> p_user and u.role in ('sdr','closer','gestor','admin'))
  );
end;
$function$;
