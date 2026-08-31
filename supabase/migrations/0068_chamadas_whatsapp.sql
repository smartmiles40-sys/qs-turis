-- 0068_chamadas_whatsapp.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- -- CAMADA 1 DA LIGACAO PELO WHATSAPP ---------------------------------------
--
-- 28/08: o Bruno ligou pro numero oficial e a chamada NAO apareceu no QS.
-- O motivo nao era codigo faltando na tela, era a chamada nunca chegar aqui:
--
--   Meta  ->  Chatwoot  ->  QS        (o caminho de MENSAGEM que existe hoje)
--   Meta  ->  ???                     (o evento `calls` morre no Chatwoot,
--                                      que nao suporta ligacao)
--
-- O `wa-webhook` recebe do CHATWOOT, nao da Meta — esta escrito no cabecalho
-- dele. Entao o QS precisa de uma porta PROPRIA voltada pra Meta, e e ela que
-- alimenta esta tabela.
--
-- -- UMA LINHA POR EVENTO, NAO POR CHAMADA -----------------------------------
--
-- Uma chamada gera varios eventos (toca, conecta, encerra). Guardar um por
-- linha, em vez de atualizar um registro so, e o que permite reconstruir o que
-- aconteceu quando alguem disser "liguei e nao tocou". Estado atual = evento
-- mais recente daquele call_id.
--
-- -- POR QUE O PAYLOAD CRU VAI JUNTO ------------------------------------------
--
-- O formato exato do webhook `calls` nao foi verificado contra um evento real
-- (nenhum chegou ate agora). As colunas soltas sao extracao BEST-EFFORT; a
-- fonte da verdade e `payload`. Quando a primeira chamada de verdade cair
-- aqui, e o payload que vai dizer se os nomes de campo que eu chutei estao
-- certos — e sem ele nao haveria como descobrir sem pedir pro Bruno ligar de
-- novo.
-- ---------------------------------------------------------------------------

create table if not exists public.qs_wa_calls (
  id           bigserial primary key,
  call_id      text,
  evento       text,
  direcao      text,
  de           text,
  para         text,
  lead_id      uuid references qs_leads(id) on delete set null,
  sdp          text,
  sdp_tipo     text,
  payload      jsonb not null,
  recebido_em  timestamptz not null default now()
);

comment on table public.qs_wa_calls is
  'Eventos do webhook `calls` da Cloud API. Uma linha por evento (toca/conecta/encerra), com o payload cru como fonte da verdade enquanto o formato nao esta confirmado.';

create index if not exists idx_qs_wa_calls_recente on public.qs_wa_calls (recebido_em desc);
create index if not exists idx_qs_wa_calls_call on public.qs_wa_calls (call_id, recebido_em desc);

alter table public.qs_wa_calls enable row level security;

-- Quem escreve e o servidor (service_role ignora RLS). O app so LE.
--
-- `lead_id is null` entra de proposito: chamada de numero que ainda nao e lead
-- precisa TOCAR pra alguem. Esconder ate descobrir o dono e o mesmo que nao
-- atender. Sao dados de sinalizacao efemeros (quem ligou, quando), nao o
-- conteudo do lead.
drop policy if exists "wa_calls_leitura" on public.qs_wa_calls;
create policy "wa_calls_leitura" on public.qs_wa_calls
  for select to authenticated
  using (lead_id is null or qs_owns_lead(lead_id));
