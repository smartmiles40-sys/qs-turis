// src/lib/instagram.ts
// @ do Instagram do lead (qs_leads.instagram, migração 0418).
// Aceita "@maria", "maria", "instagram.com/maria", "https://www.instagram.com/maria/?hl=pt"
// e devolve só o usuário ("maria"). Inválido/vazio → null.
// Espelho em api/_leads.js (instagramDoLead) — manter as duas iguais.

export function normalizarInstagram(raw: string | null | undefined): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.|m\.)?instagram\.com\//i, "").replace(/^@+/, "");
  s = s.split(/[/?#]/)[0].toLowerCase(); // com espaço = nome digitado, não @ → recusa
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}

export const urlDoInstagram = (usuario: string) => `https://www.instagram.com/${usuario}/`;
