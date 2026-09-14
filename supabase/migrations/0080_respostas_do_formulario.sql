-- 0080_respostas_do_formulario.sql
-- =============================================================================
-- AS RESPOSTAS DO FORMULARIO DA LP, DO LADO DE CA (Bruno, 14/09/2026).
--
-- "Nossos SDRs ficam ligando e mandando msg direto, acaba que eles nao veem o
-- que as pessoas cadastram nas respostas que temos como padrao."
--
-- O lead responde 5 perguntas na landing page — se a data faz sentido, se a
-- faixa de investimento faz sentido, em quanto tempo pretende decidir, com quem
-- viaja, que tipo de viajante e. Isso vira campo `UF_CRM_*` no negocio do
-- Bitrix, e o QS nunca soube: o `/api/lead-inbound` recebe do n8n so nome,
-- telefone, e-mail, fonte e o id do negocio. O SDR ligava as cegas pra alguem
-- que ja tinha contado tudo.
--
-- Esta tabela e CACHE, nao fonte da verdade: quem responde e o Bitrix, pelo
-- `/api/lead-formulario`. Ela existe porque resposta de formulario nao muda
-- depois de enviada, e sem cache cada card aberto na fila seria uma chamada ao
-- portal (que tem limite). Apagar esta tabela nao perde dado nenhum — o proximo
-- acesso a preenche de novo.
--
-- COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci). Idempotente.
-- =============================================================================

create table if not exists public.qs_lead_form_answers (
  lead_id    uuid primary key references public.qs_leads(id) on delete cascade,
  -- De QUAL card veio. O vinculo do lead pode mudar de negocio (/api/lead-bitrix
  -- move o `bitrix_id` de card); quando muda, o cache guardado vira lixo e tem
  -- que ser relido — e por isso que o id fica gravado junto.
  bitrix_id  text,
  -- [{ campo: "UF_CRM_...", rotulo: "Como voce pretende viajar?", valor: "Casal" }]
  -- O ROTULO vem gravado junto de proposito: e o texto que o portal tinha no dia
  -- da leitura. Se a pergunta for reescrita no Bitrix, o que o SDR leu continua
  -- fazendo sentido ate a proxima releitura.
  answers    jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

comment on table public.qs_lead_form_answers is
  'Cache das respostas do formulario da LP, lidas do negocio no Bitrix por /api/lead-formulario. Descartavel.';

create index if not exists idx_qs_lead_form_answers_fetched
  on public.qs_lead_form_answers (fetched_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Escrita e leitura SO pela rota (service_role, que ignora RLS). O navegador
-- nunca consulta esta tabela direto: ele chama /api/lead-formulario, que confere
-- a permissao sobre o LEAD (assertCanAccessLead) antes de devolver qualquer
-- coisa. Ligar RLS sem policy nenhuma e o jeito de dizer isso ao banco — sem
-- isso, o anon key leria as respostas de todos os leads da casa.
alter table public.qs_lead_form_answers enable row level security;

-- =============================================================================
-- CONFIGURACAO (opcional, sem deploy): quais campos do Bitrix sao "resposta do
-- cliente". Quando a chave nao existe, vale a lista de fabrica que esta em
-- api/lead-formulario.js (as 5 perguntas da LP + o Instagram).
--
-- LP nova com pergunta nova = acrescentar o UF_CRM_* aqui. A ORDEM do array e a
-- ordem que o SDR le na tela.
--
--   insert into public.qs_settings (key, value) values (
--     'bitrix_campos_formulario',
--     '["UF_CRM_1773087861990","UF_CRM_1773088121860","UF_CRM_1773088140847",
--       "UF_CRM_1773096435043","UF_CRM_1773096503878","UF_CRM_1771877600411"]'::jsonb
--   ) on conflict (key) do update set value = excluded.value;
--
-- Campo sem rotulo de gente no portal e IGNORADO pela rota: "UF_CRM_1773087861990:
-- Casal" na tela do SDR nao ajuda ninguem a conduzir uma ligacao.
-- =============================================================================
