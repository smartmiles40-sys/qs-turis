// Fluxos do Relacionamento (0409): disparo pra um público, template com botões,
// clique → resposta + etiqueta + aviso, PARAR, travas — sem banco e sem Meta.
// O `fetch` global vira um PostgREST de mentira (filtros eq/in/neq/is/lte) +
// uma Graph API de mentira que anotam cada chamada.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
delete process.env.REL_DISPARO_ENVIO;
delete process.env.META_PHONE_NUMBER_ID;

type Linha = Record<string, unknown>;
type Chamada = { metodo: string; url: string; corpo: unknown };

const PH = "777000111";
const FLUXO = "55555555-5555-4555-8555-555555555555";
const DISP = "66666666-6666-4666-8666-666666666666";
const CLI = "44444444-4444-4444-8444-444444444444";
let chamadas: Chamada[] = [];
let settings: Record<string, unknown> = {};
let tabelas: Record<string, Linha[]> = {};
let publico: Linha[] = [];
let seq = 0;

const resp = (status: number, corpo: unknown) =>
  new Response(corpo === undefined ? "" : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/** Filtro PostgREST de mentira: eq., neq., in.(), is.null, lte., e a->>b. */
function casa(l: Linha, k: string, v: string): boolean {
  if (["select", "order", "limit", "on_conflict"].includes(k)) return true;
  const val = k.includes("->>") ? (l[k.split("->>")[0]] as Linha | null)?.[k.split("->>")[1]] : l[k];
  const s = val === null || val === undefined ? null : String(val);
  if (v.startsWith("eq.")) return s === v.slice(3);
  if (v.startsWith("neq.")) return s !== v.slice(4);
  if (v === "is.null") return s === null;
  if (v.startsWith("in.(")) return v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(s));
  if (v.startsWith("lte.")) return s !== null && s <= v.slice(4);
  return true;
}
const filtrar = (linhas: Linha[], q: URLSearchParams) => linhas.filter((l) => [...q.entries()].every(([k, v]) => casa(l, k, v)));

globalThis.fetch = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
  const url = String(entrada);
  const metodo = (init.method || "GET").toUpperCase();
  const corpo = init.body ? JSON.parse(String(init.body)) : undefined;
  chamadas.push({ metodo, url, corpo });

  if (url.startsWith("https://graph.facebook.com/")) {
    const u = new URL(url);
    if (metodo === "GET" && u.pathname.endsWith(`/${PH}`)) return resp(200, { whatsapp_business_manager_messaging_limit: "TIER_1K", quality_rating: "GREEN" });
    if (metodo === "POST" && u.pathname.endsWith(`/${PH}/messages`)) return resp(200, { messages: [{ id: `wamid.F${chamadas.length}` }] });
    return resp(404, { error: { message: "rota falsa", code: 100 } });
  }
  const u = new URL(url);
  const tabela = u.pathname.replace("/rest/v1/", "");
  const q = u.searchParams;

  if (tabela === "qs_settings") { const k = (q.get("key") || "").replace(/^eq\./, ""); return resp(200, k in settings ? [{ value: settings[k] }] : []); }
  if (tabela === "qs_wa_numeros_meta") {
    if ((q.get("select") || "").startsWith("waba_id")) return resp(200, [{ waba_id: "W9" }]);
    return resp(200, [{ phone_number_id: PH, numero: "+55 11 98012-4183", nome_verificado: "Rel", status: "conectado", segredo_id: "s1" }]);
  }
  if (tabela === "rpc/qs_meta_token") return resp(200, "tok-falso");
  if (tabela === "rpc/mkt_disparo_contar" || tabela === "rpc/rel_fluxo_contar_modelos") return resp(200, 0);
  if (tabela === "rpc/rel_fluxo_contar") return resp(200, null);
  if (tabela === "rpc/qs_disparo_publico_rel") return resp(200, publico);
  if (tabela === "rpc/rel_wa_ingest") { (tabelas.bolhas ||= []).push(corpo as Linha); return resp(200, { nova: true, conversa: "conv-1" }); }
  if (tabela === "rpc/rel_fluxo_reivindicar") {
    const agora = new Date().toISOString();
    return resp(200, (tabelas.rel_fluxo_execucoes || []).filter((e) => ["aguardando_tempo", "aguardando_resposta"].includes(String(e.estado)) && e.acordar_em && String(e.acordar_em) <= agora));
  }
  if (tabela.startsWith("rpc/")) return resp(200, null);

  const linhas = (tabelas[tabela] ||= []);
  if (metodo === "GET") {
    const r = filtrar(linhas, q);
    return resp(200, r.slice(0, Number(q.get("limit") || 1000)));
  }
  if (metodo === "POST") {
    const novas = (Array.isArray(corpo) ? corpo : [corpo]) as Linha[];
    const feitas: Linha[] = [];
    for (const n of novas) {
      if (tabela === "rel_fluxo_execucoes" && n.disparo_id && linhas.some((l) => l.disparo_id === n.disparo_id && l.telefone === n.telefone)) continue;
      const l = { id: n.id ?? `id-${++seq}`, passos: 0, ...n };
      linhas.push(l); feitas.push(l);
    }
    return resp(201, feitas);
  }
  if (metodo === "PATCH") {
    const r = filtrar(linhas, q);
    for (const l of r) Object.assign(l, corpo);
    return resp(200, r);
  }
  if (metodo === "DELETE") {
    const r = filtrar(linhas, q);
    tabelas[tabela] = linhas.filter((l) => !r.includes(l));
    return resp(204, undefined);
  }
  return resp(200, []);
}) as typeof fetch;

