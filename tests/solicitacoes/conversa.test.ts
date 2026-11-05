// Central de Solicitações — QUADRO + CONVERSA (05/11/2026): regras puras de
// src/solicitacoes/conversa.ts (coluna, chip de prazo, participante, não lidas,
// selo do menu, linha do tempo).
// Rodar: npx tsx --test tests/solicitacoes/conversa.test.ts
//   (ou node --import ./tests/registrar-ts.mjs --test tests/solicitacoes/*.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chipDePrazo, colunaDoQuadro, contarNaoLidas, ehParticipante, iniciais, itensDaConversa, numeroDoMenu, passaNoFiltro, podeAcompanhar,
  previaDoUltimo, quandoCurto, totalNaoLidas, colunasVisiveis, contagemDoPrazo, duracaoLegivel, camposDaDescricao,
} from "../../src/solicitacoes/conversa.ts";

// quinta, 05/11/2026 15:00 em São Paulo
const AGORA = new Date("2026-11-05T15:00:00-03:00").getTime();
const sp = (s: string) => new Date(`${s}-03:00`).toISOString();

test("status → coluna do quadro", () => {
  const base = { aguardando_quem: null, concluido_em: null };
  assert.equal(colunaDoQuadro({ ...base, status: "nova" }, AGORA), "nova");
  assert.equal(colunaDoQuadro({ ...base, status: "em_andamento" }, AGORA), "com_alguem");
  assert.equal(colunaDoQuadro({ ...base, status: "aguardando", aguardando_quem: "solicitante" }, AGORA), "voltou");
  // esperando cliente/fornecedor continua com o responsável
  assert.equal(colunaDoQuadro({ ...base, status: "aguardando", aguardando_quem: "cliente" }, AGORA), "com_alguem");
  assert.equal(colunaDoQuadro({ ...base, status: "aguardando", aguardando_quem: "fornecedor" }, AGORA), "com_alguem");
  assert.equal(colunaDoQuadro({ ...base, status: "concluida", concluido_em: sp("2026-11-01T10:00:00") }, AGORA), "concluida");
  // concluída há mais de 7 dias sai do quadro (fica no Buscar) — 05/11: janela encurtada de 14 pra 7
  assert.equal(colunaDoQuadro({ ...base, status: "concluida", concluido_em: sp("2026-10-29T10:00:00") }, AGORA), null);
  assert.equal(colunaDoQuadro({ ...base, status: "concluida", concluido_em: sp("2026-10-20T10:00:00") }, AGORA), null);
  assert.equal(colunaDoQuadro({ ...base, status: "recusada" }, AGORA), null);
  assert.equal(colunaDoQuadro({ ...base, status: "cancelada" }, AGORA), null);
});

test("chip de prazo: vermelho venceu, laranja hoje, verde no prazo, neutro pausado", () => {
  const ab = (prazo: string | null) => ({ status: "em_andamento" as const, aguardando_quem: null, concluido_em: null, prazo });
  assert.deepEqual(chipDePrazo(ab(sp("2026-11-05T12:00:00")), AGORA), { tom: "r", texto: "Venceu há 3h" });
  assert.deepEqual(chipDePrazo(ab(sp("2026-11-05T14:30:00")), AGORA), { tom: "r", texto: "Venceu há 30 min" });
  assert.deepEqual(chipDePrazo(ab(sp("2026-11-04T17:00:00")), AGORA), { tom: "r", texto: "Venceu ontem" });
  assert.deepEqual(chipDePrazo(ab(sp("2026-11-02T17:00:00")), AGORA), { tom: "r", texto: "Venceu há 3 dias" });
  assert.deepEqual(chipDePrazo(ab(sp("2026-11-05T17:00:00")), AGORA), { tom: "o", texto: "Hoje, 17:00" });
  assert.deepEqual(chipDePrazo(ab(sp("2026-11-06T10:00:00")), AGORA), { tom: "ok", texto: "Amanhã, 10:00" });
  const longe = chipDePrazo(ab(sp("2026-11-10T10:00:00")), AGORA);
  assert.equal(longe.tom, "ok");
  assert.match(longe.texto, /10\/11$/);
  assert.deepEqual(chipDePrazo(ab(null), AGORA), { tom: "n", texto: "Sem prazo" });
  // devolvido pra quem pediu: prazo pausado, mesmo vencido
  assert.deepEqual(chipDePrazo({ status: "aguardando", aguardando_quem: "solicitante", concluido_em: null, prazo: sp("2026-11-01T10:00:00") }, AGORA),
    { tom: "n", texto: "Prazo pausado" });
  // concluídas
  assert.deepEqual(chipDePrazo({ status: "concluida", aguardando_quem: null, prazo: sp("2026-11-03T18:00:00"), concluido_em: sp("2026-11-03T11:00:00") }, AGORA),
    { tom: "ok", texto: "No prazo" });
  assert.deepEqual(chipDePrazo({ status: "concluida", aguardando_quem: null, prazo: sp("2026-11-03T11:00:00"), concluido_em: sp("2026-11-03T18:00:00") }, AGORA),
    { tom: "r", texto: "Concluída com atraso" });
});

