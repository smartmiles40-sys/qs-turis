// src/components/sdr/dashboard/AnalisesPage.tsx
// -----------------------------------------------------------------------------
// "Análises & Metas" — uma única aba de Desempenho que reúne o que antes eram
// QUATRO itens de menu separados (Saúde da Cadência, Análises de FUP, Análises
// Avançadas e Metas). O menu ficou enxuto (Desempenho = Visão Geral + esta);
// aqui um seletor de sub-aba troca o painel. Cada painel guarda seus próprios
// filtros/estado — só mudamos ONDE eles moram, não a lógica interna.
// -----------------------------------------------------------------------------

import { useState } from "react";
import CadenceHealthPanel from "./CadenceHealthPanel";
import FupAnalyticsPanel from "./FupAnalyticsPanel";
import AdvancedAnalyticsPanel from "./AdvancedAnalyticsPanel";
import GoalsPage from "../goals/GoalsPage";

type SubTab = "saude" | "fup" | "avancadas" | "metas";

const TABS: { id: SubTab; label: string; desc: string }[] = [
  { id: "saude", label: "Saúde da Cadência", desc: "FUP por etapa, atrasadas e backlog (foto de agora)." },
  { id: "fup", label: "Análises de FUP", desc: "Desfechos por SDR, conversão por tentativa e aderência." },
  { id: "avancadas", label: "Análises Avançadas", desc: "Telefonia, show-rate, speed-to-lead, funil e R$ por fonte." },
  { id: "metas", label: "Metas", desc: "Planejamento diário e mensal de cada SDR e da equipe." },
];

export default function AnalisesPage() {
  const [tab, setTab] = useState<SubTab>("saude");
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="space-y-5" style={{ fontFamily: "inherit" }}>
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <rect x="7" y="10" width="3" height="7" />
            <rect x="12" y="6" width="3" height="11" />
            <rect x="17" y="13" width="3" height="4" />
          </svg>
          Análises &amp; Metas
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">{active?.desc}</p>
      </div>

      {/* Sub-abas */}
      <div className="flex flex-wrap gap-1 gap-y-2 border-b border-gray-100 pb-3">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-[#0147FF] text-white"
                  : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Painel ativo — cada um mantém seus próprios filtros/estado */}
      <div>
        {tab === "saude" && <CadenceHealthPanel />}
        {tab === "fup" && <FupAnalyticsPanel />}
        {tab === "avancadas" && <AdvancedAnalyticsPanel />}
        {tab === "metas" && <GoalsPage />}
      </div>
    </div>
  );
}
