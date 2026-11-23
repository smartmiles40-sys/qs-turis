-- 0413 (23/11/2026) — CO-COORDENADORES EM TODOS OS SETORES.
--
-- Pedido do Bruno: "colocar outras pessoas como co-coordenadores, pra quando um
-- coordenador não estiver, outro entrar em ação e fazer as modificações". Em
-- todos os setores, com os poderes O TEMPO TODO (não só na ausência).
--
-- Até aqui "coordenador" = role 'gestor' + o setor em qs_users.setores. Trocar o
-- cargo da pessoa pra gestor quebraria o dia a dia (SDR que vira gestor sai da
-- distribuição de leads, atendente some das filas…). Então:
--   qs_users.coordena text[] — setores em que a pessoa é CO-COORDENADORA: mantém
--   o cargo dela e ganha os poderes de gestor NAQUELE setor.
--   qs_coordena_de(user, setor) / qs_coordena(setor) — a regra única:
--   admin, OU gestor com o setor, OU co-coordenador do setor.
-- As regras de permissão que olhavam "role = 'gestor' and setor = any(setores)"
-- passam a aceitar o co-coordenador. Os avisos de "pedido sem dono" também vão
-- pra ele.
-- Segurança: só admin promove alguém a admin; só quem coordena o setor (ou o
-- servidor) dá "co-coordena" naquele setor.

alter table qs_users add column if not exists coordena text[] not null default '{}';

create or replace function qs_coordena_de(p_user uuid, p_setor text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select u.role = 'admin'
        or (u.role = 'gestor' and p_setor = any(coalesce(u.setores, '{}')))
        or p_setor = any(coalesce(u.coordena, '{}'))
      from qs_users u where u.id = p_user and u.is_active
  ), false);
$$;
create or replace function qs_coordena(p_setor text)
returns boolean language sql stable security definer set search_path = public as $$
  select qs_coordena_de(auth.uid(), p_setor);
$$;
grant execute on function qs_coordena_de(uuid, text) to authenticated;
grant execute on function qs_coordena(text) to authenticated;

-- Setores/co-coordena coerentes + travas de segurança.
create or replace function qs_users_acerta_setores()
returns trigger language plpgsql as $function$
declare
  servidor boolean := coalesce(auth.role(), '') = 'service_role' or session_user in ('postgres', 'supabase_admin');
  x text;
begin
  if new.role = 'admin' then
    new.setores := array['comercial', 'relacionamento', 'financeiro', 'operacional', 'marketing'];
  elsif new.role in ('relacionamento', 'financeiro', 'operacional') then
    new.setores := array[new.role];
  elsif new.role = 'gestor' then
    if new.setores is null or cardinality(new.setores) = 0 then
      new.setores := array['comercial'];
    end if;
  else
    if new.setores is null or not ('comercial' = any(new.setores)) then
      new.setores := array_append(coalesce(new.setores, '{}'), 'comercial');
    end if;
    if new.role = 'marketing' and not ('marketing' = any(new.setores)) then
      new.setores := array_append(new.setores, 'marketing');
    end if;
  end if;

  -- 0413: só admin cria/promove admin.
  if new.role = 'admin' and (tg_op = 'INSERT' or old.role is distinct from 'admin') and not servidor
     and not exists (select 1 from qs_users e where e.id = auth.uid() and e.role = 'admin' and e.is_active) then
    raise exception 'Só um admin promove alguém a admin.';
  end if;

  -- 0413: co-coordena só setores que a pessoa acessa; admin/gestor não precisam.
  if new.role in ('admin', 'gestor') then
    new.coordena := '{}';
  else
    new.coordena := coalesce(array(
      select distinct c from unnest(coalesce(new.coordena, '{}')) c where c = any(new.setores) order by c
    ), '{}');
  end if;
  if not servidor and tg_op = 'UPDATE' then
    for x in select unnest(new.coordena) except select unnest(coalesce(old.coordena, '{}')) loop
      if not qs_coordena(x) then raise exception 'Só quem coordena o setor % pode dar co-coordenação nele.', x; end if;
    end loop;
  elsif not servidor and tg_op = 'INSERT' then
    for x in select unnest(new.coordena) loop
      if not qs_coordena(x) then raise exception 'Só quem coordena o setor % pode dar co-coordenação nele.', x; end if;
    end loop;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_qs_users_acerta_setores on qs_users;
create trigger trg_qs_users_acerta_setores before insert or update of role, setores, coordena on qs_users
  for each row execute function qs_users_acerta_setores();

-- ── As regras de permissão ────────────────────────────────────────────────

create or replace function qs_pode_de(p_user uuid, p text)
returns boolean language sql stable security definer set search_path = public as $function$
  select coalesce((
    select case
      when u.role = 'admin' then true
      when u.role = 'gestor' and split_part(p, '.', 1) = any(coalesce(u.setores, '{}')) then true
      when split_part(p, '.', 1) = any(coalesce(u.coordena, '{}')) then true
      when c.id is not null and c.setor = split_part(p, '.', 1) then p = any(c.permissoes)
      else coalesce((select d.padrao from qs_permissoes_padrao() d where d.chave = p), false)
    end
    from qs_users u
    left join qs_cargos c on c.id = u.cargo_id and c.ativo
    where u.id = p_user and u.is_active
  ), false);
$function$;

create or replace function qs_gestor_do_setor(p_setor text)
returns boolean language sql stable security definer set search_path = public as $$ select qs_coordena(p_setor); $$;

create or replace function qs_is_manager()
returns boolean language sql stable security definer set search_path = public as $$ select qs_coordena('comercial'); $$;

