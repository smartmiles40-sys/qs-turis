// src/lib/emissao.ts
// -----------------------------------------------------------------------------
// EMISSÃO FUTURA (24/11/2026). Bruno: "tem algumas coisas que só emitimos depois
// de uma certa data, como o trem-bala, que só abre 3 meses antes".
//
// Cada item vendido pode ter, em `dados`:
//   emite_depois = "sim"  → não dá pra emitir na venda, fica pra perto da data
//   emitir_de    = AAAA-MM-DD → quando ABRE pra emitir (antes disso não adianta)
//   emitir_ate   = AAAA-MM-DD → o último dia pra emitir sem risco
// As REGRAS dizem, por tipo (e palavra no nome), quantos dias antes do uso a
// emissão abre e até quando dá pra deixar. Ficam em qs_settings
// "rel_regras_emissao" (a gestão edita na aba Emissão futura); sem nada salvo,
// valem as REGRAS_PADRAO.
// Usado no Subir venda (sugere as datas), na aba Emissão futura e na Rotina.
// -----------------------------------------------------------------------------
// Puro (sem banco) — carregar/salvar as regras fica em emissaoRegras.ts.

export interface RegraEmissao {
  id: string;
  rotulo: string;
  /** tipo do catálogo (trem, passeio, seguro…) */
  tipo: string;
  /** palavras no nome/dados que fazem a regra valer (vazio = vale pro tipo todo) */
  palavras: string[];
  /** abre X dias antes da data de uso (null = pode emitir a qualquer hora) */
  abre_dias: number | null;
  /** emitir até X dias antes da data de uso (null = sem limite próprio, vale a data de uso) */
  limite_dias: number | null;
}

export const CHAVE_REGRAS = "rel_regras_emissao";

export const REGRAS_PADRAO: RegraEmissao[] = [
  { id: "trem_bala", rotulo: "Trem-bala (Shinkansen / JR)", tipo: "trem", palavras: ["shinkansen", "trem bala", "trem-bala", "jr pass", "jr "], abre_dias: 90, limite_dias: 7 },
  { id: "trem", rotulo: "Trem / ônibus", tipo: "trem", palavras: [], abre_dias: 90, limite_dias: 7 },
];

const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A regra que vale pro item: primeiro as que têm palavra que bate, depois a do tipo todo. */
export function regraPara(regras: RegraEmissao[], tipo: string, texto: string): RegraEmissao | null {
  const t = ` ${semAcento(texto)} `;
  const doTipo = regras.filter((r) => r.tipo === tipo);
  return doTipo.find((r) => r.palavras.some((p) => p.trim() && t.includes(semAcento(p)))) ?? doTipo.find((r) => !r.palavras.some((p) => p.trim())) ?? null;
}

/** Datas sugeridas pela regra a partir da data de uso. */
export function sugerirDatas(regra: RegraEmissao | null, uso: string | null): { emitir_de: string | null; emitir_ate: string | null } {
  if (!regra || !uso) return { emitir_de: null, emitir_ate: null };
  return {
    emitir_de: regra.abre_dias != null ? somaDias(uso, -regra.abre_dias) : null,
    emitir_ate: regra.limite_dias != null ? somaDias(uso, -regra.limite_dias) : null,
  };
}

/** Texto que a regra olha: nome + dados do item. */
export function textoDoItem(nome: string, dados: Record<string, unknown> | null | undefined): string {
  return [nome, ...Object.values(dados ?? {}).filter((v) => typeof v === "string")].join(" ");
}

export type SituacaoEmissao = "aguardando" | "aberta" | "urgente" | "vencida";

export interface EstadoEmissao {
  situacao: SituacaoEmissao;
  /** abre pra emitir (null = já pode) */
  abre: string | null;
  /** prazo final: emitir_ate, senão a data de uso */
  prazo: string | null;
  /** dias até abrir (aguardando) ou até o prazo (aberta/urgente/vencida) */
  dias: number | null;
  texto: string;
}

const emDias = (n: number) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : n < 0 ? `há ${-n} dias` : `em ${n} dias`);
const br = (d: string) => { const [a, m, dd] = d.split("-"); return `${dd}/${m}/${a.slice(2)}`; };

/** Em que pé está a emissão do item hoje. Urgente = faltam 7 dias ou menos pro prazo. */
export function estadoEmissao(item: { data_inicio: string | null; dados: Record<string, unknown> | null | undefined }, hoje: string): EstadoEmissao {
  const d = item.dados ?? {};
  const abre = typeof d.emitir_de === "string" && d.emitir_de ? d.emitir_de.slice(0, 10) : null;
  const prazo = (typeof d.emitir_ate === "string" && d.emitir_ate ? d.emitir_ate.slice(0, 10) : null) ?? item.data_inicio?.slice(0, 10) ?? null;
  if (abre && abre > hoje) {
    const n = diasEntre(hoje, abre);
    return { situacao: "aguardando", abre, prazo, dias: n, texto: `abre ${br(abre)} (${emDias(n)})` };
  }
  if (!prazo) return { situacao: "aberta", abre, prazo, dias: null, texto: abre ? `aberta desde ${br(abre)}` : "pode emitir" };
  const n = diasEntre(hoje, prazo);
  if (n < 0) return { situacao: "vencida", abre, prazo, dias: n, texto: `prazo era ${br(prazo)} (${emDias(n)})` };
  return { situacao: n <= 7 ? "urgente" : "aberta", abre, prazo, dias: n, texto: `${abre ? "aberta · " : ""}emitir até ${br(prazo)} (${emDias(n)})` };
}

export const COR_EMISSAO: Record<SituacaoEmissao, string> = { aguardando: "#64748B", aberta: "#2563EB", urgente: "#D97706", vencida: "#DC2626" };
