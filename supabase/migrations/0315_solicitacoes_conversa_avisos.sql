-- 0315 — Central de Solicitações: QUADRO + CONVERSA e "quem fica sabendo" (05/11/2026)
--
-- Pergunta do Bruno: "como vamos notificar todos e como eles conseguem
-- acompanhar essas respostas". O padrão escolhido:
--
--   PARTICIPANTES de um pedido = quem pediu · o responsável · TODO o setor que
--   recebe enquanto o pedido está "Nova" (ninguém pegou) · quem clicou
--   "Acompanhar" ou comentou (tabela nova qs_solicitacao_seguidores).
--
--   1. qs_solicitacao_seguidores + qs_sol_seguir() + qs_sol_participantes().
--      Quem comenta passa a acompanhar sozinho (gatilho).
--   2. "Devolver para quem pediu" (aguardando:solicitante) PAUSA o prazo:
--      qs_solicitacoes.pausado_em; ao sair da pausa o prazo anda pra frente o
--      tanto de minutos ÚTEIS que ficou pausado (menos quando o prazo é "data
--      certa" — prazo_manual — ou quando quem saiu da pausa já recalculou o
--      prazo, como o qs_sol_ajustar faz). Enquanto pausado, "vencida" = false.
--   3. View qs_solicitacoes_v ganha no FIM: pausado_em, prazo_pausado,
--      seguindo, participo, nao_lidas (eventos de outras pessoas depois do meu
--      último "visto", 30 dias) e ultimo_evento (pra prévia no cartão).
--   4. qs_sol_contagem ganha 'nao_lidas' (soma do que eu participo no setor) —
--      o selo de "Solicitações" no menu usa isso.
--   5. Aviso (qs_avisos → Realtime → toast + notificação do navegador):
--      comentário avisa TODOS os participantes menos o autor ("Antônio
--      respondeu no pedido #45"); devolver/concluir/reabrir/… avisa também
--      quem acompanha (quem pediu e responsável já recebem pela 0196).
--   6. qs_avisos_sol_sem_dono(): pedido "Nova" há 2h úteis sem dono avisa o
--      GESTOR do setor (sem gestor → admins). Chamado pelo cron api/avisos.js.
--
-- Comentário continua sendo qs_sol_acao(p_acao := 'comentar') — o evento tipo
-- 'comentario' já guarda texto, autor_id (default auth.uid()) e autor_nome; não
-- precisou de RPC nova. Escrita continua só por RPC.
--
-- GANCHO PRA WHATSAPP (preparado, NÃO ligado): todo aviso nasce em
-- qs_aviso_criar(). Pra mandar também por WhatsApp fora do sistema, o caminho é
-- (a) coluna qs_users.aviso_whatsapp boolean (opt-in por pessoa) e (b) um
-- gatilho AFTER INSERT em qs_avisos, WHEN (new.tipo in ('solicitacao','prazo')),
-- que põe o aviso numa fila (ex.: qs_avisos_saida) — o cron api/avisos.js lê a
-- fila e envia pelo número oficial (API da Meta, modelo aprovado, porque a
-- pessoa pode estar fora da janela de 24h). Nada disso é criado aqui.

-- ── 1. Quem acompanha ───────────────────────────────────────────────────────
create table if not exists public.qs_solicitacao_seguidores (
  solicitacao_id uuid not null references public.qs_solicitacoes(id) on delete cascade,
  user_id        uuid not null references public.qs_users(id) on delete cascade,
  motivo         text not null default 'acompanhar' check (motivo in ('acompanhar', 'comentou')),
  criado_em      timestamptz not null default now(),
  primary key (solicitacao_id, user_id)
);
create index if not exists qs_sol_seg_user_idx on public.qs_solicitacao_seguidores (user_id);

alter table public.qs_solicitacao_seguidores enable row level security;
drop policy if exists app_cliente_barreira on public.qs_solicitacao_seguidores;
create policy app_cliente_barreira on public.qs_solicitacao_seguidores as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
drop policy if exists qs_sol_seg_ler on public.qs_solicitacao_seguidores;
create policy qs_sol_seg_ler on public.qs_solicitacao_seguidores for select to authenticated
  using (exists (select 1 from public.qs_solicitacoes s
                  where s.id = solicitacao_id and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id)));
