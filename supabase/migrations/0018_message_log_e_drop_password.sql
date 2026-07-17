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
