// src/components/sdr/SdrLayout.tsx — QS (Qualificação System)
import { comercialDividido } from "@/area/CascaDeArea";
import { useState, useRef, useEffect, Component, Suspense, type ReactNode } from "react";
import { useQsAuth, canAccessNav, telaInicial, ORDEM_EXECUCAO } from "@/contexts/QsAuthContext";
import AppShell, { type ShellGroup, type ShellItem } from "@/components/ui/AppShell";
import { Icon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui";
import { lazyPagina } from "@/lib/qs/lazyPagina";

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
import RetrospectivaModal from "./tasks/RetrospectivaModal";
import TasksPanel from "./tasks/TasksPanel";
// As demais telas carregam sob demanda: o SDR abre o app direto no Painel, e o
// código de Leads/Dashboard/Config etc. só baixa quando navegar.
// `lazyPagina` e não o `lazy()` cru porque a aba fica aberta o dia inteiro:
// quando sai um deploy, o chunk que ESTE index.html conhece some do servidor e o
// clique na tela dava "Failed to fetch dynamically imported module".
const SdrDashboard = lazyPagina(() => import("./dashboard/SdrDashboard"));
const AnalisesPage = lazyPagina(() => import("./dashboard/AnalisesPage"));
const MonitorLeadsPage = lazyPagina(() => import("./dashboard/MonitorLeadsPage"));
const VisaoGeralFunil = lazyPagina(() => import("./dashboard/VisaoGeralFunil"));
const LeadsPage = lazyPagina(() => import("./leads/LeadsPage"));
const LeadDetailPage = lazyPagina(() => import("./leads/LeadDetailPage"));
const CadencesPage = lazyPagina(() => import("./cadences/CadencesPage"));
const CadenceCreatePage = lazyPagina(() => import("./cadences/CadenceCreatePage"));
const DisparosPage = lazyPagina(() => import("./disparos/DisparosPage"));
const MeetingsPage = lazyPagina(() => import("./meetings/MeetingsPage"));
const SettingsPage = lazyPagina(() => import("./settings/SettingsPage"));
// A "Cobertura de Leads" respondia "quem espera contato AGORA" — pergunta de
// plantao, que some quando zera. A Carteira responde "quem e meu", que inclui
// quem esfriou e quem nunca respondeu: e la que esta o trabalho que a fila do
// dia nunca aponta. O CoveragePanel segue no repo, sem rota, ate a Carteira
// provar que cobre o uso — apagar tela que o time usa todo dia sem periodo de
// convivencia e como se perde a confianca numa troca.
const CarteiraPage = lazyPagina(() => import("./carteira/CarteiraPage"));
const MinhaAgendaPage = lazyPagina(() => import("./agenda/MinhaAgendaPage"));
const WaPage = lazyPagina(() => import("./wa/WaPage"));
const PipelineIAPage = lazyPagina(() => import("./gloria/PipelineIAPage"));
const SolicitacoesPage = lazyPagina(() => import("@/solicitacoes/SolicitacoesPage"));
const PropostasPage = lazyPagina(() => import("@/propostas/PropostasPage"));
import NotificationsPanel from "./notifications/NotificationsPanel";
import { BotaoBolinhaDoMenu } from "@/avisos/SinoDeAvisos";
import QsWaDock from "./wa/QsWaDock";
import ErroDeParte from "./ErroDeParte";
import AvisoDeVersao from "./AvisoDeVersao";
import GlobalToasts from "./GlobalToasts";
import ConfirmDialog from "./ConfirmDialog";
import CommandPalette from "./CommandPalette";
import { notifySuccess } from "@/lib/qs/notify";
import { sweepCadenceEndings } from "@/lib/qs/cadenceSweep";
import { varrerRetrabalhoVencido } from "@/lib/qs/carteira";
import TelefoneOnboarding from "@/components/sdr/telefone/TelefoneOnboarding";
import WebphoneWidget from "@/components/sdr/telefone/WebphoneWidget";
import LigacaoOficialWidget from "@/components/sdr/telefone/LigacaoOficialWidget";
import Presenca from "@/controle-comercial/Presenca";
import { ComCoresDaCentral } from "@/solicitacoes/PedirOutroSetor";
import { useContagemSolicitacoes } from "@/solicitacoes/useContagem";
import { useAprovacoesNovas } from "@/propostas/lib";

export type SdrNav =
  | "minha-agenda"
  | "painel"
  | "whatsapp"
  | "leads"
  | "lead-detail"
  | "cadencias"
  | "cadencia-criar"
  | "cadencia-editar"
  | "disparos"
  | "dashboard"
  | "analises"
  | "monitor-leads"
  | "reunioes"
  | "declaracao"
  | "historicos"
  | "cobertura"
  | "atendimento-ia"
  | "solicitacoes"
  | "propostas"
  | "configuracoes";

// ── Dropdown Menu ────────────────────────────────────────────────────────────

interface MenuItem {
  id: SdrNav;
  label: string;
  description?: string;
  /** Bolinha com número (Central de Solicitações). */
  badge?: number;
  alerta?: boolean;
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
      // Primeiro da lista de propósito: é a casa do closer. Para SDR/gestor é
      // só mais uma tela; para o closer é O trabalho.
      { id: "minha-agenda", label: "Minha Agenda", description: "Suas reuniões de hoje e o que falta registrar" },
      { id: "painel", label: "Painel de Atividades", description: "Fila de tarefas do dia" },
      // Tela cheia pra quem atende o dia inteiro. Quem só conversa entre uma
      // atividade e outra continua com o dock lateral, sem sair da fila.
      { id: "whatsapp", label: "WhatsApp", description: "Atendimento em tela cheia" },
      // O id continua "cobertura" de proposito: trocar o id do item quebraria
      // o MENU_ACCESS de todos os papeis e a ORDEM_EXECUCAO de uma vez, por uma
      // mudanca que e de rotulo. O que o usuario ve e o label.
      { id: "cobertura", label: "Carteira de Leads", description: "Seus clientes — quem já é seu continua seu" },
      { id: "atendimento-ia", label: "Atendimento IA", description: "O pipeline da Glória: quem ela está atendendo agora" },
      // Central de Solicitações (20/10, 0149): pedidos entre setores com dono e prazo.
      { id: "solicitacoes", label: "Solicitações", description: "Pedir e receber de Relacionamento, Operações e Financeiro" },
      // Propostas (0157): o Comercial monta as suas e envia as que pediu a Operações.
      { id: "propostas", label: "Propostas", description: "Cotações com link e PDF pro cliente escolher a opção" },
    ],
  },
  {
    id: "gerenciamento",
    label: "Gestão",
    items: [
      { id: "leads", label: "Leads", description: "Cadastro e gestão de leads" },
      { id: "cadencias", label: "Cadências", description: "Fluxos de prospecção" },
      { id: "disparos", label: "Disparo em massa", description: "Modelo aprovado pelo número de cada SDR, como passo 1 de uma cadência" },
      { id: "reunioes", label: "Reuniões", description: "Lista de reuniões e Agenda do mês" },
    ],
  },
  {
    id: "desempenho",
    label: "Desempenho",
    items: [
      { id: "dashboard", label: "Visão Geral", description: "O funil de cada SDR: onde o lead se perde" },
      { id: "analises", label: "Análises & Metas", description: "Entrada, FUP, contatos, reunião, detalhamento e metas" },
      { id: "monitor-leads", label: "Distribuição de leads", description: "Quantos leads cada SDR recebeu — fim de semana, live e fonte" },
    ],
  },
  { id: "configuracoes", label: "Configurações" },
];

