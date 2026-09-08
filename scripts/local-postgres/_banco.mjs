// scripts/local-postgres/_banco.mjs
// -----------------------------------------------------------------------------
// Sobe um Postgres DE VERDADE na sua máquina — sem Docker, sem instalar nada no
// sistema, sem encostar no Supabase de produção.
//
// O pacote `embedded-postgres` baixa os binários oficiais do Postgres 17 (a
// mesma família que o Supabase roda) e sobe um servidor numa pasta temporária,
// numa porta alta. Ao final o processo morre e a pasta some.
//
// POR QUE UM SERVIDOR DE VERDADE, e não um Postgres em WASM: o WASM aceita uma
// conexão só, e o que precisa ser provado aqui é justamente o que acontece
// quando VÁRIAS conexões pedem a vez ao mesmo tempo. Sem conexões paralelas não
// existe prova de concorrência — existe só uma fila de um.
// -----------------------------------------------------------------------------
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');

export const PORTA = 54329;

// O banco de trabalho é criado à parte, em UTF-8. No Windows o initdb usa a
// codificação da máquina (WIN1252), e aí um traço "─" de comentário — que as
// migrations do QS usam aos montes nos cabeçalhos — não tem equivalente e o
// CREATE FUNCTION morre com "has no equivalent in encoding WIN1252".
// O Supabase roda UTF-8; o banco local tem que rodar igual.
export const BANCO = 'qs_local';
export const CONEXAO = {
  host: 'localhost', port: PORTA, user: 'postgres', password: 'postgres', database: BANCO,
};

/** Sobe o banco, aplica o esqueleto do QS e a migration 0076. */
export async function subirBanco({ migration = '0076_pool_de_numeros.sql', silencioso = false } = {}) {
  const log = silencioso ? () => {} : (...a) => console.log(...a);

  const dataDir = path.join(AQUI, '.dados-temporarios');
  fs.rmSync(dataDir, { recursive: true, force: true });

  const servidor = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: CONEXAO.user,
    password: CONEXAO.password,
    port: PORTA,
    persistent: false,          // a pasta é apagada ao parar
  });

  log('Subindo Postgres local (a primeira vez baixa os binários)…');
  await servidor.initialise();
  await servidor.start();
  log(`Postgres no ar em localhost:${PORTA}`);

  // template0 é o único template que aceita mudar a codificação.
  const admin = new pg.Client({ ...CONEXAO, database: 'postgres' });
  await admin.connect();
  await admin.query(`create database ${BANCO} with encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  log(`Banco "${BANCO}" criado em UTF-8.\n`);

  const cli = new pg.Client(CONEXAO);
  await cli.connect();

  await cli.query(fs.readFileSync(path.join(AQUI, 'esqueleto.sql'), 'utf8'));
  log('Esqueleto do QS aplicado.');

  const sql = fs.readFileSync(path.join(REPO, 'supabase', 'migrations', migration), 'utf8');
  await cli.query(sql);
  log(`Migration ${migration} aplicada.`);

  // Roda de novo: a migration se diz idempotente, então tem que aguentar.
  await cli.query(sql);
  log('Migration reaplicada (idempotência conferida).\n');

  return { servidor, cli, encerrar: async () => { await cli.end(); await servidor.stop(); } };
}

/**
 * Cadastra os chips. Números FALSOS de propósito — este banco nunca fala com o
 * WhatsApp, e número real em arquivo de teste é o começo de um vazamento.
 */
export async function cadastrarChips(cli, { reservas = 2 } = {}) {
  const { rows: sdrs } = await cli.query(
    `select id, name from qs_users where role = 'sdr' and is_active order by created_at, id`
  );
  for (let i = 0; i < sdrs.length; i++) {
    await cli.query(
      `insert into sdr_pool (sdr_id, sdr_nome, numero, status) values ($1, $2, $3, 'ativo')`,
      [sdrs[i].id, sdrs[i].name, `551190000000${i + 1}`]
    );
  }
  for (let i = 0; i < reservas; i++) {
    // Uma por vez: clock_timestamp() dá carimbos distintos, e é isso que faz
    // "a reserva mais antiga entra primeiro" ser ordem e não sorteio.
    await cli.query(`insert into sdr_pool (numero, status) values ($1, 'reserva')`,
      [`551190000${String(1000 + i)}`]);
  }
  return sdrs;
}
