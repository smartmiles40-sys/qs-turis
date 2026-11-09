// Contrato POR PESSOA (0352, 09/11): as regras puras de api/_contratoFamilia.js
// (quem assina, bloqueios, valor, resumo do cartão, idempotência) e a ação
// `contrato-enviar` com lista de pessoas rodando inteira em api/closer.js com um
// fetch DE MENTIRA (banco, Storage e ZapSign falsos — nada sai pra rede).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://sb.exemplo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
process.env.ZAPSIGN_API_TOKEN = "tk-zap";
process.env.ZAPSIGN_WEBHOOK_SECRET = "segredo-longo-123";
delete process.env.BITRIX_WEBHOOK_BASE;

import * as F from "../../api/_contratoFamilia.js";
import { montarPreviaDaPessoa, camposDasFontes } from "../../api/_contrato.js";

const HOJE = "09/11/2026";
const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VENDA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// clientes (rel_clientes) e pessoas da venda (qs_venda_pessoas)
const CLI = { carlos: id(1), ana: id(2), maria: id(3), pedro: id(4), joao: id(5) };
const VP = { carlos: id(11), ana: id(12), maria: id(13), pedro: id(14), joao: id(15) };

const ficha = (cid: string, nome: string, o: Record<string, unknown> = {}) => ({
  id: cid, nome, cpf: "52998224725", rg: "", nascimento: "1980-01-01", email: `${nome.split(" ")[0].toLowerCase()}@x.com`, telefone: "5585999990000",
  mesclado_em_id: null, endereco_rua: "Rua A", endereco_numero: "1", endereco_complemento: "", endereco_bairro: "Centro",
  endereco_cidade: "Fortaleza", endereco_estado: "CE", endereco_cep: "60000000", ...o,
});
const FICHAS = [
  ficha(CLI.carlos, "Carlos Silva", { cpf: "11144477735" }),
  ficha(CLI.ana, "Ana Silva", { nascimento: "1982-02-02" }),
  // Menores sem e-mail/telefone próprios (quem recebe é o responsável).
  ficha(CLI.maria, "Maria Silva", { nascimento: "2014-01-01", email: null, telefone: null, cpf: null }),
  ficha(CLI.pedro, "Pedro Silva", { nascimento: "2016-01-01", email: null, telefone: null, cpf: null }),
  ficha(CLI.joao, "João Lima", { nascimento: "1990-03-03", email: null }),
];
const fichasMap = () => new Map(FICHAS.map((f) => [f.id, f]));
const pessoa = (vp: string, cli: string, o: Record<string, unknown> = {}) => ({
  id: vp, cliente_id: cli, comprador: false, vinculo: "filho", menor: false, responsavel_cliente_id: null, valor: null,
  aereo_incluso: null, removida_em: null, bitrix_deal_id: null, ...o,
});
const PESSOAS = [
  pessoa(VP.carlos, CLI.carlos, { comprador: true, vinculo: null }),
  pessoa(VP.ana, CLI.ana, { vinculo: "conjuge", valor: 10000 }),
  pessoa(VP.maria, CLI.maria, { menor: true, valor: 8000 }),                                   // responsável = comprador (padrão)
  pessoa(VP.pedro, CLI.pedro, { menor: true, valor: 7000, responsavel_cliente_id: CLI.carlos }),
  pessoa(VP.joao, CLI.joao, { vinculo: "amigo", valor: 5000 }),
];

// ═════════════════════════════════════════════════════════════════════════════
// Regras puras
// ═════════════════════════════════════════════════════════════════════════════
test("quem assina: adulto = o próprio; menor = o responsável (padrão: o comprador); sem responsável = falta", () => {
  const fichas = fichasMap();
  const comprador = PESSOAS[0];
  assert.deepEqual(F.quemAssina(PESSOAS[1], { fichas, comprador, hoje: HOJE }).clienteId, CLI.ana);
  const maria = F.quemAssina(PESSOAS[2], { fichas, comprador, hoje: HOJE });
  assert.equal(maria.clienteId, CLI.carlos);
  assert.equal(maria.proprio, false);
  assert.equal(F.quemAssina(PESSOAS[3], { fichas, comprador, hoje: HOJE }).clienteId, CLI.carlos);
  // Comprador menor sem responsável → não tem quem assinar.
  const compMenor = pessoa(VP.carlos, CLI.maria, { comprador: true, menor: true });
  assert.equal(F.quemAssina(compMenor, { fichas, comprador: compMenor, hoje: HOJE }).falta, "responsavel");
  // 17 anos HOJE conta como menor mesmo com qs_venda_pessoas.menor = false (18 na viagem).
  const quase = new Map(fichas); quase.set(CLI.joao, { ...fichas.get(CLI.joao)!, nascimento: "2008-12-01" });
  assert.equal(F.quemAssina(PESSOAS[4], { fichas: quase, comprador, hoje: HOJE }).clienteId, CLI.carlos);
});