test("filtros do topo: Atrasados e Comigo", () => {
  const s = (o: object) => ({ status: "em_andamento" as const, aguardando_quem: null, concluido_em: null, prazo: null, responsavel_id: null, criado_por: "x", sem_dono_atrasada: false, ...o });
  assert.equal(passaNoFiltro(s({ prazo: sp("2026-11-05T10:00:00") }), "atrasados", "eu", AGORA), true);
  assert.equal(passaNoFiltro(s({ prazo: sp("2026-11-05T18:00:00") }), "atrasados", "eu", AGORA), false);
  assert.equal(passaNoFiltro(s({ status: "nova", sem_dono_atrasada: true }), "atrasados", "eu", AGORA), true);
  // pausado não é atrasado
  assert.equal(passaNoFiltro(s({ status: "aguardando", aguardando_quem: "solicitante", prazo: sp("2026-11-01T10:00:00") }), "atrasados", "eu", AGORA), false);
  assert.equal(passaNoFiltro(s({ responsavel_id: "eu" }), "comigo", "eu", AGORA), true);
  assert.equal(passaNoFiltro(s({ responsavel_id: "outra" }), "comigo", "eu", AGORA), false);
  assert.equal(passaNoFiltro(s({}), "todos", "eu", AGORA), true);
});

test("quem é participante do pedido", () => {
  const s = { status: "em_andamento" as const, criado_por: "ana", responsavel_id: "laura", para_setor: "operacional" as const, seguindo: false };
  assert.equal(ehParticipante(s, "ana", ["comercial"]), true, "quem pediu");
  assert.equal(ehParticipante(s, "laura", ["operacional"]), true, "responsável");
  assert.equal(ehParticipante({ ...s, seguindo: true }, "bia", ["financeiro"]), true, "quem acompanha");
  // colega do setor que recebe: só enquanto ninguém pegou
  assert.equal(ehParticipante(s, "mari", ["operacional"]), false);
  assert.equal(ehParticipante({ ...s, status: "nova", responsavel_id: null }, "mari", ["operacional"]), true);
  assert.equal(ehParticipante({ ...s, status: "nova", responsavel_id: null }, "joao", ["comercial"]), false);
  assert.equal(ehParticipante({ ...s, status: "nova", responsavel_id: null }, "adm", [], true), true, "admin é de todos os setores");
  assert.equal(ehParticipante(s, "", ["operacional"]), false);
  // Acompanhar só pra quem não é participante de nascença
  assert.equal(podeAcompanhar(s, "ana"), false);
  assert.equal(podeAcompanhar(s, "laura"), false);
  assert.equal(podeAcompanhar(s, "mari"), true);
});

