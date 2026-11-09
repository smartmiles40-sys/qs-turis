// src/mkt/disparos/WhatsAppPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › WHATSAPP — UMA entrada no menu (Bruno, 30/10/2026: "não precisa
// ter tanta coisa assim no menu esquerdo, pode ser um campo dentro da página").
// Antes eram 6 telas (Contatos, Disparos, Recorrências, Sequências, Automações,
// Conversas); agora são abas desta página: Disparos | Automações | Conversas |
// Contatos. Recorrência e sequência viraram opções dentro de Disparos.
// A aba vai no endereço: #mkt/whatsapp?aba=conversas (o aviso "pediu humano"
// do motor abre direto a conversa: #mkt/whatsapp?aba=conversas&c=<id>).
// -----------------------------------------------------------------------------
import { lazy, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PaginaComAbas, type AbaMkt } from "../Abas";

const Disparos = lazy(() => import("./DisparosMktPage"));
const Contatos = lazy(() => import("./ContatosPage"));
const Automacoes = lazy(() => import("../automacoes/AutomacoesPage"));
const Conversas = lazy(() => import("../automacoes/ConversasPage"));
// 09/11/2026: links e QR de entrada (wa.me com código → fluxo), com contagem de cliques.
const Entradas = lazy(() => import("../automacoes/EntradasPage").then((m) => ({ default: () => <m.default canal="whatsapp" /> })));

const icone = (d: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICONES = {
  disparos: icone(<><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>),
  automacoes: icone(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />),
  conversas: icone(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  links: icone(<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>),
  contatos: icone(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
};

/** Quantas conversas do número do Marketing têm mensagem não lida (leve: só a coluna, só quem tem). */
function useNaoLidas(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    const contar = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.from("mkt_wa_conversas").select("id", { count: "exact", head: true }).gt("nao_lidas", 0)
        .then(({ count, error }) => { if (vivo && !error) setN(count ?? 0); });
    };
    contar();
    const t = setInterval(contar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  return n;
}

export default function WhatsAppPage() {
  const naoLidas = useNaoLidas();
  const abas: AbaMkt[] = [
    { id: "disparos", rotulo: "Disparos", icone: ICONES.disparos, componente: Disparos },
    { id: "automacoes", rotulo: "Automações", icone: ICONES.automacoes, componente: Automacoes },
    { id: "conversas", rotulo: "Conversas", icone: ICONES.conversas, badge: naoLidas || undefined, componente: Conversas },
    { id: "links", rotulo: "Links e QR", icone: ICONES.links, componente: Entradas },
    { id: "contatos", rotulo: "Contatos", icone: ICONES.contatos, componente: Contatos },
  ];
  return (
    <PaginaComAbas titulo="WhatsApp" subtitulo="Disparos, respostas automáticas e conversas do número do Marketing." abas={abas} />
  );
}
