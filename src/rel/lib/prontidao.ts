// src/rel/lib/prontidao.ts
// -----------------------------------------------------------------------------
// PRONTIDÃO DA VIAGEM (03/11/2026, desenho "Viagem" do Bruno no Claude Design).
// Oito quadrinhos — Aéreo ida, Aéreo volta, Voos internos, Hospedagem, Passeios,
// Documentos, Entrada (Sherpa), Seguro viagem — cada um ok / atenção / falta,
// e um quarto estado "neutro" para o que não se aplica ou não tem dado (não
// conta na barra: "Não vendido", "Não ligado"). Nada aqui inventa dado.
//
// Função PURA (testada em tests/viagens/prontidao.test.ts): a página entrega o
// que já calcula — os papéis dos voos (statusViagem.resumirVoos), as noites sem
// hotel (problemas.mapaDasNoites), os itens da venda (componentes) e os
// documentos — e recebe os quadrinhos prontos. Sem import de runtime de
// propósito (o teste roda no Node sem o resolvedor do Vite).
// -----------------------------------------------------------------------------

export type EstadoPront = "ok" | "atencao" | "falta" | "neutro";

export interface Quadro {
  chave: "ida" | "volta" | "internos" | "hospedagem" | "passeios" | "documentos" | "entrada" | "seguro";
  rotulo: string;
  estado: EstadoPront;
  valor: string;
  detalhe: string;
}

export type PapelPront = "ida" | "volta" | "interno" | "nacional_ida" | "nacional_volta" | null;

export interface VooPront {
  id: string;
  papel: PapelPront;
  /** false = fora das datas, genérico do Bitrix, repetido (resumirVoos). */
  valido: boolean;
  cancelado?: boolean;
  /** só o DIA (Pós-Venda do Bitrix), a hora é de mentira */
  semHora?: boolean;
  localizador?: string | null;
  partida_em: string;
  partida_fuso?: string | null;
  origem?: string | null;
  destino?: string | null;
}

export interface EntradaProntidao {
  servico: string | null;
  acompanhamento: string | null;
  voos: VooPront[];
  hoteis: { nome: string; noites: number | null }[];
  noitesSemHotel: number;
  passeios: { nome: string; comVoucher: boolean }[];
  /** itens da venda (qs_venda_itens): tipo + situação (vendido/emitido/cancelado) */
  itens: { tipo: string; status: string | null; nome?: string }[];
  docs: { tipo: string; status: string }[];
  passageiros: { nome: string; passaporte: string | null; passaporte_validade: string | null }[];
  qtdVendida: number | null;
  /** volta (ou ida) da venda — régua dos 6 meses do passaporte */
  dataReferencia: string | null;
  /** requisitos de entrada (Sherpa) — null enquanto a API não estiver ligada */
  sherpa: { exigencias: { texto: string; ok: boolean }[]; pais?: string | null } | null;
}

export interface Prontidao { quadros: Quadro[]; prontos: number; aplicaveis: number; pct: number }

// ── helpers puros ───────────────────────────────────────────────────────────

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const primeiro = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

