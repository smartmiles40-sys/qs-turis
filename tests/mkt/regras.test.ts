// Regras puras do Marketing (0242): base de contatos, recorrência, sequência,
// recibo e PARAR. Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarTelefone, formatarTelefone, normalizarEmail, emailValido, separarTags, unirTags,
  parseCsv, detectarSeparador, mapearColunas, lerCsvDeContatos, descreverRecorrencia, descreverSequencia,
} from "../../src/mkt/disparos/regras.ts";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import * as srv from "../../api/_mktRegras.js";

// ── Telefone ────────────────────────────────────────────────────────────────

const CASOS_TEL: [string, string][] = [
  ["(11) 99999-8888", "5511999998888"],
  ["+55 11 99999-8888", "5511999998888"],
  ["011 99999-8888", "5511999998888"],    // 0 de discagem interurbana cai fora
  ["+1 415 555 0100", "14155550100"],     // DDI escrito com + não vira 55
  ["0055 11 99999-8888", "5511999998888"],
  ["11 9999-8888", "5511999998888"],      // celular sem o 9 → ganha o 9
  ["551199998888", "5511999998888"],
  ["11 3333-4444", "551133334444"],       // fixo fica como está
  ["5511333344445", ""],                  // fixo com dígito a mais
  ["123", ""],
  ["", ""],
  ["351 912 345 678", "351912345678"],    // Portugal
  ["5500999998888", ""],                  // DDD 00 não existe
];

test("telefone: DDI 55, 9º dígito no celular, fixo intacto, estrangeiro aceito", () => {
  for (const [entra, sai] of CASOS_TEL) assert.equal(normalizarTelefone(entra), sai, entra);
});

test("telefone: a tela e o servidor usam a MESMA régua", () => {
  for (const [entra] of CASOS_TEL) assert.equal(normalizarTelefone(entra), srv.normalizarTelefoneMkt(entra), entra);
  for (const x of ["5585996350005", "(85) 9635-0005", "+1 415 555 0100", "99999"]) {
    assert.equal(normalizarTelefone(x), srv.normalizarTelefoneMkt(x), x);
  }
});

test("chave e variantes casam o celular com e sem o 9º dígito (wa_id da Meta)", () => {
  assert.equal(srv.chaveTelefone("5585996350005"), srv.chaveTelefone("558596350005"));
  assert.deepEqual(srv.variantesTelefone("5585996350005").sort(), ["558596350005", "5585996350005"].sort());
  assert.deepEqual(srv.variantesTelefone("558596350005").sort(), ["558596350005", "5585996350005"].sort());
  assert.deepEqual(srv.variantesTelefone("551133334444"), ["551133334444"]); // fixo não ganha 9
});

test("formatar telefone pra tela", () => {
  assert.equal(formatarTelefone("5511999998888"), "+55 11 99999-8888");
  assert.equal(formatarTelefone("551133334444"), "+55 11 3333-4444");
});

// ── E-mail e tags ───────────────────────────────────────────────────────────

test("e-mail minúsculo e validação simples", () => {
  assert.equal(normalizarEmail("  Maria@Exemplo.COM "), "maria@exemplo.com");
  assert.equal(emailValido("maria@exemplo.com"), true);
  assert.equal(emailValido("maria@exemplo"), false);
  assert.equal(emailValido("ma ria@exemplo.com"), false);
  assert.equal(srv.emailValidoMkt("Maria@Exemplo.com"), true);
});

test("tags: separa, minúsculo, sem repetir", () => {
  assert.deepEqual(separarTags("VIP, cliente; 2026 | vip"), ["vip", "cliente", "2026"]);
  assert.deepEqual(unirTags(["a", "B"], ["b", "c"], null), ["a", "b", "c"]);
});

// ── CSV ─────────────────────────────────────────────────────────────────────

test("CSV do Excel brasileiro: BOM, ponto e vírgula, aspas com ; e quebra de linha", () => {
  const csv = '﻿Nome;Telefone;E-mail;Cidade\r\n"Silva; João";(11) 9999-8888;JOAO@X.COM;São Paulo\r\n"Ana ""Aninha""";;ana@x.com;"Rio\nde Janeiro"\r\n';
  assert.equal(detectarSeparador(csv.replace(/^﻿/, "").split(/\r?\n/)[0]), ";");
  const linhas = parseCsv(csv);
  assert.equal(linhas.length, 3);
  assert.equal(linhas[1][0], "Silva; João");
  assert.equal(linhas[2][0], 'Ana "Aninha"');
  assert.equal(linhas[2][3], "Rio\nde Janeiro");
});

test("cabeçalho com acento e caixa casa; colunas extras viram campos", () => {
  const m = mapearColunas(["Nome Completo", "Celular", "Endereço de E-mail", "Destino de interesse", "Email"]);
  assert.equal(m.nome, 0); assert.equal(m.telefone, 1); assert.equal(m.email, 2);
  assert.deepEqual(m.extras.map((e) => e.chave), ["destino_de_interesse", "email"]);
});

test("ler contatos: normaliza, tira repetido do arquivo e explica quem ficou de fora", () => {
  const csv = [
    "nome,telefone,email,tags,destino",
    "Maria,(11) 99999-8888,MARIA@x.com,\"vip, japão\",Japão",
    "Maria de novo,11 9999-8888,,,",            // mesmo celular (sem o 9) → repetido
    "Sem nada,,,,",
    "Só e-mail,,so@x.com,,",
    "Inválido,123,,,",
    "Outro e-mail igual,21 98888-7777,maria@x.com,,", // e-mail repetido
  ].join("\n");
  const r = lerCsvDeContatos(csv);
  assert.equal(r.total, 6);
  assert.equal(r.contatos.length, 2);
  assert.deepEqual(r.contatos[0], { nome: "Maria", telefone: "5511999998888", email: "maria@x.com", tags: ["vip", "japão"], campos: { destino: "Japão" } });
  assert.equal(r.contatos[1].telefone, null);
  assert.equal(r.contatos[1].email, "so@x.com");
  assert.deepEqual(r.ignoradas.map((i) => i.linha), [3, 4, 6, 7]);
  assert.match(r.ignoradas[0].motivo, /Repetido/);
  assert.match(r.ignoradas[1].motivo, /Sem telefone/);
  assert.match(r.ignoradas[2].motivo, /inválido/);
});

