// src/propostas/iaMescla.ts
// -----------------------------------------------------------------------------
// "MONTAR COM IA" — a parte pura (sem rede, sem React): o que a IA leu
// (api/proposta-ia.js → validarExtracao) vira o RASCUNHO da proposta.
//
// Regra da mescla (Bruno 03/11: "dá pra rodar de novo depois de subir mais um
// print"): cada valor que a IA preenche fica anotado em conteudo._ia.valores.
// Na rodada seguinte um campo só é trocado se ainda está VAZIO, igual ao
// padrão do modelo ou igual ao que a própria IA pôs da última vez. Se o closer
// mexeu, fica o dele — e a leitura diferente da IA vira um item de "conferir".
// Listas (hotéis, dias, cartões de preço, serviços, planos) casam por nome/data,
// não por posição; o que a IA criou e o closer TIROU não volta (_ia.criados).
//
// Nada daqui vai pro cliente: api/proposta.js e paraVM tiram o _ia.
// -----------------------------------------------------------------------------
import type { ItemProposta, OpcaoProposta, Pagamento, Proposta, TipoItem } from "./lib.ts";
import {
  SECOES, conteudoInicial, ddmm, ddmmaaaa, diaCurto, diaSemana, diaVazio, hotelVazio, seguradoraVazia,
  type DiaPacote, type HotelPacote, type ModeloProposta, type SeguradoraModelo,
} from "./modelos.ts";

// ── O que a rota devolve (validarExtracao em api/_propostaIa.js) ────────────
export interface VooIa { sentido: "ida" | "volta" | "interno"; cia: string; numero: string; origem: string; origem_cidade: string; destino: string; destino_cidade: string; data: string; saida: string; chegada: string; chegada_data: string; duracao: string; classe: string; bagagem: string }
export interface HotelIa { nome: string; cidade: string; endereco: string; checkin: string; checkout: string; checkin_hora: string; checkout_hora: string; regime: string; quarto: string; comodidades: string[] }
export interface DiaIa { data: string; titulo: string; texto: string }
export interface PrecoIa { rotulo: string; titulo: string; valor_pessoa: number | null; valor_total: number | null; parcelas: number | null; desconto: number | null }
export interface ServicoIa { nome: string; local: string; data: string; descricao: string; valor_pessoa: number | null; incluso: boolean }
export interface SeguroIa { seguradora: string; plano: string; cobertura_medica: string; inicio: string; fim: string; valor_pessoa: number | null; valor_total: number | null; coberturas: { nome: string; valor: string }[] }
export interface ExtracaoIa {
  viagem: { titulo: string; cliente_nome: string; destino: string; data_ida: string; data_volta: string; adultos: number | null; criancas: number | null; bebes: number | null };
  campos: Record<string, string>;
  voos: VooIa[]; hoteis: HotelIa[]; roteiro: DiaIa[]; precos: PrecoIa[]; servicos: ServicoIa[]; seguros: SeguroIa[];
  pagamento: string; validade: string;
}
export interface ItemConferir { campo: string; motivo: string; secao?: SecaoIa }

/** Seções do passo "Revisar" (a marca "IA" e o destaque "conferir" são por seção). */
export type SecaoIa = "viagem" | "voos" | "hoteis" | "dias" | "precos" | "servicos" | "seguros" | "textos";

/** O que fica em conteudo._ia (só do time). */
export interface MarcasIa {
  valores: Record<string, unknown>;
  criados: string[];
  conferir: ItemConferir[];
  secoes: SecaoIa[];
  rodadas: number;
  em: string;
  pedido?: string;
}

export const marcasDe = (p: Pick<Proposta, "conteudo">): MarcasIa | null => {
  const m = (p.conteudo as Record<string, unknown>)?._ia as MarcasIa | undefined;
  return m && typeof m === "object" && m.valores ? m : null;
};

// ── Campos de texto do modelo que a IA preenche (marcados com `ia` em SECOES) ─
export function camposParaIa(modelo: ModeloProposta): { chave: string; rotulo: string; tipo: string }[] {
  return SECOES[modelo].flatMap((s) => s.campos.filter((c) => c.ia).map((c) => ({ chave: c.chave, rotulo: c.ia === true ? c.rotulo : c.ia!, tipo: c.tipo })));
}

// ── Utilidades ──────────────────────────────────────────────────────────────
const vazio = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (typeof v === "number" && v === 0) || (Array.isArray(v) && !v.length);
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let seq = 0;
const chaveNova = () => `ia${Date.now().toString(36)}${(seq++).toString(36)}`;
const paxDe = (p: Proposta) => (p.adultos || 0) + (p.criancas || 0) + (p.bebes || 0);
const curto = (v: unknown) => { const s = typeof v === "number" ? v.toLocaleString("pt-BR") : String(v ?? ""); return s.length > 60 ? `${s.slice(0, 57)}…` : s; };

