// src/venda/vendaRegras.ts
// -----------------------------------------------------------------------------
// Regras PURAS do "Subir venda" (sem banco, sem React) — testadas em
// tests/venda/vendaRegras.test.ts. Bruno 09/11/2026: "tudo digitado UMA vez só
// no QS e reaproveitado". Aqui mora:
//   • reabrir a venda sem perder nada: pagamento/condição/observações gravados
//     (qs_vendas) e os detalhes de cada viajante (valor, aéreo, quarto, divide
//     com, CPF, nascimento, e-mail, vínculo) — de `passageiros` (linhas do Ops,
//     o mais completo) e/ou do json do item (qs_venda_itens.passageiros);
//   • quem comprou: completar o que veio do lead com a ficha única (rel_clientes);
//   • preço de tabela do Operacional: com aéreo (preco_venda_brl) × só terrestre
//     (preco_sem_aereo_brl, 0220) e "o closer ajustou?".
// Nada aqui importa o supabase (os testes rodam no node puro).
// -----------------------------------------------------------------------------

/** Vínculo de quem viaja junto com o comprador (mesmos códigos de cad_acompanhantes, 0213). */
export type VinculoViajante = "" | "conjuge" | "filho" | "pai_mae" | "irmao" | "amigo" | "outro";
export const VINCULOS_VIAJANTE: Record<Exclude<VinculoViajante, "">, string> = {
  conjuge: "Cônjuge", filho: "Filho(a)", pai_mae: "Pai / Mãe", irmao: "Irmão(ã)", amigo: "Amigo(a)", outro: "Outro",
};
const VINCULOS_OK = new Set(Object.keys(VINCULOS_VIAJANTE));

/** Quem viaja numa expedição (o comprador e quem vai junto). */
export interface Viajante {
  chave: string;
  comprador: boolean;
  nome: string;
  telefone: string;
  cpf: string;
  email: string;
  nascimento: string;
  /** Vínculo com o comprador (prepara o contrato por pessoa: menor assina pelo pai/mãe). */
  vinculo: VinculoViajante;
  valor_contratado: string;
  valor_pago: string;
  aereo_incluso: boolean;
  quarto_desejado: string;
  /** "" = não divide · "v:<chave>" = outro viajante desta venda · "p:<id>" = quem já comprou · "t" = só o nome */
  divide: string;
  divide_nome: string;
  /** Ficha (rel_clientes) e linha de `passageiros`, quando já gravado. */
  cliente_id?: string | null;
  passageiro_id?: string | null;
}

let seq = 0;
export const chaveViajante = () => `v${Date.now().toString(36)}${(seq++).toString(36)}`;

export const viajanteVazio = (comprador = false, nome = "", chave = chaveViajante()): Viajante => ({
  chave, comprador, nome, telefone: "", cpf: "", email: "", nascimento: "", vinculo: "",
  valor_contratado: "", valor_pago: "", aereo_incluso: true, quarto_desejado: "", divide: "", divide_nome: "",
});

