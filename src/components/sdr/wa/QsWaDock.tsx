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
// 1. O painel DIVIDE a tela e nunca cobre o QS. O objetivo dele é ganho de
//    tempo, e o SDR precisa seguir executando a cadência enquanto conversa —
//    se o painel bloqueia o app, ele custa mais tempo do que economiza.
//    O problema é que os pontos de quebra do QS leem a largura da JANELA, não
//    da coluna: espremido, o topo continuava em modo desktop e CORTAVA os
//    botões. Resolvido avisando o app (classe .qs-app-narrow no <html>), que
//    então troca pro menu lateral compacto que já existe pro celular.
//
// 2. Acima de 560px vira LISTA + CONVERSA lado a lado. Antes, alargar só
//    entregava bolhas mais largas — custo sem benefício. Agora alargar compra
//    algo: ver quem está esperando enquanto responde alguém, que é como um SDR
//    realmente trabalha.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { transferLead } from "@/lib/qs/queries";
import { notifySuccess } from "@/lib/qs/notify";
import WaThreadList from "./WaThreadList";
import WaConversation from "./WaConversation";
import { useWaAvisos } from "@/lib/qs/waAvisos";
import { listUsersLite, type WaThread, type UserLite } from "@/lib/qs/waInbox";

const PANEL_W = 440;       // padrão, e o que o duplo clique devolve
const MIN_W = 340;         // abaixo disso a conversa fica ilegível
const APP_MIN = 420;       // o QS ao lado nunca fica mais estreito que isto
const APP_CONFORTO = 1080;  // abaixo disso o topo do QS entra em modo compacto
const DUAS_COLUNAS = 560;  // a partir daqui, lista e conversa convivem
const STORAGE_KEY = "qs_wa_dock_width";

// Só dois modos, de propósito. Não existe mais "flutuar por cima": o painel
// serve pra GANHAR tempo, e cobrir o QS obriga o SDR a fechar a conversa toda
// vez que precisa tocar na cadência — que é o trabalho principal dele.
type Modo = "split" | "fullscreen";

/** Teto: metade da tela é alvo legítimo, mas o QS sempre sobra utilizável. */
function maxWidth(win?: number): number {
  const w = win ?? (typeof window === "undefined" ? 1440 : window.innerWidth);
  return Math.max(MIN_W, w - APP_MIN);
}

function clampWidth(v: number, win?: number): number {
  return Math.min(Math.max(Math.round(v), MIN_W), maxWidth(win));
}

