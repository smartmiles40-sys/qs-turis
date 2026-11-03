// "Montar com IA" (0290, 03/11/2026), tudo SEM rede:
//   · esquema JSON estrito por modelo (api/_propostaIa.js), montado a partir dos
//     campos marcados com `ia` em src/propostas/modelos.ts;
//   · validação do que a IA devolve (preço/data/hora inválidos são descartados);
//   · mescla no rascunho sem passar por cima do que o closer editou;
//   · a rota api/proposta-ia.js com fetch FALSO da OpenAI e sem chave (503).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/propostas/ia.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { esquemaProposta, validarExtracao, dataValida, valorValido, horaValida } from "../../api/_propostaIa.js";
import {
  camposParaIa, mesclarExtracao, pendencias, marcasDe, veioDaIa, tabelaDeVoos, comparativoDeSeguros, marcarConferido,
  type ExtracaoIa,
} from "../../src/propostas/iaMescla.ts";
import { conteudoInicial, hotelVazio, type ModeloProposta } from "../../src/propostas/modelos.ts";
import type { Proposta } from "../../src/propostas/lib.ts";

// ── esquema ─────────────────────────────────────────────────────────────────
/** strict da OpenAI: todo objeto fecha (additionalProperties false) e lista TODAS as chaves em required. */
function conferirStrict(s: Record<string, unknown>, onde = "raiz") {
  if (s.type === "object" || (Array.isArray(s.type) && s.type.includes("object"))) {
    assert.equal(s.additionalProperties, false, `${onde}: additionalProperties`);
    const props = Object.keys(s.properties as object);
    assert.deepEqual([...(s.required as string[])].sort(), props.sort(), `${onde}: required`);
    for (const k of props) conferirStrict((s.properties as Record<string, Record<string, unknown>>)[k], `${onde}.${k}`);
  }
  if (s.type === "array") conferirStrict(s.items as Record<string, unknown>, `${onde}[]`);
}

test("esquema por modelo: estrito e só com as listas que o modelo usa", () => {
  for (const m of ["pacote", "servicos", "seguro"] as ModeloProposta[]) {
    const campos = camposParaIa(m);
    assert.ok(campos.length > 0, `${m} tem campos marcados com ia`);
    const e = esquemaProposta(m, campos) as Record<string, unknown> & { properties: Record<string, { properties?: object }> };
    conferirStrict(e);
    assert.deepEqual(Object.keys(e.properties.campos.properties!).sort(), campos.map((c) => c.chave).sort());
    for (const k of ["viagem", "campos", "pagamento", "validade", "conferir"]) assert.ok(k in e.properties, `${m}.${k}`);
  }
  const p = esquemaProposta("pacote", camposParaIa("pacote")).properties;
  assert.ok(p.voos && p.hoteis && p.precos && !p.seguros && !p.servicos);
  const s = esquemaProposta("seguro", camposParaIa("seguro")).properties;
  assert.ok(s.seguros && !s.voos && !s.precos);
  const sv = esquemaProposta("servicos", camposParaIa("servicos")).properties;
  assert.ok(sv.servicos && sv.voos && !sv.precos);
  // chave torta ou repetida que a tela mandasse não entra no esquema
  const torto = esquemaProposta("pacote", [{ chave: "Selo; drop", rotulo: "x" }, { chave: "selo", rotulo: "a" }, { chave: "selo", rotulo: "b" }]).properties.campos;
  assert.deepEqual(Object.keys(torto.properties!), ["selo"]);
});

// ── validação ───────────────────────────────────────────────────────────────
test("validadores: data que não existe, hora e preço", () => {
  assert.equal(dataValida("2027-08-17"), "2027-08-17");
  assert.equal(dataValida("2027-02-30"), "");
  assert.equal(dataValida("17/08/2027"), "");
  assert.equal(dataValida("1999-01-01"), "");
  assert.equal(horaValida("16:50"), "16:50");
  assert.equal(horaValida("25:10"), "");
  assert.equal(valorValido(1599.48), 1599.48);
  assert.equal(valorValido("R$ 1.599,48"), 1599.48);
  assert.equal(valorValido(0), null);
  assert.equal(valorValido(-10), null);
  assert.equal(valorValido(9e9), null);
  assert.equal(valorValido("sob consulta"), null);
});

