// src/expedicoes/lib/saudeFila.ts
// -----------------------------------------------------------------------------
// SAÚDE DOS VIAJANTES (Bruno, 30/10): o que o formulário de inscrição respondeu,
// lido de `passageiros.saude` (jsonb, perguntas em lib/saude.ts), separado em:
//  · CLÍNICO   → vai pra fila do médico (laudo, acompanhamento, apto a viajar);
//  · ALIMENTAR → aviso pra logística (restaurante / fornecedor);
//  · LEVE      → enjoo, medo de altura, sono: só aparece como etiqueta.
// Também conta quem já respondeu o formulário × quem falta, por expedição/pacote.
//
// Laudos (0225, cad_laudos_medicos): sem a migration a leitura falha calada e a
// fila mostra tudo como "a fazer" sem deixar salvar (temLaudos = false).
// -----------------------------------------------------------------------------
import { supabase, lerPorIds, listarExpedicoes, traduzirErro } from "./banco";
import { preencheuFormulario } from "../passageiros/dados";
import { PERGUNTAS_SAUDE } from "./saude";
import type { ExpedicaoRow, PassageiroRow } from "./database";

export const CAMPOS_CLINICOS = ["problema_saude", "medicamento_diario", "alergia_medicamento", "anafilaxia_emergencia", "limitacao_fisica", "cirurgia_importante", "gravidez"] as const;
export const CAMPOS_ALIMENTARES = ["alergia_alimentar", "restricao_alimentar"] as const;
export const CAMPOS_LEVES = ["enjoo_transporte", "medo_altura", "ronca_cpap"] as const;

export type StatusLaudo = "a_fazer" | "em_andamento" | "emitido" | "dispensado";
export type Apto = "sim" | "nao" | "ressalvas";
export const ROTULO_STATUS: Record<StatusLaudo, string> = { a_fazer: "A fazer", em_andamento: "Em andamento", emitido: "Emitido", dispensado: "Dispensado" };
export const ROTULO_APTO: Record<Apto, string> = { sim: "Apto", nao: "Não apto", ressalvas: "Apto com ressalvas" };

export interface Laudo {
  id: string; cliente_id: string | null; passageiro_id: string | null; expedicao_id: string | null;
  status: StatusLaudo; apto: Apto | null; ressalvas: string | null; parecer: string | null;
  arquivo_path: string | null; arquivo_nome: string | null; arquivo_mime: string | null; arquivo_bytes: number | null;
  emitido_em: string | null; emitido_por_nome: string | null; atualizado_em: string;
}
export interface NotaLaudo { id: string; laudo_id: string; texto: string; autor_nome: string | null; criado_em: string }

export type Pax = Pick<PassageiroRow, "id" | "nome_completo" | "cpf" | "telefone" | "email" | "expedicao_id" | "cliente_id" | "status_reserva"
  | "saude" | "perfil_viajante" | "inscricao_origem" | "restricoes_alimentares" | "condicoes_medicas" | "data_nascimento" | "liberado_expedamigo">;
const COLUNAS_PAX = "id,nome_completo,cpf,telefone,email,expedicao_id,cliente_id,status_reserva,saude,perfil_viajante,inscricao_origem,restricoes_alimentares,condicoes_medicas,data_nascimento,liberado_expedamigo";

export interface ItemDeclarado { campo: string; curto: string; detalhe: string | null }

const saudeDe = (p: Pick<PassageiroRow, "saude">) => ((p.saude && typeof p.saude === "object" ? p.saude : {}) as Record<string, string>);

function itens(saude: Record<string, string>, campos: readonly string[]): ItemDeclarado[] {
  return PERGUNTAS_SAUDE.filter((q) => campos.includes(q.campo) && saude[q.campo] === "Sim").map((q) => {
    const det = [q.detalheCampo ? saude[q.detalheCampo] : "", q.detalhe2Campo ? saude[q.detalhe2Campo] : ""].filter((x) => x && String(x).trim()).join(" · ");
    return { campo: q.campo, curto: q.curto, detalhe: det || null };
  });
}

