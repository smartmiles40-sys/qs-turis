// scripts/local-postgres/teste-ponte-posvenda.mjs
// -----------------------------------------------------------------------------
// Prova LOCAL (Postgres 17 de verdade, sem tocar no Supabase) das migrations da
// ponte pós-venda 0385–0389: aplica duas vezes (idempotência) sobre o
// esqueleto-ponte-posvenda.sql e roda os cenários do "todos os setores se conversam".
//
// Uso: cd scripts/local-postgres && npm ci && node teste-ponte-posvenda.mjs
// -----------------------------------------------------------------------------
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const PORTA = 54331;
const MIGS = ['0385_ponte_exp_voos_datas_rel.sql', '0386_ponte_pax_viagem_rel.sql', '0387_ponte_pax_financeiro.sql',
  '0388_ponte_venda_pos_consolidacao.sql', '0389_ponte_closer_prefs_perfil.sql'];

const dataDir = path.join(AQUI, '.dados-ponte');
fs.rmSync(dataDir, { recursive: true, force: true });
const srv = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORTA, persistent: false });
await srv.initialise();
await srv.start();
const adm = new pg.Client({ host: 'localhost', port: PORTA, user: 'postgres', password: 'postgres', database: 'postgres' });
await adm.connect();
await adm.query(`create database ponte with encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
await adm.end();
const db = new pg.Client({ host: 'localhost', port: PORTA, user: 'postgres', password: 'postgres', database: 'ponte' });
await db.connect();
const avisos = [];
db.on('notice', (n) => avisos.push(n.message));
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => (await q(sql, p))[0];

let ok = 0;
async function cenario(nome, fn) {
  try { await fn(); ok++; console.log(`  ✓ ${nome}`); }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); console.log(avisos.slice(-5).join('\n')); process.exitCode = 1; }
}

try {
  await db.query(fs.readFileSync(path.join(AQUI, 'esqueleto-ponte-posvenda.sql'), 'utf8'));
  for (const m of MIGS) {
    const sql = fs.readFileSync(path.join(REPO, 'supabase', 'migrations', m), 'utf8');
    await db.query(sql); await db.query(sql);
    console.log(`aplicada 2x: ${m}`);
  }

  // ── dados base ──
  const { id: exp } = await um(`insert into expedicoes (nome, destino, data_embarque, data_retorno, status)
    values ('Egito 2027', 'Egito', '2027-09-16', '2027-09-28', 'Vendas Abertas') returning id`);
  const voo = async (partida, origem, destino, extra = {}) => (await um(
    `insert into expedicao_voos (expedicao_id, trecho, companhia, numero_voo, origem, destino, partida, chegada, grupo_id, passageiro_id)
     values ($1, 'Ida', 'EK', 'EK262', $2, $3, $4, $5, $6, $7) returning id`,
    [exp, origem, destino, partida, extra.chegada ?? null, extra.grupo ?? null, extra.pax ?? null])).id;
  const v1 = await voo('16/09/2027 01h05', 'São Paulo (GRU)', 'Dubai (DXB)', { chegada: '16/09/2027 23h00' });
  const v2 = await voo('17/09 08:15', 'Dubai (DXB)', 'Cairo (CAI)');
  const { id: ana } = await um(`insert into rel_clientes (nome) values ('Ana') returning id`);
  const { id: bia } = await um(`insert into rel_clientes (nome) values ('Bia') returning id`);

  let paxAna;
  await cenario('passageiro confirmado ganha viagem, vínculo e voos no fuso certo', async () => {
    paxAna = (await um(`insert into passageiros (expedicao_id, nome_completo, status_reserva, tipo, cliente_id, valor_contratado_brl)
      values ($1, 'Ana', 'Confirmado', 'Pagante', $2, 20000) returning id`, [exp, ana])).id;
    const x = await um(`select * from rel_expedicoes_vinculo where passageiro_id = $1`, [paxAna]);
    assert.ok(x?.viagem_id, 'sem vínculo');
    const v = await um(`select * from rel_viagens where id = $1`, [x.viagem_id]);
    assert.equal(v.origem, 'expedicoes'); assert.equal(v.expedicoes_id, exp);
    const t = await q(`select ref_externa, partida_em, partida_fuso, chegada_em from rel_viagem_trechos where viagem_id = $1 order by partida_em`, [x.viagem_id]);
    assert.equal(t.length, 2);
    assert.equal(new Date(t[0].partida_em).toISOString(), '2027-09-16T04:05:00.000Z');
    assert.equal(t[0].partida_fuso, '-03:00');
    assert.equal(new Date(t[0].chegada_em).toISOString(), '2027-09-16T19:00:00.000Z'); // 23h Dubai = 19h UTC
    assert.equal(new Date(t[1].partida_em).toISOString(), '2027-09-17T04:15:00.000Z'); // 08:15 Dubai, ano da expedição
    const ev = await q(`select motivo from rel_viagem_eventos where viagem_id = $1`, [x.viagem_id]);
    assert.ok(ev.some((e) => /entrou pela expedição/.test(e.motivo)), 'sem evento');
  });

  const viagemAna = async () => (await um(`select viagem_id from rel_expedicoes_vinculo where passageiro_id = $1`, [paxAna])).viagem_id;

  await cenario('editar a hora do voo atualiza o trecho; correção manual é respeitada', async () => {
    await q(`update expedicao_voos set partida = '16/09/2027 02h00' where id = $1`, [v1]);
    const t = await um(`select * from rel_viagem_trechos where ref_externa = $1`, ['exp-voo:' + v1]);
    assert.equal(new Date(t.partida_em).toISOString(), '2027-09-16T05:00:00.000Z');
    await q(`update rel_viagem_trechos set corrigido_em = now(), partida_em = '2027-09-16T06:00:00Z' where id = $1`, [t.id]);
    await q(`update expedicao_voos set partida = '16/09/2027 03h00' where id = $1`, [v1]);
    const t2 = await um(`select partida_em from rel_viagem_trechos where id = $1`, [t.id]);
    assert.equal(new Date(t2.partida_em).toISOString(), '2027-09-16T06:00:00.000Z');
  });

  await cenario('voo apagado vira trecho CANCELADO (não some); voltar desfaz', async () => {
    await q(`delete from expedicao_voos where id = $1`, [v2]);
    const t = await um(`select status_manual, status_manual_motivo from rel_viagem_trechos where ref_externa = $1`, ['exp-voo:' + v2]);
    assert.equal(t.status_manual, 'cancelado'); assert.match(t.status_manual_motivo, /^Expedições:/);
    await q(`insert into expedicao_voos (id, expedicao_id, origem, destino, partida) values ($1, $2, 'Dubai (DXB)', 'Cairo (CAI)', '17/09 08:15')`, [v2, exp]);
    const t2 = await um(`select status_manual from rel_viagem_trechos where ref_externa = $1`, ['exp-voo:' + v2]);
    assert.equal(t2.status_manual, null);
  });

  await cenario('mudar datas da expedição leva a viagem junto (sem datas_travadas)', async () => {
    await q(`update expedicoes set data_embarque = '2027-09-17', data_retorno = '2027-09-29' where id = $1`, [exp]);
    const v = await um(`select data_embarque::text, data_retorno::text from rel_viagens where id = $1`, [await viagemAna()]);
    assert.deepEqual(v, { data_embarque: '2027-09-17', data_retorno: '2027-09-29' });
    await q(`update rel_viagens set datas_travadas = true where id = $1`, [await viagemAna()]);
    await q(`update expedicoes set data_embarque = '2027-09-18' where id = $1`, [exp]);
    const v2 = await um(`select data_embarque::text from rel_viagens where id = $1`, [await viagemAna()]);
    assert.equal(v2.data_embarque, '2027-09-17');
    await q(`update rel_viagens set datas_travadas = false where id = $1`, [await viagemAna()]);
    await q(`update expedicoes set data_embarque = '2027-09-17' where id = $1`, [exp]);
  });

  await cenario('viagem do Bitrix com datas próprias não é mexida (evento conferir)', async () => {
    const { id: vb } = await um(`insert into rel_viagens (titulo, tipo, origem, cliente_id, data_embarque, data_retorno, expedicoes_id)
      values ('Egito Bitrix', 'expedicao', 'bitrix', $1, '2027-09-16', '2027-09-30', $2) returning id`, [bia, exp]);
    const { id: px } = await um(`insert into passageiros (expedicao_id, nome_completo, status_reserva, cliente_id) values ($1, 'Bia', 'Confirmado', $2) returning id`, [exp, bia]);
    assert.equal((await um(`select viagem_id from rel_expedicoes_vinculo where passageiro_id = $1`, [px])).viagem_id, vb, 'não reusou a viagem do Bitrix');
    await q(`update expedicoes set data_retorno = '2027-10-01' where id = $1`, [exp]);
    const v = await um(`select data_retorno::text from rel_viagens where id = $1`, [vb]);
    assert.equal(v.data_retorno, '2027-09-30');
    const ev = await q(`select motivo from rel_viagem_eventos where viagem_id = $1 and tipo = 'datas'`, [vb]);
    assert.ok(ev.some((e) => /NÃO mexi/.test(e.motivo)));
  });

  await cenario('Bitrix sem expedição ligada e embarque perto: liga, não duplica', async () => {
    const { id: cli } = await um(`insert into rel_clientes (nome) values ('Caio') returning id`);
    const { id: vb } = await um(`insert into rel_viagens (titulo, tipo, origem, cliente_id, data_embarque) values ('Egito', 'expedicao', 'bitrix', $1, '2027-09-15') returning id`, [cli]);
    const { id: px } = await um(`insert into passageiros (expedicao_id, nome_completo, status_reserva, cliente_id) values ($1, 'Caio', 'Pré-reserva', $2) returning id`, [exp, cli]);
    assert.equal((await um(`select viagem_id from rel_expedicoes_vinculo where passageiro_id = $1`, [px])).viagem_id, vb);
    assert.equal((await um(`select expedicoes_id from rel_viagens where id = $1`, [vb])).expedicoes_id, exp);
  });

  await cenario('passageiro cancelado: viagem de Expedições cancelada, voos cancelados, reconfirmar reativa', async () => {
    await q(`update passageiros set status_reserva = 'Cancelado' where id = $1`, [paxAna]);
    const vid = await viagemAna();
    assert.equal((await um(`select status from rel_viagens where id = $1`, [vid])).status, 'cancelada');
    const ts = await q(`select status_manual from rel_viagem_trechos where viagem_id = $1 and ref_externa like 'exp-voo:%' and corrigido_em is null`, [vid]);
    assert.ok(ts.length && ts.every((t) => t.status_manual === 'cancelado'));
    await q(`update passageiros set status_reserva = 'Confirmado' where id = $1`, [paxAna]);
    assert.equal((await um(`select status from rel_viagens where id = $1`, [vid])).status, 'ativa');
  });

  await cenario('passageiro trocou de expedição (G1 → G2): a viagem dele acompanha, sem duplicar', async () => {
    const { id: g2 } = await um(`insert into expedicoes (nome, data_embarque, data_retorno) values ('Egito 2027 G2', '2027-09-20', '2027-10-02') returning id`);
    await q(`insert into expedicao_voos (expedicao_id, origem, destino, partida) values ($1, 'São Paulo (GRU)', 'Cairo (CAI)', '20/09/2027 10:00')`, [g2]);
    const { id: cli } = await um(`insert into rel_clientes (nome) values ('Edu') returning id`);
    const { id: px } = await um(`insert into passageiros (expedicao_id, nome_completo, status_reserva, cliente_id) values ($1, 'Edu', 'Confirmado', $2) returning id`, [exp, cli]);
    const antes = (await um(`select viagem_id from rel_expedicoes_vinculo where passageiro_id = $1`, [px])).viagem_id;
    await q(`update passageiros set expedicao_id = $1 where id = $2`, [g2, px]);
    const x = await um(`select viagem_id, expedicao_id from rel_expedicoes_vinculo where passageiro_id = $1`, [px]);
    assert.equal(x.viagem_id, antes); assert.equal(x.expedicao_id, g2);
    const v = await um(`select expedicoes_id, status, data_embarque::text e from rel_viagens where id = $1`, [antes]);
    assert.equal(v.expedicoes_id, g2); assert.equal(v.status, 'ativa'); assert.equal(v.e, '2027-09-20');
    const ts = await q(`select status_manual, origem from rel_viagem_trechos where viagem_id = $1 order by partida_em`, [antes]);
    assert.ok(ts.some((t) => t.origem === 'São Paulo (GRU)' && t.status_manual === null && true));
    assert.equal((await um(`select count(*)::int n from rel_viagens where cliente_id = $1`, [cli])).n, 1);
  });

  await cenario('passageiro apagado no Ops: viagem de Expedições cancelada (nada apagado)', async () => {
    const { id: cli } = await um(`insert into rel_clientes (nome) values ('Fabi') returning id`);
    const { id: px } = await um(`insert into passageiros (expedicao_id, nome_completo, status_reserva, cliente_id) values ($1, 'Fabi', 'Confirmado', $2) returning id`, [exp, cli]);
    const vv = (await um(`select viagem_id from rel_expedicoes_vinculo where passageiro_id = $1`, [px])).viagem_id;
    await q(`delete from passageiros where id = $1`, [px]);
    assert.equal((await um(`select status from rel_viagens where id = $1`, [vv])).status, 'cancelada');
  });

  // ── venda / financeiro ──
  const { id: neg } = await um(`insert into qs_closer_negocios (etapa, consolidada_em) values ('aguardando_emissao', now()) returning id`);
  const vid = await viagemAna();
  const { id: venda } = await um(`insert into qs_vendas (negocio_id, viagem_id, cliente_id, valor_total, estado) values ($1, $2, $3, 20000, 'consolidada') returning id`, [neg, vid, ana]);
  await q(`update rel_viagens set closer_negocio_id = $1 where id = $2`, [neg, vid]);
  const { id: item } = await um(`insert into qs_venda_itens (venda_id, negocio_id, tipo, nome, valor, dados, ordem) values ($1, $2, 'expedicao', 'Egito', 20000, $3, 1) returning id`,
    [venda, neg, JSON.stringify({ expedicao_id: exp })]);
  const { id: plano } = await um(`insert into fin_planos (venda_id, viagem_id, cliente_id, valor_total) values ($1, $2, $3, 20000) returning id`, [venda, vid, ana]);
  await q(`insert into fin_parcelas (plano_id, numero, valor, vencimento, status, pago_valor) values ($1, 1, 5000, '2026-01-01', 'pago', 5000), ($1, 2, 15000, '2026-02-01', 'a_receber', null)`, [plano]);
  await q(`insert into qs_venda_pagamentos (venda_id, valor) values ($1, 20000)`, [venda]);
  await q(`update passageiros set venda_id = $1, venda_item_id = $2 where id = $3`, [venda, item, paxAna]);

  await cenario('v_pax_financeiro soma o que o Financeiro recebeu', async () => {
    const r = await um(`select * from v_pax_financeiro where passageiro_id = $1`, [paxAna]);
    assert.equal(r.ligado_por, 'venda'); assert.equal(Number(r.recebido), 5000); assert.equal(Number(r.vencido), 15000);
    assert.equal(r.pax_no_plano, 1);
  });

  await cenario('item mudou depois de consolidada: plano avisado por venda_id, cartão avisado, nada refeito', async () => {
    await q(`update qs_venda_itens set valor = 22000 where id = $1`, [item]);
    const p = await um(`select observacao, valor_total from fin_planos where id = $1`, [plano]);
    assert.match(p.observacao, /A venda mudou para R\$ 22/); assert.equal(Number(p.valor_total), 20000);
    assert.equal((await um(`select count(*)::int n from fin_parcelas where plano_id = $1`, [plano])).n, 2);
    const d = await um(`select motivos from fin_planos_divergentes_v where plano_id = $1`, [plano]);
    assert.ok(d.motivos.includes('valor'));
  });

  await cenario('data do item mudou: viagem consolidada acompanha (sem datas_travadas)', async () => {
    await q(`update qs_venda_itens set data_fim = '2027-10-05' where id = $1`, [item]);
    assert.equal((await um(`select data_retorno::text r from rel_viagens where id = $1`, [vid])).r, '2027-10-05');
  });

  await cenario('pagamento mudou (sem cartão também) → aviso no plano', async () => {
    await q(`update qs_vendas set condicao_obs = 'nova condição' where id = $1`, [venda]);
    assert.match((await um(`select observacao from fin_planos where id = $1`, [plano])).observacao, /forma\/condição de pagamento/);
    await q(`update qs_venda_pagamentos set valor = 21000 where venda_id = $1`, [venda]);
    assert.match((await um(`select observacao from fin_planos where id = $1`, [plano])).observacao, /pagamentos da venda mudaram/);
  });

  await cenario('valor mudado no Ops → aviso no plano (item 7)', async () => {
    await q(`update passageiros set valor_contratado_brl = 21000 where id = $1`, [paxAna]);
    assert.match((await um(`select observacao from fin_planos where id = $1`, [plano])).observacao, /O Operacional mudou o valor de Ana/);
  });

  await cenario('passageiro cancelado no Ops → aviso no cartão e no plano (item 5)', async () => {
    await q(`update passageiros set status_reserva = 'Cancelado' where id = $1`, [paxAna]);
    const ev = await q(`select texto from qs_closer_negocio_eventos where negocio_id = $1`, [neg]);
    assert.ok(ev.some((e) => /O Operacional cancelou Ana/.test(e.texto)));
    assert.match((await um(`select observacao from fin_planos where id = $1`, [plano])).observacao, /O Operacional cancelou Ana/);
    await q(`update passageiros set status_reserva = 'Confirmado' where id = $1`, [paxAna]);
  });

  await cenario('cancelamento vindo do QS ([QS dd/mm/aaaa]) não duplica aviso', async () => {
    const antes = (await um(`select count(*)::int n from qs_closer_negocio_eventos where negocio_id = $1`, [neg])).n;
    await q(`update passageiros set status_reserva = 'Cancelado', observacoes = '[QS ' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY') || '] Venda cancelada: x' where id = $1`, [paxAna]);
    const depois = (await um(`select count(*)::int n from qs_closer_negocio_eventos where negocio_id = $1`, [neg])).n;
    assert.equal(depois, antes);
    await q(`update passageiros set status_reserva = 'Confirmado' where id = $1`, [paxAna]);
  });

  await cenario('viagem cancelada no Rel → aviso na venda, cartão e plano (item 5)', async () => {
    await q(`update rel_viagens set status = 'cancelada' where id = $1`, [vid]);
    assert.match((await um(`select observacoes from qs_vendas where id = $1`, [venda])).observacoes, /foi CANCELADA no Relacionamento/);
    assert.match((await um(`select observacao from fin_planos where id = $1`, [plano])).observacao, /foi CANCELADA no Relacionamento/);
    await q(`update rel_viagens set status = 'ativa' where id = $1`, [vid]);
  });

  await cenario('preferências do closer vão para o perfil só onde está vazio (item 6)', async () => {
    const { id: cli } = await um(`insert into rel_clientes (nome, perfil) values ('Duda', '{"saude":{"alergia_alimentar":"Não"}}') returning id`);
    const { id: vv } = await um(`insert into rel_viagens (titulo, tipo, origem, cliente_id) values ('Paris', 'pacote', 'closer', $1) returning id`, [cli]);
    const { id: ng } = await um(`insert into qs_closer_negocios (viagem_id, ficha) values ($1, $2) returning id`,
      [vv, JSON.stringify({ preferencias: { restricoes: 'sem glúten', alergias: 'camarão' } })]);
    await q(`update qs_closer_negocios set consolidada_em = now() where id = $1`, [ng]);
    const p = (await um(`select perfil from rel_clientes where id = $1`, [cli])).perfil;
    assert.equal(p.restricoes_alimentares, 'sem glúten');
    assert.equal(p.saude.alergia_alimentar, 'Não', 'sobrescreveu resposta existente');
    const ev = await q(`select texto from qs_closer_negocio_eventos where negocio_id = $1`, [ng]);
    assert.ok(ev.some((e) => /restrições alimentares/.test(e.texto)));
  });

  console.log(`\n${ok} cenário(s) ok.`);
  const warns = avisos.filter((a) => /ponte|0388|0358/.test(a));
  if (warns.length) console.log('Warnings do banco:\n' + warns.join('\n'));
} finally {
  await db.end();
  await srv.stop();
}
