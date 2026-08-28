-- 0067_primeiro_contato_automatico.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- -- O QUE E ISTO -----------------------------------------------------------
--
-- A mensagem automatica de PRIMEIRO CONTATO: quem cai na etapa "primeiro
-- contato" no Bitrix recebe o video de apresentacao. Nao tem IA nenhuma no
-- caminho - e template aprovado da Meta, disparado pelo QS.
--
-- Antes isso vivia no ChatApp, dentro de um workflow do n8n. Tres problemas
-- que a mudanca resolve, e que estao aqui porque a tabela existe por causa
-- deles:
--
--   1. NAO HAVIA DEDUPE. Automacao de Bitrix repete, e o lead recebia o video
--      duas vezes. Duas boas-vindas seguidas e como se ganha um bloqueio.
--   2. A MENSAGEM NAO EXISTIA EM LUGAR NENHUM. Saia pelo ChatApp e sumia: fora
--      da thread do lead, fora da tela do SDR, fora de qualquer metrica.
--   3. TELEFONE INVALIDO PASSAVA. O n8n calculava `telefone_invalido` e ninguem
--      lia; o POST saia com chatId vazio e falhava calado.
--
-- -- POR QUE UMA TABELA, E NAO UM CAMPO NO LEAD --------------------------------
--
-- O dedupe precisa responder "este lead JA recebeu?" mesmo quando o envio
-- FALHOU - senao uma falha de rede vira reenvio infinito a cada retry do
-- Bitrix. Entao a linha nasce ANTES do envio, com status pendente, e o
-- resultado e gravado por cima. A unicidade por lead e a trava.
--
-- E serve de auditoria: quantos sairam hoje (o teto do dia sai daqui), quais
-- falharam e por que.
-- ---------------------------------------------------------------------------

create table if not exists public.qs_primeiro_contato (
  lead_id        uuid primary key references qs_leads(id) on delete cascade,
  telefone       text,
  template       text,
  status         text not null default 'pendente'
                 check (status in ('pendente', 'enviado', 'falhou', 'bloqueado')),
  motivo         text,
  cw_message_id  bigint,
  origem         text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table public.qs_primeiro_contato is
  'Uma linha por lead que JA passou pelo disparo de primeiro contato. A chave primaria e o dedupe: o mesmo lead nunca recebe o video duas vezes, nem quando o Bitrix repete o webhook.';

-- O teto do dia conta daqui; sem indice ele varre a tabela inteira a cada envio.
create index if not exists idx_qs_primeiro_contato_dia
  on public.qs_primeiro_contato (criado_em desc)
  where status = 'enviado';

alter table public.qs_primeiro_contato enable row level security;

-- Quem escreve e o servidor (service_role, que ignora RLS). O app so LE, e so
-- quem ja pode ver o lead: a auditoria nao pode abrir lead de outro SDR.
drop policy if exists "primeiro_contato_leitura" on public.qs_primeiro_contato;
create policy "primeiro_contato_leitura" on public.qs_primeiro_contato
  for select to authenticated
  using (qs_owns_lead(lead_id));

-- -- CONFIGURACAO --------------------------------------------------------------
-- Fica DESLIGADA. Ligar e decisao de tela (Configuracoes -> Mensagem
-- automatica), nunca de SQL: quem liga precisa ver qual template vai sair.
--
--   { "ativo": false,
--     "template": { "nome": "...", "idioma": "pt_BR", "params": {"1":"{{primeiro_nome}}"} },
--     "midia": { "url": "https://.../video.mp4", "tipo": "video" },
--     "teto_dia": 200 }
insert into qs_settings(key, value)
values ('primeiro_contato_auto', '{"ativo": false, "teto_dia": 200}'::jsonb)
on conflict (key) do nothing;
