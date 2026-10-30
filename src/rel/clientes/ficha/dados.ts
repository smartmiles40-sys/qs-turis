// src/rel/clientes/ficha/dados.ts
// -----------------------------------------------------------------------------
// Contas da ficha redesenhada (spec 29/10): próxima viagem, trilha de etapas
// (Venda → Contrato → Pagamento → Documentos → Embarque), status da viagem
// (Contrato, Pagamento, Documentos, Aéreo, Seguro, Grupo) e a linha do tempo.
// Só lê o que a ficha já carrega — nenhuma consulta nova ao banco aqui.
// -----------------------------------------------------------------------------
import type { IdaEmExpedicao } from "@/clientes/cadastroUnico";
import type { IdaDetalhada } from "@/clientes/idasDetalhe";
import type { Semaforo } from "@/expedicoes/lib/prontidao/regras";
import type { TimelineItem } from "@/components/ui";
import type { Viagem } from "../../lib/viagens";
import type { Auditoria, Contato, LigacoesCliente } from "../../lib/clientes";
import { CANAIS_CONTATO, formatarData, moeda } from "../../lib/clientes";
import type { Solicitacao } from "@/solicitacoes/lib";
import { SIGLA } from "@/solicitacoes/lib";
import { agruparSeguidos, voltaDeReferencia } from "./regras";

export type TomEtapa = "ok" | "warn" | "danger" | "neutral";

const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** A próxima viagem da pessoa: expedição/pacote (Ops) ou viagem do Rel, a que embarca primeiro. */
export interface ProximaViagem {
  nome: string;
  grupo: string | null;
  ida: string;
  volta: string | null;
  /** Ida em expedição (cadastro único) — tem prontidão. */
  idaExp: IdaEmExpedicao | null;
  /** Viagem do Relacionamento (rel_viagens). */
  viagem: Viagem | null;
}

export function proximaViagem(idas: IdaEmExpedicao[], viagens: Viagem[]): ProximaViagem | null {
  const hoje = hojeISO();
  const cands: ProximaViagem[] = [];
  for (const i of idas) {
    const e = i.expedicao;
    if (!e?.data_embarque || e.data_embarque.slice(0, 10) < hoje) continue;
    if (i.status_reserva === "Cancelado" || i.status_reserva === "Lead") continue;
    cands.push({ nome: e.nome, grupo: e.codigo || null, ida: e.data_embarque, volta: e.data_retorno, idaExp: i, viagem: null });
  }
  for (const v of viagens) {
    if (v.status !== "ativa" || !v.data_embarque || v.data_embarque.slice(0, 10) < hoje) continue;
    cands.push({ nome: v.titulo, grupo: v.expedicao, ida: v.data_embarque, volta: v.data_retorno, idaExp: null, viagem: v });
  }
  cands.sort((a, b) => a.ida.localeCompare(b.ida) || (a.idaExp ? -1 : 1));
  return cands[0] ?? null;
}

/**
 * A volta que vale pro alerta dos 6 meses do passaporte: a viagem EM ANDAMENTO
 * (embarcou e não voltou) ou, sem ela, a próxima — expedição/pacote ou viagem do Rel.
 */
export function voltaParaAlerta(idas: IdaEmExpedicao[], viagens: Viagem[]): string | null {
  const datas = [
    ...idas.filter((i) => i.status_reserva !== "Cancelado" && i.status_reserva !== "Lead" && i.expedicao?.data_embarque)
      .map((i) => ({ ida: i.expedicao!.data_embarque, volta: i.expedicao!.data_retorno })),
    ...viagens.filter((v) => v.status === "ativa" && v.data_embarque).map((v) => ({ ida: v.data_embarque, volta: v.data_retorno })),
  ];
  return voltaDeReferencia(datas);
}

export const tomDoSemaforo = (s: Semaforo | null | undefined): TomEtapa =>
  s === "ok" ? "ok" : s === "atencao" ? "warn" : s === "bloqueio" ? "danger" : "neutral";

/** Pior semáforo entre as checagens de prontidão de alguns tipos. */
function pior(d: IdaDetalhada | null, tipos: string[]): { s: Semaforo | null; detalhe: string | null } {
  const ch = d?.prontidao?.checagens.filter((c) => tipos.includes(c.tipo)) ?? [];
  if (!ch.length) return { s: null, detalhe: null };
  const ordem: Semaforo[] = ["bloqueio", "atencao", "ok", "na"];
  for (const s of ordem) {
    const c = ch.find((x) => x.semaforo === s);
    if (c) return { s, detalhe: c.detalhe };
  }
  return { s: null, detalhe: null };
}

