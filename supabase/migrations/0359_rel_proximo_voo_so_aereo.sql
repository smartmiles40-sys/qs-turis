-- 0359_rel_proximo_voo_so_aereo.sql
-- -----------------------------------------------------------------------------
-- VIAGENS: "PRÓXIMO VOO" SÓ COM AÉREO DE VERDADE (Bruno, 11/11/2026):
--   "temos que ter sempre a data do Próximo voo atualizada; hoje tem serviço de
--    hotel que não tem voo (hospedagem) aparecendo; é muito importante que só
--    apareça o que realmente for aéreo".
--
-- A CAUSA: a sincronização do Bitrix grava, pra TODA venda com Data de Ida /
-- Data de Volta, dois trechos tipo voo_internacional (fonte = 'bitrix',
-- "Ida/Volta — data do Pós-Venda (Bitrix), horário a confirmar"). Numa venda de
-- HOTEL, seguro, passeio — ou com "Passagem Aérea: Não inclusa" no card — essas
-- datas são do check-in/check-out ou da cobertura, não de voo nenhum. A
-- rel_viagens_v (0152/0227) só olhava `tipo LIKE 'voo%'` e os tratava como voo.
-- SELECT de 11/11: 50 viagens ativas com "próximo voo" vindo dessas datas numa
-- venda sem aéreo (3 hotel, 12 sem classificação, 5 pacote e 30 expedição com
-- "Passagem Aérea: Não inclusa") — ex.: "Osaka" (hotel, deal 53771) com
-- próximo voo 26/11 "Reserva de hotel via Hoteldo…→Osaka".
--
-- O CONSERTO:
--   rel_venda_tem_aereo(servico, bitrix_dados) — a venda tem aéreo nosso?
--     • serviço "aereo"                                   → sim
--     • hotel, passeio, seguro, concierge, conta liminar, outro → não
--     • "Passagem Aérea" do card = "Não inclusa"           → não
--     • "Passagem Aérea" = "Inclusa"                       → sim
--     • pacote / expedição sem a informação                → sim (como antes)
--     • resto (sem classificação, cruzeiro sem informação) → não
--   A data do Bitrix (fonte = 'bitrix') só vale como voo quando a venda tem
--   aéreo. Voo de verdade (Expedições / IA / à mão: tem nº, horário) vale
--   SEMPRE — inclusive numa venda de hotel (ex.: extensão com voo da AA).
--
--   rel_viagens_v: mesma definição VIGENTE (0227) com a regra acima nos voos
--     (voos_total/feitos, ida/volta reais, próximo voo). Nova no fim:
--     aereo_vendido.
--   rel_trechos_v: mesma definição VIGENTE (0227) + no fim:
--     viagem_aereo_vendido, conta_como_voo (o trecho é um voo que vale pra
--     viagem — mesma régua do próximo voo: aéreo de verdade, não cancelado,
--     dentro da janela da viagem, e a data do Bitrix só quando a venda tem
--     aéreo e não há voo de verdade). A aba CHECK-INS usa essa coluna.
--
-- "Sempre atualizado": nada é gravado — a view calcula com now() a cada
-- leitura (o próximo voo anda sozinho quando um voo decola).
--
-- O front degrada sem esta migration (usa o serviço da venda pra decidir).
-- Idempotente (create or replace; colunas novas só no fim; security_invoker).
-- -----------------------------------------------------------------------------

create or replace function rel_venda_tem_aereo(p_servico text, p_bitrix jsonb)
returns boolean language sql stable set search_path = public as $$
  with pa as (
    select lower(trim(coalesce(
      (select e.value from jsonb_each_text(coalesce(p_bitrix, '{}'::jsonb)) e
        where e.key like '%UF_CRM_1770124038221%' limit 1), ''))) as txt
  )
  select case
    when p_servico = 'aereo' then true
    when p_servico in ('hospedagem', 'passeio', 'seguro', 'concierge', 'conta_liminar', 'outro') then false
    when (select txt from pa) ~ '^n[aã]o' then false
    when (select txt from pa) like 'inclu%' then true
    when p_servico in ('pacote', 'expedicao') then true
    else false
  end;
$$;

comment on function rel_venda_tem_aereo(text, jsonb) is
  '0359: a venda tem aéreo vendido por nós? (serviço + "Passagem Aérea" do card do Bitrix). Decide se a data de ida/volta do Bitrix conta como voo.';

