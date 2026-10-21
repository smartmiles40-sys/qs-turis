
-- ===== parte 1 =====
alter table acesso_links add constraint acesso_links_pkey PRIMARY KEY (id);
alter table acesso_links add constraint acesso_links_codigo_key UNIQUE (codigo);
alter table acesso_senhas add constraint acesso_senhas_pkey PRIMARY KEY (cpf);
alter table arquivos add constraint arquivos_storage_path_key UNIQUE (storage_path);
alter table arquivos add constraint arquivos_pkey PRIMARY KEY (id);
alter table audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table cambios add constraint cambios_pkey PRIMARY KEY (moeda);
alter table cambios add constraint cambios_taxa_brl_check CHECK ((taxa_brl > (0)::numeric));
alter table checklist_itens add constraint checklist_itens_pkey PRIMARY KEY (id);
alter table compras_bitrix add constraint compras_bitrix_bitrix_deal_id_key UNIQUE (bitrix_deal_id);
alter table compras_bitrix add constraint compras_bitrix_pkey PRIMARY KEY (id);
alter table custos add constraint custos_pkey PRIMARY KEY (id);
alter table documentos add constraint documentos_pkey PRIMARY KEY (id);
alter table expedamigo_acessos add constraint expedamigo_acessos_evento_chk CHECK ((evento = ANY (ARRAY['login'::text, 'download_pdf'::text, 'viagem_aberta'::text, 'download_voucher'::text, 'primeiro_acesso'::text])));
alter table expedamigo_acessos add constraint expedamigo_acessos_pkey PRIMARY KEY (id);
alter table expedicao_avisos add constraint expedicao_avisos_pkey PRIMARY KEY (id);
alter table expedicao_info add constraint expedicao_info_pkey PRIMARY KEY (id);
alter table expedicao_passeios add constraint expedicao_passeios_pkey PRIMARY KEY (id);
alter table expedicao_voos add constraint expedicao_voos_pkey PRIMARY KEY (id);
alter table expedicoes add constraint expedicoes_check CHECK ((data_retorno >= data_embarque));
alter table expedicoes add constraint expedicoes_codigo_key UNIQUE (codigo);
alter table expedicoes add constraint expedicoes_pkey PRIMARY KEY (id);
alter table expedicoes add constraint expedicoes_tipo_chk CHECK ((tipo = ANY (ARRAY['expedicao'::text, 'pacote'::text])));
alter table extensoes add constraint extensoes_pkey PRIMARY KEY (id);
alter table fornecedores add constraint fornecedores_pkey PRIMARY KEY (id);
alter table grupos_expedicao add constraint grupos_expedicao_expedicao_id_nome_key UNIQUE (expedicao_id, nome);
alter table grupos_expedicao add constraint grupos_expedicao_pkey PRIMARY KEY (id);
alter table grupos_expedicao add constraint grupos_expedicao_check CHECK (((data_retorno IS NULL) OR (data_embarque IS NULL) OR (data_retorno >= data_embarque)));
alter table inscricoes_decisoes add constraint inscricoes_decisoes_acao_check CHECK ((acao = ANY (ARRAY['aprovada'::text, 'recusada'::text, 'restaurada'::text, 'excluida'::text])));
alter table inscricoes_decisoes add constraint inscricoes_decisoes_pkey PRIMARY KEY (id);
alter table inscricoes_pendentes add constraint inscricoes_pendentes_expedicao_id_cpf_key UNIQUE (expedicao_id, cpf);
alter table inscricoes_pendentes add constraint inscricoes_pendentes_status_chk CHECK ((status = ANY (ARRAY['pendente'::text, 'recusada'::text])));
alter table inscricoes_pendentes add constraint inscricoes_pendentes_pkey PRIMARY KEY (id);
alter table links_expedicao add constraint links_expedicao_pkey PRIMARY KEY (id);
alter table pagamentos add constraint pagamentos_pkey PRIMARY KEY (id);
alter table passageiro_extensao add constraint passageiro_extensao_passageiro_id_extensao_id_key UNIQUE (passageiro_id, extensao_id);
alter table passageiro_extensao add constraint passageiro_extensao_pkey PRIMARY KEY (id);
alter table passageiro_quarto add constraint passageiro_quarto_passageiro_id_quarto_id_key UNIQUE (passageiro_id, quarto_id);
alter table passageiro_quarto add constraint passageiro_quarto_pkey PRIMARY KEY (id);
alter table passageiro_requisitos add constraint passageiro_requisitos_passageiro_id_tipo_key UNIQUE (passageiro_id, tipo);
alter table passageiro_requisitos add constraint passageiro_requisitos_pkey PRIMARY KEY (id);
alter table passageiros add constraint passageiros_bitrix_deal_id_key UNIQUE (bitrix_deal_id);
alter table passageiros add constraint passageiros_pkey PRIMARY KEY (id);
alter table passeio_opcional_compras add constraint passeio_opcional_compras_pkey PRIMARY KEY (id);
alter table passeio_opcional_compras add constraint passeio_opcional_compras_passageiro_id_passeio_opcional_id_key UNIQUE (passageiro_id, passeio_opcional_id);
alter table passeios_opcionais add constraint passeios_opcionais_pkey PRIMARY KEY (id);
alter table quartos add constraint quartos_pkey PRIMARY KEY (id);
alter table requisitos_destino add constraint requisitos_destino_destino_tipo_key UNIQUE (destino, tipo);
alter table requisitos_destino add constraint requisitos_destino_pkey PRIMARY KEY (id);
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_pkey PRIMARY KEY (id);
alter table roteiro_dias add constraint roteiro_dias_pkey PRIMARY KEY (id);
alter table roteiro_lider_dias add constraint roteiro_lider_dias_pkey PRIMARY KEY (id);
alter table usuarios add constraint usuarios_email_key UNIQUE (email);
alter table usuarios add constraint usuarios_pkey PRIMARY KEY (id);

