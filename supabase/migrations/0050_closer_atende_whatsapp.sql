-- 0050_closer_atende_whatsapp.sql
-- ---------------------------------------------------------------------------
-- O CLOSER PASSA A ENXERGAR E RESPONDER QUALQUER CONVERSA DE WHATSAPP.
--
-- Decisão do Bruno em 18/08: "abre por papel mesmo, os closers precisam
-- responder hoje". Até aqui a conversa só chegava para o DONO do lead (regra de
-- 27/07, feita quando só os SDRs atendiam) — e o closer, que entra agora no QS,
-- abria a tela e via vazio.
--
-- O QUE MUDA: `qs_owns_lead` passa a devolver verdadeiro para quem tem papel
-- `closer`, do mesmo jeito que já devolve para admin e gestor. Como TODA a
-- segurança do WhatsApp (leitura das mensagens, leitura das conversas, marcar
-- lida, apagar) passa por essa função, mudar aqui abre tudo de uma vez e sem
-- deixar uma ponta para trás.
--
-- O QUE **NÃO** MUDA: a carteira do SDR. Quem é `sdr` continua vendo apenas os
-- leads dele — esta migration não afeta nenhuma outra tabela, e a distribuição,
-- as tarefas e as métricas seguem por dono como sempre.
--
-- Reversível: para voltar, basta recriar a função sem o ramo do closer (o corpo
-- anterior está no comentário no fim do arquivo).
-- ---------------------------------------------------------------------------

-- Espelha qs_is_manager, mas para o papel de especialista.
create or replace function qs_is_closer()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
    where id = auth.uid() and role = 'closer' and is_active
  );
$$;

comment on function qs_is_closer() is
  'Verdadeiro quando o usuário logado é um especialista (closer) ativo.';

create or replace function qs_owns_lead(p_lead uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select qs_is_manager()
    -- NOVO (0050): o especialista atende qualquer conversa. Ele recebe o lead
    -- já no fim do funil e precisa responder cliente que ainda está com o SDR.
    or qs_is_closer()
    or exists (
      select 1 from qs_leads l
      where l.id = p_lead and (l.owner_id = auth.uid() or l.owner_id is null)
    )
    or exists (
      select 1 from qs_handovers h
      where h.lead_id = p_lead and h.from_user_id = auth.uid()
    );
$$;

comment on function qs_owns_lead(uuid) is
  'Quem pode ver/responder a conversa deste lead: gestão, closer (0050), o dono, ou quem passou o lead adiante.';

-- Conferência rápida depois de colar:
--   select qs_is_closer();                  -- logado como closer: true
--   select count(*) from qs_wa_threads;     -- closer passa a ver todas
--
-- PARA REVERTER, recriar sem o ramo do closer:
--   create or replace function qs_owns_lead(p_lead uuid)
--   returns boolean language sql stable security definer set search_path = public as $$
--     select qs_is_manager()
--       or exists (select 1 from qs_leads l where l.id = p_lead and (l.owner_id = auth.uid() or l.owner_id is null))
--       or exists (select 1 from qs_handovers h where h.lead_id = p_lead and h.from_user_id = auth.uid());
--   $$;
