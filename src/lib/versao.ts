// src/lib/versao.ts
// -----------------------------------------------------------------------------
// VERSÃO NOVA ENTRA SOZINHA (27/10/2026).
//
// O time deixa o QS aberto o dia inteiro e o QS não tem service worker. Depois
// de um deploy a aba segue rodando o JS velho, e as telas que carregam sob
// demanda quebram com "Failed to fetch dynamically imported module", porque os
// arquivos com o hash antigo deixaram de existir.
//
// Três peças, todas ligadas UMA vez no main.tsx (valem pra todas as áreas:
// Comercial, Closer, Rel, Financeiro, Operações, Gestão, Bolinha):
//
//  1. IDENTIDADE DO BUILD. O vite.config grava `__QS_VERSAO__` dentro do JS e
//     publica `/version.json` com o mesmo valor. Aba e servidor discordando =
//     saiu deploy.
//
//  2. VIGIA. Pergunta o /version.json a cada 5 min e quando a aba volta pro
//     primeiro plano. Achou versão nova → recarrega SOZINHA num momento seguro:
//       • nenhuma ligação em andamento (microfone aberto ou áudio de chamada
//         tocando — webfone, ligação oficial do WhatsApp, gravação de áudio);
//       • nenhum texto digitado (campo em foco, textarea/caixa de mensagem com
//         rascunho, ou modal aberto com algum campo preenchido);
//       • e a aba ESCONDIDA, ou visível porém parada há 60 s.
//     Enquanto espera, com a aba visível, aparece uma faixa discreta "Nova
//     versão do QS — atualizando em instantes" com um botão pra quem quiser já.
//
//  3. REDE DE SEGURANÇA. Se mesmo assim um import dinâmico falhar (o arquivo
//     sumiu), recarrega a página UMA vez. Trava contra laço no sessionStorage,
//     com a MESMA chave do `lazyPagina` — os dois nunca recarregam em dobro.
//
// Em `vite dev` não há build nem version.json: o vigia fica desligado.
// -----------------------------------------------------------------------------

declare const __QS_VERSAO__: string;

/** A versão que ESTA aba está rodando (vazia em dev). */
export const VERSAO_DA_ABA: string = typeof __QS_VERSAO__ === "string" ? __QS_VERSAO__ : "";

const INTERVALO_MS = 5 * 60_000;
const OCIOSO_MS = 60_000;
const PASSO_MS = 5_000;
/** Mesma chave e janela do src/lib/qs/lazyPagina.ts. */
const CHAVE_CHUNK = "qs_reload_chunk";
const VALIDADE_CHUNK_MS = 30_000;
/** Versão pra qual já recarregamos uma vez nesta aba (contra laço de cache). */
const CHAVE_ALVO = "qs_versao_alvo";

let iniciado = false;
let versaoNova: string | null = null;
let ultimaInteracao = Date.now();
let faixa: HTMLDivElement | null = null;
let passo: ReturnType<typeof setInterval> | null = null;
let consultando = false;

// ─── Microfone e áudio de chamada ───────────────────────────────────────────
// Nenhum dos três jeitos de falar com o cliente (webfone SIP, ligação oficial
// do WhatsApp, gravar áudio) precisa ser importado aqui: todos abrem o
// microfone pelo getUserMedia. Embrulhar essa função no boot dá ao vigia uma
// resposta única pra "tem alguém falando agora?" sem puxar o JsSIP pro pedaço
// principal do app.
const streamsDoMicrofone = new Set<MediaStream>();

function vigiarMicrofone(): void {
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== "function") return;
  const original = md.getUserMedia.bind(md);
  try {
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const s = await original(c);
      streamsDoMicrofone.add(s);
      return s;
    };
  } catch {
    /* navegador não deixa trocar: fica só a checagem do áudio tocando */
  }
}