function itemNovo(tipo: TipoItem, nome: string): ItemProposta {
  return { k: chaveNova(), tipo, nome, descricao: "", data_inicio: "", data_fim: "", quantidade: 1, valor_total: 0, custo: null, lucro: null, fornecedor: "", incluso: false, detalhes: {} };
}
const parcelado = (n: number): Pagamento => ({ forma: "cartao", condicao: "parcelado", parcelas: n, entrada: 0, com_juros: false, obs: "" });
function opcaoNova(modelo: ModeloProposta, grupo = 0): OpcaoProposta {
  const base: OpcaoProposta = { k: chaveNova(), titulo: "", descricao: "", recomendada: false, desconto: 0, pagamentos: [], itens: [] };
  if (modelo === "pacote") return { ...base, extra: { total_rotulo: "Total" }, itens: [itemNovo("pacote", "Pacote")], pagamentos: [parcelado(10)] };
  if (modelo === "seguro") return { ...base, extra: { grupo }, itens: [itemNovo("seguro", "Seguro viagem")], pagamentos: [] };
  return { ...base, titulo: "Serviços" };
}

// ── O motor: um campo de cada vez ───────────────────────────────────────────
class Mescla {
  marcas: MarcasIa;
  conflitos: ItemConferir[] = [];
  secoes = new Set<SecaoIa>();
  mudou = 0;
  constructor(anterior: MarcasIa | null) {
    this.marcas = { valores: { ...(anterior?.valores ?? {}) }, criados: [...(anterior?.criados ?? [])], conferir: [], secoes: [], rodadas: (anterior?.rodadas ?? 0) + 1, em: "" };
  }
  /** Troca se vazio / padrão / ainda é o que a IA pôs; senão registra o conflito. */
  campo(secao: SecaoIa, chave: string, rotulo: string, atual: unknown, novo: unknown, gravar: (v: never) => void, padrao?: unknown) {
    if (vazio(novo)) return;
    const ult = this.marcas.valores[chave];
    const livre = vazio(atual) || (ult !== undefined && igual(atual, ult)) || (padrao !== undefined && igual(atual, padrao));
    if (livre) {
      if (!igual(atual, novo)) { (gravar as (v: unknown) => void)(novo); this.mudou++; }
      this.marcas.valores[chave] = novo;
      this.secoes.add(secao);
    } else if (!igual(atual, novo)) {
      this.conflitos.push({ secao, campo: rotulo, motivo: `ficou o que você pôs ("${curto(atual)}"); a IA leu "${curto(novo)}"` });
    }
  }
  /** A IA já criou esta entrada e o closer tirou? Então não volta. */
  tirado(chave: string, existe: boolean) { return !existe && this.marcas.criados.includes(chave); }
  criado(chave: string) { if (!this.marcas.criados.includes(chave)) this.marcas.criados.push(chave); }
}

