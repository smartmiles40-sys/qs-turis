-- 0423_venda_dono_do_rel.sql
-- -----------------------------------------------------------------------------
-- DONO DO RELACIONAMENTO NA VENDA (revisão do Subir venda, 26/11/2026).
--
-- Problema: a ficha antiga do closer (src/closer/FichaFechamento.tsx, bloco
-- "4. Quem cuida no Relacionamento", ~l.447) gravava ficha.rel_responsavel_id e
-- o closer_consolidar copiava pra rel_viagens.responsavel_id (a coluna de dono
-- da viagem). O Subir venda não tem esse campo: a venda consolidada caía sempre
-- na fila "sem dono" do Rel (a menos que a ficha velha do cartão tivesse um).
--
-- O que muda:
--   1) qs_vendas.rel_responsavel_id uuid (nulo = sem dono), FK qs_users.
--   2) venda_subir aceita p.rel_responsavel_id (opcional):
--        · chave AUSENTE no payload → não mexe (chamadas antigas seguem iguais);
--        · null ou ''               → tira o dono da venda;
--        · uuid                     → precisa ser usuário ATIVO do Relacionamento
--          (role admin ou 'relacionamento' em setores — MESMA regra do
--          closer_consolidar), senão exception 'responsavel-invalido'.
--   3) venda_consolidar leva o dono pra viagem:
--        · com cartão: põe rel_responsavel_id na ficha enviada ao
--          closer_consolidar (que já faz responsavel_id = coalesce(v_resp,
--          responsavel_id)). Venda sem dono → fica o da ficha antiga do cartão,
--          se houver; e nunca apaga o dono que a viagem já tem.
--        · sem cartão: grava no INSERT da viagem nova; na viagem existente faz
--          responsavel_id = coalesce(venda.rel_responsavel_id, responsavel_id).
--
-- Remendo na definição VIGENTE (pg_get_functiondef ao aplicar) das duas funções;
-- trecho que não estiver lá exatamente 1 vez PARA a migration. Idempotente
-- (marca "0423"; coluna com if not exists).
--
-- Volta:
--   rodar pg_get_functiondef de venda_subir(jsonb) e venda_consolidar(uuid),
--   apagar as linhas/blocos marcados "0423" e executar;
--   alter table qs_vendas drop column if exists rel_responsavel_id;
--   (a coluna precisa sair DEPOIS das funções voltarem, senão elas quebram.)
-- -----------------------------------------------------------------------------

alter table qs_vendas add column if not exists rel_responsavel_id uuid references qs_users(id) on delete set null;
comment on column qs_vendas.rel_responsavel_id is
  '0423: quem cuida da viagem no Relacionamento (vai pra rel_viagens.responsavel_id no venda_consolidar). Nulo = fila sem dono.';

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

-- ── venda_subir: aceita e grava o dono ──────────────────────────────────────
select pg_temp.qs_remendar('venda_subir(jsonb)'::regprocedure, '0423', array[
-- 1) variável
$a$  v_ids     uuid[] := '{}';$a$,
$b$  v_ids     uuid[] := '{}';
  v_rresp   uuid;   -- 0423$b$,
-- 2) grava logo depois de a venda existir (antes das linhas de pagamento)
$a$  -- 0357: linhas de pagamento (substitui;$a$,
$b$  -- 0423: dono do Relacionamento (opcional). Chave ausente = mantém; null/'' = tira.
  if p ? 'rel_responsavel_id' then
    v_rresp := nullif(p ->> 'rel_responsavel_id', '')::uuid;
    if v_rresp is not null and not exists (
         select 1 from qs_users where id = v_rresp and is_active
            and (role = 'admin' or 'relacionamento' = any(coalesce(setores, '{}')))) then
      raise exception 'responsavel-invalido';
    end if;
    update qs_vendas set rel_responsavel_id = v_rresp
     where id = v_venda and rel_responsavel_id is distinct from v_rresp;
  end if;

  -- 0357: linhas de pagamento (substitui;$b$
]);

-- ── venda_consolidar: leva o dono pra viagem ────────────────────────────────
select pg_temp.qs_remendar('venda_consolidar(uuid)'::regprocedure, '0423', array[
-- 1) com cartão: vai na ficha do closer_consolidar (vazio = fica o que a ficha já tinha)
$a$      'plano', jsonb_build_object('entrada', null, 'parcelas', v_parc, 'observacao_financeiro', v.obs_financeiro));$a$,
$b$      'plano', jsonb_build_object('entrada', null, 'parcelas', v_parc, 'observacao_financeiro', v.obs_financeiro))
      -- 0423: dono do Rel escolhido no Subir venda (vazio = fica o da ficha antiga / o da viagem)
      || case when v.rel_responsavel_id is not null
              then jsonb_build_object('rel_responsavel_id', v.rel_responsavel_id) else '{}'::jsonb end;$b$,
-- 2) sem cartão, viagem nova: colunas
$a$                               cliente_id, status, origem, servico_manual, servico_por, servico_em, consolidada_em, consolidada_por)$a$,
$b$                               cliente_id, status, origem, servico_manual, servico_por, servico_em, consolidada_em, consolidada_por,
                               responsavel_id)   -- 0423$b$,
-- 3) sem cartão, viagem nova: valores
$a$              v_serv, auth.uid(), now(), now(), auth.uid())$a$,
$b$              v_serv, auth.uid(), now(), now(), auth.uid(),
              v.rel_responsavel_id)$b$,
-- 4) sem cartão, viagem que já existe: não apaga o dono que ela tem
$a$      update rel_viagens set consolidada_em = coalesce(consolidada_em, now()), consolidada_por = coalesce(consolidada_por, auth.uid())$a$,
$b$      update rel_viagens set consolidada_em = coalesce(consolidada_em, now()), consolidada_por = coalesce(consolidada_por, auth.uid()),
             responsavel_id = coalesce(v.rel_responsavel_id, responsavel_id)   -- 0423$b$
]);

-- PostgREST: recarrega o cache (coluna nova em qs_vendas).
notify pgrst, 'reload schema';
