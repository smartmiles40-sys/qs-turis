-- =============================================================================
-- 0076 — POOL DE NÚMEROS DE WHATSAPP + RODÍZIO DAS LANDING PAGES
-- -----------------------------------------------------------------------------
-- O QUE RESOLVE (Bruno, 04/09/2026): cada SDR ganhou um número de WhatsApp
-- próprio. Quem preenche o formulário de uma LP tem que cair na conversa de UM
-- SDR — alternando de um em um — e o negócio no Bitrix tem que nascer com ESSE
-- MESMO SDR como responsável.
--
-- ── A DECISÃO DE DESENHO QUE IMPORTA ────────────────────────────────────────
-- O rodízio JÁ EXISTIA (0028): o trigger trg_qs_assign_owner escolhe o dono de
-- todo lead que entra em qs_leads, com ponteiro em qs_assign_state. Criar um
-- SEGUNDO rodízio aqui — um pro número de WhatsApp, outro pro dono do card —
-- daria exatamente o defeito que este projeto veio evitar: a pessoa conversa
-- com a Mariana e o negócio no Bitrix nasce do Victor.
--
-- Então NÃO existe rodízio novo. O que existe é um BILHETE:
--
--   1. A LP chama /api/lead     -> reservar_sdr() gira a roda de 'fila:forms',
--                                  grava o bilhete (telefone -> SDR) e devolve
--                                  o número. A LP redireciona pro wa.me.
--   2. O n8n cria o lead        -> /api/lead-inbound, como sempre fez, sem
--                                  mudar uma linha lá.
--   3. INSERT em qs_leads       -> o trigger da 0028 (reescrito aqui) procura o
--                                  bilhete pelo telefone ANTES de girar a roda.
--                                  Achou -> owner_id = o SDR do bilhete.
--
-- O n8n não sabe que isso existe, e não precisa saber. O algoritmo do rodízio
-- continua sendo UM SÓ: qs_proximo_sdr(), extraída da 0028 e chamada pelos dois.
--
-- ── DUAS FILAS, DE PROPÓSITO ────────────────────────────────────────────────
--   'fila:forms'  -> o rodízio das LPs (só SDR ativo COM número ativo)
--   'global'      -> o rodízio de sempre (todo SDR ativo), pros leads que vêm
--                    do Bitrix, da carga de lista ou do cadastro manual
-- Um lead que veio de LP não gasta vez da fila global e vice-versa. A chave da
-- fila é parâmetro (p_fila), então 'trafego' e 'bio' entram no dia que você
-- quiser, sem migration.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Não altera nenhum lead existente.
-- =============================================================================

-- ── (0) A CHAVE DO TELEFONE ─────────────────────────────────────────────────
-- Por que não comparar o telefone inteiro: na base o mesmo número aparece como
-- 11951251935 (11 dígitos), 5511951251935 (13) e, em casos antigos, sem o nono
-- dígito. Comparar com = deixa passar duplicado calado — foi assim que 57 leads
-- ficaram invisíveis pro webhook do WhatsApp (ver 0037).
-- Os ÚLTIMOS 8 DÍGITOS são o pedaço que não varia em nenhum desses formatos.
create or replace function qs_tel_chave(p_tel text)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  select nullif(right(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), 8), '');
$fn$;

comment on function qs_tel_chave(text) is
  'Ultimos 8 digitos do telefone — a unica parte estavel entre 11/13 digitos, com e sem o nono.';

-- Índice pra busca por telefone em qs_leads não virar seq scan (a tabela cresce).
create index if not exists qs_leads_tel_chave_idx
  on qs_leads (qs_tel_chave(phone), created_at desc)
  where phone is not null;