function emLigacao(): boolean {
  for (const s of streamsDoMicrofone) {
    const vivas = s.getTracks().filter((t) => t.readyState === "live");
    if (vivas.length) return true;
    streamsDoMicrofone.delete(s);
  }
  // Áudio remoto de chamada: <audio> com MediaStream ao vivo.
  for (const el of Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video"))) {
    const src = el.srcObject;
    if (src && typeof MediaStream !== "undefined" && src instanceof MediaStream) {
      if (src.getTracks().some((t) => t.readyState === "live")) return true;
    }
  }
  return false;
}

// ─── Texto digitado ─────────────────────────────────────────────────────────

const TIPOS_DE_TEXTO = new Set(["", "text", "email", "tel", "url", "number", "search", "password", "date", "datetime-local", "time"]);

function campoComTexto(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return el.value.trim() !== "";
  if (el instanceof HTMLInputElement) return TIPOS_DE_TEXTO.has(el.type) && el.value.trim() !== "";
  if (el instanceof HTMLElement && el.isContentEditable) return (el.textContent ?? "").trim() !== "";
  return false;
}

function temTextoDigitado(): boolean {
  // 1. Alguém está escrevendo num campo agora. (Campo em foco VAZIO não trava:
  //    uma busca com autofoco seguraria a versão velha o dia inteiro.)
  if (document.activeElement && campoComTexto(document.activeElement)) return true;
  // 2. Rascunho em caixa de mensagem / observação (textarea, editor rico).
  for (const el of Array.from(document.querySelectorAll("textarea,[contenteditable='true'],[contenteditable='']"))) {
    if (campoComTexto(el)) return true;
  }
  // 3. Modal aberto com qualquer campo preenchido (desfecho, agendamento…).
  const modais = document.querySelectorAll("[role='dialog'],[aria-modal='true'],dialog[open]");
  for (const m of Array.from(modais)) {
    for (const el of Array.from(m.querySelectorAll("input,textarea,[contenteditable]"))) {
      if (campoComTexto(el)) return true;
    }
  }
  return false;
}

/** Dá pra recarregar sem custar nada a ninguém? */
export function momentoSeguro(): boolean {
  try {
    return !emLigacao() && !temTextoDigitado();
  } catch {
    return false; // na dúvida, espera
  }
}

// ─── Faixa ──────────────────────────────────────────────────────────────────

function mostrarFaixa(): void {
  if (faixa || !document.body) return;
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.style.cssText = [
    "position:fixed", "z-index:2147483000", "left:50%", "bottom:16px", "transform:translateX(-50%)",
    "display:flex", "align-items:center", "gap:10px", "max-width:calc(100vw - 32px)",
    "padding:8px 8px 8px 14px", "border-radius:12px", "background:#17202E", "color:#fff",
    "font:600 13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,.25)",
  ].join(";");
  const txt = document.createElement("span");
  txt.textContent = "Nova versão do QS — atualizando em instantes";
  const bt = document.createElement("button");
  bt.type = "button";
  bt.textContent = "Atualizar agora";
  bt.style.cssText = "flex-shrink:0;border:0;border-radius:8px;padding:6px 10px;background:#0147FF;color:#fff;font:700 12px system-ui,sans-serif;cursor:pointer";
  bt.addEventListener("click", () => recarregar());
  el.append(txt, bt);
  document.body.appendChild(el);
  faixa = el;
}

// ─── Recarregar ─────────────────────────────────────────────────────────────

