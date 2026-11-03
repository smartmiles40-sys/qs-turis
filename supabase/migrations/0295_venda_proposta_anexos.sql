-- 0295_venda_proposta_anexos.sql
-- -----------------------------------------------------------------------------
-- PROPOSTA ANEXADA NA HORA DA VENDA (Bruno, 03/11/2026):
--   "E se só pedirmos para anexar a proposta na hora da venda, e deixar 'Em
--    breve' nessa parte, pq quero pensar em uma forma de conseguirmos gerar
--    essas propostas por dentro do QS (de uma forma automática)."
--
-- A tela única de venda (SubirVenda — Closer, Relacionamento e Operacional,
-- 0214) passa a exigir 1+ arquivo "Proposta enviada ao cliente" (PDF ou foto,
-- até 15 MB cada) antes de confirmar.
--
--   · bucket PRIVADO `vendas-propostas`, caminho "<pasta>/<arquivo>":
--       pasta = id do cartão do closer (qs_closer_negocios) na venda do closer,
--               ou um uuid novo (lote) na venda do Rel/Ops sem cartão;
--   · qs_venda_propostas — um registro por arquivo, ligado à venda (qs_vendas),
--     ao cartão (qs_closer_negocios), ao lead e ao cliente (rel_clientes).
--
-- Ordem (front, src/venda/propostaAnexo.ts): sobe o arquivo → registra
-- (venda_proposta_anexar) — se registrar falhar, apaga o arquivo → grava a
-- venda (venda_subir) — se falhar, apaga os anexos novos → amarra os anexos na
-- venda (venda_propostas_vincular). Assim a venda nunca nasce sem a proposta.
--
-- Quem vê: a mesma regra de qs_vendas (0214): gestão/admin, Relacionamento,
-- Financeiro, Operacional, quem subiu e o closer dono do cartão. Nada pra anon.
-- Escrita só pelas RPCs (security definer); apagar = quem subiu ou a gestão.
-- Depende de: 0174 (qs_closer_negocios, closer_pode_mexer), 0214 (qs_vendas),
-- 0201 (fin_tem_acesso), 0210 (app_eh_cliente). Idempotente.
-- Só ARQUIVO — aplicar com o ok do Bruno.
-- -----------------------------------------------------------------------------

-- ── 1) Bucket privado ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendas-propostas', 'vendas-propostas', false, 15728640,
        array['application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- ── 2) Tabela ───────────────────────────────────────────────────────────────
create table if not exists qs_venda_propostas (
  id            uuid primary key default gen_random_uuid(),
  venda_id      uuid references qs_vendas(id) on delete set null,
  negocio_id    uuid references qs_closer_negocios(id) on delete set null,
  lead_id       uuid references qs_leads(id) on delete set null,
  cliente_id    uuid references rel_clientes(id) on delete set null,
  arquivo_path  text not null unique,            -- dentro do bucket vendas-propostas
  arquivo_nome  text not null,
  mime          text,
  tamanho       int check (tamanho is null or tamanho between 0 and 15728640),
  criado_por    uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now()
);
comment on table qs_venda_propostas is
  'Proposta enviada ao cliente, anexada na hora de registrar a venda (0295). Arquivo no bucket privado vendas-propostas. Escrita só por venda_proposta_anexar / venda_propostas_vincular.';
create index if not exists qs_venda_propostas_venda   on qs_venda_propostas (venda_id)   where venda_id is not null;
create index if not exists qs_venda_propostas_negocio on qs_venda_propostas (negocio_id) where negocio_id is not null;
create index if not exists qs_venda_propostas_lead    on qs_venda_propostas (lead_id)    where lead_id is not null;
create index if not exists qs_venda_propostas_cliente on qs_venda_propostas (cliente_id) where cliente_id is not null;

-- ── 3) Quem vê (a regra de qs_vendas) ───────────────────────────────────────
create or replace function qs_venda_proposta_pode_ver(p_criado_por uuid, p_negocio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select qs_is_manager() or rel_tem_acesso() or fin_tem_acesso() or ops_tem_acesso()
      or p_criado_por = auth.uid()
      or exists (select 1 from qs_closer_negocios n where n.id = p_negocio and n.closer_id = auth.uid());
$$;
revoke all on function qs_venda_proposta_pode_ver(uuid, uuid) from public, anon;
grant execute on function qs_venda_proposta_pode_ver(uuid, uuid) to authenticated;

alter table qs_venda_propostas enable row level security;
drop policy if exists qs_venda_propostas_ler on qs_venda_propostas;
create policy qs_venda_propostas_ler on qs_venda_propostas for select to authenticated
  using (qs_venda_proposta_pode_ver(criado_por, negocio_id));
-- Apagar: quem subiu ou a gestão (a venda já gravada continua exigindo 1+ na tela).
drop policy if exists qs_venda_propostas_apagar on qs_venda_propostas;
create policy qs_venda_propostas_apagar on qs_venda_propostas for delete to authenticated
  using (criado_por = (select auth.uid()) or (select qs_is_manager()));
drop policy if exists app_cliente_barreira on qs_venda_propostas;
create policy app_cliente_barreira on qs_venda_propostas as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
revoke all on qs_venda_propostas from anon;
grant select, delete on qs_venda_propostas to authenticated;
grant all on qs_venda_propostas to service_role;

-- ── 4) Quem pode SUBIR numa pasta ───────────────────────────────────────────
-- pasta = cartão do closer → o closer dono (ou a gestão); qualquer outra pasta
-- (lote do Rel/Ops) → Relacionamento, Operacional ou gestão.
create or replace function qs_venda_proposta_pode_subir(p_pasta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_closer uuid; v_achou boolean := false;
begin
  if p_pasta is null or p_pasta !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  select true, closer_id into v_achou, v_closer from qs_closer_negocios where id = p_pasta::uuid;
  if coalesce(v_achou, false) then
    return closer_pode_mexer(v_closer) or rel_tem_acesso() or ops_tem_acesso();
  end if;
  return qs_is_manager() or rel_tem_acesso() or ops_tem_acesso();
end;
$$;
revoke all on function qs_venda_proposta_pode_subir(text) from public, anon;
grant execute on function qs_venda_proposta_pode_subir(text) to authenticated;

-- Ler o arquivo: quem enxerga o registro dele.
create or replace function qs_venda_proposta_ve_arquivo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from qs_venda_propostas a
                  where a.arquivo_path = p_name and qs_venda_proposta_pode_ver(a.criado_por, a.negocio_id));
