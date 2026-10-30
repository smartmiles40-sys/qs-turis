// src/mkt/email/contexto.tsx — estado da conexão (Resend) compartilhado pelas abas
// da página E-mail: o selo do canto, o estado vazio "como conectar" e as telas
// que precisam do remetente/rodapé padrão leem daqui (uma chamada só).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { status as lerStatus, type StatusConexao } from "./lib/api";

interface CtxEmail {
  cfg: StatusConexao | null;
  carregando: boolean;
  /** Mensagem quando nem deu pra conferir (API fora, sessão…). Tela mostra o passo a passo, não erro. */
  falhou: string | null;
  /** Chave do Resend guardada. */
  conectado: boolean;
  /** Conectado e sem nada faltando (domínio, webhook, remetente…). */
  pronto: boolean;
  /** Só admin e o papel marketing conectam o Resend (regra da /api/mkt-email). */
  podeConectar: boolean;
  recarregar: () => Promise<void>;
  abrirConexao: () => void;
}

const Ctx = createContext<CtxEmail | null>(null);

export function EmailProvider({ children, onAbrirConexao }: { children: ReactNode; onAbrirConexao: () => void }) {
  const { currentUser } = useQsAuth();
  const [cfg, setCfg] = useState<StatusConexao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try { setCfg(await lerStatus()); setFalhou(null); }
    catch (e) { setFalhou((e as Error).message); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);

  const conectado = Boolean(cfg?.conectado);
  const valor: CtxEmail = {
    cfg, carregando, falhou, conectado,
    pronto: conectado && (cfg?.faltando.length ?? 1) === 0,
    podeConectar: currentUser?.role === "admin" || currentUser?.role === "marketing",
    recarregar, abrirConexao: onAbrirConexao,
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEmail(): CtxEmail {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEmail fora do EmailProvider");
  return c;
}
