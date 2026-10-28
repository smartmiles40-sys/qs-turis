// src/controle-comercial/ReunioesDoCliente.tsx
// -----------------------------------------------------------------------------
// A REUNIÃO DO GOOGLE MEET DENTRO DO CARD DO CLIENTE (Bruno, 28/10/2026).
//
//   • <ReunioesDoCliente leadId> — no cartão do closer (NegocioPainel): cada
//     reunião com o link do Meet, data, quem participou, desfecho, notas do SDR
//     e a gravação.
//   • <DetalheDaReuniao m> — o pedaço "participantes / desfecho / gravação",
//     reaproveitado no cartão de cada reunião da ficha do lead (LeadDetailPage).
//
// "Quem participou" = os convidados que o QS conhece: o SDR que marcou
// (scheduled_by), o closer (meeting_owner/closer_id) e o e-mail do cliente.
// Presença real na chamada só viria do Google (ver 0215, comentário da
// gravação). A gravação é um link colado à mão (qs_reuniao_gravacao, 0215).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SemMigration, dataHoraCurta, salvarGravacao } from "./mesa";
import { estiloEntrada } from "./pecas";

/** Campos de qs_meetings que esta peça lê (todos opcionais além de id). */
export interface ReuniaoDoCliente {
  id: string;
  scheduled_at: string;
  duration_min?: number | null;
  status: string;
  title?: string | null;
  meeting_link?: string | null;
  calendar_html_link?: string | null;
  notes?: string | null;
  scheduled_by?: string | null;
  meeting_owner?: string | null;
  client_email?: string | null;
  realizada_em?: string | null;
  sal?: string | null;
  sal_motivo?: string | null;
  desistencia_motivo?: string | null;
  venda_valor?: number | null;
  venda_tipo?: string | null;
  gravacao_url?: string | null;
}

const STATUS: Record<string, string> = {
  agendada: "Agendada", confirmada: "Confirmada", realizada: "Realizada", no_show: "Cliente não apareceu (no-show)",
  reagendada: "Reagendada", cancelada: "Cancelada", arquivada: "Arquivada", desistencia: "Desistência",
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const tx = { forte: "var(--text)", medio: "var(--muted)", fraco: "var(--subtle)" };

export default function ReunioesDoCliente({ leadId }: { leadId: string }) {
  const [lista, setLista] = useState<ReuniaoDoCliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    // "*" de propósito: traz gravacao_url quando a 0215 estiver aplicada e não quebra antes dela.
    const { data, error } = await supabase.from("qs_meetings").select("*").eq("lead_id", leadId)
      .order("scheduled_at", { ascending: false }).limit(10);
    if (error) { setErro(error.message); return; }
    setLista((data ?? []) as ReuniaoDoCliente[]);
  }, [leadId]);
  useEffect(() => { void carregar(); }, [carregar]);

  if (erro) return <p style={{ fontSize: 13, color: "var(--danger)" }}>Não carregou as reuniões: {erro}</p>;
  if (!lista) return <p style={{ fontSize: 13, color: tx.fraco }}>Carregando…</p>;
  if (!lista.length) return <p style={{ fontSize: 13, color: tx.fraco }}>Sem reuniões.</p>;

  const futura = (m: ReuniaoDoCliente) => (m.status === "agendada" || m.status === "confirmada");
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {lista.map((m) => (
        <li key={m.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <b className="qs-num" style={{ fontSize: 13.5, color: tx.forte }}>{dataHoraCurta(m.scheduled_at)}{m.duration_min ? ` · ${m.duration_min} min` : ""}</b>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: tx.medio, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title || "Reunião"}</span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "var(--surface-2)", color: tx.forte }}>{STATUS[m.status] ?? m.status}</span>
            {m.meeting_link && futura(m) && (
              <a href={m.meeting_link} target="_blank" rel="noopener noreferrer" className="qs-btn qs-btn--sm qs-btn--primary">Entrar no Meet</a>
            )}
          </div>
          {m.meeting_link && (
            <a href={m.meeting_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: "var(--info)", wordBreak: "break-all" }}>{m.meeting_link}</a>
          )}
          {m.notes && (
            <div style={{ fontSize: 12.5, color: tx.medio }}>
              <span style={{ fontWeight: 600, color: tx.fraco }}>Notas do SDR: </span>
              <span style={{ whiteSpace: "pre-wrap" }}>{m.notes}</span>
            </div>
          )}
          <DetalheDaReuniao m={m} onMudou={() => void carregar()} />
        </li>
      ))}
    </ul>
  );
}

