/**
 * Venda consolidada → trechos da viagem do Rel (0361).
 *
 * Espelho em TS da função SQL `rel_venda_trechos_desejados`: quem cria os
 * trechos é o banco (gatilho ao consolidar). Este arquivo existe pra regra ter
 * teste e pra tela poder explicar "o que a venda vai virar" — mude os dois juntos.
 *
 * Regras:
 *   - aéreo (ou pacote/outro com aéreo incluso — `precisaDeTrechos`): cada
 *     trecho de `dados.trechos` vira um voo; PENDENTE (sem IATA de 3 letras na
 *     origem ou no destino) ou sem data NÃO vira trecho;
 *   - hotel, passeio, transfer, trem, seguro, carro e cruzeiro viram 1 trecho
 *     (carro/cruzeiro como "outro"); expedição, visto e concierge não;
 *   - item cancelado não vira nada;
 *   - hora = a do bilhete/voucher, gravada como se fosse de Brasília; sem hora =
 *     00:00 ("sem horário"); chegada antes da partida → sem chegada.
 */
import { precisaDeTrechos } from "../../venda/iata.ts";
import type { TipoTrecho } from "./viagens.ts";

export interface ItemDaVenda {
  id: string;
  tipo: string;
  nome?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  dados?: Record<string, unknown> | null;
  fornecedor?: string | null;
  status?: string | null;
}

