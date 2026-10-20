-- 0152_rel_proximo_voo.sql
-- -----------------------------------------------------------------------------
-- VIAGENS: A "IDA" ANDA COM OS VOOS (Bruno, 20/10/2026): "toda vez que o
-- cliente viajar, atualizar a coluna de ida e aparecer a próxima data que vai
-- ter outro voo … hoje parece que é um voo que já passou e não um voo futuro".
--
-- A view rel_viagens_v ganha, pelos voos de rel_viagem_trechos (tipo voo_*):
--   voos_total / voos_feitos       — voos distintos (o mesmo voo repetido por
--                                    passageiro conta uma vez)
--   proximo_voo_em / _fuso / _trecho / _numero / _sem_hora
--                                  — o 1º voo que ainda não decolou
--   ultimo_voo_em                  — chegada (ou partida) do último voo
-- e a FASE passa a respeitar os voos reais: a viagem começa no 1º voo (ou na
-- data de embarque, o que vier antes) e só termina depois do último voo (ou da
-- data de retorno, o que vier depois). Quem tem voo futuro não está "concluída".
--
-- Voo vindo do Bitrix só tem o DIA (00:00 em São Paulo) e o trecho genérico
-- ("São Paulo→Japão") — proximo_voo_sem_hora avisa a tela pra não mostrar hora.
-- Quando a viagem tem os voos de verdade (Expedições/IA/à mão), o ida/volta do
-- Bitrix é ignorado nessas contas (senão o mesmo voo sai em dobro). Só valem
-- voos entre embarque − 10 dias e retorno + 60 dias (há trecho perdido de
-- outra edição); sem data de embarque, só se os voos cabem em 60 dias.
--
-- Partiu da definição VIGENTE (0148); colunas novas só no fim; security_invoker.
-- -----------------------------------------------------------------------------

