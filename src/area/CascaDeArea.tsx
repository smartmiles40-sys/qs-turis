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
import { useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import ChangePasswordModal from "@/components/sdr/settings/ChangePasswordModal";
import TrocarArea from "@/components/TrocarArea";
import type { Setor } from "@/components/sdr/types";
import { Avatar } from "@/rel/ui";

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
  aviao: traco(<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />),
  config: traco(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
};
const SETA = traco(<polyline points="6 9 12 15 18 9" />, 14);

/** Sai do endereço da área (ao trocar de área ou sair). */
export function limparHashDaArea() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** Lê "#<prefixo>/<tela>/<id>" → { tela, id }. Fora da área = início. */
export function lerHashDaArea(prefixo: string): { tela: string; id?: string } {
  const [area, tela, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (area !== prefixo || !tela) return { tela: "inicio" };
  return id ? { tela, id: decodeURIComponent(id) } : { tela };
}
export function hashDaArea(prefixo: string, r: { tela: string; id?: string }) {
  if (r.tela === "inicio") return `#${prefixo}`;
  return r.id ? `#${prefixo}/${r.tela}/${encodeURIComponent(r.id)}` : `#${prefixo}/${r.tela}`;
}

export default function CascaDeArea({
  setor, nome, subtitulo, css, grupos, ativo, onIr, chaveMenu, temConfig, children,
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
  /** Onde o menu lembra quais grupos ficaram abertos. */
  chaveMenu: string;
  /** Mostra a engrenagem (tela "config"). */
  temConfig?: boolean;
  children: ReactNode;
}) {
  const { currentUser, logout } = useQsAuth();
  const { isDark, toggleTheme } = useTheme();
  const [menuAberto, setMenuAberto] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(chaveMenu) || "{}"); } catch { return {}; }
  });
  if (!currentUser) return null;

  const ir = (tela: string) => { setMenuAberto(false); onIr(tela); };
  function alternar(g: string, valor?: boolean) {
    setAbertos((a) => {
      const n = { ...a, [g]: valor ?? !(a[g] ?? false) };
      try { localStorage.setItem(chaveMenu, JSON.stringify(n)); } catch { /* sem memória: só não lembra */ }
      return n;
    });
  }
  const Bolinha = ({ n, alerta }: { n?: number; alerta?: boolean }) => (n ? (
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none"
      style={alerta ? { background: "var(--err-bg)", color: "var(--err-ink)" } : { background: "var(--warn-bg)", color: "var(--warn-ink)" }}>{n}</span>
  ) : null);

  const menu = (
    <nav className="flex flex-col h-full" aria-label={`Menu do ${nome}`}>
      <div className="flex items-center gap-2.5 px-4 h-16 flex-shrink-0">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl text-white font-bold text-sm" style={{ background: "var(--rel)" }}>QS</span>
        <span className="leading-tight">
          <span className="block text-sm font-bold" style={{ color: "var(--ink)" }}>{nome}</span>
          <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{subtitulo}</span>
        </span>
      </div>

      <div className="px-2.5 flex-1 overflow-y-auto space-y-0.5">
        <button onClick={() => ir("inicio")} aria-current={ativo === "inicio" ? "page" : undefined}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-semibold"
          style={{ background: ativo === "inicio" ? "var(--rel-soft)" : "transparent", color: ativo === "inicio" ? "var(--rel-ink)" : "var(--ink2)" }}>
          {ICONES_AREA.inicio} <span className="flex-1 text-left">Início</span>
        </button>

        {grupos.map((g) => {
          const temAtivo = g.itens.some((i) => i.id === ativo);
          const aberto = temAtivo || (abertos[g.id] ?? false);
          const soma = g.itens.reduce((s, i) => s + (i.badge ?? 0), 0);
          const algumAlerta = g.itens.some((i) => i.alerta && i.badge);
          return (
            <div key={g.id}>
              <button onClick={() => alternar(g.id, !aberto)} aria-expanded={aberto}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-semibold"
                style={{ color: temAtivo ? "var(--rel-ink)" : "var(--ink2)" }}>
                {g.icone}
                <span className="flex-1 text-left">{g.rotulo}</span>
                {!aberto && <Bolinha n={soma || undefined} alerta={algumAlerta} />}
                <span className="transition-transform" style={{ transform: aberto ? "rotate(0deg)" : "rotate(-90deg)", color: "var(--ink3)" }}>{SETA}</span>
              </button>
              {aberto && (
                <ul className="ml-[22px] pl-3 border-l space-y-0.5 mb-1" style={{ borderColor: "var(--line)" }}>
                  {g.itens.map((it) => {
                    const sel = ativo === it.id;
                    return (
                      <li key={it.id}>
                        <button onClick={() => ir(it.id)} aria-current={sel ? "page" : undefined}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold"
                          style={{ background: sel ? "var(--rel-soft)" : "transparent", color: sel ? "var(--rel-ink)" : "var(--ink3)" }}>
                          <span className="flex-1 text-left">{it.rotulo}</span>
                          <Bolinha n={it.badge} alerta={it.alerta} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 space-y-1 border-t" style={{ borderColor: "var(--line)" }}>
        <TrocarArea atual={setor} variante="bloco" onAntes={limparHashDaArea} />
        <div className="flex items-center gap-2.5 px-1 pt-2">
          <Avatar nome={currentUser.name} tamanho={30} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{currentUser.name}</span>
            <span className="block text-[11px] truncate" style={{ color: "var(--ink3)" }}>{currentUser.email}</span>
          </span>
          {temConfig && (
            <button onClick={() => ir("config")} title="Configurações" aria-label="Configurações" className="p-1.5 rounded-lg"
              style={{ background: ativo === "config" ? "var(--rel-soft)" : "transparent", color: ativo === "config" ? "var(--rel-ink)" : "var(--ink3)" }}>
              {ICONES_AREA.config}
            </button>
          )}
        </div>
        <div className="flex gap-1 pt-1">
          <button onClick={toggleTheme} className="flex-1 px-2 py-1.5 rounded-md text-[12px] font-semibold" style={{ color: "var(--ink2)", background: "var(--card2)" }}>
            {isDark ? "Modo claro" : "Modo noturno"}
          </button>
          <button onClick={() => setTrocandoSenha(true)} className="flex-1 px-2 py-1.5 rounded-md text-[12px] font-semibold" style={{ color: "var(--ink2)", background: "var(--card2)" }}>
            Senha
          </button>
          <button onClick={() => { limparHashDaArea(); logout(); }} className="flex-1 px-2 py-1.5 rounded-md text-[12px] font-semibold" style={{ color: "var(--err-ink)", background: "var(--err-bg)" }}>
            Sair
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <style>{css}</style>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 border-r" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
        {menu}
      </aside>
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 border-b" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
        <button onClick={() => setMenuAberto(true)} aria-label="Abrir menu" className="p-1 -ml-1" style={{ color: "var(--ink)" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg text-white font-bold text-[11px]" style={{ background: "var(--rel)" }}>QS</span>
        <span className="text-sm font-bold flex-1" style={{ color: "var(--ink)" }}>{nome}</span>
      </header>
      {menuAberto && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0" style={{ background: "rgba(15,20,26,.45)" }} onClick={() => setMenuAberto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl" style={{ background: "var(--card)" }}>{menu}</aside>
        </div>
      )}
      <main className="lg:pl-60">
        <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">{children}</div>
      </main>
      <ChangePasswordModal open={trocandoSenha} onClose={() => setTrocandoSenha(false)} />
    </div>
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
