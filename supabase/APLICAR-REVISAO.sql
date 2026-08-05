-- =============================================================================
-- APLICAR-REVISAO.sql — cole no SQL Editor do Supabase, de uma vez só
-- =============================================================================
-- As três migrations da revisão de 04/08. Roda como UMA transação: se um passo
-- falhar, nada é aplicado.
--
-- NENHUMA delas apaga dado. A 0037 REESCREVE o campo telefone de quem está com
-- dois números grudados (e só desses) — é o conserto que faz a mensagem de
-- WhatsApp voltar a encontrar o lead.
--
-- Procure estes NOTICE no fim:
--   [0036] leitura liberada para marketing em N tabelas
--   [0036] escrita bloqueada para marketing em N tabelas
--   [0037] telefones desgrudados: N        → esperado ~57
--
-- Gerado a partir de supabase/migrations/ — edite lá, não aqui.
-- =============================================================================

begin;


-- ###########################################################################
-- PASSO 1/3 — Papel Marketing (vê tudo, não executa nada)
-- fonte: supabase/migrations/0036_papel_marketing.sql
-- ###########################################################################

-- =============================================================================
-- 0036 — Papel "marketing": vê tudo, não executa nada
-- =============================================================================
-- Espectador. Marketing precisa enxergar o funil inteiro pra medir campanha, mas
-- não pode concluir atividade, mexer em lead, agendar nem apagar coisa alguma.
--
-- POR QUE ISTO É UMA MIGRATION, e não só um `if` na tela: esconder o botão não
-- impede nada. Todo usuário logado fala com o PostgREST com o próprio token —
-- basta o DevTools pra mandar um PATCH. Se a regra não estiver no banco, ela não
-- existe. A tela some com o botão por educação; o banco é quem recusa.
--
-- DUAS PEÇAS, de propósito separadas:
--   1. LER  — uma policy de SELECT a mais por tabela. Policies permissivas são
--             somadas (OR), então isto libera a leitura sem tocar em NENHUMA
--             policy existente: zero risco de estragar o que já funciona.
--   2. ESCREVER — um gatilho que recusa INSERT/UPDATE/DELETE. Um só, em todas as
--             tabelas. Não depende de eu ter lembrado de ajustar 81 policies, e
--             continua valendo pra policy nova que alguém criar amanhã.
--
-- Idempotente.
-- =============================================================================

-- ── (1) O papel passa a existir ─────────────────────────────────────────────
do $$
declare c text;
begin
  select con.conname into c
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
   where rel.relname = 'qs_users'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%role%'
     and pg_get_constraintdef(con.oid) ilike '%gestor%';
  if c is not null then
    execute format('alter table qs_users drop constraint %I', c);
  end if;
end $$;

alter table qs_users
  add constraint qs_users_role_check
  check (role in ('admin', 'gestor', 'sdr', 'closer', 'marketing'));

-- ── (2) Quem é espectador ───────────────────────────────────────────────────
create or replace function qs_is_espectador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and role = 'marketing' and is_active
  );
$$;

grant execute on function qs_is_espectador() to authenticated;

-- ── (3) LER: uma policy de SELECT a mais em cada tabela qs_* ────────────────
-- Permissivas se somam. Não mexo em nada do que existe.
do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and c.relname like 'qs\_%'
       and c.relrowsecurity           -- só onde RLS está ligada
     order by c.relname
  loop
    execute format(
      'drop policy if exists %I on %I',
      t || '_select_espectador', t
    );
    execute format(
      'create policy %I on %I for select to authenticated using (qs_is_espectador())',
      t || '_select_espectador', t
    );
    n := n + 1;
  end loop;
  raise notice '[0036] leitura liberada para marketing em % tabelas', n;
end $$;

-- ── (4) ESCREVER: o gatilho que recusa ──────────────────────────────────────
-- Mensagem em português e código 42501 (insufficient_privilege) — o front mostra
-- o texto direto pro usuário em vez de um erro de Postgres cru.
create or replace function qs_bloqueia_espectador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if qs_is_espectador() then
    raise exception 'Perfil Marketing é somente leitura: esta ação não é permitida.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and c.relname like 'qs\_%'
     order by c.relname
  loop
    execute format('drop trigger if exists trg_%s_espectador on %I', t, t);
    execute format(
      'create trigger trg_%s_espectador before insert or update or delete on %I
       for each row execute function qs_bloqueia_espectador()', t, t
    );
    n := n + 1;
  end loop;
  raise notice '[0036] escrita bloqueada para marketing em % tabelas', n;
end $$;

-- ── CONFERÊNCIA ────────────────────────────────────────────────────────────
-- Depois de criar um usuário de marketing, logue com ele e tente:
--   select count(*) from qs_leads;      -- deve VER tudo
--   update qs_leads set full_name = 'x' where id = (select id from qs_leads limit 1);
--   -- deve falhar com "Perfil Marketing é somente leitura"


-- ###########################################################################
-- PASSO 2/3 — Desgruda telefones do Bitrix — conserta WhatsApp que sumia
-- fonte: supabase/migrations/0037_telefone_grudado.sql
-- ###########################################################################