const { rodadaFluxosRel, receberNoFluxoRel, agendarDisparoFluxo, iniciarTesteRel } = await import("../../api/_relFluxoMotor.js");

// Terça, 10/11/2026, 12:00 em Brasília.
const TERCA_MEIO_DIA = new Date("2026-11-10T15:00:00Z");
const DOMINGO = new Date("2026-11-08T15:00:00Z");
const RITMO = { por_segundo: 50, por_dia: 400, margem_tier: 0.6, inicio: "09:00", fim: "19:00", dias: [1, 2, 3, 4, 5, 6], tier_padrao: "TIER_250" };
const MODELO = {
  nome: "ativacao_2027", idioma: "pt_BR", categoria: "MARKETING", status: "APPROVED", formato_parametros: "POSITIONAL",
  corpo: "Oi {{1}}! Saíram as datas de 2027. Quer saber?", cabecalho_formato: "IMAGE", cabecalho_texto: null,
  botoes: [{ indice: 0, tipo: "QUICK_REPLY", texto: "Quero saber", variavel: false }, { indice: 1, tipo: "QUICK_REPLY", texto: "Agora não", variavel: false }],
};
const GRAFO = {
  nos: [
    { id: "ini", tipo: "inicio", x: 0, y: 0, dados: {} },
    { id: "tpl", tipo: "template", x: 0, y: 0, dados: { nome: "ativacao_2027", idioma: "pt_BR", variaveis: { 1: "{{primeiro_nome}}" }, cabecalhoUrl: "https://cdn/2027.jpg", botoes: ["Quero saber", "Agora não"] } },
    { id: "msg", tipo: "mensagem", x: 0, y: 0, dados: { blocos: [{ tipo: "texto", texto: "Oba, {{primeiro_nome}}! Te mando tudo." }], interacao: { tipo: "nenhuma" } } },
    { id: "acao", tipo: "acao", x: 0, y: 0, dados: { acoes: [{ tipo: "adicionar_tag", tag: "Quer 2027" }, { tipo: "avisar_humano", usuarios: ["u-gestora"], mensagem: "{{primeiro_nome}} quer saber" }] } },
  ],
  ligacoes: [
    { id: "l1", de: "ini", saida: "proximo", para: "tpl" },
    { id: "l2", de: "tpl", saida: "botao_0", para: "msg" },
    { id: "l3", de: "msg", saida: "proximo", para: "acao" },
  ],
};

