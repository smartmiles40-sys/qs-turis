// src/components/sdr/wa/QsWaDock.tsx
// -----------------------------------------------------------------------------
// O cockpit de atendimento do SDR — versão NATIVA (provider "qs").
//
// Diferença pro ChatwootDock (que embutia o painel do Chatwoot num iframe): aqui
// a conversa é do QS. O SDR não navega no Chatwoot, não precisa de conta lá, e
// não tem como abrir a caixa dos colegas — o banco só entrega as conversas dos
// leads dele (RLS da migration 0024).
//
// Mesma casca do dock antigo de propósito (mesma posição, mesma largura, mesmo
// atalho): pra quem usa, muda o conteúdo, não o hábito.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import WaThreadList from "./WaThreadList";
import WaConversation from "./WaConversation";
import { countUnread, subscribeToThreads, type WaThread } from "@/lib/qs/waInbox";

const WA_GREEN = "#12A18A";

// Largura do painel (só no computador — no celular ele ocupa a tela inteira).
const PANEL_W = 440;   // padrão, e o que o botão "restaurar" devolve
const MIN_W = 340;     // abaixo disso a conversa fica ilegível
const APP_MIN = 480;   // o QS atrás precisa continuar utilizável
const STORAGE_KEY = "qs_wa_dock_width";

/** Teto real: nunca deixa o painel engolir o app. */
function maxWidth(): number {
  if (typeof window === "undefined") return 900;
  return Math.max(MIN_W, window.innerWidth - APP_MIN);
}

function clampWidth(w: number): number {
  return Math.min(Math.max(Math.round(w), MIN_W), maxWidth());
}

/**
 * Largura do dock, guardada por navegador. O SDR passa o dia nessa tela — pedir
 * pra ele reajustar toda vez que abre o QS seria tortura.
 */
function useDockWidth() {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return PANEL_W;
    const salvo = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(salvo) && salvo > 0 ? clampWidth(salvo) : PANEL_W;
  });

  const aplicar = useCallback((w: number, persistir = true) => {
    const v = clampWidth(w);
    setWidth(v);
    if (persistir) {
      try { window.localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* modo anônimo */ }
    }
    return v;
  }, []);

  // Janela diminuiu (ou o SDR mudou de monitor): reencaixa sem perder a
  // preferência salva — senão o painel poderia cobrir o app inteiro.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { width, aplicar };
}

interface Alvo {
  leadId: string;
  name: string | null;
  phone: string | null;
}

