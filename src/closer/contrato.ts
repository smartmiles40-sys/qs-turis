// src/closer/contrato.ts
// -----------------------------------------------------------------------------
// CONTRATO e PAGAMENTO do cartão do closer (0180/0181, 22/10/2026).
//
// CONTRATO 100% em código (sem n8n): o SERVIDOR (api/closer.js) gera pelo
// Google, arquiva o PDF no Drive e cria no ZapSign. Sem Google/ZapSign
// configurados → MODO MANUAL (o closer cola o link e marca assinado; RPC).
//
// PAGAMENTO só manual / pelo Financeiro (sem Pagar.me/Asaas — Bruno 22/10):
// colar o link, marcar pago (com baixa na parcela, se houver plano) e "Pedir
// link ao Financeiro" (vira solicitação na Central; o link volta pro cartão).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { erroAmigavel } from "./lib";

// ── Chamada ao servidor ──────────────────────────────────────────────────────
async function api<T>(acao: string, dados: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch(`/api/closer?acao=${encodeURIComponent(acao)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ acao, ...dados }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error((j as { error?: string }).error || `Falhou (HTTP ${r.status}).`) as Error & { dados?: unknown; status?: number };
    e.dados = j;
    e.status = r.status;
    throw e;
  }
  return j as T;
}

// ── Campos do contrato ──────────────────────────────────────────────────────
export type TipoContrato = "pacote" | "expedicao";
export interface CamposContrato {
  tipo: TipoContrato;
  nome: string; cpf: string; rg: string; nascimento: string; endereco: string; email: string; telefone: string;
  expedicao: string; destino: string; tipo_pacote: string; ida: string; volta: string; passagem: string; seguro: string;
  valor_total: string; forma_pagamento: string; vendedor: string; data_venda: string;
}
export type ChaveCampo = keyof CamposContrato;

/** Rótulos na ordem da tela. `so` = só aparece nesse tipo de contrato. */
export const ROTULOS: { k: ChaveCampo; rotulo: string; obrigatorio?: boolean; so?: TipoContrato; longo?: boolean; dica?: string }[] = [
  { k: "nome", rotulo: "Nome completo do cliente", obrigatorio: true },
  { k: "cpf", rotulo: "CPF", obrigatorio: true },
  { k: "rg", rotulo: "RG" },
  { k: "nascimento", rotulo: "Data de nascimento", dica: "dd/mm/aaaa" },
  { k: "email", rotulo: "E-mail (o ZapSign manda o contrato pra ele)", obrigatorio: true },
  { k: "telefone", rotulo: "Telefone", obrigatorio: true },
  { k: "endereco", rotulo: "Endereço", longo: true },
  { k: "expedicao", rotulo: "Nome da expedição", obrigatorio: true, so: "expedicao" },
  { k: "destino", rotulo: "Destino / descrição do pacote", obrigatorio: true, so: "pacote", longo: true, dica: "Roteiro + o que está incluso." },
  { k: "tipo_pacote", rotulo: "Tipo de pacote", so: "pacote" },
  { k: "ida", rotulo: "Ida prevista", dica: "dd/mm/aaaa" },
  { k: "volta", rotulo: "Volta prevista", dica: "dd/mm/aaaa" },
  { k: "passagem", rotulo: "Passagem aérea", so: "expedicao", dica: "Ex.: Inclusa / Não inclusa" },
  { k: "seguro", rotulo: "Seguro viagem", so: "expedicao", dica: "Ex.: Incluso como bônus / Por conta do(a) Contratante" },
  { k: "valor_total", rotulo: "Valor total (todas as pessoas)", obrigatorio: true, dica: "Só o número: 26.990,00" },
  { k: "forma_pagamento", rotulo: "Forma de pagamento", obrigatorio: true, longo: true },
  { k: "vendedor", rotulo: "Vendedor" },
  { k: "data_venda", rotulo: "Data da venda", obrigatorio: true, dica: "dd/mm/aaaa" },
];

const soDigitos = (s: string) => String(s || "").replace(/\D/g, "");
export function cpfValido(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function numeroDoValor(v: string): number {
  let s = (String(v || "").trim().match(/^[R$\s]*([\d.,]+)/) || [])[1] || "";
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return s && Number.isFinite(n) ? n : NaN;
}

/** A mesma conferência do servidor (pra avisar antes de mandar). */
export function errosDoContrato(c: CamposContrato): Partial<Record<ChaveCampo, string>> {
  const e: Partial<Record<ChaveCampo, string>> = {};
  if (!c.nome.trim() || c.nome.trim() === ".") e.nome = "Obrigatório.";
  if (!cpfValido(c.cpf)) e.cpf = "CPF inválido (11 números).";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) e.email = "E-mail inválido.";
  if (soDigitos(c.telefone).length < 10) e.telefone = "Com DDD.";
  if (!(numeroDoValor(c.valor_total) > 0)) e.valor_total = "Informe o valor.";
  if (!c.forma_pagamento.trim()) e.forma_pagamento = "Obrigatório.";
  if (c.tipo === "expedicao" && !c.expedicao.trim()) e.expedicao = "Obrigatório na expedição.";
  if (c.tipo === "pacote" && !c.destino.trim()) e.destino = "Obrigatório no pacote.";
  if (!c.data_venda.trim()) e.data_venda = "Obrigatório.";
  return e;
}

export interface Previa {
  campos: CamposContrato;
  origem: Partial<Record<ChaveCampo, string>>;
  dealId: string | null;
  avisoBitrix: string | null;
  modo: "automatico" | "manual";
  falta: string[];
}
export const previaDoContrato = (negocioId: string) => api<Previa>("contrato-previa", { negocioId });

export interface ResultadoEnvio { ok: boolean; contratoId?: string; link?: string | null; pdf?: string | null; erro?: string; sobraram?: string[] | null }
export const enviarContrato = (negocioId: string, campos: CamposContrato, substituir = false) =>
  api<ResultadoEnvio>("contrato-enviar", { negocioId, campos, substituir });
export const atualizarContrato = (contratoId: string) => api<{ ok: boolean; status: string }>("contrato-atualizar", { contratoId });
export const cancelarContrato = (contratoId: string, motivo: string) => api<{ ok: boolean; status: string }>("contrato-cancelar", { contratoId, motivo });

// ── Os envios do cartão ─────────────────────────────────────────────────────
export type StatusContrato = "gerando" | "enviado" | "visualizado" | "assinado" | "recusado" | "cancelado" | "erro";
export const NOME_STATUS_CONTRATO: Record<StatusContrato, string> = {
  gerando: "Gerando…", enviado: "Enviado", visualizado: "Cliente abriu", assinado: "Assinado",
  recusado: "Recusado", cancelado: "Cancelado", erro: "Falhou",
};
export const TOM_STATUS_CONTRATO: Record<StatusContrato, "neutro" | "rel" | "aviso" | "erro"> = {
  gerando: "neutro", enviado: "aviso", visualizado: "aviso", assinado: "rel", recusado: "erro", cancelado: "neutro", erro: "erro",
};
export interface EnvioContrato {
  id: string; tipo: TipoContrato; modo: "automatico" | "manual"; status: StatusContrato; erro: string | null;
  campos: Partial<CamposContrato>; link_assinatura: string | null; drive_pdf_url: string | null; pdf_assinado_url: string | null;
  zapsign_token: string | null; visualizacoes: number; criado_em: string; enviado_em: string | null; visualizado_em: string | null;
  assinado_em: string | null; recusado_em: string | null; enviado_por_user: { name: string } | null;
}
export async function enviosDoCartao(negocioId: string): Promise<EnvioContrato[]> {
  const { data, error } = await supabase.from("qs_contratos")
    .select("id, tipo, modo, status, erro, campos, link_assinatura, drive_pdf_url, pdf_assinado_url, zapsign_token, visualizacoes, criado_em, enviado_em, visualizado_em, assinado_em, recusado_em, enviado_por_user:qs_users!qs_contratos_enviado_por_fkey(name)")
    .eq("negocio_id", negocioId).order("criado_em", { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EnvioContrato[];
}

/** Modo manual: 'enviado' (link colado) | 'assinado' (link do PDF, opcional) | 'cancelar' (motivo). */
export async function contratoManual(negocioId: string, acao: "enviado" | "assinado" | "cancelar", link?: string) {
  const { error } = await supabase.rpc("contrato_manual", { p_negocio: negocioId, p_acao: acao, p_link: link ?? null });
  if (error) throw new Error(erroAmigavel(error));
}

// ── Configuração (tela da gestão) ───────────────────────────────────────────
export interface ConfigContrato {
  template_pacote: string; template_expedicao: string; pasta_contratos: string;
  assinante_nome: string; assinante_email: string; assinante_telefone: string;
}
export interface SituacaoContrato {
  podeConfigurar: boolean;
  modo: "automatico" | "manual";
  falta: string[];
  config: ConfigContrato;
  google: { clienteConfigurado: boolean; conectado: boolean; email: string | null; conectadoEm: string | null; ultimoErro: string | null };
  zapsign: { token: boolean; webhookSecret: boolean; sandbox: boolean };
  redirectUri: string;
  webhookUrl: string;
}
export const situacaoDoContrato = () => api<SituacaoContrato>("contrato-config");
export const salvarConfigContrato = (valor: ConfigContrato) => api<SituacaoContrato>("contrato-config-salvar", { valor });
export const conectarGoogle = () => api<{ url: string }>("google-conectar");
export const desconectarGoogle = () => api<SituacaoContrato>("google-desconectar");
export const testarZapsign = () => api<{ ok: boolean; erro?: string }>("zapsign-testar");

// ── PAGAMENTO (0181) ────────────────────────────────────────────────────────
export async function pagamentoLink(negocioId: string, link: string, obs?: string) {
  const { error } = await supabase.rpc("closer_pagamento", { p_negocio: negocioId, p_acao: "link", p_link: link, p_parcela: null, p_data: null, p_valor: null, p_obs: obs ?? null });
  if (error) throw new Error(erroAmigavel(error));
}
export async function pagamentoPago(negocioId: string, d: { parcelaId?: string | null; data?: string | null; valor?: number | null; obs?: string }) {
  const { error } = await supabase.rpc("closer_pagamento", {
    p_negocio: negocioId, p_acao: "pago", p_link: null, p_parcela: d.parcelaId ?? null, p_data: d.data || null, p_valor: d.valor ?? null, p_obs: d.obs ?? null,
  });
  if (error) throw new Error(erroAmigavel(error));
}
export async function pagamentoLimpar(negocioId: string, obs?: string) {
  const { error } = await supabase.rpc("closer_pagamento", { p_negocio: negocioId, p_acao: "limpar", p_link: null, p_parcela: null, p_data: null, p_valor: null, p_obs: obs ?? null });
  if (error) throw new Error(erroAmigavel(error));
}

export type Modalidade = "recorrente" | "futuro" | "outro";
export const MODALIDADES: Record<Modalidade, string> = {
  recorrente: "Crédito recorrente", futuro: "Pagamento futuro (cobrança agendada)", outro: "Outro link de pagamento",
};
export async function pedirLinkAoFinanceiro(negocioId: string, d: { modalidade: Modalidade; valor: number; parcelas?: number | null; vencimento?: string | null; obs?: string; prioridade?: "normal" | "alta" | "urgente" }): Promise<string> {
  const { data, error } = await supabase.rpc("closer_pedir_link_pagamento", {
    p_negocio: negocioId, p_modalidade: d.modalidade, p_valor: d.valor, p_parcelas: d.parcelas ?? null,
    p_vencimento: d.vencimento || null, p_obs: d.obs ?? null, p_prioridade: d.prioridade ?? "normal",
  });
  if (error) throw new Error(erroAmigavel(error));
  return data as string;
}

export interface ParcelaAberta { id: string; numero: number; valor: number; vencimento: string; forma: string; status: string }
export async function parcelasDoCartao(negocioId: string): Promise<ParcelaAberta[]> {
  const { data } = await supabase.from("fin_planos").select("fin_parcelas(id, numero, valor, vencimento, forma, status)").eq("negocio_id", negocioId).maybeSingle();
  const lista = ((data as { fin_parcelas?: ParcelaAberta[] } | null)?.fin_parcelas ?? []).slice();
  return lista.sort((a, b) => a.numero - b.numero);
}
