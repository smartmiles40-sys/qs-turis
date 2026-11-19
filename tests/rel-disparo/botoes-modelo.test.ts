// Botões ao criar modelo (19/11): resposta rápida, link e ligar no formato da Meta.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
const { montarBotoesModelo } = await import("../../api/_meta.js");

test("sem botões = sem componente", () => {
  assert.deepEqual(montarBotoesModelo([]), { componente: null });
  assert.deepEqual(montarBotoesModelo(null), { componente: null });
});

test("respostas rápidas vêm antes dos links/ligar e o telefone ganha +55", () => {
  const r = montarBotoesModelo([
    { tipo: "link", texto: "Ver as datas", url: "https://seturforeuvou.com.br/datas" },
    { tipo: "resposta", texto: "Quero saber" },
    { tipo: "ligar", texto: "Ligar", telefone: "(11) 98012-4183" },
    { tipo: "resposta", texto: "Agora não" },
  ]);
  assert.deepEqual(r.componente, {
    type: "BUTTONS",
    buttons: [
      { type: "QUICK_REPLY", text: "Quero saber" },
      { type: "QUICK_REPLY", text: "Agora não" },
      { type: "URL", text: "Ver as datas", url: "https://seturforeuvou.com.br/datas" },
      { type: "PHONE_NUMBER", text: "Ligar", phone_number: "+5511980124183" },
    ],
  });
});

test("recusa o que a Meta recusa", () => {
  assert.match(montarBotoesModelo([{ tipo: "resposta", texto: "x".repeat(26) }]).erro, /25/);
  assert.match(montarBotoesModelo([{ tipo: "resposta", texto: "Sim" }, { tipo: "resposta", texto: "sim" }]).erro, /Dois botões/);
  assert.match(montarBotoesModelo([{ tipo: "link", texto: "Site", url: "seturforeuvou" }]).erro, /https/);
  assert.match(montarBotoesModelo([{ tipo: "link", texto: "Site", url: "https://a.com/{{1}}" }]).erro, /fixo/);
  assert.match(montarBotoesModelo([1, 2, 3].map((i) => ({ tipo: "link", texto: `L${i}`, url: "https://a.com" }))).erro, /2 botões de link/);
  assert.match(montarBotoesModelo([{ tipo: "ligar", texto: "A", telefone: "11980124183" }, { tipo: "ligar", texto: "B", telefone: "11980124184" }]).erro, /1 botão de ligar/);
  assert.match(montarBotoesModelo([{ tipo: "resposta", texto: "Oba 🎉" }]).erro, /emoji/);
  assert.match(montarBotoesModelo(Array.from({ length: 11 }, (_, i) => ({ tipo: "resposta", texto: `R${i}` }))).erro, /10/);
});
