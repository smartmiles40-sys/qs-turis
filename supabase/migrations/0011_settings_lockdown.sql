-- 0011_settings_lockdown.sql
-- SEGURANÇA da tabela qs_settings (requer a 0007 aplicada — usa qs_is_manager()).
--
-- Problema: a 0005 deixou qs_settings legível E GRAVÁVEL por qualquer usuário
-- autenticado, e ela guarda segredos: o accessToken do ChatApp (gravado pelo
-- n8n), a senha SIP em texto puro e o token do webfone. Qualquer SDR/closer
-- logado podia ler os tokens ou trocar a configuração de todo mundo.
--
-- Depois desta migration:
--   • ESCRITA: só gestor/admin (qs_is_manager). O n8n e as rotas /api usam a
--     service_role, que ignora RLS — continuam funcionando normalmente.
--   • LEITURA: usuários autenticados leem tudo MENOS as chaves-segredo
--     ('chatapp_token'). O wavoip_token continua legível DE PROPÓSITO: o webfone
--     roda no navegador do SDR e precisa do token pra registrar o dispositivo.
--   • 'sip_password' é APAGADA: o CRM nunca usa essa senha (ela vive no
--     softphone do PC); guardar era só risco. A UI parou de persistir.

-- Apaga a senha SIP persistida (se existir).
delete from qs_settings where key = 'sip_password';

-- Leitura: autenticado, exceto segredos (service_role bypassa RLS e lê tudo).
drop policy if exists "qs_settings read" on qs_settings;
create policy "qs_settings read" on qs_settings
  for select using (
    auth.role() = 'authenticated'
    and key not in ('chatapp_token', 'sip_password')
  );

-- Escrita: só gestor/admin.
drop policy if exists "qs_settings write" on qs_settings;
create policy "qs_settings write" on qs_settings
  for all
  using (qs_is_manager())
  with check (qs_is_manager());
