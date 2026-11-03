-- 0233_gravacao_ligacoes.sql
-- -----------------------------------------------------------------------------
-- GRAVAÇÃO DAS LIGAÇÕES DO WEBFONE (30/10).
--
-- O webfone roda no navegador do SDR (src/lib/webphone.ts), então o próprio QS
-- tem o áudio dos dois lados. Quando a ligação é atendida, o navegador grava a
-- mistura (SDR + cliente) e, ao desligar, sobe o arquivo pro bucket `ligacoes`
-- e anota uma linha aqui. Sem transcrição, por decisão do Bruno: fica só o
-- áudio arquivado no card do lead.
--
-- Não depende da VoxFree/BravoTech (sem API de gravação e instável).
--
-- Quem ouve: o próprio SDR (as dele) e gestão comercial (qs_is_manager).
-- Ninguém apaga pela tela: é arquivo.
--
-- Caminho do arquivo: <sdr_id>/<lead_id|sem-lead>/<timestamp>.webm — a 1ª pasta
-- é o dono, e é ela que a policy do Storage confere.
-- -----------------------------------------------------------------------------

create table if not exists public.qs_ligacao_gravacoes (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references public.qs_leads(id) on delete set null,
  sdr_id        uuid not null default auth.uid() references public.qs_users(id),
  telefone      text,
  inicio        timestamptz not null,
  duracao_seg   integer not null default 0,
  storage_path  text not null unique,
  tamanho_bytes integer,
  mime          text,
  origem        text not null default 'webfone',   -- webfone | discador
  created_at    timestamptz not null default now()
);

comment on table public.qs_ligacao_gravacoes is '0233 — áudio das ligações atendidas pelo webfone (bucket ligacoes).';

create index if not exists qs_ligacao_gravacoes_lead_idx on public.qs_ligacao_gravacoes (lead_id, inicio desc);
create index if not exists qs_ligacao_gravacoes_sdr_idx  on public.qs_ligacao_gravacoes (sdr_id, inicio desc);

alter table public.qs_ligacao_gravacoes enable row level security;

drop policy if exists lig_grav_ler on public.qs_ligacao_gravacoes;
create policy lig_grav_ler on public.qs_ligacao_gravacoes for select to authenticated
  using (sdr_id = auth.uid() or public.qs_is_manager());

drop policy if exists lig_grav_gravar on public.qs_ligacao_gravacoes;
create policy lig_grav_gravar on public.qs_ligacao_gravacoes for insert to authenticated
  with check (sdr_id = auth.uid());

grant select, insert on public.qs_ligacao_gravacoes to authenticated;

-- ── Bucket privado ───────────────────────────────────────────────────────────
-- 60 MB por arquivo: a 24 kbps dá folga pra mais de 5 horas de ligação.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ligacoes', 'ligacoes', false, 62914560, array['audio/webm', 'audio/ogg', 'audio/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ligacoes_ler on storage.objects;
create policy ligacoes_ler on storage.objects for select to authenticated
  using (bucket_id = 'ligacoes'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.qs_is_manager()));

drop policy if exists ligacoes_subir on storage.objects;
create policy ligacoes_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'ligacoes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Conferência depois de aplicar:
--   select id, public, file_size_limit from storage.buckets where id = 'ligacoes';
--   select count(*) from qs_ligacao_gravacoes;
