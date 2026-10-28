-- 0215_controle_comercial.sql  (28/10/2026 — Controle do Comercial) — NÃO APLICADA.
-- -----------------------------------------------------------------------------
-- Pedido do Bruno: "na parte de configurações do Comercial (SDR e Closer) temos
-- que ter a parte de MESA, para vermos quem está online e o que estão fazendo,
-- e ter um controle maior" + botão de desativar/afastar a pessoa + gravação da
-- reunião no card do cliente.
--
-- O que entra aqui (tudo idempotente; rollback no fim, comentado):
--   1. qs_presenca ............ uma linha por pessoa: visto_em, tela, ação atual,
--                                lead aberto, ligação em curso. Só a RPC grava.
--   2. qs_presenca_bater() .... o "heartbeat" do front (60 s com a aba visível).
--   3. qs_mesa_comercial() .... tudo que a Mesa mostra, numa ida só (jsonb
--                                pequeno; a tela consulta a cada 30 s, SEM
--                                Realtime — lembrar do loop de egress de 19/10).
--   4. qs_comercial_afastamentos + qs_comercial_afastar_previa() +
--      qs_comercial_afastar() .. desativar / ausência / reativar, com destino
--                                dos leads, atividades, reservas, reuniões
--                                futuras e cartões do pipeline. Transacional.
--   5. qs_meetings.gravacao_url + qs_reuniao_gravacao() .. link da gravação.
--   6. dois índices parciais em qs_tasks pros números da Mesa.
--
-- Quem pode: Mesa e afastar = qs_is_manager() (admin, ou gestor com o setor
-- comercial). Heartbeat = qualquer usuário ativo, só a própria linha.
--
-- CONVIVÊNCIA COM O RODÍZIO (0099, trg_qs_assign_owner): o gatilho só age em
-- INSERT de lead sem dono e já tira quem está inativo (is_active) ou ausente
-- (qs_sdr_ausente). Aqui a gente só faz UPDATE de owner_id, que o gatilho não
-- vê, e a conta do equilíbrio (qs_lead_entradas de HOJE) não muda — lead
-- redistribuído não conta como "lead novo recebido", então o rodízio segue
-- justo. Para não cruzar com um lead chegando no mesmo instante, a RPC pega a
-- MESMA trava do rodízio (pg_advisory_xact_lock('qs_assign_equilibrio')).
--
-- Efeitos colaterais conhecidos (documentados, não são bug):
--   • tarefa que muda de dono libera a "ligação com SDR" marcada nela
--     (gatilho qs_ligacao_sdr_segue_tarefa): a tarefa continua no mesmo
--     horário com o novo dono, só o horário sai do mapa de ocupação;
--   • reunião que troca de closer NÃO muda o evento no Google Agenda nem o
--     card do Bitrix (nada externo nesta migration). O link do Meet continua
--     o mesmo; o novo closer entra pelo link.
-- -----------------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. PRESENÇA
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.qs_presenca (
  user_id        uuid primary key references public.qs_users(id) on delete cascade,
  visto_em       timestamptz not null default now(),
  -- desde quando está nesta "sessão" (zera quando fica 10 min sem bater)
  online_desde   timestamptz not null default now(),
  tela           text,
  acao_atual     text,
  lead_id        uuid references public.qs_leads(id) on delete set null,
  aba_visivel    boolean not null default true,
  em_ligacao     boolean not null default false,
  ligacao_desde  timestamptz
);

comment on table public.qs_presenca is
  '0215 — Mesa do supervisor: última batida de cada pessoa (tela, ação, ligação). Grava só via qs_presenca_bater().';

alter table public.qs_presenca enable row level security;

drop policy if exists qs_presenca_ler on public.qs_presenca;
create policy qs_presenca_ler on public.qs_presenca
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.qs_is_manager()));
-- Sem policy de insert/update/delete: só a função grava.

