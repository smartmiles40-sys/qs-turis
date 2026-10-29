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
import { listarReceitas, naJanela } from "./lib/receitas";
import { dataSP } from "./lib/fase.ts";

const ESPERA_INICIAL_MS = 3000;
const SOSSEGO_AVISOS_MS = 30_000;

export function useContagensExp(): { avisos: number; inscricoes: number; receitas: number } {
  const [avisos, setAvisos] = useState(0);
  const [receitas, setReceitas] = useState(0);
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

  // Receitas (0223): na janela de 20 dias e ainda não enviadas. Sem a 0223 a coluna
  // não existe e a conta falha calada (fica 0).
  const contarReceitas = useCallback(async () => {
    try {
      const n = (await listarReceitas(dataSP(new Date()))).filter((r) => naJanela(r) && !r.enviadaEm).length;
      if (vivo.current) setReceitas(n);
    } catch { /* sem 0223 ou sem acesso */ }
  }, []);

  useEffect(() => {
    void contarInscricoes();
    const primeiraReceita = setTimeout(() => { void contarReceitas(); }, ESPERA_INICIAL_MS);
    const primeira = setTimeout(() => { void contarAvisos(); }, ESPERA_INICIAL_MS);
    const t = setInterval(() => { void contarAvisos(); void contarInscricoes(); void contarReceitas(); }, 30 * 60 * 1000);
    return () => { clearTimeout(primeira); clearTimeout(primeiraReceita); clearInterval(t); };
  }, [contarAvisos, contarInscricoes, contarReceitas]);

  useAoVivo([{ tabela: "passageiros" }, { tabela: "passageiro_requisitos" }, { tabela: "expedicoes" }], contarAvisos, SOSSEGO_AVISOS_MS);
  useAoVivo([{ tabela: "inscricoes_pendentes" }], contarInscricoes, 800);
  useAoVivo([{ tabela: "passageiros" }], contarReceitas, SOSSEGO_AVISOS_MS);

  return { avisos, inscricoes, receitas };
}

/** Só o número de Receitas (menu do Relacionamento, onde a Carol trabalha) — sem a conta pesada dos avisos. */
export function useContagemReceitas(ativo = true): number {
  const [n, setN] = useState(0);
  const contar = useCallback(async () => {
    if (!ativo) return;
    try { setN((await listarReceitas(dataSP(new Date()))).filter((r) => naJanela(r) && !r.enviadaEm).length); }
    catch { /* sem 0223 ou sem acesso às Expedições */ }
  }, [ativo]);
  useEffect(() => { const t = setTimeout(() => { void contar(); }, ESPERA_INICIAL_MS); return () => clearTimeout(t); }, [contar]);
  useAoVivo([{ tabela: "passageiros" }], contar, SOSSEGO_AVISOS_MS);
  return n;
}
