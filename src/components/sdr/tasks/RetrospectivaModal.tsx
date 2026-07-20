// src/components/sdr/tasks/RetrospectivaModal.tsx
// -----------------------------------------------------------------------------
// RETROSPECTIVA do dia — modal de boas-vindas que aparece 1x por dia quando o SDR
// entra no QS (pedido do Bruno; substitui a antiga aba "Meu Dia"). Três blocos:
//   A) o que rolou ONTEM (leads atendidos, atividades feitas, pendências que
//      sobraram) + uma dica de conversão conversa→reunião;
//   B) o que tem HOJE (carga de atividades + quantas estão atrasadas);
//   C) análise de ASSERTIVIDADE por regras/heurísticas (sem IA) — compara a carga
//      de hoje com a média dos últimos 7 dias e devolve 1–3 dicas acionáveis.
//
// Tudo é do PRÓPRIO SDR (owner_id = currentUser.id). É dispensável: some ao fechar
// e só reaparece no dia seguinte. "Visto" é por USUÁRIO + DIA (localStorage), no
// espírito do "por máquina/dia" do TelefoneOnboarding. Se alguma busca falhar, o
// modal abre mesmo assim com o que deu pra carregar (console.warn, sem quebrar).
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { loadWorkHours, workdaysInRange } from "@/lib/workHours";

const BLUE = "#0147FF";
const GREEN = "#0E7C6A";
const RED = "#DC2626";

// Mesma definição de "conexão" do resto do app (TasksPanel/FupAnalyticsPanel):
// cobre os legados ("atendeu"/"ganho") e as classificações novas de conversa.
const CONNECTED = new Set(["atendeu", "ganho", "com_avanco", "sem_avanco"]);

interface Props {
  user: { id: string; name: string } | null;
}

// "Visto" é por usuário + DIA local (não sessão): reabre no dia seguinte.
function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function seenKey(userId: string): string {
  return `qs_retro_seen_${userId}_${localDateKey()}`;
}

