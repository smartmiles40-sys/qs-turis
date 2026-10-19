-- 0147 (19/10/2026) — aplicada em duas partes: 0147a_rel_destino_pelos_voos + 0147b_rel_destino_pelos_voos_ida.

-- ── 0147a ────────────────────────────────────────────────────────────────────
-- Viagem sem destino no Bitrix ("-", ".", vazio) mas com voo cadastrado: o destino é a
-- chegada do último trecho de IDA (até o dia seguinte ao embarque). "Aer. Pinto Martins
-- Fortaleza - FOR" → "Pinto Martins Fortaleza (FOR)"; código puro fica o código.
create or replace function rel_destino_do_voo(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p is null or p !~* '[a-z]{3}' or p ~* '^\s*(brasil|venda)' then null
    when p ~ '^\s*[A-Z]{3}\s*$' then trim(p)
    when p ~ '\s-\s*[A-Z]{3}\s*$' then
      trim(regexp_replace(regexp_replace(p, '\s-\s*([A-Z]{3})\s*$', ''), '^\s*Aer\.?\s*(Aeroporto( de)?)?\s*', '', 'i'))
      || ' (' || substring(p from '([A-Z]{3})\s*$') || ')'
    else trim(p)
  end;
$$;

with s as (
  select v.id, v.data_embarque from rel_viagens v
   where v.status = 'ativa' and (v.destino is null or v.destino !~* '[a-z]{3}')
     and (v.expedicao is null or v.expedicao !~* '[a-z]{3}')
), ida as (
  select distinct on (s.id) s.id, rel_destino_do_voo(t.destino) d
    from s join rel_viagem_trechos t on t.viagem_id = s.id and t.tipo like 'voo%'
   where rel_destino_do_voo(t.destino) is not null
     and (s.data_embarque is null or t.partida_em < (s.data_embarque + 2)::timestamptz)
   order by s.id, t.partida_em desc
)
update rel_viagens v set destino = left(ida.d, 120)
  from ida where ida.id = v.id;

-- ── 0147b ────────────────────────────────────────────────────────────────────
-- Correção da 0147a: sem data de embarque, o "dia da ida" é o do PRIMEIRO voo (antes
-- pegava o último = a volta, e o destino virava GRU). Refaz só as que a 0147a preencheu.
with alvo as (
  select v.id, coalesce(v.data_embarque,
           (select min(t.partida_em at time zone 'America/Sao_Paulo')::date from rel_viagem_trechos t where t.viagem_id = v.id and t.tipo like 'voo%')) ida
    from rel_viagens v
   where v.status = 'ativa'
     and exists (select 1 from rel_viagem_trechos t where t.viagem_id = v.id and t.tipo like 'voo%' and rel_destino_do_voo(t.destino) = v.destino)
     and (v.expedicao is null or v.expedicao !~* '[a-z]{3}')
     and v.bitrix_dados->>'Destino [UF_CRM_1746633298495]' is distinct from v.destino
), novo as (
  select distinct on (a.id) a.id, rel_destino_do_voo(t.destino) d
    from alvo a join rel_viagem_trechos t on t.viagem_id = a.id and t.tipo like 'voo%'
   where rel_destino_do_voo(t.destino) is not null
     and t.partida_em < (a.ida + 2)::timestamptz
   order by a.id, t.partida_em desc
)
update rel_viagens v set destino = left(novo.d, 120) from novo where novo.id = v.id and v.destino is distinct from novo.d;
