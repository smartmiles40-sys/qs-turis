// src/lib/escala.ts
// O QS inteiro roda com `zoom` no <html> (Bruno, 16/11: "tudo está muito grande").
// O fator mora em --qs-zoom no index.css (0.9 no computador, 1 no celular).
//
// Por que este arquivo existe: com zoom no <html>, o navegador entrega
// clientX/clientY, getBoundingClientRect() e window.innerWidth/innerHeight em
// pixels da TELA, mas `style={{ top, left, width }}` é lido em pixels do QS
// (que depois encolhem 10%). Quem posiciona algo "fixed" a partir do mouse ou
// de um retângulo, ou converte distância do mouse em minutos/pixels, precisa
// dividir pela escala — senão o menu abre 10% fora do lugar.

/** Fator de zoom aplicado ao <html> (1 = sem zoom). */
export function escalaTela(): number {
  if (typeof document === "undefined") return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || "1");
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** Converte pixels da tela (clientX, rect, innerWidth) em pixels do QS. */
export function px(v: number): number {
  return v / escalaTela();
}

/** Largura da janela em pixels do QS (pra limitar coisas "fixed" na borda). */
export function larguraTela(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth / escalaTela();
}

/** Altura da janela em pixels do QS. */
export function alturaTela(): number {
  return typeof window === "undefined" ? 900 : window.innerHeight / escalaTela();
}

/** Modificador do @dnd-kit: o item arrastado acompanha o mouse mesmo com zoom. */
export function corrigirZoomDnd<T extends { transform: { x: number; y: number; scaleX: number; scaleY: number } }>(
  args: T,
): T["transform"] {
  const z = escalaTela();
  return z === 1 ? args.transform : { ...args.transform, x: args.transform.x / z, y: args.transform.y / z };
}
