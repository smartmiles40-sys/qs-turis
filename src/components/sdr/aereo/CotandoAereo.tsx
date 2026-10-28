// src/components/sdr/aereo/CotandoAereo.tsx
// -----------------------------------------------------------------------------
// Botão "Cotando aéreo" / "Terminei" (0206, Bruno 27/10/2026). Fica no card da
// Fila e na ficha do lead. O cronômetro é o mesmo nos dois lugares (pub/sub em
// lib/qs/aereo). Sem a migration aplicada, o botão simplesmente não aparece.
// -----------------------------------------------------------------------------
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  carregarCotacaoAberta, cotacaoAereoAberta, descartarCotacaoAereo, duracaoSeg, fecharSeVencida,
  iniciarCotacaoAereo, ouvirCotacaoAereo, relogio, terminarCotacaoAereo,
} from "@/lib/qs/aereo";

const IcAviao = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  </svg>
);

export default function CotandoAereo({ leadId }: { leadId: string | null }) {
  const { currentUser } = useQsAuth();
  const aberta = useSyncExternalStore(ouvirCotacaoAereo, cotacaoAereoAberta);
  const [agora, setAgora] = useState(Date.now());
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { if (currentUser?.id) void carregarCotacaoAberta(currentUser.id); }, [currentUser?.id]);
  const correndo = aberta && aberta !== "sem-tabela" ? aberta : null;
  useEffect(() => {
    if (!correndo) return;
    const t = setInterval(() => {
      setAgora(Date.now());
      // Bateu 2h sem "Terminei": fecha sozinha (com aviso), em vez de seguir contando.
      void fecharSeVencida();
    }, 1000);
    return () => clearInterval(t);
  }, [correndo]);

  if (aberta === "sem-tabela" || !currentUser) return null;

  const rodar = async (f: () => Promise<boolean>) => {
    if (ocupado) return;
    setOcupado(true);
    try { await f(); } finally { setOcupado(false); }
  };

  if (!correndo) {
    return (
      <button type="button" className="qs-btn qs-btn--sm" disabled={ocupado}
        title="Marque quando começar a cotar um aéreo pra este cliente. O tempo entra no seu Desempenho."
        onClick={() => rodar(() => iniciarCotacaoAereo(leadId))}>
        <IcAviao />Cotando aéreo
      </button>
    );
  }

  const outroLead = correndo.lead_id !== leadId;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 4px 2px 10px", borderRadius: 8,
      background: "var(--info-bg)", color: "var(--info)", fontSize: 13, fontWeight: 600 }}
      title={outroLead ? "A cotação em andamento é de outro cliente" : "Cotação de aéreo em andamento"}>
      <IcAviao />
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{relogio(duracaoSeg(correndo, agora))}</span>
      {outroLead && <span style={{ fontWeight: 500, fontSize: 12 }}>(outro cliente)</span>}
      <button type="button" className="qs-btn qs-btn--sm qs-btn--primary" disabled={ocupado}
        onClick={() => rodar(terminarCotacaoAereo)}>Terminei</button>
      <button type="button" className="qs-btn qs-btn--sm qs-btn--ghost qs-btn--icon" disabled={ocupado}
        aria-label="Descartar (apertei por engano)" title="Descartar (apertei por engano)"
        onClick={() => rodar(descartarCotacaoAereo)}>×</button>
    </span>
  );
}
