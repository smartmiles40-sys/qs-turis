// Selo da inscrição no nome do passageiro (Bruno 03/11 — src/expedicoes/lib/inscricaoPax.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadosDeInscricao, preencheuFormulario, textoResumoInscricoes, type InscricaoMin, type PaxInscricao } from "../../src/expedicoes/lib/inscricaoPax.ts";

const pax = (id: string, cpf: string | null, extra: Partial<PaxInscricao> = {}): PaxInscricao =>
  ({ id, cpf, status_reserva: "Confirmado", perfil_viajante: null, inscricao_origem: null, saude: null, ...extra } as PaxInscricao);
const ins = (id: string, cpf: string, status = "pendente"): InscricaoMin => ({ id, cpf, status, expedicao_id: "E1" });

test("inscrição: pendente com o mesmo CPF (com ou sem pontuação) = aguardando aprovação", () => {
  const r = estadosDeInscricao([pax("a", "123.456.789-09")], [ins("i1", "12345678909")]);
  assert.deepEqual(r.porPax.get("a"), { estado: "aguardando", inscricaoId: "i1" });
  assert.equal(r.resumo.aguardando, 1);
  assert.equal(r.semPassageiro.length, 0);
});

test("inscrição: veio do formulário = aprovada; perfil preenchido ou saúde respondida = ficha respondida", () => {
  const r = estadosDeInscricao([
    pax("a", "1", { inscricao_origem: "Formulário público" }),
    pax("b", "2", { perfil_viajante: { profissao: "Médica" } as PaxInscricao["perfil_viajante"] }),
    pax("c", "3", { saude: { problema_saude: "Não" } }),
  ], []);
  assert.equal(r.porPax.get("a")?.estado, "aprovada");
  assert.equal(r.porPax.get("b")?.estado, "respondida");
  assert.equal(r.porPax.get("c")?.estado, "respondida");
});

test("inscrição: sem nada = falta responder; só recusada = recusada; pendente ganha da recusada", () => {
  const r = estadosDeInscricao([pax("a", "111"), pax("b", "222"), pax("c", "333")], [
    ins("r1", "222", "recusada"), ins("r2", "333", "recusada"), ins("p3", "333"),
  ]);
  assert.equal(r.porPax.get("a")?.estado, "falta");
  assert.deepEqual(r.porPax.get("b"), { estado: "recusada", inscricaoId: "r1" });
  assert.deepEqual(r.porPax.get("c"), { estado: "aguardando", inscricaoId: "p3" });
});

test("inscrição: cancelado fica de fora; inscrição sem passageiro na lista vai à parte", () => {
  const r = estadosDeInscricao([pax("a", "111", { status_reserva: "Cancelado" }), pax("b", null)], [ins("i1", "111"), ins("i2", "999")]);
  assert.equal(r.porPax.has("a"), false);
  assert.equal(r.porPax.get("b")?.estado, "falta");
  // o CPF do cancelado não conta como "tem passageiro"
  assert.deepEqual(r.semPassageiro.map((i) => i.id), ["i1", "i2"]);
  assert.equal(r.resumo.semPassageiro, 2);
});

test("inscrição: texto do resumo", () => {
  const r = estadosDeInscricao([pax("a", "1"), pax("b", "2"), pax("c", "3", { inscricao_origem: "Formulário público" })], [ins("i", "1")]);
  assert.equal(textoResumoInscricoes(r.resumo), "1 aguardando aprovação · 1 falta responder · 1 com ficha ok");
  assert.equal(textoResumoInscricoes(estadosDeInscricao([], []).resumo), "Ninguém na lista ainda");
});

test("preencheuFormulario: regra do app antigo", () => {
  assert.equal(preencheuFormulario({ perfil_viajante: null, inscricao_origem: null } as never), false);
  assert.equal(preencheuFormulario({ perfil_viajante: { confirmou_veracidade: true }, inscricao_origem: null } as never), true);
  assert.equal(preencheuFormulario({ perfil_viajante: { musica: "  " }, inscricao_origem: null } as never), false);
});
