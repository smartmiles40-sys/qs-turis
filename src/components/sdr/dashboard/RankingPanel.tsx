import React, { useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface SdrRankEntry {
  id: string;
  name: string;
  avatar: string;
  leadsQualificados: number;
  tempoMedioContato: string;
  taxaConversao: number;
  atividadesPorHora: number;
  trend: "up" | "down" | "stable";
}

type RankingPeriod = "hoje" | "semana" | "mes";

// ── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_RANKING: SdrRankEntry[] = [
  {
    id: "u1",
    name: "Ana Beatriz",
    avatar: "AB",
    leadsQualificados: 47,
    tempoMedioContato: "2min 14s",
    taxaConversao: 34.2,
    atividadesPorHora: 31.5,
    trend: "up",
  },
  {
    id: "u2",
    name: "Carlos Mendes",
    avatar: "CM",
    leadsQualificados: 41,
    tempoMedioContato: "3min 08s",
    taxaConversao: 29.8,
    atividadesPorHora: 27.2,
    trend: "up",
  },
  {
    id: "u3",
    name: "Fernanda Lima",
    avatar: "FL",
    leadsQualificados: 38,
    tempoMedioContato: "4min 32s",
    taxaConversao: 26.1,
    atividadesPorHora: 24.8,
    trend: "down",
  },
  {
    id: "u4",
    name: "Roberto Silva",
    avatar: "RS",
    leadsQualificados: 33,
    tempoMedioContato: "5min 45s",
    taxaConversao: 22.5,
    atividadesPorHora: 21.3,
    trend: "stable",
  },
  {
    id: "u5",
    name: "Juliana Costa",
    avatar: "JC",
    leadsQualificados: 28,
    tempoMedioContato: "6min 10s",
    taxaConversao: 19.7,
    atividadesPorHora: 18.6,
    trend: "down",
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function RankingPanel() {
  const [period, setPeriod] = useState<RankingPeriod>("mes");

  const periods: { key: RankingPeriod; label: string }[] = [
    { key: "hoje", label: "Hoje" },
    { key: "semana", label: "Semana" },
    { key: "mes", label: "Mês" },
  ];

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
          <h2 className="text-sm font-medium text-gray-700">Ranking de Qualificadores</h2>
        </div>

        {/* Period filter */}
        <div className="flex items-center gap-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{
                background: period === p.key ? "#F97316" : "transparent",
                color: period === p.key ? "#fff" : "#6B7280",
                border: period === p.key ? "1px solid #F97316" : "1px solid #E5E7EB",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3 pl-2 w-10">#</th>
              <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Qualificador</th>
              <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Leads Qualificados</th>
              <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Tempo Médio</th>
              <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Taxa de Conversão</th>
              <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Atividades/h</th>
              <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3 w-16">Trend</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_RANKING.map((sdr, idx) => {
              const isTop = idx === 0;
              return (
                <tr
                  key={sdr.id}
                  className={`border-b border-gray-50 transition-colors hover:bg-gray-50 ${isTop ? "bg-amber-50/40" : ""}`}
                >
                  {/* Position */}
                  <td className="py-3 pl-2">
                    {isTop ? (
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                        </svg>
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-gray-500 pl-1.5">{idx + 1}</span>
                    )}
                  </td>

                  {/* Name */}
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          background: isTop ? "#FEF3C7" : "#F3F4F6",
                          color: isTop ? "#D97706" : "#6B7280",
                        }}
                      >
                        <span className="text-xs font-bold">{sdr.avatar}</span>
                      </div>
                      <span className={`text-sm ${isTop ? "font-bold text-gray-900" : "font-medium text-gray-700"}`}>
                        {sdr.name}
                      </span>
                    </div>
                  </td>

                  {/* Leads Qualificados */}
                  <td className="py-3 text-center">
                    <span className={`text-sm ${isTop ? "font-bold text-[#F97316]" : "font-medium text-gray-700"}`}>
                      {sdr.leadsQualificados}
                    </span>
                  </td>

                  {/* Tempo Médio */}
                  <td className="py-3 text-center">
                    <span className="text-sm text-gray-600">{sdr.tempoMedioContato}</span>
                  </td>

                  {/* Taxa de Conversão */}
                  <td className="py-3 text-center">
                    <span className={`text-sm font-medium ${sdr.taxaConversao >= 30 ? "text-green-600" : "text-gray-700"}`}>
                      {sdr.taxaConversao.toFixed(1)}%
                    </span>
                  </td>

                  {/* Atividades/h */}
                  <td className="py-3 text-center">
                    <span className="text-sm text-gray-600">{sdr.atividadesPorHora.toFixed(1)}</span>
                  </td>

                  {/* Trend */}
                  <td className="py-3 text-center">
                    {sdr.trend === "up" && (
                      <span className="inline-flex items-center gap-0.5 text-green-600 text-xs font-medium">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 15l-6-6-6 6" />
                        </svg>
                      </span>
                    )}
                    {sdr.trend === "down" && (
                      <span className="inline-flex items-center gap-0.5 text-red-500 text-xs font-medium">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    )}
                    {sdr.trend === "stable" && (
                      <span className="inline-flex items-center gap-0.5 text-gray-400 text-xs font-medium">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14" />
                        </svg>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
