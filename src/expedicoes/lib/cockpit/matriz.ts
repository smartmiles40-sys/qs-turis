// src/expedicoes/lib/cockpit/matriz.ts
// -----------------------------------------------------------------------------
// MATRIZ DE PASSAGEIROS (spec §3.4) + PRONTIDÃO DEPOIS DO EMBARQUE (spec §4.2).
// Uma linha por passageiro e uma coluna por requisito — Passaporte, Visto, Seguro,
// Formulário, Quarto e Pagamento —, cada célula um chip com tom, e no cabeçalho o
// PLACAR da coluna ("18/25").
//
// De onde vem cada coluna (sem schema novo, ver docs/MAPA-EXPEDICOES.md):
//   Passaporte  colunas do passageiro + regra única de ../passaporte.ts
//   Visto       checagem "Visto" da prontidão (só se o destino exige)
//   Seguro      requisito "Seguro": o ANEXO é a apólice (não há coluna de apólice)
//   Formulário  preencheuFormulario (passageiros/dados.ts) — vem pronto
//   Quarto      rooming (hotéis = quartos com datas) — vem pronto
//   Pagamento   valor contratado/pago (statusFin); líder e cortesia = "Isento"
//
// §4.2: em viagem e concluída a prontidão NÃO alarma nem bloqueia. Passaporte,
// visto e formulário ficam neutros; o que ficou faltando de documento (a apólice,
// um visto não aprovado) vira "pendência administrativa" (tom amarelo, nunca vermelho).
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------
import { avaliarValidadePassaporte } from "../passaporte.ts";
import type { Fase } from "../fase.ts";

export type TomCelula = "ok" | "warn" | "danger" | "neutral";
export type ColunaMatriz = "passaporte" | "visto" | "seguro" | "formulario" | "quarto" | "pagamento";
export const COLUNAS_MATRIZ: readonly { id: ColunaMatriz; rotulo: string }[] = [
  { id: "passaporte", rotulo: "Passaporte" },
  { id: "visto", rotulo: "Visto" },
  { id: "seguro", rotulo: "Seguro" },
  { id: "formulario", rotulo: "Formulário" },
  { id: "quarto", rotulo: "Quarto" },
  { id: "pagamento", rotulo: "Pagamento" },
];

export interface Celula {
  rotulo: string;
  tom: TomCelula;
  /** Entra no placar (denominador). Ex.: visto que o destino não exige, líder isento. */
  aplica: boolean;
  /** Resolvido (numerador do placar). */
  ok: boolean;
  /** Conta como pendência ("Com pendência", badge da aba, cobranças). */
  pendente: boolean;
  dica?: string;
}

/** Fases em que a prontidão já não vale (a viagem começou ou acabou). */
export const posEmbarque = (fase: Fase) => fase === "em_viagem" || fase === "concluida";

export interface PaxMatriz {
  id: string;
  nome: string;
  tipo: string; // Pagante | Cortesia | Líder
  status_reserva: string;
  passaporte: string | null;
  validade_passaporte: string | null;
  /** Já calculado (passageiros/dados.ts → preencheuFormulario). */
  preencheu: boolean;
  /** null = a expedição não tem hotel com quarto; senão o rótulo e se está em todos. */
  quarto: { rotulo: string | null; completo: boolean } | null;
  valor_contratado_brl: number | null;
  valor_pago_brl: number | null;
  /** Checagens da prontidão (avaliarProntidao) — só tipo e semáforo. */
  checagens: readonly { tipo: string; semaforo: string; detalhe?: string }[];
  /** Requisitos do passageiro (pra achar a apólice do seguro). */
  requisitos: readonly { tipo: string; status: string; arquivo_id: string | null }[];
}

export interface LinhaMatriz {
  pax: PaxMatriz;
  lider: boolean;
  celulas: Record<ColunaMatriz, Celula>;
  pendente: boolean;
}

const C = (rotulo: string, tom: TomCelula, o: Partial<Celula> = {}): Celula =>
  ({ rotulo, tom, aplica: true, ok: tom === "ok", pendente: tom === "warn" || tom === "danger", ...o });
const NA = (rotulo = "—", dica?: string): Celula => ({ rotulo, tom: "neutral", aplica: false, ok: false, pendente: false, dica });

const isento = (tipo: string) => tipo === "Líder" || tipo === "Cortesia";

/** Mesma conta do gatilho da 0220 (valores/dados.ts → statusFin). */
export function statusFinanceiro(contratado: number, pago: number): "Sem valor" | "Em aberto" | "Parcial" | "Quitado" {
  if (!(contratado > 0)) return pago > 0 ? "Parcial" : "Sem valor";
  if (pago >= contratado) return "Quitado";
  return pago > 0 ? "Parcial" : "Em aberto";
}

