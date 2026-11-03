-- 0290_proposta_insumos_ia.sql
-- -----------------------------------------------------------------------------
-- "MONTAR COM IA" (Bruno, 03/11/2026): "ter uma IA, que os Closers vão subindo
-- informações, como prints de voos e etc e ele preenche tudo sozinho, já
-- deixando a cotação pronta e sem ter que ficar preenchendo as coisas".
--
-- Cada proposta guarda os INSUMOS que o closer subiu/colou:
--   · arquivo — print (voo, hotel, passeio, seguro, tela da consolidadora) ou
--               PDF, no bucket PRIVADO `propostas-insumos`, caminho
--               "<proposta_id>/<nome>";
--   · texto   — conversa de WhatsApp, e-mail de fornecedor colado.
-- api/proposta-ia.js (service role) lê tudo e manda pra OpenAI; o resultado
-- volta pra tela e só vira proposta quando o closer abre, confere e SALVA.
-- O que veio da IA (pra marcar e pra mesclar sem passar por cima do que o
-- closer editou) fica em qs_propostas.conteudo._ia — a 0280 já salva o
-- conteúdo e api/proposta.js tira o _ia antes de mandar pro cliente.
--
-- Quem pode: ler = quem vê propostas (qs_pode_propostas); subir/apagar = quem
-- pode EDITAR aquela proposta (mesma regra do qs_proposta_salvar: do setor da
-- proposta ou quem criou).
-- Depende da 0156 (qs_propostas) e da 0149 (qs_do_setor). Só ARQUIVO — aplicar
-- com o ok do Bruno.
-- -----------------------------------------------------------------------------

-- ── Quem pode editar a proposta (texto: serve pro caminho do Storage) ───────
create or replace function qs_proposta_pode_editar(p_id text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_id is null or p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return exists (
    select 1 from qs_propostas
     where id = p_id::uuid and status <> 'cancelada'
       and (qs_do_setor(setor) or criado_por = auth.uid())
  );
end;
$$;
revoke all on function qs_proposta_pode_editar(text) from public, anon;
grant execute on function qs_proposta_pode_editar(text) to authenticated;

-- ── Insumos ─────────────────────────────────────────────────────────────────
create table if not exists qs_proposta_insumos (
  id            uuid primary key default gen_random_uuid(),
  proposta_id   uuid not null references qs_propostas(id) on delete cascade,
  tipo          text not null check (tipo in ('arquivo','texto')),
  arquivo_path  text,                    -- dentro do bucket propostas-insumos
  arquivo_nome  text,
  mime          text,
  tamanho       int,
  texto         text,                    -- tipo = texto (até 20 mil caracteres)
  lido_em       timestamptz,             -- última vez que a IA leu este insumo
  criado_por    uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  constraint qs_proposta_insumos_forma check (
    (tipo = 'arquivo' and arquivo_path is not null and texto is null)
    or (tipo = 'texto' and arquivo_path is null and length(coalesce(texto, '')) between 1 and 20000)
  ),
  constraint qs_proposta_insumos_tamanho check (tamanho is null or tamanho between 0 and 15728640)
);
create index if not exists qs_proposta_insumos_proposta on qs_proposta_insumos (proposta_id, criado_em);

alter table qs_proposta_insumos enable row level security;
drop policy if exists qs_prop_insumos_ler on qs_proposta_insumos;
drop policy if exists qs_prop_insumos_criar on qs_proposta_insumos;
drop policy if exists qs_prop_insumos_apagar on qs_proposta_insumos;
create policy qs_prop_insumos_ler on qs_proposta_insumos for select to authenticated
  using (qs_pode_propostas());
create policy qs_prop_insumos_criar on qs_proposta_insumos for insert to authenticated
  with check (qs_proposta_pode_editar(proposta_id::text)
              and (arquivo_path is null or split_part(arquivo_path, '/', 1) = proposta_id::text));
create policy qs_prop_insumos_apagar on qs_proposta_insumos for delete to authenticated
  using (qs_proposta_pode_editar(proposta_id::text));
revoke all on qs_proposta_insumos from anon;
grant select, insert, delete on qs_proposta_insumos to authenticated;

-- ── Storage: bucket privado (15 MB por arquivo; imagens e PDF) ──────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('propostas-insumos', 'propostas-insumos', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists qs_prop_insumos_obj_ler on storage.objects;
drop policy if exists qs_prop_insumos_obj_subir on storage.objects;
drop policy if exists qs_prop_insumos_obj_apagar on storage.objects;
create policy qs_prop_insumos_obj_ler on storage.objects for select to authenticated
  using (bucket_id = 'propostas-insumos' and qs_pode_propostas());
create policy qs_prop_insumos_obj_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'propostas-insumos' and qs_proposta_pode_editar((storage.foldername(name))[1]));
create policy qs_prop_insumos_obj_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'propostas-insumos' and qs_proposta_pode_editar((storage.foldername(name))[1]));
