// Disparo do Relacionamento (0408): a rodada, o link rastreado e o clique no
// botão — sem banco e sem Meta. O `fetch` global vira um PostgREST de mentira +
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
const PH_SDR = "888000222"; // 0411: número de um SDR (outra WABA)
const CAMP = "22222222-2222-4222-8222-222222222222";
const E1 = "33333333-3333-4333-8333-333333333331";
const E2 = "33333333-3333-4333-8333-333333333332";
const CLI = "44444444-4444-4444-8444-444444444444";
let chamadas: Chamada[] = [];
let settings: Record<string, unknown> = {};
let campanhas: Linha[] = [];
let envios: Linha[] = [];
let modelos: Linha[] = [];
let etiquetas: Linha[] = [];
let mensagensRel: Linha[] = [];
let numeroRel: Linha | null = null;
let numeroSdr: Linha | null = null;
let optout = false;

const resp = (status: number, corpo: unknown) =>
  new Response(corpo === undefined ? "" : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const eq = (q: URLSearchParams, k: string) => (q.get(k) || "").replace(/^eq\./, "");

globalThis.fetch = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
  const url = String(entrada);
  const metodo = (init.method || "GET").toUpperCase();
  const corpo = init.body ? JSON.parse(String(init.body)) : undefined;
  chamadas.push({ metodo, url, corpo });

  if (url.startsWith("https://graph.facebook.com/")) {
    const u = new URL(url);
    for (const ph of [PH, PH_SDR]) {
      if (metodo === "GET" && u.pathname.endsWith(`/${ph}`)) return resp(200, { whatsapp_business_manager_messaging_limit: "TIER_1K", quality_rating: "GREEN" });
      if (metodo === "POST" && u.pathname.endsWith(`/${ph}/messages`)) return resp(200, { messages: [{ id: `wamid.R${chamadas.length}` }] });
    }
    return resp(404, { error: { message: "rota falsa", code: 100 } });
  }

  const u = new URL(url);
  const tabela = u.pathname.replace("/rest/v1/", "");
  const q = u.searchParams;

  if (tabela === "qs_settings") { const k = eq(q, "key"); return resp(200, k in settings ? [{ value: settings[k] }] : []); }
  if (tabela === "qs_wa_numeros_meta") {
    if ((q.get("select") || "").startsWith("waba_id")) return resp(200, [{ waba_id: eq(q, "phone_number_id") === PH_SDR ? "W_SDR" : "W9" }]);
    if (eq(q, "setor") === "relacionamento") return resp(200, numeroRel ? [numeroRel] : []);
    return resp(200, [...(numeroRel ? [{ ...numeroRel, setor: "relacionamento", waba_id: "W9" }] : []), ...(numeroSdr ? [numeroSdr] : [])]);
  }
  if (tabela === "rpc/qs_meta_token") return resp(200, "tok-falso");
  if (tabela === "rpc/mkt_disparo_contar") return resp(200, 0);
  if (tabela === "rpc/rel_cliente_optout") return resp(200, optout);
  if (tabela === "rpc/rel_wa_ingest") { mensagensRel.push(corpo as Linha); return resp(200, { nova: true, conversa: "conv-1" }); }
  if (tabela === "rel_wa_mensagens") return resp(200, []);
  if (tabela === "rel_viagens") return resp(200, [{ destino: "Japão", titulo: "Japão 2027" }]);
  if (tabela === "rel_wa_modelos") {
    const n = eq(q, "nome"); const i = eq(q, "idioma"); const w = eq(q, "waba_id");
    return resp(200, modelos.filter((m) => (!n || m.nome === n) && (!i || m.idioma === i) && (!w || m.waba_id === w)));
  }
  if (tabela === "rel_cliente_etiquetas") {
    if (metodo === "POST") { for (const l of corpo as Linha[]) etiquetas.push(l); return resp(201, undefined); }
    return resp(200, etiquetas);
  }
  if (tabela === "qs_disparo_campanhas") {
    if (metodo === "GET") {
      let r = campanhas;
      if (q.get("status")) r = r.filter((c) => c.status === eq(q, "status"));
      if (q.get("id")) r = r.filter((c) => c.id === eq(q, "id"));
      const setor = q.get("setor") || "";
      if (setor.startsWith("eq.")) r = r.filter((c) => c.setor === setor.slice(3));
      return resp(200, r);
    }
    if (metodo === "PATCH") {
      for (const c of campanhas) if (c.id === eq(q, "id") && (!q.get("status") || c.status === eq(q, "status"))) Object.assign(c, corpo);
      return resp(204, undefined);
    }
  }
  if (tabela === "qs_disparo_envios") {
    if (metodo === "GET") {
      if (q.get("wamid")) return resp(200, envios.filter((e) => e.wamid === eq(q, "wamid")));
      if (q.get("id")) return resp(200, envios.filter((e) => e.id === eq(q, "id")));
      const r = envios.filter((e) => e.campanha_id === eq(q, "campanha_id") && e.status === eq(q, "status"));
      return resp(200, r.slice(0, Number(q.get("limit") || 1000)));
    }
    if (metodo === "PATCH") {
      const e = envios.find((x) => x.id === eq(q, "id"));
      if (!e || (q.get("status") && e.status !== eq(q, "status"))) return resp(200, []);
      if (q.get("clicou_em") === "is.null" && e.clicou_em) return resp(200, []);
      Object.assign(e, corpo);
      return resp(200, [e]);
    }
  }
  return resp(200, []);
}) as typeof fetch;

