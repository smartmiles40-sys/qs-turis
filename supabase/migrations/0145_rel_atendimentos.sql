-- 0145_rel_atendimentos.sql
-- -----------------------------------------------------------------------------
-- ATENDIMENTOS DO WHATSAPP (Bruno, 19/10/2026): "responder todo mundo e sempre
-- dar concluída, pra nada ficar pendente" + medir tempo de resposta e tempo de
-- solução de cada pessoa do Relacionamento.
--
-- Um ATENDIMENTO nasce quando o cliente escreve e termina no botão CONCLUIR
-- (com motivo). Guarda: quem está atendendo, a 1ª resposta (minutos úteis),
-- quando/quem concluiu, o tempo de solução (minutos úteis) e as reaberturas.
--   • cliente escreve até N horas depois de concluir → REABRE o mesmo (conta
--     reabertura); depois disso → atendimento novo. N = rel_config.atendimento
--   • REABRIR manual pelo botão também conta reabertura;
--   • esperando o cliente há X dias úteis sem resposta dele → conclui sozinho
--     com o motivo "Cliente não respondeu" (rel_wa_autoconcluir, cron);
--   • pesquisa de 1 a 5 depois de concluir (desligada por padrão): a nota que o
--     cliente responde fica no atendimento e NÃO reabre a conversa.
-- Sem distribuição automática (Bruno: "todas veem"). O responsável é quem
-- assumiu ou quem respondeu por último; resposta pelo celular vai pra ele.
-- Conversa "não conta no prazo" (grupo, fornecedor…) não tem atendimento.
-- -----------------------------------------------------------------------------

insert into rel_config (chave, valor) values ('atendimento', jsonb_build_object(
  'reabrir_horas', 24,
  'autoconcluir_ativo', true,
  'autoconcluir_dias_uteis', 3,
  'csat_ativo', false,
  'csat_texto', 'Seu atendimento foi concluído! De 1 a 5, que nota você dá pro nosso atendimento? É só responder com o número 😊'
)) on conflict (chave) do nothing;

create table if not exists rel_wa_atendimentos (
  id                    uuid primary key default gen_random_uuid(),
  conversa_id           uuid not null references rel_wa_conversas(id) on delete cascade,
  setor                 text not null default 'relacionamento',
  -- 'importado' = já estava aberto quando isto nasceu (início aproximado): fica
  -- fora das médias de tempo.
  origem                text not null default 'cliente' check (origem in ('cliente', 'importado')),
  aberto_em             timestamptz not null,
  atendente_id          uuid references qs_users(id) on delete set null,
  meta_min              integer not null default 30,
  primeira_resposta_em  timestamptz,
  primeira_resposta_por uuid references qs_users(id) on delete set null,
  min_primeira_resposta integer,
  concluido_em          timestamptz,
  concluido_por         uuid references qs_users(id) on delete set null,
  motivo                text check (motivo in ('resolvido', 'so_agradeceu', 'sem_retorno', 'encaminhado', 'engano', 'outro')),
  nota                  text,
  automatico            boolean not null default false,
  min_solucao           integer,
  reaberturas           integer not null default 0,
  reaberto_em           timestamptz,
  csat_pedido_em        timestamptz,
  csat_nota             smallint check (csat_nota between 1 and 5),
  csat_em               timestamptz,
  criado_em             timestamptz not null default now()
);
create unique index if not exists rel_wa_atend_um_aberto on rel_wa_atendimentos (conversa_id) where concluido_em is null;
create index if not exists rel_wa_atend_conversa_idx on rel_wa_atendimentos (conversa_id, aberto_em desc);
create index if not exists rel_wa_atend_concluido_idx on rel_wa_atendimentos (concluido_em desc);
create index if not exists rel_wa_atend_aberto_idx on rel_wa_atendimentos (aberto_em desc);

