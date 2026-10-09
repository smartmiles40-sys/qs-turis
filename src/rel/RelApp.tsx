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
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQsAuth, setoresDe } from "@/contexts/QsAuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import ChangePasswordModal from "@/components/sdr/settings/ChangePasswordModal";
import { carregarResumo, type Resumo } from "./lib/clientes";
import { contarEsperando } from "./lib/whatsapp";
import { Avatar, Etiqueta, REL_CSS } from "./ui";
import ClientesPage from "./clientes/ClientesPage";
import ClienteFicha from "./clientes/ClienteFicha";
import DuplicadosPage from "./clientes/DuplicadosPage";
import AtendimentoPage from "./atendimento/AtendimentoPage";
import PrazoPage from "./atendimento/PrazoPage";
import ConfigPage from "./config/ConfigPage";
import ViagensPage from "./viagens/ViagensPage";
import ViagemPage from "./viagens/ViagemPage";
import AlertasPage from "./viagens/AlertasPage";
import DisparosPage from "./disparos/DisparosPage";
import AutomacoesPage from "./disparos/AutomacoesPage";
import PesquisasPage from "./pos/PesquisasPage";
import RecompraPage from "./pos/RecompraPage";
import ChamadosPage from "./chamados/ChamadosPage";

type Rota =
  | { tela: "inicio" }
  | { tela: "atendimento"; id?: string } | { tela: "chamados" } | { tela: "prazo" }
  | { tela: "clientes" } | { tela: "ficha"; id: string } | { tela: "duplicados" }
  | { tela: "viagens" } | { tela: "viagem"; id: string } | { tela: "alertas" }
  | { tela: "disparos" } | { tela: "automacoes" } | { tela: "pesquisas" } | { tela: "recompra" }
  | { tela: "config" };
type Tela = Rota["tela"];

const SIMPLES: Tela[] = ["inicio", "chamados", "prazo", "clientes", "duplicados", "viagens", "alertas", "disparos", "automacoes", "pesquisas", "recompra", "config"];

function lerRota(): Rota {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [area, tela, id] = h.split("/");
  if (area !== "rel") return { tela: "inicio" };
  if (tela === "cliente" && id) return { tela: "ficha", id };
  if (tela === "viagem" && id) return { tela: "viagem", id };
  if (tela === "atendimento") return id ? { tela: "atendimento", id } : { tela: "atendimento" };
  if ((SIMPLES as string[]).includes(tela)) return { tela } as Rota;
  return { tela: "inicio" };
}

function hashDe(r: Rota) {
  if (r.tela === "ficha") return `#rel/cliente/${r.id}`;
  if (r.tela === "viagem") return `#rel/viagem/${r.id}`;
  if (r.tela === "atendimento" && r.id) return `#rel/atendimento/${r.id}`;
  return r.tela === "inicio" ? "#rel" : `#rel/${r.tela}`;
}

/** Sai do endereço do Relacionamento (ao trocar de área ou sair). */
function limparHash() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

// ── Ícones ──
const ICONES: Record<string, ReactNode> = {
  inicio: <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  atendimento: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  clientes: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  viagens: <><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></>,
  pos: <><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></>,
  config: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  seta: <polyline points="6 9 12 15 18 9" />,
};

function Icone({ nome, tamanho = 18 }: { nome: string; tamanho?: number }) {
  return <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONES[nome]}</svg>;
}

