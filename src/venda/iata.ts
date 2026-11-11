// src/venda/iata.ts
// -----------------------------------------------------------------------------
// AÉREO DA VENDA SÓ COM CÓDIGO IATA (Bruno, 11/11/2026): "Hoje o pessoal faz
// De: GRU para: Europa… Temos que colocar SOMENTE os IATAs dos aeroportos caso
// seja vendido com aéreo, pra sabermos pra onde os clientes estão indo.
// Extremamente importante. Isso inclui voos internos também."
//
// Regras PURAS (sem banco, sem React) — testadas em tests/venda/iata.test.ts.
//
// ── FORMATO DO TRECHO GRAVADO (qs_venda_itens.dados.trechos, jsonb) ──────────
// Um objeto por VOO (ida, volta, conexões e voos internos são trechos separados),
// com os MESMOS nomes de coluna de rel_viagem_trechos (0106 + 0139), pro
// Relacionamento (próximo voo, check-in) usar direto:
//   {
//     "ordem": 1,
//     "tipo": "voo_internacional" | "voo_interno",   // = rel_viagem_trechos.tipo
//     "sentido": "ida" | "volta" | "interno",
//     "conexao": false,                              // true = continua a jornada do trecho anterior
//     "origem_codigo": "GRU",                         // = rel_viagem_trechos.origem_codigo (IATA, 3 letras)
//     "destino_codigo": "LIS",                        // = rel_viagem_trechos.destino_codigo
//     "origem": "São Paulo, SP",                      // = rel_viagem_trechos.origem (cidade, da lista)
//     "destino": "Lisboa",                            // = rel_viagem_trechos.destino
//     "data": "2027-03-12", "hora_saida": "22:10",    // hora LOCAL do bilhete (partida_em = data+hora no fuso de origem)
//     "chegada_data": "2027-03-13", "hora_chegada": "11:30",
//     "companhia": "TAP", "numero": "TP 82",          // = rel_viagem_trechos.companhia / numero
//     "localizador": "ABC123", "classe": "Econômica", "bagagem": "1 x 23 kg",
//     "origem_texto": "Europa"                        // SÓ quando o código falta: o que estava escrito
//   }                                                 //   (venda antiga / IA) — PENDENTE até o closer corrigir
// Junto, `dados.voos` continua sendo gravado como TEXTO ("GRU → LIS 12/03/2027 TP 82",
// uma linha por trecho) pra quem ainda lê o campo antigo.
//
// Onde vale: item tipo "aereo" sempre; "pacote" e "outro" quando marcados
// "Inclui aéreo" (dados.aereo_incluso = "sim"). Expedição NÃO: o voo do grupo é
// cadastrado pelo Operacional na própria expedição.
//
// Validação de um código:
//   • ok         — 3 letras e está na lista (src/propostas/aeroportos.ts);
//   • fora_lista — 3 letras, não está na lista: ACEITA com aviso "confira";
//   • invalido   — texto livre ("Europa", "Itália", "São Paulo"), código de
//                  CIDADE (SAO, RIO, TYO…) ou sigla de região/país (EUA, EUR…).
// Consolidar a venda BLOQUEIA com trecho inválido/vazio; Salvar e Reservar só avisam.
// -----------------------------------------------------------------------------
import { AEROPORTOS, type Aeroporto } from "../propostas/aeroportos.ts";

