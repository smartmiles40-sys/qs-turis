-- 0023_seed_loss_reason_duplicado.sql
-- Adiciona o motivo de perda "Duplicado" (lead que já preencheu o formulário e
-- já está sendo atendido por outro profissional). Pedido do Bruno 2026-07-22.
--
-- Os motivos de perda vivem em qs_loss_reasons e são geridos em Configurações →
-- Motivos de perda; o dropdown de perda do lead lê os NÃO-arquivados. Este seed
-- só garante que "Duplicado" exista como motivo predefinido — dá no mesmo que
-- adicionar pela tela de Configurações, mas versionado e reproduzível.
--
-- Idempotente: não duplica se já existir um motivo com esse rótulo (case-insensitive).
-- Rode o arquivo inteiro no SQL Editor do projeto eabfjomrnucymduqnbci.

insert into qs_loss_reasons (label, is_predefined, is_archived)
select 'Duplicado', true, false
where not exists (
  select 1 from qs_loss_reasons where lower(trim(label)) = 'duplicado'
);

-- Se por acaso "Duplicado" existir mas estiver arquivado, reativa (fica visível
-- no dropdown de novo).
update qs_loss_reasons
   set is_archived = false
 where lower(trim(label)) = 'duplicado' and is_archived = true;
