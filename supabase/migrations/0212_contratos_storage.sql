-- 0212_contratos_storage.sql  (27/10/2026 — contrato sem Google)
-- -----------------------------------------------------------------------------
-- O contrato agora nasce no próprio QS (api/_contratoModelo.js) — sem Google
-- Docs nem Drive. O PDF enviado e o PDF assinado ficam neste bucket PRIVADO.
-- Só o servidor (service_role) grava e lê; a tela abre por link temporário
-- (api/closer.js ?acao=contrato-pdf-link, 10 min). Por isso não tem policy
-- pra authenticated/anon: ninguém lê direto do navegador.
--
-- Caminho: <negocio_id>/<contrato_id>.pdf e <negocio_id>/<contrato_id>-assinado.pdf
-- No banco (qs_contratos.drive_pdf_url / pdf_assinado_url) fica "storage:<caminho>".
--
-- Sem esta migration o envio continua funcionando (o ZapSign guarda o
-- original); só não fica a cópia no QS. NÃO APLICADA.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;
