// src/preview/WebphonePreview.tsx
// -----------------------------------------------------------------------------
// Página de PREVIEW LOCAL do widget de ligação (webfone WebRTC), servida em
// http://localhost:3000/webfone-preview.html no `npm run dev`.
//
// Renderiza o WebphoneWidget REAL com dados de mentira (prop `demo`), sem
// chamada, sem login e sem tocar no banco. Serve só para ver/afinar o visual.
// Nada disso entra no build de produção (o build só empacota o index.html).
// -----------------------------------------------------------------------------

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import WebphoneWidget from "../components/sdr/telefone/WebphoneWidget";
import type { WebphoneState } from "../lib/webphone";

const LEAD = { name: "Maria Fernanda Souza", number: "5511998877665", leadId: "demo-lead" };

const PRESETS: { label: string; state: WebphoneState }[] = [
  { label: "Chamando", state: { status: "connecting", peerName: LEAD.name, peerNumber: LEAD.number, leadId: LEAD.leadId, muted: false, answeredAt: null } },
  { label: "Tocando", state: { status: "ringing", peerName: LEAD.name, peerNumber: LEAD.number, leadId: LEAD.leadId, muted: false, answeredAt: null } },
  { label: "Em ligação", state: { status: "in_call", peerName: LEAD.name, peerNumber: LEAD.number, leadId: LEAD.leadId, muted: false, answeredAt: Date.now() - 74_000 } },
  { label: "Ligação manual (sem lead)", state: { status: "in_call", peerName: null, peerNumber: LEAD.number, leadId: null, muted: false, answeredAt: Date.now() - 12_000 } },
];

function Preview() {
  const [i, setI] = useState(2);
  // Re-monta o widget ao trocar de preset (zera cronômetro/painéis) via key.
  const preset = PRESETS[i];
  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "32px 24px", fontFamily: "system-ui, sans-serif", color: "#111827" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Preview do webfone</h1>
        <p style={{ color: "#6b7280", marginTop: 6, fontSize: 14 }}>
          Widget real com dados de mentira. Escolha o estado abaixo; o painel aparece no <b>canto inferior esquerdo</b>.
          Abra o <b>Teclado</b> e o <b>Anotar</b> pra ver os painéis; o cronômetro conta de verdade em "Em ligação".
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
          {PRESETS.map((p, idx) => (
            <button
              key={p.label}
              onClick={() => setI(idx)}
              style={{
                padding: "8px 14px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
                border: idx === i ? "1px solid #0147FF" : "1px solid #e5e7eb",
                background: idx === i ? "#0147FF" : "#fff",
                color: idx === i ? "#fff" : "#374151",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p style={{ color: "#9ca3af", marginTop: 24, fontSize: 12 }}>
          Estado atual: <b>{preset.label}</b>. (No app real ele só aparece durante a ligação.)
        </p>
      </div>

      <WebphoneWidget key={preset.label} demo={preset.state} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
