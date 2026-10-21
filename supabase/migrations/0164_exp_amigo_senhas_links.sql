-- 0164 — Acessos ExpedAmigo dentro do QS (21/10/2026).
-- `acesso_senhas` (senha do portal por CPF) e `acesso_links` (link curto /a/<codigo>)
-- não têm policy — no app antigo só o servidor (service role) mexia. Aqui o acesso é
-- por estas funções security definer, só pra ADMIN das Expedições (exp_eh_admin(),
-- mesma regra do antigo: "Apenas admin").
--   · exp_amigo_estado(cpfs)       → se a pessoa já criou senha / senha provisória legível
--   · exp_amigo_nova_senha(cpf)    → senha provisória NOVA (a pessoa volta ao 1º acesso)
--   · exp_amigo_gerar_link(pax)    → link /a/<codigo> de 1º acesso (30 dias) + libera o portal
-- Senha: 12 caracteres sem ambíguos, sorteio sem viés (antes: 8 caracteres; e o reset
-- de senha de usuário era "Setur@"+4 dígitos). O portal compara a provisória como texto,
-- então qualquer tamanho funciona.
-- O link /a/<codigo> é resolvido pelo app antigo (portais ficaram lá): ele lê
-- acesso_links e redireciona pro /amigo/acesso com o token — nada muda lá.

create or replace function public.exp__sortear(p_alfabeto text, p_tam int) returns text
language plpgsql volatile set search_path = public as $$
declare
  n int := length(p_alfabeto);
  lim int := 256 - (256 % n);   -- descarta bytes que causariam viés
  b bytea; i int; v_out text := '';
begin
  while length(v_out) < p_tam loop
    b := extensions.gen_random_bytes(32);
    for i in 0..31 loop
      exit when length(v_out) >= p_tam;
      if get_byte(b, i) < lim then
        v_out := v_out || substr(p_alfabeto, (get_byte(b, i) % n) + 1, 1);
      end if;
    end loop;
  end loop;
  return v_out;
end $$;

create or replace function public.exp_amigo_estado(p_cpfs text[])
returns table (cpf text, tem_senha boolean, senha_provisoria text, atualizado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exp_eh_admin() then raise exception 'Apenas admin vê as senhas do ExpedAmigo.'; end if;
  return query
    select regexp_replace(s.cpf, '\D', '', 'g'), s.senha_hash is not null, s.senha_provisoria, s.updated_at
      from acesso_senhas s
     where regexp_replace(s.cpf, '\D', '', 'g') = any (select regexp_replace(x, '\D', '', 'g') from unnest(p_cpfs) x);
end $$;

create or replace function public.exp_amigo_nova_senha(p_cpf text)
returns text language plpgsql security definer set search_path = public as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); v_senha text;
begin
  if not exp_eh_admin() then raise exception 'Apenas admin gera senha do ExpedAmigo.'; end if;
  if length(v_cpf) <> 11 then raise exception 'Passageiro sem CPF válido.'; end if;
  v_senha := exp__sortear('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', 12);
  insert into acesso_senhas (cpf, senha_provisoria, senha_hash) values (v_cpf, v_senha, null)
  on conflict (cpf) do update set senha_provisoria = excluded.senha_provisoria, senha_hash = null, updated_at = now();
  return v_senha;
end $$;

-- Link curto de 1º acesso. Reaproveita um link ainda válido por mais de 7 dias;
-- senão cria outro (10 caracteres, 30 dias). Marca a reserva como liberada no
-- portal (igual ao onboarding automático do antigo — sem isso a pessoa cria a
-- senha e não vê a viagem).
create or replace function public.exp_amigo_gerar_link(p_passageiro_id uuid, p_liberar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_codigo text; v_expira timestamptz; i int;
begin
  if not exp_eh_admin() then raise exception 'Apenas admin gera link do ExpedAmigo.'; end if;
  if not exists (select 1 from passageiros where id = p_passageiro_id) then raise exception 'Passageiro não encontrado.'; end if;
  select codigo, expira_em into v_codigo, v_expira from acesso_links
   where passageiro_id = p_passageiro_id and expira_em > now() + interval '7 days'
   order by expira_em desc limit 1;
  if v_codigo is null then
    v_expira := now() + interval '30 days';
    for i in 1..6 loop
      v_codigo := exp__sortear('abcdefghjkmnpqrstuvwxyz23456789', 10);
      begin
        insert into acesso_links (codigo, passageiro_id, expira_em) values (v_codigo, p_passageiro_id, v_expira);
        exit;
      exception when unique_violation then v_codigo := null;
      end;
    end loop;
    if v_codigo is null then raise exception 'Não consegui gerar um código livre — tente de novo.'; end if;
  end if;
  if p_liberar then update passageiros set liberado_expedamigo = true where id = p_passageiro_id and not liberado_expedamigo; end if;
  return jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
end $$;

revoke execute on function public.exp__sortear(text, int), public.exp_amigo_estado(text[]),
  public.exp_amigo_nova_senha(text), public.exp_amigo_gerar_link(uuid, boolean) from public, anon;
revoke execute on function public.exp__sortear(text, int) from authenticated;
grant execute on function public.exp_amigo_estado(text[]), public.exp_amigo_nova_senha(text),
  public.exp_amigo_gerar_link(uuid, boolean) to authenticated;
