// src/rel/atendimento/EditorFoto.tsx
// -----------------------------------------------------------------------------
// EDITOR DE FOTO antes de enviar (16/10/2026). Pedido do time: "colocar emojis,
// recortar a imagem, desenhar…" — igual ao editor do WhatsApp.
//
// Ferramentas: Recortar · Girar · Desenhar (cor + espessura) · Emoji · Texto ·
// Desfazer. Emoji e texto ficam soltos (arrasta pra mover, +/− muda o tamanho,
// lixeira apaga) até enviar. Recortar e girar "assam" tudo na imagem antes, pra
// não ter conta de coordenada girada — mais simples e sem surpresa.
//
// Saída: um File JPEG com no máximo 2560 px e até 3 MB (limite da Meta aqui).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { EmojiPicker } from "./PainelExpressoes";

type Ferramenta = "mover" | "desenhar" | "recortar";
interface Traco { cor: string; esp: number; pts: { x: number; y: number }[] }
interface Adesivo { id: number; tipo: "emoji" | "texto"; conteudo: string; x: number; y: number; tam: number; cor: string }
interface Estado { base: HTMLCanvasElement; tracos: Traco[]; adesivos: Adesivo[] }

const CORES = ["#FFFFFF", "#000000", "#E53935", "#FDD835", "#43A047", "#1E88E5", "#8E24AA", "#FB8C00"];
const MAX_LADO = 2560;
const MAX_BYTES = 3 * 1024 * 1024;
let proxId = 1;

function clonarCanvas(c: HTMLCanvasElement) {
  const n = document.createElement("canvas");
  n.width = c.width; n.height = c.height;
  n.getContext("2d")!.drawImage(c, 0, 0);
  return n;
}

/** Desenha tudo (base + traços + adesivos) num contexto na escala da imagem. */
function pintar(ctx: CanvasRenderingContext2D, e: Estado, selecionado: number | null = null, escalaTela = 1) {
  ctx.drawImage(e.base, 0, 0);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const t of e.tracos) {
    if (t.pts.length < 2) { if (t.pts[0]) { ctx.fillStyle = t.cor; ctx.beginPath(); ctx.arc(t.pts[0].x, t.pts[0].y, t.esp / 2, 0, Math.PI * 2); ctx.fill(); } continue; }
    ctx.strokeStyle = t.cor; ctx.lineWidth = t.esp;
    ctx.beginPath(); ctx.moveTo(t.pts[0].x, t.pts[0].y);
    for (const p of t.pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  for (const a of e.adesivos) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (a.tipo === "emoji") {
      ctx.font = `${a.tam}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif`;
      ctx.fillText(a.conteudo, a.x, a.y);
    } else {
      ctx.font = `bold ${a.tam}px "Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif`;
      // contorno pra ler em qualquer fundo (igual ao WhatsApp)
      ctx.lineWidth = Math.max(2, a.tam / 8); ctx.strokeStyle = a.cor === "#000000" ? "#FFFFFF" : "rgba(0,0,0,.65)";
      ctx.strokeText(a.conteudo, a.x, a.y);
      ctx.fillStyle = a.cor; ctx.fillText(a.conteudo, a.x, a.y);
    }
    if (a.id === selecionado) {
      const m = medir(ctx, a);
      ctx.save(); ctx.setLineDash([8 / escalaTela, 6 / escalaTela]); ctx.lineWidth = 2 / escalaTela; ctx.strokeStyle = "#00A884";
      ctx.strokeRect(a.x - m.w / 2 - 6, a.y - m.h / 2 - 6, m.w + 12, m.h + 12); ctx.restore();
    }
  }
}

function medir(ctx: CanvasRenderingContext2D, a: Adesivo) {
  ctx.font = a.tipo === "emoji" ? `${a.tam}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif` : `bold ${a.tam}px "Segoe UI",Helvetica,Arial,sans-serif`;
  return { w: ctx.measureText(a.conteudo).width, h: a.tam };
}

