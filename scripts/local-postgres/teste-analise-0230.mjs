// scripts/local-postgres/teste-analise-0230.mjs
// -----------------------------------------------------------------------------
// Testa a migration 0230 (análise pós-venda) num Postgres LOCAL de verdade
// (embedded-postgres), com um esqueleto mínimo das tabelas que ela encosta.
// Nada toca o Supabase de produção.
//
//   cd scripts/local-postgres && npm install && node teste-analise-0230.mjs
//
// Confere: aplica 2× (idempotente); venda do closer com falta abre UMA
// solicitação pro Rel (de comercial → relacionamento, tipo rel_emissoes_pendentes,
// prioridade pela data); reanálise comenta na mesma; tudo emitido comenta
// "pode concluir"; venda do próprio Rel não abre pedido; histórico guardado;
// marcar item emitido; permissões (authenticated não grava análise).
// -----------------------------------------------------------------------------
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const PORTA = 54331;
const C = { host: 'localhost', port: PORTA, user: 'postgres', password: 'postgres', database: 'qs_0230' };

const ESQUELETO = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('teste.uid', true), '')::uuid $f$;
grant usage on schema auth to authenticated, service_role, anon;
create table qs_users (id uuid primary key default gen_random_uuid(), name text, role text, is_active boolean default true, setores text[] default '{}');
create table rel_clientes (id uuid primary key default gen_random_uuid(), nome text);
create table rel_viagens (id uuid primary key default gen_random_uuid(), cliente_id uuid, titulo text, destino text, expedicao text);
create table qs_closer_negocios (id uuid primary key default gen_random_uuid(), closer_id uuid, lead_id uuid);
create table qs_propostas (id uuid primary key default gen_random_uuid());
create table qs_vendas (id uuid primary key default gen_random_uuid(), origem text not null, negocio_id uuid, viagem_id uuid,
  cliente_id uuid references rel_clientes(id), valor_total numeric, pagamento jsonb default '{}', criado_por uuid,
  criado_em timestamptz default now(), atualizado_em timestamptz default now());
create table qs_venda_itens (id uuid primary key default gen_random_uuid(), venda_id uuid references qs_vendas(id), tipo text, nome text,
  dados jsonb not null default '{}', status text not null default 'vendido');
create table qs_solicitacao_tipos (id text primary key, setor text not null, rotulo text not null, prazo_horas int not null default 8, ordem int not null default 100,
  ativo boolean not null default true, atualizado_em timestamptz default now(), formulario text, desfecho_dias int, prazo_alta_horas int, prazo_urgente_horas int, grupo text, papel text);
create table qs_solicitacoes (id uuid primary key default gen_random_uuid(), numero bigint generated always as identity, de_setor text not null, para_setor text not null,
  tipo_id text, titulo text not null, descricao text not null default '', prioridade text not null default 'normal', status text not null default 'nova',
  prazo timestamptz, prazo_manual boolean not null default false, cliente_id uuid, viagem_id uuid, sobre_nome text, criado_por uuid, atualizado_por uuid,
  closer_negocio_id uuid, atualizado_em timestamptz default now(), check (de_setor <> para_setor));
create table qs_solicitacao_eventos (id bigserial primary key, solicitacao_id uuid, tipo text, de text, para text, texto text, autor_id uuid, autor_nome text, criado_em timestamptz default now());
create or replace function rel_tem_acesso() returns boolean language sql stable as $f$ select exists(select 1 from qs_users where id=auth.uid() and (role='admin' or 'relacionamento'=any(setores))) $f$;
create or replace function ops_tem_acesso() returns boolean language sql stable as $f$ select exists(select 1 from qs_users where id=auth.uid() and (role='admin' or 'operacional'=any(setores))) $f$;
create or replace function qs_is_manager() returns boolean language sql stable as $f$ select exists(select 1 from qs_users where id=auth.uid() and role in ('admin','gestor')) $f$;
create or replace function app_eh_cliente() returns boolean language sql stable as $f$ select false $f$;
create or replace function qs_somar_minutos_uteis(p_de timestamptz, p_minutos int) returns timestamptz language sql as $f$ select p_de + make_interval(mins => p_minutos) $f$;
create or replace function qs_sol_horas(p_tipo text, p_prioridade text) returns int language sql as $f$
  select case p_prioridade when 'urgente' then prazo_urgente_horas when 'alta' then prazo_alta_horas else prazo_horas end from qs_solicitacao_tipos where id=p_tipo $f$;
