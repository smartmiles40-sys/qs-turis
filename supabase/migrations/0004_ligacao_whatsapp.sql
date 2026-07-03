-- 0004_ligacao_whatsapp.sql
-- Adiciona o canal 'ligacao_whatsapp' (Ligação WhatsApp) — separa a ligação
-- normal da ligação feita pelo WhatsApp. Roda no SQL Editor do Supabase.

-- 1) qs_tasks.channel_type
alter table qs_tasks drop constraint if exists qs_tasks_channel_type_check;
alter table qs_tasks add constraint qs_tasks_channel_type_check
  check (channel_type in ('pesquisa','email','ligacao','ligacao_whatsapp','whatsapp','linkedin','instagram','tiktok','youtube'));

-- 2) qs_cadence_activities.channel_type
alter table qs_cadence_activities drop constraint if exists qs_cadence_activities_channel_type_check;
alter table qs_cadence_activities add constraint qs_cadence_activities_channel_type_check
  check (channel_type in ('pesquisa','email','ligacao','ligacao_whatsapp','whatsapp','linkedin','instagram','tiktok','youtube'));

-- 3) qs_channel_config.type
alter table qs_channel_config drop constraint if exists qs_channel_config_type_check;
alter table qs_channel_config add constraint qs_channel_config_type_check
  check (type in ('pesquisa','email','ligacao','ligacao_whatsapp','whatsapp','linkedin','instagram','tiktok','youtube'));

-- 4) registra o canal na config (se a tabela estiver em uso)
insert into qs_channel_config (type, enabled, label)
  values ('ligacao_whatsapp', true, 'Ligação WhatsApp')
  on conflict (type) do nothing;
