// A tradução do que o Bitrix manda (api/_bitrixEntrada.js + api/bitrix-entrada.js).
// Sem rede. Rodar:
//   node --import ./tests/registrar-ts.mjs --test tests/bitrix-entrada/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://banco.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
// Nenhum teste aqui pode sair pra rede.
globalThis.fetch = (async (url: string) => {
  throw new Error("rede proibida no teste: " + url);
}) as typeof fetch;

/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import * as E from "../../api/_bitrixEntrada.js";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import handler, { autorizado } from "../../api/bitrix-entrada.js";

test("chave ignora maiúscula, acento e pontuação", () => {
  assert.equal(E.chave("Telefone"), "telefone");
  assert.equal(E.chave("TELEFONE"), "telefone");
  assert.equal(E.chave("E-mail"), "email");
  assert.equal(E.chave("Pontuação"), "pontuacao");
  assert.equal(E.chave("data[FIELDS][ID]"), "datafieldsid");
  assert.equal(E.chave("auth[application_token]"), "authapplicationtoken");
});

test("robô do Bitrix: dados na query com maiúscula (o bug do Normalizar)", () => {
  const mapa = E.achatar(
    { Nome: "Maria", Sobrenome: "Silva", Telefone: "(62) 99999-0001", "E-mail": "maria@x.com", Fonte: "[Islândia] - Tráfego", LeadScoring: "Quente", ID: "52123" },
    { "document_id[]": ["crm", "CCrmDocumentDeal", "DEAL_52123"], "auth[application_token]": "tok" },
  );
  const lead = E.leadDoBitrix(mapa);
  assert.deepEqual(lead, {
    full_name: "Maria Silva",
    phone: "(62) 99999-0001",
    email: "maria@x.com",
    segment: "[Islândia] - Tráfego",
    lead_score: "Quente",
    bitrix_id: "52123",
    source: "integracao",
  });
});

test("minúscula e MAIÚSCULA dão o mesmo lead", () => {
  const a = E.leadDoBitrix(E.achatar({ nome: "Ana", telefone: "62999990001", email: "a@b.c", id: "10" }));
  const b = E.leadDoBitrix(E.achatar({ NOME: "Ana", TELEFONE: "62999990001", EMAIL: "a@b.c", Id: "10" }));
  assert.deepEqual(a, b);
  assert.equal(a.phone, "62999990001");
  assert.equal(a.bitrix_id, "10");
});

test("form-urlencoded cru (string) é lido, com document_id[] repetido", () => {
  const corpo = E.lerCorpo(
    "document_id%5B%5D=crm&document_id%5B%5D=CCrmDocumentDeal&document_id%5B%5D=DEAL_777" +
      "&auth%5Bapplication_token%5D=abc&Telefone=5562988887777&Nome=Jo%C3%A3o",
  );
  const mapa = E.achatar(corpo);
  assert.equal(E.idDoNegocio(mapa), "777");
  assert.equal(E.pegar(mapa, "auth[application_token]"), "abc");
  const lead = E.leadDoBitrix(mapa);
  assert.equal(lead.full_name, "João");
  assert.equal(lead.phone, "5562988887777");
  assert.equal(lead.bitrix_id, "777");
});

test("document_id aninhado (objeto) também vira o id do negócio", () => {
  const mapa = E.achatar({ document_id: ["crm", "CCrmDocumentDeal", "DEAL_123"] });
  assert.equal(E.idDoNegocio(mapa), "123");
  // LEAD_ / CONTACT_ não é negócio.
  assert.equal(E.idDoNegocio(E.achatar({ document_id: ["crm", "CCrmDocumentLead", "LEAD_9"] })), null);
});

test("evento de saída: data[FIELDS][ID] achatado ou aninhado", () => {
  const plano = E.achatar({ event: "ONCRMDEALADD", "data[FIELDS][ID]": "4567", "auth[application_token]": "t" });
  const aninhado = E.achatar({ event: "ONCRMDEALADD", data: { FIELDS: { ID: "4567" } }, auth: { application_token: "t" } });
  assert.equal(E.idDoNegocio(plano), "4567");
  assert.equal(E.idDoNegocio(aninhado), "4567");
  assert.equal(E.idDaAtividade(plano), "4567");
  assert.equal(E.idDaAtividade(aninhado), "4567");
  assert.equal(E.pegar(aninhado, "auth[application_token]"), "t");
});

