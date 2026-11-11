// Sprint final do "Subir venda" (11/11): o espelho do cartão no Bitrix
// (api/_closerEspelho.js) com bx/rest de mentira — nada sai pra rede.
//   • ordem FILHOS → PAI (o pai só desconta os filhos que existem);
//   • erro ao ler a família = erro do cartão, nada enviado;
//   • família já em negociação; toda etapa do pai vale pra todos os filhos;
//   • 'pre-venda' (Reservar vaga) em venda consolidada = ok "já consolidada";
//   • venda reservada conta como venda; cancelada avisa pai+filhos uma vez.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as F from "../../api/_closerBitrixFamilia.js";
import { cartaoComEstadoDaVenda, espelharCartao, MARCA_CANCELADA } from "../../api/_closerEspelho.js";

const FUNIS = JSON.parse(readFileSync(new URL("./funis-03-11.json", import.meta.url), "utf8"));
const C1 = FUNIS["0"];
const NEGOCIACAO = "UC_YGG9JY";
const EMISSAO = "UC_70BW8E";
const CANCELAMENTO = "UC_NV92A7";

const U = { id: "u-closer", name: "Ana Closer", role: "closer" };

type Pessoa = Record<string, any>;
let seq = 0;
const pessoa = (o: Pessoa = {}): Pessoa => {
  const k = ++seq;
  return {
    id: `p-${k}`, comprador: false, vinculo: "filho", valor: 10000, menor: false, removida_em: null,
    bitrix_deal_id: null, bitrix_contato_id: null, bitrix_status: "pendente", responsavel_nome: null,
    cliente: { id: `c-${k}`, nome: `Pessoa${k} Silva`, telefone: null, email: null, cpf: null, nascimento: null, bitrix_contato_id: null },
    ...o,
  };
};
const titular = () => pessoa({ comprador: true, vinculo: null, cliente: { id: "c-tit", nome: "Carlos Silva", telefone: null, email: null, cpf: null, nascimento: null } });

/** Um mundo de mentira: cartão, venda, pessoas, Bitrix. Registra a ORDEM das escritas. */
function mundo(opts: {
  n?: Pessoa; venda?: Pessoa | null; pessoas?: Pessoa[]; pai?: Pessoa; filhosBitrix?: Pessoa[];
  vendaFalha?: boolean; pessoasFalha?: boolean; falhaAoCriar?: RegExp; eventos?: Pessoa[];
} = {}) {
  const n = { id: "neg-1", lead_id: "lead-1", closer_id: U.id, etapa: "em_negociacao", ficha: null, valor_previsto: 30000, consolidada_em: null, pre_venda_em: null, arquivado_em: null, ...opts.n };
  const venda = opts.venda === undefined ? { id: "v1", valor_total: 30000, estado: "negociacao" } : opts.venda;
  const pessoas = opts.pessoas ?? [];
  const deals = new Map<string, any>();
  const pai = { ID: "9001", TITLE: "Carlos Silva", CATEGORY_ID: "0", STAGE_ID: NEGOCIACAO, OPPORTUNITY: "30000", TYPE_ID: "SALE", ...opts.pai };
  deals.set("9001", pai);
  for (const f of opts.filhosBitrix ?? []) deals.set(String(f.ID), { CATEGORY_ID: "0", [F.CAMPO_ID_PAI]: "9001", ...f });
  let prox = 7000;
  const log: string[] = [];          // ordem das escritas no Bitrix
  const comentarios: { deal: number; texto: string }[] = [];
  const marcas: any[] = [];
  const eventos: any[] = [...(opts.eventos ?? [])];
  const pessoaPatches: any[] = [];

  const bx = async (m: string, p: any) => {
    if (m === "crm.deal.get") return deals.get(String(p.id)) ?? null;
    if (m === "crm.deal.list") return [...deals.values()].filter((d) => d.ID !== "9001" && d[F.CAMPO_ID_PAI] === p.filter[F.CAMPO_ID_PAI]);
    if (m === "crm.duplicate.findbycomm") return {};
    if (m === "crm.contact.list") return [];
    if (m === "crm.contact.add") return 500 + prox;
    if (m === "crm.deal.add") {
      if (opts.falhaAoCriar && opts.falhaAoCriar.test(p.fields.TITLE)) throw new Error("Bitrix recusou o card");
      const id = String(prox++);
      deals.set(id, { ID: id, ...p.fields, CATEGORY_ID: String(p.fields.CATEGORY_ID) });
      log.push(`filho.add:${id}:${p.fields.STAGE_ID}`);
      return Number(id);
    }
    if (m === "crm.deal.update") {
      Object.assign(deals.get(String(p.id)), p.fields);
      log.push(`filho.update:${p.id}:${p.fields.STAGE_ID ?? "-"}`);
      return true;
    }
    if (m === "crm.item.update") { Object.assign(deals.get(String(p.id)), { CATEGORY_ID: String(p.fields.categoryId), STAGE_ID: p.fields.stageId }); log.push(`filho.item:${p.id}`); return true; }
    if (m === "crm.timeline.comment.add") { comentarios.push({ deal: p.fields.ENTITY_ID, texto: p.fields.COMMENT }); return 1; }
    throw new Error("método inesperado " + m);
  };
  const rest = async (path: string, o: any = {}) => {
    const metodo = o.method || "GET";
    if (path.startsWith("qs_closer_negocios?select=*")) return [n];
    if (path.startsWith("qs_closer_negocios?id=eq.") && metodo === "PATCH") { marcas.push(o.body); return null; }
    if (path.startsWith("qs_leads?")) return [{ id: "lead-1", bitrix_id: "9001" }];
    if (path.startsWith("qs_vendas?")) { if (opts.vendaFalha) throw new Error("timeout lendo qs_vendas"); return venda ? [venda] : []; }
    if (path.startsWith("qs_venda_pessoas?select")) { if (opts.pessoasFalha) throw new Error("conexão caiu"); return pessoas; }
    if (path.startsWith("qs_venda_pessoas?id=eq.")) {
      pessoaPatches.push(o.body);
      const id = path.match(/id=eq\.([^&]+)/)![1];
      const alvo = pessoas.find((x) => x.id === id);
      if (alvo && o.body.bitrix_deal_id) alvo.bitrix_deal_id = o.body.bitrix_deal_id;
      return null;
    }
    if (path.startsWith("qs_closer_negocio_eventos?select")) {
      const termo = decodeURIComponent(path.match(/texto=like\.([^&]+)/)?.[1] || "").replace(/\*/g, "");
      return eventos.filter((e) => e.texto.includes(termo));
    }
    if (path === "qs_closer_negocio_eventos") { eventos.push(o.body); return null; }
    if (path.startsWith("rel_clientes?") || path.startsWith("fin_planos?")) return [];
    throw new Error("rest inesperado " + path);
  };
  const deps = {
    rest, bx,
    atualizarNegocioComFunil: async (id: string, fields: any) => {
      Object.assign(deals.get(String(id)), fields);
      log.push(`pai:${fields.STAGE_ID ?? "-"}:${fields.OPPORTUNITY ?? "-"}`);
    },
    comentarNoNegocio: async (id: string, texto: string) => { comentarios.push({ deal: Number(id), texto }); return "1"; },
    colunasDoFunil: async (cat: string) => FUNIS[String(cat ?? "0")] || C1,
    podeMexer: () => true,
  };
  return { n, venda, pessoas, deals, log, comentarios, marcas, eventos, pessoaPatches, deps };
}

