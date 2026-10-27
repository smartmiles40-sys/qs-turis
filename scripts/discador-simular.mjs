// scripts/discador-simular.mjs
// -----------------------------------------------------------------------------
// Testes + simulação do MOTOR do discador (src/lib/discador/motor.ts) SEM rede.
// Não liga pra ninguém, não fala com a VoxFree nem com o Supabase.
//
//   node scripts/discador-simular.mjs            → cenários (asserts) + simulação
//   node scripts/discador-simular.mjs --seed 7   → outra semente aleatória
//
// O motor é TypeScript; o esbuild (que já vem com o Vite) transpila na hora.
// -----------------------------------------------------------------------------

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "discador-"));
const saida = join(tmp, "motor.mjs");
await build({
  entryPoints: [join(raiz, "src/lib/discador/motor.ts")],
  outfile: saida, format: "esm", platform: "node", bundle: true, logLevel: "error",
});
const M = await import(pathToFileURL(saida).href);
rmSync(tmp, { recursive: true, force: true });

// ── utilitários ──────────────────────────────────────────────────────────────
const cfg = M.normalizarConfig({});
const itens = (n, pref = "L") =>
  Array.from({ length: n }, (_, i) => ({ tarefaId: `T${pref}${i}`, leadId: `${pref}${i}`, telefone: `55119900000${String(i).padStart(2, "0")}` }));

function rodar(lote, eventos) {
  const cmds = [];
  for (const ev of eventos) {
    const r = M.aplicarEvento(lote, ev);
    lote = r.lote;
    cmds.push(...r.comandos);
  }
  return { lote, cmds };
}
const status = (l) => l.pernas.map((p) => p.status);
const acoes = (l) => l.pernas.map((p) => M.acaoDaTarefa(p.status));

let ok = 0;
function cenario(nome, fn) {
  try { fn(); ok++; console.log(`  ✔ ${nome}`); }
  catch (e) { console.error(`  ✘ ${nome}\n    ${e.message}`); process.exitCode = 1; }
}

console.log("\nCENÁRIOS");

cenario("ninguém atende → todos 'não atendeu' + CANCEL em todos aos 20 s", () => {
  let l = M.novoLote(1, itens(5), 0);
  const { lote, cmds } = rodar(l, [
    ...[0, 1, 2, 3, 4].map((idx) => ({ tipo: "tocando", idx, t: 800 })),
    { tipo: "relogio", t: 19_999, toqueMs: 20_000 },
    { tipo: "relogio", t: 20_000, toqueMs: 20_000 },
  ]);
  assert.deepEqual(status(lote), Array(5).fill("nao_atendeu"));
  assert.equal(cmds.filter((c) => c.tipo === "cancelar").length, 5);
  assert.ok(M.loteResolvido(lote));
  assert.deepEqual(acoes(lote), Array(5).fill("nao_atendeu"));
  assert.deepEqual(M.leadsConsumidos(lote).length, 5);
});

cenario("1 atende → vira do SDR, as outras 4 são canceladas e voltam pra fila", () => {
  const { lote, cmds } = rodar(M.novoLote(1, itens(5), 0), [
    ...[0, 1, 2, 3, 4].map((idx) => ({ tipo: "tocando", idx, t: 900 })),
    { tipo: "atendeu", idx: 2, t: 6_000 },
    { tipo: "atendeu", idx: 2, t: 6_050 }, // confirmed repetido
    { tipo: "falhou", idx: 0, t: 6_100, sipCode: 487, cause: "Canceled" }, // eco do nosso CANCEL
  ]);
  assert.equal(lote.vencedora, 2);
  assert.deepEqual(status(lote), ["cancelada", "cancelada", "vencedora", "cancelada", "cancelada"]);
  assert.deepEqual(cmds.map((c) => c.tipo), ["promover", "cancelar", "cancelar", "cancelar", "cancelar"]);
  assert.deepEqual(acoes(lote), ["devolver", "devolver", "sdr", "devolver", "devolver"]);
  assert.equal(M.itensDevolvidos(lote).length, 4);
});

