// src/components/sdr/wa/QsWaDock.tsx
// -----------------------------------------------------------------------------
// O cockpit de atendimento do SDR — versão NATIVA (provider "qs").
//
// A conversa é do QS: o SDR não navega no Chatwoot, não precisa de conta lá, e
// não tem como abrir a caixa dos colegas — o banco só entrega as conversas dos
// leads dele (RLS das migrations 0024/0025).
//
// DESENHO — as duas decisões que mudam a experiência:
//
// 1. O painel PARA de espremer o app. Os pontos de quebra do QS leem a largura
//    da JANELA, não da coluna: quando o dock espremia o conteúdo, o topo
//    continuava em modo desktop e simplesmente CORTAVA os botões, em vez de
//    reorganizar. Isso não tem conserto por CSS sem reescrever o app inteiro.
//    Então: enquanto sobra app de verdade ele divide a tela; passando disso,
//    descola e flutua por cima, com o fundo levemente escurecido.
//
// 2. Acima de 560px vira LISTA + CONVERSA lado a lado. Antes, alargar só
//    entregava bolhas mais largas — custo sem benefício. Agora alargar compra
//    algo: ver quem está esperando enquanto responde alguém, que é como um SDR
//    realmente trabalha.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import WaThreadList from "./WaThreadList";
import WaConversation from "./WaConversation";
import { countUnread, subscribeToThreads, type WaThread } from "@/lib/qs/waInbox";

const PANEL_W = 440;        // padrão, e o que o duplo clique devolve
const MIN_W = 340;          // abaixo disso a conversa fica ilegível
const MAX_OVERLAY = 820;    // flutuando pode ser largo: não custa nada ao app
const APP_CONFORTO = 1024;  // largura mínima pro QS continuar "desktop"
const SPLIT_MIN_WIN = 1280; // num notebook 1366 não há tela pra dividir
const DUAS_COLUNAS = 560;   // a partir daqui, lista e conversa convivem
const STORAGE_KEY = "qs_wa_dock_width";
const AVISO_KEY = "qs_wa_avisos";

type Modo = "split" | "overlay" | "fullscreen";

function maxWidth(win?: number): number {
  const w = win ?? (typeof window === "undefined" ? 1440 : window.innerWidth);
  return Math.max(MIN_W, Math.min(MAX_OVERLAY, w - 320));
}

function clampWidth(v: number, win?: number): number {
  return Math.min(Math.max(Math.round(v), MIN_W), maxWidth(win));
}

function modoDoDock(win: number, largura: number): Modo {
  if (win < 768) return "fullscreen";
  if (win < SPLIT_MIN_WIN) return "overlay";
  return win - largura < APP_CONFORTO ? "overlay" : "split";
}

function useWinW() {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** Largura do dock, guardada por navegador — o SDR ajusta uma vez, não todo dia. */
function useDockWidth() {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return PANEL_W;
    const salvo = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(salvo) && salvo > 0 ? clampWidth(salvo) : PANEL_W;
  });

  const aplicar = useCallback((v: number, persistir = true) => {
    const w = clampWidth(v);
    setWidth(w);
    if (persistir) {
      try { window.localStorage.setItem(STORAGE_KEY, String(w)); } catch { /* anônimo */ }
    }
    return w;
  }, []);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { width, aplicar };
}

/** Bipe gerado na hora — um .mp3 hospedado é uma requisição que pode falhar
 *  justo na hora do aviso, e o som some sem ninguém perceber. */
function tocarBipe() {
  try {
    const Ctx = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => ctx.close();
  } catch { /* navegador bloqueou áudio sem gesto */ }
}

interface Alvo { leadId: string; name: string | null; phone: string | null; draft?: string | null }

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const P = {
  chat: "M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z",
  close: "M18 6 6 18M6 6l12 12",
  back: "M15 18l-6-6 6-6",
  widen: "M8 7 3 12l5 5M16 7l5 5-5 5M12 4v16",
  narrow: "M4 7l5 5-5 5M20 7l-5 5 5 5M12 4v16",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  bellOff: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18",
};