test("família já em NEGOCIAÇÃO: filhos nascem na coluna do pai e ANTES de o pai ser reduzido", async () => {
  const m = mundo({ pessoas: [titular(), pessoa({ valor: 9000 }), pessoa({ valor: 8000 })] });
  const r = await espelharCartao("neg-1", U, {}, m.deps);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  // os dois filhos primeiro, depois o pai
  assert.deepEqual(m.log.map((l) => l.split(":")[0]), ["filho.add", "filho.add", "pai"]);
  assert.ok(m.log.slice(0, 2).every((l) => l.endsWith(`:${NEGOCIACAO}`)));
  // pai = 30000 − 17000; não muda de coluna (já está em negociação)
  assert.equal(m.deals.get("9001").OPPORTUNITY, 13000);
  assert.equal(m.log[2], "pai:-:13000");
  assert.equal(m.marcas.at(-1).bitrix_status, "ok");
});

test("filho que falha ao nascer NÃO é descontado do pai; cartão fica em erro com o nome", async () => {
  const m = mundo({ pessoas: [titular(), pessoa({ valor: 9000, cliente: { id: "c-a", nome: "Maria Silva" } }), pessoa({ valor: 8000, cliente: { id: "c-b", nome: "João Silva" } })], falhaAoCriar: /João/ });
  const r = await espelharCartao("neg-1", U, {}, m.deps);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.status, "erro");
  assert.match(r.body.mensagem, /João Silva \(Bitrix recusou o card\)/);
  // só a Maria existe → pai = 30000 − 9000 (a soma dos cards nunca passa do total)
  assert.equal(m.deals.get("9001").OPPORTUNITY, 21000);
  assert.equal(m.marcas.at(-1).bitrix_status, "erro");
});

