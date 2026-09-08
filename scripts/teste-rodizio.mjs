#!/usr/bin/env node
// scripts/teste-rodizio.mjs
// -----------------------------------------------------------------------------
// PROVA QUE O RODÍZIO DAS LPs DIVIDE PAREJO SOB CONCORRÊNCIA.
//
// Dispara N chamadas SIMULTÂNEAS de reservar_sdr() e confere duas coisas:
//
//   1. DISTRIBUIÇÃO — com 3 SDRs e 30 chamadas tem que dar 10/10/10. Se a trava
//      não funcionasse, duas chamadas leriam o mesmo ponteiro e o mesmo SDR
//      levaria duas seguidas — o resultado sairia tipo 12/10/8.
//   2. ORDEM — a sequência tem que ser A,B,C,A,B,C… sem repetir e sem pular.
//      Só a contagem não basta: 10/10/10 também sairia de um sorteio com sorte.
//
// ── POR QUE DÁ PRA RODAR EM PRODUÇÃO ────────────────────────────────────────
//   • usa uma FILA PRÓPRIA (--fila), então o ponteiro de 'fila:forms' — o que
//     atende as LPs de verdade — não é tocado;
//   • NÃO cria lead nenhum. Escreve só em sdr_reservas, e apaga tudo no fim;
//   • os telefones são falsos e conferidos antes contra qs_leads, pra não
//     esbarrar na regra de "mesmo telefone em 30 dias volta pro mesmo SDR".
//
// USO:
//   node scripts/teste-rodizio.mjs                 # 30 chamadas, limpa no fim
//   node scripts/teste-rodizio.mjs --n=60
//   node scripts/teste-rodizio.mjs --manter        # deixa as linhas pra inspeção
//
// Precisa da migration 0076 aplicada e do .env com SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY (as mesmas variáveis que as rotas /api usam).
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

// ── argumentos ──────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const N = Number(args.n || 30);
const FILA = String(args.fila || 'teste-rodizio');
const MANTER = Boolean(args.manter);

