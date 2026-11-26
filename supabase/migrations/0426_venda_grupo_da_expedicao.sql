-- 0426_venda_grupo_da_expedicao.sql
-- -----------------------------------------------------------------------------
-- GRUPO DA EXPEDIÇÃO (G1/G2…) NA VENDA (revisão do Subir venda, 26/11/2026).
--
-- Problema: expedições com mais de uma turma têm grupos em grupos_expedicao
-- (cada um com data_embarque / data_retorno próprias), mas o venda_subir criava
-- o passageiro SEM grupo_id — o Operacional tinha que achar e mover um por um
-- (exp_grupo_definir). E a lista de expedições com vaga do vendedor
-- (exp_vagas_para_venda, 0368) não mostrava os grupos.
--
-- O que muda:
--   1) venda_subir aceita o grupo:
--        · itens[k].dados.grupo_id (uuid) no item de expedição → vale pra todo
--          mundo desse item;
--        · viajantes[j].grupo_id (uuid, opcional) → sobrescreve o do item só pra
--          essa pessoa (ex.: casal em turmas diferentes).
--      O grupo TEM que ser da mesma expedição, senão exception 'grupo-invalido'.
--      Passageiro novo nasce com grupo_id; passageiro que já existia só troca se
--      veio grupo (sem grupo no payload = mantém o que o Operacional pôs).
--      O json qs_venda_itens.passageiros ganha 'grupo_id' por pessoa.
--      (dados.grupo_id também fica guardado no próprio item, como o resto de dados.)
--   2) exp_vagas_para_venda(p_venda) devolve UMA coluna nova no fim, sem mudar as
--      outras: grupos jsonb = lista ordenada (ordem, nome) de
--        { id, nome, data_embarque, data_retorno, pax_planejados, ocupados }
--      ocupados = pagantes em Pré-reserva/Confirmado naquele grupo (mesma conta
--      do exp_ocupados, sem a fila do espelho). Expedição sem grupo → [].
--      Mudar o tipo de retorno exige drop + create; os grants da 0368 são
--      refeitos (só authenticated).
--   Obs.: grupos_expedicao também guarda subgrupos de voo (ex. JAPCHI "Europa –
--   Natal"), não só G1/G2 — a lista devolve todos; a tela decide o que mostrar.
--
-- venda_subir: remendo na definição VIGENTE (pg_get_functiondef ao aplicar);
-- trecho que não estiver lá exatamente 1 vez PARA a migration. Idempotente
-- (marca "0426"; a função de vagas é drop if exists + create).
--
-- Volta:
--   venda_subir: pg_get_functiondef('venda_subir(jsonb)'::regprocedure), apagar as
--   linhas/blocos "0426" e executar;
--   exp_vagas_para_venda: drop function exp_vagas_para_venda(uuid); e rodar de
--   novo o bloco dela da 0368 (com os grants).
-- -----------------------------------------------------------------------------

create or replace function pg_temp.qs_remendar(p_fn regprocedure, p_marca text, p_trocas text[])
returns void language plpgsql as $f$
declare
  d    text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
  de   text;
  para text;
  n    int;
begin
  if position(p_marca in d) > 0 then
    raise notice '% já tem a marca % — nada a fazer.', p_fn, p_marca;
    return;
  end if;
  for k in 1 .. coalesce(array_length(p_trocas, 1), 0) / 2 loop
    de   := replace(p_trocas[2 * k - 1], E'\r\n', E'\n');
    para := replace(p_trocas[2 * k], E'\r\n', E'\n');
    n := (length(d) - length(replace(d, de, ''))) / length(de);
    if n <> 1 then
      raise exception '%: o trecho % aparece % vez(es) na versão vigente (esperado 1) — a função mudou; revise a migration %.', p_fn, k, n, p_marca;
    end if;
    d := replace(d, de, para);
  end loop;
  if position(p_marca in d) = 0 then raise exception '%: a marca % não entrou.', p_fn, p_marca; end if;
  execute d;
end $f$;

-- ── 1) venda_subir grava o grupo ───────────────────────────────────────────
select pg_temp.qs_remendar('venda_subir(jsonb)'::regprocedure, '0426', array[
-- variáveis
$a$  v_ids     uuid[] := '{}';$a$,
$b$  v_ids     uuid[] := '{}';
  v_grpi    uuid;   -- 0426: grupo do item
  v_grp     uuid;   -- 0426: grupo da pessoa$b$,
-- grupo do item (confere que é desta expedição)
$a$    if not found then raise exception 'expedicao-nao-encontrada'; end if;$a$,
$b$    if not found then raise exception 'expedicao-nao-encontrada'; end if;
    -- 0426: grupo da expedição (G1/G2…) escolhido no item.
    v_grpi := nullif(it #>> '{dados,grupo_id}', '')::uuid;
    if v_grpi is not null and not exists (select 1 from grupos_expedicao g where g.id = v_grpi and g.expedicao_id = v_exp) then
      raise exception 'grupo-invalido';
    end if;$b$,
-- grupo da pessoa (viajante pode ter o seu)
$a$      v_pcli := (v_nomes ->> (vj ->> 'chave'))::uuid;
      v_pax := null;$a$,
$b$      v_pcli := (v_nomes ->> (vj ->> 'chave'))::uuid;
      v_pax := null;
      v_grp := coalesce(nullif(vj ->> 'grupo_id', '')::uuid, v_grpi);   -- 0426
      if v_grp is distinct from v_grpi
         and not exists (select 1 from grupos_expedicao g where g.id = v_grp and g.expedicao_id = v_exp) then
        raise exception 'grupo-invalido';
      end if;$b$,
-- passageiro novo: coluna
$a$                                 condicao_obs, pagamento, observacoes)$a$,
$b$                                 condicao_obs, pagamento, observacoes, grupo_id)   -- 0426$b$,
-- passageiro novo: valor
$a$               nullif(trim(coalesce(p ->> 'observacoes', '')), '')
          from rel_clientes c where c.id = v_pcli$a$,
$b$               nullif(trim(coalesce(p ->> 'observacoes', '')), ''), v_grp
          from rel_clientes c where c.id = v_pcli$b$,
-- passageiro que já existia: só troca se veio grupo
$a$pagamento = v_pag
         where id = v_pax;$a$,
$b$pagamento = v_pag,
          grupo_id = coalesce(v_grp, grupo_id)   -- 0426
         where id = v_pax;$b$,
-- json do item
$a$                 'quarto_par_id', px.quarto_par_id, 'divide_nome', px.acompanhante_dividir_com,$a$,
$b$                 'quarto_par_id', px.quarto_par_id, 'divide_nome', px.acompanhante_dividir_com,
                 'grupo_id', px.grupo_id,   -- 0426$b$
]);

