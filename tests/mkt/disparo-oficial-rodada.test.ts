// DISPARO OFICIAL DO MARKETING (0341): a rodada, o webhook e o isolamento do
// Comercial — sem banco e sem Meta. O `fetch` global vira um banco de mentira
// (PostgREST) + uma Meta de mentira (Graph API) que anotam cada chamada.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
delete process.env.MKT_DISPARO_ENVIO;
delete process.env.META_PHONE_NUMBER_ID;

type Linha = Record<string, unknown>;
type Chamada = { metodo: string; url: string; corpo: unknown };

const PH = "999000111";
const CAMP = "11111111-1111-4111-8111-111111111111";
let chamadas: Chamada[] = [];
let settings: Record<string, unknown> = {};
let campanhas: Linha[] = [];
let envios: Linha[] = [];
let modelos: Linha[] = [];
let numeroMkt: Linha | null = null;
let respostaMeta: (corpo: unknown) => [number, unknown] = () => [200, { messages: [{ id: "wamid.REAL" }] }];

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
    if (metodo === "GET" && u.pathname.endsWith(`/${PH}`)) return resp(200, { whatsapp_business_manager_messaging_limit: "TIER_2K", quality_rating: "GREEN" });
    if (metodo === "POST" && u.pathname.endsWith(`/${PH}/messages`)) { const [s, j] = respostaMeta(corpo); return resp(s, j); }
    return resp(404, { error: { message: "rota falsa", code: 100 } });
  }

  const u = new URL(url);
  const tabela = u.pathname.replace("/rest/v1/", "");
  const q = u.searchParams;

  if (tabela === "qs_settings") {
    const k = eq(q, "key");
    return resp(200, k in settings ? [{ value: settings[k] }] : []);
  }
  if (tabela === "qs_wa_numeros_meta") {
    if ((q.get("select") || "").startsWith("waba_id")) return resp(200, [{ waba_id: "W1" }]);
    return resp(200, numeroMkt ? [numeroMkt] : []);
  }
  if (tabela === "rpc/qs_meta_token") return resp(200, "tok-falso");
  if (tabela === "rpc/mkt_disparo_contar") return resp(200, 0);
  if (tabela === "rpc/rel_cliente_optout") return resp(200, false);
  if (tabela === "mkt_wa_modelos") {
    const n = eq(q, "nome"); const i = eq(q, "idioma");
    return resp(200, modelos.filter((m) => (!n || m.nome === n) && (!i || m.idioma === i)));
  }
  if (tabela === "mkt_contatos") return resp(200, []);
  if (tabela === "mkt_contato_eventos") return resp(201, undefined);
  if (tabela === "qs_users") return resp(200, []);
  if (tabela === "qs_disparo_campanhas") {
    if (metodo === "GET") {
      let r = campanhas.filter((c) => c.status === eq(q, "status"));
      const setor = q.get("setor") || "";
      if (setor.startsWith("eq.")) r = r.filter((c) => c.setor === setor.slice(3));
      if (setor.startsWith("neq.")) r = r.filter((c) => c.setor !== setor.slice(4));
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
      const r = envios.filter((e) => e.campanha_id === eq(q, "campanha_id") && e.status === eq(q, "status"));
      return resp(200, r.slice(0, Number(q.get("limit") || 1000)));
    }
    if (metodo === "PATCH") {
      const e = envios.find((x) => x.id === eq(q, "id"));
      if (!e || (q.get("status") && e.status !== eq(q, "status"))) return resp(200, []);
      Object.assign(e, corpo);
      return resp(200, [e]);
    }
  }
  return resp(200, []);
}) as typeof fetch;

const { rodadaMkt } = await import("../../api/_mktDisparoOficial.js");
const { processarMarketing } = await import("../../api/_mktEntrada.js");
const { rodada } = await import("../../api/_disparo.js");

// Terça, 10/11/2026, 12:00 em Brasília (dentro da janela).
const TERCA_MEIO_DIA = new Date("2026-11-10T15:00:00Z");
const RITMO_RAPIDO = { por_segundo: 80, por_dia: 1000, margem_tier: 0.8, inicio: "09:00", fim: "20:00", dias: [1, 2, 3, 4, 5, 6], tier_padrao: "TIER_250" };
const MODELO = {
  nome: "vagas_japao", idioma: "pt_BR", categoria: "MARKETING", status: "APPROVED", formato_parametros: "POSITIONAL",
  corpo: "Oi {{1}}! Abriram as vagas.", cabecalho_formato: "IMAGE", cabecalho_texto: null, botoes: [],
};