export interface TrechoDaVenda {
  ref_externa: string;
  venda_item_id: string;
  tipo: TipoTrecho;
  descricao: string;
  origem: string | null;
  destino: string | null;
  origem_codigo: string | null;
  destino_codigo: string | null;
  partida_em: string;
  chegada_em: string | null;
  companhia: string | null;
  numero: string | null;
  localizador: string | null;
  classe: string | null;
  bagagem: string | null;
  assento: string | null;
  endereco: string | null;
  ponto_encontro: string | null;
  observacoes: string | null;
}

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/** data (AAAA-MM-DD…) + hora (HH:MM…) em Brasília → ISO; data inválida = null. */
export function instanteDaVenda(data: unknown, hora?: unknown): string | null {
  const d = typeof data === "string" ? data : data == null ? "" : String(data);
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const h = (typeof hora === "string" ? hora : "").match(/^(\d{1,2}):(\d{2})/);
  const hm = h ? `${h[1].padStart(2, "0")}:${h[2]}` : "00:00";
  const t = new Date(`${d.slice(0, 10)}T${hm}:00-03:00`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

const IATA = /^[A-Za-z]{3}$/;
const SENTIDO: Record<string, string> = { ida: "Ida", volta: "Volta", interno: "Voo interno" };
const NOME_PADRAO: Record<string, string> = {
  carro: "Carro", cruzeiro: "Cruzeiro", seguro: "Seguro viagem", hospedagem: "Hospedagem", passeio: "Passeio", transfer: "Transfer", trem: "Trem",
};
const TIPO_DO_SERVICO: Record<string, TipoTrecho> = {
  hospedagem: "hospedagem", passeio: "passeio", transfer: "transfer", trem: "trem", seguro: "seguro", carro: "outro", cruzeiro: "outro",
};

const depois = (a: string | null, b: string) => (a && new Date(a).getTime() >= new Date(b).getTime() ? a : null);

function voosDoItem(i: ItemDaVenda): TrechoDaVenda[] {
  if (!precisaDeTrechos({ tipo: i.tipo, dados: i.dados ?? null })) return [];
  const lista = Array.isArray(i.dados?.trechos) ? (i.dados!.trechos as Record<string, unknown>[]) : [];
  const out: TrechoDaVenda[] = [];
  lista.forEach((t, n) => {
    const oc = txt(t.origem_codigo), dc = txt(t.destino_codigo);
    if (!oc || !dc || !IATA.test(oc) || !IATA.test(dc)) return;   // pendente: não vira trecho
    const partida = instanteDaVenda(t.data, t.hora_saida);
    if (!partida) return;
    const horaChegada = txt(t.hora_chegada);
    const chegada0 = horaChegada ? instanteDaVenda(txt(t.chegada_data) ?? t.data, horaChegada) : null;
    out.push({
      ref_externa: `venda:${i.id}:voo:${txt(t.ordem) ?? String(n + 1)}`,
      venda_item_id: i.id,
      tipo: t.tipo === "voo_interno" ? "voo_interno" : "voo_internacional",
      descricao: [SENTIDO[String(t.sentido)] ?? "", t.conexao === true || t.conexao === "true" ? "conexão" : "", "da venda"].filter(Boolean).join(" — "),
      origem: txt(t.origem), destino: txt(t.destino),
      origem_codigo: oc.toUpperCase(), destino_codigo: dc.toUpperCase(),
      partida_em: partida, chegada_em: depois(chegada0, partida),
      companhia: txt(t.companhia), numero: txt(t.numero), localizador: txt(t.localizador),
      classe: txt(t.classe), bagagem: txt(t.bagagem),
      assento: null, endereco: null, ponto_encontro: null, observacoes: null,
    });
  });
  return out;
}

function servicoDoItem(i: ItemDaVenda): TrechoDaVenda | null {
  const tipo = TIPO_DO_SERVICO[i.tipo];
  if (!tipo) return null;
  const d = i.dados ?? {};
  const horaIni = i.tipo === "hospedagem" ? d.checkin_hora : i.tipo === "passeio" || i.tipo === "transfer" ? d.hora : i.tipo === "trem" ? d.saida : i.tipo === "carro" ? d.retirada_hora : null;
  const partida = instanteDaVenda(i.data_inicio, horaIni);
  if (!partida) return null;
  let chegada0: string | null = null;
  if (["hospedagem", "seguro", "carro", "cruzeiro"].includes(i.tipo) && i.data_fim)
    chegada0 = instanteDaVenda(i.data_fim, i.tipo === "hospedagem" ? d.checkout_hora : i.tipo === "carro" ? d.devolucao_hora : null);
  else if (i.tipo === "trem" && txt(d.chegada)) chegada0 = instanteDaVenda(i.data_fim || i.data_inicio, d.chegada);
  else if (i.tipo === "passeio" && i.data_fim && i.data_inicio && i.data_fim > i.data_inicio) chegada0 = instanteDaVenda(i.data_fim, null);
  const origem = txt(i.tipo === "transfer" || i.tipo === "trem" ? d.de : i.tipo === "carro" ? d.retirada_local : i.tipo === "cruzeiro" ? d.porto_embarque : i.tipo === "hospedagem" ? d.cidade : i.tipo === "passeio" ? d.local : null);
  const destino = txt(i.tipo === "transfer" || i.tipo === "trem" ? d.para : i.tipo === "carro" ? d.devolucao_local : i.tipo === "cruzeiro" ? d.porto_desembarque : i.tipo === "hospedagem" ? d.cidade : i.tipo === "passeio" ? d.local : null);
  const extra = txt(i.tipo === "hospedagem" ? d.regime : i.tipo === "seguro" ? d.plano : i.tipo === "passeio" ? d.duracao : i.tipo === "cruzeiro" ? d.navio : null);
  return {
    ref_externa: `venda:${i.id}:${i.tipo}`,
    venda_item_id: i.id,
    tipo,
    descricao: txt(i.nome) ?? NOME_PADRAO[i.tipo],
    origem, destino, origem_codigo: null, destino_codigo: null,
    partida_em: partida, chegada_em: depois(chegada0, partida),
    companhia: txt(i.tipo === "trem" ? d.operadora : i.tipo === "seguro" ? d.seguradora : i.tipo === "carro" ? d.locadora : i.tipo === "cruzeiro" ? d.companhia : null),
    numero: txt(i.tipo === "trem" ? d.numero : i.tipo === "seguro" ? d.apolice : null),
    localizador: txt(d.localizador),
    classe: txt(i.tipo === "trem" ? d.classe : i.tipo === "carro" ? d.categoria : i.tipo === "cruzeiro" ? d.cabine : i.tipo === "hospedagem" ? d.quarto : null),
    bagagem: null,
    assento: txt(i.tipo === "trem" ? d.assento : null),
    endereco: txt(i.tipo === "hospedagem" ? d.endereco : null),
    ponto_encontro: txt(i.tipo === "passeio" ? d.local : null),
    observacoes: [extra, txt(i.fornecedor)].filter(Boolean).join(" · ") || null,
  };
}

/** Os trechos que a venda consolidada põe na viagem (mesma regra da SQL). */
export function trechosDaVenda(itens: ItemDaVenda[]): TrechoDaVenda[] {
  const out: TrechoDaVenda[] = [];
  for (const i of itens) {
    if (i.status === "cancelado") continue;
    out.push(...voosDoItem(i));
    const s = servicoDoItem(i);
    if (s) out.push(s);
  }
  return out;
}

/** Trechos de voo que NÃO entram (pendentes de IATA ou sem data) — pra avisar na tela. */
export function voosQueNaoEntram(itens: ItemDaVenda[]): number {
  let n = 0;
  for (const i of itens) {
    if (i.status === "cancelado" || !precisaDeTrechos({ tipo: i.tipo, dados: i.dados ?? null })) continue;
    const lista = Array.isArray(i.dados?.trechos) ? (i.dados!.trechos as unknown[]).length : 0;
    n += lista - voosDoItem(i).length;
  }
  return n;
}
