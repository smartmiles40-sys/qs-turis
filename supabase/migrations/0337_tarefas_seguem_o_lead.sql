-- supabase/migrations/0337_tarefas_seguem_o_lead.sql
-- -----------------------------------------------------------------------------
-- AS TAREFAS SEGUEM O LEAD (auditoria 09/11/2026)
--
-- Dois furos achados na auditoria:
--   a) Lead vira ganho/perdido e as atividades PENDENTES dele ficam abertas pra
--      sempre. Só alguns caminhos fechavam (0093 qs_perder_lead_da_reuniao,
--      Glória, mover de cadência); o resto deixava lixo na fila e nos números.
--   b) Lead troca de dono (owner_id) por um caminho que não é o
--      qs_transferir_lead (0040) — closer_negocio_trazer/trocar_closer (0334),
--      redistribuição, update direto — e as tarefas ficam com o dono ANTIGO.
--
-- O que esta migration faz:
--   1) qs_tarefa_pos_fechamento(tags): as tarefas que NASCEM ou VIVEM depois do
--      encerramento e não podem morrer junto — a MESMA regra da fila
--      (tarefaVisivelNaFila em TasksPanel.tsx): re_contato (perdido de propósito
--      / oportunidade futura / cotação vencida) e as cobranças da reunião
--      (confirmar, desfecho, reuniao, meeting:<id>). Ganho no QS = reunião
--      agendada: a confirmação e o desfecho são o trabalho que FALTA.
--   2) Gatilho trg_qs_tarefas_fecham_com_lead (AFTER UPDATE OF status em
--      qs_leads): entrou em ganho/perdido → pendentes viram 'ignorada' (o status
--      que o sistema já usa pra "não feita", ver 0052/0093/_leads.js) com
--      skip_reason "Lead ganho (0337)" / "Lead perdido (0337)". Exceção: (1).
--   3) Gatilho trg_qs_tarefas_seguem_dono (AFTER UPDATE OF owner_id em
--      qs_leads): pendentes do dono antigo (ou sem dono) passam pro novo.
--      Exceções: cobranças de reunião (confirmar/desfecho/meeting: são de quem
--      AGENDOU, não de quem herda o lead — o qs_transferir_lead continua movendo
--      tudo quando é chamado explicitamente) e tarefas de cadência
--      congelada/rascunho em lead ainda aberto (ver "Resgate" abaixo).
--   4) Faxina única dos casos que já existem.
--
-- LAÇO: nenhum. Gatilhos em qs_tasks (conferidos em pg_trigger 09/11):
--   trg_audit_qs_tasks (log), trg_qs_ligacao_sdr_segue_tarefa (mexe só em
--   qs_ligacoes_sdr — e libera a ligação marcada quando a tarefa vira
--   'ignorada' ou troca de dono, que é exatamente o desejado),
--   trg_qs_tasks_espectador (bloqueia papéis de outra área — os mesmos que já
--   não conseguem atualizar qs_leads). Nenhum deles escreve em qs_leads.
--
-- RESGATE DA YANCA (decisão pendente do dono): "Resgate — Base Fria" está
--   congelada desde 24/10 com ~2.042 pendentes em leads ABERTOS. Nada aqui toca
--   nessas tarefas enquanto o lead estiver aberto: (2) só age em lead que
--   FECHOU, (3) pula tarefa de cadência não 'disponivel' em lead aberto, e a
--   faxina (4b) também pula.
--
-- NÚMEROS NA HORA (SELECT em 09/11/2026, banco eabfjomrnucymduqnbci):
--   4a) 24 tarefas pendentes em 20 leads já ganhos/perdidos (de 94 pendentes
--       em leads fechados; 55 são cobranças de reunião e 15 re_contato — ficam).
--   4b) 0 tarefas pendentes em lead aberto com dono ≠ dono do lead quando o
--       dono do lead é SDR ativo. A faxina fica por segurança (idempotente).
--
-- Volta:
--   drop trigger if exists trg_qs_tarefas_fecham_com_lead on qs_leads;
--   drop trigger if exists trg_qs_tarefas_seguem_dono on qs_leads;
--   drop function if exists qs_tarefas_fecham_com_lead();
--   drop function if exists qs_tarefas_seguem_dono();
--   drop function if exists qs_tarefa_pos_fechamento(text[]);
--   drop function if exists qs_tarefa_de_reuniao(text[]);
--   -- desfazer a faxina 4a (só as linhas dela, marcadas no skip_reason):
--   update qs_tasks set status = 'pendente', skip_reason = null
--    where skip_reason = 'Faxina 0337: lead já estava ganho/perdido';
--   -- 4b não tem volta automática (0 linhas em 09/11).
-- -----------------------------------------------------------------------------

