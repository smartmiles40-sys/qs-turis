-- 0316 — Central de Solicitações: ANEXOS (05/11/2026)
--
-- Pedido do Bruno: "todo mundo está pedindo, na parte de Solicitações, poder
-- anexar arquivos". Vale pra conversa do quadro, o modal completo e a criação
-- do pedido.
--
--   1. Bucket PRIVADO `solicitacoes` (25 MB por arquivo). Caminho:
--        <solicitacao_id>/<carimbo>-<aleatório>.<ext>        (o arquivo)
--        <solicitacao_id>/<carimbo>-<aleatório>.mini.webp    (miniatura da foto,
--                                                              feita no navegador)
--   2. Tabela qs_solicitacao_anexos (um registro por arquivo). evento_id aponta
--      pra mensagem (qs_solicitacao_eventos) em que o arquivo foi enviado — é
--      assim que o anexo aparece DENTRO da bolha.
--   3. RLS = a regra VIGENTE de quem vê o pedido (qs_ve_solicitacao, a mesma da
--      qs_sol_ler / qs_sol_ev_ler / qs_sol_seg_ler): quem pediu, o responsável,
--      quem é do setor que pediu ou do que recebe (admin vê tudo). Escrita só
--      por RPC:
--        qs_sol_anexar(p_id, p_texto, p_arquivos)  → grava os anexos + UMA
--          mensagem (evento 'comentario'). Por ser 'comentario', reaproveita da
--          0315: o aviso pra todos os participantes (trg_qs_avisos_sol_evento),
--          quem anexa passa a acompanhar (trg_qs_sol_seguir_ao_comentar) e a
--          contagem de não lidas (view). Sem texto, a mensagem vira
--          "anexou orçamento.pdf" com para = 'anexos' (a tela sabe que o texto
--          é automático e mostra só os arquivos).
--        qs_sol_anexo_apagar(p_anexo) → só quem enviou ou o gestor de um dos
--          dois setores (admin também). Devolve os caminhos pra a tela apagar
--          os arquivos do Storage.
--        qs_sol_anexos_resumo(p_ids) → nº de anexos + miniatura da 1ª foto de
--          cada pedido (pros cartões do quadro). security invoker: a RLS filtra.
--   4. storage.objects do bucket: ler/subir = quem vê o pedido do 1º pedaço do
--      caminho; apagar = dono do arquivo ou gestor; nada de update.
--
-- Executáveis são barrados na tela E aqui (pela extensão do nome).

-- ── 1. Bucket ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('solicitacoes', 'solicitacoes', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ── 2. Tabela ───────────────────────────────────────────────────────────────
create table if not exists public.qs_solicitacao_anexos (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.qs_solicitacoes(id) on delete cascade,
  evento_id      bigint references public.qs_solicitacao_eventos(id) on delete set null,
  path           text not null unique,
  miniatura      text,
  nome           text not null,
  mime           text,
  tamanho        bigint not null default 0 check (tamanho >= 0 and tamanho <= 26214400),
  enviado_por    uuid references public.qs_users(id) on delete set null default auth.uid(),
  enviado_nome   text,
  criado_em      timestamptz not null default now()
);
create index if not exists qs_sol_anexos_sol_idx on public.qs_solicitacao_anexos (solicitacao_id, criado_em);
create index if not exists qs_sol_anexos_evento_idx on public.qs_solicitacao_anexos (evento_id) where evento_id is not null;

alter table public.qs_solicitacao_anexos enable row level security;
drop policy if exists app_cliente_barreira on public.qs_solicitacao_anexos;
create policy app_cliente_barreira on public.qs_solicitacao_anexos as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
drop policy if exists qs_sol_anexos_ler on public.qs_solicitacao_anexos;
create policy qs_sol_anexos_ler on public.qs_solicitacao_anexos for select to authenticated
  using (exists (select 1 from public.qs_solicitacoes s
                  where s.id = solicitacao_id and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id)));
revoke all on public.qs_solicitacao_anexos from public, anon;
grant select on public.qs_solicitacao_anexos to authenticated;

