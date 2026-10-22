// src/avisos/AvisosProvider.tsx
// -----------------------------------------------------------------------------
// O "CÉREBRO" DOS AVISOS (0196). Montado UMA vez pro app logado inteiro (App.tsx,
// por fora das cascas): Comercial, Closer, Relacionamento, Financeiro e Operações
// usam o mesmo — e a bolinha flutuante não fecha quando a pessoa troca de área.
//
//   • 1 consulta leve ao abrir (os não lidos, no índice) + Realtime FILTRADO
//     por user_id=eq.<eu>. Nada de recontar de tempos em tempos.
//   • Aviso novo → bip (se não estiver mudo), pulso na bolinha e, com a aba
//     escondida, a notificação do Windows (se a pessoa deu permissão).
//   • Clique num aviso → marca lido e abre a tela certa (troca de área se
//     o aviso for de outra área da pessoa).
// -----------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import {
  bip, carregarNaoLidos, gravarPrefs, LIMITE, lerPrefs, marcarLidos, pegarVez, prepararSom, temBolinha, temNotificacao,
  type Aviso, type PrefsAvisos,
} from "./lib";
import BolinhaFlutuante, { CSS_BOLINHA } from "./BolinhaFlutuante";

interface ValorAvisos {
  /** Não lidos, do mais novo pro mais velho (até LIMITE). */
  avisos: Aviso[];
  /** Quantos não lidos (passa de LIMITE = "50+"). */
  total: number;
  maisQueLimite: boolean;
  abrir: (a: Aviso) => void;
  marcar: (ids: number[]) => void;
  marcarTodos: () => void;
  prefs: PrefsAvisos;
  mudarPrefs: (p: Partial<PrefsAvisos>) => void;
  /** Permissão das notificações do Windows: "default" | "granted" | "denied" | "indisponivel". */
  permissao: NotificationPermission | "indisponivel";
  pedirPermissao: () => Promise<void>;
  bolinhaAberta: boolean;
  bolinhaSuportada: boolean;
  abrirBolinha: () => Promise<string | null>;
  fecharBolinha: () => void;
}

const Ctx = createContext<ValorAvisos | null>(null);

/** Use dentro do app logado. Fora do provider devolve null (o sino some sozinho). */
export function useAvisos(): ValorAvisos | null {
  return useContext(Ctx);
}

type DocPiP = { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window>; window: Window | null };

