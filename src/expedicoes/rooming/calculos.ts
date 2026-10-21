// src/expedicoes/rooming/calculos.ts
// Valores calculados do Rooming (app antigo: RoomingBoard.tsx, seção 2.4/2.7 da
// spec): trechos (hotéis), quem viaja junto, pendências, grupos G1/G2 e a regra
// que libera o Excel. Funções puras — a tela só chama `calcularRooming`.
// Diferenças de propósito: a chave do hotel é UMA só (igual à do banco, 0168);
// a cor da conexão é estável (ordenada pelo id da conexão, não pela ordem dos
// pax); o grupo G1/G2 vem só de passageiros.grupo_id (sem a lista fixa do Egito);
// quarto "cancelado" não recebe ninguém e não entra no Excel.
import { CAPACIDADE_QUARTO } from "../lib/constants";
import { normalizarNome, nomesAcompanhante } from "../lib/rooming/acompanhante";
import type { AlocacaoQuartoRow, PassageiroRow, QuartoRow } from "../lib/database";
import type { DadosRooming } from "./dados";

export const CORES_CONEXAO = ["#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed", "#0891b2", "#ca8a04", "#e11d48"];

export type Grupo = "G1" | "G2";
export type GrupoTrecho = Grupo | "misto" | null;

export const capacidade = (tipo: string) => CAPACIDADE_QUARTO[tipo] ?? 1;
export const quartoCancelado = (q: QuartoRow) => (q.status ?? "").toLowerCase() === "cancelado";

/** Chave do hotel/trecho: nome sem espaços sobrando + check-in + check-out + extensão. */
export function chaveTrecho(q: { hotel_cidade: string | null; check_in: string | null; check_out: string | null; extensao_id?: string | null }): string {
  const hotel = (q.hotel_cidade ?? "").trim().replace(/\s+/g, " ");
  return `${hotel}|${(q.check_in ?? "").slice(0, 10)}|${(q.check_out ?? "").slice(0, 10)}|${q.extensao_id ?? ""}`;
}

export const cmpNumero = (a: QuartoRow, b: QuartoRow) =>
  String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

export interface Trecho {
  key: string;
  hotel_cidade: string | null;
  check_in: string | null;
  check_out: string | null;
  extensao_id: string | null;
  quartos: QuartoRow[];
}

export interface Conexao { id: string; membros: PassageiroRow[]; cor: string }

export interface SituacaoConexao { porQuarto: Map<string, number>; semQuarto: number; quartoAncora: string | null; juntos: boolean }

