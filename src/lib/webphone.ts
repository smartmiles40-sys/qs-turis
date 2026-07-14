// src/lib/webphone.ts
// -----------------------------------------------------------------------------
// WEBFONE WebRTC (VoxFree) — ligação de voz REAL dentro do navegador, via JsSIP.
//
// Diferente da Wavoip (que liga pelo WhatsApp) e do click-to-dial SIP (que abre
// um softphone instalado no PC), aqui o próprio navegador registra o ramal SIP
// por WSS e faz a chamada — o SDR só clica "Ligar" e fala pelo microfone.
//
// Fluxo:
//   1. lê a linha SIP do SDR logado (qs_sip_lines, RLS por dono) + a config
//      compartilhada (WSS/domínio/prefixo em qs_settings)      → getMySipLine()
//   2. cria o UA JsSIP e espera REGISTRAR no VoxFree            → ensureRegistered()
//   3. disca (sip:<prefixo><numero>@<dominio>)                 → dialViaWebphone()
//   4. anexa o áudio remoto, emite o estado pro widget e, ao
//      encerrar, registra o desfecho (log + callback do Painel) → wiring interno
//
// Segurança: a senha SIP vive só na linha do próprio SDR (RLS). É carregada na
// memória do navegador na hora de registrar — inevitável no WebRTC —, nunca no
// bundle e nunca legível por outro SDR. Config compartilhada (não-secreta) fica
// em qs_settings. Ver migration 0013_sip_lines.sql.
// -----------------------------------------------------------------------------

import { UA, WebSocketInterface } from "jssip";
import { supabase } from "./supabase";
import { getSetting, setSetting } from "./qsSettings";
import { normalizePhoneBR, logWhatsApp } from "./whatsapp";

// Tipo da sessão de chamada (o JsSIP não reexporta RTCSession pelo índice).
type RTCSession = ReturnType<InstanceType<typeof UA>["call"]>;

// ── Config compartilhada (qs_settings — NÃO secreta) ─────────────────────────
export const SIP_WS_URL_KEY = "sip_ws_url"; // ex.: wss://box49.voxfree.com:5080
export const SIP_WS_DOMAIN_KEY = "sip_ws_domain"; // realm/registrar, ex.: box49.voxfree.com
export const SIP_WS_PREFIX_KEY = "sip_ws_prefix"; // prefixo de rota de saída (ex.: "0"), vazio = disca o número puro

export interface SipSharedConfig {
  wsUrl: string;
  domain: string;
  prefix: string;
}

/** Config compartilhada do webfone WebRTC (legível por qualquer SDR). */
export async function getSipSharedConfig(): Promise<SipSharedConfig> {
  const [wsUrl, domain, prefix] = await Promise.all([
    getSetting<string>(SIP_WS_URL_KEY),
    getSetting<string>(SIP_WS_DOMAIN_KEY),
    getSetting<string>(SIP_WS_PREFIX_KEY),
  ]);
  return {
    wsUrl: (wsUrl ?? "").trim(),
    domain: (domain ?? "").trim(),
    prefix: (prefix ?? "").trim(),
  };
}

/** Salva a config compartilhada (só admin/gestor — RLS de qs_settings, 0011). */
export async function saveSipSharedConfig(cfg: SipSharedConfig): Promise<boolean> {
  const [a, b, c] = await Promise.all([
    setSetting(SIP_WS_URL_KEY, cfg.wsUrl.trim()),
    setSetting(SIP_WS_DOMAIN_KEY, cfg.domain.trim()),
    setSetting(SIP_WS_PREFIX_KEY, cfg.prefix.trim()),
  ]);
  return a && b && c;
}

// ── Linha SIP do SDR (qs_sip_lines — RLS por dono) ───────────────────────────
export interface SipLineRow {
  user_id: string;
  auth_user: string;
  password: string;
  display_name: string | null;
  ws_url: string | null;
  domain: string | null;
  active: boolean;
}

/** Linha resolvida (row do SDR + fallback pra config compartilhada) pronta pra registrar. */
export interface ResolvedSipLine {
  wsUrl: string;
  domain: string;
  authUser: string;
  password: string;
  displayName?: string;
  prefix: string;
}

/**
 * Lê a linha SIP do SDR logado (RLS devolve só a dele) e mescla com a config
 * compartilhada. Null se o admin ainda não provisionou o ramal do SDR ou se a
 * config compartilhada (WSS/domínio) está incompleta.
 */