test("valor da pessoa: comprador = total − filhos (igual ao card PAI do Bitrix); sem filho com valor = total; filho sem valor = null", () => {
  assert.equal(F.valorDaPessoa(PESSOAS[0], { pessoas: PESSOAS, valorTotal: 40000 }), 10000);
  assert.equal(F.valorDaPessoa(PESSOAS[2], { pessoas: PESSOAS, valorTotal: 40000 }), 8000);
  const so = [PESSOAS[0], pessoa(VP.ana, CLI.ana, { valor: null })];
  assert.equal(F.valorDaPessoa(so[0], { pessoas: so, valorTotal: 30000 }), 30000);
  assert.equal(F.valorDaPessoa(so[1], { pessoas: so, valorTotal: 30000 }), null);
});

test("bloqueios: responsável sem e-mail/telefone, adulto sem e-mail, sem valor, sem nascimento — cada um só na sua pessoa", () => {
  const fichas = fichasMap();
  fichas.set(CLI.carlos, { ...fichas.get(CLI.carlos)!, email: null, telefone: "85 9" });
  const linhas = F.planoDaFamilia({ pessoas: PESSOAS, fichas, contratos: [], valorTotal: 40000, hoje: HOJE });
  const de = (vp: string) => linhas.find((l) => l.venda_pessoa_id === vp)!;
  assert.match(de(VP.maria).bloqueios.join(" "), /responsável \(Carlos\) está sem e-mail/);
  assert.match(de(VP.maria).bloqueios.join(" "), /responsável \(Carlos\) está sem telefone/);
  assert.match(de(VP.joao).bloqueios.join(" "), /João está sem e-mail/);
  assert.deepEqual(de(VP.ana).bloqueios, []);
  const semNasc = new Map(fichasMap()); semNasc.set(CLI.ana, { ...semNasc.get(CLI.ana)!, nascimento: null });
  const semValor = PESSOAS.map((p) => (p.id === VP.ana ? { ...p, valor: null } : p));
  const l2 = F.planoDaFamilia({ pessoas: semValor, fichas: semNasc, contratos: [], valorTotal: 40000, hoje: HOJE }).find((l) => l.venda_pessoa_id === VP.ana)!;
  assert.match(l2.bloqueios.join(" "), /Sem data de nascimento de Ana/);
  assert.match(l2.bloqueios.join(" "), /Sem valor de Ana/);
  // Menor sem responsável e comprador também menor: bloqueia com mensagem clara.
  const compMenor = [pessoa(VP.carlos, CLI.maria, { comprador: true, menor: true, vinculo: null })];
  assert.match(F.planoDaFamilia({ pessoas: compMenor, fichas: fichasMap(), contratos: [], valorTotal: 1000, hoje: HOJE })[0].bloqueios.join(" "), /menor de idade e não tem responsável/);
});

test("plano: dois menores com o MESMO responsável = duas linhas, cada uma assinada por ele; contrato antigo do cartão conta como do comprador", () => {
  const contratos = [
    { id: "k-ana", venda_pessoa_id: VP.ana, status: "enviado", criado_em: "2026-11-09T10:00:00Z" },
    { id: "k-velho", venda_pessoa_id: null, status: "assinado", criado_em: "2026-11-01T10:00:00Z" },
    { id: "k-maria-erro", venda_pessoa_id: VP.maria, status: "erro", erro: "ZapSign caiu", criado_em: "2026-11-09T11:00:00Z" },
  ];
  const linhas = F.planoDaFamilia({ pessoas: PESSOAS, fichas: fichasMap(), contratos, valorTotal: 40000, hoje: HOJE });
  assert.equal(linhas[0].comprador, true, "comprador primeiro");
  const de = (vp: string) => linhas.find((l) => l.venda_pessoa_id === vp)!;
  assert.equal(de(VP.maria).assina.cliente_id, CLI.carlos);
  assert.equal(de(VP.pedro).assina.cliente_id, CLI.carlos);
  assert.equal(de(VP.maria).assina.proprio, false);
  assert.equal(de(VP.carlos).ativo?.id, "k-velho");
  assert.equal(de(VP.ana).ativo?.id, "k-ana");
  assert.equal(de(VP.maria).ativo, null);
  assert.equal(de(VP.maria).atual?.status, "erro");
  assert.equal(de(VP.carlos).valor, 10000);
  // O que vai pra tela não leva as fichas inteiras.
  assert.ok(!("_ficha" in F.linhaParaTela(de(VP.ana))));
});

