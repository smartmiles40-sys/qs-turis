-- =============================================================================
-- 0102 — Relacionamento: feriados fora do prazo + assinatura configurável
-- =============================================================================
-- Feriado (ex.: 12/10) não conta no SLA: cliente que escreveu no feriado e foi
-- respondido no dia útil seguinte às 9h05 esperou 5 minutos úteis.
-- `rel_config.horario.feriados` = lista de datas "AAAA-MM-DD".
--
-- Assinatura: a mensagem que sai pela tela vai com "*Nome:*" na primeira linha
-- (o cliente sabe com quem fala). `rel_config.assinatura.ativo` desliga.
-- =============================================================================

insert into rel_config (chave, valor) values ('assinatura', '{"ativo": true}')
on conflict (chave) do nothing;

update rel_config
   set valor = valor || '{"feriados": ["2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25", "2027-01-01"]}'::jsonb
 where chave = 'horario' and not (valor ? 'feriados');

create or replace function rel_minutos_uteis(de timestamptz, ate timestamptz)
returns integer language plpgsql stable set search_path = public as $$
declare
  cfg   jsonb;
  dias  int[];
  folga date[];
  ini   time;
  fim   time;
  tz    constant text := 'America/Sao_Paulo';
  d     date;
  ultimo date;
  a     timestamptz;
  b     timestamptz;
  total numeric := 0;
begin
  if de is null or ate is null or ate <= de then return 0; end if;
  select valor into cfg from rel_config where chave = 'horario';
  dias  := coalesce((select array_agg(x::int) from jsonb_array_elements_text(cfg -> 'dias') x), array[1,2,3,4,5]);
  folga := coalesce((select array_agg(x::date) from jsonb_array_elements_text(cfg -> 'feriados') x
                      where x ~ '^\d{4}-\d{2}-\d{2}$'), '{}');
  ini   := coalesce((cfg ->> 'inicio')::time, '09:00');
  fim   := coalesce((cfg ->> 'fim')::time, '18:00');
  d      := (de at time zone tz)::date;
  ultimo := least((ate at time zone tz)::date, d + 62);
  while d <= ultimo loop
    if extract(isodow from d)::int = any(dias) and not (d = any(folga)) then
      a := greatest(de,  (d + ini) at time zone tz);
      b := least(ate,    (d + fim) at time zone tz);
      if b > a then total := total + extract(epoch from (b - a)) / 60; end if;
    end if;
    d := d + 1;
  end loop;
  return floor(total)::int;
end;
$$;