export async function getMySipLine(): Promise<ResolvedSipLine | null> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id;
  if (!uid) return null;

  const [{ data: row }, shared] = await Promise.all([
    supabase
      .from("qs_sip_lines")
      .select("user_id, auth_user, password, display_name, ws_url, domain, active")
      .eq("user_id", uid)
      .maybeSingle(),
    getSipSharedConfig(),
  ]);

  const line = row as SipLineRow | null;
  if (!line || !line.active || !line.auth_user || !line.password) return null;

  const wsUrl = (line.ws_url || shared.wsUrl || "").trim();
  const domain = (line.domain || shared.domain || "").trim();
  if (!wsUrl || !domain) return null; // sem WSS/domínio não dá pra registrar

  return {
    wsUrl,
    domain,
    authUser: line.auth_user.trim(),
    password: line.password,
    displayName: (line.display_name || undefined)?.trim() || undefined,
    prefix: shared.prefix,
  };
}

/** true se o SDR logado tem uma linha SIP completa (dá pra ligar pelo navegador). */
export async function isWebphoneConfigured(): Promise<boolean> {
  return (await getMySipLine()) !== null;
}

// ── Estado da chamada (para o WebphoneWidget) ────────────────────────────────
export type CallStatus = "idle" | "registering" | "connecting" | "ringing" | "in_call" | "ended";

export interface WebphoneState {
  status: CallStatus;
  peerName?: string | null;
  peerNumber?: string | null;
  muted: boolean;
  /** epoch ms de quando a chamada foi ATENDIDA (pra o cronômetro); null até atender. */
  answeredAt: number | null;
  error?: string | null;
}

let state: WebphoneState = { status: "idle", muted: false, answeredAt: null };
const listeners = new Set<(s: WebphoneState) => void>();

function setState(patch: Partial<WebphoneState>): void {
  state = { ...state, ...patch };
  for (const cb of listeners) {
    try { cb(state); } catch { /* um listener não pode derrubar os outros */ }
  }
}

/** Assina o estado do webfone (o widget usa isso). Devolve a função de cancelar. */
export function subscribeWebphone(cb: (s: WebphoneState) => void): () => void {
  listeners.add(cb);
  cb(state); // emite o estado atual na hora de assinar
  return () => listeners.delete(cb);
}

export function getWebphoneState(): WebphoneState {
  return state;
}

// ── Callback de fim de chamada (desfecho automático no Painel) ───────────────
export interface CallEndedInfo {
  leadId: string | null;
  phone: string | null;
  answered: boolean;
  durationSec: number;
}
let onCallEndedCb: ((info: CallEndedInfo) => void) | null = null;
/** Registra quem reage ao fim de uma chamada (ex.: o Painel abre o desfecho). */
export function setOnCallEnded(cb: ((info: CallEndedInfo) => void) | null): void {
  onCallEndedCb = cb;
}

// ── Áudio remoto ─────────────────────────────────────────────────────────────
let remoteAudio: HTMLAudioElement | null = null;
function getRemoteAudio(): HTMLAudioElement {
  if (remoteAudio) return remoteAudio;
  const el = document.createElement("audio");
  el.autoplay = true;
  el.hidden = true;
  el.id = "qs-webphone-audio";
  document.body.appendChild(el);
  remoteAudio = el;
  return el;
}

function attachRemoteStream(session: RTCSession): void {
  const bind = (pc: RTCPeerConnection) => {
    const audio = getRemoteAudio();
    const setStream = (stream: MediaStream | undefined) => {
      if (stream) { audio.srcObject = stream; void audio.play().catch(() => { /* autoplay pode exigir gesto */ }); }
    };
    // Padrão moderno (ontrack) + fallback pro antigo (onaddstream).
    pc.addEventListener("track", (ev) => setStream((ev as RTCTrackEvent).streams?.[0]));
    // @ts-expect-error onaddstream é legado (não está no lib.dom atual), mas alguns navegadores ainda emitem.
    pc.addEventListener("addstream", (ev) => setStream(ev?.stream));
    // Se o stream já existir (evento perdido), tenta pelos receivers.
    const fromReceivers = pc.getReceivers?.().map((r) => r.track).filter(Boolean) as MediaStreamTrack[] | undefined;
    if (fromReceivers && fromReceivers.length) setStream(new MediaStream(fromReceivers));
  };
  const existing = (session as unknown as { connection?: RTCPeerConnection }).connection;
  if (existing) bind(existing);
  session.on("peerconnection", (e: unknown) => {
    const pc = (e as { peerconnection?: RTCPeerConnection })?.peerconnection;
    if (pc) bind(pc);
  });
}

// ── UA (singleton) ───────────────────────────────────────────────────────────
type RegResult = { ok: boolean; error?: string };

let ua: UA | null = null;
let uaLineKey = "";       // identifica a linha registrada; se mudar, recria o UA
let registered = false;    // reflete o "registered" do JsSIP (some numa reconexão)
// Quem está esperando o próximo evento de registro (vários cliques concorrentes).
let registrationWaiters: Array<(r: RegResult) => void> = [];