function modoDoDock(win: number): Modo {
  return win < 768 ? "fullscreen" : "split";
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

interface Alvo {
  leadId: string;
  name: string | null;
  phone: string | null;
  /** Dono atual do lead — necessário pra transferência registrar o handover. */
  ownerId?: string | null;
  draft?: string | null;
}

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
  const { currentUser } = useQsAuth();
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  // Compartilhado com a aba de WhatsApp — só um dos dois fica montado por vez.
  const { naoLidas, avisos, alternarAvisos } = useWaAvisos();

  // ── Transferir o lead direto da conversa ──────────────────────────────────
  // O caso real: chega mensagem de um lead que na verdade é do colega (número
  // que ligou pro SDR errado, dupla que divide carteira). Antes o SDR tinha que
  // sair do atendimento, achar o lead no Painel e transferir por lá — aqui é
  // onde ele ESTÁ quando percebe o problema.
  const [transferindo, setTransferindo] = useState(false);   // popover aberto?
  const [transferBusy, setTransferBusy] = useState(false);
  const [sdrs, setSdrs] = useState<UserLite[]>([]);
  useEffect(() => {
    if (!transferindo) return;
    void listUsersLite().then((us) => setSdrs(us.filter((u) => u.is_active && (u.role === "sdr" || u.role === "closer"))));
  }, [transferindo]);

  const transferirPara = useCallback(async (destino: UserLite) => {
    if (!alvo || transferBusy) return;
    setTransferBusy(true);
    const ok = await transferLead(
      alvo.leadId,
      alvo.ownerId ?? currentUser?.id ?? null,
      destino.id,
      `Transferido pelo atendimento (WhatsApp) por ${currentUser?.name ?? "?"}`
    );
    setTransferBusy(false);
    setTransferindo(false);
    // Transferiu = a conversa deixa de ser deste SDR (a RLS corta na hora).
    // Fechar aqui evita a tela morta de "conversa que não carrega mais".
    if (ok) {
      notifySuccess(`${alvo.name ?? "Lead"} transferido para ${destino.name} — a conversa foi junto.`);
      setAlvo(null);
    }
  }, [alvo, transferBusy, currentUser]);

  const win = useWinW();
  const { width, aplicar } = useDockWidth();
  const modo = modoDoDock(win);
  const duasColunas = isOpen && modo !== "fullscreen" && width >= DUAS_COLUNAS;

  // O QS ao lado só tem os breakpoints da JANELA, não da coluna: sem este aviso
  // o topo continua em modo desktop e corta os botões em vez de reorganizar.
  // Com a classe, ele troca pro menu lateral que já existe — e segue navegável.
  useEffect(() => {
    const apertado = isOpen && modo === "split" && win - width < APP_CONFORTO;
    document.documentElement.classList.toggle("qs-app-narrow", apertado);
    return () => document.documentElement.classList.remove("qs-app-narrow");
  }, [isOpen, modo, win, width]);

  // Clicou no WhatsApp de um lead lá na fila → abre direto na conversa dele.
  useEffect(() => {
    if (target?.leadId) {
      setTransferindo(false);   // popover aberto não pode "vazar" pra outra conversa
      setAlvo({
        leadId: target.leadId,
        name: target.name ?? null,
        phone: target.phone ?? null,
        ownerId: target.ownerId ?? null,
        draft: target.draft ?? null,
      });
    }
  }, [target?.leadId, target?.name, target?.phone, target?.ownerId, target?.draft]);

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

  const largoAlvo = () => clampWidth(Math.round(win * 0.5));   // metade da tela
  const estaLargo = width >= largoAlvo() - 8;
  const alternarLargura = () => aplicar(estaLargo ? PANEL_W : largoAlvo());

  const escolher = (t: WaThread) => {
    setTransferindo(false);
    setAlvo({
      leadId: t.lead_id,
      name: t.lead?.full_name || t.lead?.first_name || null,
      phone: t.lead?.phone ?? null,
      ownerId: t.lead?.owner_id ?? null,
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
          {alvo && (
            <div className="relative shrink-0">
              <button onClick={() => setTransferindo((v) => !v)}
                      title="Transferir este lead para outro SDR"
                      aria-expanded={transferindo}
                      className="wa-chip px-2.5 h-8 rounded-lg text-[12px] font-semibold"
                      style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
                Transferir
              </button>
              {transferindo && (
                <div className="absolute right-0 top-10 z-30 w-56 rounded-xl border shadow-lg overflow-hidden"
                     style={{ borderColor: "var(--line)", background: "var(--card)" }}>
                  <p className="px-3 pt-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-wide"
                     style={{ color: "var(--ink3)" }}>
                    Transferir para
                  </p>
                  {sdrs.filter((u) => u.id !== (alvo.ownerId ?? currentUser?.id)).length === 0 ? (
                    <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--ink3)" }}>
                      Nenhum outro SDR ativo.
                    </p>
                  ) : (
                    sdrs.filter((u) => u.id !== (alvo.ownerId ?? currentUser?.id)).map((u) => (
                      <button key={u.id}
                              onClick={() => void transferirPara(u)}
                              disabled={transferBusy}
                              className="wa-row-btn w-full text-left px-3 py-2 text-[13px] font-medium disabled:opacity-50"
                              style={{ color: "var(--ink)" }}>
                        {u.name}
                      </button>
                    ))
                  )}
                  <p className="px-3 py-2 text-[10.5px] leading-snug border-t"
                     style={{ color: "var(--ink3)", borderColor: "var(--line)" }}>
                    A conversa, as atividades e o histórico vão junto. Esta conversa sai da sua lista.
                  </p>
                </div>
              )}
            </div>
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
                <WaThreadList selectedLeadId={alvo?.leadId ?? null} onPick={escolher} onOpenLead={onOpenLead} />
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
                : <WaThreadList selectedLeadId={null} onPick={escolher} onOpenLead={onOpenLead} />}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
