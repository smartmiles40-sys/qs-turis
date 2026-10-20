-- 0155_rel_documentos_sem_copia.sql
-- -----------------------------------------------------------------------------
-- ARQUIVOS REPETIDOS NA VIAGEM (Bruno, 20/10/2026). A viagem da Luana mostrava
-- 63 documentos: 20 arquivos de verdade, cada um 3× (negócios #41029, #43171,
-- #43173). Quando o card é copiado no Bitrix, o arquivo ganha um file_id novo,
-- e a fila (chave = file_id) baixava de novo. Na base: 6.267 cópias de 9.731.
--
--   1. sha256 do arquivo: o importador (api/_relBitrixArquivos.js) confere,
--      antes de subir, se a viagem já tem o mesmo arquivo (hash, ou nome +
--      tamanho em bytes) e reaproveita o documento.
--   2. Cópia NÃO é apagada: ganha copia_de = o original e some das telas (a
--      policy de leitura esconde). Na mesma viagem, mesmo nome + mesmo tamanho
--      = cópia; fica a revisada / lida pela IA / com trecho / a mais antiga.
--      Trechos e a fila do Bitrix passam a apontar pro original.
--      Desfazer: update rel_documentos set copia_de = null where copia_de is not null;
--   3. ia_revisao: o mesmo alerta repetido (um por cópia) vira um só.
-- -----------------------------------------------------------------------------

alter table public.rel_documentos
  add column if not exists sha256 text,
  add column if not exists copia_de uuid references public.rel_documentos(id) on delete set null;
create index if not exists rel_documentos_viagem_arquivo_idx
  on public.rel_documentos (viagem_id, arquivo_nome, tamanho) where copia_de is null;
create index if not exists rel_documentos_viagem_sha_idx
  on public.rel_documentos (viagem_id, sha256) where sha256 is not null and copia_de is null;

drop policy if exists rel_documentos_ler on public.rel_documentos;
create policy rel_documentos_ler on public.rel_documentos for select to authenticated
  using (public.rel_tem_acesso() and copia_de is null);

with g as (
  select id,
    first_value(id) over w as fica,
    row_number() over w as rn
  from public.rel_documentos d
  where viagem_id is not null and tamanho is not null and arquivo_nome is not null and copia_de is null
  window w as (partition by viagem_id, arquivo_nome, tamanho
    order by (status <> 'recebido') desc, (revisado_em is not null) desc, (ia_status is not null) desc,
             (exists (select 1 from public.rel_viagem_trechos t where t.documento_id = d.id)) desc,
             enviado_em, id)
), c as (select id, fica from g where rn > 1),
tr as (update public.rel_viagem_trechos t set documento_id = c.fica from c where t.documento_id = c.id returning 1),
fa as (update public.rel_bitrix_arquivos a set documento_id = c.fica from c where a.documento_id = c.id returning 1)
update public.rel_documentos d set copia_de = c.fica from c where d.id = c.id;

-- alertas da IA: um por texto; documentos lidos: um por arquivo
update public.rel_viagens v set ia_revisao = jsonb_set(
    jsonb_set(v.ia_revisao, '{divergencias}', coalesce((
      select jsonb_agg(x.e order by x.o) from (
        select distinct on (e->>'texto') e, o
        from jsonb_array_elements(v.ia_revisao->'divergencias') with ordinality as a(e, o)
        order by e->>'texto', o) x), '[]'::jsonb)),
    '{documentos}', coalesce((
      select jsonb_agg(x.e order by x.o) from (
        select distinct on (coalesce(e->>'arquivo_nome', e->>'documento_id', o::text)) e, o
        from jsonb_array_elements(v.ia_revisao->'documentos') with ordinality as a(e, o)
        order by coalesce(e->>'arquivo_nome', e->>'documento_id', o::text), o) x), '[]'::jsonb))
where jsonb_typeof(v.ia_revisao->'divergencias') = 'array'
  and jsonb_typeof(v.ia_revisao->'documentos') = 'array';
