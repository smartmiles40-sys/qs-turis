// src/components/sdr/wa/WaBits.tsx
// -----------------------------------------------------------------------------
// Peças pequenas do painel de atendimento: avatar, player de áudio e esqueleto.
//
// Estão separadas porque são as duas decisões visuais que mais mudam a cara do
// painel — e as duas que o navegador não dá de graça:
//   • Avatar: a lista não tinha âncora à esquerda; o olho não conseguia varrer.
//   • Áudio: o <audio controls> do Chrome é um bloco cinza de 54px com paleta
//     própria, que ignora o modo noturno, estoura numa bolha estreita e esconde
//     a duração até você dar play — a primeira pergunta de quem vende.
// -----------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react";

// ── Avatar ──────────────────────────────────────────────────────────────────
// Cor derivada do nome: o mesmo lead tem SEMPRE a mesma cor, então a coluna da
// esquerda vira memória visual mesmo sem foto (só 8 de 25 contatos têm foto de
// perfil — o WhatsApp não entrega quando o cliente restringe a privacidade).
const CORES = ["#0147FF", "#0E7C6A", "#B26A00", "#7C3AED", "#B4242A", "#0F766E", "#1D4FD8", "#BE185D"];

function corDoNome(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CORES[h % CORES.length];
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  const s = (p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "");
  return s.toUpperCase() || "?";
}

export function WaAvatar({
  nome, url, size = 40,
}: { nome: string; url?: string | null; size?: number }) {
  const [quebrou, setQuebrou] = useState(false);
  const mostraFoto = Boolean(url) && !quebrou;
  return (
    <span
      className="relative shrink-0 grid place-items-center rounded-full overflow-hidden select-none"
      style={{
        width: size, height: size,
        background: mostraFoto ? "var(--card2)" : corDoNome(nome),
        color: "#fff",
        fontSize: Math.round(size * 0.36),
        fontWeight: 600,
        letterSpacing: ".02em",
      }}
      aria-hidden="true"
    >
      {mostraFoto
        ? <img src={url as string} alt="" loading="lazy" decoding="async"
               className="w-full h-full object-cover" onError={() => setQuebrou(true)} />
        : iniciais(nome)}
    </span>
  );
}

// ── Player de áudio ─────────────────────────────────────────────────────────

let audioAtual: HTMLAudioElement | null = null;   // só um toca por vez

const BARRAS = 30;

/**
 * Onda derivada da URL. Não decodifica o arquivo (caro e assíncrono) — mas cada
 * áudio ganha um desenho próprio e ESTÁVEL: reabrir a conversa mostra a mesma
 * onda. Serve de textura e de barra de progresso ao mesmo tempo.
 */
function ondas(url: string): number[] {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < BARRAS; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out.push(0.28 + ((h >>> 16) % 100) / 100 * 0.72);
  }
  return out;
}

