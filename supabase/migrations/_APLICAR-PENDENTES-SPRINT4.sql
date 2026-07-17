-- ============================================================================
-- _APLICAR-PENDENTES-SPRINT4.sql  —  TUDO NUM ARQUIVO SÓ
-- ----------------------------------------------------------------------------
-- Junta as 4 migrations pendentes da Sprint 4 numa ordem segura pra você colar
-- de UMA VEZ no Supabase e não precisar abrir arquivo por arquivo.
--
-- COMO USAR:
--   Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New query
--   -> cole ESTE arquivo INTEIRO -> Run.
--
-- É IDEMPOTENTE: pode rodar 2x sem quebrar. Se você já aplicou alguma delas
-- antes (ex.: a 0017/0018), rodar de novo não faz mal.
--
-- ORDEM (importante!): 0018 e 0020 CRIAM tabelas novas (qs_message_log,
-- qs_call_logs); a 0017 varre as tabelas qs_* existentes pra pôr a trava de
-- "usuario desativado perde acesso". Por isso a 0017 vem POR ULTIMO — assim ela
-- cobre tambem as tabelas novas. (Aplicar os arquivos soltos na ordem numerica
-- deixaria essas 2 tabelas de fora da trava; este arquivo corrige isso.)
--
-- Depois de aplicar, pode apagar este arquivo — os originais 0017/0018/0020/0021
-- continuam na pasta como historico.
-- ============================================================================




-- ####################################################################
-- >>> 0018_message_log_e_drop_password.sql
-- ####################################################################

-- 0018_message_log_e_drop_password.sql
-- SPRINT 4 — backend/serverless (auditoria docs/SPRINT-2026-07-14.md, FASE 3/5).
--
-- (1) qs_message_log: rastro server-side + rate limit do envio de WhatsApp.
--     A rota /api/chatapp-send agora grava UMA linha por tentativa de envio
--     (ANTES de chamar o ChatApp) e conta as linhas dos últimos 5 minutos para
--     limitar a 30 envios/5 min por usuário (serverless é stateless — o
--     "contador" precisa viver no banco). Também resolve o "chamada direta na
--     rota não deixa rastro": agora todo envio tem quem/pra quem/quando.
--     Enquanto esta migration NÃO for aplicada, a rota avisa no log da Vercel e
--     envia sem limite (degrada com aviso, não quebra o envio em produção).
--
-- (2) DROP da coluna legada qs_users.password: era texto puro dos tempos
--     pré-Supabase-Auth (setup.sql a marcava como "legado"). NADA no app usa
--     (grep em src/ e api/ 2026-07-16: zero referências). Senha de verdade vive
--     no Supabase Auth. Guardar uma coluna chamada "password" em texto é risco
--     LGPD/vazamento à toa.
--     ⚠️ Nota: os bootstraps legados supabase/setup.sql e supabase/seed.sql
--     ainda INSEREM nessa coluna — só afeta instalação DO ZERO (o projeto real
--     já existe). Se um dia recriar do zero, remova "password" desses inserts.
--
-- Não afeta: service_role (rotas /api ignoram RLS). Idempotente: rodar 2x não quebra.
--
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New query
--    → cole este arquivo INTEIRO → Run.

-- ── (1) Log de mensagens enviadas (WhatsApp/ChatApp) ─────────────────────────
create table if not exists qs_message_log (
  id         uuid primary key default gen_random_uuid(),
  -- Quem enviou. NULL = envio servidor-a-servidor (x-internal-secret / n8n),
  -- que conta num "balde" próprio no rate limit. FK com SET NULL: excluir o
  -- usuário não apaga o rastro.
  user_id    uuid references qs_users(id) on delete set null,
  phone      text,                        -- destino, só dígitos (sem conteúdo da mensagem — LGPD)
  chars      integer not null default 0,  -- tamanho do texto enviado
  created_at timestamptz not null default now()
);

-- Índice do rate limit: a consulta é sempre "por remetente, janela recente".
create index if not exists idx_qs_message_log_user_created
  on qs_message_log (user_id, created_at desc);

-- RLS: quem escreve é SÓ a rota serverless (service_role, ignora RLS).
-- Gestor/admin pode LER (auditoria futura na UI); SDR não enxerga o log.
alter table qs_message_log enable row level security;
drop policy if exists message_log_select on qs_message_log;
create policy message_log_select on qs_message_log
  for select to authenticated using (qs_is_manager());

-- ── (2) Coluna legada de senha em texto puro ─────────────────────────────────
alter table qs_users drop column if exists password;

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- 1ª query: deve listar a tabela nova com RLS ligada.
-- 2ª query: NÃO deve retornar linha nenhuma (coluna password extinta).
select relname, relrowsecurity from pg_class where relname = 'qs_message_log';
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'qs_users' and column_name = 'password';


