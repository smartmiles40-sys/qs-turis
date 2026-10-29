# Proposta de schema — Ficha do Cliente (29/10/2026)

> Só proposta. **Nada foi aplicado.** Item [SCHEMA] da spec `docs/ref/qs-redesign-ficha-solicitacoes.md` (seção 3, "Pessoas ligadas").
> Aguarda o ok do Bruno antes de virar migration.

## 1. O problema: "Família" e "Quem viaja junto" são duas coisas no banco

Hoje a mesma relação entre duas pessoas mora em dois lugares:

| Onde | O que guarda | Quem grava |
|---|---|---|
| `rel_clientes.titular_id` + `rel_clientes.parentesco` (0100) | árvore de família: cada membro aponta pro titular; parentesco `conjuge, filho, pai_mae, irmao, neto, amigo, outro` | Rel (ClienteForm → "Adicionar familiar") |
| `cad_acompanhantes` (0213) | pares "quem viaja junto": `cliente_id`, `acompanhante_id`, `vinculo` `conjuge, filho, pai_mae, irmao, amigo, outro` (sem `neto`) | SDR, Closer, Rel e Ops (CadastroPessoa → "Quem viaja junto") |

Efeitos: o mesmo cônjuge pode estar nos dois com vínculos diferentes; a família só tem 1 nível (titular); "viaja junto" não diz **em qual viagem**.

A ficha nova já mostra **um bloco só** ("Pessoas ligadas"), fazendo a união na tela (`pessoasLigadas()` em `src/rel/clientes/ficha/LateralFicha.tsx`). Funciona, mas a duplicidade continua no banco.

## 2. Proposta: uma tabela de vínculo + marcação por viagem

```sql
-- 02xx_pessoas_ligadas.sql  (PROPOSTA — não aplicar sem ok)

-- a) O vínculo entre duas pessoas (um par, vale nos dois sentidos).
--    Reaproveita cad_acompanhantes, que já tem o par único e a RLS da 0213.
alter table public.cad_acompanhantes rename to cad_vinculos;            -- ou manter o nome e criar uma view
alter table public.cad_vinculos drop constraint if exists cad_acompanhantes_vinculo_check;
alter table public.cad_vinculos add constraint cad_vinculos_vinculo_check
  check (vinculo in ('conjuge', 'filho', 'pai_mae', 'irmao', 'neto', 'amigo', 'outro'));   -- + 'neto' (vem da família)
alter table public.cad_vinculos add column if not exists familia boolean not null default false;  -- era titular_id
alter table public.cad_vinculos add column if not exists viaja_junto boolean not null default true; -- marcação geral

-- b) "Viaja junto" POR VIAGEM (spec: "um marcador viaja junto por viagem").
create table if not exists public.cad_vinculo_viagens (
  vinculo_id uuid not null references public.cad_vinculos(id) on delete cascade,
  -- uma das duas: viagem do Rel ou ida em expedição/pacote (Ops)
  viagem_id uuid references public.rel_viagens(id) on delete cascade,
  expedicao_id uuid references public.expedicoes(id) on delete cascade,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  check ((viagem_id is not null) <> (expedicao_id is not null))
);
create unique index if not exists cad_vinculo_viagens_uq
  on public.cad_vinculo_viagens (vinculo_id, coalesce(viagem_id, expedicao_id));
-- RLS: mesma regra da 0213 (quem pode ler/editar o cadastro da pessoa).

-- c) Migrar a família pra dentro (idempotente).
insert into public.cad_vinculos (cliente_id, acompanhante_id, vinculo, familia, viaja_junto)
select c.titular_id, c.id, coalesce(c.parentesco, 'outro'), true, false
  from public.rel_clientes c
 where c.titular_id is not null and c.mesclado_em_id is null
on conflict do nothing;   -- par já existe como acompanhante: marcar familia=true num update à parte
update public.cad_vinculos v set familia = true
  from public.rel_clientes c
 where c.titular_id is not null
   and least(v.cliente_id, v.acompanhante_id) = least(c.titular_id, c.id)
   and greatest(v.cliente_id, v.acompanhante_id) = greatest(c.titular_id, c.id);

-- d) titular_id/parentesco ficam (só leitura) por um tempo: telas antigas, KPIs da
--    carteira e o rel_auditoria leem esses campos. Depois de tudo migrado, um gatilho
--    pode mantê-los a partir de cad_vinculos, ou eles saem numa migration futura.
```

RPCs a ajustar (0213): `cad_ler_pessoa` passa a devolver `vinculos[]` com `{ id, nome, vinculo, familia, viaja_junto, viagens[] }`; `cad_ligar_acompanhante` ganha `p_familia` e `p_viaja_junto`; nova `cad_marcar_viagem(vinculo_id, viagem_id|expedicao_id, marcado)`.

## 3. Antes de aplicar, conferir

- Quantos pares existem nos dois lugares com vínculo diferente (`titular_id` × `cad_acompanhantes`) — decidir qual vale.
- `parentesco = 'neto'` existe hoje? (o check da 0213 não aceita).
- Quem lê `titular_id` além da ficha: `rel_cliente_metricas` (família no LTV?), `ClientesPage`, `ClienteForm`, `carregarFamilia`.

## 4. Outro item [SCHEMA] notado (fora da ficha, só registro)

- `qs_sol_criar` recusa `p_de = p_para` ("Escolha outro setor"). O "Pedir" da ficha cria a solicitação **para o Relacionamento**; quando quem pede está no próprio Relacionamento, o banco recusa e a tela mostra o aviso. Se o pedido Rel → Rel deve existir (fila interna), a regra precisa abrir uma exceção (ex.: permitir `de = para` quando `p_tipo = 'rel_contato'`). A distribuição automática que o Bruno está fazendo pode resolver junto.
