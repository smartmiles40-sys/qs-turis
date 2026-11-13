-- 0385_ponte_exp_voos_datas_rel.sql
-- -----------------------------------------------------------------------------
-- PONTE PÓS-VENDA (1/5) — EXPEDIÇÕES → REL: VOOS E DATAS AO VIVO (13/11/2026).
--
-- POR QUÊ: os trechos de voo do Rel que vêm de Expedições (rel_viagem_trechos,
-- fonte = 'expedicoes', ref_externa = 'exp-voo:<id do voo>') nasceram de UMA
-- importação (scripts/importar-expedicoes.mjs:345) e nunca mais andaram.
-- Auditoria de 13/11: 159 viagens ativas com data ≠ da expedição, 83 voos sem
-- trecho, 91 voos editados depois da importação. expedicoes só tinha gatilho de
-- auditoria/updated_at; expedicao_voos, nenhum.
--
-- O QUE FAZ:
--   • ponte_trechos_expedicao_sincronizar(viagem): olha os passageiros ATIVOS
--     (Confirmado/Pré-reserva, Pagante/Cortesia — a mesma régua da importação)
--     ligados à viagem por rel_expedicoes_vinculo, calcula os voos de cada um
--     (grupo, extensão, voo só de um passageiro, "apenas sem extensão" — igual a
--     voosDoPax da importação) e:
--       – cria/atualiza o trecho 'exp-voo:<id>' (hora do bilhete no fuso do
--         aeroporto, igual a quando()/fusoDe() da importação);
--       – trecho que saiu (voo apagado, passageiro trocou de grupo/extensão ou
--         foi cancelado) fica CANCELADO (status_manual = 'cancelado', motivo
--         começando com "Expedições:") — nada é apagado;
--       – se o voo volta, o cancelamento automático é desfeito;
--       – trecho CORRIGIDO À MÃO no Rel (corrigido_em) ou com situação manual
--         (status_manual posto por gente) NÃO é tocado.
--   • gatilhos: expedicao_voos (insert/update/delete), passageiro_extensao
--     (insert/delete), expedicoes e grupos_expedicao (datas).
--   • datas: quando a expedição (ou o grupo) muda de data, a viagem do Rel
--     ligada acompanha se NÃO tem datas_travadas, é de expedição/pacote e
--     estava seguindo a expedição (mesmas datas de antes, sem data, ou nasceu de
--     Expedições). Viagem com datas próprias (ex.: Bitrix com extensão) não é
--     mexida: ganha um evento "conferir" no histórico.
--   • rastro: rel_viagem_eventos (tipo 'datas' ou 'item', motivo "Ponte
--     Expedições: …") — aparece no Histórico da viagem no Rel.
--   • Os gatilhos rodam também nas gravações do espelho (exp.espelho = 'on'):
--     é assim que as mudanças do sistema de Expedições chegam. O espelho só
--     grava linha que mudou (is distinct from), então não há enxurrada.
--   • Sem laço: nada aqui grava em expedicoes/expedicao_voos/passageiros.
--
-- NÃO FAZ BACKFILL: as divergências antigas ficam para
-- scripts/ponte/backfill-voos-datas.sql (simulação; quem decide é o Bruno).
--
-- COMO CONFERIR (depois de aplicar):
--   select _ponte_voo_ts('16/09/2027 01h05', '2027-09-16', 'São Paulo (GRU)');   -- 2027-09-16 04:05+00
--   select _ponte_voo_ts('19/11/2026 03:30', '2026-11-18', 'Doha (DOH)');       -- 2026-11-19 00:30+00
--   -- edite a hora de um voo de uma expedição futura e veja o trecho:
--   select partida_em, partida_fuso from rel_viagem_trechos where ref_externa = 'exp-voo:<id>';
--   select * from rel_viagem_eventos where motivo like 'Ponte Expedições%' order by em desc limit 20;
--
-- COMO VOLTAR:
--   drop trigger if exists zz_ponte_voo_rel on expedicao_voos;
--   drop trigger if exists zz_ponte_pax_extensao_rel on passageiro_extensao;
--   drop trigger if exists zz_ponte_expedicao_datas_rel on expedicoes;
--   drop trigger if exists zz_ponte_grupo_datas_rel on grupos_expedicao;
--   (as funções _ponte_* / ponte_* podem ficar — sem gatilho não rodam.)
-- -----------------------------------------------------------------------------

-- 0. Utilitários comuns da ponte ------------------------------------------------
create or replace function _ponte_hoje_txt()
returns text language sql stable set search_path = public as $$
  select to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY')
$$;

create or replace function _ponte_data_txt(p date)
returns text language sql immutable as $$ select coalesce(to_char(p, 'DD/MM/YYYY'), 'sem data') $$;

/** Linha no Histórico da viagem do Rel (nunca derruba quem chamou). */
create or replace function _ponte_evento_viagem(p_viagem uuid, p_tipo text, p_de text, p_para text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_viagem is null then return; end if;
  insert into rel_viagem_eventos (viagem_id, tipo, de, para, motivo, por)
  values (p_viagem, p_tipo, left(p_de, 200), left(p_para, 200), left(p_motivo, 1000),
          (select id from qs_users where id = auth.uid()));
exception when others then
  raise warning 'ponte: evento da viagem % não gravou: %', p_viagem, sqlerrm;
end $$;

/** Aviso no plano do Financeiro (mesmo formato do _venda_propagar: "[Aviso QS dd/mm/aaaa] …").
    O mesmo texto no mesmo dia não se repete. Devolve true se gravou. */
create or replace function _ponte_aviso_plano(p_plano uuid, p_txt text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_linha text := '[Aviso QS ' || _ponte_hoje_txt() || '] ' || p_txt; k int;
begin
  if p_plano is null or nullif(trim(coalesce(p_txt, '')), '') is null then return false; end if;
  update fin_planos set observacao = concat_ws(E'\n', nullif(observacao, ''), v_linha), atualizado_em = now()
   where id = p_plano and position(v_linha in coalesce(observacao, '')) = 0;
  get diagnostics k = row_count;
  return k > 0;
exception when others then
  raise warning 'ponte: aviso no plano % não gravou: %', p_plano, sqlerrm;
  return false;
end $$;

/** Planos do Financeiro ligados a uma venda, a um cartão do closer ou (sem os dois) a uma viagem. */
create or replace function _ponte_planos(p_venda uuid, p_negocio uuid, p_viagem uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct id from fin_planos
   where (p_venda is not null and venda_id = p_venda)
      or (p_negocio is not null and negocio_id = p_negocio)
      or (p_venda is null and p_negocio is null and p_viagem is not null and viagem_id = p_viagem)
$$;

-- 1. Hora do bilhete → timestamptz no fuso do aeroporto ---------------------------
-- Mesma tabela ZONA de scripts/importar-expedicoes.mjs (+ KBV, que apareceu depois).
create or replace function _ponte_iata_zona(p_lugar text)
returns text language sql immutable as $$
  select case coalesce(substring(coalesce(p_lugar, '') from '\(([A-Z]{3})\)'), substring(coalesce(p_lugar, '') from '([A-Z]{3})'))
    when 'GRU' then 'America/Sao_Paulo' when 'CGH' then 'America/Sao_Paulo' when 'GIG' then 'America/Sao_Paulo'
    when 'BSB' then 'America/Sao_Paulo' when 'POA' then 'America/Sao_Paulo' when 'CNF' then 'America/Sao_Paulo'
    when 'VCP' then 'America/Sao_Paulo' when 'FLN' then 'America/Sao_Paulo' when 'CWB' then 'America/Sao_Paulo'
    when 'FOR' then 'America/Fortaleza' when 'NAT' then 'America/Fortaleza' when 'REC' then 'America/Recife'
    when 'SSA' then 'America/Bahia' when 'BEL' then 'America/Belem' when 'MAO' then 'America/Manaus'
    when 'DXB' then 'Asia/Dubai' when 'CAI' then 'Africa/Cairo' when 'ASW' then 'Africa/Cairo' when 'LXR' then 'Africa/Cairo'
    when 'PEK' then 'Asia/Shanghai' when 'PKX' then 'Asia/Shanghai' when 'PVG' then 'Asia/Shanghai' when 'SHA' then 'Asia/Shanghai'
    when 'HND' then 'Asia/Tokyo' when 'NRT' then 'Asia/Tokyo' when 'KIX' then 'Asia/Tokyo' when 'ITM' then 'Asia/Tokyo'
    when 'FCO' then 'Europe/Rome' when 'DOH' then 'Asia/Qatar'
    when 'BKK' then 'Asia/Bangkok' when 'DMK' then 'Asia/Bangkok' when 'CNX' then 'Asia/Bangkok' when 'HKT' then 'Asia/Bangkok'
    when 'KBV' then 'Asia/Bangkok'
    when 'LHR' then 'Europe/London' when 'LGW' then 'Europe/London' when 'KEF' then 'Atlantic/Reykjavik'
    when 'CUZ' then 'America/Lima' when 'LIM' then 'America/Lima'
    when 'JFK' then 'America/New_York' when 'EWR' then 'America/New_York' when 'MIA' then 'America/New_York'
    when 'BOG' then 'America/Bogota' when 'FRA' then 'Europe/Berlin' when 'MUC' then 'Europe/Berlin'
    when 'LIS' then 'Europe/Lisbon' when 'OPO' then 'Europe/Lisbon' when 'MAD' then 'Europe/Madrid' when 'BCN' then 'Europe/Madrid'
    when 'CDG' then 'Europe/Paris' when 'ORY' then 'Europe/Paris' when 'IST' then 'Europe/Istanbul' when 'ATH' then 'Europe/Athens'
    when 'ICN' then 'Asia/Seoul' when 'SCL' then 'America/Santiago'
    when 'EZE' then 'America/Argentina/Buenos_Aires' when 'AEP' then 'America/Argentina/Buenos_Aires'
    when 'ZRH' then 'Europe/Zurich' when 'AMS' then 'Europe/Amsterdam' when 'LAX' then 'America/Los_Angeles' when 'PTY' then 'America/Panama'
  end
$$;

/** "22/08 01:20" | "19/09/2026 01:05" | "29/09/2026 17h35" → hora LOCAL do bilhete (sem fuso).
    Sem ano: o da expedição; voo em janeiro de viagem de dezembro vira o ano seguinte (igual a quando()). */
create or replace function _ponte_voo_local(p_txt text, p_embarque date)
returns timestamp language plpgsql immutable as $$
declare m text[]; v_ano int; v_mes int;
begin
  m := regexp_match(coalesce(p_txt, ''), '(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\D+(\d{1,2})[:h](\d{2})');
  if m is null then return null; end if;
  v_mes := m[2]::int;
  if m[3] is not null then
    v_ano := case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end;
  else
    if p_embarque is null then return null; end if;
    v_ano := extract(year from p_embarque)::int;
    if v_mes < extract(month from p_embarque)::int - 6 then v_ano := v_ano + 1; end if;
  end if;
  return make_timestamp(v_ano, v_mes, m[1]::int, m[4]::int, m[5]::int, 0);
exception when others then
  return null;
end $$;

create or replace function _ponte_voo_ts(p_txt text, p_embarque date, p_lugar text)
returns timestamptz language sql immutable as $$
  select _ponte_voo_local(p_txt, p_embarque) at time zone coalesce(_ponte_iata_zona(p_lugar), 'America/Sao_Paulo')
$$;

/** "+04:00" — o fuso daquela hora local naquele aeroporto (o que a tela mostra ao lado da hora). */
create or replace function _ponte_voo_fuso(p_txt text, p_embarque date, p_lugar text)
returns text language sql immutable as $$
  select case when d < interval '0' then '-' else '+' end || to_char(case when d < interval '0' then -d else d end, 'HH24:MI')
    from (select _ponte_voo_local(p_txt, p_embarque) - (_ponte_voo_ts(p_txt, p_embarque, p_lugar) at time zone 'UTC') as d) s
   where d is not null
$$;

-- 2. Voos de um passageiro (mesma regra de voosDoPax da importação) ----------------
create or replace function _ponte_pax_entra(p passageiros)
returns boolean language sql immutable as $$
  select p.status_reserva::text in ('Confirmado', 'Pré-reserva') and p.tipo::text in ('Pagante', 'Cortesia')
$$;

create or replace function _ponte_voos_do_pax(p_pax uuid)
returns setof expedicao_voos language sql stable security definer set search_path = public as $$
  select vo.* from passageiros p
    join expedicao_voos vo on vo.expedicao_id = p.expedicao_id
   where p.id = p_pax
     and (vo.passageiro_id is null or vo.passageiro_id = p.id)
     and (vo.grupo_id is null or vo.grupo_id = p.grupo_id)
     and (vo.extensao_id is null
          or exists (select 1 from passageiro_extensao x where x.passageiro_id = p.id and x.extensao_id = vo.extensao_id))
     and (not coalesce(vo.apenas_sem_extensao, false)
          or not exists (select 1 from passageiro_extensao x where x.passageiro_id = p.id))
$$;

-- 3. Sincroniza os trechos de Expedições de UMA viagem do Rel -----------------------
create or replace function ponte_trechos_expedicao_sincronizar(p_viagem uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v        rel_viagens;
  r        record;
  v_guc    text := current_setting('rel.correcao_manual', true);
  v_desej  text[] := '{}';
  v_part   timestamptz;
  v_cheg   timestamptz;
  n_up     int := 0;
  n_canc   int := 0;
  k        int;
begin
  select * into v from rel_viagens where id = p_viagem;
  if not found or v.mesclada_em_id is not null then return 0; end if;
  -- Viagem que nunca foi ligada a passageiro de Expedições: não é com a ponte.
  if not exists (select 1 from rel_expedicoes_vinculo where viagem_id = p_viagem) then return 0; end if;

  -- quem mexe aqui é a própria ponte: a trava rel_trecho_respeita_correcao (service_role não
  -- desfaz situação manual) não vale para o cancelamento AUTOMÁTICO; correção de gente é
  -- respeitada pelos WHERE abaixo. Devolvido no fim (mesmo padrão da 0361).
  perform set_config('rel.correcao_manual', '1', true);

  for r in
    select distinct on (vo.id) vo.*, pa.localizador as pax_localizador, ex.data_embarque as exp_embarque
      from rel_expedicoes_vinculo x
      join passageiros pa on pa.id = x.passageiro_id
      join expedicoes ex on ex.id = pa.expedicao_id
      cross join lateral _ponte_voos_do_pax(pa.id) vo
     where x.viagem_id = p_viagem and pa.expedicao_id = x.expedicao_id and _ponte_pax_entra(pa)
     order by vo.id, (pa.cliente_id = v.cliente_id) desc nulls last, pa.localizador nulls last
  loop
    v_desej := v_desej || ('exp-voo:' || r.id::text);
    v_part := _ponte_voo_ts(r.partida, r.exp_embarque, r.origem);
    if v_part is null then continue; end if;   -- sem hora legível: não inventa (igual à importação)
    v_cheg := _ponte_voo_ts(r.chegada, r.exp_embarque, r.destino);
    if v_cheg is not null and v_cheg < v_part then v_cheg := null; end if;

    insert into rel_viagem_trechos as t (viagem_id, ref_externa, fonte, tipo, descricao, origem, destino,
                                         partida_em, chegada_em, partida_fuso, chegada_fuso, companhia, numero, localizador)
    values (p_viagem, 'exp-voo:' || r.id::text, 'expedicoes',
            case when coalesce(r.trecho, '') ~* 'intern' then 'voo_interno' else 'voo_internacional' end,
            nullif(r.trecho, ''), nullif(r.origem, ''), nullif(r.destino, ''),
            v_part, v_cheg, _ponte_voo_fuso(r.partida, r.exp_embarque, r.origem),
            case when v_cheg is not null then _ponte_voo_fuso(r.chegada, r.exp_embarque, r.destino) end,
            nullif(r.companhia, ''), nullif(r.numero_voo, ''), coalesce(nullif(r.localizador, ''), nullif(r.pax_localizador, '')))
    on conflict (viagem_id, ref_externa) do update set
      tipo = excluded.tipo, descricao = excluded.descricao, origem = excluded.origem, destino = excluded.destino,
      partida_em = excluded.partida_em, chegada_em = excluded.chegada_em,
      partida_fuso = excluded.partida_fuso, chegada_fuso = excluded.chegada_fuso,
      companhia = excluded.companhia, numero = excluded.numero, localizador = excluded.localizador,
      -- o voo voltou: desfaz o cancelamento que a PRÓPRIA ponte tinha feito
      status_manual = null, status_manual_motivo = null, status_manual_em = null
    where t.corrigido_em is null
      and (t.status_manual is null or (t.status_manual_por is null and t.status_manual_motivo like 'Expedições:%'))
      and ((t.tipo, t.descricao, t.origem, t.destino, t.partida_em, t.chegada_em, t.partida_fuso, t.chegada_fuso,
            t.companhia, t.numero, t.localizador, t.status_manual)
           is distinct from
           (excluded.tipo, excluded.descricao, excluded.origem, excluded.destino, excluded.partida_em, excluded.chegada_em,
            excluded.partida_fuso, excluded.chegada_fuso, excluded.companhia, excluded.numero, excluded.localizador, null::text));
    get diagnostics k = row_count;
    n_up := n_up + k;
  end loop;

  -- O que saiu (voo apagado, passageiro mudou de grupo/extensão, cancelado): CANCELA, não apaga.
  update rel_viagem_trechos t set
    status_manual = 'cancelado',
    status_manual_motivo = 'Expedições: o voo saiu da expedição ou deste passageiro',
    status_manual_em = now()
   where t.viagem_id = p_viagem and t.ref_externa like 'exp-voo:%'
     and t.corrigido_em is null and t.status_manual is null
     and not (t.ref_externa = any (v_desej));
  get diagnostics n_canc = row_count;

  perform set_config('rel.correcao_manual', coalesce(v_guc, ''), true);

  if n_up + n_canc > 0 then
    perform _ponte_evento_viagem(p_viagem, 'item', null, null,
      'Ponte Expedições: voos atualizados a partir da expedição ('
      || n_up || ' criado(s)/atualizado(s)' || case when n_canc > 0 then ', ' || n_canc || ' cancelado(s)' else '' end || ').');
  end if;
  return n_up + n_canc;
exception when others then
  perform set_config('rel.correcao_manual', coalesce(v_guc, ''), true);
  raise warning 'ponte: trechos da viagem % não sincronizaram: %', p_viagem, sqlerrm;
  return 0;
end $$;

-- 4. Datas da viagem seguindo a expedição/grupo -------------------------------------
/** Datas que a viagem deveria ter: as do grupo do passageiro (se houver) ou as da expedição. */
create or replace function _ponte_datas_desejadas(p_viagem uuid, out d_emb date, out d_ret date)
language plpgsql stable security definer set search_path = public as $$
declare v rel_viagens;
begin
  select * into v from rel_viagens where id = p_viagem;
  if not found then return; end if;
  select coalesce(g.data_embarque, ex.data_embarque), coalesce(g.data_retorno, ex.data_retorno) into d_emb, d_ret
    from rel_expedicoes_vinculo x
    join passageiros pa on pa.id = x.passageiro_id
    join expedicoes ex on ex.id = pa.expedicao_id
    left join grupos_expedicao g on g.id = pa.grupo_id
   where x.viagem_id = p_viagem and pa.expedicao_id = x.expedicao_id and pa.status_reserva::text <> 'Cancelado'
     and (v.expedicoes_id is null or pa.expedicao_id = v.expedicoes_id)
   order by (pa.cliente_id = v.cliente_id) desc nulls last, pa.created_at
   limit 1;
  if not found then
    select data_embarque, data_retorno into d_emb, d_ret from expedicoes where id = v.expedicoes_id;
  end if;
  if d_emb is not null and d_ret is not null and d_ret < d_emb then d_ret := null; end if;
end $$;

/** Leva as datas da expedição para a viagem. p_emb_antes/p_ret_antes = datas ANTES da mudança
    (a viagem que estava nelas acompanha). p_forcar = backfill decidido pelo Bruno.
    Devolve 'atualizada', 'conferir' ou null (nada a fazer). */
create or replace function ponte_viagem_datas_da_expedicao(p_viagem uuid, p_emb_antes date default null,
                                                           p_ret_antes date default null, p_forcar boolean default false,
                                                           p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v rel_viagens; d record; v_segue boolean;
begin
  select * into v from rel_viagens where id = p_viagem;
  if not found or v.mesclada_em_id is not null or v.status <> 'ativa' or coalesce(v.datas_travadas, false) then return null; end if;
  select * into d from _ponte_datas_desejadas(p_viagem);
  if d.d_emb is null then return null; end if;
  if v.data_embarque is not distinct from d.d_emb and v.data_retorno is not distinct from d.d_ret then return null; end if;

  v_segue := v.tipo in ('expedicao', 'pacote')
             and (p_forcar or v.origem = 'expedicoes' or v.data_embarque is null
                  or (p_emb_antes is not null and v.data_embarque is not distinct from p_emb_antes
                      and v.data_retorno is not distinct from p_ret_antes));
  if v_segue then
    update rel_viagens set data_embarque = d.d_emb,
           data_retorno = case when d.d_ret is not null then d.d_ret
                               when data_retorno is not null and data_retorno >= d.d_emb then data_retorno end
     where id = p_viagem;
    perform _ponte_evento_viagem(p_viagem, 'datas',
      _ponte_data_txt(v.data_embarque) || ' – ' || _ponte_data_txt(v.data_retorno),
      _ponte_data_txt(d.d_emb) || ' – ' || _ponte_data_txt(d.d_ret),
      coalesce(p_motivo, 'Ponte Expedições: datas acompanham a expedição.'));
    return 'atualizada';
  end if;
  if p_emb_antes is not null then
    perform _ponte_evento_viagem(p_viagem, 'datas',
      _ponte_data_txt(v.data_embarque) || ' – ' || _ponte_data_txt(v.data_retorno),
      _ponte_data_txt(d.d_emb) || ' – ' || _ponte_data_txt(d.d_ret),
      'Ponte Expedições: a expedição mudou de data, mas esta viagem tem datas próprias — NÃO mexi. Conferir.');
    return 'conferir';
  end if;
  return null;
end $$;

-- 5. Gatilhos --------------------------------------------------------------------------
create or replace function _ponte_trg_voo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_voo uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'UPDATE' and (new.expedicao_id, new.trecho, new.companhia, new.numero_voo, new.origem, new.destino, new.partida,
                           new.chegada, new.localizador, new.extensao_id, new.apenas_sem_extensao, new.grupo_id, new.passageiro_id)
                          is not distinct from
                          (old.expedicao_id, old.trecho, old.companhia, old.numero_voo, old.origem, old.destino, old.partida,
                           old.chegada, old.localizador, old.extensao_id, old.apenas_sem_extensao, old.grupo_id, old.passageiro_id) then
    return null;
  end if;
  for v_id in
    select distinct x.viagem_id from rel_expedicoes_vinculo x join passageiros pa on pa.id = x.passageiro_id
     where x.viagem_id is not null
       and pa.expedicao_id in (select e from unnest(array[case when tg_op <> 'DELETE' then new.expedicao_id end,
                                                          case when tg_op <> 'INSERT' then old.expedicao_id end]) e where e is not null)
    union
    select viagem_id from rel_viagem_trechos where ref_externa = 'exp-voo:' || v_voo::text
  loop
    perform ponte_trechos_expedicao_sincronizar(v_id);
  end loop;
  return null;
exception when others then
  raise warning 'ponte: voo % → Rel: %', v_voo, sqlerrm;
  return null;
end $$;
drop trigger if exists zz_ponte_voo_rel on expedicao_voos;
create trigger zz_ponte_voo_rel after insert or update or delete on expedicao_voos
  for each row execute function _ponte_trg_voo();

create or replace function _ponte_trg_pax_extensao()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select viagem_id into v_id from rel_expedicoes_vinculo where passageiro_id = coalesce(new.passageiro_id, old.passageiro_id);
  if v_id is not null then perform ponte_trechos_expedicao_sincronizar(v_id); end if;
  return null;
exception when others then
  raise warning 'ponte: extensão do passageiro → Rel: %', sqlerrm;
  return null;
end $$;
drop trigger if exists zz_ponte_pax_extensao_rel on passageiro_extensao;
create trigger zz_ponte_pax_extensao_rel after insert or delete on passageiro_extensao
  for each row execute function _ponte_trg_pax_extensao();

create or replace function _ponte_trg_expedicao_datas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in
    select id from rel_viagens where expedicoes_id = new.id and mesclada_em_id is null
    union
    select x.viagem_id from rel_expedicoes_vinculo x join passageiros pa on pa.id = x.passageiro_id
     where pa.expedicao_id = new.id and pa.grupo_id is null and x.viagem_id is not null
  loop
    perform ponte_viagem_datas_da_expedicao(v_id, old.data_embarque, old.data_retorno, false,
      'Ponte Expedições: a expedição ' || coalesce(new.nome, '') || ' mudou de ' || _ponte_data_txt(old.data_embarque)
      || ' – ' || _ponte_data_txt(old.data_retorno) || ' para ' || _ponte_data_txt(new.data_embarque) || ' – ' || _ponte_data_txt(new.data_retorno) || '.');
    -- voo sem ano usa o ano da expedição
    if extract(year from old.data_embarque) is distinct from extract(year from new.data_embarque) then
      perform ponte_trechos_expedicao_sincronizar(v_id);
    end if;
  end loop;
  return null;
exception when others then
  raise warning 'ponte: datas da expedição % → Rel: %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists zz_ponte_expedicao_datas_rel on expedicoes;
create trigger zz_ponte_expedicao_datas_rel after update of data_embarque, data_retorno on expedicoes
  for each row when (old.data_embarque is distinct from new.data_embarque or old.data_retorno is distinct from new.data_retorno)
  execute function _ponte_trg_expedicao_datas();

create or replace function _ponte_trg_grupo_datas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in
    select distinct x.viagem_id from rel_expedicoes_vinculo x join passageiros pa on pa.id = x.passageiro_id
     where pa.grupo_id = new.id and x.viagem_id is not null
  loop
    perform ponte_viagem_datas_da_expedicao(v_id, old.data_embarque, old.data_retorno, false,
      'Ponte Expedições: o grupo ' || coalesce(new.nome, '') || ' mudou de ' || _ponte_data_txt(old.data_embarque)
      || ' – ' || _ponte_data_txt(old.data_retorno) || ' para ' || _ponte_data_txt(new.data_embarque) || ' – ' || _ponte_data_txt(new.data_retorno) || '.');
  end loop;
  return null;
exception when others then
  raise warning 'ponte: datas do grupo % → Rel: %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists zz_ponte_grupo_datas_rel on grupos_expedicao;
create trigger zz_ponte_grupo_datas_rel after update of data_embarque, data_retorno on grupos_expedicao
  for each row when (old.data_embarque is distinct from new.data_embarque or old.data_retorno is distinct from new.data_retorno)
  execute function _ponte_trg_grupo_datas();

-- Funções internas: sem grant para a tela (rodam pelos gatilhos, como definer).
revoke all on function _ponte_evento_viagem(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function _ponte_aviso_plano(uuid, text) from public, anon, authenticated;
revoke all on function _ponte_planos(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function _ponte_voos_do_pax(uuid) from public, anon, authenticated;
revoke all on function ponte_trechos_expedicao_sincronizar(uuid) from public, anon, authenticated;
revoke all on function _ponte_datas_desejadas(uuid) from public, anon, authenticated;
revoke all on function ponte_viagem_datas_da_expedicao(uuid, date, date, boolean, text) from public, anon, authenticated;
revoke all on function _ponte_trg_voo() from public, anon, authenticated;
revoke all on function _ponte_trg_pax_extensao() from public, anon, authenticated;
revoke all on function _ponte_trg_expedicao_datas() from public, anon, authenticated;
revoke all on function _ponte_trg_grupo_datas() from public, anon, authenticated;