// ── Contadores do menu ──
interface Contadores {
  esperando: number; foraDoPrazo: number; duplicados: number;
  alertasAltos: number; chamadosVencidos: number;
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

function Inicio({ resumo, cont, nome, ir }: { resumo: Resumo | null; cont: Contadores | null; nome: string; ir: (r: Rota) => void }) {
  const [alertas, setAlertas] = useState<AlertaCurto[] | null>(null);
  const [embarques, setEmbarques] = useState<{ id: string; titulo: string; data_embarque: string; passageiros: number }[]>([]);
  useEffect(() => {
    supabase.from("rel_alertas").select("tipo, gravidade, titulo, detalhe, cliente_id, viagem_id").in("gravidade", ["alta", "media"]).order("data").limit(8)
      .then(({ data }) => setAlertas((data ?? []) as AlertaCurto[]));
    const hoje = new Date().toISOString().slice(0, 10);
    const em30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    supabase.from("rel_viagens_v").select("id, titulo, data_embarque, passageiros").eq("status", "ativa").gte("data_embarque", hoje).lte("data_embarque", em30).order("data_embarque").limit(6)
      .then(({ data }) => setEmbarques((data ?? []) as typeof embarques));
  }, []);

  const cartoes: { rotulo: string; valor: number | undefined; dica: string; rota: Rota; tom?: "aviso" | "erro" }[] = [
    { rotulo: "Esperando resposta", valor: cont?.esperando, dica: cont?.foraDoPrazo ? `${cont.foraDoPrazo} fora do prazo` : "no WhatsApp", rota: { tela: "atendimento" }, tom: cont?.foraDoPrazo ? "erro" : undefined },
    { rotulo: "Alertas importantes", valor: cont?.alertasAltos, dica: "passaporte, tarefas atrasadas…", rota: { tela: "alertas" }, tom: cont?.alertasAltos ? "aviso" : undefined },
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

// ── Menu em grupos ──
interface Item { id: Tela; rotulo: string; badge?: number; alerta?: boolean }
interface Grupo { id: string; rotulo: string; icone: string; itens: Item[] }

const CHAVE_GRUPOS = "qs_rel_menu_aberto";
function gruposGuardados(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(CHAVE_GRUPOS) || "{}"); } catch { return {}; }
}

export default function RelApp() {
  const { currentUser, logout, trocarArea } = useQsAuth();
  const { isDark, toggleTheme } = useTheme();
  const [rota, setRota] = useState<Rota>(lerRota);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [cont, setCont] = useState<Contadores | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>(gruposGuardados);

  useEffect(() => {
    const onHash = () => setRota(lerRota());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const ir = useCallback((r: Rota) => {
    window.location.hash = hashDe(r);
    setRota(r);
    setMenuAberto(false);
    window.scrollTo(0, 0);
  }, []);

  const atualizar = useCallback(() => {
    void Promise.all([
      carregarResumo().catch(() => null),
      contarEsperando().catch(() => null),
      contarAlertasEChamados().catch(() => null),
    ]).then(([r, f, ac]) => {
      if (r) setResumo(r);
      setCont({
        esperando: f?.esperando ?? 0, foraDoPrazo: f?.foraDoPrazo ?? 0, duplicados: r?.duplicados ?? 0,
        alertasAltos: ac?.alertasAltos ?? 0, chamadosVencidos: ac?.chamadosVencidos ?? 0,
      });
    });
  }, []);
  // As bolinhas do menu se atualizam sozinhas (e ao trocar de tela).
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) atualizar(); }, 30_000);
    return () => clearInterval(t);
  }, [atualizar]);
  useEffect(() => { atualizar(); }, [rota.tela, atualizar]);

  if (!currentUser) return null;
  const temComercial = setoresDe(currentUser).includes("comercial");
  const abrirCliente = (id: string) => ir({ tela: "ficha", id });
  const abrirViagem = (id: string) => ir({ tela: "viagem", id });
  const abrirConversa = (id: string) => ir({ tela: "atendimento", id });

  // A tela de detalhe acende o item da lista dela.
  const ativo: Tela = rota.tela === "ficha" ? "clientes" : rota.tela === "viagem" ? "viagens" : rota.tela;

  const grupos: Grupo[] = [
    { id: "atendimento", rotulo: "Atendimento", icone: "atendimento", itens: [
      { id: "atendimento", rotulo: "Conversas", badge: cont?.esperando || undefined, alerta: !!cont?.foraDoPrazo },
      { id: "chamados", rotulo: "Chamados", badge: cont?.chamadosVencidos || undefined, alerta: true },
      { id: "prazo", rotulo: "Prazo de resposta" },
    ] },
    { id: "clientes", rotulo: "Clientes", icone: "clientes", itens: [
      { id: "clientes", rotulo: "Fichas" },
      { id: "duplicados", rotulo: "Duplicados", badge: cont?.duplicados || undefined },
    ] },
    { id: "viagens", rotulo: "Viagens", icone: "viagens", itens: [
      { id: "viagens", rotulo: "Viagens" },
      { id: "alertas", rotulo: "Alertas", badge: cont?.alertasAltos || undefined, alerta: true },
    ] },
    { id: "pos", rotulo: "Pós-venda", icone: "pos", itens: [
      { id: "disparos", rotulo: "Disparos" },
      { id: "automacoes", rotulo: "Automações" },
      { id: "pesquisas", rotulo: "Pesquisas" },
      { id: "recompra", rotulo: "Recompra" },
    ] },
  ];

  function alternar(g: string, valor?: boolean) {
    setAbertos((a) => {
      const n = { ...a, [g]: valor ?? !(a[g] ?? false) };
      try { localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(n)); } catch { /* sem memória: só não lembra */ }
      return n;
    });
  }

  const Bolinha = ({ n, alerta }: { n?: number; alerta?: boolean }) => (n ? (
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none"
      style={alerta ? { background: "var(--err-bg)", color: "var(--err-ink)" } : { background: "var(--warn-bg)", color: "var(--warn-ink)" }}>{n}</span>
  ) : null);

  const menu = (
    <nav className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 h-16 flex-shrink-0">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl text-white font-bold text-sm" style={{ background: "var(--rel)" }}>QS</span>
        <span className="leading-tight">
          <span className="block text-sm font-bold" style={{ color: "var(--ink)" }}>Relacionamento</span>
          <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>pós-venda</span>
        </span>
      </div>

      <div className="px-2.5 flex-1 overflow-y-auto space-y-0.5">
        <button
          onClick={() => ir({ tela: "inicio" })}
          aria-current={ativo === "inicio" ? "page" : undefined}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-semibold"
          style={{ background: ativo === "inicio" ? "var(--rel-soft)" : "transparent", color: ativo === "inicio" ? "var(--rel-ink)" : "var(--ink2)" }}
        >
          <Icone nome="inicio" /> <span className="flex-1 text-left">Início</span>
        </button>

        {grupos.map((g) => {
          const temAtivo = g.itens.some((i) => i.id === ativo);
          const aberto = temAtivo || (abertos[g.id] ?? false);
          const soma = g.itens.reduce((s, i) => s + (i.badge ?? 0), 0);
          const algumAlerta = g.itens.some((i) => i.alerta && i.badge);
          return (
            <div key={g.id}>
              <button
                onClick={() => alternar(g.id, !aberto)}
                aria-expanded={aberto}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-semibold"
                style={{ color: temAtivo ? "var(--rel-ink)" : "var(--ink2)" }}
              >
                <Icone nome={g.icone} />
                <span className="flex-1 text-left">{g.rotulo}</span>
                {!aberto && <Bolinha n={soma || undefined} alerta={algumAlerta} />}
                <span className="transition-transform" style={{ transform: aberto ? "rotate(0deg)" : "rotate(-90deg)", color: "var(--ink3)" }}>
                  <Icone nome="seta" tamanho={14} />
                </span>
              </button>
              {aberto && (
                <ul className="ml-[22px] pl-3 border-l space-y-0.5 mb-1" style={{ borderColor: "var(--line)" }}>
                  {g.itens.map((it) => {
                    const sel = ativo === it.id;
                    return (
                      <li key={it.id}>
                        <button
                          onClick={() => ir({ tela: it.id } as Rota)}
                          aria-current={sel ? "page" : undefined}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold"
                          style={{ background: sel ? "var(--rel-soft)" : "transparent", color: sel ? "var(--rel-ink)" : "var(--ink3)" }}
                        >
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
        {temComercial && (
          <button
            onClick={() => { limparHash(); trocarArea("comercial"); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold text-white"
            style={{ background: "#0147FF" }}
          >
            Ir para o Comercial
          </button>
        )}
        <div className="flex items-center gap-2.5 px-1 pt-2">
          <Avatar nome={currentUser.name} tamanho={30} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{currentUser.name}</span>
            <span className="block text-[11px] truncate" style={{ color: "var(--ink3)" }}>{currentUser.email}</span>
          </span>
          <button
            onClick={() => ir({ tela: "config" })}
            title="Configurações"
            aria-label="Configurações"
            className="p-1.5 rounded-lg"
            style={{ background: ativo === "config" ? "var(--rel-soft)" : "transparent", color: ativo === "config" ? "var(--rel-ink)" : "var(--ink3)" }}
          >
            <Icone nome="config" />
          </button>
        </div>
        <div className="flex gap-1 pt-1">
          <button onClick={toggleTheme} className="flex-1 px-2 py-1.5 rounded-md text-[12px] font-semibold" style={{ color: "var(--ink2)", background: "var(--card2)" }}>
            {isDark ? "Modo claro" : "Modo noturno"}
          </button>
          <button onClick={() => setTrocandoSenha(true)} className="flex-1 px-2 py-1.5 rounded-md text-[12px] font-semibold" style={{ color: "var(--ink2)", background: "var(--card2)" }}>
            Senha
          </button>
          <button onClick={() => { limparHash(); logout(); }} className="flex-1 px-2 py-1.5 rounded-md text-[12px] font-semibold" style={{ color: "var(--err-ink)", background: "var(--err-bg)" }}>
            Sair
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <style>{REL_CSS}</style>

      {/* Menu fixo (computador) */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 border-r" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
        {menu}
      </aside>

      {/* Barra do topo (celular) */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 border-b" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
        <button onClick={() => setMenuAberto(true)} aria-label="Abrir menu" className="p-1 -ml-1" style={{ color: "var(--ink)" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg text-white font-bold text-[11px]" style={{ background: "var(--rel)" }}>QS</span>
        <span className="text-sm font-bold flex-1" style={{ color: "var(--ink)" }}>Relacionamento</span>
        {!!cont?.esperando && (
          <button onClick={() => ir({ tela: "atendimento" })} aria-label="Conversas esperando">
            <Bolinha n={cont.esperando} alerta={!!cont.foraDoPrazo} />
          </button>
        )}
      </header>
      {menuAberto && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0" style={{ background: "rgba(15,20,26,.45)" }} onClick={() => setMenuAberto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl" style={{ background: "var(--card)" }}>{menu}</aside>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {rota.tela === "inicio" && <Inicio resumo={resumo} cont={cont} nome={currentUser.name} ir={ir} />}
          {rota.tela === "atendimento" && (
            <AtendimentoPage
              conversaId={rota.id ?? null}
              abrir={(id) => ir(id ? { tela: "atendimento", id } : { tela: "atendimento" })}
              onAbrirCliente={abrirCliente}
              onMudou={atualizar}
            />
          )}
          {rota.tela === "chamados" && <ChamadosPage onAbrirCliente={abrirCliente} onAbrirViagem={abrirViagem} onAbrirConversa={abrirConversa} />}
          {rota.tela === "prazo" && <PrazoPage />}
          {rota.tela === "clientes" && <ClientesPage onAbrir={abrirCliente} />}
          {rota.tela === "duplicados" && <DuplicadosPage onAbrir={abrirCliente} onMudou={atualizar} />}
          {rota.tela === "ficha" && (
            <ClienteFicha key={rota.id} id={rota.id} onAbrir={abrirCliente} onVoltar={() => ir({ tela: "clientes" })}
              onAbrirConversa={abrirConversa} onAbrirViagem={abrirViagem} />
          )}
          {rota.tela === "viagens" && <ViagensPage onAbrirViagem={abrirViagem} onAbrirCliente={abrirCliente} />}
          {rota.tela === "viagem" && (
            <ViagemPage key={rota.id} id={rota.id} onVoltar={() => ir({ tela: "viagens" })} onAbrirCliente={abrirCliente} onAbrirConversa={abrirConversa} />
          )}
          {rota.tela === "alertas" && <AlertasPage onAbrirViagem={abrirViagem} onAbrirCliente={abrirCliente} />}
          {rota.tela === "disparos" && <DisparosPage />}
          {rota.tela === "automacoes" && <AutomacoesPage />}
          {rota.tela === "pesquisas" && <PesquisasPage onAbrirCliente={abrirCliente} onAbrirViagem={abrirViagem} />}
          {rota.tela === "recompra" && <RecompraPage onAbrirCliente={abrirCliente} />}
          {rota.tela === "config" && <ConfigPage />}
        </div>
      </main>

      <ChangePasswordModal open={trocandoSenha} onClose={() => setTrocandoSenha(false)} />
    </div>
  );
}
