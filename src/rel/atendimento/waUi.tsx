// src/rel/atendimento/waUi.tsx
// -----------------------------------------------------------------------------
// A CARA DE WHATSAPP do Atendimento (Bruno, 13/10/2026: "algo mais visual, ainda
// mais com arquivos, imagens e vídeos — um layout bem parecido com o do WhatsApp
// mesmo"). Só aparência: lista, bolhas, mídia, visualizador de fotos e player de
// áudio. A lógica (envio, janela de 24h, prazo, chamados) fica no AtendimentoPage.
//
// MÍDIA: rel_wa_mensagens.anexos = [{ type: image|video|audio|file, url, nome? }]
// — a URL é pública (bucket wa-midia, caminho com sorteio). A Meta não diz
// "sticker": figurinha chega como image .webp sem legenda. Histórico do celular
// chega SEM o arquivo (só o rótulo "📷 imagem", "🎤 áudio"…) → placeholder.
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Anexo, Mensagem } from "../lib/whatsapp";

export const WA_CSS = `
.wa {
  --wa-bg: #EFEAE2; --wa-in: #FFFFFF; --wa-out: #D9FDD3; --wa-txt: #111B21; --wa-meta: #667781;
  --wa-head: #F0F2F5; --wa-list: #FFFFFF; --wa-hover: #F5F6F6; --wa-sel: #F0F2F5; --wa-line: #E9EDEF;
  --wa-green: #00A884; --wa-green-ink: #008069; --wa-blue: #53BDEB; --wa-chip: rgba(255,255,255,.92); --wa-doc: rgba(11,20,26,.05);
  --wa-patt: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='.045' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 22l10-4 3 9-9 4z'/%3E%3Ccircle cx='70' cy='18' r='6'/%3E%3Cpath d='M98 40c6-6 14 2 8 8l-8 8-8-8c-6-6 2-14 8-8z'/%3E%3Cpath d='M20 70h16M28 62v16'/%3E%3Cpath d='M60 64l18 6-18 6 4-6z'/%3E%3Cpath d='M92 88a8 8 0 1 0 16 0 8 8 0 1 0-16 0M100 80v-6'/%3E%3Cpath d='M30 100c4-6 10-6 14 0'/%3E%3Cpath d='M64 104l6-8 6 8'/%3E%3C/g%3E%3C/svg%3E");
}
html.dark .wa {
  --wa-bg: #0B141A; --wa-in: #202C33; --wa-out: #005C4B; --wa-txt: #E9EDEF; --wa-meta: #8696A0;
  --wa-head: #202C33; --wa-list: #111B21; --wa-hover: #202C33; --wa-sel: #2A3942; --wa-line: #222D34;
  --wa-green: #00A884; --wa-green-ink: #00A884; --wa-chip: #182229; --wa-doc: rgba(255,255,255,.06);
  --wa-patt: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='.035' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 22l10-4 3 9-9 4z'/%3E%3Ccircle cx='70' cy='18' r='6'/%3E%3Cpath d='M98 40c6-6 14 2 8 8l-8 8-8-8c-6-6 2-14 8-8z'/%3E%3Cpath d='M20 70h16M28 62v16'/%3E%3Cpath d='M60 64l18 6-18 6 4-6z'/%3E%3Cpath d='M92 88a8 8 0 1 0 16 0 8 8 0 1 0-16 0M100 80v-6'/%3E%3Cpath d='M30 100c4-6 10-6 14 0'/%3E%3Cpath d='M64 104l6-8 6 8'/%3E%3C/g%3E%3C/svg%3E");
}
.wa-fundo { background-color: var(--wa-bg); background-image: var(--wa-patt); background-size: 240px 240px; }
.wa-lista { background: var(--wa-list); }
.wa-item:hover { background: var(--wa-hover); }
.wa-item[aria-current="true"] { background: var(--wa-sel); }
.wa-cab { background: var(--wa-head); }
.wa-bolha {
  position: relative; max-width: min(78%, 540px); padding: 6px 8px 8px 9px; border-radius: 8px;
  box-shadow: 0 1px .5px rgba(11,20,26,.13); color: var(--wa-txt); font-size: 14.2px; line-height: 19px;
  overflow-wrap: anywhere;
}
.wa-in { background: var(--wa-in); }
.wa-out { background: var(--wa-out); }
.wa-rabo.wa-in { border-top-left-radius: 0; }
.wa-rabo.wa-out { border-top-right-radius: 0; }
.wa-rabo.wa-in::before, .wa-rabo.wa-out::before { content: ""; position: absolute; top: 0; width: 8px; height: 13px; }
.wa-rabo.wa-in::before { left: -8px; background: var(--wa-in); clip-path: polygon(100% 0, 0 0, 100% 100%); }
.wa-rabo.wa-out::before { right: -8px; background: var(--wa-out); clip-path: polygon(0 0, 100% 0, 0 100%); }
.wa-hora { float: right; margin: 4px 0 -6px 12px; position: relative; top: 5px; font-size: 11px; line-height: 15px; color: var(--wa-meta); display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.wa-hora-sobre { position: absolute; right: 7px; bottom: 6px; color: #fff; background: linear-gradient(to top, rgba(0,0,0,.45), rgba(0,0,0,0)); padding: 10px 4px 0 18px; border-radius: 0 0 6px 0; font-size: 11px; display: inline-flex; gap: 3px; align-items: center; }
.wa-chip { background: var(--wa-chip); color: var(--wa-meta); box-shadow: 0 1px .5px rgba(11,20,26,.13); }
.wa-doc { background: var(--wa-doc); }
.wa-verde { background: var(--wa-green); color: #fff; }
.wa-verde:hover { filter: brightness(.95); }
.wa-campo { background: var(--wa-list); color: var(--wa-txt); border-radius: 10px; border: none; outline: none; }
.wa-campo::placeholder { color: var(--wa-meta); }
.wa-icone { color: var(--wa-meta); border-radius: 999px; }
.wa-icone:hover { background: rgba(127,127,127,.12); }
.wa-audio input[type=range] { accent-color: var(--wa-green); }
`;

