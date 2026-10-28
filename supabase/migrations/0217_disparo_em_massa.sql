-- =============================================================================
-- 0217 — DISPARO EM MASSA (Comercial) + REMARKETING (Relacionamento)
-- =============================================================================
-- Pedido do Bruno (28/10/2026):
--   "disparo em massa pelo número dos SDRs e com filtros, assim conseguindo
--    disparar para uma base completa de clientes (sempre com base em uma
--    cadência)" + no Rel: "disparos para a base e alimentar os grupos".
--
-- UM MOTOR SÓ (api/disparos.js) pros dois setores:
--   • comercial      → público = qs_leads; cada lead sai pelo número (Cloud API /
--                      Coexistência) do SDR DONO; o envio é o PASSO 1 da cadência
--                      escolhida (quem não responde segue os próximos passos).
--   • relacionamento → público = rel_clientes (viagens passadas, retorno, sem
--                      viagem futura, nível do clube); sai pelo número do Rel;
--                      pode levar o link do grupo da expedição ({{n}} = link_grupo).
--
-- REGRAS DA CASA (não se negociam):
--   • SÓ API oficial da Meta e SÓ modelo (template) aprovado. Nada de Evolution/QR.
--     Motivo: bloqueio de 24 h da Meta (1ª msg pra quem nunca escreveu + texto
--     igual em massa) — ver memória "whatsapp-bloqueio-24h-analise".
--   • Ritmo com teto por número por hora/dia, só em horário comercial.
--   • Começa em SIMULAÇÃO (qs_settings.disparo_simulacao = true): registra tudo,
--     não manda nada, não cria tarefa, não mexe em lead.
--
-- O QUE TEM AQUI
--   1. qs_disparo_campanhas  — a campanha (modelo, variáveis, público, cadência, estado)
--   2. qs_disparo_envios     — a fila: uma linha por telefone, com o funil
--                              pendente → enviado → entregue → lido → respondeu (ou pulado/erro/cancelado)
--   3. qs_disparo_publico(jsonb)     — quem a campanha do Comercial atinge (só servidor)
--   4. qs_disparo_publico_rel(jsonb) — quem a campanha do Rel atinge (só servidor)
--   5. qs_disparo_resumo(uuid)       — contadores do painel (lê o funil da fila)
--   6. chaves em qs_settings: disparo_simulacao, disparo_ritmo, disparo_modelos
--   7. RLS: só LEITURA pra quem pode (qs_pode('<setor>.disparos')) e pro SDR
--      dono (os envios dos leads dele). Escrever é só pelo servidor (service_role).
--
-- Idempotente: pode rodar de novo sem estrago.
-- =============================================================================

-- ── 1. Campanhas ─────────────────────────────────────────────────────────────
-- `params`: de onde vem cada {{n}} do modelo. Ex.:
--   {"1": {"fonte": "nome"}, "2": {"fonte": "sdr"}, "3": {"fonte": "texto", "valor": "Japão"}}
--   Fontes: nome | sdr | destino | link_grupo | texto
-- `publico` (comercial): {"segmentos":[], "sdrs":[], "status":[], "cadencias":[],
--   "entrada_de":"2026-01-01", "entrada_ate":"...", "tags":[], "respondeu":"sim|nao|"}
-- `publico` (relacionamento): {"expedicao":"", "destino":"", "retorno_de":"",
--   "retorno_ate":"", "sem_viagem_futura":true, "niveis":["Viajante",...], "viajou":"sim|nao|"}
create table if not exists qs_disparo_campanhas (
  id             uuid primary key default gen_random_uuid(),
  setor          text not null default 'comercial' check (setor in ('comercial', 'relacionamento')),
  nome           text not null check (length(trim(nome)) >= 2),
  modelo_nome    text not null,
  modelo_idioma  text not null default 'pt_BR',
  -- Cópia do corpo no momento da criação: o painel mostra o texto mesmo se o
  -- modelo sumir da Meta depois. O ENVIO nunca usa isto como verdade.
  modelo_corpo   text,
  params         jsonb not null default '{}',
  publico        jsonb not null default '{}',
  -- Comercial: obrigatória (o disparo é o passo 1 dela). Rel: não usa.
  cadence_id     uuid references qs_cadences(id) on delete set null,
  -- Rel: link de convite do grupo da expedição (vira a variável link_grupo).
  grupo_link     text,
  status         text not null default 'rascunho'
                 check (status in ('rascunho', 'enviando', 'pausada', 'cancelada', 'concluida')),
  total          integer not null default 0,
  ultimo_erro    text,
  criado_por     uuid references qs_users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  iniciada_em    timestamptz,
  pausada_em     timestamptz,
  concluida_em   timestamptz,
  cancelada_em   timestamptz
);
create index if not exists qs_disparo_campanhas_status_idx on qs_disparo_campanhas (status, iniciada_em);