-- O voo cabe na janela da viagem [embarque − 10 dias, volta + 60 dias]? (mesma régua da 0152)
create or replace function rel_voo_na_janela(p_partida timestamptz, p_embarque date, p_retorno date)
returns boolean language sql stable set search_path = public as $$
  select p_embarque is null
      or (p_partida at time zone 'America/Sao_Paulo')::date
         between p_embarque - 10 and greatest(coalesce(p_retorno, p_embarque), p_embarque) + 60;
$$;

create or replace view rel_viagens_v with (security_invoker = true) as
 SELECT v.id,
    v.titulo,
    v.destino,
    v.expedicao,
    v.tipo,
    v.data_venda,
    v.data_embarque,
    v.data_retorno,
    v.valor,
    v.qtd_passageiros,
    v.cliente_id,
    v.responsavel_id,
    v.bitrix_deal_id,
    v.status,
    v.observacoes,
    v.necessidades,
    v.origem,
    v.criado_em,
    v.atualizado_em,
    c.nome AS cliente_nome,
    c.telefone AS cliente_telefone,
    u.name AS responsavel_nome,
        CASE
            WHEN (v.status = 'cancelada'::text) THEN 'cancelada'::text
            WHEN ((v.fase_manual IS NOT NULL) AND ((v.fase_manual_ate IS NULL) OR (rel_hoje() <= v.fase_manual_ate))) THEN v.fase_manual
            WHEN (iv.ida IS NULL) THEN 'sem_data'::text
            WHEN (rel_hoje() < iv.ida) THEN 'antes'::text
            WHEN (rel_hoje() <= iv.volta) THEN 'em_viagem'::text
            ELSE 'concluida'::text
        END AS fase,
    (v.data_embarque - rel_hoje()) AS dias_para_embarque,
    (( SELECT count(*) AS count
           FROM rel_viagem_passageiros p
          WHERE (p.viagem_id = v.id)))::integer AS passageiros,
    (( SELECT count(*) AS count
           FROM rel_viagem_tarefas t
          WHERE ((t.viagem_id = v.id) AND (t.feita_em IS NULL) AND (t.prazo < rel_hoje()))))::integer AS tarefas_atrasadas,
    (( SELECT count(*) AS count
           FROM rel_viagem_tarefas t
          WHERE ((t.viagem_id = v.id) AND (t.feita_em IS NULL))))::integer AS tarefas_pendentes,
    (( SELECT count(*) AS count
           FROM rel_viagem_tarefas t
          WHERE (t.viagem_id = v.id)))::integer AS tarefas_total,
    COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)) AS servico,
    rel_acompanhamento(COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados))) AS acompanhamento,
    v.servico_manual,
    COALESCE(vo.total, 0) AS voos_total,
    COALESCE(vo.feitos, 0) AS voos_feitos,
    px.partida_em AS proximo_voo_em,
    px.partida_fuso AS proximo_voo_fuso,
    px.trecho AS proximo_voo_trecho,
    px.numero AS proximo_voo_numero,
    px.sem_hora AS proximo_voo_sem_hora,
    vo.ultimo_em AS ultimo_voo_em,
        CASE
            WHEN (v.status = 'cancelada'::text) THEN 'cancelada'::text
            WHEN (iv.ida IS NULL) THEN 'sem_data'::text
            WHEN (rel_hoje() < iv.ida) THEN 'antes'::text
            WHEN (rel_hoje() <= iv.volta) THEN 'em_viagem'::text
            ELSE 'concluida'::text
        END AS fase_auto,
    v.fase_manual,
    v.fase_manual_motivo,
    v.fase_manual_por,
    v.fase_manual_em,
    v.fase_manual_ate,
    iv.ida AS ida_real,
    iv.volta AS volta_real,
    COALESCE(vo.internos, 0) AS voos_internos,
    v.alertas_ignorados,
    -- 0359: a venda tem aéreo? (decide se a data do Bitrix conta como voo)
    r.aereo AS aereo_vendido
   FROM (((((((rel_viagens v
     LEFT JOIN rel_clientes c ON ((c.id = v.cliente_id)))
     LEFT JOIN qs_users u ON ((u.id = v.responsavel_id)))
     CROSS JOIN LATERAL ( SELECT (v.data_embarque - 10) AS de,
            (GREATEST(COALESCE(v.data_retorno, v.data_embarque), v.data_embarque) + 60) AS ate,
            (EXISTS ( SELECT 1
                   FROM rel_viagem_trechos x
                  WHERE ((x.viagem_id = v.id) AND (x.tipo ~~ 'voo%'::text) AND (x.partida_em IS NOT NULL) AND (x.fonte IS DISTINCT FROM 'bitrix'::text) AND (x.status_manual IS DISTINCT FROM 'cancelado'::text) AND ((v.data_embarque IS NULL) OR ((((x.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date >= (v.data_embarque - 10)) AND (((x.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date <= (GREATEST(COALESCE(v.data_retorno, v.data_embarque), v.data_embarque) + 60))))))) AS tem_real,
            rel_venda_tem_aereo(COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)), v.bitrix_dados) AS aereo) r)
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS total,
            (count(*) FILTER (WHERE d.voado))::integer AS feitos,
            (count(*) FILTER (WHERE (d.tipo = 'voo_interno'::text)))::integer AS internos,
            min(((d.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date) AS primeiro_dia,
            max(((COALESCE(d.chegada_em, d.partida_em) AT TIME ZONE 'America/Sao_Paulo'::text))::date) AS ultimo_dia,
            max(COALESCE(d.chegada_em, d.partida_em)) AS ultimo_em
           FROM ( SELECT DISTINCT ON (t.partida_em, COALESCE(t.numero, ((t.origem || '>'::text) || t.destino))) t.partida_em,
                    t.chegada_em,
                    t.tipo,
                    ((t.status_manual = 'voado'::text) OR (
                        CASE
                            WHEN ((t.fonte = 'bitrix'::text) OR (to_char((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text), 'HH24:MI'::text) = '00:00'::text)) THEN (t.partida_em + '1 day'::interval)
                            ELSE t.partida_em
                        END <= now())) AS voado
                   FROM rel_viagem_trechos t
                  WHERE ((t.viagem_id = v.id) AND (t.tipo ~~ 'voo%'::text) AND (t.partida_em IS NOT NULL) AND (t.status_manual IS DISTINCT FROM 'cancelado'::text)
                    -- 0359: a data do Bitrix só é voo quando a venda tem aéreo (e não há o voo de verdade)
                    AND ((t.fonte IS DISTINCT FROM 'bitrix'::text) OR ((NOT r.tem_real) AND r.aereo))
                    AND ((v.data_embarque IS NULL) OR ((((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date >= r.de) AND (((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date <= r.ate))))
                  ORDER BY t.partida_em, COALESCE(t.numero, ((t.origem || '>'::text) || t.destino)), (t.status_manual = 'voado'::text) DESC) d
         HAVING ((count(*) > 0) AND ((v.data_embarque IS NOT NULL) OR ((max(((d.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date) - min(((d.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date)) <= 60)))) vo ON (true))
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (vo.primeiro_dia IS NULL) THEN v.data_embarque
                    WHEN ((v.data_embarque IS NULL) OR (vo.primeiro_dia <= (v.data_embarque + 2))) THEN vo.primeiro_dia
                    ELSE v.data_embarque
                END AS ida,
                CASE
                    WHEN (vo.ultimo_dia IS NULL) THEN COALESCE(v.data_retorno, v.data_embarque)
                    WHEN ((COALESCE(v.data_retorno, v.data_embarque) IS NULL) OR (vo.ultimo_dia >= (COALESCE(v.data_retorno, v.data_embarque) - 2))) THEN vo.ultimo_dia
                    ELSE COALESCE(v.data_retorno, v.data_embarque)
                END AS volta0) iv0)
     CROSS JOIN LATERAL ( SELECT iv0.ida,
            GREATEST(iv0.volta0, iv0.ida) AS volta) iv)
     LEFT JOIN LATERAL ( SELECT t.partida_em,
            t.partida_fuso,
            t.numero,
            NULLIF(concat_ws('→'::text, rel_ponta_voo(t.origem_codigo, t.origem), rel_ponta_voo(t.destino_codigo, t.destino)), ''::text) AS trecho,
            ((t.fonte = 'bitrix'::text) OR (to_char((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text), 'HH24:MI'::text) = '00:00'::text)) AS sem_hora
           FROM rel_viagem_trechos t
          WHERE ((t.viagem_id = v.id) AND (t.tipo ~~ 'voo%'::text) AND (t.status_manual IS NULL) AND (
                CASE
                    WHEN ((t.fonte = 'bitrix'::text) OR (to_char((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text), 'HH24:MI'::text) = '00:00'::text)) THEN (t.partida_em + '1 day'::interval)
                    ELSE t.partida_em
                END > now())
            -- 0359: idem
            AND ((t.fonte IS DISTINCT FROM 'bitrix'::text) OR ((NOT r.tem_real) AND r.aereo))
            AND ((v.data_embarque IS NULL) OR ((((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date >= r.de) AND (((t.partida_em AT TIME ZONE 'America/Sao_Paulo'::text))::date <= r.ate))))
          ORDER BY t.partida_em, t.id
         LIMIT 1) px ON ((vo.total IS NOT NULL)));

create or replace view rel_trechos_v with (security_invoker = true) as
 SELECT t.id,
    t.viagem_id,
    t.tipo,
    t.descricao,
    t.origem,
    t.destino,
    t.partida_em,
    t.chegada_em,
    t.companhia,
    t.numero,
    t.localizador,
    t.checkin_abre_em,
    t.checkin_feito_em,
    t.checkin_feito_por,
    t.criado_por,
    t.criado_em,
    t.ref_externa,
    t.fonte,
    t.ia_confianca,
    t.documento_id,
    t.origem_codigo,
    t.destino_codigo,
    t.partida_fuso,
    t.chegada_fuso,
    t.terminal_partida,
    t.terminal_chegada,
    t.classe,
    t.bagagem,
    t.assento,
    t.numero_bilhete,
    t.passageiros,
    t.ponto_encontro,
    t.contato,
    t.endereco,
    t.observacoes,
    COALESCE(t.checkin_abre_em,
        CASE
            WHEN (t.tipo = ANY (ARRAY['voo_internacional'::text, 'voo_interno'::text])) THEN (t.partida_em - '48:00:00'::interval)
            WHEN (t.tipo = 'trem'::text) THEN (t.partida_em - '24:00:00'::interval)
            ELSE NULL::timestamp with time zone
        END) AS checkin_em,
    v.tipo AS viagem_tipo,
    v.titulo AS viagem_titulo,
    v.destino AS viagem_destino,
    v.expedicao,
    v.status AS viagem_status,
    t.status_manual,
    t.status_manual_motivo,
    t.status_manual_por,
    t.status_manual_em,
    t.corrigido_em,
    t.corrigido_por,
    -- 0359
    a.aereo AS viagem_aereo_vendido,
    ((t.tipo = ANY (ARRAY['voo_internacional'::text, 'voo_interno'::text]))
      AND (t.status_manual IS DISTINCT FROM 'cancelado'::text)
      AND rel_voo_na_janela(t.partida_em, v.data_embarque, v.data_retorno)
      AND ((t.fonte IS DISTINCT FROM 'bitrix'::text)
           OR (a.aereo AND NOT EXISTS (
                 SELECT 1 FROM rel_viagem_trechos x
                  WHERE x.viagem_id = t.viagem_id AND x.tipo ~~ 'voo%'::text
                    AND x.fonte IS DISTINCT FROM 'bitrix'::text
                    AND x.status_manual IS DISTINCT FROM 'cancelado'::text
                    AND rel_voo_na_janela(x.partida_em, v.data_embarque, v.data_retorno))))) AS conta_como_voo
   FROM (rel_viagem_trechos t
     JOIN rel_viagens v ON ((v.id = t.viagem_id)))
     CROSS JOIN LATERAL (SELECT rel_venda_tem_aereo(COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)), v.bitrix_dados) AS aereo) a;

-- Conferência (rodar depois de aplicar; o 1º deve dar 0):
--   select count(*) from rel_viagens_v where proximo_voo_em is not null and proximo_voo_sem_hora and not aereo_vendido;
--   select servico, count(*) filter (where proximo_voo_em is not null) from rel_viagens_v where status = 'ativa' group by 1;

-- Volta:
--   Recriar rel_viagens_v e rel_trechos_v como estão na 0227 (CREATE OR REPLACE
--   não tira coluna: antes, `drop view rel_trechos_v; drop view rel_viagens_v;`
--   — conferir dependências com \d+ — e recriar pela 0227), depois:
--   drop function if exists rel_voo_na_janela(timestamptz, date, date);
--   drop function if exists rel_venda_tem_aereo(text, jsonb);