export interface StatusDaViagem { rotulo: string; texto: string; tom: TomEtapa }

/**
 * Contrato, Pagamento, Documentos, Aéreo, Seguro e Grupo de WhatsApp.
 * Fonte: prontidão do Operações (mesmas regras do Ops) quando é expedição/pacote;
 * na viagem do Rel, o que a viagem tem (voos). O resto fica "—" (sem dado), nunca inventado.
 */
export function statusDaViagem(p: ProximaViagem | null, d: IdaDetalhada | null, faltandoCadastro: number, ligacoes: LigacoesCliente | null,
  contrato?: { texto: string; tom: TomEtapa } | null): StatusDaViagem[] {
  const de = (rotulo: string, tipos: string[], okTexto: string): StatusDaViagem => {
    const r = pior(d, tipos);
    if (!r.s) return { rotulo, texto: "—", tom: "neutral" };
    if (r.s === "na") return { rotulo, texto: "não se aplica", tom: "neutral" };
    return { rotulo, texto: r.s === "ok" ? okTexto : (r.detalhe || "pendente"), tom: tomDoSemaforo(r.s) };
  };
  const contratoS: StatusDaViagem = contrato
    ? { rotulo: "Contrato", ...contrato }
    : d?.pax ? (d.pax.contrato_assinado ? { rotulo: "Contrato", texto: "assinado", tom: "ok" } : { rotulo: "Contrato", texto: "não assinado", tom: "warn" })
      : { rotulo: "Contrato", texto: "—", tom: "neutral" };
  const pag = (() => {
    const i = p?.idaExp;
    if (i && i.saldo_brl != null) {
      return i.saldo_brl <= 0
        ? { rotulo: "Pagamento", texto: "quitado", tom: "ok" as TomEtapa }
        : { rotulo: "Pagamento", texto: `falta ${moeda(i.saldo_brl)}`, tom: "warn" as TomEtapa };
    }
    return de("Pagamento", ["Pagamento"], "em dia");
  })();
  const docs: StatusDaViagem = d?.prontidao
    ? de("Documentos", ["Passaporte", "RG", "Visto", "Vacina", "Dados Pessoais", "Autorização de Menor"], "ok")
    : faltandoCadastro > 0 ? { rotulo: "Documentos", texto: `${faltandoCadastro} faltando`, tom: "warn" } : { rotulo: "Documentos", texto: "cadastro completo", tom: "ok" };
  const aereo: StatusDaViagem = d?.prontidao
    ? de("Aéreo", ["Aéreo Internacional", "Aéreo Doméstico", "Voo Interno"], "emitido")
    : p?.viagem && (p.viagem.voos_total ?? 0) > 0
      ? { rotulo: "Aéreo", texto: `${p.viagem.voos_total} voo${p.viagem.voos_total === 1 ? "" : "s"} lançado${p.viagem.voos_total === 1 ? "" : "s"}`, tom: "ok" }
      : { rotulo: "Aéreo", texto: "—", tom: "neutral" };
  const seguro = de("Seguro viagem", ["Seguro"], "ok");
  const grupo: StatusDaViagem = ligacoes
    ? ligacoes.grupos.length ? { rotulo: "Grupo de WhatsApp", texto: ligacoes.grupos.map((g) => g.nome || "grupo").slice(0, 2).join(", "), tom: "ok" }
      : { rotulo: "Grupo de WhatsApp", texto: "não está em grupo", tom: p ? "warn" : "neutral" }
    : { rotulo: "Grupo de WhatsApp", texto: "—", tom: "neutral" };
  return [contratoS, pag, docs, aereo, seguro, grupo];
}