revoke all on public.qs_presenca from anon, public;
grant select on public.qs_presenca to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. HEARTBEAT
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.qs_presenca_bater(
  p_tela        text,
  p_acao        text default null,
  p_lead        uuid default null,
  p_aba_visivel boolean default true,
  p_em_ligacao  boolean default false
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_lead uuid;
begin
  if v_uid is null or not exists (select 1 from qs_users where id = v_uid and is_active) then
    return; -- quem não é usuário ativo não aparece na Mesa (e não recebe erro)
  end if;
  -- lead que não existe (ou id inventado) não pode quebrar a batida
  select id into v_lead from qs_leads where id = p_lead;

  insert into qs_presenca as p (user_id, visto_em, online_desde, tela, acao_atual, lead_id, aba_visivel, em_ligacao, ligacao_desde)
  values (v_uid, now(), now(), left(p_tela, 80), left(p_acao, 160), v_lead,
          coalesce(p_aba_visivel, true), coalesce(p_em_ligacao, false),
          case when coalesce(p_em_ligacao, false) then now() end)
  on conflict (user_id) do update set
    visto_em      = now(),
    online_desde  = case when p.visto_em < now() - interval '10 minutes' then now() else p.online_desde end,
    tela          = excluded.tela,
    acao_atual    = excluded.acao_atual,
    lead_id       = excluded.lead_id,
    aba_visivel   = excluded.aba_visivel,
    em_ligacao    = excluded.em_ligacao,
    ligacao_desde = case
                      when not excluded.em_ligacao then null
                      when p.em_ligacao and p.ligacao_desde is not null then p.ligacao_desde
                      else now() end;
end;
$$;

revoke all on function public.qs_presenca_bater(text, text, uuid, boolean, boolean) from public, anon;
grant execute on function public.qs_presenca_bater(text, text, uuid, boolean, boolean) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. A MESA (uma ida só)
-- ═════════════════════════════════════════════════════════════════════════════
-- p_corte_atraso: a data de corte de "atrasada" calculada no front com a mesma
-- régua do resto do sistema (overdueCutoff: dia útil, src/lib/workHours.ts).
-- Sem ela, usa a meia-noite de hoje em São Paulo.
create or replace function public.qs_mesa_comercial(
  p_corte_atraso      timestamptz default null,
  p_incluir_inativos  boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ini   timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_corte timestamptz;
  v_out   jsonb;
begin
  if not qs_is_manager() then
    raise exception 'Só admin ou gestor do Comercial abre a Mesa.' using errcode = '42501';
  end if;
  v_corte := coalesce(p_corte_atraso, v_ini);

  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'id', u.id, 'nome', u.name, 'papel', u.role, 'ativo', u.is_active,
      'ausente_ate', u.ausente_ate, 'ausente_motivo', u.ausente_motivo,
      'visto_em', p.visto_em, 'online_desde', p.online_desde, 'tela', p.tela, 'acao_atual', p.acao_atual,
      'lead_id', p.lead_id, 'lead_nome', (select l.full_name from qs_leads l where l.id = p.lead_id),
      'aba_visivel', p.aba_visivel, 'em_ligacao', p.em_ligacao, 'ligacao_desde', p.ligacao_desde,
      'concluidas_hoje', (select count(*) from qs_tasks t where t.owner_id = u.id and t.status = 'concluida' and t.completed_at >= v_ini),
      'pendentes_hoje',  (select count(*) from qs_tasks t where t.owner_id = u.id and t.status in ('pendente','atrasada')
                                                          and t.scheduled_at >= v_ini and t.scheduled_at < v_ini + interval '1 day'),
      'atrasadas',       (select count(*) from qs_tasks t where t.owner_id = u.id and t.status in ('pendente','atrasada') and t.scheduled_at < v_corte),
      'leads_abertos',   (select count(*) from qs_leads l where l.owner_id = u.id and l.status in ('nao_iniciado','em_prospeccao')),
      'ligacoes_hoje',   (select count(*) from qs_call_logs c where c.owner_id = u.id and c.created_at >= v_ini),
      'atendidas_hoje',  (select count(*) from qs_call_logs c where c.owner_id = u.id and c.created_at >= v_ini and c.answered),
      'ultima', (
        select jsonb_build_object('em', t.completed_at, 'canal', t.channel_type, 'resultado', t.contact_result,
                                  'lead_id', t.lead_id, 'lead_nome', l.full_name)
          from qs_tasks t left join qs_leads l on l.id = t.lead_id
         where t.owner_id = u.id and t.status = 'concluida' and t.completed_at >= v_ini - interval '3 days'
         order by t.completed_at desc limit 1),
      'reunioes', (
        select coalesce(jsonb_agg(r order by r->>'em'), '[]'::jsonb) from (
          select jsonb_build_object('id', m.id, 'em', m.scheduled_at, 'lead_id', m.lead_id,
                                    'lead_nome', coalesce(m.lead_name, l.full_name), 'link', m.meeting_link,
                                    'como', case when m.closer_id = u.id then 'closer' else 'marcou' end) as r
            from qs_meetings m left join qs_leads l on l.id = m.lead_id
           where (m.closer_id = u.id or (m.owner_id = u.id and u.role <> 'closer'))
             and m.status in ('agendada','confirmada')
             and m.scheduled_at >= now() - interval '1 hour'
           order by m.scheduled_at limit 3) z)
    ) as x
    from qs_users u
    left join qs_presenca p on p.user_id = u.id
    where u.role in ('sdr','closer') and (u.is_active or p_incluir_inativos)
  ) s;

  return jsonb_build_object('agora', now(), 'corte_atraso', v_corte, 'pessoas', v_out);