const { rodadaRel, registrarClique } = await import("../../api/_relDisparoOficial.js");
const { tratarCliqueDeDisparo } = await import("../../api/_relDisparoBotoes.js");
const { rodada } = await import("../../api/_disparo.js");

// Terça, 10/11/2026, 12:00 em Brasília.
const TERCA_MEIO_DIA = new Date("2026-11-10T15:00:00Z");
const RITMO = { por_segundo: 20, por_dia: 400, margem_tier: 0.6, inicio: "09:00", fim: "19:00", dias: [1, 2, 3, 4, 5, 6], tier_padrao: "TIER_250" };
const MODELO = {
  nome: "volta_viagem", idioma: "pt_BR", categoria: "MARKETING", status: "APPROVED", formato_parametros: "POSITIONAL",
  corpo: "Oi {{1}}! Como foi o {{2}}? Fotos: {{3}}", cabecalho_formato: "IMAGE", cabecalho_texto: null,
  botoes: [{ indice: 0, tipo: "QUICK_REPLY", texto: "Quero viajar de novo", variavel: false }],
};

function envio(id: string, tel: string): Linha {
  return { id, campanha_id: CAMP, status: "pendente", telefone: tel, nome: "Ana Souza", phone_number_id: PH, pego_em: null, tentativas: 0, cliente_id: CLI, viagem_id: "v1", clicou_em: null };
}

beforeEach(() => {
  chamadas = []; etiquetas = []; mensagensRel = []; optout = false;
  settings = { rel_disparo_ritmo: RITMO };
  numeroRel = { phone_number_id: PH, numero: "+55 11 98012-4183", nome_verificado: "Rel", status: "conectado", segredo_id: "s1" };
  numeroSdr = null;
  modelos = [{ ...MODELO, waba_id: "W9" }];
  campanhas = [{
    id: CAMP, setor: "relacionamento", nome: "Volta da viagem", status: "enviando", modelo_nome: "volta_viagem", modelo_idioma: "pt_BR",
    params: { 1: { fonte: "nome" }, 2: { fonte: "destino" }, 3: { fonte: "link", valor: "https://fotos.com/japao" } },
    envio_extra: { midia: { link: "https://cdn/x.jpg" }, respostas: { 0: { rotulo: "Quero viajar de novo", texto: "Oba {{nome}}! Te mando as próximas.", etiqueta: "quer voltar" } } },
    iniciada_em: "2026-11-10T14:00:00Z",
  }];
  envios = [envio(E1, "5511999990001"), envio(E2, "5511999990002")];
  delete process.env.REL_DISPARO_ENVIO;
});

const graphPosts = () => chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/") && c.metodo === "POST");