-- ####################################################################
-- >>> 0020_call_logs.sql
-- ####################################################################

-- 0020_call_logs.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- SPRINT 4 — Analytics parte 2 (Onda B3): TELEFONIA REAL LOGADA NO BANCO.
--
-- Até aqui a ligação só deixava rastro "narrativo" em qs_whatsapp_messages
-- (kind='call', texto formatado) — impossível de agregar. Esta tabela grava a
-- ligação de forma ESTRUTURADA (atendida?, duração, hora, provedor) pra alimentar
-- as análises de desempenho (taxa de atendimento por horário, duração média por
-- SDR). O código (src/lib/qs/callLog.ts) insere UMA linha por chamada encerrada,
-- atendida ou não, mesmo sem lead vinculado. Telemetria fire-and-forget: se a
-- tabela não existir ainda, o insert falha em silêncio e a ligação segue normal.
--
-- ⚠️ COMO APLICAR: cole este arquivo INTEIRO no SQL Editor do Supabase
--    (projeto eabfjomrnucymduqnbci) e rode 1x. Idempotente: rodar 2x não quebra.
--    Requer a 0007 (usa o helper qs_is_manager()).
-- ⚠️ As rotas /api (service_role) NÃO são afetadas — service_role ignora RLS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tabela ───────────────────────────────────────────────────────────────────
create table if not exists qs_call_logs (
  id           uuid primary key default gen_random_uuid(),
  -- Quem ligou. FK com SET NULL: desativar/remover o usuário não apaga o rastro.
  owner_id     uuid references qs_users(id) on delete set null,
  -- Lead da ligação (pode ser null: ligação avulsa, fora de um card). SET NULL
  -- pra não travar a exclusão de lead (qs_leads É excluível — deleteQsLead).
  lead_id      uuid references qs_leads(id) on delete set null,
  phone        text,
  answered     boolean not null,
  duration_sec int not null default 0,
  -- Provedor da chamada. Hoje o app registra sem distinguir (os dois webfones
  -- compartilham um único callback no Painel), então costuma vir null; o CHECK
  -- deixa o campo pronto pra quando a origem for diferenciada.
  provider     text check (provider is null or provider in ('wavoip','webrtc')),
  created_at   timestamptz not null default now()
);

-- Índices das análises: "por dono" (duração média por SDR) e "por janela recente"
-- (taxa de atendimento por horário no período).
create index if not exists idx_qs_call_logs_owner on qs_call_logs (owner_id);
create index if not exists idx_qs_call_logs_created on qs_call_logs (created_at desc);

-- ── RLS — espelha qs_tasks (dono faz CRUD do próprio; gestor/admin veem tudo) ──
alter table qs_call_logs enable row level security;

drop policy if exists call_logs_select on qs_call_logs;
create policy call_logs_select on qs_call_logs for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null);

-- INSERT: só pode gravar log em NOME PRÓPRIO (ou owner null do bypass "demo-skip").
-- Impede um SDR forjar ligação no nome de outro (que adulteraria a estatística de
-- duração/atendimento por SDR). O app sempre grava com a sessão atual.
drop policy if exists call_logs_insert on qs_call_logs;
create policy call_logs_insert on qs_call_logs for insert to authenticated
  with check (owner_id = auth.uid() or owner_id is null);

drop policy if exists call_logs_update on qs_call_logs;
create policy call_logs_update on qs_call_logs for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null)
  with check (true);

drop policy if exists call_logs_delete on qs_call_logs;
create policy call_logs_delete on qs_call_logs for delete to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

-- ── Realtime: NÃO publicamos ──────────────────────────────────────────────────
-- qs_call_logs é tabela de LOG/analytics (como qs_message_log 0018 e qs_audit_log
-- 0009) — consumida sob demanda pelos painéis, não por uma fila ao vivo. Só
-- qs_tasks/qs_leads (a fila) entram na publicação supabase_realtime; log fica de
-- fora de propósito.

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- Deve listar a tabela nova com RLS ligada (relrowsecurity = t).
select relname, relrowsecurity from pg_class where relname = 'qs_call_logs';


-- ####################################################################
-- >>> 0021_qs_contacts_rls.sql
-- ####################################################################

-- 0021_qs_contacts_rls.sql
-- Fecha o buraco de isolamento por dono na tabela qs_contacts.
--
-- Contexto: o 0007 (RLS por papéis, "P0 da auditoria") travou por dono todas as
-- tabelas de dado do lead — MENOS qs_contacts, que ficou esquecida com a policy
-- permissiva `app_auth_qs_contacts` do 0002 (`for all using(true)`). Enquanto o
-- CRUD de contatos ficou dormente isso não incomodava; a Sprint 4 (LeadDetailPage)
-- LIGOU a leitura/escrita de contatos (telefone, e-mail, WhatsApp, LinkedIn — PII),
-- então agora qualquer usuário autenticado consegue ler/alterar/apagar os contatos
-- dos leads de QUALQUER colega. Espelha a RLS de qs_notes/qs_lead_custom_values:
-- escopo pelo dono do LEAD (join em qs_leads), gestor/admin veem tudo.
--
-- Requer: 0007 (função qs_is_manager()). Idempotente.

