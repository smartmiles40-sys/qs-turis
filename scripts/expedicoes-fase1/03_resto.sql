-- Fase 1 · parte D: funções, view, gatilhos, permissões (RLS), realtime e buckets.
--
-- Diferença pro sistema antigo (lá qualquer login via tudo): aqui no QS o banco é
-- compartilhado com SDRs/closers, então só enxerga Expedições quem
--   · tem linha em `usuarios` (os usuários do app antigo), ou
--   · no QS é admin, Operações, Relacionamento ou Financeiro.
-- Só leitura (is_readonly): papel leitura/relacionamento no app antigo; no QS,
-- quem não está em `usuarios` e não é Operações/Financeiro/admin (ex.: Relacionamento).

-- ── funções ──────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function audit_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  begin v_user := auth.uid(); exception when others then v_user := null; end;
  -- usuario_id tem FK pra usuarios: quem é só do QS (sem linha em usuarios) fica nulo.
  if v_user is not null and not exists (select 1 from usuarios where id = v_user) then v_user := null; end if;
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
end $$;

create or replace function exp_tem_acesso() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = auth.uid())
      or qs_do_setor('operacional') or qs_do_setor('relacionamento') or qs_do_setor('financeiro');
$$;

create or replace function exp_eh_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = auth.uid() and papel = 'admin')
      or exists (select 1 from qs_users where id = auth.uid() and is_active and role = 'admin');
$$;

create or replace function is_readonly() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select papel::text in ('relacionamento', 'leitura') from usuarios where id = auth.uid()),
    not (qs_do_setor('operacional') or qs_do_setor('financeiro'))
  );
$$;

create or replace function prontidao_marcar_vencidos() returns integer language plpgsql set search_path = public as $$
declare n integer;
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
end $$;

revoke execute on function audit_change(), exp_tem_acesso(), exp_eh_admin(), is_readonly(), prontidao_marcar_vencidos() from public, anon;
grant execute on function exp_tem_acesso(), exp_eh_admin(), is_readonly() to authenticated;
grant execute on function prontidao_marcar_vencidos() to authenticated, service_role;

-- ── view (agora security_invoker: respeita o RLS de quem consulta) ──────────
create or replace view vw_prontidao_passageiro with (security_invoker = true) as
WITH req AS (
  SELECT pr.passageiro_id,
    count(*) FILTER (WHERE (pr.bloqueia_embarque AND (NOT ((pr.status = ANY (ARRAY['Aprovado'::status_requisito, 'Dispensado'::status_requisito])) AND ((pr.validade IS NULL) OR (pr.validade >= e_1.data_retorno)))))) AS bloqueios_abertos,
    count(*) FILTER (WHERE ((NOT pr.bloqueia_embarque) AND (pr.status <> ALL (ARRAY['Aprovado'::status_requisito, 'Dispensado'::status_requisito])))) AS pendencias_leves,
    count(*) FILTER (WHERE ((pr.tipo = 'Passaporte'::tipo_requisito) AND (pr.validade IS NOT NULL) AND (pr.validade >= e_1.data_retorno) AND (pr.validade < (e_1.data_retorno + '6 mons'::interval)))) AS passaporte_em_alerta
  FROM passageiro_requisitos pr
  JOIN passageiros p_1 ON p_1.id = pr.passageiro_id
  JOIN expedicoes e_1 ON e_1.id = p_1.expedicao_id
  GROUP BY pr.passageiro_id
)
SELECT p.id AS passageiro_id,
  p.expedicao_id,
  p.nome_completo,
  e.data_embarque,
  e.data_retorno,
  (e.data_embarque - CURRENT_DATE) AS dias_ate_embarque,
  COALESCE(r.bloqueios_abertos, 0::bigint) AS bloqueios_abertos,
  COALESCE(r.pendencias_leves, 0::bigint) AS pendencias_leves,
  COALESCE(r.passaporte_em_alerta, 0::bigint) AS passaporte_em_alerta,
  (p.saldo_brl > 0::numeric) AS tem_saldo,
  CASE
    WHEN COALESCE(r.bloqueios_abertos, 0::bigint) > 0 THEN 'Bloqueado'::text
    WHEN (p.saldo_brl > 0::numeric) AND ((e.data_embarque - CURRENT_DATE) <= 15) THEN 'Bloqueado'::text
    WHEN (COALESCE(r.passaporte_em_alerta, 0::bigint) > 0) OR (COALESCE(r.pendencias_leves, 0::bigint) > 0) OR (p.saldo_brl > 0::numeric) THEN 'Atenção'::text
    ELSE 'Apto'::text
  END AS prontidao
FROM passageiros p
JOIN expedicoes e ON e.id = p.expedicao_id
LEFT JOIN req r ON r.passageiro_id = p.id;
revoke all on vw_prontidao_passageiro from anon;

-- ── índices ──────────────────────────────────────────────────────────────────
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

