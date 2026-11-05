// "Absolutamente tudo sobe pro QS" (Bruno, 05/11/2026): nenhum tipo de mensagem
// pode voltar null e ser jogado fora em silêncio — nem da Meta nem da Evolution.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { lerMensagemMeta } from "../../api/_metaEntrada.js";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { lerPrivado } from "../../api/_relGruposPrivado.js";

const base = { id: "wamid.X", from: "5531991133653", timestamp: "1793800000" };

test("Meta: 'unsupported' vira aviso (4 casos reais em 05/11 sumiam)", () => {
  const l = lerMensagemMeta({ ...base, type: "unsupported", errors: [{ code: 131051 }], unsupported: { type: "video_note" } });
  assert.ok(l);
  assert.match(l.texto, /video_note/);
  assert.match(l.texto, /abra no celular/);
});

test("Meta: tipo que ainda nem existe também vira aviso", () => {
  const l = lerMensagemMeta({ ...base, type: "coisa_nova_2027" });
  assert.match(l.texto, /coisa_nova_2027/);
});

test("Meta: edição mostra o texto novo e aponta pra original", () => {
  const l = lerMensagemMeta({ ...base, type: "edit", edit: { original_message_id: "wamid.ORIG", message: { type: "text", text: { body: "chego às 10h" } } } });
  assert.equal(l.texto, "✏️ Editou a mensagem: chego às 10h");
  assert.equal(l.respondendoA, "wamid.ORIG");
});

test("Meta: apagar, sistema e pedido viram bolha", () => {
  assert.equal(lerMensagemMeta({ ...base, type: "revoke", revoke: { original_message_id: "wamid.O" } }).respondendoA, "wamid.O");
  assert.match(lerMensagemMeta({ ...base, type: "system", system: { body: "Fulano trocou de número" } }).texto, /trocou de número/);
  assert.match(lerMensagemMeta({ ...base, type: "order", order: { product_items: [{}, {}] } }).texto, /2 itens/);
});

test("Meta: interativo sem título não some", () => {
  assert.match(lerMensagemMeta({ ...base, type: "interactive", interactive: { type: "call_permission_reply" } }).texto, /interativa/);
});

test("Meta: reação e request_welcome continuam fora (são tratados à parte / não têm conteúdo)", () => {
  assert.equal(lerMensagemMeta({ ...base, type: "reaction", reaction: { emoji: "👍" } }), null);
  assert.equal(lerMensagemMeta({ ...base, type: "request_welcome" }), null);
});

test("Meta: contato leva o telefone junto", () => {
  const l = lerMensagemMeta({ ...base, type: "contacts", contacts: [{ name: { formatted_name: "Ana" }, phones: [{ phone: "+55 31 99999-0000" }] }] });
  assert.equal(l.texto, "👤 Contato: Ana (+55 31 99999-0000)");
});

test("Meta: texto e mídia seguem como antes", () => {
  assert.equal(lerMensagemMeta({ ...base, type: "text", text: { body: "oi" } }).texto, "oi");
  const img = lerMensagemMeta({ ...base, type: "image", image: { id: "M1", mime_type: "image/jpeg", caption: "foto" } });
  assert.equal(img.midia.tipo, "image");
  assert.equal(img.texto, "foto");
});

const evo = (message: Record<string, unknown>) => ({
  key: { id: "3A00", fromMe: false, remoteJid: "553191133653@s.whatsapp.net" },
  messageTimestamp: 1793800000,
  message,
});

test("Evolution: vídeo redondinho, edição, apagar, contatos, botão e evento viram bolha", () => {
  assert.equal(lerPrivado(evo({ ptvMessage: { caption: "" } })).midia, "video");
  assert.equal(lerPrivado(evo({ editedMessage: { message: { protocolMessage: { type: 14, editedMessage: { conversation: "novo" } } } } })).texto, "✏️ Editou a mensagem: novo");
  assert.equal(lerPrivado(evo({ protocolMessage: { type: 0 } })).texto, "🗑️ Apagou uma mensagem");
  assert.match(lerPrivado(evo({ contactsArrayMessage: { contacts: [{ displayName: "A" }, { displayName: "B" }] } })).texto, /A[\s\S]*B/);
  assert.equal(lerPrivado(evo({ buttonsResponseMessage: { selectedDisplayText: "Sim" } })).texto, "↩️ Sim");
  assert.match(lerPrivado(evo({ eventMessage: { name: "Reunião" } })).texto, /Reunião/);
});

test("Evolution: tipo desconhecido vira aviso; reação/voto/chave não", () => {
  assert.match(lerPrivado(evo({ fooBarMessage: {}, messageContextInfo: {} })).texto, /fooBar/);
  assert.equal(lerPrivado(evo({ reactionMessage: { text: "👍" } })), null);
  assert.equal(lerPrivado(evo({ pollUpdateMessage: {} })), null);
  assert.equal(lerPrivado(evo({ senderKeyDistributionMessage: {}, messageContextInfo: {} })), null);
  assert.equal(lerPrivado({ key: { id: "3A01", remoteJid: "553191133653@s.whatsapp.net" }, messageStubType: 2 }), null);
});
