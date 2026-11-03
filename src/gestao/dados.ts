// src/gestao/dados.ts
// -----------------------------------------------------------------------------
// Os números do PAINEL DE GESTÃO (27/10/2026). Só LEITURA do que já existe no
// banco — nenhuma função nova. Cada bloco carrega sozinho e falha sozinho: um
// setor que quebra (ou que a pessoa não pode ler) não apaga os outros.
//
// Regras da casa respeitadas aqui:
//   • teto de 1000 linhas do PostgREST: contagem com head:true ou fetchAllRows;
//   • datas no fuso de São Paulo (o Brasil não tem horário de verão desde 2019,
//     então "-03:00" é o início do dia certo);
//   • sem dado nenhum ≠ zero: quando a tabela ainda está vazia, o número vira
//     null e a tela escreve "sem dados ainda".
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/qs/queries";
import { fetchFunil, type LinhaFunil } from "@/lib/qs/funil";

export type Periodo = "hoje" | "7d" | "mes";
export const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "7d", rotulo: "7 dias" },
  { id: "mes", rotulo: "Mês" },
];

export type SetorGestao = "sdr" | "closer" | "rel" | "fin" | "ops";
export const NOME_SETOR_GESTAO: Record<SetorGestao, string> = {
  sdr: "Comercial · SDR", closer: "Comercial · Closer", rel: "Relacionamento", fin: "Financeiro", ops: "Operações",
};

// ── Datas (São Paulo) ────────────────────────────────────────────────────────
const TZ = "America/Sao_Paulo";
/** "AAAA-MM-DD" de hoje em São Paulo. */
export const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const inicioDoDia = (ymd: string) => `${ymd}T00:00:00-03:00`;
function somaDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface Intervalo { deData: string; ateData: string; deIso: string; ateIso: string }
export function intervalo(p: Periodo): Intervalo {
  const hoje = hojeSP();
  const deData = p === "hoje" ? hoje : p === "7d" ? somaDias(hoje, -6) : `${hoje.slice(0, 8)}01`;
  return { deData, ateData: hoje, deIso: inicioDoDia(deData), ateIso: new Date().toISOString() };
}

// ── Apoio ────────────────────────────────────────────────────────────────────
type Erro = { message?: string } | null;
function checa(error: Erro) { if (error) throw new Error(error.message || "erro ao ler"); }
async function contar(q: PromiseLike<{ count: number | null; error: Erro }>): Promise<number> {
  const { count, error } = await q;
  checa(error);
  return count ?? 0;
}
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

let nomesCache: Promise<Map<string, { nome: string; ativo: boolean }>> | null = null;
/** Nome de cada pessoa (qs_users). Uma ida por sessão. */
export function nomes(): Promise<Map<string, { nome: string; ativo: boolean }>> {
  if (!nomesCache) {
    nomesCache = Promise.resolve(supabase.from("qs_users").select("id, name, is_active")).then(({ data, error }) => {
      if (error) { nomesCache = null; throw new Error(error.message); }
      return new Map((data ?? []).map((u: { id: string; name: string | null; is_active: boolean | null }) =>
        [u.id, { nome: (u.name ?? "").trim() || "Sem nome", ativo: u.is_active !== false }]));
    });
  }
  return nomesCache;
}
const primeiroNome = (n: string) => n.replace(/\s*\(.*?\)\s*/g, " ").trim().split(/\s+/)[0] || n;

// ═════════════════════════════════════════════════════════════════════════════
// PRECISA DE ATENÇÃO HOJE
// ═════════════════════════════════════════════════════════════════════════════
export interface Alerta {
  id: string;
  setor: SetorGestao;
  titulo: string;
  /** null = não deu pra calcular (ver `semDados`/`erro`). */
  n: number | null;
  detalhe?: string;
  tom: "danger" | "warn";
  /** Endereço da tela onde se resolve (#closer/…, #rel/…). */
  link?: string;
  linkRotulo?: string;
  semDados?: string;
  erro?: string;
}

/** Atividade atrasada a partir de quantas por pessoa vira alerta. */
export const LIMITE_ATRASADAS = 30;
/** Passageiro pendente: Lead ou Pré-reserva, ou inscrição aguardando aprovação.
 *  Escrito como "nem confirmado nem cancelado": o valor com acento ("Pré-reserva")
 *  no filtro faz o gateway do Supabase devolver 500 (testado em 27/10). */