/** Participantes, desfecho e gravação de UMA reunião. */
export function DetalheDaReuniao({ m, onMudou }: { m: ReuniaoDoCliente; onMudou?: () => void }) {
  const participantes = [
    m.scheduled_by ? `marcada por ${m.scheduled_by.trim()}` : null,
    m.meeting_owner ? `closer ${m.meeting_owner.trim()}` : null,
    m.client_email ? `cliente ${m.client_email}` : null,
  ].filter(Boolean);
  const desfecho = [
    m.realizada_em ? `realizada em ${dataHoraCurta(m.realizada_em)}` : null,
    m.sal === "aceito" ? "lead aceito pelo closer (SAL)" : m.sal === "recusado" ? `lead recusado${m.sal_motivo ? `: ${m.sal_motivo}` : ""}` : null,
    m.desistencia_motivo ? `desistência: ${m.desistencia_motivo}` : null,
    m.venda_valor ? `venda ${brl(Number(m.venda_valor))}${m.venda_tipo ? ` (${m.venda_tipo})` : ""}` : null,
  ].filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: tx.medio }}>
      {participantes.length > 0 && <span><span style={{ fontWeight: 600, color: tx.fraco }}>Convidados: </span>{participantes.join(" · ")}</span>}
      {desfecho.length > 0 && <span><span style={{ fontWeight: 600, color: tx.fraco }}>Desfecho: </span>{desfecho.join(" · ")}</span>}
      {m.calendar_html_link && (
        <a href={m.calendar_html_link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", width: "fit-content" }}>Abrir no Google Agenda</a>
      )}
      <Gravacao m={m} onMudou={onMudou} />
    </div>
  );
}

function Gravacao({ m, onMudou }: { m: ReuniaoDoCliente; onMudou?: () => void }) {
  const [editando, setEditando] = useState(false);
  const [url, setUrl] = useState(m.gravacao_url ?? "");
  const [atual, setAtual] = useState(m.gravacao_url ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Antes da 0215 a coluna não vem no "*": não oferece o campo.
  if (!("gravacao_url" in m)) return null;
  // Gravação só faz sentido depois que a reunião aconteceu (ou foi marcada como tal).
  if (!atual && !["realizada", "no_show", "desistencia"].includes(m.status)) return null;

  async function salvar() {
    setOcupado(true); setMsg(null);
    try {
      await salvarGravacao(m.id, url);
      setAtual(url.trim()); setEditando(false); onMudou?.();
    } catch (e) {
      setMsg(e instanceof SemMigration ? "Falta aplicar a migration 0215." : e instanceof Error ? e.message : "não salvou");
    } finally { setOcupado(false); }
  }

  if (!editando) {
    return (
      <span style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, color: tx.fraco }}>Gravação:</span>
        {atual
          ? <a href={atual} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", wordBreak: "break-all" }}>abrir gravação</a>
          : <span style={{ color: tx.fraco }}>sem link</span>}
        <button type="button" onClick={() => { setUrl(atual); setEditando(true); }} style={{ fontSize: 12, textDecoration: "underline", color: tx.medio }}>
          {atual ? "trocar" : "colar link"}
        </button>
      </span>
    );
  }
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" aria-label="Link da gravação"
        style={{ ...estiloEntrada, flex: "1 1 220px", minHeight: 32, fontSize: 13 }} />
      <button type="button" className="qs-btn qs-btn--sm qs-btn--primary" disabled={ocupado} onClick={() => void salvar()}>Salvar</button>
      <button type="button" className="qs-btn qs-btn--sm qs-btn--ghost" onClick={() => setEditando(false)}>Cancelar</button>
      {msg && <span style={{ color: "var(--danger)", width: "100%" }}>{msg}</span>}
    </span>
  );
}