beforeEach(() => {
  chamadas = []; seq = 0;
  settings = { rel_disparo_ritmo: RITMO };
  delete process.env.REL_DISPARO_ENVIO;
  tabelas = {
    rel_fluxos: [{ id: FLUXO, nome: "Ativação 2027", status: "ativo", grafo: structuredClone(GRAFO), execucoes_total: 0 }],
    rel_fluxo_disparos: [{ id: DISP, fluxo_id: FLUXO, publico: {}, status: "agendado", agendado_para: "2026-11-10T14:00:00.000Z", total: 0 }],
    rel_fluxo_execucoes: [], rel_fluxo_eventos: [], rel_wa_modelos: [{ ...MODELO }],
    rel_clientes: [{ id: CLI, nome: "Ana Souza", optout_em: null, telefone: "11999990001", mesclado_em_id: null }],
    rel_wa_conversas: [], rel_cliente_etiquetas: [], qs_avisos: [], rel_viagens: [],
  };
  publico = [
    { cliente_id: CLI, nome: "Ana Souza", telefone: "11999990001", viagem_id: null, optout: false },
    { cliente_id: "c2", nome: "Beto", telefone: "11999990002", viagem_id: null, optout: true },
    { cliente_id: CLI, nome: "Ana Souza", telefone: "5511999990001", viagem_id: null, optout: false },
  ];
});

const graphPosts = () => chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/") && c.metodo === "POST");
const execs = () => tabelas.rel_fluxo_execucoes;

test("disparo em simulação: entra quem pode (sem opt-out, sem repetir), nada vai pra Meta, fica esperando o clique", async () => {
  const r = await rodadaFluxosRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  assert.equal(r.modo, "simulacao");
  assert.equal(execs().length, 1, "Beto pediu pra parar; Ana veio 2x com o mesmo número");
  assert.equal(graphPosts().length, 0);
  assert.equal(execs()[0].estado, "aguardando_resposta");
  assert.equal(execs()[0].no_atual, "tpl");
  assert.ok(tabelas.rel_fluxo_eventos.some((e) => e.tipo === "enviou_modelo" && e.simulado === true));
  assert.equal(tabelas.rel_fluxo_disparos[0].status, "concluido");
  assert.equal(tabelas.rel_fluxo_disparos[0].total, 1);
});

test("fora da janela de envio (domingo): ninguém começa", async () => {
  const r = await rodadaFluxosRel({ agora: DOMINGO, limiteMs: 5_000 });
  assert.match(String(r.parado), /janela/);
  assert.equal(execs().length, 0);
});

test("envio real: template com imagem, nome e o payload de cada botão apontando pra seta; vira bolha na conversa", async () => {
  process.env.REL_DISPARO_ENVIO = "1";
  settings.rel_disparo_simulacao = false;
  await rodadaFluxosRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  const posts = graphPosts();
  assert.equal(posts.length, 1);
  const t = (posts[0].corpo as { to: string; template: { name: string; components: Linha[] } });
  assert.equal(t.to, "5511999990001");
  assert.equal(t.template.name, "ativacao_2027");
  const header = t.template.components.find((c) => c.type === "header") as { parameters: { image: { link: string } }[] };
  assert.equal(header.parameters[0].image.link, "https://cdn/2027.jpg");
  const body = t.template.components.find((c) => c.type === "body") as { parameters: { text: string }[] };
  assert.equal(body.parameters[0].text, "Ana");
  const qr = t.template.components.filter((c) => c.sub_type === "quick_reply") as { index: string; parameters: { payload: string }[] }[];
  assert.deepEqual(qr.map((b) => [b.index, b.parameters[0].payload]), [["0", `f:${FLUXO}:tpl:botao_0`], ["1", `f:${FLUXO}:tpl:botao_1`]]);
  assert.equal(tabelas.bolhas?.length, 1);
});

test("real com modelo NÃO aprovado: não manda e registra o erro", async () => {
  process.env.REL_DISPARO_ENVIO = "1";
  settings.rel_disparo_simulacao = false;
  tabelas.rel_wa_modelos[0].status = "PENDING";
  await rodadaFluxosRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  assert.equal(graphPosts().length, 0);
  assert.equal(execs()[0].estado, "erro");
  assert.ok(tabelas.rel_fluxo_eventos.some((e) => e.tipo === "erro" && /PENDING/.test(String(e.detalhe))));
});

