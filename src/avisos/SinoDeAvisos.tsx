// src/avisos/SinoDeAvisos.tsx
// -----------------------------------------------------------------------------
// O SINO com contador + o PAINEL dos avisos (0196).
//
//   • SinoDeAvisos       → sino próprio, pras cascas que ainda não tinham um
//                          (Relacionamento, Financeiro, Operações, Closer).
//   • ListaDeAvisos      → a lista (o Comercial pendura no sino que já existe,
//                          o NotificationsPanel — não tem 2 sinos na tela).
//   • AjustesDeAvisos    → bolinha flutuante, Windows e bip.
// -----------------------------------------------------------------------------
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { useAvisos } from "./AvisosProvider";
import { carregarLidos, COR_TIPO, haQuanto, ROTULO_TIPO, type Aviso } from "./lib";

const SINO = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/** Uma linha de aviso. */
function Linha({ a, onAbrir, onLido }: { a: Aviso; onAbrir: () => void; onLido?: () => void }) {
  const cor = COR_TIPO[a.tipo] ?? "#0147FF";
  return (
    <li className="group flex items-start border-b last:border-b-0" style={{ borderColor: "var(--line)", opacity: a.lido_em ? 0.6 : 1 }}>
      <button onClick={onAbrir} className="flex-1 min-w-0 text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-[var(--card2)]">
        <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.lido_em ? "var(--line)" : cor }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>{a.titulo}</span>
          {a.texto && <span className="block text-[12px] leading-snug mt-0.5 line-clamp-2" style={{ color: "var(--ink2)" }}>{a.texto}</span>}
          <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>
            <span style={{ color: cor, fontWeight: 700 }}>{ROTULO_TIPO[a.tipo] ?? "Aviso"}</span> · {haQuanto(a.criado_em)}
          </span>
        </span>
      </button>
      {onLido && !a.lido_em && (
        <button onClick={onLido} title="Marcar como lido" aria-label="Marcar como lido"
          className="px-3 py-3 text-[12px] font-bold opacity-60 hover:opacity-100" style={{ color: "var(--ink3)" }}>✓</button>
      )}
    </li>
  );
}

