// src/components/sdr/dashboard/AnalisesPage.tsx
// -----------------------------------------------------------------------------
// "Análises & Metas" — as abas seguem o CAMINHO DO LEAD (Bruno, 28/09/2026):
// Entrada → FUP/cadência → Contatos → Reunião e fonte → Detalhamento → Metas.
//
// Antes eram 4 painéis soltos, sem ordem. A Visão Geral virou o funil
// (VisaoGeralFunil); o que ela mostrava antes (canal, horários, motivos de
// perda, fontes) mora agora em "Detalhamento", pra nada se perder. Cada painel
// ainda guarda os próprios filtros — a unificação num filtro só é o passo
// seguinte.
// -----------------------------------------------------------------------------

import { useState } from "react";
import CadenceHealthPanel from "./CadenceHealthPanel";
import FupAnalyticsPanel from "./FupAnalyticsPanel";
import AdvancedAnalyticsPanel from "./AdvancedAnalyticsPanel";
import MonitorLeadsPage from "./MonitorLeadsPage";
import SdrDashboard from "./SdrDashboard";
import GoalsPage from "../goals/GoalsPage";

type SubTab = "entrada" | "saude" | "fup" | "avancadas" | "detalhe" | "metas";

const TABS: { id: SubTab; label: string; desc: string }[] = [
  { id: "entrada", label: "1 · Entrada", desc: "Quantos leads cada SDR recebeu: fim de semana, live, fonte e closers." },
  { id: "saude", label: "2 · FUP e cadência", desc: "FUP por etapa, atrasadas e backlog (foto de agora)." },
  { id: "fup", label: "3 · Contatos", desc: "Desfechos por SDR, conversão por tentativa, aderência e por que se pula." },
  { id: "avancadas", label: "4 · Reunião e fonte", desc: "Telefonia, show-rate, velocidade do 1º contato, funil e R$ por fonte." },
  { id: "detalhe", label: "Detalhamento", desc: "Canal, melhores horários, motivos de perda e conversão por fonte (a Visão Geral anterior)." },
  { id: "metas", label: "Metas", desc: "Planejamento diário e mensal de cada SDR e da equipe." },
];

export default function AnalisesPage({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const [tab, setTab] = useState<SubTab>("entrada");
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="space-y-5" style={{ fontFamily: "inherit" }}>
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-gray-900">Análises &amp; Metas</h1>
        <p className="text-sm text-gray-500 mt-0.5">{active?.desc}</p>
      </div>

      <div className="flex flex-wrap gap-1.5 gap-y-2 border-b border-gray-100 pb-3" role="tablist">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 h-9 text-[13px] font-semibold transition-colors ${
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

      <div>
        {tab === "entrada" && <MonitorLeadsPage onOpenLead={onOpenLead} />}
        {tab === "saude" && <CadenceHealthPanel />}
        {tab === "fup" && <FupAnalyticsPanel />}
        {tab === "avancadas" && <AdvancedAnalyticsPanel />}
        {tab === "detalhe" && <SdrDashboard />}
        {tab === "metas" && <GoalsPage />}
      </div>
    </div>
  );
}
