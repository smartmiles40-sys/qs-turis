// src/lib/qs/modeloCampos.ts
// -----------------------------------------------------------------------------
// O QUE É CADA {{VARIÁVEL}} de um modelo da Meta (0130, 14/10/2026).
//
// A Meta só conhece {{1}}, {{2}}…; a tabela qs_wa_modelo_campos diz que, no
// modelo "reuniao_link", {{2}} é o destino e {{3}} o especialista. No envio, o
// SDR recebe o modelo JÁ PREENCHIDO com o que o QS sabe do lead (nome, destino
// pela Fonte, a reunião marcada) — e pode corrigir antes de mandar.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type TipoCampo = "nome_lead" | "nome_sdr" | "destino" | "especialista" | "reuniao_dia" | "reuniao_hora" | "livre";

export const TIPOS_CAMPO: Record<TipoCampo, string> = {
  nome_lead: "Nome do lead",
  nome_sdr: "Seu nome (SDR)",
  destino: "Destino",
  especialista: "Especialista da reunião",
  reuniao_dia: "Dia da reunião",
  reuniao_hora: "Hora da reunião",
  livre: "Você digita",
};

/** Exemplo pronto pra Meta aprovar, por tipo (ela exige 1 exemplo por variável). */
export const EXEMPLO_DO_TIPO: Record<TipoCampo, string> = {
  nome_lead: "Maria", nome_sdr: "Mariana", destino: "Japão", especialista: "Talita",
  reuniao_dia: "quinta, 16/10", reuniao_hora: "15h", livre: "",
};

/** Cada {{n}} → um tipo acima OU um rótulo livre ("Assunto do contato"), que a tela mostra como está. */
export type CamposDoModelo = Record<string, TipoCampo | string>;

/** "Nome do lead" pros tipos conhecidos; o próprio texto pros rótulos livres. */
export function rotuloDoCampo(tipo: string | undefined): string | null {
  if (!tipo || tipo === "livre") return null;
  return TIPOS_CAMPO[tipo as TipoCampo] ?? tipo;
}

/**
 * O pedaço da frase em volta da variável — é o que diz pra pessoa o que vai ali
 * mesmo quando ninguém cadastrou o rótulo: "…entrando em contato sobre ____. Pode…".
 */
export function trechoDaVariavel(corpo: string, chave: string): string {
  const marca = new RegExp(`{{\\s*${chave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*}}`);
  const m = marca.exec(corpo);
  if (!m) return "";
  const limpar = (s: string) => s.replace(/{{\s*([^}]+?)\s*}}/g, "…").replace(/\s+/g, " ");
  const antes = limpar(corpo.slice(0, m.index)).slice(-40);
  const depois = limpar(corpo.slice(m.index + m[0].length)).slice(0, 30);
  return `${antes.length === 40 ? "…" : ""}${antes.trimStart()}____${depois.trimEnd()}${depois.length === 30 ? "…" : ""}`;
}

// ── Mídia no topo do modelo (14/10) ─────────────────────────────────────────
/** O que o seletor de arquivo aceita, por tipo de topo (o que a Meta aceita). */
export const ACEITA_DO_TOPO: Record<string, string> = {
  IMAGE: "image/jpeg,image/png",
  VIDEO: "video/mp4",
  DOCUMENT: "application/pdf",
};
export const ROTULO_DO_TOPO: Record<string, string> = { IMAGE: "imagem", VIDEO: "vídeo", DOCUMENT: "documento (PDF)" };
/** Teto do servidor pro arquivo do topo: 3 MB. */
export const MAX_ARQUIVO_DO_TOPO = 3 * 1024 * 1024;

/** O arquivo serve pro topo? Devolve o problema em texto, ou null. */
export function problemaDoArquivoDoTopo(formato: string | undefined, arquivo: File | null): string | null {
  if (!arquivo) return `Escolha o arquivo (${ROTULO_DO_TOPO[formato || ""] ?? "mídia"}) do topo.`;
  if (arquivo.size > MAX_ARQUIVO_DO_TOPO) return "O arquivo passa de 3 MB.";
  const aceitos = (ACEITA_DO_TOPO[formato || ""] || "").split(",");
  if (aceitos[0] && !aceitos.includes(arquivo.type)) {
    return { IMAGE: "Use uma imagem JPG ou PNG.", VIDEO: "Use um vídeo MP4.", DOCUMENT: "Use um PDF." }[formato || ""] ?? "Tipo de arquivo não aceito.";
  }
  return null;
}

/** File → base64 (sem o "data:...;base64,"). */
export function arquivoParaBase64(arquivo: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result || ""); ok(s.slice(s.indexOf(",") + 1)); };
    fr.onerror = () => falha(new Error("Não consegui ler o arquivo."));
    fr.readAsDataURL(arquivo);
  });
}

