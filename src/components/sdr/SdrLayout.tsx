// src/components/sdr/SdrLayout.tsx — QS (Qualificação System)
import { useState, useRef, useEffect, Component, type ReactNode } from "react";
import { useQsAuth, canAccessNav } from "@/contexts/QsAuthContext";

// ── Error Boundary ─────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  pageName: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class PageErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center px-6">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Erro ao carregar {this.props.pageName}
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Algo deu errado. Tente novamente.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: "#0147FF" }}
          >
            Tentar novamente
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
import SdrDashboard from "./dashboard/SdrDashboard";
import LeadsPage from "./leads/LeadsPage";
import LeadDetailPage from "./leads/LeadDetailPage";
import CadencesPage from "./cadences/CadencesPage";
import CadenceCreatePage from "./cadences/CadenceCreatePage";
import TasksPanel from "./tasks/TasksPanel";
import MeetingsPage from "./meetings/MeetingsPage";
import GoalsPage from "./goals/GoalsPage";
import SettingsPage from "./settings/SettingsPage";
import CoveragePanel from "./dashboard/CoveragePanel";
import NotificationsPanel from "./notifications/NotificationsPanel";
import ChatAppDock from "./chatapp/ChatAppDock";
import GlobalToasts from "./GlobalToasts";
import { toggleWebphone } from "@/lib/wavoip";

export type SdrNav =
  | "painel"
  | "leads"
  | "lead-detail"
  | "cadencias"
  | "cadencia-criar"
  | "cadencia-editar"
  | "dashboard"
  | "reunioes"
  | "metas"
  | "declaracao"
  | "historicos"
  | "cobertura"
  | "configuracoes";

// ── Dropdown Menu ────────────────────────────────────────────────────────────

interface MenuItem {
  id: SdrNav;
  label: string;
  description?: string;
}

interface MenuGroup {
  id: string;
  label: string;
  items: MenuItem[];
}

const MENU: (MenuGroup | MenuItem)[] = [
  {
    id: "execucao",
    label: "Execução",
    items: [
      { id: "painel", label: "Painel de Atividades", description: "Fila de tarefas do dia" },
      { id: "cobertura", label: "Cobertura de Leads", description: "Leads aguardando contato" },
    ],
  },
  {
    id: "gerenciamento",
    label: "Gestão",
    items: [
      { id: "leads", label: "Leads", description: "Cadastro e gestão de leads" },
      { id: "cadencias", label: "Cadências", description: "Fluxos de prospecção" },
      { id: "reunioes", label: "Reuniões", description: "Agenda de reuniões" },
    ],
  },
  {
    id: "desempenho",
    label: "Desempenho",
    items: [
      { id: "dashboard", label: "Visão Geral", description: "Indicadores operacionais" },
      { id: "metas", label: "Metas", description: "Planejamento diário e mensal" },
    ],
  },
  { id: "configuracoes", label: "Configurações" },
];

