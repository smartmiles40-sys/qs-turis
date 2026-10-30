// src/expedicoes/useContagemSaude.ts
// Selo do item "Saúde · médico" no menu de Operações (30/10): laudos ainda a fazer
// ou em andamento de quem embarca em até 45 dias. Mesma leitura da tela
// (lib/saudeFila.ts), só que 3 s depois de abrir (não disputa rede com a tela) e
// de novo quando um laudo muda ou a cada meia hora. Falha calada (sem acesso → 0).
import { useCallback, useEffect, useRef, useState } from "react";
import { useAoVivo } from "./ui";
import { carregarFila, pendenteMedico } from "./lib/saudeFila";
import { dataSP } from "./lib/fase.ts";

export const DIAS_SELO_SAUDE = 45;

export function useContagemSaude(): number {
  const [n, setN] = useState(0);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const contar = useCallback(async () => {
    try {
      const { casos } = await carregarFila(dataSP(new Date()));
      if (vivo.current) setN(casos.filter((c) => pendenteMedico(c) && (c.dias ?? 999) <= DIAS_SELO_SAUDE).length);
    } catch { /* sem acesso ou rede fora */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void contar(); }, 3000);
    const i = setInterval(() => { void contar(); }, 30 * 60 * 1000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [contar]);
  useAoVivo([{ tabela: "cad_laudos_medicos" }], contar, 2000);
  return n;
}
