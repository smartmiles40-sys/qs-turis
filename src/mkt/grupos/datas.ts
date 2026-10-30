// src/mkt/grupos/datas.ts
// -----------------------------------------------------------------------------
// Regras PURAS das telas de Grupos (sem React, sem Supabase) — testadas em
// tests/mkt-grupos/datas.test.ts. Datas e horas sempre em Brasília (UTC-3 fixo
// desde 2019, igual ao servidor em api/_mktGruposRegras.js).
// -----------------------------------------------------------------------------

export const SP_MS = 3 * 3600_000;
const p2 = (n: number) => String(n).padStart(2, "0");

// ── Brasília ────────────────────────────────────────────────────────────────
/** "2026-11-02" + "19:30" (Brasília) → ISO em UTC. Nulo se algum dos dois for inválido. */
export function isoDeSP(ymd: string, hm: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  const h = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm || ""));
  if (!d || !h) return null;
  const t = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2])) + SP_MS;
  return new Date(t).toISOString();
}

/** ISO → data (YYYY-MM-DD), hora (HH:MM) e dia da semana (0 = domingo) em Brasília. */
export function partesSP(iso: string | number | Date): { data: string; hora: string; dow: number } {
  const x = new Date(new Date(iso).getTime() - SP_MS);
  return {
    data: `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`,
    hora: `${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`,
    dow: x.getUTCDay(),
  };
}

export const hojeSP = (agora: number | Date = Date.now()) => partesSP(agora).data;

