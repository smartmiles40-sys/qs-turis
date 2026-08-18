-- 0052_closer_le_o_lead.sql
-- ---------------------------------------------------------------------------
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New
--    query → cole este arquivo INTEIRO → Run.
--
-- O QUE ESTAVA ACONTECENDO
--
-- A 0050 deu ao closer o direito de ver e responder QUALQUER conversa de
-- WhatsApp (qs_wa_threads / qs_wa_messages passam por qs_owns_lead, que ganhou
-- o ramo qs_is_closer()). Mas as tabelas de CONTEXTO ficaram na regra da 0008,
-- escrita quando só existiam SDR e gestor: "gestor ou dono da linha".
--
-- Efeito medido em 18/08: o closer abre a aba de WhatsApp, a conversa aparece
-- — e o cliente não. O embed de qs_leads volta nulo, então a lista mostra
-- linha após linha escrita só "Lead", sem nome, sem telefone, sem dono. A
-- busca por nome ou telefone devolve zero entre ~2.000 conversas, e "abrir o
-- card" cai em "Lead não encontrado".
--
-- É ESTA a reclamação dos especialistas ("não aparecem os leads que eu estava
-- falando no ChatApp"). Conferido no banco: 1.358 leads com mensagem, 1.369
-- com conversa, ZERO conversas órfãs. O histórico está todo lá; a RLS é que o
-- apagava da tela. Mesma origem do "card da agenda sem informação" (as notas
-- do SDR sempre existiram) e das 56 cobranças de desfecho que já estão no
-- banco com o closer como dono e que ele nunca viu.
--
-- O QUE ESTA MIGRATION FAZ
--
-- Acrescenta qs_is_closer() às políticas de LEITURA de lead, nota, tarefa e
-- valores de campo custom. Só SELECT: escrever continua exigindo ser dono ou
-- gestão, então o closer não pode reatribuir nem apagar o lead de ninguém.
--
-- CADA POLICY ABAIXO PARTE DA VERSÃO VIGENTE, NÃO DA 0007. Importa: a 0008
-- removeu de propósito o "or owner_id is null" (lead órfão só o gestor vê, pra
-- dois SDRs não pegarem o mesmo na vitrine) e a 0015 acrescentou o histórico
-- por dono do lead em qs_tasks. Recriar a partir da 0007 desfaria as duas
-- coisas em silêncio.
--
-- qs_meetings NÃO aparece aqui: a 0027 já a deixou com "using (true)".
--
-- POR QUE ABRIR POR PAPEL, E NÃO SÓ "OS LEADS DAS MINHAS REUNIÕES"
--
-- Decisão do Bruno em 18/08 ("abre por papel mesmo, os closers precisam
-- responder hoje"): um cliente escreve antes de a reunião existir, e quem está
-- online atende. Amarrar a leitura à reunião recriaria o mesmo buraco no dia
-- seguinte. São 2 pessoas, ambas já com acesso a tudo no Bitrix.
--
-- PARA REVERTER: rode de novo a 0008 e depois a 0015 (fazem drop/create das
-- mesmas políticas, com os mesmos nomes, sem o ramo do closer).
-- ---------------------------------------------------------------------------

-- Lead — base da 0008. Sem isto, o closer vê a conversa sem saber de quem é.
drop policy if exists leads_select on qs_leads;
create policy leads_select on qs_leads for select to authenticated
  using (qs_is_manager() or qs_is_closer() or owner_id = auth.uid());

-- Tarefas — base da 0015 (mantém o histórico por dono do lead). É onde nasce a
-- cobrança "registre o desfecho da reunião": sem leitura, ela existe no banco
-- e nunca chega na tela de quem tem que agir.
drop policy if exists tasks_select on qs_tasks;
create policy tasks_select on qs_tasks for select to authenticated
  using (
    qs_is_manager()
    or qs_is_closer()
    or owner_id = auth.uid()
    or exists (select 1 from qs_leads l where l.id = lead_id and l.owner_id = auth.uid())
  );

-- Notas — base da 0008. É o resumo do que o SDR já conversou, o que evita
-- perguntar duas vezes a mesma coisa ao cliente.
drop policy if exists notes_select on qs_notes;
create policy notes_select on qs_notes for select to authenticated
  using (
    qs_is_manager()
    or qs_is_closer()
    or exists (select 1 from qs_leads l where l.id = lead_id and l.owner_id = auth.uid())
  );

-- Campos personalizados do lead (orçamento, destino, quantas pessoas…).
drop policy if exists lcv_select on qs_lead_custom_values;
create policy lcv_select on qs_lead_custom_values for select to authenticated
  using (
    qs_is_manager()
    or qs_is_closer()
    or exists (select 1 from qs_leads l where l.id = lead_id and l.owner_id = auth.uid())
  );


-- ---------------------------------------------------------------------------
-- TRANSFERIR LEAD — o botão existia pro closer e recusava em toda conversa
-- que não fosse dele. A 0040 checa "gestor, dono atual ou órfão"; o closer não
-- é nenhum dos três. Como ele passa a atender a conversa de qualquer um, é ele
-- quem descobre que o lead está com o SDR errado — e é ele que precisa passar
-- adiante. Só a autorização muda; todo o resto da função continua igual.
-- ---------------------------------------------------------------------------
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

  -- Autorização, idêntica à da policy: gestor, CLOSER (0052), dono atual ou
  -- lead órfão. O closer entrou porque é ele quem atende a conversa de
  -- qualquer um e, portanto, quem descobre que o lead está com o SDR errado.
  if not (qs_is_manager() or qs_is_closer() or v_dono = v_eu or v_dono is null) then
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


-- ---------------------------------------------------------------------------
-- TRANSCRIÇÃO DE ÁUDIO — hoje ela nunca salva.
--
-- A 0024 diz, de propósito, "sem policy de INSERT/UPDATE/DELETE: o navegador
-- não escreve aqui", e a 0051 acrescentou a coluna sem abrir exceção. O front
-- faz update direto em qs_wa_messages e leva 0 linhas, sem erro — falha
-- silenciosa. Efeito prático: toda vez que alguém reabre a conversa, o Whisper
-- roda o áudio de novo, no navegador, do zero.
--
-- Em vez de abrir a tabela para UPDATE (o que deixaria o navegador reescrever
-- o texto de qualquer mensagem), uma função que só encosta na coluna
-- transcricao e só de quem pode ver aquela conversa.
-- ---------------------------------------------------------------------------
create or replace function qs_wa_salvar_transcricao(p_msg uuid, p_texto text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida — entre de novo no QS.' using errcode = '42501';
  end if;

  select lead_id into v_lead from qs_wa_messages where id = p_msg;
  if not found then
    raise exception 'Mensagem não encontrada.' using errcode = 'P0002';
  end if;

  -- Mesma porta da leitura da conversa (0050 já inclui o closer aqui).
  if not qs_owns_lead(v_lead) then
    raise exception 'Sem acesso a esta conversa.' using errcode = '42501';
  end if;

  update qs_wa_messages
     set transcricao = nullif(btrim(p_texto), '')
   where id = p_msg;

  return true;
end;
$$;

grant execute on function qs_wa_salvar_transcricao(uuid, text) to authenticated;

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- Aqui, logo depois do Run (conferindo que o SDR NÃO ganhou o lead órfão):
select policyname, cmd, qual::text from pg_policies
where schemaname = 'public'
  and tablename in ('qs_leads','qs_tasks','qs_notes','qs_lead_custom_values')
  and cmd = 'SELECT'
order by tablename;

-- E, logado como Bruno Matheus ou Talita no app:
--   as conversas passam a mostrar NOME e TELEFONE em vez de "Lead";
--   a busca por nome volta a achar; "abrir o card" para de dar erro;
--   as cobranças de desfecho aparecem na fila deles.