-- 1) Tarefa que sobrevive ao fechamento do lead -------------------------------
create or replace function qs_tarefa_pos_fechamento(p_tags text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_tags, '{}'::text[]) && array['re_contato', 'confirmar', 'desfecho', 'reuniao']
      or exists (select 1 from unnest(coalesce(p_tags, '{}'::text[])) g where g like 'meeting:%');
$$;

-- Cobrança de reunião: é de quem agendou, não segue o dono do lead.
create or replace function qs_tarefa_de_reuniao(p_tags text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_tags, '{}'::text[]) && array['confirmar', 'desfecho', 'reuniao']
      or exists (select 1 from unnest(coalesce(p_tags, '{}'::text[])) g where g like 'meeting:%');
$$;

-- 2) Fechou o lead → fecha as pendentes ---------------------------------------
create or replace function qs_tarefas_fecham_com_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('ganho', 'perdido') and old.status is distinct from new.status then
    update qs_tasks t
       set status = 'ignorada',
           skip_reason = case when new.status = 'ganho' then 'Lead ganho (0337)' else 'Lead perdido (0337)' end
     where t.lead_id = new.id
       and t.status in ('pendente', 'atrasada')
       and not qs_tarefa_pos_fechamento(t.tags);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_tarefas_fecham_com_lead on qs_leads;
create trigger trg_qs_tarefas_fecham_com_lead
  after update of status on qs_leads
  for each row execute function qs_tarefas_fecham_com_lead();

-- 3) Trocou o dono → as pendentes do antigo vão pro novo ----------------------
create or replace function qs_tarefas_seguem_dono()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null and new.owner_id is distinct from old.owner_id then
    update qs_tasks t
       set owner_id = new.owner_id
     where t.lead_id = new.id
       and t.status in ('pendente', 'atrasada')
       and t.owner_id is not distinct from old.owner_id
       and not qs_tarefa_de_reuniao(t.tags)
       -- Cadência congelada/rascunho em lead aberto: não mexe (Resgate da Yanca).
       and not (
         new.status in ('nao_iniciado', 'em_prospeccao')
         and t.cadence_id is not null
         and exists (select 1 from qs_cadences c where c.id = t.cadence_id and c.status <> 'disponivel')
       );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_tarefas_seguem_dono on qs_leads;
create trigger trg_qs_tarefas_seguem_dono
  after update of owner_id on qs_leads
  for each row execute function qs_tarefas_seguem_dono();

-- Só os gatilhos chamam; ninguém precisa executar pela API.
revoke all on function qs_tarefas_fecham_com_lead() from public, anon, authenticated;
revoke all on function qs_tarefas_seguem_dono() from public, anon, authenticated;
revoke all on function qs_tarefa_pos_fechamento(text[]) from anon;
revoke all on function qs_tarefa_de_reuniao(text[]) from anon;

-- 4) Faxina única ---------------------------------------------------------------
-- 4a) 24 linhas em 09/11: pendentes em lead já ganho/perdido.
update qs_tasks t
   set status = 'ignorada',
       skip_reason = 'Faxina 0337: lead já estava ganho/perdido'
  from qs_leads l
 where l.id = t.lead_id
   and l.status in ('ganho', 'perdido')
   and t.status in ('pendente', 'atrasada')
   and not qs_tarefa_pos_fechamento(t.tags);

-- 4b) 0 linhas em 09/11: lead aberto de SDR ativo com tarefa pendente de outro dono.
update qs_tasks t
   set owner_id = l.owner_id
  from qs_leads l, qs_users u
 where l.id = t.lead_id
   and u.id = l.owner_id and u.role = 'sdr' and u.is_active
   and l.status in ('nao_iniciado', 'em_prospeccao')
   and t.status in ('pendente', 'atrasada')
   and t.owner_id is distinct from l.owner_id
   and not qs_tarefa_de_reuniao(t.tags)
   and not (t.cadence_id is not null
            and exists (select 1 from qs_cadences c where c.id = t.cadence_id and c.status <> 'disponivel'));

-- ── VERIFICAÇÃO (rodar depois) ────────────────────────────────────────────────
-- Esperado: 0 e 0.
-- select count(*) from qs_tasks t join qs_leads l on l.id = t.lead_id
--  where t.status in ('pendente','atrasada') and l.status in ('ganho','perdido')
--    and not qs_tarefa_pos_fechamento(t.tags);
-- select count(*) from qs_tasks t join qs_leads l on l.id = t.lead_id
--   join qs_users u on u.id = l.owner_id and u.role = 'sdr' and u.is_active
--  where t.status in ('pendente','atrasada') and l.status in ('nao_iniciado','em_prospeccao')
--    and t.owner_id is distinct from l.owner_id and not qs_tarefa_de_reuniao(t.tags)
--    and not exists (select 1 from qs_cadences c where c.id = t.cadence_id and c.status <> 'disponivel');
