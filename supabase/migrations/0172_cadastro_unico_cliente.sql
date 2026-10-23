-- 0172 — CADASTRO ÚNICO DO CLIENTE (Bruno 21/10/2026: "ser 1 sistema só — a mesma
-- informação que o Relacionamento tem do perfil do cliente, o Operações deve ter também,
-- ainda mais passageiros").
--
-- Ideia: a PESSOA é uma só = rel_clientes (a ficha). Cada linha de `passageiros` é a
-- participação dessa pessoa numa expedição e aponta pra ficha por `cliente_id`.
--   • Passageiro novo (Operações, inscrição, Bitrix, CSV, app antigo) → acha a ficha
--     (CPF → passaporte → contato Bitrix → telefone → e-mail → nome único) ou cria.
--   • Dados pessoais (CPF, passaporte, validade, nascimento, e-mail, telefone) valem
--     pros dois lados: quem edita por último ganha, e vai pra ficha e pra todas as
--     viagens da pessoa. Campo vazio nunca apaga o que existe.
--   • O que já está diferente hoje NÃO é escolhido no chute: vai pra fila
--     `cad_divergencias` e alguém escolhe qual vale.
--   • Nome NÃO é sincronizado: passageiro guarda o nome do passaporte, a ficha pode
--     ter o nome de chamada (188 diferem hoje, quase tudo acento/abreviação).
-- Nada aqui quebra insert do app antigo: as funções engolem erro e só avisam.
-- Preenchimento dos dados que já existem: 0172b (separado, roda depois do ok).

-- ── normalizadores (mesmas regras do importar-expedicoes.mjs) ──
create or replace function cad_dig(t text) returns text language sql immutable as
  $$ select nullif(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '') $$;
create or replace function cad_cpf(t text) returns text language sql immutable as
  $$ select case when length(cad_dig(t)) = 11 and cad_dig(t) !~ '^(\d)\1{10}$' then cad_dig(t) end $$;
create or replace function cad_pass(t text) returns text language sql immutable as
  $$ select case when upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z0-9]{5,12}$'
                 then upper(regexp_replace(t, '[^A-Za-z0-9]', '', 'g')) end $$;
create or replace function cad_tel(t text) returns text language sql immutable as $$
  select case when d is null then null
              when length(d) in (10, 11) then '55' || d
              when length(d) between 12 and 15 then d end
    from (select cad_dig(t) d) x $$;