const txt = (v: unknown): string => (v == null ? "" : String(v).trim());
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Códigos de CIDADE (grupo de aeroportos): não são aeroporto — tem que escolher qual. */
export const CODIGOS_DE_CIDADE: Record<string, string[]> = {
  SAO: ["GRU", "CGH", "VCP"], RIO: ["GIG", "SDU"], BHZ: ["CNF", "PLU"], TYO: ["NRT", "HND"], OSA: ["KIX", "ITM"],
  LON: ["LHR", "LGW", "STN", "LTN", "LCY"], PAR: ["CDG", "ORY"], NYC: ["JFK", "EWR", "LGA"], MIL: ["MXP", "LIN", "BGY"],
  ROM: ["FCO", "CIA"], BUE: ["EZE", "AEP"], SEL: ["ICN", "GMP"], BJS: ["PEK", "PKX"], STO: ["ARN"], MOW: ["SVO"],
  CHI: ["ORD"], WAS: ["IAD", "DCA"], REK: ["KEF"], YTO: ["YYZ"], YMQ: ["YUL"], JKT: ["CGK"],
};
/** Siglas de 3 letras que aparecem no lugar do aeroporto e NÃO são aeroporto. */
const NAO_AEROPORTO = new Set(["EUA", "USA", "EUR", "ASI", "AFR", "OCE", "AME", "SUL", "NOR", "JAP", "CHN", "XXX", "AAA", "ZZZ"]);
/** Regiões/continentes escritos por extenso. */
const REGIOES = ["europa", "asia", "africa", "oceania", "america", "america do sul", "america do norte", "america central", "caribe",
  "oriente medio", "oriente", "sudeste asiatico", "escandinavia", "patagonia", "mundo", "exterior", "internacional", "nacional"];

export type StatusIata = "ok" | "fora_lista" | "invalido" | "vazio";
export interface LeituraIata { codigo: string; status: StatusIata; mensagem?: string; sugestoes?: string[] }

/** Cidade sem o ", UF" (pra comparar com o que foi digitado). */
const cidadeBase = (a: Aeroporto) => a.cidade.split(",")[0].replace(/\s*\(.*\)\s*$/, "").trim();
const semPrefixo = (s: string) => s.replace(/^aeroporto( internacional)?( de| do| da| dos| das)?\s+/, "").trim();

const PAISES = new Map<string, string[]>();
for (const [cod, a] of Object.entries(AEROPORTOS)) {
  if (!a.pais) continue;
  const k = norm(a.pais);
  PAISES.set(k, [...(PAISES.get(k) ?? []), cod]);
}

/** Rótulo do autocompletar: "LIS · Lisboa, Portugal" (Brasil: "GRU · São Paulo, SP"). */
export function rotuloAeroporto(cod: string): string {
  const a = AEROPORTOS[cod];
  if (!a) return cod;
  return `${cod} · ${a.cidade}${a.pais && a.pais !== "Brasil" ? `, ${a.pais}` : ""}`;
}

/**
 * Lê o que foi digitado/gravado e devolve o código IATA (ou por que não dá).
 * Aceita "lis", "LIS", "LIS · Lisboa", "Lisboa (LIS)" e o nome da cidade ou do
 * aeroporto quando só tem UM aeroporto com esse nome ("Lisboa" → LIS).
 */
