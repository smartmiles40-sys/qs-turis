// src/closer/CloserApp.tsx
// -----------------------------------------------------------------------------
// ÁREA DO CLOSER (22/10/2026). Até aqui o closer usava a casca do SDR
// (SdrLayout) com meia dúzia de telas a menos. Agora ele tem a área dele, na
// casca comum das áreas (src/area/CascaDeArea, a mesma do Financeiro e de
// Operações), cor própria (violeta) e endereço #closer/<tela>/<id>.
//
// QUEM CAI AQUI: o papel closer, direto ao entrar pela porta do Comercial (o
// closer é do Comercial — não ganhou porta nova no login). Admin e gestor do
// Comercial abrem pelo menu do avatar no Comercial ("Área do Closer") e voltam
// pelo item "Abrir o Comercial (SDR)". Ver App.tsx e ./lib (podeAbrirAreaCloser).
//
// O QUE TEM: o PIPELINE (0174) com a ficha de fechamento (0176) é o Início.
// O resto REAPROVEITA as telas que o closer já usava no Comercial — agenda,
// WhatsApp, reuniões, leads, solicitações e propostas —
// sem reescrever nada. Desde 26/10 agenda, atividades e reuniões ficam numa
// tela só, em abas (./ReunioesCloser).
// -----------------------------------------------------------------------------
import { Component, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import CascaDeArea, { ICONES_AREA, hashDaArea, lerHashDaArea, limparHashDaArea, type GrupoDoMenu } from "@/area/CascaDeArea";
import { REL_CSS } from "@/rel/ui";
import { lazyPagina } from "@/lib/qs/lazyPagina";
import { bolinhaDaCentral, useContagemSolicitacoes } from "@/solicitacoes/useContagem";
import { useAprovacoesNovas } from "@/propostas/lib";
import { SELO_PROPOSTAS } from "@/propostas/disponivel";
import ErroDeParte from "@/components/sdr/ErroDeParte";
import GlobalToasts from "@/components/sdr/GlobalToasts";
import ConfirmDialog from "@/components/sdr/ConfirmDialog";
import AvisoDeVersao from "@/components/sdr/AvisoDeVersao";
import CommandPalette from "@/components/sdr/CommandPalette";
import WebphoneWidget from "@/components/sdr/telefone/WebphoneWidget";
import LigacaoOficialWidget from "@/components/sdr/telefone/LigacaoOficialWidget";
import Presenca from "@/controle-comercial/Presenca";
import PipelinePage from "./PipelinePage";
import ReunioesCloser from "./ReunioesCloser";
import { abaDoCloser, hashDaAgenda } from "@/lib/qs/agendaStatus";

const WaPage = lazyPagina(() => import("@/components/sdr/wa/WaPage"));
const LeadsPage = lazyPagina(() => import("@/components/sdr/leads/LeadsPage"));
const LeadDetailPage = lazyPagina(() => import("@/components/sdr/leads/LeadDetailPage"));
// 03/11: o desempenho do closer é dele (R.R., no-show, SAL, propostas, faturamento) — não mais o painel do SDR.
const DesempenhoCloser = lazyPagina(() => import("./DesempenhoCloser"));
const SolicitacoesPage = lazyPagina(() => import("@/solicitacoes/SolicitacoesPage"));
const PropostasPage = lazyPagina(() => import("@/propostas/PropostasPage"));
const PropostaEditor = lazyPagina(() => import("@/propostas/PropostaEditor"));
const QsWaDock = lazyPagina(() => import("@/components/sdr/wa/QsWaDock"));
const ContratoConfigPage = lazyPagina(() => import("./ContratoConfigPage"));
// Minhas comissões (06/11, 0327): a planilha card a card só do closer logado.
const MinhasComissoesPage = lazyPagina(() => import("@/fin/comissoes/MinhasComissoesPage"));

/** Cor do Closer: violeta (#6D28D9 com texto branco = 7:1, WCAG AA). */
const CLOSER_CSS = `${REL_CSS}
:root { --rel: #6D28D9; --rel-hover: #5B21B6; --rel-ink: #5B21B6; --rel-soft: #F1EBFD; --closer: #6D28D9; }
html.dark { --rel-ink: #C4B5FD; --rel-soft: rgba(167, 139, 250, .16); }
.rel-input:focus, .rel-input:focus-visible { box-shadow: 0 0 0 3px rgba(109, 40, 217, .25); }
/* Celular (04/11): o botão do WhatsApp e a bolinha de avisos ficam por cima do
   fim da tela ("Anotar", "Salvar" do cartão). Folga no fim da rolagem; fora o
   WhatsApp, que cuida da própria altura. Só abaixo de 768 px. */
@media (max-width: 767px) {
  .qs-area-conteudo:not(:has(.qs-closer-wa)) { padding-bottom: calc(150px + env(safe-area-inset-bottom)); }
}
`;

const PREFIXO = "closer";
const TELAS = ["inicio", "pipeline", "agenda", "painel", "whatsapp", "reunioes", "leads", "lead", "desempenho", "solicitacoes", "propostas", "proposta-nova", "contrato", "comercial", "comissoes"] as const;
type Tela = (typeof TELAS)[number];
interface Rota { tela: Tela; id?: string }

function lerRota(): Rota {
  const r = lerHashDaArea(PREFIXO);
  return (TELAS as readonly string[]).includes(r.tela) ? (r as Rota) : { tela: "inicio" };
}

/** Uma tela que quebra não derruba a área inteira. */
class Cerca extends Component<{ nome: string; children: ReactNode }, { erro: boolean }> {
  state = { erro: false };
  static getDerivedStateFromError() { return { erro: true }; }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="rel-card p-6 text-center max-w-md mx-auto">
        <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>Erro ao carregar {this.props.nome}</p>
        <button className="mt-3 text-[13px] font-semibold underline" style={{ color: "var(--rel-ink)" }} onClick={() => this.setState({ erro: false })}>Tentar de novo</button>
      </div>
    );
  }
}