test("padrão = simulação: a fila anda, NADA vai pra Meta, nenhuma bolha", async () => {
  const r = await rodadaRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  assert.equal(r.modo, "simulacao");
  assert.equal(chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/")).length, 0);
  assert.ok(envios.every((e) => e.status === "enviado" && e.simulado === true));
  assert.equal(mensagensRel.length, 0);
  assert.equal(campanhas[0].status, "concluida");
});

test("simulação desligada sem a env: PARA (nem simula, nem manda)", async () => {
  settings.rel_disparo_simulacao = false;
  const r = await rodadaRel({ agora: TERCA_MEIO_DIA });
  assert.match(String(r.parado), /REL_DISPARO_ENVIO/);
  assert.ok(envios.every((e) => e.status === "pendente"));
});

test("fora da janela (domingo): não faz nada", async () => {
  const r = await rodadaRel({ agora: new Date("2026-11-15T15:00:00Z") });
  assert.match(String(r.parado), /janela/);
});

test("tudo ligado: manda pelo número do Rel com imagem, link rastreado e bolha na conversa", async () => {
  process.env.REL_DISPARO_ENVIO = "1";
  settings.rel_disparo_simulacao = false;
  const r = await rodadaRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  assert.equal(r.modo, "real");
  const posts = graphPosts();
  assert.equal(posts.length, 2);
  const corpo = posts[0].corpo as { to: string; biz_opaque_callback_data: string; template: { components: { type: string; parameters: { text?: string }[] }[] } };
  assert.equal(corpo.to, "5511999990001");
  assert.equal(corpo.biz_opaque_callback_data, `rel:${E1}`);
  const body = corpo.template.components.find((c) => c.type === "body")!;
  assert.deepEqual(body.parameters.map((p) => p.text), ["Ana", "Japão", `https://qs.setuforeuvouviagens.com.br/l/${E1}/3`]);
  assert.ok(envios.every((e) => e.status === "enviado" && e.simulado === false && String(e.wamid).startsWith("wamid.")));
  assert.equal(mensagensRel.length, 2); // a bolha de cada envio, origem automática
  assert.equal((mensagensRel[0] as { p_origem?: string }).p_origem ?? "automatica", "automatica");
});

test("quem pediu pra parar é pulado na hora", async () => {
  optout = true;
  await rodadaRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  assert.ok(envios.every((e) => e.status === "pulado" && /não receber/.test(String(e.motivo))));
});

test("a rodada antiga (Comercial) não pega campanha do Rel", async () => {
  await rodada({ agora: TERCA_MEIO_DIA }).catch(() => null);
  assert.ok(envios.every((e) => e.status === "pendente"));
});

test("clique no link: registra uma vez e devolve o destino", async () => {
  envios[0].campanha_id = CAMP;
  assert.equal(await registrarClique(E1, "3"), "https://fotos.com/japao");
  assert.ok(envios[0].clicou_em);
  const primeiro = envios[0].clicou_em;
  await registrarClique(E1, "3");
  assert.equal(envios[0].clicou_em, primeiro);
  assert.equal(await registrarClique(E1, "1"), null); // variável que não é link
  assert.equal(await registrarClique("lixo", "3"), null);
});

test("tocou no botão: marca o clique, põe a etiqueta e responde UMA vez", async () => {
  envios[0].wamid = "wamid.DISP1";
  const m = { id: "wamid.IN1", type: "button", button: { text: "Quero viajar de novo", payload: "Quero viajar de novo" }, context: { id: "wamid.DISP1" } };
  const r = await tratarCliqueDeDisparo({ m, phoneId: PH, telefone: "5511999990001", conversaId: "conv-1" });
  assert.deepEqual(r?.feito, ["etiqueta", "respondeu"]);
  assert.equal(envios[0].botao, "Quero viajar de novo");
  assert.deepEqual(etiquetas.map((e) => [e.cliente_id, e.etiqueta, e.origem]), [[CLI, "quer voltar", "botao"]]);
  const texto = graphPosts().map((p) => p.corpo as { type: string; text?: { body: string } }).find((c) => c.type === "text");
  assert.equal(texto?.text?.body, "Oba Ana! Te mando as próximas.");
  // tocou de novo: não responde outra vez
  chamadas = [];
  const r2 = await tratarCliqueDeDisparo({ m: { ...m, id: "wamid.IN2" }, phoneId: PH, telefone: "5511999990001", conversaId: "conv-1" });
  assert.deepEqual(r2?.feito, ["etiqueta"]);
  assert.equal(graphPosts().length, 0);
});

test("mensagem que não é resposta a disparo: ignora", async () => {
  const r = await tratarCliqueDeDisparo({ m: { id: "x", type: "button", button: { text: "Oi" }, context: { id: "wamid.OUTRO" } }, phoneId: PH, telefone: "5511999990001", conversaId: "c" });
  assert.equal(r, null);
});
test("0411: disparo pelo número do SDR — sai por ele, só template da conta dele, sem bolha no Rel", async () => {
  process.env.REL_DISPARO_ENVIO = "1";
  settings.rel_disparo_simulacao = false;
  numeroSdr = { phone_number_id: PH_SDR, numero: "+55 11 94394-8398", rotulo: "Hugo", setor: "comercial", status: "conectado", segredo_id: "s2", waba_id: "W_SDR" };
  campanhas[0].phone_number_id = PH_SDR;
  // O modelo só existe na WABA do Rel: pelo SDR não acha → pausa, nada sai.
  let r = await rodadaRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  assert.equal(graphPosts().length, 0);
  assert.equal(campanhas[0].status, "pausada");
  assert.match(String(campanhas[0].ultimo_erro), /número escolhido/);
  // Aprovado na conta do SDR: sai pelo número dele, sem bolha na conversa do Rel.
  modelos.push({ ...MODELO, waba_id: "W_SDR" });
  campanhas[0].status = "enviando";
  r = await rodadaRel({ agora: TERCA_MEIO_DIA, limiteMs: 5_000 });
  assert.equal(r.modo, "real");
  const posts = graphPosts();
  assert.equal(posts.length, 2);
  assert.ok(posts.every((p) => p.url.includes(`/${PH_SDR}/messages`)));
  assert.equal(mensagensRel.length, 0);
});