// ── Valores ────────────────────────────────────────────────────────────────
/** "1.234,56" / "1234.56" / "1234" → número (ou null se vazio/inválido). */
export function lerValor(t: string | number | null | undefined): number | null {
  const s = String(t ?? "").trim().replace(/^R\$\s*/, "");
  if (!s) return null;
  const n = /^\d+\.\d{1,2}$/.test(s) ? Number(s) : Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export const mostrarValor = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const txt = (v: unknown): string => (v == null ? "" : String(v));

// ── Preço do Operacional (0220) ────────────────────────────────────────────
export interface PrecosExpedicao { preco_venda_brl: number | null; preco_sem_aereo_brl?: number | null }

/** Preço de tabela por pessoa: com aéreo = preco_venda_brl; só terrestre = preco_sem_aereo_brl (null se o Ops não cadastrou). */
export function precoTabela(exp: PrecosExpedicao | null | undefined, aereo: boolean): number | null {
  if (!exp) return null;
  const v = aereo ? exp.preco_venda_brl : exp.preco_sem_aereo_brl;
  return v == null || !(Number(v) > 0) ? null : Number(v);
}

/** O closer mudou o valor da tabela? (null = não dá pra comparar: sem tabela ou sem valor). */
export function valorAjustado(v: Pick<Viajante, "valor_contratado" | "aereo_incluso">, exp: PrecosExpedicao | null | undefined): boolean | null {
  const tab = precoTabela(exp, v.aereo_incluso);
  const val = lerValor(v.valor_contratado);
  if (tab == null || val == null) return null;
  return Math.abs(tab - val) > 0.009;
}

/** Valor sugerido pra quem ainda não tem valor (ou está no preço da tabela antiga). */
export function sugerirValor(v: Viajante, exp: PrecosExpedicao | null | undefined, aereoAntes = v.aereo_incluso): string {
  const novo = precoTabela(exp, v.aereo_incluso);
  const atual = lerValor(v.valor_contratado);
  const antigo = precoTabela(exp, aereoAntes);
  // Só troca o que é "da tabela": vazio, ou igual à tabela de antes. Valor ajustado pelo closer fica.
  // Se a tabela nova não existe (ex.: Ops sem preço sem aéreo), o valor da tabela antiga sai — enganaria.
  const daTabela = atual == null || (antigo != null && Math.abs(atual - antigo) < 0.01);
  if (!daTabela) return v.valor_contratado;
  return novo != null ? mostrarValor(novo) : "";
}

/** Marca/desmarca "aéreo incluso" e acompanha o preço da tabela (se o valor não foi ajustado à mão). */
export function trocarAereo(v: Viajante, aereo: boolean, exp: PrecosExpedicao | null | undefined): Viajante {
  if (v.aereo_incluso === aereo) return v;
  const novo = { ...v, aereo_incluso: aereo };
  return { ...novo, valor_contratado: sugerirValor(novo, exp, v.aereo_incluso) };
}

// ── Pagamento gravado (qs_vendas.pagamento) → tela ─────────────────────────
export interface PagamentoVenda {
  forma: string;
  condicao: "avista" | "parcelado" | "entrada";
  entrada: string;
  entrada_data: string;
  parcelas: string;
  primeira_parcela: string;
  obs: string;
}
export const pagamentoVendaVazio = (): PagamentoVenda =>
  ({ forma: "", condicao: "avista", entrada: "", entrada_data: "", parcelas: "", primeira_parcela: "", obs: "" });

export function pagamentoDaVenda(j: unknown): PagamentoVenda {
  const p = pagamentoVendaVazio();
  if (!j || typeof j !== "object" || Array.isArray(j)) return p;
  const o = j as Record<string, unknown>;
  const cond = txt(o.condicao);
  return {
    forma: txt(o.forma),
    condicao: cond === "parcelado" || cond === "entrada" ? cond : "avista",
    entrada: mostrarValor(num(o.entrada)),
    entrada_data: txt(o.entrada_data).slice(0, 10),
    parcelas: cond === "avista" || num(o.parcelas) == null ? "" : String(num(o.parcelas)),
    primeira_parcela: txt(o.primeira_parcela).slice(0, 10),
    obs: txt(o.obs),
  };
}

// ── Quem comprou: completar com a ficha única ──────────────────────────────
export interface PessoaVenda {
  id?: string | null;
  nome: string;
  telefone: string;
  email: string;
  cpf: string;
  nascimento: string;
  passaporte: string;
}
export const pessoaVazia = (): PessoaVenda => ({ id: null, nome: "", telefone: "", email: "", cpf: "", nascimento: "", passaporte: "" });

/** Preenche SÓ o que está vazio (o que já veio do lead/cliente fica). Nunca apaga. */
export function completarPessoa(base: PessoaVenda, ficha: Partial<Record<keyof PessoaVenda, string | null | undefined>> | null | undefined): PessoaVenda {
  if (!ficha) return base;
  const r = { ...base };
  for (const k of ["nome", "telefone", "email", "cpf", "nascimento", "passaporte"] as const) {
    const v = txt(ficha[k]).trim();
    if (!String(r[k] ?? "").trim() && v) r[k] = k === "nascimento" ? v.slice(0, 10) : v;
  }
  return r;
}

// ── Viajantes: tela ↔ json do item ─────────────────────────────────────────
/** Linha do json qs_venda_itens.passageiros (a venda_subir hoje só devolve nome/cliente_id/passageiro_id). */
export interface PaxJson {
  nome: string;
  cliente_id?: string | null;
  passageiro_id?: string | null;
  chave?: string;
  comprador?: boolean;
  telefone?: string | null;
  cpf?: string | null;
  email?: string | null;
  nascimento?: string | null;
  vinculo?: string | null;
  valor_contratado?: number | null;
  valor_pago?: number | null;
  aereo_incluso?: boolean | null;
  quarto_desejado?: string | null;
  divide?: string | null;
  divide_nome?: string | null;
  /** Mesmo uuid = mesmo quarto (passageiros.quarto_par_id) — vem quando a venda_subir passar a gravar o json completo. */
  quarto_par_id?: string | null;
}

/** Viajantes da tela → json do item (guarda tudo: reabrir o rascunho não perde nada). */
export function viajantesParaJson(vs: Viajante[], nomeComprador: string): PaxJson[] {
  const vazio = (s: string) => (s.trim() ? s.trim() : null);
  return vs.map((v) => ({
    nome: (v.comprador ? nomeComprador : v.nome).trim(),
    cliente_id: v.cliente_id ?? null, passageiro_id: v.passageiro_id ?? null,
    chave: v.chave, comprador: v.comprador,
    telefone: vazio(v.telefone), cpf: vazio(v.cpf), email: vazio(v.email), nascimento: vazio(v.nascimento),
    vinculo: v.comprador ? null : v.vinculo || null,
    valor_contratado: lerValor(v.valor_contratado), valor_pago: lerValor(v.valor_pago),
    aereo_incluso: v.aereo_incluso, quarto_desejado: vazio(v.quarto_desejado),
    divide: v.divide || null, divide_nome: v.divide === "t" ? vazio(v.divide_nome) : null,
  }));
}

/** Linha de `passageiros` (Ops/Expedições) ligada ao item da venda (venda_item_id). */
export interface PaxLinha {
  id: string;
  cliente_id: string | null;
  nome_completo: string | null;
  telefone?: string | null;
  email?: string | null;
  cpf?: string | null;
  data_nascimento?: string | null;
  valor_contratado_brl?: number | string | null;
  valor_pago_brl?: number | string | null;
  aereo_incluso?: boolean | null;
  quarto_desejado?: string | null;
  quarto_par_id?: string | null;
  acompanhante_dividir_com?: string | null;
  status_reserva?: string | null;
}

/** Acompanhante da ficha do comprador (cad_ler_pessoa): o vínculo e os documentos. */
export interface AcompFicha {
  id: string; nome: string; vinculo?: string | null;
  cpf?: string | null; nascimento?: string | null; email?: string | null; telefone?: string | null;
}

export const normNome = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export interface Restauro { viajantes: Viajante[]; /** Os valores por pessoa não estavam gravados: dividiu o total igual (conferir). */ dividiuIgual: boolean }

/**
 * Item de expedição já salvo → viajantes da tela, SEM perder detalhe.
 * Fontes, da mais completa pra menos: linhas de `passageiros` (quem tem acesso às
 * Expedições), o json do item (rascunho guarda tudo) e a ficha do comprador
 * (acompanhantes: CPF, nascimento, e-mail, vínculo). O comprador é quem tem a
 * marca no json, a ficha do comprador, ou o mesmo nome — só cai no "1º da lista"
 * se nada disso existir (venda antiga).
 */
export function restaurarViajantes(p: {
  item: { valor: number | null; passageiros: PaxJson[] | { nome: string }[]; dados?: Record<string, string> };
  linhas?: PaxLinha[];
  compradorClienteId?: string | null;
  nomeComprador?: string;
  acompanhantes?: AcompFicha[];
}): Restauro {
  const json = (p.item.passageiros ?? []) as PaxJson[];
  const linhas = (p.linhas ?? []).filter((l) => l.status_reserva !== "Cancelado");
  const acomps = p.acompanhantes ?? [];
  const usados = new Set<number>();
  const doJson = (pid?: string | null, cid?: string | null, nome?: string | null): PaxJson | undefined => {
    const n = normNome(nome);
    let i = json.findIndex((j, k) => !usados.has(k) && !!pid && j.passageiro_id === pid);
    if (i < 0) i = json.findIndex((j, k) => !usados.has(k) && !!cid && j.cliente_id === cid);
    if (i < 0) i = json.findIndex((j, k) => !usados.has(k) && !!n && normNome(j.nome) === n);
    if (i < 0) return undefined;
    usados.add(i);
    return json[i];
  };
  const daFicha = (cid?: string | null, nome?: string | null) =>
    acomps.find((a) => !!cid && a.id === cid) ?? acomps.find((a) => !!nome && normNome(a.nome) === normNome(nome));

  type Bruto = { j?: PaxJson; l?: PaxLinha };
  const brutos: Bruto[] = linhas.length
    ? [...linhas.map((l) => ({ l, j: doJson(l.id, l.cliente_id, l.nome_completo) })),
       // json com gente que não está nas linhas (rascunho novo ao lado de linha antiga) — não some ninguém
       ...json.filter((_, k) => !usados.has(k)).filter((j) => !j.passageiro_id).map((j) => ({ j }))]
    : json.filter((j) => (j?.nome ?? "").trim() || j?.comprador).map((j) => ({ j }));

  const vs: Viajante[] = brutos.map(({ j, l }) => {
    const nome = (l?.nome_completo ?? j?.nome ?? "").trim();
    const cid = l?.cliente_id ?? j?.cliente_id ?? null;
    const f = daFicha(cid, nome);
    const vin = txt(j?.vinculo ?? f?.vinculo);
    const valor = num(l?.valor_contratado_brl) ?? num(j?.valor_contratado);
    const pago = num(l?.valor_pago_brl) ?? num(j?.valor_pago);
    return {
      ...viajanteVazio(false, nome, j?.chave || chaveViajante()),
      telefone: txt(l?.telefone ?? j?.telefone ?? f?.telefone),
      cpf: txt(l?.cpf ?? j?.cpf ?? f?.cpf),
      email: txt(l?.email ?? j?.email ?? f?.email),
      nascimento: txt(l?.data_nascimento ?? j?.nascimento ?? f?.nascimento).slice(0, 10),
      vinculo: (VINCULOS_OK.has(vin) ? vin : "") as VinculoViajante,
      valor_contratado: mostrarValor(valor),
      valor_pago: pago ? mostrarValor(pago) : "",
      aereo_incluso: (l?.aereo_incluso ?? j?.aereo_incluso) ?? true,
      quarto_desejado: txt(l?.quarto_desejado ?? j?.quarto_desejado),
      divide: txt(j?.divide), divide_nome: txt(j?.divide_nome),
      cliente_id: cid, passageiro_id: l?.id ?? j?.passageiro_id ?? null,
      // marca do comprador vinda do json (as outras regras logo abaixo)
      comprador: j?.comprador === true,
    };
  });

  // ── Quem é o comprador ──
  if (!vs.some((v) => v.comprador)) {
    let i = p.compradorClienteId ? vs.findIndex((v) => v.cliente_id === p.compradorClienteId) : -1;
    if (i < 0 && p.nomeComprador) i = vs.findIndex((v) => normNome(v.nome) === normNome(p.nomeComprador));
    if (i < 0 && vs.length) i = 0; // venda antiga, sem marca nenhuma
    if (i >= 0) vs[i] = { ...vs[i], comprador: true };
  }
  if (!vs.length) vs.push(viajanteVazio(true));
  for (const v of vs) if (v.comprador) { v.nome = ""; v.vinculo = ""; }
  vs.sort((a, b) => Number(b.comprador) - Number(a.comprador));
  const comp = vs.find((v) => v.comprador)!;
  if (!comp.quarto_desejado && p.item.dados?.quarto) comp.quarto_desejado = p.item.dados.quarto;

  // ── Quarto: quem divide com quem (linhas do Ops mandam; sem elas, o json gravado pela venda_subir) ──
  const quartos: PaxLinha[] = linhas.length ? linhas : json.filter((j) => j.passageiro_id && !j.divide).map((j) => ({
    id: j.passageiro_id!, cliente_id: j.cliente_id ?? null, nome_completo: j.nome,
    quarto_par_id: j.quarto_par_id ?? null, acompanhante_dividir_com: j.divide_nome ?? null,
  }));
  if (quartos.length) {
    const linhas = quartos;
    const porPax = new Map(vs.filter((v) => v.passageiro_id).map((v) => [v.passageiro_id!, v]));
    for (const l of linhas) {
      const v = porPax.get(l.id);
      if (!v || (v.divide && v.divide !== "t")) continue;
      const par = l.quarto_par_id ? linhas.find((o) => o.id !== l.id && o.quarto_par_id === l.quarto_par_id) : undefined;
      const outro = par ? porPax.get(par.id) : undefined;
      if (outro) { v.divide = `v:${outro.chave}`; v.divide_nome = ""; }
      else if (l.acompanhante_dividir_com?.trim()) {
        const mesmo = vs.find((o) => o !== v && normNome(o.comprador ? p.nomeComprador : o.nome) === normNome(l.acompanhante_dividir_com));
        if (mesmo) { v.divide = `v:${mesmo.chave}`; v.divide_nome = ""; }
        else { v.divide = "t"; v.divide_nome = l.acompanhante_dividir_com.trim(); }
      }
    }
  }
  // "v:<chave>" que aponta pra ninguém (chave perdida) vira "não divide".
  const chaves = new Set(vs.map((v) => v.chave));
  for (const v of vs) if (v.divide.startsWith("v:") && !chaves.has(v.divide.slice(2))) v.divide = "";

  // ── Valor por pessoa: só divide igual se NINGUÉM tem valor gravado ──
  let dividiuIgual = false;
  if (p.item.valor && vs.every((v) => !v.valor_contratado)) {
    const cada = Math.round((p.item.valor / vs.length) * 100) / 100;
    for (const v of vs) v.valor_contratado = mostrarValor(cada);
    dividiuIgual = vs.length > 1;
  }
  return { viajantes: vs, dividiuIgual };
}

/** Menor de idade na data de referência (embarque; sem data, hoje)? null = sem nascimento válido. */
export function menorDeIdade(nascimento: string, referencia?: string | null): boolean | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento ?? "");
  if (!m) return null;
  const ref = /^\d{4}-\d{2}-\d{2}/.test(referencia ?? "") ? referencia!.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const [ra, rm, rd] = ref.split("-").map(Number);
  let idade = ra - Number(m[1]);
  if (rm < Number(m[2]) || (rm === Number(m[2]) && rd < Number(m[3]))) idade--;
  return idade < 18;
}