/** A lista dos avisos (não lidos + "ver os já lidos"). */
export function ListaDeAvisos({ onDepoisDeAbrir, compacta }: { onDepoisDeAbrir?: () => void; compacta?: boolean }) {
  const ctx = useAvisos();
  const { currentUser } = useQsAuth();
  const [lidos, setLidos] = useState<Aviso[] | null>(null);
  const [verLidos, setVerLidos] = useState(false);
  useEffect(() => {
    if (!verLidos || !currentUser) return;
    carregarLidos(currentUser.id).then(setLidos).catch(() => setLidos([]));
  }, [verLidos, currentUser]);
  if (!ctx) return null;
  const abrir = (a: Aviso) => { ctx.abrir(a); onDepoisDeAbrir?.(); };

  return (
    <div>
      {ctx.avisos.length === 0 ? (
        !compacta && (
          <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>
            Nenhum aviso novo. Quando chegar solicitação, prazo ou reunião, aparece aqui (e toca um bip).
          </p>
        )
      ) : (
        <ul>
          {ctx.avisos.map((a) => <Linha key={a.id} a={a} onAbrir={() => abrir(a)} onLido={() => ctx.marcar([a.id])} />)}
        </ul>
      )}
      {!compacta && (
        <div className="px-4 py-2 border-t" style={{ borderColor: "var(--line)" }}>
          <button onClick={() => setVerLidos((v) => !v)} className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>
            {verLidos ? "Esconder os já lidos" : "Ver os já lidos"}
          </button>
          {verLidos && (
            lidos === null ? <p className="text-[12px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>
              : lidos.length === 0 ? <p className="text-[12px] py-2" style={{ color: "var(--ink3)" }}>Nada lido nos últimos 30 dias.</p>
              : <ul className="-mx-4 mt-1">{lidos.map((a) => <Linha key={a.id} a={a} onAbrir={() => abrir(a)} />)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Bolinha flutuante, notificação do Windows e bip. */
export function AjustesDeAvisos() {
  const ctx = useAvisos();
  const [erroBolinha, setErroBolinha] = useState<string | null>(null);
  if (!ctx) return null;
  const { prefs, mudarPrefs, permissao } = ctx;
  return (
    <div className="space-y-2.5 text-[12px]" style={{ color: "var(--ink2)" }}>
      <div>
        {ctx.bolinhaAberta ? (
          <button onClick={ctx.fecharBolinha} className="w-full px-3 py-2 rounded-lg font-bold" style={{ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" }}>
            Fechar a bolinha flutuante
          </button>
        ) : (
          <button onClick={async () => setErroBolinha(await ctx.abrirBolinha())} className="w-full px-3 py-2 rounded-lg font-bold text-white" style={{ background: "#0147FF" }}>
            Abrir bolinha flutuante
          </button>
        )}
        <p className="mt-1 leading-snug" style={{ color: "var(--ink3)" }}>
          {ctx.bolinhaSuportada
            ? "Uma janelinha redonda que fica por cima de tudo, até de outros programas. Arraste pela barrinha de cima. Ela fecha se o QS fechar."
            : "Seu navegador não tem a bolinha flutuante. Use o Chrome ou o Edge atualizado."}
        </p>
        {erroBolinha && <p className="mt-1 font-semibold" style={{ color: "var(--err-ink)" }}>{erroBolinha}</p>}
      </div>

      <div>
        {permissao === "granted" ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!prefs.semWindows} onChange={(e) => mudarPrefs({ semWindows: !e.target.checked })} />
            Avisar no canto do Windows quando o QS estiver escondido
          </label>
        ) : permissao === "denied" ? (
          <p className="leading-snug">O navegador está <b>bloqueando</b> os avisos do Windows. Pra liberar: clique no cadeado ao lado do endereço → Notificações → Permitir.</p>
        ) : permissao === "indisponivel" ? (
          <p className="leading-snug">Este navegador não mostra avisos do Windows.</p>
        ) : (
          <button onClick={() => void ctx.pedirPermissao()} className="w-full px-3 py-2 rounded-lg font-bold" style={{ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" }}>
            Ativar avisos do Windows
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!prefs.semBip} onChange={(e) => mudarPrefs({ semBip: !e.target.checked })} />
        Tocar um bip quando chegar aviso
      </label>
    </div>
  );
}

/** Sino + painel, pras cascas que ainda não tinham sino. */
export default function SinoDeAvisos() {
  const ctx = useAvisos();
  const [aberto, setAberto] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  // O painel é "fixed" (o sino mora no menu lateral, que corta o que passa da borda).
  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const largura = Math.min(380, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)) });
  }, [aberto]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!painel.current?.contains(t) && !botao.current?.contains(t)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  if (!ctx) return null;
  const n = ctx.total;
  const rotulo = ctx.maisQueLimite ? `${n}+` : n > 9 ? "9+" : String(n);

  return (
    <>
      <button ref={botao} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
        aria-label={n ? `Avisos: ${n} novos` : "Avisos"} title="Avisos"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0"
        style={{ color: "var(--ink2)", background: aberto ? "var(--card2)" : "transparent" }}>
        {SINO}
        {n > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold text-white"
            style={{ background: "#EF4444", boxShadow: "0 0 0 2px var(--card)" }}>{rotulo}</span>
        )}
      </button>
      {aberto && pos && (
        <div ref={painel} role="dialog" aria-label="Avisos"
          className="fixed z-[70] rounded-xl shadow-xl border flex flex-col overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: "min(380px, calc(100vw - 16px))", maxHeight: "min(560px, 80vh)", background: "var(--card)", borderColor: "var(--line)" }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--line)" }}>
            <span className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Avisos</span>
            {n > 0 && (
              <button onClick={ctx.marcarTodos} className="text-[12px] font-semibold" style={{ color: "var(--accent)" }}>Marcar todos como lidos</button>
            )}
            <button onClick={() => setAjustes((v) => !v)} aria-expanded={ajustes} title="Bolinha flutuante, Windows e bip"
              className="text-[12px] font-semibold px-2 py-1 rounded-md" style={{ color: "var(--ink2)", background: ajustes ? "var(--card2)" : "transparent" }}>
              Ajustes
            </button>
          </div>
          {ajustes && (
            <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
              <AjustesDeAvisos />
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            <ListaDeAvisos onDepoisDeAbrir={() => setAberto(false)} />
          </div>
          {!ajustes && !ctx.bolinhaAberta && ctx.bolinhaSuportada && (
            <button onClick={() => void ctx.abrirBolinha()} className="flex-shrink-0 border-t px-4 py-2.5 text-[12px] font-semibold text-center"
              style={{ borderColor: "var(--line)", color: "var(--accent)" }}>
              Abrir bolinha flutuante (fica por cima de tudo)
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Item do menu do avatar (Comercial): abre/fecha a bolinha flutuante. */
export function BotaoBolinhaDoMenu({ onAntes }: { onAntes?: () => void }) {
  const ctx = useAvisos();
  if (!ctx) return null;
  return (
    <button
      onClick={async () => {
        onAntes?.();
        if (ctx.bolinhaAberta) { ctx.fecharBolinha(); return; }
        const erro = await ctx.abrirBolinha();
        if (erro) window.alert(erro);
      }}
      className="w-full text-left px-4 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" />
      </svg>
      {ctx.bolinhaAberta ? "Fechar bolinha de avisos" : "Abrir bolinha flutuante de avisos"}
    </button>
  );
}
