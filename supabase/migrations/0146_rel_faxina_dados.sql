-- 0146 — Faxina dos dados do Relacionamento (Bruno, 19/10/2026)
-- -----------------------------------------------------------------------------
-- "O que impede o uso diário hoje é dado sujo." Aplicada em partes (0146a–k) pelo
-- MCP; este arquivo é a soma delas, na mesma ordem.
--   a) título 'Preencher formulário de CRM "..."' virava o destino
--   b) contatos da gestão de milhas ("[SM] Gestão - ...") arquivados
--   c) 9º dígito: rel_fone_chave + ficha ↔ conversa com e sem o 9
--   d/e) duplicados sem acento/maiúscula + o NULL que escondia todos os pares
--   f/g) alertas: tarefa atrasada = etapa da Esteira (mesmo número da tela)
--   h/i) KPIs: resposta pelo celular conta pro responsável; nome sem "| ..."
--   j) anexo grande: o navegador sobe direto no bucket (rel-envio/)
--   k) respostas prontas de partida
-- -----------------------------------------------------------------------------

-- ── a) título de formulário ────────────────────────────────────────────────
update rel_viagens set titulo = 'Japão 2027', destino = coalesce(destino, 'Japão 2027')
 where titulo = 'Preencher formulário de CRM "[Japão 2027] - Orgânico"';
update rel_viagens set titulo = 'Turquia e Grécia 2027', destino = coalesce(destino, 'Turquia e Grécia 2027')
 where titulo = 'Preencher formulário de CRM "Lista de espera - Expedição Turquia e Grécia 2027"';
update rel_viagens set titulo = 'Cotação (Operações) — #' || bitrix_deal_id
 where titulo = 'Preencher formulário de CRM "Solicitação de cotação"';

-- ── b) gestão de milhas ────────────────────────────────────────────────────
with g as (
  select id from rel_clientes
   where mesclado_em_id is null and arquivado_em is null
     and nome ~* '^\s*(\[\s*sm\s*\]|gest[aã]o\s*-)'
)
, v as (
  update rel_viagens set status = 'arquivada'
   where cliente_id in (select id from g) and status = 'ativa'
  returning 1
)
update rel_clientes c set arquivado_em = now(), arquivado_motivo = 'gestão de milhas (não é cliente de viagem)'
 where c.id in (select id from g);

-- ── c) 9º dígito ───────────────────────────────────────────────────────────
create or replace function rel_fone_chave(p text) returns text
language sql immutable parallel safe set search_path = public as $$
  select case
    when d ~ '^55\d{10,11}$' then substr(d, 1, 4) || right(d, 8)
    when d ~ '^\d{10,11}$'   then '55' || substr(d, 1, 2) || right(d, 8)
    else nullif(d, '')
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x;
$$;

create index if not exists rel_clientes_fone_chave_idx on rel_clientes (rel_fone_chave(telefone)) where mesclado_em_id is null;
create index if not exists rel_wa_conversas_fone_chave_idx on rel_wa_conversas (rel_fone_chave(telefone));

create or replace function rel_cliente_do_telefone(p_telefone text) returns uuid
language sql stable set search_path = public as $$
  with exato as (
    select id, titular_id from rel_clientes
     where telefone = p_telefone and mesclado_em_id is null and arquivado_em is null
  ), chave as (
    select id, titular_id from rel_clientes
     where rel_fone_chave(telefone) = rel_fone_chave(p_telefone) and mesclado_em_id is null and arquivado_em is null
  ), c as (
    select * from exato union all select * from chave where not exists (select 1 from exato)
  )
  select case
    when (select count(*) from c) = 1 then (select id from c)
    when (select count(*) from c where titular_id is null) = 1 then (select id from c where titular_id is null)
    else null
  end;
$$;