// ── Textos gerados a partir das listas ──────────────────────────────────────
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
const cidadeDo = (codigo: string, cidade: string) => cidade || codigo;
function blocosDeVoo(voos: VooIa[]) {
  const grupos: { sentido: VooIa["sentido"]; voos: VooIa[] }[] = [];
  for (const v of voos) {
    const g = grupos[grupos.length - 1];
    if (g && g.sentido === v.sentido) g.voos.push(v); else grupos.push({ sentido: v.sentido, voos: [v] });
  }
  return grupos;
}
/** Tabela "Voos" do pacote (mesmo formato do campo `voos` em SECOES_PACOTE). */
export function tabelaDeVoos(voos: VooIa[]): string {
  const out: string[] = [];
  for (const g of blocosDeVoo(voos)) {
    const d0 = g.voos[0].data;
    const escalas = g.voos.length - 1;
    const nome = g.sentido === "ida" ? "Ida" : g.sentido === "volta" ? "Volta" : "Trecho interno";
    out.push(`# ${[nome, d0 && `${diaSemana(d0)}, ${ddmmaaaa(d0)}`, escalas ? plural(escalas, "escala", "escalas") : g.voos.length ? "voo direto" : ""].filter(Boolean).join(" · ")}`);
    g.voos.forEach((v, n) => {
      const quando = (h: string, d: string) => (h ? `${h}${d && d !== d0 ? ` (${ddmm(d)})` : ""}` : "");
      out.push([`${cidadeDo(v.origem, v.origem_cidade)} → ${cidadeDo(v.destino, v.destino_cidade)}`, [v.numero].filter(Boolean).join(" ") || v.cia, quando(v.saida, v.data), quando(v.chegada, v.chegada_data || v.data), v.duracao].join(" | "));
      const prox = g.voos[n + 1];
      if (prox) out.push(`> Conexão em ${cidadeDo(prox.origem, prox.origem_cidade)}`);
    });
    const bag = [...new Set(g.voos.map((v) => v.bagagem).filter(Boolean))];
    if (bag.length) out.push(`> Bagagem: ${bag.join("; ")}`);
  }
  return out.join("\n");
}
/** Rota da capa do pacote: "FOR | Fortaleza | G3 2055 · 16:50" … "CUN | Cancún". */
export function rotaDaIda(voos: VooIa[]): string {
  const ida = voos.filter((v) => v.sentido === "ida");
  if (!ida.length || ida.some((v) => !v.origem || !v.destino)) return "";
  const l = ida.map((v) => [v.origem, v.origem_cidade, [v.numero, v.saida].filter(Boolean).join(" · ")].join(" | "));
  const ult = ida[ida.length - 1];
  l.push([ult.destino, ult.destino_cidade].join(" | "));
  return l.join("\n");
}
/** Quadros da capa do pacote: Saída / Chegada / Volta / Companhia. */
export function quadrosDaCapa(voos: VooIa[]): string {
  const ida = voos.filter((v) => v.sentido === "ida"), volta = voos.filter((v) => v.sentido === "volta");
  const l: string[] = [];
  const i0 = ida[0], iN = ida[ida.length - 1], vN = volta[volta.length - 1];
  if (i0?.data) l.push(`Saída | ${cidadeDo(i0.origem, i0.origem_cidade)} | ${diaCurto(i0.data)}${i0.saida ? ` às ${i0.saida}` : ""}`);
  if (iN && (iN.chegada_data || iN.data)) l.push(`Chegada em ${cidadeDo(iN.destino, iN.destino_cidade)} | ${diaCurto(iN.chegada_data || iN.data)}${iN.chegada ? ` | às ${iN.chegada}` : ""}`);
  if (vN && (vN.chegada_data || vN.data)) l.push(`Volta a ${cidadeDo(vN.destino, vN.destino_cidade)} | ${diaCurto(vN.chegada_data || vN.data)}${vN.chegada ? ` | às ${vN.chegada}` : ""}`);
  const cias = [...new Set(voos.map((v) => v.cia).filter(Boolean))];
  if (cias.length) l.push(`Companhia | ${cias.join(" e ")}${voos[0]?.classe ? ` | ${voos[0].classe.toLowerCase()}` : ""}`);
  return l.join("\n");
}
/** Faixas IDA/RETORNO do modelo de serviços: "Iberia 150 | Fortaleza 18:25 → Madri 06:10 | Qui 29/10". */
export function faixaDeVoo(voos: VooIa[]): string {
  return voos.map((v) => [
    [v.cia, v.numero].filter(Boolean).join(" ") || "Voo",
    `${cidadeDo(v.origem, v.origem_cidade)}${v.saida ? ` ${v.saida}` : ""} → ${cidadeDo(v.destino, v.destino_cidade)}${v.chegada ? ` ${v.chegada}` : ""}`,
    [v.data && diaCurto(v.data), v.chegada_data && v.chegada_data !== v.data && `chegada ${diaCurto(v.chegada_data).toLowerCase()}`].filter(Boolean).join(" · "),
  ].join(" | ")).join("\n");
}
/** Roteiro do modelo de serviços: "# Cidade | hotel · 30/10 a 04/11" e os dias. */
export function roteiroDeServicos(dias: DiaIa[], hoteis: HotelIa[]): string {
  const out: string[] = [];
  const linhaDia = (d: DiaIa) => [d.data, d.titulo, d.texto].join(" | ");
  const usados = new Set<DiaIa>();
  for (const h of hoteis) {
    const doHotel = dias.filter((d) => d.data && h.checkin && d.data >= h.checkin && (!h.checkout || d.data < h.checkout) && !usados.has(d));
    out.push(`# ${h.cidade || h.nome} | ${[h.nome, h.checkin && `${ddmm(h.checkin)}${h.checkout ? ` a ${ddmm(h.checkout)}` : ""}`].filter(Boolean).join(" · ")}`);
    for (const d of doHotel) { usados.add(d); out.push(linhaDia(d)); }
  }
  const resto = dias.filter((d) => !usados.has(d));
  if (resto.length && out.length) return [...resto.map(linhaDia), ...out].join("\n");
  return [...out, ...resto.map(linhaDia)].join("\n");
}
/** Comparativo do seguro: "Cobertura | plano 1 | plano 2 …" (Assistência médica primeiro). */
export function comparativoDeSeguros(planos: (SeguroIa | null)[]): string {
  const nomes: string[] = [];
  const valor = new Map<string, Map<number, string>>();
  const por = (nome: string, n: number, v: string) => {
    const k = norm(nome);
    if (!k || !v) return;
    if (!valor.has(k)) { valor.set(k, new Map()); nomes.push(nome); }
    if (!valor.get(k)!.has(n)) valor.get(k)!.set(n, v);
  };
  planos.forEach((s, n) => { if (!s) return; por("Assistência médica", n, s.cobertura_medica); for (const c of s.coberturas) por(c.nome, n, c.valor); });
  return nomes.map((nome) => [nome, ...planos.map((_, n) => valor.get(norm(nome))!.get(n) ?? "—")].join(" | ")).join("\n");
}