// ── utilidades ──────────────────────────────────────────────────────────────

const PALETA = ["#00A884", "#53BDEB", "#FF8F6B", "#A78BFA", "#F472B6", "#F59E0B", "#34D399", "#60A5FA", "#E879F9", "#FB7185"];
export function corDoNome(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
}

export function AvatarWa({ nome, tamanho = 49 }: { nome: string; tamanho?: number }) {
  const ini = nome.trim().split(/\s+/).filter((p) => /\p{L}/u.test(p[0] || "")).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
  return (
    <span aria-hidden className="inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0 select-none"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.38, background: corDoNome(nome), color: "#fff" }}>
      {ini || (
        <svg width={tamanho * 0.55} height={tamanho * 0.55} viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14z" /></svg>
      )}
    </span>
  );
}

/** Hora da lista: hoje = HH:MM, ontem, senão dd/mm. */
export function horaDaLista(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: d.getFullYear() !== hoje.getFullYear() ? "2-digit" : undefined });
}

export function rotuloDoDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  const dias = (hoje.getTime() - d.getTime()) / 86_400_000;
  if (dias < 7) { const s = d.toLocaleDateString("pt-BR", { weekday: "long" }); return s[0].toUpperCase() + s.slice(1); }
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: d.getFullYear() !== hoje.getFullYear() ? "numeric" : undefined });
}


/** Rótulos que a entrada grava quando a mídia não veio (histórico). */
const SEM_ARQUIVO: Record<string, { icone: string; nome: string }> = {
  "📷 imagem": { icone: "📷", nome: "Foto" },
  "🎤 áudio": { icone: "🎤", nome: "Áudio" },
  "🎬 vídeo": { icone: "🎥", nome: "Vídeo" },
  "📎 arquivo": { icone: "📄", nome: "Documento" },
};

