-- 0167 · Aba Passageiros das Expedições no QS (21/10/2026).
-- O que no app antigo eram vários updates soltos (ou service role) vira função atômica:
--  · exp_chave_pessoa(row)            — identidade da pessoa (= chaveIdentidade de lib/pessoas.ts)
--  · exp_atualizar_passageiro(id, patch) — salva a reserva e copia os dados PESSOAIS pra
--      todas as reservas da mesma pessoa (o antigo baixava a tabela inteira no servidor)
--  · exp_adicionar_existente(exp, ref) — puxa alguém da base (copia da reserva MAIS RECENTE;
--      se a pessoa estava "avulsa", a linha avulsa é usada em vez de duplicar)
--  · exp_importar_passageiros(exp, linhas) — CSV em lote; CPF repetido é pulado, não derruba o lote
--  · exp_mover_passageiro(pax, nova)  — muda de expedição levando arquivos, voos próprios,
--      extensões/passeios equivalentes (mesmo nome) e os requisitos que valem no destino novo
--  · exp_remover_passageiro(pax)      — tira desta expedição; os arquivos vão pra outra reserva
--      da pessoa (antes a cascata apagava até o passaporte das outras expedições)
--  · exp_grupo_definir / exp_grupos_ativar / exp_grupos_remover — G1/G2 (só admin; era
--      service role). "Remover divisão" apaga só G1/G2 (o antigo apagava TODOS os grupos).
-- security invoker = passa pelo RLS (exp_tem_acesso / is_readonly) de quem chama, exceto
-- grupos (security definer + exp_eh_admin()). Só aditivo. Não grava dado ao aplicar.

