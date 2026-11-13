-- 0378_ponte_whatsapp_conversa_optout.sql
-- -----------------------------------------------------------------------------
-- PONTE PESSOA (3/4): CONVERSA DO REL NASCE LIGADA E "SAIR DO WHATSAPP" VALE
-- PRA TODOS OS SETORES (13/11/2026).
--
-- POR QUÊ
--   (a) rel_wa_conversas.cliente_id só era preenchido pelo gatilho da FICHA
--       (trg_rel_liga_conversas, quando a ficha nasce/muda telefone). Conversa
--       nova de quem já tinha ficha ficava sem ficha — e aí o "PARAR" dela
--       (api/_relEntrada.js) não chegava à ficha. Em 13/11: 51 conversas sem
--       ficha, 1 delas com ficha única pelo telefone.
--   (b) Opt-out de WhatsApp morava em 3 lugares sem sincronia:
--       qs_leads.optout_whatsapp_em (0087, Comercial), rel_clientes.optout_em
--       (0103, Rel) e mkt_contatos.optout_whatsapp_em (0242, Marketing).
--       Em 13/11, 4 leads de clientes que saíram no Rel seguiam liberados.
--
-- O QUE FAZ
--   1. rel_trg_conversa_ficha: BEFORE INSERT / UPDATE OF telefone em
--      rel_wa_conversas → cliente_id := rel_cliente_do_telefone(telefone)
--      quando está nulo. É a MESMA regra que o lado da ficha já usa (ficha
--      única; se houver família no mesmo número, o titular).
--   2. cad_optout_propagar + 3 gatilhos (qs_leads, rel_clientes, mkt_contatos):
--      MARCAR (sair) propaga pros outros dois:
--        • pela pessoa: ficha viva do cliente_id (e fichas mescladas nela),
--          leads com esse cliente_id, contatos do mkt com rel_cliente_id;
--        • sem ligação: mesmo telefone EXATO normalizado (cad_tel) — só em
--          registros que também não têm ligação (lead ligado a outra ficha
--          não é tocado).
--      Só marca quem está liberado (… is null) e com o MESMO carimbo de hora.
--      LIMPAR (voltar a aceitar) só propaga pros registros com o MESMO carimbo
--      (= marcados por aquele mesmo pedido). Quem saiu por conta própria em
--      outro setor continua fora.
--      Sem laço: cada propagação só escreve onde o valor ainda é diferente
--      (is null / = carimbo antigo), então a cascata morre no 2º nível; e há
--      trava pg_trigger_depth() < 8 por garantia.
--      Os updates em qs_leads rodam com qs.ponte=on (0376): não mexem em
--      updated_at e passam pelo bloqueio de "outra área" (Rel/Mkt marcando).
--
-- COMO CONFERIR
--   -- divergências que sobram (deve tender a 0 depois do backfill opcional):
--   select count(*) from rel_clientes c join qs_leads l on l.cliente_id = c.id
--    where c.optout_em is not null and l.optout_whatsapp_em is null;
--   select count(*) from rel_wa_conversas where cliente_id is null and rel_cliente_do_telefone(telefone) is not null;
--
-- COMO VOLTAR
--   drop trigger if exists trg_rel_wa_conversas_ficha on rel_wa_conversas;
--   drop trigger if exists trg_qs_leads_optout_ponte on qs_leads;
--   drop trigger if exists trg_rel_clientes_optout_ponte on rel_clientes;
--   drop trigger if exists trg_mkt_contatos_optout_ponte on mkt_contatos;
--   drop function if exists rel_trg_conversa_ficha(), cad_trg_optout_lead(),
--     cad_trg_optout_ficha(), cad_trg_optout_mkt(),
--     cad_optout_propagar(uuid, text, timestamptz, timestamptz, text);
-- Idempotente.
-- -----------------------------------------------------------------------------

-- ── (1) Conversa nova já nasce com ficha ────────────────────────────────────
create or replace function public.rel_trg_conversa_ficha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.cliente_id is null and new.telefone is not null
     and (tg_op = 'INSERT' or new.telefone is distinct from old.telefone) then
    begin
      new.cliente_id := rel_cliente_do_telefone(new.telefone);
    exception when others then
      raise warning 'ponte conversa→ficha: conversa % não ligou: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_rel_wa_conversas_ficha on public.rel_wa_conversas;
create trigger trg_rel_wa_conversas_ficha
  before insert or update of telefone on public.rel_wa_conversas
  for each row execute function public.rel_trg_conversa_ficha();