create or replace function qs_sol_sobre(p_cliente uuid, p_viagem uuid) returns text language sql as $f$ select (select nome from rel_clientes where id=p_cliente) $f$;
`;

let ok = 0, falhou = 0;
const confere = (c, m) => { if (c) { ok++; console.log(`  ✓ ${m}`); } else { falhou++; console.log(`  ✗ ${m}`); } };

const dir = path.join(AQUI, '.dados-0230');
fs.rmSync(dir, { recursive: true, force: true });
const srv = new EmbeddedPostgres({ databaseDir: dir, user: C.user, password: C.password, port: PORTA, persistent: false });
await srv.initialise(); await srv.start();
const adm = new pg.Client({ ...C, database: 'postgres' }); await adm.connect();
await adm.query(`create database qs_0230 with encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`); await adm.end();
const db = new pg.Client(C); await db.connect();
try {
  await db.query(ESQUELETO);
  const sql = fs.readFileSync(path.join(REPO, 'supabase', 'migrations', '0230_venda_analise_pos_venda.sql'), 'utf8');
  await db.query(sql); await db.query(sql);
  confere(true, '0230 aplicada 2× (idempotente)');

  const one = async (s, p) => (await db.query(s, p)).rows[0];
  const closer = (await one(`insert into qs_users(name,role,setores) values('Closer Teste','closer','{comercial}') returning id`)).id;
  const relU = (await one(`insert into qs_users(name,role,setores) values('Rel Teste','user','{relacionamento}') returning id`)).id;
  const cli = (await one(`insert into rel_clientes(nome) values('Maria Silva') returning id`)).id;
  const venda = (await one(`insert into qs_vendas(origem,cliente_id,criado_por) values('closer',$1,$2) returning id`, [cli, closer])).id;
  const inicio = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const res = (status, falta, extra = {}) => JSON.stringify({ status, base: 'proposta', contagens: { ok: 2, falta, divergente: 0, extra: 0, total: 2 + falta },
    linhas: [], riscos: [{ nivel: 'alto', categoria: 'voo_interno', motivo: 'Voo interno sem bilhete', fonte: 'regra' }], risco_nivel: 'alto',
    faltam: falta ? ['Aéreo: HND → KIX'] : [], divergencias: [], resumo: `Falta emitir ${falta}.`, inicio, fim: inicio,
    texto_extrato: falta ? 'FALTA EMITIR:\n• Aéreo: HND → KIX' : 'Tudo emitido ✓', ia: { usada: false, aviso: 'Análise por IA indisponível' }, ...extra });

  await db.query(`set role service_role`);
  const r1 = (await one(`select venda_analise_gravar($1,$2::jsonb,$3,'subir_venda') r`, [venda, res('risco_alto', 1), closer])).r;
  await db.query(`reset role`);
  confere(r1.solicitacao_nova && r1.solicitacao_numero, `falta → abre solicitação nº ${r1.solicitacao_numero}`);
  const s = await one(`select * from qs_solicitacoes where id=$1`, [r1.solicitacao_id]);
  confere(s.de_setor === 'comercial' && s.para_setor === 'relacionamento' && s.tipo_id === 'rel_emissoes_pendentes', 'comercial → relacionamento, tipo Emissões pendentes');
  confere(s.prioridade === 'urgente' && /HND/.test(s.descricao) && /Maria Silva/.test(s.titulo), 'embarque em 10 dias = urgente; extrato na descrição');
  const v = await one(`select * from qs_vendas where id=$1`, [venda]);
  confere(v.analise_status === 'risco_alto' && v.analise_solicitacao_id === r1.solicitacao_id && v.analise_resumo.riscos_altos.length === 1, 'status e resumo gravados na venda');

  await db.query(`set role service_role`);
  const r2 = (await one(`select venda_analise_gravar($1,$2::jsonb,$3,'reanalise') r`, [venda, res('faltam_emissoes', 1), relU])).r;
  const r3 = (await one(`select venda_analise_gravar($1,$2::jsonb,$3,'reanalise') r`, [venda, res('tudo_emitido', 0, { riscos: [], risco_nivel: 'baixo' }), relU])).r;
  await db.query(`reset role`);
  confere(!r2.solicitacao_nova && r2.solicitacao_id === r1.solicitacao_id, 'reanálise com falta comenta na MESMA solicitação');
  const evs = (await db.query(`select tipo,texto from qs_solicitacao_eventos where solicitacao_id=$1 order by id`, [r1.solicitacao_id])).rows;
  confere(evs.length === 3 && evs[0].tipo === 'criada' && /pode concluir/.test(evs[2].texto), 'eventos: criada, reanálise, "pode concluir"');
  confere(r3.status === 'tudo_emitido' && (await one(`select count(*)::int n from qs_venda_analises where venda_id=$1`, [venda])).n === 3, 'histórico: 3 análises guardadas');
  confere((await one(`select analise_status from qs_vendas_analise_v where id=$1`, [venda])).analise_status === 'tudo_emitido', 'view do painel mostra o status');

  const vrel = (await one(`insert into qs_vendas(origem,cliente_id,criado_por) values('rel',$1,$2) returning id`, [cli, relU])).id;
  await db.query(`set role service_role`);
  const r4 = (await one(`select venda_analise_gravar($1,$2::jsonb,$3) r`, [vrel, res('faltam_emissoes', 2), relU])).r;
  await db.query(`reset role`);
  confere(r4.solicitacao_id === null && r4.status === 'faltam_emissoes', 'venda do próprio Rel: sem solicitação, status guardado');

  let negado = false;
  await db.query(`set role authenticated`);
  try { await db.query(`select venda_analise_gravar($1,$2::jsonb,$3)`, [vrel, res('tudo_emitido', 0), relU]); } catch { negado = true; }
  await db.query(`reset role`);
  confere(negado, 'authenticated NÃO grava análise (só o servidor)');

  const item = (await one(`insert into qs_venda_itens(venda_id,tipo,nome) values($1,'aereo','Voo interno') returning id`, [venda])).id;
  await db.query(`select set_config('teste.uid',$1,false)`, [relU]);
  await db.query(`set role authenticated`);
  await db.query(`select venda_item_marcar_emitido($1,'abc123','emitido no balcão')`, [item]);
  await db.query(`reset role`);
  const it = await one(`select * from qs_venda_itens where id=$1`, [item]);
  confere(it.status === 'emitido' && it.dados.localizador === 'ABC123', 'Rel marca item como emitido com localizador');
  await db.query(`select set_config('teste.uid',$1,false)`, [closer]);
  let bloq = false;
  try { await db.query(`select venda_item_marcar_emitido($1,'X',null)`, [item]); } catch (e) { bloq = /sem-permissao/.test(e.message); }
  confere(bloq, 'closer não marca emissão (sem-permissao)');
  let inval = false;
  await db.query(`set role service_role`);
  try { await db.query(`select venda_analise_gravar($1,'{"status":"xx"}'::jsonb,$2)`, [venda, closer]); } catch (e) { inval = /analise-status-invalido/.test(e.message); }
  await db.query(`reset role`);
  confere(inval, 'status inválido é recusado');
} catch (e) {
  falhou++; console.log('  ✗ ERRO:', e.message);
} finally {
  await db.end(); await srv.stop();
}
console.log(`\n${ok} ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