-- ── (1) O POOL DE NÚMEROS ───────────────────────────────────────────────────
-- Uma linha por CHIP, não por SDR. É o que permite ter reserva pré-aquecida
-- comprada e não atribuída a ninguém, e é o que preserva o histórico: número
-- queimado não some, vira registro de quem falou com quem.
--
--   'ativo'    -> é o número que está recebendo lead agora (um por SDR)
--   'reserva'  -> comprado, aquecido, esperando na fila (sdr_id fica nulo)
--   'queimado' -> saiu de circulação (banido, trocado ou desativado). Fim.
create table if not exists sdr_pool (
  id         uuid primary key default gen_random_uuid(),
  -- Nulo enquanto é reserva: o chip ainda não é de ninguém.
  sdr_id     uuid references qs_users(id) on delete set null,
  -- FOTOGRAFIA do nome no momento da promoção, não fonte da verdade. Serve pra
  -- ler um número queimado daqui a seis meses e saber de quem era, mesmo que a
  -- pessoa já tenha saído da empresa. A tela mostra qs_users.name.
  sdr_nome   text,
  -- Só dígitos, com DDI: 5511999999999. O CHECK é a fronteira contra máscara
  -- entrando por acidente e o wa.me abrindo em branco.
  numero     text not null check (numero ~ '^[0-9]{12,13}$'),
  status     text not null default 'reserva' check (status in ('ativo', 'reserva', 'queimado')),
  -- clock_timestamp(), não now(). A regra "a reserva mais antiga é a mais
  -- aquecida, então é ela que entra" depende desta coluna ordenar de verdade —
  -- e now() é o horário de INÍCIO DA TRANSAÇÃO: dois chips cadastrados no mesmo
  -- insert ficavam com carimbo IDÊNTICO e o desempate caía no uuid, ou seja, em
  -- sorteio. clock_timestamp() é avaliado por linha e preserva a ordem digitada.
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  -- Número ativo sem dono não existe: seria um chip recebendo lead de ninguém.
  constraint sdr_pool_ativo_tem_dono check (status <> 'ativo' or sdr_id is not null)
);

-- Idempotência: se a tabela já existia com o default antigo, corrige.
alter table sdr_pool alter column created_at set default clock_timestamp();
alter table sdr_pool alter column updated_at set default clock_timestamp();

-- UM número ativo por SDR. É esta linha que garante que "trocar por reserva"
-- não deixe dois chips do mesmo SDR no ar ao mesmo tempo.
create unique index if not exists sdr_pool_um_ativo_por_sdr
  on sdr_pool (sdr_id) where status = 'ativo';

-- O mesmo número não pode estar em circulação duas vezes. Queimado pode
-- repetir (o mesmo chip pode ter sido de duas pessoas ao longo do tempo).
create unique index if not exists sdr_pool_numero_em_uso
  on sdr_pool (numero) where status <> 'queimado';


-- ── (2) O BILHETE ───────────────────────────────────────────────────────────
-- "Este telefone foi mandado pra conversar com a Mariana." Nasce no /api/lead,
-- antes de o lead existir, e é lido pelo trigger quando o n8n cria o card.
--
-- LGPD: guarda telefone e primeiro nome porque sem isso um bilhete órfão (a
-- pessoa foi redirecionada mas o n8n falhou e o card nunca nasceu) vira um
-- registro que ninguém consegue reconciliar. E-mail não entra — não ajuda a
-- casar e é dado a mais.
create table if not exists sdr_reservas (
  id         uuid primary key default gen_random_uuid(),
  telefone   text not null,
  chave      text not null,               -- qs_tel_chave(telefone)
  sdr_id     uuid references qs_users(id) on delete set null,
  numero     text,                        -- o número entregue (o chip pode trocar depois)
  fila       text not null default 'forms',
  origem     text,
  expedicao  text,
  nome       text,
  -- SEM foreign key de propósito: quem preenche isto é um trigger BEFORE INSERT
  -- em qs_leads, ou seja, a linha do lead ainda não existe naquele instante e a
  -- FK seria violada. É um vínculo pra auditoria, não uma integridade.
  lead_id    uuid,
  -- clock_timestamp(), não now(). now() é o horário de INÍCIO DA TRANSAÇÃO: sob
  -- concorrência, trinta chamadas simultâneas gravam carimbos fora da ordem em
  -- que realmente pegaram a vez na fila, e aí não dá pra PROVAR que o rodízio
  -- girou certo. clock_timestamp() marca o instante do insert — que acontece
  -- dentro da trava, logo na mesma ordem do rodízio.
  created_at timestamptz not null default clock_timestamp()
);