create or replace function cad_email(t text) returns text language sql immutable as
  $$ select case when lower(trim(coalesce(t, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(trim(t)) end $$;
create or replace function cad_nome(t text) returns text language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^a-z ]+', ' ', 'g'), '\s+', ' ', 'g')), '') $$;
/** CPF no formato que o Operações usa (000.000.000-00). */
create or replace function cad_cpf_fmt(t text) returns text language sql immutable as
  $$ select case when cad_cpf(t) is not null then regexp_replace(cad_cpf(t), '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4') end $$;

-- ── a ligação ──
alter table passageiros add column if not exists cliente_id uuid references rel_clientes(id) on delete set null;
create index if not exists passageiros_cliente_idx on passageiros (cliente_id);

-- ── fila de divergências ──
create table if not exists cad_divergencias (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references rel_clientes(id) on delete cascade,
  passageiro_id   uuid not null references passageiros(id) on delete cascade,
  campo           text not null check (campo in ('pessoa', 'cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone')),
  valor_ficha     text,
  valor_expedicao text,
  ficha_sugerida  uuid references rel_clientes(id) on delete set null,   -- campo 'pessoa': a ficha antiga (13/10)
  criado_em       timestamptz not null default now(),
  resolvido_em    timestamptz,
  resolvido_por   uuid,
  escolha         text check (escolha in ('ficha', 'expedicao', 'editado', 'mesma', 'outra'))
);
create unique index if not exists cad_divergencias_aberta_idx on cad_divergencias (passageiro_id, campo) where resolvido_em is null;
create index if not exists cad_divergencias_cliente_idx on cad_divergencias (cliente_id) where resolvido_em is null;
alter table cad_divergencias enable row level security;
drop policy if exists cad_divergencias_ler on cad_divergencias;
create policy cad_divergencias_ler on cad_divergencias for select to authenticated using (rel_tem_acesso() or ops_tem_acesso());
revoke all on cad_divergencias from anon;

/** Segue a ficha mesclada até a que vale. */
create or replace function cad_ficha_viva(p uuid) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := p; m uuid; i int := 0;
begin
  loop
    select mesclado_em_id into m from rel_clientes where id = v;
    exit when m is null or i > 10;
    v := m; i := i + 1;
  end loop;
  return v;
end $$;

/** A ficha pode ser desse passageiro? Não, se tem outro CPF ou se já tem OUTRA pessoa na mesma
    expedição (a importação de 13/10 juntou parentes: passaporte/contato do Bitrix de quem comprou). */
create or replace function cad_compativel(p passageiros, p_ficha uuid) returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from rel_clientes c where c.id = p_ficha and cad_cpf(c.cpf) is not null and cad_cpf(p.cpf) is not null and cad_cpf(c.cpf) <> cad_cpf(p.cpf))
     and not exists (select 1 from passageiros o where o.cliente_id = p_ficha and o.id <> p.id and o.expedicao_id = p.expedicao_id
                        and not (cad_cpf(o.cpf) is not null and cad_cpf(o.cpf) = cad_cpf(p.cpf)))
$$;

/** Acha a ficha de um passageiro (não cria). Devolve null se não achou ou se ficou ambíguo. */
create or replace function cad_achar_ficha(p passageiros) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid; n int;
begin
  -- 1) a ligação feita pela importação de 13/10
  select cliente_id into v from rel_expedicoes_vinculo where passageiro_id = p.id and cliente_id is not null;
  v := cad_ficha_viva(v);
  if v is not null and cad_compativel(p, v) then return v; end if;
  v := null;
  -- 2) CPF  3) passaporte  4) contato do Bitrix — chaves fortes: pega a ativa
  if cad_cpf(p.cpf) is not null then
    select id into v from rel_clientes where mesclado_em_id is null and cpf = cad_cpf(p.cpf) and cad_compativel(p, id) order by arquivado_em nulls first, criado_em limit 1;
    if v is not null then return v; end if;
  end if;
  if cad_pass(p.passaporte) is not null then
    select id into v from rel_clientes where mesclado_em_id is null and passaporte = cad_pass(p.passaporte) and cad_compativel(p, id) order by arquivado_em nulls first, criado_em limit 1;
    if v is not null then return v; end if;
  end if;
  if nullif(trim(p.bitrix_contact_id), '') is not null then
    select id into v from rel_clientes where mesclado_em_id is null and bitrix_contato_id = trim(p.bitrix_contact_id) and cad_compativel(p, id) order by arquivado_em nulls first, criado_em limit 1;
    if v is not null then return v; end if;
  end if;
  -- 5) telefone  6) e-mail  7) nome — só se for um só
  if cad_tel(p.telefone) is not null then
    select count(*), min(id::text)::uuid into n, v from rel_clientes where mesclado_em_id is null and telefone = cad_tel(p.telefone) and cad_compativel(p, id);
    if n = 1 then return v; end if;
  end if;
  if cad_email(p.email) is not null then
    select count(*), min(id::text)::uuid into n, v from rel_clientes where mesclado_em_id is null and lower(email) = cad_email(p.email) and cad_compativel(p, id);
    if n = 1 then return v; end if;
  end if;
  if cad_nome(p.nome_completo) is not null then
    select count(*), min(id::text)::uuid into n, v from rel_clientes
     where mesclado_em_id is null and cad_nome(nome) = cad_nome(p.nome_completo)
       and (nascimento is null or p.data_nascimento is null or nascimento = p.data_nascimento) and cad_compativel(p, id);
    if n = 1 then return v; end if;
  end if;
  return null;
end $$;

/** Valor de um campo, já normalizado, de cada lado. */
create or replace function cad_valor_pax(p passageiros, campo text) returns text language sql immutable as $$
  select case campo when 'cpf' then cad_cpf(p.cpf) when 'passaporte' then cad_pass(p.passaporte)
    when 'passaporte_validade' then p.validade_passaporte::text when 'nascimento' then p.data_nascimento::text
    when 'email' then cad_email(p.email) when 'telefone' then cad_tel(p.telefone) end $$;