create or replace function rel_liga_conversas_do_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.telefone is not null and new.mesclado_em_id is null then
    update rel_wa_conversas
       set cliente_id = rel_cliente_do_telefone(telefone)
     where rel_fone_chave(telefone) = rel_fone_chave(new.telefone) and cliente_id is null;
  end if;
  if new.mesclado_em_id is not null then
    update rel_wa_conversas set cliente_id = new.mesclado_em_id where cliente_id = new.id;
  end if;
  return null;
end;
$$;

update rel_wa_conversas c set cliente_id = rel_cliente_do_telefone(c.telefone)
 where c.cliente_id is null and c.telefone is not null and rel_cliente_do_telefone(c.telefone) is not null;

-- ── d/e) duplicados ────────────────────────────────────────────────────────
create or replace function rel_nome_chave(p text) returns text
language sql immutable parallel safe set search_path = public as $$
  select nullif(trim(regexp_replace(
    translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- O filtro "mesma família" dava NULL com titular_id vazio e o NOT NULL descartava o par.
create or replace view rel_duplicados_sugeridos with (security_invoker = true) as
with vivos as (
  select id, nome, cpf, email, nascimento, telefone, titular_id,
         rel_nome_chave(nome) nk, rel_fone_chave(telefone) fk
    from rel_clientes
   where mesclado_em_id is null and arquivado_em is null
)
select a.id as a_id, a.nome as a_nome, b.id as b_id, b.nome as b_nome,
  array_remove(array[
    case when a.cpf = b.cpf then 'mesmo CPF' end,
    case when a.fk = b.fk then 'mesmo telefone' end,
    case when a.email = b.email then 'mesmo e-mail' end,
    case when a.nk = b.nk then 'mesmo nome' end,
    case when a.nascimento = b.nascimento and split_part(a.nk, ' ', 1) = split_part(b.nk, ' ', 1) then 'mesmo primeiro nome e nascimento' end
  ], null) as motivos
from vivos a join vivos b on a.id < b.id
where (a.cpf = b.cpf or a.fk = b.fk or a.email = b.email or (a.nk = b.nk and length(a.nk) >= 5)
       or (a.nascimento = b.nascimento and split_part(a.nk, ' ', 1) = split_part(b.nk, ' ', 1)))
  and not coalesce(a.titular_id = b.id or b.titular_id = a.id or a.titular_id = b.titular_id, false)
  and not (a.cpf is not null and b.cpf is not null and a.cpf <> b.cpf)
  and not exists (select 1 from rel_nao_duplicados n where n.a = a.id and n.b = b.id);

create or replace function rel_buscar_parecidos(p_cpf text default null, p_passaporte text default null, p_telefone text default null,
  p_email text default null, p_nome text default null, p_ignorar uuid default null)
returns table(id uuid, nome text, motivo text, bloqueia boolean)
language plpgsql stable set search_path = public as $$
declare
  cpf_n  text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  pass_n text := nullif(upper(regexp_replace(coalesce(p_passaporte, ''), '[^A-Za-z0-9]', '', 'g')), '');
  fone_k text := rel_fone_chave(p_telefone);
  mail_n text := nullif(lower(trim(coalesce(p_email, ''))), '');
  nome_k text := rel_nome_chave(p_nome);
begin
  return query
    select c.id, c.nome,
           case
             when cpf_n is not null and c.cpf = cpf_n then 'mesmo CPF'
             when pass_n is not null and c.passaporte = pass_n then 'mesmo passaporte'
             when fone_k is not null and rel_fone_chave(c.telefone) = fone_k then 'mesmo telefone'
             when mail_n is not null and c.email = mail_n then 'mesmo e-mail'
             else 'mesmo nome'
           end,
           (cpf_n is not null and c.cpf = cpf_n) or (pass_n is not null and c.passaporte = pass_n)
      from rel_clientes c
     where c.mesclado_em_id is null
       and (p_ignorar is null or c.id <> p_ignorar)
       and ((cpf_n is not null and c.cpf = cpf_n)
         or (pass_n is not null and c.passaporte = pass_n)
         or (fone_k is not null and rel_fone_chave(c.telefone) = fone_k)
         or (mail_n is not null and c.email = mail_n)
         or (nome_k is not null and length(nome_k) >= 5 and rel_nome_chave(c.nome) = nome_k))
     limit 10;
end;
$$;

-- ── f) a Esteira no banco (espelha src/rel/lib/etapas.ts → estadoDaEsteira) ──
create or replace function rel_esteira_atrasadas()
returns table(viagem_id uuid, etapa text, rotulo text, prazo date)
language sql stable security invoker set search_path = public as $$
  with v as (
    select id, data_venda venda, data_embarque ida, coalesce(data_retorno, data_embarque) volta,
           coalesce(data_venda, data_embarque) base
      from rel_viagens_v
     where status = 'ativa' and tipo <> 'expedicao' and data_embarque is not null
       and (fase in ('antes', 'em_viagem') or (fase = 'concluida' and data_retorno >= rel_hoje() - 10))
  ), e as (
    select v.id, x.ordem, x.etapa, x.rotulo, x.abre, x.prazo,
      case
        when exists (select 1 from rel_viagem_etapas r where r.viagem_id = v.id and r.etapa = x.etapa and r.concluida_em is not null) then 'feita'
        when not x.aplica then 'nao_se_aplica'
        when x.prazo < date '2026-10-16' then 'zerada'          -- ZERADAS_ATE
        when x.abre > rel_hoje() then 'aguardando'
        when x.prazo < rel_hoje() then 'atrasada'
        else 'a_fazer'
      end situacao
    from v cross join lateral (values
      (1, 'passagem',  'Passagem de bastão', v.base,     v.base + 2,  v.venda is not null and v.venda >= date '2026-10-16'),
      (2, 'revisao',   'Revisão',            v.base,     v.base + 5,  v.venda is not null),
      (3, 'd30',       'D-30',               v.ida - 30, v.ida - 28,  v.venda is null or v.venda <= v.ida - 30),
      (4, 'd7',        'D-7',                v.ida - 7,  v.ida - 5,   v.venda is null or v.venda <= v.ida - 7),
      (5, 'd3',        'D-3',                v.ida - 3,  v.ida - 2,   true),
      (6, 'checkin',   'Check-in',           v.ida - 2,  v.ida,       true),
      (7, 'em_viagem', 'Em viagem',          v.ida,      v.volta,     true),
      (8, 'retorno',   'Retorno',            v.volta,    v.volta + 3, true)
    ) x(ordem, etapa, rotulo, abre, prazo, aplica)
  ), atual as (
    select distinct on (id) id, etapa, rotulo, prazo, situacao
      from e where situacao not in ('feita', 'nao_se_aplica', 'zerada')
     order by id, ordem
  )
  select id, etapa, rotulo, prazo from atual where situacao = 'atrasada';
$$;
grant execute on function rel_esteira_atrasadas() to authenticated;

-- ── g) alertas ─────────────────────────────────────────────────────────────
create or replace view rel_alertas with (security_invoker = true) as
 select 'passaporte'::text as tipo, 'alta'::text as gravidade, c.id as cliente_id, v.id as viagem_id,
    c.nome || ': passaporte vence em ' || to_char(c.passaporte_validade, 'DD/MM/YYYY') as titulo,
    'Viagem ' || v.titulo || ' volta em ' || to_char(coalesce(v.data_retorno, v.data_embarque), 'DD/MM/YYYY') || '. O passaporte precisa valer 6 meses além disso.' as detalhe,
    v.data_embarque as data
   from rel_viagens v join rel_viagem_passageiros p on p.viagem_id = v.id join rel_clientes c on c.id = p.cliente_id
  where v.status = 'ativa' and v.data_embarque >= rel_hoje() and c.arquivado_em is null
    and c.passaporte_validade is not null and c.passaporte_validade < coalesce(v.data_retorno, v.data_embarque) + interval '6 mons'
union all
 select 'sem_passaporte', 'media', c.id, v.id, c.nome || ': sem passaporte na ficha',
    'Embarca em ' || to_char(v.data_embarque, 'DD/MM/YYYY') || ' (' || v.titulo || ').', v.data_embarque
   from rel_viagens v join rel_viagem_passageiros p on p.viagem_id = v.id join rel_clientes c on c.id = p.cliente_id
  where v.status = 'ativa' and v.tipo = 'expedicao' and v.data_embarque between rel_hoje() and rel_hoje() + 180
    and c.passaporte is null and c.arquivado_em is null
union all
 select 'tarefa', 'alta', v.cliente_id, v.id, 'Esteira: ' || a.rotulo || ' atrasada',
    v.titulo || ' · prazo ' || to_char(a.prazo, 'DD/MM'), a.prazo
   from rel_esteira_atrasadas() a join rel_viagens v on v.id = a.viagem_id
union all
 select 'documentos', 'media', d.cliente_id, d.viagem_id, c.nome || ': documentos pedidos e não enviados',
    'Link criado em ' || to_char(d.criado_em, 'DD/MM') || '.', d.criado_em::date
   from rel_doc_pedidos d join rel_clientes c on c.id = d.cliente_id
  where d.concluido_em is null and d.criado_em < now() - interval '7 days' and d.expira_em > now()
    and not exists (select 1 from rel_documentos x where x.pedido_id = d.id)
union all
 select 'chamado', case when ch.prioridade in ('alta', 'urgente') then 'alta' else 'media' end, ch.cliente_id, ch.viagem_id,
    'Chamado #' || ch.numero || ': ' || ch.assunto,
    'Prazo era ' || to_char(ch.prazo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.', ch.prazo::date
   from rel_chamados ch
  where ch.status <> 'resolvido' and ch.prazo < now()
union all
 select 'aniversario', 'baixa', c.id, null::uuid, c.nome || ' faz aniversário em ' || to_char(c.nascimento, 'DD/MM'),
    'Boa hora pra uma mensagem.',
    make_date(extract(year from rel_hoje())::int, extract(month from c.nascimento)::int,
      case when to_char(c.nascimento, 'MM-DD') = '02-29' then 28 else extract(day from c.nascimento)::int end)
   from rel_clientes c
  where c.mesclado_em_id is null and c.arquivado_em is null and c.nascimento is not null
    and ((to_char(c.nascimento, 'MM-DD') >= to_char(rel_hoje(), 'MM-DD') and to_char(c.nascimento, 'MM-DD') <= to_char(rel_hoje() + 7, 'MM-DD'))
      or (to_char(rel_hoje() + 7, 'MM-DD') < to_char(rel_hoje(), 'MM-DD')
          and (to_char(c.nascimento, 'MM-DD') >= to_char(rel_hoje(), 'MM-DD') or to_char(c.nascimento, 'MM-DD') <= to_char(rel_hoje() + 7, 'MM-DD'))))
union all
 select 'embarque', 'baixa', v.cliente_id, v.id, v.titulo || ' embarca em ' || to_char(v.data_embarque, 'DD/MM'),
    (select count(*) from rel_viagem_passageiros p where p.viagem_id = v.id) || ' passageiro(s).', v.data_embarque
   from rel_viagens v
  where v.status = 'ativa' and v.data_embarque between rel_hoje() and rel_hoje() + 7;

-- ── h/i) KPIs de atendimento ───────────────────────────────────────────────
create or replace function rel_nome_equipe(p_id uuid) returns text
language sql stable set search_path = public as $$
  select regexp_replace(u.name, '\s*\|.*$', '')
         || case when u.role = 'financeiro' then ' (Financeiro)'
                 when u.role in ('operacoes', 'operações') then ' (Operações)' else '' end
    from qs_users u where u.id = p_id;
$$;
grant execute on function rel_nome_equipe(uuid) to authenticated;

create or replace function rel_kpi_atendimento(p_de timestamptz, p_ate timestamptz) returns jsonb
language sql stable set search_path = public as $$
with
espera as (
  -- sem autor (respondido no celular): o responsável da conversa; senão quem respondeu pelo QS mais perto
  select coalesce(s.atendente_id, c.atendente_id,
           (select m.autor_id from rel_wa_mensagens m where m.conversa_id = c.id and m.direcao = 'out' and m.autor_id is not null
             order by abs(extract(epoch from m.enviada_em - s.respondido_em)) limit 1)) atendente_id, s.minutos_uteis::numeric as m
    from rel_wa_sla s
    join rel_wa_conversas c on c.id = s.conversa_id
   where not c.sem_sla and s.respondido_em >= p_de and s.respondido_em < p_ate
),
msgs as (
  select m.conversa_id, m.direcao, m.origem, m.autor_id, m.enviada_em,
         case when lag(m.enviada_em) over w is null
                or m.enviada_em - lag(m.enviada_em) over w > interval '60 minutes' then 1 else 0 end as nova
    from rel_wa_mensagens m
    join rel_wa_conversas c on c.id = m.conversa_id
   where not c.sem_sla
     and coalesce(m.origem, '') not in ('historico', 'automatica')
     and m.enviada_em >= p_de - interval '1 day' and m.enviada_em < p_ate
  window w as (partition by m.conversa_id order by m.enviada_em)
),
sessoes_raw as (
  select *, sum(nova) over (partition by conversa_id order by enviada_em rows unbounded preceding) as sessao
    from msgs
),
sessoes as (
  select r.conversa_id, r.sessao,
         min(r.enviada_em) filter (where r.direcao = 'in') as primeira_in,
         max(r.enviada_em) filter (where r.direcao = 'out' and r.origem in ('qs', 'celular')) as ultima_resp,
         coalesce((array_agg(r.autor_id order by r.enviada_em desc) filter (where r.direcao = 'out' and r.origem in ('qs', 'celular') and r.autor_id is not null))[1],
                  max(c.atendente_id::text)::uuid) as atendente_id
    from sessoes_raw r join rel_wa_conversas c on c.id = r.conversa_id
   group by r.conversa_id, r.sessao
),
atend as (
  select atendente_id, extract(epoch from (ultima_resp - primeira_in)) / 60.0 as m
    from sessoes
   where primeira_in is not null and ultima_resp is not null and ultima_resp > primeira_in
     and primeira_in >= p_de and primeira_in < p_ate
),
tme_por as (
  select e.atendente_id, count(*) n, round(avg(m), 1) media,
         round((percentile_cont(0.5) within group (order by m))::numeric, 1) mediana
    from espera e group by e.atendente_id
),
tma_por as (
  select a.atendente_id, count(*) n, round(avg(m), 1) media,
         round((percentile_cont(0.5) within group (order by m))::numeric, 1) mediana
    from atend a group by a.atendente_id
)
select jsonb_build_object(
  'tme', (select jsonb_build_object('n', count(*), 'media', round(avg(m), 1),
                                    'mediana', round((percentile_cont(0.5) within group (order by m))::numeric, 1)) from espera),
  'tma', (select jsonb_build_object('n', count(*), 'media', round(avg(m), 1),
                                    'mediana', round((percentile_cont(0.5) within group (order by m))::numeric, 1)) from atend),
  'por_atendente', coalesce((
     select jsonb_agg(jsonb_build_object(
              'atendente_id', coalesce(t1.atendente_id, t2.atendente_id),
              'nome', rel_nome_equipe(coalesce(t1.atendente_id, t2.atendente_id)),
              'tme_n', coalesce(t1.n, 0), 'tme_media', t1.media, 'tme_mediana', t1.mediana,
              'tma_n', coalesce(t2.n, 0), 'tma_media', t2.media, 'tma_mediana', t2.mediana))
       from tme_por t1 full join tma_por t2 on coalesce(t1.atendente_id::text, '') = coalesce(t2.atendente_id::text, '')), '[]'::jsonb)
);
$$;

-- rel_kpi_atendimentos (0145): só o nome passa por rel_nome_equipe.
do $$
declare d text;
begin
  d := pg_get_functiondef('rel_kpi_atendimentos'::regproc);
  d := replace(d, '(select name from qs_users u where u.id = p.id) as nome', 'rel_nome_equipe(p.id) as nome');
  execute d;
end $$;

-- ── j) anexo grande direto no bucket ───────────────────────────────────────
create policy rel_envio_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'wa-midia' and (storage.foldername(name))[1] = 'rel-envio'
              and (rel_tem_acesso() or fin_tem_acesso()));

