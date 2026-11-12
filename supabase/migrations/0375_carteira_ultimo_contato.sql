-- 0375_carteira_ultimo_contato.sql
-- -----------------------------------------------------------------------------
-- O "TEMPO SEM CONTATO" DA CARTEIRA (12/11/2026).
--
-- A Carteira ganhou filtros pra o SDR escolher QUAIS leads iniciar (Lead Score,
-- tempo sem contato e cadência). Até aqui o "parado há X dias" saía de
-- qs_leads.updated_at — que muda com qualquer edição ou sync do Bitrix, então
-- um lead esquecido há meses aparecia "parado há 0 dias" depois de um sync.
--
-- Contato de verdade = a última ATIVIDADE CONCLUÍDA do lead. São 63 mil tarefas
-- concluídas em 12/11 — baixar isso no navegador não dá. A view agrega no banco
-- e devolve uma linha por lead (~5,8 mil).
--
-- security_invoker: a view respeita a RLS de qs_tasks de quem consulta — o SDR
-- só enxerga o último contato dos leads que ele já enxerga.
-- -----------------------------------------------------------------------------

create or replace view public.qs_lead_ultimo_contato
with (security_invoker = true) as
select
  t.lead_id,
  max(t.completed_at) as ultimo_contato
from public.qs_tasks t
where t.status = 'concluida'
  and t.completed_at is not null
  and t.lead_id is not null
group by t.lead_id;

comment on view public.qs_lead_ultimo_contato is
  'Última atividade concluída por lead (Carteira: filtro "tempo sem contato"). security_invoker → RLS de qs_tasks.';

grant select on public.qs_lead_ultimo_contato to authenticated;

-- O Supabase dá tudo pro anon/authenticated por default privileges. A view é só
-- leitura e só pra quem está logado (mesma linha da 0373: anon fechado).
revoke all on public.qs_lead_ultimo_contato from anon;
revoke insert, update, delete, truncate, references, trigger on public.qs_lead_ultimo_contato from authenticated;
