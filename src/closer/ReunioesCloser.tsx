// src/closer/ReunioesCloser.tsx
// -----------------------------------------------------------------------------
// AGENDA DO CLOSER. Desde 03/11 (desenho do Bruno, agenda.html) é a mesma
// Agenda do Comercial — Agenda do dia, Reuniões do time (aqui: as que ele
// atende) e Mês —, mais as duas abas que só a área do closer tinha:
//
//   Meus desfechos . a casa do closer de sempre (MinhaAgendaPage): primeiro o
//                    que falta desfecho, depois hoje e o resto da semana.
//   Falta agendar .. cliente do pipeline antes da reunião (Aguardando reunião,
//                    Reagendamento, No-show) sem reunião marcada pela frente.
//
// A aba vai no endereço: #closer/agenda/<aba>. Os antigos (#closer/agenda,
// #closer/painel, #closer/reunioes/<aba>) caem na aba certa — ver abaDoCloser
// em src/lib/qs/agendaStatus.ts.
// -----------------------------------------------------------------------------
import { Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { lazyPagina } from "@/lib/qs/lazyPagina";
import { Aviso, Botao, Etiqueta, Vazio } from "@/rel/ui";
import ScheduleMeetingModal from "@/components/sdr/agenda/ScheduleMeetingModal";
import type { Lead } from "@/components/sdr/types";
import { ABAS_AGENDA_CLOSER, type AbaAgenda } from "@/lib/qs/agendaStatus";
import { NOME_ETAPA, dataBr, nomeDoLead, type Etapa, type Negocio } from "./lib";

const MinhaAgendaPage = lazyPagina(() => import("@/components/sdr/agenda/MinhaAgendaPage"));
const MeetingsPage = lazyPagina(() => import("@/components/sdr/meetings/MeetingsPage"));

const ANTES_DA_REUNIAO: Etapa[] = ["aguardando_reuniao", "reagendamento", "no_show"];

export default function ReunioesCloser({ aba, onAba, onOpenLead }: {
  aba: AbaAgenda;
  onAba: (a: AbaAgenda) => void;
  onOpenLead: (leadId: string) => void;
}) {
  const [faltam, setFaltam] = useState<number | null>(null);
  const carregando = <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <Suspense fallback={carregando}>
      <MeetingsPage
        onOpenLead={onOpenLead}
        aba={aba}
        onAba={onAba}
        extras={[
          { id: "desfechos", rotulo: ABAS_AGENDA_CLOSER[0].rotulo,
            conteudo: <Suspense fallback={carregando}><MinhaAgendaPage onOpenLead={onOpenLead} /></Suspense> },
          // Sempre montada (escondida fora da aba) pra contar o número da aba.
          { id: "falta-agendar", rotulo: ABAS_AGENDA_CLOSER[1].rotulo, badge: faltam, sempreMontada: true,
            conteudo: <FaltaAgendar onOpenLead={onOpenLead} onContou={setFaltam} /> },
        ]}
      />
    </Suspense>
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
