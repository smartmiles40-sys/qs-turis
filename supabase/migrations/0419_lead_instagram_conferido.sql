-- 0419 (25/11/2026): marca quando o QS já foi ao Bitrix buscar o @ do lead
-- (api/lead-formulario.js ?acao=instagram, Cron a cada 10 min). Conferido sem
-- @ não é perguntado de novo. Pra reconferir todo mundo: update ... set null.
alter table public.qs_leads add column if not exists instagram_conferido_em timestamptz;
create index if not exists qs_leads_instagram_pendente_idx on public.qs_leads (created_at desc)
  where instagram is null and instagram_conferido_em is null and bitrix_id is not null;
