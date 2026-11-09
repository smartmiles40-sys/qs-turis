// src/closer/contrato.ts
// -----------------------------------------------------------------------------
// CONTRATO e PAGAMENTO do cartão do closer (0180/0181, 22/10/2026).
//
// CONTRATO 100% em código (sem n8n e, desde 27/10, sem Google): o SERVIDOR
// (api/closer.js) monta o PDF pelos modelos do próprio QS
// (api/_contratoModelo.js), guarda no Storage e cria no ZapSign. Sem ZapSign
// configurado → MODO MANUAL (o closer cola o link e marca assinado; RPC).
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
  /** Só no contrato de menor: quem viaja (o contratante é o pai/mãe). Vazio = o próprio contratante. */
  viajante: string;
  expedicao: string; destino: string; tipo_pacote: string; inclusos: string; nao_inclusos: string;
  ida: string; volta: string; passagem: string; seguro: string;
  valor_total: string; forma_pagamento: string; vendedor: string; data_venda: string;
  /** Anexo I (expedição): um dia por bloco, começando por "Dia N". Vazio = sem anexo. */
  roteiro: string;
}
export type ChaveCampo = keyof CamposContrato;

/** Rótulos na ordem da tela. `so` = só aparece nesse tipo de contrato. */
export const ROTULOS: { k: ChaveCampo; rotulo: string; obrigatorio?: boolean; so?: TipoContrato; longo?: boolean; dica?: string }[] = [
  { k: "nome", rotulo: "Nome completo do cliente", obrigatorio: true },
  { k: "cpf", rotulo: "CPF", obrigatorio: true },
  { k: "rg", rotulo: "RG", dica: "Sai no quadro só se preenchido" },
  { k: "nascimento", rotulo: "Data de nascimento", so: "pacote", dica: "dd/mm/aaaa" },
  { k: "email", rotulo: "E-mail (o ZapSign manda o contrato pra ele)", obrigatorio: true },
  { k: "telefone", rotulo: "Telefone", obrigatorio: true },
  { k: "endereco", rotulo: "Endereço", longo: true },
  { k: "viajante", rotulo: "Viajante menor de idade (se o contratante for o pai/mãe)", longo: true,
    dica: "Ex.: Ana Souza, nascida em 10/03/2015 — sai como linha VIAJANTE no quadro. Vazio = quem assina é quem viaja" },
  { k: "expedicao", rotulo: "Nome da expedição", obrigatorio: true, so: "expedicao" },
  { k: "destino", rotulo: "Destino (quadro resumo)", obrigatorio: true, so: "pacote", longo: true, dica: "Ex.: Itália dos Sonhos: Milão, Toscana e Roma." },
  { k: "tipo_pacote", rotulo: "Tipo de pacote", so: "pacote", dica: "Ex.: Personalizado" },
  { k: "inclusos", rotulo: "O que está incluso (cláusula 1.3)", obrigatorio: true, so: "pacote", longo: true,
    dica: "Um item por linha. O que vem antes dos dois-pontos sai em negrito: \"Hospedagem: 13 noites em hotéis 3 estrelas\"" },
  { k: "nao_inclusos", rotulo: "Não inclusos", so: "pacote", longo: true, dica: "Ex.: traslados aeroporto–hotel, refeições não mencionadas, seguro-viagem" },
  { k: "ida", rotulo: "Ida prevista", dica: "dd/mm/aaaa" },
  { k: "volta", rotulo: "Volta prevista", dica: "dd/mm/aaaa" },
  { k: "passagem", rotulo: "Passagem aérea", so: "expedicao", dica: "Ex.: Inclusa / Não inclusa" },
  { k: "seguro", rotulo: "Seguro viagem", so: "expedicao", dica: "Ex.: Incluso como bônus / Por conta do(a) Contratante" },
  { k: "valor_total", rotulo: "Valor total (todas as pessoas)", obrigatorio: true, dica: "Só o número: 26.990,00 (sai \"R$ 26.990,00\")" },
  { k: "forma_pagamento", rotulo: "Forma de pagamento", obrigatorio: true, longo: true, dica: "Entrada, parcelas e datas. Ex.: Entrada de R$ 2.000,00 via Pix e 12 parcelas de R$ 2.000,00 no cartão" },
  { k: "vendedor", rotulo: "Vendedor" },
  { k: "data_venda", rotulo: "Data da venda", obrigatorio: true, dica: "dd/mm/aaaa" },
  { k: "roteiro", rotulo: "Roteiro (Anexo I)", so: "expedicao", longo: true,
    dica: "Vem do roteiro da expedição. Cada dia começa com \"Dia N\". Vazio = o contrato sai sem anexo" },
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
/** "dd/mm/aaaa" (ou aaaa-mm-dd) → Date, ou null se não for uma data de verdade. */
function dataDe(s: string): Date | null {
  const t = String(s || "").trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const [d, m, a] = br ? [+br[1], +br[2], +br[3]] : iso ? [+iso[3], +iso[2], +iso[1]] : [0, 0, 0];
  if (!a) return null;
  const x = new Date(Date.UTC(a, m - 1, d, 12));
  return x.getUTCDate() === d && x.getUTCMonth() === m - 1 ? x : null;
}
const linhasDosInclusos = (s: string) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);

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
  if (c.tipo === "pacote" && !linhasDosInclusos(c.inclusos).length) e.inclusos = "Liste o que está incluso (um item por linha).";
  if (!dataDe(c.data_venda)) e.data_venda = "Data em dd/mm/aaaa.";
  for (const k of ["ida", "volta"] as const) if (c[k].trim() && !dataDe(c[k])) e[k] = "Data em dd/mm/aaaa.";
  const ida = dataDe(c.ida), volta = dataDe(c.volta);
  if (ida && volta && volta < ida) e.volta = "A volta está antes da ida (confira o ano).";
  return e;
}

