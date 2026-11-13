// src/mkt/contexto.tsx
// -----------------------------------------------------------------------------
// Quem é quem no Marketing (0240): as pessoas da área, os papéis de cada uma
// (Orgânico / Tráfego / Supervisores / Gestor) e se quem está logado aprova.
// Um provider só, na casca (MarketingApp); as telas de todas as frentes usam useMkt().
// A regra de verdade (quem aprova, quem escreve) está no banco; isto é a tela.
//
// 13/11/2026: VISÃO por time (menu.ts). A visão escolhida fica no navegador
// (qs_mkt_visao) — é conveniência; o padrão vem dos papéis.
// -----------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { visaoValida, visoesDe, type PapelMkt, type TimeMkt, type VisaoMkt } from "./menu";

export interface PessoaMkt { id: string; nome: string; role: string; papeis: PapelMkt[]; aprovador: boolean }

interface Valor {
  pessoas: PessoaMkt[];
  /** Papéis de quem está logado ([] = ainda sem papel definido). */
  meusPapeis: PapelMkt[];
  /** Quem está logado aprova cards (gestor de Marketing, gestor com o setor, admin — e, com a 0266, o time). */
  aprovador: boolean;
  /** Gestor de Marketing (admin, gestor do QS ou papel 'gestor'). Espelho de mkt_eh_gestor. */
  gestor: boolean;
  /** Supervisor do time (ou gestor). Espelho de mkt_eh_supervisor. */
  supervisorDe: (time: TimeMkt) => boolean;
  /** Visão do menu (Orgânico / Tráfego / Tudo) e as que a pessoa pode escolher. */
  visao: VisaoMkt;
  visoes: VisaoMkt[];
  mudarVisao: (v: VisaoMkt) => void;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
  nomeDe: (id: string | null | undefined) => string;
}

const Ctx = createContext<Valor | null>(null);
const CHAVE_VISAO = "qs_mkt_visao";

function lerVisao(): string | null {
  try { return localStorage.getItem(CHAVE_VISAO); } catch { return null; }
}

export function MktProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useQsAuth();
  const [pessoas, setPessoas] = useState<PessoaMkt[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [visaoGuardada, setVisaoGuardada] = useState<string | null>(lerVisao);

  const recarregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("mkt_pessoas");
    if (error) setErro(error.message);
    else { setErro(null); setPessoas((data ?? []) as PessoaMkt[]); }
    setCarregando(false);
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);

  const mudarVisao = useCallback((v: VisaoMkt) => {
    setVisaoGuardada(v);
    try { localStorage.setItem(CHAVE_VISAO, v); } catch { /* aba anônima: só não lembra */ }
  }, []);

  const valor = useMemo<Valor>(() => {
    const eu = pessoas.find((p) => p.id === currentUser?.id);
    const porId = new Map(pessoas.map((p) => [p.id, p.nome]));
    const meusPapeis = eu?.papeis ?? [];
    const role = currentUser?.role;
    const gestor = role === "admin" || role === "gestor" || meusPapeis.includes("gestor");
    const visoes = visoesDe(meusPapeis, gestor);
    return {
      pessoas,
      meusPapeis,
      // Antes de carregar (ou se a 0240 ainda não foi aplicada): admin aprova, o resto não.
      aprovador: eu?.aprovador ?? role === "admin",
      gestor,
      supervisorDe: (t) => gestor || meusPapeis.includes(`sup_${t}` as PapelMkt),
      visao: visaoValida(visaoGuardada, visoes),
      visoes,
      mudarVisao,
      carregando,
      erro,
      recarregar,
      nomeDe: (id) => (id ? porId.get(id) ?? "—" : "—"),
    };
  }, [pessoas, currentUser, carregando, erro, recarregar, visaoGuardada, mudarVisao]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useMkt(): Valor {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMkt fora do MktProvider (a tela precisa estar dentro da área Marketing).");
  return v;
}
