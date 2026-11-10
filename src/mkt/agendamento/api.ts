// src/mkt/agendamento/api.ts — conversa da tela "Links de agendamento" (0354).
// Direto no banco, com a RLS da 0354 (mkt_tem_acesso) decidindo quem pode.
import { supabase } from "@/lib/supabase";
import { linhaDoForm, novoCodigo, type LinkForm, type LinkSalvo } from "./regras";

export interface LinkAgendamento extends LinkSalvo {
  id: string;
  nome: string;
  criado_em: string;
  criado_por: string | null;
  arquivado_em: string | null;
}
export interface ResumoLink { link_id: string; agendados: number; ultimos_7d: number; realizadas: number; no_show: number; ultimo_em: string | null }
export interface UsoLink { id: string; tipo: string; quando: string | null; criado_em: string; lead_id: string | null; meeting_id: string | null }

const FALTA_0354 = "A tela de links ainda não está ligada no banco (falta aplicar a 0354).";
const erroLegivel = (e: { message?: string; code?: string } | null) =>
  e && (e.code === "42P01" || e.code === "PGRST205" || /mkt_links_agendamento/.test(e.message || "") && /does not exist|schema cache/.test(e.message || ""))
    ? FALTA_0354 : e?.message || "Falhou.";

export async function lerLinks(): Promise<LinkAgendamento[]> {
  const { data, error } = await supabase.from("mkt_links_agendamento").select("*").order("criado_em", { ascending: false });
  if (error) throw new Error(erroLegivel(error));
  return (data ?? []) as LinkAgendamento[];
}

export async function lerResumo(): Promise<Map<string, ResumoLink>> {
  const { data, error } = await supabase.rpc("mkt_links_agendamento_resumo");
  if (error) return new Map(); // o resumo é enfeite: sem ele a lista aparece igual
  return new Map(((data ?? []) as ResumoLink[]).map((r) => [r.link_id, r]));
}

export async function lerUsos(linkId: string): Promise<UsoLink[]> {
  const { data, error } = await supabase.from("mkt_link_agendamento_usos")
    .select("id,tipo,quando,criado_em,lead_id,meeting_id").eq("link_id", linkId).order("criado_em", { ascending: false }).limit(200);
  if (error) throw new Error(erroLegivel(error));
  return (data ?? []) as UsoLink[];
}

/** Cria (código novo) ou edita (o código NÃO muda: a URL já pode estar publicada). */
export async function salvarLink(f: LinkForm, id?: string | null): Promise<LinkAgendamento> {
  const linha = linhaDoForm(f);
  if (id) {
    const { data, error } = await supabase.from("mkt_links_agendamento")
      .update({ ...linha, atualizado_em: new Date().toISOString() }).eq("id", id).select("*").single();
    if (error) throw new Error(erroLegivel(error));
    return data as LinkAgendamento;
  }
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data, error } = await supabase.from("mkt_links_agendamento")
      .insert({ ...linha, codigo: novoCodigo(f.nome) }).select("*").single();
    if (!error) return data as LinkAgendamento;
    if (error.code !== "23505") throw new Error(erroLegivel(error)); // 23505 = código repetido → sorteia outro
  }
  throw new Error("Não consegui gerar um código único. Tente de novo.");
}

export async function arquivarLink(id: string, arquivar: boolean): Promise<void> {
  const { error } = await supabase.from("mkt_links_agendamento")
    .update({ arquivado_em: arquivar ? new Date().toISOString() : null, atualizado_em: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(erroLegivel(error));
}

/** Nomes das expedições abertas (sugestão do campo; o campo continua livre). */
export async function sugestoesDeExpedicao(): Promise<string[]> {
  const { data } = await supabase.from("expedicoes").select("nome,status,data_embarque")
    .in("status", ["Planejamento", "Vendas Abertas", "Em andamento"]).order("data_embarque", { ascending: true }).limit(100);
  const nomes = ((data ?? []) as { nome: string | null }[]).map((e) => (e.nome || "").trim()).filter(Boolean);
  return [...new Set(nomes)];
}