export function lerIata(entrada: unknown): LeituraIata {
  const t = txt(entrada);
  if (!t) return { codigo: "", status: "vazio" };
  const m = /^([A-Za-z]{3})(?:\s*[·\-–—(,:/|]|$)/.exec(t) || /\(([A-Za-z]{3})\)/.exec(t);
  if (m) {
    const c = m[1].toUpperCase();
    if (CODIGOS_DE_CIDADE[c]) {
      const s = CODIGOS_DE_CIDADE[c];
      return { codigo: "", status: "invalido", sugestoes: s, mensagem: `${c} é o código da CIDADE, não de um aeroporto: escolha ${s.join(", ")}.` };
    }
    if (NAO_AEROPORTO.has(c)) return { codigo: "", status: "invalido", mensagem: `"${t}" não é aeroporto: use o código de 3 letras do aeroporto (ex.: LIS, FCO, NRT).` };
    if (AEROPORTOS[c]) return { codigo: c, status: "ok" };
    // 3 letras sozinhas que não estão na lista: aceita, mas pede pra conferir.
    if (/^[A-Za-z]{3}$/.test(t) || m.index === 0) return { codigo: c, status: "fora_lista", mensagem: `${c} não está na lista de aeroportos do QS — confira o código.` };
  }
  const n = semPrefixo(norm(t));
  if (REGIOES.includes(n)) return { codigo: "", status: "invalido", mensagem: `"${t}" é uma região, não um aeroporto: escolha o aeroporto de chegada (ex.: LIS, CDG, FCO).` };
  const pais = PAISES.get(n);
  if (pais) {
    return { codigo: "", status: "invalido", sugestoes: pais.slice(0, 6), mensagem: `"${t}" é um país: escolha o aeroporto (${pais.slice(0, 4).join(", ")}${pais.length > 4 ? "…" : ""}).` };
  }
  const nCidade = n.split(",")[0].trim();
  let achados = Object.entries(AEROPORTOS).filter(([, a]) => norm(cidadeBase(a)) === nCidade || norm(a.cidade) === n).map(([c]) => c);
  if (!achados.length) achados = Object.entries(AEROPORTOS).filter(([, a]) => n.length >= 4 && (semPrefixo(norm(a.nome)) === n || norm(a.nome).includes(n))).map(([c]) => c);
  if (achados.length === 1) return { codigo: achados[0], status: "ok", mensagem: `Entendi "${t}" como ${rotuloAeroporto(achados[0])}.` };
  if (achados.length > 1) return { codigo: "", status: "invalido", sugestoes: achados, mensagem: `"${t}" tem mais de um aeroporto: escolha ${achados.join(", ")}.` };
  return { codigo: "", status: "invalido", mensagem: `Não achei o aeroporto "${t}": use o código IATA de 3 letras (ex.: GRU, LIS, NRT).` };
}

export interface OpcaoAeroporto { codigo: string; rotulo: string; cidade: string; nome: string; pais: string }

/** Sugestões do autocompletar: código, cidade, aeroporto ou país ("lis", "Lisboa", "Itália"). */
export function buscarAeroportos(q: string, limite = 8): OpcaoAeroporto[] {
  const n = norm(q);
  if (!n) return [];
  const Q = n.toUpperCase();
  const pontos: { c: string; p: number }[] = [];
  for (const [c, a] of Object.entries(AEROPORTOS)) {
    const cid = norm(a.cidade), nome = norm(a.nome), pais = norm(a.pais ?? "");
    let p = -1;
    if (c === Q) p = 0;
    else if (Q.length <= 3 && c.startsWith(Q)) p = 1;
    else if (cid.startsWith(n)) p = 2;
    else if (cid.includes(n) || nome.includes(n)) p = 3;
    else if (pais.startsWith(n)) p = 4;
    if (p >= 0) pontos.push({ c, p });
  }
  return pontos.sort((x, y) => x.p - y.p || x.c.localeCompare(y.c)).slice(0, limite).map(({ c }) => {
    const a = AEROPORTOS[c];
    return { codigo: c, rotulo: rotuloAeroporto(c), cidade: a.cidade, nome: a.nome, pais: a.pais ?? "" };
  });
}

// ── Trechos ─────────────────────────────────────────────────────────────────
export type SentidoTrecho = "ida" | "volta" | "interno";
export interface TrechoVenda {
  ordem: number;
  tipo: "voo_internacional" | "voo_interno";
  sentido: SentidoTrecho;
  conexao: boolean;
  origem_codigo: string;
  destino_codigo: string;
  origem: string;
  destino: string;
  data: string;
  hora_saida: string;
  chegada_data: string;
  hora_chegada: string;
  companhia: string;
  numero: string;
  localizador: string;
  classe: string;
  bagagem: string;
  /** O que estava escrito e NÃO virou código (venda antiga / IA). Pendente até corrigir. */
  origem_texto?: string;
  destino_texto?: string;
}

export const trechoVendaVazio = (sentido: SentidoTrecho = "ida", data = ""): TrechoVenda => ({
  ordem: 0, tipo: "voo_internacional", sentido, conexao: false, origem_codigo: "", destino_codigo: "", origem: "", destino: "",
  data, hora_saida: "", chegada_data: "", hora_chegada: "", companhia: "", numero: "", localizador: "", classe: "", bagagem: "",
});

const dataOk = (s: unknown) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(txt(s)); return m ? m[1] : ""; };
const horaOk = (s: unknown) => { const m = /^(\d{1,2}):(\d{2})/.exec(txt(s)); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };

/** Um lado do trecho (origem/destino) vindo de qualquer formato → código + cidade + texto pendente. */
function resolverLado(r: Record<string, unknown>, lado: "origem" | "destino"): { codigo: string; cidade: string; texto: string } {
  const candCodigo = [r[`${lado}_codigo`], r[lado]];
  for (const c of candCodigo) {
    const l = lerIata(c);
    // "origem" no formato gravado é a CIDADE: só vale aqui se for código (ou nome de UM aeroporto só).
    if (l.status === "ok" || l.status === "fora_lista") return { codigo: l.codigo, cidade: AEROPORTOS[l.codigo]?.cidade || txt(r[`${lado}_cidade`]), texto: "" };
  }
  for (const c of [r[`${lado}_texto`], r[`${lado}_cidade`]]) {
    const l = lerIata(c);
    if (l.status === "ok") return { codigo: l.codigo, cidade: AEROPORTOS[l.codigo]?.cidade || "", texto: "" };
  }
  const texto = [r[`${lado}_texto`], r[lado], r[`${lado}_cidade`], r[`${lado}_codigo`]].map(txt).find(Boolean) ?? "";
  return { codigo: "", cidade: "", texto };
}

/** País do aeroporto (pra decidir voo interno). */
export const paisDoAeroporto = (cod: string) => AEROPORTOS[cod]?.pais ?? "";

/** Qualquer formato de trecho (este, o do voucher/IA, o da proposta, o de rel_viagem_trechos) → TrechoVenda. */
export function normalizarTrecho(bruto: unknown, ordem = 1): TrechoVenda {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const o = resolverLado(r, "origem"), d = resolverLado(r, "destino");
  const sent = txt(r.sentido);
  const t: TrechoVenda = {
    ...trechoVendaVazio(sent === "volta" || sent === "interno" ? sent : "ida"),
    ordem, conexao: r.conexao === true,
    origem_codigo: o.codigo, destino_codigo: d.codigo, origem: o.cidade, destino: d.cidade,
    data: dataOk(r.data) || dataOk(r.partida_em), hora_saida: horaOk(r.hora_saida) || horaOk(r.saida),
    chegada_data: dataOk(r.chegada_data) || dataOk(r.chegada_em), hora_chegada: horaOk(r.hora_chegada) || horaOk(r.chegada),
    companhia: txt(r.companhia) || txt(r.cia), numero: (txt(r.numero) || txt(r.voo)).toUpperCase(),
    localizador: txt(r.localizador).toUpperCase(), classe: txt(r.classe), bagagem: txt(r.bagagem),
  };
  if (o.texto) t.origem_texto = o.texto;
  if (d.texto) t.destino_texto = d.texto;
  t.tipo = tipoDoTrecho(t, r.voo_interno === true || r.tipo === "voo_interno");
  return t;
}

/** voo_interno quando origem e destino ficam no MESMO país (Brasil ou no destino). */
export function tipoDoTrecho(t: Pick<TrechoVenda, "origem_codigo" | "destino_codigo">, padraoInterno = false): TrechoVenda["tipo"] {
  const a = paisDoAeroporto(t.origem_codigo), b = paisDoAeroporto(t.destino_codigo);
  if (a && b) return a === b ? "voo_interno" : "voo_internacional";
  return padraoInterno ? "voo_interno" : "voo_internacional";
}

const SEPARADORES = /\s*(?:→|->|=>|>|–|—|\s-\s|\s+para\s+|\s+até\s+|\s+x\s+)\s*/i;