// ── A mescla ────────────────────────────────────────────────────────────────
export interface ResultadoMescla { proposta: Proposta; mudou: number; conferir: ItemConferir[]; secoes: SecaoIa[] }

/**
 * Preenche o rascunho com o que a IA leu, sem passar por cima do que o closer
 * editou. `conferirIa` = a lista "conferir" que a rota devolveu.
 */
export function mesclarExtracao(p0: Proposta, ex: ExtracaoIa, conferirIa: ItemConferir[] = [], opts: { hoje?: string; pedido?: string } = {}): ResultadoMescla {
  const modelo = p0.modelo;
  if (!modelo) throw new Error("Escolha o modelo da proposta antes de montar com IA.");
  const p: Proposta = structuredClone(p0);
  p.conteudo = { ...(p.conteudo ?? {}) };
  const padrao = conteudoInicial(modelo, { pax: paxDe(p0), cliente: p0.cliente_nome || p0.titulo, hoje: opts.hoje });
  const m = new Mescla(marcasDe(p0));
  const c = p.conteudo as Record<string, unknown>;
  const V = ex.viagem;

  // ── A viagem ─────────────────────────────────────────────────────────────
  const idas = ex.voos.filter((v) => v.sentido === "ida"), voltas = ex.voos.filter((v) => v.sentido === "volta");
  const seg0 = ex.seguros[0];
  const dataIda = V.data_ida || idas[0]?.data || (modelo === "seguro" ? seg0?.inicio : "") || "";
  const dataVolta = V.data_volta || voltas[voltas.length - 1]?.chegada_data || voltas[voltas.length - 1]?.data || (modelo === "seguro" ? seg0?.fim : "") || "";
  m.campo("viagem", "viagem.titulo", "Título", p.titulo, V.titulo, (v: string) => { p.titulo = v; });
  m.campo("viagem", "viagem.cliente_nome", "Nome do cliente", p.cliente_nome, V.cliente_nome, (v: string) => { p.cliente_nome = v; });
  m.campo("viagem", "viagem.destino", "Destino", p.destino, V.destino, (v: string) => { p.destino = v; });
  m.campo("viagem", "viagem.data_ida", "Data da ida", p.data_ida, dataIda, (v: string) => { p.data_ida = v; });
  if (!dataIda || !dataVolta || dataVolta >= (p.data_ida || dataIda)) m.campo("viagem", "viagem.data_volta", "Data da volta", p.data_volta, dataVolta, (v: string) => { p.data_volta = v; });
  m.campo("viagem", "viagem.adultos", "Adultos", p.adultos, V.adultos, (v: number) => { p.adultos = v; }, 2);
  m.campo("viagem", "viagem.criancas", "Crianças", p.criancas, V.criancas, (v: number) => { p.criancas = v; });
  m.campo("viagem", "viagem.bebes", "Bebês", p.bebes, V.bebes, (v: number) => { p.bebes = v; });

  // ── Textos do modelo que a IA preencheu direto ───────────────────────────
  const permitidos = new Set(camposParaIa(modelo).map((x) => x.chave));
  for (const [k, v] of Object.entries(ex.campos ?? {})) {
    if (!permitidos.has(k)) continue;
    const rot = SECOES[modelo].flatMap((s) => s.campos).find((f) => f.chave === k)?.rotulo ?? k;
    m.campo("textos", `textos.${k}`, rot, c[k], v, (x: string) => { c[k] = x; }, padrao[k]);
  }
  const texto = (secao: SecaoIa, k: string, rot: string, v: string) => m.campo(secao, `textos.${k}`, rot, c[k], v, (x: string) => { c[k] = x; }, padrao[k]);

  if (modelo === "pacote") mesclarPacote(m, p, c, ex, texto);
  if (modelo === "servicos") mesclarServicos(m, p, c, ex, texto);
  if (modelo === "seguro") mesclarSeguro(m, p, c, ex, texto);

  // ── "Conferir": o que a IA pediu + o que a mescla achou ──────────────────
  const conferir = [...conferirIa.map((x) => ({ ...x })), ...m.conflitos];
  if (modelo === "pacote" && ex.pagamento) conferir.push({ secao: "precos", campo: "Forma de pagamento", motivo: `a IA leu "${curto(ex.pagamento)}" — confira as parcelas dos cartões de preço` });
  m.marcas.conferir = conferir;
  m.marcas.secoes = [...m.secoes];
  m.marcas.em = new Date().toISOString();
  if (opts.pedido != null) m.marcas.pedido = opts.pedido;
  c._ia = m.marcas;
  return { proposta: p, mudou: m.mudou, conferir, secoes: m.marcas.secoes };
}

