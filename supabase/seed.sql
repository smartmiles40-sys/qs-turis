-- =============================================================================
-- QS Turis — Seed inicial. Rode DEPOIS de 0001_init.sql.
-- Cria o usuário admin, os canais de contato, motivos de perda e produtos base.
-- =============================================================================

-- ── Usuário admin ───────────────────────────────────────────────────────────
-- ⚠️ TROQUE A SENHA depois do primeiro login (o modelo atual guarda em texto puro).
insert into qs_users (name, email, password, role, is_active)
values ('Administrador', 'admin@qsturis.com', 'admin123', 'admin', true)
on conflict (email) do nothing;

-- ── Canais de contato (espelha DEFAULT_CHANNEL_CONFIG do front) ──────────────
insert into qs_channel_config (type, enabled, label) values
  ('pesquisa',  true,  'Pesquisa'),
  ('email',     true,  'E-mail'),
  ('ligacao',   true,  'Ligação'),
  ('whatsapp',  true,  'WhatsApp'),
  ('linkedin',  true,  'LinkedIn'),
  ('instagram', false, 'Instagram'),
  ('tiktok',    false, 'TikTok'),
  ('youtube',   false, 'YouTube')
on conflict (type) do nothing;

-- ── Motivos de perda predefinidos ───────────────────────────────────────────
insert into qs_loss_reasons (label, is_predefined, is_archived) values
  ('Sem orçamento no momento', true, false),
  ('Comprou com concorrente',  true, false),
  ('Sem interesse',            true, false),
  ('Não respondeu',            true, false),
  ('Fora do perfil (ICP)',     true, false),
  ('Momento inadequado',       true, false),
  ('Contato/telefone inválido', true, false)
on conflict do nothing;

-- ── Produtos base (turismo) — ajuste à vontade ──────────────────────────────
insert into qs_products (name, is_active) values
  ('Pacote de viagem',   true),
  ('Expedição',          true),
  ('Consultoria de roteiro', true)
on conflict do nothing;
