// Sync Bitrix → passageiros (05/11/2026): casamento negócio ↔ passageiro e as
// regras portadas do antigo (b1c8258 avulso anexado, 513705e sem nome, etapa por
// expedição). Só funções puras de api/_expBitrixSync.js — nada vai à rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  colunaDaExpedicao, contatoParaPassageiro, decidirCasamento, acharNaLista, patchVazios,
  colunaEhDividida, autoGravando, pendentesDaRodada, rotuloColuna,
  // @ts-expect-error — módulo JS das funções da Vercel, sem tipos
} from "../../api/_expBitrixSync.js";

const EXP = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";

const contato = (extra: Record<string, unknown> = {}) => ({
  ID: "900", NAME: "Maria", LAST_NAME: "da Silva", BIRTHDATE: "1990-05-04T03:00:00+03:00",
  UF_CRM_1752691408782: "123.456.789-09", PHONE: [{ VALUE: "+55 11 99999-0000" }], EMAIL: [{ VALUE: "maria@ex.com" }],
  ...extra,
});
const dados = (extra: Record<string, unknown> = {}) => contatoParaPassageiro(contato(extra), "5001").d;

// ── Coluna da expedição ────────────────────────────────────────────────────

test("etapa própria (bitrix_stage_id) vence a coluna antiga", () => {
  const c = colunaDaExpedicao({ bitrix_stage_id: "c29:uc_f6m93i", bitrix_pipeline_id: "C15" });
  assert.deepEqual(c, { filtro: { STAGE_ID: "C29:UC_F6M93I" }, origem: "etapa" });
  assert.equal(rotuloColuna(c.filtro), "C29:UC_F6M93I");
});

test("sem etapa: usa bitrix_pipeline_id (etapa ou funil); nada = null", () => {
  assert.deepEqual(colunaDaExpedicao({ bitrix_pipeline_id: "C12:UC_ABC" }), { filtro: { STAGE_ID: "C12:UC_ABC" }, origem: "coluna" });
  assert.deepEqual(colunaDaExpedicao({ bitrix_pipeline_id: "12" }), { filtro: { CATEGORY_ID: 12 }, origem: "funil" });
  assert.equal(colunaDaExpedicao({ bitrix_stage_id: "  ", bitrix_pipeline_id: null }), null);
  assert.equal(colunaDaExpedicao({ bitrix_stage_id: "lixo com espaço" }), null);
});

// ── Contato → passageiro (fix 513705e) ─────────────────────────────────────

test("contato completo vira passageiro normalizado", () => {
  const d = dados();
  assert.equal(d.nome_completo, "Maria da Silva");
  assert.equal(d.cpf, "12345678909");
  assert.equal(d.data_nascimento, "1990-05-04");
  assert.equal(d.email, "maria@ex.com");
  assert.equal(d.telefone, "+55 11 99999-0000");
  assert.equal(d.bitrix_deal_id, "5001");
  assert.equal(d.bitrix_contact_id, "900");
});

test("sem nome E sem CPF: pula (não cria 'Sem nome')", () => {
  assert.ok(contatoParaPassageiro({ ID: "1" }, "7").pular);
  assert.ok(contatoParaPassageiro(undefined, "7").pular);
  assert.ok(contatoParaPassageiro({ ID: "1", NAME: "  ", UF_CRM_1752691408782: "" }, "7").pular);
});

test("sem nome mas com CPF: cria com rótulo reconhecível", () => {
  const r = contatoParaPassageiro({ ID: "1", UF_CRM_1749757426655: 1234567890 }, "7");
  assert.equal(r.pular, undefined);
  assert.equal(r.d.cpf, "01234567890");
  assert.match(r.d.nome_completo, /^Sem nome \(CPF 01234567890\)$/);
});

test("e-mail inválido não entra", () => {
  assert.equal(dados({ EMAIL: [{ VALUE: "nao-e-email" }] }).email, null);
});

// ── Casamento ──────────────────────────────────────────────────────────────

test("deal já é passageiro desta expedição: só preenche o vazio, não marca venda nova", () => {
  const ex = { id: "p1", expedicao_id: EXP, pendente_aprovacao: false, nome_completo: "Maria S.", cpf: null, telefone: "11 0000", bitrix_deal_id: "5001" };
  const r = decidirCasamento(dados(), { expedicaoId: EXP, porDeal: ex, lista: [ex] });
  assert.equal(r.acao, "atualizar");
  assert.equal(r.alvo, ex);
  assert.equal(r.patch.cpf, "12345678909");
  assert.equal(r.patch.nome_completo, undefined, "nome curado pelo time não é sobrescrito");
  assert.equal(r.patch.telefone, undefined);
  assert.equal(r.patch.nova_venda, undefined);
});

test("b1c8258: deal casa com linha AVULSA → anexa nesta expedição e entra na fila", () => {
  const avulso = { id: "p9", expedicao_id: null, pendente_aprovacao: false, nome_completo: "Maria da Silva", cpf: "12345678909", bitrix_deal_id: "5001" };
  const r = decidirCasamento(dados(), { expedicaoId: EXP, porDeal: avulso, lista: [] });
  assert.equal(r.acao, "anexar");
  assert.equal(r.patch.expedicao_id, EXP);
  assert.equal(r.patch.nova_venda, true);
});

