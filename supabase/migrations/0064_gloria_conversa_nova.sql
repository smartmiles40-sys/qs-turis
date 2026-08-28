-- 0064_gloria_conversa_nova.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- Depende da 0053, 0060 e 0061.
--
-- -- O QUE ACONTECEU, COM HORA -----------------------------------------------
--
-- 25/08, 21:45 - a Gloria atendeu um lead sobre Africa do Sul, concluiu que nao
-- e expedicao nossa e transferiu pro especialista. Correto.
--
-- 27/08, 14:00 - o MESMO lead escreveu "Ola". So isso.
-- 27/08, 14:02 - ela respondeu: "Ja encaminhei seu caso pro nosso especialista
--                pra montar um roteiro sob medida pra AFRICA DO SUL". E se
--                desligou. As 14:03 ele disse "na verdade eu queria falar sobre
--                a expedicao Islandia" e ficou sem resposta.
--
-- Ela nao errou a leitura: foi INFORMADA errado. A 0061 reabre a sessao zerando
-- a mecanica (ativa, toques, pausada_em, entrou_em) e preserva a MEMORIA
-- (resumo, perfil_viajante, como_pretende_viajar, respondidas, temperatura,
-- resposta_*). Pior: como respondidas = 2, o etapa nao voltava pra 'abertura' -
-- virava 'qualificando'. O banco declarou "estamos no meio de uma qualificacao"
-- para uma conversa que ainda nao tinha comecado.
--
-- -- A REGRA, E POR QUE NAO E "SEMPRE LIMPA" ---------------------------------
--
-- Limpar sempre estragaria o caso legitimo: o SDR tira a IA da conversa por dez
-- minutos pra dar um recado e devolve. Ali a qualificacao e a MESMA, e jogar
-- fora o que o lead ja respondeu obrigaria a perguntar tudo de novo - que e
-- justamente o que irrita quem ja respondeu.
--
-- Sao DOIS sinais, e basta um deles:
--
--   1. transferida_em preenchido. Transferir e ela declarar "terminei com este
--      lead, agora e com voces". Voltar depois disso e um atendimento NOVO, nao
--      a continuacao do anterior.
--   2. A nossa ultima saida foi ha mais de 8 horas. A conversa esfriou.
--
--   Devolver depois de 10 min -> nao transferiu, saida recente -> PRESERVA
--   Voltar dois dias depois   -> saida antiga                  -> LIMPA
--   Voltar depois de transferir -> sinal 1                     -> LIMPA
--
-- Nao uso "ultima mensagem do lead" de proposito: no caso de 27/08 a mensagem
-- mais recente era o "Ola" NOVO, de segundos antes. Medir por ela diria
-- "recente" e nao limparia nada - o bug passaria batido pelo proprio conserto.
--
-- O PRECO do sinal 1, dito com todas as letras: se o time devolver a IA pra uma
-- conversa que ela mesma transferiu ha 20 minutos, ela vai reperguntar o que o
-- lead ja respondeu. Escolhi esse preco porque o contrario - responder sobre
-- Africa do Sul quem perguntou de Islandia - custa o lead, e reperguntar so
-- custa uma mensagem. Se isso incomodar na pratica, o ajuste e trocar o sinal 1
-- por "transferida_em < now() - interval '1 hour'".
--
-- -- O QUE ESTE ARQUIVO NAO FAZ ----------------------------------------------
--
-- Nao apaga historico. qs_wa_messages e qs_gloria_log ficam intactos: o que e
-- zerado e o RASCUNHO da qualificacao, nao a conversa. A thread continua
-- inteira na tela do lead.
-- ---------------------------------------------------------------------------

