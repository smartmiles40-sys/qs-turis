// Testes das regras puras da visão cruzada (src/clientes/visaoCruzadaRegras.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/visao-cruzada/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataCurta, eventosDaPessoa, itensDaFaixa, resumoDasParcelas, seloDasParcelas, semMigration, situacaoParcela, textoOrigem,
  TIPOS_QUE_A_FICHA_JA_TEM, type LinhaPessoa, type ParcelaReal, type ResumoSetores,
} from "../../src/clientes/visaoCruzadaRegras.ts";

const vazio = (): ResumoSetores => ({
  cliente_id: "c1", leads: 1,
  viagens: { ativas: 0, realizadas: 0, canceladas: 0, proximas: [] },
  chamados: { abertos: 0, lista: [] },
  oportunidades: { abertas: 0, lista: [] },
  parcelas: { vencidas: 0, vencidas_valor: 0, abertas: 0, abertas_valor: 0, pagas: 0 },
  negocios: [], motivo_perda: null, origem: null,
});

test("faixa: sem nada na casa (ou sem resumo) não aparece", () => {
  assert.deepEqual(itensDaFaixa(null), []);
  assert.deepEqual(itensDaFaixa(undefined), []);
  // parcelas abertas em dia e negócios não acendem a faixa
  const r = vazio(); r.parcelas.abertas = 3; r.parcelas.pagas = 2;
  r.negocios = [{ id: "n", lead_id: "l", etapa: "perdido", closer: null, motivo_perda: "preço", atualizado_em: "2026-11-01" }];
  assert.deepEqual(itensDaFaixa(r), []);
});

test("faixa: viagens com a próxima data, chamado, oportunidade do Rel e parcela vencida, nessa ordem", () => {
  const r = vazio();
  r.viagens = { ativas: 1, realizadas: 2, canceladas: 1, proximas: [{ id: "v", titulo: "Islândia", destino: null, embarque: "2027-03-04", retorno: null }] };
  r.chamados = { abertos: 2, lista: [{ numero: 41, assunto: "Troca de voo", status: "aberto", prioridade: "alta", prazo: null }] };
  r.oportunidades = { abertas: 1, lista: [{ titulo: "Seguro", etapa: "proposta", produto: "seguro", dono: "Ana Souza" }] };
  r.parcelas.vencidas = 1; r.parcelas.vencidas_valor = 1500;
  const itens = itensDaFaixa(r);
  assert.deepEqual(itens.map((i) => i.chave), ["viagens", "chamado", "oportunidade", "parcelas"]);
  assert.equal(itens[0].texto, "1 viagem ativa · 2 realizadas · 1 cancelada");
  assert.equal(itens[0].detalhe, "próxima: Islândia em 04/03/2027");
  assert.equal(itens[1].texto, "2 chamados abertos no Relacionamento");
  assert.equal(itens[1].detalhe, "#41 Troca de voo");
  assert.match(itens[2].texto, /recompra é do Rel/);
  assert.equal(itens[2].detalhe, "Seguro · Proposta · com Ana");
  assert.equal(itens[3].texto, "1 parcela vencida no Financeiro");
  assert.equal(itens[3].tom, "danger");
  assert.match(itens[3].detalhe ?? "", /1\.500,00/);
});

test("faixa: só viagem cancelada já conta (é cliente da casa)", () => {
  const r = vazio(); r.viagens.canceladas = 1;
  const itens = itensDaFaixa(r);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].texto, "1 cancelada");
  assert.equal(itens[0].detalhe, undefined);
});

test("origem: UTM com meio, fonte só quando acrescenta", () => {
  assert.equal(textoOrigem(null), "");
  assert.equal(textoOrigem({ fonte: "integracao" }), "integracao");
  assert.equal(textoOrigem({ utm_source: "meta", utm_campaign: "islandia-27", utm_medium: "cpc" }), "meta / islandia-27 (cpc)");
  assert.equal(textoOrigem({ fonte: "LP", utm_source: "google" }), "LP · google");
  assert.equal(textoOrigem({ fonte: "google", utm_source: "google", utm_campaign: " " }), "google");
});

test("dataCurta não passa por fuso", () => {
  assert.equal(dataCurta("2027-01-01"), "01/01/2027");
  assert.equal(dataCurta("2026-10-10T01:27:26.025+00:00"), "10/10/2026");
  assert.equal(dataCurta(null), "—");
});