revoke all on public.qs_solicitacao_seguidores from public, anon;
grant select on public.qs_solicitacao_seguidores to authenticated;

-- Acompanhar / deixar de acompanhar (quem vê o pedido).
create or replace function public.qs_sol_seguir(p_id uuid, p_seguir boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s qs_solicitacoes;
begin
  select * into s from qs_solicitacoes where id = p_id;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if not qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id) then raise exception 'Sem acesso a essa solicitação.'; end if;
  if coalesce(p_seguir, true) then
    insert into qs_solicitacao_seguidores (solicitacao_id, user_id, motivo) values (p_id, auth.uid(), 'acompanhar')
      on conflict (solicitacao_id, user_id) do update set motivo = 'acompanhar';
  else
    delete from qs_solicitacao_seguidores where solicitacao_id = p_id and user_id = auth.uid();
  end if;
end $$;
revoke all on function public.qs_sol_seguir(uuid, boolean) from public, anon;
grant execute on function public.qs_sol_seguir(uuid, boolean) to authenticated;

-- Quem está no pedido (pro painel: "Pediu · Com · Acompanham").
create or replace function public.qs_sol_participantes(p_id uuid)
returns table (user_id uuid, nome text, papel text)
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select * from qs_solicitacoes
     where id = p_id and qs_ve_solicitacao(de_setor, para_setor, criado_por, responsavel_id)
  )
  select u.id, u.name, 'pediu' from s join qs_users u on u.id = s.criado_por
  union all
  select u.id, u.name, 'responsavel' from s join qs_users u on u.id = s.responsavel_id
   where s.responsavel_id is distinct from s.criado_por
  union all
  select u.id, u.name, 'acompanha' from s
    join qs_solicitacao_seguidores g on g.solicitacao_id = s.id
    join qs_users u on u.id = g.user_id and u.is_active
   where g.user_id is distinct from s.criado_por and g.user_id is distinct from s.responsavel_id;
$$;
revoke all on function public.qs_sol_participantes(uuid) from public, anon;
grant execute on function public.qs_sol_participantes(uuid) to authenticated;

-- Quem comenta passa a acompanhar (se já não é quem pediu nem o responsável).
create or replace function public.qs_sol_seguir_ao_comentar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.autor_id is not null and exists (
       select 1 from qs_solicitacoes s where s.id = new.solicitacao_id
          and s.criado_por is distinct from new.autor_id and s.responsavel_id is distinct from new.autor_id) then
    insert into qs_solicitacao_seguidores (solicitacao_id, user_id, motivo) values (new.solicitacao_id, new.autor_id, 'comentou')
      on conflict (solicitacao_id, user_id) do nothing;
  end if;
  return null;
exception when others then
  raise warning '[qs_sol] seguir ao comentar %: %', new.id, sqlerrm;
  return null;
end $$;
revoke all on function public.qs_sol_seguir_ao_comentar() from public, anon, authenticated;
drop trigger if exists trg_qs_sol_seguir_ao_comentar on public.qs_solicitacao_eventos;
create trigger trg_qs_sol_seguir_ao_comentar after insert on public.qs_solicitacao_eventos
  for each row when (new.tipo = 'comentario') execute function public.qs_sol_seguir_ao_comentar();

-- ── 2. Prazo pausado enquanto o pedido voltou pra quem pediu ────────────────
alter table public.qs_solicitacoes add column if not exists pausado_em timestamptz;

create or replace function public.qs_sol_pausa_prazo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  entrou boolean := new.status = 'aguardando' and new.aguardando_quem = 'solicitante';
  estava boolean := old.status = 'aguardando' and old.aguardando_quem = 'solicitante';
begin
  if entrou and not estava then
    new.pausado_em := now();
  elsif estava and not entrou then
    -- só empurra se ninguém recalculou o prazo nessa mesma mudança e não é "data certa"
    if old.pausado_em is not null and new.prazo is not null and new.prazo is not distinct from old.prazo
       and not coalesce(new.prazo_manual, false) then
      new.prazo := qs_somar_minutos_uteis(old.prazo, rel_minutos_uteis(old.pausado_em, now()));
    end if;
    new.pausado_em := null;
  end if;
  return new;
