// src/clientes/visaoCruzadaRegras.ts
// -----------------------------------------------------------------------------
// VISÃO CRUZADA (13/11/2026) — as contas puras, sem banco. "Todos os setores se
// conversam": o SDR/closer vê que o lead já é cliente da casa; o Rel/Ops vê o
// que o Comercial viveu com a pessoa. Os dados vêm das RPCs 0381–0384
// (src/clientes/visaoCruzada.ts); aqui só decidimos O QUE mostrar e COMO dizer.
// Testes: tests/visao-cruzada/regras.test.ts
// -----------------------------------------------------------------------------
import type { SetorQs } from "@/components/ui/qs";

// ── Tipos do que as RPCs devolvem ───────────────────────────────────────────

export interface ViagemResumo { id: string; titulo: string; destino: string | null; embarque: string | null; retorno: string | null }
export interface ChamadoResumo { numero: number; assunto: string; status: string; prioridade: string; prazo: string | null }
export interface OportunidadeResumo { titulo: string; etapa: string; produto: string | null; dono: string | null }
export interface NegocioResumo { id: string; lead_id: string; etapa: string; closer: string | null; motivo_perda: string | null; atualizado_em: string }
export interface OrigemResumo {
  lead_id?: string; chegou_em?: string | null; fonte?: string | null;
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null; utm_term?: string | null;
}

/** cliente_resumo_setores / lead_resumo_setores (0381). */
export interface ResumoSetores {
  cliente_id: string;
  leads: number;
  viagens: { ativas: number; realizadas: number; canceladas: number; proximas: ViagemResumo[] };
  chamados: { abertos: number; lista: ChamadoResumo[] };
  oportunidades: { abertas: number; lista: OportunidadeResumo[] };
  parcelas: { vencidas: number; vencidas_valor: number; abertas: number; abertas_valor: number; pagas: number };
  negocios: NegocioResumo[];
  motivo_perda: string | null;
  origem: OrigemResumo | null;
}

export interface RespostaForm { campo: string; rotulo: string; valor: string }
export interface NotaComercial { id: string; texto: string; criado_em: string; autor: string | null }
export interface LeadComercial extends OrigemResumo {
  id: string; nome: string | null; status: string | null; dono: string | null; motivo_perda: string | null;
  respostas: RespostaForm[]; notas: NotaComercial[];
  negocio: { id: string; etapa: string; closer: string | null; motivo_perda: string | null; atualizado_em: string } | null;
}
/** pessoa_contexto_comercial (0382). */
export interface ContextoComercial { leads: LeadComercial[] }

/** Uma linha de pessoa_linha_do_tempo (0383). */
export interface LinhaPessoa { id: string; em: string; tipo: string; titulo: string; sub: string | null; setor: string | null }

/** Uma parcela de negocio_parcelas (0384). */
export interface ParcelaReal {
  id: string; plano_id: string; numero: number; valor: number; vencimento: string; forma: string;
  status: "a_receber" | "pago" | "cancelado" | string; pago_em: string | null; pago_valor: number | null;
}

// ── Etapas (rótulos curtos, iguais aos do closer/Rel) ───────────────────────

export const ETAPA_NEGOCIO: Record<string, string> = {
  aguardando_reuniao: "Aguardando reunião", reagendamento: "Reagendamento", em_cotacao: "Em cotação", em_negociacao: "Em negociação",
  no_show: "No-show", oportunidade_futura: "Oportunidade futura", aguardando_emissao: "Aguardando emissão",
  venda_cancelada: "Venda cancelada", perdido: "Perdido", venda_realizada: "Venda realizada",
};
export const ETAPA_OPORTUNIDADE: Record<string, string> = {
  oportunidade: "Oportunidade", contato: "Em contato", proposta: "Proposta", negociacao: "Negociação", ganho: "Ganho", perdido: "Perdido",
};

// ── Formatação ──────────────────────────────────────────────────────────────

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** "2027-09-04" → "04/09/2027" sem passar por Date (sem fuso). */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ── Faixa "Cliente da casa" (SDR/closer) ────────────────────────────────────

