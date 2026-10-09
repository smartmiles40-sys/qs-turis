-- =============================================================================
-- 0100 — RELACIONAMENTO, FASE 1: acessos por setor + ficha única do cliente
-- =============================================================================
-- Decisão de 09/10/2026: o QS vira UM sistema com áreas separadas por setor.
-- O login tem duas portas (Comercial e Relacionamento); cada pessoa só entra
-- pela porta do setor dela, e o admin entra pelas duas.
--
-- Por que um banco só e não dois sistemas: o cliente é o mesmo. Com dois
-- sistemas, a ficha do cliente teria que ser sincronizada entre eles — a dor
-- que o Bitrix já deu. Aqui o Relacionamento nasce com tabelas próprias
-- (prefixo rel_), sem tocar nas do Comercial (qs_).
--
-- O que esta migration faz:
--   1. papel novo 'relacionamento' + coluna qs_users.setores
--   2. quem é só do Relacionamento NÃO escreve nas tabelas do Comercial
--   3. rel_clientes — a ficha única (CPF e passaporte nunca se repetem)
--   4. família pelo titular (o "ID Pai" do Bitrix)
--   5. duplicados: sugestão, "não é a mesma pessoa" e juntar
--   6. auditoria (LGPD): quem mudou o quê, e quando
-- =============================================================================


-- ── 1. PAPEL E SETORES ──────────────────────────────────────────────────────
alter table qs_users drop constraint if exists qs_users_role_check;
alter table qs_users
  add constraint qs_users_role_check
  check (role in ('admin', 'gestor', 'sdr', 'closer', 'marketing', 'relacionamento'));

alter table qs_users add column if not exists setores text[] not null default '{comercial}';

alter table qs_users drop constraint if exists qs_users_setores_check;
alter table qs_users
  add constraint qs_users_setores_check
  check (setores <@ array['comercial', 'relacionamento']::text[] and cardinality(setores) >= 1);

-- O setor não pode contradizer o papel. Em vez de recusar o cadastro com erro
-- cru, o banco acerta sozinho:
--   - admin entra nas duas áreas, sempre;
--   - 'relacionamento' é SÓ Relacionamento (se ganhasse o Comercial, cairia na
--     distribuição de leads como se fosse SDR — por isso é papel, e não setor).
create or replace function qs_users_acerta_setores()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'admin' then
    new.setores := array['comercial', 'relacionamento'];
  elsif new.role = 'relacionamento' then
    new.setores := array['relacionamento'];
  elsif not ('comercial' = any(new.setores)) then
    -- papel do Comercial sem o setor Comercial não faz sentido
    new.setores := array_append(new.setores, 'comercial');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_users_acerta_setores on qs_users;
create trigger trg_qs_users_acerta_setores
  before insert or update of role, setores on qs_users
  for each row execute function qs_users_acerta_setores();

update qs_users set setores = array['comercial', 'relacionamento'] where role = 'admin';

-- Quem pode trabalhar no Relacionamento.
create or replace function rel_tem_acesso()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid()
       and is_active
       and (role = 'admin' or 'relacionamento' = any(setores))
  );
$$;
grant execute on function rel_tem_acesso() to authenticated;


-- ── 2. RELACIONAMENTO NÃO MEXE NO COMERCIAL ─────────────────────────────────
-- Várias tabelas do Comercial aceitam escrita de qualquer pessoa logada
-- (cadências, reuniões, leads...). O papel Marketing já é barrado por um
-- gatilho em TODAS as tabelas qs_ (0036). Redefinir a função desse gatilho
-- estende a mesma trava ao papel 'relacionamento', sem recriar gatilho nenhum.
create or replace function qs_bloqueia_espectador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  papel text;
begin
  select role into papel from qs_users where id = auth.uid() and is_active;
  if papel = 'marketing' then
    raise exception 'Perfil Marketing é somente leitura: esta ação não é permitida.'
      using errcode = '42501';
  end if;
  if papel = 'relacionamento' then
    raise exception 'Perfil Relacionamento não altera dados do Comercial.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


