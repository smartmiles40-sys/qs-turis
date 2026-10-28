// src/rel/RelApp.tsx
// -----------------------------------------------------------------------------
// ÁREA DE RELACIONAMENTO (pós-venda) — roadmap de 09/10/2026, Fases 1 a 5.
//
// Um app à parte dentro do QS: menu, telas e cor próprios, nada reaproveitado
// do Comercial (pedido do Bruno: "um sistema 100% do zero"). O que é comum aos
// dois é só o que TEM que ser: o login, o banco e o cliente.
//
// MENU EM GRUPOS (Bruno, 09/10: "está ficando muita coisa na aba esquerda").
// Cada grupo abre e fecha; o grupo da tela aberta abre sozinho, e um grupo
// fechado mostra a soma das bolinhas dos itens dele — nada que pede atenção
// fica escondido. Configurações saiu da lista e virou o ícone de engrenagem
// perto do nome de quem está logado.
//
// Navegação pelo endereço (#rel/clientes, #rel/viagem/<id>...): o botão
// "voltar" do navegador funciona e dá pra mandar o link de uma tela pra
// alguém do time.
// -----------------------------------------------------------------------------
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { supabase } from "@/lib/supabase";
import { carregarResumoDoMenu, type ResumoDoMenu } from "./lib/clientes";
import { contarEsperando } from "./lib/whatsapp";
import { COM_ACOMPANHAMENTO, hojeSP } from "./lib/viagens";
import { Etiqueta, REL_CSS } from "./ui";
import { contarGruposNovos } from "./lib/grupos";
import { podeGerirRelacionamento, podeGerirTime } from "./equipe/permissao";
import { usePode } from "./equipe/usePode";
import { bolinhaDaCentral, useContagemSolicitacoes } from "@/solicitacoes/useContagem";
import { useAprovacoesNovas } from "@/propostas/lib";
import type { TelaExp } from "@/expedicoes/contexto";
import SinoDeAvisos from "@/avisos/SinoDeAvisos";
import AppShell, { type ShellGroup, type ShellItem } from "@/components/ui/AppShell";
import { Icon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui";

// Telas carregadas sob demanda (22/10, desempenho): o Rel abre só com o menu e
// o Início; cada tela baixa o seu pedaço na primeira vez que é aberta (o
// Atendimento, com emojis, editor de foto e modelos da Meta, é o maior).
const ClientesPage = lazy(() => import("./clientes/ClientesPage"));
const ClienteFicha = lazy(() => import("./clientes/ClienteFicha"));
const ArrumarCadastrosPage = lazy(() => import("./clientes/ArrumarCadastrosPage"));
const AtendimentoPage = lazy(() => import("./atendimento/AtendimentoPage"));
const GruposPage = lazy(() => import("./atendimento/GruposPage"));
const ConfigPage = lazy(() => import("./config/ConfigPage"));
const ViagensPage = lazy(() => import("./viagens/ViagensPage"));
const EsteiraPage = lazy(() => import("./viagens/EsteiraPage"));
const ViagemPage = lazy(() => import("./viagens/ViagemPage"));
const AlertasPage = lazy(() => import("./viagens/AlertasPage"));
const DisparosPage = lazy(() => import("./disparos/DisparosPage"));
const AutomacoesPage = lazy(() => import("./disparos/AutomacoesPage"));
const PesquisasPage = lazy(() => import("./pos/PesquisasPage"));
const RecompraPage = lazy(() => import("./pos/RecompraPage"));
// 0218: o Rel vende pra base (a recompra não vai mais pro Comercial)
const PipelinePage = lazy(() => import("./vendas/PipelinePage"));
const KpisPage = lazy(() => import("./kpis/KpisPage"));
const WhatsAppPage = lazy(() => import("./whatsapp/WhatsAppPage"));
const EquipePage = lazy(() => import("./equipe/EquipePage"));
const ModelosPage = lazy(() => import("./modelos/ModelosPage"));
const AgendaPage = lazy(() => import("./agenda/AgendaPage"));
const SolicitacoesPage = lazy(() => import("@/solicitacoes/SolicitacoesPage"));
const PropostasPage = lazy(() => import("@/propostas/PropostasPage"));

// Expedições (21/10): o Rel vê o módulo de Expedições do QS em modo só-leitura
// (as policies já barram a escrita — is_readonly) e decide inscrições.
// Telas com prefixo "exp-" pra não bater com as do Rel ("clientes", "passageiros").
const ExpedicoesArea = lazy(() => import("@/expedicoes/ExpedicoesArea"));
const REL_EXP = { "exp-expedicoes": "expedicoes", "exp-pacotes": "pacotes", "exp-passageiros": "passageiros", "exp-inscricoes": "inscricoes", "exp-avisos": "avisos" } as const satisfies Record<string, TelaExp>;
type TelaRelExp = keyof typeof REL_EXP;
const ehRelExp = (t: string): t is TelaRelExp => t in REL_EXP;

type Rota =
  | { tela: "inicio" }
  | { tela: "atendimento"; id?: string } | { tela: "grupos"; id?: string } | { tela: "chamados" } | { tela: "solicitacoes"; id?: string } | { tela: "propostas"; id?: string } | { tela: "modelos" } | { tela: "agenda" } | { tela: "prazo" } | { tela: "kpis" } | { tela: "whatsapp" } | { tela: "equipe" }
  | { tela: "clientes" } | { tela: "ficha"; id: string } | { tela: "duplicados" } | { tela: "cadastros" }
  | { tela: "esteira" } | { tela: "viagens" } | { tela: "viagem"; id: string } | { tela: "alertas" }
  | { tela: "disparos" } | { tela: "automacoes" } | { tela: "pesquisas" } | { tela: "recompra" } | { tela: "vendas"; id?: string }
  | { tela: "config" } | { tela: "faxina" } | { tela: "mais" } | { tela: TelaRelExp; id?: string };
type Tela = Rota["tela"];

const SIMPLES: Tela[] = ["inicio", "chamados", "modelos", "agenda", "prazo", "kpis", "whatsapp", "equipe", "clientes", "duplicados", "cadastros", "esteira", "viagens", "alertas", "disparos", "automacoes", "pesquisas", "recompra", "config", "faxina", "mais"];

/** Item do menu que abre/fecha o grupo "Mais" (não é tela). */
const MAIS_ID = "__mais";

function lerRota(): Rota {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [area, tela, id] = h.split("/");
  if (area !== "rel") return { tela: "inicio" };
  if (tela === "cliente" && id) return { tela: "ficha", id };
  if (tela === "viagem" && id) return { tela: "viagem", id };
  if (tela === "atendimento") return id ? { tela: "atendimento", id } : { tela: "atendimento" };
  if (tela === "grupos") return id ? { tela: "grupos", id: decodeURIComponent(id) } : { tela: "grupos" };
  if (tela === "solicitacoes") return id ? { tela: "solicitacoes", id } : { tela: "solicitacoes" };
  if (tela === "propostas") return id ? { tela: "propostas", id } : { tela: "propostas" };
  if (tela === "vendas") return id ? { tela: "vendas", id } : { tela: "vendas" };
  if (ehRelExp(tela)) return id ? { tela, id: decodeURIComponent(id) } : { tela };
  if ((SIMPLES as string[]).includes(tela)) return { tela } as Rota;
  return { tela: "inicio" };
}

function hashDe(r: Rota) {
  if (r.tela === "ficha") return `#rel/cliente/${r.id}`;
  if (r.tela === "viagem") return `#rel/viagem/${r.id}`;
  if (r.tela === "atendimento" && r.id) return `#rel/atendimento/${r.id}`;
  if (r.tela === "grupos" && r.id) return `#rel/grupos/${encodeURIComponent(r.id)}`;
  if (r.tela === "solicitacoes" && r.id) return `#rel/solicitacoes/${r.id}`;
  if (r.tela === "propostas" && r.id) return `#rel/propostas/${r.id}`;
  if (r.tela === "vendas" && r.id) return `#rel/vendas/${r.id}`;
  if (ehRelExp(r.tela) && "id" in r && r.id) return `#rel/${r.tela}/${encodeURIComponent(r.id)}`;
  return r.tela === "inicio" ? "#rel" : `#rel/${r.tela}`;
}

/** Sai do endereço do Relacionamento (ao trocar de área ou sair). */
function limparHash() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

// ── Contadores do menu ──
interface Contadores {
  esperando: number; foraDoPrazo: number; duplicados: number;
  alertasAltos: number; chamadosVencidos: number;
  /** 0142: grupos com mensagem nova e quantos marcaram o número */
  gruposNovos?: number; gruposMencao?: number;
  /** 0184: viagens que eu cuido (vão acontecer) e as que ninguém cuida */
  minhasViagens?: number; semDono?: number;
}

async function contarDonos(eu: string): Promise<{ minhasViagens: number; semDono: number }> {
  const base = () => supabase.from("rel_viagens_v").select("id", { count: "exact", head: true })
    .eq("status", "ativa").in("fase", ["antes", "em_viagem"]).in("acompanhamento", ["completo", "leve"]);
  const [m, s] = await Promise.all([base().eq("responsavel_id", eu), base().is("responsavel_id", null)]);
  return { minhasViagens: m.count ?? 0, semDono: s.count ?? 0 };
}

async function contarAlertasEChamados(): Promise<{ alertasAltos: number; chamadosVencidos: number }> {
  const [a, c] = await Promise.all([
    supabase.from("rel_alertas").select("tipo", { count: "exact", head: true }).eq("gravidade", "alta"),
    supabase.from("rel_chamados").select("id", { count: "exact", head: true }).neq("status", "resolvido").lt("prazo", new Date().toISOString()),
  ]);
  return { alertasAltos: a.count ?? 0, chamadosVencidos: c.count ?? 0 };
}

// ── Tela inicial ──
interface AlertaCurto { tipo: string; gravidade: string; titulo: string; detalhe: string; cliente_id: string | null; viagem_id: string | null }

function Inicio({ resumo, cont, nome, ir }: { resumo: ResumoDoMenu | null; cont: Contadores | null; nome: string; ir: (r: Rota) => void }) {
  const [alertas, setAlertas] = useState<AlertaCurto[] | null>(null);
  const [embarques, setEmbarques] = useState<{ id: string; titulo: string; data_embarque: string; passageiros: number }[]>([]);
  useEffect(() => {
    supabase.from("rel_alertas").select("tipo, gravidade, titulo, detalhe, cliente_id, viagem_id").in("gravidade", ["alta", "media"]).order("data").limit(8)
      .then(({ data }) => setAlertas((data ?? []) as AlertaCurto[]));
    // dia de São Paulo (o UTC já virava o dia às 21h) e só o que pede acompanhamento (0148: seguro sozinho não é embarque)
    const hoje = hojeSP();
    const em30 = new Date(new Date(`${hoje}T12:00:00Z`).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    supabase.from("rel_viagens_v").select("id, titulo, data_embarque, passageiros").eq("status", "ativa").in("acompanhamento", COM_ACOMPANHAMENTO).gte("data_embarque", hoje).lte("data_embarque", em30).order("data_embarque").limit(6)
      .then(({ data }) => setEmbarques((data ?? []) as typeof embarques));
  }, []);

  const cartoes: { rotulo: string; valor: number | undefined; dica: string; rota: Rota; tom?: "aviso" | "erro" }[] = [
    { rotulo: "Esperando resposta", valor: cont?.esperando, dica: cont?.foraDoPrazo ? `${cont.foraDoPrazo} fora do prazo` : "no WhatsApp", rota: { tela: "atendimento" }, tom: cont?.foraDoPrazo ? "erro" : undefined },
    { rotulo: "Alertas importantes", valor: cont?.alertasAltos, dica: "passaporte vencendo, esteira atrasada…", rota: { tela: "alertas" }, tom: cont?.alertasAltos ? "aviso" : undefined },
    { rotulo: "Chamados vencidos", valor: cont?.chamadosVencidos, dica: "passaram do prazo", rota: { tela: "chamados" }, tom: cont?.chamadosVencidos ? "erro" : undefined },
    { rotulo: "Clientes", valor: resumo?.clientes, dica: resumo?.duplicados ? `${resumo.duplicados} possíveis duplicados` : "fichas ativas", rota: { tela: "clientes" } },
  ];
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const cor = (t?: "aviso" | "erro") => (t === "erro" ? { bg: "var(--err-bg)", line: "var(--err-line)", ink: "var(--err-ink)" } : t === "aviso" ? { bg: "var(--warn-bg)", line: "var(--warn-line)", ink: "var(--warn-ink)" } : null);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>{saudacao}, {nome.split(" ")[0]}</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Relacionamento · cuidar de quem já comprou com a gente.</p>
      </div>
      {/* 0184: o trabalho do dia primeiro — as etapas das viagens que eu cuido */}
      <div className="grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <button onClick={() => ir({ tela: "esteira" })} className="rel-card p-4 text-left transition-shadow hover:shadow-md flex items-center gap-4"
          style={{ borderColor: "var(--rel)", background: "var(--rel-soft)" }}>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-bold" style={{ color: "var(--rel-ink)" }}>Minhas atividades de hoje →</span>
            <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--ink2)" }}>
              {cont?.minhasViagens ? `Etapas da Esteira das ${cont.minhasViagens} viage${cont.minhasViagens === 1 ? "m" : "ns"} que você cuida: concluir em 1 clique.` : "Você ainda não cuida de nenhuma viagem — assuma as suas em “Sem dono”."}
            </span>
          </span>
          <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--rel-ink)" }}>{cont?.minhasViagens ?? "–"}</span>
        </button>
        <button onClick={() => ir({ tela: "faxina" })} className="rel-card p-4 text-left transition-shadow hover:shadow-md"
          style={cont?.semDono ? { borderColor: "var(--err-line)", background: "var(--err-bg)" } : undefined}>
          <span className="block text-[12px] font-semibold" style={{ color: cont?.semDono ? "var(--err-ink)" : "var(--ink2)" }}>Viagens sem dono</span>
          <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: cont?.semDono ? "var(--err-ink)" : "var(--ink)" }}>{cont?.semDono ?? "–"}</span>
          <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>pacote, aéreo e hotel que vão acontecer</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cartoes.map((c) => {
          const k = cor(c.tom);
          return (
            <button key={c.rotulo} onClick={() => ir(c.rota)} className="rel-card p-4 text-left transition-shadow hover:shadow-md"
              style={k ? { borderColor: k.line, background: k.bg } : undefined}>
              <span className="block text-[12px] font-semibold" style={{ color: k?.ink ?? "var(--ink2)" }}>{c.rotulo}</span>
              <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: k?.ink ?? "var(--ink)" }}>{c.valor ?? "–"}</span>
              <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{c.dica}</span>
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rel-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Precisa de atenção</h2>
            <button className="text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => ir({ tela: "alertas" })}>Ver todos</button>
          </div>
          {alertas === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
            : alertas.length === 0 ? <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nada pendente. 🎉</p>
            : (
              <ul className="space-y-1">
                {alertas.map((a, i) => (
                  <li key={i}>
                    <button className="rel-linha w-full text-left p-2 -mx-2 rounded-lg flex gap-2 items-start"
                      onClick={() => a.viagem_id ? ir({ tela: "viagem", id: a.viagem_id }) : a.cliente_id ? ir({ tela: "ficha", id: a.cliente_id }) : ir({ tela: "alertas" })}>
                      <Etiqueta tom={a.gravidade === "alta" ? "erro" : "aviso"}>{a.gravidade === "alta" ? "urgente" : "atenção"}</Etiqueta>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{a.titulo}</span>
                        <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{a.detalhe}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>
        <section className="rel-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Embarques nos próximos 30 dias</h2>
            <button className="text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => ir({ tela: "viagens" })}>Viagens</button>
          </div>
          {embarques.length === 0 ? <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhum embarque nos próximos 30 dias.</p> : (
            <ul className="space-y-1">
              {embarques.map((v) => (
                <li key={v.id}>
                  <button className="rel-linha w-full text-left p-2 -mx-2 rounded-lg flex items-center gap-3" onClick={() => ir({ tela: "viagem", id: v.id })}>
                    <span className="w-12 text-center flex-shrink-0">
                      <span className="block text-lg font-bold leading-none" style={{ color: "var(--rel-ink)" }}>{v.data_embarque.slice(8, 10)}</span>
                      <span className="block text-[10px] uppercase" style={{ color: "var(--ink3)" }}>
                        {new Date(v.data_embarque + "T12:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                      </span>
                    </span>
                    <span className="flex-1 min-w-0 text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{v.titulo}</span>
                    <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{v.passageiros} pax</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default function RelApp() {
  const { currentUser } = useQsAuth();
  // KPIs: some do menu pra quem o cargo não deixa ver (0135).
  const verKpis = usePode("relacionamento.kpis") !== false;
  const [central, recontarCentral] = useContagemSolicitacoes("relacionamento");
  const [aprovacoes, recontarAprovacoes] = useAprovacoesNovas(currentUser?.id, "relacionamento");
  const [rota, setRota] = useState<Rota>(lerRota);
  const [resumo, setResumo] = useState<ResumoDoMenu | null>(null);
  const [cont, setCont] = useState<Contadores | null>(null);
  const [maisAberto, setMaisAberto] = useState(false);
  const eu = currentUser?.id ?? "";

  useEffect(() => {
    const onHash = () => setRota(lerRota());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const ir = useCallback((r: Rota) => {
    window.location.hash = hashDe(r);
    setRota(r);
    window.scrollTo(0, 0);
  }, []);

  // Uma contagem por vez: se pedirem outra no meio (onMudou de uma tela), roda
  // UMA de novo no fim — nunca empilha.
  const emCurso = useRef(false);
  const deNovo = useRef(false);
  const ultimaContagem = useRef(0);
  const atualizar = useCallback(() => {
    if (emCurso.current) { deNovo.current = true; return; }
    const rodar = () => {
      emCurso.current = true;
      ultimaContagem.current = Date.now();
      void Promise.all([
        carregarResumoDoMenu().catch(() => null),
        contarEsperando().catch(() => null),
        contarAlertasEChamados().catch(() => null),
        contarGruposNovos().catch(() => null),
        eu ? contarDonos(eu).catch(() => null) : Promise.resolve(null),
      ]).then(([r, f, ac, g, d]) => {
        if (r) setResumo(r);
        setCont({
          esperando: f?.esperando ?? 0, foraDoPrazo: f?.foraDoPrazo ?? 0, duplicados: r?.duplicados ?? 0,
          alertasAltos: ac?.alertasAltos ?? 0, chamadosVencidos: ac?.chamadosVencidos ?? 0,
          gruposNovos: g?.grupos ?? 0, gruposMencao: g?.mencoes ?? 0,
          minhasViagens: d?.minhasViagens ?? 0, semDono: d?.semDono ?? 0,
        });
      }).finally(() => {
        if (deNovo.current) { deNovo.current = false; rodar(); } else emCurso.current = false;
      });
    };
    rodar();
  }, [eu]);
  // O Atendimento avisa a cada mensagem enviada: aí só recontam as 2 bolinhas
  // dele (esperando resposta e chamados vencidos), não o menu inteiro.
  const recontarAtendimento = useCallback(() => {
    void Promise.all([
      contarEsperando(),
      supabase.from("rel_chamados").select("id", { count: "exact", head: true }).neq("status", "resolvido").lt("prazo", new Date().toISOString()),
    ]).then(([f, ch]) => setCont((c) => (c ? { ...c, esperando: f.esperando, foraDoPrazo: f.foraDoPrazo, chamadosVencidos: ch.count ?? c.chamadosVencidos } : c)))
      .catch(() => undefined);
  }, []);
  // As bolinhas do menu se atualizam sozinhas — a cada 2 min, ao voltar pra aba
  // e ao voltar pro Início (22/10, desempenho). Antes eram a cada 30 s E a cada
  // troca de tela: ~1 s de banco por aba aberta. Quem muda algo numa tela
  // (juntar duplicado, concluir atendimento…) chama onMudou → atualiza na hora.
  useEffect(() => {
    atualizar();
    const t = setInterval(() => { if (!document.hidden) atualizar(); }, 120_000);
    const aoVoltar = () => { if (!document.hidden && Date.now() - ultimaContagem.current > 30_000) atualizar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [atualizar]);
  useEffect(() => {
    // o Início mostra os números grandes: se estão com mais de 30 s, recontar
    if (rota.tela === "inicio" && Date.now() - ultimaContagem.current > 30_000) atualizar();
  }, [rota.tela, atualizar]);

  if (!currentUser) return null;
  const abrirCliente = (id: string) => ir({ tela: "ficha", id });
  const abrirViagem = (id: string) => ir({ tela: "viagem", id });
  const abrirConversa = (id: string) => ir({ tela: "atendimento", id });

  // A tela de detalhe acende o item da lista dela.
  const ativo: Tela = rota.tela === "ficha" ? "clientes" : rota.tela === "duplicados" || rota.tela === "cadastros" ? "clientes" : rota.tela === "exp-passageiros" ? "clientes" : rota.tela === "viagem" ? "viagens" : rota.tela === "prazo" ? "kpis" : rota.tela === "whatsapp" ? "config" : rota.tela;
  const supervisao = podeGerirRelacionamento(currentUser);
  const verTime = podeGerirTime(currentUser, "relacionamento");

  // MENU ENXUTO (27/10, Bruno: "tudo o mais simples"). No 1º nível fica só o
  // que a atendente usa todo dia — Atendimento, Viagens, Clientes — e, pra
  // supervisão, Faxina/Modelos/Time. O resto vai pro grupo recolhido "Mais"
  // (uso medido em 27/10: Esteira 0 etapas concluídas, Disparos/Automações/
  // Pesquisas/Recompra/Agenda 0 registros, Chamados 1). Toda rota continua
  // funcionando: link antigo abre a tela e o "Mais" já vem aberto.
  const itensMais: ShellItem[] = [
    { id: "esteira", label: "Minhas atividades", icon: Icon.check },
    { id: "chamados", label: "Chamados", icon: Icon.chamado, count: cont?.chamadosVencidos || undefined, late: true },
    { id: "agenda", label: "Agenda do time", icon: Icon.agenda },
    { id: "exp-expedicoes", label: "Expedições", icon: Icon.mapa },
    { id: "exp-pacotes", label: "Pacotes", icon: Icon.aviao },
    { id: "exp-inscricoes", label: "Inscrições", icon: Icon.inscricao },
    { id: "exp-avisos", label: "Avisos das expedições", icon: Icon.megafone },
    { id: "disparos", label: "Disparos", icon: Icon.disparo },
    { id: "automacoes", label: "Automações", icon: Icon.cadencia },
    { id: "pesquisas", label: "Pesquisas", icon: Icon.pesquisa },
    { id: "recompra", label: "Recompra", icon: Icon.recompra },
    ...(verKpis ? [{ id: "kpis", label: "KPIs", icon: Icon.kpi }] : []),
    { id: "config", label: "Configurações", icon: Icon.config },
  ];
  const noMais = itensMais.some((i) => i.id === ativo);
  const somaMais = itensMais.reduce((s, i) => s + (i.count ?? 0), 0);

  // Redesign (out/2026): menu na ordem do HANDOFF.md ("Menus por setor") e a
  // casca é o AppShell comum dos 4 setores. Agrupamento novo:
  //   Início, Minhas atividades · Atendimento · Carteira · Expedições · Pós-venda · Gestão
  // Bruno, 27/10: Solicitações, Propostas e Agenda do time sobem pro Atendimento
  // (não ficam no rodapé); Modelos de mensagem só pra supervisão; Arrumar
  // cadastros virou aba de Clientes (o cadastro é um só).
  const mostraMais = maisAberto || noMais;
  const grupos: ShellGroup[] = [
    { items: [
      { id: "inicio", label: "Início", icon: Icon.inicio },
    ] },
    { label: "Atendimento", items: [
      { id: "atendimento", label: "Conversas", icon: Icon.chat, count: cont?.esperando || undefined, late: !!cont?.foraDoPrazo },
      // Grupos (15/10, 0137): vermelho quando marcaram o número com @
      { id: "grupos", label: cont?.gruposMencao ? "Grupos  @" : "Grupos", icon: Icon.pessoas, count: cont?.gruposNovos || undefined, late: !!cont?.gruposMencao },
      // Central de Solicitações (0149) e Propostas (0157)
      { id: "solicitacoes", label: "Solicitações", icon: Icon.inbox, count: bolinhaDaCentral(central).badge, late: bolinhaDaCentral(central).alerta },
      { id: "propostas", label: "Propostas", icon: Icon.doc, count: aprovacoes || undefined },
      // 0218: pipeline de vendas pra base (hunters)
      { id: "vendas", label: "Pipeline de vendas", icon: Icon.funil },
    ] },
    { label: "Carteira", items: [
      { id: "viagens", label: "Viagens", icon: Icon.aviao },
      { id: "clientes", label: "Clientes", icon: Icon.cliente, count: cont?.duplicados || undefined },
      { id: "alertas", label: "Alertas", icon: Icon.alerta, count: cont?.alertasAltos || undefined, late: true },
    ] },
    ...(supervisao || verTime ? [{ label: "Supervisão", items: [
      ...(supervisao ? [
        { id: "faxina", label: "Faxina das viagens", icon: Icon.ferramenta, count: cont?.semDono || undefined },
        { id: "modelos", label: "Modelos de mensagem", icon: Icon.modelo },
      ] : []),
      // Time (13/10): a gestora do Relacionamento cadastra e cuida do time.
      ...(verTime ? [{ id: "equipe", label: "Time", icon: Icon.time }] : []),
    ] }] : []),
    { items: [
      // "Mais" recolhido: fechado, mostra a soma das bolinhas de dentro
      { id: MAIS_ID, label: mostraMais ? "Mais ▾" : "Mais ▸", icon: Icon.mais, count: !mostraMais && somaMais ? somaMais : undefined, late: true },
      ...(mostraMais ? itensMais : []),
    ] },
  ];
  const ativoNoMenu = ativo;
  const navegar = (id: string) => {
    if (id !== MAIS_ID) { ir({ tela: id } as Rota); return; }
    // celular/tablet: o menu é gaveta e fecha ao tocar → abre a tela "Mais"
    if (window.matchMedia("(max-width: 1023px)").matches) { ir({ tela: "mais" }); return; }
    setMaisAberto(!mostraMais);
  };

  return (
    <>
      <style>{REL_CSS}</style>
      <AppShell setor="relacionamento" groups={grupos} active={ativoNoMenu} onNavigate={navegar}
        notifications={<SinoDeAvisos />} onBeforeSwitch={limparHash}
        onSettings={() => ir({ tela: "config" })} settingsActive={ativo === "config"}>
        <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {/* telas sob demanda: enquanto o pedaço da tela baixa, o mesmo "Carregando…" das listas */}
          <Suspense fallback={<p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}>
          {rota.tela === "inicio" &&<Inicio resumo={resumo} cont={cont} nome={currentUser.name} ir={ir} />}
          {rota.tela === "atendimento" && (
            <AtendimentoPage
              visao="conversas"
              conversaId={rota.id ?? null}
              abrir={(id) => ir(id ? { tela: "atendimento", id } : { tela: "atendimento" })}
              onAbrirCliente={abrirCliente}
              onAbrirViagem={abrirViagem}
              onTrocarVisao={(v) => ir(v === "chamados" ? { tela: "chamados" } : { tela: "atendimento" })}
              onMudou={recontarAtendimento}
            />
          )}
          {rota.tela === "solicitacoes" && (
            <SolicitacoesPage setor="relacionamento" abrirId={rota.id ?? null} onMudou={recontarCentral}
              onAbrirId={(id) => ir(id ? { tela: "solicitacoes", id } : { tela: "solicitacoes" })}
              links={{ onAbrirViagem: abrirViagem, onAbrirCliente: abrirCliente, onAbrirConversa: abrirConversa, onAbrirProposta: (id) => ir({ tela: "propostas", id }) }} />
          )}
          {rota.tela === "propostas" && (
            <PropostasPage setor="relacionamento" abrirId={rota.id ?? null} onMudou={recontarAprovacoes}
              onAbrirId={(id) => ir(id ? { tela: "propostas", id } : { tela: "propostas" })} />
          )}
          {rota.tela === "grupos" && (
            <GruposPage grupoJid={rota.id ?? null} abrir={(jid) => ir(jid ? { tela: "grupos", id: jid } : { tela: "grupos" })} abrirConversa={abrirConversa} />
          )}
          {/* Chamados é a visão kanban DENTRO do Atendimento (13/10) */}
          {rota.tela === "chamados" && (
            <AtendimentoPage
              visao="chamados"
              conversaId={null}
              abrir={(id) => ir(id ? { tela: "atendimento", id } : { tela: "atendimento" })}
              onAbrirCliente={abrirCliente}
              onAbrirViagem={abrirViagem}
              onTrocarVisao={(v) => ir(v === "chamados" ? { tela: "chamados" } : { tela: "atendimento" })}
              onMudou={recontarAtendimento}
            />
          )}
          {/* Prazo de resposta saiu do Atendimento e virou parte dos KPIs; link antigo cai lá */}
          {(rota.tela === "kpis" || rota.tela === "prazo") && (verKpis ? <KpisPage /> : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Seu cargo não vê os KPIs.</p>)}
          {rota.tela === "whatsapp" && <WhatsAppPage />}
          {/* Clientes e Arrumar cadastros: duas abas do mesmo cadastro (Bruno, 27/10) */}
          {(rota.tela === "clientes" || rota.tela === "cadastros" || rota.tela === "duplicados") && (
            <div className="mb-4">
              <Segmented label="Clientes" value={rota.tela === "clientes" ? "clientes" : "cadastros"}
                onChange={(v) => ir({ tela: v } as Rota)}
                options={[
                  { value: "clientes", label: "Clientes" },
                  { value: "cadastros", label: "Arrumar cadastros", count: cont?.duplicados || undefined },
                ]} />
            </div>
          )}
          {rota.tela === "clientes" && <ClientesPage onAbrir={abrirCliente} />}
          {rota.tela === "duplicados" && <ArrumarCadastrosPage abaInicial="duplicados" nDuplicados={cont?.duplicados} onAbrir={abrirCliente} onAbrirViagem={abrirViagem} onAbrirConversa={abrirConversa} onMudou={atualizar} />}
          {rota.tela === "cadastros" && <ArrumarCadastrosPage nDuplicados={cont?.duplicados} onAbrir={abrirCliente} onAbrirViagem={abrirViagem} onAbrirConversa={abrirConversa} onMudou={atualizar} />}
          {rota.tela === "ficha" && (
            <ClienteFicha key={rota.id} id={rota.id} onAbrir={abrirCliente} onVoltar={() => ir({ tela: "clientes" })}
              onAbrirConversa={abrirConversa} onAbrirViagem={abrirViagem}
              onAbrirExpedicao={(exp, tipo, pax) => ir({ tela: tipo === "pacote" ? "exp-pacotes" : "exp-expedicoes", id: pax ? `${exp}/passageiros/pax/${pax}` : exp })} />
          )}
          {rota.tela === "esteira" && <EsteiraPage onAbrirViagem={abrirViagem} />}
          {rota.tela === "viagens" && <ViagensPage key="viagens" onAbrirViagem={abrirViagem} onAbrirCliente={abrirCliente} />}
          {/* Faxina (supervisão): a mesma lista de Viagens, com todas as filas à mostra */}
          {rota.tela === "faxina" && <ViagensPage key="faxina" faxina onAbrirViagem={abrirViagem} onAbrirCliente={abrirCliente} />}
          {rota.tela === "mais" && (
            <div className="max-w-3xl mx-auto">
              <h1 className="text-xl font-bold mb-1" style={{ color: "var(--ink)" }}>Mais</h1>
              <p className="text-[13px] mb-4" style={{ color: "var(--ink3)" }}>Telas que o time usa de vez em quando.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {itensMais.map((i) => (
                  <button key={i.id} type="button" className="rel-card p-3 text-left flex items-center gap-2 text-[13.5px] font-semibold"
                    style={{ color: "var(--ink)" }} onClick={() => ir({ tela: i.id } as Rota)}>
                    {i.icon}<span className="flex-1">{i.label}</span>
                    {!!i.count && <Etiqueta tom={i.late ? "erro" : "aviso"}>{i.count}</Etiqueta>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {rota.tela === "viagem" && (
            <ViagemPage key={rota.id} id={rota.id} onVoltar={() => ir({ tela: "viagens" })} onAbrirCliente={abrirCliente} onAbrirConversa={abrirConversa}
              onAbrirExpedicao={(exp, tipo) => ir({ tela: tipo === "pacote" ? "exp-pacotes" : "exp-expedicoes", id: exp })} />
          )}
          {rota.tela === "alertas" && <AlertasPage onAbrirViagem={abrirViagem} onAbrirCliente={abrirCliente} />}
          {rota.tela === "disparos" && <DisparosPage />}
          {rota.tela === "automacoes" && <AutomacoesPage />}
          {rota.tela === "pesquisas" && <PesquisasPage onAbrirCliente={abrirCliente} onAbrirViagem={abrirViagem} />}
          {rota.tela === "recompra" && <RecompraPage onAbrirCliente={abrirCliente} onAbrirOportunidade={(id) => ir({ tela: "vendas", id })} />}
          {rota.tela === "vendas" && (
            <PipelinePage abrirId={rota.id ?? null} onAbrirId={(id) => ir(id ? { tela: "vendas", id } : { tela: "vendas" })}
              onAbrirCliente={abrirCliente} onAbrirViagem={abrirViagem} onAbrirProposta={(id) => ir({ tela: "propostas", id })} />
          )}
          {rota.tela === "config" && <ConfigPage onAbrirWhatsApp={() => ir({ tela: "whatsapp" })} />}
          {rota.tela === "equipe" && <EquipePage />}
          {ehRelExp(rota.tela) && (
            <Suspense fallback={null}>
              <ExpedicoesArea setorRelacionamento tela={REL_EXP[rota.tela]} caminho={"id" in rota ? rota.id : undefined}
                ir={(tela, id) => {
                  const rel = (Object.keys(REL_EXP) as TelaRelExp[]).find((k) => REL_EXP[k] === tela);
                  if (rel) ir({ tela: rel, id });
                }} />
            </Suspense>
          )}
          {rota.tela === "modelos" && (supervisao ? <ModelosPage /> : (
            <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Modelos de mensagem são cuidados pela supervisão do Relacionamento.</p>
          ))}
          {rota.tela === "agenda" && <AgendaPage onAbrirCliente={(id) => ir({ tela: "ficha", id })} onAbrirViagem={(id) => ir({ tela: "viagem", id })} onAbrirConversa={(id) => ir({ tela: "atendimento", id })} />}
          </Suspense>
        </div>
      </AppShell>
    </>
  );
}