-- Idempotência: se a tabela já existia com o default antigo, corrige.
alter table sdr_reservas alter column created_at set default clock_timestamp();

create index if not exists sdr_reservas_chave_idx on sdr_reservas (chave, created_at desc);
create index if not exists sdr_reservas_sdr_idx   on sdr_reservas (sdr_id, created_at desc);


-- ── (3) LIMITE POR IP ───────────────────────────────────────────────────────
-- O /api/lead roda no navegador do visitante, então não pode ter segredo
-- (diferente do lead-inbound). Sem teto, qualquer um que leia o JS da LP roda a
-- roda mil vezes e desequilibra a distribuição do dia.
--
-- Guarda o HASH do IP, nunca o IP. Endereço de IP é dado pessoal na LGPD e aqui
-- ele só precisa servir de chave de contagem — o hash faz isso igual.
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


-- ── (4) O RODÍZIO, EXTRAÍDO DA 0028 ─────────────────────────────────────────
-- Mesmo algoritmo de antes, agora como função própria pra ser chamada em dois
-- lugares (o trigger dos leads e o reservar_sdr das LPs). Uma implementação só.
--
-- Por que o ponteiro guarda QUEM FOI O ÚLTIMO em vez de um contador: a posição é
-- recalculada contra a lista de agora. Se um SDR sai da fila, o array_position
-- simplesmente não o encontra e a fila recomeça por quem recebeu menos — em vez
-- de um "contador % 3" virar "contador % 2" e deslocar a vez de todo mundo.
create or replace function qs_proximo_sdr(p_scope text, p_pool uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_last uuid;
  v_pos  int;
  v_n    int;
  chosen uuid;
begin
  if p_pool is null or cardinality(p_pool) = 0 then
    return null;                                   -- fila vazia: quem chamou decide o plano B
  end if;
  v_n := cardinality(p_pool);

  -- Serializa ESTA fila. Dois leads no mesmo milissegundo avançam o ponteiro um
  -- de cada vez: o segundo espera alguns ms na porta e lê o valor já atualizado.
  -- Sem isto os dois leriam "último = Yanca" e os dois iriam pra Mariana.
  perform pg_advisory_xact_lock(hashtext('qs_assign_' || p_scope));

  select s.last_owner_id into v_last
    from qs_assign_state s
   where s.scope = p_scope
     for update;

  v_pos := array_position(p_pool, v_last);

  if v_pos is null then
    -- Primeira volta da fila, ou o último dono saiu do rodízio. Recomeça por
    -- QUEM RECEBEU MENOS leads no total — recomeçar sempre pelo primeiro da
    -- lista viciaria a fila a cada mudança de time.
    select p.id into chosen
      from unnest(p_pool) with ordinality as p(id, ord)
      left join (
        select l.owner_id, count(*) as c
          from qs_leads l
         where l.owner_id is not null
         group by l.owner_id
      ) k on k.owner_id = p.id
     order by coalesce(k.c, 0) asc, p.ord asc
     limit 1;
  else
    chosen := p_pool[(v_pos % v_n) + 1];            -- o próximo da roda
  end if;

  insert into qs_assign_state (scope, last_owner_id, updated_at)
       values (p_scope, chosen, now())
  on conflict (scope) do update
       set last_owner_id = excluded.last_owner_id,
           updated_at    = now();

  return chosen;
end;
$fn$;

-- Quem entra no rodízio das LPs: SDR ativo QUE TEM número ativo. Um SDR sem
-- chip não pode receber lead de WhatsApp — mandar a pessoa pro wa.me de um
-- número que não existe é pior do que mandar pro próximo da fila.
-- É por isso que "Desativar" na tela reequilibra a fila sozinho: o SDR fica sem
-- número ativo e some daqui na chamada seguinte, sem deploy.
create or replace function qs_sdrs_no_rodizio()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select array_agg(u.id order by u.created_at, u.id)
    from qs_users u
    join sdr_pool p on p.sdr_id = u.id and p.status = 'ativo'
   where u.role = 'sdr' and u.is_active = true;
$fn$;


-- ── (5) reservar_sdr — o que o /api/lead chama ──────────────────────────────
-- Uma chamada só: decide o SDR, grava o bilhete e devolve o número.
--
-- Devolve ZERO LINHAS quando não há ninguém no rodízio. Não é erro: é o sinal
-- pro endpoint cair no WHATSAPP_FALLBACK em vez de deixar o lead sem destino.
create or replace function reservar_sdr(
  p_nome      text default null,
  p_telefone  text default null,
  p_email     text default null,
  p_origem    text default null,
  p_expedicao text default null,
  p_fila      text default 'forms'
)
returns table (
  reserva_id    uuid,
  sdr_id        uuid,
  sdr_nome      text,
  numero        text,
  reaproveitado boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tel   text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  v_chave text := qs_tel_chave(p_telefone);
  v_fila  text := coalesce(nullif(btrim(lower(p_fila)), ''), 'forms');
  v_sdr   uuid;
  v_reap  boolean := false;
  v_num   text;
  v_nome  text;
  v_id    uuid;
begin
  if v_chave is null then
    raise exception 'telefone invalido' using errcode = '22023';
  end if;

  -- (a) LEAD RECORRENTE: mesmo telefone nos últimos 30 dias volta pro MESMO SDR.
  -- Quem preencheu a LP do Japão semana passada e agora preencheu a do Egito
  -- cai de novo na Mariana, que já conhece a conversa. E não gasta vez da roda:
  -- o ponteiro não se mexe, então a próxima pessoa NOVA pega a vez que estava lá.
  select r.sdr_id into v_sdr
    from sdr_reservas r
   where r.chave = v_chave
     and r.sdr_id is not null
     and r.created_at > now() - interval '30 days'
   order by r.created_at desc
   limit 1;

  -- Sem bilhete? Olha o card: o lead pode ter nascido pelo Bitrix ou na mão.
  if v_sdr is null then
    select l.owner_id into v_sdr
      from qs_leads l
     where qs_tel_chave(l.phone) = v_chave
       and l.owner_id is not null
       and l.created_at > now() - interval '30 days'
     order by l.created_at desc
     limit 1;
  end if;

  -- O SDR de antes precisa continuar com número ativo. Se ele saiu do rodízio
  -- (férias, chip queimado), a pessoa vai pro próximo da fila — melhor um SDR
  -- novo do que um wa.me que não abre.
  if v_sdr is not null then
    if exists (select 1 from sdr_pool p where p.sdr_id = v_sdr and p.status = 'ativo') then
      v_reap := true;
    else
      v_sdr := null;
    end if;
  end if;

  -- (b) A RODA.
  if v_sdr is null then
    v_sdr := qs_proximo_sdr('fila:' || v_fila, qs_sdrs_no_rodizio());
  end if;

  if v_sdr is null then
    return;                                        -- ninguém no rodízio -> fallback
  end if;

  select p.numero, coalesce(u.name, p.sdr_nome)
    into v_num, v_nome
    from sdr_pool p
    left join qs_users u on u.id = p.sdr_id
   where p.sdr_id = v_sdr and p.status = 'ativo'
   limit 1;

  insert into sdr_reservas (telefone, chave, sdr_id, numero, fila, origem, expedicao, nome)
       values (v_tel, v_chave, v_sdr, v_num, v_fila,
               nullif(btrim(coalesce(p_origem, '')), ''),
               nullif(btrim(coalesce(p_expedicao, '')), ''),
               nullif(btrim(coalesce(p_nome, '')), ''))
    returning sdr_reservas.id into v_id;

  reserva_id    := v_id;
  sdr_id        := v_sdr;
  sdr_nome      := v_nome;
  numero        := v_num;
  reaproveitado := v_reap;
  return next;
end;
$fn$;


-- ── (6) O TRIGGER DA 0028 PASSA A OLHAR O BILHETE ───────────────────────────
-- Única mudança no que já existia. A lógica da 0028 continua inteira embaixo —
-- só ganhou uma consulta ANTES dela.
create or replace function qs_assign_lead_owner() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_scope   text;
  v_pool    uuid[];
  v_chave   text;
  v_res_id  uuid;
  v_res_sdr uuid;
begin
  -- Dono explícito (transferência, handover, cadastro com responsável escolhido)
  -- manda mais que qualquer rodízio.
  if new.owner_id is not null then
    return new;
  end if;

  -- ── (A) TEM BILHETE DA LP PRA ESSE TELEFONE? ────────────────────────────
  -- É isto que faz o SDR do WhatsApp e o dono do card serem a MESMA pessoa. A
  -- pessoa já está conversando com a Mariana neste instante; o card tem que
  -- nascer dela, independente de onde o ponteiro da fila global esteja.
  --
  -- Não checa se o SDR ainda está ativo, de propósito: a conversa já aconteceu.
  -- Card órfão de conversa é pior que card de SDR que saiu de férias ontem.
  v_chave := qs_tel_chave(new.phone);
  if v_chave is not null then
    select r.id, r.sdr_id into v_res_id, v_res_sdr
      from sdr_reservas r
     where r.chave = v_chave
       and r.sdr_id is not null
       and r.created_at > now() - interval '30 days'
     order by r.created_at desc
     limit 1;

    if v_res_sdr is not null then
      new.owner_id := v_res_sdr;
      -- Marca qual card nasceu deste bilhete (auditoria: dá pra provar depois
      -- que o lead X foi mesmo pro número que a pessoa recebeu).
      update sdr_reservas set lead_id = new.id where id = v_res_id and lead_id is null;
      return new;
    end if;
  end if;

  -- ── (B) O RODÍZIO DE SEMPRE (0028, sem mudança de regra) ────────────────
  -- Fila da CADÊNCIA, quando ela tem SDRs atribuídos (Cadências -> Responsáveis).
  if new.cadence_id is not null then
    select array_agg(u.id order by u.created_at, u.id)
      into v_pool
      from qs_cadence_owners co
      join qs_users u on u.id = co.user_id
     where co.cadence_id = new.cadence_id
       and u.role = 'sdr'
       and u.is_active = true;
  end if;

  if v_pool is null or cardinality(v_pool) = 0 then
    v_scope := 'global';
    select array_agg(u.id order by u.created_at, u.id)
      into v_pool
      from qs_users u
     where u.role = 'sdr' and u.is_active = true;
  else
    v_scope := 'cadencia:' || new.cadence_id::text;
  end if;

  -- Sem SDR ativo nenhum: qs_proximo_sdr devolve null e o lead nasce órfão
  -- (o gestor vê e distribui na mão) — mesmo comportamento da 0028.
  new.owner_id := qs_proximo_sdr(v_scope, v_pool);
  return new;
end;
$fn$;

drop trigger if exists trg_qs_assign_owner on qs_leads;
create trigger trg_qs_assign_owner
  before insert on qs_leads
  for each row execute function qs_assign_lead_owner();


-- ── (7) GESTÃO DOS NÚMEROS (o que os botões da tela chamam) ─────────────────

-- "Trocar por reserva": queima o chip atual do SDR e promove a reserva mais
-- antiga (a mais aquecida) pro lugar dele. Numa transação só — não existe
-- estado intermediário em que o SDR fica sem número.
create or replace function qs_promover_reserva(p_sdr_id uuid)
returns table (pool_id uuid, numero text, numero_anterior text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ant_id  uuid;
  v_ant_num text;
  v_res_id  uuid;
  v_res_num text;
  v_nome    text;
begin
  -- Duas trocas simultâneas na mesma tela pegariam a MESMA reserva.
  perform pg_advisory_xact_lock(hashtext('sdr_pool_troca'));

  select u.name into v_nome from qs_users u where u.id = p_sdr_id;
  if v_nome is null then
    raise exception 'SDR nao encontrado' using errcode = '22023';
  end if;

  select p.id, p.numero into v_ant_id, v_ant_num
    from sdr_pool p
   where p.sdr_id = p_sdr_id and p.status = 'ativo'
   limit 1;

  -- A reserva MAIS ANTIGA é a mais aquecida — é ela que entra.
  select p.id, p.numero into v_res_id, v_res_num
    from sdr_pool p
   where p.status = 'reserva'
   order by p.created_at asc, p.id asc
   limit 1;

  if v_res_id is null then
    raise exception 'sem-reserva' using errcode = 'P0001';
  end if;

  -- Queima ANTES de promover: o índice único "um ativo por SDR" precisa estar
  -- livre no instante em que a reserva vira ativa.
  if v_ant_id is not null then
    update sdr_pool set status = 'queimado', updated_at = now() where id = v_ant_id;
  end if;

  update sdr_pool
     set sdr_id = p_sdr_id, sdr_nome = v_nome, status = 'ativo', updated_at = now()
   where id = v_res_id;

  pool_id         := v_res_id;
  numero          := v_res_num;
  numero_anterior := v_ant_num;
  return next;
end;
$fn$;

-- "Desativar": tira o número de circulação. O SDR sai do rodízio das LPs na
-- chamada seguinte (qs_sdrs_no_rodizio deixa de encontrá-lo) e a fila passa a
-- ser dos que sobraram — sem deploy, sem mexer no acesso dele ao QS.
--
-- Vai pra 'queimado' e não pra 'reserva' porque é irreversível de propósito: um
-- chip tirado do ar por suspeita de bloqueio não deve voltar sozinho pra fila
-- das reservas aquecidas.
create or replace function qs_desativar_numero(p_sdr_id uuid)
returns table (pool_id uuid, numero text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  return query
    update sdr_pool p
       set status = 'queimado', updated_at = now()
     where p.sdr_id = p_sdr_id and p.status = 'ativo'
    returning p.id, p.numero;

  if not found then
    raise exception 'sem-numero-ativo' using errcode = 'P0001';
  end if;
end;
$fn$;


-- ── (8) O QUE A TELA LÊ ─────────────────────────────────────────────────────
-- Contador dos últimos N dias por SDR. Duas contagens porque respondem coisas
-- diferentes: `leads` é tudo que caiu na carteira da pessoa (inclusive Bitrix e
-- carga de lista); `reservas` é só o que veio das LPs — é ESTE que tem que
-- estar parelho pra provar que o rodízio está funcionando.
create or replace function qs_leads_por_sdr(p_dias int default 7)
returns table (sdr_id uuid, nome text, leads bigint, reservas bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    u.id,
    u.name,
    (select count(*) from qs_leads l
      where l.owner_id = u.id and l.created_at > now() - make_interval(days => greatest(p_dias, 1))),
    (select count(*) from sdr_reservas r
      where r.sdr_id = u.id and r.created_at > now() - make_interval(days => greatest(p_dias, 1)))
  from qs_users u
  where u.role = 'sdr' and u.is_active = true
  order by u.created_at, u.id;
$fn$;


-- ── (9) RLS ─────────────────────────────────────────────────────────────────
alter table sdr_pool     enable row level security;
alter table sdr_reservas enable row level security;
alter table qs_lp_rate   enable row level security;

-- Leitura: só gestor/admin. Número de WhatsApp do time é informação de gestão —
-- e a lista completa de chips reserva é exatamente o que não se quer vazando.
drop policy if exists sdr_pool_select on sdr_pool;
create policy sdr_pool_select on sdr_pool for select to authenticated
  using (qs_is_manager());

drop policy if exists sdr_reservas_select on sdr_reservas;
create policy sdr_reservas_select on sdr_reservas for select to authenticated
  using (qs_is_manager());

-- qs_lp_rate NÃO ganha policy nenhuma: RLS ligada e sem policy = ninguém
-- autenticado lê nem escreve. Só a service_role (que passa por cima da RLS) e
-- as funções SECURITY DEFINER encostam nela. É contagem de IP, não tem por que
-- estar ao alcance de uma sessão do navegador.

grant select on sdr_pool     to authenticated;
grant select on sdr_reservas to authenticated;

-- ESCRITA NÃO TEM POLICY EM LUGAR NENHUM. Tudo passa pelas funções acima, que
-- são SECURITY DEFINER e só respondem pra quem chama com a service_role (as
-- rotas /api). Uma sessão do navegador com a anon key não consegue girar a roda
-- nem promover chip, mesmo que alguém descubra o nome da função.
revoke all on function reservar_sdr(text, text, text, text, text, text) from public;
revoke all on function qs_promover_reserva(uuid)                        from public;
revoke all on function qs_desativar_numero(uuid)                        from public;
revoke all on function qs_lp_rate_bump(text, int)                       from public;
revoke all on function qs_leads_por_sdr(int)                            from public;
revoke all on function qs_sdrs_no_rodizio()                             from public;
revoke all on function qs_proximo_sdr(text, uuid[])                     from public;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function reservar_sdr(text, text, text, text, text, text) from anon, authenticated';
    execute 'revoke all on function qs_promover_reserva(uuid) from anon, authenticated';
    execute 'revoke all on function qs_desativar_numero(uuid) from anon, authenticated';
    execute 'revoke all on function qs_lp_rate_bump(text, int) from anon, authenticated';
    execute 'revoke all on function qs_leads_por_sdr(int) from anon, authenticated';
    execute 'revoke all on function qs_sdrs_no_rodizio() from anon, authenticated';
    execute 'revoke all on function qs_proximo_sdr(text, uuid[]) from anon, authenticated';
  end if;

  -- E DEVOLVE PRA QUEM PRECISA. O `revoke ... from public` acima tira a permissão
  -- de TODO MUNDO, service_role inclusive — e é a service_role que as rotas /api
  -- usam. Sem estes grants, /api/lead responde "permission denied for function
  -- reservar_sdr" e cai no fallback pra sempre, com o rodízio nunca girando.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function reservar_sdr(text, text, text, text, text, text) to service_role';
    execute 'grant execute on function qs_promover_reserva(uuid) to service_role';
    execute 'grant execute on function qs_desativar_numero(uuid) to service_role';
    execute 'grant execute on function qs_lp_rate_bump(text, int) to service_role';
    execute 'grant execute on function qs_leads_por_sdr(int) to service_role';
    execute 'grant select, insert, update, delete on sdr_pool, sdr_reservas, qs_lp_rate to service_role';
  end if;
end
$do$;


-- ── (10) SEMENTES ───────────────────────────────────────────────────────────
-- Domínios autorizados a chamar /api/lead do navegador. Fica em qs_settings e
-- não no código pra LP nova entrar sem deploy — mesma ideia do webhook_listas.
insert into qs_settings (key, value)
     values ('lp_origins', '["https://setuforeuvouviagens.com.br","https://live.setuforeuvouviagens.com.br","https://forms.setuforeuvouviagens.com.br"]'::jsonb)
on conflict (key) do nothing;

-- Teto de chamadas por IP por hora. Afrouxa aqui se o IP do escritório esbarrar
-- durante um teste — sem deploy.
insert into qs_settings (key, value)
     values ('lp_rate_limit', '20'::jsonb)
on conflict (key) do nothing;


-- ── (11) COMO CADASTRAR OS NÚMEROS ──────────────────────────────────────────
-- A tela NÃO tem campo de digitar número, de propósito: chip errado digitado às
-- pressas manda lead pago pra conversa de um estranho. Cadastro é aqui.
--
--   -- Os três ativos (troque os números; SÓ DÍGITOS, com o 55 na frente):
--   insert into sdr_pool (sdr_id, sdr_nome, numero, status)
--   select u.id, u.name, x.numero, 'ativo'
--     from (values
--       ('mariana.rodrigues@agenciasetuforeuvou.com', '5511900000001'),
--       ('victor.hugo@agenciasetuforeuvou.com',       '5511900000002'),
--       ('yanca.manuella@agenciasetuforeuvou.com',    '5511900000003')
--     ) as x(email, numero)
--     join qs_users u on u.email = x.email;
--
--   -- As reservas aquecidas (sem dono; a mais antiga é a próxima a entrar):
--   insert into sdr_pool (numero, status) values
--     ('5511900000004', 'reserva'),
--     ('5511900000005', 'reserva');
--
-- CONFERIR DEPOIS:
--   select * from sdr_pool order by status, created_at;
--   select * from qs_assign_state;                 -- o ponteiro de cada fila
--   select * from qs_leads_por_sdr(7);             -- a distribuição da semana
