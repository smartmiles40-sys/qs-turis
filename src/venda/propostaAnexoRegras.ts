// src/venda/propostaAnexoRegras.ts
// -----------------------------------------------------------------------------
// As regras PURAS do anexo da proposta na venda (0295) — sem rede, pra testar
// (tests/venda/propostaAnexo.test.ts). O lado da rede é ./propostaAnexo.ts.
// -----------------------------------------------------------------------------
export const LIMITE_MB = 15;
export const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
export const ACEITA_PROPOSTA = "application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif";
export const MSG_SEM_PROPOSTA = "Anexe a proposta enviada ao cliente (PDF ou foto) — sem ela a venda não é registrada.";

/** Conferência do arquivo antes de subir. */
export function problemaNoArquivo(f: { name: string; size: number; type: string }): string | null {
  if (f.size > LIMITE_MB * 1024 * 1024) return `"${f.name}" passa de ${LIMITE_MB} MB.`;
  if (!EXT[f.type]) return `"${f.name}": mande PDF ou foto (JPG, PNG, WEBP, HEIC).`;
  return null;
}

/** A venda pode ser registrada? Precisa de 1+ proposta: já anexada ou escolhida agora. */
export function faltaProposta(jaAnexadas: number, novas: number): string | null {
  return jaAnexadas + novas > 0 ? null : MSG_SEM_PROPOSTA;
}

export function tamanhoLegivel(b: number | null | undefined): string {
  if (!b && b !== 0) return "";
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
