/**
 * Ordenação cronológica dos voos de grupo (aba ExpedAmigo + portal).
 *
 * O campo `partida` é texto livre, mas na prática vem como "DD/MM/AAAA HH:MM"
 * (ex.: "19/09/2026 01:05", "29/09/2026 17:35h"). Extraímos a data/hora daí e
 * ordenamos por ela — assim o voo interno entra no lugar certo da linha do tempo,
 * independentemente da ordem em que foi cadastrado.
 *
 * Voos sem data reconhecível (ex.: "Último dia · 08:30") caem para o fim, na
 * ordem de cadastro — então expedições que não usam data completa não mudam.
 */
export function parseDataVooMs(partida: string | null | undefined): number | null {
  if (!partida) return null;
  const m = partida.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const yy = y.length === 2 ? 2000 + Number(y) : Number(y);
  const ts = new Date(yy, Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0)).getTime();
  return Number.isNaN(ts) ? null : ts;
}

export function ordenarVoosCronologico<
  T extends { partida: string | null; ordem: number; created_at: string },
>(voos: T[]): T[] {
  return [...voos].sort((a, b) => {
    const ta = parseDataVooMs(a.partida);
    const tb = parseDataVooMs(b.partida);
    if (ta != null && tb != null) return ta - tb || a.ordem - b.ordem;
    if (ta != null) return -1; // voos com data vêm antes dos sem data
    if (tb != null) return 1;
    return a.ordem - b.ordem || a.created_at.localeCompare(b.created_at);
  });
}
