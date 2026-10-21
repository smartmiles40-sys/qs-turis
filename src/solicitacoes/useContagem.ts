// src/solicitacoes/useContagem.ts
// Bolinhas do menu da Central (0149): novas no setor, atrasadas (pro gestor) e
// novidades no que EU pedi (+ 0158: cotação esperando meu ajuste ou desfecho vencido). Recontagem a cada 30s com a aba aberta.
import { useCallback, useEffect, useState } from "react";
import { contarSolicitacoes, type Contagem, type Setor } from "./lib";

export function useContagemSolicitacoes(setor: Setor): [Contagem, () => void] {
  const [c, setC] = useState<Contagem>({ novas: 0, atrasadas: 0, comigo: 0, novidades: 0, ajustes: 0, desfechos: 0 });
  const contar = useCallback(() => { contarSolicitacoes(setor).then(setC).catch(() => undefined); }, [setor]);
  useEffect(() => {
    contar();
    const t = setInterval(() => { if (!document.hidden) contar(); }, 30_000);
    return () => clearInterval(t);
  }, [contar]);
  return [c, contar];
}

/** Número da bolinha: o que chegou + o que mudou no que eu pedi + desfecho vencido. Vermelho se tem atrasada. */
export function bolinhaDaCentral(c: Contagem): { badge?: number; alerta: boolean } {
  const n = c.novas + c.novidades + c.desfechos;
  return { badge: n || (c.atrasadas || undefined), alerta: c.atrasadas > 0 || c.desfechos > 0 };
}
