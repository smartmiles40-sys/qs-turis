-- 0171 — Expedições: telas globais (Passageiros / "Clube de viajantes") — 21/10/2026.
-- No app antigo (app/(app)/expedicoes/actions.ts) essas ações baixavam a tabela
-- `passageiros` INTEIRA no servidor e faziam vários updates/deletes soltos. Aqui
-- viram funções atômicas:
--   1) exp_chave_identidade(...)   — a mesma "identidade da pessoa" do app (CPF → Bitrix → e-mail → nome).
--   2) exp_pessoa_propagar(ref, patch) — grava os dados PESSOAIS em todas as linhas da pessoa
--      (propagarDadosPessoais). Correção do bug antigo: a `saude` agora é MESCLADA (chave com
--      valor null no patch = apagar aquela resposta), em vez de substituir tudo em todas as viagens.
--   3) exp_pessoa_excluir(ref)     — apaga a pessoa de todas as expedições (excluirPessoa).
--   4) exp_importar_passageiros(pax, reqs) — import CSV global: passageiros + requisitos de
--      prontidão numa transação (no antigo: insert + gerarRequisitosPadrao separados).
--   5) exp_pessoa_senha_estado / exp_pessoa_senha_nova — senha do ExpedAmigo por CPF (só admin;
--      acesso_senhas não tem policy → security definer com exp_eh_admin()).
-- 1–4 são security invoker: valem as policies da 0160 (só leitura não grava).
-- SÓ ADITIVO: cria funções.

