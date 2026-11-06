-- 0325_produto_tipo_no_tipo_de_venda.sql
-- -----------------------------------------------------------------------------
-- 06/11: em vez de criar um campo "Produto", o Bruno escolheu usar o "Tipo de
-- venda" que já existe no negócio (UF_CRM_1743296167520). A reunião grava ali
-- Expedições / Pacotes de Viagens / Outros (aéreo nunca vira reunião), e SÓ se o
-- campo estiver vazio no card — quem decide o tipo na venda é o closer
-- (api/_bitrixSaida.js). O gatilho da 0324 (esperava um campo "Produto") sai.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_bitrix_fields_alias_produto on public.bitrix_fields;
drop function if exists public.bitrix_fields_alias_produto();

update public.bitrix_fields set alias = 'produto_tipo'
 where field_name = 'UF_CRM_1743296167520' and alias is null
   and not exists (select 1 from public.bitrix_fields where alias = 'produto_tipo');