test("resumo do cartão (mesma regra da 0352): todos assinados → assinado; algum pendente → enviado; recusado; nada saiu → null", () => {
  assert.deepEqual(
    { s: F.resumoDosContratos(["assinado", "assinado", "assinado", "assinado"]).statusCartao, t: F.resumoDosContratos(["assinado", "assinado", "assinado", "assinado"]).texto },
    { s: "assinado", t: "contratos 4/4 assinados" });
  const r = F.resumoDosContratos(["assinado", "enviado", "visualizado", "assinado"]);
  assert.equal(r.statusCartao, "enviado");
  assert.equal(r.texto, "contratos 2/4 assinados");
  assert.equal(F.resumoDosContratos(["visualizado", "assinado"]).statusCartao, "visualizado");
  assert.equal(F.resumoDosContratos(["recusado", "assinado"]).statusCartao, "recusado");
  assert.equal(F.resumoDosContratos(["cancelado", null]).statusCartao, "cancelado");
  assert.equal(F.resumoDosContratos([null, null]).statusCartao, null);
  assert.equal(F.resumoDosContratos([]).texto, "");
  // statusDasLinhas ignora gerando/erro (não saiu pro cliente).
  assert.deepEqual(F.statusDasLinhas([{ atual: { status: "gerando" } }, { atual: { status: "erro" } }, { atual: null }, { atual: { status: "enviado" } }]), [null, null, null, "enviado"]);
});

test("idempotência por pessoa: sem contrato envia; ativo pula; assinado nunca é substituído", () => {
  assert.equal(F.decidirEnvio(null), "enviar");
  assert.equal(F.decidirEnvio({ status: "enviado" }), "pular-ativo");
  assert.equal(F.decidirEnvio({ status: "visualizado" }, { substituir: true }), "substituir");
  assert.equal(F.decidirEnvio({ status: "assinado" }, { substituir: true }), "pular-assinado");
  assert.equal(F.decidirEnvio({ status: "gerando" }), "pular-gerando");
});

test("montarPreviaDaPessoa: menor da VIAGEM (qs_venda_pessoas.menor) força o responsável mesmo com 18 anos hoje", () => {
  const base = camposDasFontes({ negocio: {}, lead: {}, cliente: null, venda: null, hoje: HOJE });
  const r = montarPreviaDaPessoa(base, { nome: "Bia", nascimento: "2008-11-01", valor: 100 }, { responsavel: FICHAS[0], menor: true });
  assert.equal(r.menor, true);
  assert.equal(r.campos.nome, "Carlos Silva");
  assert.match(r.campos.viajante, /^Bia, nascido\(a\) em 01\/11\/2008/);
});

// ═════════════════════════════════════════════════════════════════════════════
// A ação inteira (api/closer.js) com fetch de mentira
// ═════════════════════════════════════════════════════════════════════════════
type Contrato = Record<string, unknown> & { id: string; status: string; criado_em: string; venda_pessoa_id: string | null };
const db = { contratos: [] as Contrato[], seq: 0, zapFalhaPara: new Set<string>() };
const zapDocs: { name: string; signers: { name: string; email: string }[] }[] = [];
const inserts: Record<string, unknown>[] = [];

const resposta = (obj: unknown, status = 200) => ({
  ok: status < 400, status, json: async () => obj, text: async () => (obj == null ? "" : JSON.stringify(obj)),
});
const param = (url: string, re: RegExp) => (url.match(re) || [])[1] || null;