/** Texto livre antigo ("GRU → NRT 12/03 JL 45", "GRU para Europa") → trechos (o que não virar código fica pendente). */
export function trechosDoTextoLivre(voos: string): TrechoVenda[] {
  const out: TrechoVenda[] = [];
  for (const linha of txt(voos).split(/\n|;/).map((l) => l.trim()).filter(Boolean)) {
    const ordem = out.length + 1;
    const sep = SEPARADORES.exec(linha);
    const t = trechoVendaVazio(/\bvolta\b/i.test(linha) ? "volta" : "ida");
    t.ordem = ordem;
    if (!sep) { t.origem_texto = linha; out.push(t); continue; }
    const partes = [linha.slice(0, sep.index), linha.slice(sep.index + sep[0].length)];
    const limpa = (s: string) => s.replace(/^\s*(ida|volta|de|from)(?:\s*:\s*|\s+)/i, "").replace(/\s+\d.*$/, "").replace(/\s*[·|].*$/, "").trim();
    const resto = partes[1];
    const o = lerIata(limpa(partes[0])), d = lerIata(limpa(resto));
    if (o.codigo) { t.origem_codigo = o.codigo; t.origem = AEROPORTOS[o.codigo]?.cidade ?? ""; } else t.origem_texto = limpa(partes[0]) || partes[0];
    if (d.codigo) { t.destino_codigo = d.codigo; t.destino = AEROPORTOS[d.codigo]?.cidade ?? ""; } else t.destino_texto = limpa(resto) || resto;
    const dt = /(\d{2})\/(\d{2})\/(\d{4}|\d{2})\b/.exec(resto);
    if (dt) t.data = `${dt[3].length === 2 ? `20${dt[3]}` : dt[3]}-${dt[2]}-${dt[1]}`;
    const voo = /\b([A-Z0-9]{2}\s?\d{2,4})\b/.exec(resto.toUpperCase().replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, ""));
    if (voo) t.numero = voo[1];
    t.tipo = tipoDoTrecho(t);
    out.push(t);
  }
  return out;
}

/** dados do item (tela: trechos em JSON texto; banco: array; venda antiga: só `voos`) → trechos. */
export function lerTrechos(dados: Record<string, unknown> | null | undefined): TrechoVenda[] {
  const d = dados ?? {};
  let lista: unknown = d.trechos;
  if (typeof lista === "string") {
    if (!lista.trim()) lista = null;
    else { try { lista = JSON.parse(lista); } catch { lista = null; } }
  }
  if (Array.isArray(lista)) return lista.map((t, i) => normalizarTrecho(t, i + 1));
  return txt(d.voos) ? trechosDoTextoLivre(txt(d.voos)) : [];
}

/** A tela guarda os trechos como texto JSON dentro de `dados` (ItemVenda.dados é Record<string,string>). */
export const comTrechos = (dados: Record<string, string>, ts: TrechoVenda[]): Record<string, string> =>
  ({ ...dados, trechos: JSON.stringify(ts.map((t, i) => ({ ...t, ordem: i + 1 }))) });

/** Trecho que a pessoa nem começou a preencher (não vai pro banco). */
export const trechoEmBranco = (t: TrechoVenda) =>
  !t.origem_codigo && !t.destino_codigo && !t.origem_texto && !t.destino_texto && !t.data && !t.numero && !t.companhia;

/** Trechos limpos, no formato gravado (ordem, tipo, sem texto pendente quando o código existe). */
export function trechosParaBanco(ts: TrechoVenda[]): TrechoVenda[] {
  return ts.filter((t) => !trechoEmBranco(t)).map((t, i) => {
    const o: TrechoVenda = {
      ...t, ordem: i + 1, origem_codigo: t.origem_codigo.toUpperCase(), destino_codigo: t.destino_codigo.toUpperCase(),
      origem: AEROPORTOS[t.origem_codigo]?.cidade || t.origem, destino: AEROPORTOS[t.destino_codigo]?.cidade || t.destino,
    };
    o.tipo = tipoDoTrecho(o, t.tipo === "voo_interno");
    if (o.origem_codigo) delete o.origem_texto;
    if (o.destino_codigo) delete o.destino_texto;
    return o;
  });
}