test("validarExtracao descarta preço/data inválidos e avisa no conferir", () => {
  const { extracao, conferir, descartados } = validarExtracao({
    viagem: { destino: "Cancún", data_ida: "2027-08-17", data_volta: "2027-08-10", adultos: 2, criancas: -1 },
    campos: { selo: "ALL INCLUSIVE", nao_existe: "x" },
    voos: [{ sentido: "ida", numero: "g3 2055", origem: "for", destino: "Rio de Janeiro", data: "2027-08-17", saida: "16:50", chegada: "29:00" }],
    hoteis: [{ nome: "Hilton Cancun", checkin: "2027-08-18", checkout: "2027-08-18", comodidades: ["Spa"] }],
    precos: [{ rotulo: "Duplo", valor_pessoa: "abc" }, { rotulo: "Single", valor_pessoa: 21000 }, { rotulo: "Single", valor_pessoa: 20500 }],
    conferir: [{ campo: "preço do single", motivo: "dois valores" }],
  }, { modelo: "pacote", campos: camposParaIa("pacote") });
  assert.equal(extracao.viagem.data_volta, "", "volta antes da ida é descartada");
  assert.equal(extracao.viagem.criancas, null);
  assert.deepEqual(Object.keys(extracao.campos), ["selo"]);
  assert.equal(extracao.voos[0].numero, "G3 2055");
  assert.equal(extracao.voos[0].origem, "FOR");
  assert.equal(extracao.voos[0].destino, "", "cidade não é código IATA");
  assert.equal(extracao.voos[0].chegada, "");
  assert.equal(extracao.hoteis[0].checkout, "", "check-out no dia do check-in");
  assert.equal(extracao.precos.length, 2, "o preço 'abc' foi descartado");
  assert.ok(descartados.some((d: { motivo: string }) => d.motivo === "preço inválido"));
  assert.ok(conferir.some((c: { campo: string }) => c.campo === "preço do single"), "o conferir da IA vem junto");
  assert.ok(conferir.some((c: { motivo: string }) => /dois valores diferentes/.test(c.motivo)), "dois preços pro mesmo cartão");
  assert.ok(conferir.some((c: { campo: string }) => c.campo === "datas da viagem"));
});

// ── mescla ──────────────────────────────────────────────────────────────────
const HOJE = "2026-11-03";
function proposta(modelo: ModeloProposta): Proposta {
  const conteudo = conteudoInicial(modelo, { pax: 2, cliente: "", hoje: HOJE });
  const item = (tipo: string, nome: string) => ({ k: `k${tipo}`, tipo, nome, descricao: "", data_inicio: "", data_fim: "", quantidade: 1, valor_total: 0, custo: null, lucro: null, fornecedor: "", incluso: false, detalhes: {} });
  const op = { k: "o0", titulo: "", descricao: "", recomendada: false, desconto: 0, pagamentos: [], itens: [] as unknown[], extra: {} as Record<string, unknown> };
  if (modelo === "pacote") Object.assign(op, { itens: [item("pacote", "Pacote")], extra: { rotulo: "Quarto duplo · por pessoa", total_rotulo: "Total por pessoa" }, pagamentos: [{ forma: "cartao", condicao: "parcelado", parcelas: 10, entrada: 0, com_juros: false, obs: "" }] });
  if (modelo === "seguro") Object.assign(op, { itens: [item("seguro", "Seguro viagem")], extra: { grupo: 0 } });
  if (modelo === "servicos") op.titulo = "Serviços";
  return {
    setor: "operacional", status: "rascunho", titulo: "", destino: "", data_ida: "", data_volta: "", adultos: 2, criancas: 0, bebes: 0,
    apresentacao: "", observacoes: "", esconder_precos: false, capa_url: "", solicitacao_id: null, cliente_id: null, viagem_id: null, lead_id: null,
    cliente_nome: "", modelo, conteudo, opcoes: [op],
  } as unknown as Proposta;
}
const vazia = (): ExtracaoIa => ({
  viagem: { titulo: "", cliente_nome: "", destino: "", data_ida: "", data_volta: "", adultos: null, criancas: null, bebes: null },
  campos: {}, voos: [], hoteis: [], roteiro: [], precos: [], servicos: [], seguros: [], pagamento: "", validade: "",
});
const voo = (o: Partial<ExtracaoIa["voos"][number]>) => ({ sentido: "ida" as const, cia: "GOL", numero: "", origem: "", origem_cidade: "", destino: "", destino_cidade: "", data: "", saida: "", chegada: "", chegada_data: "", duracao: "", classe: "", bagagem: "", ...o });
const hotel = (o: Partial<ExtracaoIa["hoteis"][number]>) => ({ nome: "", cidade: "", endereco: "", checkin: "", checkout: "", checkin_hora: "", checkout_hora: "", regime: "", quarto: "", comodidades: [], ...o });

