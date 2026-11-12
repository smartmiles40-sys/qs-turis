-- 0368_vagas_contam_fila.sql
-- -----------------------------------------------------------------------------
-- "RESERVAR VAGA" OCUPA VAGA MESMO COM O ESPELHO LIGADO (revisão 12/11/2026).
--
-- Enquanto a cópia Expedições → QS está ligada (ops_config.exp_espelho), o
-- passageiro da venda nova não entra em `passageiros`: fica na fila
-- exp_venda_pax_pendentes até a troca (exp_venda_pax_aplicar). exp_ocupados
-- só contava `passageiros` → a fila não ocupava vaga → dava pra vender acima
-- da lotação.
--
--   • exp_ocupados(p_exp): pagantes ativos em passageiros + inserts AINDA NA
--     FILA (aplicado_em null) da mesma expedição, pagante e Pré-reserva/
--     Confirmado. Sem contar em dobro: quando a troca aplica, aplicado_em é
--     preenchido e o passageiro passa a contar pela tabela (e a linha da fila
--     cujo id já existe em passageiros nunca conta). Insert descartado pelo
--     cancelamento também tem aplicado_em → sai da conta.
--     Quem usa: exp_vagas_para_venda, venda_subir (trava 'sem-vaga') e
--     exp_vagas_ajustar (não deixa baixar abaixo dos ocupados) — os três
--     passam a enxergar a fila sem mudar o código deles.
--   • exp_vagas_para_venda(p_venda uuid default null): + colunas
--       na_fila     = quantos dos ocupados ainda estão na fila (tela: "X
--                     reservadas aguardando a troca do sistema");
--       desta_venda = com p_venda, quantos ocupados são DESTA venda (tabela ou
--                     fila) — a tela soma de volta ao reabrir a própria venda
--                     (o passageiro da fila não tem passageiro_id no json).
--     Troca de assinatura → drop da versão sem parâmetro (a tela antiga chama
--     sem argumento e continua funcionando com o default).
--
-- Idempotente. Volta: recriar exp_ocupados e exp_vagas_para_venda() da 0214/0350
-- (drop function exp_vagas_para_venda(uuid) antes).
-- -----------------------------------------------------------------------------

create index if not exists exp_venda_pax_pendentes_abertos
  on exp_venda_pax_pendentes ((linha ->> 'expedicao_id')) where aplicado_em is null;

-- Só a fila (ajudante; mesma regra da parte da fila do exp_ocupados).
create or replace function exp_ocupados_na_fila(p_exp uuid, p_venda uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from exp_venda_pax_pendentes q
   where q.aplicado_em is null and q.acao = 'insert'
     and q.linha ->> 'expedicao_id' = p_exp::text
     and coalesce(nullif(q.linha ->> 'tipo', ''), 'Pagante') = 'Pagante'
     and coalesce(nullif(q.linha ->> 'status_reserva', ''), 'Pré-reserva') in ('Pré-reserva', 'Confirmado')
     and (p_venda is null or q.venda_id = p_venda)
     and not exists (select 1 from passageiros p
                      where p.id = case when q.linha ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                        then (q.linha ->> 'id')::uuid end);
$$;
revoke all on function exp_ocupados_na_fila(uuid, uuid) from public, anon, authenticated;

create or replace function exp_ocupados(p_exp uuid)
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*)::int from passageiros
           where expedicao_id = p_exp and tipo = 'Pagante' and status_reserva in ('Pré-reserva','Confirmado'))
       + exp_ocupados_na_fila(p_exp, null);
$$;
revoke all on function exp_ocupados(uuid) from public, anon;
grant execute on function exp_ocupados(uuid) to authenticated;

drop function if exists exp_vagas_para_venda();
create or replace function exp_vagas_para_venda(p_venda uuid default null)
returns table(id uuid, codigo text, nome text, destino text, data_embarque date, data_retorno date, status text,
              preco_venda_brl numeric, preco_sem_aereo_brl numeric, pax_planejados integer, ocupados integer, vagas integer,
              na_fila integer, desta_venda integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from qs_users u where u.id = auth.uid() and u.is_active) then
    raise exception 'sem-permissao';
  end if;
  return query
    select e.id, e.codigo, e.nome, e.destino, e.data_embarque, e.data_retorno, e.status::text,
           e.preco_venda_brl, e.preco_sem_aereo_brl,
           coalesce(e.pax_planejados, 0), o.n, greatest(coalesce(e.pax_planejados, 0) - o.n, 0),
           f.n,
           case when p_venda is null then 0 else
             (select count(*)::int from passageiros p
               where p.expedicao_id = e.id and p.venda_id = p_venda and p.tipo = 'Pagante'
                 and p.status_reserva in ('Pré-reserva','Confirmado'))
             + exp_ocupados_na_fila(e.id, p_venda) end
      from expedicoes e
      cross join lateral (select exp_ocupados(e.id) as n) o
      cross join lateral (select exp_ocupados_na_fila(e.id, null) as n) f
     where coalesce(e.tipo, 'expedicao') = 'expedicao'
       and e.status::text in ('Planejamento','Vendas Abertas','Em andamento')
       and (e.data_embarque is null or e.data_embarque >= (now() at time zone 'America/Sao_Paulo')::date)
     order by e.data_embarque nulls last, e.codigo;
end;
$$;
revoke all on function exp_vagas_para_venda(uuid) from public, anon;
grant execute on function exp_vagas_para_venda(uuid) to authenticated;

-- Conferência depois de aplicar (só leitura):
--   select codigo, pax_planejados, ocupados, na_fila, vagas from exp_vagas_para_venda() where na_fila > 0;
