-- 0163 — Inscrições das Expedições dentro do QS (21/10/2026).
-- No app antigo, aprovar/recusar/restaurar/excluir usavam SERVICE ROLE e eram
-- vários inserts/updates soltos (se caía no meio, sobrava passageiro gravado com
-- a pendência ainda na fila). Aqui cada decisão é UMA função security definer,
-- atômica, que confere a permissão de quem chama:
--   · aprovar / recusar → exp_pode_decidir_inscricao() (quem edita + Relacionamento)
--   · restaurar / excluir → quem edita (not is_readonly()); Relacionamento não.
-- O formulário público (/inscricao, app antigo) continua gravando
-- inscricoes_pendentes do MESMO jeito — nada no formato mudou.
-- Correções em relação ao antigo (bugs da spec):
--   · requisitos de prontidão agora são gerados mesmo quando quem aprova é do
--     Relacionamento (antes a RLS barrava e o erro era engolido);
--   · a busca da pessoa por CPF não corta em 1000 linhas;
--   · propagar dados pessoais pras outras reservas da pessoa não apaga valor com vazio;
--   · o Relacionamento consegue anexar arquivo no motivo da recusa (policy de storage
--     só pra pasta inscricoes/recusas);
--   · excluir definitivo não apaga arquivo que algum passageiro/requisito ainda usa.

-- ── Quem decide ──────────────────────────────────────────────────────────────
create or replace function public.exp_pode_decidir_inscricao() returns boolean
language sql stable security definer set search_path = public as $$
  select exp_tem_acesso() and (
    not is_readonly()
    or coalesce((select papel::text = 'relacionamento' from usuarios where id = auth.uid()), qs_do_setor('relacionamento'))
  );
$$;

-- Nome de quem decidiu (usuarios do app antigo, senão o perfil do QS).
create or replace function public.exp__nome_usuario() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nome from usuarios where id = auth.uid()), (select name from qs_users where id = auth.uid()));
$$;

-- Texto → data (aceita 'aaaa-mm-dd...' ; qualquer coisa estranha vira null).
create or replace function public.exp__data(p text) returns date
language plpgsql immutable as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return left(btrim(p), 10)::date;
exception when others then return null;
end $$;

create or replace function public.exp__uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return p::uuid;
end $$;

create or replace function public.exp__registrar_decisao(p_exp uuid, p_cpf text, p_nome text, p_acao text, p_motivo text default null)
returns void language sql security definer set search_path = public as $$
  insert into inscricoes_decisoes (expedicao_id, cpf, nome_completo, acao, motivo, decidido_por, decidido_por_nome)
  values (p_exp, p_cpf, p_nome, p_acao, p_motivo,
          (select id from usuarios where id = auth.uid()), exp__nome_usuario());
$$;

