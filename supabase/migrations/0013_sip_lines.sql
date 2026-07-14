-- 0013_sip_lines.sql
-- WEBFONE WebRTC (VoxFree) — credenciais SIP por SDR (ramal + senha).
--
-- Contexto: o webfone WebRTC roda DENTRO do navegador (JsSIP). Pra registrar o
-- ramal, o navegador PRECISA ter a senha SIP daquele SDR em memória — não tem
-- como fugir disso no WebRTC. Guardar a senha em qs_settings NÃO serve: a 0011
-- ou deixa a chave legível por todo mundo (todo SDR leria a senha do outro), ou
-- bloqueia a leitura (aí o navegador do próprio dono também não lê).
--
-- Solução: uma linha POR USUÁRIO com RLS por dono. Cada SDR lê SÓ a própria
-- linha (auth.uid() = user_id); admin/gestor gerencia todas. É o mesmo padrão de
-- isolamento das qs_leads/qs_tasks (0007): id do qs_users = auth.uid().
--
-- Config COMPARTILHADA (não-secreta: URL do WSS, domínio, prefixo de rota) fica
-- em qs_settings (legível), definida pelo admin em Configurações. Aqui mora só o
-- que é secreto e individual: authorization_user (o ramal) + a senha.

create table if not exists qs_sip_lines (
  user_id      uuid primary key references qs_users(id) on delete cascade,
  auth_user    text not null,             -- authorization user / ramal (ex.: "2272_2001")
  password     text not null,             -- senha SIP (secreta; protegida por RLS por dono)
  display_name text,                       -- nome que aparece pro destino (opcional)
  ws_url       text,                       -- override do WSS por-usuário (senão usa o de qs_settings)
  domain       text,                       -- override do domínio/realm (senão usa o de qs_settings)
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);

alter table qs_sip_lines enable row level security;

-- LEITURA: o próprio SDR (pra registrar o ramal no navegador) ou o gestor/admin.
-- A service_role (n8n/rotas /api) ignora RLS e continua lendo tudo.
drop policy if exists sip_lines_select on qs_sip_lines;
create policy sip_lines_select on qs_sip_lines
  for select to authenticated
  using (user_id = auth.uid() or qs_is_manager());

-- ESCRITA (criar/editar/apagar): só gestor/admin. O SDR nunca grava a própria
-- linha — quem provisiona os ramais é o admin em Configurações.
drop policy if exists sip_lines_write on qs_sip_lines;
create policy sip_lines_write on qs_sip_lines
  for all to authenticated
  using (qs_is_manager())
  with check (qs_is_manager());

-- ── VERIFICAÇÃO (rode e confira o resultado) ────────────────────────────────
-- Deve listar as 2 políticas (sip_lines_select / sip_lines_write):
--   select policyname, cmd from pg_policies where tablename = 'qs_sip_lines';
