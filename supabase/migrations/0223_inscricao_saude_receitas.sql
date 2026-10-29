-- 0223_inscricao_saude_receitas.sql
-- APLICADA em 29/10/2026 (0223a colunas + triagem, 0223b gatilho + receitas), com o ok do Bruno. Testada com rollback: a aprovação leva o lembrete pro passageiro.
-- Pedidos da Carol (Relacionamento) nas Inscrições, trazidos do sistema antigo
-- (sistema-expedicoes 711f772 / fe8ff18 / 23fc68f, migrations 0061 e 0062 de lá):
--
--  1) comentário de TRIAGEM DE SAÚDE na inscrição pendente ("receita já emitida",
--     "não precisa de receita") — o time vê antes de aprovar; some junto na aprovação;
--  2) lembrete "preciso emitir e enviar a receita" marcado na triagem e CARREGADO pro
--     passageiro na aprovação (sobrevive) → alimenta o menu Receitas, que mostra a
--     receita quando faltam ≤ 20 dias pro embarque e tem "marcar enviada".
--
-- O exp_inscricao_aprovar (0163, 14 KB) NÃO é reescrito: ele termina com
-- `delete from inscricoes_pendentes`; um gatilho BEFORE DELETE leva o lembrete pro
-- passageiro que a própria aprovação acabou de criar/achar (mesma transação).
-- Quem mexe: as mesmas pessoas que decidem inscrição (exp_pode_decidir_inscricao:
-- Operações que edita + Relacionamento), por funções security definer — o
-- Relacionamento é só leitura nas tabelas de expedição.

alter table public.inscricoes_pendentes
  add column if not exists comentario_saude text,
  add column if not exists receita_pendente boolean not null default false;

alter table public.passageiros
  add column if not exists receita_pendente boolean not null default false,
  add column if not exists receita_enviada_em timestamptz,
  add column if not exists receita_enviada_por uuid references auth.users(id);

-- ── triagem de saúde (comentário + lembrete) ─────────────────────────────────
create or replace function public.exp_inscricao_triagem_saude(p_id uuid, p_comentario text, p_receita boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exp_pode_decidir_inscricao() then
    raise exception 'Sem permissão para fazer a triagem de saúde.';
  end if;
  update inscricoes_pendentes
     set comentario_saude = nullif(left(btrim(coalesce(p_comentario, '')), 2000), ''),
         receita_pendente = coalesce(p_receita, false),
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'Inscrição não encontrada.'; end if;
end;
$$;
revoke all on function public.exp_inscricao_triagem_saude(uuid, text, boolean) from public, anon;
grant execute on function public.exp_inscricao_triagem_saude(uuid, text, boolean) to authenticated;

-- ── a aprovação leva o lembrete pro passageiro ──────────────────────────────
create or replace function public._exp_trg_inscricao_receita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.receita_pendente and coalesce(old.status, '') <> 'recusada' then
    update passageiros
       set receita_pendente = true
     where expedicao_id = old.expedicao_id
       and regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = regexp_replace(coalesce(old.cpf, ''), '\D', '', 'g')
       and regexp_replace(coalesce(old.cpf, ''), '\D', '', 'g') <> '';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_inscricao_receita on public.inscricoes_pendentes;
create trigger trg_inscricao_receita
  before delete on public.inscricoes_pendentes
  for each row execute function public._exp_trg_inscricao_receita();

-- ── menu Receitas: marcar enviada / precisa de receita ──────────────────────
create or replace function public.exp_receita_definir(p_passageiro uuid, p_pendente boolean, p_enviada boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exp_pode_decidir_inscricao() then
    raise exception 'Sem permissão para mexer nas receitas.';
  end if;
  update passageiros
     set receita_pendente = coalesce(p_pendente, receita_pendente),
         receita_enviada_em = case when p_enviada then now() when p_enviada = false then null else receita_enviada_em end,
         receita_enviada_por = case when p_enviada then auth.uid() when p_enviada = false then null else receita_enviada_por end
   where id = p_passageiro;
  if not found then raise exception 'Passageiro não encontrado.'; end if;
end;
$$;
revoke all on function public.exp_receita_definir(uuid, boolean, boolean) from public, anon;
grant execute on function public.exp_receita_definir(uuid, boolean, boolean) to authenticated;

create index if not exists passageiros_receita_pendente_idx
  on public.passageiros (expedicao_id) where receita_pendente and receita_enviada_em is null;