/** Prévia da última mensagem na lista, com o ícone do tipo. */
export function previa(txt: string | null): { icone: string | null; texto: string } {
  const t = (txt || "").trim();
  if (!t) return { icone: null, texto: "" };
  const s = SEM_ARQUIVO[t];
  if (s) return { icone: s.icone, texto: s.nome };
  if (t === "📎 Anexo") return { icone: "📎", texto: "Anexo" };
  return { icone: null, texto: t.replace(/^\*[^*\n]{1,40}:\*\s*/, "") };
}

// ── ✓ / ✓✓ ──────────────────────────────────────────────────────────────────

export function Tiques({ status, cor }: { status: Mensagem["status"] | "sent" | null; cor?: string }) {
  if (!status) return null;
  if (status === "failed") return <span title="Não entregue" style={{ color: "#EA0038", fontWeight: 700 }}>!</span>;
  const lido = status === "read";
  const duplo = status === "delivered" || lido;
  const c = cor || (lido ? "var(--wa-blue)" : "currentColor");
  const rotulo = lido ? "Lida" : duplo ? "Entregue" : "Enviada";
  return (
    <svg role="img" aria-label={rotulo} width={duplo ? 16 : 12} height="11" viewBox={duplo ? "0 0 16 11" : "0 0 12 11"} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {duplo ? <><path d="M1 6l3 3 6-7" /><path d="M6.5 8.5L7 9l6-7" /></> : <path d="M1 6l3 3 7-8" />}
    </svg>
  );
}

// ── texto com *negrito*, _itálico_, ~riscado~ e links ───────────────────────

export function TextoWa({ texto }: { texto: string }) {
  const partes: ReactNode[] = [];
  const re = /(https?:\/\/[^\s]+)|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let ult = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(texto))) {
    if (m.index > ult) partes.push(texto.slice(ult, m.index));
    if (m[1]) partes.push(<a key={k++} href={m[1]} target="_blank" rel="noreferrer" className="underline" style={{ color: "#027EB5" }}>{m[1]}</a>);
    else if (m[2]) partes.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3]) partes.push(<em key={k++}>{m[3]}</em>);
    else if (m[4]) partes.push(<s key={k++}>{m[4]}</s>);
    ult = m.index + m[0].length;
  }
  if (ult < texto.length) partes.push(texto.slice(ult));
  return <span className="whitespace-pre-wrap">{partes}</span>;
}

// ── Mídia ───────────────────────────────────────────────────────────────────

const ext = (url: string, nome?: string) => ((nome || url).split("?")[0].match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
export const ehFigurinha = (a: Anexo, texto: string) => a.type === "image" && ext(a.url) === "webp" && !texto.trim();

function nomeDoArquivo(a: Anexo) {
  if (a.nome) return a.nome;
  const e = ext(a.url);
  return e ? `Documento.${e}` : "Documento";
}

const COR_DOC: Record<string, string> = { pdf: "#E5252A", doc: "#2B579A", docx: "#2B579A", xls: "#217346", xlsx: "#217346", csv: "#217346", ppt: "#D24726", pptx: "#D24726", zip: "#7D7D7D" };

function CartaoDocumento({ a }: { a: Anexo }) {
  const e = ext(a.url, a.nome) || "arq";
  const nome = nomeDoArquivo(a);
  return (
    <a href={a.url} target="_blank" rel="noreferrer" download={nome} className="wa-doc flex items-center gap-3 rounded-md px-2.5 py-2 min-w-[220px] max-w-[320px]" aria-label={`Baixar ${nome}`}>
      <span className="w-9 h-11 rounded-[4px] flex items-end justify-center pb-1 text-[9px] font-bold uppercase text-white flex-shrink-0" style={{ background: COR_DOC[e] || "#5E6A71" }}>{e.slice(0, 4)}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[14px]" style={{ color: "var(--wa-txt)" }}>{nome}</span>
        <span className="block text-[11.5px] uppercase" style={{ color: "var(--wa-meta)" }}>{e} · toque pra abrir</span>
      </span>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--wa-meta)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
    </a>
  );
}

