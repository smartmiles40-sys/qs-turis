-- docs/correcoes-dados-0227.sql
-- -----------------------------------------------------------------------------
-- CORREÇÕES DE DADO RECOMENDADAS (auditoria de 30/10/2026 — docs/AUDITORIA-VIAGENS-30-10.md).
-- NÃO FOI RODADO. Decisão do Bruno, item por item.
--
-- Pré-requisito: a migration 0227 APLICADA (usa status_manual, corrigido_em e o
-- histórico rel_viagem_correcoes — assim cada mudança aparece na tela, no
-- "histórico de correções" da viagem, com o valor anterior e dá pra DESFAZER).
--
-- Como rodar: um bloco por vez, dentro de begin; … conferir os "returning" … commit;
-- Todos os blocos são idempotentes (só mexem se o dado ainda estiver errado).
--
-- O mais simples, e o recomendado, é corrigir PELA TELA (Viagens › a viagem ›
-- "Voos e check-ins"): os mesmos casos aparecem lá em "Não bate".
-- -----------------------------------------------------------------------------

-- Helper: registra no histórico como "script 0227" (feito_por vazio).
-- (cria e apaga no fim; não fica no banco)
create or replace function pg_temp.corrigir_trecho(p_trecho uuid, p_novo jsonb, p_motivo text, p_acao text default 'trecho_editado')
returns void language plpgsql as $$
declare t rel_viagem_trechos; antes jsonb; depois jsonb;
begin
  select * into t from rel_viagem_trechos where id = p_trecho for update;
  if not found then raise notice 'trecho % não existe mais — pulando', p_trecho; return; end if;
  antes := rel_trecho_restauravel(t);
  depois := antes || p_novo || jsonb_build_object('corrigido_em', now());
  -- idempotente: já está com o valor novo → não grava de novo
  if (antes - 'corrigido_em' - 'corrigido_por' - 'status_manual_em') = (depois - 'corrigido_em' - 'corrigido_por' - 'status_manual_em') then return; end if;
  perform rel_trecho_aplicar(p_trecho, depois);
  insert into rel_viagem_correcoes (viagem_id, trecho_id, acao, antes, depois, motivo)
  values (t.viagem_id, p_trecho, p_acao, antes, depois, p_motivo);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. CASO VINÍCIUS BARBOSA DE MELO (viagem a57b84fa…, Bitrix #521)
-- ═════════════════════════════════════════════════════════════════════════════
-- Por quê: a viagem é a Turquia & Grécia G2 de 05–17/06/2027, mas o card do
-- Pós-Venda #8759 (ligado a ela em rel_viagem_deals) tem "Data de Ida" 21/03/2026 e
-- "Data de Volta" 29/03/2026 — de outra viagem (ou preenchido errado). A 0134b
-- transformou essas datas em 2 voos (fonte bitrix, ref bx-pv:…), e o quadro de
-- partidas, sem voo futuro, mostrava "o 1º voo da viagem" = 21/03/2026.
-- Correção: os 2 trechos viram CANCELADOS (saem de toda conta, ficam visíveis
-- apagados com o motivo). Não apaga: se o Bitrix for corrigido, o histórico explica.
begin;
select pg_temp.corrigir_trecho('92990d37-271d-44c5-9971-0bcca8cf5e13',
  jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Data do Pós-Venda #8759 (21/03/2026) é de outra viagem — viagem é 05–17/06/2027', 'status_manual_em', now()),
  'Auditoria 30/10: voo fora das datas da viagem', 'trecho_situacao');
select pg_temp.corrigir_trecho('850d6d05-66a4-42f9-b230-3701390726f2',
  jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Data do Pós-Venda #8759 (29/03/2026) é de outra viagem — viagem é 05–17/06/2027', 'status_manual_em', now()),
  'Auditoria 30/10: voo fora das datas da viagem', 'trecho_situacao');
-- Por quê: é EXPEDIÇÃO (ligada à TURGRE-2027-06 em expedicoes_id), mas o Bitrix diz
-- "Tipo de venda: Pacotes de Viagens" → caiu no quadro de PACOTES como "pendente
-- de checagem". O serviço manual põe no quadro das expedições.
update rel_viagens set servico_manual = 'expedicao', servico_em = now()
 where id = 'a57b84fa-49b9-4ed2-b4cf-7adec4b6afa9' and servico_manual is distinct from 'expedicao'
returning id, titulo, servico_manual;
commit;
-- FORA DO QS: corrigir as datas no card #8759 do Bitrix (senão outra tela lê de novo).

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. VOO DO PÓS-VENDA COM O ANO ERRADO (a data +1/+2 anos cai certinho na viagem)
-- ═════════════════════════════════════════════════════════════════════════════
-- Por quê: a "Data de Volta" do card do Pós-Venda foi digitada com o ano anterior.
-- Com o ano certo, a volta bate com a turma (conferido com a tabela expedicoes).
-- Corrige a data do trecho (corrigido à mão = a sincronização não volta com a errada).
begin;
-- Eduardo Regis (Tailândia 17/11–03/12/2026): volta 02/12/2025 → 02/12/2026
select pg_temp.corrigir_trecho('05693383-8e31-42ce-9ae0-86a00245a2b2', jsonb_build_object('partida_em', '2026-12-02 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2025 → 2026)');
-- Livia Laura (Japão, embarque 26/10/2026, sem volta): volta 12/11/2025 → 12/11/2026 (Japão & China out/nov 2026 volta 12/11)
select pg_temp.corrigir_trecho('0fb13eea-0bca-4f2d-9af8-1200e00f8b6c', jsonb_build_object('partida_em', '2026-11-12 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2025 → 2026)');
-- Cleusa / Gislea / Lidiane (Tailândia G1 2027, 06–21/11/2027): volta 21/11/2026 → 21/11/2027
select pg_temp.corrigir_trecho('1c59c65e-cd92-46cb-84fa-4d46a7bb8bd3', jsonb_build_object('partida_em', '2027-11-21 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2026 → 2027)');
select pg_temp.corrigir_trecho('94681be6-e3fc-4b09-96a1-fd222a6ffdde', jsonb_build_object('partida_em', '2027-11-21 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2026 → 2027)');
select pg_temp.corrigir_trecho('06a6f4b4-dca6-4875-b8cd-24f2d484eba5', jsonb_build_object('partida_em', '2027-11-21 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2026 → 2027)');
-- Patrícia Freitas (Turquia G4 2027, 26/06–08/07/2027): volta 08/07/2026 → 08/07/2027
select pg_temp.corrigir_trecho('6f9a98ad-02cc-467f-9927-2eacc76a30f7', jsonb_build_object('partida_em', '2027-07-08 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2026 → 2027)');
-- Roberta Nayara (Egito 2027, 16–29/09/2027): volta 29/09/2026 → 29/09/2027
select pg_temp.corrigir_trecho('cb7c1321-d2cc-42f9-921f-8cb402559f15', jsonb_build_object('partida_em', '2027-09-29 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2026 → 2027)');
-- Delia (China out/2027, embarque 16/10/2027): volta 31/10/2026 → 31/10/2027  [CONFERIR: a turma CHI-2027 volta 24/10]
select pg_temp.corrigir_trecho('9f575c63-713f-4dd9-a1e3-e0f9a7d06212', jsonb_build_object('partida_em', '2027-10-31 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2026 → 2027)');
-- Waldo Pancieri (Japão & China out/2027, 14–31/10/2027): volta 30/10/2025 → 30/10/2027 (+2 anos)
select pg_temp.corrigir_trecho('9a0e04bf-916d-4cf0-987e-441bf52144f2', jsonb_build_object('partida_em', '2027-10-30 00:00:00-03'), 'Auditoria 30/10: ano errado no Pós-Venda (2025 → 2027)');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. VOO DO PÓS-VENDA QUE NÃO É DESTA VIAGEM (nenhum ano bate) → CANCELADO
-- ═════════════════════════════════════════════════════════════════════════════
-- Por quê: a data não cabe na viagem nem trocando o ano (volta antes do
-- embarque, ou meses longe). Sai das contas; fica visível com o motivo.
-- Cada uma vale conferir no card do Bitrix — a tela mostra "Não bate".
begin;
-- Bruna Eduarda (Tailândia 17/11/2026): volta 02/11/2026, antes do embarque
select pg_temp.corrigir_trecho('e47b900a-4a23-4e7a-8de7-7df6aa500363', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 02/11/2026 antes do embarque 17/11/2026', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
-- Marina Almeida (Tailândia 18/11/2026): volta 07/11/2026, antes do embarque
select pg_temp.corrigir_trecho('bfc8a4b0-0cef-41b9-a770-c409e523685c', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 07/11/2026 antes do embarque 18/11/2026', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
-- João da Costa (Escandinávia 14–29/01/2027): volta 29/06/2026 — outra viagem
select pg_temp.corrigir_trecho('5f845f25-5bd2-4476-88bf-30c1cc6cfb4d', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 29/06/2026 é de outra viagem (Escandinávia é jan/2027)', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
-- Massako Sakai (Japão & China G2 abr/2027, 26/03/2027): volta 11/03/2027, antes do embarque
select pg_temp.corrigir_trecho('193b955a-a0cb-4d40-8da8-a53eaa7535dd', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 11/03/2027 antes do embarque 26/03/2027', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
-- Eugênio Francisco (Japão & China G1 abr/2027): volta 13/06/2026 — outra viagem
select pg_temp.corrigir_trecho('88919803-d323-4774-8254-77e5bddcfca9', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 13/06/2026 é de outra viagem', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
-- Roselene Pereira (Japão & China out/2027): volta 30/07/2026 — outra viagem
select pg_temp.corrigir_trecho('d51d1341-6bdf-4286-bc32-5fd0caa7aba9', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 30/07/2026 é de outra viagem', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
-- Luiz Cláudio (BKK, 13/04/2028): volta 28/11/2026 — outra viagem
select pg_temp.corrigir_trecho('67cba6ba-94c2-416a-9657-0293ef1822dd', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 28/11/2026 é de outra viagem (embarque 13/04/2028)', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
-- Ginel Correa ("Pereira", 13/12/2027): volta 02/02/2027, antes do embarque [CONFERIR: talvez 02/02/2028]
select pg_temp.corrigir_trecho('a364fa71-b69b-4165-b305-da9f5e19e197', jsonb_build_object('status_manual', 'cancelado', 'status_manual_motivo', 'Volta 02/02/2027 antes do embarque 13/12/2027', 'status_manual_em', now()), 'Auditoria 30/10: voo fora das datas', 'trecho_situacao');
commit;
-- NÃO incluídos (precisam de alguém olhar): Consuelo de Oliveira — três vendas
-- sobrepostas ("Peru/ Mai 2026" com datas e voos do Japão de out/2026, "PEK/BKK"
-- e "Japão/ Out 2026" com voo de 25/10/2026 do Bitrix E da IA). Corrigir pela tela.

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. DATA DE EMBARQUE ERRADA (venda da família Sobreira)
-- ═════════════════════════════════════════════════════════════════════════════
-- Por quê: Marlon Sobreira "Madri" com ida 29/08/2026 e volta 08/11/2026 (71 dias,
-- "em viagem" desde agosto, sem nenhum voo). O pacote da família (PAC-ESP-SOBREIRA)
-- é 29/10–08/11/2026 e as outras 15 vendas da família estão em 29/10. É o mês errado.
-- Trava as datas (datas_travadas) pro Bitrix não voltar com 29/08.
begin;
with v as (select * from rel_viagens where id = '2d82de64-cbad-4c27-b778-f5d27dbc79ea' and data_embarque = '2026-08-29' for update),
d as (
  insert into rel_viagem_correcoes (viagem_id, acao, antes, depois, motivo)
  select v.id, 'datas', rel_viagem_restauravel(v), rel_viagem_restauravel(v) || jsonb_build_object('data_embarque', '2026-10-29', 'datas_travadas', true),
         'Auditoria 30/10: ida 29/08 é 29/10 (pacote da família Sobreira 29/10–08/11)'
    from v returning viagem_id)
update rel_viagens set data_embarque = '2026-10-29', datas_travadas = true
 where id in (select viagem_id from d)
returning id, titulo, data_embarque, data_retorno;
commit;
-- E a irmã: Mirian Sobreira "Madri/Barcelona" com ida 29/11/2026 e volta do Pós-Venda
-- 08/11/2026 — a ida certa é 29/10 (mesmo erro, mês trocado pra frente).
begin;
with v as (select * from rel_viagens where id = 'ef697701-eeb4-4c79-85d0-776a49b2c95b' and data_embarque = '2026-11-29' for update),
d as (
  insert into rel_viagem_correcoes (viagem_id, acao, antes, depois, motivo)
  select v.id, 'datas', rel_viagem_restauravel(v), rel_viagem_restauravel(v) || jsonb_build_object('data_embarque', '2026-10-29', 'data_retorno', '2026-11-08', 'datas_travadas', true),
         'Auditoria 30/10: ida 29/11 é 29/10 (pacote da família Sobreira 29/10–08/11)'
    from v returning viagem_id)
update rel_viagens set data_embarque = '2026-10-29', data_retorno = '2026-11-08', datas_travadas = true
 where id in (select viagem_id from d)
returning id, titulo, data_embarque, data_retorno;
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. PACOTES DO MÓDULO EXPEDIÇÕES QUE O RELACIONAMENTO NÃO ENXERGA
-- ═════════════════════════════════════════════════════════════════════════════
-- Por quê: PAC-ESP-SOBREIRA (28 pax, 3 voos) e PAC-EURO-LUANA (2 pax, 6 voos) estão
-- "Em andamento" no Expedições, mas as 17 vendas do Bitrix dessas pessoas não estão
-- ligadas a eles (rel_viagens.expedicoes_id vazio) → no Relacionamento aparecem
-- "em viagem" SEM voo nenhum. Liga pela pessoa (cliente_id) + data (±3 dias).
-- Depois de ligar, rodar a importação das Expedições (scripts/importar-expedicoes.mjs)
-- pra copiar os voos pros trechos.
begin;
update rel_viagens r set expedicoes_id = x.expedicao_id
  from (select distinct on (v.id) v.id, p.expedicao_id
          from rel_viagens v
          join passageiros p on p.cliente_id = v.cliente_id
          join expedicoes e on e.id = p.expedicao_id and abs(e.data_embarque - coalesce(v.data_embarque, e.data_embarque)) <= 3
         where v.expedicoes_id is null and v.status = 'ativa' and e.codigo in ('PAC-ESP-SOBREIRA', 'PAC-EURO-LUANA')
         order by v.id, e.data_embarque) x
 where r.id = x.id and r.expedicoes_id is null
returning r.id, r.titulo, r.expedicoes_id;   -- esperado: 17 linhas (16 Sobreira + Luana)
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. STATUS DAS EXPEDIÇÕES (tabela expedicoes) que não bate com as datas
-- ═════════════════════════════════════════════════════════════════════════════
-- Por quê: as 4 turmas da Tailândia de novembro estão "Em andamento" mas só
-- embarcam em 13 e 17/11. O cockpit já avisa (divergenciaStatus). "Em andamento"
-- deve ser o grupo viajando; antes disso é "Vendas Abertas" (ou o status de
-- preparação que o Ops usar). CONFERIR com a Operações antes — pode ser que eles
-- usem "Em andamento" como "operação em curso".
-- update expedicoes set status = 'Vendas Abertas'
--  where codigo in ('TAI-G1-2026-11', 'TAI-G2-2026-11', 'TAI-G3-2026-11', 'TAI-G4-2026-11')
--    and status = 'Em andamento' and data_embarque > current_date
-- returning codigo, status;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. SÓ CONFERIR (sem SQL — o dado certo não está no QS)
-- ═════════════════════════════════════════════════════════════════════════════
-- • Ano no nome ≠ ano da data (o nome vem do Bitrix; corrigir LÁ):
--     "Japão e China/ Out 2027" com datas 26/10–13/11/2026 (Thaize, Tuanny, Aline — estão viajando AGORA, o nome está errado);
--     "Tailandia/ Nov 2027" com datas 17/11–02/12/2026 (Indianara, Alessandra, Elaine, Fabiana — nome OU data errados);
--     "Japão/ Out 2026" com datas 14–31/10/2027 (Rosicler) e "Egito/ Out 2026" com 14–30/10/2027 (Silvia).
-- • Mayara Felix "Fortaleza" 11/12/2026 → 15/03/2027 (95 dias).
-- • 23 expedições e 4 pacotes ativos sem data de volta (fase depende só dos voos).
-- • Duplicadas: 14 pessoas com a venda do Bitrix + a do Expedições na mesma saída
--   (esperado — o painel já conta uma vez); 13 com DUAS vendas do Bitrix iguais
--   (ex.: Ana Claudia Greco "Itália/ Set 2027" ×2) → Viagens › Repetidas.
-- • Turma divergente: Adriana Palhano — Bitrix "Turquia G3/ Jun 2027", Expedições G2.