function lerSessao(k: string): string | null {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function gravarSessao(k: string, v: string): void {
  try { sessionStorage.setItem(k, v); } catch { /* modo restrito */ }
}

function recarregar(): void {
  if (versaoNova) gravarSessao(CHAVE_ALVO, versaoNova);
  window.location.reload();
}

/** A cada 5 s, com versão nova pendente: chegou a hora? */
function tentarAgora(): void {
  if (!versaoNova) return;
  if (!momentoSeguro()) { if (!document.hidden) mostrarFaixa(); return; }
  if (document.hidden) { recarregar(); return; }
  mostrarFaixa();
  if (Date.now() - ultimaInteracao >= OCIOSO_MS) recarregar();
}

async function versaoDoServidor(): Promise<string | null> {
  try {
    // no-store: com o JSON vindo do cache, a resposta seria sempre "igual".
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { versao?: unknown };
    return typeof j?.versao === "string" && j.versao ? j.versao : null;
  } catch {
    return null; // offline / rede caiu: não é sinal de versão nova
  }
}

async function verificar(): Promise<void> {
  if (versaoNova || consultando || !VERSAO_DA_ABA) return;
  consultando = true;
  try {
    const servidor = await versaoDoServidor();
    if (!servidor || servidor === VERSAO_DA_ABA) return;
    // TRAVA DE LAÇO: já recarregamos pra essa versão e continuamos na velha
    // (CDN ou proxy segurando o index.html). Não insiste sozinho: só a faixa,
    // com o botão, pra pessoa decidir.
    if (lerSessao(CHAVE_ALVO) === servidor) {
      versaoNova = servidor;
      mostrarFaixa();
      if (passo) { clearInterval(passo); passo = null; }
      return;
    }
    versaoNova = servidor;
    passo = setInterval(tentarAgora, PASSO_MS);
    tentarAgora();
  } finally {
    consultando = false;
  }
}

// ─── Import dinâmico que falhou ─────────────────────────────────────────────

const RE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i;

function ehChunkSumido(erro: unknown): boolean {
  const msg = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro ?? "");
  return RE_CHUNK.test(msg);
}

function jaRecarregouPorChunk(): boolean {
  let v: string | null;
  try { v = sessionStorage.getItem(CHAVE_CHUNK); } catch { return true; } // sem storage não há trava: não arrisca laço
  const marca = Number(v ?? 0);
  return marca > 0 && Date.now() - marca < VALIDADE_CHUNK_MS;
}

/** Recarrega uma vez por causa de arquivo sumido. Devolve se recarregou. */
function recarregarPorChunk(): boolean {
  if (jaRecarregouPorChunk()) return false;
  gravarSessao(CHAVE_CHUNK, String(Date.now()));
  window.location.reload();
  return true;
}

function capturarImportQuebrado(): void {
  // O Vite dispara isto quando um import() dinâmico (ou o CSS dele) falha.
  window.addEventListener("vite:preloadError", (ev) => {
    if (recarregarPorChunk()) ev.preventDefault();
  });
  // Rede de segurança pros imports que não passam pelo helper do Vite.
  window.addEventListener("unhandledrejection", (ev) => {
    if (ehChunkSumido(ev.reason)) recarregarPorChunk();
  });
  window.addEventListener("error", (ev) => {
    if (ehChunkSumido(ev.error ?? ev.message)) recarregarPorChunk();
  });
}

// ─── Ligar ──────────────────────────────────────────────────────────────────

/** Páginas abertas pelo CLIENTE (link com token, agendamento): sem vigia. */
function paginaDeCliente(): boolean {
  return /^\/(documentos|pesquisa|proposta|agendar)(\/|$)/i.test(window.location.pathname);
}

/** Chamar uma vez, no main.tsx, antes de renderizar. */
export function iniciarAtualizacaoAutomatica(): void {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;

  capturarImportQuebrado();
  if (!VERSAO_DA_ABA || paginaDeCliente()) return;

  vigiarMicrofone();

  const mexeu = () => { ultimaInteracao = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "mousemove", "input"]) {
    window.addEventListener(ev, mexeu, { passive: true, capture: true });
  }

  const aoVoltar = () => { if (!document.hidden) void verificar(); else tentarAgora(); };
  document.addEventListener("visibilitychange", aoVoltar);
  window.addEventListener("focus", aoVoltar);
  setInterval(() => void verificar(), INTERVALO_MS);
  // Primeira consulta um pouco depois do boot, sem disputar a rede com o login.
  setTimeout(() => void verificar(), 20_000);
}
