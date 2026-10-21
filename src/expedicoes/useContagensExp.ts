// src/expedicoes/useContagensExp.ts
// Números dos selos do menu das Expedições (app antigo: app/(app)/layout.tsx →
// getContagemAlertas + contarInscricoesPendentes):
//  - avisos: mesma conta da página Avisos (exigência pendente dentro da janela, nas
//    expedições em grupo ativas que ainda não embarcaram);
//  - inscricoes: inscrições do formulário público com status 'pendente'.
// Atualiza sozinho (realtime) e de meia em meia hora (a janela dos avisos anda com o dia).
// Não depende do ExpProvider — pode ser usado no menu.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./lib/banco";
import { useAoVivo } from "./ui";
import { calcularAlertas, carregarProntidaoAtivas } from "./paginas/_globais/prontidaoGlobal";

export function useContagensExp(): { avisos: number; inscricoes: number } {
  const [avisos, setAvisos] = useState(0);
  const [inscricoes, setInscricoes] = useState(0);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const contarAvisos = useCallback(async () => {
    try {
      const n = calcularAlertas(await carregarProntidaoAtivas({ soFuturas: true })).length;
      if (vivo.current) setAvisos(n);
    } catch { /* sem acesso às Expedições ou rede fora: mantém o último número */ }
  }, []);

  const contarInscricoes = useCallback(async () => {
    const { count, error } = await supabase.from("inscricoes_pendentes").select("id", { count: "exact", head: true }).eq("status", "pendente");
    if (!error && vivo.current) setInscricoes(count ?? 0);
  }, []);

  useEffect(() => {
    void contarAvisos(); void contarInscricoes();
    const t = setInterval(() => { void contarAvisos(); void contarInscricoes(); }, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [contarAvisos, contarInscricoes]);

  useAoVivo([{ tabela: "passageiros" }, { tabela: "passageiro_requisitos" }, { tabela: "expedicoes" }], contarAvisos, 3000);
  useAoVivo([{ tabela: "inscricoes_pendentes" }], contarInscricoes, 800);

  return { avisos, inscricoes };
}