/** Soma dias a uma data YYYY-MM-DD (sem fuso no meio). */
export function somarDiasYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`;
}

/** Empurra uma data/hora em N dias mantendo o MESMO horário de Brasília. */
export function somarDias(iso: string, n: number): string {
  const { data, hora } = partesSP(iso);
  return isoDeSP(somarDiasYmd(data, n), hora) as string;
}

export const DIAS_LONGOS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "hoje · quinta-feira, 30 de outubro" — o cabeçalho de dia da linha do tempo. */
export function diaPorExtenso(iso: string, agora: number = Date.now()): string {
  const { data, dow } = partesSP(iso);
  const [y, m, d] = data.split("-").map(Number);
  const hoje = hojeSP(agora);
  const prefixo = data === hoje ? "hoje · " : data === somarDiasYmd(hoje, 1) ? "amanhã · " : data === somarDiasYmd(hoje, -1) ? "ontem · " : "";
  const ano = y !== Number(hoje.slice(0, 4)) ? ` de ${y}` : "";
  return `${prefixo}${DIAS_LONGOS[dow]}, ${d} de ${MESES[m - 1]}${ano}`;
}

/** "em 3h", "em 2 dias", "há 5 min" — o quanto falta, que é o que a equipe quer saber. */
export function relativo(iso: string, agora: number = Date.now()): string {
  const diff = new Date(iso).getTime() - agora;
  const min = Math.round(Math.abs(diff) / 60_000);
  if (min < 1) return "agora";
  const txt = min < 60 ? `${min} min` : min < 60 * 36 ? `${Math.round(min / 60)}h` : `${Math.round(min / 1440)} dias`;
  return diff >= 0 ? `em ${txt}` : `há ${txt}`;
}

/** "30/10 às 19:30" (Brasília). */
export function quandoSP(iso: string | null): string {
  if (!iso) return "—";
  const { data, hora } = partesSP(iso);
  return `${data.slice(8, 10)}/${data.slice(5, 7)} às ${hora}`;
}

/**
 * Data sugerida pra uma mensagem nova da cadência, encaixada entre a anterior e a
 * próxima (ou no fim): um dia depois da anterior, no mesmo horário; se não couber,
 * no meio das duas (arredondado em 15 min). Nunca no passado (no mínimo +10 min).
 */
export function sugerirData(anterior: string | null, proxima: string | null, agora: number = Date.now()): string {
  const base = agora + 60 * 60_000;
  if (!anterior) {
    const t = proxima ? Math.min(base, new Date(proxima).getTime() - 60 * 60_000) : base;
    return new Date(Math.max(t, agora + 10 * 60_000)).toISOString();
  }
  const umDiaDepois = somarDias(anterior, 1);
  if (!proxima || new Date(umDiaDepois) < new Date(proxima)) {
    return new Date(Math.max(new Date(umDiaDepois).getTime(), base)).toISOString();
  }
  const meio = (new Date(anterior).getTime() + new Date(proxima).getTime()) / 2;
  return new Date(Math.max(Math.round(meio / 900_000) * 900_000, agora + 10 * 60_000)).toISOString();
}

// ── Feriados nacionais (atalho do calendário de várias datas) ───────────────
function pascoa(ano: number): { m: number; d: number } {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return { m: Math.floor((h + l - 7 * m + 114) / 31), d: ((h + l - 7 * m + 114) % 31) + 1 };
}

export interface Feriado { data: string; nome: string }

export function feriadosBR(ano: number): Feriado[] {
  const iso = (m: number, d: number) => `${ano}-${p2(m)}-${p2(d)}`;
  const pa = pascoa(ano);
  const pascoaYmd = iso(pa.m, pa.d);
  return [
    { data: iso(1, 1), nome: "Confraternização Universal" },
    { data: somarDiasYmd(pascoaYmd, -47), nome: "Carnaval" },
    { data: somarDiasYmd(pascoaYmd, -2), nome: "Sexta-feira Santa" },
    { data: iso(4, 21), nome: "Tiradentes" },
    { data: iso(5, 1), nome: "Dia do Trabalho" },
    { data: somarDiasYmd(pascoaYmd, 60), nome: "Corpus Christi" },
    { data: iso(9, 7), nome: "Independência" },
    { data: iso(10, 12), nome: "Nossa Senhora Aparecida" },
    { data: iso(11, 2), nome: "Finados" },
    { data: iso(11, 15), nome: "Proclamação da República" },
    { data: iso(11, 20), nome: "Consciência Negra" },
    { data: iso(12, 25), nome: "Natal" },
  ].sort((x, y) => x.data.localeCompare(y.data));
}

/** Feriados de hoje em diante (este ano e o próximo). */
export function proximosFeriados(agora: number = Date.now()): Feriado[] {
  const hoje = hojeSP(agora);
  const ano = Number(hoje.slice(0, 4));
  return [...feriadosBR(ano), ...feriadosBR(ano + 1)].filter((f) => f.data >= hoje);
}

// ── Calendário de várias datas ("Vários dias") ──────────────────────────────
export type TipoMsgDatas = "texto" | "imagem" | "video" | "documento" | "audio" | "enquete";
export const TIPOS_COM_MIDIA: TipoMsgDatas[] = ["imagem", "video", "documento", "audio"];
export const temMidia = (t: string) => (TIPOS_COM_MIDIA as string[]).includes(t);

export interface EntradaData {
  /** YYYY-MM-DD (Brasília). */
  data: string;
  /** HH:MM (Brasília). */
  hora: string;
  /** Mensagem só desta data; vazio = herda a da base. */
  texto?: string;
  /** Tipo só desta data; sem = herda tipo + mídia da base. */
  tipo?: TipoMsgDatas;
  midia_url?: string | null;
  midia_nome?: string | null;
}

/** Uma entrada por data, em ordem. */
export function normalizarDatas(entradas: EntradaData[]): EntradaData[] {
  const vistas = new Map<string, EntradaData>();
  for (const e of entradas) if (!vistas.has(e.data)) vistas.set(e.data, e);
  return [...vistas.values()].sort((a, b) => a.data.localeCompare(b.data));
}

export interface BaseConteudo { tipo: TipoMsgDatas; texto: string; midia_url: string | null; midia_nome: string | null }

/**
 * Uma campanha por data: data com tipo próprio troca a mídia inteira; texto
 * próprio vence o da base. Devolve em ordem de envio.
 */
export function campanhasDasDatas(base: BaseConteudo, entradas: EntradaData[]): (BaseConteudo & { enviar_em: string; data: string })[] {
  return normalizarDatas(entradas)
    .map((e) => {
      const tipo = e.tipo ?? base.tipo;
      const propria = e.tipo !== undefined;
      return {
        data: e.data,
        enviar_em: isoDeSP(e.data, e.hora) as string,
        tipo,
        texto: e.texto?.trim() ? e.texto : base.texto,
        midia_url: temMidia(tipo) ? (propria ? e.midia_url ?? null : base.midia_url) : null,
        midia_nome: temMidia(tipo) ? (propria ? e.midia_nome ?? null : base.midia_nome) : null,
      };
    })
    .filter((c) => c.enviar_em)
    .sort((a, b) => a.enviar_em.localeCompare(b.enviar_em));
}

/** Problemas das datas antes de agendar (vazio = pode). */
export function problemasDasDatas(base: BaseConteudo, entradas: EntradaData[], agora: number = Date.now()): string[] {
  const erros: string[] = [];
  const lista = campanhasDasDatas(base, entradas);
  if (!lista.length) return ["Escolha pelo menos uma data."];
  if (lista.length !== normalizarDatas(entradas).length) erros.push("Tem data com hora inválida.");
  if (lista.some((c) => new Date(c.enviar_em).getTime() <= agora)) erros.push("Todas as datas precisam estar no futuro. Ajuste os horários.");
  const sem = lista.find((c) => temMidia(c.tipo) && !c.midia_url);
  if (sem) erros.push(`${sem.data.split("-").reverse().join("/")}: envie a mídia dessa data (ou troque para Herdar/Texto).`);
  return erros;
}

// ── Tempo do envio (intervalo entre grupos) ─────────────────────────────────
export function estimarDuracao(grupos: number, minSeg: number, maxSeg: number): { minSeg: number; maxSeg: number } {
  const n = Math.max(0, grupos - 1);
  return { minSeg: n * minSeg, maxSeg: n * Math.max(minSeg, maxSeg) };
}
export function formatarDuracao(seg: number): string {
  if (seg < 60) return "menos de 1 min";
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h}h ${r}min` : `${h}h`;
}

