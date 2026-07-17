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

drop policy if exists call_logs_insert on qs_call_logs;
create policy call_logs_insert on qs_call_logs for insert to authenticated
  with check (true);

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