function isGroup(item: MenuGroup | MenuItem): item is MenuGroup {
  return "items" in item;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function SdrLayout() {
  const { currentUser } = useQsAuth();
  // A tela de entrada depende do papel: o closer cai na agenda dele, não na
  // fila do SDR. Só vale na PRIMEIRA renderização — depois quem manda é a
  // navegação do usuário.
  const [activeNav, setActiveNav] = useState<SdrNav>("painel");
  const landingAplicada = useRef(false);
  useEffect(() => {
    if (landingAplicada.current || !currentUser) return;
    landingAplicada.current = true;
    const inicial = telaInicial(currentUser.role) as SdrNav;
    if (inicial !== "painel") setActiveNav(inicial);
  }, [currentUser]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // A tela de onde o lead foi aberto, pro "Voltar" devolver pra ela.
  const [origemDoLead, setOrigemDoLead] = useState<SdrNav | null>(null);
  const [editingCadenceId, setEditingCadenceId] = useState<string | null>(null);

  // "Configurar telefone" (menu do avatar) reabre o onboarding do BravoTech — o
  // TelefoneOnboarding escuta este evento e força a exibição, ignorando as
  // chaves de "já configurado"/"adiado" desta máquina.
  function reopenTelefoneOnboarding() {
    window.dispatchEvent(new CustomEvent("qs:reopen-tel-onboarding"));
  }

  const userRole = currentUser?.role ?? "sdr";
  const [central, recontarCentral] = useContagemSolicitacoes("comercial");
  const [solicitacaoAberta, setSolicitacaoAberta] = useState<string | null>(null);
  const [propostaAberta, setPropostaAberta] = useState<string | null>(null);
  const [aprovacoes, recontarAprovacoes] = useAprovacoesNovas(currentUser?.id, "comercial");
  // O retrabalho de ontem fecha no LOGIN, não na Carteira (25/09). Rodando só
  // na abertura da Carteira, o SDR que foi direto pro Painel via o retrabalho
  // de ontem como atraso — o Victor Hugo amanheceu com 376 assim. Cada um varre
  // o que é seu (RLS); o realtime da fila tira as linhas da tela sozinho.
  // E de novo quando o DIA VIRA com a aba aberta (checa a cada 15 min): aba
  // deixada aberta de um dia pro outro não passava pelo login.
  const retrabalhoVarridoEm = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser) return;
    const diaSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const varrer = () => {
      const hoje = diaSP();
      if (retrabalhoVarridoEm.current === hoje) return;
      retrabalhoVarridoEm.current = hoje;
      void varrerRetrabalhoVencido();
    };
    varrer();
    const t = window.setInterval(varrer, 15 * 60_000);
    return () => window.clearInterval(t);
  }, [currentUser]);

  // Fim de cadência (redirecionamento / perda automática) — roda 1x por sessão,
  // depois do login. Idempotente; se nada foi tratado, fica em silêncio.
  const sweepRan = useRef(false);
  useEffect(() => {
    if (!currentUser || sweepRan.current) return;
    // O motor de cadência é assunto de quem PROSPECTA. O alcance dele segue a
    // RLS, e desde a 0052 o closer lê a base inteira: rodar isto no login dele
    // varreria todos os leads da empresa e gravaria a nota de fim de cadência
    // em cada um (notes_insert é "with check (true)", então passaria). Além de
    // ser trabalho que não é dele, o toast diria "N leads aguardando SUA
    // decisão" com o número da operação toda.
    if (currentUser.role === "closer") return;
    sweepRan.current = true;
    sweepCadenceEndings().then(({ redirected, lost, finished }) => {
      if (redirected > 0) notifySuccess(`${redirected} lead(s) terminaram a cadência e foram redirecionados automaticamente.`);
      if (lost > 0) notifySuccess(`${lost} lead(s) marcados como perdidos automaticamente (fim de cadência) — perda espelhada no Bitrix.`);
      if (finished > 0) notifySuccess(`${finished} lead(s) terminaram a cadência e voltaram pra carteira — dá pra reiniciar por lá.`);
    });
  }, [currentUser]);

  // Filter menu items based on role
  const filteredMenu = MENU.map((item) => {
    if (isGroup(item)) {
      const filteredItems = item.items.filter((sub) => canAccessNav(userRole, sub.id))
        .map((sub) => sub.id === "solicitacoes" ? { ...sub, badge: central.novas + central.novidades || undefined, alerta: central.atrasadas > 0 }
          : sub.id === "propostas" ? { ...sub, badge: aprovacoes || undefined } : sub);
      if (filteredItems.length === 0) return null;
      // A ORDEM DE EXECUÇÃO MUDA POR PAPEL (Bruno, 01/09). A primeira tela da
      // lista é onde a pessoa volta o dia inteiro: pro closer é a agenda, pro
      // SDR é a fila. Ver ORDEM_EXECUCAO. Item fora da lista vai pro fim, nunca
      // some — ordenar não pode virar um jeito acidental de esconder tela.
      const ordem = item.id === "execucao" ? ORDEM_EXECUCAO[userRole] : undefined;
      if (ordem) {
        const posicao = (id: string) => {
          const i = ordem.indexOf(id);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        filteredItems.sort((x, y) => posicao(x.id) - posicao(y.id));
      }
      return { ...item, items: filteredItems };
    }
    // Direct item (e.g. Configurações)
    return canAccessNav(userRole, item.id) ? item : null;
  }).filter(Boolean) as (MenuGroup | MenuItem)[];

  // Preenchido por openLeadDetail; lido por voltarDoLead e pelo item aceso do menu.
  function navigate(nav: SdrNav) {
    setActiveNav(nav);
    setSelectedLeadId(null);
    setEditingCadenceId(null);
  }

  // DE ONDE O LEAD FOI ABERTO (Bruno, 01/09).
  //
  // Antes o "Voltar" ia sempre pra tela de Leads, viesse de onde viesse. Quem
  // abria um lead a partir da Agenda pra conferir uma coisa era cuspido numa
  // lista que não estava usando e tinha que refazer o caminho inteiro — o
  // suficiente pra deixar de abrir o lead, que é justamente onde está o
  // contexto da reunião.
  function openLeadDetail(leadId: string) {
    // A origem é a tela em que a pessoa ESTAVA. Abrir um lead a partir de outro
    // lead não empilha: continua valendo a tela de onde a sequência começou,
    // senão o Voltar viraria um vaivém entre dois cards.
    if (activeNav !== "lead-detail") setOrigemDoLead(activeNav);
    setSelectedLeadId(leadId);
    setActiveNav("lead-detail");
  }

  /** Volta pra tela de onde o lead foi aberto (Leads, quando não se sabe). */
  function voltarDoLead() {
    navigate(origemDoLead ?? "leads");
  }

  // AVISOS (0196): o aviso abre "#comercial/<tela>/<id>" — lead, solicitação,
  // painel ou agenda. O Comercial não navega por endereço, então lê e limpa.
  const abrirDoAviso = useRef<(h: string) => void>(() => undefined);
  abrirDoAviso.current = (h: string) => {
    const [, tela, id] = h.replace(/^#\/?/, "").split("/");
    const alvo = id ? decodeURIComponent(id) : null;
    if (tela === "lead" && alvo) openLeadDetail(alvo);
    else if (tela === "solicitacoes" && canAccessNav(userRole, "solicitacoes")) { setSolicitacaoAberta(alvo); navigate("solicitacoes"); }
    else if ((tela === "painel" || tela === "minha-agenda") && canAccessNav(userRole, tela)) navigate(tela);
  };
  useEffect(() => {
    const ler = () => {
      const h = window.location.hash;
      if (!h.startsWith("#comercial/")) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      abrirDoAviso.current(h);
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);

  function openCadenceCreate() {
    setEditingCadenceId(null);
    setActiveNav("cadencia-criar");
  }

  function openCadenceEdit(cadenceId: string) {
    setEditingCadenceId(cadenceId);
    setActiveNav("cadencia-editar");
  }

  const visualActiveNav: SdrNav =
    // Aceso fica o item de ONDE o lead foi aberto: quem veio da Agenda continua
    // vendo "Minha Agenda" marcada, que é o que diz onde o Voltar vai cair.
    activeNav === "lead-detail" ? (origemDoLead ?? "leads") :
    activeNav === "cadencia-criar" || activeNav === "cadencia-editar" ? "cadencias" :
    activeNav;

  // ── MENU DO REDESIGN (out/2026) ─────────────────────────────────────────
  // O menu de cima (Execução / Gestão / Desempenho / Configurações) virou a
  // sidebar comum dos 4 setores (HANDOFF.md, "Menus por setor"). As permissões
  // continuam as de sempre: `filteredMenu` já filtrou por papel e ordenou a
  // Execução por ORDEM_EXECUCAO; aqui só se reagrupa e se põe ícone.
  const permitido = new Set(filteredMenu.flatMap((e) => (isGroup(e) ? e.items.map((i) => i.id) : [e.id])));
  const badgeDe = (id: SdrNav) => {
    for (const e of filteredMenu) if (isGroup(e)) { const it = e.items.find((i) => i.id === id); if (it) return it; }
    return undefined;
  };
  const ICONE_NAV: Partial<Record<SdrNav, ReactNode>> = {
    painel: Icon.fila, "minha-agenda": Icon.agenda, whatsapp: Icon.chat, "atendimento-ia": Icon.ia,
    leads: Icon.pessoas, cobertura: Icon.carteira, cadencias: Icon.cadencia, disparos: Icon.disparo, reunioes: Icon.video,
    solicitacoes: Icon.inbox, propostas: Icon.doc, dashboard: Icon.grafico, configuracoes: Icon.config,
  };
  const ROTULO_NAV: Partial<Record<SdrNav, string>> = {
    painel: "Fila de hoje", "minha-agenda": "Minha agenda", cobertura: "Minha carteira", reunioes: "Reuniões", whatsapp: "WhatsApp",
  };
  const item = (id: SdrNav, label: string): ShellItem | null => {
    if (!permitido.has(id)) return null;
    const b = badgeDe(id);
    return { id, label: ROTULO_NAV[id] ?? label, icon: ICONE_NAV[id], count: b?.badge, late: b?.alerta };
  };
  // Bruno, 26/10: "Minha agenda" é do closer (o SDR vê as reuniões em Gestão ›
  // Reuniões); "Atendimento IA" sai do menu até ser configurado; Cadências é da
  // gestão (master). O SDR fica com Gestão = Leads, Minha carteira e Reuniões.
  const ehSdr = userRole === "sdr";
  const FORA_DO_MENU = new Set<SdrNav>(["cobertura", "atendimento-ia", ...(ehSdr ? (["cadencias"] as SdrNav[]) : [])]);
  const execucao = (ORDEM_EXECUCAO[userRole] ?? ["painel", "minha-agenda", "whatsapp"])
    .concat(["painel", "minha-agenda", "whatsapp"])
    // SDR: "Reuniões" entra no lugar da "Minha agenda" (Bruno, 26/10) — ele
    // acompanha as reuniões que vão acontecer, não só quem vai entrar.
    .map((id) => (ehSdr && id === "minha-agenda" ? "reunioes" : id))
    .filter((id, i, arr) => arr.indexOf(id) === i && !FORA_DO_MENU.has(id as SdrNav)) as SdrNav[];
  // Desempenho: Visão Geral, Análises & Metas e Distribuição viram ABAS de uma
  // tela só; o item do menu abre a primeira que o papel pode ver.
  const desempenhoAbas = (["dashboard", "analises", "monitor-leads"] as SdrNav[]).filter((id) => permitido.has(id));
  const grupos: ShellGroup[] = [
    { label: "Execução", items: execucao.map((id) => item(id, id)).filter(Boolean) as ShellItem[] },
    { label: "Gestão", items: [item("leads", "Leads"), item("cobertura", "Minha carteira"), ...(ehSdr ? [] : [item("cadencias", "Cadências"), item("disparos", "Disparo em massa"), item("reunioes", "Reuniões")])].filter(Boolean) as ShellItem[] },
    { label: "Com outros setores", items: [item("solicitacoes", "Solicitações"), item("propostas", "Propostas")].filter(Boolean) as ShellItem[] },
    { label: "Análise", items: [
      ...(desempenhoAbas.length ? [{ id: desempenhoAbas[0], label: "Desempenho", icon: Icon.grafico }] : []),
      item("configuracoes", "Configurações"),
    ].filter(Boolean) as ShellItem[] },
  ].filter((g) => g.items.length > 0);
  const ativoNoMenu = (desempenhoAbas as string[]).includes(visualActiveNav) ? desempenhoAbas[0] : visualActiveNav;

  const ROTULO_DESEMPENHO: Partial<Record<SdrNav, string>> = { dashboard: "Visão geral", analises: "Análises e metas", "monitor-leads": "Distribuição de leads" };

  return (
    <AppShell
      setor="comercial"
      groups={grupos}
      active={ativoNoMenu}
      onNavigate={(id) => navigate(id as SdrNav)}
      notifications={
        <span className="qs-notif-up">
          <NotificationsPanel onGoToTasks={() => setActiveNav("painel")} onOpenLead={openLeadDetail} />
        </span>
      }
      userActions={[
        { id: "telefone", label: "Configurar telefone", icon: Icon.telefone, onClick: reopenTelefoneOnboarding },
      ]}
      comercial={comercialDividido(currentUser, "sdr")}
      after={activeNav !== "whatsapp" ? (
        // Painel de atendimento — divide a tela; montado uma única vez e persistente.
        // Cerca: uma falha no painel de atendimento NÃO pode derrubar o Painel junto.
        // Na ABA de WhatsApp o dock não é montado (dois atendimentos na mesma tela
        // assinam o realtime duas vezes e apitam em dobro).
        <ErroDeParte parte="o WhatsApp" modo="discreto">
          <QsWaDock onOpenLead={openLeadDetail} />
        </ErroDeParte>
      ) : undefined}
      mainClassName="qs-main--comercial"
    >
      {/* A bolinha flutuante (0196) tinha item no menu do avatar; segue lá. */}
      <span hidden><BotaoBolinhaDoMenu /></span>

      {/* Onboarding do telefone (BravoTech) — só na 1ª vez, por máquina */}
      <TelefoneOnboarding user={currentUser ? { id: currentUser.id, name: currentUser.name } : null} />

      {/* Retrospectiva do dia — modal de boas-vindas, 1x por dia por usuário */}
      <RetrospectivaModal user={currentUser ? { id: currentUser.id, name: currentUser.name } : null} />

      {/* UI flutuante da ligação WebRTC (VoxFree) — só aparece durante a chamada */}
      <WebphoneWidget />
      {/* Ligação pelo número oficial (Cloud API Calling) — some quando não há chamada. */}
      <LigacaoOficialWidget />
      {/* Mesa do supervisor (0215): batida de presença a cada 60 s; não desenha nada. */}
      <Presenca tela={activeNav} leadId={activeNav === "lead-detail" ? selectedLeadId : null} />

      {/* Desempenho: as três telas viraram abas de uma só (redesign). */}
      {(desempenhoAbas as string[]).includes(activeNav) && desempenhoAbas.length > 1 && (
        <div className="px-4 sm:px-6 pt-5">
          <Segmented label="Desempenho" value={activeNav} onChange={(v) => navigate(v as SdrNav)}
            options={desempenhoAbas.map((id) => ({ value: id, label: ROTULO_DESEMPENHO[id] ?? id }))} />
        </div>
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      {/* A aba de WhatsApp gerencia a própria rolagem (lista e conversa rolam
          separadas). Deixar o overflow do <main> ligado criaria uma segunda
          barra e faria a conversa "escapar" da tela ao chegar mensagem. */}
      <main className={`flex-1 min-h-0 ${activeNav === "whatsapp" ? "overflow-hidden" : "overflow-y-auto"}`}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full py-24 text-sm text-gray-400">
              Carregando…
            </div>
          }
        >
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
              onBack={voltarDoLead}
            />
          </PageErrorBoundary>
        )}
        {activeNav === "disparos" && (
          <PageErrorBoundary pageName="Disparo em massa">
            <DisparosPage setor="comercial" />
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
            {/* Funil (0095) pra gestor e SDR; o closer segue na tela anterior até ganhar a dele. */}
            {userRole === "closer" ? <SdrDashboard /> : <VisaoGeralFunil onIrParaPainel={() => navigate("painel")} />}
          </PageErrorBoundary>
        )}
        {activeNav === "analises" && (
          <PageErrorBoundary pageName="Análises & Metas">
            <AnalisesPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "monitor-leads" && (
          <PageErrorBoundary pageName="Monitor de leads">
            <MonitorLeadsPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "cobertura" && (
          <PageErrorBoundary pageName="Carteira de Leads">
            <CarteiraPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "atendimento-ia" && (
          <PageErrorBoundary pageName="Atendimento IA">
            <PipelineIAPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "minha-agenda" && (
          <PageErrorBoundary pageName="Minha Agenda">
            <MinhaAgendaPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "whatsapp" && (
          <PageErrorBoundary pageName="WhatsApp">
            <WaPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "reunioes" && (
          <PageErrorBoundary pageName="Reuniões">
            <MeetingsPage onOpenLead={openLeadDetail} />
          </PageErrorBoundary>
        )}
        {activeNav === "solicitacoes" && (
          <PageErrorBoundary pageName="Solicitações">
            <ComCoresDaCentral>
              <div className="px-4 sm:px-6 py-6">
                <SolicitacoesPage setor="comercial" abrirId={solicitacaoAberta} onAbrirId={setSolicitacaoAberta}
                  onMudou={recontarCentral} links={{ onAbrirLead: openLeadDetail, onAbrirProposta: (id) => { setPropostaAberta(id); setActiveNav("propostas"); } }} />
              </div>
            </ComCoresDaCentral>
          </PageErrorBoundary>
        )}
        {activeNav === "propostas" && (
          <PageErrorBoundary pageName="Propostas">
            <ComCoresDaCentral>
              <div className="px-4 sm:px-6 py-6">
                <PropostasPage setor="comercial" abrirId={propostaAberta} onAbrirId={setPropostaAberta} onMudou={recontarAprovacoes} />
              </div>
            </ComCoresDaCentral>
          </PageErrorBoundary>
        )}
        {activeNav === "configuracoes" && (
          <PageErrorBoundary pageName="Configurações">
            <SettingsPage />
          </PageErrorBoundary>
        )}
        </Suspense>
      </main>

      {/* Toasts globais (erros de gravação, confirmações) */}
      <GlobalToasts />
      <ConfirmDialog />
      <AvisoDeVersao />

      {/* Busca global Ctrl+K */}
      <CommandPalette onOpenLead={openLeadDetail} />
    </AppShell>
  );
}