test("clique no botão do template: responde (janela aberta), põe a etiqueta, avisa no sino e termina", async () => {
  process.env.REL_DISPARO_ENVIO = "1";
  settings.rel_disparo_simulacao = false;
  await rodadaFluxosRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  // O clique abre a janela de 24 h (a conversa registra a entrada).
  tabelas.rel_wa_conversas.push({ id: "conv-1", phone_number_id: PH, telefone: "5511999990001", cliente_id: CLI, ultima_entrada_em: new Date().toISOString(), optout_em: null });
  chamadas = [];
  const m = { id: "wamid.IN1", from: "5511999990001", type: "button", button: { text: "Quero saber", payload: `f:${FLUXO}:tpl:botao_0` }, context: { id: "wamid.X" } };
  const r = await receberNoFluxoRel({ phoneId: PH, telefone: "5511999990001", m, conversaId: "conv-1" });
  assert.equal(r?.motivo, "clique");
  const texto = graphPosts().map((c) => c.corpo as { type: string; text?: { body: string } }).find((c) => c.type === "text");
  assert.equal(texto?.text?.body, "Oba, Ana! Te mando tudo.");
  assert.deepEqual(tabelas.rel_cliente_etiquetas.map((e) => [e.cliente_id, e.etiqueta, e.origem]), [[CLI, "quer 2027", "fluxo"]]);
  assert.equal(tabelas.qs_avisos.length, 1);
  assert.equal(tabelas.qs_avisos[0].user_id, "u-gestora");
  assert.match(String(tabelas.qs_avisos[0].texto), /Ana quer saber/);
  assert.equal(execs()[0].estado, "concluida");
});

test("PARAR cancela o fluxo de quem pediu", async () => {
  await rodadaFluxosRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  const m = { id: "wamid.IN2", from: "5511999990001", type: "text", text: { body: "parar" } };
  const r = await receberNoFluxoRel({ phoneId: PH, telefone: "5511999990001", m, conversaId: null });
  assert.equal(r?.motivo, "optout");
  assert.equal(execs()[0].estado, "cancelada");
});

test("mensagem comum sem fluxo esperando: o motor não se mete (segue pro atendimento)", async () => {
  const m = { id: "wamid.IN3", from: "5511999990009", type: "text", text: { body: "oi, tudo bem?" } };
  assert.equal(await receberNoFluxoRel({ phoneId: PH, telefone: "5511999990009", m, conversaId: null }), null);
  assert.equal(graphPosts().length, 0);
});

test("disparar: recusa fluxo pausado e fluxo que não começa por Template", async () => {
  tabelas.rel_fluxos[0].status = "pausado";
  assert.match(String((await agendarDisparoFluxo({ fluxoId: FLUXO, publico: {}, userId: "u1" })).erro), /Ative/);
  tabelas.rel_fluxos[0].status = "ativo";
  (tabelas.rel_fluxos[0].grafo as typeof GRAFO).ligacoes[0].para = "msg";
  assert.match(String((await agendarDisparoFluxo({ fluxoId: FLUXO, publico: {}, userId: "u1" })).erro), /Template/);
  (tabelas.rel_fluxos[0].grafo as typeof GRAFO).ligacoes[0].para = "tpl";
  const ok = await agendarDisparoFluxo({ fluxoId: FLUXO, publico: { etiquetas: ["vip"] }, userId: "u1" });
  assert.ok(ok.disparo);
});

test("teste do editor precisa da env (sai de verdade)", async () => {
  const r = await iniciarTesteRel({ fluxoId: FLUXO, telefone: "11999990001", nome: "Bruno" });
  assert.match(String(r.erro), /REL_DISPARO_ENVIO|travado/);
  process.env.REL_DISPARO_ENVIO = "1";
  const r2 = await iniciarTesteRel({ fluxoId: FLUXO, telefone: "11999990001", nome: "Bruno" });
  assert.ok(r2.execucaoId);
  assert.equal(graphPosts().length, 1, "o template saiu mesmo com a simulação geral ligada");
});
