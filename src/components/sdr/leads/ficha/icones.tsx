// src/components/sdr/leads/ficha/icones.tsx — ícones de traço da ficha do lead (os do desenho).
import type { ReactNode } from "react";

function Svg({ size = 18, sw = 2, children }: { size?: number; sw?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IcVoltar = () => <Svg size={14}><path d="M15 18l-6-6 6-6" /></Svg>;
export const IcTelefone = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></Svg>
);
export const IcWhats = ({ size = 18 }: { size?: number }) => <Svg size={size}><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z" /></Svg>;
export const IcSeta = () => <Svg size={16}><path d="M6 9l6 6 6-6" /></Svg>;
export const IcCalendario = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>
);
export const IcRaio = () => <Svg size={16}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></Svg>;
export const IcCheck = ({ size = 16, sw = 2.5 }: { size?: number; sw?: number }) => <Svg size={size} sw={sw}><path d="M20 6L9 17l-5-5" /></Svg>;
export const IcNota = () => <Svg size={16}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
export const IcRelogio = ({ size = 22 }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IcPontos = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);
export const IcX = () => <Svg size={16}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Svg>;