test("filho que JÁ existia conta no desconto mesmo se a atualização dele falhar agora", async () => {
  const joao = pessoa({ valor: 8000, bitrix_deal_id: "8100", cliente: { id: "c-b", nome: "João Silva" } });
  const m = mundo({ pessoas: [titular(), joao], filhosBitrix: [{ ID: "8100", TITLE: "x", STAGE_ID: NEGOCIACAO, OPPORTUNITY: "1" }] });
  const bxOrig = m.deps.bx;
  m.deps.bx = async (mt: string, p: any) => { if (mt === "crm.deal.update" && String(p.id) === "8100") throw new Error("lock"); return bxOrig(mt, p); };
  const r = await espelharCartao("neg-1", U, {}, m.deps);
  assert.equal(r.body.status, "erro");
  assert.equal(m.deals.get("9001").OPPORTUNITY, 22000);
});

test("erro ao carregar a família = status 'erro' com mensagem clara e NADA vai pro Bitrix", async () => {
  for (const falha of [{ vendaFalha: true }, { pessoasFalha: true }]) {
    const m = mundo({ pessoas: [titular(), pessoa()], ...falha });
    const r = await espelharCartao("neg-1", U, {}, m.deps);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.status, "erro");
    assert.match(r.body.mensagem, /Não consegui ler a família desta venda/);
    assert.match(r.body.mensagem, /Nada foi enviado ao Bitrix/);
    assert.deepEqual(m.log, []); // nem pai nem filho
    assert.equal(m.deals.get("9001").OPPORTUNITY, "30000");
    assert.equal(m.marcas.at(-1).bitrix_status, "erro");
    assert.match(m.eventos.at(-1).texto, /família/);
  }
  // modo conferir: também não finge que está ok
  const s = mundo({ pessoasFalha: true });
  const rs = await espelharCartao("neg-1", null, { seco: true }, s.deps);
  assert.equal(rs.body.ok, false);
  assert.match(rs.body.motivo, /família/);
});

test("TODOS JUNTOS: pai vai pra Perdidos → filhos ativos vão pra Perdidos (até pelo cron)", async () => {
  const a = pessoa({ bitrix_deal_id: "8100" });
  const b = pessoa({ bitrix_deal_id: "8101", valor: 5000 });
  const saiu = pessoa({ bitrix_deal_id: "8102", removida_em: "2026-11-10", bitrix_status: "removida_avisada" });
  const m = mundo({
    n: { etapa: "perdido" }, pessoas: [titular(), a, b, saiu],
    filhosBitrix: [
      { ID: "8100", TITLE: "x", STAGE_ID: NEGOCIACAO, OPPORTUNITY: "10000" },
      { ID: "8101", TITLE: "y", STAGE_ID: EMISSAO, OPPORTUNITY: "5000" },     // estava em venda: vai junto
      { ID: "8102", TITLE: "z", STAGE_ID: NEGOCIACAO, OPPORTUNITY: "1" },     // saiu da venda: não mexe
    ],
  });
  const r = await espelharCartao("neg-1", null, {}, m.deps);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(m.deals.get("8100").STAGE_ID, "LOSE");
  assert.equal(m.deals.get("8101").STAGE_ID, "LOSE");
  assert.equal(m.deals.get("8102").STAGE_ID, NEGOCIACAO);
  assert.equal(m.deals.get("9001").STAGE_ID, "LOSE");
  // filhos antes do pai
  assert.ok(m.log.findIndex((l) => l.startsWith("pai")) > m.log.findIndex((l) => l.startsWith("filho")));
});

test("diffDealFilho: venda → aberta acompanha o pai; outro funil só pela pessoa (com CATEGORY_ID)", () => {
  const des = F.montarDealFilho({ pessoa: pessoa(), titularNome: "Carlos Silva", dealPai: { ID: "9001" }, para: { funil: "0", coluna: NEGOCIACAO } });
  const base = { ID: "1", TITLE: des.TITLE, OPPORTUNITY: String(des.OPPORTUNITY), [F.CAMPO_ID_PAI]: "9001" };
  assert.equal(F.diffDealFilho({ atual: { ...base, CATEGORY_ID: "0", STAGE_ID: EMISSAO }, desejado: des, lista: C1 }).STAGE_ID, NEGOCIACAO);
  const outro = { ...base, CATEGORY_ID: "3", STAGE_ID: "C3:NEW" };
  assert.deepEqual(F.diffDealFilho({ atual: outro, desejado: des, lista: C1 }), {});
  assert.deepEqual(F.diffDealFilho({ atual: outro, desejado: des, lista: C1, porPessoa: true }), { CATEGORY_ID: 0, STAGE_ID: NEGOCIACAO });
});

test("'pre-venda' (Reservar vaga) em venda CONSOLIDADA: ok 'já consolidada', sem tocar no Bitrix", async () => {
  for (const o of [{ venda: { id: "v1", valor_total: 30000, estado: "consolidada" } }, { n: { consolidada_em: "2026-11-10" }, venda: { id: "v1", valor_total: 30000 } }]) {
    const m = mundo({ ...o, pessoas: [titular(), pessoa()] });
    const r = await espelharCartao("neg-1", U, { preVenda: true }, m.deps);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.jaConsolidada, true);
    assert.deepEqual(m.log, []);
    assert.deepEqual(m.marcas, []);
  }
});

