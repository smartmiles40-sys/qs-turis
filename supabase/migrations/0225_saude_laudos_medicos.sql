-- 0225_saude_laudos_medicos.sql
-- NÃO APLICADA (30/10/2026). Escrita no worktree v2-saude. Idempotente: pode rodar duas vezes.
-- Pedido do Bruno: "quem tem algum problema de saúde, pra passar pro médico e ele fazer os laudos,
-- o acompanhamento e a curadoria do cliente" + formulário também pra PACOTE.
--
-- O que entra:
--  1) papel 'medico' em qs_users.papeis (o mesmo campo dos papéis cx/cs/hunter da 0222);
--  2) exp_pode_ver_saude() / exp_eh_medico(): quem vê dado de saúde (LGPD):
--     Operações (ops_tem_acesso), a gestão do Relacionamento (rel_pode_configurar) e o médico;
--  3) cad_laudos_medicos: 1 laudo por passageiro (viagem), ligado a cliente_id (ficha do cliente),
--     com status (a_fazer · em_andamento · emitido · dispensado), apto (sim · nao · ressalvas)
--     e o PDF no bucket privado laudos-medicos;
--  4) cad_laudo_notas: anotações de acompanhamento com data e autor (só acrescenta);
--  5) RPCs cad_laudo_salvar / cad_laudo_nota / cad_laudo_apagar_arquivo — a escrita passa só por elas;
--  6) exp_pacote_abrir_inscricao(viagem): liga um pacote personalizado (rel_viagens, serviço pacote)
--     a uma linha de `expedicoes` tipo 'pacote' (rel_viagens.expedicoes_id, que já existe desde a 0112)
--     e põe o titular como passageiro. Assim o MESMO formulário /inscricao do app antigo
--     (que grava inscricoes_pendentes.expedicao_id) serve pro pacote, sem mexer no app antigo.
--
-- Contrato da tabela pra ficha do cliente: docs/CONTRATO-LAUDOS.md.
--
-- Fica de fora (de propósito): a policy de leitura de passageiros.saude continua a da 0160
-- (exp_tem_acesso, que inclui o Financeiro). Fechar isso quebra telas de outros setores —
-- decisão do Bruno; ver o fim do contrato.
--
-- ROLLBACK (rodar na ordem):
--   drop function if exists public.exp_pacote_abrir_inscricao(uuid);
--   drop function if exists public.cad_laudo_apagar_arquivo(uuid);
--   drop function if exists public.cad_laudo_nota(uuid, text);
--   drop function if exists public.cad_laudo_salvar(uuid, text, text, text, text, jsonb);
--   drop policy if exists laudos_ler on storage.objects;
--   drop policy if exists laudos_subir on storage.objects;
--   drop policy if exists laudos_apagar on storage.objects;
--   -- (o bucket só sai vazio) delete from storage.buckets where id = 'laudos-medicos';
--   drop table if exists public.cad_laudo_notas;
--   drop table if exists public.cad_laudos_medicos;
--   drop function if exists public.exp_eh_medico();
--   drop function if exists public.exp_pode_ver_saude();
--   update public.qs_users set papeis = array_remove(papeis, 'medico');
--   alter table public.qs_users drop constraint if exists qs_users_papeis_check;
--   alter table public.qs_users add constraint qs_users_papeis_check check (papeis <@ array['cx','cs','hunter']::text[]);

begin;

-- ── 1) papel 'medico' ───────────────────────────────────────────────────────
alter table public.qs_users drop constraint if exists qs_users_papeis_check;
alter table public.qs_users add constraint qs_users_papeis_check
  check (papeis <@ array['cx','cs','hunter','medico']::text[]);
-- Quem liga: a gestão do setor, pela mesma qs_sol_definir_papeis da 0222. O médico precisa
-- de uma linha em qs_users com setores = {operacional} pra entrar na porta de Operações.

-- ── 2) quem vê saúde ─────────────────────────────────────────────────────────
create or replace function public.exp_eh_medico()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from qs_users where id = auth.uid() and is_active and 'medico' = any(papeis));
$$;