const mmss = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/** Player compacto estilo nota de voz. */
export function PlayerAudio({ url, minha, nome }: { url: string; minha: boolean; nome: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [erro, setErro] = useState(false);
  function alternar() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) { document.querySelectorAll("audio").forEach((x) => x !== a && x.pause()); void a.play().catch(() => setErro(true)); }
    else a.pause();
  }
  if (erro) return <a href={url} target="_blank" rel="noreferrer" className="underline text-[13px]">🎤 Abrir áudio</a>;
  return (
    <div className="wa-audio flex items-center gap-2.5 w-[260px] max-w-full py-1">
      <AvatarWa nome={nome} tamanho={40} />
      <button type="button" onClick={alternar} aria-label={tocando ? "Pausar áudio" : "Tocar áudio"} className="w-9 h-9 inline-flex items-center justify-center flex-shrink-0" style={{ color: minha ? "var(--wa-meta)" : "var(--wa-meta)" }}>
        {tocando
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      <span className="flex-1 min-w-0">
        <input type="range" min={0} max={dur || 1} step={0.1} value={pos} aria-label="Posição do áudio"
          onChange={(e) => { const a = ref.current; if (a) { a.currentTime = Number(e.target.value); setPos(a.currentTime); } }}
          className="w-full h-1 cursor-pointer" />
        <span className="block text-[11px] mt-0.5" style={{ color: "var(--wa-meta)" }}>{mmss(tocando || pos ? pos : dur)}</span>
      </span>
      <audio ref={ref} src={url} preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onPlay={() => setTocando(true)} onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setPos(0); }} onError={() => setErro(true)} />
    </div>
  );
}

/** Mídia que não veio (histórico do celular vem sem o arquivo). */
export function SemArquivo({ texto, historico }: { texto: string; historico: boolean }) {
  const s = SEM_ARQUIVO[texto.trim()];
  if (!s) return null;
  return (
    <span className="wa-doc flex items-center gap-2.5 rounded-md px-3 py-2.5 min-w-[200px]">
      <span className="text-[22px]" aria-hidden>{s.icone}</span>
      <span className="text-[13px]" style={{ color: "var(--wa-meta)" }}>{s.nome} não disponível{historico ? " (histórico)" : ""}</span>
    </span>
  );
}
export const ehRotuloSemArquivo = (texto: string) => !!SEM_ARQUIVO[texto.trim()];

// ── Visualizador de fotos (tela cheia) ──────────────────────────────────────

export interface FotoDaConversa { url: string; legenda: string; quando: string; de: string }

