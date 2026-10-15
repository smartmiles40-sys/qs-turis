// src/rel/lib/viagemIa.ts
// -----------------------------------------------------------------------------
// Revisão da viagem pela IA (0115 + api/rel-viagem-ia.js). A IA lê bilhetes,
// seguro e vouchers; o servidor cruza com a viagem e grava em
// rel_viagens.ia_revisao. Aqui só lemos o resultado e chamamos a rota.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type StatusRevisao = "ok" | "divergente" | "incompleta" | "erro";
export type CategoriaSeg = "voo_internacional" | "voo_interno" | "transfer" | "trem" | "hospedagem" | "passeio";

export interface SegmentoIa {
  categoria: CategoriaSeg;
  documento_id: string | null;
  fonte_leitura: "documento" | "bitrix";
  origem: string | null;
  destino: string | null;
  origem_pais: string | null;
  destino_pais: string | null;
  partida_em: string;
  chegada_em: string | null;
  companhia: string | null;
  numero: string | null;
  nome_local: string | null;
  classe: string | null;
  bagagem: string | null;
  localizador: string | null;
  confianca: number;
}

export interface LeituraIa {
  fonte: "documento" | "bitrix";
  documento_id: string | null;
  arquivo_nome: string | null;
  tipo_cadastro: string | null;
  erro?: string | null;
  lido_em?: string | null;
  lido: {
    legivel: boolean;
    tipo_detectado: string;
    passageiros: string[];
    localizador: string | null;
    seguro: { seguradora: string | null; apolice: string | null; vigencia_inicio: string | null; vigencia_fim: string | null; segurados: string[]; cobertura: string | null } | null;
    observacao: string | null;
  } | null;
}

export type AreaConformidade = "documentacao" | "passagens" | "roteiro";
export const AREAS_CONFORMIDADE: Record<AreaConformidade, string> = { documentacao: "Documentação", passagens: "Passagens", roteiro: "Roteiro" };

/** Quanto da venda bate (0139/v2): itens sim/não de documentação, passagens e roteiro. */
export interface Conformidade {
  pct: number;
  ok: number;
  total: number;
  areas: Record<AreaConformidade, { ok: number; total: number }>;
  itens: { area: AreaConformidade; texto: string; ok: boolean }[];
}

export interface RevisaoIa {
  versao: number;
  conformidade?: Conformidade;
  documentos: LeituraIa[];
  segmentos: SegmentoIa[];
  divergencias: { gravidade: "alta" | "media" | "baixa"; texto: string; documento_id: string | null }[];
  avisos: string[];
  passageiros_cobertos: { cliente_id: string; nome: string; bilhete: boolean; seguro: boolean }[];
  trechos?: { novos: number; completados: number; removidos: number };
  resumo: string;
  modelo?: string;
}

export interface EstadoRevisao { ia_revisao: RevisaoIa | null; ia_revisao_em: string | null; ia_revisao_status: StatusRevisao | null }

export const STATUS_REVISAO: Record<StatusRevisao, { txt: string; tom: "rel" | "aviso" | "erro" | "neutro" }> = {
  ok: { txt: "Revisada pela IA: tudo bate", tom: "rel" },
  divergente: { txt: "IA achou pontos pra conferir", tom: "erro" },
  incompleta: { txt: "Revisão incompleta", tom: "aviso" },
  erro: { txt: "IA não conseguiu revisar", tom: "aviso" },
};

export const CATEGORIA_SEG: Record<CategoriaSeg, string> = {
  voo_internacional: "Voo internacional",
  voo_interno: "Voo interno",
  transfer: "Transfer",
  trem: "Trem",
  hospedagem: "Hospedagem",
  passeio: "Passeio",
};

export async function carregarRevisao(viagemId: string): Promise<EstadoRevisao> {
  const { data, error } = await supabase.from("rel_viagens")
    .select("ia_revisao, ia_revisao_em, ia_revisao_status").eq("id", viagemId).maybeSingle();
  if (error) throw error;
  return (data ?? { ia_revisao: null, ia_revisao_em: null, ia_revisao_status: null }) as EstadoRevisao;
}

/** Revisa agora (pode levar até ~50 s). */
export async function revisarViagem(viagemId: string): Promise<{ status: StatusRevisao; ia_revisao: RevisaoIa }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/rel-viagem-ia", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ viagem_id: viagemId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (HTTP ${r.status}).`);
  return j as { status: StatusRevisao; ia_revisao: RevisaoIa };
}
