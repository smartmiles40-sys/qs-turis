// Família da venda → cards filhos no Bitrix (0351, api/_closerBitrixFamilia.js).
// Puras sem rede + a execução inteira com um fetch de mentira (bx e rest de verdade).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as F from "../../api/_closerBitrixFamilia.js";
import { planejarEspelho } from "../../api/_closerBitrixPlano.js";
import { bx } from "../../api/_bitrixLead.js";
import { rest } from "../../api/_supabaseAdmin.js";

const FUNIS = JSON.parse(readFileSync(new URL("./funis-03-11.json", import.meta.url), "utf8"));
const C1 = FUNIS["0"];
const PARA = { funil: "0", coluna: "UC_70BW8E" }; // Em Emissão (venda)

const PAI = {
  ID: "9001", TITLE: "Carlos Silva", CATEGORY_ID: "0", STAGE_ID: "UC_70BW8E", OPPORTUNITY: "30000", TYPE_ID: "SALE",
  ASSIGNED_BY_ID: "77", SOURCE_ID: "UC_LIVE", SOURCE_DESCRIPTION: "ad 123", UTM_SOURCE: "instagram", UTM_CAMPAIGN: "japao",
  UF_CRM_1743296167520: "123",
};
const pessoa = (o: Record<string, unknown> = {}) => ({
  id: "p-" + Math.random().toString(36).slice(2), comprador: false, vinculo: "filho", valor: 10000, menor: false,
  removida_em: null, bitrix_deal_id: null, bitrix_contato_id: null, bitrix_status: "pendente", responsavel_nome: null,
  cliente: { id: "c-" + Math.random().toString(36).slice(2), nome: "Maria Souza Silva", telefone: "5511988887777", email: "maria@x.com", cpf: "123.456.789-09", nascimento: "2012-05-04", bitrix_contato_id: null },
  ...o,
});
const titular = () => pessoa({ comprador: true, vinculo: null, valor: 10000, cliente: { id: "c-tit", nome: "Carlos Alberto da Silva", telefone: null, email: null, cpf: null, nascimento: null } });

test("título do card filho: Família <sobrenome> — <primeiro nome> (<vínculo>)", () => {
  assert.equal(F.sobrenome("Carlos Alberto da Silva"), "Silva");
  assert.equal(F.sobrenome("João Pereira Filho"), "Pereira");
  assert.equal(F.sobrenome("Ana"), "Ana");
  assert.equal(F.tituloFilho("Carlos Alberto da Silva", { nome: "Maria Souza Silva", vinculo: "filho" }), "Família Silva — Maria (filho(a))");
  assert.equal(F.tituloFilho("Carlos Silva", { nome: "Bia", vinculo: null }), "Família Silva — Bia (acompanhante)");
});

test("valor do pai = total − filhos ativos (quem saiu não conta); sem filho com valor → null", () => {
  const ps = [titular(), pessoa({ valor: 9000 }), pessoa({ valor: 8000.5 }), pessoa({ valor: 5000, removida_em: "2026-11-09" })];
  assert.equal(F.somaDosFilhos(ps), 17000.5);
  assert.equal(F.valorDoPai(30000, ps), 12999.5);
  assert.equal(F.valorDoPai(30000, [titular(), pessoa({ valor: null })]), null);
  assert.equal(F.valorDoPai(1000, [titular(), pessoa({ valor: 5000 })]), 0); // nunca negativo
});

test("planejarEspelho: com família, o pai leva só o titular (Dashboard não conta em dobro)", () => {
  const n = { etapa: "aguardando_emissao", consolidada_em: "2026-11-09", ficha: { valor_total: 30000 }, valor_previsto: 30000 };
  const p = planejarEspelho({ n, deal: { ...PAI, OPPORTUNITY: "30000" }, lista: C1, valorFilhos: 20000 });
  assert.equal(p.ok, true);
  assert.equal(p.valor, 10000);
  assert.equal(p.fields.OPPORTUNITY, 10000);
  assert.equal(p.valorVenda, 30000);
  // Sem família: igual a antes.
  const s = planejarEspelho({ n, deal: { ...PAI, OPPORTUNITY: "30000" }, lista: C1 });
  assert.equal(s.fields.OPPORTUNITY, undefined);
  // Titular sem valor próprio: o pai vai a 0 (e manda o 0).
  const z = planejarEspelho({ n, deal: { ...PAI, OPPORTUNITY: "30000" }, lista: C1, valorFilhos: 30000 });
  assert.equal(z.fields.OPPORTUNITY, 0);
});