-- Vacina é da PESSOA: espalha o certificado de febre amarela no slot "Vacina" vazio
-- de todas as reservas dela (não mexe em Dispensado/Reprovado). Porte de
-- lib/prontidao/vacina-sync.ts.
create or replace function public.exp__espalhar_vacina(p_cpf text, p_cert uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cert uuid := p_cert; n integer;
begin
  if length(coalesce(p_cpf, '')) <> 11 then return 0; end if;
  if v_cert is null then
    select pr.arquivo_id into v_cert
      from passageiro_requisitos pr join passageiros p on p.id = pr.passageiro_id
     where regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g') = p_cpf and pr.tipo = 'Vacina' and pr.arquivo_id is not null
     limit 1;
  end if;
  if v_cert is null then
    select a.id into v_cert
      from arquivos a join passageiros p on p.id = a.passageiro_id
     where regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g') = p_cpf and a.descricao ilike '%Febre Amarela%'
     limit 1;
  end if;
  if v_cert is null then return 0; end if;
  update passageiro_requisitos pr
     set arquivo_id = v_cert,
         status = case when pr.status = 'Aprovado' then 'Aprovado'::status_requisito else 'Enviado'::status_requisito end
    from passageiros p
   where p.id = pr.passageiro_id
     and regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g') = p_cpf
     and pr.tipo = 'Vacina' and pr.arquivo_id is null
     and pr.status not in ('Dispensado', 'Reprovado');
  get diagnostics n = row_count;
  return n;
end $$;

-- ── APROVAR ─────────────────────────────────────────────────────────────────
-- p_requisitos: os modelos de requisito do destino (o catálogo mora no front,
-- lib/prontidao/requisitos-destino.ts), já sem os de coluna:
--   [{tipo, descricao, obrigatoriedade, bloqueia_embarque, observacoes}]
-- Gera para TODO passageiro ativo da expedição que ainda não tem requisito
-- (igual ao gerarRequisitosPadrao do antigo).
create or replace function public.exp_inscricao_aprovar(p_id uuid, p_requisitos jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pend inscricoes_pendentes%rowtype;
  d jsonb;
  v_cpf text;
  v_exp uuid;
  v_pax uuid;
  v_exist passageiros%rowtype;
  v_onb boolean;
  v_cert uuid;
  v_saude jsonb;
  v_perfil jsonb;
  ag record;
  r record;
  v_novos uuid[];
begin
  if not exp_pode_decidir_inscricao() then raise exception 'Sem permissão para aprovar inscrições.'; end if;
  select * into pend from inscricoes_pendentes where id = p_id for update;
  if not found then raise exception 'Inscrição não encontrada.'; end if;

  d := coalesce(pend.dados, '{}'::jsonb);
  v_cpf := regexp_replace(coalesce(pend.cpf, ''), '\D', '', 'g');
  v_exp := pend.expedicao_id;
  v_saude := case when jsonb_typeof(d->'saude') = 'object' then d->'saude' else '{}'::jsonb end;
  v_cert := exp__uuid(v_saude->>'vacina_febre_amarela_arquivo_id');
  v_perfil := jsonb_build_object(
    'profissao', nullif(btrim(d->>'profissao'), ''), 'instagram', nullif(btrim(d->>'instagram'), ''),
    'camiseta', nullif(btrim(d->>'camiseta'), ''), 'musica', nullif(btrim(d->>'musica'), ''),
    'descricao_grupo', nullif(btrim(d->>'descricao_grupo'), ''), 'anima_expedicao', nullif(btrim(d->>'anima_expedicao'), ''),
    'significado', nullif(btrim(d->>'significado'), ''),
    'confirmou_veracidade', coalesce((case when jsonb_typeof(d->'confirmou_veracidade') = 'boolean' then (d->>'confirmou_veracidade')::boolean end), false));

  -- A reserva desta expedição; senão a linha AVULSA criada no envio do formulário.
  select * into v_exist from passageiros
   where regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf and expedicao_id = v_exp
   order by created_at limit 1;
  if not found then
    select * into v_exist from passageiros
     where regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf and expedicao_id is null
     order by created_at limit 1;
  end if;
  v_onb := exists (select 1 from acesso_senhas where regexp_replace(cpf, '\D', '', 'g') = v_cpf);

  if v_exist.id is not null then
    update passageiros set
      nome_completo = coalesce(nullif(d->>'nome_completo', ''), nome_completo),
      data_nascimento = coalesce(exp__data(d->>'data_nascimento'), pend.data_nascimento, data_nascimento),
      email = nullif(btrim(d->>'email'), ''),
      telefone = nullif(btrim(d->>'telefone'), ''),
      passaporte = nullif(btrim(d->>'passaporte'), ''),
      validade_passaporte = exp__data(d->>'validade_passaporte'),
      contato_emergencia_nome = nullif(btrim(d->>'contato_emergencia_nome'), ''),
      contato_emergencia_fone = nullif(btrim(d->>'contato_emergencia_fone'), ''),
      contato_emergencia_vinculo = nullif(btrim(d->>'contato_emergencia_vinculo'), ''),
      endereco_cep = nullif(btrim(d->>'endereco_cep'), ''),
      endereco_rua = nullif(btrim(d->>'endereco_rua'), ''),
      endereco_numero = nullif(btrim(d->>'endereco_numero'), ''),
      endereco_complemento = nullif(btrim(d->>'endereco_complemento'), ''),
      endereco_bairro = nullif(btrim(d->>'endereco_bairro'), ''),
      endereco_cidade = nullif(btrim(d->>'endereco_cidade'), ''),
      endereco_estado = nullif(btrim(d->>'endereco_estado'), ''),
      pref_marcar_assento = case when jsonb_typeof(d->'pref_marcar_assento') = 'boolean' then (d->>'pref_marcar_assento')::boolean end,
      pref_upgrade_classe = nullif(btrim(coalesce(d->>'pref_upgrade_classe', '')), ''),
      ja_viajou_internacional = case when jsonb_typeof(d->'ja_viajou_internacional') = 'boolean' then (d->>'ja_viajou_internacional')::boolean end,
      paises_visitados = nullif(btrim(d->>'paises_visitados'), ''),
      acompanhante_nome = nullif(btrim(d->>'acompanhante_nome'), ''),
      acompanhante_divide_quarto = nullif(btrim(coalesce(d->>'acompanhante_divide_quarto', '')), ''),
      acompanhante_vinculo = nullif(btrim(d->>'acompanhante_vinculo'), ''),
      acompanhante_dividir_com = nullif(btrim(d->>'acompanhante_dividir_com'), ''),
      saude = coalesce(saude, '{}'::jsonb) || v_saude,
      perfil_viajante = v_perfil,
      pendente_aprovacao = false,
      expedicao_id = v_exp,
      status_reserva = case when status_reserva = 'Lead' then 'Pré-reserva'::status_reserva else status_reserva end,
      passaporte_arquivo_id = coalesce(pend.passaporte_arquivo_id, passaporte_arquivo_id),
      foto_arquivo_id = coalesce(pend.foto_arquivo_id, foto_arquivo_id),
      liberado_expedamigo = liberado_expedamigo or v_onb
    where id = v_exist.id;
    v_pax := v_exist.id;
  else
    -- Perfil agregado da pessoa (valor mais recente não vazio) pra completar o que o form não trouxe.
    select
      (array_agg(email order by created_at desc) filter (where nullif(email, '') is not null))[1] as email,
      (array_agg(telefone order by created_at desc) filter (where nullif(telefone, '') is not null))[1] as telefone,
      (array_agg(passaporte order by created_at desc) filter (where nullif(passaporte, '') is not null))[1] as passaporte,
      (array_agg(validade_passaporte order by created_at desc) filter (where validade_passaporte is not null))[1] as validade_passaporte,
      (array_agg(passaporte_arquivo_id order by created_at desc) filter (where passaporte_arquivo_id is not null))[1] as passaporte_arquivo_id,
      (array_agg(endereco_cep order by created_at desc) filter (where nullif(endereco_cep, '') is not null))[1] as endereco_cep,
      (array_agg(endereco_rua order by created_at desc) filter (where nullif(endereco_rua, '') is not null))[1] as endereco_rua,
      (array_agg(endereco_numero order by created_at desc) filter (where nullif(endereco_numero, '') is not null))[1] as endereco_numero,
      (array_agg(endereco_complemento order by created_at desc) filter (where nullif(endereco_complemento, '') is not null))[1] as endereco_complemento,
      (array_agg(endereco_bairro order by created_at desc) filter (where nullif(endereco_bairro, '') is not null))[1] as endereco_bairro,
      (array_agg(endereco_cidade order by created_at desc) filter (where nullif(endereco_cidade, '') is not null))[1] as endereco_cidade,
      (array_agg(endereco_estado order by created_at desc) filter (where nullif(endereco_estado, '') is not null))[1] as endereco_estado,
      (array_agg(contato_emergencia_nome order by created_at desc) filter (where nullif(contato_emergencia_nome, '') is not null))[1] as contato_emergencia_nome,
      (array_agg(contato_emergencia_fone order by created_at desc) filter (where nullif(contato_emergencia_fone, '') is not null))[1] as contato_emergencia_fone,
      (array_agg(contato_emergencia_vinculo order by created_at desc) filter (where nullif(contato_emergencia_vinculo, '') is not null))[1] as contato_emergencia_vinculo,
      (array_agg(restricoes_alimentares order by created_at desc) filter (where nullif(restricoes_alimentares, '') is not null))[1] as restricoes_alimentares,
      (array_agg(condicoes_medicas order by created_at desc) filter (where nullif(condicoes_medicas, '') is not null))[1] as condicoes_medicas,
      (array_agg(saude order by created_at desc) filter (where saude is not null and saude <> '{}'::jsonb))[1] as saude,
      (array_agg(ja_viajou_internacional order by created_at desc) filter (where ja_viajou_internacional is not null))[1] as ja_viajou_internacional,
      (array_agg(paises_visitados order by created_at desc) filter (where nullif(paises_visitados, '') is not null))[1] as paises_visitados
    into ag
    from passageiros where regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf;

    insert into passageiros (
      nome_completo, cpf, data_nascimento, email, telefone, passaporte, validade_passaporte,
      contato_emergencia_nome, contato_emergencia_fone, contato_emergencia_vinculo,
      endereco_cep, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado,
      pref_marcar_assento, pref_upgrade_classe, ja_viajou_internacional, paises_visitados,
      acompanhante_nome, acompanhante_divide_quarto, acompanhante_vinculo, acompanhante_dividir_com,
      saude, perfil_viajante, tipo, inscricao_origem, restricoes_alimentares, condicoes_medicas,
      expedicao_id, status_reserva, pendente_aprovacao, passaporte_arquivo_id, foto_arquivo_id, liberado_expedamigo)
    values (
      coalesce(nullif(d->>'nome_completo', ''), pend.nome_completo, ''), v_cpf,
      coalesce(exp__data(d->>'data_nascimento'), pend.data_nascimento),
      coalesce(nullif(btrim(d->>'email'), ''), ag.email),
      coalesce(nullif(btrim(d->>'telefone'), ''), ag.telefone),
      coalesce(nullif(btrim(d->>'passaporte'), ''), ag.passaporte),
      coalesce(exp__data(d->>'validade_passaporte'), ag.validade_passaporte),
      coalesce(nullif(btrim(d->>'contato_emergencia_nome'), ''), ag.contato_emergencia_nome),
      coalesce(nullif(btrim(d->>'contato_emergencia_fone'), ''), ag.contato_emergencia_fone),
      coalesce(nullif(btrim(d->>'contato_emergencia_vinculo'), ''), ag.contato_emergencia_vinculo),
      coalesce(nullif(btrim(d->>'endereco_cep'), ''), ag.endereco_cep),
      coalesce(nullif(btrim(d->>'endereco_rua'), ''), ag.endereco_rua),
      coalesce(nullif(btrim(d->>'endereco_numero'), ''), ag.endereco_numero),
      coalesce(nullif(btrim(d->>'endereco_complemento'), ''), ag.endereco_complemento),
      coalesce(nullif(btrim(d->>'endereco_bairro'), ''), ag.endereco_bairro),
      coalesce(nullif(btrim(d->>'endereco_cidade'), ''), ag.endereco_cidade),
      coalesce(nullif(btrim(d->>'endereco_estado'), ''), ag.endereco_estado),
      case when jsonb_typeof(d->'pref_marcar_assento') = 'boolean' then (d->>'pref_marcar_assento')::boolean end,
      nullif(btrim(coalesce(d->>'pref_upgrade_classe', '')), ''),
      coalesce(case when jsonb_typeof(d->'ja_viajou_internacional') = 'boolean' then (d->>'ja_viajou_internacional')::boolean end, ag.ja_viajou_internacional),
      coalesce(nullif(btrim(d->>'paises_visitados'), ''), ag.paises_visitados),
      nullif(btrim(d->>'acompanhante_nome'), ''),
      nullif(btrim(coalesce(d->>'acompanhante_divide_quarto', '')), ''),
      nullif(btrim(d->>'acompanhante_vinculo'), ''),
      nullif(btrim(d->>'acompanhante_dividir_com'), ''),
      case when v_saude <> '{}'::jsonb then v_saude else coalesce(ag.saude, '{}'::jsonb) end,
      v_perfil, 'Pagante', 'Formulário público', ag.restricoes_alimentares, ag.condicoes_medicas,
      v_exp, 'Pré-reserva', false,
      coalesce(pend.passaporte_arquivo_id, ag.passaporte_arquivo_id), pend.foto_arquivo_id, v_onb)
    returning id into v_pax;
  end if;

  -- Dados pessoais seguem a pessoa nas outras reservas (sem apagar valor com vazio).
  update passageiros set
    nome_completo = coalesce(nullif(d->>'nome_completo', ''), nome_completo),
    email = coalesce(nullif(btrim(d->>'email'), ''), email),
    telefone = coalesce(nullif(btrim(d->>'telefone'), ''), telefone),
    passaporte = coalesce(nullif(btrim(d->>'passaporte'), ''), passaporte),
    validade_passaporte = coalesce(exp__data(d->>'validade_passaporte'), validade_passaporte),
    endereco_cep = coalesce(nullif(btrim(d->>'endereco_cep'), ''), endereco_cep),
    endereco_rua = coalesce(nullif(btrim(d->>'endereco_rua'), ''), endereco_rua),
    endereco_numero = coalesce(nullif(btrim(d->>'endereco_numero'), ''), endereco_numero),
    endereco_complemento = coalesce(nullif(btrim(d->>'endereco_complemento'), ''), endereco_complemento),
    endereco_bairro = coalesce(nullif(btrim(d->>'endereco_bairro'), ''), endereco_bairro),
    endereco_cidade = coalesce(nullif(btrim(d->>'endereco_cidade'), ''), endereco_cidade),
    endereco_estado = coalesce(nullif(btrim(d->>'endereco_estado'), ''), endereco_estado),
    contato_emergencia_nome = coalesce(nullif(btrim(d->>'contato_emergencia_nome'), ''), contato_emergencia_nome),
    contato_emergencia_fone = coalesce(nullif(btrim(d->>'contato_emergencia_fone'), ''), contato_emergencia_fone),
    contato_emergencia_vinculo = coalesce(nullif(btrim(d->>'contato_emergencia_vinculo'), ''), contato_emergencia_vinculo),
    ja_viajou_internacional = coalesce(case when jsonb_typeof(d->'ja_viajou_internacional') = 'boolean' then (d->>'ja_viajou_internacional')::boolean end, ja_viajou_internacional),
    paises_visitados = coalesce(nullif(btrim(d->>'paises_visitados'), ''), paises_visitados)
  where regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf and id <> v_pax;

  -- Anexos do formulário passam a ser do passageiro.
  update arquivos set passageiro_id = v_pax
   where id in (pend.passaporte_arquivo_id, pend.foto_arquivo_id, v_cert);

  -- Requisitos de prontidão pra quem ainda não tem (toda a expedição, como no antigo).
  select array_agg(p.id) into v_novos
    from passageiros p
   where p.expedicao_id = v_exp and p.status_reserva <> 'Cancelado'
     and not exists (select 1 from passageiro_requisitos pr where pr.passageiro_id = p.id);
  if v_novos is not null and jsonb_typeof(p_requisitos) = 'array' and jsonb_array_length(p_requisitos) > 0 then
    insert into passageiro_requisitos (passageiro_id, tipo, descricao, status, obrigatoriedade, bloqueia_embarque, numero, observacoes)
    select p.id, (t->>'tipo')::tipo_requisito, t->>'descricao',
           case
             when t->>'tipo' = 'Aéreo Internacional' then case when nullif(p.localizador, '') is not null then 'Aprovado' else 'Pendente' end
             when t->>'tipo' = 'Aéreo Doméstico' then case when p.voo_nacional_necessario then 'Pendente' else 'Dispensado' end
             else 'Pendente'
           end::status_requisito,
           coalesce(nullif(t->>'obrigatoriedade', ''), 'Obrigatório')::obrigatoriedade,
           coalesce((t->>'bloqueia_embarque')::boolean, true),
           case when t->>'tipo' = 'Aéreo Internacional' then p.localizador end,
           nullif(t->>'observacoes', '')
      from passageiros p cross join jsonb_array_elements(p_requisitos) t
     where p.id = any(v_novos);
    -- quem ganhou requisito agora herda o certificado de vacina que já tiver
    for r in select distinct regexp_replace(coalesce(cpf, ''), '\D', '', 'g') as c from passageiros where id = any(v_novos) and id <> v_pax loop
      perform exp__espalhar_vacina(r.c, null);
    end loop;
  end if;
  perform exp__espalhar_vacina(v_cpf, v_cert);

  delete from inscricoes_pendentes where id = p_id;
  perform exp__registrar_decisao(v_exp, pend.cpf, coalesce(pend.nome_completo, d->>'nome_completo'), 'aprovada');

  return jsonb_build_object('passageiro_id', v_pax, 'expedicao_id', v_exp,
    'nome', (select nome_completo from passageiros where id = v_pax));
end $$;

-- ── RECUSAR (com motivo obrigatório e anexo opcional) ───────────────────────
-- p_arquivo (opcional): o arquivo que o front acabou de subir no bucket
--   {storage_path, nome, mime, tamanho_bytes} — a linha em `arquivos` nasce aqui.
create or replace function public.exp_inscricao_recusar(p_id uuid, p_motivo text, p_arquivo jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare pend inscricoes_pendentes%rowtype; v_arq uuid; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not exp_pode_decidir_inscricao() then raise exception 'Sem permissão para recusar inscrições.'; end if;
  if v_motivo = '' then raise exception 'Informe o motivo da recusa.'; end if;
  select * into pend from inscricoes_pendentes where id = p_id for update;
  if not found then raise exception 'Inscrição não encontrada.'; end if;
  if p_arquivo is not null and nullif(p_arquivo->>'storage_path', '') is not null then
    if (p_arquivo->>'storage_path') not like pend.expedicao_id::text || '/inscricoes/recusas/%' then
      raise exception 'Caminho de anexo inválido.';
    end if;
    insert into arquivos (expedicao_id, passageiro_id, categoria, nome, descricao, mime, tamanho_bytes, storage_path, uploaded_by)
    values (pend.expedicao_id, null, 'Outros', coalesce(nullif(p_arquivo->>'nome', ''), 'anexo'), 'Motivo da recusa — inscrição',
            p_arquivo->>'mime', nullif(p_arquivo->>'tamanho_bytes', '')::bigint, p_arquivo->>'storage_path',
            (select id from usuarios where id = auth.uid()))
    returning id into v_arq;
  end if;
  update inscricoes_pendentes
     set status = 'recusada', recusada_em = now(), motivo_recusa = v_motivo, recusa_arquivo_id = v_arq
   where id = p_id;
  perform exp__registrar_decisao(pend.expedicao_id, pend.cpf, pend.nome_completo, 'recusada', v_motivo);
end $$;

-- ── RESTAURAR (volta pra fila) ──────────────────────────────────────────────
create or replace function public.exp_inscricao_restaurar(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pend inscricoes_pendentes%rowtype;
begin
  if not exp_tem_acesso() or is_readonly() then raise exception 'Seu perfil é somente leitura.'; end if;
  update inscricoes_pendentes set status = 'pendente', recusada_em = null where id = p_id returning * into pend;
  if pend.id is null then raise exception 'Inscrição não encontrada.'; end if;
  perform exp__registrar_decisao(pend.expedicao_id, pend.cpf, pend.nome_completo, 'restaurada');
end $$;

-- ── EXCLUIR DEFINITIVO ──────────────────────────────────────────────────────
-- Apaga a pendência e as linhas de `arquivos` dela; devolve os caminhos no bucket
-- pro front remover do Storage (a policy de storage deixa quem edita apagar).
-- Arquivo ainda usado por algum passageiro/requisito NÃO é apagado.
create or replace function public.exp_inscricao_excluir(p_id uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare pend inscricoes_pendentes%rowtype; v_ids uuid[]; v_paths text[];
begin
  if not exp_tem_acesso() or is_readonly() then raise exception 'Seu perfil é somente leitura.'; end if;
  select * into pend from inscricoes_pendentes where id = p_id for update;
  if not found then raise exception 'Inscrição não encontrada.'; end if;
  v_ids := array_remove(array[pend.passaporte_arquivo_id, pend.foto_arquivo_id, pend.recusa_arquivo_id,
                              exp__uuid(pend.dados->'saude'->>'vacina_febre_amarela_arquivo_id')], null);
  select array_agg(a.id) into v_ids from arquivos a
   where a.id = any(v_ids)
     and not exists (select 1 from passageiros p where p.passaporte_arquivo_id = a.id or p.foto_arquivo_id = a.id)
     and not exists (select 1 from passageiro_requisitos pr where pr.arquivo_id = a.id)
     and not exists (select 1 from inscricoes_pendentes o where o.id <> p_id
                       and a.id in (o.passaporte_arquivo_id, o.foto_arquivo_id, o.recusa_arquivo_id));
  delete from inscricoes_pendentes where id = p_id;
  if v_ids is not null then
    with apagados as (delete from arquivos where id = any(v_ids) returning storage_path)
    select array_agg(storage_path) into v_paths from apagados;
  end if;
  perform exp__registrar_decisao(pend.expedicao_id, pend.cpf, pend.nome_completo, 'excluida');
  return coalesce(v_paths, '{}');
end $$;

-- ── Anexo da recusa: o Relacionamento (só leitura) também pode subir ─────────
create policy exp_inscricao_recusa_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivos-expedicoes' and name like '%/inscricoes/recusas/%' and exp_pode_decidir_inscricao());

revoke execute on function public.exp_pode_decidir_inscricao(), public.exp__nome_usuario(), public.exp__data(text), public.exp__uuid(text),
  public.exp__registrar_decisao(uuid, text, text, text, text), public.exp__espalhar_vacina(text, uuid),
  public.exp_inscricao_aprovar(uuid, jsonb), public.exp_inscricao_recusar(uuid, text, jsonb),
  public.exp_inscricao_restaurar(uuid), public.exp_inscricao_excluir(uuid) from public, anon;
-- os auxiliares (security definer que escrevem) só rodam por dentro das funções acima
revoke execute on function public.exp__nome_usuario(), public.exp__registrar_decisao(uuid, text, text, text, text),
  public.exp__espalhar_vacina(text, uuid) from authenticated;
grant execute on function public.exp_pode_decidir_inscricao(), public.exp_inscricao_aprovar(uuid, jsonb),
  public.exp_inscricao_recusar(uuid, text, jsonb), public.exp_inscricao_restaurar(uuid), public.exp_inscricao_excluir(uuid)
  to authenticated;
