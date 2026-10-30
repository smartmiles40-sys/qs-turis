// O DESVIO NO WEBHOOK (api/_metaEntrada.js, 30/10/2026): prova que só o número com
// setor 'marketing' vai pro motor do Marketing e que Comercial e Relacionamento
// seguem exatamente o caminho de antes — nenhum dos dois encosta numa tabela mkt_*,
// e o Marketing não encosta em nenhuma tabela do Comercial/Rel.
//
// Sem banco e sem Meta: o `fetch` global é trocado por um roteador falso que
// anota cada chamada (PostgREST e Graph API).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";

type Chamada = { metodo: string; url: string; corpo: unknown };
let chamadas: Chamada[] = [];
let mensagensMkt = new Set<string>();
let fluxoAtivo: unknown = null;

const NUMEROS: Record<string, unknown> = {
  PH_COM: { phone_number_id: "PH_COM", user_id: null, rotulo: "oficial", cw_inbox_id: 1, setor: "comercial" },
  PH_REL: { phone_number_id: "PH_REL", user_id: null, rotulo: "rel", cw_inbox_id: null, setor: "relacionamento" },
  PH_MKT: { phone_number_id: "PH_MKT", user_id: null, rotulo: "mkt", cw_inbox_id: null, setor: "marketing" },
  PH_SEM: { phone_number_id: "PH_SEM", user_id: null, rotulo: "antigo", cw_inbox_id: 2 }, // sem coluna setor
};

function resposta(status: number, corpo: unknown) {
  return new Response(corpo === undefined ? "" : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

globalThis.fetch = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  const metodo = (init.method || "GET").toUpperCase();
  const corpo = init.body ? JSON.parse(String(init.body)) : null;
  chamadas.push({ metodo, url, corpo });
  const rota = url.replace(/^https:\/\/falso\.supabase\.co\/rest\/v1\//, "");

  // ── Graph API (envio) ──
  if (url.startsWith("https://graph.facebook.com/")) {
    if (url.includes("/message_templates")) return resposta(200, { data: [] });
    return resposta(200, { messages: [{ id: `wamid.SAIDA${chamadas.length}` }] });
  }
  if (rota.startsWith("qs_wa_numeros_meta?select=phone_number_id,user_id")) {
    const id = decodeURIComponent(rota.match(/phone_number_id=eq\.([^&]+)/)?.[1] || "");
    return resposta(200, NUMEROS[id] ? [NUMEROS[id]] : []);
  }
  if (rota.startsWith("qs_wa_numeros_meta?select=waba_id")) return resposta(200, [{ waba_id: "WABA1" }]);
  if (rota.startsWith("rpc/qs_meta_token")) return resposta(200, "TOKEN-FALSO");

  // ── Marketing ──
  if (rota.startsWith("mkt_wa_mensagens") && metodo === "POST") {
    const w = (corpo as { wamid?: string })?.wamid;
    if (w && mensagensMkt.has(w)) return resposta(409, { message: "duplicate key value violates unique constraint" });
    if (w) mensagensMkt.add(w);
    return resposta(201, undefined);
  }
  if (rota.startsWith("mkt_wa_conversas") && metodo === "POST") return resposta(201, [{ id: "conv-1", contato_id: null, ultima_entrada_em: null, ...(corpo as object) }]);
  if (rota.startsWith("mkt_contatos") && metodo === "POST") return resposta(201, [{ id: "ct-1", nome: null, tags: [], campos: {}, optout_whatsapp_em: null }]);
  if (rota.startsWith("mkt_contatos") && metodo === "GET") return resposta(200, [{ id: "ct-1", nome: null, email: null, telefone: "5561996708984", tags: [], campos: {}, optout_whatsapp_em: null }]);
  if (rota.startsWith("mkt_auto_config")) return resposta(200, [{ valor: { ligado: true, pausa_manual_horas: 12 } }]);
  if (rota.startsWith("rpc/mkt_auto_tomar_conversa")) return resposta(200, true);
  if (rota.startsWith("mkt_fluxo_gatilhos")) return resposta(200, fluxoAtivo ? [{ id: "gat-1", fluxo_id: "11111111-2222-3333-4444-555555555555", tipo: "palavra_chave", config: { palavras: ["japao"] }, ativo: true }] : []);
  if (rota.startsWith("mkt_fluxos?")) return resposta(200, fluxoAtivo ? [fluxoAtivo] : []);
  if (rota.startsWith("mkt_fluxo_execucoes") && metodo === "POST") return resposta(201, [{ id: "exec-1", fluxo_id: "11111111-2222-3333-4444-555555555555", passos: 0, teste: false }]);

  // Tudo o mais: lista vazia / ok.
  if (metodo === "GET") return resposta(200, []);
  if (metodo === "PATCH") return resposta(204, undefined);
  return resposta(200, null);
}) as typeof fetch;

const { processarMensagensDaMeta, destinoDoNumero } = await import("../../api/_metaEntrada.js");

const mudanca = (phoneId: string, msg: Record<string, unknown>, field = "messages") => ({
  field,
  value: {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: phoneId, display_phone_number: "5561999990000" },
    contacts: [{ wa_id: "556196708984", profile: { name: "Cliente Teste" } }],
    ...(field === "messages" ? { messages: [msg] } : { message_echoes: [msg] }),
  },
});
// timestamp de AGORA: a janela de 24 h conta da última mensagem da pessoa
const texto = (id: string, body: string) => ({ from: "556196708984", id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } });

const tocouMkt = () => chamadas.filter((c) => /\/rest\/v1\/(mkt_|rpc\/mkt_)/.test(c.url));
const tocouForaDoMkt = () => chamadas.filter((c) => c.url.includes("/rest/v1/") && !/\/rest\/v1\/(mkt_|rpc\/mkt_|qs_wa_numeros_meta|rpc\/qs_meta_token)/.test(c.url));

beforeEach(() => { chamadas = []; fluxoAtivo = null; });

test("destinoDoNumero: só setor 'marketing' desvia; qualquer outro valor segue o caminho antigo", () => {
  assert.equal(destinoDoNumero({ setor: "marketing" }), "marketing");
  for (const n of [{ setor: "comercial" }, { setor: "relacionamento" }, { setor: null }, {}, null, undefined, { setor: "Marketing" }]) {
    assert.equal(destinoDoNumero(n), "antigo");
  }
});

test("COMERCIAL: mensagem no número comercial não encosta em nada do Marketing", async () => {
  await processarMensagensDaMeta([mudanca("PH_COM", texto("wamid.COM1", "Quero saber do Japão"))]);
  assert.equal(tocouMkt().length, 0, JSON.stringify(tocouMkt().map((c) => c.url)));
  // e continua fazendo o trabalho do Comercial (procura o lead pelo telefone)
  assert.ok(chamadas.some((c) => /\/rest\/v1\/qs_/.test(c.url) && !c.url.includes("qs_wa_numeros_meta")), "o Comercial deixou de consultar o banco dele");
});

test("COMERCIAL (número antigo sem coluna setor) também segue igual", async () => {
  await processarMensagensDaMeta([mudanca("PH_SEM", texto("wamid.SEM1", "oi"))]);
  assert.equal(tocouMkt().length, 0);
});

test("RELACIONAMENTO: mensagem no número do Rel não encosta em nada do Marketing", async () => {
  await processarMensagensDaMeta([mudanca("PH_REL", texto("wamid.REL1", "Oi, sobre minha viagem"))]);
  assert.equal(tocouMkt().length, 0);
  assert.ok(chamadas.some((c) => /\/rest\/v1\/(rel_|rpc\/rel_)/.test(c.url)), "o Rel deixou de gravar na caixa dele");
});

test("MARKETING: vai pro motor do Marketing e NÃO encosta em lead, Comercial nem Rel", async () => {
  const r = await processarMensagensDaMeta([mudanca("PH_MKT", texto("wamid.MKT1", "Olá!"))]);
  assert.equal(r.recebidas, 1);
  assert.equal(r.erros, 0);
  assert.ok(chamadas.some((c) => c.metodo === "POST" && c.url.includes("/mkt_wa_mensagens")), "não gravou a mensagem");
  assert.deepEqual(tocouForaDoMkt().map((c) => c.url), []);
});