test("montarDealFilho: mesma coluna do pai, ID pai, valor da pessoa, origem herdada, CPF/nasc", () => {
  const p = pessoa({ menor: true, responsavel_nome: "Carlos Alberto da Silva" });
  const f = F.montarDealFilho({ pessoa: p, titularNome: "Carlos Alberto da Silva", dealPai: PAI, para: PARA, contatoId: "555" });
  assert.equal(f.CATEGORY_ID, 0);
  assert.equal(f.STAGE_ID, "UC_70BW8E");
  assert.equal(f[F.CAMPO_ID_PAI], "9001");
  assert.equal(f.OPPORTUNITY, 10000);
  assert.equal(f.CONTACT_ID, "555");
  assert.equal(f.ASSIGNED_BY_ID, "77");
  assert.equal(f.SOURCE_ID, "UC_LIVE");
  assert.equal(f.UTM_CAMPAIGN, "japao");
  assert.equal(f.UF_CRM_1743296167520, "123");
  assert.equal(f[F.CAMPO_DEAL_CPF], "12345678909");
  assert.equal(f[F.CAMPO_DEAL_NASC], "2012-05-04");
  assert.match(f.COMMENTS, /MENOR DE IDADE/);
  assert.equal(f.TITLE, "Família Silva — Maria (filho(a))");
});

test("montarContato: telefone, e-mail, nascimento e CPF do contato", () => {
  const c = F.montarContato(pessoa(), "Carlos");
  assert.equal(c.NAME, "Maria Souza Silva");
  assert.equal(c.PHONE[0].VALUE, "5511988887777");
  assert.equal(c.EMAIL[0].VALUE, "maria@x.com");
  assert.equal(c.BIRTHDATE, "2012-05-04");
  assert.equal(c[F.CAMPO_CONTATO_CPF], "12345678909");
  const semNada = F.montarContato(pessoa({ cliente: { nome: "Bebê", telefone: null, email: null, cpf: "123", nascimento: null } }), "Carlos");
  assert.equal(semNada.PHONE, undefined);
  assert.equal(semNada[F.CAMPO_CONTATO_CPF], undefined); // CPF incompleto não vai
});

test("diffDealFilho: só o que mudou; cron não tira da coluna um filho encerrado à mão", () => {
  const des = F.montarDealFilho({ pessoa: pessoa(), titularNome: "Carlos Silva", dealPai: PAI, para: PARA });
  const igual = { ID: "1", TITLE: des.TITLE, OPPORTUNITY: "10000.00", CATEGORY_ID: "0", STAGE_ID: "UC_70BW8E", [F.CAMPO_ID_PAI]: "9001", [F.CAMPO_DEAL_CPF]: "x", [F.CAMPO_DEAL_NASC]: "y" };
  assert.deepEqual(F.diffDealFilho({ atual: igual, desejado: des, lista: C1 }), {});
  const valorMudou = F.diffDealFilho({ atual: { ...igual, OPPORTUNITY: "9000" }, desejado: des, lista: C1 });
  assert.equal(valorMudou.OPPORTUNITY, 10000);
  // Alguém cancelou ESTE membro à mão (Cancelamento/Desistência): o cron não reabre; a pessoa pode.
  const cancelado = { ...igual, STAGE_ID: "UC_NV92A7" };
  assert.equal(F.diffDealFilho({ atual: cancelado, desejado: des, lista: C1 }).STAGE_ID, undefined);
  assert.equal(F.diffDealFilho({ atual: cancelado, desejado: des, lista: C1, porPessoa: true }).STAGE_ID, "UC_70BW8E");
  // Filho atrasado numa coluna aberta acompanha o pai.
  assert.equal(F.diffDealFilho({ atual: { ...igual, STAGE_ID: "UC_YGG9JY" }, desejado: des, lista: C1 }).STAGE_ID, "UC_70BW8E");
  // Filho em outro funil: não mexe na coluna.
  assert.equal(F.diffDealFilho({ atual: { ...igual, CATEGORY_ID: "3", STAGE_ID: "C3:NEW" }, desejado: des, lista: C1 }).STAGE_ID, undefined);
});