function lineKey(line: ResolvedSipLine): string {
  return `${line.wsUrl}|${line.authUser}@${line.domain}`;
}

function flushWaiters(r: RegResult): void {
  const waiters = registrationWaiters;
  registrationWaiters = [];
  for (const cb of waiters) { try { cb(r); } catch { /* ignora */ } }
}

/** Cria o UA JsSIP com listeners PERSISTENTES (sobrevivem a reconexões). */
function buildUa(line: ResolvedSipLine): UA {
  const socket = new WebSocketInterface(line.wsUrl);
  const agent = new UA({
    sockets: [socket],
    uri: `sip:${line.authUser}@${line.domain}`,
    authorization_user: line.authUser,
    password: line.password,
    realm: line.domain,
    display_name: line.displayName,
    register: true,
    session_timers: false, // muitos PABX não usam; evita RE-INVITE desnecessário
  });
  agent.on("registered", () => {
    registered = true;
    if (state.status === "registering") setState({ status: "idle", error: null });
    flushWaiters({ ok: true });
  });
  agent.on("unregistered", () => { registered = false; });
  agent.on("registrationFailed", (e: unknown) => {
    registered = false;
    const cause = (e as { cause?: string })?.cause || "";
    flushWaiters({ ok: false, error: `Falha ao registrar o ramal${cause ? ` (${cause})` : ""} — confira ramal/senha no VoxFree.` });
  });
  agent.on("disconnected", () => { registered = false; });
  return agent;
}

/**
 * Garante o UA JsSIP criado e REGISTRADO no VoxFree. Reaproveita o UA enquanto a
 * linha não muda; se a config trocar (novo ramal/WSS), derruba e recria. Lida com
 * reconexão: se o WSS caiu, cutuca um novo register e espera o evento.
 */
export async function ensureRegistered(): Promise<RegResult> {
  const line = await getMySipLine();
  if (!line) {
    return { ok: false, error: "Seu ramal ainda não foi configurado (Configurações → Webfone WebRTC)." };
  }

  const key = lineKey(line);
  // Linha mudou: derruba o UA antigo e zera o estado de registro.
  if (ua && uaLineKey !== key) {
    try { ua.stop(); } catch { /* ignora */ }
    ua = null;
    registered = false;
    registrationWaiters = [];
  }
  // Já registrado nessa mesma linha? Reaproveita na hora.
  if (ua && registered && ua.isRegistered()) return { ok: true };

  return new Promise<RegResult>((resolve) => {
    let settled = false;
    const done = (r: RegResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      registrationWaiters = registrationWaiters.filter((w) => w !== waiter);
      if (!r.ok && state.status === "registering") setState({ status: "idle", error: r.error ?? null });
      resolve(r);
    };
    const waiter = (r: RegResult) => done(r);
    // Timeout de registro (rede/credencial ruim não pode travar o clique).
    const timer = setTimeout(
      () => done({ ok: false, error: "O ramal não registrou a tempo — confira o WSS/senha (Configurações → Webfone WebRTC)." }),
      12000,
    );
    registrationWaiters.push(waiter);

    setState({ status: "registering", error: null });
    try {
      if (!ua) { uaLineKey = key; ua = buildUa(line); ua.start(); }
      else { try { ua.register(); } catch { /* re-register best-effort */ } }
    } catch (e) {
      done({ ok: false, error: e instanceof Error ? e.message : "Erro ao iniciar o webfone." });
    }
  });
}

// ── Discagem ─────────────────────────────────────────────────────────────────
let currentSession: RTCSession | null = null;

export interface WebphoneDialContext {
  leadId?: string | null;
  ownerId?: string | null;
  leadName?: string | null;
}
export type DialResult = { ok: true } | { ok: false; error: string };

/**
 * Liga para um telefone pelo webfone WebRTC. `phone` em qualquer formato BR é
 * normalizado; o alvo vira sip:<prefixo><numero>@<dominio>. Garante o registro
 * antes de discar, anexa o áudio remoto e registra o desfecho ao encerrar.
 */
