// E-mail marketing (0245): segmentos, fila/429, automações, score.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import * as R from "../../api/_mktEmailRegras.js";

const ID = "3f2b8c1a-1111-4222-8333-944455556666";

test("segmentos: E/OU aninhado válido passa", () => {
  const regras = {
    combinar: "todas",
    condicoes: [
      { campo: "tag", op: "tem", valor: "japao" },
      { combinar: "qualquer", condicoes: [
        { campo: "abriu_email", op: "ultimos_dias", valor: "30" },
        { campo: "score", op: "maior_igual", valor: "10" },
        { combinar: "todas", condicoes: [{ campo: "campo", chave: "cidade", op: "igual", valor: "Recife" }] },
      ] },
      { campo: "lista", op: "esta", valor: ID },
      { campo: "criado", op: "depois_de", valor: "2026-10-01" },
      { campo: "clicou_email", op: "nunca" },
      { campo: "origem", op: "contem", valor: "live" },
    ],
  };
  assert.equal(R.validarRegras(regras), null);
  assert.equal(R.validarRegras({ combinar: "todas", condicoes: [] }), null, "raiz vazia = ninguém, aceita");
});

test("segmentos: recusa campo/operador fora da lista fechada (nada vira SQL cru)", () => {
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ campo: "senha", op: "igual", valor: "1" }] }), /campo/);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ campo: "tag", op: "; drop table x", valor: "a" }] }), /regra/);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ campo: "campo", chave: "a'b", op: "igual", valor: "x" }] }), /personalizado/);
  assert.match(R.validarRegras({ combinar: "e", condicoes: [] }), /todas/);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ campo: "lista", op: "esta", valor: "1 or 1=1" }] }), /lista/);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ campo: "abriu_email", op: "ultimos_dias", valor: "30; --" }] }), /dias/);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ campo: "score", op: "maior_igual", valor: "1e9" }] }), /pontua/);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ campo: "criado", op: "antes_de", valor: "ontem" }] }), /data/);
});

test("segmentos: limites de nível, grupo vazio e quantidade", () => {
  const fundo = (n: number): unknown => (n === 0 ? { campo: "tag", op: "tem", valor: "a" } : { combinar: "todas", condicoes: [fundo(n - 1)] });
  assert.equal(R.validarRegras({ combinar: "todas", condicoes: [fundo(3)] }), null);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [fundo(4)] }), /níveis/);
  assert.match(R.validarRegras({ combinar: "todas", condicoes: [{ combinar: "qualquer", condicoes: [] }] }), /vazio/);
  const muitas = Array.from({ length: 31 }, () => ({ campo: "tag", op: "tem", valor: "a" }));
  assert.match(R.validarRegras({ combinar: "todas", condicoes: muitas }), /30/);
});

test("público: vazio é erro (nunca 'todos'); limpa lixo", () => {
  assert.ok(R.limparPublico({}).erro);
  assert.ok(R.limparPublico({ listas: ["x"], tags: ["  "] }).erro);
  assert.deepEqual(R.limparPublico({ listas: [ID, ID, "lixo"], tags: [" vip ", "vip"], segmento_id: "" }).publico,
    { listas: [ID], tags: ["vip"], segmento_id: null });
});

test("fila: 429 devolve a tentativa e pausa pelo Retry-After", () => {
  assert.deepEqual(R.decidirAposErro({ status: 429, esperarMs: 12_000 }, 1), { status: "pendente", tentativas: 0, pausarMs: 12_000 });
  // 429 mesmo na 3ª tentativa NÃO vira falha
  assert.equal(R.decidirAposErro({ status: 429 }, 3).status, "pendente");
  assert.equal(R.decidirAposErro({ status: 429 }, 3).pausarMs, 5_000);
  assert.equal(R.decidirAposErro({ status: 429, esperarMs: 999_999 }, 1).pausarMs, 60_000, "teto de 1 min");
});

test("fila: 4xx é definitivo; 5xx tenta até 3", () => {
  assert.equal(R.decidirAposErro({ status: 422, permanente: true }, 1).status, "falha");
  assert.equal(R.decidirAposErro({ status: 500 }, 1).status, "pendente");
  assert.equal(R.decidirAposErro({ status: 500 }, 2).status, "pendente");
  assert.equal(R.decidirAposErro({ status: 500 }, 3).status, "falha");
  assert.equal(R.decidirAposErro({}, 1).status, "pendente", "erro de rede tenta de novo");
});

