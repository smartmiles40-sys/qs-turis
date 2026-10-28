// src/components/ui/AppShell.tsx
// -----------------------------------------------------------------------------
// A CASCA do redesign (out/2026) — uma só pros 4 setores. Ver HANDOFF.md, "Shell".
//
//   topo:    seletor de setor (substitui os botões "Ir para o …")
//   abaixo:  busca global (Ctrl K)
//   meio:    menu agrupado (rótulos em caixa alta) com contadores
//   rodapé:  notificações, modo claro/noite e o usuário (senha e sair no menu dele)
//
// Em tela estreita (< 1024px) a sidebar vira gaveta aberta por uma barra no topo.
// Quem usa só passa os grupos e reage a `onIr` — a navegação de cada setor
// continua sendo a dela (hash no Rel/Fin/Ops, estado no Comercial).
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { NOME_SETOR, type Setor } from "@/components/sdr/types";
import { abrirGestao, podeAbrirGestao } from "@/gestao/acesso";
import ChangePasswordModal from "@/components/sdr/settings/ChangePasswordModal";
import { Avatar } from "./index";
import { Icon } from "./icons";
import "./ui.css";

export interface ShellItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Contador à direita (cinza). */
  count?: number;
  /** O contador representa ATRASO → vai em --danger. */
  late?: boolean;
}
export interface ShellGroup { label?: string; items: ShellItem[] }
/** O Comercial tem duas portas, SDR e Closer (Bruno, 27/10): as duas viram
 *  opções do seletor de setor em vez de item escondido no menu. */
export interface ComercialDividido {
  atual: "sdr" | "closer";
  irSdr: () => void;
  irCloser: () => void;
}
const PORTA_COMERCIAL = {
  sdr: { nome: "Comercial · SDR", sub: "Fila, leads e reuniões" },
  closer: { nome: "Comercial · Closer", sub: "Pipeline e contratos" },
} as const;

/** Painel de Gestão (27/10): todos os setores, só admin e gestor. */
const GESTAO = { nome: "Gestão", sub: "Todos os setores", cor: "var(--text)" } as const;

export interface ShellMenuAction { id: string; label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }

const SUBTITULO: Record<Setor, string> = {
  comercial: "Pré-venda e vendas",
  relacionamento: "Pós-venda",
  financeiro: "Recebimentos e pagamentos",
  operacional: "Expedições e embarques",
};
const COR: Record<Setor, string> = {
  comercial: "var(--sector-comercial)",
  relacionamento: "var(--sector-relacionamento)",
  financeiro: "var(--sector-financeiro)",
  operacional: "var(--sector-operacoes)",
};
const NOME_PAPEL: Record<string, string> = {
  admin: "Administrador", gestor: "Gestor", sdr: "SDR", closer: "Closer", marketing: "Marketing",
  relacionamento: "Relacionamento", financeiro: "Financeiro", operacional: "Operações",
};

const ROTULO_ROLE = (r?: string) => (r ? NOME_PAPEL[r] ?? r : "");

/** Fecha um popover ao clicar fora ou apertar Esc. */
function useFora(aberto: boolean, fechar: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) fechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto, fechar]);
  return ref;
}

