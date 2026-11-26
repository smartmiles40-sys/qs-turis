-- 0421 — Espelho travado desde 25/11 14:05 (26/11/2026)
-- O sistema antigo de Expedições ganhou valores novos que o QS recusava, e o
-- espelho parou nessas duas tabelas:
--   · passageiro_requisitos: tipo de requisito "Aéreo Nacional" (enum tipo_requisito)
--   · expedamigo_acessos: evento "formulario_preenchido" (check constraint)
-- Só acrescenta valores aceitos; nada muda nos dados existentes.
alter type tipo_requisito add value if not exists 'Aéreo Nacional';

alter table expedamigo_acessos drop constraint if exists expedamigo_acessos_evento_chk;
alter table expedamigo_acessos add constraint expedamigo_acessos_evento_chk
  check (evento = any (array['login','download_pdf','viagem_aberta','download_voucher','primeiro_acesso','formulario_preenchido']));
