// scripts/local-postgres/teste-endpoint-local.mjs
// -----------------------------------------------------------------------------
// O /api/lead RODANDO DE VERDADE, na sua máquina, ponta a ponta.
//
//   fetch HTTP  ->  api/lead.js (o arquivo real, sem stub)
//               ->  um PostgREST de mentira (60 linhas aqui embaixo)
//               ->  Postgres 17 local
//
// Por que o PostgREST falso: as rotas /api falam com o Supabase por HTTP, não
// por driver. Trocar isso só pro teste seria testar outro código. Então o que a
// gente troca é o SERVIDOR do outro lado — a rota continua achando que está
// falando com o Supabase, e fala com o banco local.
//
// Testa o que o teste de rodízio não alcança: CORS, campo-armadilha, teto por
// IP, normalização de telefone, cabeçalhos de cache e o fallback.
//
//   node teste-endpoint-local.mjs
// -----------------------------------------------------------------------------
import http from 'node:http';
import pg from 'pg';
import { subirBanco, cadastrarChips, CONEXAO } from './_banco.mjs';

const PORTA_REST = 54330;
const PORTA_API = 54331;
const ORIGEM_BOA = 'https://setuforeuvouviagens.com.br';
const ORIGEM_MA = 'https://setuforeuvouviagens.com.br.site-de-outra-pessoa.com';
const FALLBACK = '5511900009999';

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const vermelho = (s) => `\x1b[31m${s}\x1b[0m`;

let passou = 0, falhou = 0;
function checar(nome, condicao, detalhe = '') {
  if (condicao) { passou++; console.log(`  ${verde('✓')} ${nome}`); }
  else { falhou++; console.log(`  ${vermelho('✗')} ${nome}${detalhe ? '  → ' + detalhe : ''}`); }
}

const { cli, encerrar } = await subirBanco({ silencioso: true });
console.log('Postgres local no ar, migration aplicada.\n');

const sdrs = await cadastrarChips(cli);
await cli.query(`update qs_settings set value = '10'::jsonb where key = 'lp_rate_limit'`);

// ── PostgREST de mentira ────────────────────────────────────────────────────
const pool = new pg.Pool({ ...CONEXAO, max: 10 });
const rest = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const corpo = await new Promise((r) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b ? JSON.parse(b) : {}));
  });
  try {
    let saida;
    if (url.pathname === '/rest/v1/qs_settings') {
      saida = (await pool.query('select key, value from qs_settings')).rows;
    } else if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.split('/').pop();
      const chaves = Object.keys(corpo);
      const args = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
      const r = await pool.query(`select * from ${fn}(${args})`, chaves.map((k) => corpo[k]));
      // PostgREST devolve escalar cru quando a função retorna um valor só, e
      // array quando retorna TABLE. A rota depende dessa diferença.
      saida = (r.fields.length === 1 && r.fields[0].name === fn) ? r.rows[0]?.[fn] : r.rows;
    } else {
      res.writeHead(404).end('[]'); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(saida));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: e.message }));
  }
});
await new Promise((r) => rest.listen(PORTA_REST, r));

// ── A rota de verdade ───────────────────────────────────────────────────────
process.env.SUPABASE_URL = `http://localhost:${PORTA_REST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
process.env.LEAD_INBOUND_SECRET = 'sal-de-teste';
process.env.WHATSAPP_FALLBACK = FALLBACK;

const { default: handler } = await import('../../api/lead.js');

const api = http.createServer(async (req, res) => {
  const bruto = await new Promise((r) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b));
  });
  req.body = bruto;                                   // a Vercel entrega string ou objeto
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  await handler(req, res);
});
await new Promise((r) => api.listen(PORTA_API, r));

const chamar = (corpo, { origem = ORIGEM_BOA, ip = '203.0.113.1', metodo = 'POST' } = {}) =>
  fetch(`http://localhost:${PORTA_API}/api/lead`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(origem ? { Origin: origem } : {}),
      'x-forwarded-for': ip,
    },
    body: metodo === 'POST' ? JSON.stringify(corpo) : undefined,
  });

const lead = (extra = {}) => ({
  nome: 'Fulano', telefone: '(11) 98765-4321', email: 'f@x.com',
  origem: 'lp-japao', expedicao: 'Japão', ...extra,
});

