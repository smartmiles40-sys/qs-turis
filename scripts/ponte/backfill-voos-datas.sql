-- scripts/ponte/backfill-voos-datas.sql
-- -----------------------------------------------------------------------------
-- BACKFILL (SIMULAÇÃO) — voos e datas de Expedições → Rel (ponte 0385).
-- NÃO FOI EXECUTADO. Quem decide rodar de verdade é o Bruno.
--
-- PARTE A — só leitura, roda HOJE (não precisa das migrations): conta o que o
--   backfill faria. Resultado em 13/11/2026 (SQL editor / MCP, só SELECT):
--     voos × viagens desejados: 1.361 (contando só o pax na expedição ATUAL do vínculo)
--     trechos a CRIAR: 461
--     trechos a CANCELAR: 173 — 144 deles são de passageiros que trocaram de expedição
--       (36 viagens, Tailândia G1→G2 / G3→G4). Com a 0386 aplicada, a viagem desses
--       passageiros ACOMPANHA a troca (rode o backfill-passageiros ANTES deste), então
--       esses 144 viram voos da nova expedição em vez de cancelados. Restam: 18 de
--       passageiro apagado (5 viagens), 8 por filtro de grupo/extensão (2), 3 de voo apagado.
--     trechos protegidos (corrigidos à mão): 0
--   (Contagem antiga, sem o filtro de expedição atual: 572 criar / 39 hora / 29 cancelar.)
--     datas: 159 viagens ativas com data ≠ expedição/grupo — TODAS do Bitrix
--       (117 de expedição/pacote: 56 passadas, 61 futuras; 42 tipo 'outro').
--       Pela regra do gatilho (só segue quem estava nas datas antigas ou nasceu de
--       Expedições) o backfill de datas NÃO mexe em nenhuma. 102 das 117 diferem
--       até 3 dias (provável: data do voo × data da expedição).
--
-- PARTE B — com as migrations aplicadas: roda as funções DENTRO de uma transação
--   e termina em ROLLBACK (troque por COMMIT só depois de conferir).
-- -----------------------------------------------------------------------------

-- ═════ PARTE A (só leitura) ═════
with z(iata, zona) as (values
  ('GRU','America/Sao_Paulo'),('CGH','America/Sao_Paulo'),('GIG','America/Sao_Paulo'),('BSB','America/Sao_Paulo'),('POA','America/Sao_Paulo'),
  ('CNF','America/Sao_Paulo'),('VCP','America/Sao_Paulo'),('FLN','America/Sao_Paulo'),('CWB','America/Sao_Paulo'),('FOR','America/Fortaleza'),
  ('NAT','America/Fortaleza'),('REC','America/Recife'),('SSA','America/Bahia'),('BEL','America/Belem'),('MAO','America/Manaus'),
  ('DXB','Asia/Dubai'),('CAI','Africa/Cairo'),('ASW','Africa/Cairo'),('LXR','Africa/Cairo'),('PEK','Asia/Shanghai'),('PKX','Asia/Shanghai'),
  ('PVG','Asia/Shanghai'),('SHA','Asia/Shanghai'),('HND','Asia/Tokyo'),('NRT','Asia/Tokyo'),('KIX','Asia/Tokyo'),('ITM','Asia/Tokyo'),
  ('FCO','Europe/Rome'),('DOH','Asia/Qatar'),('BKK','Asia/Bangkok'),('DMK','Asia/Bangkok'),('CNX','Asia/Bangkok'),('HKT','Asia/Bangkok'),
  ('KBV','Asia/Bangkok'),('LHR','Europe/London'),('LGW','Europe/London'),('KEF','Atlantic/Reykjavik'),('CUZ','America/Lima'),('LIM','America/Lima'),
  ('JFK','America/New_York'),('EWR','America/New_York'),('MIA','America/New_York'),('BOG','America/Bogota'),('FRA','Europe/Berlin'),
  ('MUC','Europe/Berlin'),('LIS','Europe/Lisbon'),('OPO','Europe/Lisbon'),('MAD','Europe/Madrid'),('BCN','Europe/Madrid'),('CDG','Europe/Paris'),
  ('ORY','Europe/Paris'),('IST','Europe/Istanbul'),('ATH','Europe/Athens'),('ICN','Asia/Seoul'),('SCL','America/Santiago'),
  ('EZE','America/Argentina/Buenos_Aires'),('AEP','America/Argentina/Buenos_Aires'),('ZRH','Europe/Zurich'),('AMS','Europe/Amsterdam'),
  ('LAX','America/Los_Angeles'),('PTY','America/Panama')),
