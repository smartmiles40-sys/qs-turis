// Leitura do evento da Evolution (api/_relGruposLer.js) — 11/11.
// Formato real: a Evolution troca extendedTextMessage por "conversation" e deixa
// o contextInfo só no TOPO do evento (data.contextInfo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { citacaoDoGrupo, contextoDoEvento, desembrulhar, grupoCitadoDoEvento, lerConteudoGrupo } from "../../api/_relGruposLer.js";

const GRUPO = "120363409195939801@g.us";

test("resposta em TEXTO no grupo: citação vem do topo do evento (formato da Evolution)", () => {
  const d = {
    key: { remoteJid: GRUPO, id: "ABC", participant: "111@lid" },
    message: { conversation: "Sim, vou!" },
    messageType: "conversation",
    contextInfo: { stanzaId: "3EB0X", participant: "222@lid", quotedMessage: { conversation: "Quem vai no passeio?" } },
  };
  assert.deepEqual(lerConteudoGrupo(d.message), { tipo: "texto", texto: "Sim, vou!" });
  assert.deepEqual(citacaoDoGrupo(d), { responde_a: "3EB0X", citado_texto: "Quem vai no passeio?", citado_autor: "222@lid", mencoes: [] });
});

test("resposta com FOTO: citação dentro do imageMessage continua valendo", () => {
  const d = { message: { imageMessage: { caption: "olha", contextInfo: { stanzaId: "S1", participant: "9@lid", quotedMessage: { imageMessage: {} } } } } };
  const c = citacaoDoGrupo(d);
  assert.equal(c.responde_a, "S1");
  assert.equal(c.citado_texto, "📷 foto");
});

test("formato cru do Baileys (extendedTextMessage com contextInfo dentro) também lê", () => {
  const d = { message: { extendedTextMessage: { text: "ok", contextInfo: { stanzaId: "S2", quotedMessage: { conversation: "pergunta" }, mentionedJid: ["5511999999999@s.whatsapp.net"] } } } };
  const c = citacaoDoGrupo(d);
  assert.equal(c.responde_a, "S2");
  assert.deepEqual(c.mencoes, ["5511999999999@s.whatsapp.net"]);
});

test("topo só com @ e citação dentro: prefere o que tem citação", () => {
  const d = { contextInfo: { mentionedJid: ["1@lid"] }, message: { imageMessage: { contextInfo: { stanzaId: "S3", quotedMessage: { conversation: "x" } } } } };
  assert.equal(contextoDoEvento(d)?.stanzaId, "S3");
});

test("sem citação: campos vazios", () => {
  assert.deepEqual(citacaoDoGrupo({ message: { conversation: "oi" } }), { responde_a: null, citado_texto: null, citado_autor: null, mencoes: [] });
});

test("mensagem temporária / visualização única no grupo é desembrulhada (antes era ignorada)", () => {
  const eph = { ephemeralMessage: { message: { extendedTextMessage: { text: "temporária", contextInfo: { stanzaId: "S4", quotedMessage: { conversation: "q" } } } } } };
  assert.deepEqual(lerConteudoGrupo(eph), { tipo: "texto", texto: "temporária" });
  assert.equal(citacaoDoGrupo({ message: eph }).responde_a, "S4");
  const vo = { viewOnceMessageV2: { message: { imageMessage: { caption: "" } } } };
  assert.equal(lerConteudoGrupo(vo)?.tipo, "imagem");
  assert.ok(desembrulhar({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "a.pdf" } } } }).documentMessage);
});

test("reação e protocolo continuam ignorados", () => {
  assert.equal(lerConteudoGrupo({ reactionMessage: { text: "👍" } }), null);
  assert.equal(lerConteudoGrupo({ protocolMessage: { type: 0 } }), null);
});

test("'Responder em particular': 1:1 com contextInfo apontando pro grupo", () => {
  const d = {
    key: { remoteJid: "5585999999999@s.whatsapp.net", id: "P1" },
    message: { conversation: "Tenho uma dúvida sobre isso" },
    contextInfo: { stanzaId: "3EB0G", participant: "165129127772186@lid", remoteJid: GRUPO, quotedMessage: { conversation: "Aviso do roteiro" } },
  };
  assert.deepEqual(grupoCitadoDoEvento(d), { jid: GRUPO, msg_id: "3EB0G", autor: "165129127772186@lid", texto: "Aviso do roteiro" });
  assert.equal(grupoCitadoDoEvento({ ...d, contextInfo: { ...d.contextInfo, remoteJid: undefined } }), null);
});
