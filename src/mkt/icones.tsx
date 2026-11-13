// src/mkt/icones.tsx — ícones do menu do Marketing (traço 18px, mesmo estilo
// dos ICONES_AREA). O campo `icone` de uma RotaMkt é a chave daqui.
import type { ReactNode } from "react";

const traco = (d: ReactNode) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);

export const ICONES_MKT: Record<string, ReactNode> = {
  planejamento: traco(<><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 12l2 2 4-4" /><line x1="9" y1="17" x2="15" y2="17" /></>),
  quadro: traco(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v12" /></>),
  calendario: traco(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  aprovacao: traco(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  pedido: traco(<><path d="M3 11l18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>),
  biblioteca: traco(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>),
  equipe: traco(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  colunas: traco(<><path d="M12 3v18" /><rect x="3" y="3" width="18" height="18" rx="2" /></>),
  lista: traco(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>),
  pasta: traco(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />),
  disparo: traco(<><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>),
  grupo: traco(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>),
  automacao: traco(<><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>),
  email: traco(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></>),
  grafico: traco(<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>),
  config: traco(<><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></>),
};

/** Ícone de cada grupo (quando a rota não diz o dela). */
export const ICONE_GRUPO_MKT: Record<string, ReactNode> = {
  organico: ICONES_MKT.quadro,
  trafego: ICONES_MKT.grafico,
  comum: ICONES_MKT.equipe,
  disparos: ICONES_MKT.disparo,
  automacoes: ICONES_MKT.automacao,
  email: ICONES_MKT.email,
};
