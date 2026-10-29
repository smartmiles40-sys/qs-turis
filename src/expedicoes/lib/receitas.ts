// src/expedicoes/lib/receitas.ts
// Receitas médicas a emitir e enviar (Carol, 29/10 — app antigo fe8ff18/23fc68f).
// Marca-se na triagem da inscrição ("Preciso emitir e enviar a receita"); a 0223
// leva a marca pro passageiro na aprovação. A receita só entra na lista quando
// faltam ≤ 20 dias pro embarque; a data-limite é embarque − 20 dias.
import { addDays, format, parseISO } from "date-fns";
import { supabase, listarExpedicoes, traduzirErro } from "./banco";
import type { ExpedicaoRow } from "./database";

export const DIAS_JANELA_RECEITA = 20;

export interface Receita {
  passageiroId: string;
  nome: string;
  telefone: string | null;
  saude: Record<string, string>;
  exp: ExpedicaoRow;
  limite: string | null;
  /** dias até a data-limite (negativo = passou) */
  diasAteLimite: number | null;
  enviadaEm: string | null;
}

const diasEntre = (de: string, ate: string) => Math.round((parseISO(ate).getTime() - parseISO(de).getTime()) / 86_400_000);

/** Todas as receitas marcadas nas expedições que ainda não embarcaram (ou embarcam hoje). */
export async function listarReceitas(hoje: string): Promise<Receita[]> {
  const { data, error } = await supabase.from("passageiros")
    .select("id,nome_completo,telefone,saude,expedicao_id,receita_enviada_em")
    .eq("receita_pendente", true).limit(1000);
  if (error) throw new Error(traduzirErro(error.message));
  const exps = new Map((await listarExpedicoes()).map((e) => [e.id, e]));
  const out: Receita[] = [];
  for (const p of (data ?? []) as { id: string; nome_completo: string; telefone: string | null; saude: unknown; expedicao_id: string; receita_enviada_em: string | null }[]) {
    const exp = exps.get(p.expedicao_id);
    if (!exp || exp.status === "Cancelada") continue;
    if (exp.data_embarque && exp.data_embarque < hoje) continue;
    const limite = exp.data_embarque ? format(addDays(parseISO(exp.data_embarque), -DIAS_JANELA_RECEITA), "yyyy-MM-dd") : null;
    out.push({
      passageiroId: p.id, nome: p.nome_completo, telefone: p.telefone,
      saude: (p.saude && typeof p.saude === "object" ? p.saude : {}) as Record<string, string>,
      exp, limite, diasAteLimite: limite ? diasEntre(hoje, limite) : null, enviadaEm: p.receita_enviada_em,
    });
  }
  return out.sort((a, b) => (a.exp.data_embarque ?? "9999").localeCompare(b.exp.data_embarque ?? "9999") || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Está na janela (≤ 20 dias pro embarque)? */
export const naJanela = (r: Receita) => r.diasAteLimite != null && r.diasAteLimite <= 0;

export async function definirReceita(passageiroId: string, mudanca: { pendente?: boolean; enviada?: boolean }): Promise<void> {
  const { error } = await supabase.rpc("exp_receita_definir", {
    p_passageiro: passageiroId, p_pendente: mudanca.pendente ?? null, p_enviada: mudanca.enviada ?? null,
  });
  if (error) throw new Error(traduzirErro(error.message));
}