// ── Recorrências ────────────────────────────────────────────────────────────
/** "Toda segunda e quarta às 19:00" / "Todo dia às 09:00". */
export function descreverRecorrencia(dias: number[], hora: string): string {
  const ds = [...new Set(dias)].filter((d) => d >= 0 && d <= 6).sort();
  if (!ds.length) return "Nenhum dia escolhido";
  if (ds.length === 7) return `Todo dia às ${hora}`;
  const nomes = ds.map((d) => DIAS_LONGOS[d].replace("-feira", ""));
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  // "Todo domingo/sábado", "Toda segunda…": concorda com o primeiro dia da lista
  const todo = ds[0] === 0 || ds[0] === 6 ? "Todo" : "Toda";
  return `${todo} ${lista} às ${hora}`;
}

/** As próximas N vezes que a recorrência sai (Brasília), respeitando início/fim. */
export function proximasOcorrencias(
  rec: { dias_semana: number[]; hora: string; inicio: string | null; fim: string | null; ativo: boolean },
  agora: number = Date.now(), n = 3,
): string[] {
  if (!rec.ativo) return [];
  const dias = new Set(rec.dias_semana);
  const saida: string[] = [];
  let ymd = hojeSP(agora);
  for (let i = 0; i < 400 && saida.length < n; i++, ymd = somarDiasYmd(ymd, 1)) {
    if (rec.fim && ymd > rec.fim) break;
    if (rec.inicio && ymd < rec.inicio) continue;
    const iso = isoDeSP(ymd, rec.hora);
    if (!iso) return [];
    if (dias.has(partesSP(iso).dow) && new Date(iso).getTime() > agora) saida.push(iso);
  }
  return saida;
}

