-- 0170 — Expedições: "Liberar portal para todos" (aba ExpedAmigo) — 21/10/2026.
-- No app antigo era a server action liberarExpedamigoTodos (service role, só admin):
--   1) marca liberado_expedamigo=true em todos os pax NÃO cancelados da expedição;
--   2) por CPF (11 dígitos, sem repetir): quem já tem senha própria (senha_hash) só conta;
--      quem tem senha provisória reaproveita; quem não tem ganha uma provisória aleatória
--      de 8 caracteres (alfabeto sem 0/O/1/l/I), gravada em acesso_senhas.
-- acesso_senhas não tem policy (ninguém do navegador lê/escreve) — por isso security definer
-- com checagem exp_eh_admin(). Devolve a lista pra o admin repassar as senhas.
-- SÓ ADITIVO: cria uma função.

create or replace function public.exp_liberar_expedamigo_todos(p_expedicao_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  v_total int := 0;
  v_ja int := 0;
  v_senhas jsonb := '[]'::jsonb;
  r record;
  v_hash text;
  v_prov text;
  v_bytes bytea;
  v_senha text;
  i int;
begin
  if not exp_eh_admin() then
    raise exception 'Apenas admin pode liberar o ExpedAmigo.';
  end if;

  select count(*) into v_total from passageiros
   where expedicao_id = p_expedicao_id and status_reserva::text <> 'Cancelado';
  if v_total = 0 then
    return jsonb_build_object('total', 0, 'ja_tinham_senha', 0, 'senhas', '[]'::jsonb);
  end if;

  update passageiros set liberado_expedamigo = true
   where expedicao_id = p_expedicao_id and status_reserva::text <> 'Cancelado';

  for r in
    select distinct on (cpf_d) cpf_d, nome_completo
      from (select regexp_replace(coalesce(cpf, ''), '\D', '', 'g') as cpf_d, nome_completo, created_at
              from passageiros
             where expedicao_id = p_expedicao_id and status_reserva::text <> 'Cancelado') s
     where length(cpf_d) = 11
     order by cpf_d, created_at
  loop
    v_hash := null; v_prov := null;
    select senha_hash, senha_provisoria into v_hash, v_prov
      from acesso_senhas where regexp_replace(cpf, '\D', '', 'g') = r.cpf_d
     order by (senha_hash is not null) desc limit 1;
    if v_hash is not null then
      v_ja := v_ja + 1;
    elsif v_prov is not null then
      v_senhas := v_senhas || jsonb_build_object('nome', r.nome_completo, 'cpf', r.cpf_d, 'senha', v_prov);
    else
      v_bytes := extensions.gen_random_bytes(8);
      v_senha := '';
      for i in 0..7 loop
        v_senha := v_senha || substr(v_alfabeto, (get_byte(v_bytes, i) % length(v_alfabeto)) + 1, 1);
      end loop;
      insert into acesso_senhas (cpf, senha_provisoria, senha_hash)
      values (r.cpf_d, v_senha, null)
      on conflict (cpf) do update set senha_provisoria = excluded.senha_provisoria, senha_hash = null, updated_at = now();
      v_senhas := v_senhas || jsonb_build_object('nome', r.nome_completo, 'cpf', r.cpf_d, 'senha', v_senha);
    end if;
  end loop;

  return jsonb_build_object('total', v_total, 'ja_tinham_senha', v_ja, 'senhas', v_senhas);
end $function$;

revoke execute on function public.exp_liberar_expedamigo_todos(uuid) from public, anon;
grant execute on function public.exp_liberar_expedamigo_todos(uuid) to authenticated;