-- ── 3. Regras do caminho / extensão ─────────────────────────────────────────
-- O pedido dono do arquivo (1º pedaço do caminho) é visível pra mim?
create or replace function public.qs_sol_ve_arquivo(p_name text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from qs_solicitacoes s
     where s.id = case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then split_part(p_name, '/', 1)::uuid end
       and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id));
$$;
revoke all on function public.qs_sol_ve_arquivo(text) from public, anon;
grant execute on function public.qs_sol_ve_arquivo(text) to authenticated;

-- Sou gestor (ou admin) de um dos dois setores do pedido do arquivo?
create or replace function public.qs_sol_gestor_do_arquivo(p_name text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from qs_solicitacoes s
     where s.id = case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then split_part(p_name, '/', 1)::uuid end
       and (qs_gestor_do_setor(s.de_setor) or qs_gestor_do_setor(s.para_setor)));
$$;
revoke all on function public.qs_sol_gestor_do_arquivo(text) from public, anon;
grant execute on function public.qs_sol_gestor_do_arquivo(text) to authenticated;

-- Mesma lista da tela (src/solicitacoes/anexos.ts → EXT_BLOQUEADAS).
create or replace function public.qs_sol_ext_bloqueada(p_nome text)
returns boolean language sql immutable set search_path to 'public' as $$
  select lower(coalesce(substring(p_nome from '\.([A-Za-z0-9]+)$'), '')) = any (array[
    'exe','msi','bat','cmd','com','scr','pif','cpl','vbs','vbe','js','jse','mjs','ws','wsf','wsh','ps1','psm1',
    'sh','bash','jar','app','dmg','pkg','deb','rpm','apk','lnk','reg','hta','dll','sys','iso','img','vhd','gadget','msc','inf','py','pl','rb'
  ]);
$$;
revoke all on function public.qs_sol_ext_bloqueada(text) from public, anon;
grant execute on function public.qs_sol_ext_bloqueada(text) to authenticated; -- a policy do Storage roda como o usuário

-- ── 4. Storage: policies do bucket ──────────────────────────────────────────
drop policy if exists qs_sol_arquivos_ler on storage.objects;
create policy qs_sol_arquivos_ler on storage.objects for select to authenticated
  using (bucket_id = 'solicitacoes' and public.qs_sol_ve_arquivo(name));
drop policy if exists qs_sol_arquivos_subir on storage.objects;
create policy qs_sol_arquivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'solicitacoes' and public.qs_sol_ve_arquivo(name) and not public.qs_sol_ext_bloqueada(name));
drop policy if exists qs_sol_arquivos_apagar on storage.objects;
create policy qs_sol_arquivos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'solicitacoes'
         and (owner_id = (select auth.uid())::text or public.qs_sol_gestor_do_arquivo(name)));

-- ── 5. Anexar (grava a mensagem + os arquivos já enviados ao Storage) ───────
-- p_arquivos: [{ "path": "...", "nome": "...", "mime": "...", "tamanho": 123, "miniatura": "..."|null }]
create or replace function public.qs_sol_anexar(p_id uuid, p_texto text, p_arquivos jsonb)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare
  s qs_solicitacoes;
  v_eu text := qs_eu_nome();
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
  v_auto boolean := false;
  v_ev bigint;
  v_n int;
  a jsonb;
  v_path text;
  v_mini text;
  v_nome text;
  v_nomes text[] := '{}';
