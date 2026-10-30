-- 0227_viagens_correcao_manual.sql
-- -----------------------------------------------------------------------------
-- VIAGENS: CORREÇÃO MANUAL PELA TELA + VOOS QUE VALEM (Bruno, 30/10/2026).
--   "quando há inconsistência eu tenho que alterar por código, e isso não é a
--    forma correta" — e o caso do Vinícius (Turquia jun/2027 com "próximo voo
--    21/03/2026" e "pendente de checagem"). Auditoria: docs/AUDITORIA-VIAGENS-30-10.md.
--
-- 1) rel_viagem_trechos ganha a SITUAÇÃO MANUAL (voado / cancelado + motivo) e a
--    marca de CORRIGIDO À MÃO. Um gatilho faz o automático (sincronização do
--    Bitrix, importação das Expedições e a IA — todos com a chave service_role)
--    RESPEITAR a correção: não muda data/rota/tipo/situação de trecho corrigido
--    e não apaga trecho corrigido. Pessoa logada na tela edita normalmente.
-- 2) rel_viagens ganha o STATUS MANUAL (fase forçada + motivo, opcionalmente
--    até uma data) e os ALERTAS IGNORADOS (chave → motivo, quem, quando).
-- 3) rel_viagem_correcoes: o histórico de TODA correção — quem, quando, o valor
--    anterior e o novo, o motivo — e o DESFAZER (restaura o anterior).
-- 4) RPCs (security definer; só quem pode editar viagens no Relacionamento):
--      rel_corrigir_trecho(trecho, campos jsonb, motivo)
--      rel_trecho_situacao(trecho, 'voado'|'cancelado'|null, motivo)
--      rel_trecho_checkin(trecho, feito)
--      rel_viagem_corrigir_datas(viagem, embarque, retorno, motivo)   → trava as datas
--      rel_viagem_status_manual(viagem, fase|null, motivo, ate)
--      rel_viagem_ignorar_alerta(viagem, chave, motivo, ignorar)
--      rel_desfazer_correcao(correcao)
--      rel_correcoes_da_viagem(viagem)
-- 5) rel_viagens_v (partindo da definição VIGENTE = 0152; colunas novas só no
--    fim; security_invoker):
--      • trecho cancelado não conta; marcado como voado conta como feito e sai
--        do "próximo voo";
--      • voo sem horário (Bitrix / 00:00) continua "próximo" até o fim do dia;
--      • FASE = a manual (se valendo) ou a automática pela IDA/VOLTA REAIS: os
--        voos mandam quando parecem a ida/volta (1º voo até 2 dias depois do
--        embarque; último a partir de 2 dias antes da volta), senão as datas da
--        venda. Antes era LEAST/GREATEST (voo/venda), que esticava o "em viagem".
--      • novas: fase_auto, fase_manual*, ida_real, volta_real, voos_internos,
--        alertas_ignorados.
--    rel_trechos_v ganha status_manual*, corrigido_em/por no fim.
--
-- O front degrada sem esta migration (detecta a coluna fase_auto / a RPC).
-- Idempotente. Rollback no fim (comentado).
-- -----------------------------------------------------------------------------

-- ── 1. colunas ──────────────────────────────────────────────────────────────
alter table rel_viagem_trechos
  add column if not exists status_manual text,
  add column if not exists status_manual_motivo text,
  add column if not exists status_manual_por uuid references qs_users(id) on delete set null,
  add column if not exists status_manual_em timestamptz,
  add column if not exists corrigido_em timestamptz,
  add column if not exists corrigido_por uuid references qs_users(id) on delete set null;
alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_status_manual_check;
alter table rel_viagem_trechos add constraint rel_viagem_trechos_status_manual_check
  check (status_manual is null or status_manual in ('voado', 'cancelado'));

alter table rel_viagens
  add column if not exists fase_manual text,
  add column if not exists fase_manual_motivo text,
  add column if not exists fase_manual_por uuid references qs_users(id) on delete set null,
  add column if not exists fase_manual_em timestamptz,
  add column if not exists fase_manual_ate date,
  add column if not exists alertas_ignorados jsonb not null default '{}'::jsonb;
alter table rel_viagens drop constraint if exists rel_viagens_fase_manual_check;
alter table rel_viagens add constraint rel_viagens_fase_manual_check
  check (fase_manual is null or fase_manual in ('antes', 'em_viagem', 'concluida'));