export function Visualizador({ fotos, indice, onFechar, onTrocar }: { fotos: FotoDaConversa[]; indice: number; onFechar: () => void; onTrocar: (i: number) => void }) {
  const f = fotos[indice];
  const fecharRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const ant = document.activeElement as HTMLElement | null;
    fecharRef.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
      else if (e.key === "ArrowLeft" && indice > 0) onTrocar(indice - 1);
      else if (e.key === "ArrowRight" && indice < fotos.length - 1) onTrocar(indice + 1);
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); ant?.focus?.(); };
  }, [indice, fotos.length, onFechar, onTrocar]);
  if (!f) return null;
  const seta = "w-12 h-12 rounded-full inline-flex items-center justify-center text-white disabled:opacity-25";
  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: "rgba(11,20,26,.96)" }} role="dialog" aria-modal="true" aria-label="Foto da conversa">
      <div className="flex items-center gap-3 px-4 h-14 text-white">
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold truncate">{f.de}</span>
          <span className="block text-[12px] opacity-70">{new Date(f.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {indice + 1} de {fotos.length}</span>
        </span>
        <a href={f.url} download target="_blank" rel="noreferrer" className="w-10 h-10 rounded-full inline-flex items-center justify-center hover:bg-white/10" aria-label="Baixar foto">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </a>
        <button ref={fecharRef} onClick={onFechar} className="w-10 h-10 rounded-full inline-flex items-center justify-center hover:bg-white/10" aria-label="Fechar (Esc)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center gap-2 px-2" onClick={onFechar}>
        <button className={seta} disabled={indice === 0} onClick={(e) => { e.stopPropagation(); onTrocar(indice - 1); }} aria-label="Foto anterior" style={{ background: "rgba(255,255,255,.1)" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <img src={f.url} alt={f.legenda || "Foto da conversa"} className="max-h-full max-w-[calc(100%-120px)] object-contain select-none" onClick={(e) => e.stopPropagation()} />
        <button className={seta} disabled={indice >= fotos.length - 1} onClick={(e) => { e.stopPropagation(); onTrocar(indice + 1); }} aria-label="Próxima foto" style={{ background: "rgba(255,255,255,.1)" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
      {f.legenda && <p className="text-center text-white text-[14px] px-6 py-3 whitespace-pre-wrap">{f.legenda}</p>}
      {fotos.length > 1 && (
        <div className="flex justify-center gap-1.5 px-4 pb-4 overflow-x-auto">
          {fotos.map((x, i) => (
            <button key={x.url + i} onClick={() => onTrocar(i)} aria-label={`Foto ${i + 1}`} aria-current={i === indice ? "true" : undefined}
              className="w-12 h-12 rounded overflow-hidden flex-shrink-0" style={{ outline: i === indice ? "2px solid var(--wa-green)" : "none", opacity: i === indice ? 1 : 0.6 }}>
              <img src={x.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Emojis (simples, sem lib) ───────────────────────────────────────────────

export const EMOJIS = "😀 😂 😊 😍 🥰 😘 😉 😎 🤩 🥳 😅 🙏 👍 👏 🙌 💪 👋 🤝 ❤️ 💚 💙 ✨ 🎉 🔥 ✅ ☑️ ✈️ 🌍 🗺️ 🧳 🏖️ 🏔️ 🛂 📄 📸 📍 ⏰ 📅 💬 😢 😮 🤔 😴 🙂".split(" ");

export function MidiaDaMensagem({ a, texto, minha, nome, onAbrirFoto, hora }: {
  a: Anexo; texto: string; minha: boolean; nome: string; onAbrirFoto: (url: string) => void; hora: ReactNode;
}) {
  const [quebrou, setQuebrou] = useState(false);
  if (a.type === "image") {
    if (quebrou) return <SemArquivo texto="📷 imagem" historico={false} />;
    return (
      <button type="button" onClick={() => onAbrirFoto(a.url)} className="relative block rounded-md overflow-hidden" aria-label="Abrir foto em tela cheia" style={{ maxWidth: 330 }}>
        <img src={a.url} alt={texto || "Foto"} loading="lazy" onError={() => setQuebrou(true)} className="block w-full max-h-[340px] object-cover" style={{ minWidth: 160, minHeight: 90, background: "rgba(127,127,127,.15)" }} />
        {!texto && <span className="wa-hora-sobre">{hora}</span>}
      </button>
    );
  }
  if (a.type === "video") {
    return (
      <span className="relative block rounded-md overflow-hidden" style={{ maxWidth: 330 }}>
        <video src={a.url} controls preload="metadata" className="block w-full max-h-[340px] bg-black" />
      </span>
    );
  }
  if (a.type === "audio") return <PlayerAudio url={a.url} minha={minha} nome={nome} />;
  return <CartaoDocumento a={a} />;
}