const PAX_PENDENTE = "status_reserva.not.in.(Confirmado,Cancelado),pendente_aprovacao.is.true";
const STATUS_ABERTA = ["agendada", "confirmada"];

async function alertaSemDesfecho(): Promise<Alerta> {
  const base: Alerta = { id: "sem-desfecho", setor: "closer", titulo: "Reuniões que já passaram e estão sem desfecho", n: null, tom: "danger", link: "#closer/agenda/desfechos", linkRotulo: "Abrir meus desfechos" };
  const agora = Date.now();
  const [{ data, error }, mapa] = await Promise.all([
    supabase.from("qs_meetings").select("id, closer_id, scheduled_at, ends_at").in("status", STATUS_ABERTA).lt("scheduled_at", new Date().toISOString()).limit(1000),
    nomes(),
  ]);
  checa(error);
  const passadas = (data ?? []).filter((m: { scheduled_at: string; ends_at: string | null }) => {
    const fim = m.ends_at ? new Date(m.ends_at).getTime() : new Date(m.scheduled_at).getTime() + 3_600_000;
    return fim < agora;
  });
  const porCloser = new Map<string, number>();
  for (const m of passadas as { closer_id: string | null }[]) {
    const p = m.closer_id ? mapa.get(m.closer_id) : null;
    const nome = p ? `${primeiroNome(p.nome)}${p.ativo ? "" : " (inativo)"}` : "sem closer";
    porCloser.set(nome, (porCloser.get(nome) ?? 0) + 1);
  }
  const detalhe = [...porCloser.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return { ...base, n: passadas.length, detalhe: detalhe || undefined };
}

async function alertaSemMeet(): Promise<Alerta> {
  const base: Alerta = { id: "sem-meet", setor: "closer", titulo: "Reuniões futuras sem link do Meet", n: null, tom: "danger", link: "#closer/agenda/dia", linkRotulo: "Abrir a agenda" };
  const { data, error } = await supabase.from("qs_meetings").select("id, meeting_link, calendar_error")
    .in("status", STATUS_ABERTA).gte("scheduled_at", new Date().toISOString()).limit(1000);
  checa(error);
  const lista = (data ?? []) as { meeting_link: string | null; calendar_error: string | null }[];
  const sem = lista.filter((m) => !(m.meeting_link ?? "").trim());
  const comErro = sem.filter((m) => m.calendar_error).length;
  return { ...base, n: sem.length, detalhe: sem.length ? `${comErro} com erro na agenda do Google · ${lista.length} reuniões marcadas daqui pra frente` : undefined };
}

async function alertaReuniaoSemBitrix(): Promise<Alerta> {
  const base: Alerta = { id: "reuniao-bitrix", setor: "closer", titulo: "Reuniões que não chegaram no Bitrix (últimos 30 dias)", n: null, tom: "warn", link: "#closer/agenda/dia", linkRotulo: "Abrir a agenda" };
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const q = () => supabase.from("qs_meetings").select("id", { count: "exact", head: true })
    .not("status", "in", "(cancelada,arquivada)").gte("created_at", desde);
  const [total, comErro] = await Promise.all([
    contar(q().or("bitrix_synced.not.is.true,bitrix_error.not.is.null")),
    contar(q().not("bitrix_error", "is", null)),
  ]);
  return { ...base, n: total, detalhe: total ? `${comErro} com erro registrado · ${total - comErro} ainda não enviadas` : undefined };
}

async function alertaCartaoBitrix(): Promise<Alerta> {
  const base: Alerta = { id: "cartao-bitrix", setor: "closer", titulo: "Cartões do closer com Bitrix pendente há mais de 1 hora ou com erro", n: null, tom: "warn", link: "#closer/pipeline", linkRotulo: "Abrir pipeline" };
  const umaHora = new Date(Date.now() - 3_600_000).toISOString();
  const q = () => supabase.from("qs_closer_negocios").select("id", { count: "exact", head: true }).is("arquivado_em", null);
  const [total, erro] = await Promise.all([
    contar(q().or(`bitrix_status.eq.erro,and(bitrix_status.eq.pendente,atualizado_em.lt.${umaHora})`)),
    contar(q().eq("bitrix_status", "erro")),
  ]);
  return { ...base, n: total, detalhe: total ? `${erro} com erro · ${total - erro} pendentes` : undefined };
}

async function alertaAtrasadas(): Promise<Alerta> {
  const base: Alerta = { id: "atrasadas", setor: "sdr", titulo: `Pessoas com mais de ${LIMITE_ATRASADAS} atividades atrasadas`, n: null, tom: "warn", link: "#comercial/painel", linkRotulo: "Abrir Painel do SDR" };
  const hoje = inicioDoDia(hojeSP());
  const [linhas, mapa] = await Promise.all([
    fetchAllRows<{ owner_id: string | null }>((de, ate) => supabase.from("qs_tasks").select("owner_id")
      .in("status", ["pendente", "atrasada"]).lt("scheduled_at", hoje).order("id").range(de, ate)),
    nomes(),
  ]);
  const por = new Map<string, number>();
  for (const l of linhas) { const k = l.owner_id ?? "-"; por.set(k, (por.get(k) ?? 0) + 1); }
  const acima = [...por.entries()].filter(([, v]) => v > LIMITE_ATRASADAS).sort((a, b) => b[1] - a[1]);
  const detalhe = acima.map(([id, v]) => `${mapa.get(id)?.nome ? primeiroNome(mapa.get(id)!.nome) : "sem dono"}: ${v.toLocaleString("pt-BR")}`).join(" · ");
  return { ...base, n: acima.length, tom: acima.some(([, v]) => v > 100) ? "danger" : "warn",
    detalhe: acima.length ? `${detalhe} (total do time: ${linhas.length.toLocaleString("pt-BR")})` : undefined };
}

async function alertaViagemSemDono(): Promise<Alerta> {
  const base: Alerta = { id: "viagem-sem-dono", setor: "rel", titulo: "Viagens que embarcam nos próximos 7 dias sem dono", n: null, tom: "danger", link: "#rel/esteira", linkRotulo: "Abrir Minhas atividades" };
  const hoje = hojeSP();
  const n = await contar(supabase.from("rel_viagens_v").select("id", { count: "exact", head: true })
    .eq("status", "ativa").in("acompanhamento", ["completo", "leve"]).is("responsavel_id", null)
    .gte("data_embarque", hoje).lte("data_embarque", somaDias(hoje, 7)));
  return { ...base, n };
}

async function alertaConversasSemResposta(): Promise<Alerta> {
  const base: Alerta = { id: "rel-sem-resposta", setor: "rel", titulo: "Conversas do Relacionamento esperando a primeira resposta", n: null, tom: "warn", link: "#rel/atendimento", linkRotulo: "Abrir conversas" };
  const n = await contar(supabase.from("rel_wa_atendimentos").select("id", { count: "exact", head: true })
    .is("concluido_em", null).is("primeira_resposta_em", null));
  return { ...base, n };
}

async function alertaParcelas(): Promise<Alerta> {
  const base: Alerta = { id: "parcelas", setor: "fin", titulo: "Parcelas atrasadas", n: null, tom: "danger", link: "#fin/receber", linkRotulo: "Abrir contas a receber" };
  const [total, { data, error }] = await Promise.all([
    contar(supabase.from("fin_contas_receber_v").select("id", { count: "exact", head: true })),
    supabase.from("fin_contas_receber_v").select("valor").eq("situacao", "atrasado").limit(1000),
  ]);
  checa(error);
  if (total === 0) return { ...base, semDados: "Nenhuma parcela lançada ainda (as parcelas nascem da ficha de fechamento do closer)." };
  const lista = (data ?? []) as { valor: number }[];
  return { ...base, n: lista.length, detalhe: lista.length ? `${brl(lista.reduce((s, p) => s + num(p.valor), 0))} em atraso` : undefined };
}

async function alertaPassageiroPendente(): Promise<Alerta> {
  const base: Alerta = { id: "pax-pendente", setor: "ops", titulo: "Expedições que embarcam em 30 dias com passageiro pendente", n: null, tom: "warn", link: "#ops/expedicoes", linkRotulo: "Abrir expedições" };
  const hoje = hojeSP();
  const { data: exps, error } = await supabase.from("expedicoes").select("id, nome")
    .gte("data_embarque", hoje).lte("data_embarque", somaDias(hoje, 30)).limit(1000);
  checa(error);
  const ids = (exps ?? []).map((e: { id: string }) => e.id);
  if (!ids.length) return { ...base, n: 0 };
  const { data: pax, error: e2 } = await supabase.from("passageiros").select("expedicao_id")
    .in("expedicao_id", ids).or(PAX_PENDENTE).limit(1000);
  checa(e2);
  const por = new Map<string, number>();
  for (const p of (pax ?? []) as { expedicao_id: string }[]) por.set(p.expedicao_id, (por.get(p.expedicao_id) ?? 0) + 1);
  const nome = new Map((exps ?? []).map((e: { id: string; nome: string }) => [e.id, e.nome]));
  const detalhe = [...por.entries()].map(([id, v]) => `${nome.get(id) ?? "?"}: ${v}`).join(" · ");
  return { ...base, n: por.size, detalhe: por.size ? detalhe : undefined };
}

/** Cada alerta por setor (o painel só pede os setores que a pessoa enxerga). */
export const ALERTAS: { setor: SetorGestao; carregar: () => Promise<Alerta> }[] = [
  { setor: "closer", carregar: alertaSemDesfecho },
  { setor: "closer", carregar: alertaSemMeet },
  { setor: "rel", carregar: alertaViagemSemDono },
  { setor: "fin", carregar: alertaParcelas },
  { setor: "sdr", carregar: alertaAtrasadas },
  { setor: "closer", carregar: alertaReuniaoSemBitrix },
  { setor: "closer", carregar: alertaCartaoBitrix },
  { setor: "rel", carregar: alertaConversasSemResposta },
  { setor: "ops", carregar: alertaPassageiroPendente },
];

// ═════════════════════════════════════════════════════════════════════════════
// NÚMEROS POR SETOR
// ═════════════════════════════════════════════════════════════════════════════
export interface Numero {
  rotulo: string;
  /** null = "sem dados ainda". */
  valor: string | null;
  dica?: string;
  tom?: "danger" | "warn" | "ok";
}

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const int = (v: number) => v.toLocaleString("pt-BR");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

// ── SDR ──────────────────────────────────────────────────────────────────────
export interface LinhaSdr {
  id: string; nome: string; recebidos: number; trabalhou: number; marcou: number;
  agendadas: number; realizadas: number; cotacoes: number; atrasadas: number;
}
export interface BlocoSdr { numeros: Numero[]; ranking: LinhaSdr[] }

export async function carregarSdr(p: Periodo): Promise<BlocoSdr> {
  const i = intervalo(p);
  const [funil, agendadas, realizadas, cotacoes, cotacoesTotal, metas, mapa] = await Promise.all([
    fetchFunil(i.deData, i.ateData),
    fetchAllRows<{ owner_id: string | null }>((de, ate) => supabase.from("qs_meetings").select("owner_id")
      .neq("status", "arquivada").neq("tipo", "retomada").gte("created_at", i.deIso).lte("created_at", i.ateIso).order("id").range(de, ate)),
    fetchAllRows<{ owner_id: string | null }>((de, ate) => supabase.from("qs_meetings").select("owner_id")
      .eq("status", "realizada").neq("tipo", "retomada").gte("scheduled_at", i.deIso).lte("scheduled_at", i.ateIso).order("id").range(de, ate)),
    fetchAllRows<{ owner_id: string | null }>((de, ate) => supabase.from("qs_aereo_cotacoes").select("owner_id")
      .gte("created_at", i.deIso).lte("created_at", i.ateIso).order("id").range(de, ate)),
    contar(supabase.from("qs_aereo_cotacoes").select("id", { count: "exact", head: true })),
    supabase.from("qs_goals").select("owner_id, type, target_value").eq("period", "mensal").in("type", ["reunioes", "reunioes_realizadas"]),
    nomes(),
  ]);
  checa(metas.error);
  const goals = (metas.data ?? []) as { owner_id: string | null; type: string; target_value: number }[];
  const meta = (type: string): number | null => {
    const l = goals.filter((g) => g.type === type);
    if (!l.length) return null;
    const ind = l.filter((g) => g.owner_id);
    return ind.length ? ind.reduce((s, g) => s + num(g.target_value), 0) : num(l[0].target_value);
  };
  const vsMeta = (feito: number, type: string): string => {
    const m = meta(type);
    // 27/10: diz ONDE cadastrar (não há link direto: o SDR não abre a aba Metas pelo endereço)
    if (m == null) return "sem meta: cadastre em Comercial · SDR → Análises & Metas → Metas";
    if (p !== "mes") return `meta do mês: ${int(m)}`;
    return `${pct(feito, m)} da meta de ${int(m)}`;
  };
  const t: LinhaFunil | null = funil.time;
  const numeros: Numero[] = [
    { rotulo: "Leads recebidos", valor: t ? int(t.recebidos) : null, dica: "leads que chegaram para os SDRs" },
    { rotulo: "Com primeiro contato", valor: t ? int(t.trabalhou) : null, dica: t ? `${pct(t.trabalhou, t.recebidos)} dos recebidos tiveram ao menos 1 atividade` : undefined },
    { rotulo: "Reuniões agendadas", valor: int(agendadas.length), dica: `marcadas no período · ${vsMeta(agendadas.length, "reunioes")}` },
    { rotulo: "Reuniões realizadas", valor: int(realizadas.length), dica: vsMeta(realizadas.length, "reunioes_realizadas") },
    { rotulo: "Cotações de aéreo", valor: cotacoesTotal === 0 ? null : int(cotacoes.length), dica: cotacoesTotal === 0 ? "nenhuma cotação registrada até hoje" : "iniciadas no período" },
  ];

  const conta = (rows: { owner_id: string | null }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.owner_id) m.set(r.owner_id, (m.get(r.owner_id) ?? 0) + 1);
    return m;
  };
  const ag = conta(agendadas), re = conta(realizadas), co = conta(cotacoes);
  const linhas = new Map<string, LinhaSdr>();
  const linha = (id: string): LinhaSdr => {
    let l = linhas.get(id);
    if (!l) { l = { id, nome: mapa.get(id)?.nome ?? "Sem nome", recebidos: 0, trabalhou: 0, marcou: 0, agendadas: 0, realizadas: 0, cotacoes: 0, atrasadas: 0 }; linhas.set(id, l); }
    return l;
  };
  for (const s of funil.sdrs) {
    if (!s.sdr_id) continue;
    const l = linha(s.sdr_id);
    if (s.nome) l.nome = s.nome;
    l.recebidos = s.recebidos; l.trabalhou = s.trabalhou; l.marcou = s.marcou; l.atrasadas = s.atrasadas ?? 0;
  }
  // Reunião marcada por quem não é SDR (closer, gestão) também aparece: o ranking é "quem fez".
  for (const [id, v] of ag) linha(id).agendadas = v;
  for (const [id, v] of re) linha(id).realizadas = v;
  for (const [id, v] of co) linha(id).cotacoes = v;
  const ranking = [...linhas.values()]
    .filter((l) => l.recebidos || l.trabalhou || l.agendadas || l.realizadas || l.cotacoes)
    .sort((a, b) => b.agendadas - a.agendadas || b.realizadas - a.realizadas || b.recebidos - a.recebidos);
  return { numeros, ranking };
}