-- ── k) respostas prontas de partida ────────────────────────────────────────
insert into rel_wa_respostas (titulo, atalho, categoria, texto, criado_por) values
('Boas-vindas ao Relacionamento', 'boasvindas', 'Passagem de bastão',
 '{saudacao}, {nome}! Aqui é {atendente}, do Relacionamento da Se Tu For, Eu Vou. A partir de agora eu acompanho a sua viagem de perto: documentos, voos, check-in e o que precisar até a volta. Pode me chamar por aqui sempre que quiser 😊', null),
('Pedir documentos', 'docs', 'Revisão',
 '{nome}, pra deixar tudo certinho preciso de uma foto do seu passaporte (página com a foto) e do RG ou CNH. Se for viajar com mais alguém, manda dos acompanhantes também, por favor.', null),
('Conferência dos dados', 'conferir', 'Revisão',
 '{nome}, conferi sua reserva com o que foi combinado na venda. Pode confirmar se o nome está exatamente igual ao do passaporte e se as datas de ida e volta estão certas?', null),
('Faltam 30 dias', 'd30', 'D-30',
 '{saudacao}, {nome}! Falta 1 mês pra sua viagem ✈️ Passando pra saber se mudou alguma coisa nos seus planos e lembrar de conferir passaporte (6 meses de validade além da volta), vistos e vacinas exigidas no destino.', null),