-- ── 2. histórico das correções ──────────────────────────────────────────────
create table if not exists rel_viagem_correcoes (
  id           uuid primary key default gen_random_uuid(),
  viagem_id    uuid not null references rel_viagens(id) on delete cascade,
  trecho_id    uuid references rel_viagem_trechos(id) on delete set null,
  acao         text not null,          -- trecho_editado | trecho_situacao | trecho_checkin | datas | status_manual | alerta_ignorado
  antes        jsonb not null,         -- o registro (só as colunas restauráveis) ANTES
  depois       jsonb not null,         -- e DEPOIS
  motivo       text,
  feito_por    uuid references qs_users(id) on delete set null,
  feito_em     timestamptz not null default now(),
  desfeita_em  timestamptz,
  desfeita_por uuid references qs_users(id) on delete set null
);
create index if not exists rel_viagem_correcoes_viagem_idx on rel_viagem_correcoes (viagem_id, feito_em desc);
alter table rel_viagem_correcoes enable row level security;
drop policy if exists rel_viagem_correcoes_ler on rel_viagem_correcoes;
create policy rel_viagem_correcoes_ler on rel_viagem_correcoes for select
  using ((select rel_tem_acesso()) or (select ops_tem_acesso()));
-- grava só pelas funções abaixo (security definer) — sem policy de insert/update/delete

-- ── 3. o automático respeita a correção manual ──────────────────────────────
create or replace function rel_trecho_respeita_correcao()
returns trigger language plpgsql as $$
begin
  -- as funções de correção (abaixo) ligam esta marca: passam direto
  if coalesce(current_setting('rel.correcao_manual', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.corrigido_em is null and old.status_manual is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- pessoa logada na tela: vale o que ela fez. Só o automático (service_role) é barrado.
  if coalesce(auth.role(), '') <> 'service_role' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then return null; end if;   -- não apaga trecho corrigido
  new.tipo := old.tipo;
  new.partida_em := old.partida_em;   new.chegada_em := old.chegada_em;
  new.partida_fuso := old.partida_fuso; new.chegada_fuso := old.chegada_fuso;
  new.origem := old.origem;           new.destino := old.destino;
  new.origem_codigo := old.origem_codigo; new.destino_codigo := old.destino_codigo;
  new.numero := old.numero;           new.companhia := old.companhia;
  new.localizador := old.localizador;
  new.status_manual := old.status_manual; new.status_manual_motivo := old.status_manual_motivo;
  new.status_manual_por := old.status_manual_por; new.status_manual_em := old.status_manual_em;
  new.corrigido_em := old.corrigido_em; new.corrigido_por := old.corrigido_por;
  new.checkin_feito_em := old.checkin_feito_em; new.checkin_feito_por := old.checkin_feito_por;
  return new;
end;
$$;
drop trigger if exists rel_trecho_respeita_correcao_upd on rel_viagem_trechos;
create trigger rel_trecho_respeita_correcao_upd before update on rel_viagem_trechos
  for each row execute function rel_trecho_respeita_correcao();
drop trigger if exists rel_trecho_respeita_correcao_del on rel_viagem_trechos;
create trigger rel_trecho_respeita_correcao_del before delete on rel_viagem_trechos
  for each row execute function rel_trecho_respeita_correcao();

-- ── 4. funções de correção ──────────────────────────────────────────────────
-- colunas que a correção mexe e o desfazer restaura
create or replace function rel_trecho_restauravel(t rel_viagem_trechos) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'tipo', t.tipo, 'partida_em', t.partida_em, 'chegada_em', t.chegada_em,
    'partida_fuso', t.partida_fuso, 'chegada_fuso', t.chegada_fuso,
    'origem', t.origem, 'destino', t.destino, 'origem_codigo', t.origem_codigo, 'destino_codigo', t.destino_codigo,
    'companhia', t.companhia, 'numero', t.numero, 'localizador', t.localizador,
    'status_manual', t.status_manual, 'status_manual_motivo', t.status_manual_motivo,
    'status_manual_por', t.status_manual_por, 'status_manual_em', t.status_manual_em,
    'checkin_feito_em', t.checkin_feito_em, 'checkin_feito_por', t.checkin_feito_por,
    'corrigido_em', t.corrigido_em, 'corrigido_por', t.corrigido_por);
$$;

create or replace function rel_viagem_restauravel(v rel_viagens) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'data_embarque', v.data_embarque, 'data_retorno', v.data_retorno, 'datas_travadas', v.datas_travadas,
    'fase_manual', v.fase_manual, 'fase_manual_motivo', v.fase_manual_motivo, 'fase_manual_por', v.fase_manual_por,
    'fase_manual_em', v.fase_manual_em, 'fase_manual_ate', v.fase_manual_ate,
    'alertas_ignorados', v.alertas_ignorados);