create or replace function public.exp_chave_pessoa(p passageiros)
returns text language sql immutable set search_path to 'public' as $function$
  select case
    when length(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g')) >= 11 then 'cpf:' || regexp_replace(p.cpf, '\D', '', 'g')
    when nullif(p.bitrix_contact_id, '') is not null then 'bx:' || p.bitrix_contact_id
    when nullif(p.email, '') is not null then 'email:' || lower(trim(p.email))
    else 'nome:' || lower(trim(p.nome_completo)) end;
$function$;

-- Barra cedo quem só lê (senão o RLS só "filtra" o update e a tela acharia que salvou).
create or replace function public._exp_exige_edicao()
returns void language plpgsql stable set search_path to 'public' as $function$
begin
  if not exp_tem_acesso() or is_readonly() then
    raise exception 'Seu perfil é só de leitura nas Expedições — essa ação não é permitida.';
  end if;
end $function$;

-- Campos PESSOAIS (propagam) = CAMPOS_PESSOAIS do app antigo. O resto é da reserva.
create or replace function public.exp_atualizar_passageiro(p_id uuid, p_patch jsonb)
returns void language plpgsql set search_path to 'public' as $function$
declare
  v_old passageiros;
  v passageiros;
  v_chave text;
begin
  perform _exp_exige_edicao();
  select * into v_old from passageiros where id = p_id;
  if not found then raise exception 'Passageiro não encontrado.'; end if;
  v_chave := exp_chave_pessoa(v_old);
  v := jsonb_populate_record(v_old, p_patch);
  if p_patch ? 'nome_completo' and length(trim(coalesce(v.nome_completo, ''))) < 2 then
    raise exception 'Nome precisa ter pelo menos 2 letras.';
  end if;

  update passageiros set
    nome_completo = v.nome_completo, cpf = v.cpf, passaporte = v.passaporte, validade_passaporte = v.validade_passaporte,
    passaporte_arquivo_id = v.passaporte_arquivo_id, foto_arquivo_id = v.foto_arquivo_id, data_nascimento = v.data_nascimento,
    email = v.email, telefone = v.telefone, contato_emergencia_nome = v.contato_emergencia_nome,
    contato_emergencia_fone = v.contato_emergencia_fone, contato_emergencia_vinculo = v.contato_emergencia_vinculo,
    restricoes_alimentares = v.restricoes_alimentares, condicoes_medicas = v.condicoes_medicas, saude = v.saude,
    endereco_cep = v.endereco_cep, endereco_rua = v.endereco_rua, endereco_numero = v.endereco_numero,
    endereco_complemento = v.endereco_complemento, endereco_bairro = v.endereco_bairro, endereco_cidade = v.endereco_cidade,
    endereco_estado = v.endereco_estado, ja_viajou_internacional = v.ja_viajou_internacional, paises_visitados = v.paises_visitados,
    -- da reserva
    tipo = v.tipo, status_reserva = v.status_reserva, observacoes = v.observacoes, companhia_aerea = v.companhia_aerea,
    localizador = v.localizador, voo_nacional_necessario = v.voo_nacional_necessario, contrato_assinado = v.contrato_assinado,
    checkin_online_feito = v.checkin_online_feito, pref_marcar_assento = v.pref_marcar_assento,
    pref_upgrade_classe = v.pref_upgrade_classe, acompanhante_nome = v.acompanhante_nome,
    acompanhante_divide_quarto = v.acompanhante_divide_quarto, acompanhante_vinculo = v.acompanhante_vinculo,
    acompanhante_dividir_com = v.acompanhante_dividir_com, perfil_viajante = v.perfil_viajante
  where id = p_id;

  -- propaga só os campos pessoais que vieram no patch, pras outras reservas da MESMA pessoa (chave antiga)
  update passageiros t set
    nome_completo = case when p_patch ? 'nome_completo' then v.nome_completo else t.nome_completo end,
    cpf = case when p_patch ? 'cpf' then v.cpf else t.cpf end,
    passaporte = case when p_patch ? 'passaporte' then v.passaporte else t.passaporte end,
    validade_passaporte = case when p_patch ? 'validade_passaporte' then v.validade_passaporte else t.validade_passaporte end,
    passaporte_arquivo_id = case when p_patch ? 'passaporte_arquivo_id' then v.passaporte_arquivo_id else t.passaporte_arquivo_id end,
    foto_arquivo_id = case when p_patch ? 'foto_arquivo_id' then v.foto_arquivo_id else t.foto_arquivo_id end,
    data_nascimento = case when p_patch ? 'data_nascimento' then v.data_nascimento else t.data_nascimento end,
    email = case when p_patch ? 'email' then v.email else t.email end,
    telefone = case when p_patch ? 'telefone' then v.telefone else t.telefone end,
    contato_emergencia_nome = case when p_patch ? 'contato_emergencia_nome' then v.contato_emergencia_nome else t.contato_emergencia_nome end,
    contato_emergencia_fone = case when p_patch ? 'contato_emergencia_fone' then v.contato_emergencia_fone else t.contato_emergencia_fone end,
    contato_emergencia_vinculo = case when p_patch ? 'contato_emergencia_vinculo' then v.contato_emergencia_vinculo else t.contato_emergencia_vinculo end,
    restricoes_alimentares = case when p_patch ? 'restricoes_alimentares' then v.restricoes_alimentares else t.restricoes_alimentares end,
    condicoes_medicas = case when p_patch ? 'condicoes_medicas' then v.condicoes_medicas else t.condicoes_medicas end,
    saude = case when p_patch ? 'saude' then v.saude else t.saude end,
    endereco_cep = case when p_patch ? 'endereco_cep' then v.endereco_cep else t.endereco_cep end,
    endereco_rua = case when p_patch ? 'endereco_rua' then v.endereco_rua else t.endereco_rua end,
    endereco_numero = case when p_patch ? 'endereco_numero' then v.endereco_numero else t.endereco_numero end,
    endereco_complemento = case when p_patch ? 'endereco_complemento' then v.endereco_complemento else t.endereco_complemento end,
    endereco_bairro = case when p_patch ? 'endereco_bairro' then v.endereco_bairro else t.endereco_bairro end,
    endereco_cidade = case when p_patch ? 'endereco_cidade' then v.endereco_cidade else t.endereco_cidade end,
    endereco_estado = case when p_patch ? 'endereco_estado' then v.endereco_estado else t.endereco_estado end,
    ja_viajou_internacional = case when p_patch ? 'ja_viajou_internacional' then v.ja_viajou_internacional else t.ja_viajou_internacional end,
    paises_visitados = case when p_patch ? 'paises_visitados' then v.paises_visitados else t.paises_visitados end
  where t.id <> p_id and exp_chave_pessoa(t) = v_chave
    and p_patch ?| array['nome_completo','cpf','passaporte','validade_passaporte','passaporte_arquivo_id','foto_arquivo_id',
      'data_nascimento','email','telefone','contato_emergencia_nome','contato_emergencia_fone','contato_emergencia_vinculo',
      'restricoes_alimentares','condicoes_medicas','saude','endereco_cep','endereco_rua','endereco_numero','endereco_complemento',
      'endereco_bairro','endereco_cidade','endereco_estado','ja_viajou_internacional','paises_visitados'];
end $function$;

create or replace function public.exp_adicionar_existente(p_expedicao uuid, p_ref uuid)
returns uuid language plpgsql set search_path to 'public' as $function$
declare
  v_ref passageiros;
  v_chave text;
  v_avulso uuid;
  v_id uuid;
begin
  perform _exp_exige_edicao();
  select * into v_ref from passageiros where id = p_ref;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  v_chave := exp_chave_pessoa(v_ref);
  if exists (select 1 from passageiros t where t.expedicao_id = p_expedicao and exp_chave_pessoa(t) = v_chave) then
    raise exception 'Essa pessoa já está nesta expedição.';
  end if;
  -- copia da reserva MAIS RECENTE da pessoa (o antigo pegava a mais antiga)
  select * into v_ref from passageiros t where exp_chave_pessoa(t) = v_chave order by t.updated_at desc, t.created_at desc limit 1;
  select id into v_avulso from passageiros t where t.expedicao_id is null and exp_chave_pessoa(t) = v_chave limit 1;
  if v_avulso is not null then
    update passageiros set expedicao_id = p_expedicao, tipo = 'Pagante', status_reserva = 'Lead' where id = v_avulso;
    return v_avulso;
  end if;
  insert into passageiros (expedicao_id, tipo, status_reserva, bitrix_contact_id,
    nome_completo, cpf, passaporte, validade_passaporte, passaporte_arquivo_id, foto_arquivo_id, data_nascimento, email, telefone,
    contato_emergencia_nome, contato_emergencia_fone, contato_emergencia_vinculo, restricoes_alimentares, condicoes_medicas, saude,
    endereco_cep, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado,
    ja_viajou_internacional, paises_visitados)
  values (p_expedicao, 'Pagante', 'Lead', v_ref.bitrix_contact_id,
    v_ref.nome_completo, v_ref.cpf, v_ref.passaporte, v_ref.validade_passaporte, v_ref.passaporte_arquivo_id, v_ref.foto_arquivo_id,
    v_ref.data_nascimento, v_ref.email, v_ref.telefone, v_ref.contato_emergencia_nome, v_ref.contato_emergencia_fone,
    v_ref.contato_emergencia_vinculo, v_ref.restricoes_alimentares, v_ref.condicoes_medicas, v_ref.saude,
    v_ref.endereco_cep, v_ref.endereco_rua, v_ref.endereco_numero, v_ref.endereco_complemento, v_ref.endereco_bairro,
    v_ref.endereco_cidade, v_ref.endereco_estado, v_ref.ja_viajou_internacional, v_ref.paises_visitados)
  returning id into v_id;
  return v_id;
end $function$;

-- linhas: [{nome_completo, tipo, status_reserva, cpf, passaporte, validade_passaporte, data_nascimento,
--           email, telefone, observacoes, valor_contratado_brl, valor_pago_brl}]
create or replace function public.exp_importar_passageiros(p_expedicao uuid, p_linhas jsonb)
returns jsonb language plpgsql set search_path to 'public' as $function$
declare
  l jsonb;
  v_cpf text;
  v_dig text;
  v_tipo tipo_passageiro;
  v_contr numeric;
  v_pago numeric;
  v_vistos text[] := array(select regexp_replace(cpf, '\D', '', 'g') from passageiros where expedicao_id = p_expedicao and cpf is not null);
  ins int := 0;
  ign int := 0;
begin
  perform _exp_exige_edicao();
  if jsonb_array_length(coalesce(p_linhas, '[]')) = 0 then raise exception 'Nenhuma linha para importar.'; end if;
  if jsonb_array_length(p_linhas) > 1000 then raise exception 'No máximo 1000 linhas por vez.'; end if;
  for l in select * from jsonb_array_elements(p_linhas) loop
    if length(trim(coalesce(l->>'nome_completo', ''))) < 2 then ign := ign + 1; continue; end if;
    v_cpf := nullif(trim(coalesce(l->>'cpf', '')), '');
    v_dig := regexp_replace(coalesce(v_cpf, ''), '\D', '', 'g');
    if length(v_dig) = 11 and v_dig = any(v_vistos) then ign := ign + 1; continue; end if;
    v_tipo := coalesce(nullif(l->>'tipo', ''), 'Pagante')::tipo_passageiro;
    v_contr := coalesce((l->>'valor_contratado_brl')::numeric, 0);
    v_pago := coalesce((l->>'valor_pago_brl')::numeric, 0);
    begin
      insert into passageiros (expedicao_id, nome_completo, tipo, status_reserva, cpf, passaporte, validade_passaporte,
        data_nascimento, email, telefone, observacoes, valor_contratado_brl, valor_pago_brl, status_financeiro)
      values (p_expedicao, trim(l->>'nome_completo'), v_tipo, coalesce(nullif(l->>'status_reserva', ''), 'Confirmado')::status_reserva,
        v_cpf, nullif(l->>'passaporte', ''), nullif(l->>'validade_passaporte', '')::date, nullif(l->>'data_nascimento', '')::date,
        nullif(l->>'email', ''), nullif(l->>'telefone', ''), nullif(l->>'observacoes', ''), v_contr, v_pago,
        case when v_tipo <> 'Pagante' and v_contr = 0 then 'Cortesia'
             when v_contr > 0 and v_pago >= v_contr then 'Quitado' else 'Em aberto' end);
      ins := ins + 1;
      if length(v_dig) = 11 then v_vistos := v_vistos || v_dig; end if;
    exception when unique_violation then
      ign := ign + 1;
    end;
  end loop;
  return jsonb_build_object('inseridos', ins, 'ignorados', ign);
end $function$;

create or replace function public.exp_mover_passageiro(p_pax uuid, p_nova uuid)
returns void language plpgsql set search_path to 'public' as $function$
declare
  v passageiros;
  v_destino text;
begin
  perform _exp_exige_edicao();
  select * into v from passageiros where id = p_pax;
  if not found then raise exception 'Passageiro não encontrado.'; end if;
  if v.expedicao_id = p_nova then raise exception 'Já está nessa expedição.'; end if;
  select destino into v_destino from expedicoes where id = p_nova;
  if v_destino is null then raise exception 'Expedição de destino não encontrada.'; end if;
  if exists (select 1 from passageiros t where t.expedicao_id = p_nova and exp_chave_pessoa(t) = exp_chave_pessoa(v)) then
    raise exception 'Essa pessoa já está na expedição de destino.';
  end if;

  -- requisitos: ficam só os que são DA PESSOA (passaporte, vacina, RG) e que o destino novo também
  -- pede — com anexo e status. Os da viagem (aéreo, seguro, visto, ingressos) saem e renascem pendentes.
  delete from passageiro_requisitos r where r.passageiro_id = p_pax
    and (r.tipo not in ('Passaporte', 'Vacina', 'RG')
         or r.tipo not in (select c.tipo from exp_catalogo_requisitos(v_destino) c));
  delete from passageiro_quarto where passageiro_id = p_pax;
  -- extensões / passeios: troca pela equivalente (mesmo nome) da expedição nova; sem equivalente, sai.
  update passageiro_extensao pe set extensao_id = n.id
    from extensoes o, extensoes n
   where pe.passageiro_id = p_pax and o.id = pe.extensao_id and n.expedicao_id = p_nova
     and lower(trim(n.nome)) = lower(trim(o.nome));
  delete from passageiro_extensao pe using extensoes o
   where pe.passageiro_id = p_pax and o.id = pe.extensao_id and o.expedicao_id <> p_nova;
  update passeio_opcional_compras pc set passeio_opcional_id = n.id
    from passeios_opcionais o, passeios_opcionais n
   where pc.passageiro_id = p_pax and o.id = pc.passeio_opcional_id and n.expedicao_id = p_nova
     and lower(trim(coalesce(n.titulo, ''))) = lower(trim(coalesce(o.titulo, ''))) and coalesce(o.titulo, '') <> '';
  delete from passeio_opcional_compras pc using passeios_opcionais o
   where pc.passageiro_id = p_pax and o.id = pc.passeio_opcional_id and o.expedicao_id <> p_nova;
  -- arquivos e voos próprios do pax vão junto
  update arquivos set expedicao_id = p_nova where passageiro_id = p_pax;
  update expedicao_voos set expedicao_id = p_nova, extensao_id = null, grupo_id = null where passageiro_id = p_pax;

  update passageiros set expedicao_id = p_nova, grupo_id = null, conexao_viagem_id = null, quarto_id = null where id = p_pax;
  -- o trigger trg_passageiros_requisitos (0166) cria os requisitos que faltarem do destino novo
end $function$;

-- 'apagado' = a pessoa tinha outra reserva, esta linha saiu; 'avulso' = era a única, virou avulso.
create or replace function public.exp_remover_passageiro(p_pax uuid)
returns text language plpgsql set search_path to 'public' as $function$
declare
  v passageiros;
  v_irmao passageiros;
begin
  perform _exp_exige_edicao();
  select * into v from passageiros where id = p_pax;
  if not found then raise exception 'Passageiro não encontrado.'; end if;
  select * into v_irmao from passageiros t where t.id <> p_pax and exp_chave_pessoa(t) = exp_chave_pessoa(v)
   order by (t.expedicao_id is null), t.updated_at desc limit 1;
  if found then
    -- arquivos da pessoa (passaporte, certificados…) passam pra outra reserva dela antes de apagar
    update arquivos set passageiro_id = v_irmao.id, expedicao_id = coalesce(v_irmao.expedicao_id, expedicao_id)
     where passageiro_id = p_pax;
    delete from passageiros where id = p_pax;
    return 'apagado';
  end if;
  delete from passageiro_requisitos where passageiro_id = p_pax;
  delete from passageiro_quarto where passageiro_id = p_pax;
  delete from passageiro_extensao where passageiro_id = p_pax;
  delete from passeio_opcional_compras where passageiro_id = p_pax;
  update passageiros set expedicao_id = null, grupo_id = null, conexao_viagem_id = null, quarto_id = null where id = p_pax;
  return 'avulso';
end $function$;

-- ── Grupos G1/G2 (só admin) ──────────────────────────────────────────────────
create or replace function public.exp_grupos_ativar(p_expedicao uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exp_eh_admin() then raise exception 'Só administradores mexem na divisão por grupos.'; end if;
  insert into grupos_expedicao (expedicao_id, nome, pax_planejados, ordem)
  select p_expedicao, g.nome, 0, g.ordem from (values ('G1', 1), ('G2', 2)) g(nome, ordem)
  on conflict (expedicao_id, nome) do nothing;
end $function$;

create or replace function public.exp_grupos_remover(p_expedicao uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exp_eh_admin() then raise exception 'Só administradores mexem na divisão por grupos.'; end if;
  -- grupo_id dos passageiros cai sozinho (FK on delete set null). Outros grupos (G3, com datas…) ficam.
  delete from grupos_expedicao where expedicao_id = p_expedicao and nome in ('G1', 'G2');
end $function$;

create or replace function public.exp_grupo_definir(p_pax uuid, p_grupo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_exp uuid; v_grupo uuid;
begin
  if not exp_eh_admin() then raise exception 'Só administradores mexem na divisão por grupos.'; end if;
  select expedicao_id into v_exp from passageiros where id = p_pax;
  if v_exp is null then raise exception 'Passageiro sem expedição.'; end if;
  if p_grupo is null or p_grupo = '' then
    update passageiros set grupo_id = null where id = p_pax;
    return;
  end if;
  if p_grupo not in ('G1', 'G2') then raise exception 'Grupo inválido.'; end if;
  insert into grupos_expedicao (expedicao_id, nome, pax_planejados, ordem)
  values (v_exp, p_grupo, 0, case when p_grupo = 'G1' then 1 else 2 end)
  on conflict (expedicao_id, nome) do nothing;
  select id into v_grupo from grupos_expedicao where expedicao_id = v_exp and nome = p_grupo;
  update passageiros set grupo_id = v_grupo where id = p_pax;
end $function$;

revoke execute on function public.exp_atualizar_passageiro(uuid, jsonb), public.exp_adicionar_existente(uuid, uuid),
  public.exp_importar_passageiros(uuid, jsonb), public.exp_mover_passageiro(uuid, uuid), public.exp_remover_passageiro(uuid),
  public.exp_grupos_ativar(uuid), public.exp_grupos_remover(uuid), public.exp_grupo_definir(uuid, text) from public, anon;
grant execute on function public._exp_exige_edicao(), public.exp_chave_pessoa(passageiros), public.exp_atualizar_passageiro(uuid, jsonb),
  public.exp_adicionar_existente(uuid, uuid), public.exp_importar_passageiros(uuid, jsonb), public.exp_mover_passageiro(uuid, uuid),
  public.exp_remover_passageiro(uuid), public.exp_grupos_ativar(uuid), public.exp_grupos_remover(uuid),
  public.exp_grupo_definir(uuid, text) to authenticated;
