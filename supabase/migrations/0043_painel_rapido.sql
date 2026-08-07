-- =============================================================================
-- 0043 — O PAINEL PARA DE BAIXAR 21 MIL LINHAS PARA MOSTRAR DOIS SELOS
-- -----------------------------------------------------------------------------
-- MEDIDO em 07/08, abrindo o Painel como admin:
--
--   fetchContactedLeadIds .... 12 idas ao banco, 61 s, 11.238 linhas
--   fetchNoteCountsByLead .... 11 idas ao banco, 30 s, 10.151 linhas
--
-- As duas alimentam apenas o contador "📝 N obs." e o selo "🔴 SEM CONTATO" do
-- card. Para isso baixavam a tabela inteira e agregavam no NAVEGADOR, paginando
-- de mil em mil — e cada página usa OFFSET, que o Postgres percorre desde o
-- começo. Por isso a página 12 custa mais que a 1.
--
-- Agregar é trabalho de banco. Estas duas visões devolvem ~800 linhas numa ida
-- só, e o resultado é idêntico.
--
-- security_invoker = true é ESSENCIAL: sem isso a visão rodaria com os poderes
-- de quem a criou e um SDR enxergaria os leads dos outros. Com ele, a RLS de
-- qs_notes/qs_tasks/qs_leads continua valendo exatamente como hoje.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Só cria visões e índices — não altera nenhum dado.
-- =============================================================================

-- ── (1) Quantas observações cada lead tem ───────────────────────────────────
-- owner_id vem junto para o Painel poder filtrar por SDR sem uma segunda volta.
create or replace view public.qs_lead_note_counts
with (security_invoker = true) as
  select n.lead_id,
         l.owner_id,
         count(*)::int as total
    from public.qs_notes n
    join public.qs_leads l on l.id = n.lead_id
   where n.lead_id is not null
   group by n.lead_id, l.owner_id;

-- ── (2) Quais leads já tiveram alguma atividade concluída ───────────────────
-- É o que decide o selo "SEM CONTATO". Distinto no banco: 11.238 linhas viram
-- ~800.
create or replace view public.qs_leads_contatados
with (security_invoker = true) as
  select distinct t.lead_id, t.owner_id
    from public.qs_tasks t
   where t.status = 'concluida'
     and t.lead_id is not null;

grant select on public.qs_lead_note_counts to authenticated;
grant select on public.qs_leads_contatados to authenticated;

-- ── (3) Índices que sustentam as duas ───────────────────────────────────────
-- Sem eles a agregação vira varredura completa das tabelas.
create index if not exists idx_qs_notes_lead on public.qs_notes(lead_id);
create index if not exists idx_qs_tasks_concluida_lead
  on public.qs_tasks(lead_id) where status = 'concluida';

-- A fila do Painel também: ela filtra por status e ordena por scheduled_at.
create index if not exists idx_qs_tasks_fila
  on public.qs_tasks(status, scheduled_at) where status in ('pendente','atrasada');

-- ── Como conferir ───────────────────────────────────────────────────────────
-- select count(*) from public.qs_lead_note_counts;   -- ~800, não 10.151
-- select count(*) from public.qs_leads_contatados;   -- ~800, não 11.238