end $$;
revoke all on function public.qs_sol_pausa_prazo() from public, anon, authenticated;
drop trigger if exists trg_qs_sol_pausa_prazo on public.qs_solicitacoes;
create trigger trg_qs_sol_pausa_prazo before update of status, aguardando_quem on public.qs_solicitacoes
  for each row execute function public.qs_sol_pausa_prazo();

-- Os que já estão devolvidos: a pausa começa no último "pediu ajuste".
update public.qs_solicitacoes s
   set pausado_em = coalesce((select max(e.criado_em) from public.qs_solicitacao_eventos e
                               where e.solicitacao_id = s.id and e.tipo = 'ajuste'), s.atualizado_em)
 where s.status = 'aguardando' and s.aguardando_quem = 'solicitante' and s.pausado_em is null;

-- ── 3. View: pausa, participação, não lidas e a última mensagem ─────────────
-- (mesmas colunas na mesma ordem; só "vencida" respeita a pausa; as novas vão no fim)
create or replace view public.qs_solicitacoes_v with (security_invoker = true) as
 select s.id,
    s.numero,
    s.de_setor,
    s.para_setor,
    s.tipo_id,
    s.titulo,
    s.descricao,
    s.prioridade,
    s.status,
    s.aguardando_quem,
    s.prazo,
    s.cliente_id,
    s.viagem_id,
    s.lead_id,
    s.conversa_id,
    s.sobre_nome,
    s.criado_por,
    s.responsavel_id,
    s.criado_em,
    s.aceito_em,
    s.concluido_em,
    s.confirmado_em,
    s.atualizado_em,
    s.atualizado_por,
    s.resolucao,
    s.reaberturas,
    t.rotulo as tipo_rotulo,
    uc.name as criado_por_nome,
    ur.name as responsavel_nome,
    (s.status = any (array['nova', 'em_andamento', 'aguardando'])) as aberta,
    ((s.status = any (array['nova', 'em_andamento', 'aguardando'])) and s.prazo is not null and s.prazo < now()
      and not (s.status = 'aguardando' and s.aguardando_quem = 'solicitante')) as vencida,
    ((s.status = 'nova') and (rel_minutos_uteis(s.criado_em, now()) >= 120)) as sem_dono_atrasada,
    ((s.atualizado_por is distinct from auth.uid()) and (s.atualizado_em > coalesce(v.visto_em, '-infinity'::timestamptz))) as novidade,
    (t.formulario = 'cotacao') as cotacao,
    s.formulario,
    s.desfecho,
    s.desfecho_motivo,
    s.desfecho_texto,
    s.desfecho_em,
    s.desfecho_prazo,
    ud.name as desfecho_por_nome,
    ((s.status = 'concluida') and (s.desfecho is null) and (s.desfecho_prazo is not null)) as falta_desfecho,
    ((s.status = 'concluida') and (s.desfecho is null) and (s.desfecho_prazo is not null) and (s.desfecho_prazo < now())) as desfecho_atrasado,
    -- 0315
    s.pausado_em,
    (s.status = 'aguardando' and s.aguardando_quem = 'solicitante') as prazo_pausado,
    exists (select 1 from qs_solicitacao_seguidores g where g.solicitacao_id = s.id and g.user_id = auth.uid()) as seguindo,
    (s.criado_por = auth.uid() or s.responsavel_id = auth.uid()
      or exists (select 1 from qs_solicitacao_seguidores g where g.solicitacao_id = s.id and g.user_id = auth.uid())
      or (s.status = 'nova' and s.responsavel_id is null and qs_do_setor(s.para_setor))) as participo,
    (select count(*)::int from qs_solicitacao_eventos e
      where e.solicitacao_id = s.id and e.autor_id is distinct from auth.uid()
        and e.criado_em > coalesce(v.visto_em, '-infinity'::timestamptz)
        and e.criado_em > now() - interval '30 days') as nao_lidas,
    (select jsonb_build_object('tipo', e.tipo, 'texto', left(e.texto, 160), 'para', e.para,
              'autor_id', e.autor_id, 'autor_nome', e.autor_nome, 'criado_em', e.criado_em)
       from qs_solicitacao_eventos e where e.solicitacao_id = s.id
      order by e.criado_em desc, e.id desc limit 1) as ultimo_evento
   from qs_solicitacoes s
     left join qs_solicitacao_tipos t on t.id = s.tipo_id
     left join qs_users uc on uc.id = s.criado_por
     left join qs_users ur on ur.id = s.responsavel_id
     left join qs_users ud on ud.id = s.desfecho_por
     left join qs_solicitacao_vistos v on v.solicitacao_id = s.id and v.user_id = auth.uid();
