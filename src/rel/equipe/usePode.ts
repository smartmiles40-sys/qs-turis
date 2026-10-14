// src/rel/equipe/usePode.ts
// -----------------------------------------------------------------------------
// O que EU posso, pelo cargo (0135). A regra mora no banco (qs_pode): admin e
// gestor(a) da área podem tudo; quem tem cargo, o que está marcado nele; quem
// não tem cargo, o padrão de hoje. Aqui só se ESCONDE botão — quem barra de
// verdade é o banco.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { supabase } from "@/lib/supabase";
import type { Permissao } from "./cargos";

// null = não deu pra ler (rede): a tela NÃO conclui que a pessoa não pode.
const cache = new Map<string, Promise<Set<string> | null>>();

function minhas(userId: string): Promise<Set<string> | null> {
  let p = cache.get(userId);
  if (!p) {
    p = Promise.resolve(supabase.rpc("qs_minhas_permissoes")).then(({ data, error }) => {
      if (error) { cache.delete(userId); return null; }
      return new Set<string>((data as string[] | null) ?? []);
    });
    cache.set(userId, p);
  }
  return p;
}

/** Esquece o que foi lido (ex.: depois de mudar o cargo de alguém). */
export function esquecerPermissoes() { cache.clear(); }

/**
 * `null` enquanto carrega. Admin já responde `true` na hora, sem esperar.
 */
export function usePode(p: Permissao): boolean | null {
  const { currentUser } = useQsAuth();
  const id = currentUser?.id ?? "";
  const admin = currentUser?.role === "admin";
  const [pode, setPode] = useState<boolean | null>(admin ? true : null);
  useEffect(() => {
    if (!id) { setPode(false); return; }
    if (admin) { setPode(true); return; }
    let vivo = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    // Falhou a leitura: continua "carregando" e tenta de novo em 5s, em vez de
    // esconder botões de quem tem a permissão.
    const ler = () => void minhas(id).then((s) => {
      if (!vivo) return;
      if (s) setPode(s.has(p)); else t = setTimeout(ler, 5000);
    });
    ler();
    return () => { vivo = false; if (t) clearTimeout(t); };
  }, [id, admin, p]);
  return pode;
}