export function celulasDoPax(p: PaxMatriz, exp: { data_embarque: string | null; data_retorno: string | null }, fase: Fase): Record<ColunaMatriz, Celula> {
  const pos = posEmbarque(fase);
  const chk = (tipo: string) => p.checagens.find((c) => c.tipo === tipo);

  // Passaporte — regra única (vermelho se vence < 6 meses depois da volta).
  const v = avaliarValidadePassaporte(p, exp);
  let passaporte: Celula;
  if (v.estado === "sem") passaporte = pos ? C("Sem passaporte", "neutral", { pendente: false }) : C("Sem passaporte", "danger");
  else if (v.estado === "ok") passaporte = C(`Válido · ${v.mesAno}`, "ok");
  else passaporte = pos
    ? C(`Vence ${v.mesAno}`, "neutral", { ok: true, pendente: false })
    : C(`Vence ${v.mesAno}`, "danger", { dica: v.estado === "vence_na_viagem" ? "Vence antes da volta" : "Vence menos de 6 meses depois da volta" });

  // Visto — só se o destino exige (existe a checagem).
  const cv = chk("Visto");
  let visto: Celula;
  if (!cv || cv.semaforo === "na") visto = NA("Não precisa");
  else if (cv.semaforo === "ok") visto = C("Aprovado", "ok");
  else if (pos) visto = C("Pend. adm.", "warn", { dica: cv.detalhe ?? "Visto sem aprovação registrada" });
  else visto = C(cv.detalhe && cv.detalhe.length <= 18 ? cv.detalhe : "Pendente", cv.semaforo === "bloqueio" ? "danger" : "warn", { dica: cv.detalhe });

  // Seguro — o anexo do requisito É a apólice.
  const cs = chk("Seguro");
  const rs = p.requisitos.find((r) => r.tipo === "Seguro");
  let seguro: Celula;
  if (!cs && !rs) seguro = NA("—", "O destino não pede seguro");
  else if (rs?.status === "Dispensado") seguro = NA("Dispensado");
  else if (rs?.arquivo_id) seguro = C("Apólice", "ok");
  else seguro = C("Sem apólice", "warn", { dica: pos ? "Pendência administrativa" : undefined });

  // Formulário
  const formulario = p.preencheu ? C("Preencheu", "ok") : pos ? C("Não preencheu", "neutral", { pendente: false }) : C("Pendente", "warn");

  // Quarto
  let quarto: Celula;
  if (!p.quarto) quarto = NA("—", "Sem hotéis no rooming");
  else if (p.quarto.completo) quarto = C(p.quarto.rotulo ?? "Alocado", "ok");
  else quarto = C(p.quarto.rotulo ? `${p.quarto.rotulo} · falta hotel` : "Sem quarto", "warn");

  // Pagamento
  let pagamento: Celula;
  if (isento(p.tipo)) pagamento = NA("Isento", p.tipo === "Líder" ? "Líder não paga" : "Cortesia");
  else {
    const st = statusFinanceiro(Number(p.valor_contratado_brl || 0), Number(p.valor_pago_brl || 0));
    pagamento = st === "Sem valor" ? C("Sem valor", "danger") : st === "Quitado" ? C("Quitado", "ok")
      // Tem valor lançado (o placar conta "com valor"); o saldo em aberto é assunto do Financeiro, não pendência.
      : C(st, "warn", { ok: true, pendente: false });
  }

  return { passaporte, visto, seguro, formulario, quarto, pagamento };
}

export function montarMatriz(pax: readonly PaxMatriz[], exp: { data_embarque: string | null; data_retorno: string | null }, fase: Fase): LinhaMatriz[] {
  return pax
    .filter((p) => p.status_reserva !== "Cancelado")
    .map((p) => {
      const celulas = celulasDoPax(p, exp, fase);
      return { pax: p, lider: p.tipo === "Líder", celulas, pendente: Object.values(celulas).some((c) => c.pendente) };
    })
    // Líderes primeiro (spec), depois por nome.
    .sort((a, b) => Number(b.lider) - Number(a.lider) || a.pax.nome.localeCompare(b.pax.nome, "pt-BR"));
}

export interface Placar { texto: string; tom: TomCelula; ok: number; aplica: number }

const SUFIXO: Partial<Record<ColunaMatriz, string>> = { passaporte: " válidos", pagamento: " com valor" };