try {
  console.log('CORS');
  {
    const r = await chamar(null, { metodo: 'OPTIONS' });
    checar('preflight de domínio nosso passa', r.status === 204, `status ${r.status}`);
    checar('devolve o Allow-Origin certo', r.headers.get('access-control-allow-origin') === ORIGEM_BOA);
    checar('marca Vary: Origin (senão um CDN serve a origem errada)', r.headers.get('vary') === 'Origin');
  }
  {
    const r = await chamar(lead(), { origem: ORIGEM_MA, ip: '203.0.113.2' });
    checar('domínio parecido com o nosso é BARRADO', r.status === 403, `status ${r.status}`);
    checar('e não recebe Allow-Origin', !r.headers.get('access-control-allow-origin'));
  }
  {
    const r = await chamar(lead({ telefone: '11 91111-0001' }), { origem: '', ip: '203.0.113.3' });
    checar('sem Origin (curl / servidor) passa', r.status === 200, `status ${r.status}`);
  }

  console.log('\nCACHE');
  {
    const r = await chamar(lead({ telefone: '11 91111-0002' }), { ip: '203.0.113.4' });
    checar('Cache-Control: no-store', (r.headers.get('cache-control') || '').includes('no-store'));
    checar('CDN da Vercel também proibida de cachear',
      r.headers.get('vercel-cdn-cache-control') === 'no-store');
  }

  console.log('\nO CAMINHO FELIZ');
  {
    const r = await chamar(lead({ telefone: '(11) 92222-0001' }), { ip: '203.0.113.5' });
    const j = await r.json();
    checar('devolve numero e sdr_nome', !!j.numero && !!j.sdr_nome, JSON.stringify(j));
    checar('não é fallback', j.fallback === false);
    const { rows } = await cli.query(`select telefone, nome, origem, expedicao from sdr_reservas order by created_at desc limit 1`);
    checar('telefone gravado só com dígitos', rows[0].telefone === '11922220001', rows[0].telefone);
    checar('expedição e origem gravadas', rows[0].expedicao === 'Japão' && rows[0].origem === 'lp-japao');
  }

  console.log('\nRODÍZIO PELA ROTA HTTP');
  {
    const nomes = [];
    for (let i = 0; i < 6; i++) {
      const r = await chamar(lead({ telefone: `11 93333-000${i}` }), { ip: `203.0.113.1${i}` });
      nomes.push((await r.json()).sdr_nome);
    }
    checar('alterna entre os 3 SDRs', new Set(nomes).size === 3, nomes.join(' → '));
    checar('e cada um levou 2', [...new Set(nomes)].every((n) => nomes.filter((x) => x === n).length === 2),
      nomes.join(' → '));
    // A ordem tem que seguir a roda (created_at de qs_users), não a ordem em que
    // as chamadas saíram daqui.
    const roda = sdrs.map((s) => s.name);
    const inicio = roda.indexOf(nomes[0]);
    checar('na ordem da roda',
      nomes.every((n, i) => n === roda[(inicio + i) % roda.length]), nomes.join(' → '));
  }

  console.log('\nLEAD RECORRENTE (formato diferente do telefone)');
  {
    const a = await (await chamar(lead({ telefone: '(11) 94444-1234' }), { ip: '203.0.113.20' })).json();
    const b = await (await chamar(lead({ telefone: '+55 11 94444-1234' }), { ip: '203.0.113.21' })).json();
    checar('mesmo SDR nos dois envios', a.sdr_nome === b.sdr_nome, `${a.sdr_nome} vs ${b.sdr_nome}`);
  }

  console.log('\nCAMPO-ARMADILHA (honeypot)');
  {
    const { rows: [antes] } = await cli.query(`select last_owner_id from qs_assign_state where scope='fila:forms'`);
    const r = await chamar(lead({ telefone: '11 95555-0001', site: 'http://spam.example' }), { ip: '203.0.113.30' });
    const j = await r.json();
    const { rows: [depois] } = await cli.query(`select last_owner_id from qs_assign_state where scope='fila:forms'`);
    checar('responde 200 (não ensina o robô qual campo o entregou)', r.status === 200);
    checar('devolve o fallback', j.numero === FALLBACK && j.fallback === true, JSON.stringify(j));
    checar('e NÃO gira a roda', antes.last_owner_id === depois.last_owner_id);
  }

  console.log('\nTELEFONE INVÁLIDO');
  {
    const r = await chamar(lead({ telefone: 'não tenho' }), { ip: '203.0.113.31' });
    checar('recusa com 400', r.status === 400, `status ${r.status}`);
  }

  console.log('\nTETO POR IP (configurado em 10/hora)');
  {
    const ip = '203.0.113.99';
    const status = [];
    for (let i = 0; i < 12; i++) {
      const r = await chamar(lead({ telefone: `11 96${String(660000 + i)}` }), { ip });
      status.push(r.status);
    }
    checar('as 10 primeiras passam', status.slice(0, 10).every((s) => s === 200), status.join(','));
    checar('a 11ª e a 12ª levam 429', status.slice(10).every((s) => s === 429), status.join(','));
    const outro = await chamar(lead({ telefone: '11 97777-9999' }), { ip: '203.0.113.100' });
    checar('outro IP não é afetado', outro.status === 200, `status ${outro.status}`);
  }

  console.log('\nFALLBACK (nenhum SDR com número)');
  {
    await cli.query(`update sdr_pool set status = 'queimado' where status = 'ativo'`);
    const r = await chamar(lead({ telefone: '11 98888-0001' }), { ip: '203.0.113.50' });
    const j = await r.json();
    checar('ninguém fica sem destino', r.status === 200 && j.numero === FALLBACK, JSON.stringify(j));
    checar('marcado como fallback', j.fallback === true);
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(falhou === 0
    ? verde(`TODOS OS ${passou} TESTES PASSARAM`)
    : vermelho(`${falhou} de ${passou + falhou} FALHARAM`));
  console.log('='.repeat(52) + '\n');
} finally {
  api.close(); rest.close(); await pool.end(); await encerrar();
}

process.exit(falhou ? 1 : 0);
