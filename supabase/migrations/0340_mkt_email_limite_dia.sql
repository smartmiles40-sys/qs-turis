-- 0340 — E-MAIL MARKETING: teto de e-mails por dia (aquecimento do domínio).
--
-- Domínio novo que manda milhares de e-mails no primeiro dia cai no spam do
-- Gmail/Outlook. O motor (api/_mktEmailMotor.js) para de enviar quando o dia
-- (horário de São Paulo) bate o teto; o resto fica na fila e sai no dia
-- seguinte, sem perder nada. Vazio = sem teto.
--
-- Começa em 200/dia. Sugestão de rampa: 200 → 500 → 1.000 → 2.000 → 5.000,
-- subindo a cada 2–3 dias se bounce < 2% e spam < 0,1%.
--
-- Idempotente. Antes de aplicar, nada no código quebra: sem a coluna o motor
-- entende "sem teto"; sem a função, idem.

alter table public.mkt_email_config
  add column if not exists limite_por_dia int
  check (limite_por_dia is null or limite_por_dia between 1 and 100000);

update public.mkt_email_config set limite_por_dia = 200
 where id = 1 and limite_por_dia is null;

-- Quantos e-mails já saíram hoje (dia de São Paulo). Só o servidor chama.
create or replace function public.mkt_email_enviados_hoje()
returns int
language sql stable security definer set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.mkt_email_envios
   where enviado_em >= (((now() at time zone 'America/Sao_Paulo')::date)::timestamp
                        at time zone 'America/Sao_Paulo');
$$;

revoke all on function public.mkt_email_enviados_hoje() from public, anon, authenticated;
grant execute on function public.mkt_email_enviados_hoje() to service_role;

-- Índice para a contagem não varrer a tabela inteira.
create index if not exists mkt_email_envios_enviado_em_idx
  on public.mkt_email_envios (enviado_em) where enviado_em is not null;