// ── Closer ───────────────────────────────────────────────────────────────────
export interface LinhaCloser {
  id: string; nome: string; realizadas: number; noShow: number; preVendas: number; consolidadas: number; valor: number;
}
export interface BlocoCloser { numeros: Numero[]; ranking: LinhaCloser[] }

interface NegocioLido { id: string; closer_id: string | null; pre_venda_em: string | null; pre_venda_valor: number | null; consolidada_em: string | null; valor_previsto: number | null; ficha: { valor_total?: number } | null }

export async function carregarCloser(p: Periodo): Promise<BlocoCloser> {
  const i = intervalo(p);
  const selNeg = "id, closer_id, pre_venda_em, pre_venda_valor, consolidada_em, valor_previsto, ficha";
  const [reunioes, preVendas, consolidadas, jaHouveVenda, mapa] = await Promise.all([
    fetchAllRows<{ closer_id: string | null; status: string; venda_valor: number | null }>((de, ate) => supabase.from("qs_meetings")
      .select("closer_id, status, venda_valor").in("status", ["realizada", "no_show"])
      .gte("scheduled_at", i.deIso).lte("scheduled_at", i.ateIso).order("id").range(de, ate)),
    fetchAllRows<NegocioLido>((de, ate) => supabase.from("qs_closer_negocios").select(selNeg)
      .gte("pre_venda_em", i.deIso).lte("pre_venda_em", i.ateIso).order("id").range(de, ate)),
    fetchAllRows<NegocioLido>((de, ate) => supabase.from("qs_closer_negocios").select(selNeg)
      .gte("consolidada_em", i.deIso).lte("consolidada_em", i.ateIso).order("id").range(de, ate)),
    contar(supabase.from("qs_closer_negocios").select("id", { count: "exact", head: true }).or("pre_venda_em.not.is.null,consolidada_em.not.is.null")),
    nomes(),
  ]);
  const realizadas = reunioes.filter((r) => r.status === "realizada");
  const noShow = reunioes.length - realizadas.length;
  const valorInformado = realizadas.reduce((s, r) => s + num(r.venda_valor), 0);
  const valorDe = (n: NegocioLido) => num(n.ficha?.valor_total ?? n.pre_venda_valor ?? n.valor_previsto);
  // Venda = cartão com pré-venda OU consolidado no período (contado uma vez só).
  const vendas = new Map<string, NegocioLido>();
  for (const n of [...preVendas, ...consolidadas]) vendas.set(n.id, n);
  const valorVendas = consolidadas.reduce((s, n) => s + valorDe(n), 0);
  const semVendaAinda = jaHouveVenda === 0;
  const aviso = "nenhuma pré-venda ou venda consolidada registrada no QS até hoje";

  const numeros: Numero[] = [
    { rotulo: "Reuniões realizadas", valor: int(realizadas.length), dica: `${int(noShow)} no-show (${pct(noShow, reunioes.length)})${valorInformado ? ` · ${brl(valorInformado)} informados no desfecho` : ""}` },
    { rotulo: "Pré-vendas", valor: semVendaAinda ? null : int(preVendas.length), dica: semVendaAinda ? aviso : "marcadas no período" },
    { rotulo: "Vendas consolidadas", valor: semVendaAinda ? null : int(consolidadas.length), dica: semVendaAinda ? aviso : "ficha de fechamento feita no período" },
    { rotulo: "Valor consolidado", valor: semVendaAinda ? null : brl(valorVendas), dica: semVendaAinda ? aviso : "soma das fichas de fechamento" },
    { rotulo: "Conversão", valor: semVendaAinda ? null : pct(vendas.size, realizadas.length), dica: semVendaAinda ? aviso : "vendas (pré-venda ou consolidada) ÷ reuniões realizadas" },
  ];

  const linhas = new Map<string, LinhaCloser>();
  const linha = (id: string | null): LinhaCloser => {
    const k = id ?? "-";
    let l = linhas.get(k);
    if (!l) { l = { id: k, nome: id ? mapa.get(id)?.nome ?? "Sem nome" : "Sem closer", realizadas: 0, noShow: 0, preVendas: 0, consolidadas: 0, valor: 0 }; linhas.set(k, l); }
    return l;
  };
  for (const r of reunioes) { const l = linha(r.closer_id); if (r.status === "realizada") l.realizadas++; else l.noShow++; }
  for (const n of preVendas) linha(n.closer_id).preVendas++;
  for (const n of consolidadas) { const l = linha(n.closer_id); l.consolidadas++; l.valor += valorDe(n); }
  const ranking = [...linhas.values()].sort((a, b) => b.valor - a.valor || b.consolidadas - a.consolidadas || b.realizadas - a.realizadas);
  return { numeros, ranking };
}

