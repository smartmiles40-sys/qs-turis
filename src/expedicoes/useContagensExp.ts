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
import { listarReceitas, naJanela } from "./lib/receitas";
import { dataSP } from "./lib/fase.ts";
import { contarNovasVendas } from "./lib/novasVendas";

const ESPERA_INICIAL_MS = 3000;
const SOSSEGO_AVISOS_MS = 30_000;

// 16/11 (Bruno, limpeza): "Avisos" saiu do menu de Operações (já mora dentro da
// expedição) e "Receitas" já tinha saído em 30/10 — as duas contas (a dos avisos era
// a mais pesada do menu) não rodam mais. Ficam Inscrições e Novas vendas.
export function useContagensExp(): { inscricoes: number; novasVendas: number } {
  const [inscricoes, setInscricoes] = useState(0);
  const [novasVendas, setNovasVendas] = useState(0);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const contarInscricoes = useCallback(async () => {
    const { count, error } = await supabase.from("inscricoes_pendentes").select("id", { count: "exact", head: true }).eq("status", "pendente");
    if (!error && vivo.current) setInscricoes(count ?? 0);
  }, []);

  // Novas vendas (0317): passageiros com nova_venda=true. Sem a coluna, a conta dá 0.
  const contarNovas = useCallback(async () => {
    const n = await contarNovasVendas();
    if (vivo.current) setNovasVendas(n);
  }, []);

  useEffect(() => {
    void contarInscricoes();
    void contarNovas();
    const t = setInterval(() => { void contarInscricoes(); void contarNovas(); }, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [contarInscricoes, contarNovas]);

  useAoVivo([{ tabela: "inscricoes_pendentes" }], contarInscricoes, 800);
  useAoVivo([{ tabela: "passageiros" }], contarNovas, 5000);

  return { inscricoes, novasVendas };
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