revoke all on public.qs_solicitacoes_v from anon;

-- Pedidos já fechados não estreiam com "não lidas" acumuladas: marca como visto
-- pra quem pediu e pro responsável.
insert into public.qs_solicitacao_vistos (solicitacao_id, user_id)
select s.id, x.u from public.qs_solicitacoes s
  cross join lateral (values (s.criado_por), (s.responsavel_id)) x(u)
 where s.status in ('concluida', 'recusada', 'cancelada') and x.u is not null
   and exists (select 1 from public.qs_users q where q.id = x.u)
on conflict (solicitacao_id, user_id) do nothing;

-- ── 4. Contagem do menu + não lidas ─────────────────────────────────────────
create or replace function public.qs_sol_contagem(p_setor text)
returns jsonb language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
    'novas',      count(*) filter (where para_setor = p_setor and status = 'nova'),
    'atrasadas',  count(*) filter (where para_setor = p_setor and (sem_dono_atrasada or vencida)),
    'comigo',     count(*) filter (where responsavel_id = auth.uid() and aberta),
    'novidades',  count(*) filter (where criado_por = auth.uid() and novidade and not (status = 'cancelada')),
    'ajustes',    count(*) filter (where criado_por = auth.uid() and status = 'aguardando' and aguardando_quem = 'solicitante'),
    'desfechos',  count(*) filter (where criado_por = auth.uid() and desfecho_atrasado),
    'nao_lidas',  coalesce(sum(nao_lidas) filter (where participo and (para_setor = p_setor or de_setor = p_setor)
                    and (aberta or concluido_em > now() - interval '14 days')), 0)
  )
  from qs_solicitacoes_v
  where para_setor = p_setor or criado_por = auth.uid() or responsavel_id = auth.uid() or seguindo;
$$;
revoke all on function public.qs_sol_contagem(text) from public, anon;
grant execute on function public.qs_sol_contagem(text) to authenticated;

-- ── 5. Avisos de mensagem/evento pra todos os participantes ─────────────────
-- Área do link: a do setor que RECEBE se a pessoa é de lá; senão a de quem pediu.
create or replace function public.qs_sol_area_de(p_user uuid, p_de text, p_para text)
returns text language sql stable security definer set search_path to 'public' as $$
  select case when exists (select 1 from qs_users where id = p_user and p_para = any(coalesce(setores, '{}'))) then p_para else p_de end;
$$;
revoke all on function public.qs_sol_area_de(uuid, text, text) from public, anon, authenticated;

create or replace function public.qs_avisos_sol_evento()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  s qs_solicitacoes;
  autor uuid := coalesce(new.autor_id, auth.uid());
  quem text := coalesce(nullif(split_part(coalesce(new.autor_nome, ''), ' ', 1), ''), 'Alguém');
  v_titulo text;
  v_texto text;
  v_area text;
  u uuid;
