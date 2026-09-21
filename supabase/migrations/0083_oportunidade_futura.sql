-- 0083_oportunidade_futura.sql
-- -----------------------------------------------------------------------------
-- OPORTUNIDADE FUTURA (Bruno, 21/09/2026).
--
-- O closer conversa, o cliente quer — mas não agora ("só consigo em março",
-- "esperando as férias sair"). Até hoje isso ia pra perdido ou ficava parado
-- num card que ninguém revisita. Agora o closer registra a DATA e QUEM retoma:
--
--   hoje            → card vai pra coluna "Oportunidade futura" (funil Comercial 1)
--   no dia marcado  → volta pro SDR (dono de novo, card em Pré-Vendas › Follow-up 1)
--                     ou pro closer (card em Comercial 1 › Em Negociação),
--                     com uma atividade na fila de quem retoma.
--
-- Quem faz a volta é o servidor (/api/oportunidade-futura): cron da Vercel de
-- hora em hora + "carona" quando alguém abre a fila. Agendador que morre calado
-- já custou caro aqui (qs-vigia-e-envio), por isso são dois gatilhos.
-- -----------------------------------------------------------------------------

create table if not exists public.qs_oportunidades_futuras (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.qs_leads(id) on delete cascade,
  meeting_id      uuid references public.qs_meetings(id) on delete set null,
  criado_por      uuid references public.qs_users(id) on delete set null,
  -- o dia em que o lead volta (data de Brasília)
  retomar_em      date not null,
  -- quem retoma: o SDR (rechamar) ou o próprio closer (retomar a negociação)
  quem            text not null,
  responsavel_id  uuid not null references public.qs_users(id) on delete restrict,
  motivo          text not null,
  -- aguardando → devolvendo (trava do processamento) → devolvida | cancelada
  status          text not null default 'aguardando',
  devolvida_em    timestamptz,
  task_id         uuid references public.qs_tasks(id) on delete set null,
  -- o que aconteceu no Bitrix na ida e na volta (texto curto, pra auditoria)
  bitrix_ida      text,
  bitrix_volta    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint qs_of_quem_check   check (quem in ('sdr', 'closer')),
  constraint qs_of_status_check check (status in ('aguardando', 'devolvendo', 'devolvida', 'cancelada')),
  constraint qs_of_motivo_check check (length(btrim(motivo)) >= 10)
);

-- Uma oportunidade em aberto por lead. Registrar outra substitui a anterior
-- (o servidor cancela a velha antes) — duas datas pro mesmo cliente seriam
-- duas pessoas ligando pra ele.
create unique index if not exists uq_qs_of_aberta_por_lead
  on public.qs_oportunidades_futuras (lead_id)
  where status in ('aguardando', 'devolvendo');

create index if not exists idx_qs_of_vencendo
  on public.qs_oportunidades_futuras (retomar_em)
  where status = 'aguardando';

alter table public.qs_oportunidades_futuras enable row level security;

-- Quem vê: gestão, closer, quem registrou, quem vai retomar e o dono do lead.
drop policy if exists qs_of_select on public.qs_oportunidades_futuras;
create policy qs_of_select on public.qs_oportunidades_futuras
  for select to authenticated
  using (
    (select qs_is_manager()) or (select qs_is_closer())
    or criado_por = (select auth.uid())
    or responsavel_id = (select auth.uid())
    or exists (select 1 from qs_leads l where l.id = lead_id and l.owner_id = (select auth.uid()))
  );

-- Escrita só pelo servidor: registrar mexe em Bitrix, dono e fila juntos, e
-- isso não pode ficar pela metade porque o navegador fechou.
revoke insert, update, delete on public.qs_oportunidades_futuras from anon, authenticated;
