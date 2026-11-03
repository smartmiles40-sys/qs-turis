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
import { StatCard, FilterPill, StatusChip, Card, Alert, EmptyState } from "@/components/ui";
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
        if (!gestao) q = q.eq("owner_id", currentUser.id);
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
  }, [currentUser, gestao]);

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

  return (
    <section aria-label="Reuniões que você marcou" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold" style={{ color: "var(--text)" }}>
            {gestao ? "Reuniões marcadas pelo time" : "Reuniões que você marcou"}
          </h2>
          <p className="text-[13px]" style={{ color: "var(--subtle)" }}>
            O status de cada uma, do agendamento ao desfecho do closer.
          </p>
        </div>
        {gestao && sdrs.length > 0 && (
          <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--muted)" }}>
            SDR
            <select value={sdrFiltro} onChange={(e) => setSdrFiltro(e.target.value)}
              className="h-9 px-3 rounded-lg border text-[13px]" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>
              <option value="">Todos</option>
              {sdrs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {erro && <Alert tone="danger">{erro}</Alert>}

      {/* A cobrança vem antes de tudo, como na Minha agenda: é a única coisa
          que já deveria ter sido feita. */}
      {semDesfechoTotal > 0 && (
        <Alert tone="warn" action={<button type="button" className="qs-btn qs-btn--sm" onClick={verSemDesfecho}>Ver quais</button>}>
          {semDesfechoTotal === 1
            ? `1 reunião ${gestao ? "do time" : "que você marcou"} já passou e o closer não registrou o desfecho.`
            : `${semDesfechoTotal} reuniões ${gestao ? "do time" : "que você marcou"} já passaram e o closer não registrou o desfecho.`}
          {!gestao && " Cobre quem atendeu."}
        </Alert>
      )}

      {/* Semana: um dia por coluna, com quantas reuniões tem. Clicar filtra. */}
      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Esta semana">
        {semana.map(({ dia, total, abertas }) => {
          const ehHoje = dia.toDateString() === agora.toDateString();
          const ativo = diaEscolhido?.toDateString() === dia.toDateString();
          return (
            <button key={dia.toISOString()} type="button"
              onClick={() => setDiaEscolhido(ativo ? null : dia)}
              aria-pressed={ativo}
              title={`${WEEKDAY_LONG[dia.getDay()]}: ${total} reuniõe${total === 1 ? "" : "s"}${abertas ? `, ${abertas} em aberto` : ""}`}
              className="rounded-xl border px-1 py-2 flex flex-col items-center gap-0.5 transition-colors"
              style={{
                borderColor: ativo ? "var(--text)" : "var(--border)",
                background: ativo ? "var(--surface-2)" : "var(--surface)",
              }}>
              <span className="text-[11px] font-semibold uppercase" style={{ color: ehHoje ? "var(--info)" : "var(--subtle)" }}>
                {ehHoje ? "Hoje" : WEEKDAY_SHORT[dia.getDay()]}
              </span>
              <span className="text-[13px] tabular-nums" style={{ color: "var(--muted)" }}>{dia.getDate()}</span>
              <span className="text-[22px] font-semibold leading-none tabular-nums" style={{ color: total ? "var(--text)" : "var(--border)" }}>{total}</span>
            </button>
          );
        })}
      </div>

      {/* Período */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODOS_REUNIOES.map((p) => (
          <FilterPill key={p.id} active={!diaEscolhido && periodo === p.id} onClick={() => { setDiaEscolhido(null); setPeriodo(p.id); }}>
            {p.rotulo}
          </FilterPill>
        ))}
        {diaEscolhido && (
          <FilterPill active onClick={() => setDiaEscolhido(null)}>
            {WEEKDAY_SHORT[diaEscolhido.getDay()]}, {diaEscolhido.getDate()}/{diaEscolhido.getMonth() + 1} ✕
          </FilterPill>
        )}
      </div>

      {/* Os números do período — poucos e grandes. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Reuniões no período" value={resumo.total}
          sub={`${resumo.porSituacao.vai_acontecer} vão acontecer`} />
        <StatCard label="Realizadas" value={resumo.porSituacao.realizada} tone={resumo.porSituacao.realizada ? "ok" : "default"}
          sub={`comparecimento ${pct(resumo.comparecimento)} · ${resumo.porSituacao.no_show} no-show`}
          onClick={() => setSituacao("realizada")} />
        <StatCard label="SAL aceito" value={resumo.salAceito}
          sub={resumo.porSituacao.realizada ? `${pct((resumo.salAceito / resumo.porSituacao.realizada) * 100)} das realizadas` : "nenhuma realizada"}
          onClick={() => setSoSal((v) => !v)} />
        <StatCard label="Vendas" value={resumo.vendas} tone={resumo.vendas ? "ok" : "default"}
          sub={resumo.vendas ? brl(resumo.valorVendido) : "nenhuma no período"}
          onClick={() => setSoVenda((v) => !v)} />
      </div>

      {/* Status */}
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtrar por status">
        <FilterPill active={situacao === "todas"} count={resumo.total} onClick={() => setSituacao("todas")}>Todas</FilterPill>
        {SITUACOES.filter((s) => resumo.porSituacao[s.id] > 0 || situacao === s.id).map((s) => (
          <FilterPill key={s.id} active={situacao === s.id} count={resumo.porSituacao[s.id]}
            countTone={s.id === "sem_desfecho" ? "warn" : undefined}
            onClick={() => setSituacao(situacao === s.id ? "todas" : s.id)}>
            {s.rotulo}
          </FilterPill>
        ))}
        <span className="mx-1 h-5 w-px" style={{ background: "var(--border)" }} aria-hidden />
        <FilterPill active={soSal} onClick={() => setSoSal((v) => !v)}>Com SAL</FilterPill>
        <FilterPill active={soVenda} onClick={() => setSoVenda((v) => !v)}>Com venda</FilterPill>
      </div>

      {/* Lista por dia */}
      {carregando ? (
        <div className="h-32 rounded-2xl animate-pulse" style={{ background: "var(--surface-2)" }} />
      ) : grupos.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma reunião com esse filtro."
            description={periodo === "proximas" && situacao === "todas" ? "Nada marcado de hoje em diante." : "Troque o período ou o status."} />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {grupos.map((g) => {
            if (restantes <= 0) return null;
            const itens = g.itens.slice(0, restantes);
            restantes -= itens.length;
            const ehHoje = g.dia.toDateString() === agora.toDateString();
            return (
              <div key={g.chave} className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div className="px-4 py-2 text-[12.5px] font-semibold border-b" style={{ borderColor: "var(--border)", color: ehHoje ? "var(--info)" : "var(--muted)", background: "var(--surface-2)" }}>
                  {ehHoje ? "Hoje · " : ""}{WEEKDAY_LONG[g.dia.getDay()]}, {g.dia.getDate()} de {MONTH_LONG[g.dia.getMonth()]}
                  {g.dia.getFullYear() !== agora.getFullYear() ? ` de ${g.dia.getFullYear()}` : ""}
                  <span className="ml-2 font-normal" style={{ color: "var(--subtle)" }}>{g.itens.length}</span>
                </div>
                <ul>
                  {itens.map((m) => (
                    <LinhaReuniao key={m.id} m={m} agora={agora}
                      sdr={gestao ? nomeSdr(m.owner_id) ?? m.scheduled_by ?? null : null}
                      gravacoes={gravacoes.get(m.lead_id) ?? 0}
                      onDetalhe={() => setDetalhe(m)}
                      onLead={() => onOpenLead(m.lead_id)} />
                  ))}
                </ul>
              </div>
            );
          })}
          {filtradas.length > mostrar && (
            <button type="button" className="qs-btn self-center" onClick={() => setMostrar((n) => n + POR_PAGINA)}>
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

const TOM: Record<Situacao, "info" | "warn" | "ok" | "danger" | "neutral"> =
  Object.fromEntries(SITUACOES.map((s) => [s.id, s.tom])) as Record<Situacao, "info" | "warn" | "ok" | "danger" | "neutral">;
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
  return (
    <li className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)", opacity: apagada ? 0.65 : 1 }}>
      <div className="w-14 shrink-0">
        <div className="text-[17px] font-semibold tabular-nums leading-none" style={{ color: "var(--text)" }}>{hhmm(ini)}</div>
        {agoraNela && <div className="text-[10.5px] font-bold uppercase mt-1" style={{ color: "var(--info)" }}>agora</div>}
      </div>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onDetalhe} className="text-left text-[14.5px] font-semibold truncate max-w-full hover:underline" style={{ color: "var(--text)" }}>
          {m.lead?.full_name ?? m.lead_name ?? "Lead"}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: "var(--subtle)" }}>
          {closer && <span>Closer: <b style={{ color: "var(--muted)", fontWeight: 600 }}>{primeiroNome(closer)}</b></span>}
          {sdr && <span>SDR: <b style={{ color: "var(--muted)", fontWeight: 600 }}>{primeiroNome(sdr)}</b></span>}
          {m.tipo === "retomada" && <span>· retomada</span>}
          {m.origem === "autoagendamento" && <span>· o cliente marcou sozinho</span>}
          {gravacoes > 0 && (
            <button type="button" onClick={onLead} className="underline" title="Abre a ficha do lead — aba Ligações">
              · {gravacoes} ligaç{gravacoes === 1 ? "ão gravada" : "ões gravadas"}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <StatusChip tone={TOM[s]}>{ROTULO_UM[s]}</StatusChip>
        {m.sal === "aceito" && <StatusChip tone="ok">SAL</StatusChip>}
        {m.sal === "recusado" && <StatusChip>SAL recusado</StatusChip>}
        {venda > 0 && <StatusChip tone="ok">{brl(venda)}</StatusChip>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {aberta && m.meeting_link && (
          <a href={m.meeting_link} target="_blank" rel="noreferrer" className="qs-btn qs-btn--sm qs-btn--primary">Entrar no Meet</a>
        )}
        <button type="button" className="qs-btn qs-btn--sm" onClick={onLead}>Histórico</button>
        <button type="button" className="qs-btn qs-btn--sm" onClick={onDetalhe}>{s === "sem_desfecho" ? "Ver" : "Detalhes"}</button>
      </div>
    </li>
  );
}
