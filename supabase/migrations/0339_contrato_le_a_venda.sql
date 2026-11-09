-- 0339_contrato_le_a_venda.sql
-- -----------------------------------------------------------------------------
-- CONTRATO LÊ A VENDA (09/11/2026, Bruno: "digitar UMA VEZ no QS").
--
-- O contrato (api/_contrato.js) passou a ler a venda registrada e o cadastro
-- único, e a devolver pro cadastro o que o closer corrige no contrato. O único
-- dado que não tinha onde morar no QS é o RG (antes só existia no contato do
-- Bitrix, UF_CRM_1768940114697). Esta migration cria rel_clientes.rg.
--
-- Sem ela o código continua funcionando: a leitura cai pro select sem rg e o
-- write-back grava o resto (cpf/nascimento/e-mail/endereço) e pula o RG.
--
-- Escrita: só pelo servidor (service role) no fluxo do contrato e pela ficha do
-- Rel (a RLS de rel_clientes não muda — coluna nova herda as policies da tabela).
--
-- ROLLBACK: alter table rel_clientes drop column if exists rg;
-- -----------------------------------------------------------------------------

alter table public.rel_clientes add column if not exists rg text;

comment on column public.rel_clientes.rg is
  'RG do cliente (0339). Preenchido pelo contrato do closer (o que ele corrige volta pro cadastro) ou pela ficha. Texto livre (cada estado tem um formato).';
