// src/rel/lib/docsIa.ts
// -----------------------------------------------------------------------------
// Conferência dos documentos pela IA (0106 + api/rel-docs-ia.js).
// A IA lê o documento; o servidor compara com a ficha e grava o resultado em
// rel_documentos (ia_status, ia_resultado, ia_em). Aqui só chamamos a rota e
// aplicamos as SUGESTÕES quando o time clica em "Usar no cadastro".
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Documento } from "./viagens";

export type IaStatus = "pendente" | "ok" | "divergente" | "ilegivel" | "erro";

export interface IaDivergencia { campo: string; cadastro: string | null; documento: string | null }
export interface IaSugestao {
  alvo: "cliente" | "documento";
  campo: "cpf" | "passaporte" | "nascimento" | "passaporte_validade" | "validade";
  valor: string;
  rotulo: string;
}
export interface IaResultado {
  campos_lidos: Record<string, string | null> | null;
  divergencias: IaDivergencia[];
  alertas: string[];
  sugestoes: IaSugestao[];
  resumo: string;
  /** Erro passageiro: o servidor tenta de novo (até 3x). */
  repetir?: boolean;
  tentativas?: number;
}

export type DocumentoIa = Documento & {
  ia_status: IaStatus | null;
  ia_resultado: IaResultado | null;
  ia_em: string | null;
};

/** Tipos que a IA confere (os outros — voucher, contrato, foto… — não). */
export const TIPOS_CONFERIDOS = ["passaporte", "rg_cnh", "visto", "vacina", "seguro"] as const;
export const conferivel = (d: Documento) => (TIPOS_CONFERIDOS as readonly string[]).includes(d.tipo);

/** Precisa conferir: nunca conferido ou o arquivo chegou depois da última conferência. */
export const precisaConferir = (d: DocumentoIa) =>
  conferivel(d) && d.status !== "recusado" && (!d.ia_em || new Date(d.enviado_em) > new Date(d.ia_em)
    // erro passageiro (timeout, OpenAI fora): volta pra fila até 3 tentativas — igual ao servidor
    || (d.ia_status === "erro" && d.ia_resultado?.repetir === true && (d.ia_resultado.tentativas ?? 1) < 3));

export const ROTULO_CAMPO: Record<string, string> = {
  tipo: "Tipo do documento", nome: "Nome", cpf: "CPF", passaporte: "Nº do passaporte",
  nascimento: "Nascimento", validade: "Validade", passaporte_validade: "Validade do passaporte (ficha)",
};

async function api<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/rel-docs-ia", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (HTTP ${r.status}).`);
  return j as T;
}

export function conferirDocumento(documentoId: string) {
  return api<{ id: string; status: IaStatus; resultado?: IaResultado }>({ documento_id: documentoId });
}

export interface ResumoLote { conferidos: number; ok: number; divergentes: number; ilegiveis: number; erros: number; restam: number; aviso?: string }
export function conferirPendentes(filtro: { clienteId?: string; viagemId?: string | null }) {
  return api<ResumoLote>({ acao: "pendentes", cliente_id: filtro.clienteId, viagem_id: filtro.viagemId || undefined });
}

/** "Usar no cadastro": grava a sugestão na ficha (ou na validade do documento). */
export async function aplicarSugestao(doc: DocumentoIa, s: IaSugestao) {
  let jaTinha = false;
  if (s.alvo === "documento") {
    const { data, error } = await supabase.from("rel_documentos").update({ validade: s.valor }).eq("id", doc.id).select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Não consegui gravar a validade (documento não encontrado ou sem permissão).");
  } else {
    // Só preenche se a ficha ainda estiver vazia — nunca sobrescreve.
    const { data, error } = await supabase.from("rel_clientes").update({ [s.campo]: s.valor }).eq("id", doc.cliente_id).is(s.campo, null).select("id");
    if (error) throw error;
    jaTinha = !data?.length; // 0 linhas = alguém preencheu antes (ou a ficha foi juntada)
  }
  // tira a sugestão do resultado guardado (aplicada, ou que não vale mais)
  if (doc.ia_resultado) {
    const resto = doc.ia_resultado.sugestoes.filter((x) => !(x.alvo === s.alvo && x.campo === s.campo));
    const { error } = await supabase.from("rel_documentos").update({ ia_resultado: { ...doc.ia_resultado, sugestoes: resto } }).eq("id", doc.id);
    if (error) throw new Error(`Gravou na ficha, mas não consegui tirar a sugestão da lista (${error.message}).`);
  }
  if (jaTinha) throw new Error("A ficha já tinha esse campo preenchido — nada foi mudado. Confira a ficha se o valor do documento for diferente.");
}