// ── .env ────────────────────────────────────────────────────────────────────
const raiz = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const envPath = path.join(raiz, '.env');
if (!fs.existsSync(envPath)) {
  console.error(`Não achei o .env em ${envPath}`);
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);
const URL_BASE = (env.SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

async function rest(caminho, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  if (!res.ok) {
    const e = new Error((json && json.message) || `HTTP ${res.status}`);
    e.detalhe = json;
    throw e;
  }
  return json;
}

const cor = { ok: (s) => `\x1b[32m${s}\x1b[0m`, ruim: (s) => `\x1b[31m${s}\x1b[0m`, fraco: (s) => `\x1b[90m${s}\x1b[0m` };

async function main() {
  console.log(`\n── Teste do rodízio ──  ${N} chamadas simultâneas, fila "${FILA}"\n`);

  // ── (1) Quem está no rodízio, na ordem canônica ───────────────────────────
  // Espelha qs_sdrs_no_rodizio(): SDR ativo QUE TEM número ativo, ordenado por
  // created_at. É contra ESTA ordem que a sequência é conferida.
  const [usuarios, chips] = await Promise.all([
    rest('qs_users?select=id,name,created_at&role=eq.sdr&is_active=eq.true&order=created_at.asc,id.asc'),
    rest('sdr_pool?select=sdr_id,numero&status=eq.ativo'),
  ]);
  const comChip = new Set(chips.map((c) => c.sdr_id));
  const pool = usuarios.filter((u) => comChip.has(u.id));

  if (pool.length === 0) {
    console.error(cor.ruim('Nenhum SDR com número ativo em sdr_pool.'));
    console.error('Cadastre os chips primeiro — o passo a passo está no rodapé de');
    console.error('supabase/migrations/0076_pool_de_numeros.sql\n');
    process.exit(1);
  }

  const nomes = new Map(pool.map((u) => [u.id, u.name]));
  console.log(`SDRs no rodízio (${pool.length}): ${pool.map((u) => u.name).join(' → ')} → (volta)\n`);

  if (N % pool.length !== 0) {
    console.log(cor.fraco(`Aviso: ${N} não é múltiplo de ${pool.length}; a divisão perfeita não é possível.\n`));
  }

  // ── (2) Telefones de teste que não esbarram na regra dos 30 dias ─────────
  // Se um desses telefones já existisse em qs_leads, reservar_sdr devolveria o
  // SDR de antes em vez de girar a roda — e o teste acusaria uma falha que não
  // existe. Então a gente confere e desloca o prefixo até achar faixa limpa.
  let prefixo = 90000000;
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const chaves = Array.from({ length: N }, (_, i) => String(prefixo + i));
    const usados = await rest(
      `qs_leads?select=id&phone=not.is.null&or=(${chaves.map((c) => `phone.like.*${c}`).join(',')})&limit=1`
    ).catch(() => []);
    if (!usados || usados.length === 0) break;
    prefixo += 1000;
  }
  const telefones = Array.from({ length: N }, (_, i) => `55119${prefixo + i}`);

  // ── (3) Zera a fila do teste ─────────────────────────────────────────────
  await rest(`qs_assign_state?scope=eq.fila%3A${encodeURIComponent(FILA)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  await rest(`sdr_reservas?fila=eq.${encodeURIComponent(FILA)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});

  // ── (4) AS N CHAMADAS, TODAS DE UMA VEZ ──────────────────────────────────
  // Promise.all dispara todas antes de qualquer uma responder: é isto que põe a
  // trava do banco à prova. Sem pg_advisory_xact_lock, é aqui que quebraria.
  const t0 = Date.now();
  const respostas = await Promise.all(
    telefones.map((tel, i) =>
      rest('rpc/reservar_sdr', {
        method: 'POST',
        body: {
          p_nome: `Teste ${i + 1}`,
          p_telefone: tel,
          p_email: null,
          p_origem: 'teste-automatizado',
          p_expedicao: 'Teste',
          p_fila: FILA,
        },
      }).then((r) => (Array.isArray(r) ? r[0] : r)).catch((e) => ({ erro: e.message }))
    )
  );
  const ms = Date.now() - t0;

  const falhas = respostas.filter((r) => !r || r.erro || !r.sdr_id);
  if (falhas.length) {
    console.error(cor.ruim(`${falhas.length} de ${N} chamadas falharam.`));
    console.error(falhas.slice(0, 3));
    process.exit(1);
  }
  console.log(`${N} chamadas concluídas em ${ms}ms (${Math.round(ms / N)}ms por chamada)\n`);

  // ── (5) A ordem real ─────────────────────────────────────────────────────
  // Lida do banco, não da ordem em que as respostas voltaram: quem respondeu
  // primeiro não é necessariamente quem pegou a vez primeiro. created_at é
  // clock_timestamp() gravado DENTRO da trava, então é a ordem verdadeira.
  const linhas = await rest(
    `sdr_reservas?select=sdr_id,numero,telefone,created_at&fila=eq.${encodeURIComponent(FILA)}&order=created_at.asc&limit=${N + 10}`
  );

  let falhou = false;

  // ── Conferência 1: distribuição ──────────────────────────────────────────
  const contagem = new Map(pool.map((u) => [u.id, 0]));
  linhas.forEach((l) => contagem.set(l.sdr_id, (contagem.get(l.sdr_id) || 0) + 1));
  const esperado = Math.floor(N / pool.length);

  console.log('DISTRIBUIÇÃO');
  for (const u of pool) {
    const c = contagem.get(u.id) || 0;
    const certo = c === esperado || (N % pool.length !== 0 && Math.abs(c - N / pool.length) < 1);
    if (!certo) falhou = true;
    console.log(`  ${certo ? cor.ok('✓') : cor.ruim('✗')} ${u.name.padEnd(24)} ${String(c).padStart(3)}  (esperado ${esperado})`);
  }

  // ── Conferência 2: ordem ─────────────────────────────────────────────────
  console.log('\nORDEM DA RODA');
  const idx = pool.map((u) => u.id);
  let quebras = 0;
  for (let i = 1; i < linhas.length; i++) {
    const ant = idx.indexOf(linhas[i - 1].sdr_id);
    const atual = idx.indexOf(linhas[i].sdr_id);
    const esperadoIdx = (ant + 1) % idx.length;
    if (atual !== esperadoIdx) {
      quebras++;
      if (quebras <= 5) {
        console.log(cor.ruim(
          `  ✗ posição ${i + 1}: veio ${nomes.get(linhas[i].sdr_id)}, ` +
          `esperado ${nomes.get(idx[esperadoIdx])} (anterior: ${nomes.get(linhas[i - 1].sdr_id)})`
        ));
      }
    }
  }
  if (quebras === 0) {
    console.log(cor.ok(`  ✓ ${linhas.length} chamadas na ordem exata da roda, sem repetir nem pular`));
    const amostra = linhas.slice(0, Math.min(9, linhas.length)).map((l) => nomes.get(l.sdr_id));
    console.log(cor.fraco(`    ${amostra.join(' → ')} → …`));
  } else {
    falhou = true;
    console.log(cor.ruim(`  ${quebras} quebra(s) de ordem em ${linhas.length} chamadas`));
  }

  // ── (6) Faxina ───────────────────────────────────────────────────────────
  if (MANTER) {
    console.log(cor.fraco(`\n(--manter) As ${linhas.length} linhas ficaram em sdr_reservas com fila='${FILA}'.`));
  } else {
    await rest(`sdr_reservas?fila=eq.${encodeURIComponent(FILA)}`, { method: 'DELETE', prefer: 'return=minimal' });
    await rest(`qs_assign_state?scope=eq.fila%3A${encodeURIComponent(FILA)}`, { method: 'DELETE', prefer: 'return=minimal' });
    console.log(cor.fraco('\nLinhas de teste apagadas. O ponteiro de fila:forms não foi tocado.'));
  }

  console.log(falhou ? cor.ruim('\nRESULTADO: FALHOU\n') : cor.ok('\nRESULTADO: PASSOU\n'));
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => {
  console.error(cor.ruim('\nErro:'), e.message);
  if (e.detalhe) console.error(e.detalhe);
  if (String(e.message).includes('reservar_sdr')) {
    console.error('\nA migration 0076 foi aplicada? Rode o SQL antes do teste.\n');
  }
  process.exit(1);
});