begin
  begin
    select * into s from qs_solicitacoes where id = new.solicitacao_id;
    if s.id is null then return null; end if;

    if new.tipo = 'comentario' then
      -- mensagem: avisa TODO participante menos quem escreveu
      v_titulo := quem || ' respondeu no pedido #' || s.numero;
      v_texto := left(coalesce(new.texto, ''), 200);
      for u in
        select distinct x from (
          select s.criado_por x
          union all select s.responsavel_id
          union all select g.user_id from qs_solicitacao_seguidores g where g.solicitacao_id = s.id
          union all select r from qs_avisos_recebedores(s.para_setor) r where s.status = 'nova' and s.responsavel_id is null
        ) p where x is not null
      loop
        continue when u is not distinct from autor;
        v_area := case when u = s.criado_por then s.de_setor when u = s.responsavel_id then s.para_setor
                       else qs_sol_area_de(u, s.de_setor, s.para_setor) end;
        perform qs_aviso_criar(u, 'solicitacao', v_area, v_titulo, v_texto,
          qs_avisos_link_sol(v_area, u, s.id), 'qs_solicitacoes', s.id::text, 'sol_evt:' || new.id);
      end loop;
    else
      -- devolveu, concluiu, reabriu…: quem pediu e o responsável já recebem pela 0196;
      -- aqui entram só os que ACOMPANHAM.
      v_titulo := 'Pedido #' || s.numero || ': ' || quem || ' ' || case new.tipo
        when 'ajuste' then 'devolveu para quem pediu'
        when 'ajustada' then 'enviou os ajustes'
        when 'concluida' then 'concluiu'
        when 'recusada' then 'recusou'
        when 'reaberta' then 'reabriu'
        when 'cancelada' then 'cancelou'
        when 'aceita' then 'pegou o pedido'
        when 'passada' then 'passou para ' || coalesce(new.para, 'outra pessoa')
        else 'atualizou' end;
      v_texto := coalesce(left(new.texto, 200), s.titulo);
      for u in
        select g.user_id from qs_solicitacao_seguidores g
         where g.solicitacao_id = s.id
           and g.user_id is distinct from s.criado_por and g.user_id is distinct from s.responsavel_id
      loop
        continue when u is not distinct from autor;
        v_area := qs_sol_area_de(u, s.de_setor, s.para_setor);
        perform qs_aviso_criar(u, 'solicitacao', v_area, v_titulo, v_texto,
          qs_avisos_link_sol(v_area, u, s.id), 'qs_solicitacoes', s.id::text, 'sol_evt:' || new.id);
      end loop;
    end if;
  exception when others then
    raise warning '[qs_avisos] evento %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.qs_avisos_sol_evento() from public, anon, authenticated;

drop trigger if exists trg_qs_avisos_sol_evento on public.qs_solicitacao_eventos;
create trigger trg_qs_avisos_sol_evento after insert on public.qs_solicitacao_eventos
  for each row when (new.tipo in ('comentario', 'ajuste', 'ajustada', 'concluida', 'recusada', 'reaberta', 'cancelada', 'aceita', 'passada'))
  execute function public.qs_avisos_sol_evento();

-- ── 6. Sem dono há 2h úteis → gestor do setor ───────────────────────────────
create or replace function public.qs_avisos_sol_sem_dono()
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  u uuid;
  n int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão.';
  end if;
  for r in
    select s.id, s.numero, s.titulo, s.sobre_nome, s.para_setor
      from qs_solicitacoes s
     where s.status = 'nova' and s.responsavel_id is null
       and s.criado_em > now() - interval '10 days'
       and rel_minutos_uteis(s.criado_em, now()) >= 120
  loop
    begin
      for u in
        with g as (
          select id from qs_users where is_active and role = 'gestor' and r.para_setor = any(coalesce(setores, '{}'))
        )
        select id from g
        union all
        select id from qs_users where is_active and role = 'admin' and not exists (select 1 from g)
      loop
        perform qs_aviso_criar(u, 'prazo', r.para_setor,
          'Ninguém pegou o pedido #' || r.numero || ' há 2h úteis',
          r.titulo || coalesce(' — ' || r.sobre_nome, ''),
          qs_avisos_link_sol(r.para_setor, u, r.id), 'qs_solicitacoes', r.id::text, 'sol_semdono:' || r.id);
        n := n + 1;
      end loop;
    exception when others then raise warning '[qs_avisos] sem dono %: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.qs_avisos_sol_sem_dono() from public, anon, authenticated;
grant execute on function public.qs_avisos_sol_sem_dono() to service_role;