export interface Previa {
  campos: CamposContrato;
  origem: Partial<Record<ChaveCampo, string>>;
  dealId: string | null;
  avisoBitrix: string | null;
  modo: "automatico" | "manual";
  falta: string[];
  /** Ficha do cliente no cadastro único (rel_clientes), se achada. */
  clienteId?: string | null;
  /** Quem viaja na venda registrada (base do contrato por pessoa — fase 3). */
  viajantes?: { nome: string; valor: number | null; aereo_incluso: boolean | null }[];
}
export const previaDoContrato = (negocioId: string) => api<Previa>("contrato-previa", { negocioId });

/** O que voltou pro cadastro do cliente (rel_clientes) depois de gerar/enviar. */
export interface ResultadoCadastro { clienteId: string | null; gravados: string[]; aviso?: string | null }
/** A prévia como chegou (sugestão + origem): o servidor compara pra saber o que o closer EDITOU. */
type PreviaEnviada = Pick<Previa, "campos" | "origem">;
const soPrevia = (p?: PreviaEnviada | null) => (p ? { campos: p.campos, origem: p.origem } : null);

export interface ResultadoEnvio { ok: boolean; contratoId?: string; link?: string | null; erro?: string; cadastro?: ResultadoCadastro | null }
export const enviarContrato = (negocioId: string, campos: CamposContrato, substituir = false, previa?: PreviaEnviada | null) =>
  api<ResultadoEnvio>("contrato-enviar", { negocioId, campos, substituir, previa: soPrevia(previa) });
/** O PDF como vai sair, pra abrir numa aba. Com o cartão, o que o closer corrigiu volta pro cadastro. */
export async function pdfDeTeste(campos: CamposContrato, negocioId?: string, previa?: PreviaEnviada | null): Promise<{ blob: Blob; erros: string[]; avisos: string[]; cadastro: ResultadoCadastro | null }> {
  const r = await api<{ base64: string; erros: string[]; avisos: string[]; cadastro?: ResultadoCadastro | null }>("contrato-pdf-teste", { campos, negocioId, previa: soPrevia(previa) });
  const bin = atob(r.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: "application/pdf" }), erros: r.erros, avisos: r.avisos, cadastro: r.cadastro ?? null };
}

const NOME_CAMPO_CADASTRO: Record<string, string> = { cpf: "CPF", nascimento: "nascimento", email: "e-mail", rg: "RG", endereco: "endereço" };
/** "Cadastro do cliente atualizado: CPF, endereço." (ou o aviso). Vazio = nada mudou. */
export function textoDoCadastro(r: ResultadoCadastro | null | undefined): string {
  if (!r) return "";
  const feito = r.gravados?.length ? `Cadastro do cliente atualizado: ${r.gravados.map((k) => NOME_CAMPO_CADASTRO[k] ?? k).join(", ")}.` : "";
  return [feito, r.aviso || ""].filter(Boolean).join(" ");
}
/** Link de 10 min do PDF guardado no QS (o enviado ou o assinado). */
export const linkDoPdf = (contratoId: string, qual: "gerado" | "assinado") =>
  api<{ url: string }>("contrato-pdf-link", { contratoId, qual }).then((r) => r.url);

export const atualizarContrato =(contratoId: string) => api<{ ok: boolean; status: string }>("contrato-atualizar", { contratoId });
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
  zapsign: { token: boolean; webhookSecret: boolean; sandbox: boolean };
  webhookUrl: string;
}
export const situacaoDoContrato = () => api<SituacaoContrato>("contrato-config");
export const salvarConfigContrato = (valor: ConfigContrato) => api<SituacaoContrato>("contrato-config-salvar", { valor });
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