const BR = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
/** Linha de texto do trecho ("GRU → LIS 12/03/2027 22:10 TP 82") — o `voos` antigo. */
export const linhaDoTrecho = (t: TrechoVenda) => [
  `${t.origem_codigo || t.origem_texto || "?"} → ${t.destino_codigo || t.destino_texto || "?"}`,
  BR(t.data), t.hora_saida, [t.companhia, t.numero].filter(Boolean).join(" "), t.tipo === "voo_interno" ? "(voo interno)" : "",
].filter(Boolean).join(" ");

/** Item com aéreo? Aéreo sempre; pacote/outro quando marcado "Inclui aéreo". */
export function precisaDeTrechos(i: { tipo: string; dados?: Record<string, unknown> | null }): boolean {
  if (i.tipo === "aereo") return true;
  if (i.tipo !== "pacote" && i.tipo !== "outro") return false;
  const v = i.dados?.aereo_incluso;
  return v === true || v === "sim" || v === "true";
}

/** `dados` da tela → `dados` do banco: trechos viram ARRAY no formato acima e `voos` vira o texto deles. Vazio sai. */
export function dadosParaBanco(dados: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(dados).filter(([, v]) => String(v ?? "").trim() !== ""));
  if ("trechos" in out) {
    const ts = trechosParaBanco(lerTrechos({ trechos: out.trechos }));
    if (ts.length) { out.trechos = ts; out.voos = ts.map(linhaDoTrecho).join("\n"); }
    else delete out.trechos;
  }
  return out;
}

// ── Problemas (bloqueiam o Consolidar) e avisos (só conferir) ───────────────
/** O que falta no aéreo pra consolidar. Vazio = ok. `rotulo` = "Aéreo", "Aéreo 2", "Pacote — aéreo"… */
export function problemasDoAereo(ts: TrechoVenda[], rotulo = "Aéreo"): string[] {
  const validos = ts.filter((t) => !trechoEmBranco(t));
  if (!validos.length) return [`${rotulo}: coloque os trechos do voo (origem e destino com o código IATA do aeroporto).`];
  const f: string[] = [];
  validos.forEach((t, i) => {
    const n = i + 1;
    const o = t.origem_codigo ? lerIata(t.origem_codigo) : null;
    const d = t.destino_codigo ? lerIata(t.destino_codigo) : null;
    const semO = !o || o.status === "invalido" || o.status === "vazio";
    const semD = !d || d.status === "invalido" || d.status === "vazio";
    const escrito = [semO && t.origem_texto ? `"${t.origem_texto}"` : "", semD && t.destino_texto ? `"${t.destino_texto}"` : ""].filter(Boolean).join(" / ");
    if (semO || semD) {
      const lado = semO && semD ? "origem e destino" : semO ? "origem" : "destino";
      f.push(`${rotulo}: trecho ${n} sem código IATA de ${lado}${escrito ? ` (está escrito ${escrito})` : ""}.`);
    } else if (t.origem_codigo === t.destino_codigo) f.push(`${rotulo}: trecho ${n} com origem e destino iguais (${t.origem_codigo}).`);
  });
  return f;
}

/** Avisos que NÃO bloqueiam: código fora da lista. */
export function avisosDoAereo(ts: TrechoVenda[], rotulo = "Aéreo"): string[] {
  const a: string[] = [];
  ts.filter((t) => !trechoEmBranco(t)).forEach((t, i) => {
    for (const c of [t.origem_codigo, t.destino_codigo]) {
      if (c && lerIata(c).status === "fora_lista") a.push(`${rotulo}: trecho ${i + 1} — ${c} não está na lista de aeroportos, confira.`);
    }
  });
  return a;
}