-- ── (2) Opt-out: um pedido, três setores ────────────────────────────────────
-- p_cliente: ficha ligada à origem (pode ser null) · p_fone: telefone da origem
-- p_em: novo valor (null = voltou a aceitar) · p_antes: valor anterior
create or replace function public.cad_optout_propagar(
  p_cliente uuid, p_fone text, p_em timestamptz, p_antes timestamptz, p_texto text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  f uuid := case when p_cliente is not null then cad_ficha_viva(p_cliente) end;
  fone text := cad_tel(p_fone);
  fichas uuid[];
  antes text := current_setting('qs.ponte', true);
begin
  if p_em is null and p_antes is null then return; end if;
  if f is null and fone is null then return; end if;

  -- Fichas da pessoa (a viva + as mescladas nela) ou, sem ligação, as do telefone.
  if f is not null then
    select array_agg(id) into fichas from rel_clientes where id = f or (mesclado_em_id is not null and cad_ficha_viva(id) = f);
  else
    select array_agg(id) into fichas from rel_clientes where telefone = fone and mesclado_em_id is null;
  end if;
  fichas := coalesce(fichas, '{}');

  perform set_config('qs.ponte', 'on', true);

  if p_em is not null then
    -- MARCAR
    update rel_clientes set optout_em = p_em
     where id = any(fichas) and optout_em is null;

    update qs_leads set optout_whatsapp_em = p_em,
                        optout_whatsapp_texto = left(coalesce(p_texto, 'Saiu do WhatsApp em outro setor.'), 300)
     where optout_whatsapp_em is null
       and (cliente_id = any(fichas)
            or (cliente_id is null and fone is not null and phone is not null
                and qs_tel_chave(phone) = qs_tel_chave(fone) and cad_tel(phone) = fone));

    update mkt_contatos set optout_whatsapp_em = p_em
     where optout_whatsapp_em is null
       and (rel_cliente_id = any(fichas)
            or (rel_cliente_id is null and fone is not null
                and telefone in (fone, substr(fone, 3)) and cad_tel(telefone) = fone));
  else
    -- LIMPAR: só o que foi marcado pelo MESMO pedido (mesmo carimbo).
    update rel_clientes set optout_em = null
     where id = any(fichas) and optout_em = p_antes;

    update qs_leads set optout_whatsapp_em = null, optout_whatsapp_texto = null
     where optout_whatsapp_em = p_antes
       and (cliente_id = any(fichas)
            or (cliente_id is null and fone is not null and phone is not null
                and qs_tel_chave(phone) = qs_tel_chave(fone) and cad_tel(phone) = fone));

    update mkt_contatos set optout_whatsapp_em = null
     where optout_whatsapp_em = p_antes
       and (rel_cliente_id = any(fichas)
            or (rel_cliente_id is null and fone is not null
                and telefone in (fone, substr(fone, 3)) and cad_tel(telefone) = fone));
  end if;

  perform set_config('qs.ponte', coalesce(antes, ''), true);
end $fn$;

comment on function public.cad_optout_propagar(uuid, text, timestamptz, timestamptz, text) is
  'Propaga opt-out de WhatsApp entre qs_leads, rel_clientes e mkt_contatos (pela ficha; sem ela, telefone exato). Limpar só desfaz o mesmo carimbo. (0378)';

revoke all on function public.cad_optout_propagar(uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;

-- Lead (Comercial)
create or replace function public.cad_trg_optout_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if pg_trigger_depth() >= 8 then return null; end if;
  if tg_op = 'INSERT' and new.optout_whatsapp_em is null then return null; end if;
  if tg_op = 'UPDATE' and new.optout_whatsapp_em is not distinct from old.optout_whatsapp_em then return null; end if;
  begin
    perform cad_optout_propagar(new.cliente_id, new.phone, new.optout_whatsapp_em,
      case when tg_op = 'UPDATE' then old.optout_whatsapp_em end, 'Saiu do WhatsApp pelo Comercial.');
  exception when others then
    raise warning 'ponte opt-out: lead % não propagou: %', new.id, sqlerrm;
  end;
  return null;
end $fn$;

drop trigger if exists trg_qs_leads_optout_ponte on public.qs_leads;
create trigger trg_qs_leads_optout_ponte
  after insert or update of optout_whatsapp_em on public.qs_leads
  for each row execute function public.cad_trg_optout_lead();

-- Ficha (Relacionamento)
create or replace function public.cad_trg_optout_ficha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if pg_trigger_depth() >= 8 then return null; end if;
  if tg_op = 'INSERT' and new.optout_em is null then return null; end if;
  if tg_op = 'UPDATE' and new.optout_em is not distinct from old.optout_em then return null; end if;
  if new.mesclado_em_id is not null then return null; end if;
  begin
    perform cad_optout_propagar(new.id, new.telefone, new.optout_em,
      case when tg_op = 'UPDATE' then old.optout_em end, 'Saiu do WhatsApp pelo Relacionamento.');
  exception when others then
    raise warning 'ponte opt-out: ficha % não propagou: %', new.id, sqlerrm;
  end;
  return null;
end $fn$;

drop trigger if exists trg_rel_clientes_optout_ponte on public.rel_clientes;
create trigger trg_rel_clientes_optout_ponte
  after insert or update of optout_em on public.rel_clientes
  for each row execute function public.cad_trg_optout_ficha();

-- Contato (Marketing)
create or replace function public.cad_trg_optout_mkt()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if pg_trigger_depth() >= 8 then return null; end if;
  if tg_op = 'INSERT' and new.optout_whatsapp_em is null then return null; end if;
  if tg_op = 'UPDATE' and new.optout_whatsapp_em is not distinct from old.optout_whatsapp_em then return null; end if;
  begin
    perform cad_optout_propagar(new.rel_cliente_id, new.telefone, new.optout_whatsapp_em,
      case when tg_op = 'UPDATE' then old.optout_whatsapp_em end, 'Saiu do WhatsApp pelo Marketing.');
  exception when others then
    raise warning 'ponte opt-out: contato mkt % não propagou: %', new.id, sqlerrm;
  end;
  return null;
end $fn$;

drop trigger if exists trg_mkt_contatos_optout_ponte on public.mkt_contatos;
create trigger trg_mkt_contatos_optout_ponte
  after insert or update of optout_whatsapp_em on public.mkt_contatos
  for each row execute function public.cad_trg_optout_mkt();