export default function QsWaDock({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const { isOpen, target, open, close } = useChatAppDock();
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const naoLidasRef = useRef(0);

  const [avisos, setAvisos] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(AVISO_KEY) !== "off";
  });

  const win = useWinW();
  const { width, aplicar } = useDockWidth();
  const modo = modoDoDock(win, width);
  const flutuando = isOpen && modo === "overlay";
  const duasColunas = isOpen && modo !== "fullscreen" && width >= DUAS_COLUNAS;

  // ── Avisos de mensagem nova ───────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    const atualizar = () => {
      countUnread().then((n) => {
        if (!vivo) return;
        // Só avisa quando o número SOBE. Zerar (o SDR leu) não pode tocar nada.
        if (n > naoLidasRef.current && avisos) {
          tocarBipe();
          try {
            if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
              new Notification("Nova mensagem no WhatsApp", {
                body: `${n} conversa${n > 1 ? "s" : ""} esperando você`,
                tag: "qs-wa",
              });
            }
          } catch { /* sem suporte */ }
        }
        naoLidasRef.current = n;
        setNaoLidas(n);
      });
    };
    atualizar();
    const off = subscribeToThreads(atualizar);
    return () => { vivo = false; off(); };
  }, [avisos]);

  const alternarAvisos = useCallback(async () => {
    const novo = !avisos;
    setAvisos(novo);
    try { window.localStorage.setItem(AVISO_KEY, novo ? "on" : "off"); } catch { /* anônimo */ }
    // Pedir permissão só funciona dentro do clique.
    if (novo && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* ignorado */ }
    }
  }, [avisos]);

  // Clicou no WhatsApp de um lead lá na fila → abre direto na conversa dele.
  useEffect(() => {
    if (target?.leadId) {
      setAlvo({
        leadId: target.leadId,
        name: target.name ?? null,
        phone: target.phone ?? null,
        draft: target.draft ?? null,
      });
    }
  }, [target?.leadId, target?.name, target?.phone, target?.draft]);

  // Esc fecha quando está por cima: é camada sobreposta, o hábito manda.
  useEffect(() => {
    if (!flutuando) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [flutuando, close]);

  // ── Redimensionar ─────────────────────────────────────────────────────────
  const [arrastando, setArrastando] = useState(false);
  const dragRef = useRef<{ x0: number; w0: number } | null>(null);
  const ultimaLargura = useRef(width);

  const aoPegar = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x0: e.clientX, w0: width };
    // Clicar sem arrastar gravaria uma largura antiga sem esta linha.
    ultimaLargura.current = width;
    setArrastando(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, [width]);

  const aoArrastar = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    ultimaLargura.current = aplicar(d.w0 + (d.x0 - e.clientX), false);
  }, [aplicar]);

  const aoSoltar = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setArrastando(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    aplicar(ultimaLargura.current);
  }, [aplicar]);

  useEffect(() => () => {
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  const aoTeclar = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); aplicar(width + 24); }
    else if (e.key === "ArrowRight") { e.preventDefault(); aplicar(width - 24); }
    else if (e.key === "Home") { e.preventDefault(); aplicar(PANEL_W); }
  }, [aplicar, width]);

  const largoAlvo = () => clampWidth(Math.round(win * 0.55));
  const estaLargo = width >= largoAlvo() - 8;
  const alternarLargura = () => aplicar(estaLargo ? PANEL_W : largoAlvo());

  const escolher = (t: WaThread) => {
    setAlvo({
      leadId: t.lead_id,
      name: t.lead?.full_name || t.lead?.first_name || null,
      phone: t.lead?.phone ?? null,
    });
  };

  const tituloBarra = duasColunas
    ? "Atendimento"
    : alvo ? (alvo.name || "Lead") : "Minhas conversas";
  const subtituloBarra = duasColunas
    ? "WhatsApp dos seus leads"
    : alvo ? (formatPhoneDisplay(alvo.phone) || "WhatsApp") : "Só os leads da sua carteira";

  return (
    <>
      {/* Botão flutuante */}
      {!isOpen && (
        <button
          onClick={open}
          title="Abrir atendimento (WhatsApp)"
          aria-label={naoLidas > 0 ? `Abrir atendimento — ${naoLidas} não lidas` : "Abrir atendimento"}
          className="qs-wa fixed z-[45] right-4 sm:right-6 flex items-center gap-2 h-12 pl-4 pr-4 rounded-2xl text-white font-semibold text-[13px] transition-transform duration-150 hover:scale-[1.03] active:scale-95"
          style={{
            background: "var(--wa)",
            boxShadow: "0 14px 30px -12px rgba(14,124,106,.65)",
            bottom: "calc(1.5rem + env(safe-area-inset-bottom))",
          }}
        >
          <Icon d={P.chat} size={19} />
          WhatsApp
          {naoLidas > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold grid place-items-center tabular-nums"
                  style={{ background: "#fff", color: "var(--wa)" }}>
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          )}
        </button>
      )}

      {/* Fundo escurecido quando o painel flutua — deixa claro que é camada */}
      {flutuando && (
        <div className="qs-wa-scrim fixed inset-0 z-[75]" onClick={close} aria-hidden="true" />
      )}

      <aside
        data-modo={modo}
        data-arrastando={arrastando ? "true" : undefined}
        className={`qs-wa qs-chatdock shrink-0 h-full overflow-hidden flex flex-col relative ${isOpen ? "qs-chatdock-open" : ""}`}
        style={{ ["--wa-dock-w" as string]: `${width}px` }}
        aria-hidden={!isOpen}
        {...(isOpen ? {} : { inert: "" })}
      >
        {/* Alça de redimensionar — inteiramente dentro do painel, pra não roubar
            cliques dos últimos pixels do app. */}
        {isOpen && modo !== "fullscreen" && (
          <div
            className="qs-chatdock-alca absolute left-0 top-0 h-full z-10 flex items-center justify-center"
            style={{ width: 12, cursor: "col-resize", touchAction: "none" }}
            onPointerDown={aoPegar}
            onPointerMove={aoArrastar}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
            onDoubleClick={() => aplicar(PANEL_W)}
            onKeyDown={aoTeclar}
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar a largura do atendimento"
            aria-valuenow={width}
            aria-valuemin={MIN_W}
            aria-valuemax={maxWidth(win)}
            tabIndex={0}
            title="Arraste para alargar · duplo clique volta ao padrão"
          >
            <span className="qs-chatdock-alca-linha rounded-full"
                  style={{
                    width: 3, height: 40,
                    background: arrastando ? "var(--wa)" : "var(--line)",
                    opacity: arrastando ? 1 : .9,
                  }} />
          </div>
        )}

        {/* Cabeçalho — superfície do QS, não barra verde de outro produto.
            O verde ficou reservado pra ação (enviar) e pro contador. */}
        <div className="shrink-0 flex items-center gap-2 pl-4 pr-2 h-14"
             style={{ background: "var(--card)", borderBottom: "1px solid var(--line)", minWidth: width }}>
          {alvo && !duasColunas ? (
            <button onClick={() => setAlvo(null)} title="Voltar para as conversas" aria-label="Voltar"
                    className="wa-icon-btn -ml-1.5 w-9 h-9 grid place-items-center rounded-lg">
              <Icon d={P.back} />
            </button>
          ) : (
            <span style={{ color: "var(--wa)" }}><Icon d={P.chat} size={19} /></span>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold leading-tight truncate" style={{ color: "var(--ink)" }}>
              {tituloBarra}
            </p>
            <p className="text-[12px] leading-tight truncate" style={{ color: "var(--ink3)" }}>
              {subtituloBarra}
            </p>
          </div>

          {alvo && onOpenLead && (
            <button onClick={() => onOpenLead(alvo.leadId)}
                    title="Abrir o card deste cliente"
                    className="wa-chip shrink-0 px-2.5 h-8 rounded-lg text-[12px] font-semibold"
                    style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
              Ver card
            </button>
          )}
          <button onClick={alternarAvisos}
                  title={avisos ? "Desligar som e notificação" : "Ligar som e notificação"}
                  aria-label={avisos ? "Desligar avisos" : "Ligar avisos"}
                  aria-pressed={avisos}
                  className="wa-icon-btn w-9 h-9 grid place-items-center rounded-lg">
            <Icon d={avisos ? P.bell : P.bellOff} size={17} />
          </button>
          <button onClick={alternarLargura}
                  title={estaLargo ? "Voltar ao tamanho normal" : "Alargar o painel"}
                  aria-label={estaLargo ? "Voltar ao tamanho normal" : "Alargar o painel"}
                  className="wa-icon-btn hidden md:grid w-9 h-9 place-items-center rounded-lg">
            <Icon d={estaLargo ? P.narrow : P.widen} size={17} />
          </button>
          <button onClick={close} title="Fechar" aria-label="Fechar atendimento"
                  className="wa-icon-btn w-9 h-9 grid place-items-center rounded-lg">
            <Icon d={P.close} />
          </button>
        </div>

        {/* Conteúdo — só monta aberto (não gasta query com o dock fechado) */}
        <div className="flex-1 min-h-0 flex" style={{ minWidth: width }}>
          {isOpen && (duasColunas ? (
            <>
              <div className="w-[292px] shrink-0 overflow-hidden"
                   style={{ borderRight: "1px solid var(--line)" }}>
                <WaThreadList selectedLeadId={alvo?.leadId ?? null} onPick={escolher} />
              </div>
              <div className="flex-1 min-w-0">
                {alvo
                  ? <WaConversation leadId={alvo.leadId} leadName={alvo.name} phone={alvo.phone} initialText={alvo.draft} />
                  : (
                    <div className="h-full grid place-items-center px-8 text-center" style={{ background: "var(--bg)" }}>
                      <div>
                        <span className="inline-grid place-items-center w-12 h-12 rounded-2xl mb-3"
                              style={{ background: "var(--card2)", color: "var(--ink3)" }}>
                          <Icon d={P.chat} size={22} />
                        </span>
                        <p className="text-[14px] font-semibold" style={{ color: "var(--ink2)" }}>
                          Escolha uma conversa
                        </p>
                        <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>
                          A lista à esquerda mostra quem está esperando.
                        </p>
                      </div>
                    </div>
                  )}
              </div>
            </>
          ) : (
            <div className="flex-1 min-w-0">
              {alvo
                ? <WaConversation leadId={alvo.leadId} leadName={alvo.name} phone={alvo.phone} initialText={alvo.draft} />
                : <WaThreadList selectedLeadId={null} onPick={escolher} />}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