(globalThis as { fetch: unknown }).fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
  const method = init.method || "GET";
  let body: any = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
  const R = (x: unknown, s = 200) => resposta(x, s);
  if (url.endsWith("/auth/v1/user")) return R({ id: U });
  if (url.includes("/storage/v1/object/contratos/")) return R({ Key: "ok" });
  if (url.startsWith("https://api.zapsign.com.br/api/v1/docs/") && method === "POST") {
    zapDocs.push(body);
    if ([...db.zapFalhaPara].some((n) => body.name.includes(n))) return R({ detail: "erro interno" }, 500);
    const tk = `aaaaaaaa-0000-4000-8000-${String(zapDocs.length).padStart(12, "0")}`;
    return R({ token: tk, open_id: zapDocs.length, signers: body.signers.map((s: any, i: number) => ({ email: s.email, sign_url: `https://zap/${tk}/${i}` })) }, 201);
  }
  const p = url.replace("https://sb.exemplo/rest/v1/", "");
  if (p.startsWith("qs_users?select=id,name,role")) return R([{ id: U, name: "Closer Teste", role: "closer", setores: [], is_active: true }]);
  if (p.startsWith("qs_users?select=name")) return R([{ name: "Closer Teste" }]);
  if (p.startsWith("qs_closer_negocios?select=")) return R([{ id: NEG, lead_id: LEAD, closer_id: U, etapa: "em_negociacao", ficha: null, valor_previsto: null, viagem_id: null, status_contrato: null }]);
  if (p.startsWith("qs_contrato_config")) return R([]);
  if (p.startsWith("qs_vendas?select=id,valor_total,cliente_id")) return R([{ id: VENDA, valor_total: 40000, cliente_id: CLI.carlos }]);
  if (p.startsWith("qs_vendas?select=")) return R([{ id: VENDA, cliente_id: CLI.carlos, valor_total: 40000, pagamento: { forma: "pix", condicao: "avista" }, condicao_especial: false, condicao_obs: null, observacoes: null }]);
  if (p.startsWith("qs_venda_itens?")) return R([{ id: "i1", tipo: "pacote", nome: "Pacote Itália", data_inicio: "2027-05-01", data_fim: "2027-05-15", dados: { destino: "Itália" }, passageiros: [], valor: 40000, status: "ativo", ordem: 0 }]);
  if (p.startsWith("qs_venda_pessoas?select=")) return R(PESSOAS);
  if (p.startsWith("passageiros?")) return R([]);
  if (p.startsWith("qs_leads?select=")) return R([{ id: LEAD, full_name: "Carlos Silva", email: "carlos@x.com", phone: "5585999990000", bitrix_id: null, cliente_id: CLI.carlos }]);
  if (p.startsWith("rel_clientes?select=")) {
    const ids = param(p, /id=in\.\(([^)]*)\)/)?.split(",") ?? [param(p, /[?&]id=eq\.([0-9a-f-]+)/)];
    return R(FICHAS.filter((f) => ids.includes(f.id)));
  }
  if (p.startsWith("qs_contratos?select=campos")) return R([]);
  if (p.startsWith("qs_contratos?select=id,status,modo,zapsign_token")) {
    const vp = param(p, /venda_pessoa_id[=.]eq\.([0-9a-f-]+)/);
    const comNulo = p.includes("venda_pessoa_id.is.null");
    const vivos = db.contratos.filter((k) => ["enviado", "visualizado", "assinado"].includes(k.status)
      && (k.venda_pessoa_id === vp || (comNulo && k.venda_pessoa_id === null)));
    return R(vivos.sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 1));
  }
  if (p.startsWith("qs_contratos?select=id,link_assinatura")) return R(db.contratos.filter((k) => k.id === param(p, /id=eq\.([0-9a-f-]+)/)));
  if (p.startsWith("qs_contratos?select=")) return R([...db.contratos].sort((a, b) => b.criado_em.localeCompare(a.criado_em)));
  if (p.startsWith("qs_contratos?negocio_id=eq.") && method === "PATCH") return R(null);
  if (p === "qs_contratos" && method === "POST") {
    inserts.push(body);
    const k = { ...body, id: id(900 + ++db.seq), criado_em: new Date(Date.UTC(2026, 10, 9, 12, 0, db.seq)).toISOString(), venda_pessoa_id: body.venda_pessoa_id ?? null };
    db.contratos.push(k);
    return R([k], 201);
  }
  if (p.startsWith("qs_contratos?id=eq.") && method === "PATCH") {
    const k = db.contratos.find((x) => x.id === param(p, /id=eq\.([0-9a-f-]+)/));
    Object.assign(k!, body);
    return R(null);
  }
  if (p === "rpc/contrato_registrar_status") {
    const k = db.contratos.find((x) => x.id === body.p_contrato)!;
    k.status = body.p_status;
    return R(body.p_status);
  }
  throw new Error(`url inesperada ${method} ${url}`);
};

const { default: handler } = await import("../../api/closer.js");
function chamar(corpo: Record<string, unknown>) {
  const req = { method: "POST", url: "/api/closer", query: {}, headers: { authorization: "Bearer jwt" }, body: corpo };
  const out: { status: number; json: any } = { status: 0, json: null };
  const res = { status(s: number) { out.status = s; return this; }, json(j: unknown) { out.json = j; return out; }, setHeader() {} };
  return Promise.resolve(handler(req as never, res as never)).then(() => out);
}

