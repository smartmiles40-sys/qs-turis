-- 0327_fin_comissoes.sql
-- -----------------------------------------------------------------------------
-- COMISSÕES DOS SDRs E CLOSERS (Bruno, 06/11/2026): "como se fosse uma
-- planilha, card por card. Cada um deve só visualizar o próprio, e o financeiro
-- deve fazer o fechamento de todos".
--
-- A CONTA fica no front, numa função pura com testes (src/fin/comissoes/
-- calculo.ts). O banco guarda:
--   fin_com_vendas      espelho dos cards comerciais do Bitrix, copiado do
--                       Dashboard pelo cron api/fin-comissoes.js. sdr_id e
--                       closer_id são resolvidos aqui (apelidos + nome).
--   fin_com_apelidos    nome do Bitrix → pessoa do QS, quando o nome não casa
--                       sozinho ("Mariana Rodrigues - SDR" × "Mariana").
--   fin_com_regras      valor fixo por R.R e por Expedição, % de Aéreo e de
--                       Pacote; por papel, exceção por pessoa, com vigência.
--   fin_com_ajustes     valor manual / "não comissiona" num card, com motivo.
--                       Só insere (é o histórico); o mais novo vale.
--   fin_com_fechamentos o mês fechado de uma pessoa: os valores ficam
--                       CONGELADOS em `itens` (mudar a regra depois não mexe).
--                       Pago com data; reabrir só com motivo.
--   fin_com_sync        quando o cron rodou pela última vez.
--
-- QUEM VÊ (RLS): o financeiro (fin_tem_acesso(), 0126) lê e mexe em tudo; o
-- SDR/closer lê só o que é dele (sdr_id/closer_id/pessoa_id = auth.uid()).
-- Escrita do financeiro usa fin_tem_acesso() (não fin_pode_configurar): a
-- única pessoa do Financeiro hoje (Giovana) não é gestora, e é ela quem fecha.
--
-- Volta:
--   drop table if exists fin_com_fechamentos, fin_com_ajustes, fin_com_regras,
--     fin_com_vendas, fin_com_apelidos, fin_com_sync cascade;
--   drop function if exists fin_com_norm(text), fin_com_pessoa_do_nome(text),
--     fin_com_vendas_resolver(), fin_com_reresolver(), fin_com_apelidos_mudou(),
--     fin_com_ajuste_confere(), fin_com_fechamento_confere();
-- -----------------------------------------------------------------------------