cenario("2 atendem quase juntos → 2ª é DERRUBADA (BYE) e ganha retorno urgente", () => {
  const { lote, cmds } = rodar(M.novoLote(1, itens(4), 0), [
    { tipo: "atendeu", idx: 1, t: 5_000 },
    { tipo: "atendeu", idx: 3, t: 5_020 }, // o 200 OK cruzou com o nosso CANCEL
  ]);
  assert.deepEqual(status(lote), ["cancelada", "vencedora", "cancelada", "derrubada"]);
  assert.ok(cmds.some((c) => c.tipo === "desligar" && c.idx === 3));
  assert.deepEqual(acoes(lote), ["devolver", "sdr", "devolver", "retorno"]);
  const s = M.fecharLote(M.novaSessao(cfg), lote, M.detectarLimiteCanais(lote, cfg), cfg);
  assert.equal(s.atendidas, 2);
  assert.equal(s.abandonadas, 1);
  assert.ok(s.nAtual < cfg.lote, "abandono de 50% tem que baixar o lote");
});

cenario("caixa postal antes do tempo → atende (o SDR marca 'caixa postal'); depois do tempo → nem chega", () => {
  const a = rodar(M.novoLote(1, itens(1), 0), [{ tipo: "atendeu", idx: 0, t: 15_000 }]).lote;
  assert.equal(a.vencedora, 0);
  const b = rodar(M.novoLote(1, itens(1), 0), [{ tipo: "relogio", t: 20_000, toqueMs: 20_000 }]).lote;
  assert.equal(b.pernas[0].status, "nao_atendeu");
});

cenario("respostas SIP por número: 404/484 inválido, 486 ocupado, 480 indisponível — sem travar o lote", () => {
  const { lote } = rodar(M.novoLote(1, itens(4), 0), [
    { tipo: "tocando", idx: 2, t: 900 },
    { tipo: "tocando", idx: 3, t: 900 },
    { tipo: "falhou", idx: 0, t: 2_000, sipCode: 404, cause: "Not Found" },
    { tipo: "falhou", idx: 1, t: 2_100, sipCode: 484, cause: "Address Incomplete" },
    { tipo: "falhou", idx: 2, t: 4_000, sipCode: 486, cause: "Busy" },
    { tipo: "falhou", idx: 3, t: 9_000, sipCode: 480, cause: "Unavailable" },
  ]);
  assert.deepEqual(status(lote), ["invalido", "invalido", "ocupado", "nao_atendeu"]);
  assert.deepEqual(acoes(lote), ["numero_errado", "numero_errado", "nao_atendeu", "nao_atendeu"]);
  assert.ok(M.loteResolvido(lote));
  assert.equal(M.detectarLimiteCanais(lote, cfg).tipo, "ok", "recusas lentas não são limite");
});

cenario("central aceita só 3 → as 2 últimas voltam recusadas na hora; N cai pra 3 e avisa", () => {
  let { lote } = rodar(M.novoLote(1, itens(5), 0), [
    { tipo: "tocando", idx: 0, t: 700 }, { tipo: "tocando", idx: 1, t: 700 }, { tipo: "tocando", idx: 2, t: 700 },
    { tipo: "falhou", idx: 3, t: 150, sipCode: 503, cause: "SIP Failure Code" },
    { tipo: "falhou", idx: 4, t: 160, sipCode: 503, cause: "SIP Failure Code" },
    { tipo: "relogio", t: 20_000, toqueMs: 20_000 },
  ]);
  const d = M.detectarLimiteCanais(lote, cfg);
  assert.equal(d.tipo, "limite");
  assert.equal(d.capacidade, 3);
  lote = M.marcarRecusasDaCentral(lote, d);
  assert.deepEqual(acoes(lote), ["nao_atendeu", "nao_atendeu", "nao_atendeu", "devolver", "devolver"]);
  const s = M.fecharLote(M.novaSessao(cfg), lote, d, cfg);
  assert.equal(s.nAtual, 3);
  assert.equal(s.capacidadeCentral, 3);
  assert.equal(s.recusasCentral, 2);
  assert.match(s.avisos[0], /aceitou só 3/);
});

cenario("central recusa TUDO duas vezes seguidas → sessão bloqueada", () => {
  let s = M.novaSessao(cfg);
  const l1 = rodar(M.novoLote(1, itens(5), 0), [0, 1, 2, 3, 4].map((idx) => ({ tipo: "falhou", idx, t: 100, sipCode: 403 }))).lote;
  const d1 = M.detectarLimiteCanais(l1, cfg);
  assert.equal(d1.tipo, "recusou_tudo");
  s = M.fecharLote(s, M.marcarRecusasDaCentral(l1, d1), d1, cfg);
  assert.equal(s.nAtual, 1);
  assert.equal(s.bloqueio, null);
  const l2 = rodar(M.novoLote(2, itens(1, "X"), 0), [{ tipo: "falhou", idx: 0, t: 120, sipCode: 403 }]).lote;
  s = M.fecharLote(s, l2, M.detectarLimiteCanais(l2, cfg), cfg);
  assert.ok(s.bloqueio, "segunda recusa total tem que parar");
});

