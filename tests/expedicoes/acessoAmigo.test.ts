// Testes do link mágico do ExpedAmigo (mensagem, montagem do link, expiração).
// Rodar: npx tsx --test tests/expedicoes/acessoAmigo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codigoDoLink, codigoValido, cpfMaster, diasRestantesLink, expiracaoDoLink, linkExpirado, linkReaproveitavel,
  montarLinkCurto, montarLinkWhatsapp, montarMensagemOnboarding, normalizarBasePortal, primeiroNome, telefoneWhatsapp,
  DIAS_VALIDADE_LINK,
} from "../../src/expedicoes/expedamigo/acessoAmigo.ts";

const AGORA = new Date("2026-11-05T15:00:00.000Z");
const DIA = 86_400_000;
const em = (dias: number) => new Date(AGORA.getTime() + dias * DIA).toISOString();

test("mensagem: primeiro nome, expedição e link no lugar", () => {
  const m = montarMensagemOnboarding("Maria  da Silva", { nome: "Japão G1", tipo: "expedicao" }, "https://p.x/a/abcdefghjk");
  assert.match(m, /^Oiii Maria! Que alegria ter você na Expedição Japão G1 💚/);
  assert.ok(m.includes("👉 https://p.x/a/abcdefghjk"));
  assert.ok(m.includes("próximos passos da sua expedição."));
  assert.ok(!/\{[a-zçã_]+\}/.test(m), "nenhum {marcador} sobrando");
});

test("mensagem: pacote fala 'sua viagem' e 'viagem'", () => {
  const m = montarMensagemOnboarding("João", { nome: "Lisboa", tipo: "pacote" }, "L");
  assert.ok(m.includes("na sua viagem Lisboa"));
  assert.ok(m.includes("próximos passos da sua viagem."));
});

test("mensagem: sem viagem não quebra; modelo próprio substitui o padrão", () => {
  assert.ok(montarMensagemOnboarding("Ana", undefined, "L").includes("Expedição "));
  assert.equal(montarMensagemOnboarding("Ana Lima", null, "L", "Oi {nome}: {link} ({expedicao})"), "Oi Ana: L ()");
  assert.equal(primeiroNome("  "), "");
});

test("link curto: <base>/a/<codigo>, base sem barra", () => {
  assert.equal(montarLinkCurto("https://portal.x/", "abcdefghjk"), "https://portal.x/a/abcdefghjk");
  assert.equal(normalizarBasePortal(""), "https://sistema-expedicoes.vercel.app");
  assert.equal(normalizarBasePortal(" https://a.b// "), "https://a.b");
});

test("código: 10 letras do alfabeto do antigo (sem ambíguos)", () => {
  assert.ok(codigoValido("abcdefghjk"));
  assert.ok(codigoValido("23456789ab"));
  assert.ok(!codigoValido("abcdefghij"), "i é ambíguo");
  assert.ok(!codigoValido("abc"));
  assert.ok(!codigoValido("ABCDEFGHJK"));
  assert.throws(() => montarLinkCurto("https://x", "l0l0l0l0l0"));
});

test("código do link: lê de volta", () => {
  assert.equal(codigoDoLink("https://p.x/a/abcdefghjk"), "abcdefghjk");
  assert.equal(codigoDoLink("https://p.x/a/abcdefghjk?x=1"), "abcdefghjk");
  assert.equal(codigoDoLink("https://p.x/amigo/acesso?t=abc.def"), null);
  assert.equal(codigoDoLink(null), null);
});

test("expiração: 30 dias, vencido, reaproveitável só com > 7 dias", () => {
  assert.equal(expiracaoDoLink(AGORA), em(DIAS_VALIDADE_LINK));
  assert.equal(linkExpirado(em(-0.01), AGORA), true);
  assert.equal(linkExpirado(em(1), AGORA), false);
  assert.equal(linkExpirado(null, AGORA), true);
  assert.equal(linkExpirado("lixo", AGORA), true);
  assert.equal(linkReaproveitavel(em(8), AGORA), true);
  assert.equal(linkReaproveitavel(em(7), AGORA), false);
  assert.equal(linkReaproveitavel(em(-1), AGORA), false);
  assert.equal(diasRestantesLink(em(29.5), AGORA), 29);
  assert.equal(diasRestantesLink(em(-3), AGORA), 0);
});

test("WhatsApp: DDI 55 só quando falta; DDD 55 (RS) não é confundido com DDI", () => {
  assert.equal(telefoneWhatsapp("(11) 98888-7777"), "5511988887777");
  assert.equal(telefoneWhatsapp("+55 11 98888-7777"), "5511988887777");
  assert.equal(telefoneWhatsapp("55 99999-8888"), "5555999998888");
  assert.equal(telefoneWhatsapp("1234"), null);
  assert.equal(montarLinkWhatsapp(null, "oi"), null);
  assert.equal(montarLinkWhatsapp("11988887777", "oi & tchau"), "https://wa.me/5511988887777?text=oi%20%26%20tchau");
});

test("CPF de master: 11 dígitos ou null", () => {
  assert.equal(cpfMaster("491.432.018-57"), "49143201857");
  assert.equal(cpfMaster("123"), null);
});
