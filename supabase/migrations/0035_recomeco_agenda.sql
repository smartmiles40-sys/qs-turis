-- =============================================================================
-- 0035 — Recomeço da agenda: tira do funil o histórico inservível
-- =============================================================================
-- Autorizada pelo Bruno em 04/08/2026. LEIA ANTES DE COLAR.
--
-- POR QUE. Das 98 reuniões do banco, 25 têm data IMPOSSÍVEL (anos 1110, 1424,
-- 2920, 5525, 6565…) e 30% caem fora de qualquer horário comercial (03:52,
-- 23:51). Foram digitadas à mão, sem trava nenhuma, e o resultado é que o funil
-- não fecha: reunião marcada para o ano 5525 é ETERNAMENTE futura — nunca vence,
-- nunca vira no-show, nunca entra no contador de "sem desfecho". Fica parada
-- como `agendada` para sempre. É por isso que o painel mostra 88 agendadas e
-- ZERO realizadas.
--
-- É o `dt_inicio_medicao` que o próprio briefing pede: registro anterior à
-- virada tem SAL nulo por AUSÊNCIA DE PROCESSO, não por recusa, e misturar os
-- dois faz a taxa de aceite histórica aparecer em 0% para sempre.
--
-- O QUE FICA ATIVO: reunião do mês corrente em diante, dentro de um ano — as 9
-- reais de Bruno Matheus e Talita Carvalho, entre 03 e 10/08/2026.
-- O QUE SAI DO FUNIL: 88 linhas.
--
-- COMO SAI, e esta é a parte importante: as linhas são COPIADAS para
-- `qs_meetings_arquivo` e depois removidas de `qs_meetings`. Nada é perdido — o
-- arquivo guarda a linha inteira, e o gatilho de auditoria (0009) registra cada
-- remoção por cima disso. A consulta de restauração está no fim do arquivo.
--
-- Idempotente: rodar de novo não mexe no que ficou nem duplica o arquivo.
-- Depende da 0032 (colunas novas) e da 0009 (auditoria).
-- =============================================================================

-- ── (1) O arquivo — a rede de segurança, criada ANTES de qualquer remoção ────
create table if not exists qs_meetings_arquivo (like qs_meetings including defaults);

alter table qs_meetings_arquivo add column if not exists arquivado_em  timestamptz not null default now();
alter table qs_meetings_arquivo add column if not exists arquivado_por text;

-- Se o arquivo foi criado numa execução ANTERIOR à 0031/0032, ele nasceu sem as
-- colunas novas — e aí o `insert ... select m.*` abaixo quebraria por diferença
-- de forma. Alinha antes, em vez de descobrir no meio da cópia.
alter table qs_meetings_arquivo add column if not exists sal_motivo         text;
alter table qs_meetings_arquivo add column if not exists realizada_em       timestamptz;
alter table qs_meetings_arquivo add column if not exists reagendado_de      uuid;
alter table qs_meetings_arquivo add column if not exists calendar_event_id  text;
alter table qs_meetings_arquivo add column if not exists calendar_html_link text;
alter table qs_meetings_arquivo add column if not exists calendar_error     text;

-- Histórico, não operação: só a gestão lê.
alter table qs_meetings_arquivo enable row level security;
do $$
begin
  create policy qs_meetings_arquivo_leitura on qs_meetings_arquivo
    for select using (qs_is_manager());
exception
  when duplicate_object then null;
end $$;

-- ── (2) A janela do que continua ativo ──────────────────────────────────────
-- Mês corrente em diante, até um ano à frente. O teto de um ano é o que barra o
-- lixo que "parece futuro": havia uma reunião em 23/01/2030 01:12 que passaria
-- por qualquer filtro de "é futura" e seguiria sujando a métrica.
create or replace function qs_meeting_no_periodo(p_quando timestamptz)
returns boolean
language sql
stable
as $$
  select p_quando >= date_trunc('month', now())
     and p_quando <  now() + interval '1 year';
$$;

do $$
declare
  n_arquivadas int;
  n_tarefas    int;
  n_removidas  int;
  colunas      text;   -- "a, b, c"
  colunas_m    text;   -- "m.a, m.b, m.c"
