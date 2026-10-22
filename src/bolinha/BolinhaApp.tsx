// src/bolinha/BolinhaApp.tsx
// -----------------------------------------------------------------------------
// BOLINHA DO QS — o lado WEB (Bruno 22/10/2026: "tipo o AssistiveTouch do
// iPhone, no computador"). O App.tsx desenha isto NO LUGAR das áreas quando o
// endereço tem ?bolinha=1 (é o que o app do computador abre — ver lib.ts).
//
//   • Recolhida (64×64): círculo azul com o número de avisos novos (cinza-escuro
//     com o sino quando não tem nenhum); pulsa quando chega aviso. Arrastar
//     move a janela (o app do computador faz o movimento); clique sem arrastar
//     abre o painel.
//   • Aberta (380×560): grade de 6 botões redondos — Avisos, Nova solicitação,
//     Buscar, Hoje, Perguntar e Abrir o QS.
//   • Sem login: um login compacto (a janela abre sozinha pra ele aparecer).
//
// Os avisos (Realtime, bip, notificação do Windows) vêm do MESMO AvisosProvider
// do QS — aqui só sem a bolinha flutuante de dentro da página, e o clique num
// aviso abre o QS no navegador em vez de trocar o endereço desta janela.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { SETORES, type Setor, type SdrUser } from "@/components/sdr/types";
import AvisosProvider, { useAvisos } from "@/avisos/AvisosProvider";
import { abrirNoQS, desktop, rotas, type EstadoJanela, type MensagemChat } from "./lib";
import { TelaAvisos, TelaBuscar, TelaHoje, TelaNova, TelaPerguntar } from "./Telas";

const AZUL = "#0147FF";
const ESCURO = "#1E293B";

const CSS = `
html.qs-bolinha, html.qs-bolinha body, html.qs-bolinha #root { background: transparent !important; min-height: 0; overflow: hidden; }
@keyframes qsb-pulso { 0% { box-shadow: 0 0 0 0 rgba(1,71,255,.55); transform: scale(1); } 40% { transform: scale(1.08); } 100% { box-shadow: 0 0 0 16px rgba(1,71,255,0); transform: scale(1); } }
.qsb-pulso { animation: qsb-pulso 1.1s ease-out 2; }
@media (prefers-reduced-motion: reduce) { .qsb-pulso { animation: none; } }
`;

// ── Ícones ──────────────────────────────────────────────────────────────────