$$;

create or replace function rel_correcao_checar(p_motivo text, p_exige_motivo boolean default true)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (rel_tem_acesso() and qs_pode('relacionamento.editar_viagens')) then
    raise exception 'Sem permissão pra corrigir viagens.';
  end if;
  if p_exige_motivo and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Diga o motivo da correção (fica no histórico).';
  end if;
end;
$$;

-- grava o trecho a partir de um jsonb com as colunas restauráveis
create or replace function rel_trecho_aplicar(p_trecho uuid, p_valores jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('rel.correcao_manual', '1', true);
  update rel_viagem_trechos x set
    (tipo, partida_em, chegada_em, partida_fuso, chegada_fuso, origem, destino, origem_codigo, destino_codigo,
     companhia, numero, localizador, status_manual, status_manual_motivo, status_manual_por, status_manual_em,
     checkin_feito_em, checkin_feito_por, corrigido_em, corrigido_por)
  = (select r.tipo, r.partida_em, r.chegada_em, r.partida_fuso, r.chegada_fuso, r.origem, r.destino, r.origem_codigo, r.destino_codigo,
            r.companhia, r.numero, r.localizador, r.status_manual, r.status_manual_motivo, r.status_manual_por, r.status_manual_em,
            r.checkin_feito_em, r.checkin_feito_por, r.corrigido_em, r.corrigido_por
       from jsonb_populate_record(null::rel_viagem_trechos, p_valores) r)
  where x.id = p_trecho;
  perform set_config('rel.correcao_manual', '', true);
end;
$$;

create or replace function rel_viagem_aplicar(p_viagem uuid, p_valores jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update rel_viagens x set
    (data_embarque, data_retorno, datas_travadas, fase_manual, fase_manual_motivo, fase_manual_por, fase_manual_em, fase_manual_ate, alertas_ignorados)
  = (select r.data_embarque, r.data_retorno, coalesce(r.datas_travadas, false), r.fase_manual, r.fase_manual_motivo, r.fase_manual_por,
            r.fase_manual_em, r.fase_manual_ate, coalesce(r.alertas_ignorados, '{}'::jsonb)
       from jsonb_populate_record(null::rel_viagens, p_valores) r)
  where x.id = p_viagem;
end;
$$;

-- corrigir data/rota/tipo/nº do trecho
create or replace function rel_corrigir_trecho(p_trecho uuid, p_campos jsonb, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t rel_viagem_trechos; antes jsonb; depois jsonb; k text; cid uuid;
  permitidos constant text[] := array['tipo','partida_em','chegada_em','partida_fuso','chegada_fuso','origem','destino',
                                      'origem_codigo','destino_codigo','companhia','numero','localizador'];
begin
  perform rel_correcao_checar(p_motivo);
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' or p_campos = '{}'::jsonb then raise exception 'Nada pra corrigir.'; end if;
  for k in select jsonb_object_keys(p_campos) loop
    if not (k = any(permitidos)) then raise exception 'O campo % não se corrige por aqui.', k; end if;
  end loop;
  select * into t from rel_viagem_trechos where id = p_trecho for update;
  if not found then raise exception 'Trecho não encontrado.'; end if;
  antes := rel_trecho_restauravel(t);
  depois := antes || p_campos || jsonb_build_object('corrigido_em', now(), 'corrigido_por', auth.uid());
  if (depois->>'chegada_em') is not null and (depois->>'chegada_em')::timestamptz < (depois->>'partida_em')::timestamptz then
    raise exception 'A chegada não pode ser antes da partida.';
  end if;
  perform rel_trecho_aplicar(p_trecho, depois);
  insert into rel_viagem_correcoes (viagem_id, trecho_id, acao, antes, depois, motivo, feito_por)
  values (t.viagem_id, p_trecho, 'trecho_editado', antes, depois, trim(p_motivo), auth.uid()) returning id into cid;
  return cid;
end;
$$;

-- marcar trecho como voado / cancelado (null = volta pro automático)
create or replace function rel_trecho_situacao(p_trecho uuid, p_situacao text, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t rel_viagem_trechos; antes jsonb; depois jsonb; cid uuid;
begin
  perform rel_correcao_checar(p_motivo, p_situacao is not null);
  if p_situacao is not null and p_situacao not in ('voado', 'cancelado') then raise exception 'Situação inválida: %', p_situacao; end if;
  select * into t from rel_viagem_trechos where id = p_trecho for update;
  if not found then raise exception 'Trecho não encontrado.'; end if;
  antes := rel_trecho_restauravel(t);
  depois := antes || jsonb_build_object(
    'status_manual', p_situacao, 'status_manual_motivo', case when p_situacao is null then null else trim(p_motivo) end,
    'status_manual_por', case when p_situacao is null then null else auth.uid() end,
    'status_manual_em', case when p_situacao is null then null else now() end);
  perform rel_trecho_aplicar(p_trecho, depois);
  insert into rel_viagem_correcoes (viagem_id, trecho_id, acao, antes, depois, motivo, feito_por)
  values (t.viagem_id, p_trecho, 'trecho_situacao', antes, depois, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid()) returning id into cid;
  return cid;
end;
$$;

-- check-in feito / desfeito (auditado; não exige motivo)
create or replace function rel_trecho_checkin(p_trecho uuid, p_feito boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare t rel_viagem_trechos; antes jsonb; depois jsonb; cid uuid;
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;
  select * into t from rel_viagem_trechos where id = p_trecho for update;
  if not found then raise exception 'Trecho não encontrado.'; end if;
  antes := rel_trecho_restauravel(t);
  depois := antes || jsonb_build_object('checkin_feito_em', case when p_feito then now() end, 'checkin_feito_por', case when p_feito then auth.uid() end);
  perform rel_trecho_aplicar(p_trecho, depois);
  insert into rel_viagem_correcoes (viagem_id, trecho_id, acao, antes, depois, motivo, feito_por)
  values (t.viagem_id, p_trecho, 'trecho_checkin', antes, depois, null, auth.uid()) returning id into cid;
  return cid;
end;
$$;

-- corrigir as datas da viagem (e travar: a sincronização do Bitrix não volta com as antigas)
create or replace function rel_viagem_corrigir_datas(p_viagem uuid, p_embarque date, p_retorno date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v rel_viagens; antes jsonb; depois jsonb; cid uuid;
begin
  perform rel_correcao_checar(p_motivo);
  if p_embarque is not null and p_retorno is not null and p_retorno < p_embarque then raise exception 'A volta não pode ser antes da ida.'; end if;
  select * into v from rel_viagens where id = p_viagem for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  antes := rel_viagem_restauravel(v);
  depois := antes || jsonb_build_object('data_embarque', p_embarque, 'data_retorno', p_retorno, 'datas_travadas', true);
  perform rel_viagem_aplicar(p_viagem, depois);
  insert into rel_viagem_correcoes (viagem_id, acao, antes, depois, motivo, feito_por)
  values (p_viagem, 'datas', antes, depois, trim(p_motivo), auth.uid()) returning id into cid;
  return cid;
end;
$$;

-- forçar o status da viagem (null = volta pro automático)
create or replace function rel_viagem_status_manual(p_viagem uuid, p_fase text, p_motivo text, p_ate date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v rel_viagens; antes jsonb; depois jsonb; cid uuid;
begin
  perform rel_correcao_checar(p_motivo, p_fase is not null);
  if p_fase is not null and p_fase not in ('antes', 'em_viagem', 'concluida') then raise exception 'Status inválido: %', p_fase; end if;
  select * into v from rel_viagens where id = p_viagem for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  antes := rel_viagem_restauravel(v);
  depois := antes || jsonb_build_object(
    'fase_manual', p_fase, 'fase_manual_motivo', case when p_fase is null then null else trim(p_motivo) end,
    'fase_manual_por', case when p_fase is null then null else auth.uid() end,
    'fase_manual_em', case when p_fase is null then null else now() end,
    'fase_manual_ate', case when p_fase is null then null else p_ate end);
  perform rel_viagem_aplicar(p_viagem, depois);
  insert into rel_viagem_correcoes (viagem_id, acao, antes, depois, motivo, feito_por)
  values (p_viagem, 'status_manual', antes, depois, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid()) returning id into cid;
  return cid;
end;
$$;

-- ignorar (ou voltar a mostrar) um alerta da viagem — a chave vem da tela (statusViagem.ts)
create or replace function rel_viagem_ignorar_alerta(p_viagem uuid, p_chave text, p_motivo text, p_ignorar boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v rel_viagens; antes jsonb; depois jsonb; cid uuid;
begin
  perform rel_correcao_checar(p_motivo, p_ignorar);
  if nullif(trim(coalesce(p_chave, '')), '') is null then raise exception 'Alerta sem chave.'; end if;
  select * into v from rel_viagens where id = p_viagem for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  antes := rel_viagem_restauravel(v);
  depois := antes || jsonb_build_object('alertas_ignorados',
    case when p_ignorar
      then coalesce(v.alertas_ignorados, '{}'::jsonb) || jsonb_build_object(p_chave, jsonb_build_object('motivo', trim(p_motivo), 'por', auth.uid(), 'em', now()))
      else coalesce(v.alertas_ignorados, '{}'::jsonb) - p_chave end);
  perform rel_viagem_aplicar(p_viagem, depois);
  insert into rel_viagem_correcoes (viagem_id, acao, antes, depois, motivo, feito_por)
  values (p_viagem, 'alerta_ignorado', antes, depois, coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'voltou a mostrar: ' || p_chave), auth.uid()) returning id into cid;
  return cid;
end;
$$;

-- desfazer: restaura o ANTES. Só a correção mais recente (ainda valendo) do mesmo
-- trecho/viagem — senão desfazer uma antiga apagaria as de depois.
create or replace function rel_desfazer_correcao(p_correcao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c rel_viagem_correcoes;
begin
  perform rel_correcao_checar(null, false);
  select * into c from rel_viagem_correcoes where id = p_correcao for update;
  if not found then raise exception 'Correção não encontrada.'; end if;
  if c.desfeita_em is not null then raise exception 'Essa correção já foi desfeita.'; end if;
  if exists (select 1 from rel_viagem_correcoes o
              where o.id <> c.id and o.desfeita_em is null and o.feito_em > c.feito_em
                and o.viagem_id = c.viagem_id
                and ((c.trecho_id is null and o.trecho_id is null) or o.trecho_id = c.trecho_id)) then
    raise exception 'Tem correção mais nova neste mesmo item — desfaça a mais recente primeiro.';
  end if;
  if c.trecho_id is not null then
    if not exists (select 1 from rel_viagem_trechos where id = c.trecho_id) then raise exception 'O trecho não existe mais.'; end if;
    perform rel_trecho_aplicar(c.trecho_id, c.antes);
  else
    perform rel_viagem_aplicar(c.viagem_id, c.antes);
  end if;
  update rel_viagem_correcoes set desfeita_em = now(), desfeita_por = auth.uid() where id = c.id;
end;
$$;

create or replace function rel_correcoes_da_viagem(p_viagem uuid)
returns table (id uuid, trecho_id uuid, acao text, antes jsonb, depois jsonb, motivo text,
               feito_por uuid, feito_por_nome text, feito_em timestamptz, desfeita_em timestamptz, desfeita_por_nome text)
language sql stable security definer set search_path = public as $$
  select c.id, c.trecho_id, c.acao, c.antes, c.depois, c.motivo, c.feito_por, u.name, c.feito_em, c.desfeita_em, d.name
    from rel_viagem_correcoes c
    left join qs_users u on u.id = c.feito_por
    left join qs_users d on d.id = c.desfeita_por
   where c.viagem_id = p_viagem and (rel_tem_acesso() or ops_tem_acesso())
   order by c.feito_em desc
   limit 200;
$$;

-- Postgres dá EXECUTE a PUBLIC por padrão (lição da 0153): fecha tudo e abre só pro logado.
do $$
declare f text;
begin
  foreach f in array array[
    'rel_correcao_checar(text, boolean)', 'rel_trecho_aplicar(uuid, jsonb)', 'rel_viagem_aplicar(uuid, jsonb)',
    'rel_corrigir_trecho(uuid, jsonb, text)', 'rel_trecho_situacao(uuid, text, text)', 'rel_trecho_checkin(uuid, boolean)',
    'rel_viagem_corrigir_datas(uuid, date, date, text)', 'rel_viagem_status_manual(uuid, text, text, date)',
    'rel_viagem_ignorar_alerta(uuid, text, text, boolean)', 'rel_desfazer_correcao(uuid)', 'rel_correcoes_da_viagem(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;
  -- as internas (aplicar/checar) não são chamadas da tela
  execute 'revoke all on function rel_trecho_aplicar(uuid, jsonb) from authenticated';
  execute 'revoke all on function rel_viagem_aplicar(uuid, jsonb) from authenticated';
  foreach f in array array[
    'rel_corrigir_trecho(uuid, jsonb, text)', 'rel_trecho_situacao(uuid, text, text)', 'rel_trecho_checkin(uuid, boolean)',
    'rel_viagem_corrigir_datas(uuid, date, date, text)', 'rel_viagem_status_manual(uuid, text, text, date)',
    'rel_viagem_ignorar_alerta(uuid, text, text, boolean)', 'rel_desfazer_correcao(uuid)', 'rel_correcoes_da_viagem(uuid)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── 5. views ────────────────────────────────────────────────────────────────
create or replace view rel_trechos_v with (security_invoker = true) as
 SELECT t.id, t.viagem_id, t.tipo, t.descricao, t.origem, t.destino, t.partida_em, t.chegada_em, t.companhia, t.numero,
    t.localizador, t.checkin_abre_em, t.checkin_feito_em, t.checkin_feito_por, t.criado_por, t.criado_em, t.ref_externa,
    t.fonte, t.ia_confianca, t.documento_id, t.origem_codigo, t.destino_codigo, t.partida_fuso, t.chegada_fuso,
    t.terminal_partida, t.terminal_chegada, t.classe, t.bagagem, t.assento, t.numero_bilhete, t.passageiros,
    t.ponto_encontro, t.contato, t.endereco, t.observacoes,
    COALESCE(t.checkin_abre_em,
        CASE
            WHEN t.tipo = ANY (ARRAY['voo_internacional'::text, 'voo_interno'::text]) THEN t.partida_em - '48:00:00'::interval
            WHEN t.tipo = 'trem'::text THEN t.partida_em - '24:00:00'::interval
            ELSE NULL::timestamp with time zone
        END) AS checkin_em,
    v.tipo AS viagem_tipo, v.titulo AS viagem_titulo, v.destino AS viagem_destino, v.expedicao, v.status AS viagem_status,
    -- 0227
    t.status_manual, t.status_manual_motivo, t.status_manual_por, t.status_manual_em, t.corrigido_em, t.corrigido_por
   FROM rel_viagem_trechos t
     JOIN rel_viagens v ON v.id = t.viagem_id;

create or replace view rel_viagens_v with (security_invoker = true) as
 SELECT v.id, v.titulo, v.destino, v.expedicao, v.tipo, v.data_venda, v.data_embarque, v.data_retorno, v.valor,
    v.qtd_passageiros, v.cliente_id, v.responsavel_id, v.bitrix_deal_id, v.status, v.observacoes, v.necessidades,
    v.origem, v.criado_em, v.atualizado_em,
    c.nome AS cliente_nome,
    c.telefone AS cliente_telefone,
    u.name AS responsavel_nome,
    -- a fase: a manual (se valendo) ou a automática pela ida/volta REAIS
    CASE
        WHEN v.status = 'cancelada'::text THEN 'cancelada'::text
        WHEN v.fase_manual IS NOT NULL AND (v.fase_manual_ate IS NULL OR rel_hoje() <= v.fase_manual_ate) THEN v.fase_manual
        WHEN iv.ida IS NULL THEN 'sem_data'::text
        WHEN rel_hoje() < iv.ida THEN 'antes'::text
        WHEN rel_hoje() <= iv.volta THEN 'em_viagem'::text
        ELSE 'concluida'::text
    END AS fase,
    v.data_embarque - rel_hoje() AS dias_para_embarque,
    (( SELECT count(*) FROM rel_viagem_passageiros p WHERE p.viagem_id = v.id))::integer AS passageiros,
    (( SELECT count(*) FROM rel_viagem_tarefas t WHERE t.viagem_id = v.id AND t.feita_em IS NULL AND t.prazo < rel_hoje()))::integer AS tarefas_atrasadas,
    (( SELECT count(*) FROM rel_viagem_tarefas t WHERE t.viagem_id = v.id AND t.feita_em IS NULL))::integer AS tarefas_pendentes,
    (( SELECT count(*) FROM rel_viagem_tarefas t WHERE t.viagem_id = v.id))::integer AS tarefas_total,
    COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)) AS servico,
    rel_acompanhamento(COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados))) AS acompanhamento,
    v.servico_manual,
    COALESCE(vo.total, 0) AS voos_total,
    COALESCE(vo.feitos, 0) AS voos_feitos,
    px.partida_em AS proximo_voo_em,
    px.partida_fuso AS proximo_voo_fuso,
    px.trecho AS proximo_voo_trecho,
    px.numero AS proximo_voo_numero,
    px.sem_hora AS proximo_voo_sem_hora,
    vo.ultimo_em AS ultimo_voo_em,
    -- 0227
    CASE
        WHEN v.status = 'cancelada'::text THEN 'cancelada'::text
        WHEN iv.ida IS NULL THEN 'sem_data'::text
        WHEN rel_hoje() < iv.ida THEN 'antes'::text
        WHEN rel_hoje() <= iv.volta THEN 'em_viagem'::text
        ELSE 'concluida'::text
    END AS fase_auto,
    v.fase_manual,
    v.fase_manual_motivo,
    v.fase_manual_por,
    v.fase_manual_em,
    v.fase_manual_ate,
    iv.ida AS ida_real,
    iv.volta AS volta_real,
    COALESCE(vo.internos, 0) AS voos_internos,
    v.alertas_ignorados
   FROM rel_viagens v
     LEFT JOIN rel_clientes c ON c.id = v.cliente_id
     LEFT JOIN qs_users u ON u.id = v.responsavel_id
     -- Os voos que VALEM: dentro de [embarque − 10 dias, retorno + 60 dias] e não
     -- cancelados à mão. Tem voo de verdade? Então o ida/volta genérico do Bitrix não conta.
     CROSS JOIN LATERAL ( SELECT v.data_embarque - 10 AS de,
            GREATEST(COALESCE(v.data_retorno, v.data_embarque), v.data_embarque) + 60 AS ate,
            (EXISTS ( SELECT 1 FROM rel_viagem_trechos x
                  WHERE x.viagem_id = v.id AND x.tipo ~~ 'voo%'::text AND x.partida_em IS NOT NULL
                    AND x.fonte IS DISTINCT FROM 'bitrix'::text AND x.status_manual IS DISTINCT FROM 'cancelado'::text
                    AND (v.data_embarque IS NULL OR (x.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date >= (v.data_embarque - 10)
                         AND (x.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date <= (GREATEST(COALESCE(v.data_retorno, v.data_embarque), v.data_embarque) + 60)))) AS tem_real) r
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS total,
            -- feito = já decolou (sem horário: o dia já acabou) ou marcado como voado
            count(*) FILTER (WHERE d.voado)::integer AS feitos,
            count(*) FILTER (WHERE d.tipo = 'voo_interno'::text)::integer AS internos,
            min((d.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date) AS primeiro_dia,
            max((COALESCE(d.chegada_em, d.partida_em) AT TIME ZONE 'America/Sao_Paulo'::text)::date) AS ultimo_dia,
            max(COALESCE(d.chegada_em, d.partida_em)) AS ultimo_em
           FROM ( SELECT DISTINCT ON (t.partida_em, (COALESCE(t.numero, (t.origem || '>'::text) || t.destino))) t.partida_em, t.chegada_em, t.tipo,
                    (t.status_manual = 'voado'::text OR
                     (CASE WHEN t.fonte = 'bitrix'::text OR to_char((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text), 'HH24:MI'::text) = '00:00'::text
                           THEN t.partida_em + '1 day'::interval ELSE t.partida_em END) <= now()) AS voado
                   FROM rel_viagem_trechos t
                  WHERE t.viagem_id = v.id AND t.tipo ~~ 'voo%'::text AND t.partida_em IS NOT NULL
                    AND t.status_manual IS DISTINCT FROM 'cancelado'::text
                    AND (t.fonte IS DISTINCT FROM 'bitrix'::text OR NOT r.tem_real)
                    AND (v.data_embarque IS NULL OR (t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date >= r.de AND (t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date <= r.ate)
                  ORDER BY t.partida_em, (COALESCE(t.numero, (t.origem || '>'::text) || t.destino)), (t.status_manual = 'voado'::text) DESC) d
         HAVING count(*) > 0 AND (v.data_embarque IS NOT NULL OR (max((d.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date) - min((d.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date)) <= 60)) vo ON true
     -- ida/volta REAIS: os voos quando parecem a ida/volta (±2 dias), senão as datas da venda
     CROSS JOIN LATERAL ( SELECT
            CASE WHEN vo.primeiro_dia IS NULL THEN v.data_embarque
                 WHEN v.data_embarque IS NULL OR vo.primeiro_dia <= v.data_embarque + 2 THEN vo.primeiro_dia
                 ELSE v.data_embarque END AS ida,
            CASE WHEN vo.ultimo_dia IS NULL THEN COALESCE(v.data_retorno, v.data_embarque)
                 WHEN COALESCE(v.data_retorno, v.data_embarque) IS NULL OR vo.ultimo_dia >= COALESCE(v.data_retorno, v.data_embarque) - 2 THEN vo.ultimo_dia
                 ELSE COALESCE(v.data_retorno, v.data_embarque) END AS volta0) iv0
     CROSS JOIN LATERAL ( SELECT iv0.ida, GREATEST(iv0.volta0, iv0.ida) AS volta) iv
     LEFT JOIN LATERAL ( SELECT t.partida_em, t.partida_fuso, t.numero,
            NULLIF(concat_ws('→'::text, rel_ponta_voo(t.origem_codigo, t.origem), rel_ponta_voo(t.destino_codigo, t.destino)), ''::text) AS trecho,
            t.fonte = 'bitrix'::text OR to_char((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text), 'HH24:MI'::text) = '00:00'::text AS sem_hora
           FROM rel_viagem_trechos t
          WHERE t.viagem_id = v.id AND t.tipo ~~ 'voo%'::text
            AND t.status_manual IS NULL                                  -- nem voado nem cancelado à mão
            AND (CASE WHEN t.fonte = 'bitrix'::text OR to_char((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text), 'HH24:MI'::text) = '00:00'::text
                      THEN t.partida_em + '1 day'::interval ELSE t.partida_em END) > now()
            AND (t.fonte IS DISTINCT FROM 'bitrix'::text OR NOT r.tem_real)
            AND (v.data_embarque IS NULL OR (t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date >= r.de AND (t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text)::date <= r.ate)
          ORDER BY t.partida_em, t.id
         LIMIT 1) px ON vo.total IS NOT NULL;

-- -----------------------------------------------------------------------------
-- ROLLBACK (rodar na ordem; volta as views da 0152/0139 e tira o resto):
--   -- 1) views: rodar de novo o "create or replace view rel_viagens_v" da 0152 NÃO
--   --    funciona (Postgres não deixa tirar colunas) — então:
--   drop view if exists rel_viagens_v;   -- e recriar com o texto da 0152 (seção da view)
--   drop view if exists rel_trechos_v;   -- e recriar com o texto da 0139
--   --    (conferir antes: select * from pg_depend/pg_views — nenhuma view depende delas hoje)
--   drop function if exists rel_correcoes_da_viagem(uuid);
--   drop function if exists rel_desfazer_correcao(uuid);
--   drop function if exists rel_viagem_ignorar_alerta(uuid, text, text, boolean);
--   drop function if exists rel_viagem_status_manual(uuid, text, text, date);
--   drop function if exists rel_viagem_corrigir_datas(uuid, date, date, text);
--   drop function if exists rel_trecho_checkin(uuid, boolean);
--   drop function if exists rel_trecho_situacao(uuid, text, text);
--   drop function if exists rel_corrigir_trecho(uuid, jsonb, text);
--   drop function if exists rel_viagem_aplicar(uuid, jsonb);
--   drop function if exists rel_trecho_aplicar(uuid, jsonb);
--   drop function if exists rel_correcao_checar(text, boolean);
--   drop function if exists rel_viagem_restauravel(rel_viagens);
--   drop function if exists rel_trecho_restauravel(rel_viagem_trechos);
--   drop trigger if exists rel_trecho_respeita_correcao_upd on rel_viagem_trechos;
--   drop trigger if exists rel_trecho_respeita_correcao_del on rel_viagem_trechos;
--   drop function if exists rel_trecho_respeita_correcao();
--   drop table if exists rel_viagem_correcoes;          -- perde o histórico das correções
--   alter table rel_viagens drop constraint if exists rel_viagens_fase_manual_check;
--   alter table rel_viagens drop column if exists alertas_ignorados, drop column if exists fase_manual_ate,
--     drop column if exists fase_manual_em, drop column if exists fase_manual_por,
--     drop column if exists fase_manual_motivo, drop column if exists fase_manual;
--   alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_status_manual_check;
--   alter table rel_viagem_trechos drop column if exists corrigido_por, drop column if exists corrigido_em,
--     drop column if exists status_manual_em, drop column if exists status_manual_por,
--     drop column if exists status_manual_motivo, drop column if exists status_manual;
-- -----------------------------------------------------------------------------