test("contrato-enviar com a família: um contrato por pessoa, comprador sempre, menor assinado pelo responsável, erro isolado, idempotente", async () => {
  // A Ana já tem contrato aguardando; o ZapSign vai falhar no do Pedro.
  db.contratos.push({ id: "k-ana-0", venda_pessoa_id: VP.ana, status: "enviado", criado_em: "2026-11-08T10:00:00Z" });
  db.zapFalhaPara.add("Pedro");

  const r1 = await chamar({ acao: "contrato-enviar", negocioId: NEG, vendaPessoaIds: [VP.ana, VP.maria, VP.pedro, VP.joao] });
  assert.equal(r1.status, 200);
  const res = Object.fromEntries((r1.json.resultados as any[]).map((x) => [x.vendaPessoaId, x]));
  assert.equal(res[VP.carlos].resultado, "enviado", "o comprador vai sempre, mesmo fora da lista");
  assert.equal(res[VP.ana].resultado, "pulado");
  assert.equal(res[VP.maria].resultado, "enviado");
  assert.equal(res[VP.pedro].resultado, "erro");
  assert.match(res[VP.pedro].motivo, /ZapSign/);
  assert.equal(res[VP.joao].resultado, "bloqueado");
  assert.match(res[VP.joao].motivo, /sem e-mail/);
  assert.equal(r1.json.ok, false);

  // Um documento por pessoa no ZapSign (Carlos, Maria, Pedro — o do Pedro falhou).
  assert.equal(zapDocs.length, 3);
  const docMaria = zapDocs.find((d) => d.name.includes("Maria"))!;
  assert.equal(docMaria.signers[0].email, "carlos@x.com", "menor: quem assina é o responsável");
  assert.equal(docMaria.signers[0].name, "Carlos Silva");
  // O que foi gravado: pessoa, quem assina, valor DELA e o menor como viajante.
  const insMaria = inserts.find((i) => i.venda_pessoa_id === VP.maria) as any;
  assert.equal(insMaria.cliente_id, CLI.maria);
  assert.equal(insMaria.assinante_cliente_id, CLI.carlos);
  assert.equal(insMaria.campos.valor_total, "8.000,00");
  assert.match(insMaria.campos.viajante, /^Maria Silva, nascido\(a\) em 01\/01\/2014.*menor de idade/);
  const insCarlos = inserts.find((i) => i.venda_pessoa_id === VP.carlos) as any;
  assert.equal(insCarlos.campos.valor_total, "10.000,00", "comprador = total − filhos");
  assert.equal(insCarlos.campos.viajante, "");
  assert.equal(db.contratos.find((k) => k.venda_pessoa_id === VP.pedro)!.status, "erro");

  // 2ª rodada (ZapSign voltou): só o Pedro sai; ninguém recebe contrato duplicado.
  db.zapFalhaPara.clear();
  const antes = zapDocs.length;
  const r2 = await chamar({ acao: "contrato-enviar", negocioId: NEG, vendaPessoaIds: [VP.ana, VP.maria, VP.pedro] });
  const res2 = Object.fromEntries((r2.json.resultados as any[]).map((x) => [x.vendaPessoaId, x.resultado]));
  assert.deepEqual(res2, { [VP.carlos]: "pulado", [VP.ana]: "pulado", [VP.maria]: "pulado", [VP.pedro]: "enviado" });
  assert.equal(zapDocs.length, antes + 1);
  assert.equal(zapDocs.at(-1)!.signers[0].email, "carlos@x.com", "dois menores, mesmo responsável: dois contratos assinados por ele");
  assert.equal(r2.json.ok, true);

  // A tela: contrato-familia lista as 5, com o resumo.
  const fam = await chamar({ acao: "contrato-familia", negocioId: NEG });
  assert.equal(fam.json.familia, true);
  assert.equal(fam.json.pessoas.length, 5);
  assert.equal(fam.json.resumo.texto, "contratos 0/4 assinados");
  assert.ok(!("_ficha" in fam.json.pessoas[0]));

  // Contrato de UMA pessoa bloqueada: 400 com a mensagem clara, sem tocar no ZapSign.
  const n0 = zapDocs.length;
  const r3 = await chamar({ acao: "contrato-enviar", negocioId: NEG, vendaPessoaId: VP.joao, campos: {} });
  assert.equal(r3.status, 400);
  assert.match(r3.json.error, /João está sem e-mail/);
  assert.equal(zapDocs.length, n0);

  // Prévia da Maria: dados do responsável, valor dela.
  const pv = await chamar({ acao: "contrato-previa", negocioId: NEG, vendaPessoaId: VP.maria });
  assert.equal(pv.json.campos.nome, "Carlos Silva");
  assert.equal(pv.json.campos.valor_total, "8.000,00");
  assert.equal(pv.json.pessoa.assina.cliente_id, CLI.carlos);
});