test("a query vence o corpo, e template não substituído não é dado", () => {
  const mapa = E.achatar({ Telefone: "{{Contato: Telefone}}", Nome: "Query" }, { Nome: "Corpo", telefone: "62999990001" });
  assert.equal(E.pegar(mapa, "nome"), "Query");
  assert.equal(E.pegar(mapa, "telefone"), "62999990001");
});

test("ID com prefixo DEAL_ é aceito; lixo não", () => {
  assert.equal(E.idDoNegocio(E.achatar({ ID: "DEAL_88" })), "88");
  assert.equal(E.idDoNegocio(E.achatar({ ID: "abc" })), null);
});

test("JSON comum (qs-inbound-leads) continua funcionando", () => {
  const corpo = E.lerCorpo(JSON.stringify({ nome: "Rui", whatsapp: "11988887777", empresa: "X", cidade: "SP", estado: "SP", segmento: "Live" }));
  const lead = E.leadDoBitrix(E.achatar(corpo));
  assert.equal(lead.full_name, "Rui");
  assert.equal(lead.phone, "11988887777");
  assert.equal(lead.company_name, "X");
  assert.equal(lead.city, "SP");
  assert.equal(lead.segment, "Live");
  assert.equal(lead.bitrix_id, undefined);
});

test("resgate: telefone com 55, Fonte padrão e source resgate", () => {
  const lead = E.leadDoBitrix(E.achatar({ nome: "Bia", telefone: "062 99999-0003" }), { resgate: true });
  assert.equal(lead.phone, "5562999990003");
  assert.equal(lead.segment, "Resgate");
  assert.equal(lead.source, "resgate");
  assert.equal(E.telefoneResgate("+55 11 98888-0005"), "5511988880005");
  assert.equal(E.telefoneResgate("123"), null);
  assert.equal(E.telefoneResgate("62 99999-0001, 62 3333-4444"), "5562999990001");
});

test("sem nenhum identificador", () => {
  assert.equal(E.temIdentificador(E.leadDoBitrix(E.achatar({ Fonte: "X" }))), false);
});

// ── autenticação ────────────────────────────────────────────────────────────

