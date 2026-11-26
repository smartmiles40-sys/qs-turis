// src/expedicoes/passageiros/aereoDados.ts
// -----------------------------------------------------------------------------
// Leitura do que a coluna PASSAGEM da matriz precisa (26/11, lib/cockpit/passagem.ts).
// SÓ LÊ. Três fontes, cada uma degrada sozinha (falhou = segue sem ela):
//   expedicao_voos            voos do grupo (sem passageiro) e os de cada pessoa
//   rel_viagens.bitrix_dados  "Passagem Aérea" do card (Inclusa / Não inclusa)
//   rel_viagem_trechos        bilhetes que a IA/o time cadastrou na viagem do Rel
//                             (ex.: o GOL Fortaleza → Guarulhos comprado à parte)
// -----------------------------------------------------------------------------
import { lerTudo, supabase } from "../lib/banco";
import type { ExpedicaoVooRow, PassageiroRow } from "../lib/database";
import { ehNacional, iataDe, ladoDoTrecho, ufDoAeroporto, ufDoCep, ufDoTexto, type EntradaPassagem, type VooPassagem } from "../lib/cockpit/passagem";

const CAMPO_PASSAGEM = "UF_CRM_1770124038221"; // "Passagem Aérea" no card de venda

export interface DadosAereo {
  voos: ExpedicaoVooRow[];
  /** passageiro.id → texto do "Passagem Aérea" do card de venda */
  passagemBitrix: Map<string, string>;
  /** passageiro.id → voos cadastrados na viagem dele no Rel (IA, à mão, venda) */
  voosRel: Map<string, VooPassagem[]>;
}

type ViagemRel = { id: string; cliente_id: string | null; bitrix_deal_id: string | null; bitrix_dados: Record<string, unknown> | null; data_embarque: string | null; data_retorno: string | null; status: string | null };

const lotes = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * A viagem da pessoa no Rel: pelo card (bitrix_deal_id) ou pela PESSOA (cliente da
 * viagem ou passageiro dela) com datas dentro da janela da expedição (±15 dias).
 * Pelo card só 49 de 409 batiam em 26/11; pela pessoa, 287.
 */