create or replace function cad_valor_ficha(c rel_clientes, campo text) returns text language sql immutable as $$
  select case campo when 'cpf' then cad_cpf(c.cpf) when 'passaporte' then cad_pass(c.passaporte)
    when 'passaporte_validade' then c.passaporte_validade::text when 'nascimento' then c.nascimento::text
    when 'email' then cad_email(c.email) when 'telefone' then cad_tel(c.telefone) end $$;

/** Grava UM campo na ficha e em todas as viagens da pessoa (sem disparar o sincronismo de novo). */
create or replace function cad_gravar_campo(p_cliente uuid, p_campo text, p_valor text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('cad.sync', 'on', true);
  if p_campo = 'cpf' then
    update rel_clientes set cpf = cad_cpf(p_valor) where id = p_cliente and cpf is distinct from cad_cpf(p_valor);
    update passageiros set cpf = cad_cpf_fmt(p_valor) where cliente_id = p_cliente and cad_cpf(cpf) is distinct from cad_cpf(p_valor);
  elsif p_campo = 'passaporte' then
    update rel_clientes set passaporte = cad_pass(p_valor) where id = p_cliente and passaporte is distinct from cad_pass(p_valor);
    update passageiros set passaporte = cad_pass(p_valor) where cliente_id = p_cliente and cad_pass(passaporte) is distinct from cad_pass(p_valor);
  elsif p_campo = 'passaporte_validade' then
    update rel_clientes set passaporte_validade = p_valor::date where id = p_cliente and passaporte_validade is distinct from p_valor::date;
    update passageiros set validade_passaporte = p_valor::date where cliente_id = p_cliente and validade_passaporte is distinct from p_valor::date;
  elsif p_campo = 'nascimento' then
    update rel_clientes set nascimento = p_valor::date where id = p_cliente and nascimento is distinct from p_valor::date;
    update passageiros set data_nascimento = p_valor::date where cliente_id = p_cliente and data_nascimento is distinct from p_valor::date;
  elsif p_campo = 'email' then
    update rel_clientes set email = cad_email(p_valor) where id = p_cliente and lower(email) is distinct from cad_email(p_valor);
    update passageiros set email = cad_email(p_valor) where cliente_id = p_cliente and cad_email(email) is distinct from cad_email(p_valor);
  elsif p_campo = 'telefone' then
    update rel_clientes set telefone = cad_tel(p_valor) where id = p_cliente and telefone is distinct from cad_tel(p_valor);
    update passageiros set telefone = cad_tel(p_valor) where cliente_id = p_cliente and cad_tel(telefone) is distinct from cad_tel(p_valor);
  end if;
  perform set_config('cad.sync', 'off', true);
end $$;
revoke all on function cad_gravar_campo(uuid, text, text) from public, anon, authenticated;

/** Confere um passageiro com a ficha: completa o lado vazio, divergência vai pra fila. */
create or replace function cad_conciliar(p_pax uuid) returns void language plpgsql security definer set search_path = public as $$
declare p passageiros; c rel_clientes; f text; vp text; vc text;
begin
  select * into p from passageiros where id = p_pax;
  if p.cliente_id is null then return; end if;
  select * into c from rel_clientes where id = p.cliente_id;
  foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone'] loop
    vp := cad_valor_pax(p, f); vc := cad_valor_ficha(c, f);
    if vp is null and vc is null then continue; end if;
    if vp is not distinct from vc then continue; end if;
    if vc is null or vp is null then
      begin
        perform cad_gravar_campo(c.id, f, coalesce(vp, vc));   -- o lado vazio ganha o que o outro sabia
      exception when unique_violation then
        perform set_config('cad.sync', 'off', true);
        insert into cad_divergencias (cliente_id, passageiro_id, campo, valor_ficha, valor_expedicao)
        values (c.id, p.id, f, vc, vp) on conflict (passageiro_id, campo) where resolvido_em is null do nothing;
      end;
    else
      insert into cad_divergencias (cliente_id, passageiro_id, campo, valor_ficha, valor_expedicao)
      values (c.id, p.id, f, vc, vp)
      on conflict (passageiro_id, campo) where resolvido_em is null
      do update set valor_ficha = excluded.valor_ficha, valor_expedicao = excluded.valor_expedicao;
    end if;
  end loop;
end $$;
revoke all on function cad_conciliar(uuid) from public, anon, authenticated;

/** Liga um passageiro à ficha (acha ou cria) e concilia. Devolve a ficha. */
create or replace function cad_ligar_passageiro(p_pax uuid, p_criar boolean default true) returns uuid language plpgsql security definer set search_path = public as $$
declare p passageiros; v uuid;
begin
  select * into p from passageiros where id = p_pax;
  if not found then return null; end if;
  v := coalesce(cad_ficha_viva(p.cliente_id), cad_achar_ficha(p));
  -- cria só pra quem é cliente de verdade (líder é da equipe; lead ainda não comprou)
  if v is null and p_criar and p.tipo::text <> 'Líder' and p.status_reserva::text not in ('Lead', 'Cancelado') then
    insert into rel_clientes (nome, cpf, passaporte, passaporte_validade, nascimento, telefone, email, bitrix_contato_id, observacoes)
    -- CPF/passaporte/contato Bitrix são únicos na ficha: se outra ficha já usa (parente), fica vazio e vai pra fila
    values (p.nome_completo,
            case when not exists (select 1 from rel_clientes x where x.mesclado_em_id is null and x.cpf = cad_cpf(p.cpf)) then cad_cpf(p.cpf) end,
            case when not exists (select 1 from rel_clientes x where x.mesclado_em_id is null and x.passaporte = cad_pass(p.passaporte)) then cad_pass(p.passaporte) end,
            p.validade_passaporte, p.data_nascimento, cad_tel(p.telefone), cad_email(p.email),
            case when not exists (select 1 from rel_clientes x where x.mesclado_em_id is null and x.bitrix_contato_id = trim(p.bitrix_contact_id)) then nullif(trim(p.bitrix_contact_id), '') end,
            'Criada pelo cadastro único (passageiro de expedição).')
    returning id into v;
  end if;
  if v is null then return null; end if;
  -- a importação de 13/10 tinha posto essa pessoa noutra ficha: registra pra alguém conferir
  insert into cad_divergencias (cliente_id, passageiro_id, campo, valor_ficha, valor_expedicao, ficha_sugerida)
  select v, p.id, 'pessoa', (select nome from rel_clientes where id = cad_ficha_viva(x.cliente_id)), p.nome_completo, cad_ficha_viva(x.cliente_id)
    from rel_expedicoes_vinculo x
   where x.passageiro_id = p.id and x.cliente_id is not null and cad_ficha_viva(x.cliente_id) <> v
  on conflict (passageiro_id, campo) where resolvido_em is null do nothing;
  if p.cliente_id is distinct from v then
    perform set_config('cad.sync', 'on', true);
    update passageiros set cliente_id = v where id = p_pax;
    perform set_config('cad.sync', 'off', true);
  end if;
  perform cad_conciliar(p_pax);
  return v;
end $$;
revoke all on function cad_ligar_passageiro(uuid, boolean) from public, anon, authenticated;

-- ── sincronismo ──
-- passageiro novo ou com dado pessoal editado
create or replace function cad_trg_passageiro() returns trigger language plpgsql security definer set search_path = public as $$
declare f text; vn text; vo text;
begin
  if coalesce(current_setting('cad.sync', true), 'off') = 'on' then return null; end if;
  begin
    if new.cliente_id is null then
      perform cad_ligar_passageiro(new.id, true);
      return null;
    end if;
    if tg_op = 'UPDATE' then
      -- quem edita por último ganha: campo preenchido/alterado vai pra ficha e pras outras viagens
      foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone'] loop
        vn := cad_valor_pax(new, f); vo := cad_valor_pax(old, f);
        if vn is not null and vn is distinct from vo then
          perform cad_gravar_campo(new.cliente_id, f, vn);
          update cad_divergencias set resolvido_em = now(), resolvido_por = auth.uid(), escolha = 'editado'
           where cliente_id = new.cliente_id and cad_divergencias.campo = f and resolvido_em is null;
        end if;
      end loop;
    else
      perform cad_conciliar(new.id);
    end if;
  exception when others then
    raise warning 'cadastro único: passageiro % não sincronizou: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists cad_passageiro_ins on passageiros;
create trigger cad_passageiro_ins after insert on passageiros for each row execute function cad_trg_passageiro();
drop trigger if exists cad_passageiro_upd on passageiros;
create trigger cad_passageiro_upd after update of cpf, passaporte, validade_passaporte, data_nascimento, email, telefone, cliente_id
  on passageiros for each row execute function cad_trg_passageiro();

-- ficha editada no Relacionamento → todas as viagens da pessoa
create or replace function cad_trg_ficha() returns trigger language plpgsql security definer set search_path = public as $$
declare f text; vn text; vo text;
begin
  if coalesce(current_setting('cad.sync', true), 'off') = 'on' then return null; end if;
  begin
    foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone'] loop
      vn := cad_valor_ficha(new, f); vo := cad_valor_ficha(old, f);
      if vn is not null and vn is distinct from vo then
        perform cad_gravar_campo(new.id, f, vn);
        update cad_divergencias set resolvido_em = now(), resolvido_por = auth.uid(), escolha = 'editado'
         where cliente_id = new.id and cad_divergencias.campo = f and resolvido_em is null;
      end if;
    end loop;
    -- ficha mesclada em outra: os passageiros vão junto
    if new.mesclado_em_id is not null and old.mesclado_em_id is null then
      perform set_config('cad.sync', 'on', true);
      update passageiros set cliente_id = cad_ficha_viva(new.mesclado_em_id) where cliente_id = new.id;
      update cad_divergencias set cliente_id = cad_ficha_viva(new.mesclado_em_id) where cliente_id = new.id and resolvido_em is null;
      perform set_config('cad.sync', 'off', true);
    end if;
  exception when others then
    raise warning 'cadastro único: ficha % não sincronizou: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists cad_ficha_upd on rel_clientes;
create trigger cad_ficha_upd after update of cpf, passaporte, passaporte_validade, nascimento, email, telefone, mesclado_em_id
  on rel_clientes for each row execute function cad_trg_ficha();

-- ── telas ──
/** Escolhe qual valor vale numa divergência; grava na ficha e em todas as viagens.
    campo 'pessoa': 'outra' = é outra pessoa mesmo (fica na ficha própria); 'mesma' = volta pra ficha antiga. */
create or replace function cad_resolver_divergencia(p_id uuid, p_escolha text) returns void language plpgsql security definer set search_path = public as $$
declare d cad_divergencias;
begin
  if not (rel_tem_acesso() or ops_tem_acesso()) then raise exception 'Sem permissão pra arrumar cadastro.'; end if;
  select * into d from cad_divergencias where id = p_id and resolvido_em is null;
  if not found then raise exception 'Essa divergência já foi resolvida.'; end if;
  if d.campo = 'pessoa' then
    if p_escolha not in ('mesma', 'outra') then raise exception 'Escolha: é a mesma pessoa ou outra pessoa.'; end if;
    update cad_divergencias set resolvido_em = now(), resolvido_por = auth.uid(), escolha = p_escolha where id = p_id;
    if p_escolha = 'mesma' and d.ficha_sugerida is not null then perform cad_trocar_ficha(d.passageiro_id, d.ficha_sugerida); end if;
    return;
  end if;
  if p_escolha not in ('ficha', 'expedicao') then raise exception 'Escolha ficha ou expedição.'; end if;
  perform cad_gravar_campo(d.cliente_id, d.campo, case p_escolha when 'ficha' then d.valor_ficha else d.valor_expedicao end);
  update cad_divergencias set resolvido_em = now(), resolvido_por = auth.uid(), escolha = p_escolha
   where cliente_id = d.cliente_id and campo = d.campo and resolvido_em is null;
end $$;
grant execute on function cad_resolver_divergencia(uuid, text) to authenticated;

/** Liga à mão um passageiro a outra ficha (quando a automática errou). */
create or replace function cad_trocar_ficha(p_pax uuid, p_cliente uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (rel_tem_acesso() or ops_tem_acesso()) then raise exception 'Sem permissão pra arrumar cadastro.'; end if;
  perform set_config('cad.sync', 'on', true);
  update passageiros set cliente_id = cad_ficha_viva(p_cliente) where id = p_pax;
  delete from cad_divergencias where passageiro_id = p_pax and resolvido_em is null and campo <> 'pessoa';
  perform set_config('cad.sync', 'off', true);
  perform cad_conciliar(p_pax);
end $$;
grant execute on function cad_trocar_ficha(uuid, uuid) to authenticated;
