// src/mkt/grupos/useBases.ts — grupos, tags e vínculos (carregados uma vez por tela).
import { useEffect, useState } from "react";
import { lerGrupos, lerLinks, lerTags, type Grupo, type Tag, type TagLink } from "./lib";

export interface Bases { grupos: Grupo[]; tags: Tag[]; links: TagLink[] }

export function useBases() {
  const [b, setB] = useState<Bases>({ grupos: [], tags: [], links: [] });
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([lerGrupos(), lerTags(), lerLinks()])
      .then(([grupos, tags, links]) => setB({ grupos, tags, links }))
      .catch((e) => setErro((e as Error).message));
  }, []);
  return { ...b, erro };
}
