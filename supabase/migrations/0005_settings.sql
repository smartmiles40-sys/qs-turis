-- 0005_settings.sql
-- Tabela genérica de configurações da empresa (chave→valor JSON).
-- Usada pelo Horário de Trabalho (métricas de tempo só dentro do expediente).

create table if not exists qs_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table qs_settings enable row level security;

-- Leitura pra qualquer usuário autenticado; escrita idem (ajuste se quiser restringir a admin).
drop policy if exists "qs_settings read" on qs_settings;
create policy "qs_settings read" on qs_settings for select using (auth.role() = 'authenticated');

drop policy if exists "qs_settings write" on qs_settings;
create policy "qs_settings write" on qs_settings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