test("avulso PENDENTE de aprovação não é anexado (só preenche)", () => {
  const pend = { id: "p9", expedicao_id: null, pendente_aprovacao: true, bitrix_deal_id: "5001" };
  const r = decidirCasamento(dados(), { expedicaoId: EXP, porDeal: pend });
  assert.equal(r.acao, "atualizar");
  assert.equal(r.patch.expedicao_id, undefined);
});

test("deal é passageiro de OUTRA expedição: não muda de expedição", () => {
  const ex = { id: "p2", expedicao_id: OUTRA, pendente_aprovacao: false, bitrix_deal_id: "5001" };
  const r = decidirCasamento(dados(), { expedicaoId: EXP, porDeal: ex });
  assert.equal(r.acao, "atualizar");
  assert.equal(r.outraExpedicao, OUTRA);
  assert.equal(r.patch.expedicao_id, undefined);
});

test("sem deal: casa na expedição por CPF, depois contato, depois nome+nascimento", () => {
  const porCpf = { id: "a", cpf: "123.456.789-09" };
  const porContato = { id: "b", bitrix_contact_id: " 900 " };
  const porNome = { id: "c", nome_completo: "MARIA  DA SÍLVA", data_nascimento: "1990-05-04" };
  const d = dados();
  assert.equal(acharNaLista(d, [porNome, porContato, porCpf]).id, "a");
  assert.equal(acharNaLista({ ...d, cpf: null }, [porNome, porContato]).id, "b");
  assert.equal(acharNaLista({ ...d, cpf: null, bitrix_contact_id: null }, [porNome]).id, "c");
  assert.equal(acharNaLista({ ...d, cpf: null, bitrix_contact_id: null, data_nascimento: null }, [porNome]), null, "só nome não basta");
  const r = decidirCasamento(d, { expedicaoId: EXP, lista: [porCpf] });
  assert.equal(r.acao, "atualizar");
  assert.equal(r.patch.bitrix_deal_id, "5001", "vincula o negócio na linha que já existia");
});

test("nada casou → cria Confirmado com nova_venda", () => {
  const r = decidirCasamento(dados(), { expedicaoId: EXP, lista: [{ id: "x", cpf: "99999999999" }] });
  assert.equal(r.acao, "criar");
  assert.equal(r.registro.expedicao_id, EXP);
  assert.equal(r.registro.status_reserva, "Confirmado");
  assert.equal(r.registro.nova_venda, true);
  assert.equal(r.registro.bitrix_deal_id, "5001");
});

test("sem a coluna nova_venda (0317 não aplicada): cria/anexa sem o campo", () => {
  const c = decidirCasamento(dados(), { expedicaoId: EXP, temNovaVenda: false });
  assert.equal("nova_venda" in c.registro, false);
  const a = decidirCasamento(dados(), { expedicaoId: EXP, temNovaVenda: false, porDeal: { id: "p", expedicao_id: null, pendente_aprovacao: false } });
  assert.equal(a.acao, "anexar");
  assert.equal("nova_venda" in a.patch, false);
});

test("coluna dividida: novo e avulso viram 'sem_grupo'; quem já é passageiro segue normal", () => {
  assert.equal(decidirCasamento(dados(), { expedicaoId: EXP, colunaDividida: true }).acao, "sem_grupo");
  assert.equal(decidirCasamento(dados(), { expedicaoId: EXP, colunaDividida: true, porDeal: { id: "p", expedicao_id: null, pendente_aprovacao: false } }).acao, "sem_grupo");
  assert.equal(decidirCasamento(dados(), { expedicaoId: EXP, colunaDividida: true, porDeal: { id: "p", expedicao_id: EXP } }).acao, "atualizar");
});

test("coluna dividida: pela etapa própria só se outra expedição usa a mesma etapa", () => {
  const porDeal = new Map([["1", { expedicao_id: OUTRA }]]);
  assert.equal(colunaEhDividida({ origem: "etapa", expedicaoId: EXP, porDeal, outrasComMesmaEtapa: 0 }), false);
  assert.equal(colunaEhDividida({ origem: "etapa", expedicaoId: EXP, porDeal, outrasComMesmaEtapa: 1 }), true);
  assert.equal(colunaEhDividida({ origem: "maioria", expedicaoId: EXP, porDeal }), true);
  assert.equal(colunaEhDividida({ origem: "funil", expedicaoId: EXP, porDeal: new Map([["1", { expedicao_id: EXP }], ["2", { expedicao_id: null }]]) }), false);
});

test("patchVazios ignora o que veio vazio e o que já está preenchido", () => {
  assert.deepEqual(patchVazios({ cpf: "1", email: "", telefone: "2" }, { cpf: null, email: null, telefone: "3" }), { cpf: "1" });
});

// ── Automática ─────────────────────────────────────────────────────────────

test("automática só grava com EXP_BITRIX_AUTO_LIGADO=1", () => {
  assert.equal(autoGravando({}), false);
  assert.equal(autoGravando({ EXP_BITRIX_AUTO_LIGADO: "0" }), false);
  assert.equal(autoGravando({ EXP_BITRIX_AUTO_LIGADO: "true" }), false);
  assert.equal(autoGravando({ EXP_BITRIX_AUTO_LIGADO: " 1 " }), true);
});

test("retomada: pula as expedições já feitas no dia, mantendo a ordem", () => {
  const exps = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(pendentesDaRodada(exps, ["b"]).map((e: { id: string }) => e.id), ["a", "c"]);
  assert.deepEqual(pendentesDaRodada(exps, null).length, 3);
});