test("não lidas por pessoa: eventos de outros depois do meu visto", () => {
  const ev = [
    { autor_id: "ana", criado_em: sp("2026-11-05T09:00:00") },
    { autor_id: "eu", criado_em: sp("2026-11-05T10:00:00") },
    { autor_id: "ana", criado_em: sp("2026-11-05T11:00:00") },
    { autor_id: null, criado_em: sp("2026-11-05T12:00:00") }, // distribuição automática (QS)
  ];
  assert.equal(contarNaoLidas(ev, null, "eu", AGORA), 3, "nunca abriu: tudo dos outros");
  assert.equal(contarNaoLidas(ev, sp("2026-11-05T10:30:00"), "eu", AGORA), 2);
  assert.equal(contarNaoLidas(ev, sp("2026-11-05T13:00:00"), "eu", AGORA), 0);
  // janela de 30 dias, como a view
  assert.equal(contarNaoLidas([{ autor_id: "ana", criado_em: sp("2026-09-01T10:00:00") }], null, "eu", AGORA), 0);

  assert.equal(totalNaoLidas([{ nao_lidas: 2, participo: true }, { nao_lidas: 5, participo: false }, { nao_lidas: 1, participo: true }, { participo: true }]), 3);
});

test("selo do menu: não lidas (0315) ou o antigo", () => {
  assert.equal(numeroDoMenu({ novas: 1, novidades: 4, desfechos: 0, naoLidas: 3 }), 3);
  assert.equal(numeroDoMenu({ novas: 5, novidades: 0, desfechos: 1, naoLidas: 2 }), 6, "nova sem dono já vista continua contando");
  assert.equal(numeroDoMenu({ novas: 1, novidades: 2, desfechos: 1, naoLidas: null }), 4, "sem 0315: novas + novidades + desfechos");
  assert.equal(numeroDoMenu({ novas: 0, novidades: 0, desfechos: 0, naoLidas: 0 }), 0);
});

test("linha do tempo: pílulas e bolhas", () => {
  const ev = (id: number, tipo: string, extra: object = {}) => ({ id, solicitacao_id: "s", tipo, de: null, para: null, texto: null, autor_id: "ant", autor_nome: "Antônio Lima", criado_em: sp("2026-11-05T09:00:00"), ...extra }) as never;
  const itens = itensDaConversa([
    ev(1, "criada"),
    ev(2, "aceita", { autor_id: "lau", autor_nome: "Laura", criado_em: sp("2026-11-05T10:00:00") }),
    ev(3, "comentario", { autor_id: "lau", autor_nome: "Laura", texto: "Vou procurar.", criado_em: sp("2026-11-05T10:05:00") }),
    ev(4, "ajuste", { autor_id: "lau", autor_nome: "Laura", texto: "Falta o CPF.", criado_em: sp("2026-11-05T11:00:00") }),
    ev(5, "passada", { autor_id: null, autor_nome: "QS", para: "Mariane Souza" }),
  ], "lau", { quemPediu: "Antônio Lima", descricaoInicial: "Preciso do código do Bitrix.", agora: AGORA });

  assert.deepEqual(itens.map((i) => i.tipo), ["evento", "msg", "evento", "msg", "evento", "msg", "evento"]);
  assert.equal(itens[0].tipo === "evento" && itens[0].texto, "Antônio criou o pedido · hoje, 09:00");
  assert.ok(itens[1].tipo === "msg" && itens[1].texto === "Preciso do código do Bitrix." && !itens[1].eu && itens[1].quem === "Antônio");
  assert.ok(itens[3].tipo === "msg" && itens[3].eu && itens[3].quem === "Você");
  assert.equal(itens[4].tipo === "evento" && itens[4].texto, "Pedido voltou para Antônio · prazo pausado · hoje, 11:00");
  assert.equal(itens[6].tipo === "evento" && itens[6].texto.startsWith("Distribuído para Mariane"), true);

  // pedido com formulário: sem bolha da descrição
  assert.equal(itensDaConversa([ev(1, "criada")], "x", { agora: AGORA }).length, 1);
});