function envio(id: string, tel: string): Linha {
  return { id, campanha_id: CAMP, status: "pendente", telefone: tel, nome: "Ana Souza", phone_number_id: PH, pego_em: null, tentativas: 0, contato_id: null, lead_id: null, cliente_id: null, viagem_id: null };
}

beforeEach(() => {
  chamadas = [];
  settings = { mkt_disparo_ritmo: RITMO_RAPIDO, disparo_simulacao: true, disparo_modelos: [] };
  numeroMkt = { phone_number_id: PH, numero: "+55 11 4000-0000", rotulo: "Marketing" };
  modelos = [{ ...MODELO }];
  campanhas = [{
    id: CAMP, setor: "marketing", nome: "Japão 2027", status: "enviando", modelo_nome: "vagas_japao", modelo_idioma: "pt_BR",
    params: { "1": { fonte: "nome" } }, envio_extra: { midia: { link: "https://cdn/x.jpg" } }, iniciada_em: "2026-11-10T14:00:00Z",
  }];
  envios = [envio("e1", "5511999990001"), envio("e2", "5511999990002")];
  respostaMeta = () => [200, { messages: [{ id: "wamid.REAL" }] }];
  delete process.env.MKT_DISPARO_ENVIO;
});

const graphPosts = () => chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/") && c.metodo === "POST");
const graphTodas = () => chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/"));

test("simulação (padrão, sem mkt_disparo_simulacao): a fila anda e NADA vai pra Meta", async () => {
  const r = await rodadaMkt({ agora: TERCA_MEIO_DIA, limiteMs: 10_000 });
  assert.equal(r.modo, "simulacao");
  assert.equal(graphTodas().length, 0);
  assert.deepEqual(envios.map((e) => [e.status, e.simulado, String(e.wamid).startsWith("sim:")]), [["enviado", true, true], ["enviado", true, true]]);
  assert.equal(campanhas[0].status, "concluida");
});

test("simulação desligada mas sem a env MKT_DISPARO_ENVIO: PARA tudo (nem simula, nem manda)", async () => {
  settings.mkt_disparo_simulacao = false;
  const r = await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.match(String(r.parado), /MKT_DISPARO_ENVIO/);
  assert.equal(graphTodas().length, 0);
  assert.ok(envios.every((e) => e.status === "pendente" && e.pego_em === null));
});

test("env ligada mas simulação ligada: continua simulação", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  const r = await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.equal(r.modo, "simulacao");
  assert.equal(graphTodas().length, 0);
});

test("env = 'true' (não '1') não liga", async () => {
  process.env.MKT_DISPARO_ENVIO = "true";
  settings.mkt_disparo_simulacao = false;
  const r = await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.match(String(r.parado), /MKT_DISPARO_ENVIO/);
  assert.equal(graphTodas().length, 0);
});

test("sem número do Marketing: trava", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  numeroMkt = null;
  const r = await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.match(String(r.parado), /número/);
  assert.equal(graphPosts().length, 0);
});

test("todas as travas ligadas: manda o template certo pela Cloud API", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  const r = await rodadaMkt({ agora: TERCA_MEIO_DIA, limiteMs: 10_000 });
  assert.equal(r.modo, "real");
  assert.equal(r.tier, "TIER_2K");
  const posts = graphPosts();
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].corpo, {
    messaging_product: "whatsapp", recipient_type: "individual", to: "5511999990001", type: "template",
    biz_opaque_callback_data: "mkt:e1",
    template: {
      name: "vagas_japao", language: { code: "pt_BR" },
      components: [
        { type: "header", parameters: [{ type: "image", image: { link: "https://cdn/x.jpg" } }] },
        { type: "body", parameters: [{ type: "text", text: "Ana" }] },
      ],
    },
  });
  assert.deepEqual(envios.map((e) => [e.status, e.simulado, e.wamid, e.cobranca_categoria]), [
    ["enviado", false, "wamid.REAL", "marketing"], ["enviado", false, "wamid.REAL", "marketing"],
  ]);
});

test("modelo não aprovado: no envio real a campanha pausa e nada sai", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  modelos = [{ ...MODELO, status: "PAUSED" }];
  await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.equal(graphPosts().length, 0);
  assert.equal(campanhas[0].status, "pausada");
  assert.match(String(campanhas[0].ultimo_erro), /APROVADO/);
});

test("130429 (velocidade): o envio volta pra fila e a rodada espera", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  respostaMeta = () => [400, { error: { message: "rate", code: 130429 } }];
  const r = await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.equal(graphPosts().length, 1); // parou no primeiro
  assert.match(String(r.esperando), /130429/);
  assert.deepEqual([envios[0].status, envios[0].pego_em], ["pendente", null]);
  assert.equal(campanhas[0].status, "enviando");
});