/** A trilha do card Viagem: Venda, Contrato, Pagamento, Documentos, Embarque. */
export function trilha(p: ProximaViagem | null, status: StatusDaViagem[], d: IdaDetalhada | null): { rotulo: string; tom: TomEtapa; dica: string }[] {
  const s = (r: string) => status.find((x) => x.rotulo === r);
  const embarque: TomEtapa = !p ? "neutral" : d?.prontidao?.prontidao === "Bloqueado" ? "danger" : d?.prontidao?.prontidao === "Apto" ? "ok" : "neutral";
  return [
    { rotulo: "Venda", tom: p ? "ok" : "neutral", dica: p ? "venda registrada" : "sem viagem à frente" },
    { rotulo: "Contrato", tom: s("Contrato")?.tom ?? "neutral", dica: s("Contrato")?.texto ?? "—" },
    { rotulo: "Pagamento", tom: s("Pagamento")?.tom ?? "neutral", dica: s("Pagamento")?.texto ?? "—" },
    { rotulo: "Documentos", tom: s("Documentos")?.tom ?? "neutral", dica: s("Documentos")?.texto ?? "—" },
    { rotulo: "Embarque", tom: embarque, dica: d?.prontidao ? d.prontidao.prontidao : p ? `embarca ${formatarData(p.ida)}` : "—" },
  ];
}

// ── Linha do tempo ──────────────────────────────────────────────────────────

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export interface FontesTimeline {
  historico: Auditoria[];
  mudancas: (a: Auditoria) => string;
  usuarios: Record<string, string>;
  contatos: Contato[];
  solicitacoes: Solicitacao[];
  ligacoes: LigacoesCliente | null;
  viagens: Viagem[];
  /** 30/10 (ficha completa): idas, contratos, laudos, receitas, itens de venda, audit_log das idas, uploads,
   *  decisões — ver eventosDaFichaCompleta / eventosDoHistoricoExtra (fontes.ts) */
  extras?: (TimelineItem & { em: string; grupo?: string | null })[];
}

/**
 * Tudo que aconteceu com a pessoa, do mais novo pro mais antigo. Gravações seguidas
 * da mesma pessoa no mesmo lugar (ex.: o "Preencher por telefone", campo a campo)
 * em até 10 min viram UMA linha.
 */
export function linhaDoTempo(f: FontesTimeline): (TimelineItem & { em: string })[] {
  const out: (TimelineItem & { em: string; grupo?: string | null })[] = [];
  for (const h of f.historico) {
    const quem = (h.por && f.usuarios[h.por]) || "Sistema";
    out.push({ id: `a${h.id}`, em: h.em, when: quando(h.em), title: `Ficha: ${f.mudancas(h)}`, sub: quem, setor: "relacionamento", grupo: `ficha:${quem}` });
  }
  for (const k of f.contatos) {
    out.push({ id: `c${k.id}`, em: k.feito_em, when: quando(k.feito_em), title: `Contato por ${CANAIS_CONTATO[k.canal]}`,
      sub: [k.resumo, k.autor_id && f.usuarios[k.autor_id]].filter(Boolean).join(" · ") || undefined, tone: "ok" });
  }
  for (const s of f.solicitacoes) {
    out.push({ id: `s${s.id}`, em: s.criado_em, when: quando(s.criado_em), title: `Solicitação #${s.numero}: ${s.titulo}`,
      sub: `${SIGLA[s.de_setor]} → ${SIGLA[s.para_setor]} · ${s.tipo_rotulo ?? "pedido"}${s.criado_por_nome ? ` · ${s.criado_por_nome}` : ""}`, setor: s.para_setor });
  }
  for (const l of f.ligacoes?.leads ?? []) {
    out.push({ id: `l${l.id}`, em: l.criado_em, when: quando(l.criado_em), title: "Lead chegou no Comercial",
      sub: [l.fonte, l.dono && `com ${l.dono.split(" ")[0]}`, l.status].filter(Boolean).join(" · "), setor: "comercial" });
  }
  for (const v of f.viagens) {
    const em = v.data_venda ?? v.criado_em;
    out.push({ id: `v${v.id}`, em, when: v.data_venda ? formatarData(v.data_venda) : quando(v.criado_em), title: `Venda: ${v.titulo}`,
      sub: [v.valor ? moeda(v.valor) : null, v.data_embarque ? `embarca ${formatarData(v.data_embarque)}` : null].filter(Boolean).join(" · ") || undefined, setor: "financeiro" });
  }
  if (f.extras) out.push(...f.extras);
  out.sort((a, b) => b.em.localeCompare(a.em));
  return agruparSeguidos(out as (typeof out[number] & { title: string })[], 10).map(({ grupo: _g, ...r }) => r);
}