test("autorizado: fail-closed sem env", () => {
  const r = autorizado({}, { secret: "x" }, {});
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test("autorizado: ?secret= ou auth[application_token]", () => {
  const env = { BITRIX_ENTRADA_SECRET: "s3gredo", BITRIX_APP_TOKEN: "app-tok" };
  assert.equal(autorizado({}, { secret: "s3gredo" }, env).ok, true);
  assert.equal(autorizado({}, { secret: "errado" }, env).ok, false);
  assert.equal(autorizado(E.achatar({ auth: { application_token: "app-tok" } }), {}, env).ok, true);
  assert.equal(autorizado(E.achatar({ "auth[application_token]": "outro" }), {}, env).ok, false);
  // Só o token configurado: o secret na URL não vale nada.
  assert.equal(autorizado({}, { secret: "" }, { BITRIX_APP_TOKEN: "app-tok" }).ok, false);
});

// ── a rota, sem rede ────────────────────────────────────────────────────────

function resFalso() {
  const r: any = { statusCode: 0, corpo: null, headers: {} };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.status = (s: number) => { r.statusCode = s; return r; };
  r.json = (j: unknown) => { r.corpo = j; return r; };
  return r;
}

test("rota: sem segredo → 401; evento inválido → 400", async () => {
  process.env.BITRIX_ENTRADA_SECRET = "s3gredo";
  let res = resFalso();
  await handler({ method: "POST", query: { evento: "lead", secret: "nao" }, headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  res = resFalso();
  await handler({ method: "POST", query: { evento: "xyz", secret: "s3gredo" }, headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("rota: lead sem dado nenhum → 400 com as chaves recebidas (sem chamar o QS)", async () => {
  process.env.BITRIX_ENTRADA_SECRET = "s3gredo";
  const res = resFalso();
  await handler({ method: "POST", query: { evento: "lead", secret: "s3gredo", Fonte: "X" }, headers: {}, body: "" }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.corpo.campos_recebidos, ["fonte"]);
});

test("rota: atividade sem id (handshake) → 200 ignorado", async () => {
  process.env.BITRIX_ENTRADA_SECRET = "s3gredo";
  const res = resFalso();
  await handler({ method: "POST", query: { evento: "atividade", secret: "s3gredo" }, headers: {}, body: { event: "ONCRMACTIVITYUPDATE" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.corpo.ignorado, true);
});

// ── atividade concluída ─────────────────────────────────────────────────────

function bxFalso(atv: any, deal: any) {
  const chamadas: string[] = [];
  const bx = async (metodo: string, params: any) => {
    chamadas.push(metodo);
    if (metodo === "crm.activity.get") return atv;
    if (metodo === "crm.deal.get") return deal;
    if (metodo === "crm.deal.update") { assert.equal(params.fields.STAGE_ID, "C25:UC_271QUB"); return true; }
    if (metodo === "crm.timeline.comment.add") return 1;
    throw new Error("método inesperado " + metodo);
  };
  return { bx, chamadas };
}

const atvOk = { ID: "9", OWNER_TYPE_ID: "2", OWNER_ID: "500", COMPLETED: "Y", TYPE_ID: "2", PROVIDER_ID: "VOXIMPLANT_CALL", SUBJECT: "Ligação" };

test("atividade: primeira concluída em Novo Lead move pra Follow-up 1", async () => {
  const { bx, chamadas } = bxFalso(atvOk, { ID: "500", STAGE_ID: "C25:PREPAYMENT_INVOIC" });
  const r = await E.processarAtividade("9", bx);
  assert.equal(r.movido, true);
  assert.deepEqual(chamadas, ["crm.activity.get", "crm.deal.get", "crm.deal.update", "crm.timeline.comment.add"]);
});

test("atividade: negócio que já saiu de Novo Lead não anda", async () => {
  const { bx, chamadas } = bxFalso(atvOk, { ID: "500", STAGE_ID: "C25:UC_271QUB" });
  const r = await E.processarAtividade("9", bx);
  assert.equal(r.movido, false);
  assert.equal(r.motivo, "fora_de_novo_lead");
  assert.ok(!chamadas.includes("crm.deal.update"));
});

test("atividade: canal aberto, não concluída ou de contato não contam", () => {
  assert.equal(E.atividadeConta({ ...atvOk, PROVIDER_ID: "IMOPENLINES_SESSION" }).motivo, "atividade_de_robo");
  assert.equal(E.atividadeConta({ ...atvOk, PROVIDER_ID: "CRM_NOTIFICATION" }).motivo, "atividade_de_robo");
  assert.equal(E.atividadeConta({ ...atvOk, COMPLETED: "N" }).motivo, "nao_concluida");
  assert.equal(E.atividadeConta({ ...atvOk, COMPLETED: "N", STATUS: "2" }).conta, true);
  assert.equal(E.atividadeConta({ ...atvOk, OWNER_TYPE_ID: "3" }).motivo, "nao_e_de_negocio");
});

// ── negócio sem dados (ONCRMDEALADD) ────────────────────────────────────────

test("completarPeloNegocio lê deal + contato como o bitrix-to-qs", async () => {
  const bx = async (m: string) => {
    if (m === "crm.deal.get") return { ID: "4567", TITLE: "Negócio X", CONTACT_ID: "88", OPPORTUNITY: "15000.00", CATEGORY_ID: "25" };
    if (m === "crm.contact.get") return { NAME: "Carla", LAST_NAME: "Dias", PHONE: [{ VALUE: "+5562999990009" }], EMAIL: [{ VALUE: "c@d.e" }] };
    throw new Error(m);
  };
  const r = await E.completarPeloNegocio("4567", bx);
  assert.deepEqual(r.campos, { full_name: "Carla Dias", phone: "+5562999990009", email: "c@d.e", estimated_value: "15000.00" });
  assert.equal(r.deal.CATEGORY_ID, "25");
});

test("completarPeloNegocio sem contato usa o título do negócio", async () => {
  const bx = async (m: string) => (m === "crm.deal.get" ? { ID: "1", TITLE: "Lead do site", CONTACT_ID: "0" } : null);
  const r = await E.completarPeloNegocio("1", bx);
  assert.deepEqual(r.campos, { full_name: "Lead do site" });
});
