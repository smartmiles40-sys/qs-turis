// src/expedicoes/useContagensExp.ts
// Números dos selos do menu das Expedições (app antigo: app/(app)/layout.tsx →
// getContagemAlertas + contarInscricoesPendentes):
//  - avisos: mesma conta da página Avisos (exigência pendente dentro da janela, nas
//    expedições em grupo ativas que ainda não embarcaram);
//  - inscricoes: inscrições do formulário público com status 'pendente'.
// Não depende do ExpProvider — pode ser usado no menu.
//
// 22/10 (leveza): este hook roda em TODA tela de Operações (até na Central de
// Solicitações). Antes: baixava a linha inteira dos ~400 passageiros futuros
// (~0,7 MB) + requisitos em fila, logo ao abrir, e refazia tudo 3 s depois de
// QUALQUER edição em passageiros/requisitos/expedições de qualquer pessoa.
// Agora:
//  - a conta lê só as colunas da regra (carregarProntidaoAtivas leve) e a leitura
//    é a MESMA da página Avisos (guardada 60 s);
//  - a 1ª conta espera a tela abrir (3 s) pra não disputar rede com ela;
//  - mudança em passageiros/requisitos/expedições só recalcula depois de 30 s de
//    sossego (rajada de edição = uma conta); fora isso, de meia em meia hora
//    (a janela dos avisos anda com o dia).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./lib/banco";
import { useAoVivo } from "./ui";
import { calcularAlertas, carregarProntidaoAtivas } from "./paginas/_globais/prontidaoGlobal";

const ESPERA_INICIAL_MS = 3000;
const SOSSEGO_AVISOS_MS = 30_000;

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
    void contarInscricoes();
    const primeira = setTimeout(() => { void contarAvisos(); }, ESPERA_INICIAL_MS);
    const t = setInterval(() => { void contarAvisos(); void contarInscricoes(); }, 30 * 60 * 1000);
    return () => { clearTimeout(primeira); clearInterval(t); };
  }, [contarAvisos, contarInscricoes]);

  useAoVivo([{ tabela: "passageiros" }, { tabela: "passageiro_requisitos" }, { tabela: "expedicoes" }], contarAvisos, SOSSEGO_AVISOS_MS);
  useAoVivo([{ tabela: "inscricoes_pendentes" }], contarInscricoes, 800);

  return { avisos, inscricoes };
}