export default function EditorFoto({ arquivo, onPronto, onCancelar }: { arquivo: File; onPronto: (f: File) => void; onCancelar: () => void }) {
  const telaRef = useRef<HTMLCanvasElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [historico, setHistorico] = useState<Estado[]>([]);
  const [ferr, setFerr] = useState<Ferramenta>("mover");
  const [cor, setCor] = useState(CORES[2]);
  const [esp, setEsp] = useState(8);
  const [sel, setSel] = useState<number | null>(null);
  const [emojis, setEmojis] = useState(false);
  const [escala, setEscala] = useState(1);
  const [recorte, setRecorte] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const arraste = useRef<{ modo: "traco" | "adesivo" | "recorte-novo" | "recorte-mover"; ox: number; oy: number; id?: number; ini?: { x: number; y: number; w: number; h: number } } | null>(null);

  // carrega a foto (limitada a 2560 px)
  useEffect(() => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      setEstado({ base: c, tracos: [], adesivos: [] });
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  // redesenha na tela, cabendo na caixa
  const redesenhar = useCallback(() => {
    const cv = telaRef.current, cx = caixaRef.current;
    if (!cv || !cx || !estado) return;
    const s = Math.min(cx.clientWidth / estado.base.width, cx.clientHeight / estado.base.height, 1);
    setEscala(s);
    cv.width = estado.base.width; cv.height = estado.base.height;
    cv.style.width = `${estado.base.width * s}px`; cv.style.height = `${estado.base.height * s}px`;
    const ctx = cv.getContext("2d")!;
    pintar(ctx, estado, ferr === "mover" ? sel : null, s);
    if (recorte && ferr === "recortar") {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.rect(recorte.x, recorte.y, recorte.w, recorte.h); ctx.fill("evenodd");
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 / s; ctx.strokeRect(recorte.x, recorte.y, recorte.w, recorte.h);
      ctx.restore();
    }
  }, [estado, sel, ferr, recorte]);
  useEffect(() => { redesenhar(); }, [redesenhar]);
  useEffect(() => { window.addEventListener("resize", redesenhar); return () => window.removeEventListener("resize", redesenhar); }, [redesenhar]);

  const guardar = (e: Estado) => { if (estado) setHistorico((h) => [...h.slice(-19), estado]); setEstado(e); };
  const desfazer = () => setHistorico((h) => { if (!h.length) return h; setEstado(h[h.length - 1]); setSel(null); return h.slice(0, -1); });

  /** Junta traços e adesivos na imagem (antes de recortar/girar). */
  function assado(e: Estado): HTMLCanvasElement {
    const c = clonarCanvas(e.base);
    pintar(c.getContext("2d")!, e);
    return c;
  }

  function ponto(ev: RPointerEvent<HTMLCanvasElement>) {
    const r = telaRef.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / escala, y: (ev.clientY - r.top) / escala };
  }

  function acharAdesivo(p: { x: number; y: number }) {
    if (!estado) return null;
    const ctx = telaRef.current!.getContext("2d")!;
    for (const a of [...estado.adesivos].reverse()) {
      const m = medir(ctx, a);
      if (Math.abs(p.x - a.x) <= m.w / 2 + 10 && Math.abs(p.y - a.y) <= m.h / 2 + 10) return a;
    }
    return null;
  }

  function aoApertar(ev: RPointerEvent<HTMLCanvasElement>) {
    if (!estado) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = ponto(ev);
    if (ferr === "desenhar") {
      guardar({ ...estado, tracos: [...estado.tracos, { cor, esp: esp / escala, pts: [p] }] });
      arraste.current = { modo: "traco", ox: p.x, oy: p.y };
    } else if (ferr === "recortar") {
      if (recorte && p.x > recorte.x && p.x < recorte.x + recorte.w && p.y > recorte.y && p.y < recorte.y + recorte.h) arraste.current = { modo: "recorte-mover", ox: p.x, oy: p.y, ini: recorte };
      else { setRecorte({ x: p.x, y: p.y, w: 1, h: 1 }); arraste.current = { modo: "recorte-novo", ox: p.x, oy: p.y }; }
    } else {
      const a = acharAdesivo(p);
      setSel(a?.id ?? null);
      if (a) { guardar({ ...estado }); arraste.current = { modo: "adesivo", ox: p.x - a.x, oy: p.y - a.y, id: a.id }; }
    }
  }
  function aoMover(ev: RPointerEvent<HTMLCanvasElement>) {
    const d = arraste.current;
    if (!d || !estado) return;
    const p = ponto(ev);
    if (d.modo === "traco") {
      const tr = estado.tracos.slice(); const ult = tr[tr.length - 1];
      tr[tr.length - 1] = { ...ult, pts: [...ult.pts, p] };
      setEstado({ ...estado, tracos: tr });
    } else if (d.modo === "adesivo") {
      setEstado({ ...estado, adesivos: estado.adesivos.map((a) => (a.id === d.id ? { ...a, x: p.x - d.ox, y: p.y - d.oy } : a)) });
    } else if (d.modo === "recorte-novo") {
      const W = estado.base.width, H = estado.base.height;
      const x = Math.max(0, Math.min(d.ox, p.x)), y = Math.max(0, Math.min(d.oy, p.y));
      setRecorte({ x, y, w: Math.min(W, Math.max(d.ox, p.x)) - x, h: Math.min(H, Math.max(d.oy, p.y)) - y });
    } else if (d.modo === "recorte-mover" && d.ini) {
      const W = estado.base.width, H = estado.base.height;
      setRecorte({ ...d.ini, x: Math.max(0, Math.min(W - d.ini.w, d.ini.x + p.x - d.ox)), y: Math.max(0, Math.min(H - d.ini.h, d.ini.y + p.y - d.oy)) });
    }
  }
  const aoSoltar = () => { arraste.current = null; };

  function aplicarRecorte() {
    if (!estado || !recorte || recorte.w < 20 || recorte.h < 20) return;
    const plano = assado(estado);
    const c = document.createElement("canvas");
    c.width = Math.round(recorte.w); c.height = Math.round(recorte.h);
    c.getContext("2d")!.drawImage(plano, recorte.x, recorte.y, recorte.w, recorte.h, 0, 0, c.width, c.height);
    guardar({ base: c, tracos: [], adesivos: [] });
    setRecorte(null); setFerr("mover"); setSel(null);
  }
  function girar() {
    if (!estado) return;
    const plano = assado(estado);
    const c = document.createElement("canvas");
    c.width = plano.height; c.height = plano.width;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(plano, 0, 0);
    guardar({ base: c, tracos: [], adesivos: [] });
    setSel(null); setRecorte(null);
  }
  function adicionar(tipo: "emoji" | "texto", conteudo: string) {
    if (!estado) return;
    const lado = Math.min(estado.base.width, estado.base.height);
    const a: Adesivo = { id: proxId++, tipo, conteudo, x: estado.base.width / 2, y: estado.base.height / 2, tam: Math.round(lado * (tipo === "emoji" ? 0.18 : 0.08)), cor: tipo === "texto" ? cor : "#000" };
    guardar({ ...estado, adesivos: [...estado.adesivos, a] });
    setSel(a.id); setFerr("mover");
  }
  const selecionado = estado?.adesivos.find((a) => a.id === sel) ?? null;
  const mudarSel = (f: (a: Adesivo) => Adesivo) => { if (estado && selecionado) setEstado({ ...estado, adesivos: estado.adesivos.map((a) => (a.id === selecionado.id ? f(a) : a)) }); };
  const apagarSel = () => { if (estado && selecionado) { guardar({ ...estado, adesivos: estado.adesivos.filter((a) => a.id !== selecionado.id) }); setSel(null); } };

  async function concluir() {
    if (!estado) return;
    setSalvando(true);
    const plano = assado(estado);
    let q = 0.9, blob: Blob | null = null;
    for (let i = 0; i < 6; i++) {
      blob = await new Promise<Blob | null>((r) => plano.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= MAX_BYTES) break;
      q -= 0.12;
    }
    setSalvando(false);
    if (!blob) return;
    const nome = arquivo.name.replace(/\.[a-z0-9]+$/i, "") + "-editada.jpg";
    onPronto(new File([blob], nome, { type: "image/jpeg" }));
  }

  // atalhos: Ctrl+Z desfaz, Delete apaga o selecionado, Esc cancela
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); desfazer(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel && !(e.target instanceof HTMLInputElement)) apagarSel();
      else if (e.key === "Escape") onCancelar();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const Btn = ({ ativo, onClick, children, titulo }: { ativo?: boolean; onClick: () => void; children: React.ReactNode; titulo: string }) => (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo} aria-pressed={ativo}
      className="h-10 min-w-10 px-2.5 rounded-full inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold"
      style={ativo ? { background: "#00A884", color: "#fff" } : { background: "rgba(255,255,255,.12)", color: "#fff" }}>{children}</button>
  );

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: "#0B141A" }} role="dialog" aria-modal="true" aria-label="Editar foto">
      {/* barra de cima: ferramentas */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5" style={{ background: "#111B21" }}>
        <Btn titulo="Cancelar" onClick={onCancelar}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></Btn>
        <span className="flex-1" />
        <Btn titulo="Recortar" ativo={ferr === "recortar"} onClick={() => { setFerr(ferr === "recortar" ? "mover" : "recortar"); setSel(null); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></svg>Recortar
        </Btn>
        <Btn titulo="Girar 90°" onClick={girar}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg></Btn>
        <Btn titulo="Desenhar" ativo={ferr === "desenhar"} onClick={() => { setFerr(ferr === "desenhar" ? "mover" : "desenhar"); setSel(null); setRecorte(null); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
        </Btn>
        <Btn titulo="Emoji" ativo={emojis} onClick={() => setEmojis((x) => !x)}><span className="text-[18px]">😊</span></Btn>
        <Btn titulo="Texto" onClick={() => adicionar("texto", "Texto")}><span className="text-[16px] font-bold">Aa</span></Btn>
        <Btn titulo={historico.length ? "Desfazer (Ctrl+Z)" : "Nada para desfazer"} onClick={desfazer}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg></Btn>
      </div>

      {/* opções da ferramenta */}
      {(ferr === "desenhar" || selecionado?.tipo === "texto") && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: "#111B21", borderTop: "1px solid #222D34" }}>
          {CORES.map((c) => (
            <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => { setCor(c); if (selecionado?.tipo === "texto") mudarSel((a) => ({ ...a, cor: c })); }}
              className="w-7 h-7 rounded-full" style={{ background: c, outline: (selecionado?.tipo === "texto" ? selecionado.cor : cor) === c ? "3px solid #00A884" : "1px solid #555", outlineOffset: 2 }} />
          ))}
          {ferr === "desenhar" && (
            <label className="flex items-center gap-2 text-[12px] ml-2" style={{ color: "#AEBAC1" }}>espessura
              <input type="range" min={2} max={40} value={esp} onChange={(e) => setEsp(Number(e.target.value))} />
            </label>
          )}
          {selecionado?.tipo === "texto" && (
            <input value={selecionado.conteudo} onChange={(e) => mudarSel((a) => ({ ...a, conteudo: e.target.value }))} autoFocus
              className="ml-2 h-9 px-3 rounded-lg text-[14px] flex-1 min-w-[160px]" style={{ background: "#202C33", color: "#E9EDEF", border: "none" }} aria-label="Texto na foto" />
          )}
        </div>
      )}
      {selecionado && (
        <div className="flex items-center justify-center gap-2 px-3 py-2" style={{ background: "#111B21", borderTop: "1px solid #222D34" }}>
          <span className="text-[12px]" style={{ color: "#AEBAC1" }}>arraste pra mover ·</span>
          <Btn titulo="Diminuir" onClick={() => mudarSel((a) => ({ ...a, tam: Math.max(12, a.tam * 0.85) }))}>−</Btn>
          <Btn titulo="Aumentar" onClick={() => mudarSel((a) => ({ ...a, tam: a.tam * 1.18 }))}>+</Btn>
          <Btn titulo="Apagar" onClick={apagarSel}>🗑</Btn>
        </div>
      )}
      {ferr === "recortar" && (
        <div className="flex items-center justify-center gap-2 px-3 py-2" style={{ background: "#111B21", borderTop: "1px solid #222D34" }}>
          <span className="text-[12.5px]" style={{ color: "#AEBAC1" }}>{recorte ? "Arraste a área pra ajustar." : "Arraste sobre a foto pra marcar a área."}</span>
          {recorte && <Btn titulo="Aplicar recorte" ativo onClick={aplicarRecorte}>Aplicar</Btn>}
          {recorte && <Btn titulo="Limpar" onClick={() => setRecorte(null)}>Limpar</Btn>}
        </div>
      )}

      {/* a foto */}
      <div ref={caixaRef} className="flex-1 min-h-0 flex items-center justify-center p-4 relative">
        {!estado ? <p style={{ color: "#AEBAC1" }}>Carregando a foto…</p> : (
          <canvas ref={telaRef} onPointerDown={aoApertar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
            style={{ touchAction: "none", cursor: ferr === "desenhar" ? "crosshair" : ferr === "recortar" ? "crosshair" : "default", boxShadow: "0 4px 24px rgba(0,0,0,.5)" }} />
        )}
        {emojis && (
          <div className="wa absolute right-4 top-4 w-[340px] max-w-[calc(100%-32px)] h-[380px] rounded-xl overflow-hidden" style={{ background: "var(--wa-list, #fff)" }}>
            <EmojiPicker compacto autoFocus onEscolher={(e) => { adicionar("emoji", e); setEmojis(false); }} />
          </div>
        )}
      </div>

      {/* enviar */}
      <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ background: "#111B21" }}>
        <span className="flex-1 text-[12px]" style={{ color: "#8696A0" }}>Ctrl+Z desfaz · Delete apaga o emoji/texto selecionado · Esc cancela</span>
        <button type="button" onClick={() => void concluir()} disabled={!estado || salvando}
          className="h-11 px-5 rounded-full text-[14px] font-semibold disabled:opacity-60" style={{ background: "#00A884", color: "#fff" }}>
          {salvando ? "Preparando…" : "Concluir"}
        </button>
      </div>
    </div>
  );
}