test("MARKETING: idempotência por wamid — a reentrega da Meta não grava nem responde de novo", async () => {
  fluxoAtivo = null;
  await processarMensagensDaMeta([mudanca("PH_MKT", texto("wamid.DUP1", "japao"))]);
  chamadas = [];
  const r = await processarMensagensDaMeta([mudanca("PH_MKT", texto("wamid.DUP1", "japao"))]);
  assert.equal(r.recebidas, 0);
  assert.equal(chamadas.filter((c) => c.url.includes("mkt_fluxo_gatilhos")).length, 0, "olhou gatilho numa mensagem repetida");
  assert.equal(chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/")).length, 0, "mandou mensagem de novo");
});

test("MARKETING: palavra-chave dispara o fluxo e o botão sai com o endereço da seta (para o wa_id da Meta)", async () => {
  fluxoAtivo = {
    id: "11111111-2222-3333-4444-555555555555", nome: "Japão", status: "ativo",
    grafo: {
      nos: [
        { id: "ini", tipo: "inicio", x: 0, y: 0, dados: {} },
        { id: "msg", tipo: "mensagem", x: 0, y: 0, dados: { blocos: [{ tipo: "texto", texto: "Oi {{primeiro_nome}}! Quer o roteiro?" }], interacao: { tipo: "botoes", botoes: [{ id: "quero", titulo: "Quero" }] } } },
      ],
      ligacoes: [{ id: "l1", de: "ini", saida: "proximo", para: "msg" }],
    },
  };
  await processarMensagensDaMeta([mudanca("PH_MKT", texto(`wamid.KW${Date.now()}`, "Quero ir pro Japão"))]);
  const envio = chamadas.find((c) => c.url.startsWith("https://graph.facebook.com/") && c.url.includes("/PH_MKT/messages") && (c.corpo as { type?: string })?.type === "interactive");
  assert.ok(envio, "não mandou a mensagem do fluxo");
  const corpo = envio!.corpo as { to: string; interactive: { body: { text: string }; action: { buttons: { reply: { id: string } }[] } } };
  assert.equal(corpo.to, "556196708984");
  assert.equal(corpo.interactive.body.text, "Oi Cliente! Quer o roteiro?");
  assert.equal(corpo.interactive.action.buttons[0].reply.id, "f:11111111-2222-3333-4444-555555555555:msg:quero");
  // e ainda assim nada do Comercial/Rel
  assert.deepEqual(tocouForaDoMkt().map((c) => c.url), []);
});

test("MARKETING: 'PARAR' registra a saída no contato do Marketing (não no opt-out do Comercial)", async () => {
  await processarMensagensDaMeta([mudanca("PH_MKT", texto(`wamid.STOP${Date.now()}`, "PARAR"))]);
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes("/mkt_contatos") && (c.corpo as { optout_whatsapp_em?: string })?.optout_whatsapp_em));
  assert.equal(chamadas.filter((c) => c.url.includes("qs_wa_optout")).length, 0);
  assert.equal(chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/")).length, 0, "respondeu quem pediu para sair");
});

test("MARKETING: eco do celular grava e pausa o robô", async () => {
  await processarMensagensDaMeta([mudanca("PH_MKT", { to: "556196708984", id: `wamid.ECO${Date.now()}`, timestamp: "1793280900", type: "text", text: { body: "Oi, aqui é a Ana" } }, "smb_message_echoes")]);
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes("/mkt_wa_conversas") && (c.corpo as { automacao_pausada_ate?: string })?.automacao_pausada_ate));
  assert.deepEqual(tocouForaDoMkt().map((c) => c.url), []);
});

test("lote misto (Comercial + Marketing na mesma entrega): cada um no seu caminho", async () => {
  await processarMensagensDaMeta([mudanca("PH_COM", texto("wamid.MIX1", "oi")), mudanca("PH_MKT", texto(`wamid.MIX2${Date.now()}`, "oi"))]);
  const mkt = chamadas.filter((c) => c.url.includes("/mkt_wa_mensagens"));
  assert.equal(mkt.length, 1);
  assert.ok(!JSON.stringify(mkt[0].corpo).includes("wamid.MIX1"), "a mensagem do Comercial foi parar no Marketing");
});