type Texto = (secao: SecaoIa, k: string, rot: string, v: string) => void;

function mesclarHoteis(m: Mescla, c: Record<string, unknown>, hoteis: HotelIa[]) {
  const lista = (Array.isArray(c.hoteis) ? [...(c.hoteis as HotelPacote[])] : []).map((h) => ({ ...h }));
  for (const h of hoteis) {
    const k = `hotel:${norm(h.nome)}`;
    let n = lista.findIndex((x) => norm(x.nome) === norm(h.nome));
    if (m.tirado(k, n >= 0)) continue;
    if (n < 0) n = lista.findIndex((x) => !x.nome.trim() && !x.descricao.trim());
    if (n < 0) { lista.push(hotelVazio()); n = lista.length - 1; }
    m.criado(k);
    const alvo = lista[n];
    const noites = h.checkin && h.checkout ? Math.round((Date.parse(h.checkout) - Date.parse(h.checkin)) / 86400000) : 0;
    const selo = [noites > 0 && plural(noites, "noite", "noites").toUpperCase(), h.regime && h.regime.toUpperCase()].filter(Boolean).join(" · ");
    const desc = [h.endereco, [h.cidade && !h.endereco ? h.cidade : "", h.quarto && `Quarto ${h.quarto}`, h.regime && !selo.includes(h.regime.toUpperCase()) ? h.regime : ""].filter(Boolean).join(". ")].filter(Boolean).join(". ");
    const quando = (d: string, hora: string, prefixo: string) => (d ? `${diaCurto(d)}${hora ? ` ${prefixo} ${hora.replace(":00", "h").replace(":", "h")}` : ""}` : "");
    m.campo("hoteis", `${k}.nome`, `Nome do hotel`, alvo.nome, h.nome, (v: string) => { alvo.nome = v; });
    m.campo("hoteis", `${k}.selo`, `Selo do ${h.nome}`, alvo.selo, selo, (v: string) => { alvo.selo = v; });
    m.campo("hoteis", `${k}.descricao`, `Endereço e quarto do ${h.nome}`, alvo.descricao, desc, (v: string) => { alvo.descricao = v; });
    m.campo("hoteis", `${k}.checkin`, `Check-in do ${h.nome}`, alvo.checkin, quando(h.checkin, h.checkin_hora, "a partir das"), (v: string) => { alvo.checkin = v; });
    m.campo("hoteis", `${k}.checkout`, `Check-out do ${h.nome}`, alvo.checkout, quando(h.checkout, h.checkout_hora, "até"), (v: string) => { alvo.checkout = v; });
    m.campo("hoteis", `${k}.comodidades`, `Comodidades do ${h.nome}`, alvo.comodidades, h.comodidades.join("\n"), (v: string) => { alvo.comodidades = v; });
  }
  c.hoteis = lista;
}

