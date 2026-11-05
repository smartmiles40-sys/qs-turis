// src/solicitacoes/anexos.ts
// -----------------------------------------------------------------------------
// ANEXOS da Central de Solicitações (0316, 05/11/2026 — "todo mundo está
// pedindo poder anexar arquivos").
//
// Regras PURAS (sem banco, sem React — testadas em tests/solicitacoes/):
//   • o que pode subir (25 MB, nada de programa/script)
//   • nome e tamanho legíveis ("orçamento.pdf · 1,2 MB")
//   • o caminho no bucket privado `solicitacoes`: <pedido>/<carimbo>-<aleatório>.<ext>
//     (o 1º pedaço é o id do pedido — é ele que as policies do Storage conferem)
//   • que tipo de prévia mostrar (foto, PDF, outro)
//   • anexos agrupados pela mensagem em que foram enviados
// O acesso ao banco/Storage fica em anexosApi.ts.
// -----------------------------------------------------------------------------

/** Teto por arquivo (igual ao file_size_limit do bucket na 0316). */
export const LIMITE_ANEXO = 25 * 1024 * 1024;
/** Teto de arquivos por mensagem (igual ao qs_sol_anexar). */
export const MAX_ANEXOS_POR_VEZ = 20;

/** Extensões barradas (mesma lista do qs_sol_ext_bloqueada da 0316). */
export const EXT_BLOQUEADAS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "vbs", "vbe", "js", "jse", "mjs", "ws", "wsf", "wsh", "ps1", "psm1",
  "sh", "bash", "jar", "app", "dmg", "pkg", "deb", "rpm", "apk", "lnk", "reg", "hta", "dll", "sys", "iso", "img", "vhd", "gadget", "msc", "inf", "py", "pl", "rb",
]);

export interface AnexoSol {
  id: string;
  solicitacao_id: string;
  evento_id: number | null;
  path: string;
  miniatura: string | null;
  nome: string;
  mime: string | null;
  tamanho: number;
  enviado_por: string | null;
  enviado_nome: string | null;
  criado_em: string;
}

type ArqMin = { name: string; size: number; type?: string };