-- ── 2. Fila de envios ────────────────────────────────────────────────────────
-- Uma linha por TELEFONE por campanha (unique): a mesma pessoa não recebe duas
-- vezes a mesma campanha, mesmo com duas fichas/leads no mesmo número.
-- `pego_em` é a trava do cron (pendente com pego_em velho = envio que morreu
-- no meio e volta pra fila). `simulado` = registrado em modo simulação.
create table if not exists qs_disparo_envios (
  id               uuid primary key default gen_random_uuid(),
  campanha_id      uuid not null references qs_disparo_campanhas(id) on delete cascade,
  lead_id          uuid references qs_leads(id) on delete set null,
  cliente_id       uuid references rel_clientes(id) on delete set null,
  viagem_id        uuid references rel_viagens(id) on delete set null,
  sdr_id           uuid references qs_users(id) on delete set null,
  phone_number_id  text,
  nome             text,
  telefone         text not null,
  status           text not null default 'pendente'
                   check (status in ('pendente', 'pulado', 'enviado', 'entregue', 'lido', 'respondeu', 'erro', 'cancelado')),
  motivo           text,
  wamid            text,
  simulado         boolean not null default false,
  tentativas       integer not null default 0,
  pego_em          timestamptz,
  enviado_em       timestamptz,
  entregue_em      timestamptz,
  lido_em          timestamptz,
  respondeu_em     timestamptz,
  cadencia_em      timestamptz,
  criado_em        timestamptz not null default now(),
  unique (campanha_id, telefone)
);
create index if not exists qs_disparo_envios_campanha_idx on qs_disparo_envios (campanha_id, status);
-- Teto por número por hora/dia: conta os enviados recentes de cada número.
create index if not exists qs_disparo_envios_ritmo_idx on qs_disparo_envios (phone_number_id, enviado_em) where enviado_em is not null;
create index if not exists qs_disparo_envios_wamid_idx on qs_disparo_envios (wamid) where wamid is not null;
create index if not exists qs_disparo_envios_lead_idx on qs_disparo_envios (lead_id, enviado_em) where lead_id is not null;
create index if not exists qs_disparo_envios_cliente_idx on qs_disparo_envios (cliente_id, enviado_em) where cliente_id is not null;

