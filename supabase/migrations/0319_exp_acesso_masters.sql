-- 0319 — Masters do portal do viajante CONFIGURÁVEIS no QS (05/11/2026).
-- ESCRITA, NÃO APLICADA (aplicar só com ok do Bruno).
--
-- No app antigo (sistema-expedicoes) "master" é uma LISTA FIXA NO CÓDIGO, por CPF:
--   · app/amigo/actions.ts → ADMINS_AMIGO: ao logar no ExpedAmigo (/amigo) com a
--     própria senha (acesso_senhas), o CPF vê TODAS as expedições futuras (menos as
--     privadas, ex.: JAPCOR-2026-09), mesmo sem ser passageiro.
--   · app/lider/actions.ts → MASTERS: na Área do Líder (/lider) o CPF vê TODAS as
--     expedições, não só as que lidera.
-- Cada pessoa nova virava um commit (d020c7a John/Talita, 98d5359 Tainara,
-- f2b4d72 Laura/Mariane). Aqui vira uma tabela editada na tela "Acessos ExpedAmigo"
-- (aba Masters), só por admin das Expedições.
--
-- IMPORTANTE: o portal que está no ar (app antigo) ainda NÃO lê esta tabela — ele
-- segue com a lista do código até ganhar a leitura (`exp_masters_portal`, abaixo) ou
-- até a virada do portal pro banco do QS. A semente abaixo é a lista de 05/11.

create table if not exists public.exp_acesso_masters (
  cpf          text primary key check (cpf ~ '^[0-9]{11}$'),
  nome         text not null check (length(btrim(nome)) > 0),
  -- vê todas as expedições futuras no ExpedAmigo (/amigo)
  portal       boolean not null default true,
  -- vê todas as expedições na Área do Líder (/lider)
  lider        boolean not null default false,
  ativo        boolean not null default true,
  observacao   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

comment on table public.exp_acesso_masters is
  'Masters do portal do viajante (antes: ADMINS_AMIGO e MASTERS fixos no código do app antigo). portal = /amigo vê todas as futuras; lider = /lider vê todas.';

create or replace function public.exp_acesso_masters_tocar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.cpf := regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g');
  new.nome := btrim(new.nome);
  new.updated_at := now();
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  return new;
end $$;

drop trigger if exists exp_acesso_masters_tocar on public.exp_acesso_masters;
create trigger exp_acesso_masters_tocar before insert or update on public.exp_acesso_masters
  for each row execute function public.exp_acesso_masters_tocar();

alter table public.exp_acesso_masters enable row level security;

-- Ler: quem tem acesso às Expedições (a tela mostra a lista). Gravar: só admin.
drop policy if exists exp_acesso_masters_ler on public.exp_acesso_masters;
create policy exp_acesso_masters_ler on public.exp_acesso_masters
  for select to authenticated using (exp_tem_acesso() or exp_eh_admin());

drop policy if exists exp_acesso_masters_gravar on public.exp_acesso_masters;
create policy exp_acesso_masters_gravar on public.exp_acesso_masters
  for all to authenticated using (exp_eh_admin()) with check (exp_eh_admin());

revoke all on public.exp_acesso_masters from anon;
grant select, insert, update, delete on public.exp_acesso_masters to authenticated;

-- Lista que o PORTAL vai ler (service role) quando trocar a constante do código por
-- esta tabela: CPFs ativos de uma área ('portal' ou 'lider').
create or replace function public.exp_masters_portal(p_area text default 'portal')
returns table (cpf text, nome text)
language sql stable security definer set search_path = public as $$
  select m.cpf, m.nome from exp_acesso_masters m
   where m.ativo and case when p_area = 'lider' then m.lider else m.portal end
   order by m.nome;
$$;
revoke execute on function public.exp_masters_portal(text) from public, anon, authenticated;
grant execute on function public.exp_masters_portal(text) to service_role;

-- Semente: as duas listas do app antigo em 05/11 (origin/master adf9d1a).
insert into public.exp_acesso_masters (cpf, nome, portal, lider) values
  ('20262027999', 'Administrador',                               true, true),
  ('79746748220', 'Carolina Lage Taketomi',                      true, true),
  ('40718963881', 'Antonio Carlos Feitosa Beserra dos Santos',   true, true),
  ('01997549344', 'Luis Antonio de Negreiros Caetano',           true, true),
  ('47146666816', 'Beatriz Rodrigues Galvão',                    true, true),
  ('46323253844', 'Rafaellen Borges',                            true, false),
  ('41765424895', 'John Italo Pereira da Silva',                 true, false),
  ('37028025845', 'Talita Carvalho',                             true, false),
  ('44186003882', 'Tainara Ferreira Vasconcelos',                true, true),
  ('49143201857', 'Laura de Assunção',                           true, false),
  ('43446657835', 'Mariane Valentim Silveira',                   true, false)
on conflict (cpf) do nothing;