end;
$$;

revoke all on function public.qs_mesa_comercial(timestamptz, boolean) from public, anon;
grant execute on function public.qs_mesa_comercial(timestamptz, boolean) to authenticated;

create index if not exists idx_qs_tasks_owner_concluida
  on public.qs_tasks (owner_id, completed_at) where status = 'concluida';
create index if not exists idx_qs_tasks_owner_aberta
  on public.qs_tasks (owner_id, scheduled_at) where status in ('pendente','atrasada');

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. AFASTAR / DESATIVAR / REATIVAR
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.qs_comercial_afastamentos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.qs_users(id) on delete cascade,
  feito_por   uuid references public.qs_users(id) on delete set null default auth.uid(),
  modo        text not null check (modo in ('desativar','ausencia','reativar')),
  ausente_ate date,
  motivo      text,
  resumo      jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now()
);
create index if not exists qs_comercial_afastamentos_user on public.qs_comercial_afastamentos (user_id, criado_em desc);
create index if not exists qs_comercial_afastamentos_criado on public.qs_comercial_afastamentos (criado_em desc);

comment on table public.qs_comercial_afastamentos is
  '0215 — registro de quem desativou/afastou/reativou quem pela Mesa, e pra onde foram leads, atividades e reuniões.';

alter table public.qs_comercial_afastamentos enable row level security;
drop policy if exists qs_comercial_afastamentos_ler on public.qs_comercial_afastamentos;
create policy qs_comercial_afastamentos_ler on public.qs_comercial_afastamentos
  for select to authenticated using ((select public.qs_is_manager()));
revoke all on public.qs_comercial_afastamentos from anon, public;
grant select on public.qs_comercial_afastamentos to authenticated;

-- ── Prévia: o que a pessoa tem em aberto e pra quem dá pra mandar ────────────
create or replace function public.qs_comercial_afastar_previa(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
    'tarefas_abertas', (select count(*) from qs_tasks where owner_id = p_user and status in ('pendente','atrasada')),
    'reservas_30d',    (select count(*) from sdr_reservas where sdr_id = p_user and created_at > now() - interval '30 days'),
    'negocios_abertos',(select count(*) from qs_closer_negocios where closer_id = p_user and arquivado_em is null and not closer_etapa_final(etapa)),
    'reunioes_futuras', (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'em', m.scheduled_at, 'ate', m.ends_at,
                                                   'lead_nome', coalesce(m.lead_name, l.full_name), 'titulo', m.title)
                                order by m.scheduled_at), '[]'::jsonb)
        from qs_meetings m left join qs_leads l on l.id = m.lead_id
       where m.closer_id = p_user and m.status in ('agendada','confirmada') and m.scheduled_at >= now()),
    -- quem entra no "dividir no rodízio": SDR ativo, sem ausência, menos carregado primeiro
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
$$;

