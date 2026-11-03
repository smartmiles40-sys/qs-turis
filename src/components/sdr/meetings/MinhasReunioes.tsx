// src/components/sdr/meetings/MinhasReunioes.tsx
// -----------------------------------------------------------------------------
// "REUNIÕES QUE EU MARQUEI" — a parte de cima da tela unificada (Bruno, 03/11:
// "Minha agenda, vamos unificar com Reuniões, assim eles conseguem acompanhar
// todas as reuniões que eles marcaram e como está o status dessas reuniões").
//
// O que veio da Minha agenda pra cá:
//   - as reuniões que o SDR marcou e o closer ainda não deu desfecho (faixa
//     amarela, agora contando TODAS, não só as 50 mais recentes);
//   - hoje e os próximos dias (período "De hoje em diante" + faixa da semana);
//   - Entrar no Meet, Ver histórico do lead, Detalhes (o MeetingDetailModal:
//     gerar sala do Meet, remarcar, desfecho, SAL, reenviar pro Bitrix,
//     excluir — cada um com a permissão que já tinha).
// O que é novo: a lista de TODAS as reuniões com filtro por período e status,
// e os números do período (realizadas, comparecimento, SAL, vendas).
//
// Quem marcou = qs_meetings.owner_id (createMeeting grava o SDR ali; conferido
// no banco em 03/11). Gestão vê o time e escolhe o SDR.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { fetchAllRows } from "@/lib/qs/queries";
import { hhmm, WEEKDAY_SHORT, WEEKDAY_LONG, MONTH_LONG } from "@/lib/qs/calendarLayout";
import {
  SITUACOES, PERIODOS_REUNIOES, situacaoDaReuniao, intervaloReunioes, intervaloDoDia, dentroDoIntervalo,
  resumirReunioes, agruparPorDia, faixaDaSemana, valorDaVenda, type PeriodoReunioes, type Situacao,
} from "@/lib/qs/reunioesDoSdr";
import "../agenda/agenda.css";
import MeetingDetailModal from "../agenda/MeetingDetailModal";
import ScheduleMeetingModal from "../agenda/ScheduleMeetingModal";
import type { Meeting } from "../types";

interface Props {
  onOpenLead: (leadId: string) => void;
  /** Muda quando outra parte da tela grava algo (agendou, remarcou) — relê. */
  versao?: number;
}

type Reuniao = Meeting & {
  lead?: { id: string; full_name: string | null; phone: string | null; bitrix_id?: string | null; owner_id: string | null } | null;
  closer?: { id: string; name: string } | null;
};

const SELECT = "*, lead:qs_leads(id,full_name,phone,email,segment,owner_id,bitrix_id), closer:qs_users!qs_meetings_closer_id_fkey(id,name)";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
const primeiroNome = (n?: string | null) => String(n ?? "").trim().split(/\s+/)[0] || "";
const POR_PAGINA = 80;

