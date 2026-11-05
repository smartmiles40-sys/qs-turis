// src/components/sdr/agenda/TemperaturaSdrPicker.tsx
// -----------------------------------------------------------------------------
// A TEMPERATURA DO SDR na hora de agendar (Bruno, 05/11): a segunda temperatura
// do lead, dada por quem conversou com ele. Obrigatória na 1ª reunião — é o que
// o closer usa pra decidir com quem falar primeiro. Usado nos dois modais de
// agendamento (Agenda e Ganho no Painel).
// -----------------------------------------------------------------------------

import { TEMPERATURAS, chipDaTemperatura, type LeadTemperature } from "@/lib/leadScore";

const DICA: Record<LeadTemperature, string> = {
  quente: "Quer viajar, tem data e dinheiro. Prioridade do closer.",
  morno: "Tem interesse, mas falta algo (data, orçamento, decisão).",
  frio: "Topou conversar, mas ainda está só pesquisando.",
};

export default function TemperaturaSdrPicker({
  value,
  onChange,
  disabled,
  labelClassName = "text-xs font-medium text-gray-500 block mb-1",
}: {
  value: LeadTemperature | "";
  onChange: (v: LeadTemperature) => void;
  disabled?: boolean;
  labelClassName?: string;
}) {
  return (
    <div>
      <label className={labelClassName}>
        Temperatura do SDR <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Temperatura do SDR">
        {TEMPERATURAS.map((t) => {
          const chip = chipDaTemperatura(t);
          const ativo = value === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={disabled}
              onClick={() => onChange(t)}
              className="rounded-lg border px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              style={{
                borderColor: ativo ? chip.color : "#e5e7eb",
                background: ativo ? chip.bg : "#F9FAFB",
                color: ativo ? chip.color : "#6B7280",
              }}
            >
              {chip.emoji} {chip.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10.5px] text-gray-400">
        {value ? DICA[value] : "Sua leitura do cliente. O closer vê isso pra saber quem atender primeiro."}
      </p>
    </div>
  );
}