// ── Relacionamento ───────────────────────────────────────────────────────────
// Olha pra frente: os embarques não dependem do período escolhido.
export async function carregarRel(): Promise<Numero[]> {
  const hoje = hojeSP();
  const v = () => supabase.from("rel_viagens_v").select("id", { count: "exact", head: true }).eq("status", "ativa");
  const at = () => supabase.from("rel_wa_atendimentos").select("id", { count: "exact", head: true }).is("concluido_em", null);
  const [ativas, emViagem, emb7, emb30, faxina, abertos, semResposta] = await Promise.all([
    contar(v().in("fase", ["antes", "em_viagem"])),
    contar(v().eq("fase", "em_viagem")),
    contar(v().gte("data_embarque", hoje).lte("data_embarque", somaDias(hoje, 7))),
    contar(v().gte("data_embarque", hoje).lte("data_embarque", somaDias(hoje, 30))),
    supabase.from("rel_faxina_resumo").select("sem_dono").maybeSingle(),
    contar(at()),
    contar(at().is("primeira_resposta_em", null)),
  ]);
  checa(faxina.error);
  const semDono = faxina.data ? num((faxina.data as { sem_dono: number }).sem_dono) : null;
  return [
    { rotulo: "Viagens ativas", valor: int(ativas), dica: `antes do embarque ou em viagem · ${int(emViagem)} viajando agora` },
    { rotulo: "Embarques nos próximos 7 dias", valor: int(emb7), dica: `${int(emb30)} nos próximos 30 dias` },
    { rotulo: "Viagens sem dono", valor: semDono == null ? null : int(semDono), dica: "com acompanhamento, antes ou durante a viagem", tom: semDono ? "danger" : undefined },
    { rotulo: "Atendimentos em aberto", valor: int(abertos), dica: `${int(semResposta)} ainda sem nenhuma resposta`, tom: semResposta ? "warn" : undefined },
  ];
}

