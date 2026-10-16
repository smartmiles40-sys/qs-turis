// src/rel/atendimento/PainelExpressoes.tsx
// -----------------------------------------------------------------------------
// EMOJIS E FIGURINHAS do WhatsApp do Relacionamento (Bruno, 14/10/2026: "igual
// ao WhatsApp mesmo").
//
// Emojis: TODOS (~1.900), com busca em português — "joia", "avião", "coração"
// — porque os nomes e apelidos vêm do emojibase em PT (dados do Unicode). Os
// dados são carregados só quando o painel abre (chunk à parte, ~580 KB) e ficam
// guardados no módulo: abrir de novo é instantâneo. Recentes e tom de pele
// ficam no navegador de cada pessoa, como no celular.
//
// Fonte: no Windows as bandeiras viram letras ("JP" no lugar de 🇯🇵). A Noto
// Color Emoji do Google resolve — por isso a classe .wa-emoji (EMOJI_FONT_CSS).
//
// Figurinhas: a biblioteca é do TIME (rel_wa_figurinhas). "Criar figurinha"
// transforma uma foto em WEBP 512×512 com fundo transparente e até 100 KB —
// o formato que a Meta exige pra figurinha estática.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { apagarFigurinha, listarFigurinhas, salvarFigurinha, type Figurinha } from "../lib/whatsapp";

export const EMOJI_FONT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap");
/* Letras e NÚMEROS na fonte do WhatsApp Web; a de emoji vem DEPOIS (16/10). Antes a
   Noto Color Emoji vinha na frente e desenhava 0–9, # e * do jeito dela — os
   números ficavam "estranhos". Agora ela só pega o que a fonte de texto não tem. */