-- ── 3. FICHA ÚNICA DO CLIENTE ───────────────────────────────────────────────
-- Uma pessoa = uma linha. CPF e passaporte são as chaves fortes (o banco
-- recusa repetição). Telefone e e-mail NÃO são únicos de propósito: numa
-- família é comum o filho usar o celular e o e-mail da mãe. Para esses, o
-- sistema AVISA ("já existe alguém com este telefone") em vez de recusar.
create table if not exists rel_clientes (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null check (length(trim(nome)) >= 2),
  cpf                   text check (cpf ~ '^\d{11}$'),
  passaporte            text check (passaporte ~ '^[A-Z0-9]{5,12}$'),
  passaporte_validade   date,
  nascimento            date,
  telefone              text check (telefone ~ '^\d{10,15}$'),
  email                 text check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Família: aponta pro TITULAR (o "ID Pai" do Bitrix). Um nível só — quem
  -- tem titular não pode ser titular de ninguém (gatilho abaixo).
  titular_id            uuid references rel_clientes(id) on delete set null,
  parentesco            text check (parentesco in ('conjuge', 'filho', 'pai_mae', 'irmao', 'neto', 'amigo', 'outro')),
  bitrix_contato_id     text,
  observacoes           text,
  -- LGPD: quando a pessoa autorizou o uso dos dados (null = não registrado).
  lgpd_consentimento_em timestamptz,
  -- Juntar duplicados não APAGA: a ficha repetida fica apontando pra que ficou.
  mesclado_em_id        uuid references rel_clientes(id),
  criado_por            uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em             timestamptz not null default now(),
  atualizado_por        uuid references qs_users(id) on delete set null,
  atualizado_em         timestamptz not null default now(),
  check (titular_id is null or titular_id <> id),
  check (parentesco is null or titular_id is not null)
);

-- Únicos só entre as fichas VIVAS (a mesclada mantém o CPF pra histórico).
create unique index if not exists rel_clientes_cpf_uq        on rel_clientes (cpf)               where cpf is not null and mesclado_em_id is null;
create unique index if not exists rel_clientes_passaporte_uq on rel_clientes (passaporte)        where passaporte is not null and mesclado_em_id is null;
create unique index if not exists rel_clientes_bitrix_uq     on rel_clientes (bitrix_contato_id) where bitrix_contato_id is not null and mesclado_em_id is null;
create index if not exists rel_clientes_telefone_idx on rel_clientes (telefone) where mesclado_em_id is null;
create index if not exists rel_clientes_email_idx    on rel_clientes (email)    where mesclado_em_id is null;
create index if not exists rel_clientes_nome_idx     on rel_clientes (lower(nome));
create index if not exists rel_clientes_titular_idx  on rel_clientes (titular_id);

-- Normaliza ANTES de gravar: o mesmo CPF digitado com e sem pontos tem que
-- bater no índice único. Se a normalização ficasse só na tela, uma importação
-- ou um n8n gravaria "123.456.789-00" e furaria a ficha única.
create or replace function rel_clientes_normaliza()
returns trigger
language plpgsql
as $$
declare
  fone text;