function mmss(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function WaAudio({ url, meu }: { url: string; meu: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [vel, setVel] = useState(1);
  const barras = useMemo(() => ondas(url), [url]);
  const prog = dur > 0 ? pos / dur : 0;

  /**
   * Áudio gravado pelo MediaRecorder chega SEM duração no cabeçalho: o navegador
   * devolve Infinity. Empurrar o cursor pro "fim" força o cálculo e dispara
   * durationchange. Sem isso, todo áudio que nós mesmos gravamos mostra 0:00.
   */
  const aoCarregar = () => {
    const el = ref.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) { setDur(el.duration); return; }
    const corrigir = () => {
      if (!Number.isFinite(el.duration)) return;
      setDur(el.duration);
      el.removeEventListener("durationchange", corrigir);
      try { el.currentTime = 0; } catch { /* alguns navegadores reclamam */ }
    };
    el.addEventListener("durationchange", corrigir);
    try { el.currentTime = 1e101; } catch { /* ignora */ }
  };

  const alternar = async () => {
    const el = ref.current;
    if (!el) return;
    if (!el.paused) { el.pause(); return; }
    if (audioAtual && audioAtual !== el) audioAtual.pause();
    audioAtual = el;
    try { await el.play(); } catch { /* autoplay bloqueado */ }
  };

  const trocarVel = () => {
    const nova = vel === 1 ? 1.5 : vel === 1.5 ? 2 : 1;
    setVel(nova);
    if (ref.current) ref.current.playbackRate = nova;
  };

  const tinta = meu ? "var(--wa-ink)" : "var(--ink2)";

  return (
    <div className="flex items-center gap-2 mb-1 min-w-[200px] max-w-[268px]">
      <audio
        ref={ref} src={url} preload="metadata"
        onLoadedMetadata={aoCarregar}
        onDurationChange={() => { const d = ref.current?.duration; if (d && Number.isFinite(d)) setDur(d); }}
        onTimeUpdate={() => setPos(ref.current?.currentTime ?? 0)}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setPos(0); }}
      />

      <button
        onClick={alternar}
        aria-label={tocando ? "Pausar áudio" : "Tocar áudio"}
        className="wa-audio-play shrink-0 w-9 h-9 grid place-items-center rounded-full text-white"
      >
        {tocando ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.2" /><rect x="14" y="4" width="4" height="16" rx="1.2" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.2c0-.9 1-1.5 1.8-1l9 6.8c.7.5.7 1.5 0 2l-9 6.8c-.8.5-1.8-.1-1.8-1V5.2z" />
          </svg>
        )}
      </button>

      {/* Onda + range invisível por cima: arrastar, clicar e as setas do teclado
          saem de graça, com rótulo pra leitor de tela. */}
      <div className="wa-audio-seek relative flex-1 min-w-0 h-8 flex items-center">
        <div className="flex items-center gap-[2px] w-full h-6" aria-hidden="true">
          {barras.map((b, i) => (
            <span key={i} className="flex-1 rounded-full"
                  style={{
                    height: `${Math.round(b * 100)}%`,
                    background: i / BARRAS <= prog ? "var(--wa-bright)" : "var(--line)",
                    transition: "background-color .1s linear",
                  }} />
          ))}
        </div>
        <input
          type="range" min={0} max={dur || 0} step={0.05} value={pos}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPos(v);
            if (ref.current) ref.current.currentTime = v;
          }}
          aria-label="Posição do áudio"
          aria-valuetext={`${mmss(pos)} de ${mmss(dur)}`}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>

      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <span className="text-[11px] tabular-nums leading-none" style={{ color: tinta }}>
          {mmss(tocando || pos > 0 ? pos : dur)}
        </span>
        <button onClick={trocarVel} aria-label={`Velocidade ${vel}x — tocar para mudar`}
                className="wa-audio-vel text-[10px] font-semibold leading-none px-1 py-0.5 rounded">
          {vel}×
        </button>
      </div>
    </div>
  );
}

// ── Selo do número (comum × API oficial) ────────────────────────────────────
//
// A diferença é operacional, não decorativa, e é por isso que ela merece um
// desenho próprio:
//
//   • API oficial (Meta) — fora da janela de 24h só sai template aprovado, e
//     cada mensagem tem custo. Escudo com visto: "verificado, com regra".
//   • Comum (Evolution/QR) — texto livre a qualquer hora, mas o número pode ser
//     banido em disparo. Celular: "é um aparelho, como o do cliente".
//
// Cor não carrega o significado sozinha (daltonismo, tema escuro, impressão):
// as duas formas já são distintas, e todo selo tem `title` pra quem passar o
// mouse. Em `compacto` fica só o ícone — cabe na linha da lista sem empurrar o
// nome do cliente.

export function WaSeloNumero({
  tipo, nome, compacto = false,
}: { tipo: "normal" | "api"; nome?: string | null; compacto?: boolean }) {
  const ehApi = tipo === "api";
  const titulo = ehApi
    ? `${nome ? nome + " · " : ""}API oficial da Meta — fora da janela de 24h só sai template aprovado`
    : `${nome ? nome + " · " : ""}WhatsApp comum (via aparelho) — texto livre a qualquer hora`;

  const cor = ehApi
    ? { background: "var(--wa-ok-bg)", color: "var(--wa-ok-ink)" }
    : { background: "var(--card2)", color: "var(--ink3)" };

  const icone = ehApi ? (
    // Escudo com visto
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ) : (
    // Celular
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );

  return (
    <span
      title={titulo}
      aria-label={titulo}
      className={`shrink-0 inline-flex items-center rounded font-semibold ${
        compacto ? "gap-0 w-[18px] h-[15px] justify-center" : "gap-1 px-1.5 h-[18px] text-[10.5px]"
      }`}
      style={cor}
    >
      {icone}
      {!compacto && <span>{ehApi ? "Oficial" : "Comum"}</span>}
    </span>
  );
}

// ── Esqueleto da lista ──────────────────────────────────────────────────────

export function WaLinhaEsqueleto() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 border-b" style={{ borderColor: "var(--line2)" }}>
      <span className="wa-sk w-10 h-10 rounded-full shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="wa-sk block h-[13px] rounded" style={{ width: "58%" }} />
        <span className="wa-sk block h-[11px] rounded mt-2" style={{ width: "82%" }} />
      </span>
    </div>
  );
}
