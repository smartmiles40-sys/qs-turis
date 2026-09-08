// scripts/local-postgres/teste-rodizio-local.mjs
// -----------------------------------------------------------------------------
// O TESTE DOS 30 ENVIOS SIMULTÂNEOS — rodando 100% na sua máquina.
//
// Abre 30 conexões SEPARADAS com o Postgres local, espera todas estarem de pé, e
// só então dispara as 30 chamadas de reservar_sdr() de uma vez. Confere:
//
//   1. DISTRIBUIÇÃO — 10/10/10. Se a trava do banco não funcionasse, duas
//      chamadas leriam o mesmo ponteiro e o mesmo SDR levaria duas seguidas.
//   2. ORDEM — Mariana, Victor, Yanca, Mariana… sem repetir e sem pular. Só a
//      contagem não bastaria: 10/10/10 também sai de um sorteio com sorte.
//
// Nada aqui toca em produção: o banco nasce e morre dentro deste processo.
//
//   node teste-rodizio-local.mjs          # 30 chamadas
//   node teste-rodizio-local.mjs 90       # outro volume
// -----------------------------------------------------------------------------
import pg from 'pg';
import { subirBanco, cadastrarChips, CONEXAO } from './_banco.mjs';

const N = Number(process.argv[2] || 30);
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const vermelho = (s) => `\x1b[31m${s}\x1b[0m`;
const fraco = (s) => `\x1b[90m${s}\x1b[0m`;

const { cli, encerrar } = await subirBanco();
let falhou = false;

try {
  const sdrs = await cadastrarChips(cli);
  const ordemDaRoda = sdrs.map((s) => s.name);
  console.log(`Roda: ${ordemDaRoda.join(' → ')} → (volta)`);
  console.log(`Disparando ${N} chamadas SIMULTÂNEAS…\n`);

  // ── As 30 conexões ────────────────────────────────────────────────────────
  // Conecta TODAS antes de mandar qualquer query. Se a gente deixasse o pool
  // conectar sob demanda, parte das chamadas só começaria depois que outras já
  // tivessem terminado — e aí não haveria disputa nenhuma pra provar.
  const conexoes = Array.from({ length: N }, () => new pg.Client(CONEXAO));
  await Promise.all(conexoes.map((c) => c.connect()));

  const t0 = Date.now();
  const respostas = await Promise.all(
    conexoes.map((c, i) =>
      c.query(
        `select sdr_nome, numero from reservar_sdr($1, $2, null, 'lp-japao', 'Japão', 'forms')`,
        [`Pessoa ${i + 1}`, `5511987${String(650000 + i)}`]
      ).then((r) => r.rows[0]).catch((e) => ({ erro: e.message }))
    )
  );
  const ms = Date.now() - t0;
  await Promise.all(conexoes.map((c) => c.end()));

  const erros = respostas.filter((r) => !r || r.erro);
  if (erros.length) {
    console.log(vermelho(`${erros.length} de ${N} chamadas falharam:`));
    console.log([...new Set(erros.map((e) => e.erro))].slice(0, 3).join('\n'));
    process.exit(1);
  }
  console.log(`${N} chamadas concluídas em ${ms}ms\n`);

  // ── A ordem real ──────────────────────────────────────────────────────────
  // Vem do banco, não da ordem em que as respostas voltaram: quem respondeu
  // primeiro não é necessariamente quem pegou a vez primeiro. created_at é
  // clock_timestamp() gravado DENTRO da trava — essa é a ordem verdadeira.
  const { rows: linhas } = await cli.query(
    `select u.name from sdr_reservas r join qs_users u on u.id = r.sdr_id order by r.created_at asc`
  );

  // ── 1. Distribuição ───────────────────────────────────────────────────────
  console.log('DISTRIBUIÇÃO');
  const esperado = Math.floor(N / ordemDaRoda.length);
  const conta = {};
  linhas.forEach((l) => { conta[l.name] = (conta[l.name] || 0) + 1; });
  for (const nome of ordemDaRoda) {
    const c = conta[nome] || 0;
    const ok = c === esperado;
    if (!ok) falhou = true;
    console.log(`  ${ok ? verde('✓') : vermelho('✗')} ${nome.padEnd(24)} ${String(c).padStart(3)}   (esperado ${esperado})`);
  }

  // ── 2. Ordem ──────────────────────────────────────────────────────────────
  console.log('\nORDEM DA RODA');
  let quebras = 0;
  for (let i = 1; i < linhas.length; i++) {
    const ant = ordemDaRoda.indexOf(linhas[i - 1].name);
    const esp = ordemDaRoda[(ant + 1) % ordemDaRoda.length];
    if (linhas[i].name !== esp) {
      quebras++;
      if (quebras <= 5) {
        console.log(vermelho(`  ✗ posição ${i + 1}: veio ${linhas[i].name}, esperado ${esp}`));
      }
    }
  }
  if (quebras === 0) {
    console.log(verde(`  ✓ ${linhas.length} chamadas na ordem exata, sem repetir e sem pular`));
    console.log(fraco(`    ${linhas.slice(0, 9).map((l) => l.name.split(' ')[0]).join(' → ')} → …`));
  } else {
    falhou = true;
    console.log(vermelho(`  ${quebras} quebra(s) de ordem`));
  }

  // ── 3. O ponteiro voltou pro lugar ────────────────────────────────────────
  // 30 é múltiplo de 3: dez voltas completas deixam o ponteiro exatamente onde
  // estava. É por isso que rodar este teste em produção não desequilibra o dia.
  if (N % ordemDaRoda.length === 0) {
    const { rows: [p] } = await cli.query(
      `select u.name from qs_assign_state s join qs_users u on u.id = s.last_owner_id where s.scope = 'fila:forms'`
    );
    const voltouAoInicio = p.name === ordemDaRoda[ordemDaRoda.length - 1];
    if (!voltouAoInicio) falhou = true;
    console.log(`\nPONTEIRO\n  ${voltouAoInicio ? verde('✓') : vermelho('✗')} parou em ${p.name} — ${N} sendo múltiplo de ${ordemDaRoda.length}, a roda fechou certinho`);
  }

  console.log(falhou ? vermelho('\nRESULTADO: FALHOU\n') : verde('\nRESULTADO: PASSOU\n'));
} finally {
  await encerrar();
}

process.exit(falhou ? 1 : 0);