begin
  new.nome       := regexp_replace(trim(new.nome), '\s+', ' ', 'g');
  new.cpf        := nullif(regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g'), '');
  new.passaporte := nullif(upper(regexp_replace(coalesce(new.passaporte, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.email      := nullif(lower(trim(coalesce(new.email, ''))), '');
  fone := regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g');
  -- Celular/fixo do Brasil sem o 55 → coloca o 55 (mesmo padrão do WhatsApp).
  if length(fone) in (10, 11) then fone := '55' || fone; end if;
  new.telefone := nullif(fone, '');
  if new.titular_id is null then new.parentesco := null; end if;

  if tg_op = 'UPDATE' then
    new.atualizado_em  := now();
    new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rel_clientes_normaliza on rel_clientes;
create trigger trg_rel_clientes_normaliza
  before insert or update on rel_clientes
  for each row execute function rel_clientes_normaliza();

-- Família de UM nível: o titular não pode ter titular, e quem já é titular de
-- alguém não pode virar membro de outra família (os membros ficariam órfãos
-- de um titular que não é titular).
create or replace function rel_clientes_familia_valida()
returns trigger
language plpgsql
as $$
begin
  if new.titular_id is not null then
    if exists (select 1 from rel_clientes where id = new.titular_id and titular_id is not null) then
      raise exception 'Esta pessoa já faz parte de outra família — escolha o titular dessa família.'
        using errcode = '23514';
    end if;
    if exists (select 1 from rel_clientes where titular_id = new.id and mesclado_em_id is null) then
      raise exception 'Esta pessoa é titular de uma família e não pode entrar em outra.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rel_clientes_familia on rel_clientes;
create trigger trg_rel_clientes_familia
  before insert or update of titular_id on rel_clientes
  for each row execute function rel_clientes_familia_valida();


-- ── 4. AUDITORIA (LGPD) ─────────────────────────────────────────────────────
-- Toda mudança na ficha fica registrada: quem, quando, antes e depois. Ninguém
-- escreve aqui direto — só o gatilho.
create table if not exists rel_auditoria (
  id          bigserial primary key,
  tabela      text not null,
  registro_id uuid not null,
  acao        text not null,          -- INSERT | UPDATE | DELETE | JUNTAR
  antes       jsonb,
  depois      jsonb,
  por         uuid default auth.uid(),
  em          timestamptz not null default now()
);
create index if not exists rel_auditoria_registro_idx on rel_auditoria (registro_id, em desc);

create or replace function rel_audita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into rel_auditoria (tabela, registro_id, acao, antes, depois)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end;
$$;

drop trigger if exists trg_rel_clientes_audita on rel_clientes;
create trigger trg_rel_clientes_audita
  after insert or update or delete on rel_clientes
  for each row execute function rel_audita();


-- ── 5. DUPLICADOS ───────────────────────────────────────────────────────────
-- "Não é a mesma pessoa": o par some da lista de sugestões pra sempre.
create table if not exists rel_nao_duplicados (
  a           uuid not null references rel_clientes(id) on delete cascade,
  b           uuid not null references rel_clientes(id) on delete cascade,
  marcado_por uuid default auth.uid(),
  marcado_em  timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);

-- Sugestões de duplicado. Família fica de fora: mãe e filho com o mesmo
-- telefone NÃO são a mesma pessoa.
create or replace view rel_duplicados_sugeridos
with (security_invoker = true) as
with vivos as (
  select * from rel_clientes where mesclado_em_id is null
)
select a.id as a_id, a.nome as a_nome, b.id as b_id, b.nome as b_nome,
       array_remove(array[
         case when a.telefone = b.telefone then 'mesmo telefone' end,
         case when a.email = b.email then 'mesmo e-mail' end,
         case when lower(a.nome) = lower(b.nome) then 'mesmo nome' end,
         case when a.nascimento = b.nascimento and split_part(lower(a.nome), ' ', 1) = split_part(lower(b.nome), ' ', 1)
              then 'mesmo primeiro nome e nascimento' end
       ], null) as motivos
  from vivos a
  join vivos b on a.id < b.id
 where (a.telefone = b.telefone
        or a.email = b.email
        or lower(a.nome) = lower(b.nome)
        or (a.nascimento = b.nascimento and split_part(lower(a.nome), ' ', 1) = split_part(lower(b.nome), ' ', 1)))
   -- mesma família não é duplicado
   and not (a.titular_id = b.id or b.titular_id = a.id or (a.titular_id is not null and a.titular_id = b.titular_id))
   -- CPFs diferentes = pessoas diferentes, com certeza
   and not (a.cpf is not null and b.cpf is not null and a.cpf <> b.cpf)
   and not exists (select 1 from rel_nao_duplicados n where n.a = a.id and n.b = b.id);

-- Busca de parecidos ANTES de cadastrar (a tela chama enquanto a pessoa digita).
-- Devolve quem bate com algum dos dados e POR QUÊ.
create or replace function rel_buscar_parecidos(
  p_cpf text default null,
  p_passaporte text default null,
  p_telefone text default null,
  p_email text default null,
  p_nome text default null,
  p_ignorar uuid default null
)
returns table (id uuid, nome text, motivo text, bloqueia boolean)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  cpf_n  text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  pass_n text := nullif(upper(regexp_replace(coalesce(p_passaporte, ''), '[^A-Za-z0-9]', '', 'g')), '');
  fone_n text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  mail_n text := nullif(lower(trim(coalesce(p_email, ''))), '');
  nome_n text := nullif(lower(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g')), '');
begin
  if length(fone_n) in (10, 11) then fone_n := '55' || fone_n; end if;
  return query
    select c.id, c.nome,
           case
             when cpf_n is not null and c.cpf = cpf_n then 'mesmo CPF'
             when pass_n is not null and c.passaporte = pass_n then 'mesmo passaporte'
             when fone_n is not null and c.telefone = fone_n then 'mesmo telefone'
             when mail_n is not null and c.email = mail_n then 'mesmo e-mail'
             else 'mesmo nome'
           end,
           (cpf_n is not null and c.cpf = cpf_n) or (pass_n is not null and c.passaporte = pass_n)
      from rel_clientes c
     where c.mesclado_em_id is null
       and (p_ignorar is null or c.id <> p_ignorar)
       and ((cpf_n is not null and c.cpf = cpf_n)
         or (pass_n is not null and c.passaporte = pass_n)
         or (fone_n is not null and c.telefone = fone_n)
         or (mail_n is not null and c.email = mail_n)
         or (nome_n is not null and length(nome_n) >= 5 and lower(c.nome) = nome_n))
     limit 10;
end;
$$;
grant execute on function rel_buscar_parecidos(text, text, text, text, text, uuid) to authenticated;

-- JUNTAR: a ficha `p_manter` fica; a `p_remover` vira um apontamento pra ela.
-- O que faltava na que fica é completado com a que sai (nunca sobrescreve).
-- A família da que sai passa pra que fica.
--
-- ⚠️ Fases futuras (viagens, documentos, conversas...) que apontarem pra
-- rel_clientes PRECISAM ser repontadas aqui também — senão a viagem fica presa
-- na ficha mesclada.
create or replace function rel_juntar_clientes(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m rel_clientes;
  r rel_clientes;
begin
  if not rel_tem_acesso() then
    raise exception 'Sem acesso ao Relacionamento.' using errcode = '42501';
  end if;
  if p_manter = p_remover then
    raise exception 'Escolha duas fichas diferentes.';
  end if;

  select * into m from rel_clientes where id = p_manter for update;
  select * into r from rel_clientes where id = p_remover for update;
  if m.id is null or r.id is null then raise exception 'Ficha não encontrada.'; end if;
  if m.mesclado_em_id is not null or r.mesclado_em_id is not null then
    raise exception 'Uma das fichas já foi juntada a outra.';
  end if;
  if m.cpf is not null and r.cpf is not null and m.cpf <> r.cpf then
    raise exception 'As fichas têm CPFs diferentes — não são a mesma pessoa.';
  end if;

  -- 1) tira a ficha que sai do caminho (libera CPF/passaporte no índice único)
  update rel_clientes set mesclado_em_id = p_manter, titular_id = null where id = p_remover;

  -- 2) a família da que sai passa pra que fica
  update rel_clientes set titular_id = p_manter
   where titular_id = p_remover and id <> p_manter and mesclado_em_id is null;
  if m.titular_id = p_remover then
    update rel_clientes set titular_id = null where id = p_manter;
    m.titular_id := null;
  end if;

  -- 3) completa o que falta (nunca sobrescreve o que a ficha que fica já tem)
  update rel_clientes set
    cpf                   = coalesce(m.cpf, r.cpf),
    passaporte            = coalesce(m.passaporte, r.passaporte),
    passaporte_validade   = coalesce(m.passaporte_validade, r.passaporte_validade),
    nascimento            = coalesce(m.nascimento, r.nascimento),
    telefone              = coalesce(m.telefone, r.telefone),
    email                 = coalesce(m.email, r.email),
    bitrix_contato_id     = coalesce(m.bitrix_contato_id, r.bitrix_contato_id),
    lgpd_consentimento_em = coalesce(m.lgpd_consentimento_em, r.lgpd_consentimento_em),
    titular_id            = coalesce(m.titular_id, case when r.titular_id <> p_manter then r.titular_id end),
    parentesco            = case when m.titular_id is not null then m.parentesco
                                 when r.titular_id is not null and r.titular_id <> p_manter then r.parentesco end,
    observacoes           = nullif(concat_ws(E'\n\n', m.observacoes, r.observacoes), '')
   where id = p_manter;

  insert into rel_auditoria (tabela, registro_id, acao, antes, depois)
  values ('rel_clientes', p_manter, 'JUNTAR', to_jsonb(r), jsonb_build_object('juntado_em', p_manter));
end;
$$;
grant execute on function rel_juntar_clientes(uuid, uuid) to authenticated;


-- ── 6. RLS ──────────────────────────────────────────────────────────────────
alter table rel_clientes       enable row level security;
alter table rel_auditoria      enable row level security;
alter table rel_nao_duplicados enable row level security;

drop policy if exists rel_clientes_ler      on rel_clientes;
drop policy if exists rel_clientes_criar    on rel_clientes;
drop policy if exists rel_clientes_editar   on rel_clientes;
drop policy if exists rel_clientes_apagar   on rel_clientes;
create policy rel_clientes_ler    on rel_clientes for select to authenticated using (rel_tem_acesso());
create policy rel_clientes_criar  on rel_clientes for insert to authenticated with check (rel_tem_acesso());
create policy rel_clientes_editar on rel_clientes for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso());
-- Apagar de verdade só o admin (pedido de exclusão da LGPD). No dia a dia,
-- ficha repetida se JUNTA, não se apaga.
create policy rel_clientes_apagar on rel_clientes for delete to authenticated
  using (exists (select 1 from qs_users where id = auth.uid() and role = 'admin' and is_active));

drop policy if exists rel_auditoria_ler on rel_auditoria;
create policy rel_auditoria_ler on rel_auditoria for select to authenticated using (rel_tem_acesso());

drop policy if exists rel_nao_dup_ler   on rel_nao_duplicados;
drop policy if exists rel_nao_dup_criar on rel_nao_duplicados;
create policy rel_nao_dup_ler   on rel_nao_duplicados for select to authenticated using (rel_tem_acesso());
create policy rel_nao_dup_criar on rel_nao_duplicados for insert to authenticated with check (rel_tem_acesso());

grant select, insert, update, delete on rel_clientes to authenticated;
grant select on rel_auditoria to authenticated;
grant select, insert on rel_nao_duplicados to authenticated;
grant select on rel_duplicados_sugeridos to authenticated;

-- ── CONFERÊNCIA ────────────────────────────────────────────────────────────
--   select id, name, role, setores from qs_users order by role;   -- admin com as 2
--   insert into rel_clientes (nome, cpf) values ('Teste', '123.456.789-09');
--   select cpf from rel_clientes where nome = 'Teste';            -- 12345678909
