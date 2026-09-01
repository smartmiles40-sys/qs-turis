// src/components/sdr/agenda/MinhaAgendaPage.tsx
// -----------------------------------------------------------------------------
// A CASA DO CLOSER. É o que ele vê ao entrar no QS.
//
// Por que existe: até 07/08 o closer caía no Painel de Atividades — a fila do
// SDR — e precisava caçar as próprias reuniões em Reuniões → Agenda. O resultado
// estava no número: das 40 reuniões da base, ZERO tinham desfecho registrado, e
// 39 cobranças se acumulavam numa fila que ele não abria.
//
// A tela responde três perguntas, nesta ordem de urgência:
//
//   1. O que ficou pendente de mim?   (reunião que já passou e não tem desfecho)
//   2. O que eu tenho hoje?           (com o link e o contexto do lead à mão)
//   3. O que vem pela frente?         (resto da semana, para se localizar)
//
// A ordem é deliberada: a pendência vem ANTES do dia de hoje. É a única coisa
// que já deveria ter sido feita, e era justamente a que ninguém via.
//
// Registrar o desfecho reaproveita o MeetingDetailModal, que já sabe fazer isso
// (status, SAL, motivo da recusa, remarcar). Um caminho só para a mesma ação.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { sweepOutcomeTasks } from "@/lib/qs/meetings";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { fetchAllRows } from "@/lib/qs/queries";
import MeetingDetailModal from "./MeetingDetailModal";
import ScheduleMeetingModal from "./ScheduleMeetingModal";
import { hhmm, WEEKDAY_SHORT, WEEKDAY_LONG, MONTH_LONG } from "@/lib/qs/calendarLayout";
import type { Meeting } from "../types";

interface Props {
  onOpenLead: (leadId: string) => void;
}

/** Só o que a tela mostra do lead — evita `select *` numa tela de abertura. */
interface LeadCard {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  segment: string | null;
  owner_id: string | null;
}

type ReuniaoCard = Meeting & { lead?: LeadCard | null };

const ABERTAS = ["agendada", "confirmada"];

function inicioDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** "há 2 dias", "ontem" — o quanto a pendência está velha importa mais que a data. */
function haQuantoTempo(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 30) return `há ${Math.floor(dias / 7)} semana${dias >= 14 ? "s" : ""}`;
  return `há ${Math.floor(dias / 30)} mês${dias >= 60 ? "es" : ""}`;
}

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function primeiroNome(nome: string | null | undefined): string {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

export default function MinhaAgendaPage({ onOpenLead }: Props) {
  const { currentUser } = useQsAuth();
  const gestor = currentUser ? canSeeAllData(currentUser.role) : false;
  // A MESMA TELA, DOIS PONTOS DE VISTA (Bruno, 01/09).
  //
  // Pro closer, "pendente" é reunião DELE que ele não registrou — é cobrança.
  // Pro SDR é reunião que ELE marcou e o closer ainda não deu desfecho — é
  // acompanhamento: ele não pode registrar, mas é o único que sabe cobrar,
  // porque foi quem prometeu a call pro cliente. Até aqui ele nem via a tela.
  const visaoSdr = currentUser?.role === "sdr";

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState<ReuniaoCard[]>([]);
  const [proximas, setProximas] = useState<ReuniaoCard[]>([]);
  const [contatos, setContatos] = useState<Map<string, number>>(new Map());
  const [sdrs, setSdrs] = useState<Map<string, string>>(new Map());
  const [detalhe, setDetalhe] = useState<Meeting | null>(null);
  const [remarcar, setRemarcar] = useState<Meeting | null>(null);
  const [agendando, setAgendando] = useState(false);

  const SELECT = "*, lead:qs_leads(id,full_name,phone,email,segment,owner_id)";

  const carregar = useCallback(async () => {
    if (!currentUser) return;
    setErro(null);
    try {
      const agora = new Date();
      const hoje0 = inicioDoDia(agora);
      const ate = new Date(hoje0.getTime() + 8 * 864e5);

      // O gestor enxerga a agenda do time; o closer, a dele. A RLS já corta,
      // mas filtrar aqui evita trazer o que não vai ser mostrado.
      let qPend = supabase.from("qs_meetings").select(SELECT)
        .in("status", ABERTAS)
        .lt("ends_at", agora.toISOString())
        .order("scheduled_at", { ascending: false })
        .limit(50);
      let qProx = supabase.from("qs_meetings").select(SELECT)
        .gte("scheduled_at", hoje0.toISOString())
        .lt("scheduled_at", ate.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(100);

      if (visaoSdr) {
        // `owner_id` é quem AGENDOU (ver createMeeting) — não o closer que
        // atende. É por ele que o SDR reencontra o que prometeu.
        qPend = qPend.eq("owner_id", currentUser.id);
        qProx = qProx.eq("owner_id", currentUser.id);
      } else if (!gestor) {
        qPend = qPend.or(`closer_id.eq.${currentUser.id},meeting_owner.eq.${(currentUser.name ?? "").replace(/,/g, "")}`);
        qProx = qProx.or(`closer_id.eq.${currentUser.id},meeting_owner.eq.${(currentUser.name ?? "").replace(/,/g, "")}`);
      }

      const [rPend, rProx, rUsers] = await Promise.all([
        qPend,
        qProx,
        supabase.from("qs_users").select("id,name"),
      ]);

      if (rPend.error) throw rPend.error;
      if (rProx.error) throw rProx.error;

      const pend = (rPend.data ?? []) as ReuniaoCard[];
      const prox = (rProx.data ?? []) as ReuniaoCard[];
      setPendentes(pend);
      setProximas(prox);

      const mapaSdr = new Map<string, string>();
      for (const u of (rUsers.data ?? []) as { id: string; name: string }[]) mapaSdr.set(u.id, u.name);
      setSdrs(mapaSdr);

      // Quantos contatos o SDR já fez com este lead — é o "quanto custou chegar
      // até aqui" que dá contexto antes da conversa. Só dos leads em tela.
      const leadIds = [...new Set([...pend, ...prox].map((m) => m.lead_id).filter(Boolean))];
      if (leadIds.length) {
        const linhas = await fetchAllRows<{ lead_id: string }>((from, to) =>
          supabase.from("qs_tasks").select("lead_id")
            .eq("status", "concluida")
            .in("lead_id", leadIds)
            .order("id")
            .range(from, to)
        );
        const c = new Map<string, number>();
        for (const l of linhas) c.set(l.lead_id, (c.get(l.lead_id) ?? 0) + 1);
        setContatos(c);
      } else {
        setContatos(new Map());
      }
    } catch (e) {
      console.warn("[minha-agenda]", e);
      setErro("Não consegui carregar sua agenda. Recarregue a página.");
    } finally {
      setCarregando(false);
    }
  }, [currentUser, gestor, visaoSdr]);

  useEffect(() => { void carregar(); }, [carregar]);
  // As cobranças de desfecho nasciam só quando alguém abria a aba Reuniões — o
  // closer que vive NESTA tela nunca era cobrado. A varredura é idempotente.
  useEffect(() => { void sweepOutcomeTasks(); }, []);

  const hoje = useMemo(() => {
    const agora = new Date();
    return proximas.filter((m) => mesmoDia(new Date(m.scheduled_at), agora));
  }, [proximas]);

  // Os próximos 7 dias, sem hoje — para "se localizar" sem abrir o calendário.
  const semana = useMemo(() => {
    const hoje0 = inicioDoDia(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const dia = new Date(hoje0.getTime() + (i + 1) * 864e5);
      const doDia = proximas.filter((m) => mesmoDia(new Date(m.scheduled_at), dia));
      return { dia, reunioes: doDia };
    });
  }, [proximas]);

  const agora = new Date();
  const titulo = `${WEEKDAY_LONG[agora.getDay()]}, ${agora.getDate()} de ${MONTH_LONG[agora.getMonth()]}`;

  function aoMudar() {
    setDetalhe(null);
    void carregar();
  }

  if (carregando) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-3">
        <div className="h-8 w-64 rounded bg-gray-100 animate-pulse" />
        <div className="h-24 rounded-xl bg-gray-100 animate-pulse" />
        <div className="h-32 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {saudacao()}{currentUser?.name ? `, ${primeiroNome(currentUser.name)}` : ""}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5 capitalize">{titulo}</p>
        </div>
        {/* AGENDAR DAQUI (Bruno, 01/09). O modal já existia nesta tela, mas só
            abria em modo REMARCAR — pra marcar uma reunião nova o closer tinha
            que sair da própria casa e ir na aba Reuniões. A sala do Meet e o
            link saem iguais aos de lá: é o mesmo ScheduleMeetingModal. */}
        <button
          onClick={() => setAgendando(true)}
          className="shrink-0 px-3.5 py-2 rounded-lg bg-[#0147FF] text-white text-sm font-semibold hover:bg-[#0139cc]"
        >
          + Nova reunião
        </button>
      </header>

      {erro && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>
      )}

      {/* ── 1. O que ficou pendente ───────────────────────────────────────── */}
      {/* Vem antes do dia de hoje de propósito: é o que já deveria ter sido
          feito. Some da tela sozinho quando zera — não vira ruído permanente. */}
      {pendentes.length > 0 && (
        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200/70 flex items-center gap-2">
            <span className="text-lg leading-none">⚠️</span>
            <p className="text-sm font-bold text-amber-900">
              {visaoSdr
                ? (pendentes.length === 1
                    ? "1 reunião que você marcou e o closer ainda não registrou"
                    : `${pendentes.length} reuniões que você marcou e o closer ainda não registrou`)
                : (pendentes.length === 1
                    ? "1 reunião esperando seu desfecho"
                    : `${pendentes.length} reuniões esperando seu desfecho`)}
            </p>
          </div>
          <ul className="divide-y divide-amber-200/60">
            {pendentes.slice(0, 6).map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-950 truncate">
                    {m.lead?.full_name ?? m.lead_name ?? "Lead"}
                  </p>
                  <p className="text-[11.5px] text-amber-800">
                    {haQuantoTempo(m.scheduled_at)} · {new Date(m.scheduled_at).getDate()}/{new Date(m.scheduled_at).getMonth() + 1} às {hhmm(new Date(m.scheduled_at))}
                    {gestor && m.meeting_owner ? ` · ${m.meeting_owner}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setDetalhe(m)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700"
                >
                  {/* O SDR não registra o desfecho — quem esteve na call é que
                      sabe no que deu. Ele abre pra ver com quem cobrar. */}
                  {visaoSdr ? "Ver" : "Registrar"}
                </button>
              </li>
            ))}
          </ul>
          {pendentes.length > 6 && (
            <p className="px-4 py-2 text-[11.5px] text-amber-800 bg-amber-100/60">
              e mais {pendentes.length - 6} — registre as de cima primeiro.
            </p>
          )}
        </section>
      )}

      {/* ── 2. Hoje ───────────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
          Hoje {hoje.length > 0 && <span className="text-gray-500">· {hoje.length} {hoje.length === 1 ? "reunião" : "reuniões"}</span>}
        </h2>

        {hoje.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-gray-600">Nenhuma reunião hoje.</p>
            <p className="text-xs text-gray-400 mt-1">
              {pendentes.length > 0
                ? "Bom momento para registrar os desfechos acima."
                : "Sua agenda de hoje está livre."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {hoje.map((m) => {
              const ini = new Date(m.scheduled_at);
              const fim = new Date(ini.getTime() + (m.duration_min ?? 30) * 60_000);
              const passou = fim.getTime() < Date.now();
              const agoraNela = !passou && ini.getTime() <= Date.now();
              const nContatos = contatos.get(m.lead_id) ?? 0;
              const sdrNome = m.lead?.owner_id ? sdrs.get(m.lead.owner_id) : null;

              return (
                <li
                  key={m.id}
                  className={`rounded-xl border bg-white overflow-hidden ${
                    agoraNela ? "border-[#0147FF] ring-2 ring-[#0147FF]/15" : "border-gray-200"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-stretch">
                    {/* Horário: a âncora visual da linha */}
                    <div className={`shrink-0 px-4 py-3 sm:w-32 sm:border-r border-gray-100 ${agoraNela ? "bg-[#0147FF]/5" : ""}`}>
                      <p className="text-lg font-bold text-gray-900 leading-none tabular-nums">{hhmm(ini)}</p>
                      <p className="text-[11px] text-gray-400 mt-1 tabular-nums">até {hhmm(fim)}</p>
                      {agoraNela && <p className="text-[10px] font-bold text-[#0147FF] mt-1.5 uppercase">agora</p>}
                      {passou && <p className="text-[10px] font-semibold text-gray-400 mt-1.5 uppercase">já passou</p>}
                    </div>

                    {/* Quem é e o que se sabe dele */}
                    <div className="min-w-0 flex-1 px-4 py-3">
                      <p className="text-[15px] font-bold text-gray-900 truncate">
                        {m.lead?.full_name ?? m.lead_name ?? "Lead"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-gray-500">
                        {m.lead?.segment && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{m.lead.segment}</span>}
                        {sdrNome && <span>SDR: <b className="text-gray-700 font-semibold">{primeiroNome(sdrNome)}</b></span>}
                        {nContatos > 0 && <span>{nContatos} contato{nContatos > 1 ? "s" : ""} antes</span>}
                        {gestor && m.meeting_owner && <span>· {m.meeting_owner}</span>}
                      </div>
                      {m.notes && (
                        <p className="mt-1.5 text-[12px] text-gray-600 line-clamp-2 whitespace-pre-wrap">{m.notes}</p>
                      )}

                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {m.meeting_link ? (
                          <a
                            href={m.meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-[#0147FF] text-white text-xs font-bold hover:bg-[#0139D6]"
                          >
                            Entrar no Meet
                          </a>
                        ) : (
                          <span className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-400 text-xs font-semibold">
                            Sem link
                          </span>
                        )}
                        <button
                          onClick={() => onOpenLead(m.lead_id)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                        >
                          Ver histórico
                        </button>
                        <button
                          onClick={() => setDetalhe(m)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                        >
                          {passou ? "Registrar desfecho" : "Detalhes"}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 3. O que vem pela frente ──────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Próximos 7 dias</h2>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {semana.every((d) => d.reunioes.length === 0) ? (
            <p className="px-5 py-6 text-center text-sm text-gray-400">Nada agendado para os próximos 7 dias.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {semana.filter((d) => d.reunioes.length > 0).map(({ dia, reunioes }) => (
                <li key={dia.toISOString()} className="flex gap-3 px-4 py-3">
                  <div className="shrink-0 w-14 text-center">
                    <p className="text-[10px] font-bold uppercase text-gray-400">{WEEKDAY_SHORT[dia.getDay()]}</p>
                    <p className="text-lg font-bold text-gray-800 leading-none tabular-nums">{dia.getDate()}</p>
                  </div>
                  <ul className="min-w-0 flex-1 space-y-1">
                    {reunioes.map((m) => (
                      <li key={m.id}>
                        <button
                          onClick={() => setDetalhe(m)}
                          className="w-full text-left flex items-baseline gap-2 rounded px-1.5 py-1 hover:bg-gray-50"
                        >
                          <span className="text-[12px] font-bold text-gray-700 tabular-nums shrink-0">{hhmm(new Date(m.scheduled_at))}</span>
                          <span className="text-[12.5px] text-gray-600 truncate">{m.lead?.full_name ?? m.lead_name ?? "Lead"}</span>
                          {gestor && m.meeting_owner && (
                            <span className="text-[11px] text-gray-400 shrink-0">· {m.meeting_owner}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

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

      {/* Agendamento novo. Sem `reschedule`, o modal abre no modo de criar —
          com escolha de lead, produto, resumo, e-mail e sala do Meet. */}
      <ScheduleMeetingModal
        open={agendando}
        onClose={() => setAgendando(false)}
        onSaved={() => { setAgendando(false); void carregar(); }}
      />
    </div>
  );
}
