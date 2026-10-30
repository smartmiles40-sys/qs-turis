// src/mkt/grupos/useBases.ts — grupos, tags e vínculos (carregados uma vez por tela).
import { useCallback, useEffect, useState } from "react";
import { lerGrupos, lerLinks, lerTags, type Grupo, type Tag, type TagLink } from "./lib";

export interface Bases { grupos: Grupo[]; tags: Tag[]; links: TagLink[] }

export function useBases() {
  const [b, setB] = useState<Bases>({ grupos: [], tags: [], links: [] });
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const recarregar = useCallback(async () => {
    try {
      const [grupos, tags, links] = await Promise.all([lerGrupos(), lerTags(), lerLinks()]);
      setB({ grupos, tags, links }); setErro(null);
    } catch (e) { setErro((e as Error).message); }
    finally { setPronto(true); }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);
  return { ...b, erro, pronto, recarregar };
}
