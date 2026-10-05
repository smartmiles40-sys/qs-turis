-- 0099 — DISTRIBUIÇÃO EQUILIBRADA DE LEADS ENTRE OS SDRs (05/10)
--
-- O time reclamava de divisão desigual. Medido de 21/09 a 05/10 (leads NOVOS,
-- sem retorno): Mariana 199, Victor Hugo 189, Yanca 199 — e por canal pior:
-- live 13 / 18 / 18, "outros" 40 / 25 / 34.
--
-- A causa: havia TRÊS rodas independentes decidindo dono, cada uma com o seu
-- ponteiro e sem enxergar as outras:
--   1. o gatilho de qs_leads (`qs_proximo_sdr('global' | 'cadencia:X')`);
--   2. a agenda de ligação com SDR (_ligacaoSdr.js), que escolhia "quem tem
--      menos ligações marcadas daqui pra frente" e ignorava quantos leads cada
--      um já tinha recebido;
--   3. o distribuidor das páginas (`fila:forms`, parado desde 29/09).
-- Cada uma era justa sozinha; somadas, desalinhavam, e nenhuma olhava o CANAL.
-- Um SDR afastado de manhã também nunca era compensado à tarde.
--
-- A REGRA NOVA, uma só pra todo lugar: o lead vai pra quem RECEBEU MENOS leads
-- novos HOJE (dia de São Paulo) DESTE CANAL (live / tráfego / orgânico / outros
-- / sem fonte); empate → quem recebeu menos no total hoje; empate → a ordem da
-- roda (o próximo depois do último que recebeu). Como ela olha o que de fato
-- entrou (qs_lead_entradas, 0094), qualquer desvio — ligação marcada num
-- horário em que só um SDR estava livre, lead que caiu na carteira, SDR que
-- voltou de folga — é corrigido pelos leads seguintes, automaticamente.
--
-- O que NÃO muda: carteira (mesmo telefone volta pro mesmo SDR), reserva do
-- distribuidor (30 dias), afastamento (0090) e dono vindo explícito. Retornos
-- não contam na conta — são da carteira, não da roda.

create or replace function public.qs_sdr_equilibrado(p_pool uuid[], p_canal text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n     int;
  v_last  uuid;
  v_pos   int;
  v_ini   timestamptz;
  v_canal text := coalesce(p_canal, 'sem_fonte');
  chosen  uuid;
begin
  if p_pool is null or cardinality(p_pool) = 0 then
    return null;
  end if;
  v_n := cardinality(p_pool);

  -- Uma trava pra TODA a distribuição (não uma por escopo): dois leads de live
  -- chegando juntos esperam um pelo outro, e o segundo já vê o primeiro contado
  -- (a linha em qs_lead_entradas nasce na mesma transação do lead).
  perform pg_advisory_xact_lock(hashtext('qs_assign_equilibrio'));

  v_ini := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';

  select s.last_owner_id into v_last from qs_assign_state s where s.scope = 'equilibrio';
  v_pos := coalesce(array_position(p_pool, v_last), 0);

  with hoje as (
    select e.sdr_id, qs_canal_da_fonte(l.segment) as canal
      from qs_lead_entradas e
      join qs_leads l on l.id = e.lead_id
     where e.chegou_em >= v_ini - interval '2 days'
       and l.created_at >= v_ini
       and not e.retorno
       and not e.reconstruido
       and e.sdr_id = any(p_pool)
  ),
  conta as (
    select sdr_id,
           count(*) filter (where canal = v_canal) as no_canal,
           count(*) as no_total
      from hoje group by sdr_id
  )
  select p.id into chosen
    from unnest(p_pool) with ordinality as p(id, ord)
    left join conta c on c.sdr_id = p.id
   order by coalesce(c.no_canal, 0),
            coalesce(c.no_total, 0),
            ((p.ord - v_pos - 1 + v_n) % v_n)
   limit 1;

  insert into qs_assign_state (scope, last_owner_id, updated_at)
       values ('equilibrio', chosen, now())
  on conflict (scope) do update
       set last_owner_id = excluded.last_owner_id, updated_at = now();

  return chosen;
end;
$$;

revoke all on function public.qs_sdr_equilibrado(uuid[], text) from public, anon, authenticated;
grant execute on function public.qs_sdr_equilibrado(uuid[], text) to service_role;

-- O gatilho: igual ao de antes (reserva → pool da cadência ou todos → tira os
-- afastados), só troca a roda pela conta do dia.
create or replace function public.qs_assign_lead_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pool    uuid[];
  v_todos   uuid[];
  v_chave   text;
  v_res_id  uuid;
  v_res_sdr uuid;
begin
  if new.owner_id is not null then
    return new;
  end if;

  v_chave := qs_tel_chave(new.phone);
  if v_chave is not null then
    select r.id, r.sdr_id into v_res_id, v_res_sdr from sdr_reservas r
     where r.chave = v_chave and r.sdr_id is not null and r.created_at > now() - interval '30 days'
     order by r.created_at desc limit 1;
    if v_res_sdr is not null and not qs_sdr_ausente(v_res_sdr) then
      new.owner_id := v_res_sdr;
      update sdr_reservas set lead_id = new.id where id = v_res_id and lead_id is null;
      return new;
    end if;
  end if;

  if new.cadence_id is not null then
    select array_agg(u.id order by u.created_at, u.id) into v_todos
      from qs_cadence_owners co join qs_users u on u.id = co.user_id
     where co.cadence_id = new.cadence_id and u.role = 'sdr' and u.is_active = true;
  end if;

  if v_todos is null or cardinality(v_todos) = 0 then
    select array_agg(u.id order by u.created_at, u.id) into v_todos
      from qs_users u where u.role = 'sdr' and u.is_active = true;
  end if;

  select array_agg(x order by o) into v_pool
    from unnest(v_todos) with ordinality as t(x, o)
   where not qs_sdr_ausente(x);

  if v_pool is null or cardinality(v_pool) = 0 then
    v_pool := v_todos;
  end if;

  new.owner_id := qs_sdr_equilibrado(v_pool, qs_canal_da_fonte(new.segment));
  return new;
end;
$$;

-- ── CLOSER DE RESERVA (mesmo dia, mesmo pedido) ─────────────────────────────
-- O John (supervisor) tem usuário de closer — "Z John Italo (closer)" — e por
-- isso entrava no rodízio do agendamento direto. Agora ele é RESERVA: só recebe
-- quando a agenda dos outros closers está lotada na janela inteira. A regra
-- mora em api/_agenda.js (closersPorPrioridade); aqui só a lista de quem é
-- reserva. Para tirar alguém da reserva, remova o id da lista.
insert into qs_settings (key, value, updated_at)
values ('agenda_closers_reserva', '["396165ae-e490-4076-9a99-436412839ed3"]'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();