export type TomFaixa = "info" | "warn" | "danger";
export interface ItemFaixa { chave: "viagens" | "chamado" | "oportunidade" | "parcelas"; texto: string; detalhe?: string; tom: TomFaixa }

/**
 * O que a faixa diz, na ordem de importância pra quem vai ligar/fechar.
 * Lista vazia = a faixa NÃO aparece (pessoa sem nada na casa).
 */
export function itensDaFaixa(r: ResumoSetores | null | undefined): ItemFaixa[] {
  if (!r) return [];
  const out: ItemFaixa[] = [];
  const v = r.viagens;
  if (v && (v.ativas > 0 || v.realizadas > 0 || v.canceladas > 0)) {
    const partes = [
      v.ativas ? `${v.ativas} ${v.ativas === 1 ? "viagem ativa" : "viagens ativas"}` : null,
      v.realizadas ? `${v.realizadas} ${v.realizadas === 1 ? "realizada" : "realizadas"}` : null,
      v.canceladas ? `${v.canceladas} ${v.canceladas === 1 ? "cancelada" : "canceladas"}` : null,
    ].filter(Boolean);
    const prox = v.proximas?.[0];
    out.push({
      chave: "viagens", tom: "info", texto: partes.join(" · "),
      detalhe: prox ? `próxima: ${prox.titulo}${prox.embarque ? ` em ${dataCurta(prox.embarque)}` : ""}` : undefined,
    });
  }
  if (r.chamados?.abertos > 0) {
    const c = r.chamados.lista?.[0];
    out.push({
      chave: "chamado", tom: "warn",
      texto: r.chamados.abertos === 1 ? "1 chamado aberto no Relacionamento" : `${r.chamados.abertos} chamados abertos no Relacionamento`,
      detalhe: c ? `#${c.numero} ${c.assunto}` : undefined,
    });
  }
  if (r.oportunidades?.abertas > 0) {
    const o = r.oportunidades.lista?.[0];
    out.push({
      chave: "oportunidade", tom: "warn",
      texto: "Oportunidade aberta no Relacionamento — recompra é do Rel",
      detalhe: o ? [o.titulo, ETAPA_OPORTUNIDADE[o.etapa] ?? o.etapa, o.dono ? `com ${o.dono.split(" ")[0]}` : null].filter(Boolean).join(" · ") : undefined,
    });
  }
  if (r.parcelas?.vencidas > 0) {
    out.push({
      chave: "parcelas", tom: "danger",
      texto: `${r.parcelas.vencidas} ${r.parcelas.vencidas === 1 ? "parcela vencida" : "parcelas vencidas"} no Financeiro`,
      detalhe: r.parcelas.vencidas_valor > 0 ? brl(Number(r.parcelas.vencidas_valor)) : undefined,
    });
  }
  return out;
}

// ── Origem / UTM ────────────────────────────────────────────────────────────

/** "Meta Ads / campanha-x (cpc)" — vazio quando não há nada. */
export function textoOrigem(o: OrigemResumo | null | undefined): string {
  if (!o) return "";
  const utm = [o.utm_source, o.utm_campaign].filter((x) => !!x && String(x).trim()).join(" / ");
  const meio = o.utm_medium && o.utm_medium.trim() ? ` (${o.utm_medium.trim()})` : "";
  const base = utm ? `${utm}${meio}` : "";
  const fonte = o.fonte && o.fonte.trim() ? o.fonte.trim() : "";
  if (base && fonte && !base.toLowerCase().includes(fonte.toLowerCase())) return `${fonte} · ${base}`;
  return base || fonte;
}

// ── Linha do tempo ──────────────────────────────────────────────────────────

/**
 * Tipos da pessoa_linha_do_tempo que a ficha do Rel JÁ monta sozinha
 * (src/rel/clientes/ficha/dados.ts → linhaDoTempo): lead chegou, venda,
 * solicitação criada, contato do Rel. Chamado não está na linha antiga, mas o
 * Rel já tem a lista própria — fica de fora pra não repetir.
 */
export const TIPOS_QUE_A_FICHA_JA_TEM = new Set(["lead", "venda", "solicitacao", "contato", "chamado"]);