$$;
revoke all on function qs_venda_proposta_ve_arquivo(text) from public, anon;
grant execute on function qs_venda_proposta_ve_arquivo(text) to authenticated;

-- ── 5) Storage ──────────────────────────────────────────────────────────────
drop policy if exists vendas_propostas_ler on storage.objects;
create policy vendas_propostas_ler on storage.objects for select to authenticated
  using (bucket_id = 'vendas-propostas' and qs_venda_proposta_ve_arquivo(name));
drop policy if exists vendas_propostas_subir on storage.objects;
create policy vendas_propostas_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'vendas-propostas' and qs_venda_proposta_pode_subir(split_part(name, '/', 1)));
-- Apagar: quem subiu (não deixa arquivo órfão se o registro/a venda falhar) ou a gestão.
drop policy if exists vendas_propostas_apagar on storage.objects;
create policy vendas_propostas_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'vendas-propostas' and (owner_id = (select auth.uid())::text or (select qs_is_manager())));

-- ── 6) Registrar o arquivo que acabou de subir ──────────────────────────────
create or replace function venda_proposta_anexar(p_path text, p_nome text, p_mime text default null,
                                                 p_tamanho int default null, p_negocio uuid default null,
                                                 p_cliente uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n    qs_closer_negocios;
  v_id uuid;
begin
  if p_path is null or position('/' in p_path) = 0 then raise exception 'caminho-invalido'; end if;
  if not qs_venda_proposta_pode_subir(split_part(p_path, '/', 1)) then raise exception 'sem-permissao'; end if;
  if p_negocio is not null then
    select * into n from qs_closer_negocios where id = p_negocio;
    if not found then raise exception 'negocio-nao-encontrado'; end if;
    if split_part(p_path, '/', 1) <> p_negocio::text then raise exception 'caminho-invalido'; end if;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'vendas-propostas' and o.name = p_path) then
    raise exception 'O arquivo não chegou — tente anexar de novo.';
  end if;
  insert into qs_venda_propostas (negocio_id, lead_id, cliente_id, arquivo_path, arquivo_nome, mime, tamanho)
  values (p_negocio, n.lead_id, p_cliente, p_path, left(coalesce(nullif(trim(p_nome), ''), 'proposta'), 200), p_mime, p_tamanho)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function venda_proposta_anexar(text, text, text, int, uuid, uuid) from public, anon;
grant execute on function venda_proposta_anexar(text, text, text, int, uuid, uuid) to authenticated;

-- ── 7) Amarrar os anexos na venda recém-gravada ─────────────────────────────
create or replace function venda_propostas_vincular(p_ids uuid[], p_venda uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v   qs_vendas;
  v_n int;
begin
  select * into v from qs_vendas where id = p_venda;
  if not found then raise exception 'venda-nao-encontrada'; end if;
  if not (v.criado_por = auth.uid() or qs_venda_proposta_pode_ver(v.criado_por, v.negocio_id)) then raise exception 'sem-permissao'; end if;
  update qs_venda_propostas a set
    venda_id   = v.id,
    negocio_id = coalesce(a.negocio_id, v.negocio_id),
    cliente_id = coalesce(v.cliente_id, a.cliente_id),
    lead_id    = coalesce(a.lead_id, (select n.lead_id from qs_closer_negocios n where n.id = v.negocio_id))
   where a.id = any(coalesce(p_ids, '{}'))
     and (a.criado_por = auth.uid() or qs_is_manager())
     and (a.venda_id is null or a.venda_id = v.id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function venda_propostas_vincular(uuid[], uuid) from public, anon;
grant execute on function venda_propostas_vincular(uuid[], uuid) to authenticated;