begin
  -- (a) COPIA primeiro. Se algo falhar daqui pra frente, o arquivo já existe.
  --
  -- A lista de colunas é montada na hora, pelo NOME, a partir do que as duas
  -- tabelas têm em comum. `select m.*` seria mais curto e traiçoeiro: ele casa
  -- por POSIÇÃO, e basta o arquivo ter sido criado numa execução anterior (com
  -- as colunas novas entrando no fim, em outra ordem) pra gravar cada valor na
  -- coluna errada — silenciosamente, quando os tipos batem. Em migration que
  -- apaga dado, não dá pra depender de ordem de coluna.
  select string_agg(quote_ident(c.column_name),        ', ' order by c.ordinal_position),
         string_agg('m.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into colunas, colunas_m
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name   = 'qs_meetings'
     and exists (
       select 1 from information_schema.columns a
        where a.table_schema = 'public'
          and a.table_name   = 'qs_meetings_arquivo'
          and a.column_name  = c.column_name
     );

  execute format(
    'insert into qs_meetings_arquivo (%s, arquivado_em, arquivado_por)
     select %s, now(), %L
       from qs_meetings m
      where not qs_meeting_no_periodo(m.scheduled_at)
        and not exists (select 1 from qs_meetings_arquivo a where a.id = m.id)',
    colunas, colunas_m, 'migration 0035'
  );
  get diagnostics n_arquivadas = row_count;

  -- (b) Encerra as tarefas de CONFIRMAÇÃO dessas reuniões. Sem isto sobram 25
  --     tarefas abertas na fila do SDR mandando confirmar reunião que não existe
  --     mais: ele abre, não entende, e não tem o que fazer.
  update qs_tasks t
     set status = 'ignorada',
         skip_reason = 'Reunião retirada do funil na limpeza da agenda (0035)'
   where t.status in ('pendente', 'atrasada')
     and exists (
       select 1
         from qs_meetings_arquivo a
        where t.tags @> array['meeting:' || a.id::text]
     );
  get diagnostics n_tarefas = row_count;

  -- (c) Só agora sai da tabela ativa.
  delete from qs_meetings m
   where not qs_meeting_no_periodo(m.scheduled_at);
  get diagnostics n_removidas = row_count;

  raise notice '[0035] arquivadas: % | tarefas encerradas: % | retiradas do funil: %',
    n_arquivadas, n_tarefas, n_removidas;
  raise notice '[0035] reuniões ativas agora: %', (select count(*) from qs_meetings);
end $$;

-- ── (3) Fecha a porta por onde o lixo entrou ────────────────────────────────
-- Limpar sem isto é varrer para debaixo do tapete: em um mês o banco volta a ter
-- reunião no ano 5525. Folga generosa de propósito (2020–2100) — a intenção é
-- barrar digitação absurda, não limitar o negócio.
do $$
begin
  alter table qs_meetings
    add constraint qs_meetings_data_plausivel
    check (scheduled_at > timestamptz '2020-01-01' and scheduled_at < timestamptz '2100-01-01')
    not valid;   -- não reprova o que já existe; vale para todo novo INSERT/UPDATE
  raise notice '[0035] CHECK de data plausível aplicado';
exception
  when duplicate_object then raise notice '[0035] CHECK de data plausível já existia';
end $$;

-- ── COMO DESFAZER ──────────────────────────────────────────────────────────
-- Ver o que foi arquivado:
--
--   select id, scheduled_at, meeting_owner, lead_name, status
--     from qs_meetings_arquivo
--    order by scheduled_at;
--
-- Trazer UMA reunião de volta (o CHECK do passo 3 barra data absurda, então só
-- volta o que tem data plausível):
--
--   insert into qs_meetings
--   select a.id, a.lead_id, a.owner_id, a.closer_id, a.title, a.scheduled_at,
--          a.ends_at, a.duration_min, a.location, a.meeting_link, a.notes,
--          a.status, a.lead_name, a.scheduled_by, a.meeting_owner, a.client_email,
--          a.booking_date, a.created_at, a.updated_at
--     from qs_meetings_arquivo a
--    where a.id = 'COLE-O-UUID-AQUI';
--   -- (confira as colunas com \d qs_meetings antes; a lista acima é a da 0027)