-- ===== parte 2 =====
alter table acesso_links add constraint acesso_links_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table arquivos add constraint arquivos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table arquivos add constraint arquivos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table arquivos add constraint arquivos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table audit_log add constraint audit_log_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table checklist_itens add constraint checklist_itens_dependencia_id_fkey FOREIGN KEY (dependencia_id) REFERENCES checklist_itens(id) ON DELETE SET NULL;
alter table checklist_itens add constraint checklist_itens_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table checklist_itens add constraint checklist_itens_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES checklist_itens(id) ON DELETE CASCADE;
alter table checklist_itens add constraint checklist_itens_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table custos add constraint custos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table custos add constraint custos_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;
alter table custos add constraint custos_pago_por_fkey FOREIGN KEY (pago_por) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table documentos add constraint documentos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table expedamigo_acessos add constraint expedamigo_acessos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE SET NULL;
alter table expedicao_avisos add constraint expedicao_avisos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_info add constraint expedicao_info_arquivo_id_2_fkey FOREIGN KEY (arquivo_id_2) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_info add constraint expedicao_info_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_info add constraint expedicao_info_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_passeios add constraint expedicao_passeios_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_passeios add constraint expedicao_passeios_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_voos add constraint expedicao_voos_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_voos add constraint expedicao_voos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_voos add constraint expedicao_voos_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE SET NULL;
alter table expedicao_voos add constraint expedicao_voos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos_expedicao(id) ON DELETE SET NULL;
alter table expedicao_voos add constraint expedicao_voos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table expedicoes add constraint expedicoes_dmc_principal_id_fkey FOREIGN KEY (dmc_principal_id) REFERENCES fornecedores(id) ON DELETE SET NULL;
alter table expedicoes add constraint expedicoes_hospedagem_voucher_arquivo_id_fkey FOREIGN KEY (hospedagem_voucher_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicoes add constraint expedicoes_responsavel_comercial_id_fkey FOREIGN KEY (responsavel_comercial_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table expedicoes add constraint expedicoes_responsavel_operacional_id_fkey FOREIGN KEY (responsavel_operacional_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table extensoes add constraint extensoes_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table extensoes add constraint extensoes_hospedagem_voucher_arquivo_id_fkey FOREIGN KEY (hospedagem_voucher_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table grupos_expedicao add constraint grupos_expedicao_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table inscricoes_decisoes add constraint inscricoes_decisoes_decidido_por_fkey FOREIGN KEY (decidido_por) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table inscricoes_decisoes add constraint inscricoes_decisoes_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE SET NULL;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_foto_arquivo_id_fkey FOREIGN KEY (foto_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_passaporte_arquivo_id_fkey FOREIGN KEY (passaporte_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_recusa_arquivo_id_fkey FOREIGN KEY (recusa_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table links_expedicao add constraint links_expedicao_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table pagamentos add constraint pagamentos_custo_id_fkey FOREIGN KEY (custo_id) REFERENCES custos(id) ON DELETE CASCADE;
alter table pagamentos add constraint pagamentos_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;
alter table passageiro_extensao add constraint passageiro_extensao_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE CASCADE;
alter table passageiro_extensao add constraint passageiro_extensao_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passageiro_quarto add constraint passageiro_quarto_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passageiro_quarto add constraint passageiro_quarto_quarto_id_fkey FOREIGN KEY (quarto_id) REFERENCES quartos(id) ON DELETE CASCADE;
alter table passageiro_requisitos add constraint passageiro_requisitos_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passageiro_requisitos add constraint passageiro_requisitos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passageiro_requisitos add constraint passageiro_requisitos_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table passageiro_requisitos add constraint passageiro_requisitos_verificado_por_fkey FOREIGN KEY (verificado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table passageiros add constraint passageiros_foto_arquivo_id_fkey FOREIGN KEY (foto_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos_expedicao(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_passaporte_arquivo_id_fkey FOREIGN KEY (passaporte_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_quarto_id_fkey FOREIGN KEY (quarto_id) REFERENCES quartos(id) ON DELETE SET NULL;
alter table passeio_opcional_compras add constraint passeio_opcional_compras_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passeio_opcional_compras add constraint passeio_opcional_compras_passeio_opcional_id_fkey FOREIGN KEY (passeio_opcional_id) REFERENCES passeios_opcionais(id) ON DELETE CASCADE;
alter table passeios_opcionais add constraint passeios_opcionais_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table passeios_opcionais add constraint passeios_opcionais_foto_arquivo_id_fkey FOREIGN KEY (foto_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passeios_opcionais add constraint passeios_opcionais_roteiro_dia_id_fkey FOREIGN KEY (roteiro_dia_id) REFERENCES roteiro_dias(id) ON DELETE CASCADE;
alter table quartos add constraint quartos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table quartos add constraint quartos_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE SET NULL;
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE CASCADE;
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_roteiro_dia_id_fkey FOREIGN KEY (roteiro_dia_id) REFERENCES roteiro_dias(id) ON DELETE CASCADE;
alter table roteiro_dias add constraint roteiro_dias_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table roteiro_dias add constraint roteiro_dias_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE SET NULL;
alter table roteiro_lider_dias add constraint roteiro_lider_dias_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table usuarios add constraint usuarios_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ===== parte 3 =====
CREATE INDEX idx_acesso_links_codigo ON public.acesso_links USING btree (codigo);
CREATE INDEX idx_arquivos_categoria ON public.arquivos USING btree (categoria);
CREATE INDEX idx_arquivos_expedicao ON public.arquivos USING btree (expedicao_id);
CREATE INDEX idx_arquivos_passageiro ON public.arquivos USING btree (passageiro_id);
CREATE INDEX idx_audit_created_at ON public.audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_tabela_registro ON public.audit_log USING btree (tabela, registro_id);
CREATE INDEX idx_checklist_etapa ON public.checklist_itens USING btree (expedicao_id, etapa, ordem);
CREATE INDEX idx_checklist_expedicao ON public.checklist_itens USING btree (expedicao_id);
CREATE INDEX idx_checklist_parent ON public.checklist_itens USING btree (parent_id);
CREATE INDEX idx_checklist_status ON public.checklist_itens USING btree (status);
CREATE INDEX idx_compras_bitrix_contact ON public.compras_bitrix USING btree (bitrix_contact_id);
CREATE INDEX idx_compras_bitrix_cpf ON public.compras_bitrix USING btree (cpf);
CREATE INDEX idx_compras_bitrix_data ON public.compras_bitrix USING btree (data_compra DESC);
CREATE INDEX idx_custos_categoria ON public.custos USING btree (categoria);
CREATE INDEX idx_custos_expedicao ON public.custos USING btree (expedicao_id);
CREATE INDEX idx_custos_status ON public.custos USING btree (status);
CREATE INDEX idx_documentos_passageiro ON public.documentos USING btree (passageiro_id);
CREATE INDEX idx_expedamigo_acessos_cpf ON public.expedamigo_acessos USING btree (cpf);
CREATE INDEX idx_expedamigo_acessos_criado ON public.expedamigo_acessos USING btree (created_at DESC);
CREATE INDEX idx_expedicao_avisos_exp ON public.expedicao_avisos USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_info_exp ON public.expedicao_info USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_passeios_exp ON public.expedicao_passeios USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_voos_exp ON public.expedicao_voos USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_voos_extensao ON public.expedicao_voos USING btree (extensao_id);
CREATE INDEX idx_expedicao_voos_grupo ON public.expedicao_voos USING btree (grupo_id);
CREATE INDEX idx_expedicao_voos_passageiro ON public.expedicao_voos USING btree (passageiro_id);
CREATE INDEX idx_expedicoes_data_embarque ON public.expedicoes USING btree (data_embarque);
CREATE INDEX idx_expedicoes_destino ON public.expedicoes USING btree (destino);
CREATE INDEX idx_expedicoes_ordem ON public.expedicoes USING btree (ordem);
CREATE INDEX idx_expedicoes_status ON public.expedicoes USING btree (status);
CREATE INDEX idx_expedicoes_tipo ON public.expedicoes USING btree (tipo);
CREATE INDEX idx_extensoes_exp ON public.extensoes USING btree (expedicao_id, ordem);
CREATE INDEX idx_fornecedores_status ON public.fornecedores USING btree (status);
CREATE INDEX idx_fornecedores_tipo ON public.fornecedores USING btree (tipo);
CREATE INDEX idx_grupos_expedicao_id ON public.grupos_expedicao USING btree (expedicao_id);
CREATE INDEX idx_insc_decisoes_created ON public.inscricoes_decisoes USING btree (created_at DESC);
CREATE INDEX idx_inscricoes_pendentes_status ON public.inscricoes_pendentes USING btree (status);
CREATE INDEX idx_links_expedicao ON public.links_expedicao USING btree (expedicao_id);
CREATE INDEX idx_links_expedicao_ordem ON public.links_expedicao USING btree (expedicao_id, ordem);
CREATE INDEX idx_pagamentos_custo ON public.pagamentos USING btree (custo_id);
CREATE INDEX idx_pagamentos_status ON public.pagamentos USING btree (status);
CREATE INDEX idx_pagamentos_vencimento ON public.pagamentos USING btree (vencimento_saldo);
CREATE INDEX idx_passageiros_avulsos ON public.passageiros USING btree (id) WHERE (expedicao_id IS NULL);
CREATE INDEX idx_passageiros_bitrix_deal ON public.passageiros USING btree (bitrix_deal_id);
CREATE INDEX idx_passageiros_conexao_viagem ON public.passageiros USING btree (conexao_viagem_id);
CREATE INDEX idx_passageiros_expedicao ON public.passageiros USING btree (expedicao_id);
CREATE INDEX idx_passageiros_grupo ON public.passageiros USING btree (grupo_id);
CREATE INDEX idx_passageiros_pendente ON public.passageiros USING btree (pendente_aprovacao) WHERE pendente_aprovacao;
CREATE INDEX idx_passageiros_status ON public.passageiros USING btree (status_reserva);
CREATE INDEX idx_passeio_compras_passeio ON public.passeio_opcional_compras USING btree (passeio_opcional_id);
CREATE INDEX idx_passeio_compras_pax ON public.passeio_opcional_compras USING btree (passageiro_id);
CREATE INDEX idx_passeios_opcionais_dia ON public.passeios_opcionais USING btree (roteiro_dia_id, ordem);
CREATE INDEX idx_passeios_opcionais_exp ON public.passeios_opcionais USING btree (expedicao_id, ordem);
CREATE INDEX idx_pax_extensao_ext ON public.passageiro_extensao USING btree (extensao_id);
CREATE INDEX idx_pax_extensao_pax ON public.passageiro_extensao USING btree (passageiro_id);
CREATE INDEX idx_pq_passageiro ON public.passageiro_quarto USING btree (passageiro_id);
CREATE INDEX idx_pq_quarto ON public.passageiro_quarto USING btree (quarto_id);
CREATE INDEX idx_preq_passageiro ON public.passageiro_requisitos USING btree (passageiro_id);
CREATE INDEX idx_preq_status ON public.passageiro_requisitos USING btree (status);
CREATE INDEX idx_preq_tipo ON public.passageiro_requisitos USING btree (tipo);
CREATE INDEX idx_quartos_expedicao ON public.quartos USING btree (expedicao_id);
CREATE INDEX idx_quartos_extensao ON public.quartos USING btree (extensao_id);
CREATE INDEX idx_requisitos_destino_destino ON public.requisitos_destino USING btree (destino);
CREATE INDEX idx_roteiro_dia_fotos_dia ON public.roteiro_dia_fotos USING btree (roteiro_dia_id, ordem);
CREATE INDEX idx_roteiro_dia_fotos_exp ON public.roteiro_dia_fotos USING btree (expedicao_id);
CREATE INDEX idx_roteiro_dias_exp ON public.roteiro_dias USING btree (expedicao_id, ordem);
CREATE INDEX idx_roteiro_dias_extensao ON public.roteiro_dias USING btree (extensao_id);
CREATE INDEX idx_roteiro_lider_dias_exp ON public.roteiro_lider_dias USING btree (expedicao_id, ordem);
CREATE UNIQUE INDEX ux_passageiros_avulso_cpf ON public.passageiros USING btree (regexp_replace(cpf, '\D'::text, ''::text, 'g'::text)) WHERE ((cpf IS NOT NULL) AND (expedicao_id IS NULL));
CREATE UNIQUE INDEX ux_passageiros_expedicao_cpf ON public.passageiros USING btree (expedicao_id, regexp_replace(cpf, '\D'::text, ''::text, 'g'::text)) WHERE ((cpf IS NOT NULL) AND (expedicao_id IS NOT NULL));

-- ===== parte 4 =====
CREATE OR REPLACE FUNCTION public.audit_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_user uuid;
begin
  begin
    v_user := auth.uid();
  exception when others then
    v_user := null;
  end;

  if (tg_op = 'INSERT') then
    insert into audit_log(tabela, registro_id, usuario_id, acao, dados_depois)
      values (tg_table_name, new.id, v_user, 'insert', to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into audit_log(tabela, registro_id, usuario_id, acao, dados_antes, dados_depois)
      values (tg_table_name, new.id, v_user, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'DELETE') then
    insert into audit_log(tabela, registro_id, usuario_id, acao, dados_antes)
      values (tg_table_name, old.id, v_user, 'delete', to_jsonb(old));
    return old;
  end if;
  return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.is_readonly()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select papel::text in ('relacionamento','leitura')
       from public.usuarios where id = auth.uid()),
    false
  );
$function$
;
CREATE OR REPLACE FUNCTION public.prontidao_marcar_vencidos()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  n integer;
begin
  with alvo as (
    select pr.id
    from passageiro_requisitos pr
    join passageiros p on p.id = pr.passageiro_id
    join expedicoes  e on e.id = p.expedicao_id
    where pr.validade is not null
      and pr.validade < e.data_retorno
      and pr.status not in ('Vencido', 'Dispensado', 'Reprovado')
  )
  update passageiro_requisitos
     set status = 'Vencido', updated_at = now()
   where id in (select id from alvo);
  get diagnostics n = row_count;
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;

-- ===== parte 5 =====
create or replace view vw_prontidao_passageiro with (security_invoker=false) as  WITH req AS (
         SELECT pr.passageiro_id,
            count(*) FILTER (WHERE (pr.bloqueia_embarque AND (NOT ((pr.status = ANY (ARRAY['Aprovado'::status_requisito, 'Dispensado'::status_requisito])) AND ((pr.validade IS NULL) OR (pr.validade >= e_1.data_retorno)))))) AS bloqueios_abertos,
            count(*) FILTER (WHERE ((NOT pr.bloqueia_embarque) AND (pr.status <> ALL (ARRAY['Aprovado'::status_requisito, 'Dispensado'::status_requisito])))) AS pendencias_leves,
            count(*) FILTER (WHERE ((pr.tipo = 'Passaporte'::tipo_requisito) AND (pr.validade IS NOT NULL) AND (pr.validade >= e_1.data_retorno) AND (pr.validade < (e_1.data_retorno + '6 mons'::interval)))) AS passaporte_em_alerta
           FROM ((passageiro_requisitos pr
             JOIN passageiros p_1 ON ((p_1.id = pr.passageiro_id)))
             JOIN expedicoes e_1 ON ((e_1.id = p_1.expedicao_id)))
          GROUP BY pr.passageiro_id
        )
 SELECT p.id AS passageiro_id,
    p.expedicao_id,
    p.nome_completo,
    e.data_embarque,
    e.data_retorno,
    (e.data_embarque - CURRENT_DATE) AS dias_ate_embarque,
    COALESCE(r.bloqueios_abertos, (0)::bigint) AS bloqueios_abertos,
    COALESCE(r.pendencias_leves, (0)::bigint) AS pendencias_leves,
    COALESCE(r.passaporte_em_alerta, (0)::bigint) AS passaporte_em_alerta,
    (p.saldo_brl > (0)::numeric) AS tem_saldo,
        CASE
            WHEN (COALESCE(r.bloqueios_abertos, (0)::bigint) > 0) THEN 'Bloqueado'::text
            WHEN ((p.saldo_brl > (0)::numeric) AND ((e.data_embarque - CURRENT_DATE) <= 15)) THEN 'Bloqueado'::text
            WHEN ((COALESCE(r.passaporte_em_alerta, (0)::bigint) > 0) OR (COALESCE(r.pendencias_leves, (0)::bigint) > 0) OR (p.saldo_brl > (0)::numeric)) THEN 'Atenção'::text
            ELSE 'Apto'::text
        END AS prontidao
   FROM ((passageiros p
     JOIN expedicoes e ON ((e.id = p.expedicao_id)))
     LEFT JOIN req r ON ((r.passageiro_id = p.id)));

-- ===== parte 6 =====
CREATE TRIGGER tg_acesso_senhas_updated_at BEFORE UPDATE ON public.acesso_senhas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_arquivos_updated_at BEFORE UPDATE ON public.arquivos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_checklist_itens_updated_at BEFORE UPDATE ON public.checklist_itens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_compras_bitrix_updated_at BEFORE UPDATE ON public.compras_bitrix FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_custos_audit AFTER INSERT OR DELETE OR UPDATE ON public.custos FOR EACH ROW EXECUTE FUNCTION audit_change();
CREATE TRIGGER trg_custos_updated_at BEFORE UPDATE ON public.custos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_documentos_updated_at BEFORE UPDATE ON public.documentos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_expedicao_avisos_updated_at BEFORE UPDATE ON public.expedicao_avisos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_expedicao_info_updated_at BEFORE UPDATE ON public.expedicao_info FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_expedicao_passeios_updated_at BEFORE UPDATE ON public.expedicao_passeios FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_expedicao_voos_updated_at BEFORE UPDATE ON public.expedicao_voos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_expedicoes_audit AFTER INSERT OR DELETE OR UPDATE ON public.expedicoes FOR EACH ROW EXECUTE FUNCTION audit_change();
CREATE TRIGGER trg_expedicoes_updated_at BEFORE UPDATE ON public.expedicoes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_extensoes_updated_at BEFORE UPDATE ON public.extensoes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fornecedores_updated_at BEFORE UPDATE ON public.fornecedores FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_grupos_expedicao_updated_at BEFORE UPDATE ON public.grupos_expedicao FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_inscricoes_pendentes_updated_at BEFORE UPDATE ON public.inscricoes_pendentes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_links_expedicao_updated_at BEFORE UPDATE ON public.links_expedicao FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pagamentos_audit AFTER INSERT OR DELETE OR UPDATE ON public.pagamentos FOR EACH ROW EXECUTE FUNCTION audit_change();
CREATE TRIGGER trg_pagamentos_updated_at BEFORE UPDATE ON public.pagamentos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_passageiro_requisitos_audit AFTER INSERT OR DELETE OR UPDATE ON public.passageiro_requisitos FOR EACH ROW EXECUTE FUNCTION audit_change();
CREATE TRIGGER trg_passageiro_requisitos_updated_at BEFORE UPDATE ON public.passageiro_requisitos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_passageiros_audit AFTER INSERT OR DELETE OR UPDATE ON public.passageiros FOR EACH ROW EXECUTE FUNCTION audit_change();
CREATE TRIGGER trg_passageiros_updated_at BEFORE UPDATE ON public.passageiros FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_passeios_opcionais_updated_at BEFORE UPDATE ON public.passeios_opcionais FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_quartos_updated_at BEFORE UPDATE ON public.quartos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_requisitos_destino_updated_at BEFORE UPDATE ON public.requisitos_destino FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_roteiro_dia_fotos_updated_at BEFORE UPDATE ON public.roteiro_dia_fotos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_roteiro_dias_updated_at BEFORE UPDATE ON public.roteiro_dias FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tg_roteiro_lider_dias_updated_at BEFORE UPDATE ON public.roteiro_lider_dias FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== parte 7 =====
alter table acesso_links enable row level security;
alter table acesso_senhas enable row level security;
alter table arquivos enable row level security;
alter table audit_log enable row level security;
alter table cambios enable row level security;
alter table checklist_itens enable row level security;
alter table compras_bitrix enable row level security;
alter table custos enable row level security;
alter table documentos enable row level security;
alter table expedamigo_acessos enable row level security;
alter table expedicao_avisos enable row level security;
alter table expedicao_info enable row level security;
alter table expedicao_passeios enable row level security;
alter table expedicao_voos enable row level security;
alter table expedicoes enable row level security;
alter table extensoes enable row level security;
alter table fornecedores enable row level security;
alter table grupos_expedicao enable row level security;
alter table inscricoes_decisoes enable row level security;
alter table inscricoes_pendentes enable row level security;
alter table links_expedicao enable row level security;
alter table pagamentos enable row level security;
alter table passageiro_extensao enable row level security;
alter table passageiro_quarto enable row level security;
alter table passageiro_requisitos enable row level security;
alter table passageiros enable row level security;
alter table passeio_opcional_compras enable row level security;
alter table passeios_opcionais enable row level security;
alter table quartos enable row level security;
alter table requisitos_destino enable row level security;
alter table roteiro_dia_fotos enable row level security;
alter table roteiro_dias enable row level security;
alter table roteiro_lider_dias enable row level security;
alter table usuarios enable row level security;

-- ===== parte 8 =====
create policy "arquivos: escrita autenticado" on arquivos as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "arquivos: leitura autenticado" on arquivos as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on arquivos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on arquivos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on arquivos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on audit_log as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on audit_log as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on audit_log as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on audit_log as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy auth_all_delete on cambios as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on cambios as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on cambios as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on cambios as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on cambios as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on cambios as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on cambios as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on checklist_itens as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on checklist_itens as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on checklist_itens as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on checklist_itens as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on checklist_itens as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on checklist_itens as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on checklist_itens as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "compras_bitrix: leitura autenticado" on compras_bitrix as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_delete on custos as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on custos as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on custos as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on custos as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on custos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on custos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on custos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on documentos as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on documentos as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on documentos as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on documentos as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on documentos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on documentos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on documentos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "expedamigo_acessos: escrita autenticado" on expedamigo_acessos as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "expedamigo_acessos: leitura autenticado" on expedamigo_acessos as PERMISSIVE for SELECT to authenticated using (true);
create policy "expedicao_avisos: escrita autenticado" on expedicao_avisos as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "expedicao_avisos: leitura autenticado" on expedicao_avisos as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on expedicao_avisos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on expedicao_avisos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on expedicao_avisos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "expedicao_info: escrita autenticado" on expedicao_info as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "expedicao_info: leitura autenticado" on expedicao_info as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on expedicao_info as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on expedicao_info as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on expedicao_info as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "expedicao_passeios: escrita autenticado" on expedicao_passeios as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "expedicao_passeios: leitura autenticado" on expedicao_passeios as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on expedicao_passeios as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on expedicao_passeios as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on expedicao_passeios as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "expedicao_voos: escrita autenticado" on expedicao_voos as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "expedicao_voos: leitura autenticado" on expedicao_voos as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on expedicao_voos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on expedicao_voos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on expedicao_voos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on expedicoes as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on expedicoes as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on expedicoes as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on expedicoes as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on expedicoes as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on expedicoes as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on expedicoes as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "extensoes: escrita autenticado" on extensoes as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "extensoes: leitura autenticado" on extensoes as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_delete on fornecedores as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on fornecedores as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on fornecedores as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on fornecedores as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on fornecedores as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on fornecedores as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on fornecedores as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "grupos: escrita autenticado" on grupos_expedicao as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "grupos: leitura autenticado" on grupos_expedicao as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on grupos_expedicao as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on grupos_expedicao as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on grupos_expedicao as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "insc_decisoes: leitura autenticado" on inscricoes_decisoes as PERMISSIVE for SELECT to authenticated using (true);
create policy "inscricoes_pendentes: escrita autenticado" on inscricoes_pendentes as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "inscricoes_pendentes: leitura autenticado" on inscricoes_pendentes as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on inscricoes_pendentes as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on inscricoes_pendentes as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on inscricoes_pendentes as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "links_expedicao: escrita autenticado" on links_expedicao as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "links_expedicao: leitura autenticado" on links_expedicao as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on links_expedicao as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on links_expedicao as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on links_expedicao as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on pagamentos as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on pagamentos as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on pagamentos as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on pagamentos as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on pagamentos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on pagamentos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on pagamentos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "passageiro_extensao: escrita autenticado" on passageiro_extensao as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "passageiro_extensao: leitura autenticado" on passageiro_extensao as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_delete on passageiro_quarto as PERMISSIVE for DELETE to anon,authenticated using (true);
create policy auth_all_insert on passageiro_quarto as PERMISSIVE for INSERT to anon,authenticated with check (true);
create policy auth_all_select on passageiro_quarto as PERMISSIVE for SELECT to anon,authenticated using (true);
create policy ro_block_delete on passageiro_quarto as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on passageiro_quarto as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on passageiro_quarto as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on passageiro_requisitos as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on passageiro_requisitos as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on passageiro_requisitos as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on passageiro_requisitos as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on passageiro_requisitos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on passageiro_requisitos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on passageiro_requisitos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on passageiros as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on passageiros as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on passageiros as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on passageiros as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on passageiros as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on passageiros as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on passageiros as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "passeio_opcional_compras: escrita autenticado" on passeio_opcional_compras as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "passeio_opcional_compras: leitura autenticado" on passeio_opcional_compras as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on passeio_opcional_compras as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on passeio_opcional_compras as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on passeio_opcional_compras as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "passeios_opcionais: escrita autenticado" on passeios_opcionais as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "passeios_opcionais: leitura autenticado" on passeios_opcionais as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on passeios_opcionais as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on passeios_opcionais as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on passeios_opcionais as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on quartos as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on quartos as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on quartos as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on quartos as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on quartos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on quartos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on quartos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy auth_all_delete on requisitos_destino as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on requisitos_destino as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on requisitos_destino as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on requisitos_destino as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy ro_block_delete on requisitos_destino as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on requisitos_destino as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on requisitos_destino as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy ro_block_delete on roteiro_dia_fotos as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on roteiro_dia_fotos as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on roteiro_dia_fotos as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "roteiro_dia_fotos: escrita autenticado" on roteiro_dia_fotos as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "roteiro_dia_fotos: leitura autenticado" on roteiro_dia_fotos as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on roteiro_dias as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on roteiro_dias as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on roteiro_dias as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "roteiro_dias: escrita autenticado" on roteiro_dias as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "roteiro_dias: leitura autenticado" on roteiro_dias as PERMISSIVE for SELECT to authenticated using (true);
create policy ro_block_delete on roteiro_lider_dias as RESTRICTIVE for DELETE to authenticated using ((NOT is_readonly()));
create policy ro_block_insert on roteiro_lider_dias as RESTRICTIVE for INSERT to authenticated with check ((NOT is_readonly()));
create policy ro_block_update on roteiro_lider_dias as RESTRICTIVE for UPDATE to authenticated using ((NOT is_readonly())) with check ((NOT is_readonly()));
create policy "roteiro_lider_dias: escrita autenticado" on roteiro_lider_dias as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "roteiro_lider_dias: leitura autenticado" on roteiro_lider_dias as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_delete on usuarios as PERMISSIVE for DELETE to authenticated using (true);
create policy auth_all_insert on usuarios as PERMISSIVE for INSERT to authenticated with check (true);
create policy auth_all_select on usuarios as PERMISSIVE for SELECT to authenticated using (true);
create policy auth_all_update on usuarios as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

-- ===== parte 9 =====
-- realtime: arquivos
-- realtime: cambios
-- realtime: checklist_itens
-- realtime: custos
-- realtime: documentos
-- realtime: expedicoes
-- realtime: fornecedores
-- realtime: grupos_expedicao
-- realtime: links_expedicao
-- realtime: pagamentos
-- realtime: passageiro_requisitos
-- realtime: passageiros
-- realtime: quartos
-- realtime: requisitos_destino
-- realtime: usuarios

-- ===== parte 11 =====
-- bucket arquivos-expedicoes public=f limit=52428800 mimes=
-- bucket pasta_public public=t limit= mimes=