test("132015 (modelo pausado pela Meta): a campanha PAUSA com o motivo", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  respostaMeta = () => [400, { error: { message: "paused", code: 132015 } }];
  await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.equal(graphPosts().length, 1);
  assert.equal(campanhas[0].status, "pausada");
  assert.match(String(campanhas[0].ultimo_erro), /132015/);
  assert.equal(envios[0].status, "pendente");
});

test("131026 (não entregável): erro só daquele, o resto segue", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  let n = 0;
  respostaMeta = () => (++n === 1 ? [400, { error: { message: "undeliverable", code: 131026 } }] : [200, { messages: [{ id: "wamid.2" }] }]);
  await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.deepEqual(envios.map((e) => [e.status, e.erro_codigo ?? null]), [["erro", 131026], ["enviado", null]]);
});

test("envio real interrompido no meio NÃO é reenviado (sem mensagem duplicada)", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  envios[0].pego_em = "2026-11-10T14:00:00Z"; // pego há mais de 5 min e não terminou
  envios = [envios[0]];
  await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.equal(graphPosts().length, 0);
  assert.equal(envios[0].status, "erro");
  assert.match(String(envios[0].motivo), /interrompido/);
});

test("telefone inválido é pulado sem chamar a Meta", async () => {
  process.env.MKT_DISPARO_ENVIO = "1";
  settings.mkt_disparo_simulacao = false;
  envios = [envio("e9", "123")];
  await rodadaMkt({ agora: TERCA_MEIO_DIA });
  assert.equal(graphPosts().length, 0);
  assert.equal(envios[0].status, "pulado");
});

test("fora da janela: nada", async () => {
  const r = await rodadaMkt({ agora: new Date("2026-11-08T15:00:00Z") }); // domingo
  assert.match(String(r.parado), /janela/);
  assert.equal(envios[0].status, "pendente");
});

test("webhook: 131048 marca o erro com código e PAUSA a campanha; pricing é gravado", async () => {
  envios = [{ ...envio("e1", "5511999990001"), status: "enviado", wamid: "wamid.A", contato_id: null }];
  await processarMarketing({ field: "messages", value: { statuses: [
    { id: "wamid.A", status: "sent", pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" } },
  ] } });
  assert.deepEqual([envios[0].status, envios[0].cobravel, envios[0].cobranca_categoria], ["enviado", true, "marketing"]);
  await processarMarketing({ field: "messages", value: { statuses: [
    { id: "wamid.A", status: "failed", errors: [{ code: 131048, title: "Spam rate limit hit" }] },
  ] } });
  assert.equal(envios[0].status, "erro");
  assert.equal(envios[0].erro_codigo, 131048);
  assert.equal(campanhas[0].status, "pausada");
});

test("webhook: delivered/read andam o funil", async () => {
  envios = [{ ...envio("e1", "5511999990001"), status: "enviado", wamid: "wamid.B" }];
  await processarMarketing({ field: "messages", value: { statuses: [{ id: "wamid.B", status: "delivered" }] } });
  assert.equal(envios[0].status, "entregue");
  await processarMarketing({ field: "messages", value: { statuses: [{ id: "wamid.B", status: "read" }] } });
  assert.equal(envios[0].status, "lido");
});

// ── O Comercial não muda ────────────────────────────────────────────────────

test("Comercial: a rodada compartilhada não pega campanha do Marketing e continua igual", async () => {
  settings.disparo_ritmo = { por_hora: 30, por_dia: 150, inicio: "00:00", fim: "23:59", dias: [0, 1, 2, 3, 4, 5, 6], intervalo_dias: 7 };
  const r = await rodada();
  const get = chamadas.find((c) => c.metodo === "GET" && c.url.includes("/rest/v1/qs_disparo_campanhas"));
  assert.ok(get, "consultou as campanhas");
  assert.match(get!.url, /status=eq\.enviando/);
  assert.match(get!.url, /setor=neq\.marketing/);
  assert.deepEqual(r, { ok: true, simulacao: true, campanhas: [] }); // a do Marketing ficou de fora
  assert.equal(envios[0].status, "pendente");
  assert.equal(graphTodas().length, 0);
});

test("Comercial: simulação desligada sem envio plugado continua parando como antes", async () => {
  settings.disparo_simulacao = false;
  const r = await rodada();
  assert.deepEqual(r, { parado: "simulação desligada, mas o envio real ainda não está plugado — nada enviado" });
});
