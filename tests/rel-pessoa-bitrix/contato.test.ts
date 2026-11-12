// Pessoa do QS → contato no Bitrix (api/_relPessoaBitrix.js, revisão 12/11).
// bx/rest de mentira — nada sai pra rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../api/_relPessoaBitrix.js";

const pessoa = (extra: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", nome: "Maria da Silva", telefone: "5511987654321", email: null, cpf: null,
  nascimento: null, bitrix_contato_id: null, mesclado_em_id: null, arquivado_em: null, ...extra,
});

test("sem CPF, telefone nem e-mail → sem_dados (não cria só com o nome)", () => {
  assert.equal(R.planejarContato(pessoa({ telefone: null })).acao, "sem_dados");
});

test("CPF único liga sem olhar o nome; CPF repetido é ambíguo", () => {
  const p = pessoa({ cpf: "12345678901" });
  assert.deepEqual(R.planejarContato(p, { cpf: [{ ID: "77" }] }), { acao: "vincular", contatoId: "77", por: "cpf" });
  assert.equal(R.planejarContato(p, { cpf: [{ ID: "77" }, { ID: "78" }] }).acao, "ambiguo");
});

test("telefone da família: só liga se o nome bate; senão cria contato novo", () => {
  const mae = { ID: "50", NAME: "Joana", LAST_NAME: "da Silva" };
  const eu = { ID: "51", NAME: "Maria", LAST_NAME: "Silva" };
  assert.equal(R.planejarContato(pessoa(), { telefone: [mae] }).acao, "criar");
  assert.deepEqual(R.planejarContato(pessoa(), { telefone: [mae, eu] }), { acao: "vincular", contatoId: "51", por: "telefone" });
  assert.equal(R.planejarContato(pessoa(), { telefone: [eu, { ...eu, ID: "52" }] }).acao, "ambiguo");
});

test("nomeBate: primeiro e último nome, sem acento", () => {
  assert.equal(R.nomeBate("José Antônio Souza", { NAME: "Jose", LAST_NAME: "Souza" }), true);
  assert.equal(R.nomeBate("José Souza", { NAME: "Jose", LAST_NAME: "Pereira" }), false);
  assert.equal(R.nomeBate("José", { NAME: "Jose", LAST_NAME: "Pereira" }), true);
});

test("contato novo leva telefone, e-mail, CPF e nascimento", () => {
  const f = R.montarContatoDaPessoa(pessoa({ email: "M@X.com", cpf: "123.456.789-01", nascimento: "1990-02-03" }));
  assert.equal(f.NAME, "Maria da Silva");
  assert.deepEqual(f.PHONE, [{ VALUE: "5511987654321", VALUE_TYPE: "MOBILE" }]);
  assert.deepEqual(f.EMAIL, [{ VALUE: "m@x.com", VALUE_TYPE: "HOME" }]);
  assert.equal(f[R.CAMPO_CONTATO_CPF], "12345678901");
  assert.equal(f.BIRTHDATE, "1990-02-03");
});

function falsos(respostas: Record<string, unknown>, falha?: string) {
  const chamadas: { metodo: string; params: unknown }[] = [];
  const escritas: { path: string; body: unknown }[] = [];
  const bx = async (metodo: string, params: unknown) => {
    chamadas.push({ metodo, params });
    if (falha === metodo) throw new Error("Bitrix fora");
    return respostas[metodo] ?? null;
  };
  const rest = async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    if (opts.method && opts.method !== "GET") escritas.push({ path, body: opts.body });
    return [];
  };
  return { bx, rest, chamadas, escritas };
}

test("simulação (seco) não escreve nada nem cria", async () => {
  const f = falsos({ "crm.duplicate.findbycomm": { CONTACT: [] } });
  const r = await R.garantirContato(pessoa(), { bx: f.bx, rest: f.rest, seco: true });
  assert.equal(r.acao, "criar");
  assert.equal(f.escritas.length, 0);
  assert.ok(!f.chamadas.some((c) => c.metodo === "crm.contact.add"));
});

test("real: não achou → cria e grava o id só se a ficha ainda estiver sem contato", async () => {
  const f = falsos({ "crm.duplicate.findbycomm": { CONTACT: [] }, "crm.contact.add": 900 });
  const r = await R.garantirContato(pessoa(), { bx: f.bx, rest: f.rest });
  assert.equal(r.status, "ok");
  assert.equal(r.contatoId, "900");
  assert.ok(f.escritas.some((e) => e.path.includes("rel_clientes?id=eq.") && e.path.includes("bitrix_contato_id=is.null")));
});

test("Bitrix fora na busca → falhou, e NÃO cria", async () => {
  const f = falsos({}, "crm.duplicate.findbycomm");
  const r = await R.garantirContato(pessoa(), { bx: f.bx, rest: f.rest });
  assert.equal(r.status, "falhou");
  assert.ok(!f.chamadas.some((c) => c.metodo === "crm.contact.add"));
  assert.ok(f.escritas.some((e) => e.path.startsWith("rel_clientes_bitrix") && (e.body as { status: string }).status === "falhou"));
});