-- ── 3. Público do Comercial ──────────────────────────────────────────────────
-- Devolve TODO mundo que bate no filtro, com as marcas que o servidor usa pra
-- excluir com motivo (optout, conversa aberta < 24 h, ganho). Telefone
-- inválido, número proibido (1935/NUMEROS_PROIBIDOS), número do time e SDR sem
-- número conectado o servidor confere (precisa da Vercel/qs_wa_numeros_meta).
create or replace function qs_disparo_publico(p_publico jsonb)
returns table (
  lead_id uuid, nome text, telefone text, owner_id uuid, status text, segment text,
  cadence_id uuid, optout boolean, conversa_24h boolean, ja_respondeu boolean, disparo_recente boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  segs   text[] := array(select jsonb_array_elements_text(coalesce(p_publico -> 'segmentos', '[]')));
  sdrs   uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p_publico -> 'sdrs', '[]')) x);
  sts    text[] := array(select jsonb_array_elements_text(coalesce(p_publico -> 'status', '[]')));
  cads   uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p_publico -> 'cadencias', '[]')) x);
  tgs    text[] := array(select jsonb_array_elements_text(coalesce(p_publico -> 'tags', '[]')));
  resp   text   := coalesce(p_publico ->> 'respondeu', '');
  -- Datas de entrada em horário de Brasília (ver memória postgres-date-at-time-zone:
  -- `date AT TIME ZONE` erra 6 h; aqui monta o timestamptz com -03 explícito).
  de     timestamptz := case when nullif(p_publico ->> 'entrada_de', '') is null then null
                             else ((p_publico ->> 'entrada_de') || ' 00:00:00-03')::timestamptz end;
  ate    timestamptz := case when nullif(p_publico ->> 'entrada_ate', '') is null then null
                             else ((p_publico ->> 'entrada_ate') || ' 23:59:59-03')::timestamptz end;
  dias   int := coalesce(nullif(p_publico ->> 'intervalo_dias', '')::int, 7);
begin
  return query
    select l.id,
           coalesce(nullif(trim(l.full_name), ''), trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, ''))),
           l.phone, l.owner_id, l.status, l.segment, l.cadence_id,
           (l.optout_whatsapp_em is not null),
           exists (select 1 from qs_wa_messages m
                    where m.lead_id = l.id and m.direction = 'in' and m.sent_at >= now() - interval '24 hours'),
           exists (select 1 from qs_wa_messages m where m.lead_id = l.id and m.direction = 'in'),
           exists (select 1 from qs_disparo_envios e
                    where e.lead_id = l.id and e.enviado_em >= now() - make_interval(days => dias) and not e.simulado)
      from qs_leads l
     where l.phone is not null and length(regexp_replace(l.phone, '\D', '', 'g')) >= 10
       and (cardinality(segs) = 0 or l.segment = any(segs))
       and (cardinality(sdrs) = 0 or l.owner_id = any(sdrs))
       and (cardinality(sts)  = 0 or l.status = any(sts))
       and (cardinality(cads) = 0 or l.cadence_id = any(cads))
       and (de  is null or coalesce(l.arrived_at, l.created_at) >= de)
       and (ate is null or coalesce(l.arrived_at, l.created_at) <= ate)
       and (cardinality(tgs) = 0 or exists (select 1 from qs_tasks t where t.lead_id = l.id and t.tags && tgs))
       and (resp = ''
            or (resp = 'sim' and exists (select 1 from qs_wa_messages m where m.lead_id = l.id and m.direction = 'in'))
            or (resp = 'nao' and not exists (select 1 from qs_wa_messages m where m.lead_id = l.id and m.direction = 'in')))
     order by coalesce(l.arrived_at, l.created_at) desc;
end;
$$;
revoke all on function qs_disparo_publico(jsonb) from public, anon, authenticated;