// ── Campanhas migradas do SendFlow ──────────────────────────────────────────
export const MARCA_SENDFLOW = "Migrada do SendFlow";
export const veioDoSendFlow = (avisos: string[] | null | undefined) => (avisos || []).some((a) => String(a).startsWith(MARCA_SENDFLOW));
/** O aviso "Migrada do SendFlow — pausada de propósito…", se a campanha tiver. */
export function avisoPausadaDeProposito(avisos: string[] | null | undefined): string | null {
  return (avisos || []).find((a) => String(a).startsWith(MARCA_SENDFLOW) && /pausada/i.test(String(a))) ?? null;
}

// ── Lista de campanhas: abas e botões ───────────────────────────────────────
export type StatusCamp = "rascunho" | "agendada" | "enviando" | "pausada" | "concluida" | "cancelada" | "erro";
export type AbaCampanhas = "agendadas" | "pausadas" | "historico" | "rascunhos";
export function abaDoStatus(s: StatusCamp): AbaCampanhas {
  if (s === "agendada" || s === "enviando") return "agendadas";
  if (s === "pausada") return "pausadas";
  if (s === "rascunho") return "rascunhos";
  return "historico";
}

export type AcaoCamp = "editar" | "retomar" | "pausar" | "cancelar" | "excluir" | "duplicar";
/** Os botões de cada linha — o mesmo que o banco aceita (gatilho + RLS da 0243). */
export function acoesDaCampanha(c: { status: StatusCamp; fanout_em: string | null }): AcaoCamp[] {
  const a: AcaoCamp[] = [];
  const semFila = !c.fanout_em;
  if (semFila && ["rascunho", "agendada", "pausada", "erro"].includes(c.status)) a.push("editar");
  if (c.status === "pausada") a.push("retomar");
  if (c.status === "agendada" || c.status === "enviando") a.push("pausar");
  if (["agendada", "enviando", "pausada"].includes(c.status)) a.push("cancelar");
  a.push("duplicar");
  if (semFila && ["rascunho", "agendada", "pausada"].includes(c.status)) a.push("excluir");
  return a;
}

/** Passo da cadência que ainda abre no editor (o resto abre o resultado). */
export const passoEditavel = (c: { status: StatusCamp; fanout_em: string | null }) =>
  !c.fanout_em && ["rascunho", "agendada", "pausada", "erro"].includes(c.status);

// ── Conferência antes de agendar (o mesmo que o servidor confere) ───────────
export function problemasDaCampanha(
  c: { nome: string; tipo: string; texto: string; midia_url: string | null; enquete_opcoes: string[] | null; tag_ids: string[]; grupo_jids: string[]; enviar_em: string | null },
  { exigirData = true, agora = Date.now() }: { exigirData?: boolean; agora?: number } = {},
): Record<string, string> {
  const e: Record<string, string> = {};
  const texto = (c.texto || "").trim();
  if (!c.nome.trim()) e.nome = "Dê um nome pra campanha.";
  if (c.tipo === "texto" && !texto) e.texto = "Escreva a mensagem.";
  if (texto.length > 4096) e.texto = "Texto acima de 4096 caracteres.";
  if (temMidia(c.tipo) && !/^https:\/\//.test(c.midia_url || "")) e.midia = "Escolha o arquivo.";
  if (c.tipo === "enquete") {
    const ops = (c.enquete_opcoes || []).map((o) => o.trim()).filter(Boolean);
    if (!texto) e.texto = "Escreva a pergunta da enquete.";
    if (ops.length < 2 || ops.length > 12) e.enquete = "A enquete precisa de 2 a 12 opções.";
    else if (new Set(ops.map((o) => o.toLowerCase())).size !== ops.length) e.enquete = "Opções repetidas na enquete.";
  }
  if (!c.tag_ids.length && !c.grupo_jids.length) e.publico = "Escolha os grupos (por tag ou um a um). Destino vazio NÃO quer dizer \"todos\".";
  if (exigirData) {
    const t = Date.parse(c.enviar_em || "");
    if (Number.isNaN(t)) e.enviar_em = "Diga o dia e a hora do envio.";
    else if (t < agora - 5 * 60_000) e.enviar_em = "A data do envio já passou.";
  }
  return e;
}