// ── Financeiro ───────────────────────────────────────────────────────────────
export async function carregarFin(p: Periodo): Promise<Numero[]> {
  const i = intervalo(p);
  const linhas = await fetchAllRows<{ valor: number; situacao: string; pago_em: string | null; pago_valor: number | null }>((de, ate) =>
    supabase.from("fin_contas_receber_v").select("valor, situacao, pago_em, pago_valor").order("id").range(de, ate));
  if (!linhas.length) {
    const d = "nenhuma parcela lançada ainda";
    return [
      { rotulo: "A receber", valor: null, dica: d },
      { rotulo: "Recebido no período", valor: null, dica: d },
      { rotulo: "Atrasado", valor: null, dica: d },
    ];
  }
  const soma = (f: (l: (typeof linhas)[number]) => boolean, v: (l: (typeof linhas)[number]) => number) => linhas.filter(f).reduce((s, l) => s + v(l), 0);
  const aReceber = linhas.filter((l) => l.situacao === "a_receber");
  const atrasado = linhas.filter((l) => l.situacao === "atrasado");
  const recebido = soma((l) => l.situacao === "pago" && !!l.pago_em && l.pago_em.slice(0, 10) >= i.deData && l.pago_em.slice(0, 10) <= i.ateData, (l) => num(l.pago_valor ?? l.valor));
  return [
    { rotulo: "A receber", valor: brl(aReceber.reduce((s, l) => s + num(l.valor), 0)), dica: `${int(aReceber.length)} parcelas em dia` },
    { rotulo: "Recebido no período", valor: brl(recebido), dica: "baixas dadas pelo Financeiro" },
    { rotulo: "Atrasado", valor: brl(atrasado.reduce((s, l) => s + num(l.valor), 0)), dica: `${int(atrasado.length)} parcelas vencidas`, tom: atrasado.length ? "danger" : "ok" },
  ];
}