('Faltam 7 dias', 'd7', 'D-7',
 '{nome}, falta 1 semana! Já está com tudo separado? Vou te mandar em seguida o resumo com voos, hotéis e contatos. Qualquer dúvida sobre bagagem ou documentos, me chama.', null),
('Faltam 3 dias', 'd3', 'D-3',
 '{nome}, faltam 3 dias! Confere comigo: passaporte na mão, documentos impressos ou no celular, seguro viagem e cartão liberado pra uso no exterior. Daqui a pouco abre o check-in e eu te aviso.', null),
('Check-in feito', 'checkin', 'Check-in',
 '{nome}, check-in feito ✅ Seus cartões de embarque vão em seguida. Chegue ao aeroporto com 3 horas de antecedência em voo internacional (2 horas no nacional).', null),
('Boa viagem', 'boaviagem', 'Em viagem',
 '{nome}, boa viagem! 🧳 Estou por aqui durante toda a viagem — se acontecer qualquer coisa (voo, hotel, passeio), é só me chamar neste número.', null),
('Como está a viagem', 'comoesta', 'Em viagem',
 '{saudacao}, {nome}! Passando pra saber como está a viagem. Está tudo certo com hotel e passeios? Se precisar de algo, me avisa.', null),
('Bem-vindo de volta', 'volta', 'Retorno',
 'Bem-vindo(a) de volta, {nome}! 🏡 Como foi a viagem? Conta pra gente o que mais gostou — e se tiver alguma coisa que poderia ter sido melhor, quero saber também.', null),
('Já vou verificar', 'verificar', 'Geral',
 '{nome}, recebi! Vou verificar e te retorno ainda hoje.', null),
('Fora do horário', 'fora', 'Geral',
 'Oi, {nome}! Recebemos sua mensagem. Nosso atendimento é de segunda a sexta, das 9h às 18h — te respondo assim que voltarmos. Se for emergência durante a viagem, escreva URGENTE que a gente prioriza.', null);