/** Placar de cada coluna ("18/25"), colorido: tudo ok = verde; algo vermelho = vermelho; senão amarelo. */
export function placarDaMatriz(linhas: readonly LinhaMatriz[]): Record<ColunaMatriz, Placar> {
  const out = {} as Record<ColunaMatriz, Placar>;
  for (const { id } of COLUNAS_MATRIZ) {
    const cs = linhas.map((l) => l.celulas[id]).filter((c) => c.aplica);
    const ok = cs.filter((c) => c.ok).length;
    if (!cs.length) { out[id] = { texto: id === "visto" ? "não exigido" : "—", tom: "neutral", ok: 0, aplica: 0 }; continue; }
    const tom: TomCelula = cs.some((c) => c.tom === "danger") ? "danger" : cs.some((c) => c.tom === "warn") ? "warn" : ok === cs.length ? "ok" : "neutral";
    out[id] = { texto: `${ok}/${cs.length}${SUFIXO[id] ?? ""}`, tom, ok, aplica: cs.length };
  }
  return out;
}

export type FiltroMatriz = "todos" | "pendencia" | "formulario" | "lideres" | "seguro";
export function filtrarMatriz(linhas: readonly LinhaMatriz[], f: FiltroMatriz): LinhaMatriz[] {
  switch (f) {
    case "pendencia": return linhas.filter((l) => l.pendente);
    case "formulario": return linhas.filter((l) => l.celulas.formulario.pendente);
    case "seguro": return linhas.filter((l) => l.celulas.seguro.pendente);
    case "lideres": return linhas.filter((l) => l.lider);
    default: return [...linhas];
  }
}

export function contagensMatriz(linhas: readonly LinhaMatriz[]) {
  return {
    todos: linhas.length,
    pendencia: linhas.filter((l) => l.pendente).length,
    formulario: linhas.filter((l) => l.celulas.formulario.pendente).length,
    seguro: linhas.filter((l) => l.celulas.seguro.pendente).length,
    lideres: linhas.filter((l) => l.lider).length,
  };
}

const FRASE_PENDENCIA: Record<ColunaMatriz, (n: number) => string> = {
  passaporte: (n) => `${n} com passaporte a resolver`,
  visto: (n) => `${n} sem visto aprovado`,
  seguro: (n) => `${n} sem seguro`,
  formulario: (n) => `${n} sem formulário`,
  quarto: (n) => `${n} sem quarto`,
  pagamento: (n) => `${n} sem valor lançado`,
};

/** As `n` maiores pendências agregadas ("18 sem seguro", "7 sem formulário"). */
export function maioresPendencias(linhas: readonly LinhaMatriz[], n = 3): { coluna: ColunaMatriz; qtd: number; texto: string }[] {
  return COLUNAS_MATRIZ
    .map(({ id }) => ({ coluna: id, qtd: linhas.filter((l) => l.celulas[id].pendente).length }))
    .filter((x) => x.qtd > 0)
    .sort((a, b) => b.qtd - a.qtd)
    .slice(0, n)
    .map((x) => ({ ...x, texto: FRASE_PENDENCIA[x.coluna](x.qtd) }));
}

// ── Prontidão por fase (§4.2) ────────────────────────────────────────────────
export type ResumoProntidao =
  | { modo: "prontidao"; aptos: number; atencao: number; bloqueados: number; total: number }
  | { modo: "administrativo"; comPendencia: number; total: number; porTipo: { tipo: string; qtd: number }[] };

/**
 * Antes do embarque: Aptos / Atenção / Bloqueados. Em viagem e concluída: nada de
 * bloqueio — só quem ficou com alguma checagem aberta, como pendência administrativa.
 */
export function resumoProntidao(fase: Fase, resultados: readonly { prontidao: string; checagens: readonly { tipo: string; semaforo: string }[] }[]): ResumoProntidao {
  if (!posEmbarque(fase)) {
    return {
      modo: "prontidao", total: resultados.length,
      aptos: resultados.filter((r) => r.prontidao === "Apto").length,
      atencao: resultados.filter((r) => r.prontidao === "Atenção").length,
      bloqueados: resultados.filter((r) => r.prontidao === "Bloqueado").length,
    };
  }
  const porTipo = new Map<string, number>();
  let comPendencia = 0;
  for (const r of resultados) {
    const abertas = r.checagens.filter((c) => c.semaforo === "atencao" || c.semaforo === "bloqueio");
    if (abertas.length) comPendencia++;
    for (const c of abertas) porTipo.set(c.tipo, (porTipo.get(c.tipo) ?? 0) + 1);
  }
  return {
    modo: "administrativo", total: resultados.length, comPendencia,
    porTipo: [...porTipo.entries()].map(([tipo, qtd]) => ({ tipo, qtd })).sort((a, b) => b.qtd - a.qtd || a.tipo.localeCompare(b.tipo)),
  };
}
