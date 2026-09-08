-- =============================================================================
-- 0077 — AUTOAGENDAMENTO: O CLIENTE MARCA O PRÓPRIO HORÁRIO
-- -----------------------------------------------------------------------------
-- O QUE RESOLVE (Bruno, 08/09/2026): hoje só o time marca reunião — pela Agenda
-- ou pela Glória no WhatsApp. Esta migration abre a porta pro próprio cliente
-- escolher o horário numa página pública (/agendar/), que vai embutida num
-- <iframe> dentro do STFV Forms e das LPs.
--
-- ── POR QUE ESTA MIGRATION É TÃO PEQUENA ────────────────────────────────────
-- Porque o autoagendamento NÃO ganhou banco próprio, e isso foi decisão de
-- desenho, não preguiça. Tudo o que ele precisa já existe e já está em produção:
--
--   • qs_meetings + a constraint EXCLUDE da 0027  -> a trava que impede dois
--     clientes na mesma hora do mesmo especialista. É a única trava que
--     realmente importa aqui, e ela é do BANCO — nenhuma corrida de servidor
--     serverless passa por cima dela.
--   • qs_closer_blocks / qs_users(role='closer')  -> quem atende e quando não
--   • qs_leads + o trigger de rodízio da 0028/0076 -> o lead nasce com dono
--   • qs_lp_rate_bump (0076)                       -> o teto por IP por hora,
--     agora compartilhado: a chave do autoagendamento é 'agendar:<hash do ip>',
--     então ele NÃO gasta a cota das landing pages e vice-versa.
--
-- Criar tabela nova de "solicitação de agendamento" seria inventar um segundo
-- lugar onde mora reunião — e no dia em que os dois divergissem, o time estaria
-- olhando pra uma agenda que não é a verdadeira. A reunião do autoagendamento é
-- uma reunião como qualquer outra; o que a distingue é a ASSINATURA:
--
--     qs_meetings.scheduled_by = 'Autoagendamento (site)'
--
-- (a da Glória é 'Glória (IA)', a do time é o nome de quem marcou). É por esse
-- campo que se conta quantas reuniões o self-book trouxe — a consulta pronta
-- está no fim deste arquivo.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Não altera nenhuma reunião nem nenhum lead existente.
-- =============================================================================

