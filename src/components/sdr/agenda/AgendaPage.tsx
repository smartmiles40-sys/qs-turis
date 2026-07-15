// src/components/sdr/agenda/AgendaPage.tsx
// -----------------------------------------------------------------------------
// Aba "Agenda": mostra a Google Agenda compartilhada dos closers embutida, pro
// SDR ver todas as reuniões num lugar só. Configurada pelo admin em
// Configurações → Agenda (Google). Só visualização.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { getAgendaEmbed, buildAgendaEmbedSrc, isEmbedUrl, type AgendaMode } from "@/lib/qs/agenda";

const MODES: { id: AgendaMode; label: string }[] = [
  { id: "WEEK", label: "Semana" },
  { id: "MONTH", label: "Mês" },
  { id: "AGENDA", label: "Lista" },
];

export default function AgendaPage() {
  const [raw, setRaw] = useState<string | null>(null);
  const [mode, setMode] = useState<AgendaMode>("WEEK");

  useEffect(() => { void getAgendaEmbed().then(setRaw); }, []);

  if (raw === null) {
    return <div className="p-6 md:p-8 text-sm text-gray-400">Carregando agenda…</div>;
  }

  const src = buildAgendaEmbedSrc(raw, mode);
  const fixedUrl = isEmbedUrl(raw); // URL completa colada → o modo já vem nela

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agenda</h1>
          <p className="text-sm text-gray-500">Reuniões dos closers, direto da Google Agenda compartilhada.</p>
        </div>
        {src && !fixedUrl && (
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  mode === m.id ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {src ? (
        <iframe
          key={src}
          src={src}
          title="Agenda dos closers"
          className="w-full h-[78vh] min-h-[520px] rounded-xl border border-gray-200 bg-white"
          style={{ colorScheme: "light" }}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <p className="text-sm font-semibold text-gray-700">A agenda ainda não foi configurada.</p>
          <p className="text-sm text-gray-500 mt-1">
            Um administrador precisa colar o <b>ID da agenda compartilhada</b> (ou a URL de
            incorporação do Google) em <b>Configurações → Agenda (Google)</b>.
          </p>
        </div>
      )}
    </div>
  );
}