function mesclarPacote(m: Mescla, p: Proposta, c: Record<string, unknown>, ex: ExtracaoIa, texto: Texto) {
  if (ex.voos.length) {
    texto("voos", "voos", "Tabela de voos", tabelaDeVoos(ex.voos));
    texto("voos", "rota", "Rota do voo de ida", rotaDaIda(ex.voos));
    texto("voos", "capa_quadros", "Quadros da capa", quadrosDaCapa(ex.voos));
  }
  mesclarHoteis(m, c, ex.hoteis);

  // dia a dia (casa pela data)
  const dias = (Array.isArray(c.dias) ? [...(c.dias as DiaPacote[])] : []).map((d) => ({ ...d }));
  for (const d of ex.roteiro) {
    const k = `dia:${d.data || norm(d.titulo)}`;
    let n = dias.findIndex((x) => (d.data ? x.data === d.data : norm(x.titulo) === norm(d.titulo)));
    if (m.tirado(k, n >= 0)) continue;
    if (n < 0) { dias.push(diaVazio(d.data)); n = dias.length - 1; }
    m.criado(k);
    const alvo = dias[n];
    const rot = d.data ? `Dia ${ddmm(d.data)}` : d.titulo;
    m.campo("dias", `${k}.titulo`, `${rot}: título`, alvo.titulo, d.titulo, (v: string) => { alvo.titulo = v; });
    m.campo("dias", `${k}.linhas`, `${rot}: programação`, alvo.linhas, d.texto, (v: string) => { alvo.linhas = v; });
  }
  dias.sort((a, b) => (a.data && b.data ? a.data.localeCompare(b.data) : 0));
  c.dias = dias;

  // cartões de preço (casam pelo rótulo/título)
  for (const [i, pr] of ex.precos.entries()) {
    const nome = pr.rotulo || pr.titulo || `Preço ${i + 1}`;
    const k = `preco:${norm(nome)}`;
    let n = p.opcoes.findIndex((o) => [o.extra?.rotulo, o.titulo].some((x) => x && norm(x) === norm(nome)));
    if (m.tirado(k, n >= 0)) continue;
    if (n < 0) n = p.opcoes.findIndex((o) => !o.titulo.trim() && (o.itens[0]?.valor_total || 0) === 0);
    if (n < 0) { p.opcoes.push(opcaoNova("pacote")); n = p.opcoes.length - 1; }
    m.criado(k);
    const o = p.opcoes[n];
    if (!o.itens.length) o.itens.push(itemNovo("pacote", "Pacote"));
    o.extra = { ...(o.extra ?? {}) };
    const porPessoa = pr.valor_pessoa != null;
    m.campo("precos", `${k}.rotulo`, `Rótulo do preço "${nome}"`, o.extra.rotulo, pr.rotulo, (v: string) => { o.extra!.rotulo = v; }, n === 0 ? "Quarto duplo · por pessoa" : undefined);
    m.campo("precos", `${k}.titulo`, `Título do preço "${nome}"`, o.titulo, pr.titulo, (v: string) => { o.titulo = v; });
    m.campo("precos", `${k}.valor`, `Preço "${nome}"`, o.itens[0].valor_total, pr.valor_pessoa ?? pr.valor_total, (v: number) => { o.itens[0].valor_total = v; });
    m.campo("precos", `${k}.total_rotulo`, `Rótulo do total "${nome}"`, o.extra.total_rotulo, porPessoa ? "Total por pessoa" : "Total", (v: string) => { o.extra!.total_rotulo = v; }, "Total");
    if (pr.desconto) m.campo("precos", `${k}.desconto`, `Desconto "${nome}"`, o.desconto, pr.desconto, (v: number) => { o.desconto = v; });
    if (pr.parcelas && pr.parcelas > 1) {
      const pg = o.pagamentos.find((x) => x.condicao === "parcelado");
      m.campo("precos", `${k}.parcelas`, `Parcelas "${nome}"`, pg?.parcelas, pr.parcelas, (v: number) => {
        if (pg) pg.parcelas = v; else o.pagamentos = [parcelado(v), ...o.pagamentos];
      }, 10);
    }
  }
}

function mesclarServicos(m: Mescla, p: Proposta, c: Record<string, unknown>, ex: ExtracaoIa, texto: Texto) {
  const idas = ex.voos.filter((v) => v.sentido !== "volta"), voltas = ex.voos.filter((v) => v.sentido === "volta");
  if (idas.length) texto("voos", "ida", "Faixa IDA", faixaDeVoo(idas));
  if (voltas.length) texto("voos", "retorno", "Faixa RETORNO", faixaDeVoo(voltas));
  if (ex.roteiro.length || ex.hoteis.length) texto("dias", "roteiro", "Roteiro da viagem", roteiroDeServicos(ex.roteiro, ex.hoteis));
  if (ex.pagamento) texto("textos", "pagamento", "Forma de pagamento", ex.pagamento);
  const cidades = [...new Set([...ex.hoteis.map((h) => h.cidade), ...ex.servicos.map((s) => s.local)].filter(Boolean))];
  if (cidades.length > 1 || (cidades.length === 1 && !c.cidades)) texto("textos", "cidades", "Cidades", cidades.slice(0, 5).join(" · "));

  if (!p.opcoes.length) p.opcoes.push(opcaoNova("servicos"));
  const o = p.opcoes[0];
  for (const s of ex.servicos) {
    const k = `serv:${norm(s.nome)}${s.data ? `@${s.data}` : ""}`;
    let n = o.itens.findIndex((i) => norm(i.nome) === norm(s.nome) && (!s.data || !i.data_inicio || i.data_inicio === s.data));
    if (m.tirado(k, n >= 0)) continue;
    if (n < 0) n = o.itens.findIndex((i) => !i.nome.trim() && !i.valor_total);
    if (n < 0) { o.itens.push({ ...itemNovo("passeio", ""), data_inicio: "", data_fim: "" }); n = o.itens.length - 1; }
    m.criado(k);
    const i = o.itens[n];
    i.detalhes = { ...i.detalhes };
    m.campo("servicos", `${k}.nome`, `Serviço "${s.nome}"`, i.nome, s.nome, (v: string) => { i.nome = v; });
    m.campo("servicos", `${k}.data`, `Data de "${s.nome}"`, i.data_inicio, s.data, (v: string) => { i.data_inicio = v; });
    m.campo("servicos", `${k}.local`, `Local de "${s.nome}"`, i.detalhes.local, s.local, (v: string) => { i.detalhes.local = v; });
    m.campo("servicos", `${k}.descricao`, `Descrição de "${s.nome}"`, i.descricao, s.descricao, (v: string) => { i.descricao = v; });
    if (s.incluso) m.campo("servicos", `${k}.incluso`, `"${s.nome}" incluso`, i.incluso, true, (v: boolean) => { i.incluso = v; i.valor_total = 0; }, false);
    else m.campo("servicos", `${k}.valor`, `Valor por pessoa de "${s.nome}"`, i.valor_total, s.valor_pessoa, (v: number) => { i.valor_total = v; });
  }
}