revoke all on function public.qs_comercial_afastar_previa(uuid) from public, anon;
grant execute on function public.qs_comercial_afastar_previa(uuid) to authenticated;

-- ── A ação, numa transação ───────────────────────────────────────────────────
-- p_modo:      'desativar' | 'ausencia' | 'reativar'
-- p_destino:   pra quem vão leads + atividades + reservas. NULL = dividir no
--              rodízio entre os SDRs ativos e não ausentes (menos carregado
--              primeiro, depois em roda).
-- p_mover:     na ausência, se também move leads/atividades (padrão: não — a
--              ausência sozinha já tira a pessoa do rodízio de leads novos).
--              Na desativação, move SEMPRE.
-- p_reunioes:  [{"id": "<meeting>", "closer_id": "<novo closer>"}] — toda
--              reunião futura do closer precisa vir aqui na desativação.
-- p_negocios_para: closer que herda os cartões abertos do pipeline (opcional).
create or replace function public.qs_comercial_afastar(
  p_user           uuid,
  p_modo           text,
  p_ausente_ate    date default null,
  p_motivo         text default null,
  p_destino        uuid default null,
  p_mover          boolean default false,
  p_reunioes       jsonb default '[]'::jsonb,
  p_negocios_para  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  v_novo      uuid;
  v_nome      text;
  v_resumo    jsonb;
  v_mover     boolean;
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

  -- mesma trava do rodízio (0099): nenhum lead novo é distribuído no meio disto
  perform pg_advisory_xact_lock(hashtext('qs_assign_equilibrio'));

  -- ── reativar: volta pro jogo e acabou ──
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

  -- ── destino de leads/atividades ──
  if v_mover then
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

    if v_n = 0 and (exists (select 1 from qs_leads where owner_id = p_user and status in ('nao_iniciado','em_prospeccao'))
                    or exists (select 1 from qs_tasks where owner_id = p_user and status in ('pendente','atrasada'))) then
      raise exception 'Não há SDR ativo (e sem ausência) pra receber os leads. Escolha uma pessoa específica.';
    end if;

    if v_n > 0 then
      -- leads abertos: em roda pelo pool (o menos carregado recebe primeiro)
      with alvo as (
        select l.id, row_number() over (order by l.created_at, l.id) as rn
          from qs_leads l where l.owner_id = p_user and l.status in ('nao_iniciado','em_prospeccao')
      )
      update qs_leads l set owner_id = v_pool[((a.rn - 1) % v_n) + 1]
        from alvo a where l.id = a.id;
      get diagnostics v_leads = row_count;

      -- atividades abertas: seguem o novo dono do lead; as sem lead (ou com
      -- lead de dono inativo) vão na roda também
      update qs_tasks t set owner_id = l.owner_id
        from qs_leads l, qs_users nu
       where t.owner_id = p_user and t.status in ('pendente','atrasada')
         and l.id = t.lead_id and l.owner_id <> p_user
         and nu.id = l.owner_id and nu.is_active;
      get diagnostics v_tarefas = row_count;

      with resto as (
        select t.id, row_number() over (order by t.scheduled_at, t.id) as rn
          from qs_tasks t where t.owner_id = p_user and t.status in ('pendente','atrasada')
      )
      update qs_tasks t set owner_id = v_pool[((r2.rn - 1) % v_n) + 1]
        from resto r2 where t.id = r2.id;
      get diagnostics v_faltam = row_count;
      v_tarefas := v_tarefas + v_faltam;

      -- reservas da carteira (mesmo telefone volta pro mesmo SDR por 30 dias):
      -- na desativação, a reserva passa pro novo dono do lead (ou pra roda)
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

  -- ── reuniões futuras (closer) ──
  for r in
    select (e->>'id')::uuid as mid, nullif(e->>'closer_id', '')::uuid as cid
      from jsonb_array_elements(coalesce(p_reunioes, '[]'::jsonb)) e
  loop
    if r.cid is null then continue; end if;
    select name into v_nome from qs_users where id = r.cid and is_active and role in ('closer','admin','gestor');
    if v_nome is null then raise exception 'O closer escolhido para uma das reuniões não está ativo.'; end if;
    if r.cid = p_user then raise exception 'Escolha outro closer (não a pessoa que está saindo).'; end if;
    -- conflito de horário: avisa com o nome em vez de estourar a exclusão da 0027
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

  -- ── cartões abertos do pipeline do closer ──
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
    'destino', case when not v_mover then null when p_destino is null then 'rodizio' else p_destino::text end,
    'rodizio', case when v_mover and p_destino is null then to_jsonb(v_pool) end,
    'antes', jsonb_build_object('ativo', v_u.is_active, 'ausente_ate', v_u.ausente_ate, 'ausente_motivo', v_u.ausente_motivo)
  );
  insert into qs_comercial_afastamentos (user_id, feito_por, modo, ausente_ate, motivo, resumo)
  values (p_user, v_ator, p_modo, case when p_modo = 'ausencia' then p_ausente_ate end, nullif(trim(p_motivo), ''), v_resumo);
  return v_resumo;
