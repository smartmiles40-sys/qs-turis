-- 0201_rel_contadores_leves.sql
-- -----------------------------------------------------------------------------
-- RELACIONAMENTO MAIS LEVE: as bolinhas do menu (22/10/2026).
--
-- O menu do Rel conta, de tempos em tempos, duplicados, alertas urgentes e
-- viagens com/sem dono. MEDIDO no banco de produção:
--   • count(rel_duplicados_sugeridos) ........ 402 ms (pg_stat: média 663 ms)
--   • count(rel_alertas where gravidade='alta') 135 ms (média 612 ms)
--   • count(rel_viagens_v ... acompanhamento)   ~90 ms cada (2 por rodada)
--
-- CAUSA 1 — alertas e viagens: o filtro "acompanhamento in (completo, leve)"
--   chama rel_servico_auto(tipo, bitrix_dados) linha a linha, e isso abre o
--   JSON inteiro do Bitrix (TOAST) de ~1.400 viagens: 89 ms dos 90 ms.
--   CONSERTO: índice na expressão. O filtro vira consulta ao índice
--   (ensaiado numa cópia: 90 ms → 0,3 ms, as mesmas 190 viagens). Vale pra
--   rel_viagens_v, rel_esteira_atrasadas() (o pedaço caro de rel_alertas),
--   Esteira, Viagens e contagem de donos — sem mudar nenhuma view.
--   ⚠ Se um dia rel_servico_auto ou rel_acompanhamento mudarem (CREATE OR
--   REPLACE), rodar logo depois:  REINDEX INDEX public.rel_viagens_acomp_idx;
--   (o Postgres não recalcula o índice sozinho quando a função muda).
--
-- CAUSA 2 — duplicados: a view compara TODOS os pares de clientes (913² =
--   833 mil comparações) por causa do OR. CONSERTO: rel_duplicados_contagem()
--   acha os candidatos por igualdade (CPF, telefone, e-mail, nome, nascimento
--   + primeiro nome — cada um vira hash join) e REAPLICA o filtro inteiro da
--   view nos candidatos. Mesmo número (22 = 22 no ensaio), 402 ms → 35 ms.
--   É SECURITY INVOKER: a RLS de rel_clientes vale igual à da view.
--   A view continua a mesma (a tela Duplicados lista por ela).
--
-- Tudo aditivo: um índice e uma função. Nada de dado muda.
-- -----------------------------------------------------------------------------

-- 1) Índice da expressão "acompanhamento" (a mesma da view rel_viagens_v).
--    rel_viagens tem ~1.850 linhas: cria em menos de 1 s.
set lock_timeout = '5s';
create index if not exists rel_viagens_acomp_idx
  on public.rel_viagens (rel_acompanhamento(coalesce(servico_manual, rel_servico_auto(tipo, bitrix_dados))));
reset lock_timeout;
analyze public.rel_viagens;

-- 2) Contagem de duplicados sugeridos — mesmo resultado de
--    select count(*) from rel_duplicados_sugeridos, sem o produto cartesiano.
create or replace function public.rel_duplicados_contagem()
returns integer
language sql
stable
set search_path = public
as $$
  with vivos as materialized (
    select id, cpf, email, nascimento, titular_id,
           rel_nome_chave(nome) as nk, rel_fone_chave(telefone) as fk
      from rel_clientes
     where mesclado_em_id is null and arquivado_em is null
  ), candidatos as (
    -- todo par que passa no OR da view casa em pelo menos uma destas igualdades
              select a.id as a_id, b.id as b_id from vivos a join vivos b on a.cpf = b.cpf and a.id < b.id
    union     select a.id, b.id from vivos a join vivos b on a.fk = b.fk and a.id < b.id
    union     select a.id, b.id from vivos a join vivos b on a.email = b.email and a.id < b.id
    union     select a.id, b.id from vivos a join vivos b on a.nk = b.nk and a.id < b.id
    union     select a.id, b.id from vivos a join vivos b
                on a.nascimento = b.nascimento and split_part(a.nk, ' ', 1) = split_part(b.nk, ' ', 1) and a.id < b.id
  )
  select count(*)::integer
    from candidatos p
    join vivos a on a.id = p.a_id
    join vivos b on b.id = p.b_id
   -- o filtro da view rel_duplicados_sugeridos, sem tirar nada
   where (a.cpf = b.cpf or a.fk = b.fk or a.email = b.email
          or a.nk = b.nk and length(a.nk) >= 5
          or a.nascimento = b.nascimento and split_part(a.nk, ' ', 1) = split_part(b.nk, ' ', 1))
     and not coalesce(a.titular_id = b.id or b.titular_id = a.id or a.titular_id = b.titular_id, false)
     and not (a.cpf is not null and b.cpf is not null and a.cpf <> b.cpf)
     and not exists (select 1 from rel_nao_duplicados n where n.a = a.id and n.b = b.id)
$$;

comment on function public.rel_duplicados_contagem() is
  'Mesmo número que count(*) de rel_duplicados_sugeridos, por hash join em vez de comparar todos os pares (0201). Se a view mudar o filtro, mudar aqui também.';

revoke all on function public.rel_duplicados_contagem() from public, anon;
grant execute on function public.rel_duplicados_contagem() to authenticated, service_role;