function mesclarSeguro(m: Mescla, p: Proposta, c: Record<string, unknown>, ex: ExtracaoIa, texto: Texto) {
  if (ex.pagamento) texto("textos", "condicoes_pagamento", "Pagamento", ex.pagamento);
  if (ex.validade) texto("textos", "validade", "Validade", ex.validade);
  if (!ex.seguros.length) return;
  const pax = Math.max(1, paxDe(p));
  const segs = (Array.isArray(c.seguradoras) && c.seguradoras.length ? [...(c.seguradoras as SeguradoraModelo[])] : [seguradoraVazia()]).map((s) => ({ ...s }));
  // seguradoras (casam pelo nome)
  const grupoDe = (nome: string) => {
    let g = segs.findIndex((s) => norm(s.nome) === norm(nome));
    if (g < 0) g = segs.findIndex((s) => !s.nome.trim());
    if (g < 0) { segs.push(seguradoraVazia()); g = segs.length - 1; }
    const alvo = segs[g];
    m.campo("seguros", `seguradora:${norm(nome)}.nome`, "Seguradora", alvo.nome, nome, (v: string) => { alvo.nome = v; });
    return g;
  };
  const doGrupo = new Map<number, SeguroIa[]>();
  for (const s of ex.seguros) {
    const plano = s.plano || "Plano";
    const k = `plano:${norm(s.seguradora)}|${norm(plano)}`;
    let n = p.opcoes.findIndex((o) => norm(o.titulo) === norm(plano));
    if (m.tirado(k, n >= 0)) continue;
    const g = s.seguradora ? grupoDe(s.seguradora) : 0;
    doGrupo.set(g, [...(doGrupo.get(g) ?? []), s]);
    if (n < 0) n = p.opcoes.findIndex((o) => !o.titulo.trim() && totalItem(o) === 0);
    if (n < 0) { p.opcoes.push(opcaoNova("seguro", g)); n = p.opcoes.length - 1; }
    m.criado(k);
    const o = p.opcoes[n];
    o.extra = { ...(o.extra ?? {}), grupo: g };
    if (!o.itens.length) o.itens.push(itemNovo("seguro", "Seguro viagem"));
    const i = o.itens[0];
    i.detalhes = { ...i.detalhes, seguradora: s.seguradora || i.detalhes.seguradora, plano };
    if (s.inicio && !i.data_inicio) i.data_inicio = s.inicio;
    if (s.fim && !i.data_fim) i.data_fim = s.fim;
    const total = s.valor_total ?? (s.valor_pessoa != null ? Math.round(s.valor_pessoa * pax * 100) / 100 : null);
    m.campo("seguros", `${k}.titulo`, `Plano "${plano}"`, o.titulo, plano, (v: string) => { o.titulo = v; });
    m.campo("seguros", `${k}.cobertura`, `Assistência médica do ${plano}`, i.detalhes.cobertura, s.cobertura_medica, (v: string) => { i.detalhes.cobertura = v; });
    m.campo("seguros", `${k}.preco_pax`, `Por passageiro do ${plano}`, o.extra.preco_pax, s.valor_pessoa, (v: number) => { o.extra!.preco_pax = v; });
    m.campo("seguros", `${k}.valor`, `Total do ${plano}`, i.valor_total, total, (v: number) => { i.valor_total = v; });
    if (s.valor_total == null && total != null) m.conflitos.push({ secao: "seguros", campo: `Total do ${plano}`, motivo: `calculado: valor por pessoa × ${pax} passageiros (o insumo não trazia o total)` });
  }
  // planos agrupados por seguradora (a ordem das colunas do comparativo segue esta)
  p.opcoes = [...p.opcoes].sort((a, b) => (Number(a.extra?.grupo) || 0) - (Number(b.extra?.grupo) || 0));
  for (const [g, planos] of doGrupo) {
    const alvo = segs[g];
    const tab = comparativoDeSeguros(planos).split("\n").filter((l) => !l.startsWith("Assistência médica")).join("\n");
    if (tab) m.campo("seguros", `seguradora:${norm(alvo.nome)}.coberturas`, `Coberturas da ${alvo.nome || "seguradora"}`, alvo.coberturas, tab, (v: string) => { alvo.coberturas = v; });
  }
  c.seguradoras = segs;
  // comparativo na ordem das colunas (planos ordenados por seguradora)
  const ordem = p.opcoes.map((o) => ex.seguros.find((s) => norm(s.plano || "Plano") === norm(o.titulo)) ?? null);
  if (ordem.some(Boolean)) texto("seguros", "comparativo", "Comparativo das coberturas", comparativoDeSeguros(ordem));
}
const totalItem = (o: OpcaoProposta) => o.itens.reduce((s, i) => s + (Number(i.valor_total) || 0), 0);