test("Retry-After: segundos, data HTTP e ausente", () => {
  assert.equal(R.retryAfterMs("3"), 3000);
  assert.equal(R.retryAfterMs(null), 5000);
  const agora = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(R.retryAfterMs("Fri, 30 Oct 2026 12:00:10 GMT", agora), 10_000);
  assert.equal(R.retryAfterMs("lixo"), 5000);
});

test("orçamento do tick", () => {
  let t = 0;
  const o = R.criarOrcamento(1000, () => t);
  assert.equal(o.cabe(900), true);
  t = 500;
  assert.equal(o.cabe(600), false);
  assert.equal(o.resta(), 500);
});

test("automação: anda até a próxima espera, junta e-mails seguidos", () => {
  const m1 = ID, m2 = ID.replace("1111", "2222");
  const passos = [{ tipo: "email", modelo_id: m1 }, { tipo: "esperar", minutos: 1440 }, { tipo: "email", modelo_id: m2 }, { tipo: "email", modelo_id: m1 }];
  const t0 = 1_000_000;
  assert.deepEqual(R.planejarExecucao(passos, 0, t0), { emails: [{ passo: 0, modelo_id: m1 }], proximoPasso: 2, proximoEm: t0 + 1440 * 60_000, concluida: false });
  assert.deepEqual(R.planejarExecucao(passos, 2, t0), { emails: [{ passo: 2, modelo_id: m2 }, { passo: 3, modelo_id: m1 }], proximoPasso: 4, proximoEm: null, concluida: true });
  assert.deepEqual(R.planejarExecucao(passos, 4, t0), { emails: [], proximoPasso: 4, proximoEm: null, concluida: true });
  // começa com espera: nada sai agora
  assert.equal(R.planejarExecucao([{ tipo: "esperar", minutos: 60 }, { tipo: "email", modelo_id: m1 }], 0, t0).emails.length, 0);
});

test("automação: validação dos passos (igual ao CHECK do banco)", () => {
  assert.equal(R.validarPassos([{ tipo: "email", modelo_id: ID }, { tipo: "esperar", minutos: 60 }]), null);
  assert.match(R.validarPassos([]), /pelo menos/);
  assert.match(R.validarPassos([{ tipo: "email", modelo_id: "x" }]), /modelo/);
  assert.match(R.validarPassos([{ tipo: "esperar", minutos: 0 }]), /espera/);
  assert.match(R.validarPassos([{ tipo: "esperar", minutos: 200_000 }]), /90 dias/);
  assert.match(R.validarPassos([{ tipo: "sms" }]), /desconhecido/);
});

test("score: pesos e recálculo 1x por dia (São Paulo)", () => {
  assert.deepEqual(R.limparPesos({ email_abriu: "2", email_clicou: 4 }).pesos, { email_abriu: 2, email_clicou: 4 });
  assert.ok(R.limparPesos({ "drop table": 1 }).erro);
  assert.ok(R.limparPesos({ email_abriu: 1.5 }).erro);
  assert.ok(R.limparPesos({ email_abriu: 500 }).erro);
  assert.equal(R.precisaRecalcularScore(null), true);
  // 23h de SP (02:00 UTC) e 01h de SP do dia seguinte: dias diferentes
  assert.equal(R.precisaRecalcularScore("2026-10-30T02:00:00Z", new Date("2026-10-30T04:00:00Z")), true);
  assert.equal(R.precisaRecalcularScore("2026-10-30T04:00:00Z", new Date("2026-10-30T23:00:00Z")), false);
});

test("remetente precisa ser do domínio verificado", () => {
  assert.equal(R.remetenteDoDominio("ola@mail.stfv.com.br", "mail.stfv.com.br"), true);
  assert.equal(R.remetenteDoDominio("ola@gmail.com", "mail.stfv.com.br"), false);
  assert.equal(R.emailValido("a b@c.com"), false);
});

// 0340 — teto diário (aquecimento do domínio)
test("teto diário: sem teto = infinito; com teto desconta o que já saiu; nunca negativo", () => {
  assert.equal(R.calcularRestante(null, 50), Infinity);
  assert.equal(R.calcularRestante(undefined, 50), Infinity);
  assert.equal(R.calcularRestante(0, 0), Infinity);
  assert.equal(R.calcularRestante(200, 0), 200);
  assert.equal(R.calcularRestante(200, 150), 50);
  assert.equal(R.calcularRestante(200, 200), 0);
  assert.equal(R.calcularRestante(200, 350), 0);
});

test("409 (mesma Idempotency-Key em andamento) volta pra fila, não vira falha", () => {
  const d = R.decidirAposErro({ status: 409, permanente: false }, 1);
  assert.equal(d.status, "pendente");
});