create or replace function public.exp_pode_ver_saude()
returns boolean language sql stable security definer set search_path = public as $$
  select ops_tem_acesso() or rel_pode_configurar() or exp_eh_medico()
      or exists (select 1 from usuarios where id = auth.uid() and papel = 'admin');
$$;
revoke all on function public.exp_eh_medico() from public, anon;
revoke all on function public.exp_pode_ver_saude() from public, anon;
grant execute on function public.exp_eh_medico() to authenticated;
grant execute on function public.exp_pode_ver_saude() to authenticated;

-- ── 3) laudos ────────────────────────────────────────────────────────────────
create table if not exists public.cad_laudos_medicos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid references public.rel_clientes(id) on delete set null,
  passageiro_id    uuid references public.passageiros(id) on delete set null,
  expedicao_id     uuid references public.expedicoes(id) on delete set null,
  status           text not null default 'a_fazer'
                   check (status in ('a_fazer', 'em_andamento', 'emitido', 'dispensado')),
  apto             text check (apto in ('sim', 'nao', 'ressalvas')),
  ressalvas        text,
  parecer          text,
  arquivo_path     text,
  arquivo_nome     text,
  arquivo_mime     text,
  arquivo_bytes    bigint,
  emitido_em       timestamptz,
  emitido_por      uuid references auth.users(id) on delete set null,
  emitido_por_nome text,
  criado_em        timestamptz not null default now(),
  criado_por       uuid references auth.users(id) on delete set null,
  atualizado_em    timestamptz not null default now(),
  atualizado_por   uuid references auth.users(id) on delete set null,
  constraint cad_laudos_tem_dono check (cliente_id is not null or passageiro_id is not null)
);
create unique index if not exists cad_laudos_um_por_passageiro on public.cad_laudos_medicos (passageiro_id) where passageiro_id is not null;
create index if not exists cad_laudos_cliente_idx on public.cad_laudos_medicos (cliente_id);
create index if not exists cad_laudos_expedicao_idx on public.cad_laudos_medicos (expedicao_id);

create table if not exists public.cad_laudo_notas (
  id         uuid primary key default gen_random_uuid(),
  laudo_id   uuid not null references public.cad_laudos_medicos(id) on delete cascade,
  texto      text not null check (length(btrim(texto)) between 1 and 4000),
  autor_id   uuid references auth.users(id) on delete set null,
  autor_nome text,
  criado_em  timestamptz not null default now()
);
create index if not exists cad_laudo_notas_laudo_idx on public.cad_laudo_notas (laudo_id, criado_em);

alter table public.cad_laudos_medicos enable row level security;
alter table public.cad_laudo_notas enable row level security;
-- Só leitura direta; escrita só pelas funções abaixo (sem policy de insert/update/delete).
drop policy if exists cad_laudos_ler on public.cad_laudos_medicos;
create policy cad_laudos_ler on public.cad_laudos_medicos for select to authenticated using ((select exp_pode_ver_saude()));
drop policy if exists cad_laudo_notas_ler on public.cad_laudo_notas;
create policy cad_laudo_notas_ler on public.cad_laudo_notas for select to authenticated using ((select exp_pode_ver_saude()));
revoke all on public.cad_laudos_medicos from anon;
revoke all on public.cad_laudo_notas from anon;
grant select on public.cad_laudos_medicos to authenticated;
grant select on public.cad_laudo_notas to authenticated;

-- Realtime pra fila do médico atualizar sozinha (ignora se já estiver na publicação).
do $$ begin
  begin alter publication supabase_realtime add table public.cad_laudos_medicos; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.cad_laudo_notas; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- ── 4) bucket privado dos laudos ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('laudos-medicos', 'laudos-medicos', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists laudos_ler on storage.objects;
create policy laudos_ler on storage.objects for select to authenticated
  using (bucket_id = 'laudos-medicos' and (select exp_pode_ver_saude()));
drop policy if exists laudos_subir on storage.objects;
create policy laudos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'laudos-medicos' and (select exp_pode_ver_saude()));
drop policy if exists laudos_apagar on storage.objects;
create policy laudos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'laudos-medicos' and (select exp_pode_ver_saude()));

