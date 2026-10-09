// src/rel/RelApp.tsx
// -----------------------------------------------------------------------------
// ÁREA DE RELACIONAMENTO (pós-venda) — Fase 1 do roadmap de 09/10/2026.
//
// Um app à parte dentro do QS: menu, telas e cor próprios, nada reaproveitado
// do Comercial (pedido do Bruno: "um sistema 100% do zero"). O que é comum aos
// dois é só o que TEM que ser: o login, o banco e o cliente.
//
// Navegação pelo endereço (#rel/clientes, #rel/cliente/<id>...): o botão
// "voltar" do navegador funciona e dá pra mandar o link de uma ficha pra
// alguém do time.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQsAuth, setoresDe } from "@/contexts/QsAuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import ChangePasswordModal from "@/components/sdr/settings/ChangePasswordModal";
import { carregarResumo, type Resumo } from "./lib/clientes";
import { Avatar, REL_CSS } from "./ui";
import ClientesPage from "./clientes/ClientesPage";
import ClienteFicha from "./clientes/ClienteFicha";
import DuplicadosPage from "./clientes/DuplicadosPage";
import AtendimentoPage from "./atendimento/AtendimentoPage";
import PrazoPage from "./atendimento/PrazoPage";
import ConfigPage from "./config/ConfigPage";
import { contarEsperando } from "./lib/whatsapp";

type Rota =
  | { tela: "inicio" } | { tela: "clientes" } | { tela: "duplicados" } | { tela: "ficha"; id: string }
  | { tela: "atendimento"; id?: string } | { tela: "prazo" } | { tela: "config" };
type TelaMenu = "inicio" | "atendimento" | "clientes" | "duplicados" | "prazo" | "config";

function lerRota(): Rota {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [area, tela, id] = h.split("/");
  if (area !== "rel") return { tela: "inicio" };
  if (tela === "clientes") return { tela: "clientes" };
  if (tela === "duplicados") return { tela: "duplicados" };
  if (tela === "cliente" && id) return { tela: "ficha", id };
  if (tela === "atendimento") return id ? { tela: "atendimento", id } : { tela: "atendimento" };
  if (tela === "prazo") return { tela: "prazo" };
  if (tela === "config") return { tela: "config" };
  return { tela: "inicio" };
}

function hashDe(r: Rota) {
  if (r.tela === "ficha") return `#rel/cliente/${r.id}`;
  if (r.tela === "atendimento" && r.id) return `#rel/atendimento/${r.id}`;
  return r.tela === "inicio" ? "#rel" : `#rel/${r.tela}`;
}

/** Sai do endereço do Relacionamento (ao trocar de área ou sair). */
function limparHash() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

// ── Ícones do menu ──
const ICONES: Record<string, ReactNode> = {
  inicio: <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  clientes: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  duplicados: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  atendimento: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  prazo: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  config: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
};

function Icone({ nome }: { nome: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONES[nome]}</svg>;
}

