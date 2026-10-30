// src/mkt/contexto.tsx
// -----------------------------------------------------------------------------
// Quem é quem no Marketing (0240): as pessoas da área, os papéis de cada uma
// (Orgânico / Tráfego / Gestor) e se quem está logado aprova. Um provider só,
// na casca (MarketingApp); as telas de todas as frentes usam useMkt().
// A regra de verdade (quem aprova, quem escreve) está no banco; isto é a tela.
// -----------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import type { PapelMkt } from "./menu";

export interface PessoaMkt { id: string; nome: string; role: string; papeis: PapelMkt[]; aprovador: boolean }

interface Valor {
  pessoas: PessoaMkt[];
  /** Papéis de quem está logado ([] = ainda sem papel definido). */
  meusPapeis: PapelMkt[];
  /** Quem está logado aprova (gestor de Marketing, gestor com o setor, admin). */
  aprovador: boolean;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
  nomeDe: (id: string | null | undefined) => string;
}

const Ctx = createContext<Valor | null>(null);

export function MktProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useQsAuth();
  const [pessoas, setPessoas] = useState<PessoaMkt[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("mkt_pessoas");
    if (error) setErro(error.message);
    else { setErro(null); setPessoas((data ?? []) as PessoaMkt[]); }
    setCarregando(false);
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);

  const valor = useMemo<Valor>(() => {
    const eu = pessoas.find((p) => p.id === currentUser?.id);
    const porId = new Map(pessoas.map((p) => [p.id, p.nome]));
    return {
      pessoas,
      meusPapeis: eu?.papeis ?? [],
      // Antes de carregar (ou se a 0240 ainda não foi aplicada): admin aprova, o resto não.
      aprovador: eu?.aprovador ?? currentUser?.role === "admin",
      carregando,
      erro,
      recarregar,
      nomeDe: (id) => (id ? porId.get(id) ?? "—" : "—"),
    };
  }, [pessoas, currentUser, carregando, erro, recarregar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useMkt(): Valor {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMkt fora do MktProvider (a tela precisa estar dentro da área Marketing).");
  return v;
}