// ── Recorrência ─────────────────────────────────────────────────────────────

test("recorrência: próxima ocorrência em horário de São Paulo, estritamente depois", () => {
  // 30/10/2026 é sexta. 12:00 UTC = 09:00 em SP.
  const sexta9h = "2026-10-30T12:00:00.000Z";
  // Toda segunda 09:00 → segunda 02/11 09:00 SP = 12:00 UTC
  assert.equal(srv.proximaOcorrencia([1], "09:00", sexta9h), "2026-11-02T12:00:00.000Z");
  // Sexta 09:00 exatamente agora → não conta (estritamente depois) → próxima sexta
  assert.equal(srv.proximaOcorrencia([5], "09:00", sexta9h), "2026-11-06T12:00:00.000Z");
  // Sexta 18:00 ainda hoje
  assert.equal(srv.proximaOcorrencia([5], "18:00", sexta9h), "2026-10-30T21:00:00.000Z");
  // 23:30 SP de sexta (02:30 UTC de sábado) → o "hoje" é sexta em SP
  assert.equal(srv.proximaOcorrencia([6], "08:00", "2026-10-31T02:30:00.000Z"), "2026-10-31T11:00:00.000Z");
  assert.equal(srv.proximaOcorrencia([], "09:00", sexta9h), null);
  assert.equal(srv.proximaOcorrencia([1], "9h", sexta9h), null);
});

test("recorrência: descrição", () => {
  assert.equal(descreverRecorrencia([1], "09:00"), "Toda segunda às 09:00");
  assert.equal(descreverRecorrencia([0], "19:30"), "Todo domingo às 19:30");
  assert.equal(descreverRecorrencia([4, 1], "10:00"), "Toda segunda e quinta às 10:00");
  assert.equal(descreverRecorrencia([1, 2, 3, 4, 5], "09:00"), "De segunda a sexta às 09:00");
});

// ── Sequência ───────────────────────────────────────────────────────────────

test("sequência: passo no dia da entrada + N, na hora do passo (SP)", () => {
  const entrou = "2026-10-30T13:00:00.000Z"; // sexta 10:00 SP
  // dia 0 às 11:00 → hoje 11:00 SP
  assert.equal(srv.dataDoPasso(entrou, 0, "11:00", entrou), "2026-10-30T14:00:00.000Z");
  // dia 0 às 09:00 (já passou) → agora
  assert.equal(srv.dataDoPasso(entrou, 0, "09:00", entrou), entrou);
  // dia 3 às 10:00 → segunda 02/11 10:00 SP
  assert.equal(srv.dataDoPasso(entrou, 3, "10:00", entrou), "2026-11-02T13:00:00.000Z");
  // calculado depois (cron atrasado): nunca no passado
  const depois = "2026-11-05T00:00:00.000Z";
  assert.equal(srv.dataDoPasso(entrou, 3, "10:00", depois), depois);
});

test("sequência: dias fora de ordem dão erro na descrição", () => {
  assert.equal(descreverSequencia([{ dia_offset: 0, hora: "10:00" }, { dia_offset: 3, hora: "10:00" }]).texto, "Dia 0 às 10:00 → dia 3 às 10:00");
  assert.ok(descreverSequencia([{ dia_offset: 3, hora: "10:00" }, { dia_offset: 1, hora: "10:00" }]).erro);
});

// ── Recibo e PARAR ──────────────────────────────────────────────────────────

test("recibo da Meta só anda o funil pra frente", () => {
  assert.equal(srv.avancarStatus("enviado", "delivered"), "entregue");
  assert.equal(srv.avancarStatus("entregue", "read"), "lido");
  assert.equal(srv.avancarStatus("lido", "delivered"), null);      // atrasado não desfaz
  assert.equal(srv.avancarStatus("respondeu", "read"), null);
  assert.equal(srv.avancarStatus("enviado", "failed"), "erro");
  assert.equal(srv.avancarStatus("lido", "failed"), null);
  assert.equal(srv.avancarStatus("pulado", "delivered"), null);
  assert.equal(srv.avancarStatus("enviado", "qualquer"), null);
});

test("PARAR: texto, botão do modelo e o que NÃO é pedido de saída", () => {
  assert.equal(srv.ehParadaMkt("PARAR"), true);
  assert.equal(srv.ehParadaMkt("Parar de receber"), true);
  assert.equal(srv.ehParadaMkt("não quero mais"), true);
  assert.equal(srv.ehParadaMkt("Não quero perder a data, me manda o link?"), false);
  assert.equal(srv.ehParadaMkt("Quero saber mais do Japão"), false);
  assert.equal(srv.textoDaMensagem({ type: "button", button: { text: "Parar de receber", payload: "x" } }), "Parar de receber");
  assert.equal(srv.textoDaMensagem({ type: "text", text: { body: "oi" } }), "oi");
  assert.equal(srv.textoDaMensagem({ type: "interactive", interactive: { button_reply: { title: "Sim" } } }), "Sim");
  assert.equal(srv.textoDaMensagem(null), "");
});
