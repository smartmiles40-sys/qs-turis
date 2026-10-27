-- 0209 — Discador (Bruno, 27/10/2026) — SÓ ESCRITA, NÃO APLICADA.
--
-- O discador liga pra N leads ao mesmo tempo pelo ramal do SDR (webfone
-- WebRTC/VoxFree). Cada número discado vira UMA linha aqui: de que sessão e
-- lote veio, qual lead/tarefa, o que aconteceu (resultado + código SIP) e os
-- horários. Serve pra:
--   • não discar o mesmo lead de novo no mesmo dia pelo discador;
--   • medir taxa de abandono (atendeu e foi derrubado) e o limite da central;
--   • auditoria ("liguei pra ele às 10h12, deu 486").
--
-- Quem lê: o próprio SDR (as dele) e gestor/admin (todas). Quem grava: o SDR,
-- só linhas dele. Ninguém altera nem apaga pela API (log é log).
--
-- Config (qs_settings, sem tabela nova — a 0011 já restringe escrita a gestor):
--   discador_ativo  → true/false. Ausente = DESLIGADO (o botão nem aparece).
--   discador_config → JSON, tudo opcional (o código limpa e põe na faixa):
--     { "lote": 5,            -- chamadas por lote no início (1..loteMax)
--       "loteMax": 10,        -- teto (1..10; 10 é o teto duro do código)
--       "toqueSeg": 20,       -- segundos tocando antes de desistir (8..45)
--       "abandonoMax": 0.03,  -- taxa de abandono tolerada (3%)
--       "intervaloMs": 1500,  -- respiro entre lotes
--       "recusaRapidaMs": 1200 } -- recusa sem tocar abaixo disso = suspeita de limite de canais
--
-- Pra ligar depois de aplicar (e de a VoxFree responder sobre canais):
--   insert into qs_settings (key, value) values ('discador_config', '{"lote":3}'::jsonb)
--     on conflict (key) do update set value = excluded.value, updated_at = now();
--   insert into qs_settings (key, value) values ('discador_ativo', 'true'::jsonb)
--     on conflict (key) do update set value = excluded.value, updated_at = now();
-- (ou pela tela Configurações → Discador).

create table if not exists qs_discador_tentativas (
  id           uuid primary key default gen_random_uuid(),
  sessao_id    uuid not null,
  lote         int  not null check (lote >= 1),
  owner_id     uuid not null default auth.uid() references qs_users(id) on delete cascade,
  lead_id      uuid references qs_leads(id) on delete set null,
  tarefa_id    uuid references qs_tasks(id) on delete set null,
  telefone     text not null,
  -- mesmos nomes do motor (src/lib/discador/motor.ts → StatusPerna)
  resultado    text not null check (resultado in (
                 'discando','tocando','vencedora','derrubada','nao_atendeu','ocupado',
                 'invalido','recusado_canal','cancelada','erro')),
  sip_code     int,
  iniciou_em   timestamptz not null default now(),
  tocou_em     timestamptz,
  atendeu_em   timestamptz,
  terminou_em  timestamptz,
  created_at   timestamptz not null default now()
);

-- "Já discei este lead hoje?" e o histórico do SDR.
create index if not exists qs_discador_tentativas_owner_dia
  on qs_discador_tentativas (owner_id, iniciou_em desc);
create index if not exists qs_discador_tentativas_lead
  on qs_discador_tentativas (lead_id, iniciou_em desc);
create index if not exists qs_discador_tentativas_sessao
  on qs_discador_tentativas (sessao_id, lote);

alter table qs_discador_tentativas enable row level security;

drop policy if exists qs_discador_tentativas_ler on qs_discador_tentativas;
create policy qs_discador_tentativas_ler on qs_discador_tentativas
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select qs_is_manager()));

drop policy if exists qs_discador_tentativas_criar on qs_discador_tentativas;
create policy qs_discador_tentativas_criar on qs_discador_tentativas
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Sem policy de update/delete: log não se edita pela API.

revoke all on qs_discador_tentativas from anon, public;
grant select, insert on qs_discador_tentativas to authenticated;

-- Conferência depois de aplicar:
--   select policyname, cmd from pg_policies where tablename = 'qs_discador_tentativas';
--   select resultado, count(*) from qs_discador_tentativas
--    where iniciou_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
--    group by 1 order by 2 desc;
