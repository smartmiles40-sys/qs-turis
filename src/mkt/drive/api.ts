// src/mkt/drive/api.ts — conversa da tela com /api/mkt-drive (0241).
// Tudo passa pelo servidor (a conta de serviço do Google nunca vem pro
// navegador). Exceção: o PUT do upload, que vai DIRETO pro Google na URL de
// sessão que o servidor abriu — o arquivo não passa pela função da Vercel.
import { supabase } from "@/lib/supabase";
import type { ConfigDrive, ItemDrive, Migalha } from "./tipos";

export class ErroDrive extends Error {
  configurar: boolean;
  constructor(msg: string, configurar = false) { super(msg); this.configurar = configurar; }
}

async function token(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ErroDrive("Sessão expirada. Entre de novo.");
  return session.access_token;
}

export async function chamarDrive<T>(corpo: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/mkt-drive", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j as { error?: string; configurar?: boolean };
    throw new ErroDrive(e.error || `Falhou (${r.status}).`, !!e.configurar);
  }
  return j as T;
}

export const lerConfig = () => chamarDrive<ConfigDrive>({ acao: "config" });

export const listarPasta = (pastaId: string | null, pageToken?: string | null) =>
  chamarDrive<{ pastaId: string; caminho?: Migalha[]; itens: ItemDrive[]; proximaPagina: string | null }>({
    acao: "listar", pastaId: pastaId || undefined, pageToken: pageToken || undefined,
  });

export const buscarIndice = (corpo: Record<string, unknown>) =>
  chamarDrive<{ itens: ItemDrive[]; proximoOffset: number | null }>(corpo);

/** Busca AO VIVO no Drive (por nome) — pro caso do índice ainda não ter sincronizado. */
export const buscarNoDrive = (texto: string, pageToken?: string | null) =>
  chamarDrive<{ itens: ItemDrive[]; proximaPagina: string | null }>({ acao: "buscar", texto, pageToken: pageToken || undefined });

export const metadados = (id: string) => chamarDrive<{ item: ItemDrive; caminho: Migalha[] }>({ acao: "metadados", id });
export const criarPasta = (nome: string, paiId: string | null) => chamarDrive<{ item: ItemDrive }>({ acao: "criar_pasta", nome, paiId: paiId || undefined });
export const renomear = (id: string, nome: string) => chamarDrive<{ item: ItemDrive }>({ acao: "renomear", id, nome });
export const mover = (id: string, destinoId: string | null) => chamarDrive<{ item: ItemDrive }>({ acao: "mover", id, destinoId: destinoId || undefined });
export const mandarPraLixeira = (id: string) => chamarDrive<{ item: ItemDrive }>({ acao: "lixeira", id });
export const restaurar = (id: string) => chamarDrive<{ item: ItemDrive }>({ acao: "restaurar", id });
export const etiquetar = (id: string, campos: { tags?: string[]; destino?: string | null; expedicaoId?: string | null; observacao?: string | null }) =>
  chamarDrive<{ item: ItemDrive }>({ acao: "etiquetar", id, ...campos });
export const sincronizar = () => chamarDrive<{ modo: string; gravados: number; removidos: number; pendente: boolean }>({ acao: "sincronizar" });

// ── Upload ──────────────────────────────────────────────────────────────────

export interface EnvioOpcoes {
  pastaId: string | null;
  tags?: string[];
  expedicaoId?: string | null;
  onProgresso?: (enviados: number, total: number) => void;
  sinal?: AbortSignal;
}

/** PUT de um pedaço (ou do arquivo todo) na sessão resumable, com progresso. */
function put(url: string, corpo: Blob | null, headers: Record<string, string>, onProgresso?: (n: number) => void, sinal?: AbortSignal) {
  return new Promise<{ status: number; texto: string; range: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onProgresso) xhr.upload.onprogress = (e) => onProgresso(e.loaded);
    xhr.onload = () => {
      let range: string | null = null;
      try { range = xhr.getResponseHeader("Range"); } catch { range = null; }
      resolve({ status: xhr.status, texto: xhr.responseText, range });
    };
    xhr.onerror = () => reject(new ErroDrive("A conexão caiu durante o envio."));
    xhr.onabort = () => reject(new ErroDrive("Envio cancelado."));
    if (sinal) sinal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(corpo);
  });
}

/** "bytes=0-42" → 43 (próximo byte a mandar). Sem header → 0. */
export function proximoByte(range: string | null): number {
  const m = /bytes=\d+-(\d+)/.exec(range || "");
  return m ? Number(m[1]) + 1 : 0;
}

type RespostaPut = { status: number; texto: string; range: string | null };
const PEDACO_QS = 4 * 1024 * 1024; // 16 × 256 KB (o Google exige múltiplo de 256 KB)
const terminou = (r: RespostaPut | null) => !!r && (r.status === 200 || r.status === 201);

