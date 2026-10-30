// Cópia de reserva do 1:1 do Relacionamento (api/_relGruposPrivado.js, 30/10/2026).
// Casos reais de 29/10 (ids da Evolution e wamids da Meta conferidos no banco).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { chaveDoWamid, lerPrivado, variantesBr } from "../../api/_relGruposPrivado.js";

test("o id do WhatsApp sai de dentro do wamid da Meta (entrada, eco, envio do QS)", () => {
  assert.equal(chaveDoWamid("wamid.HBgMNTU4NTk2MzUwMDA1FQIAEhgUM0EzRjIwNEUxQzYzOTlGNTZFOEUA"), "3A3F204E1C6399F56E8E");
  assert.equal(chaveDoWamid("wamid.HBgTQlIuMTY1MTg1ODQyOTY1MzA0MBUUABEYFjNFQjAwQTg4REIxQkVEQjRGQTRBMkQA"), "3EB00A88DB1BEDB4FA4A2D");
  assert.equal(chaveDoWamid("wamid.HBgNNTUxMTk5MTUwMTE1NxUCABIYFDNBNjhEQkVDQjlEQkFEOUQxNkEyAA=="), "3A68DBECB9DBAD9D16A2");
  assert.equal(chaveDoWamid("evo:3A10CF1DFB5D22981680"), "3A10CF1DFB5D22981680");
  assert.equal(chaveDoWamid("WAID:123"), null);
  assert.equal(chaveDoWamid(""), null);
});

test("resposta no privado a mensagem de GRUPO (Rafael, 29/10 13:34:52 UTC)", () => {
  const p = lerPrivado({
    key: { id: "3A10CF1DFB5D22981680", fromMe: false, remoteJid: "51075818229977@lid", remoteJidAlt: "558599457475@s.whatsapp.net", addressingMode: "lid" },
    pushName: "Rafael Queiroz",
    message: { conversation: "Eu tenho um amigo que tem interesse, ele quer saber quanto é que tá?" },
    messageTimestamp: 1793280892,
    contextInfo: { stanzaId: "3EB09332BBB73F56393F9D", remoteJid: "120363430578232664@g.us", participant: "165129127772186@lid", quotedMessage: { conversation: "*Tainara*\nSurgiu uma vaga" } },
  });
  assert.equal(p.telefone, "558599457475");
  assert.equal(p.deMim, false);
  assert.equal(p.quando, "2026-10-29T13:34:52.000Z");
  assert.equal(p.grupoCitado.jid, "120363430578232664@g.us");
  assert.equal(p.citaId, null);
});

test("sem remoteJidAlt fica sem telefone (resolve depois pelos participantes)", () => {
  const p = lerPrivado({ key: { id: "X1", fromMe: false, remoteJid: "230966345920741@lid" }, message: { conversation: "Oi" }, messageTimestamp: 1793280877 });
  assert.equal(p.telefone, null);
  assert.equal(p.lid, "230966345920741@lid");
});

test("grupo, status, reação e anúncio de outra empresa não entram", () => {
  assert.equal(lerPrivado({ key: { id: "a", remoteJid: "120363430578232664@g.us" }, message: { conversation: "x" } }), null);
  assert.equal(lerPrivado({ key: { id: "b", remoteJid: "status@broadcast" }, message: { conversation: "x" } }), null);
  assert.equal(lerPrivado({ key: { id: "c", remoteJid: "1@lid" }, message: { reactionMessage: { text: "👍" } } }), null);
  assert.equal(lerPrivado({ key: { id: "d", remoteJid: "1@lid" }, message: { templateMessage: {} } }), null);
});

test("mídia vira anexo do tipo do QS", () => {
  const p = lerPrivado({ key: { id: "e", remoteJid: "558888415131@s.whatsapp.net" }, message: { audioMessage: {} }, messageTimestamp: 1793282256 });
  assert.equal(p.midia, "audio");
  assert.equal(p.telefone, "558888415131");
});

test("variantes com e sem o 9", () => {
  assert.deepEqual(variantesBr("5585999457475"), ["5585999457475", "558599457475"]);
  assert.deepEqual(variantesBr("558599457475"), ["558599457475", "5585999457475"]);
});