alter table rel_wa_atendimentos enable row level security;
revoke all on rel_wa_atendimentos from anon, authenticated;
grant select on rel_wa_atendimentos to authenticated;
drop policy if exists rel_wa_atend_ler on rel_wa_atendimentos;
-- Quem vê a conversa vê os atendimentos dela (a RLS da conversa decide).
create policy rel_wa_atend_ler on rel_wa_atendimentos for select to authenticated
  using (exists (select 1 from rel_wa_conversas c where c.id = conversa_id));


-- ── Cada mensagem mexe no atendimento (chamada por rel_wa_ingest) ───────────
-- Devolve 'csat' quando a mensagem do cliente era a nota da pesquisa.
create or replace function rel_wa_atend_mensagem(p_conv uuid, p_direcao text, p_origem text, p_autor uuid, p_quando timestamptz, p_texto text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cv  rel_wa_conversas;
  at  rel_wa_atendimentos;
  cfg jsonb;
begin
  if coalesce(p_origem, '') = 'historico' then return null; end if;
  select * into cv from rel_wa_conversas where id = p_conv;
  if cv.id is null or cv.sem_sla then return null; end if;
  select valor into cfg from rel_config where chave = 'atendimento';

  if p_direcao = 'in' then
    -- Nota da pesquisa (1 a 5) até 24h depois de pedida.
    if coalesce(p_texto, '') ~ '^\s*[1-5]\s*$' then
      update rel_wa_atendimentos set csat_nota = trim(p_texto)::smallint, csat_em = p_quando
       where id = (select id from rel_wa_atendimentos
                    where conversa_id = p_conv and concluido_em is not null and csat_nota is null
                      and csat_pedido_em > p_quando - interval '24 hours'
                    order by concluido_em desc limit 1);
      if found then return 'csat'; end if;
    end if;

    if exists (select 1 from rel_wa_atendimentos where conversa_id = p_conv and concluido_em is null) then
      return null;
    end if;
    select * into at from rel_wa_atendimentos where conversa_id = p_conv order by aberto_em desc limit 1;
    if at.id is not null
       and at.concluido_em > p_quando - make_interval(hours => coalesce((cfg ->> 'reabrir_horas')::int, 24)) then
      update rel_wa_atendimentos set
        concluido_em = null, concluido_por = null, motivo = null, nota = null, automatico = false, min_solucao = null,
        reaberturas = reaberturas + 1, reaberto_em = p_quando
       where id = at.id;
    else
      insert into rel_wa_atendimentos (conversa_id, setor, aberto_em, atendente_id, meta_min)
      values (p_conv, coalesce(cv.setor, 'relacionamento'), p_quando, cv.atendente_id,
              coalesce((select (valor ->> 'resposta_min')::int from rel_config where chave = 'sla'), 30));
    end if;
    return null;
  end if;

  -- Resposta nossa (automática não conta).
  if p_origem = 'automatica' then return null; end if;
  select * into at from rel_wa_atendimentos where conversa_id = p_conv and concluido_em is null;
  if at.id is null then return null; end if;
  update rel_wa_atendimentos set
    atendente_id          = coalesce(p_autor, atendente_id, cv.atendente_id),
    primeira_resposta_em  = case when primeira_resposta_em is null and p_quando >= aberto_em then p_quando else primeira_resposta_em end,
    primeira_resposta_por = case when primeira_resposta_em is null and p_quando >= aberto_em
                                 then coalesce(p_autor, atendente_id, cv.atendente_id) else primeira_resposta_por end,
    min_primeira_resposta = case when primeira_resposta_em is null and p_quando >= aberto_em
                                 then rel_minutos_uteis(aberto_em, p_quando) else min_primeira_resposta end
   where id = at.id;
  -- Quem respondeu pelo QS passa a ser quem está atendendo.
  if p_autor is not null and cv.atendente_id is distinct from p_autor then
    update rel_wa_conversas set atendente_id = p_autor where id = p_conv;
  end if;
  return null;
end;
$$;
revoke all on function rel_wa_atend_mensagem(uuid, text, text, uuid, timestamptz, text) from public, anon, authenticated;


-- ── rel_wa_ingest: igual à 0101/0113, + atendimento e nota da pesquisa ──────
create or replace function rel_wa_ingest(p_phone_id text, p_telefone text, p_nome text, p_wamid text, p_direcao text, p_origem text, p_texto text, p_anexos jsonb DEFAULT '[]'::jsonb, p_enviada_em timestamp with time zone DEFAULT now(), p_autor uuid DEFAULT NULL::uuid, p_autor_nome text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_resp text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  fone  text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  conv  rel_wa_conversas;
  nova  boolean;
  meta  int;
begin
  if fone = '' or coalesce(p_wamid, '') = '' then return jsonb_build_object('ok', false); end if;

  insert into rel_wa_conversas (phone_number_id, telefone, nome_contato, cliente_id, estado, sem_sla, sem_sla_motivo, sem_sla_em)
  values (p_phone_id, fone, nullif(p_nome, ''), rel_cliente_do_telefone(fone),
          case when p_direcao = 'in' then 'aberta' else 'aguardando_cliente' end,
          length(fone) > 15, case when length(fone) > 15 then 'grupo' end, case when length(fone) > 15 then now() end)
  on conflict (phone_number_id, telefone) do update
     set nome_contato = coalesce(nullif(excluded.nome_contato, ''), rel_wa_conversas.nome_contato),
         cliente_id   = coalesce(rel_wa_conversas.cliente_id, excluded.cliente_id)
  returning * into conv;

  insert into rel_wa_mensagens (conversa_id, wamid, direcao, origem, texto, anexos, autor_id, autor_nome, status, respondendo_a, enviada_em)
  values (conv.id, p_wamid, p_direcao, p_origem, coalesce(p_texto, ''), coalesce(p_anexos, '[]'),
          p_autor, p_autor_nome, p_status, p_resp, coalesce(p_enviada_em, now()))
  on conflict (wamid) do nothing;
  nova := found;
  if not nova then return jsonb_build_object('ok', true, 'nova', false, 'conversa', conv.id); end if;

  if p_origem = 'historico' then
    update rel_wa_conversas set
      ultima_entrada_em = case when p_direcao = 'in' then greatest(ultima_entrada_em, p_enviada_em) else ultima_entrada_em end,
      ultima_saida_em   = case when p_direcao = 'out' then greatest(ultima_saida_em, p_enviada_em) else ultima_saida_em end,
      atualizado_em     = greatest(atualizado_em, p_enviada_em)
     where id = conv.id;
    return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
  end if;

  if p_direcao = 'in' then
    -- A nota da pesquisa não reabre a conversa nem liga o relógio.
    if rel_wa_atend_mensagem(conv.id, 'in', p_origem, p_autor, coalesce(p_enviada_em, now()), p_texto) = 'csat' then
      update rel_wa_conversas set
        ultima_entrada_em = p_enviada_em,
        ultima_mensagem   = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
        atualizado_em     = now()
       where id = conv.id;
      return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id, 'csat', true);
    end if;
    update rel_wa_conversas set
      estado            = 'aberta',
      aguardando_desde  = case when sem_sla then null else coalesce(aguardando_desde, p_enviada_em) end,
      ultima_entrada_em = p_enviada_em,
      ultima_mensagem   = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      nao_lidas         = nao_lidas + 1,
      atualizado_em     = now()
     where id = conv.id;
  else
    if conv.aguardando_desde is not null and p_origem <> 'automatica' and not conv.sem_sla then
      select coalesce((valor ->> 'resposta_min')::int, 30) into meta from rel_config where chave = 'sla';
      insert into rel_wa_sla (conversa_id, atendente_id, esperou_desde, respondido_em, minutos_uteis, meta_min)
      values (conv.id, coalesce(p_autor, conv.atendente_id), conv.aguardando_desde, p_enviada_em,
              rel_minutos_uteis(conv.aguardando_desde, p_enviada_em), coalesce(meta, 30));
    end if;
    perform rel_wa_atend_mensagem(conv.id, 'out', p_origem, p_autor, coalesce(p_enviada_em, now()), p_texto);
    update rel_wa_conversas set
      estado           = case when p_origem = 'automatica' then estado else 'aguardando_cliente' end,
      aguardando_desde = case when p_origem = 'automatica' then aguardando_desde else null end,
      nao_lidas        = case when p_origem = 'automatica' then nao_lidas else 0 end,
      atendente_id     = coalesce(atendente_id, p_autor),
      ultima_saida_em  = p_enviada_em,
      ultima_mensagem  = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      auto_resposta_em = case when p_origem = 'automatica' then now() else auto_resposta_em end,
      atualizado_em    = now()
     where id = conv.id;
  end if;
  return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
end;
$function$;


-- ── Gatilhos na conversa ────────────────────────────────────────────────────
-- Assumir / passar a conversa muda o responsável do atendimento aberto; marcar
-- "não conta no prazo" tira os atendimentos dela (igual ao rel_wa_sla); virar
-- 'resolvida' por outro caminho fecha o atendimento aberto (motivo "outro").
create or replace function rel_wa_conv_atend_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sem_sla and not old.sem_sla then
    delete from rel_wa_atendimentos where conversa_id = new.id;
    return new;
  end if;
  if new.atendente_id is distinct from old.atendente_id then
    update rel_wa_atendimentos set atendente_id = new.atendente_id where conversa_id = new.id and concluido_em is null;
  end if;
  if new.estado = 'resolvida' and old.estado <> 'resolvida' then
    update rel_wa_atendimentos set
      concluido_em = now(), concluido_por = auth.uid(), motivo = 'outro',
      atendente_id = coalesce(atendente_id, auth.uid()),
      min_solucao = rel_minutos_uteis(aberto_em, now())
     where conversa_id = new.id and concluido_em is null;
  end if;
  return new;
end;
$$;
drop trigger if exists rel_wa_conv_atend_sync on rel_wa_conversas;
create trigger rel_wa_conv_atend_sync after update of atendente_id, estado, sem_sla on rel_wa_conversas
  for each row execute function rel_wa_conv_atend_sync();


-- ── Concluir / Reabrir (botões) ─────────────────────────────────────────────
create or replace function rel_wa_concluir(p_conversa uuid, p_motivo text, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cv  rel_wa_conversas;
  aid uuid;
  cfg jsonb;
begin
  select * into cv from rel_wa_conversas where id = p_conversa;
  if cv.id is null or not wa_ve_conversa(cv.setor) then
    raise exception 'Sem acesso a esta conversa.' using errcode = '42501';
  end if;
  if p_motivo is null or p_motivo not in ('resolvido', 'so_agradeceu', 'sem_retorno', 'encaminhado', 'engano', 'outro') then
    raise exception 'Escolha o motivo da conclusão.';
  end if;
  if p_motivo = 'outro' and coalesce(trim(p_nota), '') = '' then
    raise exception 'Em "Outro", escreva o motivo.';
  end if;

  update rel_wa_atendimentos set
    concluido_em = now(), concluido_por = auth.uid(), motivo = p_motivo, nota = nullif(trim(p_nota), ''),
    automatico = false, atendente_id = coalesce(atendente_id, auth.uid()),
    min_solucao = rel_minutos_uteis(aberto_em, now())
   where conversa_id = p_conversa and concluido_em is null
  returning id into aid;

  update rel_wa_conversas set estado = 'resolvida', aguardando_desde = null, nao_lidas = 0
   where id = p_conversa;

  select valor into cfg from rel_config where chave = 'atendimento';
  return jsonb_build_object(
    'atendimento', aid,
    -- A pesquisa só vai se estiver ligada e a janela de 24h da Meta aberta.
    'pedir_nota', aid is not null and coalesce((cfg ->> 'csat_ativo')::boolean, false)
                  and cv.ultima_entrada_em > now() - interval '23 hours 50 minutes'
  );
end;
$$;
revoke all on function rel_wa_concluir(uuid, text, text) from public, anon;
grant execute on function rel_wa_concluir(uuid, text, text) to authenticated;

create or replace function rel_wa_reabrir(p_conversa uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cv rel_wa_conversas;
  at rel_wa_atendimentos;
begin
  select * into cv from rel_wa_conversas where id = p_conversa;
  if cv.id is null or not wa_ve_conversa(cv.setor) then
    raise exception 'Sem acesso a esta conversa.' using errcode = '42501';
  end if;
  if not cv.sem_sla and not exists (select 1 from rel_wa_atendimentos where conversa_id = p_conversa and concluido_em is null) then
    select * into at from rel_wa_atendimentos where conversa_id = p_conversa order by aberto_em desc limit 1;
    if at.id is not null then
      update rel_wa_atendimentos set
        concluido_em = null, concluido_por = null, motivo = null, nota = null, automatico = false, min_solucao = null,
        reaberturas = reaberturas + 1, reaberto_em = now(), atendente_id = coalesce(atendente_id, auth.uid())
       where id = at.id;
    else
      insert into rel_wa_atendimentos (conversa_id, setor, origem, aberto_em, atendente_id)
      values (p_conversa, coalesce(cv.setor, 'relacionamento'), 'importado', now(), coalesce(cv.atendente_id, auth.uid()));
    end if;
  end if;
  update rel_wa_conversas set estado = 'aberta' where id = p_conversa;
end;
$$;
revoke all on function rel_wa_reabrir(uuid) from public, anon;
grant execute on function rel_wa_reabrir(uuid) to authenticated;


-- ── Conclui sozinho quem não responde há X dias úteis (cron do servidor) ────
create or replace function rel_wa_autoconcluir()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg   jsonb;
  hor   jsonb;
  dia   int;
  lim   int;
  r     record;
  n     int := 0;
begin
  select valor into cfg from rel_config where chave = 'atendimento';
  if not coalesce((cfg ->> 'autoconcluir_ativo')::boolean, true) then return 0; end if;
  select valor into hor from rel_config where chave = 'horario';
  dia := greatest(60, extract(epoch from ((coalesce(hor ->> 'fim', '18:00'))::time - (coalesce(hor ->> 'inicio', '09:00'))::time))::int / 60);
  lim := dia * greatest(1, coalesce((cfg ->> 'autoconcluir_dias_uteis')::int, 3));

  for r in
    select a.id, c.id as conversa_id
      from rel_wa_atendimentos a
      join rel_wa_conversas c on c.id = a.conversa_id
     where a.concluido_em is null
       and c.setor = 'relacionamento'
       and c.estado = 'aguardando_cliente' and c.aguardando_desde is null
       and c.ultima_saida_em is not null
       and (c.ultima_entrada_em is null or c.ultima_saida_em >= c.ultima_entrada_em)
       and c.ultima_saida_em < now() - interval '1 day'
       and rel_minutos_uteis(c.ultima_saida_em, now()) >= lim
  loop
    update rel_wa_atendimentos set
      concluido_em = now(), motivo = 'sem_retorno', automatico = true,
      min_solucao = rel_minutos_uteis(aberto_em, now())
     where id = r.id;
    update rel_wa_conversas set estado = 'resolvida', nao_lidas = 0 where id = r.conversa_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function rel_wa_autoconcluir() from public, anon, authenticated;
grant execute on function rel_wa_autoconcluir() to service_role;


-- ── A fila ganha o atendimento aberto (colunas no fim) ──────────────────────
create or replace view rel_wa_fila with (security_invoker = true) as
 SELECT c.id,
    c.phone_number_id,
    c.telefone,
    c.nome_contato,
    c.cliente_id,
    c.atendente_id,
    c.estado,
    c.aguardando_desde,
    c.ultima_entrada_em,
    c.ultima_saida_em,
    c.ultima_mensagem,
    c.nao_lidas,
    c.auto_resposta_em,
    c.criado_em,
    c.atualizado_em,
    c.optout_em,
    c.sem_sla,
    c.sem_sla_motivo,
    c.sem_sla_por,
    c.sem_sla_em,
    cl.nome AS cliente_nome,
    u.name AS atendente_nome,
    rel_minutos_uteis(c.aguardando_desde, now()) AS minutos_esperando,
    COALESCE(( SELECT ((rel_config.valor ->> 'resposta_min'::text))::integer AS int4
           FROM rel_config
          WHERE (rel_config.chave = 'sla'::text)), 30) AS meta_min,
    ((c.ultima_entrada_em IS NOT NULL) AND (c.ultima_entrada_em > (now() - '24:00:00'::interval))) AS janela_aberta,
    cu.fixada_em,
    COALESCE(cu.favorita, false) AS favorita,
    COALESCE(cu.arquivada, false) AS arquivada,
    COALESCE(cu.silenciada, false) AS silenciada,
    COALESCE(cu.marcada_nao_lida, false) AS marcada_nao_lida,
    COALESCE(( SELECT array_agg(ce.etiqueta_id) AS array_agg
           FROM rel_wa_conversa_etiquetas ce
          WHERE (ce.conversa_id = c.id)), '{}'::uuid[]) AS etiquetas,
    COALESCE(( SELECT array_agg(lc.lista_id) AS array_agg
           FROM rel_wa_lista_conversas lc
          WHERE (lc.conversa_id = c.id)), '{}'::uuid[]) AS listas,
    c.setor,
    c.setor_desde,
    a.id AS atend_id,
    a.aberto_em AS atend_aberto_em,
    a.primeira_resposta_em AS atend_primeira_resposta_em,
    a.min_primeira_resposta AS atend_min_primeira_resposta,
    a.reaberturas AS atend_reaberturas
   FROM ((((rel_wa_conversas c
     LEFT JOIN rel_clientes cl ON ((cl.id = c.cliente_id)))
     LEFT JOIN qs_users u ON ((u.id = c.atendente_id)))
     LEFT JOIN rel_wa_conversa_usuario cu ON (((cu.conversa_id = c.id) AND (cu.user_id = auth.uid()))))
     LEFT JOIN rel_wa_atendimentos a ON (((a.conversa_id = c.id) AND (a.concluido_em IS NULL))));


-- ── Indicadores por pessoa ──────────────────────────────────────────────────
-- 1ª resposta: atendimentos que tiveram a 1ª resposta no período (por quem
-- respondeu). Solução: concluídos no período por uma pessoa (automáticos e
-- importados fora da média). Pendentes: o que está aberto agora.
create or replace function rel_kpi_atendimentos(p_de timestamptz, p_ate timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
base as (
  select a.* from rel_wa_atendimentos a join rel_wa_conversas c on c.id = a.conversa_id where not c.sem_sla
),
resp as (select * from base where origem = 'cliente' and primeira_resposta_em >= p_de and primeira_resposta_em < p_ate),
conc as (select * from base where concluido_em >= p_de and concluido_em < p_ate),
sol  as (select * from conc where origem = 'cliente' and not automatico),
pend as (select * from base where concluido_em is null),
pessoas as (
  select atendente_id as id from conc union select primeira_resposta_por from resp union select atendente_id from pend
),
por as (
  select p.id,
         (select name from qs_users u where u.id = p.id) as nome,
         (select count(*) from conc where atendente_id is not distinct from p.id and not automatico) as concluidos,
         (select count(*) from conc where atendente_id is not distinct from p.id and automatico) as concluidos_auto,
         (select count(*) from pend where atendente_id is not distinct from p.id) as pendentes,
         (select count(*) from resp where primeira_resposta_por is not distinct from p.id) as resp_n,
         (select round(avg(min_primeira_resposta), 1) from resp where primeira_resposta_por is not distinct from p.id) as resp_media,
         (select round(100.0 * avg((min_primeira_resposta <= meta_min)::int), 0) from resp where primeira_resposta_por is not distinct from p.id) as resp_no_prazo,
         (select round(avg(min_solucao), 1) from sol where atendente_id is not distinct from p.id) as sol_media,
         (select count(*) from conc where atendente_id is not distinct from p.id and reaberturas > 0) as reabertos,
         (select round(avg(csat_nota), 2) from conc where atendente_id is not distinct from p.id and csat_nota is not null) as csat_media,
         (select count(*) from conc where atendente_id is not distinct from p.id and csat_nota is not null) as csat_n
    from pessoas p
)
select jsonb_build_object(
  'abertos',          (select count(*) from base where origem = 'cliente' and aberto_em >= p_de and aberto_em < p_ate),
  'concluidos',       (select count(*) from conc),
  'concluidos_auto',  (select count(*) from conc where automatico),
  'pendentes',        (select count(*) from pend),
  'pendentes_sem_resposta', (select count(*) from pend where primeira_resposta_em is null),
  'resp_n',           (select count(*) from resp),
  'resp_media',       (select round(avg(min_primeira_resposta), 1) from resp),
  'resp_mediana',     (select percentile_cont(0.5) within group (order by min_primeira_resposta) from resp),
  'resp_no_prazo',    (select round(100.0 * avg((min_primeira_resposta <= meta_min)::int), 0) from resp),
  'sol_n',            (select count(*) from sol),
  'sol_media',        (select round(avg(min_solucao), 1) from sol),
  'sol_mediana',      (select percentile_cont(0.5) within group (order by min_solucao) from sol),
  'reabertos',        (select count(*) from conc where reaberturas > 0),
  'csat_media',       (select round(avg(csat_nota), 2) from conc where csat_nota is not null),
  'csat_n',           (select count(*) from conc where csat_nota is not null),
  'motivos',          coalesce((select jsonb_object_agg(motivo, n) from (select motivo, count(*) n from conc group by motivo) m), '{}'::jsonb),
  'por_atendente',    coalesce((select jsonb_agg(to_jsonb(por) order by por.concluidos desc) from por), '[]'::jsonb)
);
$$;
grant execute on function rel_kpi_atendimentos(timestamptz, timestamptz) to authenticated;


-- ── O que já está aberto vira atendimento ───────────────────────────────────
-- Quem está esperando resposta tem início certo (aguardando_desde) e conta nas
-- médias; o resto entra como 'importado' (fora das médias de tempo).
insert into rel_wa_atendimentos (conversa_id, setor, origem, aberto_em, atendente_id, meta_min, primeira_resposta_em, primeira_resposta_por)
select c.id, coalesce(c.setor, 'relacionamento'),
       case when c.aguardando_desde is not null then 'cliente' else 'importado' end,
       coalesce(c.aguardando_desde, c.ultima_entrada_em, c.criado_em),
       c.atendente_id,
       coalesce((select (valor ->> 'resposta_min')::int from rel_config where chave = 'sla'), 30),
       case when c.aguardando_desde is null and c.ultima_saida_em >= coalesce(c.ultima_entrada_em, c.criado_em) then c.ultima_saida_em end,
       case when c.aguardando_desde is null and c.ultima_saida_em >= coalesce(c.ultima_entrada_em, c.criado_em) then c.atendente_id end
  from rel_wa_conversas c
 where not c.sem_sla and c.estado <> 'resolvida'
   and not exists (select 1 from rel_wa_atendimentos a where a.conversa_id = c.id and a.concluido_em is null);