export function classificar(p: Pick<PassageiroRow, "saude" | "restricoes_alimentares" | "condicoes_medicas">) {
  const s = saudeDe(p);
  const clinico = itens(s, CAMPOS_CLINICOS);
  const alimentar = itens(s, CAMPOS_ALIMENTARES);
  // Campos de texto antigos (antes do questionário): contam também.
  if (p.condicoes_medicas?.trim() && !clinico.length) clinico.push({ campo: "condicoes_medicas", curto: "Condição médica (cadastro)", detalhe: p.condicoes_medicas.trim() });
  if (p.restricoes_alimentares?.trim() && !alimentar.length) alimentar.push({ campo: "restricoes_alimentares", curto: "Restrição alimentar (cadastro)", detalhe: p.restricoes_alimentares.trim() });
  return { clinico, alimentar, leve: itens(s, CAMPOS_LEVES), respondeu: Object.keys(s).length > 0 };
}

/** Respondeu o formulário? (questionário de saúde preenchido OU a regra do app antigo). */
export const respondeuFormulario = (p: Pax) => Object.keys(saudeDe(p)).length > 0 || preencheuFormulario(p as PassageiroRow);

/** Dias corridos de hoje até a data (yyyy-MM-dd). */
export function diasAte(hoje: string, data: string | null | undefined): number | null {
  if (!data) return null;
  return Math.round((Date.parse(`${data.slice(0, 10)}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000);
}

/** Cor de urgência pelo embarque: ≤ 15 dias vermelho, ≤ 45 âmbar, resto neutro. */
export function urgencia(dias: number | null): "erro" | "aviso" | "neutro" {
  if (dias == null) return "neutro";
  if (dias <= 15) return "erro";
  if (dias <= 45) return "aviso";
  return "neutro";
}
export const textoDias = (d: number | null) => d == null ? "sem data" : d < 0 ? "já embarcou" : d === 0 ? "embarca hoje" : d === 1 ? "embarca amanhã" : `faltam ${d} dias`;

export interface CasoSaude {
  pax: Pax; exp: ExpedicaoRow; dias: number | null;
  clinico: ItemDeclarado[]; alimentar: ItemDeclarado[]; leve: ItemDeclarado[];
  laudo: Laudo | null;
}

/** Expedições/pacotes que ainda não embarcaram (ou embarcam hoje), sem as canceladas. */
export async function expedicoesFuturas(hoje: string): Promise<ExpedicaoRow[]> {
  return (await listarExpedicoes()).filter((e) => e.status !== "Cancelada" && (!e.data_embarque || e.data_embarque >= hoje));
}

export async function lerPassageiros(expIds: string[]): Promise<Pax[]> {
  if (!expIds.length) return [];
  const l = await lerPorIds<Pax>("passageiros", "expedicao_id", expIds, COLUNAS_PAX);
  return l.filter((p) => p.status_reserva !== "Cancelado");
}

/** Laudos (0225). null = tabela não existe ainda / sem acesso. */
export async function lerLaudos(): Promise<Laudo[] | null> {
  const { data, error } = await supabase.from("cad_laudos_medicos").select("*").limit(5000);
  if (error) return null;
  return (data ?? []) as Laudo[];
}

export async function lerNotas(laudoId: string): Promise<NotaLaudo[]> {
  const { data, error } = await supabase.from("cad_laudo_notas").select("id,laudo_id,texto,autor_nome,criado_em").eq("laudo_id", laudoId).order("criado_em", { ascending: false });
  if (error) throw new Error(traduzirErro(error.message));
  return (data ?? []) as NotaLaudo[];
}

/** Fila inteira: casos clínicos e/ou alimentares das viagens futuras, por embarque. */
export async function carregarFila(hoje: string): Promise<{ casos: CasoSaude[]; temLaudos: boolean }> {
  const exps = await expedicoesFuturas(hoje);
  const porId = new Map(exps.map((e) => [e.id, e]));
  const [pax, laudos] = await Promise.all([lerPassageiros(exps.map((e) => e.id)), lerLaudos()]);
  const laudoDe = new Map((laudos ?? []).filter((l) => l.passageiro_id).map((l) => [l.passageiro_id!, l]));
  const casos: CasoSaude[] = [];
  for (const p of pax) {
    const c = classificar(p);
    const laudo = laudoDe.get(p.id) ?? null;
    if (!c.clinico.length && !c.alimentar.length && !laudo) continue;
    const exp = p.expedicao_id ? porId.get(p.expedicao_id) : undefined;
    if (!exp) continue;
    casos.push({ pax: p, exp, dias: diasAte(hoje, exp.data_embarque), ...c, laudo });
  }
  casos.sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999) || a.pax.nome_completo.localeCompare(b.pax.nome_completo, "pt-BR"));
  return { casos, temLaudos: laudos !== null };
}

/** Caso ainda pede ação do médico? (clínico sem laudo emitido/dispensado). */
export const pendenteMedico = (c: CasoSaude) => c.clinico.length > 0 && (!c.laudo || c.laudo.status === "a_fazer" || c.laudo.status === "em_andamento");

// ── escrita (0225) ──────────────────────────────────────────────────────────
export const BUCKET_LAUDOS = "laudos-medicos";

export async function salvarLaudo(passageiroId: string, m: { status?: StatusLaudo; apto?: Apto | ""; ressalvas?: string; parecer?: string; arquivo?: { path: string; nome: string; mime: string; bytes: number } }): Promise<Laudo> {
  const { data, error } = await supabase.rpc("cad_laudo_salvar", {
    p_passageiro: passageiroId, p_status: m.status ?? null, p_apto: m.apto ?? null,
    p_ressalvas: m.ressalvas ?? null, p_parecer: m.parecer ?? null, p_arquivo: m.arquivo ?? null,
  });
  if (error) throw new Error(traduzirErro(error.message));
  return data as Laudo;
}

export async function anotar(laudoId: string, texto: string): Promise<void> {
  const { error } = await supabase.rpc("cad_laudo_nota", { p_laudo: laudoId, p_texto: texto });
  if (error) throw new Error(traduzirErro(error.message));
}

export async function subirPdfLaudo(c: CasoSaude, arquivo: File): Promise<{ path: string; nome: string; mime: string; bytes: number }> {
  if (arquivo.type && arquivo.type !== "application/pdf") throw new Error("O laudo precisa ser um PDF.");
  if (arquivo.size > 15 * 1024 * 1024) throw new Error("O PDF passa de 15 MB.");
  const dono = c.pax.cliente_id ?? `pax-${c.pax.id}`;
  const limpo = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const path = `${dono}/${c.pax.id}/${crypto.randomUUID()}-${limpo}`;
  const up = await supabase.storage.from(BUCKET_LAUDOS).upload(path, arquivo, { contentType: "application/pdf", upsert: false });
  if (up.error) throw new Error(`Não subiu o PDF: ${up.error.message}`);
  return { path, nome: arquivo.name, mime: "application/pdf", bytes: arquivo.size };
}

export async function tirarPdfLaudo(laudoId: string): Promise<void> {
  const { data, error } = await supabase.rpc("cad_laudo_apagar_arquivo", { p_laudo: laudoId });
  if (error) throw new Error(traduzirErro(error.message));
  if (data) await supabase.storage.from(BUCKET_LAUDOS).remove([String(data)]);
}

export async function abrirPdfLaudo(path: string): Promise<void> {
  const aba = window.open("about:blank", "_blank");
  const { data, error } = await supabase.storage.from(BUCKET_LAUDOS).createSignedUrl(path, 300);
  if (error || !data) { aba?.close(); throw new Error(error?.message ?? "Não abriu o laudo."); }
  if (aba) aba.location.href = data.signedUrl; else window.open(data.signedUrl, "_blank");
}

/** Texto pro restaurante / fornecedor: restrições e alergias alimentares de UMA viagem. */
export function resumoAlimentar(exp: ExpedicaoRow, casos: CasoSaude[]): string {
  const lista = casos.filter((c) => c.exp.id === exp.id && c.alimentar.length);
  const cab = `${exp.nome}${exp.data_embarque ? ` — embarque ${exp.data_embarque.split("-").reverse().join("/")}` : ""}\nRestrições e alergias alimentares do grupo (${lista.length} pessoa${lista.length === 1 ? "" : "s"}):`;
  const linhas = lista.map((c) => `• ${c.pax.nome_completo}: ${c.alimentar.map((i) => `${i.curto}${i.detalhe ? ` (${i.detalhe})` : ""}`).join("; ")}`);
  return [cab, ...linhas].join("\n");
}