create or replace function public.qs_gloria_entrar_no_pipeline(p_lead uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead      qs_leads%rowtype;
  v_cad       uuid;
  v_fechou    int := 0;
  v_ult_saida timestamptz;
  v_nova      boolean;
begin
  if auth.uid() is not null and not qs_owns_lead(p_lead) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into v_lead from qs_leads where id = p_lead;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'lead_inexistente'); end if;
  if v_lead.status = 'ganho' then return jsonb_build_object('ok', false, 'motivo', 'lead_ganho'); end if;

  if exists (select 1 from qs_meetings
              where lead_id = p_lead and status in ('agendada')
                and scheduled_at >= now()) then
    return jsonb_build_object('ok', false, 'motivo', 'tem_reuniao_marcada');
  end if;

  select id into v_cad from qs_cadences where execution_mode = 'ia' and status <> 'congelada'
   order by created_at asc limit 1;
  if v_cad is null then return jsonb_build_object('ok', false, 'motivo', 'sem_cadencia_de_ia'); end if;

  update qs_tasks
     set status = 'ignorada',
         skip_reason = 'Lead entrou no atendimento por IA'
   where lead_id = p_lead and status in ('pendente', 'atrasada');
  get diagnostics v_fechou = row_count;

  update qs_leads
     set cadence_id = v_cad,
         cadence_started_at = now(),
         status = case when status = 'nao_iniciado' then 'em_prospeccao' else status end
   where id = p_lead;

  -- E conversa nova? Dois sinais, e basta um (ver cabecalho).
  select max(sent_at) into v_ult_saida
    from qs_wa_messages where lead_id = p_lead and direction = 'out';
  select (transferida_em is not null)
           or v_ult_saida is null
           or v_ult_saida < now() - interval '8 hours'
    into v_nova
    from qs_gloria_sessoes where lead_id = p_lead;
  v_nova := coalesce(v_nova, true);

  insert into qs_gloria_sessoes(lead_id) values (p_lead) on conflict (lead_id) do nothing;

  update qs_gloria_sessoes
     set ativa = true, motivo = null, pausada_em = null,
         toques = 0, ultimo_toque_em = null,
         entrou_em = now(),

         -- A MEMORIA so e zerada quando a conversa anterior acabou faz tempo.
         transferida_em = case when v_nova then null else transferida_em end,
         qualificada_em = case when v_nova then null else qualificada_em end,
         respondidas    = case when v_nova then 0    else respondidas    end,
         respondida_ate = case when v_nova then null else respondida_ate end,
         temperatura    = case when v_nova then null else temperatura    end,
         resposta_data         = case when v_nova then null else resposta_data         end,
         resposta_investimento = case when v_nova then null else resposta_investimento end,
         resposta_decisao      = case when v_nova then null else resposta_decisao      end,
         perfil_viajante       = case when v_nova then null else perfil_viajante       end,
         como_pretende_viajar  = case when v_nova then null else como_pretende_viajar  end,
         resumo                = case when v_nova then null else resumo                end,

         -- Com a memoria limpa, respondidas e 0 e a etapa cai em 'abertura'
         -- sozinha. Sem a limpeza, ela virava 'qualificando' - o bug de 27/08.
         etapa = case
                   when v_nova then 'abertura'
                   when etapa = 'transferida' then
                     case when coalesce(respondidas, 0) >= 5 then 'qualificada'
                          when coalesce(respondidas, 0) >  0 then 'qualificando'
                          else 'abertura' end
                   else etapa
                 end
   where lead_id = p_lead;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo, payload)
  values (p_lead, 'evento',
          case when v_nova then 'entrou no pipeline (conversa NOVA: memoria zerada)'
               else 'entrou no pipeline (mesma conversa: memoria preservada)' end,
          'entrou_no_pipeline',
          jsonb_build_object('tarefas_encerradas', v_fechou,
                             'conversa_nova', v_nova,
                             'ultima_saida', v_ult_saida));

  return jsonb_build_object('ok', true, 'lead_id', p_lead, 'cadencia_id', v_cad,
                            'tarefas_encerradas', v_fechou, 'conversa_nova', v_nova);
end;
$function$;

grant execute on function public.qs_gloria_entrar_no_pipeline(uuid) to authenticated, service_role;
