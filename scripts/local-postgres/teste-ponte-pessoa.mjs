// scripts/local-postgres/teste-ponte-pessoa.mjs
// -----------------------------------------------------------------------------
// Prova LOCAL (Postgres de verdade, sem tocar em produção) das migrations
// 0376–0379 da "ponte pessoa": lead↔ficha, leads da ficha, conversa↔ficha,
// opt-out unificado e nome no cadastro único.
//
//   cd scripts/local-postgres && npm install && node teste-ponte-pessoa.mjs
//
// Aplica esqueleto-ponte.sql + as 4 migrations DUAS vezes (idempotência) e
// roda os cenários. Sai com código 1 no primeiro que falhar.
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
const MIGRATIONS = ['0376_ponte_lead_ficha.sql', '0377_ponte_leads_da_ficha.sql',
  '0378_ponte_whatsapp_conversa_optout.sql', '0379_cadastro_unico_nome.sql'];

const dataDir = path.join(AQUI, '.dados-ponte');
fs.rmSync(dataDir, { recursive: true, force: true });
const servidor = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORTA, persistent: false });
await servidor.initialise();
await servidor.start();
const admin = new pg.Client({ host: 'localhost', port: PORTA, user: 'postgres', password: 'postgres', database: 'postgres' });
await admin.connect();
await admin.query(`create database ponte with encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
await admin.end();
const db = new pg.Client({ host: 'localhost', port: PORTA, user: 'postgres', password: 'postgres', database: 'ponte' });
await db.connect();
db.on('notice', (n) => { if (process.env.VERBOSO) console.log('  [notice]', n.message); });

const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const um = async (sql, args = []) => (await q(sql, args))[0];
let ok = 0;
async function cenario(nome, fn) {
  try { await fn(); ok++; console.log('  ok  ', nome); }
  catch (e) { console.error('  FALHOU', nome, '\n', e); await encerrar(1); }
}
async function encerrar(cod = 0) { await db.end().catch(() => {}); await servidor.stop().catch(() => {}); process.exit(cod); }

try {
  await db.query(fs.readFileSync(path.join(AQUI, 'esqueleto-ponte.sql'), 'utf8'));
  for (let i = 0; i < 2; i++) {
    for (const m of MIGRATIONS) await db.query(fs.readFileSync(path.join(REPO, 'supabase', 'migrations', m), 'utf8'));
  }
  console.log('Esqueleto + 0376–0379 aplicados duas vezes (idempotência ok).\n');
} catch (e) { console.error(e); await encerrar(1); }

const ficha = async (nome, telefone, email) =>
  (await um(`insert into rel_clientes (nome, telefone, email) values ($1, $2, $3) returning id`, [nome, telefone, email])).id;
const lead = async (phone, email, extra = {}) =>
  (await um(`insert into qs_leads (full_name, phone, email, optout_whatsapp_em) values ('Lead', $1, $2, $3) returning id, cliente_id`,
    [phone, email, extra.optout ?? null]));

const A = await ficha('Ana Souza', '(11) 91234-5678', 'ana@x.com');
const B = await ficha('Bruno Lima', '21 99999-0000', 'bruno@x.com');
const C = await ficha('Carla', '31 98888-1111', 'dup@x.com');
const D = await ficha('Dora', '41 97777-2222', 'DUP@x.com');

console.log('1. lead → ficha');
await cenario('telefone formatado diferente liga na ficha única', async () => {
  assert.equal((await lead('+55 (11) 91234-5678', null)).cliente_id, A);
});
await cenario('sem o 9º dígito também liga', async () => {
  assert.equal((await lead('551112345678', null)).cliente_id, A);
});
await cenario('e-mail com caixa diferente liga', async () => {
  assert.equal((await lead(null, 'BRUNO@X.com ')).cliente_id, B);
});
await cenario('e-mail de duas fichas = ambíguo, não liga', async () => {
  assert.equal((await lead(null, 'dup@x.com')).cliente_id, null);
});
await cenario('telefone de uma ficha + e-mail de outra = ambíguo, não liga', async () => {
  assert.equal((await lead('11912345678', 'bruno@x.com')).cliente_id, null);
});
await cenario('ficha arquivada/mesclada não conta', async () => {
  const z = await ficha('Zé', '51 96666-3333', null);
  await q(`update rel_clientes set arquivado_em = now() where id = $1`, [z]);
  assert.equal((await lead('51966663333', null)).cliente_id, null);
});
await cenario('desligar à mão é respeitado (não religa)', async () => {
  const l = await lead('11912345678', null);
  await q(`update qs_leads set cliente_id = null where id = $1`, [l.id]);
  assert.equal((await um(`select cliente_id from qs_leads where id = $1`, [l.id])).cliente_id, null);
  await q(`update qs_leads set status = 'x' where id = $1`, [l.id]);
  assert.equal((await um(`select cliente_id from qs_leads where id = $1`, [l.id])).cliente_id, null);
});
await cenario('mudar o telefone do lead liga', async () => {
  const l = await lead('61900000000', null);
  assert.equal(l.cliente_id, null);
  await q(`update qs_leads set phone = '21999990000' where id = $1`, [l.id]);
  assert.equal((await um(`select cliente_id from qs_leads where id = $1`, [l.id])).cliente_id, B);
});

console.log('2. ficha → leads');
await cenario('ficha nova liga os leads soltos e não mexe em updated_at', async () => {
  const l = await lead('71 95555-4444', null);
  await q(`alter table qs_leads disable trigger trg_qs_leads_updated`);
  await q(`update qs_leads set updated_at = '2020-01-01' where id = $1`, [l.id]);
  await q(`alter table qs_leads enable trigger trg_qs_leads_updated`);
  const e = await ficha('Eva', '71955554444', null);
  const r = await um(`select cliente_id, updated_at from qs_leads where id = $1`, [l.id]);
  assert.equal(r.cliente_id, e);
  assert.equal(new Date(r.updated_at).getUTCFullYear(), 2020);
  assert.notEqual((await um(`select current_setting('qs.ponte', true) v`)).v, 'on');
});
await cenario('Relacionamento salva a ficha: lead liga apesar do bloqueio de área', async () => {
  const rel = (await um(`insert into qs_users (role) values ('relacionamento') returning id`)).id;
  const l = await lead('81 94444-5555', null);
  const f = await ficha('Fábio', null, null);
  await q(`select set_config('teste.uid', $1, false)`, [rel]);
  await q(`update rel_clientes set telefone = '81944445555' where id = $1`, [f]);
  assert.equal((await um(`select cliente_id from qs_leads where id = $1`, [l.id])).cliente_id, f);
  // mas editar o lead direto continua barrado
  await assert.rejects(q(`update qs_leads set status = 'perdido' where id = $1`, [l.id]), /outra área/);
  // e tentar usar a ponte pra mudar outra coluna também
  await db.query('begin');
  await q(`select set_config('qs.ponte', 'on', true)`);
  await assert.rejects(q(`update qs_leads set status = 'perdido' where id = $1`, [l.id]), /outra área/);
  await db.query('rollback');
  await q(`select set_config('teste.uid', '', false)`);
});
await cenario('mesclar ficha leva os leads pra ficha que ficou', async () => {
  const g = await ficha('Gil', '91 93333-6666', null);
  const l = await lead('91933336666', null);
  assert.equal(l.cliente_id, g);
  const h = await ficha('Gil Dup', null, 'gil@x.com');
  await q(`update rel_clientes set mesclado_em_id = $1 where id = $2`, [h, g]);
  assert.equal((await um(`select cliente_id from qs_leads where id = $1`, [l.id])).cliente_id, h);
});

console.log('3. leads da ficha');
await cenario('cad_leads_da_ficha: ligado (cadastro) + solto por telefone', async () => {
  const f = await ficha('Iara', '11 90000-1111', null);
  const lig = await lead('11900001111', null);            // liga sozinho
  await q(`update rel_clientes set telefone = null where id = $1`, [f]);
  const solto = await lead('11 90000-2222', null);
  await q(`update rel_clientes set telefone = '11900002222' where id = $1`, [f]);
  // o "solto" ligou pelo gatilho da ficha; desliga à mão pra testar o fallback
  await q(`update qs_leads set cliente_id = null where id = $1`, [solto.id]);
  const r = await q(`select lead_id, por from cad_leads_da_ficha($1) order by por`, [f]);
  assert.deepEqual(r.map((x) => [x.lead_id, x.por]).sort(), [[lig.id, 'cadastro'], [solto.id, 'telefone']].sort());
});
await cenario('qs_sol_cliente_do_lead: cliente_id manda', async () => {
  const l = await lead(null, 'ana@x.com');
  assert.equal((await um(`select qs_sol_cliente_do_lead($1) v`, [l.id])).v, A);
});

console.log('4. conversa do Rel');
await cenario('conversa nova com telefone de ficha já nasce ligada', async () => {
  const r = await um(`insert into rel_wa_conversas (telefone) values ('5521999990000') returning cliente_id`);
  assert.equal(r.cliente_id, B);
});
await cenario('conversa sem ficha fica sem', async () => {
  const r = await um(`insert into rel_wa_conversas (telefone) values ('5599911112222') returning cliente_id`);
  assert.equal(r.cliente_id, null);
});

console.log('5. opt-out');
const J = await ficha('Júlia', '11 98765-0000', 'julia@x.com');
const lJ = await lead('11987650000', null);
const lJsoltoOutroNumero = await lead(null, 'julia@x.com');
await q(`insert into mkt_contatos (telefone) values ('11987650000')`);
await cenario('saiu no Rel → lead e Marketing marcados com o mesmo carimbo', async () => {
  assert.equal(lJ.cliente_id, J);
  await q(`update rel_clientes set optout_em = '2026-11-13 10:00+00' where id = $1`, [J]);
  const ls = await q(`select optout_whatsapp_em, optout_whatsapp_texto from qs_leads where id = any($1)`, [[lJ.id, lJsoltoOutroNumero.id]]);
  for (const l of ls) { assert.equal(new Date(l.optout_whatsapp_em).toISOString(), '2026-11-13T10:00:00.000Z'); assert.match(l.optout_whatsapp_texto, /Relacionamento/); }
  const m = await um(`select optout_whatsapp_em from mkt_contatos where telefone = '11987650000'`);
  assert.equal(new Date(m.optout_whatsapp_em).toISOString(), '2026-11-13T10:00:00.000Z');
});
await cenario('voltou a aceitar no Rel → limpa só o que veio daquele pedido', async () => {
  // um lead que saiu por conta própria, noutro horário, continua fora
  const proprio = await lead('11 98765-0000', null, { optout: '2026-11-01 09:00+00' });
  await q(`update rel_clientes set optout_em = null where id = $1`, [J]);
  assert.equal((await um(`select optout_whatsapp_em from qs_leads where id = $1`, [lJ.id])).optout_whatsapp_em, null);
  assert.equal((await um(`select optout_whatsapp_em from mkt_contatos where telefone = '11987650000'`)).optout_whatsapp_em, null);
  assert.notEqual((await um(`select optout_whatsapp_em from qs_leads where id = $1`, [proprio.id])).optout_whatsapp_em, null);
});
await cenario('lead sem ficha sai → ficha do mesmo telefone exato marcada', async () => {
  const k = await ficha('Kika', null, null);  // sem telefone ainda: o lead nasce solto
  const l = await lead('31 91212-3434', null);
  await q(`update rel_clientes set telefone = '5531912123434' where id = $1`, [k]);
  await q(`update qs_leads set cliente_id = null where id = $1`, [l.id]);       // força o caminho "sem ligação"
  await q(`update qs_leads set optout_whatsapp_em = now() where id = $1`, [l.id]);
  assert.notEqual((await um(`select optout_em from rel_clientes where id = $1`, [k])).optout_em, null);
});
await cenario('Marketing marca → ficha ligada marcada; sem laço infinito', async () => {
  const m = await ficha('Mel', '41 95656-7878', null);
  const lm = await lead('41956567878', null);
  await q(`insert into mkt_contatos (telefone, rel_cliente_id) values ('5541956567878', $1)`, [m]);
  await q(`update mkt_contatos set optout_whatsapp_em = now() where rel_cliente_id = $1`, [m]);
  assert.notEqual((await um(`select optout_em from rel_clientes where id = $1`, [m])).optout_em, null);
  assert.notEqual((await um(`select optout_whatsapp_em from qs_leads where id = $1`, [lm.id])).optout_whatsapp_em, null);
});

console.log('6. nome no cadastro único');
const expVigente = (await um(`insert into expedicoes (data_embarque, data_retorno) values (now()::date + 30, now()::date + 40) returning id`)).id;
const expPassada = (await um(`insert into expedicoes (data_embarque, data_retorno) values ('2024-01-01', '2024-01-10') returning id`)).id;
const N = await ficha('Nina Rocha', null, null);
await cenario('ida nova com o mesmo nome (só caixa/acento) não abre divergência', async () => {
  await q(`insert into passageiros (cliente_id, expedicao_id, nome_completo) values ($1, $2, 'NÍNA rocha')`, [N, expPassada]);
  assert.equal((await um(`select count(*)::int n from cad_divergencias where cliente_id = $1`, [N])).n, 0);
});
let paxV;
await cenario('ida nova com nome diferente abre divergência "nome"', async () => {
  paxV = (await um(`insert into passageiros (cliente_id, expedicao_id, nome_completo) values ($1, $2, 'Nina R. Alves') returning id`, [N, expVigente])).id;
  const d = await um(`select campo, valor_ficha, valor_expedicao from cad_divergencias where cliente_id = $1 and resolvido_em is null`, [N]);
  assert.deepEqual(d, { campo: 'nome', valor_ficha: 'Nina Rocha', valor_expedicao: 'Nina R. Alves' });
});
await cenario('editar o nome na ficha vai pras idas vigentes (não pras passadas) e fecha a divergência', async () => {
  await q(`update rel_clientes set nome = 'Nina Rocha Alves' where id = $1`, [N]);
  const ps = await q(`select expedicao_id, nome_completo from passageiros where cliente_id = $1`, [N]);
  assert.equal(ps.find((p) => p.expedicao_id === expVigente).nome_completo, 'Nina Rocha Alves');
  assert.equal(ps.find((p) => p.expedicao_id === expPassada).nome_completo, 'NÍNA rocha');
  assert.equal((await um(`select count(*)::int n from cad_divergencias where cliente_id = $1 and resolvido_em is null`, [N])).n, 0);
});
await cenario('editar o nome na ida vai pra ficha', async () => {
  await q(`update passageiros set nome_completo = '  Nina  Rocha Alves Lima ' where id = $1`, [paxV]);
  assert.equal((await um(`select nome from rel_clientes where id = $1`, [N])).nome, 'Nina Rocha Alves Lima');
});
await cenario('nome vazio na ida não apaga a ficha', async () => {
  await q(`update passageiros set nome_completo = '' where id = $1`, [paxV]);
  assert.equal((await um(`select nome from rel_clientes where id = $1`, [N])).nome, 'Nina Rocha Alves Lima');
});

console.log(`\n${ok} cenários ok.`);
await encerrar(0);
