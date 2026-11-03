-- 0281_tipo_cotacao_seguro.sql
-- -----------------------------------------------------------------------------
-- COTAÇÃO DE SEGURO VIAGEM como tipo próprio (Bruno, 03/11/2026): a proposta
-- de seguro tem modelo próprio (0280 / "Proposta de Seguro Viagem - Padrão"),
-- mas não havia tipo de solicitação pra pedir. Com este tipo, "Montar proposta"
-- já nasce no modelo Seguro viagem. Sem formulário de cotação (o de pacote
-- pergunta hotel/aéreo): o pedido vai na descrição (destino, datas, idades).
-- Só ARQUIVO — aplicar com o ok do Bruno.
-- -----------------------------------------------------------------------------
insert into qs_solicitacao_tipos (id, setor, rotulo, grupo, formulario, prazo_horas, prazo_alta_horas, prazo_urgente_horas, desfecho_dias, ordem, ativo) values
  ('ops_cot_seguro', 'operacional', 'Cotação de seguro viagem', 'Cotação', null, 8, 4, 2, 7, 13, true)
on conflict (id) do nothing;