test("linha do tempo: só entram os tipos que a ficha ainda não tem, sem repetir id", () => {
  const linhas: LinhaPessoa[] = [
    { id: "lead:1", em: "2026-10-01T10:00:00Z", tipo: "lead", titulo: "Lead chegou", sub: null, setor: "comercial" },
    { id: "wa:1:2026-10-02", em: "2026-10-02T10:00:00Z", tipo: "wa", titulo: "WhatsApp com o Comercial: 3 mensagens", sub: "oi", setor: "comercial" },
    { id: "wa:1:2026-10-02", em: "2026-10-02T10:00:00Z", tipo: "wa", titulo: "dup", sub: null, setor: "comercial" },
    { id: "sev:9", em: "2026-10-03T10:00:00Z", tipo: "sol_evento", titulo: "Solicitação #3: aceita", sub: null, setor: "operacoes" },
    { id: "venda:2", em: "2026-10-04T10:00:00Z", tipo: "venda", titulo: "Venda: X", sub: null, setor: "financeiro" },
    { id: "nev:5", em: "2026-10-05T10:00:00Z", tipo: "negocio_evento", titulo: "Negócio: a → b", sub: null, setor: "esquisito" },
  ];
  const ev = eventosDaPessoa(linhas, (iso) => iso.slice(0, 10));
  assert.deepEqual(ev.map((e) => e.id), ["pt-wa:1:2026-10-02", "pt-sev:9", "pt-nev:5"]);
  assert.equal(ev[0].when, "2026-10-02");
  assert.equal(ev[0].sub, "oi");
  assert.equal(ev[1].setor, "operacional");
  assert.equal(ev[2].setor, undefined);
  assert.ok(TIPOS_QUE_A_FICHA_JA_TEM.has("contato"));
  // quem usa a RPC sozinha pode pedir tudo
  assert.equal(eventosDaPessoa(linhas, (i) => i, new Set()).length, 5);
});

const P = (numero: number, valor: number, vencimento: string, status: string, pago_valor: number | null = null): ParcelaReal =>
  ({ id: `p${numero}`, plano_id: "pl", numero, valor, vencimento, forma: "pix", status, pago_em: status === "pago" ? vencimento : null, pago_valor });

test("parcelas: situação de cada uma no dia (São Paulo)", () => {
  const hoje = "2026-11-13";
  assert.equal(situacaoParcela(P(1, 10, "2026-11-12", "a_receber"), hoje), "vencida");
  assert.equal(situacaoParcela(P(1, 10, "2026-11-13", "a_receber"), hoje), "a_receber"); // vence hoje ainda não venceu
  assert.equal(situacaoParcela(P(1, 10, "2026-10-01", "pago"), hoje), "paga");
  assert.equal(situacaoParcela(P(1, 10, "2026-10-01", "cancelado"), hoje), "cancelada");
});

test("parcelas: resumo ignora canceladas, soma pago pelo valor recebido e acha a próxima", () => {
  const hoje = "2026-11-13";
  const r = resumoDasParcelas([
    P(0, 1000, "2026-10-01", "pago", 990),
    P(1, 500, "2026-11-01", "a_receber"),
    P(2, 500, "2026-12-20", "a_receber"),
    P(3, 500, "2026-12-01", "a_receber"),
    P(4, 500, "2027-01-01", "cancelado"),
  ], hoje);
  assert.equal(r.total, 4);
  assert.equal(r.pagas, 1); assert.equal(r.pagoValor, 990);
  assert.equal(r.vencidas, 1); assert.equal(r.vencidoValor, 500);
  assert.equal(r.aReceber, 2); assert.equal(r.aReceberValor, 1000);
  assert.equal(r.proxima?.numero, 3);
});

test("selo do pagamento: real quando há plano, null (status manual) sem plano", () => {
  const hoje = "2026-11-13";
  assert.equal(seloDasParcelas(resumoDasParcelas([], hoje)), null);
  assert.equal(seloDasParcelas(resumoDasParcelas([P(1, 1, "2026-01-01", "cancelado")], hoje)), null);
  assert.deepEqual(seloDasParcelas(resumoDasParcelas([P(1, 1, "2026-11-01", "a_receber"), P(2, 1, "2026-11-02", "a_receber")], hoje)), { t: "2 parcelas vencidas", tom: "erro" });
  assert.deepEqual(seloDasParcelas(resumoDasParcelas([P(1, 1, "2026-11-01", "pago")], hoje)), { t: "Quitado", tom: "rel" });
  assert.deepEqual(seloDasParcelas(resumoDasParcelas([P(1, 1, "2026-11-01", "pago"), P(2, 1, "2026-12-01", "a_receber")], hoje)), { t: "Pago em parte", tom: "aviso" });
  assert.deepEqual(seloDasParcelas(resumoDasParcelas([P(1, 1, "2026-12-01", "a_receber")], hoje)), { t: "A receber", tom: "neutro" });
});

test("semMigration reconhece função/tabela ausente e nada mais", () => {
  assert.equal(semMigration({ code: "PGRST202", message: "Could not find the function public.lead_resumo_setores" }), true);
  assert.equal(semMigration({ code: "42883", message: "function public.x(uuid) does not exist" }), true);
  assert.equal(semMigration({ message: "Could not find the function public.negocio_parcelas(p_negocio) in the schema cache" }), true);
  assert.equal(semMigration({ code: "42501", message: "Sem acesso a esta pessoa." }), false);
  assert.equal(semMigration(null), false);
});