function isGroup(item: MenuGroup | MenuItem): item is MenuGroup {
  return "items" in item;
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ── Dropdown Component ───────────────────────────────────────────────────────

function NavDropdown({
  group,
  activeNav,
  onNavigate,
}: {
  group: MenuGroup;
  activeNav: SdrNav;
  onNavigate: (nav: SdrNav) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isActive = group.items.some((i) => i.id === activeNav);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-2 text-[14px] font-medium transition-colors rounded-md"
        style={{
          color: isActive ? "#0147FF" : "#374151",
          borderBottom: isActive ? "2px solid #0147FF" : "2px solid transparent",
          borderRadius: 0,
        }}
      >
        {group.label}
        <ChevronDown />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50"
          style={{ minWidth: 280 }}
        >
          {group.items.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex flex-col gap-0.5"
            >
              <span className="text-[13px] font-semibold text-gray-900">{item.label}</span>
              {item.description && (
                <span className="text-[11px] text-gray-400">{item.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function SdrLayout() {
  const { currentUser, logout } = useQsAuth();
  const [activeNav, setActiveNav] = useState<SdrNav>("painel");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [editingCadenceId, setEditingCadenceId] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const userRole = currentUser?.role ?? "sdr";
  const userInitials = currentUser
    ? currentUser.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "QS";

  // Close user menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Filter menu items based on role
  const filteredMenu = MENU.map((item) => {
    if (isGroup(item)) {
      const filteredItems = item.items.filter((sub) => canAccessNav(userRole, sub.id));
      if (filteredItems.length === 0) return null;
      return { ...item, items: filteredItems };
    }
    // Direct item (e.g. Configurações)
    return canAccessNav(userRole, item.id) ? item : null;
  }).filter(Boolean) as (MenuGroup | MenuItem)[];

  function navigate(nav: SdrNav) {
    setActiveNav(nav);
    setSelectedLeadId(null);
    setEditingCadenceId(null);
  }

  function openLeadDetail(leadId: string) {
    setSelectedLeadId(leadId);
    setActiveNav("lead-detail");
  }

  function openCadenceCreate() {
    setEditingCadenceId(null);
    setActiveNav("cadencia-criar");
  }

  function openCadenceEdit(cadenceId: string) {
    setEditingCadenceId(cadenceId);
    setActiveNav("cadencia-editar");
  }

  // Abre o webfone (Wavoip) a partir do topo — carrega sob demanda (sem widget solto).
  async function handleOpenPhone() {
    const r = await toggleWebphone();
    if (!r.ok) console.warn("[webfone]", r.error);
  }

  const visualActiveNav: SdrNav =
    activeNav === "lead-detail" ? "leads" :
    activeNav === "cadencia-criar" || activeNav === "cadencia-editar" ? "cadencias" :
    activeNav;

  return (
    <div className="h-dvh flex overflow-hidden" style={{ background: "#F8F9FA" }}>
      {/* ── COLUNA PRINCIPAL (topo + conteúdo) — divide a tela com o ChatApp ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* ── TOP BAR ────────────────────────────────────────────────────── */}
      <header
        className="shrink-0 z-50 flex items-center justify-between px-3 sm:px-4 h-[52px] select-none pl-safe pr-safe"
        style={{
          background: "#FFFFFF",
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        {/* Left: Hambúrguer (mobile) + Logo + Nav */}
        <div className="flex items-center gap-1 min-w-0">
          {/* Botão do menu — só no mobile */}
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden flex items-center justify-center w-9 h-9 -ml-1 mr-1 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            aria-label="Abrir menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {/* QS Turis Logo */}
          <div className="flex items-center gap-2 md:mr-4 md:pr-4 md:border-r md:border-gray-200">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-lg text-white font-bold text-[11px]"
              style={{ background: "#0147FF" }}
            >
              QS
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-gray-800 leading-none">Turis</span>
              <span className="text-[8px] text-gray-400 font-medium leading-none mt-0.5">by Inovvatur</span>
            </div>
          </div>

          {/* Nav items (desktop) — no mobile vira o menu lateral */}
          <nav className="hidden md:flex items-center gap-0.5">
            {filteredMenu.map((item) => {
              if (isGroup(item)) {
                return (
                  <NavDropdown
                    key={item.id}
                    group={item}
                    activeNav={visualActiveNav}
                    onNavigate={navigate}
                  />
                );
              }
              // Direct link (Ajustes)
              const isActive = visualActiveNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  className="px-3 py-2 text-[14px] font-medium transition-colors"
                  style={{
                    color: isActive ? "#0147FF" : "#374151",
                    borderBottom: isActive ? "2px solid #0147FF" : "2px solid transparent",
                    borderRadius: 0,
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Telefone + Notificações + Avatar */}
        <div className="flex items-center gap-2">
          {/* Webfone (Wavoip) — abre o discador dentro do QS, sob demanda */}
          <button
            onClick={handleOpenPhone}
            title="Telefone (Webfone)"
            aria-label="Abrir o telefone (Webfone)"
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-50 transition-colors"
            style={{ color: "#0147FF" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          {/* Sino de notificações/lembretes */}
          <NotificationsPanel
            onGoToTasks={() => setActiveNav("painel")}
            onOpenLead={openLeadDetail}
          />
          <div ref={userMenuRef} className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors"
            >
              <div
                className="flex items-center justify-center w-8 h-8 rounded-full text-white text-[11px] font-bold"
                style={{ background: "#0147FF" }}
              >
                {userInitials}
              </div>
              {currentUser && (
                <span className="text-[13px] font-medium text-gray-700 hidden sm:block">
                  {currentUser.name.split(" ")[0]}
                </span>
              )}
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50 min-w-[200px]">
                {currentUser && (
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-[13px] font-semibold text-gray-900">{currentUser.name}</p>
                    <p className="text-[11px] text-gray-400">{currentUser.email}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 uppercase">
                      {currentUser.role}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="w-full text-left px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── MENU LATERAL (MOBILE) ────────────────────────────────────────── */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[84%] max-w-[320px] bg-white shadow-2xl flex flex-col pt-safe pb-safe pl-safe">
            {/* Cabeçalho do drawer */}
            <div className="shrink-0 flex items-center justify-between px-4 h-[52px] border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg text-white font-bold text-[11px]" style={{ background: "#0147FF" }}>QS</div>
                <div className="flex flex-col">
                  <span className="text-[12px] font-bold text-gray-800 leading-none">Turis</span>
                  <span className="text-[8px] text-gray-400 font-medium leading-none mt-0.5">by Inovvatur</span>
                </div>
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-50"
                aria-label="Fechar menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Itens de navegação */}
            <nav className="flex-1 overflow-y-auto py-3">
              {filteredMenu.map((entry) => {
                if (isGroup(entry)) {
                  return (
                    <div key={entry.id} className="mb-2">
                      <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{entry.label}</p>
                      {entry.items.map((item) => {
                        const active = visualActiveNav === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => { navigate(item.id); setMobileNavOpen(false); }}
                            className="w-full text-left px-4 py-3 flex flex-col gap-0.5 active:bg-gray-50 transition-colors"
                            style={{ background: active ? "#EEF4FF" : "transparent", borderLeft: active ? "3px solid #0147FF" : "3px solid transparent" }}
                          >
                            <span className="text-[14px] font-semibold" style={{ color: active ? "#0147FF" : "#182231" }}>{item.label}</span>
                            {item.description && <span className="text-[11px] text-gray-400">{item.description}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                }
                const active = visualActiveNav === entry.id;
                return (
                  <button
                    key={entry.id}
                    onClick={() => { navigate(entry.id); setMobileNavOpen(false); }}
                    className="w-full text-left px-4 py-3 active:bg-gray-50 transition-colors"
                    style={{ background: active ? "#EEF4FF" : "transparent", borderLeft: active ? "3px solid #0147FF" : "3px solid transparent" }}
                  >
                    <span className="text-[14px] font-semibold" style={{ color: active ? "#0147FF" : "#182231" }}>{entry.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Rodapé: usuário + sair */}
            {currentUser && (
              <div className="shrink-0 border-t border-gray-100 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full text-white text-[12px] font-bold shrink-0" style={{ background: "#0147FF" }}>{userInitials}</div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900 truncate">{currentUser.name}</p>
                    <p className="text-[11px] text-gray-400 truncate">{currentUser.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setMobileNavOpen(false); logout(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold text-red-600 bg-red-50 active:bg-red-100 transition-colors"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {activeNav === "painel" && (
          <PageErrorBoundary pageName="Painel de Atividades">
            <TasksPanel onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "leads" && (
          <PageErrorBoundary pageName="Leads">
            <LeadsPage
              onOpenLead={openLeadDetail}
              onOpenCadenceCreate={openCadenceCreate}
            />
          </PageErrorBoundary>
        )}
        {activeNav === "lead-detail" && selectedLeadId && (
          <PageErrorBoundary pageName="Detalhes do Lead">
            <LeadDetailPage
              leadId={selectedLeadId}
              onBack={() => navigate("leads")}
            />
          </PageErrorBoundary>
        )}
        {activeNav === "cadencias" && (
          <PageErrorBoundary pageName="Cadências">
            <CadencesPage
              onCreateCadence={openCadenceCreate}
              onEditCadence={openCadenceEdit}
            />
          </PageErrorBoundary>
        )}
        {(activeNav === "cadencia-criar" || activeNav === "cadencia-editar") && (
          <PageErrorBoundary pageName="Criar Cadência">
            <CadenceCreatePage
              cadenceId={editingCadenceId}
              onBack={() => navigate("cadencias")}
            />
          </PageErrorBoundary>
        )}
        {activeNav === "dashboard" && (
          <PageErrorBoundary pageName="Visão Geral">
            <SdrDashboard />
          </PageErrorBoundary>
        )}
        {activeNav === "cobertura" && (
          <PageErrorBoundary pageName="Cobertura de Leads">
            <CoveragePanel />
          </PageErrorBoundary>
        )}
        {activeNav === "reunioes" && (
          <PageErrorBoundary pageName="Reuniões">
            <MeetingsPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "metas" && (
          <PageErrorBoundary pageName="Metas">
            <GoalsPage />
          </PageErrorBoundary>
        )}
        {activeNav === "configuracoes" && (
          <PageErrorBoundary pageName="Configurações">
            <SettingsPage />
          </PageErrorBoundary>
        )}
      </main>
      </div>

      {/* Coluna do ChatApp — divide a tela; montada uma única vez e persistente */}
      <ChatAppDock />

      {/* Toasts globais (erros de gravação, confirmações) */}
      <GlobalToasts />
    </div>
  );
}
