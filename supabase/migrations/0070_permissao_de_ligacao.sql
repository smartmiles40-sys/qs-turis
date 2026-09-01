-- 0070_permissao_de_ligacao.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- -- O QUE ESTA TABELA RESPONDE ----------------------------------------------
--
-- "Esse cliente liberou pra gente ligar pra ele?"
--
-- Na Cloud API, ligar pro cliente NAO e como mandar mensagem: a Meta exige que
-- a pessoa tenha AUTORIZADO receber ligacao daquele numero. Sem isso a chamada
-- e recusada com o erro 138006, e o SDR so descobre depois de clicar, liberar o
-- microfone e esperar. A tabela existe pra essa pergunta ser respondida ANTES
-- do clique — na fila, no botao e na cadencia.
--
-- -- DE ONDE VEM A INFORMACAO (tres fontes, e elas discordam de proposito) ----
--
--   1. `resposta-do-cliente` — o webhook `call_permission_reply`. E o mais
--      preciso: diz se foi "Permitir" (permanente) ou "Permitir por enquanto"
--      (7 dias), com o timestamp exato. CHEGA NO CAMPO `messages`, nao no
--      `calls` — e por isso o app `qs_call` precisa assinar `messages` tambem,
--      senao esse evento nunca aparece aqui (ver o cabecalho do wa-calls.js).
--
--   2. `ligacao-do-cliente` — com `callback_permission_status: ENABLED` (que e
--      como o numero esta configurado), quem LIGA pra empresa autoriza a
--      empresa a ligar de volta. Isso a doc afirma, mas nao publica por quanto
--      tempo vale; aqui gravamos 7 dias, que e a janela da permissao temporaria.
--      E uma INFERENCIA, e por isso `confirmado` fica false: serve pra fila e
--      pra cadencia, e a conferencia de verdade acontece no clique.
--
--   3. `api` — `GET /{phone_number_id}/call_permissions?user_wa_id=...`, a
--      fonte da verdade da Meta. E ela que o botao consulta na hora de ligar.
--      Custa uma ida a Graph API por lead, entao nao serve pra varrer fila —
--      serve pra decidir UMA ligacao. Toda leitura dela regrava esta linha.
--
-- Nenhuma das tres e descartada: a mais recente vence, e `fonte`/`confirmado`
-- dizem de onde veio. Sem isso, "o QS disse que podia e a Meta recusou" seria
-- um misterio em vez de uma linha.
--
-- -- POR QUE A CHAVE E O TELEFONE, E NAO O LEAD -------------------------------
--
-- A permissao e da PESSOA com o NUMERO da empresa — ela nao sabe o que e um
-- lead. Dois cadastros duplicados com o mesmo telefone (e o QS tem 68 desses)
-- compartilham a mesma permissao, e tem que compartilhar mesmo. O `lead_id` fica
-- junto so pra RLS e pra tela, e pode ser nulo.
-- ---------------------------------------------------------------------------

create table if not exists public.qs_call_permissions (
  wa_id          text primary key,          -- so digitos, com DDI, como a Meta usa
  lead_id        uuid references qs_leads(id) on delete set null,
  -- no_permission | temporary | permanent
  status         text not null default 'no_permission',
  expira_em      timestamptz,               -- nulo quando permanente ou sem permissao
  -- O que a Meta responde em actions[start_call].can_perform_action: ja leva em
  -- conta o teto de 5 chamadas atendidas por 24h, que `status` sozinho ignora.
  pode_ligar     boolean,
  pode_pedir     boolean,                   -- idem, pro pedido de permissao (1 por 24h)
  pedido_em      timestamptz,               -- quando MANDAMOS o ultimo pedido
  respondido_em  timestamptz,               -- quando a pessoa respondeu
  resposta       text,                      -- accept | reject
  fonte          text,                      -- resposta-do-cliente | ligacao-do-cliente | api
  confirmado     boolean not null default false,
  cru            jsonb,
  atualizado_em  timestamptz not null default now()
);

comment on table public.qs_call_permissions is
  'Permissao de ligacao da Cloud API, por telefone. Responde "posso ligar pra essa pessoa?" antes do clique. Ver 0070 pras tres fontes e por que elas discordam.';

create index if not exists idx_qs_call_perm_lead on public.qs_call_permissions (lead_id);
-- Indice da pergunta da CADENCIA: "quem liberou e ainda vale?".
create index if not exists idx_qs_call_perm_vivas on public.qs_call_permissions (status, expira_em desc)
  where status in ('temporary', 'permanent');

-- ── A pergunta em UMA funcao ───────────────────────────────────────────────
-- A regra de "vale?" mora aqui e em nenhum outro lugar: permanente sempre vale,
-- temporaria vale enquanto nao expirou, o resto nao vale. Front, cadencia e
-- servidor perguntam pra mesma funcao — tres copias dessa regra viravam tres
-- respostas diferentes pro mesmo lead.
create or replace function public.qs_permissao_vale(
  p_status text, p_expira timestamptz
) returns boolean
language sql immutable as $$
  select case
    when p_status = 'permanent' then true
    when p_status = 'temporary' then coalesce(p_expira, 'epoch'::timestamptz) > now()
    else false
  end;
$$;

alter table public.qs_call_permissions enable row level security;

-- Quem escreve e o servidor (service_role ignora RLS). O app so LE, e le pelo
-- mesmo criterio de qs_wa_calls: sem lead amarrado, todo mundo ve (e dado de
-- sinalizacao, nao conteudo do lead); com lead, segue o dono.
drop policy if exists "call_perm_leitura" on public.qs_call_permissions;
create policy "call_perm_leitura" on public.qs_call_permissions
  for select to authenticated
  using (lead_id is null or qs_owns_lead(lead_id));

-- ── A CADENCIA DE QUEM LIBEROU ─────────────────────────────────────────────
-- Qual cadencia recebe o lead no instante em que ele autoriza a ligacao. Fica
-- em qs_settings (config muda na tela, nao em deploy) e comeca DESLIGADA: sem
-- essa chave, o webhook so grava a permissao e nao mexe em cadencia nenhuma.
--
-- A troca em si passa pelo `moverLeadParaCadencia`, que ja tem as travas do
-- Bruno: lead ganho, com reuniao marcada ou com atividade de cadencia em aberto
-- NAO e movido. Autorizar ligacao nao pode atropelar quem ja esta sendo
-- trabalhado — so pescar quem estava parado.
insert into public.qs_settings (key, value)
values ('cadencia_permissao_ligacao', 'null'::jsonb)
on conflict (key) do nothing;