export default function CloserApp() {
  const { currentUser } = useQsAuth();
  const [rota, setRota] = useState<Rota>(lerRota);
  const [central, recontarCentral] = useContagemSolicitacoes("comercial");
  const [aprovacoes, recontarAprovacoes] = useAprovacoesNovas(currentUser?.id, "comercial");
  // De onde o lead foi aberto, pro "Voltar" do detalhe devolver pra lá.
  const origem = useRef<Rota>({ tela: "inicio" });
  const nomeNovaProposta = useRef("");

  useEffect(() => {
    const onHash = () => setRota(lerRota());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Endereço sempre dentro da área (o App olha o #closer pra saber que a gestão está aqui).
  useEffect(() => {
    if (!window.location.hash.startsWith(`#${PREFIXO}`)) history.replaceState(null, "", window.location.pathname + window.location.search + hashDaArea(PREFIXO, rota));
  }, [rota]);

  // Endereço antigo da agenda (#closer/reunioes/…, #closer/painel, #closer/agenda
  // sem aba) vira o novo (#closer/agenda/<aba>) sem empilhar no histórico.
  useEffect(() => {
    const aba = abaDoCloser(rota.tela, rota.id);
    if (!aba) return;
    const alvo = hashDaAgenda("closer", aba);
    if (window.location.hash !== alvo) history.replaceState(null, "", window.location.pathname + window.location.search + alvo);
  }, [rota]);

  const ir = useCallback((r: Rota) => {
    if (r.tela === "comercial") {
      // Gestão volta pro Comercial (SdrLayout): basta sair do endereço #closer.
      limparHashDaArea();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    window.location.hash = hashDaArea(PREFIXO, r);
    setRota(r);
    window.scrollTo(0, 0);
  }, []);
  const rotaAtual = useRef(rota);
  rotaAtual.current = rota;
  const abrirLead = useCallback((leadId: string) => {
    if (rotaAtual.current.tela !== "lead") origem.current = rotaAtual.current;
    ir({ tela: "lead", id: leadId });
  }, [ir]);

  if (!currentUser) return null;
  // Bruno, 26/10: a parte de Gestão do closer só abre pro master (admin).
  const gestao = currentUser.role === "admin";
  // AGENDA (03/11, desenho do Bruno): #closer/agenda/<aba>. Os endereços
  // antigos (#closer/agenda, #closer/painel, #closer/reunioes/<aba>) caem na
  // aba certa (abaDoCloser) e o efeito lá em cima reescreve o endereço.
  const telaPedida = rota.tela === "inicio" ? "pipeline" : rota.tela;
  const abaAgenda = abaDoCloser(telaPedida, rota.id);
  const tela = abaAgenda ? "agenda" : telaPedida;
  const deOnde = origem.current.tela === "inicio" ? "pipeline" : abaDoCloser(origem.current.tela, origem.current.id) ? "agenda" : origem.current.tela;
  const ativo = tela === "lead" ? deOnde : tela === "proposta-nova" ? "propostas" : tela;

  const grupos: GrupoDoMenu[] = [
    { id: "vendas", rotulo: "Vendas", icone: ICONES_AREA.dinheiro, itens: [
      { id: "pipeline", rotulo: "Pipeline" },
      { id: "agenda", rotulo: "Agenda" },
      { id: "whatsapp", rotulo: "WhatsApp" },
    ] },
    { id: "demandas", rotulo: "Demandas", icone: ICONES_AREA.pedidos, itens: [
      { id: "propostas", rotulo: "Propostas", badge: aprovacoes || undefined, selo: SELO_PROPOSTAS },
      { id: "solicitacoes", rotulo: "Solicitações", ...bolinhaDaCentral(central) },
    ] },
    { id: "consulta", rotulo: "Consulta", icone: ICONES_AREA.lista, itens: [
      { id: "leads", rotulo: "Leads" },
      { id: "desempenho", rotulo: "Desempenho" },
      { id: "comissoes", rotulo: "Minhas comissões" },
    ] },
    ...(gestao ? [{ id: "outras", rotulo: "Gestão", icone: ICONES_AREA.equipe, itens: [
      { id: "contrato", rotulo: "Configurar contrato" },
    ] }] : []),
  ];

  const links = {
    onAbrirLead: abrirLead,
    onNovaProposta: (leadId: string, nome: string) => { nomeNovaProposta.current = nome; ir({ tela: "proposta-nova", id: leadId }); },
    onAbrirProposta: (id: string) => ir({ tela: "propostas", id }),
    onAbrirSolicitacao: (id: string) => ir({ tela: "solicitacoes", id }),
  };

  return (
    <CascaDeArea setor="comercial" nome="Closer" subtitulo="pipeline e fechamento" css={CLOSER_CSS}
      grupos={grupos} ativo={ativo} onIr={(t) => ir({ tela: (t === "inicio" ? "pipeline" : t) as Tela })} chaveMenu="qs_closer_menu_aberto">
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>}>
        {tela === "pipeline" && (
          <Cerca nome="o pipeline">
            <PipelinePage abrirId={rota.id ?? null} onAbrirId={(id) => ir(id ? { tela: "pipeline", id } : { tela: "pipeline" })} links={links} />
          </Cerca>
        )}
        {tela === "contrato" && (
          // Volta do Google cai aqui: #closer/contrato/conectado (ou /erro-…).
          <Cerca nome="a configuração do contrato"><ContratoConfigPage /></Cerca>
        )}
        {tela === "whatsapp" && (
          // O WhatsApp cuida da própria rolagem: ocupa a altura da tela inteira.
          <div className="qs-closer-wa -mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8 h-[calc(100dvh-56px)] lg:h-dvh">
            <Cerca nome="o WhatsApp"><WaPage onOpenLead={abrirLead} /></Cerca>
          </div>
        )}
        {tela === "agenda" && abaAgenda && (
          <Cerca nome="a agenda">
            <ReunioesCloser aba={abaAgenda} onAba={(a) => ir({ tela: "agenda", id: a })} onOpenLead={abrirLead} />
          </Cerca>
        )}
        {tela === "leads" && <Cerca nome="os leads"><LeadsPage onOpenLead={abrirLead} onOpenCadenceCreate={() => undefined} /></Cerca>}
        {tela === "lead" && rota.id && (
          <Cerca nome="o lead"><LeadDetailPage leadId={rota.id} papel="closer" onBack={() => ir(origem.current)} /></Cerca>
        )}
        {tela === "desempenho" && <Cerca nome="o desempenho"><DesempenhoCloser /></Cerca>}
        {tela === "comissoes" && <Cerca nome="as comissões"><MinhasComissoesPage moldura={false} /></Cerca>}
        {tela === "solicitacoes" && (
          <Cerca nome="as solicitações">
            <SolicitacoesPage setor="comercial" abrirId={rota.id ?? null} onMudou={recontarCentral}
              onAbrirId={(id) => ir(id ? { tela: "solicitacoes", id } : { tela: "solicitacoes" })}
              links={{ onAbrirLead: abrirLead, onAbrirProposta: (id) => ir({ tela: "propostas", id }) }} />
          </Cerca>
        )}
        {tela === "propostas" && (
          <Cerca nome="as propostas">
            <PropostasPage setor="comercial" abrirId={rota.id ?? null} onMudou={recontarAprovacoes}
              onAbrirId={(id) => ir(id ? { tela: "propostas", id } : { tela: "propostas" })} />
          </Cerca>
        )}
        {tela === "proposta-nova" && rota.id && (
          // Proposta já amarrada ao cliente: quando for enviada/aprovada, o cartão anda sozinho.
          <Cerca nome="a proposta">
            <PropostaEditor key={rota.id} id={null} setor="comercial" inicial={{ lead_id: rota.id, cliente_nome: nomeNovaProposta.current }}
              onVoltar={() => ir({ tela: "pipeline" })} onAbrir={(id) => { recontarAprovacoes(); ir({ tela: "propostas", id }); }} />
          </Cerca>
        )}
      </Suspense>

      {/* As mesmas peças flutuantes do Comercial: atendimento, ligação, avisos, busca Ctrl+K. */}
      {tela !== "whatsapp" && (
        <ErroDeParte parte="o WhatsApp" modo="discreto">
          <Suspense fallback={null}><QsWaDock onOpenLead={abrirLead} /></Suspense>
        </ErroDeParte>
      )}
      <WebphoneWidget />
      <LigacaoOficialWidget />
      {/* Mesa do supervisor (0215): batida de presença; não desenha nada. */}
      <Presenca tela={tela === "pipeline" && rota.id ? "closer:negocio" : `closer:${tela}`} leadId={tela === "lead" ? rota.id ?? null : null} />
      <GlobalToasts />
      <ConfirmDialog />
      <AvisoDeVersao />
      <CommandPalette onOpenLead={abrirLead} />
    </CascaDeArea>
  );
}