test("planejarFamilia: cria, reconhece pelo título (idempotente), avisa quem saiu, ignora o titular", () => {
  const maria = pessoa();
  const joao = pessoa({ vinculo: "conjuge", cliente: { nome: "João Lima", telefone: null, email: null, cpf: null, nascimento: null } });
  const saiu = pessoa({ removida_em: "2026-11-09T10:00:00Z", bitrix_deal_id: "8000", bitrix_status: "removida" });
  const saiuSemCard = pessoa({ removida_em: "2026-11-09T10:00:00Z" });
  const existentes = [{ ID: "8100", TITLE: "Família Silva — João (cônjuge)", CATEGORY_ID: "0", STAGE_ID: "UC_70BW8E", OPPORTUNITY: "10000", [F.CAMPO_ID_PAI]: "9001" }];
  const a = F.planejarFamilia({ pessoas: [titular(), maria, joao, saiu, saiuSemCard], titularNome: "Carlos Silva", dealPai: PAI, para: PARA, lista: C1, existentes });
  assert.deepEqual(a.map((x) => x.tipo), ["criar", "igual", "avisar_removida", "nada"]);
  assert.equal(a[1].dealId, "8100");
  assert.equal(a[2].dealId, "8000");
});

// ── Execução com fetch de mentira ──────────────────────────────────────────
function fetchDeMentira() {
  const chamadas: { url: string; body: any; method: string }[] = [];
  let proxDeal = 7000;
  const deals = new Map<string, any>();
  const fn = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, body, method: init.method || "GET" });
    const ok = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 });
    if (url.startsWith("https://bx.test/")) {
      const metodo = url.slice("https://bx.test/".length).replace(/\.json$/, "");
      if (metodo === "crm.deal.list") return ok([...deals.values()].filter((d) => d[F.CAMPO_ID_PAI] === body.filter[F.CAMPO_ID_PAI]));
      if (metodo === "crm.deal.get") return ok(deals.get(String(body.id)) ?? null);
      if (metodo === "crm.duplicate.findbycomm") return ok({});
      if (metodo === "crm.contact.add") return ok(500 + chamadas.filter((c) => c.url.endsWith("crm.contact.add.json")).length);
      if (metodo === "crm.deal.add") { const id = String(proxDeal++); deals.set(id, { ID: id, ...body.fields, CATEGORY_ID: String(body.fields.CATEGORY_ID) }); return ok(Number(id)); }
      if (metodo === "crm.deal.update") { const d = deals.get(String(body.id)); Object.assign(d, body.fields); return ok(true); }
      if (metodo === "crm.timeline.comment.add") return ok(1);
      return new Response(JSON.stringify({ error: "METHOD", error_description: metodo }), { status: 400 });
    }
    if (url.startsWith("https://sb.test/rest/v1/")) return new Response("", { status: 204 });
    throw new Error("rede de verdade não: " + url);
  };
  return { fn, chamadas, deals };
}