/** Extensão em minúsculas, sem o ponto ("Foto.JPG" → "jpg"; sem extensão → ""). */
export function extensaoDe(nome: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(nome.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Primeiro problema do arquivo (ou null se pode subir). */
export function validarArquivo(a: ArqMin): string | null {
  const nome = a.name || "arquivo";
  if (!a.size) return `"${nome}" está vazio.`;
  if (EXT_BLOQUEADAS.has(extensaoDe(nome))) return `"${nome}" não pode ser anexado: programas e scripts (.${extensaoDe(nome)}) são bloqueados por segurança.`;
  if (a.size > LIMITE_ANEXO) return `"${nome}" tem ${tamanhoLegivel(a.size)} — o limite é 25 MB por arquivo.`;
  return null;
}

/** Separa os que podem subir dos recusados (com o motivo), respeitando o teto por vez. */
export function separarArquivos<T extends ArqMin>(lista: readonly T[], jaNaFila = 0): { ok: T[]; erros: string[] } {
  const ok: T[] = [];
  const erros: string[] = [];
  for (const a of lista) {
    const e = validarArquivo(a);
    if (e) { erros.push(e); continue; }
    if (jaNaFila + ok.length >= MAX_ANEXOS_POR_VEZ) { erros.push(`No máximo ${MAX_ANEXOS_POR_VEZ} arquivos por mensagem — "${a.name}" ficou de fora.`); continue; }
    ok.push(a);
  }
  return { ok, erros };
}

/** 532 B · 14 KB · 1,2 MB · 25 MB (vírgula, como no Brasil). */
export function tamanhoLegivel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${(mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)).toString().replace(".", ",")} MB`;
}

/** Encurta nomes compridos mantendo a extensão ("relatorio-muito-…-final.pdf"). */
export function nomeCurto(nome: string, max = 32): string {
  const n = nome.trim();
  if (n.length <= max) return n;
  const ext = extensaoDe(n);
  const corpo = ext ? n.slice(0, -(ext.length + 1)) : n;
  const sobra = Math.max(4, max - (ext ? ext.length + 2 : 1));
  return `${corpo.slice(0, sobra)}…${ext ? `.${ext}` : ""}`;
}

/** Extensão segura pro caminho no Storage (só letras/números; senão "bin"). */
function extDoCaminho(nome: string, mime?: string): string {
  const e = extensaoDe(nome);
  if (e && e.length <= 8) return e;
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

/**
 * Caminho do arquivo no bucket: "<pedido>/<carimbo>-<aleatório>.<ext>".
 * O nome original (com acento, espaço…) fica só na tabela — o caminho é ASCII.
 */
export function montarPath(solId: string, nome: string, opts: { agora?: number; aleatorio?: string; mime?: string } = {}): string {
  const agora = opts.agora ?? Date.now();
  const rnd = (opts.aleatorio ?? Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9]/gi, "").toLowerCase() || "x";
  return `${solId}/${agora}-${rnd}.${extDoCaminho(nome, opts.mime)}`;
}

/** Caminho da miniatura de uma foto ("…/123-abc.jpg" → "…/123-abc.mini.webp"). */
export function pathDaMiniatura(path: string): string {
  return path.replace(/\.[A-Za-z0-9]+$/, "") + ".mini.webp";
}

/** Nome pro print colado (Ctrl+V) que chega sem nome ou como "image.png". */
export function nomeDoPrint(mime: string, agora = Date.now()): string {
  const d = new Date(agora);
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "png";
  return `print-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export type TipoPrevia = "imagem" | "pdf" | "outro";
const EXT_IMAGEM = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"]);
/** Que prévia mostrar. HEIC conta como "outro" (o navegador não abre). */
export function tipoDePrevia(a: { nome: string; mime?: string | null }): TipoPrevia {
  const ext = extensaoDe(a.nome);
  const mime = (a.mime ?? "").toLowerCase();
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if ((mime.startsWith("image/") && !/hei[cf]/.test(mime)) || EXT_IMAGEM.has(ext)) return ext === "heic" || ext === "heif" ? "outro" : "imagem";
  return "outro";
}

/** Rótulo curto do formato pro ícone ("PDF", "XLSX", "DOC"…). */
export function rotuloDoFormato(nome: string): string {
  const e = extensaoDe(nome);
  return e ? e.slice(0, 4).toUpperCase() : "ARQ";
}

/** Texto da mensagem quando a pessoa só mandou arquivos (igual ao do qs_sol_anexar). */
export function textoAutomatico(nomes: readonly string[]): string {
  return nomes.length === 1 ? `anexou ${nomes[0]}` : `anexou ${nomes.length} arquivos: ${nomes.join(", ")}`;
}

/** Anexos de cada mensagem (evento_id → anexos), na ordem de envio. */
export function anexosPorEvento(lista: readonly AnexoSol[]): Map<number, AnexoSol[]> {
  const m = new Map<number, AnexoSol[]>();
  for (const a of [...lista].sort((x, y) => x.criado_em.localeCompare(y.criado_em))) {
    if (a.evento_id == null) continue;
    const l = m.get(a.evento_id);
    if (l) l.push(a); else m.set(a.evento_id, [a]);
  }
  return m;
}

/** Progresso total (0–100) pelo tamanho: o que já subiu + a fração do que está subindo. */
export function progressoTotal(itens: readonly { tamanho: number; estado: "fila" | "subindo" | "ok" | "erro"; fracao?: number }[]): number {
  const total = itens.reduce((n, i) => n + Math.max(i.tamanho, 1), 0);
  if (!total) return 0;
  const feito = itens.reduce((n, i) => n + Math.max(i.tamanho, 1) * (i.estado === "ok" || i.estado === "erro" ? 1 : i.estado === "subindo" ? Math.min(Math.max(i.fracao ?? 0, 0), 1) : 0), 0);
  return Math.round((feito / total) * 100);
}

/** Pode apagar? Quem enviou, ou gestor/admin (a RPC confere de novo). */
export function podeApagarAnexo(a: Pick<AnexoSol, "enviado_por">, eu: string, ehGestorDoPedido: boolean): boolean {
  return ehGestorDoPedido || (!!eu && a.enviado_por === eu);
}