test("pacote: a IA preenche viagem, voos, hotel e preço do rascunho", () => {
  const ex = vazia();
  ex.viagem = { ...ex.viagem, destino: "Cancún", cliente_nome: "Família Lima", adultos: 3 };
  ex.campos = { selo: "ALL INCLUSIVE" };
  ex.voos = [
    voo({ numero: "G3 2055", origem: "FOR", origem_cidade: "Fortaleza", destino: "GIG", destino_cidade: "Rio de Janeiro", data: "2027-08-17", saida: "16:50", chegada: "20:10", duracao: "3h20" }),
    voo({ numero: "G3 6610", origem: "GIG", origem_cidade: "Rio de Janeiro", destino: "CUN", destino_cidade: "Cancún", data: "2027-08-18", saida: "01:35", chegada: "06:00", bagagem: "mão 10 kg" }),
    voo({ sentido: "volta", numero: "G3 6632", origem: "CUN", origem_cidade: "Cancún", destino: "FOR", destino_cidade: "Fortaleza", data: "2027-08-22", saida: "16:50", chegada: "10:40", chegada_data: "2027-08-23" }),
  ];
  ex.hoteis = [hotel({ nome: "Hilton Cancun", checkin: "2027-08-18", checkout: "2027-08-22", checkin_hora: "15:00", regime: "All inclusive", quarto: "Resort View", comodidades: ["Spa", "Praia"] })];
  ex.precos = [{ rotulo: "Quarto duplo · por pessoa", titulo: "2 viajantes", valor_pessoa: 15994.8, valor_total: null, parcelas: 10, desconto: null },
    { rotulo: "Single", titulo: "1 viajante", valor_pessoa: 21000, valor_total: null, parcelas: null, desconto: null }];
  const r = mesclarExtracao(proposta("pacote"), ex, [{ campo: "bagagem", motivo: "não diz se tem mala" }], { hoje: HOJE });
  const p = r.proposta;
  assert.equal(p.destino, "Cancún");
  assert.equal(p.adultos, 3, "2 era o padrão: a IA pode trocar");
  assert.equal(p.data_ida, "2027-08-17", "ida sai do 1º voo");
  assert.equal(p.data_volta, "2027-08-23", "volta = chegada do último voo de volta");
  assert.equal(p.conteudo.selo, "ALL INCLUSIVE");
  assert.match(String(p.conteudo.voos), /^# Ida · terça, 17\/08\/2027 · 1 escala/);
  assert.match(String(p.conteudo.voos), /Rio de Janeiro → Cancún \| G3 6610 \| 01:35 \(18\/08\)/);
  assert.match(String(p.conteudo.voos), /> Bagagem: mão 10 kg/);
  assert.match(String(p.conteudo.rota), /^FOR \| Fortaleza \| G3 2055 · 16:50\nGIG/);
  const h = (p.conteudo.hoteis as { nome: string; selo: string; checkin: string }[]);
  assert.equal(h.length, 1, "o hotel vazio do modelo foi reaproveitado");
  assert.equal(h[0].nome, "Hilton Cancun");
  assert.equal(h[0].selo, "4 NOITES · ALL INCLUSIVE");
  assert.match(h[0].checkin, /^Qua 18\/08 a partir das 15h/);
  assert.equal(p.opcoes.length, 2, "o 1º cartão casou pelo rótulo, o single virou cartão novo");
  assert.equal(p.opcoes[0].itens[0].valor_total, 15994.8);
  assert.equal(p.opcoes[0].titulo, "2 viajantes");
  assert.equal(p.opcoes[1].itens[0].valor_total, 21000);
  assert.ok(r.conferir.some((c) => c.campo === "bagagem"));
  assert.ok(r.secoes.includes("voos") && r.secoes.includes("precos"));
  assert.ok(veioDaIa(p, "viagem.destino", p.destino));
  assert.equal(marcasDe(p)!.rodadas, 1);
});

test("rodar de novo: não sobrescreve o que o closer editou, mas troca o que ainda é da IA", () => {
  const ex = vazia();
  ex.viagem = { ...ex.viagem, destino: "Cancún" };
  ex.hoteis = [hotel({ nome: "Hilton Cancun", quarto: "Resort View" })];
  ex.precos = [{ rotulo: "Quarto duplo · por pessoa", titulo: "", valor_pessoa: 15000, valor_total: null, parcelas: null, desconto: null }];
  const r1 = mesclarExtracao(proposta("pacote"), ex, [], { hoje: HOJE });
  // o closer mexe: troca o destino e o preço à mão
  const editada = structuredClone(r1.proposta);
  editada.destino = "Cancún e Tulum";
  editada.opcoes[0].itens[0].valor_total = 14500;
  // novo print: outro preço e outro destino escrito
  const ex2 = structuredClone(ex);
  ex2.viagem.destino = "Riviera Maya";
  ex2.viagem.cliente_nome = "Ana";
  ex2.precos[0].valor_pessoa = 15200;
  ex2.hoteis[0].quarto = "Ocean View";
  const r2 = mesclarExtracao(editada, ex2, [], { hoje: HOJE });
  assert.equal(r2.proposta.destino, "Cancún e Tulum", "edição manual fica");
  assert.equal(r2.proposta.opcoes[0].itens[0].valor_total, 14500, "preço editado à mão fica");
  assert.equal(r2.proposta.cliente_nome, "Ana", "campo vazio é preenchido");
  assert.match((r2.proposta.conteudo.hoteis as { descricao: string }[])[0].descricao, /Ocean View/, "o que ainda era da IA é atualizado");
  assert.ok(r2.conferir.some((c) => c.campo === "Destino" && /Riviera Maya/.test(c.motivo)), "a leitura diferente vira conferir");
  assert.ok(r2.conferir.some((c) => /Preço/.test(c.campo)));
  assert.equal(marcasDe(r2.proposta)!.rodadas, 2);
  assert.equal(veioDaIa(r2.proposta, "viagem.destino", r2.proposta.destino), false, "destino não é mais da IA");
});

test("o que a IA criou e o closer tirou não volta na rodada seguinte", () => {
  const ex = vazia();
  ex.hoteis = [hotel({ nome: "Hotel A" }), hotel({ nome: "Hotel B" })];
  const r1 = mesclarExtracao(proposta("pacote"), ex, [], { hoje: HOJE });
  const sem = structuredClone(r1.proposta);
  sem.conteudo.hoteis = (sem.conteudo.hoteis as { nome: string }[]).filter((h) => h.nome !== "Hotel B") as never;
  const r2 = mesclarExtracao(sem, ex, [], { hoje: HOJE });
  assert.deepEqual((r2.proposta.conteudo.hoteis as { nome: string }[]).map((h) => h.nome), ["Hotel A"]);
});

test("serviços: cada serviço vira item com valor por pessoa; incluso sem preço", () => {
  const ex = vazia();
  ex.servicos = [
    { nome: "Excursão a Segóvia", local: "Madri", data: "2026-10-31", descricao: "Dia inteiro", valor_pessoa: 577.82, incluso: false },
    { nome: "City tour", local: "Madri", data: "2026-10-30", descricao: "", valor_pessoa: null, incluso: true },
  ];
  ex.voos = [voo({ cia: "Iberia", numero: "IB150", origem_cidade: "Fortaleza", destino_cidade: "Madri", data: "2026-10-29", saida: "18:25", chegada: "06:10", chegada_data: "2026-10-30" })];
  ex.pagamento = "PIX";
  const p = mesclarExtracao(proposta("servicos"), ex, [], { hoje: HOJE }).proposta;
  const itens = p.opcoes[0].itens;
  assert.equal(itens.length, 2);
  assert.equal(itens[0].valor_total, 577.82);
  assert.equal(itens[0].detalhes.local, "Madri");
  assert.equal(itens[1].incluso, true);
  assert.equal(p.conteudo.pagamento, "PIX");
  assert.equal(p.conteudo.ida, "Iberia IB150 | Fortaleza 18:25 → Madri 06:10 | Qui 29/10 · chegada sex 30/10");
  assert.deepEqual(pendencias(p).filter((x) => x.secao === "servicos"), []);
});

test("seguro: planos por seguradora, total calculado avisa, comparativo nas colunas certas", () => {
  const ex = vazia();
  ex.seguros = [
    { seguradora: "Hero", plano: "HERO 80", cobertura_medica: "US$ 80.000", inicio: "2026-10-30", fim: "2026-11-12", valor_pessoa: 300, valor_total: null, coberturas: [{ nome: "Bagagem", valor: "US$ 1.200" }] },
    { seguradora: "Universal", plano: "Ouro", cobertura_medica: "US$ 100.000", inicio: "", fim: "", valor_pessoa: 410, valor_total: 820, coberturas: [] },
  ];
  const r = mesclarExtracao(proposta("seguro"), ex, [], { hoje: HOJE });
  const p = r.proposta;
  assert.equal(p.data_ida, "2026-10-30", "vigência vira a data da viagem");
  assert.deepEqual(p.opcoes.map((o) => o.titulo), ["HERO 80", "Ouro"]);
  assert.deepEqual(p.opcoes.map((o) => o.extra?.grupo), [0, 1]);
  assert.equal(p.opcoes[0].itens[0].valor_total, 600, "300 × 2 passageiros");
  assert.ok(r.conferir.some((c) => /calculado/.test(c.motivo)));
  assert.deepEqual((p.conteudo.seguradoras as { nome: string }[]).map((s) => s.nome), ["Hero", "Universal"]);
  assert.equal(p.conteudo.comparativo, "Assistência médica | US$ 80.000 | US$ 100.000\nBagagem | US$ 1.200 | —");
  assert.equal(comparativoDeSeguros([null, ex.seguros[1]]), "Assistência médica | — | US$ 100.000");
});

test("pendências: o que falta pra mandar ao cliente", () => {
  const p = proposta("pacote");
  const falta = pendencias(p).map((x) => x.texto);
  assert.ok(falta.includes("Destino (ou título)") && falta.includes("Preço do pacote") && falta.includes("Hotel") && falta.includes("Data da ida"));
  p.destino = "Cancún"; p.cliente_nome = "Ana"; p.data_ida = "2027-08-17"; p.data_volta = "2027-08-23";
  p.opcoes[0].itens[0].valor_total = 1000;
  (p.conteudo.hoteis as ReturnType<typeof hotelVazio>[])[0].nome = "Hilton";
  assert.deepEqual(pendencias(p), []);
});

test("tabela de voos sem nada = vazia; conferido sai da lista", () => {
  assert.equal(tabelaDeVoos([]), "");
  const ex = vazia(); ex.viagem.destino = "X";
  const p = mesclarExtracao(proposta("pacote"), ex, [{ campo: "a", motivo: "b" }, { campo: "c", motivo: "d" }], { hoje: HOJE }).proposta;
  const q = { ...p, ...marcarConferido(p, 0) };
  assert.deepEqual(marcasDe(q)!.conferir.map((c) => c.campo), ["c"]);
});

// ── a rota, com fetch falso ─────────────────────────────────────────────────
process.env.SUPABASE_URL = "https://sb.exemplo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
const PID = "11111111-2222-3333-4444-555555555555";
const UID = "99999999-8888-7777-6666-555555555555";
let chamadas: { url: string; body?: string }[] = [];
let respostaIa: unknown = null;
let insumosFalsos: unknown[] = [];
(globalThis as { fetch: unknown }).fetch = async (url: string, init?: { body?: string; method?: string }) => {
  chamadas.push({ url, body: init?.body });
  const r = (o: unknown, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o), arrayBuffer: async () => new TextEncoder().encode("PNGFALSO").buffer, headers: new Map() });
  if (url.endsWith("/auth/v1/user")) return r({ id: UID });
  if (url.includes("qs_users?")) return r([{ id: UID, role: "user", setores: ["operacional"], is_active: true }]);
  if (url.includes("qs_propostas?")) return r([{ id: PID, setor: "operacional", status: "rascunho", criado_por: UID, destino: "", adultos: 2 }]);
  if (url.includes("qs_proposta_insumos?") && init?.method === "PATCH") return r(null);
  if (url.includes("qs_proposta_insumos?")) return r(insumosFalsos);
  if (url.includes("/storage/v1/object/propostas-insumos/")) return r(null);
  if (url.includes("api.openai.com")) return r({ model: "gpt-4o-mini", usage: { prompt_tokens: 40000, completion_tokens: 900 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(respostaIa) } }] });
  return r([]);
};
const { default: rota, separarInsumos } = await import("../../api/proposta-ia.js");
async function chamar(body: unknown, auth = "Bearer jwt") {
  let status = 0, corpo: Record<string, unknown> = {};
  const res = { setHeader() {}, status(s: number) { status = s; return this; }, json(o: Record<string, unknown>) { corpo = o; return this; } };
  await rota({ method: "POST", headers: { authorization: auth }, body }, res);
  return { status, corpo };
}