test("prévia do cartão, iniciais e datas curtas", () => {
  assert.equal(previaDoUltimo({ tipo: "comentario", texto: "Conseguiu achar?", para: null, autor_id: "ant", autor_nome: "Antônio Lima", criado_em: sp("2026-11-05T08:40:00") }, "eu"), "Antônio: Conseguiu achar?");
  assert.equal(previaDoUltimo({ tipo: "comentario", texto: "Ok", para: null, autor_id: "eu", autor_nome: "Eu Mesmo", criado_em: sp("2026-11-05T08:40:00") }, "eu"), "Você: Ok");
  assert.equal(previaDoUltimo({ tipo: "aceita", texto: null, para: null, autor_id: "m", autor_nome: "Mariane", criado_em: sp("2026-11-05T10:45:00") }, "eu"), "Mariane pegou o pedido");
  assert.equal(previaDoUltimo(null, "eu"), "");
  assert.equal(iniciais("Laura Souza"), "LS");
  assert.equal(iniciais("Mariane"), "MA");
  assert.equal(iniciais("Laura", true), "EU");
  assert.equal(iniciais(null), "?");
  assert.equal(quandoCurto(sp("2026-11-05T09:00:00"), AGORA), "hoje, 09:00");
  assert.equal(quandoCurto(sp("2026-11-04T14:22:00"), AGORA), "ontem, 14:22");
  assert.match(quandoCurto(sp("2026-10-29T09:00:00"), AGORA), /29\/10 09:00$/);
});

test("concluídas recolhidas por padrão", () => {
  assert.deepEqual(colunasVisiveis(false).map((c) => c.id), ["nova", "com_alguem", "voltou"]);
  assert.deepEqual(colunasVisiveis(true).map((c) => c.id), ["nova", "com_alguem", "voltou", "concluida"]);
});

test("prazo em destaque no pedido aberto", () => {
  const ab = (prazo: string | null, extra: object = {}) => ({ status: "em_andamento", aguardando_quem: null, prazo, concluido_em: null, ...extra }) as never;
  assert.deepEqual(contagemDoPrazo(ab(sp("2026-11-05T17:10:00")), AGORA), { tom: "o", grande: "Faltam 2h 10min", sub: "vence hoje, 17:10" });
  assert.equal(contagemDoPrazo(ab(sp("2026-11-03T15:00:00")), AGORA).grande, "Atrasado há 2 dias");
  assert.equal(contagemDoPrazo(ab(sp("2026-11-05T14:15:00")), AGORA).tom, "r");
  assert.equal(contagemDoPrazo(ab(null), AGORA).grande, "Sem prazo");
  assert.equal(contagemDoPrazo(ab(sp("2026-11-03T15:00:00"), { status: "aguardando", aguardando_quem: "solicitante" }), AGORA).grande, "Prazo pausado");
  assert.equal(duracaoLegivel(45 * 60_000), "45 min");
  assert.equal(duracaoLegivel(3 * 3_600_000), "3h");
  assert.equal(duracaoLegivel(26 * 3_600_000), "1 dia");
});

test("descrição em linhas 'Rótulo: valor' vira cartões", () => {
  const r = camposDaDescricao("Passageiro: Ana Souza\nTrecho: GRU–LIS\nVer https://exemplo.com\nqualquer coisa");
  assert.deepEqual(r.campos, [["Passageiro", "Ana Souza"], ["Trecho", "GRU–LIS"]]);
  assert.equal(r.resto, "Ver https://exemplo.com\nqualquer coisa");
  assert.deepEqual(camposDaDescricao(null), { campos: [], resto: "" });
});

test("mensagem só com arquivos (0316)", () => {
  const ev = { id: 9, solicitacao_id: "s", tipo: "comentario", de: null, para: "anexos", texto: "anexou foto.png", autor_id: "lau", autor_nome: "Laura", criado_em: sp("2026-11-05T10:00:00") } as never;
  const [m] = itensDaConversa([ev], "eu", { agora: AGORA });
  assert.ok(m.tipo === "msg" && m.auto && m.evento === 9);
  assert.equal(previaDoUltimo({ tipo: "comentario", texto: "anexou foto.png", para: "anexos", autor_id: "lau", autor_nome: "Laura", criado_em: sp("2026-11-05T10:00:00") }, "eu"), "📎 Laura anexou foto.png");
});
