// src/mkt/grupos/contexto.tsx — o estado do chip do Marketing, lido UMA vez pela página
// de Grupos e usado pelas abas (selo no canto, intervalo pra estimar o tempo do envio,
// o chip, no Celular — que é só de grupos desde 09/11/2026).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { lerEstado, type EstadoChip } from "./lib";

interface Ctx { estado: EstadoChip | null; erro: string | null; recarregar: () => Promise<void> }
const C = createContext<Ctx>({ estado: null, erro: null, recarregar: async () => {} });

export function ChipProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoChip | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = useCallback(async () => {
    try { setEstado(await lerEstado()); setErro(null); } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);
  return <C.Provider value={{ estado, erro, recarregar }}>{children}</C.Provider>;
}

export const useChip = () => useContext(C);

/** Intervalo entre um grupo e outro (o da campanha vence o do chip). */
export function intervaloDoChip(estado: EstadoChip | null, campanha?: { intervalo_min_seg: number | null; intervalo_max_seg: number | null }) {
  const min = campanha?.intervalo_min_seg ?? estado?.conexao?.intervalo_min_seg ?? 20;
  const max = campanha?.intervalo_max_seg ?? estado?.conexao?.intervalo_max_seg ?? 45;
  return { min, max: Math.max(min, max) };
}