function IconChat({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
    </svg>
  );
}
function IconClose({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function IconBack({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
/** Setas pra fora = alargar; pra dentro = voltar ao tamanho normal. */
function IconWiden({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7 3 12l5 5M16 7l5 5-5 5M12 4v16" />
    </svg>
  );
}
function IconNarrow({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l5 5-5 5M20 7l-5 5 5 5M12 4v16" />
    </svg>
  );
}

export default function QsWaDock() {
  const { isOpen, target, open, close } = useChatAppDock();
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);

  // Badge do botão: sem isso, mensagem nova só é descoberta abrindo o painel.
  // Roda mesmo com o dock fechado — é uma query leve e é o ponto todo do aviso.
  useEffect(() => {
    let vivo = true;
    const atualizar = () => { countUnread().then((n) => { if (vivo) setNaoLidas(n); }); };
    atualizar();
    const off = subscribeToThreads(atualizar);
    return () => { vivo = false; off(); };
  }, []);

  // Clicou no WhatsApp de um lead lá na fila → abre direto na conversa dele.
  useEffect(() => {
    if (target?.leadId) {
      setAlvo({ leadId: target.leadId, name: target.name ?? null, phone: target.phone ?? null });
    }
  }, [target?.leadId, target?.name, target?.phone]);

  // ── Redimensionar ─────────────────────────────────────────────────────────
  const { width, aplicar } = useDockWidth();
  const [arrastando, setArrastando] = useState(false);
  const dragRef = useRef<{ x0: number; w0: number } | null>(null);
  const ultimaLargura = useRef(width);

  const aoPegar = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x0: e.clientX, w0: width };
    // Sincroniza aqui: se o SDR clicar na alça SEM arrastar, o "soltar" grava
    // este valor. Sem esta linha ele gravaria uma largura antiga (de antes de
    // usar o botão de alargar ou o teclado) e o painel pularia sozinho.
    ultimaLargura.current = width;
    setArrastando(true);
    // Sem isto, arrastar seleciona texto do app atrás e fica tudo azul.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, [width]);

  const aoArrastar = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    // Puxar pra ESQUERDA alarga (a alça fica na borda esquerda do painel).
    ultimaLargura.current = aplicar(d.w0 + (d.x0 - e.clientX), false);
  }, [aplicar]);

  const aoSoltar = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setArrastando(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    aplicar(ultimaLargura.current);   // grava só no fim do arraste
  }, [aplicar]);

  // Se o componente sumir no meio de um arraste, não deixa o app travado
  // com o texto inselecionável e o cursor de redimensionar.
  useEffect(() => () => {
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  // Teclado: a alça é focável e as setas ajustam de 24 em 24px.
  const aoTeclar = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); aplicar(width + 24); }
    else if (e.key === "ArrowRight") { e.preventDefault(); aplicar(width - 24); }
    else if (e.key === "Home") { e.preventDefault(); aplicar(PANEL_W); }
  }, [aplicar, width]);

  const largoAlvo = () => clampWidth(Math.round(window.innerWidth * 0.6));
  const estaLargo = typeof window !== "undefined" && width >= largoAlvo() - 8;
  const alternarLargura = () => aplicar(estaLargo ? PANEL_W : largoAlvo());

  const escolher = (t: WaThread) => {
    setAlvo({
      leadId: t.lead_id,
      name: t.lead?.full_name || t.lead?.first_name || null,
      phone: t.lead?.phone ?? null,
    });
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={open}
          title="Abrir atendimento (WhatsApp)"
          aria-label="Abrir atendimento"
          className="fixed z-[45] right-4 sm:right-6 flex items-center gap-2 h-12 pl-3.5 pr-4 rounded-full text-white font-bold text-[13px] shadow-lg transition-transform hover:scale-105"
          style={{ background: WA_GREEN, boxShadow: "0 10px 24px -8px rgba(18,161,138,.7)", bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        >
          <IconChat size={20} />
          WhatsApp
          {naoLidas > 0 && (
            <span
              className="ml-0.5 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold grid place-items-center"
              style={{ background: "#fff", color: "#0E7C6A" }}
            >
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          )}
        </button>
      )}

      <aside
        className={`qs-chatdock shrink-0 h-full overflow-hidden flex flex-col relative ${isOpen ? "qs-chatdock-open" : ""}`}
        style={{
          width: isOpen ? width : 0,
          // Sem transição enquanto arrasta: senão o painel "persegue" o mouse.
          transition: arrastando ? "none" : "width .28s cubic-bezier(.4,0,.2,1)",
          borderLeft: isOpen ? "1px solid var(--line)" : "none",
          background: "var(--card)",
        }}
        aria-hidden={!isOpen}
      >
        <style>{`
          @media (max-width: 767px) {
            .qs-chatdock { position: fixed; inset: 0; z-index: 80; width: 0 !important; border-left: none !important; }
            .qs-chatdock:not(.qs-chatdock-open) { pointer-events: none; }
            .qs-chatdock-open { width: 100vw !important; }
            .qs-chatdock-alca { display: none; }   /* no celular ocupa a tela toda */
          }
          .qs-chatdock-alca:hover .qs-chatdock-alca-linha,
          .qs-chatdock-alca:focus-visible .qs-chatdock-alca-linha { background: ${WA_GREEN}; opacity: 1; }
          .qs-chatdock-alca:focus-visible { outline: none; }
        `}</style>

        {/* Alça de redimensionar — faixa fina na borda esquerda do painel */}
        {isOpen && (
          <div
            className="qs-chatdock-alca absolute left-0 top-0 h-full z-10 flex items-center justify-center"
            style={{ width: 10, marginLeft: -5, cursor: "col-resize", touchAction: "none" }}
            onPointerDown={aoPegar}
            onPointerMove={aoArrastar}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
            onDoubleClick={() => aplicar(PANEL_W)}
            onKeyDown={aoTeclar}
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar a largura do atendimento (setas do teclado; duplo clique volta ao padrão)"
            aria-valuenow={width}
            aria-valuemin={MIN_W}
            aria-valuemax={maxWidth()}
            tabIndex={0}
            title="Arraste para alargar · duplo clique volta ao padrão"
          >
            <span
              className="qs-chatdock-alca-linha rounded-full"
              style={{
                width: 3, height: 44,
                background: arrastando ? WA_GREEN : "var(--ink3)",
                opacity: arrastando ? 1 : 0.35,
                transition: "background .15s, opacity .15s",
              }}
            />
          </div>
        )}

        {/* Cabeçalho */}
        <div className="shrink-0 flex items-center gap-2 px-3 h-14 text-white" style={{ background: WA_GREEN, minWidth: width }}>
          {alvo ? (
            <button onClick={() => setAlvo(null)} title="Voltar para as conversas"
                    aria-label="Voltar" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors">
              <IconBack size={18} />
            </button>
          ) : (
            <IconChat size={20} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold leading-tight truncate">
              {alvo ? (alvo.name || "Lead") : "Minhas conversas"}
            </p>
            <p className="text-[10.5px] opacity-90 leading-tight truncate">
              {alvo ? (formatPhoneDisplay(alvo.phone) || "WhatsApp") : "Só os leads da sua carteira"}
            </p>
          </div>
          <button
            onClick={alternarLargura}
            title={estaLargo ? "Voltar ao tamanho normal" : "Alargar o painel"}
            aria-label={estaLargo ? "Voltar ao tamanho normal" : "Alargar o painel"}
            className="hidden md:block p-1.5 rounded-lg hover:bg-white/15 transition-colors"
          >
            {estaLargo ? <IconNarrow size={17} /> : <IconWiden size={17} />}
          </button>
          <button onClick={close} title="Fechar" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </div>

        {/* Conteúdo — só monta quando aberto (não gasta query com o dock fechado) */}
        <div className="flex-1 min-h-0" style={{ minWidth: width }}>
          {isOpen && (
            alvo
              ? <WaConversation leadId={alvo.leadId} leadName={alvo.name} phone={alvo.phone} />
              : <WaThreadList selectedLeadId={null} onPick={escolher} />
          )}
        </div>
      </aside>
    </>
  );
}
