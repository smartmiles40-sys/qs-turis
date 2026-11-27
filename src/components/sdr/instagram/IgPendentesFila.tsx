// src/components/sdr/instagram/IgPendentesFila.tsx
// -----------------------------------------------------------------------------
// Faixa na Fila de hoje (27/11): DMs do Instagram que chegaram e ninguém leu.
// A RLS (0430/0431) já recorta: a SDR vê as do Instagram DELA (e dos leads
// dela); o gestor vê o time, ou só a SDR escolhida no "Ver" (sdrId).
// Lead conhecido → abre a ficha (botão Instagram). Contato novo (o @ não bate
// com nenhum lead) → abre a conversa direto. Some sozinha quando não há nada.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import InstagramDoLead from "./InstagramDoLead";

interface Pendente {
  id: string; lead_id: string | null; username: string | null; nome: string | null; nao_lidas: number;
  ultima_previa: string | null; ultima_entrada_em: string | null;
  qs_leads: { full_name: string | null; owner_id: string | null } | null;
  mkt_ig_contas: { dono_id: string | null } | null;
}

export default function IgPendentesFila({ sdrId, onOpenLead }: { sdrId: string | null; onOpenLead: (leadId: string) => void }) {
  const [lista, setLista] = useState<Pendente[]>([]);
  const [aberta, setAberta] = useState<Pendente | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("mkt_ig_conversas" as never)
      .select("id,lead_id,username,nome,nao_lidas,ultima_previa,ultima_entrada_em,qs_leads(full_name,owner_id),mkt_ig_contas(dono_id)")
      .gt("nao_lidas", 0)
      .order("ultima_entrada_em", { ascending: false })
      .limit(40);
    if (error) { console.warn("[ig] pendentes:", error.message); return; }
    // Contato novo da conta da AGÊNCIA é do Marketing, não entra na Fila.
    setLista(((data ?? []) as unknown as Pendente[]).filter((p) => p.lead_id || p.mkt_ig_contas?.dono_id));
  }, []);

  useEffect(() => {
    void carregar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 60_000);
    return () => window.clearInterval(id);
  }, [carregar]);

  const visiveis = sdrId
    ? lista.filter((p) => (p.qs_leads?.owner_id ?? p.mkt_ig_contas?.dono_id) === sdrId)
    : lista;

  return (
    <>
      {visiveis.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[13px]"
          style={{ background: "rgba(221,42,123,.08)", border: "1px solid rgba(221,42,123,.25)" }}>
          <span className="font-semibold" style={{ color: "#C13584" }}>
            Instagram: {visiveis.length} conversa{visiveis.length !== 1 ? "s" : ""} sem resposta
          </span>
          {visiveis.slice(0, 8).map((p) => (
            <button key={p.id} type="button" onClick={() => (p.lead_id ? onOpenLead(p.lead_id) : setAberta(p))}
              className="rounded-lg px-2 py-1 text-[12.5px]"
              title={p.ultima_previa ?? undefined}
              style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}>
              {p.qs_leads?.full_name || p.nome || (p.username ? `@${p.username}` : "Contato")}
              {!p.lead_id && <span style={{ color: "var(--ink3)" }}> · novo</span>}
              <b style={{ color: "#DD2A7B" }}> {p.nao_lidas}</b>
            </button>
          ))}
          {visiveis.length > 8 && <span style={{ color: "var(--ink3)" }}>+{visiveis.length - 8}</span>}
        </div>
      )}
      {aberta && (
        <InstagramDoLead leadId={null} conversaId={aberta.id} instagram={aberta.username}
          nome={aberta.nome || (aberta.username ? `@${aberta.username}` : "Contato do Instagram")}
          aberto onFechar={() => { setAberta(null); void carregar(); }} onMudou={() => void carregar()} />
      )}
    </>
  );
}