test("venda RESERVADA conta como venda: pai e filhos em 'Em emissão' com o valor da venda", async () => {
  const m = mundo({ venda: { id: "v1", valor_total: 32000, estado: "reservada", reservada_em: "2026-11-11T10:00:00Z" }, pessoas: [titular(), pessoa({ valor: 12000 })] });
  let recado = "";
  const r = await espelharCartao("neg-1", U, { preVenda: true, comentario: (_n: any, v: number) => (recado = `reservada ${v}`) }, m.deps);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(m.deals.get("9001").STAGE_ID, EMISSAO);
  assert.equal(m.deals.get("9001").OPPORTUNITY, 20000);
  assert.ok(m.log[0].startsWith("filho.add") && m.log[0].endsWith(EMISSAO));
  assert.equal(recado, "reservada 20000");
});

test("venda CANCELADA: sai da coluna de venda, avisa pai e filhos UMA vez (padrão da pessoa que saiu)", async () => {
  const filho = pessoa({ bitrix_deal_id: "8100", cliente: { id: "c-a", nome: "Maria Silva" } });
  const venda = { id: "v1", valor_total: 30000, estado: "cancelada", cancelada_em: "2026-11-11T12:00:00Z", cancelada_motivo: "cliente desistiu" };
  const m = mundo({
    n: { etapa: "em_negociacao", pre_venda_em: "2026-11-10T10:00:00Z", pre_venda_valor: 30000 }, venda, pessoas: [titular(), filho],
    pai: { STAGE_ID: EMISSAO }, filhosBitrix: [{ ID: "8100", TITLE: "x", STAGE_ID: EMISSAO, OPPORTUNITY: "10000" }],
  });
  // pelo cron: pode tirar da coluna de venda porque foi o QS que pôs lá
  const r = await espelharCartao("neg-1", null, {}, m.deps);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(m.deals.get("9001").STAGE_ID, NEGOCIACAO);
  assert.equal(m.deals.get("8100").STAGE_ID, NEGOCIACAO);
  const avisos = m.comentarios.filter((c) => /VENDA CANCELADA/.test(c.texto));
  assert.deepEqual(avisos.map((c) => c.deal).sort(), [8100, 9001]);
  assert.ok(avisos.every((c) => /cliente desistiu/.test(c.texto) && /11\/11\/2026/.test(c.texto)));
  assert.ok(m.eventos.some((e) => e.texto.includes(MARCA_CANCELADA)));
  // 2ª rodada: não repete o aviso
  m.comentarios.length = 0;
  await espelharCartao("neg-1", null, {}, m.deps);
  assert.equal(m.comentarios.filter((c) => /VENDA CANCELADA/.test(c.texto)).length, 0);
});

test("cartaoComEstadoDaVenda: cancelada em etapa de venda vira 'venda_cancelada'; reservada vira pré-venda", () => {
  const n = { etapa: "aguardando_emissao", consolidada_em: null, pre_venda_em: "x" };
  assert.equal(cartaoComEstadoDaVenda(n, { estado: "cancelada" }).etapa, "venda_cancelada");
  assert.equal(cartaoComEstadoDaVenda(n, { estado: "cancelada" }).pre_venda_em, null);
  const r = cartaoComEstadoDaVenda({ etapa: "em_negociacao", pre_venda_em: null }, { estado: "reservada", valor_total: 5000, reservada_em: "2026-11-11" });
  assert.equal(r.pre_venda_em, "2026-11-11");
  assert.equal(r.pre_venda_valor, 5000);
  assert.equal(cartaoComEstadoDaVenda({ etapa: "em_negociacao" }, { estado: "negociacao" }).etapa, "em_negociacao");
});

test("venda CANCELADA com o cartão em etapa de venda: pai e filhos vão pra 'Cancelamento/Desistência'", async () => {
  const filho = pessoa({ bitrix_deal_id: "8100" });
  const m = mundo({
    n: { etapa: "aguardando_emissao" }, venda: { id: "v1", valor_total: 30000, estado: "cancelada" }, pessoas: [titular(), filho],
    pai: { STAGE_ID: EMISSAO }, filhosBitrix: [{ ID: "8100", TITLE: "x", STAGE_ID: EMISSAO, OPPORTUNITY: "10000" }],
  });
  const r = await espelharCartao("neg-1", U, {}, m.deps);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(m.deals.get("9001").STAGE_ID, CANCELAMENTO);
  assert.equal(m.deals.get("8100").STAGE_ID, CANCELAMENTO);
});