// ── Operações ────────────────────────────────────────────────────────────────
export async function carregarOps(): Promise<Numero[]> {
  const hoje = hojeSP();
  const ate = somaDias(hoje, 30);
  const [{ data: proximas, error }, { data: viajando, error: e2 }] = await Promise.all([
    supabase.from("expedicoes").select("id, pax_planejados").gte("data_embarque", hoje).lte("data_embarque", ate).limit(1000),
    supabase.from("expedicoes").select("id").lte("data_embarque", hoje).gte("data_retorno", hoje).limit(1000),
  ]);
  checa(error); checa(e2);
  const ids = (proximas ?? []).map((e: { id: string }) => e.id);
  const vagas = (proximas ?? []).reduce((s: number, e: { pax_planejados: number | null }) => s + num(e.pax_planejados), 0);
  const [confirmados, pendentes] = ids.length ? await Promise.all([
    contar(supabase.from("passageiros").select("id", { count: "exact", head: true }).in("expedicao_id", ids).eq("status_reserva", "Confirmado")),
    contar(supabase.from("passageiros").select("id", { count: "exact", head: true }).in("expedicao_id", ids).or(PAX_PENDENTE)),
  ]) : [0, 0];
  return [
    { rotulo: "Expedições nos próximos 30 dias", valor: int(ids.length), dica: `${int((viajando ?? []).length)} em viagem agora` },
    { rotulo: "Passageiros confirmados", valor: int(confirmados), dica: vagas ? `nessas expedições · ${int(vagas)} vagas planejadas` : "nessas expedições" },
    { rotulo: "Passageiros pendentes", valor: int(pendentes), dica: "lead, pré-reserva ou aguardando aprovação", tom: pendentes ? "warn" : undefined },
  ];
}