par as (
  select distinct x.viagem_id, vo.id voo, vo.partida, vo.origem, ex.data_embarque emb, ex.data_embarque > current_date fut
    from rel_expedicoes_vinculo x join passageiros pa on pa.id = x.passageiro_id and pa.expedicao_id = x.expedicao_id
    join expedicoes ex on ex.id = pa.expedicao_id
    join expedicao_voos vo on vo.expedicao_id = pa.expedicao_id
   where x.viagem_id is not null and pa.status_reserva in ('Confirmado','Pré-reserva') and pa.tipo in ('Pagante','Cortesia')
     and (vo.passageiro_id is null or vo.passageiro_id = pa.id) and (vo.grupo_id is null or vo.grupo_id = pa.grupo_id)
     and (vo.extensao_id is null or exists (select 1 from passageiro_extensao pe where pe.passageiro_id = pa.id and pe.extensao_id = vo.extensao_id))
     and (not coalesce(vo.apenas_sem_extensao, false) or not exists (select 1 from passageiro_extensao pe where pe.passageiro_id = pa.id))
), calc as (
  select par.*, regexp_match(coalesce(partida, ''), '(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\D+(\d{1,2})[:h](\d{2})') m,
         coalesce((select zona from z where z.iata = coalesce(substring(coalesce(origem, '') from '\(([A-Z]{3})\)'),
                                                              substring(coalesce(origem, '') from '([A-Z]{3})'))), 'America/Sao_Paulo') zona
    from par
), ts as (
  select calc.*, case when m is null then null else make_timestamp(
           case when m[3] is not null then case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end
                when emb is null then null
                else extract(year from emb)::int + case when m[2]::int < extract(month from emb)::int - 6 then 1 else 0 end end,
           m[2]::int, m[1]::int, m[4]::int, m[5]::int, 0) at time zone zona end partida_calc
    from calc
), cmp as (
  select ts.*, t.id tid, t.partida_em, t.corrigido_em, t.status_manual
    from ts left join rel_viagem_trechos t on t.viagem_id = ts.viagem_id and t.ref_externa = 'exp-voo:' || ts.voo
)
select fut, count(*) pares,
       count(*) filter (where tid is null and partida_calc is not null) criar,
       count(*) filter (where tid is null and partida_calc is null) sem_hora,
       count(*) filter (where tid is not null and corrigido_em is null and status_manual is null
                          and partida_em is distinct from partida_calc and partida_calc is not null) atualizar_hora,
       count(*) filter (where tid is not null and (corrigido_em is not null or status_manual is not null)) protegidos,
       count(distinct viagem_id) filter (where tid is null and partida_calc is not null) viagens_ganham
  from cmp group by fut;

-- datas que diferem (lista para conferir)
select v.id, v.titulo, v.origem, v.tipo, v.data_embarque, v.data_retorno, e.nome expedicao, e.data_embarque exp_emb, e.data_retorno exp_ret
  from rel_viagens v join expedicoes e on e.id = v.expedicoes_id
 where v.status = 'ativa' and v.mesclada_em_id is null and coalesce(v.datas_travadas, false) = false
   and (v.data_embarque is distinct from e.data_embarque or v.data_retorno is distinct from e.data_retorno)
 order by e.data_embarque desc;

-- ═════ PARTE B (com 0385 aplicada) — SIMULAÇÃO: termina em ROLLBACK ═════
begin;
create temp table _bf_trechos as
  select v.viagem_id, ponte_trechos_expedicao_sincronizar(v.viagem_id) mudou
    from (select distinct viagem_id from rel_expedicoes_vinculo where viagem_id is not null) v;
select count(*) viagens_olhadas, count(*) filter (where mudou > 0) viagens_mudaram, sum(mudou) trechos_mudaram from _bf_trechos;

-- datas: regra do gatilho (p_forcar = false). Para forçar as futuras de expedição/pacote,
-- troque false por true NA LINHA ABAIXO depois de conferir a lista da Parte A.
create temp table _bf_datas as
  select v.id, ponte_viagem_datas_da_expedicao(v.id, null, null, false, 'Ponte Expedições: backfill de 13/11 — datas da expedição.') r
    from rel_viagens v join expedicoes e on e.id = v.expedicoes_id
   where v.status = 'ativa' and v.mesclada_em_id is null and e.data_embarque > current_date;
select r, count(*) from _bf_datas group by r;
rollback;   -- ← COMMIT só com o ok do Bruno