-- =============================================================================
-- 0037 — Desgruda os telefones que vieram do Bitrix com dois números num campo
-- =============================================================================
-- O Bitrix manda telefone como LISTA. O normalizador antigo do QS fazia
-- `replace(/\D/g,'')` na string inteira e GRUDAVA os números:
--
--     " 5519993152056,  551993152056"  →  55199931520565 51993152056
--     "5547999689893554799689893"      (dois números, 25 dígitos)
--
-- Consequência silenciosa e cara: a chave do telefone dava null, o webhook do
-- WhatsApp não achava o lead e a mensagem era DESCARTADA. Medido em produção:
-- 57 leads assim — todo WhatsApp deles sumia sem erro nenhum em lugar nenhum.
--
-- O código já foi corrigido nos dois lados (leitura e gravação). Esta migration
-- arruma o que já está gravado, pra exportação, Bitrix e telefone exibido
-- pararem de carregar o monstro.
--
-- CONSERVADORA: só mexe em quem NÃO está num formato válido. Telefone já limpo
-- não é tocado. Idempotente.
-- =============================================================================

do $$
declare
  n int;
begin
  -- `\d{10,13}` é guloso: pega o PRIMEIRO número plausível e para. Em
  -- "5547999689893554799689893" isso devolve os 13 primeiros — o número certo.
  update qs_leads
     set phone = (regexp_match(phone, '\d{10,13}'))[1],
         updated_at = now()
   where phone is not null
     and phone !~ '^\d{10,15}$'      -- já limpo? não mexe
     and phone ~ '\d{10}';           -- tem pelo menos um número plausível dentro

  get diagnostics n = row_count;
  raise notice '[0037] telefones desgrudados: %', n;
end $$;

-- O que sobrou fora do padrão (número estrangeiro, dado incompleto). Não é erro:
-- o casamento por chave internacional cobre esses casos desde o conserto do
-- código. Fica a consulta pra conferência:
--
-- select id, full_name, phone from qs_leads
--  where phone is not null and phone !~ '^\d{10,15}$';


-- ###########################################################################
-- PASSO 3/3 — Registro das mensagens de WhatsApp descartadas
-- fonte: supabase/migrations/0038_wa_descartadas.sql
-- ###########################################################################

-- =============================================================================
-- 0038 — Registro das mensagens de WhatsApp que o QS NÃO conseguiu vincular
-- =============================================================================
-- O webhook do Chatwoot responde 200 e segue a vida quando não consegue tratar
-- a mensagem: telefone ausente, caixa que não é WhatsApp, ou — o caso que mais
-- acontece — nenhum lead com aquele número. É proposital (webhook que devolve
-- erro entra em retentativa eterna e entope a fila do Chatwoot), mas o efeito
-- colateral é grave: a mensagem some sem deixar rastro em lugar nenhum.
--
-- Foi assim que "mensagens não estão chegando" ficou invisível por semanas: não
-- havia onde olhar. Agora há.
--
-- Dois usos, e o segundo é o mais interessante:
--   1. diagnóstico — "sumiu mensagem?" vira uma consulta, não um palpite;
--   2. COMERCIAL — a lista de quem está falando com a agência e NÃO está no CRM.
--      Cada linha com motivo 'sem-lead-correspondente' é um contato real que
--      chegou pelo WhatsApp e ninguém cadastrou.
--
-- LGPD: guarda telefone e motivo. NÃO guarda o conteúdo da mensagem.
-- Idempotente.
-- =============================================================================

create table if not exists qs_wa_descartadas (
  id          bigint generated always as identity primary key,
  motivo      text not null,          -- sem-lead-correspondente | sem-telefone | inbox-fora-do-whatsapp | erro
  phone       text,                   -- só dígitos, como veio
  inbox_id    bigint,
  cw_message_id bigint,
  detalhe     text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_qs_wa_descartadas_data on qs_wa_descartadas (created_at desc);
create index if not exists idx_qs_wa_descartadas_motivo on qs_wa_descartadas (motivo, created_at desc);

-- Mesma mensagem repetida pelo Chatwoot não vira duas linhas.
create unique index if not exists uq_qs_wa_descartadas_cw
  on qs_wa_descartadas (cw_message_id) where cw_message_id is not null;

alter table qs_wa_descartadas enable row level security;

-- Só a gestão lê: é diagnóstico e prospecção, não fila de trabalho do SDR.
do $$
begin
  create policy qs_wa_descartadas_leitura on qs_wa_descartadas
    for select using (qs_is_manager());
exception
  when duplicate_object then null;
end $$;

comment on table qs_wa_descartadas is
  'Mensagens de WhatsApp que chegaram no webhook e não puderam ser vinculadas a um lead. Sem conteúdo (LGPD).';

-- ── CONSULTAS ÚTEIS ────────────────────────────────────────────────────────
-- Sumiu mensagem hoje? Por quê?
--
--   select motivo, count(*) from qs_wa_descartadas
--    where created_at > now() - interval '1 day' group by 1 order by 2 desc;
--
-- Quem falou com a gente e não está no CRM (oportunidade de cadastro):
--
--   select phone, count(*) as mensagens, max(created_at) as ultima
--     from qs_wa_descartadas
--    where motivo = 'sem-lead-correspondente'
--      and created_at > now() - interval '30 days'
--    group by phone order by ultima desc;

commit;