-- ── 5) escrita ───────────────────────────────────────────────────────────────
-- Cria ou atualiza o laudo do passageiro. null = não mexe naquele campo.
-- p_arquivo = {"path": "...", "nome": "...", "mime": "application/pdf", "bytes": 123} (já subido no bucket).
-- Status 'emitido' exige apto e carimba emitido_em/por (a 1ª vez).
create or replace function public.cad_laudo_salvar(
  p_passageiro uuid, p_status text, p_apto text, p_ressalvas text, p_parecer text, p_arquivo jsonb
) returns public.cad_laudos_medicos
language plpgsql security definer set search_path = public as $$
declare
  v_pax passageiros%rowtype;
  v_l cad_laudos_medicos%rowtype;
  v_nome text;
begin
  if not exp_pode_ver_saude() then raise exception 'Sem permissão para mexer em laudos médicos.'; end if;
  select * into v_pax from passageiros where id = p_passageiro;
  if not found then raise exception 'Passageiro não encontrado.'; end if;
  if p_status is not null and p_status not in ('a_fazer', 'em_andamento', 'emitido', 'dispensado') then raise exception 'Status de laudo inválido.'; end if;
  if p_apto is not null and p_apto not in ('sim', 'nao', 'ressalvas', '') then raise exception 'Valor de "apto a viajar" inválido.'; end if;
  select name into v_nome from qs_users where id = auth.uid();

  insert into cad_laudos_medicos (cliente_id, passageiro_id, expedicao_id, criado_por, atualizado_por)
  values (v_pax.cliente_id, v_pax.id, v_pax.expedicao_id, auth.uid(), auth.uid())
  on conflict (passageiro_id) where passageiro_id is not null do nothing;

  update cad_laudos_medicos l set
    cliente_id     = coalesce(v_pax.cliente_id, l.cliente_id),
    expedicao_id   = coalesce(v_pax.expedicao_id, l.expedicao_id),
    status         = coalesce(p_status, l.status),
    apto           = case when p_apto is null then l.apto else nullif(p_apto, '') end,
    ressalvas      = case when p_ressalvas is null then l.ressalvas else nullif(left(btrim(p_ressalvas), 4000), '') end,
    parecer        = case when p_parecer is null then l.parecer else nullif(left(btrim(p_parecer), 8000), '') end,
    arquivo_path   = case when p_arquivo is null then l.arquivo_path else p_arquivo->>'path' end,
    arquivo_nome   = case when p_arquivo is null then l.arquivo_nome else p_arquivo->>'nome' end,
    arquivo_mime   = case when p_arquivo is null then l.arquivo_mime else p_arquivo->>'mime' end,
    arquivo_bytes  = case when p_arquivo is null then l.arquivo_bytes else nullif(p_arquivo->>'bytes', '')::bigint end,
    atualizado_em  = now(),
    atualizado_por = auth.uid()
  where l.passageiro_id = v_pax.id
  returning * into v_l;

  if v_l.status = 'emitido' then
    if v_l.apto is null then raise exception 'Para emitir, marque se o cliente está apto a viajar.'; end if;
    if v_l.apto = 'ressalvas' and coalesce(v_l.ressalvas, '') = '' then raise exception 'Descreva as ressalvas.'; end if;
    if v_l.emitido_em is null then
      update cad_laudos_medicos set emitido_em = now(), emitido_por = auth.uid(), emitido_por_nome = v_nome
       where id = v_l.id returning * into v_l;
    end if;
  elsif v_l.emitido_em is not null then
    -- voltou de "emitido" pra outro status: o carimbo sai (o histórico fica nas notas)
    update cad_laudos_medicos set emitido_em = null, emitido_por = null, emitido_por_nome = null
     where id = v_l.id returning * into v_l;
  end if;
  return v_l;
