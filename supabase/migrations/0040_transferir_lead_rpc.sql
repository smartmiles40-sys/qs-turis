-- 0040_transferir_lead_rpc.sql
-- ---------------------------------------------------------------------------
-- TRANSFERIR LEAD VIRA UMA OPERAÇÃO SÓ, NO BANCO.
--
-- Duas dores resolvidas de uma vez.
--
-- 1) A 0039 não resolveu. Depois de aplicá-la (confirmado: o WITH CHECK no
--    banco já menciona qs_pode_receber_lead), o SDR SEGUIA tomando
--    "new row violates row-level security policy". Medido:
--
--      qs_pode_receber_lead(destino) ....... true
--      SDR mantém o lead consigo ........... 200
--      ADMIN transfere ..................... 200
--      SDR transfere ....................... 403
--
--    Uma policy PERMISSIVA não consegue causar isso — permissivas se somam com
--    OR. Só uma RESTRICTIVE explica, e não existe nenhuma no repositório além
--    da `ativo_qs_leads` (0017), que testa o usuário LOGADO e passa. Ou seja: o
--    banco tem regra que o repositório não conhece.
--
-- 2) Mesmo se a policy fosse consertada, a transferência continuaria sendo
--    TRÊS escritas separadas do navegador (lead, tarefas, handover). Falhar no
--    meio deixa o lead com as tarefas de um dono e a posse de outro — que é
--    exatamente o estado sujo que a gente já viu acontecer.
--
-- A saída certa pros dois: uma função SECURITY DEFINER. Transferência não é
-- "um UPDATE que por acaso muda o dono", é uma operação com autorização
-- própria — e como tal ela carrega a própria regra, em vez de depender de uma
-- policy genérica de UPDATE que precisa servir a todos os outros casos.
--
-- A autorização NÃO afrouxa nada: continua exigindo gestor, dono atual ou lead
-- órfão, e o destino tem de ser usuário ativo. O que muda é que a regra fica
-- num lugar só, legível, e a operação é atômica.
-- ---------------------------------------------------------------------------

begin;

create or replace function qs_transferir_lead(
  p_lead   uuid,
  p_para   uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu      uuid := auth.uid();
  v_dono    uuid;
  v_tarefas int := 0;
begin
  if v_eu is null then
    raise exception 'Sessão inválida — entre de novo no QS.' using errcode = '42501';
  end if;

  -- Quem está desativado não mexe em nada (mesma regra da 0017).
  if not exists (select 1 from qs_users where id = v_eu and is_active) then
    raise exception 'Seu usuário está desativado.' using errcode = '42501';
  end if;

  select owner_id into v_dono from qs_leads where id = p_lead;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  -- Autorização, idêntica à da policy: gestor, dono atual, ou lead órfão.
  if not (qs_is_manager() or v_dono = v_eu or v_dono is null) then
    raise exception 'Este lead é de outro SDR.' using errcode = '42501';
  end if;

  -- Destino precisa existir e estar ativo: sem isso o lead some da fila de
  -- todo mundo (id inexistente) ou cai na fila de um ex-funcionário.
  if not exists (select 1 from qs_users where id = p_para and is_active) then
    raise exception 'O destinatário não é um usuário ativo do QS.' using errcode = '42501';
  end if;

  if p_para = v_dono then
    return jsonb_build_object('ok', true, 'sem_mudanca', true);
  end if;

  update qs_leads set owner_id = p_para, updated_at = now() where id = p_lead;

  -- As atividades em aberto vão junto. Sem isto o novo dono recebe um lead sem
  -- nada pra fazer, e o antigo continua com tarefas de um lead que não é dele.
  update qs_tasks set owner_id = p_para
   where lead_id = p_lead and status in ('pendente', 'atrasada');
  get diagnostics v_tarefas = row_count;

  -- Histórico. `from_user_id` cai pra quem transferiu quando o lead era órfão.
  insert into qs_handovers (lead_id, from_user_id, to_user_id, briefing)
  values (p_lead, coalesce(v_dono, v_eu), p_para,
          coalesce(nullif(btrim(p_motivo), ''), 'Lead transferido'));

  return jsonb_build_object('ok', true, 'de', v_dono, 'para', p_para, 'tarefas', v_tarefas);
end;
$$;

grant execute on function qs_transferir_lead(uuid, uuid, text) to authenticated;

commit;

-- ── CONFERÊNCIA ────────────────────────────────────────────────────────────
--   select proname from pg_proc where proname = 'qs_transferir_lead';
--
-- O teste de verdade é na tela: um SDR transfere um lead pra outro SDR. Tem que
-- sumir da fila dele e aparecer na do colega, com as atividades pendentes junto.