export default function AvisosProvider({ children }: { children: ReactNode }) {
  const { currentUser, area, trocarArea } = useQsAuth();
  const userId = currentUser?.id ?? null;
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [prefs, setPrefs] = useState<PrefsAvisos>(lerPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [permissao, setPermissao] = useState<NotificationPermission | "indisponivel">(
    temNotificacao() ? Notification.permission : "indisponivel",
  );
  const [pip, setPip] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);
  pipRef.current = pip;
  const [pulso, setPulso] = useState(0);
  const [oferecerReabrir, setOferecerReabrir] = useState(false);
  const saindo = useRef(false);

  // ── Abrir um aviso: marca lido e leva pra tela ─────────────────────────────
  const irPara = useCallback((a: Aviso) => {
    const link = a.link;
    if (!link || !link.startsWith("#")) return;
    const outraArea = a.area && a.area !== area && currentUser && setoresDe(currentUser).includes(a.area);
    // Comercial: o closer (e a gestão dentro da Área do Closer) fica na mesma porta.
    if (outraArea && a.area) {
      history.replaceState(null, "", window.location.pathname + window.location.search + link);
      trocarArea(a.area);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    if (window.location.hash === link) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else window.location.hash = link;
  }, [area, currentUser, trocarArea]);

  const marcar = useCallback((ids: number[]) => {
    if (!ids.length) return;
    setAvisos((l) => l.filter((x) => !ids.includes(x.id)));
    marcarLidos(ids).catch((e) => console.warn("[avisos] marcar lido:", e));
  }, []);
  const marcarTodos = useCallback(() => {
    setAvisos([]);
    marcarLidos("todos").catch((e) => console.warn("[avisos] marcar todos:", e));
  }, []);
  const abrir = useCallback((a: Aviso) => {
    if (!a.lido_em) marcar([a.id]);
    irPara(a);
  }, [irPara, marcar]);
  const abrirRef = useRef(abrir);
  abrirRef.current = abrir;

  // ── Chegou aviso novo ──────────────────────────────────────────────────────
  const avisar = useCallback((a: Aviso) => {
    setPulso((n) => n + 1);
    if (!pegarVez(a.id)) return; // outra aba já tocou
    if (!prefsRef.current.semBip) bip();
    // Com a bolinha aberta ela já pulsa na tela: não repete no canto do Windows.
    const escondida = (document.hidden || !document.hasFocus()) && !pipRef.current;
    if (escondida && !prefsRef.current.semWindows && temNotificacao() && Notification.permission === "granted") {
      try {
        const n = new Notification(a.titulo, { body: a.texto ?? "", tag: `qs-aviso-${a.id}`, icon: "/favicon.svg" });
        n.onclick = () => { window.focus(); abrirRef.current(a); n.close(); };
      } catch { /* alguns navegadores só deixam via service worker — fica o bip */ }
    }
  }, []);

  // ── Carga inicial + Realtime filtrado ──────────────────────────────────────
  const recarregar = useCallback(() => {
    if (!userId) return;
    carregarNaoLidos(userId).then((lista) => {
      // (revisão) um aviso que chegou pelo Realtime ENQUANTO a consulta estava
      // no caminho não vem nela: mantém os mais novos que o mais novo da consulta.
      const maior = lista.reduce((m, a) => Math.max(m, a.id), 0);
      setAvisos((atual) => {
        const novos = atual.filter((a) => a.id > maior);
        return novos.length ? [...novos, ...lista].slice(0, LIMITE + 1) : lista;
      });
    }).catch((e) => console.warn("[avisos] carregar:", e));
  }, [userId]);

  useEffect(() => {
    setAvisos([]); // trocou de pessoa: nada da anterior fica na tela
    if (!userId) return;
    recarregar();
    let primeiraConexao = true;
    const canal = supabase
      .channel(`avisos:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "qs_avisos", filter: `user_id=eq.${userId}` }, (p) => {
        const a = p.new as Aviso;
        if (a.lido_em) return;
        setAvisos((l) => (l.some((x) => x.id === a.id) ? l : [a, ...l].slice(0, LIMITE + 1)));
        avisar(a);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "qs_avisos", filter: `user_id=eq.${userId}` }, (p) => {
        const a = p.new as Aviso;
        // lido em outra aba/computador: sai da lista daqui também
        if (a.lido_em) setAvisos((l) => l.filter((x) => x.id !== a.id));
      })
      .subscribe((status) => {
        // reconectou (internet caiu, computador dormiu): pega o que perdeu
        if (status === "SUBSCRIBED") {
          if (!primeiraConexao) recarregar();
          primeiraConexao = false;
        }
      });
    return () => { void supabase.removeChannel(canal); };
  }, [userId, recarregar, avisar]);

  // Voltou pra aba depois de muito tempo escondida: confere uma vez (sem polling).
  useEffect(() => {
    let escondeuEm = 0;
    const on = () => {
      if (document.hidden) { escondeuEm = Date.now(); return; }
      if (escondeuEm && Date.now() - escondeuEm > 10 * 60_000) recarregar();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [recarregar]);

  // O som só é liberado depois de um gesto: prepara no primeiro clique/tecla.
  useEffect(() => {
    const on = () => prepararSom();
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => { window.removeEventListener("pointerdown", on); window.removeEventListener("keydown", on); };
  }, []);

  // ── Preferências e permissão ───────────────────────────────────────────────
  const mudarPrefs = useCallback((p: Partial<PrefsAvisos>) => {
    setPrefs((atual) => { const n = { ...atual, ...p }; gravarPrefs(n); return n; });
  }, []);

  const pedirPermissao = useCallback(async () => {
    if (!temNotificacao()) return;
    prepararSom();
    try {
      const r = await Notification.requestPermission();
      setPermissao(r);
      if (r === "granted") mudarPrefs({ semWindows: false });
    } catch { /* navegador antigo */ }
  }, [mudarPrefs]);

  // ── Bolinha flutuante (Document Picture-in-Picture) ────────────────────────
  const abrirBolinha = useCallback(async (): Promise<string | null> => {
    if (!temBolinha()) return "Seu navegador não tem a bolinha flutuante. Use o Chrome ou o Edge atualizado (versão 116 ou mais nova).";
    prepararSom();
    const dpip = (window as unknown as { documentPictureInPicture: DocPiP }).documentPictureInPicture;
    if (dpip.window) { dpip.window.focus(); return null; }
    try {
      const w = await dpip.requestWindow({ width: 150, height: 150 });
      w.document.title = "Avisos do QS";
      const st = w.document.createElement("style");
      st.textContent = CSS_BOLINHA;
      w.document.head.appendChild(st);
      w.addEventListener("pagehide", () => {
        setPip(null);
        // fechou no X (com o QS aberto) = não quer mais; QS recarregando = reabre depois
        if (!saindo.current) mudarPrefs({ bolinha: false });
      });
      setPip(w);
      setOferecerReabrir(false);
      mudarPrefs({ bolinha: true });
      return null;
    } catch (e) {
      console.warn("[avisos] bolinha:", e);
      return "Não deu pra abrir a bolinha agora. Clique de novo no botão (o navegador só abre com um clique).";
    }
  }, [mudarPrefs]);

  const fecharBolinha = useCallback(() => {
    mudarPrefs({ bolinha: false });
    pip?.close();
  }, [pip, mudarPrefs]);

  // (revisão) saiu do QS (logout) com a bolinha aberta: o provider desmonta e a
  // janelinha ficaria vazia por cima de tudo. Fecha junto.
  useEffect(() => () => { try { pipRef.current?.close(); } catch { /* já fechou */ } }, []);

  useEffect(() => {
    const on = () => { saindo.current = true; };
    window.addEventListener("pagehide", on);
    window.addEventListener("beforeunload", on);
    return () => { window.removeEventListener("pagehide", on); window.removeEventListener("beforeunload", on); };
  }, []);

  // A pessoa usava a bolinha e o QS recarregou: oferece reabrir (o navegador
  // exige um clique — não dá pra abrir sozinha).
  useEffect(() => {
    if (userId && prefs.bolinha && !pip && temBolinha()) {
      const t = setTimeout(() => setOferecerReabrir(true), 1500);
      return () => clearTimeout(t);
    }
    setOferecerReabrir(false);
  }, [userId, prefs.bolinha, pip]);

  const total = avisos.length;
  const valor = useMemo<ValorAvisos>(() => ({
    avisos: avisos.slice(0, LIMITE), total: Math.min(total, LIMITE), maisQueLimite: total > LIMITE,
    abrir, marcar, marcarTodos, prefs, mudarPrefs, permissao, pedirPermissao,
    bolinhaAberta: !!pip, bolinhaSuportada: temBolinha(), abrirBolinha, fecharBolinha,
  }), [avisos, total, abrir, marcar, marcarTodos, prefs, mudarPrefs, permissao, pedirPermissao, pip, abrirBolinha, fecharBolinha]);

  return (
    <Ctx.Provider value={valor}>
      {children}
      {pip && createPortal(
        <BolinhaFlutuante
          total={Math.min(total, LIMITE)} mais={total > LIMITE} pulso={pulso}
          ultimo={avisos[0] ?? null}
          onClicar={() => {
            window.focus();
            const a = avisos[0];
            if (a) abrir(a);
          }}
        />,
        pip.document.body,
      )}
      {oferecerReabrir && (
        <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3 py-2 rounded-xl shadow-lg text-[13px]"
          style={{ background: "var(--card, #fff)", color: "var(--ink, #111)", border: "1px solid var(--line, #e5e7eb)", maxWidth: "calc(100vw - 32px)" }}>
          <span>Você usava a bolinha de avisos.</span>
          <button onClick={() => void abrirBolinha()} className="px-2.5 py-1 rounded-lg font-bold text-white" style={{ background: "#0147FF" }}>Reabrir</button>
          <button onClick={() => { setOferecerReabrir(false); mudarPrefs({ bolinha: false }); }} className="px-2 py-1 rounded-lg font-semibold"
            style={{ color: "var(--ink3, #6b7280)" }}>Agora não</button>
        </div>
      )}
    </Ctx.Provider>
  );
}