export async function dialViaWebphone(phone?: string | null, ctx?: WebphoneDialContext): Promise<DialResult> {
  const to = normalizePhoneBR(phone);
  if (!to || to.length < 11) return { ok: false, error: "Telefone inválido para ligar." };
  if (currentSession && !currentSession.isEnded()) {
    return { ok: false, error: "Já existe uma chamada em andamento — encerre antes de ligar de novo." };
  }

  const reg = await ensureRegistered();
  if (!reg.ok) return { ok: false, error: reg.error ?? "Webfone indisponível." };

  const line = await getMySipLine();
  if (!line || !ua) return { ok: false, error: "Webfone indisponível." };

  const target = `sip:${line.prefix}${to}@${line.domain}`;
  let answeredAt: number | null = null;

  try {
    setState({
      status: "connecting",
      peerName: ctx?.leadName ?? null,
      peerNumber: to,
      muted: false,
      answeredAt: null,
      error: null,
    });

    const session = ua.call(target, {
      mediaConstraints: { audio: true, video: false },
      // STUN público de apoio ao ICE. Se em alguma rede o áudio sair mudo,
      // adicionamos um TURN do VoxFree aqui.
      pcConfig: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
    });
    currentSession = session;
    attachRemoteStream(session);

    session.on("progress", () => setState({ status: "ringing" }));
    session.on("accepted", () => { answeredAt = Date.now(); setState({ status: "in_call", answeredAt }); });
    session.on("confirmed", () => { if (!answeredAt) answeredAt = Date.now(); setState({ status: "in_call", answeredAt }); });

    const finish = (failed: boolean, causeRaw?: unknown) => {
      const wasCurrent = currentSession === session;
      if (wasCurrent) currentSession = null;
      const answered = answeredAt !== null;
      const durSec = answered ? Math.max(0, Math.round((Date.now() - answeredAt!) / 1000)) : 0;
      const cause = typeof causeRaw === "object" && causeRaw
        ? String((causeRaw as { cause?: string }).cause ?? "")
        : "";
      setState({ status: "ended", answeredAt: null });
      // Volta pra "idle" depois de um instante (o widget mostra "encerrada" e some).
      setTimeout(() => { if (state.status === "ended") setState({ status: "idle", peerName: null, peerNumber: null }); }, 2500);

      const desfecho = answered ? "atendida" : "não atendida";
      void logWhatsApp({
        leadId: ctx?.leadId ?? null,
        ownerId: ctx?.ownerId ?? null,
        phone: to,
        body: `📞 Ligação (webfone WebRTC) — ${desfecho}` +
          (durSec ? ` · ${formatDuration(durSec)}` : "") +
          (failed && cause ? ` [${cause}]` : ""),
        status: answered ? "sent" : "failed",
        direction: "out",
        kind: "call",
      });

      if (onCallEndedCb) {
        try { onCallEndedCb({ leadId: ctx?.leadId ?? null, phone: to, answered, durationSec: durSec }); }
        catch { /* callback do app não pode derrubar o webfone */ }
      }
    };

    session.on("ended", () => finish(false));
    session.on("failed", (e: unknown) => finish(true, e));

    return { ok: true };
  } catch (e) {
    currentSession = null;
    setState({ status: "idle", peerName: null, peerNumber: null, error: null });
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao iniciar a chamada." };
  }
}

/** Desliga a chamada atual (se houver). */
export function hangupWebphone(): void {
  try { currentSession?.terminate(); } catch { /* já encerrada */ }
}

/** Alterna o mudo do microfone. Retorna o novo estado (true = mudo). */
export function toggleMuteWebphone(): boolean {
  const s = currentSession;
  if (!s) return false;
  const next = !state.muted;
  try {
    if (next) s.mute({ audio: true });
    else s.unmute({ audio: true });
    setState({ muted: next });
  } catch { /* sessão inválida */ }
  return next;
}

/** Envia um dígito DTMF (útil pra navegar em URA do outro lado). */
export function sendDtmf(tone: string): void {
  try { currentSession?.sendDTMF(tone); } catch { /* ignora */ }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

// ── Admin: CRUD das linhas (só gestor/admin — RLS de qs_sip_lines) ───────────
export interface SipLineAdmin {
  user_id: string;
  auth_user: string;
  password: string;
  display_name: string | null;
  active: boolean;
}

/** Lista todas as linhas SIP (o gestor enxerga todas via RLS). */
export async function listSipLines(): Promise<SipLineAdmin[]> {
  const { data, error } = await supabase
    .from("qs_sip_lines")
    .select("user_id, auth_user, password, display_name, active");
  if (error) { console.warn("[webphone] listSipLines:", error.message); return []; }
  return (data ?? []) as SipLineAdmin[];
}

/** Cria/atualiza a linha SIP de um usuário. */
export async function saveSipLine(line: SipLineAdmin): Promise<boolean> {
  const { error } = await supabase.from("qs_sip_lines").upsert(
    {
      user_id: line.user_id,
      auth_user: line.auth_user.trim(),
      password: line.password,
      display_name: line.display_name?.trim() || null,
      active: line.active,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) console.warn("[webphone] saveSipLine:", error.message);
  return !error;
}

/** Remove a linha SIP de um usuário. */
export async function deleteSipLine(userId: string): Promise<boolean> {
  const { error } = await supabase.from("qs_sip_lines").delete().eq("user_id", userId);
  if (error) console.warn("[webphone] deleteSipLine:", error.message);
  return !error;
}