create or replace function qs_menu_pode_gerir(p_setor text)
returns boolean language sql stable security definer set search_path = public as $$ select qs_coordena(p_setor); $$;

create or replace function rel_pode_configurar()
returns boolean language sql stable security definer set search_path = public as $$ select qs_coordena('relacionamento'); $$;

create or replace function fin_pode_configurar()
returns boolean language sql stable security definer set search_path = public as $$ select qs_coordena('financeiro'); $$;

create or replace function ops_pode_configurar()
returns boolean language sql stable security definer set search_path = public as $$ select qs_coordena('operacional'); $$;

create or replace function qs_pode_gerir_cargo(p_setor text)
returns boolean language sql stable security definer set search_path = public as $function$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin'
            or (role = 'gestor' and 'relacionamento' = any(setores) and p_setor in ('relacionamento', 'financeiro'))
            or (role = 'gestor' and 'financeiro'     = any(setores) and p_setor = 'financeiro')
            or (role = 'gestor' and 'operacional'    = any(setores) and p_setor = 'operacional')
            or ('relacionamento' = any(coalesce(coordena, '{}')) and p_setor in ('relacionamento', 'financeiro'))
            or (p_setor in ('financeiro', 'operacional') and p_setor = any(coalesce(coordena, '{}'))))
  );
$function$;

create or replace function qs_pode_ver_monitor()
returns boolean language sql stable security definer set search_path = public as $function$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from qs_users
                  where id = auth.uid() and is_active
                    and (role in ('admin', 'marketing')
                         or (role = 'gestor' and 'comercial' = any(coalesce(setores, '{}')))
                         or 'comercial' = any(coalesce(coordena, '{}'))));
$function$;

create or replace function qs_sol_age_como_quem_pediu(p_criado_por uuid, p_de_setor text)
returns boolean language sql stable security definer set search_path = public as $function$
  select p_criado_por = auth.uid() or qs_coordena(p_de_setor);
$function$;

create or replace function qs_sol_definir_distribuicao(p_setor text, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $function$
begin
  if not qs_coordena(p_setor) then raise exception 'Só a gestão do setor liga a distribuição.'; end if;
  update qs_sol_distribuicao set ativo = p_ativo, atualizado_em = now(), atualizado_por = auth.uid() where setor = p_setor;
end $function$;

create or replace function qs_sol_definir_papeis(p_user uuid, p_papeis text[])
returns void language plpgsql security definer set search_path = public as $function$
declare v_setores text[];
begin
  select setores into v_setores from qs_users where id = p_user;
  if v_setores is null then raise exception 'Pessoa não encontrada.'; end if;
  if not exists (
    select 1 from qs_users g where g.id = auth.uid() and g.is_active
       and (g.role = 'admin' or (g.role = 'gestor' and g.setores && v_setores) or coalesce(g.coordena, '{}') && v_setores)
  ) then raise exception 'Só a gestão do setor muda os papéis.'; end if;
  update qs_users set papeis = coalesce(p_papeis, '{}') where id = p_user;
end $function$;

create or replace function qs_definir_superior(p_usuario uuid, p_superior uuid)
returns void language plpgsql security definer set search_path = public as $function$
declare eu qs_users; alvo qs_users;
begin
  select * into eu from qs_users where id = auth.uid();
  select * into alvo from qs_users where id = p_usuario;
  if alvo.id is null then raise exception 'usuario-nao-encontrado'; end if;
  if not (eu.role = 'admin'
          or (eu.role = 'gestor' and coalesce(eu.setores, '{}') && coalesce(alvo.setores, '{}'))
          or coalesce(eu.coordena, '{}') && coalesce(alvo.setores, '{}')) then
    raise exception 'sem-permissao';
  end if;
  if p_superior is not null then
    if p_superior = p_usuario then raise exception 'superior-ciclo'; end if;
    if exists (select 1 from qs_subordinados(p_usuario) s where s = p_superior) then raise exception 'superior-ciclo'; end if;
  end if;
  update qs_users set superior_id = p_superior where id = p_usuario;
end $function$;

create or replace function mkt_eh_gestor(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $function$
  select exists (
    select 1 from qs_users u
     where u.id = p_user and u.is_active
       and (u.role = 'admin'
            or (u.role = 'gestor' and 'marketing' = any(coalesce(u.setores, '{}')))
            or 'marketing' = any(coalesce(u.coordena, '{}'))
            or exists (select 1 from mkt_equipe e where e.user_id = u.id and 'gestor' = any(e.papeis)))
  );
$function$;

create or replace function fin_ve_atendimento(p_enviado_por uuid)
returns boolean language sql stable security definer set search_path = public as $function$
  select fin_tem_acesso() or rel_tem_acesso() or p_enviado_por = auth.uid()
      or exists (select 1 from qs_users where id = auth.uid() and is_active
                  and (role in ('admin','gestor') or cardinality(coalesce(coordena, '{}')) > 0));
$function$;

create or replace function qs_avisos_sol_sem_dono()
returns integer language plpgsql security definer set search_path = public as $function$
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
          select id from qs_users where is_active
             and ((role = 'gestor' and r.para_setor = any(coalesce(setores, '{}'))) or r.para_setor = any(coalesce(coordena, '{}')))
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
end $function$;

-- Conferir: select name, role, setores, coordena from qs_users where cardinality(coordena) > 0;
-- Desfazer: reaplicar as versões anteriores das funções (0400 e anteriores) e
--   alter table qs_users drop column coordena;
