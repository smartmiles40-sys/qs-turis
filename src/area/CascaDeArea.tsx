// src/area/CascaDeArea.tsx
// -----------------------------------------------------------------------------
// A CASCA das áreas novas do QS (Financeiro e Operações, 0126 — 14/10/2026).
//
// É o mesmo esqueleto do Relacionamento (src/rel/RelApp.tsx): menu em grupos
// que abrem e fecham (o grupo da tela aberta abre sozinho; fechado mostra a soma
// das bolinhas), cabeçalho com o nome de quem está logado, engrenagem, modo
// noturno, senha, sair e a troca de área. A diferença é que aqui ela é uma peça
// só, e cada área entra só com o que é dela: cor, nome, grupos e telas.
//
// O Relacionamento continua com a casca própria — nasceu antes e mexer nele
// agora seria risco sem ganho.
// -----------------------------------------------------------------------------
import type { ReactNode } from "react";
import type { Setor } from "@/components/sdr/types";
import SinoDeAvisos from "@/avisos/SinoDeAvisos";
import AppShell, { type ComercialDividido, type ShellGroup } from "@/components/ui/AppShell";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { abrirAreaCloser, podeAbrirAreaCloser } from "@/closer/lib";
import { Icon } from "@/components/ui/icons";

export interface ItemDoMenu { id: string; rotulo: string; badge?: number; alerta?: boolean }
export interface GrupoDoMenu { id: string; rotulo: string; icone: ReactNode; itens: ItemDoMenu[] }

const traco = (d: ReactNode, t = 18) => (
  <svg width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
/** Ícones comuns pros grupos do menu (traço 18px, mesmo estilo do Rel). */
export const ICONES_AREA = {
  inicio: traco(<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  equipe: traco(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></>),
  dinheiro: traco(<><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><line x1="6" y1="15" x2="10" y2="15" /></>),
  lista: traco(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>),
  grafico: traco(<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>),
  // Central de Solicitações (0149): caixa de entrada
  pedidos: traco(<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  aviao: traco(<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />),
  config: traco(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
};

/** Sai do endereço da área (ao trocar de área ou sair). */
export function limparHashDaArea() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** As duas portas do Comercial no seletor de setor (Bruno, 27/10). Só pra quem
 *  abre as duas: o closer puro mora na área dele, o SDR não abre a do closer. */
export function comercialDividido(
  u: Parameters<typeof podeAbrirAreaCloser>[0],
  atual: ComercialDividido["atual"],
): ComercialDividido | undefined {
  if (!podeAbrirAreaCloser(u) || u?.role === "closer") return undefined;
  return {
    atual,
    irSdr: () => { limparHashDaArea(); window.dispatchEvent(new HashChangeEvent("hashchange")); },
    irCloser: abrirAreaCloser,
  };
}

/** Lê "#<prefixo>/<tela>/<id>" → { tela, id }. Fora da área = início. */
export function lerHashDaArea(prefixo: string): { tela: string; id?: string } {
  // "?aba=…" no fim do hash é estado da tela (src/lib/hashQuery.ts), não parte da rota
  const [area, tela, id] = window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  if (area !== prefixo || !tela) return { tela: "inicio" };
  return id ? { tela, id: decodeURIComponent(id) } : { tela };
}
export function hashDaArea(prefixo: string, r: { tela: string; id?: string }) {
  if (r.tela === "inicio") return `#${prefixo}`;
  return r.id ? `#${prefixo}/${r.tela}/${encodeURIComponent(r.id)}` : `#${prefixo}/${r.tela}`;
}

/** Ícone de cada item do menu (redesign out/2026): pelo id da tela. */
const ICONE_DO_ITEM: Record<string, ReactNode> = {
  inicio: Icon.inicio, atendimentos: Icon.inbox, conversas: Icon.chat, modelos: Icon.modelo,
  receber: Icon.dinheiro, pagamentos: Icon.pagamento, solicitacoes: Icon.inbox, propostas: Icon.doc,
  equipe: Icon.time, fichas: Icon.cliente, arrumar: Icon.ferramenta, fornecedores: Icon.fornecedor,
  "exp-expedicoes": Icon.aviao, "exp-inscricoes": Icon.inscricao, "exp-avisos": Icon.megafone, "checklist-padrao": Icon.check, receitas: Icon.check,
  "exp-inicio": Icon.inicio, "exp-config": Icon.cadeado,
};

export default function CascaDeArea({
  setor, css, grupos, ativo, onIr, temConfig, inicioId = "inicio", children,
}: {
  setor: Setor;
  nome: string;
  subtitulo: string;
  /** CSS da área (cores --rel… trocadas pela cor dela). */
  css: string;
  grupos: GrupoDoMenu[];
  /** Id do item aceso no menu ("inicio", "config"…). */
  ativo: string;
  onIr: (tela: string) => void;
  /** Onde o menu lembrava quais grupos ficaram abertos (a sidebar nova não fecha grupo). */
  chaveMenu: string;
  /** Mostra a engrenagem (tela "config"). */
  temConfig?: boolean;
  /** A tela que o "Início" do topo abre (Operações: o início das expedições). */
  inicioId?: string;
  children: ReactNode;
}) {
  const { currentUser } = useQsAuth();
  // Redesign (out/2026): a casca virou o AppShell comum dos 4 setores. A API
  // continua a mesma pra Financeiro e Operações não mudarem nada.
  const grupos2: ShellGroup[] = [
    { items: [{ id: inicioId, label: "Início", icon: ICONE_DO_ITEM.inicio }] },
    ...grupos.map((g) => ({
      label: g.rotulo,
      items: g.itens.map((i) => ({ id: i.id, label: i.rotulo, icon: ICONE_DO_ITEM[i.id] ?? g.icone, count: i.badge, late: i.alerta })),
    })),
  ];
  return (
    <>
      <style>{css}</style>
      <AppShell setor={setor} groups={grupos2} active={ativo} onNavigate={onIr} notifications={<SinoDeAvisos />}
        comercial={comercialDividido(currentUser, setor === "comercial" ? "closer" : "sdr")}
        onBeforeSwitch={limparHashDaArea} onSettings={temConfig ? () => onIr("config") : undefined} settingsActive={ativo === "config"}>
        <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">{children}</div>
      </AppShell>
    </>
  );
}

/** Cartão de boas-vindas das áreas em construção. */
export function EmConstrucao({ titulo, texto, itens }: { titulo: string; texto: string; itens?: string[] }) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="rel-card p-6 sm:p-8">
        <span className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
          style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>Em construção</span>
        <h1 className="text-xl font-bold mt-3" style={{ color: "var(--ink)" }}>{titulo}</h1>
        <p className="text-[14px] mt-2" style={{ color: "var(--ink2)" }}>{texto}</p>
        {itens && itens.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-[14px]" style={{ color: "var(--ink2)" }}>
            {itens.map((t) => <li key={t} className="flex gap-2"><span style={{ color: "var(--rel-ink)" }} aria-hidden>•</span>{t}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