test("espelharFamilia: cria os filhos uma vez só, grava o id, avisa no pai; rodar de novo não duplica", async () => {
  const orig = globalThis.fetch;
  process.env.BITRIX_WEBHOOK_BASE = "https://bx.test";
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
  const fake = fetchDeMentira();
  globalThis.fetch = fake.fn as typeof fetch;
  try {
    const maria = pessoa({ menor: true, responsavel_nome: "Carlos Silva" });
    const joao = pessoa({ vinculo: "conjuge", valor: 12000, cliente: { id: "c-joao", nome: "João Lima", telefone: null, email: null, cpf: null, nascimento: null } });
    const familia = { venda: { id: "v1", valor_total: 32000 }, pessoas: [titular(), maria, joao] };
    const r1 = await F.espelharFamilia({ familia, titularNome: "Carlos Silva", dealPai: PAI, para: PARA, lista: C1 }, { bx, rest });
    assert.equal(r1.criados.length, 2);
    assert.equal(r1.erros.length, 0);
    const adds = fake.chamadas.filter((c) => c.url.endsWith("crm.deal.add.json"));
    assert.equal(adds.length, 2);
    assert.equal(adds[0].body.fields[F.CAMPO_ID_PAI], "9001");
    assert.equal(adds[0].body.fields.STAGE_ID, "UC_70BW8E");
    assert.deepEqual(adds.map((a) => a.body.fields.OPPORTUNITY).sort(), [10000, 12000]);
    // id gravado em qs_venda_pessoas e contato na ficha
    const patches = fake.chamadas.filter((c) => c.url.includes("/rest/v1/qs_venda_pessoas?id=eq.") && c.method === "PATCH");
    assert.equal(patches.length, 2);
    assert.ok(patches.every((p) => p.body.bitrix_status === "ok" && /^\d+$/.test(p.body.bitrix_deal_id)));
    assert.ok(fake.chamadas.some((c) => c.url.includes("/rest/v1/rel_clientes?id=eq.") && c.body?.bitrix_contato_id));
    // recado no pai
    assert.ok(fake.chamadas.some((c) => c.url.endsWith("crm.timeline.comment.add.json") && c.body.fields.ENTITY_ID === 9001 && /Família no QS: 3 pessoas/.test(c.body.fields.COMMENT)));

    // 2ª rodada SEM o id gravado (o QS "perdeu"): acha pelo ID pai + título e não cria de novo.
    fake.chamadas.length = 0;
    const r2 = await F.espelharFamilia({ familia, titularNome: "Carlos Silva", dealPai: PAI, para: PARA, lista: C1 }, { bx, rest });
    assert.equal(r2.criados.length, 0);
    assert.equal(r2.iguais, 2);
    assert.equal(fake.chamadas.filter((c) => c.url.endsWith("crm.deal.add.json")).length, 0);

    // O João saiu da venda: não apaga o card; avisa no filho e no pai.
    fake.chamadas.length = 0;
    const idJoao = [...fake.deals.values()].find((d) => /João/.test(d.TITLE)).ID;
    const saiu = { ...joao, removida_em: "2026-11-09T12:00:00Z", bitrix_deal_id: idJoao, bitrix_status: "removida" };
    const r3 = await F.espelharFamilia({ familia: { ...familia, pessoas: [titular(), maria, saiu] }, titularNome: "Carlos Silva", dealPai: PAI, para: PARA, lista: C1 }, { bx, rest });
    assert.equal(r3.avisados, 1);
    assert.ok(!fake.chamadas.some((c) => /crm\.deal\.delete/.test(c.url)));
    const avisos = fake.chamadas.filter((c) => c.url.endsWith("crm.timeline.comment.add.json"));
    assert.deepEqual(avisos.map((c) => c.body.fields.ENTITY_ID).sort(), [9001, Number(idJoao)].sort());
    assert.ok(fake.chamadas.some((c) => c.body?.bitrix_status === "removida_avisada"));
    assert.match(F.resumoDaFamilia(r1), /2 card\(s\) filho\(s\) criado\(s\)/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("espelharFamilia: erro numa pessoa fica na linha dela e não derruba as outras", async () => {
  const chamadas: string[] = [];
  const bxFalso = async (m: string, p: any) => {
    chamadas.push(m);
    if (m === "crm.deal.list") return [];
    if (m === "crm.contact.add") return 1;
    if (m === "crm.deal.add") { if (/Maria/.test(p.fields.TITLE)) throw new Error("CPF inválido"); return 42; }
    return true;
  };
  const marcas: any[] = [];
  const restFalso = async (path: string, o: any) => { if (path.startsWith("qs_venda_pessoas")) marcas.push(o.body); return null; };
  const r = await F.espelharFamilia({
    familia: { pessoas: [titular(), pessoa(), pessoa({ cliente: { nome: "Pedro Silva", telefone: null, email: null, cpf: null, nascimento: null } })] },
    titularNome: "Carlos Silva", dealPai: PAI, para: PARA, lista: C1,
  }, { bx: bxFalso as any, rest: restFalso as any });
  assert.equal(r.criados.length, 1);
  assert.equal(r.erros.length, 1);
  assert.deepEqual(marcas.map((m) => m.bitrix_status).sort(), ["erro", "ok"]);
});