export function calcularRooming(d: DadosRooming, aloc: AlocacaoQuartoRow[]) {
  const paxAtivos = d.passageiros.filter((p) => p.status_reserva !== "Cancelado");
  const paxById = new Map(d.passageiros.map((p) => [p.id, p]));
  const quartoById = new Map(d.quartos.map((q) => [q.id, q]));

  // Divisão G1/G2 é opt-in: só com grupos chamados exatamente "G1" e "G2".
  const grupoNomePorId = new Map(d.grupos.map((g) => [g.id, g.nome]));
  const usaGrupos = d.grupos.some((g) => g.nome === "G1") && d.grupos.some((g) => g.nome === "G2");
  const grupoDoPax = (p: PassageiroRow): Grupo | null => {
    if (!usaGrupos || !p.grupo_id) return null;
    const n = grupoNomePorId.get(p.grupo_id);
    return n === "G1" || n === "G2" ? n : null;
  };
  const temGrupos = paxAtivos.some((p) => grupoDoPax(p));

  // Conexões "viajam juntas" (≥2 ativos com o mesmo conexao_viagem_id), cor estável.
  const porToken = new Map<string, PassageiroRow[]>();
  for (const p of paxAtivos) {
    if (!p.conexao_viagem_id) continue;
    const arr = porToken.get(p.conexao_viagem_id) ?? [];
    arr.push(p);
    porToken.set(p.conexao_viagem_id, arr);
  }
  const conexoes: Conexao[] = [...porToken.entries()]
    .filter(([, m]) => m.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, membros], i) => ({
      id,
      membros: [...membros].sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, "pt-BR")),
      cor: CORES_CONEXAO[i % CORES_CONEXAO.length],
    }));
  const conexaoByPax = new Map<string, { cor: string; companheiros: string }>();
  const membrosConexaoByPax = new Map<string, string[]>();
  for (const c of conexoes) {
    const ids = c.membros.map((m) => m.id);
    for (const m of c.membros) {
      conexaoByPax.set(m.id, { cor: c.cor, companheiros: c.membros.filter((x) => x.id !== m.id).map((x) => x.nome_completo).join(", ") });
      membrosConexaoByPax.set(m.id, ids);
    }
  }

  // Trechos (hotéis) por check-in; dentro do mesmo check-in, por nome (determinístico).
  const mapa = new Map<string, Trecho>();
  for (const q of d.quartos) {
    const k = chaveTrecho(q);
    if (!mapa.has(k)) mapa.set(k, { key: k, hotel_cidade: q.hotel_cidade, check_in: q.check_in, check_out: q.check_out, extensao_id: q.extensao_id ?? null, quartos: [] });
    mapa.get(k)!.quartos.push(q);
  }
  const trechos = [...mapa.values()].sort((a, b) =>
    (a.check_in ?? "").localeCompare(b.check_in ?? "") || (a.check_out ?? "").localeCompare(b.check_out ?? "") || a.key.localeCompare(b.key));
  const trechoDoQuarto = new Map<string, Trecho>();
  for (const t of trechos) for (const q of t.quartos) trechoDoQuarto.set(q.id, t);

  const ocupantesPorQuarto = new Map<string, string[]>();
  for (const q of d.quartos) ocupantesPorQuarto.set(q.id, []);
  // pax -> trecho -> quarto
  const quartoPorPaxTrecho = new Map<string, string>();
  for (const a of aloc) {
    const arr = ocupantesPorQuarto.get(a.quarto_id);
    if (!arr || !paxById.has(a.passageiro_id)) continue;
    arr.push(a.passageiro_id);
    const t = trechoDoQuarto.get(a.quarto_id);
    if (t) quartoPorPaxTrecho.set(`${a.passageiro_id}|${t.key}`, a.quarto_id);
  }
  const quartoDoPaxNoTrecho = (paxId: string, t: Trecho) => quartoPorPaxTrecho.get(`${paxId}|${t.key}`) ?? null;

  const contratantes = new Map<string, Set<string>>();
  for (const c of d.contratacoes) {
    if (!contratantes.has(c.extensao_id)) contratantes.set(c.extensao_id, new Set());
    contratantes.get(c.extensao_id)!.add(c.passageiro_id);
  }
  const nomeExtensao = new Map(d.extensoes.map((e) => [e.id, e.nome]));
  /** Hotel de extensão: só quem contratou. Senão: todos os ativos. */
  const paxRelevantes = (t: Trecho) => {
    if (!t.extensao_id) return paxAtivos;
    const s = contratantes.get(t.extensao_id) ?? new Set<string>();
    return paxAtivos.filter((p) => s.has(p.id));
  };
  const semQuarto = (t: Trecho) => paxRelevantes(t).filter((p) => !quartoDoPaxNoTrecho(p.id, t));

  const grupoDoQuarto = (q: QuartoRow): Grupo | null => {
    let g2 = false;
    for (const id of ocupantesPorQuarto.get(q.id) ?? []) {
      const p = paxById.get(id);
      const g = p ? grupoDoPax(p) : null;
      if (g === "G1") return "G1";
      if (g === "G2") g2 = true;
    }
    return g2 ? "G2" : null;
  };
  const prioridadeQuarto = (q: QuartoRow) => { const g = grupoDoQuarto(q); return g === "G1" ? 0 : g === "G2" ? 1 : 2; };
  const quartosOrdenados = (t: Trecho) =>
    [...t.quartos].sort((a, b) => (temGrupos ? prioridadeQuarto(a) - prioridadeQuarto(b) : 0) || cmpNumero(a, b));

  const grupoDoTrecho = (t: Trecho): GrupoTrecho => {
    const gs = new Set<Grupo>();
    for (const q of t.quartos) for (const id of ocupantesPorQuarto.get(q.id) ?? []) {
      const p = paxById.get(id);
      const g = p ? grupoDoPax(p) : null;
      if (g) gs.add(g);
    }
    if (gs.size === 0) return null;
    return gs.size > 1 ? "misto" : [...gs][0];
  };

  const conexaoNoTrecho = (membros: PassageiroRow[], t: Trecho): SituacaoConexao => {
    const porQuarto = new Map<string, number>();
    let sem = 0;
    for (const m of membros) {
      const q = quartoDoPaxNoTrecho(m.id, t);
      if (q) porQuarto.set(q, (porQuarto.get(q) ?? 0) + 1); else sem++;
    }
    let quartoAncora: string | null = null;
    let max = 0;
    for (const [q, n] of porQuarto) if (n > max) { max = n; quartoAncora = q; }
    return { porQuarto, semQuarto: sem, quartoAncora, juntos: sem === 0 && porQuarto.size === 1 };
  };

  const pendencias = trechos.map((t) => ({ trecho: t, faltam: semQuarto(t).length }));
  const totalFaltam = pendencias.reduce((s, p) => s + p.faltam, 0);
  const conexoesSeparadas: { trecho: Trecho; conexao: Conexao; quartoAncora: string | null }[] = [];
  for (const t of trechos) for (const c of conexoes) {
    const st = conexaoNoTrecho(c.membros, t);
    if (st.porQuarto.size > 1) conexoesSeparadas.push({ trecho: t, conexao: c, quartoAncora: st.quartoAncora });
  }
  const completo = trechos.length > 0 && totalFaltam === 0 && paxAtivos.length > 0 && conexoesSeparadas.length === 0;

  // Hotéis em ordem de grupo (G1 → G2 → ambos → sem) quando há divisão.
  const prioridadeGrupo = (g: GrupoTrecho) => (g === "G1" ? 0 : g === "G2" ? 1 : g === "misto" ? 2 : 3);
  type Item = { tipo: "cabecalho"; key: string; grupo: Exclude<GrupoTrecho, null> } | { tipo: "trecho"; t: Trecho };
  const itens: Item[] = [];
  if (!temGrupos) for (const t of trechos) itens.push({ tipo: "trecho", t });
  else {
    const cg = trechos.map((t) => ({ t, g: grupoDoTrecho(t) }));
    cg.sort((a, b) => prioridadeGrupo(a.g) - prioridadeGrupo(b.g) || trechos.indexOf(a.t) - trechos.indexOf(b.t));
    let ultima: number | null = null;
    for (const { t, g } of cg) {
      const pr = prioridadeGrupo(g);
      if (pr !== ultima) { if (g) itens.push({ tipo: "cabecalho", key: `head-${pr}`, grupo: g }); ultima = pr; }
      itens.push({ tipo: "trecho", t });
    }
  }

  // Acompanhantes indicados na inscrição → palpite de quem é (1 candidato só).
  const acompanhantes = paxAtivos
    .filter((p) => (p.acompanhante_nome ?? "").trim())
    .map((p) => {
      const partes = nomesAcompanhante(p.acompanhante_nome).map((nome) => {
        const alvo = normalizarNome(nome);
        const cands = paxAtivos.filter((o) => {
          if (o.id === p.id) return false;
          const n = normalizarNome(o.nome_completo);
          return n === alvo || n.includes(alvo) || alvo.includes(n);
        });
        return { nome, candidato: cands.length === 1 ? cands[0] : null };
      });
      const jaConectados = !!p.conexao_viagem_id && paxAtivos.some((o) => o.id !== p.id && o.conexao_viagem_id === p.conexao_viagem_id);
      return { pax: p, partes, jaConectados };
    })
    .sort((a, b) => a.pax.nome_completo.localeCompare(b.pax.nome_completo, "pt-BR"));
  const paxOrdenados = [...paxAtivos].sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, "pt-BR"));

  return {
    paxAtivos, paxById, quartoById, paxOrdenados, usaGrupos, temGrupos, grupoDoPax,
    conexoes, conexaoByPax, membrosConexaoByPax,
    trechos, trechoDoQuarto, ocupantesPorQuarto, quartoDoPaxNoTrecho,
    nomeExtensao, paxRelevantes, semQuarto, grupoDoQuarto, quartosOrdenados, grupoDoTrecho, conexaoNoTrecho,
    pendencias, totalFaltam, conexoesSeparadas, completo, itens, acompanhantes,
  };
}

export type Rooming = ReturnType<typeof calcularRooming>;

export const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? n;