export default function AppShell({
  setor, groups, active, onNavigate, notifications, userActions = [], extraSectors = [], comercial,
  onBeforeSwitch, onSettings, settingsActive, mainClassName, children, after, naGestao,
}: {
  setor: Setor;
  groups: ShellGroup[];
  active: string;
  onNavigate: (id: string) => void;
  /** O sino do setor (Avisos, ou o NotificationsPanel do Comercial). */
  notifications?: ReactNode;
  /** Itens a mais no menu do usuário (Configurar telefone, bolinha…). */
  userActions?: ShellMenuAction[];
  /** Destinos extras no seletor de setor (ex.: Área do Closer). */
  extraSectors?: { id: string; label: string; sub: string; color: string; onClick: () => void }[];
  /** Quem abre as duas portas do Comercial: o seletor mostra SDR e Closer. */
  comercial?: ComercialDividido;
  /** Roda antes de trocar de setor ou sair (limpar o endereço da área). */
  onBeforeSwitch?: () => void;
  /** Engrenagem ao lado do usuário. */
  onSettings?: () => void;
  settingsActive?: boolean;
  mainClassName?: string;
  children: ReactNode;
  /** Fica fora do <main>, à direita (o dock de WhatsApp do Comercial). */
  after?: ReactNode;
  /** Painel de Gestão aberto (#gestao, 27/10): o seletor mostra "Gestão" e
   *  escolher qualquer setor — até o mesmo da `setor` — sai do painel. */
  naGestao?: boolean;
}) {
  const { currentUser, trocarArea, logout } = useQsAuth();
  const { isDark, toggleTheme } = useTheme();
  const [setorAberto, setSetorAberto] = useState(false);
  const [userAberto, setUserAberto] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const [senha, setSenha] = useState(false);
  const setorRef = useFora(setorAberto, () => setSetorAberto(false));
  const userRef = useFora(userAberto, () => setUserAberto(false));
  if (!currentUser) return null;

  const setores = setoresDe(currentUser);
  const verGestao = podeAbrirGestao(currentUser);
  // No painel de Gestão nenhum setor está "aberto": nada leva o check.
  const aqui = (s: Setor) => !naGestao && s === setor;
  const ir = (id: string) => { setGaveta(false); onNavigate(id); };
  const buscar = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));

  const side = (
    <aside className={`qs-side${gaveta ? " qs-side--open" : ""}`} aria-label={`Menu do ${NOME_SETOR[setor]}`}>
      <div className="qs-sector" ref={setorRef}>
        <button type="button" className="qs-btn qs-btn--ghost qs-sector__btn" aria-haspopup="menu" aria-expanded={setorAberto}
          aria-label="Trocar de setor" onClick={() => setSetorAberto((v) => !v)}>
          <span className="qs-sector__logo">QS</span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, textAlign: "left", minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{naGestao ? GESTAO.nome : comercial && setor === "comercial" ? PORTA_COMERCIAL[comercial.atual].nome : NOME_SETOR[setor]}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--subtle)" }}>
              <span className="qs-dot" style={{ background: naGestao ? GESTAO.cor : COR[setor] }} aria-hidden />{naGestao ? GESTAO.sub : comercial && setor === "comercial" ? PORTA_COMERCIAL[comercial.atual].sub : SUBTITULO[setor]}
            </span>
          </span>
          <span style={{ marginLeft: "auto", display: "inline-flex" }}>{Icon.seletor}</span>
        </button>
        {setorAberto && (
          <div className="qs-pop" role="menu">
            <span className="qs-pop__title">Trocar de setor</span>
            {verGestao && (
              <button type="button" role="menuitem" className="qs-pop__item"
                onClick={() => { setSetorAberto(false); if (naGestao) return; onBeforeSwitch?.(); abrirGestao(); }}>
                <span className="qs-dot" style={{ background: GESTAO.cor }} aria-hidden />
                <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                  <span style={{ fontWeight: 600 }}>{GESTAO.nome}</span>
                  <span style={{ fontSize: 12, color: "var(--subtle)", fontWeight: 400 }}>{GESTAO.sub}</span>
                </span>
                {naGestao && <span style={{ marginLeft: "auto", display: "inline-flex" }} aria-label="Setor atual">{Icon.check}</span>}
              </button>
            )}
            {setores.map((s) => (comercial && s === "comercial") ? (
              (["sdr", "closer"] as const).map((porta) => (
                <button key={porta} type="button" role="menuitem" className="qs-pop__item"
                  onClick={() => {
                    setSetorAberto(false);
                    if (aqui("comercial") && porta === comercial.atual) return;
                    if (naGestao) onBeforeSwitch?.();
                    if (setor !== "comercial") { if (!naGestao) onBeforeSwitch?.(); trocarArea("comercial"); }
                    if (porta === "sdr") comercial.irSdr(); else comercial.irCloser();
                  }}>
                  <span className="qs-dot" style={{ background: COR.comercial }} aria-hidden />
                  <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                    <span style={{ fontWeight: 600 }}>{PORTA_COMERCIAL[porta].nome}</span>
                    <span style={{ fontSize: 12, color: "var(--subtle)", fontWeight: 400 }}>{PORTA_COMERCIAL[porta].sub}</span>
                  </span>
                  {aqui("comercial") && porta === comercial.atual && <span style={{ marginLeft: "auto", display: "inline-flex" }} aria-label="Setor atual">{Icon.check}</span>}
                </button>
              ))
            ) : (
              <button key={s} type="button" role="menuitem" className="qs-pop__item"
                onClick={() => { setSetorAberto(false); if (!aqui(s)) { onBeforeSwitch?.(); trocarArea(s); } }}>
                <span className="qs-dot" style={{ background: COR[s] }} aria-hidden />
                <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                  <span style={{ fontWeight: 600 }}>{NOME_SETOR[s]}</span>
                  <span style={{ fontSize: 12, color: "var(--subtle)", fontWeight: 400 }}>{SUBTITULO[s]}</span>
                </span>
                {aqui(s) && <span style={{ marginLeft: "auto", display: "inline-flex" }} aria-label="Setor atual">{Icon.check}</span>}
              </button>
            ))}
            {extraSectors.map((x) => (
              <button key={x.id} type="button" role="menuitem" className="qs-pop__item" onClick={() => { setSetorAberto(false); x.onClick(); }}>
                <span className="qs-dot" style={{ background: x.color }} aria-hidden />
                <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                  <span style={{ fontWeight: 600 }}>{x.label}</span>
                  <span style={{ fontSize: 12, color: "var(--subtle)", fontWeight: 400 }}>{x.sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="qs-btn" style={{ width: "100%", justifyContent: "flex-start", color: "var(--subtle)", margin: "8px 0" }} onClick={buscar}>
        {Icon.busca}Buscar<span className="qs-kbd" style={{ marginLeft: "auto" }}>Ctrl K</span>
      </button>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }} aria-label="Menu principal">
        {groups.map((g, gi) => (
          <div key={g.label ?? gi} style={{ display: "contents" }}>
            {g.label && <div className="qs-side__group">{g.label}</div>}
            {g.items.map((it) => (
              <button key={it.id} type="button" className="qs-nav" aria-current={active === it.id ? "page" : undefined} onClick={() => ir(it.id)}>
                {it.icon}<span className="qs-nav__label">{it.label}</span>
                {!!it.count && <span className={`qs-nav__n${it.late ? " qs-nav__n--danger" : ""}`}>{it.count}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="qs-side__foot">
        {notifications && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: 2, color: "var(--muted)", fontWeight: 500 }}>
            {notifications}<span>Notificações</span>
          </div>
        )}
        <button type="button" className="qs-nav" onClick={toggleTheme}>
          {isDark ? Icon.sol : Icon.lua}<span className="qs-nav__label">{isDark ? "Modo claro" : "Modo noite"}</span>
        </button>
        <div className="qs-sector" ref={userRef} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" className="qs-nav" style={{ height: 44, flex: 1 }} aria-haspopup="menu" aria-expanded={userAberto} onClick={() => setUserAberto((v) => !v)}>
            <Avatar name={currentUser.name} size={28} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, textAlign: "left" }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.name}</span>
              <span style={{ fontSize: 12, color: "var(--subtle)", fontWeight: 400 }}>{ROTULO_ROLE(currentUser.role)}</span>
            </span>
          </button>
          {onSettings && (
            <button type="button" className="qs-btn qs-btn--ghost qs-btn--icon" aria-label="Configurações" title="Configurações"
              aria-current={settingsActive ? "page" : undefined} onClick={() => { setGaveta(false); onSettings(); }}>
              {Icon.config}
            </button>
          )}
          {userAberto && (
            <div className="qs-pop qs-pop--up" role="menu">
              <span className="qs-pop__title">{currentUser.email}</span>
              <button type="button" role="menuitem" className="qs-pop__item" onClick={() => { setUserAberto(false); setSenha(true); }}>{Icon.cadeado}Trocar senha</button>
              {userActions.map((a) => (
                <button key={a.id} type="button" role="menuitem" className={`qs-pop__item${a.danger ? " qs-pop__item--danger" : ""}`}
                  onClick={() => { setUserAberto(false); a.onClick(); }}>{a.icon}{a.label}</button>
              ))}
              <button type="button" role="menuitem" className="qs-pop__item qs-pop__item--danger"
                onClick={() => { setUserAberto(false); onBeforeSwitch?.(); logout(); }}>{Icon.sair}Sair</button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="qs-shell">
      <header className="qs-topbar">
        <button type="button" className="qs-btn qs-btn--ghost qs-btn--icon" aria-label="Abrir menu" onClick={() => setGaveta(true)}>{Icon.menu}</button>
        <span className="qs-sector__logo">QS</span>
        <span style={{ fontWeight: 600, flex: 1 }}>{naGestao ? GESTAO.nome : NOME_SETOR[setor]}</span>
        <button type="button" className="qs-btn qs-btn--ghost qs-btn--icon" aria-label="Buscar" onClick={buscar}>{Icon.busca}</button>
      </header>
      {gaveta && <div className="qs-scrim" onClick={() => setGaveta(false)} aria-hidden />}
      {side}
      <main className={`qs-main ${mainClassName ?? ""}`}>{children}</main>
      {after}
      <ChangePasswordModal open={senha} onClose={() => setSenha(false)} />
    </div>
  );
}
