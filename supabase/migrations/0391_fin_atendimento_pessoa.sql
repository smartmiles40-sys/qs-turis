-- supabase/migrations/0391_fin_atendimento_pessoa.sql
-- -----------------------------------------------------------------------------
-- PONTE PEDIDOS (2/5): ATENDIMENTO DO FINANCEIRO SEMPRE COM A PESSOA (13/11/2026).
--
-- POR QUÊ
--   Auditoria de 13/11: 26 de 71 fin_atendimentos sem cliente_id e sem lead_id.
--   De onde vêm: "+ Novo atendimento" só com o número (16 com conversa, 3 sem),
--   e conversa do Relacionamento ainda sem ficha (7). O fin_enviar só copia o
--   cliente da conversa NA HORA; se a conversa ganha ficha depois, ou se veio só
--   o telefone de quem já tem ficha, o atendimento fica "sem ficha ligada" e o
--   Financeiro não vê as viagens/valores da pessoa — nem os outros setores
--   veem o atendimento na ficha.
--
-- O QUE FAZ
--   1. fin_pessoa_do_atendimento(conversa, lead, telefone) → a ficha viva:
--        a conversa já tem ficha → ela;  o lead tem ficha (0213/0376) → ela;
--        senão o telefone casa com UMA ficha viva só (rel_fone_chave: com/sem
--        55 e 9º dígito). Duas fichas com o mesmo número (família) → não chuta.
--   2. Gatilho BEFORE INSERT/UPDATE em fin_atendimentos: cliente_id vazio →
--      tenta preencher. Nunca troca uma ficha já posta.
--   3. Backfill dos que estão sem ficha (mesma regra).
--   O front (NovoAtendimento) passa a pedir a ficha OU "ainda não tem ficha".
--
-- COMO CONFERIR
--   select count(*) filter (where cliente_id is null and lead_id is null) sem_pessoa, count(*)
--     from fin_atendimentos;          -- antes: 26 de 71
--   select public.fin_pessoa_do_atendimento(null, null, '+55 11 9xxxx-xxxx');
--
-- COMO VOLTAR
--   drop trigger if exists trg_fin_atendimentos_pessoa on public.fin_atendimentos;
--   drop function if exists public.fin_atendimentos_pessoa();
--   drop function if exists public.fin_pessoa_do_atendimento(uuid, uuid, text);
--   (o backfill só preencheu cliente_id vazio.)
-- Idempotente.
-- -----------------------------------------------------------------------------

create or replace function public.fin_pessoa_do_atendimento(p_conversa uuid, p_lead uuid, p_telefone text)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v uuid; n int; k text;
begin
  if p_conversa is not null then
    select coalesce(c.mesclado_em_id, c.id) into v
      from rel_wa_conversas w join rel_clientes c on c.id = w.cliente_id
     where w.id = p_conversa;
    if v is not null then return v; end if;
  end if;
  if p_lead is not null then
    select coalesce(c.mesclado_em_id, c.id) into v
      from qs_leads l join rel_clientes c on c.id = l.cliente_id
     where l.id = p_lead;
    if v is not null then return v; end if;
  end if;
  k := rel_fone_chave(p_telefone);
  if k is null or length(k) < 10 then return null; end if;
  select min(c.id::text)::uuid, count(*) into v, n
    from rel_clientes c
   where c.mesclado_em_id is null and c.arquivado_em is null
     and rel_fone_chave(c.telefone) = k;
  return case when n = 1 then v end;
end $function$;

comment on function public.fin_pessoa_do_atendimento(uuid, uuid, text) is
  '0391: a ficha (rel_clientes) de um atendimento do Financeiro — pela conversa, pelo lead ou pelo telefone (só se for uma ficha só).';
revoke all on function public.fin_pessoa_do_atendimento(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.fin_atendimentos_pessoa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.cliente_id is null then
    begin
      new.cliente_id := fin_pessoa_do_atendimento(new.conversa_id, new.lead_id, new.telefone);
    exception when others then
      raise warning '[0391] atendimento % sem ficha: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $function$;
revoke all on function public.fin_atendimentos_pessoa() from public, anon, authenticated;

drop trigger if exists trg_fin_atendimentos_pessoa on public.fin_atendimentos;
create trigger trg_fin_atendimentos_pessoa
  before insert or update of cliente_id, conversa_id, lead_id, telefone on public.fin_atendimentos
  for each row execute function public.fin_atendimentos_pessoa();

-- Backfill: os que estão sem ficha e agora acham uma (fin_atendimentos não tem outro gatilho).
update public.fin_atendimentos a
   set cliente_id = x.cli
  from (
    select id, public.fin_pessoa_do_atendimento(conversa_id, lead_id, telefone) as cli
      from public.fin_atendimentos
     where cliente_id is null
  ) x
 where a.id = x.id and x.cli is not null and a.cliente_id is null;