export async function carregarAereo(exp: { id: string; data_embarque: string | null; data_retorno: string | null }, pax: readonly PassageiroRow[]): Promise<DadosAereo> {
  const voos = await lerTudo<ExpedicaoVooRow>("expedicao_voos", (q) => q.eq("expedicao_id", exp.id)).catch(() => [] as ExpedicaoVooRow[]);
  const passagemBitrix = new Map<string, string>();
  const voosRel = new Map<string, VooPassagem[]>();
  try {
    const clientes = [...new Set(pax.map((p) => p.cliente_id).filter((x): x is string => !!x))];
    const deals = [...new Set(pax.map((p) => p.bitrix_deal_id).filter((x): x is string => !!x))];
    const COLS = "id, cliente_id, bitrix_deal_id, bitrix_dados, data_embarque, data_retorno, status";
    const viagens = new Map<string, ViagemRel>();
    /** viagem → clientes que viajam nela (comprador + passageiros) */
    const quem = new Map<string, Set<string>>();
    const junta = (vid: string, cid: string | null) => { if (!cid) return; const s = quem.get(vid) ?? new Set<string>(); s.add(cid); quem.set(vid, s); };
    for (const l of lotes(clientes, 100)) {
      const [a, b] = await Promise.all([
        supabase.from("rel_viagens").select(COLS).in("cliente_id", l),
        supabase.from("rel_viagem_passageiros").select("viagem_id, cliente_id").in("cliente_id", l),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      for (const v of (a.data ?? []) as ViagemRel[]) { viagens.set(v.id, v); junta(v.id, v.cliente_id); }
      for (const r of (b.data ?? []) as { viagem_id: string; cliente_id: string }[]) junta(r.viagem_id, r.cliente_id);
    }
    const faltam = [...quem.keys()].filter((id) => !viagens.has(id));
    for (const l of lotes(faltam, 100)) {
      const { data, error } = await supabase.from("rel_viagens").select(COLS).in("id", l);
      if (error) throw error;
      for (const v of (data ?? []) as ViagemRel[]) viagens.set(v.id, v);
    }
    for (const l of lotes(deals, 100)) {
      const { data, error } = await supabase.from("rel_viagens").select(COLS).in("bitrix_deal_id", l);
      if (error) throw error;
      for (const v of (data ?? []) as ViagemRel[]) viagens.set(v.id, v);
    }
    // só as viagens desta expedição (datas dentro da janela) e não canceladas
    const de = exp.data_embarque ? somaDias(exp.data_embarque, -15) : null;
    const ate = exp.data_retorno ? somaDias(exp.data_retorno, 15) : null;
    const valem = [...viagens.values()].filter((v) => v.status !== "cancelada" && v.data_embarque
      && (!de || v.data_embarque >= de) && (!ate || v.data_embarque <= ate));
    // viagem → passageiros desta expedição
    const paxDa = new Map<string, string[]>();
    for (const v of valem) {
      const cs = quem.get(v.id) ?? new Set<string>();
      paxDa.set(v.id, pax.filter((p) => (p.cliente_id && cs.has(p.cliente_id)) || (p.bitrix_deal_id && p.bitrix_deal_id === v.bitrix_deal_id)).map((p) => p.id));
    }
    for (const v of valem) {
      const k = Object.keys(v.bitrix_dados ?? {}).find((x) => x.includes(CAMPO_PASSAGEM));
      const t = k ? String((v.bitrix_dados as Record<string, unknown>)[k] ?? "").trim() : "";
      if (t) for (const pid of paxDa.get(v.id) ?? []) if (!passagemBitrix.has(pid)) passagemBitrix.set(pid, t);
    }
    for (const l of lotes(valem.map((v) => v.id), 100)) {
      const { data, error } = await supabase.from("rel_viagem_trechos")
        .select("viagem_id, numero, origem, destino, origem_codigo, destino_codigo, localizador, status_manual")
        .in("viagem_id", l).in("fonte", ["ia", "manual", "venda"]).like("tipo", "voo%");
      if (error) throw error;
      for (const t of (data ?? []) as { viagem_id: string; numero: string | null; origem: string | null; destino: string | null; origem_codigo: string | null; destino_codigo: string | null; localizador: string | null; status_manual: string | null }[]) {
        if (t.status_manual === "cancelado") continue;
        const origem = t.origem_codigo || t.origem;
        const destino = t.destino_codigo || t.destino;
        const v: VooPassagem = { lado: null, numero: t.numero, origem, destino, localizador: t.localizador };
        // lado pelo Brasil: sai daqui = ida, chega aqui = volta (voo nacional fica sem lado)
        if (!ehNacional(v)) v.lado = ufDoAeroporto(iataDe(origem)) ? "ida" : ufDoAeroporto(iataDe(destino)) ? "volta" : null;
        for (const pid of paxDa.get(t.viagem_id) ?? []) { const a = voosRel.get(pid); if (a) a.push(v); else voosRel.set(pid, [v]); }
      }
    }
  } catch {
    // sem acesso às tabelas do Rel (ou falhou): a coluna segue só com o que as Expedições sabem
  }
  return { voos, passagemBitrix, voosRel };
}

/** Entrada da coluna PASSAGEM de uma pessoa a partir do que foi lido. */
export function entradaPassagem(p: PassageiroRow, d: DadosAereo): EntradaPassagem {
  const paraVoo = (v: ExpedicaoVooRow): VooPassagem => ({ lado: ladoDoTrecho(v.trecho) === "interno" ? null : ladoDoTrecho(v.trecho), numero: [v.companhia?.trim(), v.numero_voo?.trim()].filter(Boolean).join(" ") || null, origem: v.origem, destino: v.destino, localizador: v.localizador?.trim() || null });
  const grupo = d.voos
    .filter((v) => !v.passageiro_id && !v.extensao_id && (!v.grupo_id || v.grupo_id === p.grupo_id) && ladoDoTrecho(v.trecho) !== "interno")
    .map(paraVoo);
  const numerosGrupo = new Set(grupo.map((v) => soDigitos(v.numero)).filter(Boolean));
  const proprios: VooPassagem[] = [
    ...d.voos.filter((v) => v.passageiro_id === p.id && ladoDoTrecho(v.trecho) !== "interno").map(paraVoo),
    // da viagem do Rel: só o que NÃO é o voo do grupo (a IA também lê o bilhete do grupo)
    ...(d.voosRel.get(p.id) ?? []).filter((v) => !numerosGrupo.has(soDigitos(v.numero))),
  ];
  const incluso = (p as PassageiroRow & { aereo_incluso?: boolean | null }).aereo_incluso;
  const pa = d.passagemBitrix.get(p.id)?.toLowerCase() ?? "";
  const doBitrix = /^n[aã]o/.test(pa) ? false : /^inclu/.test(pa) ? true : null;
  return {
    aereoIncluso: incluso ?? doBitrix,
    fonteIncluso: incluso != null ? "venda" : doBitrix != null ? "bitrix" : null,
    grupo, proprios,
    ufCasa: ufDoCep(p.endereco_cep) ?? ufDoTexto(p.endereco_estado),
    vooNacionalMarcado: !!p.voo_nacional_necessario,
  };
}
