// src/rel/viagens/DonoViagem.tsx
// -----------------------------------------------------------------------------
// QUEM CUIDA DA VIAGEM (0184, 22/10/2026). Sem dono, ninguém sente que a
// viagem é sua — e as 38 que embarcavam em 120 dias estavam todas sem dono.
//
//   sem dono → botão "Assumir" (fica comigo) + "Atribuir a…"
//   com dono → o nome; "Atribuir a…" troca (fica no histórico da viagem)
//
// Uma viagem por vez qualquer um do time pode; em lote é só a gestão
// (ver BarraLote na lista e nas Atividades).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { atribuirViagens, eventosDaViagem, type EventoViagem } from "../lib/operacao";
import { SERVICOS, type Servico } from "../lib/viagens";

export default function DonoViagem({ viagemId, responsavelId, equipe, onMudou, compacto = false }: {
  viagemId: string; responsavelId: string | null; equipe: { id: string; name: string }[]; onMudou: () => void; compacto?: boolean;
}) {
  const { currentUser } = useQsAuth();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nome = responsavelId ? equipe.find((u) => u.id === responsavelId)?.name ?? "alguém do time" : null;
  const souEu = !!responsavelId && responsavelId === currentUser?.id;

  async function mudar(id: string | null) {
    setOcupado(true); setErro(null);
    try { await atribuirViagens([viagemId], id); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {nome ? (
        <span className="text-[13px] font-semibold" style={{ color: souEu ? "var(--rel-ink)" : "var(--ink)" }}>{souEu ? (compacto ? "eu" : `${nome} (você)`) : compacto ? nome.split(" ")[0] : nome}</span>
      ) : (
        <>
          <span className="text-[11.5px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(220,38,38,.1)", color: "#DC2626" }}>sem dono</span>
          <button type="button" disabled={ocupado || !currentUser?.id} onClick={() => void mudar(currentUser!.id)}
            className="text-[12.5px] font-bold px-2.5 py-1 rounded-md disabled:opacity-50" style={{ background: "var(--rel)", color: "#fff" }}>
            Assumir
          </button>
        </>
      )}
      <select className="rel-input" aria-label="Atribuir a" disabled={ocupado} value=""
        style={{ width: "auto", padding: "3px 6px", fontSize: 12, maxWidth: compacto ? 120 : 180 }}
        onChange={(e) => { const v = e.target.value; if (v) void mudar(v === "-" ? null : v); }}>
        <option value="">{nome ? "trocar…" : "atribuir a…"}</option>
        {equipe.filter((u) => u.id !== responsavelId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        {responsavelId && <option value="-">(tirar o dono)</option>}
      </select>
      {erro && <span className="text-[11.5px]" style={{ color: "#DC2626" }}>{erro}</span>}
    </span>
  );
}

// ── Histórico (rel_viagem_eventos) ──────────────────────────────────────────

const ROTULO_EVENTO = { dono: "Responsável", servico: "Serviço", arquivada: "Arquivada", desarquivada: "Desarquivada" } as const;

/** O que o time decidiu na viagem: troca de dono, serviço, arquivamento. */
export function HistoricoViagem({ viagemId, equipe, versao = 0 }: { viagemId: string; equipe: { id: string; name: string }[]; versao?: number }) {
  const [ev, setEv] = useState<EventoViagem[] | null>(null);
  useEffect(() => { eventosDaViagem(viagemId).then(setEv).catch(() => setEv([])); }, [viagemId, versao]);
  if (!ev || !ev.length) return null;
  const nome = (id: string | null) => (id ? equipe.find((u) => u.id === id)?.name ?? "alguém" : "ninguém");
  const valor = (e: EventoViagem, x: string | null) => (e.tipo === "dono" ? nome(x) : e.tipo === "servico" ? (x ? SERVICOS[x as Servico] ?? x : "o do Bitrix") : x ?? "—");
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>Histórico ({ev.length})</summary>
      <ul className="mt-1 space-y-0.5 text-[12px]" style={{ color: "var(--ink2)" }}>
        {ev.map((e) => (
          <li key={e.id}>
            <span className="tabular-nums" style={{ color: "var(--ink3)" }}>{new Date(e.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>{" "}
            <b>{ROTULO_EVENTO[e.tipo]}</b>{e.tipo === "dono" || e.tipo === "servico" ? <>: {valor(e, e.de)} → {valor(e, e.para)}</> : null}
            {e.motivo ? <> · “{e.motivo}”</> : null}{e.por ? <> · por {nome(e.por)}</> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
