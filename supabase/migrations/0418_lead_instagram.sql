-- 0418 (25/11/2026): @ do Instagram do lead.
-- Guardado SEM "@" e sem URL (só o usuário, minúsculo) — o front e o
-- /api/lead-inbound normalizam antes de gravar. A tarefa de Instagram da
-- cadência abre instagram.com/<usuario> quando está preenchido.
alter table public.qs_leads add column if not exists instagram text;
comment on column public.qs_leads.instagram is 'Usuário do Instagram do lead, sem @ (ex.: maria.souza)';
