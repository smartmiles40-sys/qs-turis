// Espelho antigo → QS (05/11/2026, 0317): paginação por cursor, desempate,
// colunas mandadas, remapeamento de usuários, apagados e a rodada inteira com
// um fetch dublê (nada vai à rede).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TABELAS, TABELA, filtroCursor, caminhoPagina, proximoCursor, inicioLeitura, maiorCursor,
  colunasDaOrigem, semGeradas, remaparUsuarios, soColunas, idsReferenciados, idsParaApagar,
  apagarDemais, horaDeLimpar, semRepetidas, pedacos, codCaminho, rodarEspelho,
  // @ts-expect-error — módulo JS das funções da Vercel, sem tipos
} from "../../api/_expEspelho.js";

const TS = "2026-11-05T14:58:49.070603+00:00";

test("ordem: pais antes de filhos (cada FK aponta pra trás, exceto as adiadas)", () => {
  const pos = new Map(TABELAS.map((t: { nome: string }, i: number) => [t.nome, i]));
  const deps: [string, string][] = [
    ["expedicoes", "usuarios"], ["expedicoes", "fornecedores"], ["grupos_expedicao", "expedicoes"],
    ["extensoes", "expedicoes"], ["quartos", "extensoes"], ["roteiro_dias", "extensoes"],
    ["passageiros", "quartos"], ["passageiros", "grupos_expedicao"], ["arquivos", "passageiros"],
    ["arquivos", "usuarios"], ["passageiro_quarto", "quartos"], ["passageiro_requisitos", "arquivos"],
    ["pagamentos", "custos"], ["expedicao_info", "arquivos"], ["expedicao_voos", "passageiros"],
    ["passeios_opcionais", "roteiro_dias"], ["passeio_opcional_compras", "passeios_opcionais"],
    ["roteiro_dia_fotos", "arquivos"], ["inscricoes_pendentes", "arquivos"], ["acesso_links", "passageiros"],
    ["audit_log", "usuarios"], ["inscricoes_decisoes", "usuarios"],
  ];
  for (const [filho, pai] of deps) assert.ok(pos.get(pai)! < pos.get(filho)!, `${pai} antes de ${filho}`);
  assert.equal(TABELAS.length, 34);
  // As FKs que voltariam pra trás vão no 2º passo
  assert.deepEqual(TABELA.expedicoes.adiar, { hospedagem_voucher_arquivo_id: "arquivos" });
  assert.deepEqual(Object.keys(TABELA.passageiros.adiar).sort(), ["foto_arquivo_id", "passaporte_arquivo_id"]);
  assert.deepEqual(Object.values(TABELA.checklist_itens.adiar), ["checklist_itens", "checklist_itens"]);
});

test("logs e usuários nunca são apagados pelo espelho", () => {
  for (const t of ["usuarios", "cambios", "audit_log", "expedamigo_acessos", "inscricoes_decisoes"]) {
    assert.equal(TABELA[t].apagar, false, t);
  }
  assert.equal(TABELA.passageiros.apagar, true);
});

test("filtro do cursor: maior que o instante OU mesmo instante com chave maior", () => {
  assert.equal(filtroCursor("updated_at", "id", null), "");
  const f = decodeURIComponent(filtroCursor("updated_at", "id", { ts: TS, id: "abc" }));
  assert.equal(f, `or=(updated_at.gt."${TS}",and(updated_at.eq."${TS}",id.gt."abc"))`);
  // sem id (cursor recuado) → >= (o + do fuso vai codificado)
  const g = filtroCursor("updated_at", "id", { ts: TS, id: null });
  assert.equal(g, `updated_at=gte.${encodeURIComponent(TS)}`);
  assert.ok(!g.includes("+"));
});