cenario("um 'ocupado' rápido sozinho no meio do lote NÃO é limite", () => {
  const { lote } = rodar(M.novoLote(1, itens(5), 0), [
    { tipo: "tocando", idx: 0, t: 700 }, { tipo: "falhou", idx: 1, t: 300, sipCode: 486 },
    { tipo: "tocando", idx: 2, t: 700 }, { tipo: "tocando", idx: 3, t: 700 }, { tipo: "tocando", idx: 4, t: 700 },
  ]);
  assert.equal(M.detectarLimiteCanais(lote, cfg).tipo, "ok");
});

cenario("parar no meio → as que tocam são canceladas e nenhuma tarefa é mexida", () => {
  const { lote, cmds } = rodar(M.novoLote(1, itens(3), 0), [
    { tipo: "tocando", idx: 0, t: 700 }, { tipo: "parar", t: 3_000 },
  ]);
  assert.deepEqual(status(lote), ["cancelada", "cancelada", "cancelada"]);
  assert.equal(cmds.length, 3);
  assert.deepEqual(acoes(lote), ["devolver", "devolver", "devolver"]);
});

cenario("config: lote 50 vira 10, toque 2 s vira 8 s, lixo vira padrão", () => {
  const c = M.normalizarConfig({ lote: 50, loteMax: 99, toqueSeg: 2, abandonoMax: "x" });
  assert.equal(c.lote, 10); assert.equal(c.loteMax, 10); assert.equal(c.toqueSeg, 8); assert.equal(c.abandonoMax, 0.03);
});

cenario("montagem: não repete lead no lote, pula quem já foi discado hoje e telefone curto", () => {
  const fila = [
    { tarefaId: "a", leadId: "L1", telefone: "5511990000001" },
    { tarefaId: "b", leadId: "L1", telefone: "5511990000001" }, // 2ª tarefa do mesmo lead
    { tarefaId: "c", leadId: "L2", telefone: "5511990000002" },
    { tarefaId: "d", leadId: "L3", telefone: "123" },
    { tarefaId: "e", leadId: "L4", telefone: "5511990000004" },
    { tarefaId: "f", leadId: "L5", telefone: "5511990000005" },
  ];
  const { itens: lote, resto } = M.proximoLote(fila, 3, new Set(["L4"]));
  assert.deepEqual(lote.map((i) => i.tarefaId), ["a", "c", "f"]);
  assert.ok(!resto.some((i) => i.leadId === "L4" || i.leadId === "L1"));
});

cenario("devolvido mais de 2 vezes sai da sessão", () => {
  const cont = new Map();
  const it = itens(1)[0];
  M.reenfileirar([], [it], cont); M.reenfileirar([], [it], cont);
  const r = M.reenfileirar([], [it], cont);
  assert.equal(r.fila.length, 0); assert.equal(r.descartados.length, 1);
});

console.log(`\n${ok} cenários OK${process.exitCode ? " — HÁ FALHAS" : ""}`);

// ── Simulação aleatória (sessões inteiras) ───────────────────────────────────
const argSeed = process.argv.indexOf("--seed");
let seed = argSeed > 0 ? Number(process.argv[argSeed + 1]) : 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

/**
 * Perfil do lead (por chamada): atende 15% (entre 3 e 26 s — depois de 20 s já
 * desistimos), ocupado 8%, inválido 5%, indisponível 7%, o resto toca até o fim.
 * A central aceita `capacidade` chamadas simultâneas; acima disso responde 503
 * em ~150 ms.
 */
const JANELA_CORRIDA_MS = 150;