-- ── (1) A CONFIGURAÇÃO ──────────────────────────────────────────────────────
-- As regras do que o cliente enxerga. O padrão é o MESMO da Glória, e não por
-- economia: a janela 11h–18h de segunda a sexta e a antecedência de 3 horas
-- foram escolhidas em 25/08 contra no-show ("reunião marcada às 10h50 pras 11h
-- vira no-show, e no-show custa mais caro que agenda vazia"). Abrir mais aqui
-- seria repetir de graça um erro que já foi pago uma vez.
--
-- Mexer nisto NÃO exige deploy: é UPDATE nesta linha. O servidor relê a cada
-- minuto (cache de processo em api/agendar.js).
--
--   ativo             liga/desliga a página inteira (false = mostra o recado)
--   janela.primeira   primeira hora que pode ser oferecida (hora cheia)
--   janela.ultima     ÚLTIMA HORA DE COMEÇO — 17 significa "termina 18h"
--   dias              dias da semana (0 = domingo … 6 = sábado)
--   duracaoMin        duração da reunião
--   antecedenciaMin   nada com menos que isto a partir de agora
--   diasAFrente       até quantos dias à frente a grade mostra
--   titulo/subtitulo  o texto no topo da página
--   encerrado         o que aparece quando não há horário nenhum
--
-- `on conflict do nothing`: rodar de novo NÃO reverte o que o Bruno já ajustou.
insert into qs_settings (key, value)
values (
  'autoagendamento',
  jsonb_build_object(
    'ativo',            true,
    'janela',           jsonb_build_object('primeira', 11, 'ultima', 17),
    'dias',             jsonb_build_array(1, 2, 3, 4, 5),
    'duracaoMin',       60,
    'antecedenciaMin',  180,
    'diasAFrente',      14,
    'titulo',           'Fale com um especialista',
    'subtitulo',        'Escolha o melhor dia e horário. A conversa dura 1 hora, por Google Meet.',
    'encerrado',        'No momento não temos horário disponível. Fale com a gente pelo WhatsApp que a gente encaixa você.'
  )
)
on conflict (key) do nothing;

-- ── (2) QUEM PODE CHAMAR A ROTA PELO NAVEGADOR ──────────────────────────────
-- `qs_settings.lp_origins` é a allowlist de CORS que o /api/lead já usa desde a
-- 0076 — o /api/agendar passou a ler a MESMA lista, pra não existirem duas
-- allowlists que divergem. Aqui só se garante que ela existe e que os domínios
-- que vão embutir a página estão nela.
--
-- ⚠️ Domínio novo que for embutir o agendamento precisa entrar em DOIS lugares:
--    aqui (CORS) e no `frame-ancestors` do vercel.json (que é quem autoriza o
--    <iframe>). Esquecer um dos dois dá tela em branco sem erro na tela — o
--    recado fica só no console do navegador.
insert into qs_settings (key, value)
values ('lp_origins', jsonb_build_array(
  'https://setuforeuvouviagens.com.br',
  'https://live.setuforeuvouviagens.com.br',
  'https://forms.setuforeuvouviagens.com.br',
  'https://stfv-forms-geral.vercel.app'
))
on conflict (key) do update
set value = (
  select jsonb_agg(distinct o)
  from (
    select jsonb_array_elements(
      case when jsonb_typeof(qs_settings.value) = 'array' then qs_settings.value else '[]'::jsonb end
    ) as o
    union
    select jsonb_array_elements(excluded.value) as o
  ) t
),
    updated_at = now();

-- ── (3) O TETO POR IP ───────────────────────────────────────────────────────
-- Se `lp_rate_limit` nunca foi configurado, o código cai em 20/hora sozinho.
-- Esta linha existe só pra ele aparecer na tabela e ser fácil de achar e mexer.
insert into qs_settings (key, value)
values ('lp_rate_limit', '20'::jsonb)
on conflict (key) do nothing;

-- ── (4) O CONTADOR DE ABUSO ─────────────────────────────────────────────────
-- ⚠️ MEDIDO NO BANCO DE PRODUÇÃO EM 08/09/2026: `qs_lp_rate` e
-- `qs_lp_rate_bump` NÃO EXISTEM — a 0076 nunca foi aplicada. Sem eles o teto
-- por IP do autoagendamento não conta nada: o código falha ABERTO de propósito
-- (não recusar cliente por causa do contador de abuso), então o sintoma é zero.
-- Um robô poderia encher a agenda dos closers e ninguém veria erro nenhum.
--
-- Por isso o contador é criado AQUI também, com a definição idêntica à da 0076.
-- As duas migrations passam a ser independentes: aplicar em qualquer ordem, ou
-- só uma delas, dá o mesmo resultado. `if not exists` / `or replace` garantem
-- que aplicar a 0076 depois não desfaz nada.
--
-- ⚠️ E FICA O RECADO MAIOR, que é maior do que esta feature: se a 0076 não foi
--    aplicada, o POOL DE NÚMEROS DAS LANDING PAGES também não está de pé —
--    `reservar_sdr` e `qs_wa_numeros` não existem, então /api/lead cai no
--    WHATSAPP_FALLBACK em toda chamada e o rodízio por número não acontece.
create table if not exists qs_lp_rate (
  ip_chave  text        not null,
  janela    timestamptz not null,          -- início da hora cheia
  contagem  int         not null default 0,
  primary key (ip_chave, janela)
);

-- O insert ... on conflict do update ... returning é o incremento atômico:
-- duas chamadas simultâneas do mesmo IP viram 1 e 2, nunca 1 e 1.
create or replace function qs_lp_rate_bump(p_chave text, p_teto int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_janela timestamptz := date_trunc('hour', now());
  v_cont   int;
begin
  if p_chave is null or p_chave = '' then
    return true;                                   -- sem IP legível: não bloqueia
  end if;

  insert into qs_lp_rate as t (ip_chave, janela, contagem)
       values (p_chave, v_janela, 1)
  on conflict (ip_chave, janela) do update
       set contagem = t.contagem + 1
    returning t.contagem into v_cont;

  -- Faxina barata: 2% das chamadas limpam o que já não serve. Evita cron.
  if random() < 0.02 then
    delete from qs_lp_rate where janela < now() - interval '3 hours';
  end if;

  return v_cont <= p_teto;
end;
$fn$;

-- RLS ligada e SEM policy: ninguém alcança a tabela pela chave anon. Quem conta
-- é a função (security definer), chamada só pela service_role das rotas.
alter table qs_lp_rate enable row level security;

revoke all on function qs_lp_rate_bump(text, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function qs_lp_rate_bump(text, int) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function qs_lp_rate_bump(text, int) to service_role';
    execute 'grant select, insert, update, delete on qs_lp_rate to service_role';
  end if;
end $$;

-- =============================================================================
-- CONFERÊNCIA — rode depois de aplicar
-- =============================================================================

-- A configuração entrou?
--   select key, jsonb_pretty(value) from qs_settings
--    where key in ('autoagendamento','lp_origins','lp_rate_limit');

-- Existe especialista pra oferecer? SEM ISTO A PÁGINA NASCE VAZIA — é o primeiro
-- lugar pra olhar quando "não aparece horário nenhum".
--   select id, name, email from qs_users where role = 'closer' and is_active;

-- Quantas reuniões o autoagendamento trouxe, por semana:
--   select date_trunc('week', scheduled_at) as semana,
--          count(*) filter (where scheduled_by = 'Autoagendamento (site)') as self_book,
--          count(*) filter (where scheduled_by = 'Glória (IA)')            as gloria,
--          count(*)                                                        as total
--     from qs_meetings
--    where scheduled_at >= now() - interval '60 days'
--    group by 1 order by 1 desc;

-- E o que elas deram (o número que decide se vale a pena):
--   select status, count(*) from qs_meetings
--    where scheduled_by = 'Autoagendamento (site)' group by 1 order by 2 desc;