test("caminho da página: ordem + desempate + limite; tabela inteira pagina pela chave", () => {
  const c = caminhoPagina(TABELA.passageiros, { ts: TS, id: "p1" });
  assert.ok(c.startsWith("passageiros?select=*&order=updated_at.asc,id.asc&or="));
  assert.ok(c.endsWith("&limit=1000"));
  assert.equal(caminhoPagina(TABELA.audit_log, null), "audit_log?select=*&order=created_at.asc,id.asc&limit=250");
  assert.equal(caminhoPagina(TABELA.cambios, null), "cambios?select=*&order=moeda.asc&limit=1000");
  assert.equal(caminhoPagina(TABELA.passageiro_quarto, { id: "x" }), "passageiro_quarto?select=*&order=id.asc&id=gt.x&limit=1000");
});

test("próximo cursor = última linha; inícios com sobreposição", () => {
  assert.equal(proximoCursor([], "updated_at", "id"), null);
  assert.deepEqual(proximoCursor([{ id: 1, updated_at: "a" }, { id: 2, updated_at: TS }], "updated_at", "id"), { ts: TS, id: "2" });
  assert.equal(inicioLeitura(null), null);
  const r = inicioLeitura({ ts: "2026-11-05T15:00:00.000000+00:00", id: "z" });
  assert.deepEqual(r, { ts: "2026-11-05T14:58:00.000Z", id: null });
  // seco: sem recuo, conta só o que mudou de verdade
  assert.deepEqual(inicioLeitura({ ts: TS, id: "z" }, { seco: true }), { ts: TS, id: "z" });
});

test("cursor nunca anda pra trás (a sobreposição relê linhas antigas)", () => {
  const novo = { ts: "2026-11-05T15:00:00.000002+00:00", id: "a" };
  const velho = { ts: "2026-11-05T15:00:00.000001+00:00", id: "z" };
  assert.equal(maiorCursor(novo, velho), novo);
  assert.equal(maiorCursor(velho, novo), novo);
  assert.deepEqual(maiorCursor({ ts: TS, id: "b" }, { ts: TS, id: "a" }), { ts: TS, id: "b" });
  assert.equal(maiorCursor(null, velho), velho);
  assert.deepEqual(maiorCursor({ ts: "2026-11-05T16:00:00Z", id: "a" }, { ts: "2026-11-05T15:00:00Z", id: "z" }).ts, "2026-11-05T16:00:00Z");
});

test("colunas mandadas = as do antigo, sem geradas nem adiadas (as do QS ficam de fora)", () => {
  const linhas = [{ id: "1", nome: "A", saldo_brl: 10, foto_arquivo_id: "f" }, { id: "2", cpf: "x" }];
  const cols = colunasDaOrigem(linhas, { geradas: ["saldo_brl"], excluir: ["foto_arquivo_id"] });
  assert.deepEqual(cols.sort(), ["cpf", "id", "nome"]);
  assert.ok(!cols.includes("cliente_id"));
  assert.deepEqual(semGeradas([{ id: 1, saldo: 3, x: 1 }], ["saldo"]), [{ id: 1, x: 1 }]);
  assert.deepEqual(soColunas([{ id: 1, a: 2, b: 3 }], ["id", "b", "zz"]), [{ id: 1, b: 3 }]);
});

test("ids de usuário do antigo viram os do QS (sem par: mantém)", () => {
  const mapa = new Map([["velho", "novo"]]);
  const linhas = [{ id: "c1", pago_por: "velho" }, { id: "c2", pago_por: "outro" }, { id: "c3", pago_por: null }];
  const r = remaparUsuarios(linhas, ["pago_por"], mapa);
  assert.deepEqual(r.map((l: { pago_por: string | null }) => l.pago_por), ["novo", "outro", null]);
  assert.equal(linhas[0].pago_por, "velho", "não muta a entrada");
  assert.equal(remaparUsuarios(linhas, [], mapa), linhas);
});