/** As variáveis que ainda estão vazias, na ordem do texto. */
export function variaveisVazias(variaveis: string[], valores: Record<string, string>): string[] {
  return variaveis.filter((v) => !String(valores[v] ?? "").trim());
}

export async function carregarCampos(nome: string): Promise<CamposDoModelo | null> {
  const { data } = await supabase.from("qs_wa_modelo_campos").select("campos").eq("nome", nome).maybeSingle();
  return (data?.campos as CamposDoModelo | undefined) ?? null;
}

export async function salvarCampos(nome: string, campos: CamposDoModelo) {
  const { error } = await supabase.from("qs_wa_modelo_campos")
    .upsert({ nome, campos, atualizado_em: new Date().toISOString() }, { onConflict: "nome" });
  if (error) throw new Error(error.message.includes("row-level") ? "Só gestor/admin define o que é cada variável." : error.message);
}

/** "[Japão] - Tráfego" → "Japão"; "[Turquia e Grécia]  - Live" → "Turquia e Grécia". */
export function destinoDaFonte(segment: string | null | undefined): string {
  const m = /^\s*\[([^\]]+)\]/.exec(segment || "");
  const d = m?.[1]?.trim() || "";
  return /^portal$/i.test(d) ? "" : d;
}

/** "Z John Italo (closer) " → "John"; "Talita Carvalho" → "Talita". */
export function primeiroNomeDoEspecialista(v: string | null | undefined): string {
  const limpo = String(v || "").replace(/\(.*?\)/g, "").trim().replace(/^z\s+/i, "");
  return limpo.split(/\s+/)[0] || "";
}

const FUSO = "America/Sao_Paulo";
/** "quinta, 16/10" no horário de São Paulo. */
export function diaDaReuniao(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "long", timeZone: FUSO }).replace("-feira", "");
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
  return `${dia}, ${data}`;
}
/** "15h" ou "15h30" no horário de São Paulo. */
export function horaDaReuniao(iso: string): string {
  const [h, m] = new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: FUSO }).split(":");
  return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

export interface ContextoDoLead {
  nome_lead: string;
  nome_sdr: string;
  destino: string;
  /** Próxima reunião (agendada/confirmada) — ou a última passada (no-show). */
  proxima: { especialista: string; dia: string; hora: string } | null;
  ultima: { especialista: string; dia: string; hora: string } | null;
}

export async function contextoDoLead(leadId: string, nomeLead?: string | null): Promise<ContextoDoLead> {
  const { data: { user } } = await supabase.auth.getUser();
  const [lead, eu, prox, ult] = await Promise.all([
    supabase.from("qs_leads").select("full_name, first_name, segment").eq("id", leadId).maybeSingle(),
    user ? supabase.from("qs_users").select("name").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("qs_meetings").select("scheduled_at, meeting_owner").eq("lead_id", leadId)
      .in("status", ["agendada", "confirmada"]).gte("scheduled_at", new Date(Date.now() - 3 * 3600_000).toISOString())
      .order("scheduled_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("qs_meetings").select("scheduled_at, meeting_owner").eq("lead_id", leadId)
      .lt("scheduled_at", new Date().toISOString()).order("scheduled_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const l = lead.data as { full_name: string | null; first_name: string | null; segment: string | null } | null;
  const reuniao = (r: { scheduled_at: string | null; meeting_owner: string | null } | null) =>
    r?.scheduled_at ? { especialista: primeiroNomeDoEspecialista(r.meeting_owner), dia: diaDaReuniao(r.scheduled_at), hora: horaDaReuniao(r.scheduled_at) } : null;
  const nome = (nomeLead || l?.full_name || l?.first_name || "").trim().split(/\s+/)[0] || "";
  return {
    nome_lead: nome,
    nome_sdr: (((eu as { data: { name?: string } | null }).data?.name) || "").trim().split(/\s+/)[0] || "",
    destino: destinoDaFonte(l?.segment),
    proxima: reuniao(prox.data as never),
    ultima: reuniao(ult.data as never),
  };
}

/** O valor que o QS sugere pra uma variável (vazio = o SDR digita). */
export function valorDoCampo(tipo: TipoCampo | string | undefined, ctx: ContextoDoLead | null, modelo: string): string {
  if (!ctx || !tipo) return "";
  // No-show fala da reunião que PASSOU; os outros, da próxima.
  const r = /no_?show/i.test(modelo) ? (ctx.ultima ?? ctx.proxima) : (ctx.proxima ?? null);
  switch (tipo) {
    case "nome_lead": return ctx.nome_lead;
    case "nome_sdr": return ctx.nome_sdr;
    case "destino": return ctx.destino;
    case "especialista": return r?.especialista ?? "";
    case "reuniao_dia": return r?.dia ?? "";
    case "reuniao_hora": return r?.hora ?? "";
    default: return "";
  }
}
