// src/components/sdr/leads/SeloCardBitrix.tsx
// Selo "Sem card no Bitrix — tentando de novo" / "Falhou: <motivo>" com o botão
// "Tentar agora" (só pra quem pode mexer no lead). Lead com card: não mostra nada.
// Regras e chamada ao servidor: ./cardBitrix.ts.
import { useState, type MouseEvent } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { criarCardNoBitrix, seloDoCard, type LeadComCardBitrix } from "./cardBitrix";

interface Props {
  lead: LeadComCardBitrix;
  /** Mostra o "Tentar agora" (quem já pode editar o lead). */
  podeTentar: boolean;
  /** "ficha" usa os selos da ficha (fl-selo); "lista" é a etiqueta compacta. */
  variante?: "ficha" | "lista";
  /** Depois de criar/vincular: quem chama recarrega o lead. */
  onMudou?: () => void;
}

export default function SeloCardBitrix({ lead, podeTentar, variante = "ficha", onMudou }: Props) {
  const [tentando, setTentando] = useState(false);
  const selo = seloDoCard(lead);
  if (!selo) return null;

  async function tentar(e: MouseEvent) {
    e.stopPropagation(); // na lista, o clique não abre o lead
    if (tentando) return;
    setTentando(true);
    const r = await criarCardNoBitrix(lead.id);
    setTentando(false);
    if (r.ok) {
      notifySuccess(r.como === "vinculado"
        ? `Card amarrado ao negócio ${r.bitrixId ?? ""} que já existia no Bitrix.`
        : `Card criado no Bitrix${r.bitrixId ? ` (negócio ${r.bitrixId})` : ""}.`);
    } else {
      notifyError(`O card no Bitrix não foi criado: ${r.error ?? "erro desconhecido"}`);
    }
    onMudou?.();
  }

  const titulo = selo.detalhe ? `Último erro: ${selo.detalhe}` : "Este lead ainda não tem negócio no Bitrix.";

  if (variante === "lista") {
    const cor = selo.tom === "danger"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cor}`} title={titulo}>
        <span className="max-w-[220px] truncate">{selo.tom === "danger" ? "Bitrix: falhou" : "Sem card no Bitrix"}</span>
        {podeTentar && (
          <button type="button" onClick={(e) => void tentar(e)} disabled={tentando}
            className="underline underline-offset-2 hover:opacity-80 disabled:opacity-50">
            {tentando ? "..." : "Tentar agora"}
          </button>
        )}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", maxWidth: "100%" }}>
      <span className={`fl-selo fl-selo--${selo.tom}`} title={titulo} style={{ overflowWrap: "anywhere" }}>{selo.texto}</span>
      {podeTentar && (
        <button type="button" className="fl-selo fl-selo--tracejado" onClick={(e) => void tentar(e)} disabled={tentando}>
          {tentando ? "Tentando..." : "Tentar agora"}
        </button>
      )}
    </span>
  );
}