export default function MinhasReunioes({ onOpenLead, versao = 0 }: Props) {
  const { currentUser } = useQsAuth();
  const gestao = currentUser ? canSeeAllData(currentUser.role) : false;
  // Closer (aba "Reuniões do time" da área dele, 03/11): as que ELE atende.
  const ehCloser = !gestao && currentUser?.role === "closer";
  const titulo = gestao ? "Reuniões marcadas pelo time" : ehCloser ? "Reuniões que você atende" : "Reuniões que você marcou";

  const [lista, setLista] = useState<Reuniao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sdrs, setSdrs] = useState<{ id: string; name: string }[]>([]);
  const [sdrFiltro, setSdrFiltro] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoReunioes>("proximas");
  const [diaEscolhido, setDiaEscolhido] = useState<Date | null>(null);
  const [situacao, setSituacao] = useState<Situacao | "todas">("todas");
  const [soSal, setSoSal] = useState(false);
  const [soVenda, setSoVenda] = useState(false);
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [gravacoes, setGravacoes] = useState<Map<string, number>>(new Map());
  const [detalhe, setDetalhe] = useState<Meeting | null>(null);
  const [remarcar, setRemarcar] = useState<Meeting | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  const carregar = useCallback(async () => {
    if (!currentUser) return;
    setErro(null);
    try {
      const rows = await fetchAllRows<Reuniao>((from, to) => {
        let q = supabase.from("qs_meetings").select(SELECT).order("scheduled_at", { ascending: false }).order("id");
        // SDR: as que ELE marcou. Gestão: o time (filtra na tela).
        if (ehCloser) q = q.eq("closer_id", currentUser.id);
        else if (!gestao) q = q.eq("owner_id", currentUser.id);
        return q.range(from, to) as unknown as PromiseLike<{ data: Reuniao[] | null; error: { message?: string } | null }>;
      });
      setLista(rows);
      setAgora(new Date());
    } catch (e) {
      console.warn("[minhas-reunioes]", e);
      setErro("Não consegui carregar as reuniões. Recarregue a página.");
    } finally {
      setCarregando(false);
    }
  }, [currentUser, gestao, ehCloser]);

  useEffect(() => { void carregar(); }, [carregar, versao]);
  // "Sem desfecho" depende do relógio: relê a cada 2 min com a aba visível.
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) void carregar(); }, 120_000);
    return () => window.clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    if (!gestao) return;
    void supabase.from("qs_users").select("id,name").eq("role", "sdr").eq("is_active", true).order("name")
      .then(({ data }) => setSdrs((data as { id: string; name: string }[]) ?? []));
  }, [gestao]);

  // ── Recortes ──────────────────────────────────────────────────────────────
  const doSdr = useMemo(() => (gestao && sdrFiltro ? lista.filter((m) => m.owner_id === sdrFiltro) : lista), [lista, gestao, sdrFiltro]);
  const intervalo = useMemo(() => (diaEscolhido ? intervaloDoDia(diaEscolhido) : intervaloReunioes(periodo, agora)), [periodo, diaEscolhido, agora]);
  const doPeriodo = useMemo(() => doSdr.filter((m) => dentroDoIntervalo(m, intervalo)), [doSdr, intervalo]);
  const resumo = useMemo(() => resumirReunioes(doPeriodo, agora), [doPeriodo, agora]);
  const semDesfechoTotal = useMemo(() => doSdr.filter((m) => situacaoDaReuniao(m, agora) === "sem_desfecho").length, [doSdr, agora]);
  const semana = useMemo(() => faixaDaSemana(doSdr, agora), [doSdr, agora]);

  const filtradas = useMemo(() => doPeriodo.filter((m) =>
    (situacao === "todas" || situacaoDaReuniao(m, agora) === situacao) &&
    (!soSal || m.sal === "aceito") &&
    (!soVenda || valorDaVenda(m) > 0)
  ), [doPeriodo, situacao, soSal, soVenda, agora]);

  // Pra frente: a mais próxima primeiro. Pra trás: a mais recente primeiro.
  const crescente = !diaEscolhido && (periodo === "proximas" || periodo === "hoje" || periodo === "semana");
  const grupos = useMemo(() => agruparPorDia(filtradas, crescente), [filtradas, crescente]);
  useEffect(() => { setMostrar(POR_PAGINA); }, [periodo, diaEscolhido, situacao, soSal, soVenda, sdrFiltro]);

  // Gravações de ligação (0233) dos leads que estão na tela: o atalho pra
  // achar o áudio é a ficha do lead, aba "Ligações".
  const leadsNaTela = useMemo(() => [...new Set(filtradas.slice(0, mostrar).map((m) => m.lead_id).filter(Boolean))].sort(), [filtradas, mostrar]);
  const chaveLeads = leadsNaTela.join(",");
  useEffect(() => {
    let vivo = true;
    (async () => {
      const conta = new Map<string, number>();
      for (let i = 0; i < leadsNaTela.length; i += 80) {
        const { data, error } = await supabase.from("qs_ligacao_gravacoes").select("lead_id").in("lead_id", leadsNaTela.slice(i, i + 80)).limit(1000);
        if (error) return; // tabela ausente/sem permissão: só não mostra o selo
        for (const r of (data ?? []) as { lead_id: string }[]) conta.set(r.lead_id, (conta.get(r.lead_id) ?? 0) + 1);
      }
      if (vivo) setGravacoes(conta);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveLeads]);

  function verSemDesfecho() {
    setDiaEscolhido(null);
    setPeriodo("tudo");
    setSituacao("sem_desfecho");
  }

  function aoMudar() {
    setDetalhe(null);
    void carregar();
  }

  const nomeSdr = (id: string | null) => sdrs.find((s) => s.id === id)?.name ?? null;
  let restantes = mostrar;
  const maxSemana = Math.max(1, ...semana.map((s) => s.total));
  const barra = (n: number) => (resumo.total ? Math.round((n / resumo.total) * 100) : 0);
  const kpis = [
    { rotulo: "Reuniões no período", valor: resumo.total, sub: `${resumo.porSituacao.vai_acontecer} ainda ${resumo.porSituacao.vai_acontecer === 1 ? "vai" : "vão"} acontecer`, pct: resumo.total ? 100 : 0, st: "agendada", cor: "var(--ag-text)", onClick: () => setSituacao("todas") },
    { rotulo: "Realizadas", valor: resumo.porSituacao.realizada, sub: `Comparecimento de ${pct(resumo.comparecimento)} · ${resumo.porSituacao.no_show} no-show`, pct: barra(resumo.porSituacao.realizada), st: "realizada", cor: "var(--ag-realizada-fg)", onClick: () => setSituacao("realizada") },
    { rotulo: "SAL aceito", valor: resumo.salAceito, sub: resumo.porSituacao.realizada ? `${pct((resumo.salAceito / resumo.porSituacao.realizada) * 100)} das realizadas` : "nenhuma realizada", pct: barra(resumo.salAceito), st: "agendada", cor: "var(--ag-text-2)", onClick: () => setSoSal((v) => !v) },
    { rotulo: "Vendas", valor: resumo.vendas, sub: resumo.vendas ? `${brl(resumo.valorVendido)} fechados` : "nenhuma no período", pct: barra(resumo.vendas), st: "sem_desfecho", cor: "var(--ag-warn)", onClick: () => setSoVenda((v) => !v) },
  ];

  return (
    <section aria-label={titulo} className="flex flex-col gap-4">
      {/* Período + SDR (gestão) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {PERIODOS_REUNIOES.map((p) => (
            <button key={p.id} type="button" className="ag-pill" aria-pressed={!diaEscolhido && periodo === p.id}
              onClick={() => { setDiaEscolhido(null); setPeriodo(p.id); }}>
              {p.rotulo}
            </button>
          ))}
          {diaEscolhido && (
            <button type="button" className="ag-pill" aria-pressed onClick={() => setDiaEscolhido(null)} title="Tirar o filtro do dia">
              {WEEKDAY_SHORT[diaEscolhido.getDay()]}, {diaEscolhido.getDate()}/{diaEscolhido.getMonth() + 1} ✕
            </button>
          )}
        </div>
        {gestao && sdrs.length > 0 && (
          <label className="flex items-center gap-2 ag-muted">
            SDR
            <select value={sdrFiltro} onChange={(e) => setSdrFiltro(e.target.value)} className="ag-select">
              <option value="">Todos</option>
              {sdrs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <p className="ag-muted" style={{ fontSize: 13, marginTop: -6 }}>{titulo}: o status de cada uma, do agendamento ao desfecho do closer.</p>

      {erro && <div className="ag-faixa" role="alert"><span style={{ color: "var(--ag-desistencia-fg)" }}>{erro}</span></div>}

      {/* Os números do período — poucos e grandes. Clicar filtra. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <button key={k.rotulo} type="button" onClick={k.onClick} data-st={k.st}
            className="ag-card flex flex-col gap-1.5 px-[18px] py-4 text-left">
            <span className="ag-muted" style={{ fontSize: 13 }}>{k.rotulo}</span>
            <span className="tabular" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: k.cor }}>{k.valor}</span>
            <span className="block h-1.5 overflow-hidden rounded-[3px]" style={{ background: "var(--ag-border)" }}>
              <span className="block h-full rounded-[3px]" style={{ width: `${k.pct}%`, background: "var(--st-dot)" }} />
            </span>
            <span className="ag-muted" style={{ fontSize: 12 }}>{k.sub}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        {/* Semana: um dia por coluna, com quantas reuniões tem. Clicar filtra. */}
        <section className="ag-card flex flex-col gap-3 px-[18px] py-4" style={{ flex: "1 1 420px" }} aria-label="Esta semana">
          <span className="font-bold">Esta semana</span>
          <div className="grid h-[110px] grid-cols-7 items-end gap-2">
            {semana.map(({ dia, total, abertas }) => {
              const ehHoje = dia.toDateString() === agora.toDateString();
              const ativo = diaEscolhido?.toDateString() === dia.toDateString();
              return (
                <button key={dia.toISOString()} type="button" onClick={() => setDiaEscolhido(ativo ? null : dia)} aria-pressed={ativo}
                  title={`${WEEKDAY_LONG[dia.getDay()]}, ${dia.getDate()}: ${total} ${total === 1 ? "reunião" : "reuniões"}${abertas ? `, ${abertas} em aberto` : ""}`}
                  className="flex h-full flex-col items-center justify-end gap-1.5 rounded-lg"
                  style={{ boxShadow: ativo ? "inset 0 0 0 1px var(--ag-muted)" : "none" }}>
                  <span className="text-[13px] font-bold tabular">{total}</span>
                  <span className="block w-full max-w-[44px] rounded-md"
                    style={{ height: Math.max(4, Math.round((total / maxSemana) * 64)), background: ehHoje || ativo ? "var(--ag-pessoa-1)" : total ? "var(--ag-border-2)" : "var(--ag-border)" }} />
                  <span className="text-[11px] font-bold uppercase" style={{ color: ehHoje ? "var(--ag-muted-2)" : "var(--ag-subtle)" }}>
                    {ehHoje ? "Hoje" : WEEKDAY_SHORT[dia.getDay()]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* A cobrança: a única coisa que já deveria ter sido feita. */}
        <section className="ag-card ag-card--destaque flex flex-col justify-between gap-3 px-[18px] py-4" style={{ flex: "1 1 320px" }}>
          <div className="flex flex-col gap-1">
            <span className="tabular" style={{ fontSize: 28, fontWeight: 700, color: semDesfechoTotal ? "var(--ag-warn)" : "var(--ag-realizada-fg)" }}>{semDesfechoTotal}</span>
            <span>
              {semDesfechoTotal === 1
                ? `reunião ${gestao ? "do time" : ehCloser ? "sua" : "que você marcou"} já passou e o closer ainda não registrou o desfecho`
                : `reuniões ${gestao ? "do time" : ehCloser ? "suas" : "que você marcou"} já passaram e o closer ainda não registrou o desfecho`}
              {!gestao && !ehCloser && semDesfechoTotal > 0 && ". Cobre quem atendeu."}
            </span>
          </div>
          {semDesfechoTotal > 0 && (
            <button type="button" className="ag-btn ag-btn--md ag-btn--quiet self-start" onClick={verSemDesfecho}>Ver quais</button>
          )}
        </section>
      </div>

      {/* Status */}
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtrar por status">
        <button type="button" className="ag-pill" aria-pressed={situacao === "todas"} onClick={() => setSituacao("todas")}>
          Todas <span className="ag-qtd tabular">{resumo.total}</span>
        </button>
        {SITUACOES.filter((s) => resumo.porSituacao[s.id] > 0 || situacao === s.id).map((s) => (
          <button key={s.id} type="button" className="ag-pill" aria-pressed={situacao === s.id} data-st={stDaSituacao(s.id)}
            onClick={() => setSituacao(situacao === s.id ? "todas" : s.id)}>
            <span className="ag-dot" />
            {s.rotulo} <span className="ag-qtd tabular">{resumo.porSituacao[s.id]}</span>
          </button>
        ))}
        <span className="mx-1 h-5 w-px" style={{ background: "var(--ag-border)" }} aria-hidden />
        <button type="button" className="ag-pill" aria-pressed={soSal} onClick={() => setSoSal((v) => !v)}>Com SAL</button>
        <button type="button" className="ag-pill" aria-pressed={soVenda} onClick={() => setSoVenda((v) => !v)}>Com venda</button>
      </div>

      {/* Lista por dia */}
      {carregando ? (
        <div className="h-32 animate-pulse rounded-2xl" style={{ background: "var(--ag-surface-2)" }} />
      ) : grupos.length === 0 ? (
        <div className="ag-vazio" style={{ padding: 32 }}>
          {periodo === "proximas" && situacao === "todas" && !diaEscolhido ? "Nada marcado de hoje em diante." : "Nenhuma reunião com esse status no período."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {grupos.map((g) => {
            if (restantes <= 0) return null;
            const itens = g.itens.slice(0, restantes);
            restantes -= itens.length;
            const ehHoje = g.dia.toDateString() === agora.toDateString();
            return (
              <section key={g.chave} className="ag-card overflow-hidden">
                <div className="flex items-baseline gap-2 px-[18px] py-3" style={{ borderBottom: "1px solid var(--ag-border)" }}>
                  <span className="font-bold" style={{ color: ehHoje ? "var(--ag-muted-2)" : "var(--ag-text)" }}>
                    {ehHoje ? "Hoje · " : ""}{WEEKDAY_LONG[g.dia.getDay()]}, {g.dia.getDate()} de {MONTH_LONG[g.dia.getMonth()]}
                    {g.dia.getFullYear() !== agora.getFullYear() ? ` de ${g.dia.getFullYear()}` : ""}
                  </span>
                  <span className="ag-muted" style={{ fontSize: 13 }}>{g.itens.length} {g.itens.length === 1 ? "reunião" : "reuniões"}</span>
                </div>
                <ul>
                  {itens.map((m) => (
                    <LinhaReuniao key={m.id} m={m} agora={agora}
                      sdr={nomeSdr(m.owner_id) ?? m.scheduled_by ?? null}
                      gravacoes={gravacoes.get(m.lead_id) ?? 0}
                      onDetalhe={() => setDetalhe(m)}
                      onLead={() => onOpenLead(m.lead_id)} />
                  ))}
                </ul>
              </section>
            );
          })}
          {filtradas.length > mostrar && (
            <button type="button" className="ag-btn self-center" onClick={() => setMostrar((n) => n + POR_PAGINA)}>
              Mostrar mais ({filtradas.length - mostrar})
            </button>
          )}
        </div>
      )}

      <MeetingDetailModal
        meeting={detalhe}
        onClose={() => setDetalhe(null)}
        onChanged={aoMudar}
        onReschedule={(m) => { setDetalhe(null); setRemarcar(m); }}
        onOpenLead={onOpenLead}
      />
      <ScheduleMeetingModal
        open={!!remarcar}
        reschedule={remarcar}
        onClose={() => setRemarcar(null)}
        onSaved={() => { setRemarcar(null); void carregar(); }}
      />
    </section>
  );
}

/** Situação da lista (reunioesDoSdr) → cor da paleta da agenda (agenda.css). */
function stDaSituacao(s: Situacao): string {
  return s === "vai_acontecer" ? "agendada" : s;
}
const ROTULO_UM: Record<Situacao, string> = {
  vai_acontecer: "Agendada", sem_desfecho: "Sem desfecho", realizada: "Realizada", no_show: "No-show",
  reagendada: "Reagendada", cancelada: "Cancelada", desistencia: "Desistência", arquivada: "Arquivada",
};

function LinhaReuniao({ m, agora, sdr, gravacoes, onDetalhe, onLead }: {
  m: Reuniao; agora: Date; sdr: string | null; gravacoes: number; onDetalhe: () => void; onLead: () => void;
}) {
  const s = situacaoDaReuniao(m, agora);
  const ini = new Date(m.scheduled_at);
  const aberta = s === "vai_acontecer";
  const agoraNela = aberta && ini.getTime() <= agora.getTime();
  const venda = valorDaVenda(m);
  const closer = m.closer?.name ?? m.meeting_owner ?? null;
  const apagada = s === "cancelada" || s === "arquivada" || s === "reagendada";
  const st = agoraNela ? "acontecendo" : stDaSituacao(s);
  // A ação principal muda com o status (desenho): Meet pra quem vai
  // acontecer, desfecho pra quem passou sem, e o lead pro resto.
  const acao = aberta && m.meeting_link
    ? <a href={m.meeting_link} target="_blank" rel="noreferrer" className="ag-btn ag-btn--md ag-btn--primary">Entrar no Meet</a>
    : s === "sem_desfecho"
      ? <button type="button" className="ag-btn ag-btn--md ag-btn--warn" onClick={onDetalhe}>Registrar desfecho</button>
      : <button type="button" className="ag-btn ag-btn--md" onClick={onLead}>Ver lead</button>;
  return (
    <li data-st={st} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-[18px] py-3" style={{ borderBottom: "1px solid var(--ag-line)", opacity: apagada ? 0.75 : 1 }}>
      <div className="w-14 shrink-0">
        <div className="text-[18px] font-bold tabular leading-none">{hhmm(ini)}</div>
        {agoraNela && <div className="mt-1 text-[10.5px] font-bold uppercase" style={{ color: "var(--ag-muted-2)" }}>agora</div>}
      </div>
      <span className="ag-barra" />
      <div className="flex min-w-0 flex-col gap-0.5" style={{ flex: "1 1 240px" }}>
        <button type="button" onClick={onDetalhe} className="max-w-full truncate text-left text-[15px] font-bold hover:underline">
          {m.lead?.full_name ?? m.lead_name ?? "Lead"}
        </button>
        <span className="ag-muted" style={{ fontSize: 13 }}>
          {closer ? <>Closer {primeiroNome(closer)}</> : "Sem closer"}
          {sdr && <> · SDR {primeiroNome(sdr)}</>}
          {m.tipo === "retomada" && " · retomada"}
          {m.origem === "autoagendamento" && " · marcou sozinho"}
          {gravacoes > 0 && (
            <button type="button" onClick={onLead} className="underline" title="Abre a ficha do lead — aba Ligações">
              {" "}· {gravacoes} ligaç{gravacoes === 1 ? "ão gravada" : "ões gravadas"}
            </button>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="ag-badge">{agoraNela ? "Acontecendo agora" : ROTULO_UM[s]}</span>
        {m.sal === "aceito" && <span className="ag-sal" style={{ fontSize: 12, padding: "4px 9px" }}>SAL</span>}
        {m.sal === "recusado" && <span className="ag-sal ag-sal--off" style={{ fontSize: 12, padding: "4px 9px" }}>SAL recusado</span>}
        {venda > 0 && <span className="ag-badge" data-st="realizada">{brl(venda)}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        {acao}
        {!(s !== "sem_desfecho" && !(aberta && m.meeting_link)) && (
          <button type="button" className="ag-btn ag-btn--md" onClick={onLead} title="Histórico do lead">Histórico</button>
        )}
        <button type="button" aria-label="Detalhes da reunião" title="Detalhes da reunião" className="ag-icon-btn" style={{ background: "var(--ag-surface-2)", fontWeight: 700 }} onClick={onDetalhe}>⋯</button>
      </div>
    </li>
  );
}