create or replace function public.exp_chave_identidade(p_cpf text, p_bitrix text, p_email text, p_nome text)
returns text language sql immutable set search_path to 'public' as $function$
  select case
    when length(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')) >= 11 then 'cpf:' || regexp_replace(p_cpf, '\D', '', 'g')
    when coalesce(p_bitrix, '') <> '' then 'bx:' || p_bitrix
    when coalesce(p_email, '') <> '' then 'email:' || lower(btrim(p_email, E' \t\r\n'))
    else 'nome:' || lower(btrim(coalesce(p_nome, ''), E' \t\r\n'))
  end;
$function$;

create or replace function public.exp_pessoa_propagar(p_ref uuid, p_patch jsonb)
returns jsonb language plpgsql set search_path to 'public' as $function$
declare
  v_campos constant text[] := array['nome_completo','cpf','passaporte','validade_passaporte','passaporte_arquivo_id',
    'foto_arquivo_id','data_nascimento','email','telefone','contato_emergencia_nome','contato_emergencia_fone',
    'contato_emergencia_vinculo','restricoes_alimentares','condicoes_medicas','saude','endereco_cep','endereco_rua',
    'endereco_numero','endereco_complemento','endereco_bairro','endereco_cidade','endereco_estado',
    'ja_viajou_internacional','paises_visitados'];
  v jsonb;
  v_chave text;
  v_ids uuid[];
  v_exps uuid[];
begin
  select coalesce(jsonb_object_agg(k, p_patch->k), '{}'::jsonb) into v
    from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k = any(v_campos);
  if v = '{}'::jsonb then return jsonb_build_object('linhas', 0, 'expedicoes', '[]'::jsonb); end if;

  select exp_chave_identidade(cpf, bitrix_contact_id, email, nome_completo) into v_chave from passageiros where id = p_ref;
  if v_chave is null then raise exception 'Passageiro não encontrado.'; end if;

  select array_agg(id), array_agg(distinct expedicao_id) filter (where expedicao_id is not null)
    into v_ids, v_exps
    from passageiros where exp_chave_identidade(cpf, bitrix_contact_id, email, nome_completo) = v_chave;

  update passageiros p set
    nome_completo = case when v ? 'nome_completo' then r.nome_completo else p.nome_completo end,
    cpf = case when v ? 'cpf' then r.cpf else p.cpf end,
    passaporte = case when v ? 'passaporte' then r.passaporte else p.passaporte end,
    validade_passaporte = case when v ? 'validade_passaporte' then r.validade_passaporte else p.validade_passaporte end,
    passaporte_arquivo_id = case when v ? 'passaporte_arquivo_id' then r.passaporte_arquivo_id else p.passaporte_arquivo_id end,
    foto_arquivo_id = case when v ? 'foto_arquivo_id' then r.foto_arquivo_id else p.foto_arquivo_id end,
    data_nascimento = case when v ? 'data_nascimento' then r.data_nascimento else p.data_nascimento end,
    email = case when v ? 'email' then r.email else p.email end,
    telefone = case when v ? 'telefone' then r.telefone else p.telefone end,
    contato_emergencia_nome = case when v ? 'contato_emergencia_nome' then r.contato_emergencia_nome else p.contato_emergencia_nome end,
    contato_emergencia_fone = case when v ? 'contato_emergencia_fone' then r.contato_emergencia_fone else p.contato_emergencia_fone end,
    contato_emergencia_vinculo = case when v ? 'contato_emergencia_vinculo' then r.contato_emergencia_vinculo else p.contato_emergencia_vinculo end,
    restricoes_alimentares = case when v ? 'restricoes_alimentares' then r.restricoes_alimentares else p.restricoes_alimentares end,
    condicoes_medicas = case when v ? 'condicoes_medicas' then r.condicoes_medicas else p.condicoes_medicas end,
    saude = case when v ? 'saude' and jsonb_typeof(v->'saude') = 'object'
                 then jsonb_strip_nulls(coalesce(p.saude, '{}'::jsonb) || (v->'saude')) else p.saude end,
    endereco_cep = case when v ? 'endereco_cep' then r.endereco_cep else p.endereco_cep end,
    endereco_rua = case when v ? 'endereco_rua' then r.endereco_rua else p.endereco_rua end,
    endereco_numero = case when v ? 'endereco_numero' then r.endereco_numero else p.endereco_numero end,
    endereco_complemento = case when v ? 'endereco_complemento' then r.endereco_complemento else p.endereco_complemento end,
    endereco_bairro = case when v ? 'endereco_bairro' then r.endereco_bairro else p.endereco_bairro end,
    endereco_cidade = case when v ? 'endereco_cidade' then r.endereco_cidade else p.endereco_cidade end,
    endereco_estado = case when v ? 'endereco_estado' then r.endereco_estado else p.endereco_estado end,
    ja_viajou_internacional = case when v ? 'ja_viajou_internacional' then r.ja_viajou_internacional else p.ja_viajou_internacional end,
    paises_visitados = case when v ? 'paises_visitados' then r.paises_visitados else p.paises_visitados end
  from jsonb_populate_record(null::passageiros, v) r
  where p.id = any(v_ids);

  return jsonb_build_object('linhas', coalesce(array_length(v_ids, 1), 0), 'expedicoes', to_jsonb(coalesce(v_exps, '{}'::uuid[])));
end $function$;

create or replace function public.exp_pessoa_excluir(p_ref uuid)
returns integer language plpgsql set search_path to 'public' as $function$
declare
  v_chave text;
  v_ids uuid[];
begin
  select exp_chave_identidade(cpf, bitrix_contact_id, email, nome_completo) into v_chave from passageiros where id = p_ref;
  if v_chave is null then raise exception 'Passageiro não encontrado.'; end if;
  select array_agg(id) into v_ids from passageiros
   where exp_chave_identidade(cpf, bitrix_contact_id, email, nome_completo) = v_chave;
  delete from passageiro_requisitos where passageiro_id = any(v_ids);
  delete from passageiros where id = any(v_ids);
  return coalesce(array_length(v_ids, 1), 0);
end $function$;

-- p_pax: [{id, expedicao_id, nome_completo, tipo, status_reserva, cpf, passaporte, data_nascimento,
--          validade_passaporte, email, telefone, observacoes, valor_contratado_brl, valor_pago_brl, status_financeiro}]
-- p_reqs: [{passageiro_id, tipo, descricao, status, obrigatoriedade, bloqueia_embarque, numero, observacoes}]
create or replace function public.exp_importar_passageiros(p_pax jsonb, p_reqs jsonb default '[]'::jsonb)
returns integer language plpgsql set search_path to 'public' as $function$
declare v_n integer;
begin
  insert into passageiros (id, expedicao_id, nome_completo, tipo, status_reserva, cpf, passaporte, data_nascimento,
                           validade_passaporte, email, telefone, observacoes, valor_contratado_brl, valor_pago_brl, status_financeiro)
  select (x->>'id')::uuid, (x->>'expedicao_id')::uuid, x->>'nome_completo', (x->>'tipo')::tipo_passageiro,
         (x->>'status_reserva')::status_reserva, nullif(x->>'cpf', ''), nullif(x->>'passaporte', ''),
         nullif(x->>'data_nascimento', '')::date, nullif(x->>'validade_passaporte', '')::date,
         nullif(x->>'email', ''), nullif(x->>'telefone', ''), nullif(x->>'observacoes', ''),
         coalesce((x->>'valor_contratado_brl')::numeric, 0), coalesce((x->>'valor_pago_brl')::numeric, 0),
         coalesce(x->>'status_financeiro', 'Em aberto')
    from jsonb_array_elements(coalesce(p_pax, '[]'::jsonb)) x;
  get diagnostics v_n = row_count;

  if jsonb_array_length(coalesce(p_reqs, '[]'::jsonb)) > 0 then
    insert into passageiro_requisitos (passageiro_id, tipo, descricao, status, obrigatoriedade, bloqueia_embarque, numero, observacoes)
    select (x->>'passageiro_id')::uuid, (x->>'tipo')::tipo_requisito, x->>'descricao', (x->>'status')::status_requisito,
           (x->>'obrigatoriedade')::obrigatoriedade, coalesce((x->>'bloqueia_embarque')::boolean, true),
           nullif(x->>'numero', ''), nullif(x->>'observacoes', '')
      from jsonb_array_elements(p_reqs) x;
  end if;
  return v_n;
end $function$;

create or replace function public.exp_pessoa_senha_estado(p_cpf text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_hash text; v_prov text;
begin
  if not exp_eh_admin() then return jsonb_build_object('admin', false); end if;
  if length(v_cpf) <> 11 then return jsonb_build_object('admin', true, 'tem_hash', false, 'senha_provisoria', null); end if;
  select senha_hash, senha_provisoria into v_hash, v_prov
    from acesso_senhas where regexp_replace(cpf, '\D', '', 'g') = v_cpf
   order by (senha_hash is not null) desc limit 1;
  return jsonb_build_object('admin', true, 'tem_hash', v_hash is not null, 'senha_provisoria', v_prov);
end $function$;

create or replace function public.exp_pessoa_senha_nova(p_cpf text)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_bytes bytea; v_senha text := ''; i int;
begin
  if not exp_eh_admin() then raise exception 'Apenas admin pode gerar senha do ExpedAmigo.'; end if;
  if length(v_cpf) <> 11 then raise exception 'CPF inválido (precisa de 11 dígitos).'; end if;
  v_bytes := extensions.gen_random_bytes(8);
  for i in 0..7 loop
    v_senha := v_senha || substr(v_alfabeto, (get_byte(v_bytes, i) % length(v_alfabeto)) + 1, 1);
  end loop;
  -- Linhas antigas gravadas com o CPF formatado: troca todas pra não sobrar hash velho.
  update acesso_senhas set senha_provisoria = v_senha, senha_hash = null, updated_at = now()
   where regexp_replace(cpf, '\D', '', 'g') = v_cpf;
  if not found then
    insert into acesso_senhas (cpf, senha_provisoria, senha_hash) values (v_cpf, v_senha, null);
  end if;
  return v_senha;
end $function$;

revoke execute on function public.exp_pessoa_propagar(uuid, jsonb), public.exp_pessoa_excluir(uuid),
  public.exp_importar_passageiros(jsonb, jsonb), public.exp_pessoa_senha_estado(text), public.exp_pessoa_senha_nova(text)
  from public, anon;
grant execute on function public.exp_chave_identidade(text, text, text, text), public.exp_pessoa_propagar(uuid, jsonb),
  public.exp_pessoa_excluir(uuid), public.exp_importar_passageiros(jsonb, jsonb),
  public.exp_pessoa_senha_estado(text), public.exp_pessoa_senha_nova(text) to authenticated;