end;
$$;

revoke all on function public.qs_comercial_afastar(uuid, text, date, text, uuid, boolean, jsonb, uuid) from public, anon;
grant execute on function public.qs_comercial_afastar(uuid, text, date, text, uuid, boolean, jsonb, uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. GRAVAÇÃO DA REUNIÃO (link colado à mão)
-- ═════════════════════════════════════════════════════════════════════════════
-- Puxar sozinho do Google exigiria: escopo drive.readonly (ou Meet REST API
-- conferenceRecords.recordings/transcripts) na conta de serviço/OAuth do
-- calendário, gravação ligada no Workspace (plano Business Standard ou acima),
-- e um job (cron) que, ~30 min depois do fim, procure a conferência pelo
-- meeting_link/calendar_event_id e grave aqui. Até lá: colar o link.
alter table public.qs_meetings add column if not exists gravacao_url text;
comment on column public.qs_meetings.gravacao_url is '0215 — link da gravação/transcrição (Drive/Meet), colado pelo closer ou gestor.';

create or replace function public.qs_reuniao_gravacao(p_meeting uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_url text := nullif(trim(p_url), '');
begin
  if v_url is not null and v_url !~* '^https://' then
    raise exception 'O link precisa começar com https://';
  end if;
  update qs_meetings set gravacao_url = left(v_url, 1000)
   where id = p_meeting
     and (closer_id = v_uid or owner_id = v_uid or qs_is_manager());
  if not found then
    raise exception 'Reunião não encontrada ou sem permissão.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.qs_reuniao_gravacao(uuid, text) from public, anon;
grant execute on function public.qs_reuniao_gravacao(uuid, text) to authenticated;

-- ── Conferência depois de aplicar ────────────────────────────────────────────
--   select * from qs_presenca order by visto_em desc;
--   select qs_mesa_comercial();                       -- logado como gestor
--   select * from qs_comercial_afastamentos order by criado_em desc limit 10;
--   select column_name from information_schema.columns where table_name = 'qs_meetings' and column_name = 'gravacao_url';

-- ── ROLLBACK (rodar à mão, nesta ordem) ──────────────────────────────────────
-- drop function if exists public.qs_reuniao_gravacao(uuid, text);
-- alter table public.qs_meetings drop column if exists gravacao_url;
-- drop function if exists public.qs_comercial_afastar(uuid, text, date, text, uuid, boolean, jsonb, uuid);
-- drop function if exists public.qs_comercial_afastar_previa(uuid);
-- drop table if exists public.qs_comercial_afastamentos;
-- drop function if exists public.qs_mesa_comercial(timestamptz, boolean);
-- drop function if exists public.qs_presenca_bater(text, text, uuid, boolean, boolean);
-- drop table if exists public.qs_presenca;
-- drop index if exists public.idx_qs_tasks_owner_concluida;
-- drop index if exists public.idx_qs_tasks_owner_aberta;
-- (o que a RPC já moveu — leads, tarefas, reuniões — não volta sozinho; o
--  resumo de cada ação fica em qs_comercial_afastamentos.resumo e no qs_audit_log.)
