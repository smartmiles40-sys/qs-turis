-- supabase/migrations/0390_sol_amarra_pessoa.sql
-- -----------------------------------------------------------------------------
-- PONTE PEDIDOS (1/5): TODO PEDIDO ENTRE SETORES SAI AMARRADO À PESSOA (13/11/2026).
--
-- POR QUÊ
--   Auditoria de 13/11: as 42 solicitações eram todas Rel↔Ops, 0 com lead_id e
--   12 sem pessoa. Investigado o "lead_id que se perde": NÃO se perde — o
--   qs_sol_criar grava p_lead e o front (LeadDetailPage → NovaSolicitacao →
--   criarSolicitacao) manda leadId. O Comercial simplesmente nunca abriu um
--   pedido (0 linhas com de_setor = 'comercial'). O que faltava:
--     • lead → cliente: o qs_sol_criar acha a ficha do lead só pelo telefone
--       (qs_sol_cliente_do_lead). A 0377 (ponte pessoa) passa a olhar primeiro
--       qs_leads.cliente_id — esta migration NÃO mexe nessa função.
--     • cliente → lead: pedido aberto da ficha/viagem nunca aparecia no lead /
--       cartão do closer (eles listam por lead_id).
--     • pedidos que nascem FORA do qs_sol_criar (0181 pagamento do closer,
--       0230 análise de venda…) não passavam por nenhuma dessas amarrações.
--
-- O QUE FAZ
--   Gatilho BEFORE INSERT em qs_solicitacoes (trg_a_… roda antes do
--   trg_fin_pag_validar, que confere o pagamento com cliente/lead já postos):
--     • veio lead e não veio cliente → cliente = ficha do lead
--       (qs_leads.cliente_id, seguindo mesclagem; senão qs_sol_cliente_do_lead);
--     • veio cliente e não veio lead → lead = o ÚNICO lead ligado a essa ficha
--       (qs_leads.cliente_id). Dois ou mais leads = não chuta.
--   Nunca troca o que veio preenchido. Erro aqui nunca impede o pedido.
--   Backfill: só o lado cliente → lead (o outro lado já roda no qs_sol_criar).
--
-- COMO CONFERIR
--   select count(*) filter (where lead_id is not null) com_lead,
--          count(*) filter (where cliente_id is not null) com_cliente, count(*)
--     from qs_solicitacoes;
--   -- e abrir um pedido pelo lead (Comercial → lead → "Pedir a outro setor"):
--   select cliente_id, lead_id from qs_solicitacoes order by criado_em desc limit 1;
--
-- COMO VOLTAR
--   drop trigger if exists trg_a_qs_sol_amarrar_pessoa on public.qs_solicitacoes;
--   drop function if exists public.qs_sol_amarrar_pessoa();
--   (o backfill só preencheu lead_id vazio; pra desfazer não há marca — é inofensivo.)
-- Idempotente.
-- -----------------------------------------------------------------------------

create or replace function public.qs_sol_amarrar_pessoa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v uuid; n int;
begin
  begin
    if new.cliente_id is null and new.lead_id is not null then
      select coalesce(c.mesclado_em_id, c.id) into v
        from qs_leads l join rel_clientes c on c.id = l.cliente_id
       where l.id = new.lead_id;
      new.cliente_id := coalesce(v, qs_sol_cliente_do_lead(new.lead_id));
    end if;
    if new.lead_id is null and new.cliente_id is not null then
      select min(l.id::text)::uuid, count(*) into v, n from qs_leads l where l.cliente_id = new.cliente_id;
      if n = 1 then new.lead_id := v; end if;
    end if;
  exception when others then
    raise warning '[0390] pedido sem amarrar pessoa: %', sqlerrm;
  end;
  return new;
end $function$;

comment on function public.qs_sol_amarrar_pessoa() is
  '0390: pedido entre setores — lead sem cliente pega a ficha do lead; cliente sem lead pega o único lead da ficha.';
revoke all on function public.qs_sol_amarrar_pessoa() from public, anon, authenticated;

drop trigger if exists trg_a_qs_sol_amarrar_pessoa on public.qs_solicitacoes;
create trigger trg_a_qs_sol_amarrar_pessoa
  before insert on public.qs_solicitacoes
  for each row execute function public.qs_sol_amarrar_pessoa();

-- Backfill (cliente → único lead). Não toca status/formulário: nenhum outro gatilho de UPDATE dispara.
update public.qs_solicitacoes s
   set lead_id = x.lead_id
  from (
    select s2.id, min(l.id::text)::uuid as lead_id
      from public.qs_solicitacoes s2
      join public.qs_leads l on l.cliente_id = s2.cliente_id
     where s2.lead_id is null and s2.cliente_id is not null
     group by s2.id
    having count(*) = 1
  ) x
 where s.id = x.id and s.lead_id is null;
