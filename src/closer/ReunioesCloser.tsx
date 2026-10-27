// src/closer/ReunioesCloser.tsx
// -----------------------------------------------------------------------------
// REUNIÕES DO CLOSER (Bruno, 26/10): "unificar atividades em reuniões". Uma
// tela só, em abas (ordem do Bruno), no lugar de Minha agenda + Atividades + Reuniões:
//
//   Todas ......... a lista completa de reuniões (MeetingsPage). Abre nela.
//   Agenda ........ a casa do closer de sempre (MinhaAgendaPage): primeiro o que
//                   falta desfecho, depois hoje e o resto da semana.
//   Falta agendar . cliente do pipeline antes da reunião (Aguardando reunião,
//                   Reagendamento, No-show) sem reunião marcada pela frente.
//   Atividades .... a fila de atividades (TasksPanel).
//
// A aba vai no endereço: #closer/reunioes/<aba>.
// -----------------------------------------------------------------------------
import { Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { lazyPagina } from "@/lib/qs/lazyPagina";
import { Aviso, Botao, Etiqueta, Vazio } from "@/rel/ui";
import ScheduleMeetingModal from "@/components/sdr/agenda/ScheduleMeetingModal";
import type { Lead } from "@/components/sdr/types";
import { NOME_ETAPA, dataBr, nomeDoLead, type Etapa, type Negocio } from "./lib";

const MinhaAgendaPage = lazyPagina(() => import("@/components/sdr/agenda/MinhaAgendaPage"));
const TasksPanel = lazyPagina(() => import("@/components/sdr/tasks/TasksPanel"));
const MeetingsPage = lazyPagina(() => import("@/components/sdr/meetings/MeetingsPage"));

export const ABAS_REUNIOES = [
  { id: "todas", rotulo: "Todas as reuniões" },
  { id: "agenda", rotulo: "Agenda e desfechos" },
  { id: "falta-agendar", rotulo: "Falta agendar" },
  { id: "atividades", rotulo: "Atividades" },
] as const;
export type AbaReunioes = (typeof ABAS_REUNIOES)[number]["id"];

const ANTES_DA_REUNIAO: Etapa[] = ["aguardando_reuniao", "reagendamento", "no_show"];

export default function ReunioesCloser({ aba, onAba, onOpenLead }: {
  aba: AbaReunioes;
  onAba: (a: AbaReunioes) => void;
  onOpenLead: (leadId: string) => void;
}) {
  const [faltam, setFaltam] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold flex-1" style={{ color: "var(--ink)" }}>Reuniões</h1>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--line)" }} role="tablist">
        {ABAS_REUNIOES.map((a) => {
          const on = a.id === aba;
          return (
            <button key={a.id} role="tab" aria-selected={on} onClick={() => onAba(a.id)}
              className="px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap -mb-px border-b-2"
              style={{ borderColor: on ? "var(--rel)" : "transparent", color: on ? "var(--rel-ink)" : "var(--ink2)" }}>
              {a.rotulo}
              {a.id === "falta-agendar" && !!faltam && (
                <span className="ml-1.5 inline-flex min-w-[18px] h-[18px] px-1 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>{faltam}</span>
              )}
            </button>
          );
        })}
      </div>
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>}>
        {aba === "agenda" && <MinhaAgendaPage onOpenLead={onOpenLead} />}
        {aba === "atividades" && <TasksPanel onOpenLead={onOpenLead} />}
        {aba === "todas" && <MeetingsPage onOpenLead={onOpenLead} />}
      </Suspense>
      {/* Sempre montada (escondida fora da aba) pra contar o número da aba. */}
      <div hidden={aba !== "falta-agendar"}>
        <FaltaAgendar onOpenLead={onOpenLead} onContou={setFaltam} />
      </div>
    </div>
  );
}

function FaltaAgendar({ onOpenLead, onContou }: { onOpenLead: (id: string) => void; onContou: (n: number) => void }) {
  const { currentUser } = useQsAuth();
  const ehCloser = currentUser?.role === "closer";
  const [lista, setLista] = useState<Negocio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [agendando, setAgendando] = useState<Lead | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    let q = supabase.from("qs_closer_negocios")
      .select("*, lead:qs_leads(id, full_name, first_name, last_name, phone, email, bitrix_id), closer:qs_users!qs_closer_negocios_closer_id_fkey(name)")
      .is("arquivado_em", null).in("etapa", ANTES_DA_REUNIAO)
      .order("etapa_em", { ascending: true }).limit(500);
    if (ehCloser && currentUser) q = q.eq("closer_id", currentUser.id);
    const { data, error } = await q;
    if (error) { setErro(error.message); setCarregando(false); return; }
    const cartoes = (data ?? []) as unknown as Negocio[];
    // Quem já tem reunião marcada daqui pra frente não entra.
    const leads = cartoes.map((n) => n.lead_id);
    const comReuniao = new Set<string>();
    for (let i = 0; i < leads.length; i += 200) {
      const { data: ms } = await supabase.from("qs_meetings").select("lead_id")
        .in("lead_id", leads.slice(i, i + 200)).in("status", ["agendada", "confirmada"])
        .gte("scheduled_at", new Date().toISOString());
      for (const m of ms ?? []) comReuniao.add((m as { lead_id: string }).lead_id);
    }
    const faltam = cartoes.filter((n) => !comReuniao.has(n.lead_id));
    setLista(faltam);
    onContou(faltam.length);
    setCarregando(false);
  }, [ehCloser, currentUser, onContou]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function agendar(leadId: string) {
    const { data, error } = await supabase.from("qs_leads").select("*").eq("id", leadId).maybeSingle();
    if (error || !data) { setErro(error?.message || "Lead não encontrado."); return; }
    setAgendando(data as Lead);
  }

  if (carregando) return <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <div className="space-y-3">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
        Clientes do pipeline que ainda precisam de reunião: a anterior foi cancelada, deu no-show ou ficou sem data. Agendar move o cartão sozinho.
      </p>
      {!lista.length ? (
        <Vazio titulo="Ninguém esperando reunião" texto="Todo cliente antes da reunião já tem horário marcado." />
      ) : (
        <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
          {lista.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <button className="text-[14px] font-semibold truncate hover:underline text-left" style={{ color: "var(--ink)" }} onClick={() => onOpenLead(n.lead_id)}>
                  {nomeDoLead(n.lead)}
                </button>
                <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                  {n.lead?.phone || "sem telefone"} · desde {dataBr(n.etapa_em)}{!ehCloser && n.closer?.name ? ` · ${n.closer.name}` : ""}
                </p>
              </div>
              <Etiqueta tom={n.etapa === "no_show" ? "erro" : "aviso"}>{NOME_ETAPA[n.etapa]}</Etiqueta>
              <Botao variante="primario" onClick={() => void agendar(n.lead_id)}>Agendar</Botao>
            </li>
          ))}
        </ul>
      )}
      <ScheduleMeetingModal open={!!agendando} lead={agendando} onClose={() => setAgendando(null)}
        onSaved={() => { setAgendando(null); void carregar(); }} />
    </div>
  );
}