-- ── 2) exp_vagas_para_venda devolve os grupos ──────────────────────────────
-- (corpo = 0368, vigente conferido 26/11 por md5 do prosrc, + a coluna grupos)
drop function if exists exp_vagas_para_venda(uuid);
create function exp_vagas_para_venda(p_venda uuid default null)
returns table(id uuid, codigo text, nome text, destino text, data_embarque date, data_retorno date, status text,
              preco_venda_brl numeric, preco_sem_aereo_brl numeric, pax_planejados integer, ocupados integer, vagas integer,
              na_fila integer, desta_venda integer, grupos jsonb)
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
             + exp_ocupados_na_fila(e.id, p_venda) end,
           -- 0426: grupos da expedição (G1/G2…) com datas próprias
           coalesce((select jsonb_agg(jsonb_build_object(
                        'id', g.id, 'nome', g.nome,
                        'data_embarque', g.data_embarque, 'data_retorno', g.data_retorno,
                        'pax_planejados', g.pax_planejados,
                        'ocupados', (select count(*)::int from passageiros p2
                                      where p2.expedicao_id = e.id and p2.grupo_id = g.id and p2.tipo = 'Pagante'
                                        and p2.status_reserva in ('Pré-reserva','Confirmado')))
                      order by g.ordem, g.nome)
                       from grupos_expedicao g where g.expedicao_id = e.id), '[]'::jsonb)
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

-- PostgREST: recarrega o cache (tipo de retorno novo).
notify pgrst, 'reload schema';