/** Uma ida ao plano B: PUT /api/mkt-drive?acao=pedaco, que repassa pro Google. */
async function putViaQs(uploadUrl: string, corpo: Blob | null, faixa: string, sinal?: AbortSignal): Promise<RespostaPut> {
  const r = await fetch("/api/mkt-drive?acao=pedaco", {
    method: "PUT",
    headers: { Authorization: `Bearer ${await token()}`, "X-Upload-Url": uploadUrl, "Content-Range": faixa, "Content-Type": "application/octet-stream" },
    body: corpo,
    signal: sinal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroDrive((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as RespostaPut;
}

/** Plano B: pedaços de 4 MB pelo QS (quando o navegador não fala direto com o Google). */
async function enviarViaQs(uploadUrl: string, arquivo: File, op: EnvioOpcoes): Promise<RespostaPut> {
  const total = arquivo.size;
  // Quanto já chegou (o PUT direto pode ter ido inteiro e só a resposta ter sido barrada).
  let st = await putViaQs(uploadUrl, null, `bytes */${total}`, op.sinal);
  if (terminou(st)) return st;
  let inicio = st.status === 308 ? proximoByte(st.range) : 0;
  let falhas = 0;
  while (inicio < total) {
    const fim = Math.min(inicio + PEDACO_QS, total) - 1;
    try {
      st = await putViaQs(uploadUrl, arquivo.slice(inicio, fim + 1), `bytes ${inicio}-${fim}/${total}`, op.sinal);
    } catch (e) {
      if (op.sinal?.aborted || ++falhas > 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * falhas));
      st = await putViaQs(uploadUrl, null, `bytes */${total}`, op.sinal).catch(() => ({ status: 0, texto: "", range: null }));
    }
    if (terminou(st)) return st;
    if (st.status === 404 || st.status === 410) throw new ErroDrive("A sessão de envio expirou. Mande o arquivo de novo.");
    if (st.status === 308) inicio = proximoByte(st.range);
    else if (st.status >= 400 && st.status < 500) throw new ErroDrive(`O Google recusou o envio (${st.status}).`);
    op.onProgresso?.(inicio, total);
  }
  throw new ErroDrive("O envio chegou ao fim mas o Google não confirmou. Tente de novo.");
}

/** Caminho direto: navegador → Google, com retomada pelo "quanto chegou". */
async function enviarDireto(uploadUrl: string, arquivo: File, op: EnvioOpcoes): Promise<RespostaPut | "sem_cors"> {
  const total = arquivo.size;
  let inicio = 0;
  let algumProgresso = false;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      const pedaco = inicio === 0 ? arquivo : arquivo.slice(inicio);
      const headers: Record<string, string> = inicio === 0 ? {} : { "Content-Range": `bytes ${inicio}-${total - 1}/${total}` };
      const base = inicio;
      const r = await put(uploadUrl, pedaco, headers, (n) => { if (n > 0) algumProgresso = true; op.onProgresso?.(base + n, total); }, op.sinal);
      if (terminou(r)) return r;
      if (r.status === 404 || r.status === 410) throw new ErroDrive("A sessão de envio expirou. Mande o arquivo de novo.");
      if (r.status === 308) { inicio = proximoByte(r.range); continue; }
      if (r.status >= 400 && r.status < 500) throw new ErroDrive(`O Google recusou o envio (${r.status}).`);
    } catch (e) {
      if (op.sinal?.aborted || (e instanceof ErroDrive && /expirou|recusou|cancelado/.test(e.message))) throw e;
      // Falhou de cara, sem 1 byte de progresso: é o CORS barrando → plano B.
      if (tentativa === 0 && !algumProgresso) return "sem_cors";
    }
    await new Promise((r) => setTimeout(r, 1000 * (tentativa + 1)));
    const st = await put(uploadUrl, null, { "Content-Range": `bytes */${total}` }, undefined, op.sinal).catch(() => null);
    if (terminou(st)) return st!;
    if (st && st.status === 308) inicio = proximoByte(st.range);
  }
  return "sem_cors"; // desistiu do direto: o plano B pergunta quanto chegou e continua
}

// Se o direto falhou por CORS uma vez, nem tenta de novo nesta aba.
let semCors = false;

/**
 * Sobe um arquivo pro Drive do Marketing:
 *   1. servidor abre a sessão resumable (com o Origin do QS) → uploadUrl
 *   2. navegador manda o arquivo direto pro Google (XHR, com progresso),
 *      retomando de onde parou se a conexão cair
 *   3. se o Google não liberar o CORS, plano B: pedaços de 4 MB pelo QS
 *   4. servidor confere no Google e registra no índice (quem subiu, tags)
 */
export async function enviarArquivo(arquivo: File, op: EnvioOpcoes): Promise<ItemDrive> {
  const { uploadUrl } = await chamarDrive<{ uploadUrl: string }>({
    acao: "iniciar_envio",
    nome: arquivo.name,
    mimeType: arquivo.type || "application/octet-stream",
    tamanho: arquivo.size,
    pastaId: op.pastaId || undefined,
  });
  let resposta: RespostaPut | "sem_cors" = semCors ? "sem_cors" : await enviarDireto(uploadUrl, arquivo, op);
  if (resposta === "sem_cors") {
    semCors = true;
    resposta = await enviarViaQs(uploadUrl, arquivo, op);
  }
  let id = "";
  try { id = (JSON.parse(resposta.texto) as { id?: string }).id || ""; } catch { id = ""; }
  if (!id) throw new ErroDrive("O Google terminou o envio mas não devolveu o arquivo.");
  op.onProgresso?.(arquivo.size, arquivo.size);
  const { item } = await chamarDrive<{ item: ItemDrive }>({
    acao: "concluir_envio", id, tags: op.tags, expedicaoId: op.expedicaoId || undefined,
  });
  return item;
}