end $$;
revoke all on function public.cad_laudo_salvar(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.cad_laudo_salvar(uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.cad_laudo_nota(p_laudo uuid, p_texto text)
returns public.cad_laudo_notas
language plpgsql security definer set search_path = public as $$
declare v_n cad_laudo_notas%rowtype;
begin
  if not exp_pode_ver_saude() then raise exception 'Sem permissão para anotar em laudos médicos.'; end if;
  if coalesce(btrim(p_texto), '') = '' then raise exception 'Escreva a anotação.'; end if;
  if not exists (select 1 from cad_laudos_medicos where id = p_laudo) then raise exception 'Laudo não encontrado.'; end if;
  insert into cad_laudo_notas (laudo_id, texto, autor_id, autor_nome)
  values (p_laudo, left(btrim(p_texto), 4000), auth.uid(), (select name from qs_users where id = auth.uid()))
  returning * into v_n;
  update cad_laudos_medicos set atualizado_em = now(), atualizado_por = auth.uid() where id = p_laudo;
  return v_n;
end $$;
revoke all on function public.cad_laudo_nota(uuid, text) from public, anon;
grant execute on function public.cad_laudo_nota(uuid, text) to authenticated;

-- Tira o PDF do laudo (devolve o caminho pra o front apagar do bucket).
create or replace function public.cad_laudo_apagar_arquivo(p_laudo uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  if not exp_pode_ver_saude() then raise exception 'Sem permissão.'; end if;
  select arquivo_path into v_path from cad_laudos_medicos where id = p_laudo;
  update cad_laudos_medicos
     set arquivo_path = null, arquivo_nome = null, arquivo_mime = null, arquivo_bytes = null,
         atualizado_em = now(), atualizado_por = auth.uid()
   where id = p_laudo;
  return v_path;
end $$;
revoke all on function public.cad_laudo_apagar_arquivo(uuid) from public, anon;
grant execute on function public.cad_laudo_apagar_arquivo(uuid) to authenticated;

-- ── 6) formulário pro PACOTE personalizado ───────────────────────────────────
-- Liga a viagem (rel_viagens, serviço pacote) a uma `expedicoes` tipo 'pacote' e põe o titular
-- (rel_clientes) como passageiro. Se já estiver ligada, só devolve o id. Quem pode: quem edita
-- Expedições (Operações) ou a gestão do Relacionamento. Só grava rel_viagens.expedicoes_id na viagem.
create or replace function public.exp_pacote_abrir_inscricao(p_viagem uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v rel_viagens%rowtype;
  c rel_clientes%rowtype;
  v_exp uuid;
  v_codigo text;
begin
  if not (exp_pode_editar() or rel_pode_configurar()) then raise exception 'Sem permissão para abrir o formulário do pacote.'; end if;
  select * into v from rel_viagens where id = p_viagem for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if v.expedicoes_id is not null and exists (select 1 from expedicoes where id = v.expedicoes_id) then
    return v.expedicoes_id;
  end if;
  if v.data_embarque is null then raise exception 'O pacote precisa da data de embarque antes de abrir o formulário.'; end if;

  v_codigo := 'PAC-' || to_char(v.data_embarque, 'YYYYMM') || '-' || left(replace(v.id::text, '-', ''), 6);
  insert into expedicoes (codigo, nome, destino, data_embarque, data_retorno, status, tipo, pax_planejados, observacoes)
  values (v_codigo, coalesce(nullif(btrim(v.titulo), ''), 'Pacote'), coalesce(nullif(btrim(v.destino), ''), 'A definir'),
          v.data_embarque, coalesce(v.data_retorno, v.data_embarque), 'Planejamento', 'pacote',
          greatest(coalesce(v.qtd_passageiros, 1), 1), 'Criada pelo QS pra mandar o formulário do pacote (rel_viagens ' || v.id || ').')
  on conflict (codigo) do update set updated_at = now()
  returning id into v_exp;

  update rel_viagens set expedicoes_id = v_exp where id = v.id;

  if v.cliente_id is not null then
    select * into c from rel_clientes where id = v.cliente_id;
    if found and not exists (select 1 from passageiros where expedicao_id = v_exp and cliente_id = c.id) then
      insert into passageiros (expedicao_id, cliente_id, nome_completo, cpf, data_nascimento, email, telefone, passaporte, validade_passaporte, status_reserva)
      values (v_exp, c.id, c.nome, c.cpf, c.nascimento, c.email, c.telefone, c.passaporte, c.passaporte_validade, 'Confirmado');
    end if;
  end if;
  return v_exp;
end $$;
revoke all on function public.exp_pacote_abrir_inscricao(uuid) from public, anon;
grant execute on function public.exp_pacote_abrir_inscricao(uuid) to authenticated;

commit;
