// src/components/sdr/agenda/MinhasPendencias.tsx
// -----------------------------------------------------------------------------
// As pendências do usuário (atividades extras em aberto: retornos, ligações
// marcadas pelo cliente…) que já venceram ou são de hoje. Fica em Reuniões,
// em cima da agenda do mês (Bruno, 27/10/2026), pra que nada atrasado suma
// só porque caiu fora da grade.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { rotuloPendencia } from "./AgendaMes";

interface Linha {
  id: string;
  lead_id: string;
  scheduled_at: string;
  notes: string | null;
  tags: string[] | null;
  lead: { full_name: string | null } | null;
}

const LIMITE = 30;

export default function MinhasPendencias({ ownerId, onOpenLead }: { ownerId: string; onOpenLead?: (leadId: string) => void }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);

  useEffect(() => {
    let vivo = true;
    const fimDeHoje = new Date(); fimDeHoje.setHours(23, 59, 59, 999);
    supabase
      .from("qs_tasks")
      .select("id, lead_id, scheduled_at, notes, tags, lead:qs_leads(full_name)")
      .eq("owner_id", ownerId)
      .eq("is_extra", true)
      .in("status", ["pendente", "atrasada"])
      .lte("scheduled_at", fimDeHoje.toISOString())
      .order("scheduled_at")
      .limit(LIMITE + 1)
      .then(({ data }) => { if (vivo) setLinhas(((data ?? []) as unknown) as Linha[]); });
    return () => { vivo = false; };
  }, [ownerId]);

  if (!linhas || linhas.length === 0) return null;
  const agora = Date.now();
  const atrasadas = linhas.filter((l) => new Date(l.scheduled_at).getTime() < agora).length;

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-bold text-gray-900">Suas pendências até hoje</h3>
        <span className="text-xs text-gray-500">
          {linhas.length > LIMITE ? `${LIMITE}+` : linhas.length} em aberto
          {atrasadas > 0 && <> · <span className="font-semibold text-red-600 dark:text-red-400">{atrasadas} atrasada{atrasadas === 1 ? "" : "s"}</span></>}
        </span>
      </div>
      <ul className="divide-y divide-gray-50">
        {linhas.slice(0, LIMITE).map((l) => {
          const quando = new Date(l.scheduled_at);
          const atrasada = quando.getTime() < agora;
          const hoje = quando.toDateString() === new Date().toDateString();
          return (
            <li key={l.id}>
              <button type="button" onClick={() => onOpenLead?.(l.lead_id)}
                className="flex w-full items-center gap-3 py-1.5 text-left text-sm hover:bg-gray-50">
                <span className={`w-24 shrink-0 text-xs font-semibold tabular-nums ${atrasada ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>
                  {hoje ? "hoje" : quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="w-32 shrink-0 text-xs text-gray-500">{rotuloPendencia(l)}</span>
                <span className="truncate font-medium text-gray-800">{l.lead?.full_name || "Lead"}</span>
                {l.notes && <span className="truncate text-xs text-gray-400">{l.notes}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