/** "15/11 23:45" na hora do lugar quando o fuso (±HH:MM) é conhecido; sem fuso, Brasília. */
export function diaHoraCurta(iso: string | null | undefined, fuso?: string | null, soDia = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(fuso || "-03:00")) ?? ["", "-", "03", "00"];
  const min = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const x = new Date(d.getTime() + min * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const dia = `${p(x.getUTCDate())}/${p(x.getUTCMonth() + 1)}`;
  return soDia ? dia : `${dia} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

/** Duração do trecho: "7h10", "45min"; vazio sem chegada ou se não fizer sentido. */
export function duracao(partida: string | null | undefined, chegada: string | null | undefined): string {
  if (!partida || !chegada) return "";
  const min = Math.round((new Date(chegada).getTime() - new Date(partida).getTime()) / 60_000);
  if (!Number.isFinite(min) || min <= 0 || min > 48 * 60) return "";
  const h = Math.floor(min / 60), r = min % 60;
  return h ? `${h}h${r ? String(r).padStart(2, "0") : ""}` : `${r}min`;
}

/** AAAA-MM-DD + n meses (sem estourar o fim do mês). */
function somaMeses(d: string, n: number): string {
  const [a, m, dia] = d.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ult));
  return alvo.toISOString().slice(0, 10);
}

/** Estado de um documento enviado (rel_documentos.status). */
export function estadoDocumento(status: string): { estado: EstadoPront; rotulo: string } {
  if (status === "aprovado") return { estado: "ok", rotulo: "Aprovado" };
  if (status === "recusado") return { estado: "falta", rotulo: "Recusado" };
  if (status === "recebido") return { estado: "atencao", rotulo: "A conferir" };
  return { estado: "neutro", rotulo: status || "—" };
}

/** O passaporte da pessoa contra a régua dos 6 meses depois da volta. */
export function estadoPassaporte(p: { passaporte: string | null; passaporte_validade: string | null }, dataReferencia: string | null, hoje: string):
  { estado: EstadoPront; texto: string } {
  if (!p.passaporte && !p.passaporte_validade) return { estado: "falta", texto: "Sem passaporte na ficha" };
  if (!p.passaporte_validade) return { estado: "atencao", texto: "Sem validade anotada" };
  const br = `${p.passaporte_validade.slice(8, 10)}/${p.passaporte_validade.slice(5, 7)}/${p.passaporte_validade.slice(0, 4)}`;
  if (p.passaporte_validade < hoje) return { estado: "falta", texto: `Vencido em ${br}` };
  if (dataReferencia && p.passaporte_validade < somaMeses(dataReferencia, 6)) return { estado: "falta", texto: `Vence ${br} — menos de 6 meses da volta` };
  return { estado: "ok", texto: `Válido até ${br}` };
}

const VIVO = (s: string | null) => s !== "cancelado";

// ── os quadrinhos ───────────────────────────────────────────────────────────

function quadroDoAereo(chave: "ida" | "volta", e: EntradaProntidao, aereoVendido: boolean, itemAereoAEmitir: boolean): Quadro {
  const rotulo = chave === "ida" ? "Aéreo ida" : "Aéreo volta";
  const papeis = chave === "ida" ? ["ida", "nacional_ida"] : ["volta", "nacional_volta"];
  const segs = e.voos.filter((v) => v.valido && !v.cancelado && papeis.includes(v.papel ?? ""))
    .sort((a, b) => a.partida_em.localeCompare(b.partida_em));
  if (segs.length) {
    const quando = diaHoraCurta(segs[0].partida_em, segs[0].partida_fuso, !!segs[0].semHora);
    if (segs.every((s) => s.semHora)) return { chave, rotulo, estado: "atencao", valor: "Só a data do Bitrix", detalhe: `${quando} · sem horário nem nº do voo` };
    const semLoc = segs.filter((s) => !s.localizador).length;
    if (semLoc) return { chave, rotulo, estado: "atencao", valor: "Sem localizador", detalhe: `${semLoc} de ${plural(segs.length, "trecho", "trechos")} sem LOC · ${quando}` };
    const locs = [...new Set(segs.map((s) => s.localizador!))].join(", ");
    return { chave, rotulo, estado: "ok", valor: "Emitido", detalhe: `LOC ${locs} · ${quando}` };
  }
  if (itemAereoAEmitir) return { chave, rotulo, estado: "atencao", valor: "A emitir", detalhe: "Vendido, sem voo no roteiro ainda" };
  if (aereoVendido) return { chave, rotulo, estado: "falta", valor: "Não cadastrado", detalhe: "Anexe o bilhete ou cadastre à mão" };
  return { chave, rotulo, estado: "neutro", valor: "Não vendido", detalhe: "A venda não tem aéreo" };
}

export function prontidaoDaViagem(e: EntradaProntidao, hoje: string): Prontidao {
  const itens = e.itens.filter((i) => VIVO(i.status));
  const temItem = (t: string) => itens.some((i) => i.tipo === t);
  const aEmitir = (t: string) => itens.some((i) => i.tipo === t && i.status === "vendido");
  const opera = e.acompanhamento === "completo" || e.acompanhamento === "leve" || e.acompanhamento === "expedicao";
  const aereoVendido = e.servico === "pacote" || e.servico === "aereo" || temItem("aereo");
  const q: Quadro[] = [];

  q.push(quadroDoAereo("ida", e, aereoVendido, aEmitir("aereo")));
  q.push(quadroDoAereo("volta", e, aereoVendido, aEmitir("aereo")));

  // voos internos — o sistema não sabe se o roteiro PRECISA de um; sem nenhum, fica neutro
  {
    const segs = e.voos.filter((v) => v.valido && !v.cancelado && v.papel === "interno");
    const rotulo = "Voos internos";
    if (segs.length) {
      const semLoc = segs.filter((s) => !s.localizador && !s.semHora).length;
      const rotas = segs.slice(0, 2).map((s) => [s.origem, s.destino].filter(Boolean).join(" → ")).filter(Boolean).join(" · ");
      q.push(semLoc
        ? { chave: "internos", rotulo, estado: "atencao", valor: `${semLoc} sem localizador`, detalhe: rotas || plural(segs.length, "trecho", "trechos") }
        : { chave: "internos", rotulo, estado: "ok", valor: plural(segs.length, "trecho", "trechos"), detalhe: rotas || "cadastrados" });
    } else {
      const algumVoo = e.voos.some((v) => v.valido && !v.cancelado);
      q.push({ chave: "internos", rotulo, estado: "neutro", valor: algumVoo ? "Nenhum" : "Sem voos", detalhe: algumVoo ? "Só ida e volta cadastradas" : "Nenhum voo no roteiro" });
    }
  }

  // hospedagem
  {
    const rotulo = "Hospedagem";
    const vendida = e.servico === "pacote" || e.servico === "hospedagem" || temItem("hospedagem");
    if (e.hoteis.length) {
      const det = e.hoteis.slice(0, 2).map((h) => (h.noites ? `${h.nome} ${plural(h.noites, "noite", "noites")}` : h.nome)).join(" · ");
      q.push(e.noitesSemHotel > 0
        ? { chave: "hospedagem", rotulo, estado: "atencao", valor: `${plural(e.noitesSemHotel, "noite", "noites")} sem hotel`, detalhe: det }
        : { chave: "hospedagem", rotulo, estado: "ok", valor: plural(e.hoteis.length, "hotel", "hotéis"), detalhe: det });
    } else if (aEmitir("hospedagem")) q.push({ chave: "hospedagem", rotulo, estado: "atencao", valor: "A emitir", detalhe: "Vendida, sem voucher no roteiro" });
    else if (vendida) q.push({ chave: "hospedagem", rotulo, estado: "falta", valor: "Não cadastrada", detalhe: "Anexe o voucher do hotel" });
    else q.push({ chave: "hospedagem", rotulo, estado: "neutro", valor: "Não vendida", detalhe: "A venda não tem hotel" });
  }

  // passeios — voucher = trecho com o arquivo de onde a IA tirou (documento_id)
  {
    const rotulo = "Passeios";
    const n = e.passeios.length;
    if (n) {
      const com = e.passeios.filter((p) => p.comVoucher).length;
      const sem = e.passeios.filter((p) => !p.comVoucher).map((p) => p.nome).slice(0, 2).join(", ");
      const estado: EstadoPront = com === n ? "ok" : com === 0 ? "falta" : "atencao";
      q.push({ chave: "passeios", rotulo, estado, valor: `${com} de ${n} com voucher`, detalhe: com === n ? "Todos com o arquivo anexado" : `Sem voucher: ${sem}` });
    } else if (temItem("passeio")) q.push({ chave: "passeios", rotulo, estado: "atencao", valor: "Vendido, não cadastrado", detalhe: "Anexe o voucher do passeio" });
    else q.push({ chave: "passeios", rotulo, estado: "neutro", valor: "Nenhum", detalhe: "Nenhum passeio na venda" });
  }

  // documentos — os enviados + o passaporte de cada um
  {
    const rotulo = "Documentos";
    const recusados = e.docs.filter((d) => d.status === "recusado").length;
    const conferir = e.docs.filter((d) => d.status === "recebido").length;
    const aprovados = e.docs.filter((d) => d.status === "aprovado").length;
    const pp = e.passageiros.map((p) => ({ p, s: estadoPassaporte(p, e.dataReferencia, hoje) }));
    const ppRuim = pp.filter((x) => x.s.estado === "falta");
    const ppMeio = pp.filter((x) => x.s.estado === "atencao");
    const semFicha = e.qtdVendida && e.passageiros.length < e.qtdVendida ? e.qtdVendida - e.passageiros.length : 0;
    if (recusados || ppRuim.length) {
      const partes = [recusados ? plural(recusados, "recusado", "recusados") : "", ...ppRuim.slice(0, 2).map((x) => `${primeiro(x.p.nome)}: ${x.s.texto.toLowerCase()}`)].filter(Boolean);
      q.push({ chave: "documentos", rotulo, estado: "falta", valor: recusados ? plural(recusados, "recusado", "recusados") : "Passaporte com problema", detalhe: partes.join(" · ") });
    } else if (conferir || ppMeio.length || semFicha) {
      const partes = [semFicha ? `${plural(semFicha, "passageiro", "passageiros")} sem ficha` : "", ...ppMeio.slice(0, 2).map((x) => `${primeiro(x.p.nome)}: ${x.s.texto.toLowerCase()}`)].filter(Boolean);
      q.push({ chave: "documentos", rotulo, estado: "atencao", valor: conferir ? `${conferir} a conferir` : semFicha ? "Falta passageiro" : "Passaporte incompleto", detalhe: partes.join(" · ") || "Enviados pelo cliente, falta aprovar" });
    } else if (!e.docs.length) {
      q.push({ chave: "documentos", rotulo, estado: "atencao", valor: "Nenhum enviado", detalhe: e.passageiros.length ? "Passaporte ok na ficha; nenhum arquivo na viagem" : "Sem passageiro com ficha" });
    } else {
      q.push({ chave: "documentos", rotulo, estado: "ok", valor: plural(aprovados, "aprovado", "aprovados"), detalhe: "Passaportes dentro da régua dos 6 meses" });
    }
  }

  // entrada (Sherpa)
  if (!e.sherpa) q.push({ chave: "entrada", rotulo: "Entrada (Sherpa)", estado: "neutro", valor: "Não ligado", detalhe: "Falta a chave da API do Sherpa" });
  else {
    const abertas = e.sherpa.exigencias.filter((x) => !x.ok);
    q.push(abertas.length
      ? { chave: "entrada", rotulo: "Entrada (Sherpa)", estado: "atencao", valor: plural(abertas.length, "exigência aberta", "exigências abertas"), detalhe: abertas[0].texto }
      : { chave: "entrada", rotulo: "Entrada (Sherpa)", estado: "ok", valor: "Tudo em dia", detalhe: e.sherpa.pais ? `Exigências de ${e.sherpa.pais}` : "Exigências cumpridas" });
  }

  // seguro viagem — item da venda ou apólice anexada
  {
    const rotulo = "Seguro viagem";
    const item = itens.filter((i) => i.tipo === "seguro");
    const docs = e.docs.filter((d) => d.tipo === "seguro");
    if (item.some((i) => i.status === "emitido") || docs.some((d) => d.status === "aprovado"))
      q.push({ chave: "seguro", rotulo, estado: "ok", valor: item.some((i) => i.status === "emitido") ? "Emitido" : "Apólice aprovada", detalhe: docs.length ? "Apólice anexada" : "Item da venda emitido" });
    else if (docs.some((d) => d.status === "recebido")) q.push({ chave: "seguro", rotulo, estado: "atencao", valor: "Apólice a conferir", detalhe: "Anexada, falta aprovar" });
    else if (item.length) q.push({ chave: "seguro", rotulo, estado: "atencao", valor: "A emitir", detalhe: "Vendido, sem apólice anexada" });
    else if (docs.some((d) => d.status === "recusado")) q.push({ chave: "seguro", rotulo, estado: "falta", valor: "Apólice recusada", detalhe: "Peça a apólice certa" });
    else if (opera) q.push({ chave: "seguro", rotulo, estado: "falta", valor: "Não registrado", detalhe: "Nem vendido nem anexado" });
    else q.push({ chave: "seguro", rotulo, estado: "neutro", valor: "Não registrado", detalhe: "Venda sem acompanhamento" });
  }

  const aplicaveis = q.filter((x) => x.estado !== "neutro").length;
  const prontos = q.filter((x) => x.estado === "ok").length;
  return { quadros: q, prontos, aplicaveis, pct: aplicaveis ? Math.round((prontos / aplicaveis) * 100) : 0 };
}

/** O selo do topo: "Embarca em 12 dias" / "Viajando" / "Voltou". */
export function seloEmbarque(fase: string, dias: number | null, status: string): { texto: string; tom: "info" | "ok" | "neutro" | "falta" } {
  if (status === "cancelada" || fase === "cancelada") return { texto: "Cancelada", tom: "falta" };
  if (status === "arquivada") return { texto: "Arquivada", tom: "neutro" };
  if (fase === "em_viagem") return { texto: "Viajando", tom: "ok" };
  if (fase === "concluida") return { texto: "Voltou", tom: "neutro" };
  if (dias == null) return { texto: "Sem data de embarque", tom: "neutro" };
  if (dias < 0) return { texto: "Viajando", tom: "ok" };
  if (dias === 0) return { texto: "Embarca hoje", tom: "info" };
  if (dias === 1) return { texto: "Embarca amanhã", tom: "info" };
  return { texto: `Embarca em ${dias} dias`, tom: "info" };
}

/** Noites entre a ida e a volta da venda. */
export function noitesEntre(ida: string | null, volta: string | null): number | null {
  if (!ida || !volta) return null;
  const n = Math.round((Date.parse(`${volta}T12:00:00Z`) - Date.parse(`${ida}T12:00:00Z`)) / 86_400_000);
  return n >= 0 ? n : null;
}