-- RLS já foi habilitada em qs_contacts no 0001; garante mesmo assim.
alter table qs_contacts enable row level security;

-- Remove as policies permissivas herdadas (0001 anon+auth, 0002 auth using true).
drop policy if exists app_all_qs_contacts on qs_contacts;
drop policy if exists app_auth_qs_contacts on qs_contacts;

-- SELECT: gestor/admin tudo; senão só os contatos de leads do próprio dono
-- (ou de leads sem dono, coerente com qs_leads/qs_notes).
drop policy if exists contacts_select on qs_contacts;
create policy contacts_select on qs_contacts for select to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- INSERT: só pode criar contato num lead que você enxerga (mesmo escopo).
drop policy if exists contacts_insert on qs_contacts;
create policy contacts_insert on qs_contacts for insert to authenticated
  with check (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- UPDATE: mesmo escopo no using e no check (não deixa "mover" contato pra lead alheio).
drop policy if exists contacts_update on qs_contacts;
create policy contacts_update on qs_contacts for update to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  )
  with check (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- DELETE: mesmo escopo.
drop policy if exists contacts_delete on qs_contacts;
create policy contacts_delete on qs_contacts for delete to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );


-- ####################################################################
-- >>> 0017_bloqueio_usuario_desativado.sql
-- ####################################################################

-- 0017_bloqueio_usuario_desativado.sql
-- SPRINT 3 — itens A6 e A9 (gestão/sessão de usuários).
--
-- A9 (o grosso): usuário DESATIVADO com sessão viva continuava lendo e
-- gravando tudo — a desativação só barrava o PRÓXIMO login. O front agora
-- re-checa o is_active e desloga sozinho (QsAuthContext), mas isso é só
-- cliente: o token JWT continua válido e falaria com o banco por fora do app.
-- Aqui entra a trava REAL: uma policy RESTRITIVA em todas as tabelas qs_*
-- exige perfil ativo para qualquer acesso autenticado. Restritiva = soma às
-- policies existentes com AND; não afrouxa nada do que a 0007+ já fecha.
--
-- A6 (cinto e suspensório): impede no BANCO a autodesativação — o admin que
-- se desativasse ficava trancado pra fora (só se salvava editando o banco na
-- mão). O front (SettingsPage) e a rota /api/admin-user também bloqueiam.
--
-- Não afeta: service_role (rotas /api e n8n ignoram RLS) e anon (policies
-- são "to authenticated"). Idempotente: rodar 2x não quebra.
--
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New query
--    → cole este arquivo INTEIRO → Run.

-- ── Helper: o usuário logado tem perfil ATIVO? ───────────────────────────────
-- SECURITY DEFINER evita recursão de RLS ao consultar qs_users de dentro
-- de uma policy de qs_users (mesmo padrão do qs_is_manager da 0007).
create or replace function qs_is_active_user()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
    where id = auth.uid() and is_active
  );
$$;

-- ── (1) A9: desativado perde acesso a TODAS as tabelas qs_* na hora ──────────
-- Loop dinâmico: pega qualquer tabela qs_* existente (inclusive as criadas
-- depois da 0007, ex.: qs_settings, qs_sip_lines), sem quebrar se faltar uma.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'qs\_%' escape '\'
  loop
    execute format('drop policy if exists %I on %I', 'ativo_' || t, t);
    execute format(
      'create policy %I on %I as restrictive for all to authenticated using (qs_is_active_user()) with check (qs_is_active_user())',
      'ativo_' || t, t
    );
  end loop;
end $$;

-- ── (2) A6: ninguém se desativa via update direto em qs_users ────────────────
-- Recria a users_write da 0007 com um WITH CHECK a mais: na PRÓPRIA linha,
-- is_active tem de continuar true. (O papel não é travado aqui porque o
-- gestor também escreve nesta tabela e o papel dele não é 'admin' — a trava
-- de rebaixar o próprio papel fica na UI + rota /api/admin-user.)
drop policy if exists users_write on qs_users;
create policy users_write on qs_users for all to authenticated
  using (qs_is_manager())
  with check (qs_is_manager() and (id <> auth.uid() or is_active));

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- Deve listar uma policy "ativo_<tabela>" (RESTRICTIVE) por tabela qs_* e a
-- users_write nova em qs_users.
select tablename, policyname, permissive, cmd
from pg_policies
where schemaname = 'public' and (policyname like 'ativo\_%' escape '\' or policyname = 'users_write')
order by tablename, policyname;