begin
  select * into s from qs_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if not qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id) then raise exception 'Sem acesso a essa solicitação.'; end if;
  if p_arquivos is null or jsonb_typeof(p_arquivos) <> 'array' or jsonb_array_length(p_arquivos) = 0 then
    raise exception 'Nenhum arquivo pra anexar.';
  end if;
  v_n := jsonb_array_length(p_arquivos);
  if v_n > 20 then raise exception 'No máximo 20 arquivos por vez.'; end if;

  -- confere tudo antes de gravar
  for a in select * from jsonb_array_elements(p_arquivos) loop
    v_path := a->>'path';
    v_mini := nullif(a->>'miniatura', '');
    v_nome := left(nullif(trim(coalesce(a->>'nome', '')), ''), 200);
    if v_path is null or split_part(v_path, '/', 1) <> p_id::text then raise exception 'Arquivo fora da pasta do pedido.'; end if;
    if v_mini is not null and split_part(v_mini, '/', 1) <> p_id::text then raise exception 'Miniatura fora da pasta do pedido.'; end if;
    if v_nome is null then raise exception 'Arquivo sem nome.'; end if;
    if qs_sol_ext_bloqueada(v_nome) or qs_sol_ext_bloqueada(v_path) then raise exception '"%": esse tipo de arquivo não pode ser anexado (programa/script).', v_nome; end if;
    if coalesce((a->>'tamanho')::bigint, 0) > 26214400 then raise exception '"%" passa de 25 MB.', v_nome; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'solicitacoes' and o.name = v_path) then
      raise exception '"%" não chegou ao servidor. Tente de novo.', v_nome;
    end if;
    v_nomes := v_nomes || v_nome;
  end loop;

  if v_texto is null then
    v_auto := true;
    v_texto := 'anexou ' || case when v_n = 1 then v_nomes[1] else v_n || ' arquivos: ' || array_to_string(v_nomes, ', ') end;
  end if;

  -- a mensagem (tipo 'comentario' → aviso + seguidor + não lidas da 0315)
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome)
  values (p_id, 'comentario', case when v_auto then 'anexos' end, left(v_texto, 4000), v_eu)
  returning id into v_ev;

  insert into qs_solicitacao_anexos (solicitacao_id, evento_id, path, miniatura, nome, mime, tamanho, enviado_por, enviado_nome)
  select p_id, v_ev, x->>'path', nullif(x->>'miniatura', ''), left(trim(x->>'nome'), 200), nullif(x->>'mime', ''),
         greatest(coalesce((x->>'tamanho')::bigint, 0), 0), auth.uid(), v_eu
    from jsonb_array_elements(p_arquivos) x;

  update qs_solicitacoes set atualizado_em = now(), atualizado_por = auth.uid() where id = p_id;
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (p_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
  return v_ev;
end $$;
revoke all on function public.qs_sol_anexar(uuid, text, jsonb) from public, anon;
grant execute on function public.qs_sol_anexar(uuid, text, jsonb) to authenticated;

-- ── 6. Apagar (quem enviou ou gestor) ───────────────────────────────────────
create or replace function public.qs_sol_anexo_apagar(p_anexo uuid)
returns text[] language plpgsql security definer set search_path to 'public' as $$
declare
  a qs_solicitacao_anexos;
  s qs_solicitacoes;
begin
  select * into a from qs_solicitacao_anexos where id = p_anexo;
  if a.id is null then raise exception 'Anexo não encontrado.'; end if;
  select * into s from qs_solicitacoes where id = a.solicitacao_id;
  if not qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id) then raise exception 'Sem acesso a essa solicitação.'; end if;
  if a.enviado_por is distinct from auth.uid() and not (qs_gestor_do_setor(s.de_setor) or qs_gestor_do_setor(s.para_setor)) then
    raise exception 'Só quem enviou (ou o gestor) apaga o anexo.';
  end if;
  delete from qs_solicitacao_anexos where id = p_anexo;
  update qs_solicitacoes set atualizado_em = now(), atualizado_por = auth.uid() where id = s.id;
  return array_remove(array[a.path, a.miniatura], null);
end $$;
revoke all on function public.qs_sol_anexo_apagar(uuid) from public, anon;
grant execute on function public.qs_sol_anexo_apagar(uuid) to authenticated;

-- ── 7. Resumo pros cartões do quadro ────────────────────────────────────────
create or replace function public.qs_sol_anexos_resumo(p_ids uuid[])
returns table (solicitacao_id uuid, n int, capa text)
language sql stable security invoker set search_path to 'public' as $$
  select a.solicitacao_id, count(*)::int,
         (array_agg(a.miniatura order by a.criado_em) filter (where a.miniatura is not null))[1]
    from qs_solicitacao_anexos a
   where a.solicitacao_id = any (p_ids)
   group by a.solicitacao_id;
$$;
revoke all on function public.qs_sol_anexos_resumo(uuid[]) from public, anon;
grant execute on function public.qs_sol_anexos_resumo(uuid[]) to authenticated;