function simularSessao({ leads, lote, capacidade, nome }) {
  const c = M.normalizarConfig({ lote });
  let s = M.novaSessao(c);
  let fila = itens(leads, "S");
  const consumidos = new Set();
  const devolucoes = new Map();
  let descartados = 0;
  let relogio = 0;
  let guarda = 0;
  while (fila.length && !s.bloqueio && guarda++ < 10_000) {
    const { itens: lt, resto } = M.proximoLote(fila, s.nAtual, consumidos);
    if (!lt.length) break;
    let l = M.novoLote(s.lotes + 1, lt, relogio);
    const evs = [];
    lt.forEach((_, idx) => {
      if (idx >= capacidade) { evs.push({ tipo: "falhou", idx, t: relogio + 150, sipCode: 503 }); return; }
      const r = rnd();
      evs.push({ tipo: "tocando", idx, t: relogio + 600 + rnd() * 900 });
      if (r < 0.15) evs.push({ tipo: "atendeu", idx, t: relogio + 3_000 + rnd() * 23_000 });
      else if (r < 0.23) evs.push({ tipo: "falhou", idx, t: relogio + 2_000 + rnd() * 6_000, sipCode: 486 });
      else if (r < 0.28) evs.push({ tipo: "falhou", idx, t: relogio + 1_500, sipCode: 404 });
      else if (r < 0.35) evs.push({ tipo: "falhou", idx, t: relogio + 4_000 + rnd() * 8_000, sipCode: 480 });
    });
    for (let t = relogio; t <= relogio + c.toqueSeg * 1000; t += 250) evs.push({ tipo: "relogio", t, toqueMs: c.toqueSeg * 1000 });
    evs.sort((a, b) => a.t - b.t);
    // Corrida realista: depois do nosso CANCEL (fimMs) o telefone só "atende"
    // se o 200 OK já estava a caminho — janela de ~RTT (150 ms).
    for (const ev of evs) {
      if (ev.tipo === "atendeu") {
        const p = l.pernas[ev.idx];
        if (p.fimMs !== null && ev.t > p.fimMs + JANELA_CORRIDA_MS) continue;
      }
      l = M.aplicarEvento(l, ev).lote;
    }
    const d = M.detectarLimiteCanais(l, c);
    l = M.marcarRecusasDaCentral(l, d);
    s = M.fecharLote(s, l, d, c);
    for (const id of M.leadsConsumidos(l)) consumidos.add(id);
    const r = M.reenfileirar(resto, M.itensDevolvidos(l), devolucoes);
    fila = r.fila;
    descartados += r.descartados.length;
    relogio += c.toqueSeg * 1000 + c.intervaloMs + (l.vencedora !== null ? 180_000 : 0); // conversa ~3 min
  }
  const taxa = (M.taxaAbandono(s) * 100).toFixed(1);
  console.log(
    `  ${nome.padEnd(34)} lotes ${String(s.lotes).padStart(3)} · discadas ${String(s.discadas).padStart(4)} · atendidas ${String(s.atendidas).padStart(3)}` +
    ` · abandonadas ${String(s.abandonadas).padStart(2)} (${taxa}%) · N final ${s.nAtual}` +
    ` · recusas central ${s.recusasCentral} · fora da sessão ${descartados}${s.bloqueio ? " · BLOQUEADA" : ""}`,
  );
  if (s.avisos.length) console.log(`      1º aviso: ${s.avisos[0]}`);
  return s;
}

console.log(`\nSIMULAÇÃO (semente ${argSeed > 0 ? process.argv[argSeed + 1] : 42}, 300 leads por sessão)`);
const a = simularSessao({ nome: "lote 5, central sem limite", leads: 300, lote: 5, capacidade: 99 });
const b = simularSessao({ nome: "lote 5, central aceita só 3", leads: 300, lote: 5, capacidade: 3 });
const c2 = simularSessao({ nome: "lote 10, central sem limite", leads: 300, lote: 10, capacidade: 99 });
const d = simularSessao({ nome: "lote 1 (sem discador paralelo)", leads: 300, lote: 1, capacidade: 99 });
simularSessao({ nome: "central fora (limite 0)", leads: 50, lote: 5, capacidade: 0 });

// Propriedades que TÊM de valer em qualquer semente:
assert.equal(d.abandonadas, 0, "com lote 1 não existe abandono");
assert.ok(b.nAtual <= 3, "central de 3 canais nunca pode ficar com lote > 3");
for (const s of [a, b, c2]) assert.ok(s.nAtual >= 1 && s.nAtual <= 10);
console.log("\nPropriedades da simulação OK (lote 1 sem abandono; teto da central respeitado; 1 ≤ N ≤ 10).");