// ── O que falta (passo "Revisar") ───────────────────────────────────────────
export interface Pendencia { secao: SecaoIa; texto: string }
/** Campos obrigatórios vazios: sem eles a proposta não faz sentido pro cliente. */
export function pendencias(p: Proposta): Pendencia[] {
  const out: Pendencia[] = [];
  if (!p.destino.trim() && !p.titulo.trim()) out.push({ secao: "viagem", texto: "Destino (ou título)" });
  if (!p.cliente_nome.trim()) out.push({ secao: "viagem", texto: "Nome do cliente" });
  if (!p.data_ida) out.push({ secao: "viagem", texto: "Data da ida" });
  if (p.modelo !== "servicos" && !p.data_volta) out.push({ secao: "viagem", texto: "Data da volta" });
  if ((p.adultos || 0) + (p.criancas || 0) + (p.bebes || 0) === 0) out.push({ secao: "viagem", texto: "Passageiros" });
  const c = p.conteudo ?? {};
  if (p.modelo === "pacote") {
    if (!p.opcoes.some((o) => totalItem(o) > 0)) out.push({ secao: "precos", texto: "Preço do pacote" });
    p.opcoes.forEach((o, n) => { if (p.opcoes.length > 1 && totalItem(o) === 0) out.push({ secao: "precos", texto: `Preço do cartão ${n + 1}` }); });
    if (!((c.hoteis ?? []) as HotelPacote[]).some((h) => h.nome.trim())) out.push({ secao: "hoteis", texto: "Hotel" });
  }
  if (p.modelo === "servicos") {
    const itens = p.opcoes[0]?.itens ?? [];
    if (!itens.length) out.push({ secao: "servicos", texto: "Pelo menos um serviço" });
    itens.forEach((i, n) => {
      if (!i.nome.trim()) out.push({ secao: "servicos", texto: `Nome do serviço ${n + 1}` });
      else if (!i.incluso && !i.valor_total && !String((i.detalhes as Record<string, unknown>).alternativas ?? "").trim()) out.push({ secao: "servicos", texto: `Valor de "${i.nome}"` });
    });
  }
  if (p.modelo === "seguro") {
    if (!((c.seguradoras ?? []) as SeguradoraModelo[]).some((s) => s.nome.trim())) out.push({ secao: "seguros", texto: "Seguradora" });
    p.opcoes.forEach((o, n) => {
      if (!o.titulo.trim()) out.push({ secao: "seguros", texto: `Nome do plano ${n + 1}` });
      if (totalItem(o) === 0) out.push({ secao: "seguros", texto: `Valor do ${o.titulo || `plano ${n + 1}`}` });
    });
  }
  return out;
}

/** Tira um item do "conferir" (o closer conferiu). */
export function marcarConferido(p: Proposta, n: number): Partial<Proposta> {
  const m = marcasDe(p);
  if (!m) return {};
  return { conteudo: { ...p.conteudo, _ia: { ...m, conferir: m.conferir.filter((_, k) => k !== n) } } };
}

/** O valor deste campo ainda é o que a IA pôs? (marca discreta "IA") */
export function veioDaIa(p: Proposta, chave: string, atual: unknown): boolean {
  const m = marcasDe(p);
  return !!m && chave in m.valores && !vazio(atual) && igual(atual, m.valores[chave]);
}