// ── Tela inicial ──
function Inicio({ resumo, fila, nome, ir }: { resumo: Resumo | null; fila: { esperando: number; foraDoPrazo: number } | null; nome: string; ir: (r: Rota) => void }) {
  const cartoes: { rotulo: string; valor: number | undefined; dica: string; rota?: Rota; tom?: "aviso" }[] = [
    { rotulo: "Esperando resposta", valor: fila?.esperando, dica: fila?.foraDoPrazo ? `${fila.foraDoPrazo} fora do prazo` : "no WhatsApp", rota: { tela: "atendimento" }, tom: fila?.foraDoPrazo ? "aviso" : undefined },
    { rotulo: "Clientes", valor: resumo?.clientes, dica: "fichas ativas", rota: { tela: "clientes" } },
    { rotulo: "Duplicados", valor: resumo?.duplicados, dica: "para revisar", rota: { tela: "duplicados" }, tom: resumo?.duplicados ? "aviso" : undefined },
    { rotulo: "Passaportes", valor: resumo?.passaportesVencendo, dica: "vencem em até 6 meses", tom: resumo?.passaportesVencendo ? "aviso" : undefined },
  ];
  const fases = [
    ["3", "Jornada da viagem", "A venda no Bitrix cria a viagem; documentos por link."],
    ["4", "Disparos", "Mensagens prontas para datas especiais, só com modelo aprovado."],
    ["5", "Pós-viagem e recompra", "Pesquisa de satisfação e oportunidade nova pro Comercial."],
    ["6", "Operacional", "A operação das viagens no mesmo sistema."],
  ];
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>{saudacao}, {nome.split(" ")[0]}</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Relacionamento · cuidar de quem já comprou com a gente.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cartoes.map((c) => (
          <button
            key={c.rotulo}
            disabled={!c.rota}
            onClick={() => c.rota && ir(c.rota)}
            className="rel-card p-4 text-left transition-shadow enabled:hover:shadow-md disabled:cursor-default"
            style={c.tom === "aviso" ? { borderColor: "var(--warn-line)", background: "var(--warn-bg)" } : undefined}
          >
            <span className="block text-[12px] font-semibold" style={{ color: c.tom ? "var(--warn-ink)" : "var(--ink2)" }}>{c.rotulo}</span>
            <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: c.tom ? "var(--warn-ink)" : "var(--ink)" }}>{c.valor ?? "–"}</span>
            <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{c.dica}</span>
          </button>
        ))}
      </div>
      {!!resumo?.semConsentimento && (
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          <b>{resumo.semConsentimento}</b> ficha{resumo.semConsentimento > 1 ? "s" : ""} sem consentimento LGPD registrado.
        </p>
      )}
      <section className="rel-card p-5">
        <h2 className="text-[13px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--ink2)" }}>O que vem por aí</h2>
        <ol className="grid sm:grid-cols-2 gap-3">
          {fases.map(([n, t, d]) => (
            <li key={n} className="flex gap-3">
              <span className="flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold flex-shrink-0" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>{n}</span>
              <span>
                <span className="block text-sm font-semibold" style={{ color: "var(--ink)" }}>{t}</span>
                <span className="block text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function RelApp() {
  const { currentUser, logout, trocarArea } = useQsAuth();
  const { isDark, toggleTheme } = useTheme();
  const [rota, setRota] = useState<Rota>(lerRota);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [fila, setFila] = useState<{ esperando: number; foraDoPrazo: number } | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState(false);

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

  const atualizarResumo = useCallback(() => {
    carregarResumo().then(setResumo).catch(() => undefined);
    contarEsperando().then(setFila).catch(() => undefined);
  }, []);
  // A bolinha de "esperando" no menu se atualiza sozinha.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) contarEsperando().then(setFila).catch(() => undefined); }, 30_000);
    return () => clearInterval(t);
  }, []);
  // Recarrega os números ao voltar pro início ou pra lista (depois de criar/juntar).
  useEffect(() => { atualizarResumo(); }, [rota.tela, atualizarResumo]);

  if (!currentUser) return null;
  const temComercial = setoresDe(currentUser).includes("comercial");
  const abrir = (id: string) => ir({ tela: "ficha", id });
  const ativo: TelaMenu = rota.tela === "ficha" ? "clientes" : rota.tela;

  const itens: { id: TelaMenu; rotulo: string; badge?: number; alerta?: boolean }[] = [
    { id: "inicio", rotulo: "Início" },
    { id: "atendimento", rotulo: "Atendimento", badge: fila?.esperando || undefined, alerta: !!fila?.foraDoPrazo },
    { id: "clientes", rotulo: "Clientes" },
    { id: "duplicados", rotulo: "Duplicados", badge: resumo?.duplicados || undefined },
    { id: "prazo", rotulo: "Prazo de resposta" },
    { id: "config", rotulo: "Configurações" },
  ];

  const menu = (
    <nav className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 h-16 flex-shrink-0">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl text-white font-bold text-sm" style={{ background: "var(--rel)" }}>QS</span>
        <span className="leading-tight">
          <span className="block text-sm font-bold" style={{ color: "var(--ink)" }}>Relacionamento</span>
          <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>pós-venda</span>
        </span>
      </div>
      <ul className="px-2.5 space-y-0.5 flex-1">
        {itens.map((it) => {
          const sel = ativo === it.id;
          return (
            <li key={it.id}>
              <button
                onClick={() => ir({ tela: it.id } as Rota)}
                aria-current={sel ? "page" : undefined}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-semibold transition-colors"
                style={{ background: sel ? "var(--rel-soft)" : "transparent", color: sel ? "var(--rel-ink)" : "var(--ink2)" }}
              >
                <Icone nome={it.id} />
                <span className="flex-1 text-left">{it.rotulo}</span>
                {it.badge ? <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={it.alerta ? { background: "var(--err-bg)", color: "var(--err-ink)" } : { background: "var(--warn-bg)", color: "var(--warn-ink)" }}>{it.badge}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
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
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>Relacionamento</span>
      </header>
      {menuAberto && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0" style={{ background: "rgba(15,20,26,.45)" }} onClick={() => setMenuAberto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl" style={{ background: "var(--card)" }}>{menu}</aside>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {rota.tela === "inicio" && <Inicio resumo={resumo} fila={fila} nome={currentUser.name} ir={ir} />}
          {rota.tela === "atendimento" && (
            <AtendimentoPage
              conversaId={rota.id ?? null}
              abrir={(id) => ir(id ? { tela: "atendimento", id } : { tela: "atendimento" })}
              onAbrirCliente={abrir}
              onMudou={atualizarResumo}
            />
          )}
          {rota.tela === "prazo" && <PrazoPage />}
          {rota.tela === "config" && <ConfigPage />}
          {rota.tela === "clientes" && <ClientesPage onAbrir={abrir} />}
          {rota.tela === "duplicados" && <DuplicadosPage onAbrir={abrir} onMudou={atualizarResumo} />}
          {rota.tela === "ficha" && <ClienteFicha key={rota.id} id={rota.id} onAbrir={abrir} onVoltar={() => ir({ tela: "clientes" })} onAbrirConversa={(cid) => ir({ tela: "atendimento", id: cid })} />}
        </div>
      </main>

      <ChangePasswordModal open={trocandoSenha} onClose={() => setTrocandoSenha(false)} />
    </div>
  );
}