test("rota: sem chave da OpenAI → 503 claro", async () => {
  delete process.env.OPENAI_API_KEY;
  const { status, corpo } = await chamar({ proposta_id: PID, modelo: "pacote", campos: camposParaIa("pacote") });
  assert.equal(status, 503);
  assert.match(String(corpo.error), /OPENAI_API_KEY/);
});

test("rota: sem login → 401; proposta sem id → 400", async () => {
  process.env.OPENAI_API_KEY = "sk-falsa";
  assert.equal((await chamar({ proposta_id: PID, modelo: "pacote" }, "")).status, 401);
  assert.equal((await chamar({ proposta_id: "nova", modelo: "pacote" })).status, 400);
  insumosFalsos = [];
  assert.equal((await chamar({ proposta_id: PID, modelo: "pacote" })).status, 400, "sem insumo nenhum");
});

test("rota: manda imagem + texto pra OpenAI com o esquema e devolve limpo", async () => {
  process.env.OPENAI_API_KEY = "sk-falsa";
  chamadas = [];
  insumosFalsos = [
    { id: "a1", tipo: "arquivo", arquivo_path: `${PID}/voo.png`, arquivo_nome: "voo.png", mime: "image/png", tamanho: 1000 },
    { id: "a2", tipo: "arquivo", arquivo_path: `${PID}/foto.heic`, arquivo_nome: "foto.heic", mime: "image/heic", tamanho: 1000 },
    { id: "t1", tipo: "texto", texto: "Cliente quer Cancún em agosto, 2 adultos" },
  ];
  respostaIa = { viagem: { destino: "Cancún", data_ida: "2027-13-01" }, campos: {}, voos: [], hoteis: [], roteiro: [], precos: [{ rotulo: "Duplo", valor_pessoa: 15000 }], pagamento: null, validade: null, conferir: [] };
  const { status, corpo } = await chamar({ proposta_id: PID, modelo: "pacote", campos: camposParaIa("pacote"), pedido: "all inclusive" });
  assert.equal(status, 200);
  const ex = corpo.extracao as ExtracaoIa;
  assert.equal(ex.viagem.destino, "Cancún");
  assert.equal(ex.viagem.data_ida, "", "mês 13 descartado");
  assert.equal(ex.precos[0].valor_pessoa, 15000);
  assert.ok((corpo.avisos as string[]).some((a) => /HEIC/.test(a)));
  assert.deepEqual((corpo.uso as { entrada: number }).entrada, 40000);
  const ia = chamadas.find((c) => c.url.includes("api.openai.com"))!;
  const enviado = JSON.parse(ia.body!);
  assert.equal(enviado.model, "gpt-4o-mini");
  assert.equal(enviado.response_format.json_schema.strict, true);
  const partes = enviado.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
  assert.equal(partes.filter((x) => x.type === "image_url").length, 1, "só o PNG (HEIC fica de fora)");
  assert.match(partes[0].text!, /Cancún em agosto/);
  assert.match(partes[0].text!, /all inclusive/);
  assert.ok(chamadas.some((c) => c.url.includes("qs_proposta_insumos?id=in.(a1,t1)")), "marca lido_em");
});

test("separarInsumos: no máximo 8 arquivos (os mais recentes) e respeita o tamanho", () => {
  const arqs = Array.from({ length: 10 }, (_, n) => ({ id: `a${n}`, tipo: "arquivo", arquivo_nome: `p${n}.png`, mime: "image/png", tamanho: 100 }));
  const { arquivos, avisos } = separarInsumos([...arqs, { id: "g", tipo: "arquivo", arquivo_nome: "grande.pdf", mime: "application/pdf", tamanho: 11 * 1024 * 1024 }]);
  assert.equal(arquivos.length, 8);
  assert.equal(arquivos[0].id, "a2", "os 2 mais antigos ficam de fora");
  assert.ok(avisos.some((a: string) => /10 MB/.test(a)));
});
