-- supabase/migrations/0373_seg_reacao_ligacoes_cadencias_anon.sql
-- -----------------------------------------------------------------------------
-- SEGURANÇA (revisão de 12/11/2026). Escrita a partir do que está VIGENTE no
-- banco (pg_proc / pg_policies lidos em 12/11), não das migrations antigas.
-- Idempotente: pode rodar duas vezes.
--
-- 1) qs_wa_react_by_source — SECURITY DEFINER, sem guarda nenhuma, executável
--    por anon e authenticated: qualquer um com a chave pública punha/trocava
--    reação em qualquer mensagem de WhatsApp. A 0041 já mandava "só service_role",
--    mas o grant voltou. Quem chama hoje: NINGUÉM (grep em src/, api/, desktop/,
--    n8n/ e scripts/: zero ocorrências; o webhook usa qs_wa_react, que a 0335 já
--    fechou pro service_role). → só service_role.
--
-- 2) qs_wa_calls — a policy wa_calls_leitura liberava TODA linha com lead nulo
--    pra qualquer logado. Em 12/11 eram 1.701 linhas assim, 1.688 delas com
--    evento 'desconhecido' (payload inteiro da Meta: smb_app_state_sync = agenda
--    de contatos do celular com telefone e nome, account_update, status de
--    template). Quem lê a tabela pelo navegador: só src/lib/qs/waCall.ts (a
--    "vigia" da ligação de saída), que filtra por call_id. Ligação de número
--    desconhecido (e a de saída quando o findLeadByPhone não acha o lead) chega
--    com lead nulo MAS com call_id — essa continua visível, senão a ligação
--    morreria em "discando" (ver o comentário em api/wa-calls.js ~400).
--    O /api/wa-config (diagnóstico) lê pelo service role: não muda.
--    → lead nulo só aparece se for evento de chamada (call_id preenchido).
--
-- 3) qs_cadences, qs_cadence_days, qs_cadence_activities, qs_cadence_owners —
--    a policy *_write era ALL using(true): qualquer logado (SDR, closer, papel
--    marketing) criava, editava, congelava e EXCLUÍA cadência pela API. Quem
--    escreve hoje: CadenceCreatePage.tsx, CadencesPage.tsx (congelar) e
--    queries.ts (updateQsCadence/deleteQsCadence) — telas que no menu só
--    aparecem pra admin, gestor e marketing (MENU_ACCESS em QsAuthContext.tsx;
--    o marketing é espectador e não deveria gravar). O /api (cadencia-sweep,
--    _leads, _disparo, gloria) usa service role e só LÊ. Nenhuma função do banco
--    grava nessas tabelas. → escrita só qs_is_manager() (admin ativo ou gestor
--    com setor comercial — o mesmo critério de qs_settings write). Leitura não
--    muda (as policies *_select seguem using(true)).
--
-- 4) 16 funções SECURITY DEFINER que GRAVAM e estavam executáveis por anon.
--    Nenhuma é chamada sem login: os chamadores são o navegador logado
--    (authenticated) ou o /api com service role (lista no relatório da revisão).
--    Páginas públicas (DocumentosPublico, PesquisaPublica, PropostaPublica,
--    agendar) só falam com o /api. → tira de PUBLIC e anon e dá grant explícito
--    a authenticated + service_role (sem isso, revogar de PUBLIC tiraria também
--    do authenticated, que hoje herda via PUBLIC). fin_com_vendas_resolver fica
--    de fora (está com outra frente).
--
-- Volta (se algo quebrar):
--   grant execute on function public.<sig> to anon;
--   alter policy wa_calls_leitura on qs_wa_calls using ((lead_id is null) or ...);
--   alter policy qs_cadences_write on qs_cadences using (true) with check (true); (idem nas 3 irmãs)
-- -----------------------------------------------------------------------------

-- 1) qs_wa_react_by_source: só servidor
revoke execute on function public.qs_wa_react_by_source(text, text, text, text) from public, anon, authenticated;
grant execute on function public.qs_wa_react_by_source(text, text, text, text) to service_role;

-- 2) qs_wa_calls: lead nulo só se for evento de chamada
alter policy wa_calls_leitura on public.qs_wa_calls
  using (
    ((lead_id is null) and (call_id is not null))
    or (select qs_is_manager())
    or (select qs_is_closer())
    or (lead_id in (select qs_leads_meus()))
  );

-- 3) Cadências: escrita só gestor comercial/admin
alter policy qs_cadences_write on public.qs_cadences
  using ((select qs_is_manager())) with check ((select qs_is_manager()));
alter policy qs_cadence_days_write on public.qs_cadence_days
  using ((select qs_is_manager())) with check ((select qs_is_manager()));
alter policy qs_cadence_activities_write on public.qs_cadence_activities
  using ((select qs_is_manager())) with check ((select qs_is_manager()));
alter policy qs_cadence_owners_write on public.qs_cadence_owners
  using ((select qs_is_manager())) with check ((select qs_is_manager()));

-- 4) Definer que grava: fora do anon, mantém logado + servidor
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.cad_resolver_divergencia(uuid, text)',
    'public.cad_trocar_ficha(uuid, uuid)',
    'public.fin_devolver_conversa(uuid, text)',
    'public.fin_enviar(text, text, text, uuid, uuid, uuid, text, text, text)',
    'public.fin_ligar_conversa(uuid, uuid)',
    'public.fin_mudar(uuid, text, text, boolean, text)',
    'public.qs_carteira_redistribuir(uuid)',
    'public.qs_encerrar_confirmacao(uuid, text)',
    'public.qs_gloria_entrar_no_pipeline(uuid)',
    'public.qs_gloria_tirar_do_pipeline(uuid, uuid)',
    'public.qs_transferir_lead(uuid, uuid, text)',
    'public.qs_wa_salvar_transcricao(uuid, text)',
    'public.qs_wa_toggle_pin(uuid)',
    'public.rel_juntar_clientes(uuid, uuid)',
    'public.rel_wa_fixar_mensagem(uuid, boolean)'
  ] loop
    if to_regprocedure(f) is null then
      raise notice '0373: % não existe — pulando', f;
      continue;
    end if;
    execute format('grant execute on function %s to authenticated, service_role', f);
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;

-- Conferência (esperado: anon=false nas 16; authenticated=true nas 15 do bloco 4):
-- select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute') anon,
--        has_function_privilege('authenticated', p.oid, 'execute') auth
--   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
--   'qs_wa_react_by_source','cad_resolver_divergencia','cad_trocar_ficha','fin_devolver_conversa','fin_enviar',
--   'fin_ligar_conversa','fin_mudar','qs_carteira_redistribuir','qs_encerrar_confirmacao','qs_gloria_entrar_no_pipeline',
--   'qs_gloria_tirar_do_pipeline','qs_transferir_lead','qs_wa_salvar_transcricao','qs_wa_toggle_pin',
--   'rel_juntar_clientes','rel_wa_fixar_mensagem');