-- ── Nome do Bitrix → pessoa do QS ───────────────────────────────────────────
-- "Mariana Rodrigues - SDR" → "mariana rodrigues" (sem sufixo, sem acento).
create or replace function fin_com_norm(t text) returns text
language sql immutable set search_path = public as $$
  select nullif(regexp_replace(lower(trim(regexp_replace(
           translate(coalesce(t, ''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
                                      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'),
           '\s*-\s*(sdr|closer|especialista|coordenador|coordenadora)\s*$', '', 'i'))), '\s+', ' ', 'g'), '');
$$;

create table if not exists fin_com_apelidos (
  nome_norm   text primary key,
  nome_bitrix text not null,
  pessoa_id   uuid not null references qs_users(id) on delete cascade,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);

-- 1) apelido; 2) nome igual (sem sufixo/acento); 3) um nome é o começo do
-- outro ("Mariana" × "Mariana Rodrigues", "Yanca Manuella" × "Yanca Manuella
-- Ruivo") e só UMA pessoa ativa casa. Senão null → fila "sem dono".
create or replace function fin_com_pessoa_do_nome(p_nome text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  n text := fin_com_norm(p_nome);
  r uuid;
  qtd int;
begin
  if n is null or n ~ '^n[aã]o se aplica$' or n = '(sem responsavel)' then return null; end if;
  select pessoa_id into r from fin_com_apelidos where nome_norm = n;
  if r is not null then return r; end if;
  select id into r from qs_users
   where fin_com_norm(name) = n and role in ('sdr', 'closer', 'gestor', 'admin')
   order by is_active desc, (role in ('sdr', 'closer')) desc limit 1;
  if r is not null then return r; end if;
  select count(*), min(id::text)::uuid into qtd, r from qs_users u
   where u.is_active and u.role in ('sdr', 'closer', 'gestor', 'admin')
     and fin_com_norm(u.name) is not null
     and ((n || ' ') like (fin_com_norm(u.name) || ' %') or (fin_com_norm(u.name) || ' ') like (n || ' %'));
  return case when qtd = 1 then r end;
end $$;

-- ── Espelho dos cards ───────────────────────────────────────────────────────
create table if not exists fin_com_vendas (
  bitrix_id              text primary key,
  nome                   text,
  pipeline               text,
  fase                   text,
  tipo_venda             text,
  nome_expedicao         text,
  total                  numeric,
  data_venda             date,
  sdr                    text,
  responsavel_reuniao    text,
  vendedor               text,
  data_reuniao_realizada date,
  no_show                boolean,
  reuniao_realizada      boolean,
  atualizado_no_bitrix   timestamptz,
  sdr_id                 uuid references qs_users(id) on delete set null,
  closer_id              uuid references qs_users(id) on delete set null,
  sincronizado_em        timestamptz not null default now()
);
create index if not exists fin_com_vendas_data_venda_idx on fin_com_vendas (data_venda);
create index if not exists fin_com_vendas_rr_idx on fin_com_vendas (data_reuniao_realizada);
create index if not exists fin_com_vendas_sdr_idx on fin_com_vendas (sdr_id);
create index if not exists fin_com_vendas_closer_idx on fin_com_vendas (closer_id);

create or replace function fin_com_vendas_resolver() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sdr_id := fin_com_pessoa_do_nome(new.sdr);
  new.closer_id := fin_com_pessoa_do_nome(new.responsavel_reuniao);
  return new;
end $$;
drop trigger if exists fin_com_vendas_resolver on fin_com_vendas;
create trigger fin_com_vendas_resolver before insert or update on fin_com_vendas
  for each row execute function fin_com_vendas_resolver();

-- Refaz o de-para de todos os cards (apelido novo, pessoa renomeada).
create or replace function fin_com_reresolver() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is not null and not fin_tem_acesso() then
    raise exception 'só o Financeiro' using errcode = '42501';
  end if;
  update fin_com_vendas set sdr_id = sdr_id;   -- o gatilho recalcula
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function fin_com_reresolver() from public, anon;
grant execute on function fin_com_reresolver() to authenticated;

create or replace function fin_com_apelidos_mudou() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update fin_com_vendas set sdr_id = sdr_id;
  return null;
end $$;
drop trigger if exists fin_com_apelidos_mudou on fin_com_apelidos;
create trigger fin_com_apelidos_mudou after insert or update or delete on fin_com_apelidos
  for each statement execute function fin_com_apelidos_mudou();

-- ── Regras ──────────────────────────────────────────────────────────────────
create table if not exists fin_com_regras (
  id              uuid primary key default gen_random_uuid(),
  papel           text not null check (papel in ('sdr', 'closer')),
  pessoa_id       uuid references qs_users(id) on delete cascade,   -- null = geral
  vigente_desde   date not null,
  valor_rr        numeric check (valor_rr >= 0),
  valor_expedicao numeric check (valor_expedicao >= 0),
  pct_aereo       numeric check (pct_aereo >= 0 and pct_aereo <= 100),
  pct_pacote      numeric check (pct_pacote >= 0 and pct_pacote <= 100),
  obs             text,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now()
);
create unique index if not exists fin_com_regras_uma_por_dia
  on fin_com_regras (papel, coalesce(pessoa_id, '00000000-0000-0000-0000-000000000000'::uuid), vigente_desde);

-- ── Ajustes (histórico: só insere) ──────────────────────────────────────────
create table if not exists fin_com_ajustes (
  id         uuid primary key default gen_random_uuid(),
  bitrix_id  text not null,
  pessoa_id  uuid not null references qs_users(id) on delete cascade,
  papel      text not null check (papel in ('sdr', 'closer')),
  mes        text not null check (mes ~ '^\d{4}-\d{2}$'),
  tipo       text not null check (tipo in ('valor', 'nao_comissiona', 'limpar')),
  valor      numeric,
  motivo     text not null check (length(trim(motivo)) >= 3),
  criado_por uuid default auth.uid(),
  criado_em  timestamptz not null default now(),
  check (tipo <> 'valor' or valor is not null)
);
create index if not exists fin_com_ajustes_chave_idx on fin_com_ajustes (pessoa_id, papel, mes);

-- ── Fechamentos ─────────────────────────────────────────────────────────────
create table if not exists fin_com_fechamentos (
  id                 uuid primary key default gen_random_uuid(),
  pessoa_id          uuid not null references qs_users(id) on delete cascade,
  papel              text not null check (papel in ('sdr', 'closer')),
  mes                text not null check (mes ~ '^\d{4}-\d{2}$'),
  status             text not null default 'fechado' check (status in ('fechado', 'pago', 'reaberto')),
  total              numeric not null,
  cards              integer not null,
  itens              jsonb not null,           -- as linhas congeladas (calculo.ts → Linha[])
  fechado_por        uuid default auth.uid(),
  fechado_em         timestamptz not null default now(),
  pago_em            date,
  pago_por           uuid,
  reaberto_por       uuid,
  reaberto_em        timestamptz,
  motivo_reabertura  text,
  check (status <> 'pago' or pago_em is not null),
  check (status <> 'reaberto' or length(trim(coalesce(motivo_reabertura, ''))) >= 3)
);
-- Um fechamento VIVO por pessoa/papel/mês; os reabertos ficam de histórico.
create unique index if not exists fin_com_fechamentos_vivo
  on fin_com_fechamentos (pessoa_id, papel, mes) where status <> 'reaberto';

-- Mês fechado não aceita ajuste novo (reabre primeiro, com motivo).
create or replace function fin_com_ajuste_confere() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from fin_com_fechamentos f
              where f.pessoa_id = new.pessoa_id and f.papel = new.papel and f.mes = new.mes and f.status <> 'reaberto') then
    raise exception 'O mês % já está fechado para esta pessoa. Reabra antes de ajustar.', new.mes using errcode = '23514';
  end if;
  new.criado_por := coalesce(auth.uid(), new.criado_por);
  new.criado_em := now();
  return new;
end $$;
drop trigger if exists fin_com_ajuste_confere on fin_com_ajustes;
create trigger fin_com_ajuste_confere before insert on fin_com_ajustes
  for each row execute function fin_com_ajuste_confere();

-- Fechamento: o que foi congelado não muda; caminhos válidos:
-- fechado → pago (com data) · pago → fechado (desfaz o pago) · fechado/pago → reaberto (com motivo).
create or replace function fin_com_fechamento_confere() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.itens is distinct from old.itens or new.total is distinct from old.total or new.cards is distinct from old.cards
     or new.pessoa_id <> old.pessoa_id or new.papel <> old.papel or new.mes <> old.mes
     or new.fechado_em <> old.fechado_em or new.fechado_por is distinct from old.fechado_por then
    raise exception 'Fechamento é congelado: reabra (com motivo) e feche de novo.' using errcode = '23514';
  end if;
  if old.status = 'reaberto' then
    raise exception 'Fechamento reaberto fica de histórico; feche o mês de novo.' using errcode = '23514';
  end if;
  if new.status = 'pago' and old.status <> 'pago' then
    new.pago_por := coalesce(auth.uid(), new.pago_por);
  elsif new.status = 'fechado' and old.status = 'pago' then
    new.pago_em := null; new.pago_por := null;
  elsif new.status = 'reaberto' then
    new.reaberto_por := coalesce(auth.uid(), new.reaberto_por);
    new.reaberto_em := now();
  end if;
  return new;
end $$;
drop trigger if exists fin_com_fechamento_confere on fin_com_fechamentos;
create trigger fin_com_fechamento_confere before update on fin_com_fechamentos
  for each row execute function fin_com_fechamento_confere();

-- ── Status do cron ──────────────────────────────────────────────────────────
create table if not exists fin_com_sync (
  id          integer primary key default 1 check (id = 1),
  rodou_em    timestamptz,
  cards       integer,
  erro        text
);
insert into fin_com_sync (id) values (1) on conflict do nothing;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table fin_com_vendas      enable row level security;
alter table fin_com_apelidos    enable row level security;
alter table fin_com_regras      enable row level security;
alter table fin_com_ajustes     enable row level security;
alter table fin_com_fechamentos enable row level security;
alter table fin_com_sync        enable row level security;

-- Cards: o financeiro vê todos; o vendedor só os cards em que é o SDR ou o closer.
-- Ninguém escreve pela API (só o cron, com a service key).
drop policy if exists fin_com_vendas_ler on fin_com_vendas;
create policy fin_com_vendas_ler on fin_com_vendas for select to authenticated
  using (fin_tem_acesso() or sdr_id = auth.uid() or closer_id = auth.uid());

drop policy if exists fin_com_apelidos_ler on fin_com_apelidos;
create policy fin_com_apelidos_ler on fin_com_apelidos for select to authenticated using (fin_tem_acesso());
drop policy if exists fin_com_apelidos_mudar on fin_com_apelidos;
create policy fin_com_apelidos_mudar on fin_com_apelidos for all to authenticated
  using (fin_tem_acesso()) with check (fin_tem_acesso());

-- Regras: a geral do papel é pública pro time (o vendedor precisa dela pra ver a
-- própria conta); a exceção de uma pessoa só ela e o financeiro veem.
drop policy if exists fin_com_regras_ler on fin_com_regras;
create policy fin_com_regras_ler on fin_com_regras for select to authenticated
  using (fin_tem_acesso() or pessoa_id is null or pessoa_id = auth.uid());
drop policy if exists fin_com_regras_mudar on fin_com_regras;
create policy fin_com_regras_mudar on fin_com_regras for all to authenticated
  using (fin_tem_acesso()) with check (fin_tem_acesso());

drop policy if exists fin_com_ajustes_ler on fin_com_ajustes;
create policy fin_com_ajustes_ler on fin_com_ajustes for select to authenticated
  using (fin_tem_acesso() or pessoa_id = auth.uid());
drop policy if exists fin_com_ajustes_inserir on fin_com_ajustes;
create policy fin_com_ajustes_inserir on fin_com_ajustes for insert to authenticated
  with check (fin_tem_acesso());

drop policy if exists fin_com_fechamentos_ler on fin_com_fechamentos;
create policy fin_com_fechamentos_ler on fin_com_fechamentos for select to authenticated
  using (fin_tem_acesso() or pessoa_id = auth.uid());
drop policy if exists fin_com_fechamentos_inserir on fin_com_fechamentos;
create policy fin_com_fechamentos_inserir on fin_com_fechamentos for insert to authenticated
  with check (fin_tem_acesso());
drop policy if exists fin_com_fechamentos_mudar on fin_com_fechamentos;
create policy fin_com_fechamentos_mudar on fin_com_fechamentos for update to authenticated
  using (fin_tem_acesso()) with check (fin_tem_acesso());

drop policy if exists fin_com_sync_ler on fin_com_sync;
create policy fin_com_sync_ler on fin_com_sync for select to authenticated using (true);

revoke all on fin_com_vendas, fin_com_apelidos, fin_com_regras, fin_com_ajustes, fin_com_fechamentos, fin_com_sync from anon;
grant select on fin_com_vendas, fin_com_sync to authenticated;
grant select, insert, update, delete on fin_com_apelidos, fin_com_regras to authenticated;
grant select, insert on fin_com_ajustes to authenticated;
grant select, insert, update on fin_com_fechamentos to authenticated;
revoke execute on function fin_com_pessoa_do_nome(text) from public, anon;

-- Apelidos que já se sabe que não casam pelo nome exato (06/11): o Bitrix
-- escreve "Mariana Rodrigues - SDR" e "Yanca Manuella"; no QS são "Mariana" e
-- "Yanca Manuella Ruivo". O começo-do-nome já casaria, mas fica explícito e
-- editável na tela de Comissões › Apelidos.
insert into fin_com_apelidos (nome_norm, nome_bitrix, pessoa_id, criado_por)
select fin_com_norm(a.nome), a.nome, u.id, null
  from (values ('Mariana Rodrigues', 'Mariana'), ('Yanca Manuella', 'Yanca Manuella Ruivo')) a(nome, qs)
  join qs_users u on u.name = a.qs and u.is_active
on conflict (nome_norm) do nothing;