// Fronteiras de dia SEMPRE no fuso LOCAL do navegador (como o resto do app).
function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday(): Date { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
function startOfYesterday(): Date { const d = startOfToday(); d.setDate(d.getDate() - 1); return d; }
function endOfYesterday(): Date { const d = endOfToday(); d.setDate(d.getDate() - 1); return d; }
// Início da janela dos últimos 7 dias FECHADOS (não inclui hoje, pra não diluir a
// média com o trabalho ainda em andamento).
function start7DaysAgo(): Date { const d = startOfToday(); d.setDate(d.getDate() - 7); return d; }

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

interface RetroData {
  // Bloco A — ontem
  leadsAtendidosOntem: number;   // leads DISTINTOS com conexão ontem
  atividadesConcluidasOntem: number;
  pendenciasSobraram: number;    // abertas que venceram antes de hoje (= atrasadas)
  reunioesOntem: number;         // reuniões criadas por ele ontem
  agendaDica: string;
  // Bloco B — hoje
  hojeTotal: number;             // abertas com scheduled_at <= fim de hoje
  hojeAtrasadas: number;         // subset que venceu antes de hoje
  // Bloco C — assertividade
  mediaDia: number;              // média de concluídas/dia nos últimos 7 dias
  tips: string[];
}

// Extração defensiva dos resultados do allSettled: erro/rejeição vira vazio/0 e
// só loga — nunca derruba o modal (uma busca falha, as outras aparecem).
function rowsOf<T = any>(r: PromiseSettledResult<any>): T[] {
  if (r.status !== "fulfilled") { console.warn("[retro] busca rejeitada:", r.reason); return []; }
  if (r.value?.error) { console.warn("[retro] busca falhou:", r.value.error?.message); return []; }
  return (r.value?.data ?? []) as T[];
}
function countOf(r: PromiseSettledResult<any>): number {
  if (r.status !== "fulfilled") { console.warn("[retro] contagem rejeitada:", r.reason); return 0; }
  if (r.value?.error) { console.warn("[retro] contagem falhou:", r.value.error?.message); return 0; }
  return (r.value?.count ?? 0) as number;
}

async function loadRetro(uid: string): Promise<RetroData> {
  const yStart = startOfYesterday();
  const yEnd = endOfYesterday();
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const sevenStart = start7DaysAgo();
  // Horário de Trabalho: a média/dia divide pelos DIAS ÚTEIS da janela (não pelos
  // 7 corridos) — senão o fim de semana parado dilui a média e ela mente pra baixo.
  const wh = await loadWorkHours();

  // Todas em paralelo; allSettled pra que uma falha não zere o resto.
  const [rY, rM, rOpen, rLeads, rDone7] = await Promise.allSettled([
    // Atividades concluídas ONTEM (deriva "atendidos" + "concluídas").
    supabase.from("qs_tasks")
      .select("lead_id, contact_result")
      .eq("owner_id", uid).eq("status", "concluida")
      .gte("completed_at", yStart.toISOString()).lte("completed_at", yEnd.toISOString()),
    // Reuniões que ELE agendou ontem (created_at ontem).
    supabase.from("qs_meetings")
      .select("id")
      .eq("owner_id", uid)
      .gte("created_at", yStart.toISOString()).lte("created_at", yEnd.toISOString()),
    // Abertas até o fim de hoje (carga de hoje + pendências que sobraram).
    supabase.from("qs_tasks")
      .select("id, lead_id, priority, scheduled_at")
      .eq("owner_id", uid).in("status", ["pendente", "atrasada"])
      .lte("scheduled_at", todayEnd.toISOString()),
    // Status dos leads: lead já fechado (ganho/perdido) sai da carga — mesma regra
    // do "A fazer" do antigo Meu Dia (tarefa residual não é trabalho pendente).
    supabase.from("qs_leads").select("id, status"),
    // Concluídas nos últimos 7 dias FECHADOS (base da média/dia).
    supabase.from("qs_tasks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", uid).eq("status", "concluida")
      .gte("completed_at", sevenStart.toISOString()).lt("completed_at", todayStart.toISOString()),
  ]);

  // ── Bloco A — ontem ────────────────────────────────────────────────────────
  const yTasks = rowsOf<{ lead_id: string; contact_result: string | null }>(rY);
  const atividadesConcluidasOntem = yTasks.length;
  const connectedLeads = new Set(
    yTasks.filter((t) => t.contact_result && CONNECTED.has(t.contact_result)).map((t) => t.lead_id)
  );
  const leadsAtendidosOntem = connectedLeads.size;
  const reunioesOntem = rowsOf(rM).length;

  // ── Leads fechados (exclusão da carga) ──────────────────────────────────────
  const leadRows = rowsOf<{ id: string; status: string | null }>(rLeads);
  const closedLeadIds = new Set(
    leadRows.filter((l) => l.status === "ganho" || l.status === "perdido").map((l) => l.id)
  );

  // ── Bloco B — hoje (e pendências que sobraram) ──────────────────────────────
  const openTasks = rowsOf<{ id: string; lead_id: string; priority: string; scheduled_at: string }>(rOpen)
    .filter((t) => !closedLeadIds.has(t.lead_id));
  const todayStartMs = todayStart.getTime();
  const hojeTotal = openTasks.length;
  const hojeAtrasadas = openTasks.filter((t) => new Date(t.scheduled_at).getTime() < todayStartMs).length;
  const altaHoje = openTasks.filter((t) => t.priority === "alta").length;
  // "Pendências que sobraram" de ontem = as atrasadas (venceram antes de hoje).
  const pendenciasSobraram = hojeAtrasadas;

  // ── Bloco C — média/dia e assertividade ─────────────────────────────────────
  const done7 = countOf(rDone7);
  // Denominador = dias ÚTEIS na janela [today-7, ontem] (não os 7 corridos): o
  // fim de semana/folga não entra na conta e a média reflete o ritmo real de trabalho.
  const workdays7 = Math.max(1, workdaysInRange(wh, sevenStart, yStart));
  const mediaDia = done7 / workdays7;

  // Dica de conversão conversa→reunião (regras defensivas — dados podem ser esparsos).
  let agendaDica: string;
  if (leadsAtendidosOntem === 0 && reunioesOntem === 0) {
    agendaDica = "Ontem não houve conexões nem reuniões registradas. Hoje é dia de puxar conversa e, no primeiro avanço, já propor um horário.";
  } else if (leadsAtendidosOntem === 0 && reunioesOntem > 0) {
    // Agendou sem conexão registrada (dado esparso) — não repreende, elogia.
    agendaDica = `Você agendou ${reunioesOntem} reunião(ões) ontem. 👏 Siga transformando conversa em agenda.`;
  } else if (reunioesOntem === 0) {
    agendaDica = `Você conversou com ${leadsAtendidosOntem} lead(s) ontem e não agendou nenhuma reunião — no próximo avanço, já proponha um horário fechado.`;
  } else if (reunioesOntem >= leadsAtendidosOntem) {
    agendaDica = `Mandou bem: ${leadsAtendidosOntem} conversa(s) e ${reunioesOntem} reunião(ões) agendada(s) ontem. Mantenha esse ritmo de fechar agenda.`;
  } else {
    agendaDica = `Você conversou com ${leadsAtendidosOntem} lead(s) ontem e agendou ${reunioesOntem} reunião(ões) — no próximo avanço, já ofereça um horário pra converter mais conversa em reunião.`;
  }

  // Dicas de assertividade — TODAS derivadas dos números acima, nada inventado.
  const tips: string[] = [];
  const avgLabel = mediaDia < 1 ? mediaDia.toFixed(1).replace(".", ",") : String(Math.round(mediaDia));
  // 1) Atrasadas primeiro — é o que mais dói de acumular.
  if (hojeAtrasadas > 0) {
    tips.push(`Você tem ${hojeAtrasadas} atividade(s) atrasada(s) — limpe essas primeiro pra não virar bola de neve.`);
  }
  // 2) Carga de hoje vs. a sua média dos últimos 7 dias.
  if (mediaDia > 0) {
    if (hojeTotal > mediaDia * 1.3) {
      tips.push(`Dia puxado: ${hojeTotal} atividades vs. sua média de ~${avgLabel}/dia. Comece pelas de prioridade ALTA (manhã) e pelas atrasadas.`);
    } else if (hojeTotal <= mediaDia) {
      tips.push(`Fila sob controle: ${hojeTotal} pra hoje, dentro da sua média de ~${avgLabel}/dia. Aproveite pra caprichar nos avanços e já pedir reuniões.`);
    } else {
      tips.push(`Ritmo normal: ${hojeTotal} atividades pra hoje, perto da sua média de ~${avgLabel}/dia. Foque nas de prioridade alta.`);
    }
  } else {
    // Sem histórico dos últimos 7 dias (SDR novo / semana parada): nada de número inventado.
    tips.push(`Você tem ${hojeTotal} atividade(s) pra hoje. Comece pelas de prioridade ALTA e vá descendo.`);
  }
  // 3) Foco em prioridade alta quando a carga aperta acima da média.
  if (tips.length < 3 && altaHoje > 0 && mediaDia > 0 && hojeTotal > mediaDia) {
    tips.push(`${altaHoje} das de hoje são de prioridade ALTA — reserve a manhã pra elas antes que virem atrasadas.`);
  }

  return {
    leadsAtendidosOntem,
    atividadesConcluidasOntem,
    pendenciasSobraram,
    reunioesOntem,
    agendaDica,
    hojeTotal,
    hojeAtrasadas,
    mediaDia,
    tips,
  };
}

export default function RetrospectivaModal({ user }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RetroData | null>(null);
  // Depende do ID (string estável), não do objeto `user` — o SdrLayout recria
  // esse objeto a cada render (mesma pegadinha do TelefoneOnboarding).
  const userId = user?.id ?? null;
  const ranFor = useRef<string | null>(null); // evita recarregar/reabrir no mesmo user

  useEffect(() => {
    if (!userId) return;
    if (ranFor.current === userId) return;
    ranFor.current = userId;
    // Já viu a retrospectiva HOJE? Não incomoda de novo.
    if (localStorage.getItem(seenKey(userId)) === "1") return;
    let alive = true;
    loadRetro(userId)
      .then((d) => { if (alive) { setData(d); setOpen(true); } })
      .catch((e) => {
        // Falha geral inesperada: ainda assim mostra o modal (com zeros) em vez de sumir.
        console.warn("[retro] carga falhou por completo:", e?.message);
        if (alive) { setData(null); setOpen(true); }
      });
    return () => { alive = false; };
  }, [userId]);

  if (!open || !user) return null;

  const firstName = user.name.split(" ")[0];

  function close() {
    if (userId) localStorage.setItem(seenKey(userId), "1");
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Cabeçalho */}
        <div className="px-6 pt-6 pb-5 shrink-0 relative" style={{ background: "linear-gradient(135deg,#0147FF,#3B82F6)" }}>
          <button
            onClick={close}
            aria-label="Fechar"
            className="absolute top-4 right-4 flex items-center justify-center w-8 h-8 rounded-lg text-white/80 hover:bg-white/15 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <div className="text-white">
            <h2 className="text-xl font-bold leading-tight">{greeting()}, {firstName} 👋</h2>
            <p className="text-[13px] text-white/85 mt-0.5">Sua retrospectiva do dia — onde você parou e o que vem agora.</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {/* ── BLOCO A — ONTEM ─────────────────────────────────────────────── */}
          <section>
            <SectionTitle icon={<IconHistory />} label="Ontem" />
            <div className="grid grid-cols-3 gap-3">
              <StatTile value={data?.leadsAtendidosOntem ?? 0} label="Leads atendidos" color={BLUE} />
              <StatTile value={data?.atividadesConcluidasOntem ?? 0} label="Atividades feitas" color={GREEN} />
              <StatTile value={data?.pendenciasSobraram ?? 0} label="Ficou pra trás" color={(data?.pendenciasSobraram ?? 0) > 0 ? RED : "#6B7280"} />
            </div>
            {data && (
              <Callout tone="blue">{data.agendaDica}</Callout>
            )}
          </section>

          {/* ── BLOCO B — HOJE ──────────────────────────────────────────────── */}
          <section>
            <SectionTitle icon={<IconSun />} label="Hoje" />
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 flex items-center gap-4">
              <div className="shrink-0 text-center">
                <div className="text-4xl font-extrabold tabular-nums leading-none" style={{ color: BLUE }}>{data?.hojeTotal ?? 0}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mt-1">atividades</div>
              </div>
              <div className="min-w-0 text-[13px] text-gray-600">
                {(data?.hojeAtrasadas ?? 0) > 0 ? (
                  <p>
                    <b style={{ color: RED }}>{data?.hojeAtrasadas}</b> {(data?.hojeAtrasadas ?? 0) === 1 ? "está atrasada" : "estão atrasadas"} (venceram antes de hoje). O resto é do dia — mantenha o ritmo.
                  </p>
                ) : (data?.hojeTotal ?? 0) > 0 ? (
                  <p>Nenhuma atrasada — comece pelas de prioridade alta e vá em frente. 💪</p>
                ) : (
                  <p>Nada agendado até o fim de hoje. Bom momento pra cobrir leads novos.</p>
                )}
              </div>
            </div>
          </section>

          {/* ── BLOCO C — ASSERTIVIDADE ─────────────────────────────────────── */}
          <section>
            <SectionTitle icon={<IconTarget />} label="Como atacar o dia" />
            <ul className="space-y-2">
              {(data?.tips ?? ["Bora pra cima — comece pelas atividades de prioridade alta."]).map((tip, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] text-gray-700 rounded-xl border border-gray-100 bg-white p-3">
                  <span className="shrink-0 mt-0.5" style={{ color: BLUE }}><IconArrow /></span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end shrink-0">
          <button onClick={close} className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90" style={{ background: BLUE }}>
            Bora começar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Peças visuais ────────────────────────────────────────────────────────────

function SectionTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-gray-400">{icon}</span>
      <h3 className="text-[13px] font-bold uppercase tracking-wider text-gray-500">{label}</h3>
    </div>
  );
}

function StatTile({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
      <div className="text-3xl font-extrabold tabular-nums leading-none" style={{ color }}>{value}</div>
      <div className="text-[11px] font-medium text-gray-500 mt-1.5 leading-tight">{label}</div>
    </div>
  );
}

function Callout({ tone, children }: { tone: "blue"; children: ReactNode }) {
  const bg = tone === "blue" ? "#EEF4FF" : "#F3F4F6";
  return (
    <div className="mt-3 rounded-xl p-3 text-[13px] text-gray-700 flex gap-2.5" style={{ background: bg }}>
      <span className="shrink-0 mt-0.5" style={{ color: BLUE }}><IconBulb /></span>
      <span>{children}</span>
    </div>
  );
}

// ── Ícones (inline SVG, sem libs) ────────────────────────────────────────────

function IconHistory() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
    </svg>
  );
}
function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function IconBulb() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
    </svg>
  );
}
