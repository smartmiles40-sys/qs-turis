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
import WavoipWebphone from "./webphone/WavoipWebphone";

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

  const visualActiveNav: SdrNav =
    activeNav === "lead-detail" ? "leads" :
    activeNav === "cadencia-criar" || activeNav === "cadencia-editar" ? "cadencias" :
    activeNav;

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "#F8F9FA" }}>
      {/* ── COLUNA PRINCIPAL (topo + conteúdo) — divide a tela com o ChatApp ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* ── TOP BAR ────────────────────────────────────────────────────── */}
      <header
        className="shrink-0 z-50 flex items-center justify-between px-4 h-[52px] select-none"
        style={{
          background: "#FFFFFF",
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-1">
          {/* QS Turis Logo */}
          <div className="flex items-center gap-2 mr-4 pr-4" style={{ borderRight: "1px solid #E5E7EB" }}>
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

          {/* Nav items */}
          <nav className="flex items-center gap-0.5">
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

        {/* Right: Notificações + Avatar */}
        <div className="flex items-center gap-2">
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

      {/* Webfone (Wavoip) — botão flutuante montado uma única vez (canto inferior esquerdo) */}
      <WavoipWebphone />
    </div>
  );
}