const SETORES: SetorQs[] = ["comercial", "relacionamento", "financeiro", "operacional", "marketing"];
const setorQs = (s: string | null): SetorQs | undefined => {
  if (!s) return undefined;
  if (s === "operacoes" || s === "ops") return "operacional";
  if (s === "rel") return "relacionamento";
  if (s === "fin") return "financeiro";
  return (SETORES as string[]).includes(s) ? (s as SetorQs) : undefined;
};

export interface EventoTimeline { id: string; em: string; when: string; title: string; sub?: string; setor?: SetorQs; grupo?: string | null }

/**
 * As linhas da RPC que entram na linha do tempo da ficha — só os tipos que a
 * ficha ainda não tem — no formato do <Timeline>. `quando` formata a data
 * (injetado pra o teste não depender do fuso da máquina).
 */
export function eventosDaPessoa(linhas: LinhaPessoa[], quando: (iso: string) => string, jaTem: Set<string> = TIPOS_QUE_A_FICHA_JA_TEM): EventoTimeline[] {
  const vistos = new Set<string>();
  const out: EventoTimeline[] = [];
  for (const l of linhas) {
    if (!l || !l.em || jaTem.has(l.tipo) || vistos.has(l.id)) continue;
    vistos.add(l.id);
    out.push({
      id: `pt-${l.id}`, em: l.em, when: quando(l.em), title: l.titulo,
      sub: l.sub ?? undefined, setor: setorQs(l.setor), grupo: null,
    });
  }
  return out;
}

// ── Parcelas reais do negócio (closer) ──────────────────────────────────────

export interface ResumoParcelas {
  total: number;
  pagas: number; pagoValor: number;
  vencidas: number; vencidoValor: number;
  aReceber: number; aReceberValor: number;
  proxima: ParcelaReal | null;
}

/** situação de UMA parcela hoje. `hoje` = "AAAA-MM-DD" (São Paulo). */
export function situacaoParcela(p: ParcelaReal, hoje: string): "paga" | "vencida" | "a_receber" | "cancelada" {
  if (p.status === "pago") return "paga";
  if (p.status === "cancelado") return "cancelada";
  return p.vencimento && p.vencimento.slice(0, 10) < hoje ? "vencida" : "a_receber";
}

export function resumoDasParcelas(ps: ParcelaReal[], hoje: string): ResumoParcelas {
  const r: ResumoParcelas = { total: 0, pagas: 0, pagoValor: 0, vencidas: 0, vencidoValor: 0, aReceber: 0, aReceberValor: 0, proxima: null };
  for (const p of ps) {
    const s = situacaoParcela(p, hoje);
    if (s === "cancelada") continue;
    r.total++;
    const valor = Number(p.valor) || 0;
    if (s === "paga") { r.pagas++; r.pagoValor += Number(p.pago_valor ?? p.valor) || 0; }
    else if (s === "vencida") { r.vencidas++; r.vencidoValor += valor; }
    else {
      r.aReceber++; r.aReceberValor += valor;
      if (!r.proxima || p.vencimento < r.proxima.vencimento) r.proxima = p;
    }
  }
  return r;
}

/** Erro de "a função/tabela ainda não existe" (migration não aplicada) → comportamento antigo. */
export function semMigration(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return ["PGRST202", "42883", "42P01", "PGRST205"].includes(e.code ?? "")
    || /could not find the function|function .* does not exist|schema cache/i.test(e.message ?? "");
}

/**
 * O selo do bloco Pagamento quando HÁ plano no Financeiro (manda o dado real);
 * null = sem parcelas → o cartão fica com o status manual de sempre.
 */
export function seloDasParcelas(r: ResumoParcelas): { t: string; tom: "neutro" | "rel" | "aviso" | "erro" } | null {
  if (!r.total) return null;
  if (r.vencidas > 0) return { t: r.vencidas === 1 ? "1 parcela vencida" : `${r.vencidas} parcelas vencidas`, tom: "erro" };
  if (r.aReceber === 0) return { t: "Quitado", tom: "rel" };
  if (r.pagas > 0) return { t: "Pago em parte", tom: "aviso" };
  return { t: "A receber", tom: "neutro" };
}
