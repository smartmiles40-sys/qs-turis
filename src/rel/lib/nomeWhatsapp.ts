// src/rel/lib/nomeWhatsapp.ts
// -----------------------------------------------------------------------------
// NOME DO WHATSAPP × NOME DA FICHA (Bruno, 18/11/2026)
//   O Rel mandou mensagem chamando a pessoa errada: o número estava na ficha da
//   mãe/do marido, e a tela só mostrava o nome da ficha. A Meta manda o nome do
//   perfil (rel_wa_conversas.nome_contato) — aqui decide se ele "não bate".
//
// Não bate = o 1º nome do WhatsApp não aparece na ficha nem como começo de
// palavra (Gabi → Gabriela, Paty → Patrícia, Laize → Laise passam). Nome de
// perfil sem letras suficientes ("A.T", emoji) não acusa nada.
// -----------------------------------------------------------------------------

const semAcento = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const palavras = (s: string | null | undefined) =>
  semAcento(String(s || "")).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

const TITULOS = new Set(["dr", "dra", "drs", "dro", "sr", "sra", "srta", "prof", "profa", "pastor", "pra", "tia", "tio", "dona", "seu"]);

/** true = o nome do perfil do WhatsApp parece ser de OUTRA pessoa que não a da ficha. */
export function nomeWhatsNaoBate(nomeWhats: string | null | undefined, nomeFicha: string | null | undefined): boolean {
  const w = palavras(nomeWhats).find((p) => p.length >= 3 && !TITULOS.has(p));
  const f = palavras(nomeFicha);
  if (!w || f.length === 0) return false;
  const raiz = w.slice(0, 3);
  return !f.some((p) => p.startsWith(raiz));
}
