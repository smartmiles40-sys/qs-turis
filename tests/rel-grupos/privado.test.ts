// 1:1 lido da Evolution (api/_relGruposPrivado.js): "Responder em particular" a
// um grupo e o aviso da Meta que a cópia da Evolution pode trocar pelo texto.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://banco.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-falsa";

const { lerPrivado, ehAvisoDaMeta } = await import("../../api/_relGruposPrivado.js");

test("resposta no particular a um grupo vira grupoCitado (contextInfo no topo)", () => {
  const p = lerPrivado({
    key: { remoteJid: "5585999999999@s.whatsapp.net", id: "P1", fromMe: false },
    pushName: "Rafael", messageTimestamp: 1794400000,
    message: { conversation: "Posso levar mala grande?" },
    contextInfo: { stanzaId: "3EB0G", participant: "165129127772186@lid", remoteJid: "120363409195939801@g.us", quotedMessage: { conversation: "Lista do que levar" } },
  });
  assert.equal(p?.texto, "Posso levar mala grande?");
  assert.deepEqual(p?.grupoCitado, { jid: "120363409195939801@g.us", msg_id: "3EB0G", autor: "165129127772186@lid", texto: "Lista do que levar" });
  assert.equal(p?.citaId, null);
});

test("citação da própria conversa continua em citaId", () => {
  const p = lerPrivado({ key: { remoteJid: "5585999999999@s.whatsapp.net", id: "P2" }, message: { conversation: "isso" }, contextInfo: { stanzaId: "XYZ", quotedMessage: { conversation: "a" } } });
  assert.equal(p?.citaId, "XYZ");
  assert.equal(p?.grupoCitado, null);
});

test("aviso 'não repassa' da Meta é reconhecido", () => {
  assert.ok(ehAvisoDaMeta('⚠️ Mensagem do tipo "unknown" que o WhatsApp não repassa ao sistema — abra no celular para ver.'));
  assert.ok(ehAvisoDaMeta("⚠️ Mensagem que o WhatsApp não repassa ao sistema — abra no celular para ver."));
  assert.ok(!ehAvisoDaMeta("Oi, tudo bem?"));
});
