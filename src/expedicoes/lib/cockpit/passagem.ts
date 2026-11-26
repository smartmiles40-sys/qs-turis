// src/expedicoes/lib/cockpit/passagem.ts
// -----------------------------------------------------------------------------
// COLUNA "PASSAGEM" DA MATRIZ (Bruno, 26/11/2026): "na tela das expedições onde
// ficam os passageiros, mais uma coluna — emissão da passagem — de acordo com a
// passagem; e com o CEP da pessoa ver se vai precisar de voo interno pra GRU".
//
// Na expedição os voos são todos juntos (voo do grupo), mas tem quem compra a
// ida ou a volta separado, e quem não comprou o aéreo com a gente. A célula diz,
// por pessoa:
//   • o aéreo foi vendido? passageiros.aereo_incluso (a venda nova no QS grava),
//     senão o campo "Passagem Aérea" do card no Bitrix (Inclusa / Não inclusa);
//   • ida e volta: voo do grupo (expedicao_voos sem passageiro) ou voo próprio
//     (expedicao_voos.passageiro_id, ou bilhete lido pela IA na viagem do Rel);
//     emitida = o voo tem localizador;
//   • voo interno até o ponto de encontro: UF do CEP (a do endereço, se não tiver
//     CEP) × UF do aeroporto onde o grupo embarca (origem do 1º voo de ida).
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------

/** UF pelo CEP (faixas dos Correios). null = CEP ausente ou inválido. */
export function ufDoCep(cep: string | null | undefined): string | null {
  const d = String(cep ?? "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  const n = Number(d.slice(0, 5));
  const faixas: [number, number, string][] = [
    [1000, 19999, "SP"], [20000, 28999, "RJ"], [29000, 29999, "ES"], [30000, 39999, "MG"],
    [40000, 48999, "BA"], [49000, 49999, "SE"], [50000, 56999, "PE"], [57000, 57999, "AL"],
    [58000, 58999, "PB"], [59000, 59999, "RN"], [60000, 63999, "CE"], [64000, 64999, "PI"],
    [65000, 65999, "MA"], [66000, 68899, "PA"], [68900, 68999, "AP"], [69000, 69299, "AM"],
    [69300, 69399, "RR"], [69400, 69899, "AM"], [69900, 69999, "AC"], [70000, 72799, "DF"],
    [72800, 72999, "GO"], [73000, 73699, "DF"], [73700, 76799, "GO"], [76800, 76999, "RO"],
    [77000, 77999, "TO"], [78000, 78899, "MT"], [79000, 79999, "MS"], [80000, 87999, "PR"],
    [88000, 89999, "SC"], [90000, 99999, "RS"],
  ];
  return faixas.find(([a, b]) => n >= a && n <= b)?.[2] ?? null;
}

const NOMES_UF: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO",
  roraima: "RR", "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};
const UFS = new Set(Object.values(NOMES_UF));

/** "Ceará", "Ceara", "ce", "São Paulo - SP" → UF. */
export function ufDoTexto(s: string | null | undefined): string | null {
  const t = String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!t) return null;
  const sigla = t.match(/(?:^|[^a-z])([a-z]{2})$/)?.[1]?.toUpperCase();
  if (sigla && UFS.has(sigla)) return sigla;
  const nome = t.replace(/\s*-\s*[a-z]{2}$/, "").trim();
  return NOMES_UF[nome] ?? null;
}