-- ── 4. Público do Relacionamento (remarketing) ───────────────────────────────
-- Uma linha por cliente (ficha viva, não arquivada), com a ÚLTIMA viagem já
-- feita (vira {{destino}}), quantas viagens tem (nível do clube, mesma régua de
-- src/expedicoes/lib/fidelidade.ts: 1 Viajante · 3 Explorador · 5 Aventureiro ·
-- 10 Lenda) e se tem viagem futura.
create or replace function qs_disparo_publico_rel(p_publico jsonb)
returns table (
  cliente_id uuid, nome text, telefone text, viagem_id uuid, destino text, n_viagens int,
  nivel text, tem_futura boolean, optout boolean, conversa_24h boolean, disparo_recente boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  exped  text := nullif(trim(p_publico ->> 'expedicao'), '');
  dest   text := nullif(trim(p_publico ->> 'destino'), '');
  r_de   date := nullif(p_publico ->> 'retorno_de', '')::date;
  r_ate  date := nullif(p_publico ->> 'retorno_ate', '')::date;
  sem_fut boolean := coalesce((p_publico ->> 'sem_viagem_futura')::boolean, false);
  niveis text[] := array(select jsonb_array_elements_text(coalesce(p_publico -> 'niveis', '[]')));
  viajou text := coalesce(p_publico ->> 'viajou', '');
  dias   int := coalesce(nullif(p_publico ->> 'intervalo_dias', '')::int, 7);
begin
  return query
  with vg as (
    select p.cliente_id, v.id as viagem_id, v.destino, v.titulo, v.expedicao, v.data_embarque,
           coalesce(v.data_retorno, v.data_embarque) as volta
      from rel_viagem_passageiros p
      join rel_viagens v on v.id = p.viagem_id
     where v.status = 'ativa' and v.mesclada_em_id is null and v.arquivado_em is null
  ),
  por_cliente as (
    select c.id, c.nome, c.telefone,
           (select count(distinct x.viagem_id)::int from vg x where x.cliente_id = c.id and x.volta < hoje) as n,
           exists (select 1 from vg x where x.cliente_id = c.id and x.data_embarque >= hoje) as futura,
           -- A viagem que casa com o filtro (ou a última feita, sem filtro de viagem).
           (select x.viagem_id from vg x
             where x.cliente_id = c.id and x.volta < hoje
               and (exped is null or x.expedicao ilike '%' || exped || '%')
               and (dest  is null or x.destino ilike '%' || dest || '%' or x.titulo ilike '%' || dest || '%')
               and (r_de  is null or x.volta >= r_de)
               and (r_ate is null or x.volta <= r_ate)
             order by x.volta desc limit 1) as viagem_ok
      from rel_clientes c
     where c.mesclado_em_id is null and c.arquivado_em is null
       and c.telefone is not null and length(regexp_replace(c.telefone, '\D', '', 'g')) >= 10
  )
  select pc.id, pc.nome, pc.telefone, pc.viagem_ok,
         (select coalesce(v.destino, v.titulo) from rel_viagens v where v.id = pc.viagem_ok),
         pc.n,
         case when pc.n >= 10 then 'Lenda' when pc.n >= 5 then 'Aventureiro' when pc.n >= 3 then 'Explorador'
              when pc.n >= 1 then 'Viajante' else 'Estreante' end,
         pc.futura,
         rel_cliente_optout(pc.id),
         -- A conversa guarda o número como a Meta manda (às vezes SEM o 9º
         -- dígito): compara 55+DDD e os 8 finais, não a string crua.
         exists (select 1 from rel_wa_conversas w
                  where left(w.telefone, 4) = left(regexp_replace(pc.telefone, '\D', '', 'g'), 4)
                    and right(w.telefone, 8) = right(regexp_replace(pc.telefone, '\D', '', 'g'), 8)
                    and w.ultima_entrada_em >= now() - interval '24 hours'),
         exists (select 1 from qs_disparo_envios e
                  where e.cliente_id = pc.id and e.enviado_em >= now() - make_interval(days => dias) and not e.simulado)
    from por_cliente pc
   where (not sem_fut or not pc.futura)
     -- Filtro de viagem (expedição/destino/retorno) exige uma viagem que case.
     and ((exped is null and dest is null and r_de is null and r_ate is null) or pc.viagem_ok is not null)
     and (viajou = '' or (viajou = 'sim' and pc.n > 0) or (viajou = 'nao' and pc.n = 0))
     and (cardinality(niveis) = 0 or
          (case when pc.n >= 10 then 'Lenda' when pc.n >= 5 then 'Aventureiro' when pc.n >= 3 then 'Explorador'
                when pc.n >= 1 then 'Viajante' else 'Estreante' end) = any(niveis))
   order by pc.n desc, pc.nome;
end;
$$;
revoke all on function qs_disparo_publico_rel(jsonb) from public, anon, authenticated;

-- ── 5. Resumo do painel ──────────────────────────────────────────────────────
-- O funil é CUMULATIVO: quem respondeu também foi entregue e enviado. Assim o
-- painel lê "200 enviados → 180 entregues → 120 lidos → 14 responderam".
-- security INVOKER: na tela, a RLS dos envios vale (cada um conta o que pode ver).
create or replace function qs_disparo_resumo(p_campanha uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total',      count(*),
    'pendentes',  count(*) filter (where status = 'pendente'),
    'pulados',    count(*) filter (where status = 'pulado'),
    'cancelados', count(*) filter (where status = 'cancelado'),
    'erros',      count(*) filter (where status = 'erro'),
    'enviados',   count(*) filter (where status in ('enviado', 'entregue', 'lido', 'respondeu')),
    'entregues',  count(*) filter (where status in ('entregue', 'lido', 'respondeu')),
    'lidos',      count(*) filter (where status in ('lido', 'respondeu')),
    'responderam',count(*) filter (where status = 'respondeu'),
    'simulados',  count(*) filter (where simulado),
    'na_cadencia',count(*) filter (where cadencia_em is not null)
  )
  from qs_disparo_envios where campanha_id = p_campanha;
$$;
revoke all on function qs_disparo_resumo(uuid) from public, anon;
grant execute on function qs_disparo_resumo(uuid) to authenticated;

-- ── 6. Configuração (qs_settings) ────────────────────────────────────────────
-- disparo_simulacao: o interruptor de segurança. true = nada sai de verdade.
-- disparo_ritmo: teto POR NÚMERO (cada SDR tem o seu), janela em horário de
--   Brasília (0=dom … 6=sáb) e o intervalo mínimo entre dois disparos pra
--   mesma pessoa. Números conservadores: número de Coexistência começa com
--   limite baixo na Meta e qualidade "baixa" trava até o atendimento.
-- disparo_modelos: os modelos montados na tela (rascunho → enviado à Meta →
--   aprovado). Só os "aprovado" aparecem pra campanha.
insert into qs_settings (key, value) values ('disparo_simulacao', 'true'::jsonb)
on conflict (key) do nothing;
insert into qs_settings (key, value) values ('disparo_ritmo',
  '{"por_hora": 30, "por_dia": 150, "inicio": "09:30", "fim": "18:30", "dias": [1,2,3,4,5], "intervalo_dias": 7}'::jsonb)
on conflict (key) do nothing;
insert into qs_settings (key, value) values ('disparo_modelos', '[]'::jsonb)
on conflict (key) do nothing;

-- ── 7. RLS: leitura pra quem pode; escrita só pelo servidor ─────────────────
alter table qs_disparo_campanhas enable row level security;
alter table qs_disparo_envios    enable row level security;

drop policy if exists qs_disparo_campanhas_ler on qs_disparo_campanhas;
create policy qs_disparo_campanhas_ler on qs_disparo_campanhas for select to authenticated
  using (qs_pode(setor || '.disparos'));

drop policy if exists qs_disparo_envios_ler on qs_disparo_envios;
create policy qs_disparo_envios_ler on qs_disparo_envios for select to authenticated
  using (
    sdr_id = auth.uid()
    or exists (select 1 from qs_disparo_campanhas c where c.id = campanha_id and qs_pode(c.setor || '.disparos'))
  );

grant select on qs_disparo_campanhas, qs_disparo_envios to authenticated;
revoke insert, update, delete on qs_disparo_campanhas, qs_disparo_envios from anon, authenticated;

-- =============================================================================
-- ROLLBACK (rodar na mão, nesta ordem):
--   drop function if exists qs_disparo_resumo(uuid);
--   drop function if exists qs_disparo_publico_rel(jsonb);
--   drop function if exists qs_disparo_publico(jsonb);
--   drop table if exists qs_disparo_envios;
--   drop table if exists qs_disparo_campanhas;
--   delete from qs_settings where key in ('disparo_simulacao', 'disparo_ritmo', 'disparo_modelos');
-- =============================================================================