function Svg({ children, tam = 24 }: { children: ReactNode; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const ICONE = {
  sino: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  nova: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  buscar: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  hoje: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  perguntar: <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></>,
  abrir: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  voltar: <polyline points="15 18 9 12 15 6" />,
  minimizar: <line x1="5" y1="12" x2="19" y2="12" />,
};

// ── Estado da janela (bolinha × painel) ────────────────────────────────────

function useJanela() {
  const d = desktop();
  // No navegador comum (sem o app) o painel aparece direto, pra testar.
  const [estado, setEstado] = useState<EstadoJanela>(d ? "bolinha" : "painel");
  useEffect(() => {
    const app = desktop();
    if (!app) return;
    let vivo = true;
    app.estado().then((e) => { if (vivo) setEstado(e); }).catch(() => undefined);
    const desligar = app.onMudouEstado((e) => setEstado(e));
    return () => { vivo = false; try { desligar(); } catch { /* ok */ } };
  }, []);
  const expandir = useCallback(() => { setEstado("painel"); desktop()?.expandir(); }, []);
  const recolher = useCallback(() => { setEstado("bolinha"); desktop()?.recolher(); }, []);
  return { estado, expandir, recolher, noComputador: !!d };
}

// ── Raiz ────────────────────────────────────────────────────────────────────

export default function BolinhaApp() {
  const { isAuthenticated, loading, bootFalhou, currentUser } = useQsAuth();
  const janela = useJanela();

  // Fundo transparente e sempre no tema claro (a janela é só a bolinha/o cartão).
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.add("qs-bolinha");
    html.classList.remove("dark");
    html.style.colorScheme = "light";
  }, []);

  // Sem login: abre o painel UMA vez pra pessoa ver onde entrar.
  const abriuProLogin = useRef(false);
  useEffect(() => {
    if (loading || isAuthenticated || abriuProLogin.current) return;
    abriuProLogin.current = true;
    if (janela.estado === "bolinha") janela.expandir();
  }, [loading, isAuthenticated, janela]);

  let corpo: ReactNode;
  if (isAuthenticated && currentUser) {
    corpo = (
      <AvisosProvider modoBolinha abrirFora={abrirNoQS}>
        <BolinhaLogada user={currentUser} janela={janela} />
      </AvisosProvider>
    );
  } else if (janela.estado === "bolinha") {
    corpo = <Bolinha total={0} mais={false} pulso={0} onAbrir={janela.expandir} />;
  } else {
    corpo = (
      <Cartao titulo="QS" janela={janela}>
        {loading ? (
          <p className="text-[13px] text-slate-500 text-center py-16">Carregando…</p>
        ) : bootFalhou ? (
          <div className="text-center py-12 px-4">
            <p className="text-[14px] font-semibold text-slate-900">Não consegui falar com o servidor</p>
            <p className="text-[12.5px] text-slate-600 mt-1">Costuma ser a internet. Tente de novo em alguns instantes.</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-3 px-4 py-2 rounded-lg text-[13px] font-bold text-white" style={{ background: AZUL }}>Tentar de novo</button>
          </div>
        ) : (
          <LoginCompacto />
        )}
      </Cartao>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      {corpo}
    </>
  );
}

type Janela = ReturnType<typeof useJanela>;
type Tela = "inicio" | "avisos" | "nova" | "buscar" | "hoje" | "perguntar";
const TITULO: Record<Tela, string> = {
  inicio: "QS", avisos: "Avisos", nova: "Nova solicitação", buscar: "Buscar", hoje: "Hoje", perguntar: "Perguntar",
};

function BolinhaLogada({ user, janela }: { user: SdrUser; janela: Janela }) {
  const ctx = useAvisos();
  const [tela, setTela] = useState<Tela>("inicio");
  // A conversa do "Perguntar" fica guardada enquanto a bolinha estiver aberta.
  const [conversa, setConversa] = useState<MensagemChat[]>([]);
  const total = ctx?.total ?? 0;

  if (janela.estado === "bolinha") {
    return <Bolinha total={total} mais={!!ctx?.maisQueLimite} pulso={ctx?.pulso ?? 0} onAbrir={janela.expandir} />;
  }

  return (
    <Cartao titulo={TITULO[tela]} janela={janela} onVoltar={tela === "inicio" ? undefined : () => setTela("inicio")}
      cheio={tela === "perguntar"}>
      {tela === "inicio" && <Inicio user={user} total={total} mais={!!ctx?.maisQueLimite} ir={setTela} />}
      {tela === "avisos" && <TelaAvisos />}
      {tela === "nova" && <TelaNova user={user} onFechar={() => setTela("inicio")} />}
      {tela === "buscar" && <TelaBuscar user={user} />}
      {tela === "hoje" && <TelaHoje user={user} />}
      {tela === "perguntar" && <TelaPerguntar conversa={conversa} setConversa={setConversa} />}
    </Cartao>
  );
}

// ── A bolinha (64×64) ──────────────────────────────────────────────────────

function Bolinha({ total, mais, pulso, onAbrir }: { total: number; mais: boolean; pulso: number; onAbrir: () => void }) {
  const [pulsando, setPulsando] = useState(false);
  const primeiro = useRef(pulso);
  useEffect(() => {
    if (pulso === primeiro.current) return;
    setPulsando(false);
    const a = requestAnimationFrame(() => setPulsando(true));
    const t = setTimeout(() => setPulsando(false), 2400);
    return () => { cancelAnimationFrame(a); clearTimeout(t); };
  }, [pulso]);

  // Arrastar: o app do computador move a janela entre arrastarInicio/arrastarFim.
  // Clique = soltou em menos de 300 ms e andou menos de 5 px (coordenadas da TELA,
  // porque a janela anda junto com o mouse).
  const inicio = useRef<{ x: number; y: number; t: number } | null>(null);
  function onMouseDown(e: React.MouseEvent) {
    const app = desktop();
    if (!app || e.button !== 0) return;
    e.preventDefault();
    inicio.current = { x: e.screenX, y: e.screenY, t: Date.now() };
    try { app.arrastarInicio(); } catch { /* ok */ }
    const soltar = (ev: MouseEvent) => {
      window.removeEventListener("mouseup", soltar);
      try { app.arrastarFim(); } catch { /* ok */ }
      const i = inicio.current;
      inicio.current = null;
      if (i && Math.hypot(ev.screenX - i.x, ev.screenY - i.y) < 5 && Date.now() - i.t < 300) onAbrir();
    };
    window.addEventListener("mouseup", soltar);
  }

  const tem = total > 0;
  const rotulo = tem ? `${mais ? `${total}+` : total} aviso${total === 1 && !mais ? "" : "s"} novo${total === 1 && !mais ? "" : "s"} — abrir` : "QS — abrir";
  return (
    <div className="w-16 h-16 flex items-center justify-center select-none">
      <button
        type="button"
        aria-label={rotulo}
        title={rotulo}
        onMouseDown={onMouseDown}
        onClick={() => { if (!desktop()) onAbrir(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}
        className={`w-14 h-14 rounded-full flex flex-col items-center justify-center text-white border-2 border-white/80 cursor-pointer ${pulsando ? "qsb-pulso" : ""}`}
        style={{ background: tem ? AZUL : ESCURO, boxShadow: "0 2px 8px rgba(15,23,42,.35)" }}
      >
        {tem ? (
          <span className="text-[19px] font-extrabold leading-none">{mais ? "50+" : total}</span>
        ) : (
          <>
            <Svg tam={18}>{ICONE.sino}</Svg>
            <span className="text-[9px] font-bold leading-none mt-0.5 tracking-wide">QS</span>
          </>
        )}
      </button>
    </div>
  );
}

// ── O cartão do painel (380×560) ───────────────────────────────────────────

function Cartao({ titulo, janela, onVoltar, cheio, children }: {
  titulo: string; janela: Janela; onVoltar?: () => void; cheio?: boolean; children: ReactNode;
}) {
  const app = desktop();
  const caixa = (
    <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden border border-slate-300 bg-slate-50 text-slate-900"
      style={{ fontFamily: "inherit" }}>
      <header className="flex items-center gap-1 px-2 h-12 bg-white border-b border-slate-200 flex-shrink-0">
        {onVoltar ? (
          <button type="button" onClick={onVoltar} aria-label="Voltar" title="Voltar" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100">
            <Svg tam={20}>{ICONE.voltar}</Svg>
          </button>
        ) : (
          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-extrabold" style={{ background: AZUL }}>QS</span>
        )}
        <h1 className="flex-1 min-w-0 truncate text-[15px] font-bold px-1">{titulo}</h1>
        {(
          <button type="button" onClick={janela.recolher} aria-label="Recolher a bolinha" title="Recolher"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100">
            <Svg tam={20}>{ICONE.minimizar}</Svg>
          </button>
        )}
      </header>
      <main className={`flex-1 min-h-0 px-3 py-3 ${cheio ? "flex flex-col" : "overflow-y-auto"}`}>{children}</main>
      {app && (
        <footer className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-t border-slate-200 bg-white">
          <span className="text-[10.5px] text-slate-400">Bolinha do QS{app.versao ? ` · v${app.versao}` : ""}</span>
          <button type="button" onClick={() => { try { app.sair(); } catch { /* ok */ } }} className="text-[11px] text-slate-500 hover:text-red-600">
            Sair da bolinha
          </button>
        </footer>
      )}
    </div>
  );
  // No app do computador a janela JÁ é do tamanho do cartão; no navegador, um cartão no meio da tela.
  if (app) return <div className="w-screen h-screen">{caixa}</div>;
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#E2E8F0" }}>
      <div style={{ width: 380, height: 560 }}>{caixa}</div>
    </div>
  );
}

// ── Início: a grade de botões redondos ─────────────────────────────────────

function Inicio({ user, total, mais, ir }: { user: SdrUser; total: number; mais: boolean; ir: (t: Tela) => void }) {
  const nome = (user.name ?? "").trim().split(/\s+/)[0] || "";
  const botoes: { id: Tela | "abrir"; rotulo: string; icone: ReactNode; cor: string; contador?: string }[] = [
    { id: "avisos", rotulo: "Avisos", icone: ICONE.sino, cor: AZUL, contador: total ? (mais ? `${total}+` : String(total)) : undefined },
    { id: "nova", rotulo: "Nova solicitação", icone: ICONE.nova, cor: "#0E7C6A" },
    { id: "buscar", rotulo: "Buscar", icone: ICONE.buscar, cor: "#6D28D9" },
    { id: "hoje", rotulo: "Hoje", icone: ICONE.hoje, cor: "#B45309" },
    { id: "perguntar", rotulo: "Perguntar", icone: ICONE.perguntar, cor: "#DB2777" },
    { id: "abrir", rotulo: "Abrir o QS", icone: ICONE.abrir, cor: ESCURO },
  ];
  return (
    <div>
      <p className="text-[15px] font-semibold text-slate-900 px-1">{nome ? `Oi, ${nome}!` : "Oi!"}</p>
      <p className="text-[12.5px] text-slate-500 px-1 mb-5">
        {total ? `Você tem ${mais ? `mais de ${total}` : total} aviso${total === 1 ? "" : "s"} novo${total === 1 ? "" : "s"}.` : "Nenhum aviso novo por enquanto."}
      </p>
      <div className="grid grid-cols-3 gap-y-6 gap-x-2">
        {botoes.map((b) => (
          <button key={b.id} type="button" onClick={() => (b.id === "abrir" ? abrirNoQS(rotas.inicio()) : ir(b.id))}
            className="group flex flex-col items-center gap-1.5 focus:outline-none">
            <span className="relative w-[68px] h-[68px] rounded-full flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-blue-200"
              style={{ background: b.cor }}>
              <Svg tam={28}>{b.icone}</Svg>
              {b.contador && (
                <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center border-2 border-white">
                  {b.contador}
                </span>
              )}
            </span>
            <span className="text-[12px] font-semibold text-slate-700 text-center leading-tight">{b.rotulo}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 text-center mt-7 px-2">
        {setoresDe(user).length > 1 ? "Os avisos de todas as suas áreas chegam aqui." : "Os avisos chegam aqui mesmo com o QS fechado."}
      </p>
    </div>
  );
}

// ── Login compacto ─────────────────────────────────────────────────────────

/** Na bolinha a pessoa não escolhe a "porta": tenta a última usada e depois as outras. */
function ordemDasPortas(): Setor[] {
  let ultima: Setor = "comercial";
  try { const v = localStorage.getItem("qs_area") as Setor | null; if (v && SETORES.includes(v)) ultima = v; } catch { /* ok */ }
  return [ultima, ...SETORES.filter((s) => s !== ultima)];
}

function LoginCompacto() {
  const { login, sessionNotice } = useQsAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (!email.trim() || !senha) { setErro("Preencha o e-mail e a senha."); return; }
    setEntrando(true);
    try {
      for (const porta of ordemDasPortas()) {
        const r = await login(email, senha, porta);
        if (r === "ok" || r === "inactive") return; // inactive: o aviso vem pelo sessionNotice
        if (r === "bad_credentials") { setErro("E-mail ou senha incorretos."); return; }
        if (r === "profile_error") { setErro("Não consegui carregar seu perfil agora. Confira a internet e tente de novo."); return; }
        // sem_acesso: a conta não é desta porta — tenta a próxima
      }
      setErro("Sua conta não tem acesso a nenhuma área do QS. Fale com a gestão.");
    } finally { setEntrando(false); }
  }

  const campo = "w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[14px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0147FF]";
  return (
    <form onSubmit={(e) => void entrar(e)} className="pt-6 px-2 space-y-3">
      <div className="text-center mb-2">
        <div className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center text-white font-extrabold text-lg" style={{ background: AZUL }}>QS</div>
        <p className="text-[15px] font-bold mt-2">Entrar na Bolinha do QS</p>
        <p className="text-[12px] text-slate-500">Use o mesmo e-mail e senha do QS.</p>
      </div>
      {(erro || sessionNotice) && (
        <p className={`text-[12.5px] rounded-lg px-3 py-2 border ${erro ? "text-red-700 bg-red-50 border-red-100" : "text-amber-800 bg-amber-50 border-amber-200"}`}>{erro || sessionNotice}</p>
      )}
      <label className="block">
        <span className="block text-[12px] font-semibold text-slate-600 mb-1">E-mail</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus placeholder="seu@email.com" className={campo} />
      </label>
      <label className="block">
        <span className="block text-[12px] font-semibold text-slate-600 mb-1">Senha</span>
        <div className="relative">
          <input type={ver ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" placeholder="Sua senha" className={`${campo} pr-16`} />
          <button type="button" onClick={() => setVer((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-[12px] font-semibold text-slate-500 hover:text-slate-800">
            {ver ? "Ocultar" : "Mostrar"}
          </button>
        </div>
      </label>
      <button type="submit" disabled={entrando} className="w-full py-2.5 rounded-lg text-[14px] font-bold text-white disabled:opacity-60" style={{ background: AZUL }}>
        {entrando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
