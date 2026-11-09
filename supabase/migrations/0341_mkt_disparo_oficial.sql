-- =============================================================================
-- 0341 — DISPARO OFICIAL DO MARKETING (Cloud API da Meta, modelos aprovados)
-- =============================================================================
-- Pedido do Bruno (09/11/2026): deixar PRONTO o disparo em massa do Marketing
-- pela API oficial (o "broadcast" do ManyChat), com as travas desligadas.
--
-- O QUE TEM AQUI (tudo aditivo; Comercial e Rel não usam nada disto):
--   1. mkt_wa_modelos — cópia dos modelos da WABA do número do Marketing
--      (GET /{waba}/message_templates). Só o APPROVED vira disparo.
--   2. qs_disparo_campanhas: modelo_categoria + envio_extra (mídia do topo,
--      variável do topo e sufixo dos botões de link). Só o Marketing preenche.
--   3. qs_disparo_envios: erro_codigo + cobranca_categoria + cobravel (o
--      `pricing` do recibo da Meta) — o custo estimado sai daqui.
--   4. mkt_disparo_contar(phone, desde, simulado) — contatos ÚNICOS que o número
--      já recebeu desde X (teto do tier em 24 h e do dia). Só service_role.
--   5. mkt_disparo_kpis(campanha) — os números do "ao vivo". Só service_role
--      (a tela chama pela rota /api/disparos, que confere o cargo).
--   6. qs_settings: mkt_disparo_simulacao (true), mkt_disparo_ritmo, mkt_disparo_precos.
--
-- "Não mandar 2x pro mesmo contato na mesma campanha" já é o unique
-- (campanha_id, telefone) de qs_disparo_envios (0217) — nada a criar.
--
-- Idempotente. NÃO aplicada por quem escreveu: o Bruno aplica.
-- =============================================================================

-- ── 1. Modelos da WABA do Marketing ─────────────────────────────────────────
create table if not exists mkt_wa_modelos (
  id                 uuid primary key default gen_random_uuid(),
  meta_id            text,
  waba_id            text,
  nome               text not null,
  idioma             text not null default 'pt_BR',
  categoria          text,               -- MARKETING | UTILITY | AUTHENTICATION
  status             text,               -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  formato_parametros text not null default 'POSITIONAL',  -- POSITIONAL | NAMED
  corpo              text not null default '',
  cabecalho_formato  text,               -- TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
  cabecalho_texto    text,
  rodape             text,
  botoes             jsonb not null default '[]',
  componentes        jsonb not null default '[]',
  motivo             text,               -- rejected_reason
  sincronizado_em    timestamptz not null default now(),
  unique (nome, idioma)
);
create index if not exists mkt_wa_modelos_status_idx on mkt_wa_modelos (status);

alter table mkt_wa_modelos enable row level security;
drop policy if exists mkt_wa_modelos_ler on mkt_wa_modelos;
create policy mkt_wa_modelos_ler on mkt_wa_modelos for select to authenticated using (mkt_tem_acesso());
grant select on mkt_wa_modelos to authenticated;
revoke insert, update, delete on mkt_wa_modelos from authenticated;
revoke all on mkt_wa_modelos from anon;

-- ── 2. Campanha: categoria e extras do envio ────────────────────────────────
-- envio_extra (só Marketing):
--   {"midia": {"link": "https://…", "nome": "roteiro.pdf"} | {"id": "<media_id>"},
--    "topo": {"fonte": "nome"|"texto"|"campo"|"destino", "valor": "…"},
--    "botoes": {"0": {"fonte": "texto", "valor": "japao-2027"}}}
alter table qs_disparo_campanhas add column if not exists modelo_categoria text;
alter table qs_disparo_campanhas add column if not exists envio_extra jsonb not null default '{}';

-- ── 3. Envio: código do erro e cobrança ─────────────────────────────────────
alter table qs_disparo_envios add column if not exists erro_codigo        int;
alter table qs_disparo_envios add column if not exists cobranca_categoria text;
alter table qs_disparo_envios add column if not exists cobravel           boolean;

-- ── 4. Contador do teto (contatos únicos) ───────────────────────────────────
-- count(distinct) no banco: contar linhas pelo PostgREST para em 1000.
create or replace function mkt_disparo_contar(p_phone text, p_desde timestamptz, p_simulado boolean default false)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct e.telefone)::int
    from qs_disparo_envios e
   where e.phone_number_id = p_phone
     and e.enviado_em >= p_desde
     and e.simulado = coalesce(p_simulado, false);