-- "São Paulo (GRU)" → "GRU"; sem código, o nome curto.
create or replace function rel_ponta_voo(p_codigo text, p_nome text) returns text
language sql immutable as $$
  select coalesce(nullif(upper(trim(p_codigo)), ''),
                  substring(coalesce(p_nome, '') from '\(([A-Za-z]{3})\)'),
                  nullif(trim(regexp_replace(coalesce(p_nome, ''), '\s*\(.*\)\s*', '', 'g')), ''));
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
            WHEN v.status = 'cancelada'::text THEN 'cancelada'::text
            WHEN v.data_embarque IS NULL AND vo.primeiro_dia IS NULL THEN 'sem_data'::text
            WHEN rel_hoje() < LEAST(v.data_embarque, vo.primeiro_dia) THEN 'antes'::text
            WHEN rel_hoje() <= GREATEST(COALESCE(v.data_retorno, v.data_embarque), vo.ultimo_dia) THEN 'em_viagem'::text
            ELSE 'concluida'::text
        END AS fase,
    v.data_embarque - rel_hoje() AS dias_para_embarque,
    (( SELECT count(*) AS count
           FROM rel_viagem_passageiros p
          WHERE p.viagem_id = v.id))::integer AS passageiros,
    (( SELECT count(*) AS count
           FROM rel_viagem_tarefas t
          WHERE t.viagem_id = v.id AND t.feita_em IS NULL AND t.prazo < rel_hoje()))::integer AS tarefas_atrasadas,
    (( SELECT count(*) AS count
           FROM rel_viagem_tarefas t
          WHERE t.viagem_id = v.id AND t.feita_em IS NULL))::integer AS tarefas_pendentes,
    (( SELECT count(*) AS count
           FROM rel_viagem_tarefas t
          WHERE t.viagem_id = v.id))::integer AS tarefas_total,
    COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)) AS servico,
    rel_acompanhamento(COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados))) AS acompanhamento,
    v.servico_manual,
    -- 0152: os voos
    COALESCE(vo.total, 0) AS voos_total,
    COALESCE(vo.feitos, 0) AS voos_feitos,
    px.partida_em AS proximo_voo_em,
    px.partida_fuso AS proximo_voo_fuso,
    px.trecho AS proximo_voo_trecho,
    px.numero AS proximo_voo_numero,
    px.sem_hora AS proximo_voo_sem_hora,
    vo.ultimo_em AS ultimo_voo_em
   FROM rel_viagens v
     LEFT JOIN rel_clientes c ON c.id = v.cliente_id
     LEFT JOIN qs_users u ON u.id = v.responsavel_id
     -- Os voos que VALEM pra viagem: dentro da janela [embarque − 10 dias,
     -- retorno + 60 dias] (tem trecho perdido de outra edição — ex. voo de 2025
     -- numa venda de 2027). Tem voo de verdade (Expedições / IA / à mão)? Então
     -- o "ida/volta" do Bitrix (só o dia, trecho genérico) não conta — senão o
     -- voo sai em dobro.
     CROSS JOIN LATERAL (
        SELECT v.data_embarque - 10 AS de,
               GREATEST(COALESCE(v.data_retorno, v.data_embarque), v.data_embarque) + 60 AS ate,
               EXISTS (SELECT 1 FROM rel_viagem_trechos x
                        WHERE x.viagem_id = v.id AND x.tipo LIKE 'voo%' AND x.partida_em IS NOT NULL
                          AND x.fonte IS DISTINCT FROM 'bitrix'
                          AND (v.data_embarque IS NULL OR (x.partida_em AT TIME ZONE 'America/Sao_Paulo')::date
                                 BETWEEN v.data_embarque - 10 AND GREATEST(COALESCE(v.data_retorno, v.data_embarque), v.data_embarque) + 60)) AS tem_real
     ) r
     LEFT JOIN LATERAL (
        SELECT count(*)::integer AS total,
               (count(*) FILTER (WHERE d.partida_em <= now()))::integer AS feitos,
               min((d.partida_em AT TIME ZONE 'America/Sao_Paulo')::date) AS primeiro_dia,
               max((COALESCE(d.chegada_em, d.partida_em) AT TIME ZONE 'America/Sao_Paulo')::date) AS ultimo_dia,
               max(COALESCE(d.chegada_em, d.partida_em)) AS ultimo_em
          FROM (SELECT DISTINCT ON (t.partida_em, COALESCE(t.numero, t.origem || '>' || t.destino)) t.partida_em, t.chegada_em
                  FROM rel_viagem_trechos t
                 WHERE t.viagem_id = v.id AND t.tipo LIKE 'voo%' AND t.partida_em IS NOT NULL
                   AND (t.fonte IS DISTINCT FROM 'bitrix' OR NOT r.tem_real)
                   AND (v.data_embarque IS NULL OR (t.partida_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN r.de AND r.ate)) d
        -- sem data de embarque: só confia nos voos se cabem numa viagem (≤ 60 dias)
        HAVING count(*) > 0
           AND (v.data_embarque IS NOT NULL
                OR max((d.partida_em AT TIME ZONE 'America/Sao_Paulo')::date) - min((d.partida_em AT TIME ZONE 'America/Sao_Paulo')::date) <= 60)
     ) vo ON true
     LEFT JOIN LATERAL (
        SELECT t.partida_em, t.partida_fuso, t.numero,
               NULLIF(concat_ws('→', rel_ponta_voo(t.origem_codigo, t.origem), rel_ponta_voo(t.destino_codigo, t.destino)), '') AS trecho,
               (t.fonte = 'bitrix' OR to_char(t.partida_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') = '00:00') AS sem_hora
          FROM rel_viagem_trechos t
         WHERE t.viagem_id = v.id AND t.tipo LIKE 'voo%' AND t.partida_em > now()
           AND (t.fonte IS DISTINCT FROM 'bitrix' OR NOT r.tem_real)
           AND (v.data_embarque IS NULL OR (t.partida_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN r.de AND r.ate)
         ORDER BY t.partida_em, t.id
         LIMIT 1
     ) px ON vo.total IS NOT NULL;