test("referências, repetidas e pedaços", () => {
  assert.deepEqual(idsReferenciados([{ a: "1", b: null }, { a: "1", b: "2" }, { a: "" }], ["a", "b"]).sort(), ["1", "2"]);
  assert.deepEqual(semRepetidas([{ id: 1, v: "a" }, { id: 1, v: "b" }, { id: 2 }], "id"), [{ id: 1, v: "b" }, { id: 2 }]);
  assert.deepEqual(pedacos([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(codCaminho("exp/passageiros/x/Bilhetes/a b#c.pdf"), "exp/passageiros/x/Bilhetes/a%20b%23c.pdf");
});

test("apagados: só os vindos do antigo que sumiram; trava contra apagar demais", () => {
  assert.deepEqual(idsParaApagar(["a", "b", "c"], ["a", "c", "d"]), ["b"]);
  assert.equal(apagarDemais(5, 10), null);
  assert.equal(apagarDemais(25, 1000), null);
  assert.match(apagarDemais(500, 1000)!, /segurança/);
  assert.match(apagarDemais(30, 30)!, /segurança/); // antigo "vazio" de repente
});

test("limpeza de hora em hora", () => {
  const agora = Date.parse("2026-11-05T15:00:00Z");
  assert.equal(horaDeLimpar(undefined, agora), true);
  assert.equal(horaDeLimpar("2026-11-05T14:30:00Z", agora), false);
  assert.equal(horaDeLimpar("2026-11-05T13:59:00Z", agora), true);
});

test("desligado pela env: não toca em nada", async () => {
  let chamadas = 0;
  const r = await rodarEspelho({ env: {}, fetchImpl: (async () => { chamadas++; throw new Error("não devia"); }) as never });
  assert.equal(r.desligado, true);
  assert.equal(chamadas, 0);
});

// ── Rodada com fetch dublê ──────────────────────────────────────────────────

type Pedido = { url: string; method: string; body?: unknown; headers: Record<string, string> };

function dubleFetch(origem: Record<string, unknown[]>, opts: { ligado?: boolean } = {}) {
  const pedidos: Pedido[] = [];
  const resposta = (dados: unknown) => new Response(JSON.stringify(dados), { status: 200, headers: { "content-type": "application/json" } });
  const fn = async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    pedidos.push({ url, method, body, headers: init.headers || {} });
    const u = new URL(url);
    if (u.host.startsWith("bnbpsuenlokhljrkvlke")) {
      assert.equal(method, "GET", "nunca escreve no antigo");
      const tabela = u.pathname.replace("/rest/v1/", "");
      if (tabela === "usuarios" && u.searchParams.get("select") === "id,email") return resposta([{ id: "u-velho", email: "Ana@x.com" }]);
      const linhas = (origem[tabela] || []) as Record<string, unknown>[];
      const sel = u.searchParams.get("select");
      if (sel && sel !== "*") return resposta(linhas.map((l) => ({ [sel]: l[sel] })));
      // primeira página só (dublê simples): menos que o lote → acaba
      return resposta(u.searchParams.get("id")?.startsWith("gt.") ? [] : linhas);
    }
    const caminho = u.pathname;
    if (caminho === "/rest/v1/ops_config") return resposta([{ valor: { ligado: opts.ligado ?? true } }]);
    if (caminho === "/rest/v1/exp_espelho_estado") return resposta(method === "GET" ? [] : null);
    if (caminho === "/rest/v1/rpc/exp_espelho_mapa_usuarios") return resposta([{ email: "ana@x.com", id: "u-qs" }]);
    if (caminho === "/rest/v1/rpc/exp_espelho_aplicar") return resposta({ aplicadas: (body as { p_linhas: unknown[] }).p_linhas.length, arquivos_na_fila: 0 });
    if (caminho === "/rest/v1/rpc/exp_espelho_registrar") return resposta(null);
    if (caminho === "/rest/v1/exp_espelho_storage") return resposta([]);
    if (caminho === "/rest/v1/exp_espelho_ids") return resposta([]);
    if (caminho === "/rest/v1/arquivos") return resposta([{ id: "arq-1" }]); // já existe no QS
    return resposta([]);
  };
  return { fn, pedidos };
}

const ENV = { EXP_ESPELHO_LIGADO: "1", EXPEDICOES_SECRET_KEY: "sb_secret_teste", SUPABASE_URL: "https://qs.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "eyJ.servico" };

test("rodada: chave sb_secret só no apikey, colunas certas, usuário remapeado, adiadas no 2º passo", async () => {
  const { fn, pedidos } = dubleFetch({
    expedicoes: [{ id: "e1", nome: "Japão", responsavel_operacional_id: "u-velho", hospedagem_voucher_arquivo_id: "arq-1", updated_at: TS }],
    passageiros: [{ id: "p1", nome_completo: "Fulano", saldo_brl: 100, foto_arquivo_id: null, passaporte_arquivo_id: null, updated_at: TS }],
  });
  const r = await rodarEspelho({ env: ENV, fetchImpl: fn as never });
  assert.equal(r.ok, true);
  assert.equal(r.completo, true, JSON.stringify(r));

  const doAntigo = pedidos.filter((p) => p.url.includes("bnbpsuenlokhljrkvlke"));
  assert.ok(doAntigo.length > 0);
  for (const p of doAntigo) {
    assert.equal(p.headers.apikey, "sb_secret_teste");
    assert.equal(p.headers.Authorization, undefined, "sb_secret não vai no Bearer");
  }
  const aplicar = pedidos.filter((p) => p.url.endsWith("/rpc/exp_espelho_aplicar")).map((p) => p.body as { p_tabela: string; p_linhas: Record<string, unknown>[]; p_colunas: string[] });
  const exp = aplicar.filter((a) => a.p_tabela === "expedicoes");
  assert.equal(exp.length, 2, "1º passo + colunas adiadas");
  assert.ok(!exp[0].p_colunas.includes("hospedagem_voucher_arquivo_id"));
  assert.equal(exp[0].p_linhas[0].responsavel_operacional_id, "u-qs");
  assert.deepEqual(exp[1].p_colunas, ["id", "hospedagem_voucher_arquivo_id"]);
  assert.deepEqual(exp[1].p_linhas, [{ id: "e1", hospedagem_voucher_arquivo_id: "arq-1" }]);
  const pax = aplicar.find((a) => a.p_tabela === "passageiros")!;
  assert.ok(!pax.p_colunas.includes("saldo_brl"), "coluna gerada fica de fora");
  assert.ok(!("saldo_brl" in pax.p_linhas[0]));

  const estado = pedidos.filter((p) => p.url.includes("/exp_espelho_estado?on_conflict=tabela"));
  assert.ok(estado.some((p) => (p.body as { tabela: string; cursor_ts: string }[])[0].tabela === "expedicoes"
    && (p.body as { cursor_ts: string }[])[0].cursor_ts === TS));
  const reg = pedidos.filter((p) => p.url.endsWith("/rpc/exp_espelho_registrar")).map((p) => (p.body as { p_info: Record<string, unknown> }).p_info);
  assert.ok(reg.some((i) => i.sincronizado_em), "marca a sincronia completa");
});

test("rodada seca: não escreve em lugar nenhum", async () => {
  const { fn, pedidos } = dubleFetch({ fornecedores: [{ id: "f1", nome: "DMC", updated_at: TS }] });
  const r = await rodarEspelho({ env: ENV, seco: true, fetchImpl: fn as never });
  assert.equal(r.tabelas.fornecedores.lidas, 1);
  assert.equal(r.tabelas.fornecedores.aplicadas, 0);
  const escritas = pedidos.filter((p) => p.method !== "GET" && !p.url.endsWith("/rpc/exp_espelho_mapa_usuarios"));
  assert.deepEqual(escritas.map((p) => p.url), []);
});

test("flag do banco desligada: para antes de ler o antigo", async () => {
  const { fn, pedidos } = dubleFetch({}, { ligado: false });
  const r = await rodarEspelho({ env: ENV, fetchImpl: fn as never });
  assert.equal(r.desligado, true);
  assert.ok(!pedidos.some((p) => p.url.includes("bnbpsuenlokhljrkvlke")));
});