/** Aeroportos do Brasil que aparecem como ponto de encontro / voo interno. */
const UF_DO_AEROPORTO: Record<string, string> = {
  GRU: "SP", CGH: "SP", VCP: "SP", GIG: "RJ", SDU: "RJ", CNF: "MG", PLU: "MG", BSB: "DF", SSA: "BA",
  REC: "PE", FOR: "CE", POA: "RS", CWB: "PR", FLN: "SC", NVT: "SC", VIX: "ES", GYN: "GO", BEL: "PA",
  MAO: "AM", NAT: "RN", MCZ: "AL", AJU: "SE", JPA: "PB", THE: "PI", SLZ: "MA", CGB: "MT", CGR: "MS",
  PMW: "TO", PVH: "RO", BVB: "RR", RBR: "AC", MCP: "AP", IOS: "BA", BPS: "BA", JDO: "CE", UDI: "MG",
  LDB: "PR", IGU: "PR", JOI: "SC", RAO: "SP", SJP: "SP",
};

/** "São Paulo (GRU) · Terminal 3" → "GRU"; "GRU" → "GRU". */
export function iataDe(s: string | null | undefined): string | null {
  const t = String(s ?? "").toUpperCase();
  return t.match(/\(([A-Z]{3})\b/)?.[1] ?? (/^[A-Z]{3}$/.test(t.trim()) ? t.trim() : null);
}
export const ufDoAeroporto = (iata: string | null | undefined) => (iata ? UF_DO_AEROPORTO[iata.toUpperCase()] ?? null : null);
const nacional = (iata: string | null | undefined) => !!ufDoAeroporto(iata);

/** Lado do voo pelo campo "trecho" das Expedições ("Ida", "Volta (2/2)", "Interno"…). */
export function ladoDoTrecho(trecho: string | null | undefined): "ida" | "volta" | "interno" | null {
  const t = String(trecho ?? "").trim().toLowerCase();
  if (t.startsWith("ida")) return "ida";
  if (t.startsWith("volta")) return "volta";
  if (t.startsWith("interno")) return "interno";
  return null;
}

export interface VooPassagem {
  lado: "ida" | "volta" | "interno" | null;
  numero: string | null;
  origem: string | null;
  destino: string | null;
  localizador: string | null;
}

export interface EntradaPassagem {
  /** O aéreo internacional foi vendido com a gente? null = ninguém disse. */
  aereoIncluso: boolean | null;
  /** De onde veio o aereoIncluso (pra dica). */
  fonteIncluso: "venda" | "bitrix" | null;
  /** Voos do grupo que valem pra pessoa (sem passageiro; do subgrupo dela ou de todos). */
  grupo: readonly VooPassagem[];
  /** Voos só dela (Expedições com passageiro_id + bilhetes lidos pela IA no Rel). */
  proprios: readonly VooPassagem[];
  /** UF onde mora (CEP; senão o texto do estado). */
  ufCasa: string | null;
  /** Marcado à mão nas Expedições ("precisa de voo nacional"). */
  vooNacionalMarcado: boolean;
}

export interface ResultadoPassagem {
  rotulo: string;
  tom: "ok" | "warn" | "danger" | "neutral";
  /** Entra no placar ("12/16 emitidas"). */
  aplica: boolean;
  ok: boolean;
  pendente: boolean;
  dica: string;
}

const desc = (v: VooPassagem) => [v.numero, v.localizador ? `(${v.localizador})` : null].filter(Boolean).join(" ");

/** Voo dentro do Brasil (os dois aeroportos daqui) — ex.: FOR → GRU até o encontro. */
export const ehNacional = (v: Pick<VooPassagem, "origem" | "destino">) => nacional(iataDe(v.origem)) && nacional(iataDe(v.destino));

/** Aeroporto onde o grupo embarca: origem do 1º voo de ida internacional do grupo. */
export function pontoDeEncontro(grupo: readonly VooPassagem[]): string | null {
  const ida = grupo.find((v) => v.lado === "ida" && !ehNacional(v));
  return iataDe(ida?.origem ?? null);
}

/**
 * Situação da passagem de UMA pessoa. `posEmbarque`: viagem começou ou acabou —
 * nada alarma (mesma regra das outras colunas, spec §4.2).
 */
export function avaliarPassagem(e: EntradaPassagem, posEmbarque = false): ResultadoPassagem {
  const dicas: string[] = [];
  const separadas: string[] = [];
  let falta = 0;          // algo a resolver
  let grave = false;      // vermelho antes do embarque (comprou sem aéreo e não mandou o bilhete)
  let tudoEmitido = true;

  for (const lado of ["ida", "volta"] as const) {
    const nome = lado === "ida" ? "Ida" : "Volta";
    const meus = e.proprios.filter((v) => v.lado === lado && !ehNacional(v));
    if (meus.length) {
      const emitido = meus.some((v) => v.localizador);
      if (!emitido) { tudoEmitido = false; falta++; }
      separadas.push(lado);
      dicas.push(`${nome}: voo próprio ${meus.map(desc).join(" + ")}${emitido ? "" : " — sem localizador"}`);
      continue;
    }
    if (e.aereoIncluso === false) {
      tudoEmitido = false; falta++; grave = true;
      dicas.push(`${nome}: compra por conta própria — falta o bilhete`);
      continue;
    }
    const g = e.grupo.filter((v) => v.lado === lado && !ehNacional(v));
    if (!g.length) {
      tudoEmitido = false; falta++;
      dicas.push(`${nome}: o grupo ainda não tem voo cadastrado`);
      continue;
    }
    const emitido = g.some((v) => v.localizador);
    if (!emitido) { tudoEmitido = false; falta++; }
    dicas.push(`${nome}: voo do grupo ${g.map(desc).join(" + ")}${emitido ? "" : " — sem localizador"}`);
  }

  // Voo nacional até o ponto de encontro (CEP × aeroporto do grupo)
  const encontro = pontoDeEncontro(e.grupo);
  const ufEncontro = ufDoAeroporto(encontro);
  const precisa = e.vooNacionalMarcado || (!!e.ufCasa && !!ufEncontro && e.ufCasa !== ufEncontro);
  let sufixo = "";
  if (precisa) {
    const onde = e.ufCasa && encontro ? `mora em ${e.ufCasa}, o grupo sai de ${encontro}` : "marcado como precisa de voo nacional";
    const meus = e.proprios.filter(ehNacional);
    const doGrupo = e.grupo.filter((v) => ehNacional(v) && ufDoAeroporto(iataDe(v.origem)) === e.ufCasa);
    if (meus.length) { sufixo = " + nacional"; dicas.push(`Voo nacional: ${meus.map(desc).join(" + ")} (${onde})`); }
    else if (doGrupo.length) dicas.push(`Voo nacional: o do grupo ${doGrupo.map(desc).join(" + ")} (${onde})`);
    else { sufixo = " · falta nacional"; falta++; dicas.push(`Voo nacional: provável — ${onde}; nenhum bilhete nacional cadastrado`); }
  } else if (!e.ufCasa) {
    dicas.push("Voo nacional: sem CEP/estado na ficha — não dá pra saber se precisa");
  }

  if (e.aereoIncluso == null) dicas.push("A venda não diz se o aéreo está incluso (nem no QS nem no Bitrix)");
  else dicas.push(`Aéreo ${e.aereoIncluso ? "incluso" : "NÃO incluso"} (${e.fonteIncluso === "venda" ? "venda no QS" : "card do Bitrix"})`);

  let rotulo: string;
  if (grave && !separadas.length) rotulo = "Compra própria · sem bilhete";
  else if (!tudoEmitido) rotulo = "Falta emitir";
  else rotulo = separadas.length ? `Emitida · ${separadas.join(" e ")} separada${separadas.length > 1 ? "s" : ""}` : "Emitida";
  rotulo += sufixo;

  const dica = dicas.join("\n");
  if (posEmbarque) return { rotulo, tom: falta ? "warn" : "ok", aplica: true, ok: tudoEmitido, pendente: false, dica };
  return { rotulo, tom: grave ? "danger" : falta ? "warn" : "ok", aplica: true, ok: tudoEmitido, pendente: falta > 0, dica };
}
