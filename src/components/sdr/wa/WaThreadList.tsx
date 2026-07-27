// src/components/sdr/wa/WaThreadList.tsx
// -----------------------------------------------------------------------------
// "Minhas conversas": a lista de WhatsApp do SDR logado.
//
// Não existe filtro por usuário nesta tela — e é de propósito. O recorte vem da
// RLS (migration 0024): o Supabase só devolve as conversas dos leads dele. Se um
// dia alguém abrir o DevTools e refizer a query, continua vendo só as suas.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listMyThreads, shortWhen, subscribeToThreads, threadTitle, type WaThread,
} from "@/lib/qs/waInbox";
import { formatPhoneDisplay } from "@/lib/whatsapp";

interface Props {
  selectedLeadId?: string | null;
  onPick: (t: WaThread) => void;
}

export default function WaThreadList({ selectedLeadId, onPick }: Props) {
  const [threads, setThreads] = useState<WaThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    const list = await listMyThreads();
    setThreads(list);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => subscribeToThreads(carregar), [carregar]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return threads;
    const soDigitos = q.replace(/\D/g, "");
    return threads.filter((t) => {
      const nome = threadTitle(t).toLowerCase();
      const fone = (t.lead?.phone || "").replace(/\D/g, "");
      return nome.includes(q) || (soDigitos.length >= 3 && fone.includes(soDigitos));
    });
  }, [threads, busca]);

  const totalNaoLidas = useMemo(
    () => threads.reduce((s, t) => s + (t.unread || 0), 0),
    [threads]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Busca */}
      <div className="shrink-0 p-2 border-b" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          className="w-full rounded-full px-3 py-1.5 text-[12.5px] outline-none"
          style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }}
        />
        {totalNaoLidas > 0 && (
          <p className="text-[10.5px] font-bold mt-1.5 px-1" style={{ color: "#0E7C6A" }}>
            {totalNaoLidas} {totalNaoLidas === 1 ? "mensagem não lida" : "mensagens não lidas"}
          </p>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: "var(--bg)" }}>
        {loading ? (
          <p className="text-center text-[12px] py-6" style={{ color: "var(--ink3)" }}>carregando…</p>
        ) : filtradas.length === 0 ? (
          <div className="text-center py-10 px-5">
            <p className="text-[12.5px] font-bold" style={{ color: "var(--ink2)" }}>
              {busca ? "Nada encontrado" : "Nenhuma conversa ainda"}
            </p>
            <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>
              {busca
                ? "Tente outro nome ou número."
                : "As conversas dos seus leads aparecem aqui assim que alguém escrever — ou quando você abrir o WhatsApp de um lead."}
            </p>
          </div>
        ) : (
          filtradas.map((t) => {
            const ativa = t.lead_id === selectedLeadId;
            const naoLidas = t.unread || 0;
            return (
              <button
                key={t.lead_id}
                onClick={() => onPick(t)}
                className="w-full text-left px-3 py-2.5 border-b transition-colors"
                style={{
                  borderColor: "var(--line2)",
                  background: ativa ? "var(--accent-soft)" : "var(--card)",
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 truncate text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                    {threadTitle(t)}
                  </span>
                  <span className="shrink-0 text-[10.5px]" style={{ color: "var(--ink3)" }}>
                    {shortWhen(t.last_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex-1 min-w-0 truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>
                    {t.last_direction === "out" && <span style={{ color: "var(--ink3)" }}>você: </span>}
                    {t.last_message || formatPhoneDisplay(t.lead?.phone) || "—"}
                  </span>
                  {naoLidas > 0 && (
                    <span
                      className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold grid place-items-center"
                      style={{ background: "#12A18A" }}
                    >
                      {naoLidas > 99 ? "99+" : naoLidas}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
