-- 0165 — Usuários das Expedições (tela Configurações) dentro do QS (21/10/2026).
-- `usuarios` (tabela do app antigo) guarda o PAPEL nas Expedições; o id é o mesmo
-- da conta de login (auth) e do perfil do QS (qs_users) — ligados pelo e-mail na
-- migração. Quem decide é exp_eh_admin() (admin do app antigo OU admin do QS).
--   · exp_definir_papel(usuario, papel) → troca o papel (não o próprio; anti-trancar-pra-fora)
--   · exp_dar_acesso(qs_user, papel)    → dá acesso às Expedições a quem JÁ tem login no QS
--   · exp_pessoas_sem_acesso()          → quem tem login no QS e ainda não está em `usuarios`
-- Criar login novo e resetar senha precisam do Auth admin → api/admin-user.js (ação exp_usuarios).

create or replace function public.exp_definir_papel(p_usuario uuid, p_papel text)
returns void language plpgsql security definer set search_path = public as $$
declare v_atual text;
begin
  if not exp_eh_admin() then raise exception 'Apenas admins podem mudar papéis.'; end if;
  if p_usuario = auth.uid() then raise exception 'Você não pode alterar o próprio papel.'; end if;
  select papel::text into v_atual from usuarios where id = p_usuario;
  if v_atual is null then raise exception 'Usuário não encontrado.'; end if;
  -- Atribuíveis (igual ao antigo). Um papel antigo (comercial/financeiro/leitura) pode ser mantido.
  if p_papel not in ('admin', 'operacional', 'relacionamento', 'leitura') and p_papel <> v_atual then
    raise exception 'Papel inválido.';
  end if;
  update usuarios set papel = p_papel::papel_usuario where id = p_usuario;
end $$;

create or replace function public.exp_dar_acesso(p_qs_user uuid, p_papel text)
returns void language plpgsql security definer set search_path = public as $$
declare q qs_users%rowtype;
begin
  if not exp_eh_admin() then raise exception 'Apenas admins dão acesso às Expedições.'; end if;
  if p_papel not in ('admin', 'operacional', 'relacionamento', 'leitura') then raise exception 'Papel inválido.'; end if;
  select * into q from qs_users where id = p_qs_user and is_active;
  if q.id is null then raise exception 'Pessoa não encontrada (ou desativada) no QS.'; end if;
  if exists (select 1 from usuarios where id = q.id) then raise exception 'Essa pessoa já tem acesso às Expedições.'; end if;
  if exists (select 1 from usuarios where lower(email) = lower(q.email)) then
    raise exception 'Já existe um usuário das Expedições com esse e-mail (conta antiga sem login no QS).';
  end if;
  insert into usuarios (id, email, nome, papel, senha_provisoria)
  values (q.id, lower(q.email), coalesce(nullif(q.name, ''), split_part(q.email, '@', 1)), p_papel::papel_usuario, false);
end $$;

create or replace function public.exp_pessoas_sem_acesso()
returns table (id uuid, nome text, email text, papel_qs text, setores text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not exp_eh_admin() then raise exception 'Apenas admins.'; end if;
  return query
    select q.id, q.name, q.email, q.role, q.setores
      from qs_users q
     where q.is_active and q.email is not null
       and not exists (select 1 from usuarios u where u.id = q.id)
     order by q.name;
end $$;

revoke execute on function public.exp_definir_papel(uuid, text), public.exp_dar_acesso(uuid, text),
  public.exp_pessoas_sem_acesso() from public, anon;
grant execute on function public.exp_definir_papel(uuid, text), public.exp_dar_acesso(uuid, text),
  public.exp_pessoas_sem_acesso() to authenticated;
