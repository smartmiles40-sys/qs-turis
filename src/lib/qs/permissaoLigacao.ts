// src/lib/qs/permissaoLigacao.ts
// -----------------------------------------------------------------------------
// "ESSE CLIENTE LIBEROU PRA GENTE LIGAR PRA ELE?" — do lado da tela.
//
// Ligar pela Cloud API exige que a pessoa tenha AUTORIZADO receber chamada do
// número da empresa. Sem isso a Meta recusa com 138006. Este arquivo existe pro
// SDR ver isso ANTES de clicar, em vez de descobrir depois de liberar o
// microfone e esperar.
//
// -- DUAS VELOCIDADES, DE PROPÓSITO -------------------------------------------
//
//   • `carregarPermissoes(telefones)` — lê a TABELA (qs_call_permissions), que o
//     webhook mantém em dia sozinho. Uma consulta serve a fila inteira, é
//     instantânea e não custa nada à Meta. É o que pinta o botão.
//
//   • `conferirNaMeta(telefone)` — pergunta pra META. É a verdade, custa uma ida
//     à Graph API e leva de 200ms a 1s. Serve pra UMA ligação, no clique.
//
// A tabela pode estar atrasada (a pessoa revogou a permissão nas configurações
// do WhatsApp e a Meta não avisa ninguém). Por isso o botão é OTIMISTA e a
// discagem é DESCONFIADA: o `/api/wa-config` confere na Meta antes de mandar o
// SDP. Pintar o botão com a verdade absoluta exigiria uma ida à Graph API por
// card da fila — inviável, e desnecessário, porque o erro é barato de tratar.
// -----------------------------------------------------------------------------

import { supabase } from "../supabase";
import { authHeaders } from "./waInbox";

/** Como a Meta chama: `no_permission` | `temporary` | `permanent`. */
export type StatusPermissao = "no_permission" | "temporary" | "permanent";

export interface Permissao {
  waId: string;
  status: StatusPermissao;
  /** ISO. Nulo quando permanente ou quando não há permissão. */
  expiraEm: string | null;
  /** Já pedimos? Serve pra não pedir de novo antes das 24h. */
  pedidoEm: string | null;
  respondidoEm: string | null;
  fonte: string | null;
  /** false = inferida de o cliente ter ligado pra gente; não veio de um "sim". */
  confirmado: boolean;
}

function soDigitos(t?: string | null): string {
  return String(t || "").replace(/\D/g, "");
}

/**
 * A MESMA regra do banco (`qs_permissao_vale`) e do servidor: permanente sempre
 * vale, temporária vale enquanto não expirou. Três cópias dessa regra virariam
 * três respostas diferentes pro mesmo lead — então ela é uma só, repetida nas
 * três camadas por necessidade e conferida por teste de olho.
 */
export function permissaoVale(p?: Permissao | null): boolean {
  if (!p) return false;
  if (p.status === "permanent") return true;
  if (p.status !== "temporary") return false;
  return !!p.expiraEm && new Date(p.expiraEm).getTime() > Date.now();
}

/** Quanto tempo ainda vale, em texto curto pro botão ("6 dias", "hoje"). */
export function validadeEmTexto(p?: Permissao | null): string | null {
  if (!p) return null;
  if (p.status === "permanent") return "sem prazo";
  if (!permissaoVale(p)) return null;
  const ms = new Date(p.expiraEm!).getTime() - Date.now();
  const dias = Math.floor(ms / 86_400_000);
  if (dias >= 1) return `${dias} dia${dias > 1 ? "s" : ""}`;
  const horas = Math.max(1, Math.round(ms / 3_600_000));
  return `${horas}h`;
}

function daLinha(r: Record<string, unknown>): Permissao {
  return {
    waId: String(r.wa_id ?? ""),
    status: (r.status as StatusPermissao) ?? "no_permission",
    expiraEm: (r.expira_em as string) ?? null,
    pedidoEm: (r.pedido_em as string) ?? null,
    respondidoEm: (r.respondido_em as string) ?? null,
    fonte: (r.fonte as string) ?? null,
    confirmado: r.confirmado === true,
  };
}

/**
 * Lê a permissão de VÁRIOS telefones de uma vez — é assim que a fila inteira
 * fica pintada com uma consulta só. Devolve um mapa por telefone (só dígitos).
 *
 * Telefone que não está no mapa nunca foi visto: é "sem permissão", não é erro.
 */
export async function carregarPermissoes(telefones: (string | null | undefined)[]): Promise<Map<string, Permissao>> {
  const chaves = [...new Set(telefones.map(soDigitos).filter((t) => t.length >= 12))];
  const mapa = new Map<string, Permissao>();
  if (!chaves.length) return mapa;
  // Lotes de 200: um `in.()` com a fila inteira estoura o tamanho da URL, e o
  // erro que sai disso ("414") não se parece nem um pouco com a causa.
  for (let i = 0; i < chaves.length; i += 200) {
    const { data, error } = await supabase
      .from("qs_call_permissions")
      .select("wa_id,status,expira_em,pedido_em,respondido_em,fonte,confirmado")
      .in("wa_id", chaves.slice(i, i + 200));
    if (error) { console.warn("[permissao] não carreguei:", error.message); continue; }
    for (const r of data ?? []) mapa.set(String(r.wa_id), daLinha(r as Record<string, unknown>));
  }
  return mapa;
}

/** Uma só — pro modal do lead, que não tem fila. */
export async function carregarPermissao(telefone?: string | null): Promise<Permissao | null> {
  const m = await carregarPermissoes([telefone]);
  return m.get(soDigitos(telefone)) ?? null;
}

export interface ConferenciaNaMeta {
  liberado?: boolean;
  status?: StatusPermissao;
  expiraEm?: string | null;
  podePedir?: boolean;
  /** true = a Meta não respondeu e isto é o que o banco lembrava. */
  desatualizado?: boolean;
  error?: string;
}

/**
 * Pergunta PRA META, de verdade. Uma ida à Graph API — use no clique, nunca em
 * laço sobre a fila.
 */
export async function conferirNaMeta(telefone: string, leadId?: string | null): Promise<ConferenciaNaMeta> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "calling-permissao-status", telefone, leadId: leadId ?? null }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { error: d?.error || "A Meta não respondeu." };
    return d as ConferenciaNaMeta;
  } catch {
    return { error: "Sem conexão." };
  }
}

/**
 * Manda o "podemos te ligar?". Mensagem interativa, NÃO template — a Meta só
 * aceita dentro da janela de 24h, então quem nunca respondeu não pode receber.
 * Limite de 1 pedido por 24h por pessoa.
 */
export async function pedirPermissao(
  telefone: string, leadId?: string | null, texto?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "calling-permissao", telefone, leadId: leadId ?? null, texto }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: d?.error || "A Meta recusou o pedido." };
  } catch {
    return { ok: false, error: "Sem conexão." };
  }
}
