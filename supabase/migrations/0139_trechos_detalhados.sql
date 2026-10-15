-- 0139_trechos_detalhados.sql
-- -----------------------------------------------------------------------------
-- TRECHOS COM TUDO QUE ESTÁ NO BILHETE / VOUCHER (15/10/2026).
--
-- Bruno: "futuramente a IA vai revisar toda a venda e preencher tudo — preciso
-- que tenha as informações que têm em bilhetes, transfers etc." e "enquanto o
-- passageiro está em viagem, temos que saber que horas ele vai pegar o transfer".
--
-- Transfer: partida_em = HORA DA BUSCA; ponto_encontro = onde o motorista espera.
-- Fuso (+09:00…) guardado à parte pra mostrar a hora LOCAL do lugar, que é a que
-- o passageiro vê no bilhete — partida_em continua sendo o instante exato.
-- -----------------------------------------------------------------------------

alter table rel_viagem_trechos add column if not exists origem_codigo    text;   -- IATA / estação
alter table rel_viagem_trechos add column if not exists destino_codigo   text;
alter table rel_viagem_trechos add column if not exists partida_fuso     text;   -- ex.: +09:00
alter table rel_viagem_trechos add column if not exists chegada_fuso     text;
alter table rel_viagem_trechos add column if not exists terminal_partida text;
alter table rel_viagem_trechos add column if not exists terminal_chegada text;
alter table rel_viagem_trechos add column if not exists classe           text;   -- econômica, executiva…
alter table rel_viagem_trechos add column if not exists bagagem          text;   -- "1 x 23 kg"
alter table rel_viagem_trechos add column if not exists assento          text;
alter table rel_viagem_trechos add column if not exists numero_bilhete   text;   -- e-ticket
alter table rel_viagem_trechos add column if not exists passageiros      text[] not null default '{}';
alter table rel_viagem_trechos add column if not exists ponto_encontro   text;   -- transfer/passeio: onde encontrar
alter table rel_viagem_trechos add column if not exists contato          text;   -- telefone do motorista/fornecedor/hotel
alter table rel_viagem_trechos add column if not exists endereco         text;   -- hotel/passeio
alter table rel_viagem_trechos add column if not exists observacoes      text;   -- o que mais o documento disser

-- A view já é t.* — recriar pra ela enxergar as colunas novas (drop: as colunas
-- novas entram no meio, e "create or replace" não deixa mudar a ordem).
drop view if exists rel_trechos_v;
create view rel_trechos_v
with (security_invoker = true) as
select t.*,
       coalesce(t.checkin_abre_em,
                case when t.tipo in ('voo_internacional', 'voo_interno') then t.partida_em - interval '48 hours'
                     when t.tipo = 'trem' then t.partida_em - interval '24 hours' end) as checkin_em,
       v.tipo as viagem_tipo, v.titulo as viagem_titulo, v.destino as viagem_destino,
       v.expedicao, v.status as viagem_status
  from rel_viagem_trechos t
  join rel_viagens v on v.id = t.viagem_id;

revoke all on rel_trechos_v from anon;
grant select on rel_trechos_v to authenticated;
grant all on rel_trechos_v to service_role;
