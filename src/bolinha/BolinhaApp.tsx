// src/bolinha/BolinhaApp.tsx
// -----------------------------------------------------------------------------
// BOLINHA DO QS — o lado WEB (Bruno 22/10/2026: "tipo o AssistiveTouch do
// iPhone, no computador"). O App.tsx desenha isto NO LUGAR das áreas quando o
// endereço tem ?bolinha=1 (é o que o app do computador abre — ver lib.ts).
//
//   • Recolhida (64×64): círculo azul com o número de avisos novos (cinza-escuro
//     com o sino quando não tem nenhum); pulsa e apita quando chega aviso.
//     Arrastar move a janela (o app do computador faz o movimento).
//   • Clique: os 5 atalhos SAEM FLUTUANDO em volta dela (Bruno 22/10: "igual
//     a bolinha da Apple, sem tela branca") — Avisos, Nova solicitação,
//     Buscar, Hoje e Perguntar. Clique fora ou no X fecha.
//   • Escolheu um atalho: um cartão pequeno (360×500) só com aquilo.
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
@keyframes qsb-sai { from { transform: translate(calc(-50% + var(--qsb-x)), calc(-50% + var(--qsb-y))) scale(.3); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
.qsb-sai { animation: qsb-sai .22s cubic-bezier(.2,.9,.3,1.2) both; }
@media (prefers-reduced-motion: reduce) { .qsb-pulso, .qsb-sai { animation: none; } }
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

// ── Estado da janela (bolinha × menu × painel) ─────────────────────────────

function useJanela() {
  const d = desktop();
  // No navegador comum (sem o app) o menu aparece direto no meio da tela, pra testar.
  const [estado, setEstado] = useState<EstadoJanela>(d ? "bolinha" : "menu");
  const [centro, setCentro] = useState<{ cx: number; cy: number } | null>(null);
  useEffect(() => {
    const app = desktop();
    if (!app) return;
    let vivo = true;
    if (app.layout) app.layout().then((l) => { if (vivo) { setEstado(l.estado); setCentro({ cx: l.cx, cy: l.cy }); } }).catch(() => undefined);
    else app.estado().then((e) => { if (vivo) setEstado(e); }).catch(() => undefined);
    const desligar = app.onMudouEstado((e, info) => {
      setEstado(e);
      if (info) setCentro({ cx: info.cx, cy: info.cy });
    });
    return () => { vivo = false; try { desligar(); } catch { /* ok */ } };
  }, []);
  // App antigo (sem menu): cai no painel.
  const menu = useCallback(() => {
    const app = desktop();
    if (app && !app.menu) { setEstado("painel"); app.expandir(); return; }
    setEstado("menu"); app?.menu?.();
  }, []);
  const expandir = useCallback(() => { setEstado("painel"); desktop()?.expandir(); }, []);
  const recolher = useCallback(() => {
    if (!desktop()) { setEstado("menu"); return; } // no navegador não tem "bolinha sozinha"
    setEstado("bolinha"); desktop()?.recolher();
  }, []);
  return { estado, centro, menu, expandir, recolher, noComputador: !!d };
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

  // Sem login: abre o cartão UMA vez pra pessoa ver onde entrar.
  const abriuProLogin = useRef(false);
  useEffect(() => {
    if (loading || isAuthenticated || abriuProLogin.current) return;
    abriuProLogin.current = true;
    if (janela.estado !== "painel") janela.expandir();
  }, [loading, isAuthenticated, janela]);

  let corpo: ReactNode;
  if (isAuthenticated && currentUser) {
    corpo = (
      <AvisosProvider modoBolinha abrirFora={abrirNoQS}>
        <BolinhaLogada user={currentUser} janela={janela} />
      </AvisosProvider>
    );
  } else if (janela.estado !== "painel") {
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
type Tela = "avisos" | "nova" | "buscar" | "hoje" | "perguntar";

/** Os 5 atalhos — a ordem é a da volta em torno da bolinha, começando em cima. */
const ATALHOS: { id: Tela; rotulo: string; icone: ReactNode; cor: string }[] = [
  { id: "avisos", rotulo: "Avisos", icone: ICONE.sino, cor: AZUL },
  { id: "nova", rotulo: "Nova solicitação", icone: ICONE.nova, cor: "#0E7C6A" },
  { id: "buscar", rotulo: "Buscar", icone: ICONE.buscar, cor: "#6D28D9" },
  { id: "hoje", rotulo: "Hoje", icone: ICONE.hoje, cor: "#B45309" },
  { id: "perguntar", rotulo: "Perguntar", icone: ICONE.perguntar, cor: "#DB2777" },
];

function BolinhaLogada({ user, janela }: { user: SdrUser; janela: Janela }) {
  const ctx = useAvisos();
  const [tela, setTela] = useState<Tela>("avisos");
  // A conversa do "Perguntar" fica guardada enquanto a bolinha estiver aberta.
  const [conversa, setConversa] = useState<MensagemChat[]>([]);
  const total = ctx?.total ?? 0;
  const mais = !!ctx?.maisQueLimite;
  const pulso = ctx?.pulso ?? 0;

  if (janela.estado === "bolinha") {
    return <Bolinha total={total} mais={mais} pulso={pulso} onAbrir={janela.menu} />;
  }
  if (janela.estado === "menu") {
    return (
      <MenuFlutuante total={total} mais={mais} pulso={pulso} centro={janela.centro}
        onFechar={janela.recolher} onEscolher={(t) => { setTela(t); janela.expandir(); }} />
    );
  }

  const atalho = ATALHOS.find((a) => a.id === tela)!;
  return (
    <Cartao titulo={atalho.rotulo} icone={atalho.icone} cor={atalho.cor} janela={janela} onVoltar={janela.menu}
      cheio={tela === "perguntar"}>
      {tela === "avisos" && <TelaAvisos />}
      {tela === "nova" && <TelaNova user={user} onFechar={janela.menu} />}
      {tela === "buscar" && <TelaBuscar user={user} />}
      {tela === "hoje" && <TelaHoje user={user} />}
      {tela === "perguntar" && <TelaPerguntar conversa={conversa} setConversa={setConversa} />}
    </Cartao>
  );
}

// ── O pulso da bolinha quando chega aviso ──────────────────────────────────

function usePulsando(pulso: number) {
  const [pulsando, setPulsando] = useState(false);
  const primeiro = useRef(pulso);
  useEffect(() => {
    if (pulso === primeiro.current) return;
    setPulsando(false);
    const a = requestAnimationFrame(() => setPulsando(true));
    const t = setTimeout(() => setPulsando(false), 2400);
    return () => { cancelAnimationFrame(a); clearTimeout(t); };
  }, [pulso]);
  return pulsando;
}

/** O círculo em si (o mesmo na bolinha recolhida e no meio do menu). */
function Circulo({ total, mais, pulsando, aberto }: { total: number; mais: boolean; pulsando: boolean; aberto?: boolean }) {
  const tem = total > 0;
  return (
    <span className={`relative w-14 h-14 rounded-full flex flex-col items-center justify-center text-white border-2 border-white/80 ${pulsando ? "qsb-pulso" : ""}`}
      style={{ background: aberto ? ESCURO : tem ? AZUL : ESCURO, boxShadow: "0 2px 10px rgba(15,23,42,.4)" }}>
      {aberto ? (
        <Svg tam={22}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>
      ) : tem ? (
        <span className="text-[19px] font-extrabold leading-none">{mais ? "50+" : total}</span>
      ) : (
        <>
          <Svg tam={18}>{ICONE.sino}</Svg>
          <span className="text-[9px] font-bold leading-none mt-0.5 tracking-wide">QS</span>
        </>
      )}
      {aberto && tem && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-red-600 text-white text-[10.5px] font-bold flex items-center justify-center border-2 border-white">
          {mais ? "50+" : total}
        </span>
      )}
    </span>
  );
}

// ── A bolinha (64×64) ──────────────────────────────────────────────────────

function Bolinha({ total, mais, pulso, onAbrir }: { total: number; mais: boolean; pulso: number; onAbrir: () => void }) {
  const pulsando = usePulsando(pulso);

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
  const rotulo = tem ? `${mais ? `${total}+` : total} aviso${total === 1 && !mais ? "" : "s"} novo${total === 1 && !mais ? "" : "s"} — abrir os atalhos` : "QS — abrir os atalhos";
  return (
    <div className="w-16 h-16 flex items-center justify-center select-none">
      <button type="button" aria-label={rotulo} title={rotulo}
        onMouseDown={onMouseDown}
        onClick={() => { if (!desktop()) onAbrir(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}
        className="rounded-full cursor-pointer focus:outline-none">
        <Circulo total={total} mais={mais} pulsando={pulsando} />
      </button>
    </div>
  );
}

// ── O menu: os 5 atalhos flutuando em volta da bolinha ─────────────────────

const RAIO = 96;

function MenuFlutuante({ total, mais, pulso, centro, onFechar, onEscolher }: {
  total: number; mais: boolean; pulso: number; centro: { cx: number; cy: number } | null;
  onFechar: () => void; onEscolher: (t: Tela) => void;
}) {
  const pulsando = usePulsando(pulso);
  const app = desktop();
  // No app: a janela é um quadrado transparente; o clique só "pega" em cima
  // de um ícone — fora deles atravessa pro programa de baixo.
  useEffect(() => {
    if (!app?.clicavel) return;
    let ultimo: boolean | null = null;
    const on = (e: MouseEvent) => {
      const sim = !!(e.target as Element | null)?.closest?.("[data-clicavel]");
      if (sim !== ultimo) { ultimo = sim; app.clicavel?.(sim); }
    };
    window.addEventListener("mousemove", on);
    return () => window.removeEventListener("mousemove", on);
  }, [app]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const c = app && centro ? centro : null;
  const estilo = c ? { left: c.cx, top: c.cy } : { left: "50%", top: "50%" };
  return (
    <div className={app ? "fixed inset-0 select-none" : "fixed inset-0 select-none"} style={app ? undefined : { background: "#CBD5E1" }}>
      <div className="absolute" style={estilo}>
        {ATALHOS.map((a, i) => {
          const ang = (-90 + i * (360 / ATALHOS.length)) * (Math.PI / 180);
          const x = Math.cos(ang) * RAIO;
          const y = Math.sin(ang) * RAIO;
          const contador = a.id === "avisos" && total ? (mais ? `${total}+` : String(total)) : null;
          return (
            <button key={a.id} type="button" data-clicavel onClick={() => onEscolher(a.id)}
              className="qsb-sai absolute flex flex-col items-center gap-1 focus:outline-none group"
              style={{ left: x, top: y, transform: "translate(-50%, -50%)", animationDelay: `${i * 35}ms`, ["--qsb-x" as string]: `${-x}px`, ["--qsb-y" as string]: `${-y}px` }}>
              <span className="relative w-[52px] h-[52px] rounded-full flex items-center justify-center text-white border-2 border-white/80 transition-transform group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-blue-200"
                style={{ background: a.cor, boxShadow: "0 3px 12px rgba(15,23,42,.4)" }}>
                <Svg tam={24}>{a.icone}</Svg>
                {contador && (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-red-600 text-white text-[10.5px] font-bold flex items-center justify-center border-2 border-white">
                    {contador}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                style={{ background: "rgba(15,23,42,.82)" }}>{a.rotulo}</span>
            </button>
          );
        })}
        <button type="button" data-clicavel onClick={onFechar} aria-label="Fechar os atalhos" title="Fechar"
          className="absolute rounded-full focus:outline-none" style={{ left: 0, top: 0, transform: "translate(-50%, -50%)" }}>
          <Circulo total={total} mais={mais} pulsando={pulsando} aberto />
        </button>
      </div>
    </div>
  );
}

// ── O cartão de um atalho (360×500) ────────────────────────────────────────

function Cartao({ titulo, icone, cor, janela, onVoltar, cheio, children }: {
  titulo: string; icone?: ReactNode; cor?: string; janela: Janela; onVoltar?: () => void; cheio?: boolean; children: ReactNode;
}) {
  const app = desktop();
  const caixa = (
    <div className="w-full h-full flex flex-col rounded-3xl overflow-hidden bg-slate-50 text-slate-900"
      style={{ fontFamily: "inherit", boxShadow: "0 8px 28px rgba(15,23,42,.35)" }}>
      <header className="flex items-center gap-2 px-2.5 h-12 bg-white flex-shrink-0 border-b border-slate-100">
        {onVoltar && (
          <button type="button" onClick={onVoltar} aria-label="Voltar aos atalhos" title="Voltar aos atalhos"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100">
            <Svg tam={20}>{ICONE.voltar}</Svg>
          </button>
        )}
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-white flex-shrink-0" style={{ background: cor ?? AZUL }}>
          {icone ? <Svg tam={15}>{icone}</Svg> : <span className="text-[10px] font-extrabold">QS</span>}
        </span>
        <h1 className="flex-1 min-w-0 truncate text-[15px] font-bold">{titulo}</h1>
        <button type="button" onClick={() => abrirNoQS(rotas.inicio())} aria-label="Abrir o QS" title="Abrir o QS no navegador"
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100">
          <Svg tam={17}>{ICONE.abrir}</Svg>
        </button>
        <button type="button" onClick={janela.recolher} aria-label="Recolher a bolinha" title="Recolher"
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100">
          <Svg tam={20}>{ICONE.minimizar}</Svg>
        </button>
      </header>
      <main className={`flex-1 min-h-0 px-3 py-3 ${cheio ? "flex flex-col" : "overflow-y-auto"}`}>{children}</main>
    </div>
  );
  // No app a janela é um pouco maior que o cartão (sobra pra sombra).
  if (app) return <div className="w-screen h-screen p-2">{caixa}</div>;
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#E2E8F0" }}>
      <div style={{ width: 360, height: 500 }}>{caixa}</div>
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