.wa-emoji { font-family: "Segoe UI", "Helvetica Neue", Helvetica, "Lucida Grande", Arial, Ubuntu, Cantarell, "Fira Sans", sans-serif, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"; }
.wa-expr-sec { content-visibility: auto; contain-intrinsic-size: auto 400px; }
.wa-expr-btn:focus-visible { outline: 2px solid var(--wa-green); outline-offset: -2px; }
`;

// ── Dados ───────────────────────────────────────────────────────────────────

interface Emoji { u: string; label: string; busca: string; group: number; order: number; skins?: { hexcode: string; unicode: string }[] }
interface EmojiBruto { hexcode: string; label: string; unicode: string; group?: number; order?: number; tags?: string[]; skins?: { hexcode: string; unicode: string }[] }

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

let cache: Emoji[] | null = null;
let carregando: Promise<Emoji[]> | null = null;

function carregarEmojis(): Promise<Emoji[]> {
  if (cache) return Promise.resolve(cache);
  if (!carregando) {
    carregando = import("emojibase-data/pt/compact.json").then((mod) => {
      const lista = (mod.default as unknown as EmojiBruto[])
        .filter((e) => typeof e.group === "number" && e.group !== 2)
        .map((e) => ({
          u: e.unicode,
          label: e.label,
          busca: semAcento([e.label, ...(e.tags || [])].join(" ")),
          group: e.group as number,
          order: e.order ?? 0,
          skins: e.skins,
        }))
        .sort((a, b) => a.order - b.order);
      cache = lista;
      return lista;
    }).catch((e) => { carregando = null; throw e; });
  }
  return carregando;
}

// Grupos do emojibase (o 2, "componentes", fica de fora).
const CATEGORIAS: { id: number | "recentes"; nome: string; icone: string }[] = [
  { id: "recentes", nome: "Recentes", icone: "🕘" },
  { id: 0, nome: "Sorrisos e emoções", icone: "😀" },
  { id: 1, nome: "Pessoas e corpo", icone: "👋" },
  { id: 3, nome: "Animais e natureza", icone: "🐻" },
  { id: 4, nome: "Comidas e bebidas", icone: "🍔" },
  { id: 5, nome: "Viagens e lugares", icone: "✈️" },
  { id: 6, nome: "Atividades", icone: "⚽" },
  { id: 7, nome: "Objetos", icone: "💡" },
  { id: 8, nome: "Símbolos", icone: "❤️" },
  { id: 9, nome: "Bandeiras", icone: "🏳️" },
];

// Tom de pele: sem tom + os 5 modificadores (🏻🏼🏽🏾🏿).
const TONS = [
  { hex: "", amostra: "✋", nome: "Padrão" },
  { hex: "1F3FB", amostra: "✋🏻", nome: "Pele clara" },
  { hex: "1F3FC", amostra: "✋🏼", nome: "Pele morena clara" },
  { hex: "1F3FD", amostra: "✋🏽", nome: "Pele morena" },
  { hex: "1F3FE", amostra: "✋🏾", nome: "Pele morena escura" },
  { hex: "1F3FF", amostra: "✋🏿", nome: "Pele escura" },
];
const MODIFICADORES = /1F3F[B-F]/g;

function comTom(e: Emoji, tom: string): string {
  if (!tom || !e.skins?.length) return e.u;
  // Pega a variação em que TODOS os modificadores são o tom escolhido.
  const s = e.skins.find((k) => {
    const m = k.hexcode.match(MODIFICADORES);
    return m && m.every((x) => x === tom);
  });
  return s?.unicode || e.u;
}

const CHAVE_RECENTES = "rel_emojis_recentes";
const CHAVE_TOM = "rel_emoji_tom";

interface Recente { e: string; n: number; t: number }
function lerRecentes(): Recente[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_RECENTES) || "[]") as Recente[]; } catch { return []; }
}
function usarEmoji(e: string) {
  const l = lerRecentes();
  const i = l.findIndex((r) => r.e === e);
  if (i >= 0) { l[i].n++; l[i].t = Date.now(); } else l.push({ e, n: 1, t: Date.now() });
  // Mais usado primeiro; empate, o mais recente.
  l.sort((a, b) => b.n - a.n || b.t - a.t);
  localStorage.setItem(CHAVE_RECENTES, JSON.stringify(l.slice(0, 32)));
}

// ── Navegação por setas numa grade de botões ────────────────────────────────

function navegarGrade(ev: KeyboardEvent<HTMLElement>, raiz: HTMLElement | null) {
  if (!raiz || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
  const botoes = Array.from(raiz.querySelectorAll<HTMLButtonElement>("button[data-emoji]"));
  const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
  if (atual < 0) { botoes[0]?.focus(); ev.preventDefault(); return; }
  ev.preventDefault();
  if (ev.key === "ArrowLeft") { botoes[Math.max(0, atual - 1)]?.focus(); return; }
  if (ev.key === "ArrowRight") { botoes[Math.min(botoes.length - 1, atual + 1)]?.focus(); return; }
  // Cima/baixo: o botão da linha vizinha mais perto na horizontal.
  const r = botoes[atual].getBoundingClientRect();
  const desce = ev.key === "ArrowDown";
  let melhor: HTMLButtonElement | null = null;
  let dist = Infinity;
  for (let i = desce ? atual + 1 : atual - 1; desce ? i < botoes.length : i >= 0; desce ? i++ : i--) {
    const b = botoes[i].getBoundingClientRect();
    if (desce ? b.top <= r.top + 2 : b.top >= r.top - 2) continue;
    if (melhor && Math.abs(b.top - melhor.getBoundingClientRect().top) > 2) break;
    const d = Math.abs(b.left - r.left);
    if (d < dist) { dist = d; melhor = botoes[i]; }
  }
  melhor?.focus();
  melhor?.scrollIntoView({ block: "nearest" });
}

// ── Emojis ──────────────────────────────────────────────────────────────────

export function EmojiPicker({ onEscolher, compacto, autoFocus }: { onEscolher: (e: string) => void; compacto?: boolean; autoFocus?: boolean }) {
  const [emojis, setEmojis] = useState<Emoji[] | null>(cache);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState("");
  const [tom, setTom] = useState(() => localStorage.getItem(CHAVE_TOM) || "");
  const [verTons, setVerTons] = useState(false);
  const [recentes, setRecentes] = useState(() => lerRecentes().map((r) => r.e));
  const [ativa, setAtiva] = useState<CATEGORIA_ID>(recentes.length ? "recentes" : 0);
  const rolagem = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (emojis) return;
    carregarEmojis().then(setEmojis).catch(() => setErro(true));
  }, [emojis]);
  useEffect(() => { if (autoFocus) campo.current?.focus(); }, [autoFocus]);

  const porGrupo = useMemo(() => {
    const m = new Map<number, Emoji[]>();
    for (const e of emojis || []) { const l = m.get(e.group) || []; l.push(e); m.set(e.group, l); }
    return m;
  }, [emojis]);

  const resultado = useMemo(() => {
    const t = semAcento(busca.trim());
    if (!t || !emojis) return null;
    const palavras = t.split(/\s+/);
    return emojis.filter((e) => e.u === busca.trim() || palavras.every((p) => e.busca.includes(p))).slice(0, 400);
  }, [busca, emojis]);

  function escolher(e: string) {
    usarEmoji(e);
    setRecentes(lerRecentes().map((r) => r.e));
    onEscolher(e);
  }

  function trocarTom(h: string) {
    setTom(h);
    localStorage.setItem(CHAVE_TOM, h);
    setVerTons(false);
  }

  // A aba ativa acompanha a rolagem.
  function aoRolar() {
    const el = rolagem.current;
    if (!el || resultado) return;
    const topo = el.getBoundingClientRect().top;
    let atual: CATEGORIA_ID = ativa;
    for (const s of Array.from(el.querySelectorAll<HTMLElement>("[data-cat]"))) {
      if (s.getBoundingClientRect().top - topo <= 24) atual = (s.dataset.cat === "recentes" ? "recentes" : Number(s.dataset.cat)) as CATEGORIA_ID;
    }
    if (atual !== ativa) setAtiva(atual);
  }

  function irPara(id: CATEGORIA_ID) {
    setBusca("");
    setAtiva(id);
    requestAnimationFrame(() => {
      const s = rolagem.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
      if (s && rolagem.current) rolagem.current.scrollTop = s.offsetTop - rolagem.current.offsetTop;
    });
  }

  const tamanhoBotao = compacto ? 34 : 40;
  const botao = (u: string, rotulo: string, chave: string) => (
    <button key={chave} type="button" data-emoji onClick={() => escolher(u)} title={rotulo} aria-label={rotulo}
      className="wa-emoji wa-icone wa-expr-btn inline-flex items-center justify-center rounded-md"
      style={{ width: tamanhoBotao, height: tamanhoBotao, fontSize: compacto ? 22 : 26, lineHeight: 1 }}>
      {u}
    </button>
  );

  const categorias = CATEGORIAS.filter((c) => c.id !== "recentes" || recentes.length > 0);

  return (
    <div className="flex flex-col min-h-0" style={compacto ? { width: 320, height: 360 } : { height: "100%" }}>
      {/* Abas de categoria */}
      <div className="flex items-center px-1 flex-shrink-0" role="tablist" aria-label="Categorias de emoji" style={{ borderBottom: "1px solid var(--wa-line)" }}>
        {categorias.map((c) => {
          const sel = !resultado && ativa === c.id;
          return (
            <button key={String(c.id)} type="button" role="tab" aria-selected={sel} title={c.nome} aria-label={c.nome} onClick={() => irPara(c.id)}
              className="wa-emoji wa-expr-btn flex-1 h-10 inline-flex items-center justify-center"
              style={{ fontSize: compacto ? 16 : 19, opacity: sel ? 1 : 0.55, borderBottom: `3px solid ${sel ? "var(--wa-green)" : "transparent"}`, filter: sel ? "none" : "grayscale(.6)" }}>
              {c.icone}
            </button>
          );
        })}
      </div>

      {/* Busca + tom de pele */}
      <div className="flex items-center gap-2 px-2 py-2 flex-shrink-0 relative">
        <label className="flex-1 flex items-center gap-2 px-3 h-9 rounded-lg" style={{ background: "var(--wa-head)", color: "var(--wa-meta)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></svg>
          <input ref={campo} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar emoji" aria-label="Pesquisar emoji"
            onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); rolagem.current?.querySelector<HTMLButtonElement>("button[data-emoji]")?.focus(); } }}
            className="wa-campo flex-1 min-w-0 bg-transparent text-[14px]" style={{ background: "transparent", color: "var(--wa-txt)" }} />
        </label>
        <button type="button" onClick={() => setVerTons((v) => !v)} aria-expanded={verTons} aria-label="Tom de pele" title="Tom de pele"
          className="wa-emoji wa-icone wa-expr-btn w-9 h-9 inline-flex items-center justify-center rounded-md text-[20px]">
          {TONS.find((t) => t.hex === tom)?.amostra || "✋"}
        </button>
        {verTons && (
          <div className="absolute right-2 top-11 z-10 flex gap-0.5 p-1 rounded-lg shadow-lg" role="radiogroup" aria-label="Tom de pele"
            style={{ background: "var(--wa-list)", border: "1px solid var(--wa-line)" }}>
            {TONS.map((t) => (
              <button key={t.hex || "padrao"} type="button" role="radio" aria-checked={tom === t.hex} aria-label={t.nome} title={t.nome} onClick={() => trocarTom(t.hex)}
                className="wa-emoji wa-icone wa-expr-btn w-9 h-9 inline-flex items-center justify-center rounded-md text-[20px]"
                style={tom === t.hex ? { background: "var(--wa-hover)" } : undefined}>{t.amostra}</button>
            ))}
          </div>
        )}
      </div>

      {/* Grade */}
      <div ref={rolagem} onScroll={aoRolar} onKeyDown={(e) => navegarGrade(e, rolagem.current)} className="flex-1 overflow-y-auto min-h-0 px-2 pb-2 relative">
        {erro && <p className="p-4 text-[13px] text-center" style={{ color: "var(--wa-meta)" }}>Não consegui carregar os emojis. Feche e abra de novo.</p>}
        {!emojis && !erro && (
          <div className="flex flex-wrap gap-1 p-1" aria-busy="true" aria-label="Carregando emojis">
            {Array.from({ length: compacto ? 40 : 60 }, (_, i) => (
              <span key={i} className="rounded-md animate-pulse" style={{ width: tamanhoBotao - 6, height: tamanhoBotao - 6, margin: 3, background: "var(--wa-head)" }} />
            ))}
          </div>
        )}
        {emojis && resultado && (
          resultado.length === 0
            ? <p className="p-6 text-[13px] text-center" style={{ color: "var(--wa-meta)" }}>Nenhum emoji encontrado.</p>
            : <div className="flex flex-wrap" role="grid" aria-label="Resultados da busca">{resultado.map((e) => botao(comTom(e, tom), e.label, e.u))}</div>
        )}
        {emojis && !resultado && categorias.map((c) => {
          const lista: ReactNode[] = c.id === "recentes"
            ? recentes.map((u) => botao(u, "Recente", `r-${u}`))
            : (porGrupo.get(c.id) || []).map((e) => botao(comTom(e, tom), e.label, e.u));
          return (
            <section key={String(c.id)} data-cat={String(c.id)} className={c.id === "recentes" ? "" : "wa-expr-sec"} aria-label={c.nome}>
              <h3 className="text-[13px] px-1 pt-3 pb-1.5" style={{ color: "var(--wa-meta)" }}>{c.nome}</h3>
              <div className="flex flex-wrap">{lista}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
type CATEGORIA_ID = number | "recentes";

// ── Figurinhas ──────────────────────────────────────────────────────────────

const LIMITE_FIGURINHA = 100 * 1024;

function carregarImagem(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error("Não consegui abrir essa imagem.")); };
    img.src = url;
  });
}

const paraBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, "image/webp", q));

/** Foto → WEBP 512×512, "contain", fundo transparente, até 100 KB. */
async function fotoParaFigurinha(arquivo: File): Promise<string> {
  const img = await carregarImagem(arquivo);
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("O navegador não deixou desenhar a figurinha.");
  const esc = Math.min(512 / img.width, 512 / img.height);
  const w = img.width * esc, h = img.height * esc;
  ctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
  let blob: Blob | null = null;
  for (let q = 0.9; q >= 0.2; q -= 0.1) {
    blob = await paraBlob(c, q);
    if (!blob || blob.type !== "image/webp") throw new Error("Este navegador não gera figurinha (WEBP). Use o Chrome ou o Edge.");
    if (blob.size <= LIMITE_FIGURINHA) break;
  }
  if (!blob || blob.size > LIMITE_FIGURINHA) throw new Error("A figurinha ficou maior que 100 KB. Tente uma imagem mais simples.");
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function FigurinhasPainel({ onEscolher }: { onEscolher: (f: Figurinha) => void }) {
  const { currentUser } = useQsAuth();
  const [lista, setLista] = useState<Figurinha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [apagar, setApagar] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const grade = useRef<HTMLDivElement>(null);

  const recarregar = () => listarFigurinhas().then(setLista).catch((e) => { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); });
  useEffect(() => { void recarregar(); }, []);

  async function criar(f: File | undefined) {
    if (arquivo.current) arquivo.current.value = "";
    if (!f) return;
    setErro(null); setCriando(true);
    try {
      const dataBase64 = await fotoParaFigurinha(f);
      await salvarFigurinha({ dataBase64 });
      await recarregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui criar a figurinha."); }
    finally { setCriando(false); }
  }

  async function confirmarApagar(id: string) {
    setErro(null);
    try { await apagarFigurinha(id); setApagar(null); await recarregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não apaguei."); }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <button type="button" onClick={() => arquivo.current?.click()} disabled={criando}
          className="h-9 px-3 rounded-full text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 wa-expr-btn"
          style={{ background: "var(--wa-head)", color: "var(--wa-green-ink)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {criando ? "Criando…" : "Criar figurinha"}
        </button>
        <input ref={arquivo} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => void criar(e.target.files?.[0])} />
        {erro && <span role="alert" className="text-[12.5px] flex-1 min-w-0" style={{ color: "var(--err-ink, #c0392b)" }}>{erro}</span>}
      </div>
      <div ref={grade} onKeyDown={(e) => navegarGrade(e, grade.current)} className="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
        {lista === null && (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 p-1" aria-busy="true">
            {Array.from({ length: 12 }, (_, i) => <span key={i} className="aspect-square rounded-lg animate-pulse" style={{ background: "var(--wa-head)" }} />)}
          </div>
        )}
        {lista?.length === 0 && (
          <p className="p-6 text-[13px] text-center max-w-sm mx-auto" style={{ color: "var(--wa-meta)" }}>
            Nenhuma figurinha ainda. Crie uma a partir de uma foto — ou, quando o cliente mandar uma, clique com o botão direito nela pra salvar aqui.
          </p>
        )}
        {lista && lista.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1">
            {lista.map((f) => {
              const minha = f.criado_por === currentUser?.id;
              return (
                <div key={f.id} className="relative group">
                  <button type="button" data-emoji onClick={() => onEscolher(f)} aria-label="Mandar figurinha"
                    className="wa-icone wa-expr-btn w-full aspect-square rounded-lg p-1.5 inline-flex items-center justify-center">
                    <img src={f.url} alt="" loading="lazy" className="w-full h-full object-contain" />
                  </button>
                  {minha && apagar !== f.id && (
                    <button type="button" onClick={() => setApagar(f.id)} aria-label="Apagar figurinha" title="Apagar"
                      className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100"
                      style={{ background: "var(--wa-list)", color: "var(--wa-meta)", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                  {apagar === f.id && (
                    <div className="absolute inset-0 rounded-lg flex flex-col items-center justify-center gap-1 text-[11.5px]" style={{ background: "var(--wa-list)", border: "1px solid var(--wa-line)" }}>
                      <span style={{ color: "var(--wa-txt)" }}>Apagar?</span>
                      <span className="flex gap-1">
                        <button type="button" onClick={() => void confirmarApagar(f.id)} className="px-2 h-6 rounded-full font-semibold" style={{ background: "#e5484d", color: "#fff" }}>Sim</button>
                        <button type="button" onClick={() => setApagar(null)} className="px-2 h-6 rounded-full" style={{ background: "var(--wa-head)", color: "var(--wa-txt)" }}>Não</button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── O painel (abre acima do campo de texto) ─────────────────────────────────

export default function PainelExpressoes({ aba, onAba, onEmoji, onFigurinha }: {
  aba: "emoji" | "figurinha";
  onAba: (a: "emoji" | "figurinha") => void;
  onEmoji: (e: string) => void;
  onFigurinha: (f: Figurinha) => void;
}) {
  return (
    <div className="flex flex-col rounded-xl overflow-hidden" style={{ height: 320, background: "var(--wa-list)", border: "1px solid var(--wa-line)" }}>
      <style>{EMOJI_FONT_CSS}</style>
      <div className="flex-1 min-h-0">
        {aba === "emoji" ? <EmojiPicker onEscolher={onEmoji} autoFocus /> : <FigurinhasPainel onEscolher={onFigurinha} />}
      </div>
      <div className="flex items-center justify-center gap-1 h-11 flex-shrink-0" role="tablist" aria-label="Expressões" style={{ borderTop: "1px solid var(--wa-line)", background: "var(--wa-head)" }}>
        {([["emoji", "Emojis"], ["figurinha", "Figurinhas"]] as const).map(([k, r]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} aria-label={r} title={r} onClick={() => onAba(k)}
            className="wa-icone wa-expr-btn w-12 h-9 rounded-full inline-flex items-center justify-center"
            style={aba === k ? { background: "var(--wa-hover)", color: "var(--wa-green-ink)" } : { color: "var(--wa-meta)" }}>
            {k === "emoji" ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.5V7a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h5.5" /><path d="M21 12.5 12.5 21a8.5 8.5 0 0 0 8.5-8.5z" /><path d="M8 14s1.5 2 4 2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