$$;
revoke all on function mkt_disparo_contar(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function mkt_disparo_contar(text, timestamptz, boolean) to service_role;

-- ── 5. KPIs de uma campanha (o "ao vivo") ───────────────────────────────────
create or replace function mkt_disparo_kpis(p_campanha uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total',       count(*),
    'na_fila',     count(*) filter (where status = 'pendente'),
    'enviados',    count(*) filter (where status in ('enviado', 'entregue', 'lido', 'respondeu')),
    'entregues',   count(*) filter (where status in ('entregue', 'lido', 'respondeu')),
    'lidos',       count(*) filter (where status in ('lido', 'respondeu')),
    'responderam', count(*) filter (where status = 'respondeu'),
    'falharam',    count(*) filter (where status = 'erro'),
    'pulados',     count(*) filter (where status = 'pulado'),
    'cancelados',  count(*) filter (where status = 'cancelado'),
    'simulados',   count(*) filter (where simulado),
    'cobraveis',   coalesce((select jsonb_object_agg(cat, n) from (
                      select coalesce(cobranca_categoria, 'marketing') as cat, count(*) as n
                        from qs_disparo_envios
                       where campanha_id = p_campanha and not simulado
                         and (cobravel is true or (cobravel is null and status in ('entregue', 'lido', 'respondeu')))
                       group by 1) x), '{}'::jsonb),
    'erros',       coalesce((select jsonb_object_agg(cod, n) from (
                      select coalesce(erro_codigo::text, 'sem código') as cod, count(*) as n
                        from qs_disparo_envios
                       where campanha_id = p_campanha and status = 'erro'
                       group by 1) y), '{}'::jsonb),
    'ultimo_envio', max(enviado_em)
  )
  from qs_disparo_envios where campanha_id = p_campanha;
$$;
revoke all on function mkt_disparo_kpis(uuid) from public, anon, authenticated;
grant execute on function mkt_disparo_kpis(uuid) to service_role;

-- ── 6. Configuração ─────────────────────────────────────────────────────────
-- mkt_disparo_simulacao: o interruptor do MARKETING (o do Comercial/Rel é
--   disparo_simulacao e continua mandando lá). true = nada sai de verdade.
-- mkt_disparo_ritmo: por_segundo (pausa entre envios, teto Meta = 80/s),
--   por_dia (teto do QS), margem_tier (fração do limite do tier que o QS
--   usa — o limite é do PORTFÓLIO), janela em Brasília, tier_padrao (quando
--   não dá pra ler da Meta).
-- mkt_disparo_precos: preço por mensagem ENTREGUE por categoria, pra estimar o
--   custo. Começa vazio: preencher com a tabela da Meta (Brasil) em
--   https://developers.facebook.com/docs/whatsapp/pricing (rate cards).
insert into qs_settings (key, value) values ('mkt_disparo_simulacao', 'true'::jsonb)
on conflict (key) do nothing;
insert into qs_settings (key, value) values ('mkt_disparo_ritmo',
  '{"por_segundo": 5, "por_dia": 1000, "margem_tier": 0.8, "inicio": "09:00", "fim": "20:00", "dias": [1,2,3,4,5,6], "tier_padrao": "TIER_250"}'::jsonb)
on conflict (key) do nothing;
insert into qs_settings (key, value) values ('mkt_disparo_precos',
  '{"moeda": "BRL", "marketing": null, "utility": null, "authentication": null}'::jsonb)
on conflict (key) do nothing;

-- =============================================================================
-- CONFERÊNCIA (depois de aplicar):
--   select * from mkt_wa_modelos limit 1;                          -- vazio até sincronizar
--   select mkt_disparo_contar('123', now() - interval '24 hours');  -- como service_role = 0
--   select key, value from qs_settings where key like 'mkt_disparo_%';
--   -- como authenticated: deve FALHAR (permission denied)
--   select mkt_disparo_kpis(gen_random_uuid());
--
-- ROLLBACK (na mão, nesta ordem):
--   drop function if exists mkt_disparo_kpis(uuid);
--   drop function if exists mkt_disparo_contar(text, timestamptz, boolean);
--   alter table qs_disparo_envios drop column if exists cobravel, drop column if exists cobranca_categoria, drop column if exists erro_codigo;
--   alter table qs_disparo_campanhas drop column if exists envio_extra, drop column if exists modelo_categoria;
--   drop table if exists mkt_wa_modelos;
--   delete from qs_settings where key in ('mkt_disparo_simulacao', 'mkt_disparo_ritmo', 'mkt_disparo_precos');
-- =============================================================================
