// src/propostas/EmBreve.tsx
// -----------------------------------------------------------------------------
// O selo e o cartão "Em breve" da geração de propostas (ver disponivel.ts).
// -----------------------------------------------------------------------------
import { TEXTO_EM_BREVE } from "./disponivel";

export function SeloEmBreve() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide align-middle"
      style={{ background: "var(--warn-bg, #fff4d6)", color: "var(--warn-ink, #8a5a00)" }}>
      Em breve
    </span>
  );
}

export function CartaoEmBreve({ compacto = false }: { compacto?: boolean }) {
  return (
    <div className={`rel-card ${compacto ? "p-3" : "p-5"} space-y-1.5`}>
      <p className={`${compacto ? "text-[13px]" : "text-[15px]"} font-bold flex items-center gap-2`} style={{ color: "var(--ink)" }}>
        Gerar proposta pelo QS <SeloEmBreve />
      </p>
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{TEXTO_EM_BREVE}</p>
    </div>
  );
}
