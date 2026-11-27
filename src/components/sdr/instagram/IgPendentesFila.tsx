// src/components/sdr/instagram/IgPendentesFila.tsx
// -----------------------------------------------------------------------------
// Faixa na Fila de hoje (27/11): DMs do Instagram que chegaram e ninguém leu.
// A RLS (0430) já recorta: a SDR vê só as dos leads dela; o gestor vê o time,
// ou só a SDR escolhida no "Ver" (sdrId). Clicar abre a ficha do lead, onde
// fica o botão Instagram. Some sozinha quando não há nada.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Pendente {
  id: string; lead_id: string; username: string | null; nao_lidas: number; ultima_previa: string | null;
  ultima_entrada_em: string | null;
  qs_leads: { full_name: string | null; owner_id: string | null } | null;
}

export default function IgPendentesFila({ sdrId, onOpenLead }: { sdrId: string | null; onOpenLead: (leadId: string) => void }) {
  const [lista, setLista] = useState<Pendente[]>([]);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("mkt_ig_conversas" as never)
      .select("id,lead_id,username,nao_lidas,ultima_previa,ultima_entrada_em,qs_leads(full_name,owner_id)")
      .gt("nao_lidas", 0)
      .not("lead_id", "is", null)
      .order("ultima_entrada_em", { ascending: false })
      .limit(30);
    if (error) { console.warn("[ig] pendentes:", error.message); return; }
    setLista((data ?? []) as unknown as Pendente[]);
  }, []);

  useEffect(() => {
    void carregar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 60_000);
    return () => window.clearInterval(id);
  }, [carregar]);

  const visiveis = sdrId ? lista.filter((p) => p.qs_leads?.owner_id === sdrId) : lista;
  if (visiveis.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[13px]"
      style={{ background: "rgba(221,42,123,.08)", border: "1px solid rgba(221,42,123,.25)" }}>
      <span className="font-semibold" style={{ color: "#C13584" }}>
        Instagram: {visiveis.length} conversa{visiveis.length !== 1 ? "s" : ""} sem resposta
      </span>
      {visiveis.slice(0, 8).map((p) => (
        <button key={p.id} type="button" onClick={() => onOpenLead(p.lead_id)}
          className="rounded-lg px-2 py-1 text-[12.5px]"
          title={p.ultima_previa ?? undefined}
          style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}>
          {p.qs_leads?.full_name || (p.username ? `@${p.username}` : "Lead")}
          <b style={{ color: "#DD2A7B" }}> {p.nao_lidas}</b>
        </button>
      ))}
      {visiveis.length > 8 && <span style={{ color: "var(--ink3)" }}>+{visiveis.length - 8}</span>}
    </div>
  );
}