-- ── gatilhos (updated_at + auditoria) ───────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['acesso_senhas','arquivos','checklist_itens','compras_bitrix','custos','documentos','expedicao_avisos','expedicao_info','expedicao_passeios','expedicao_voos','expedicoes','extensoes','fornecedores','grupos_expedicao','inscricoes_pendentes','links_expedicao','pagamentos','passageiro_requisitos','passageiros','passeios_opcionais','quartos','requisitos_destino','roteiro_dia_fotos','roteiro_dias','roteiro_lider_dias','usuarios'] loop
    execute format('create trigger tg_%s_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
  foreach t in array array['custos','expedicoes','pagamentos','passageiro_requisitos','passageiros'] loop
    execute format('create trigger trg_%s_audit after insert or update or delete on %I for each row execute function audit_change()', t, t);
  end loop;
end $$;

-- ── permissões ───────────────────────────────────────────────────────────────
create policy exp_ler on arquivos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on arquivos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on arquivos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on arquivos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on arquivos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on cambios for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on cambios for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on cambios as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on cambios as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on cambios as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on checklist_itens for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on checklist_itens for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on checklist_itens as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on checklist_itens as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on checklist_itens as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on custos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on custos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on custos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on custos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on custos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on documentos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on documentos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on documentos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on documentos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on documentos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedamigo_acessos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedamigo_acessos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedamigo_acessos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedamigo_acessos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedamigo_acessos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_avisos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_avisos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_avisos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_avisos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_avisos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_info for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_info for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_info as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_info as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_info as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_passeios for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_passeios for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_passeios as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_passeios as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_passeios as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_voos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_voos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_voos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_voos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_voos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicoes for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicoes for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicoes as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicoes as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicoes as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on extensoes for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on extensoes for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on extensoes as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on extensoes as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on extensoes as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on fornecedores for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on fornecedores for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on fornecedores as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on fornecedores as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on fornecedores as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on grupos_expedicao for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on grupos_expedicao for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on grupos_expedicao as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on grupos_expedicao as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on grupos_expedicao as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on inscricoes_pendentes for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on inscricoes_pendentes for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on inscricoes_pendentes as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on inscricoes_pendentes as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on inscricoes_pendentes as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on links_expedicao for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on links_expedicao for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on links_expedicao as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on links_expedicao as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on links_expedicao as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on pagamentos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on pagamentos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on pagamentos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on pagamentos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on pagamentos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiro_extensao for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiro_extensao for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiro_extensao as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiro_extensao as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiro_extensao as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiro_quarto for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiro_quarto for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiro_quarto as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiro_quarto as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiro_quarto as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiro_requisitos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiro_requisitos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiro_requisitos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiro_requisitos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiro_requisitos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiros for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiros for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiros as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiros as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiros as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passeio_opcional_compras for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passeio_opcional_compras for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passeio_opcional_compras as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passeio_opcional_compras as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passeio_opcional_compras as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passeios_opcionais for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passeios_opcionais for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passeios_opcionais as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passeios_opcionais as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passeios_opcionais as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on quartos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on quartos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on quartos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on quartos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on quartos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on requisitos_destino for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on requisitos_destino for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on requisitos_destino as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on requisitos_destino as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on requisitos_destino as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on roteiro_dia_fotos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on roteiro_dia_fotos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on roteiro_dia_fotos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on roteiro_dia_fotos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on roteiro_dia_fotos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on roteiro_dias for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on roteiro_dias for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on roteiro_dias as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on roteiro_dias as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on roteiro_dias as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on roteiro_lider_dias for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on roteiro_lider_dias for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on roteiro_lider_dias as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on roteiro_lider_dias as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on roteiro_lider_dias as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on compras_bitrix for select to authenticated using (exp_tem_acesso());
create policy exp_ler on inscricoes_decisoes for select to authenticated using (exp_tem_acesso());
create policy exp_ler on audit_log for select to authenticated using (exp_tem_acesso());
create policy exp_inserir on audit_log for insert to authenticated with check (exp_tem_acesso());
-- usuarios: todos com acesso leem; cada um mexe na própria linha sem trocar o papel; admin mexe em todos.
-- O 1º login no app antigo cria a linha como "leitura" — só pra quem já é Operações/Rel/Fin no QS.
create policy exp_ler on usuarios for select to authenticated using (exp_tem_acesso());
create policy exp_criar on usuarios for insert to authenticated
  with check (exp_eh_admin() or (id = auth.uid() and papel = 'leitura' and exp_tem_acesso()));
create policy exp_editar on usuarios for update to authenticated
  using (exp_eh_admin() or id = auth.uid())
  with check (exp_eh_admin() or (id = auth.uid() and papel = (select u.papel from usuarios u where u.id = auth.uid())));
create policy exp_apagar on usuarios for delete to authenticated using (exp_eh_admin());
-- acesso_links e acesso_senhas (login do portal do viajante): sem policy = só o servidor (service role).

-- ── realtime ─────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table arquivos;
alter publication supabase_realtime add table cambios;
alter publication supabase_realtime add table checklist_itens;
alter publication supabase_realtime add table custos;
alter publication supabase_realtime add table documentos;
alter publication supabase_realtime add table expedicoes;
alter publication supabase_realtime add table fornecedores;
alter publication supabase_realtime add table grupos_expedicao;
alter publication supabase_realtime add table links_expedicao;
alter publication supabase_realtime add table pagamentos;
alter publication supabase_realtime add table passageiro_requisitos;
alter publication supabase_realtime add table passageiros;
alter publication supabase_realtime add table quartos;
alter publication supabase_realtime add table requisitos_destino;
alter publication supabase_realtime add table usuarios;

-- ── buckets (sem policy de storage, igual ao antigo: só o servidor acessa) ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('arquivos-expedicoes', 'arquivos-expedicoes', false, 52428800), ('pasta_public', 'pasta_public', true, null)
on conflict (id) do nothing;
