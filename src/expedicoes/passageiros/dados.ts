// src/expedicoes/passageiros/dados.ts
// Leitura e escrita da aba Passageiros (app antigo: passageiros/page.tsx + as
// server actions de expedicoes/actions.ts, grupo-actions, extensoes/passeios,
// mudar-expedicao e /api/arquivos/*). O que era vários updates soltos virou RPC
// (migrações 0166/0167); arquivos sobem direto pro Storage (policies da 0161).
import { supabase, lerTudo, lerPorIds, erroOuDados, traduzirErro } from "../lib/banco";
import { avaliarProntidao, type ResultadoProntidao } from "../lib/prontidao/regras";
import { comprimirImagem } from "../lib/comprimir-imagem";
import { MAX_UPLOAD_BYTES, MIME_ARQUIVO_PERMITIDOS, CAPACIDADE_QUARTO } from "../lib/constants";
import type {
  ArquivoRow, CategoriaArquivo, ExpedicaoRow, GrupoExpedicaoRow, PassageiroRequisitoRow, PassageiroRow,
  QuartoRow, AlocacaoQuartoRow, StatusRequisito,
} from "../lib/database";

export type DadosAba = {
  pax: PassageiroRow[];
  requisitos: PassageiroRequisitoRow[];
  arquivos: ArquivoRow[];
  quartos: QuartoRow[];
  alocacoes: AlocacaoQuartoRow[];
  grupos: GrupoExpedicaoRow[];
  /** foto_arquivo_id → URL assinada (1h) */
  fotos: Record<string, string>;
};

export async function carregarAba(expId: string): Promise<DadosAba> {
  const [pax, arquivos, quartos, grupos] = await Promise.all([
    lerTudo<PassageiroRow>("passageiros", (q) => q.eq("expedicao_id", expId)),
    lerTudo<ArquivoRow>("arquivos", (q) => q.eq("expedicao_id", expId)),
    lerTudo<QuartoRow>("quartos", (q) => q.eq("expedicao_id", expId)),
    lerTudo<GrupoExpedicaoRow>("grupos_expedicao", (q) => q.eq("expedicao_id", expId)),
  ]);
  const ids = pax.map((p) => p.id);
  const [requisitos, alocacoes] = await Promise.all([
    lerPorIds<PassageiroRequisitoRow>("passageiro_requisitos", "passageiro_id", ids),
    lerPorIds<AlocacaoQuartoRow>("passageiro_quarto", "quarto_id", quartos.map((q) => q.id)),
  ]);
  // Arquivos referenciados que moram em outra expedição (passaporte/foto propagam entre reservas).
  const conhecidos = new Set(arquivos.map((a) => a.id));
  const faltando = [...new Set(pax.flatMap((p) => [p.foto_arquivo_id, p.passaporte_arquivo_id]).concat(requisitos.map((r) => r.arquivo_id))
    .filter((x): x is string => !!x && !conhecidos.has(x)))];
  if (faltando.length) arquivos.push(...(await lerPorIds<ArquivoRow>("arquivos", "id", faltando)));
  const fotos = await urlsAssinadas(arquivos.filter((a) => pax.some((p) => p.foto_arquivo_id === a.id)));
  return { pax, requisitos, arquivos, quartos, alocacoes, grupos: grupos.sort((a, b) => a.ordem - b.ordem), fotos };
}

async function urlsAssinadas(arqs: ArquivoRow[]): Promise<Record<string, string>> {
  if (!arqs.length) return {};
  const { data } = await supabase.storage.from("arquivos-expedicoes").createSignedUrls(arqs.map((a) => a.storage_path), 3600);
  const out: Record<string, string> = {};
  (data ?? []).forEach((d, i) => { if (d.signedUrl) out[arqs[i].id] = d.signedUrl; });
  return out;
}

export function prontidaoDe(exp: ExpedicaoRow, pax: PassageiroRow[], requisitos: PassageiroRequisitoRow[]) {
  const porPax = new Map<string, PassageiroRequisitoRow[]>();
  for (const r of requisitos) { const a = porPax.get(r.passageiro_id); if (a) a.push(r); else porPax.set(r.passageiro_id, [r]); }
  const out = new Map<string, ResultadoProntidao>();
  for (const p of pax) {
    if (p.status_reserva === "Cancelado") continue;
    out.set(p.id, avaliarProntidao({ passageiro: p, expedicao: exp, destino: exp.destino, requisitos: porPax.get(p.id) ?? [] }));
  }
  return { porPax, resultado: out };
}

/** Regra do app antigo (PassageirosTabela L790-799). */
export function preencheuFormulario(p: PassageiroRow): boolean {
  const pv = p.perfil_viajante;
  const temPerfil = !!pv && typeof pv === "object" && (
    pv.confirmou_veracidade === true ||
    [pv.profissao, pv.descricao_grupo, pv.anima_expedicao, pv.significado, pv.instagram, pv.camiseta, pv.musica]
      .some((v) => v && String(v).trim() !== "")
  );
  return temPerfil || p.inscricao_origem === "Formulário público";
}

// ── Quartos ─────────────────────────────────────────────────────────────────
export type Trecho = { chave: string; hotel: string; checkIn: string; quartos: QuartoRow[] };

/** Trechos de hospedagem = hotel + check-in + check-out (+ extensão), em ordem de check-in. */
export function trechosDe(quartos: QuartoRow[]): Trecho[] {
  const m = new Map<string, Trecho>();
  for (const q of quartos) {
    const chave = `${(q.hotel_cidade ?? "").trim()}|${(q.check_in ?? "").slice(0, 10)}|${(q.check_out ?? "").slice(0, 10)}|${q.extensao_id ?? ""}`;
    const t = m.get(chave) ?? { chave, hotel: (q.hotel_cidade ?? "").trim() || "Hotel", checkIn: (q.check_in ?? "").slice(0, 10), quartos: [] };
    t.quartos.push(q);
    m.set(chave, t);
  }
  const lista = [...m.values()].sort((a, b) => (a.checkIn || "9999").localeCompare(b.checkIn || "9999"));
  for (const t of lista) t.quartos.sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
  return lista;
}
export const capacidade = (tipo: string) => CAPACIDADE_QUARTO[tipo] ?? 1;

/** Põe o pax num quarto do trecho (tira dos outros quartos do MESMO trecho). Vazio = tira do trecho. */
export async function alocarNoTrecho(paxId: string, trecho: Trecho, quartoId: string | null) {
  const doTrecho = trecho.quartos.map((q) => q.id);
  const del = await supabase.from("passageiro_quarto").delete().eq("passageiro_id", paxId).in("quarto_id", doTrecho);
  if (del.error) throw new Error(traduzirErro(del.error.message));
  if (quartoId) erroOuDados(await supabase.from("passageiro_quarto").insert({ passageiro_id: paxId, quarto_id: quartoId }));
}

// ── Escrita (RPCs da 0166/0167) ─────────────────────────────────────────────
async function rpc<T = unknown>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw new Error(traduzirErro(error.message));
  return data as T;
}

/** Salva campos do passageiro; os PESSOAIS vão pra todas as reservas da pessoa. */
export const atualizarPassageiro = (id: string, patch: Partial<PassageiroRow>) => rpc("exp_atualizar_passageiro", { p_id: id, p_patch: patch });
export const adicionarExistente = (expId: string, refId: string) => rpc<string>("exp_adicionar_existente", { p_expedicao: expId, p_ref: refId });
export const importarPassageiros = (expId: string, linhas: unknown[]) =>
  rpc<{ inseridos: number; ignorados: number }>("exp_importar_passageiros", { p_expedicao: expId, p_linhas: linhas });
export const moverPassageiro = (paxId: string, novaExp: string) => rpc("exp_mover_passageiro", { p_pax: paxId, p_nova: novaExp });
export const removerPassageiro = (paxId: string) => rpc<"apagado" | "avulso">("exp_remover_passageiro", { p_pax: paxId });
export const gerarRequisitos = (expId: string) => rpc<number>("exp_gerar_requisitos", { p_expedicao: expId });
export const espalharVacina = (cpf: string | null, cert: string | null) => rpc<number>("exp_espalhar_vacina", { p_cpf: cpf ?? "", p_cert: cert });
// G1/G2: usa as funções da aba Divisões (src/expedicoes/divisoes/dados.ts — migração 0169).
export { ativarDivisao, removerDivisao, definirGrupoDoPax, souAdmin, usaDivisao } from "../divisoes/dados";

export async function criarPassageiro(row: Partial<PassageiroRow> & { expedicao_id: string; nome_completo: string }): Promise<string> {
  const { data, error } = await supabase.from("passageiros").insert(row).select("id").single();
  if (error) {
    if (/ux_passageiros_expedicao_cpf/.test(error.message)) throw new Error("Já existe um passageiro com este CPF nesta expedição.");
    throw new Error(traduzirErro(error.message));
  }
  return (data as { id: string }).id;
}

/** Atualiza um requisito de uma vez (o antigo mandava 1 campo por chamada). */
export async function salvarRequisito(id: string, patch: Partial<PassageiroRequisitoRow>) {
  const final: Partial<PassageiroRequisitoRow> = { ...patch };
  if (patch.status && (["Aprovado", "Reprovado", "Dispensado"] as StatusRequisito[]).includes(patch.status)) final.verificado_em = new Date().toISOString();
  erroOuDados(await supabase.from("passageiro_requisitos").update(final).eq("id", id));
}

/** Cria a instância de um requisito do catálogo sob demanda (o trigger normalmente já criou). */
export async function criarInstancia(paxId: string, tpl: { tipo: string; descricao: string; obrigatoriedade: string; bloqueia_embarque: boolean; observacoes?: string | null }): Promise<PassageiroRequisitoRow> {
  const { data: ja } = await supabase.from("passageiro_requisitos").select("*").eq("passageiro_id", paxId).eq("tipo", tpl.tipo).maybeSingle();
  if (ja) return ja as PassageiroRequisitoRow;
  return erroOuDados(await supabase.from("passageiro_requisitos").insert({
    passageiro_id: paxId, tipo: tpl.tipo, descricao: tpl.descricao, status: "Pendente",
    obrigatoriedade: tpl.obrigatoriedade, bloqueia_embarque: tpl.bloqueia_embarque, observacoes: tpl.observacoes ?? null,
  }).select("*").single()) as PassageiroRequisitoRow;
}

// ── Arquivos (antes /api/arquivos/*) ────────────────────────────────────────
function nomeSeguro(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/** Sobe um arquivo do passageiro (imagem é comprimida) e cria a linha em `arquivos`. Devolve o id. */
export async function enviarArquivo(f: File, o: { expedicaoId: string; passageiroId: string; categoria: CategoriaArquivo; descricao?: string }): Promise<ArquivoRow> {
  const file = await comprimirImagem(f);
  if (file.size === 0) throw new Error("Arquivo vazio.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Arquivo maior que 15 MB.");
  if (file.type && !(MIME_ARQUIVO_PERMITIDOS as readonly string[]).includes(file.type)) throw new Error("Tipo de arquivo não aceito (use PDF, imagem ou Office).");
  const path = `${o.expedicaoId}/passageiros/${o.passageiroId}/${nomeSeguro(o.categoria)}/${crypto.randomUUID()}-${nomeSeguro(f.name)}`;
  const up = await supabase.storage.from("arquivos-expedicoes").upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw new Error(traduzirErro(up.error.message));
  const { data, error } = await supabase.from("arquivos").insert({
    expedicao_id: o.expedicaoId, passageiro_id: o.passageiroId, categoria: o.categoria, nome: f.name,
    descricao: o.descricao ?? null, mime: file.type || null, tamanho_bytes: file.size, storage_path: path,
  }).select("*").single();
  if (error) {
    await supabase.storage.from("arquivos-expedicoes").remove([path]);
    throw new Error(traduzirErro(error.message));
  }
  return data as ArquivoRow;
}

export async function apagarArquivo(a: ArquivoRow) {
  erroOuDados(await supabase.from("arquivos").delete().eq("id", a.id));
  await supabase.storage.from("arquivos-expedicoes").remove([a.storage_path]);
}

export async function urlArquivo(a: ArquivoRow, baixar = false): Promise<string> {
  const { data, error } = await supabase.storage.from("arquivos-expedicoes").createSignedUrl(a.storage_path, 300, baixar ? { download: a.nome } : undefined);
  if (error || !data) throw new Error(error?.message ?? "Não foi possível abrir o arquivo.");
  return data.signedUrl;
}

export async function arquivoPorId(id: string): Promise<ArquivoRow | null> {
  return erroOuDados(await supabase.from("arquivos").select("*").eq("id", id).maybeSingle()) as ArquivoRow | null;
}

// ── Extensões e passeios opcionais ──────────────────────────────────────────
export type ItemCompra = { id: string; titulo: string; detalhe: string | null; marcado: boolean };

export async function extensoesDoPax(expId: string, paxId: string): Promise<ItemCompra[]> {
  const [ext, marc] = await Promise.all([
    lerTudo<{ id: string; nome: string; descricao: string | null }>("extensoes", (q) => q.eq("expedicao_id", expId), "id, nome, descricao"),
    lerTudo<{ extensao_id: string }>("passageiro_extensao", (q) => q.eq("passageiro_id", paxId), "id, extensao_id"),
  ]);
  const set = new Set(marc.map((m) => m.extensao_id));
  return ext.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((e) => ({ id: e.id, titulo: e.nome, detalhe: e.descricao, marcado: set.has(e.id) }));
}

export async function marcarExtensao(paxId: string, extId: string, marcar: boolean) {
  if (marcar) erroOuDados(await supabase.from("passageiro_extensao").upsert({ passageiro_id: paxId, extensao_id: extId }, { onConflict: "passageiro_id,extensao_id", ignoreDuplicates: true }));
  else erroOuDados(await supabase.from("passageiro_extensao").delete().eq("passageiro_id", paxId).eq("extensao_id", extId));
}

export async function passeiosDoPax(expId: string, paxId: string): Promise<ItemCompra[]> {
  const [ps, dias, comp] = await Promise.all([
    lerTudo<{ id: string; titulo: string | null; roteiro_dia_id: string }>("passeios_opcionais", (q) => q.eq("expedicao_id", expId), "id, titulo, roteiro_dia_id"),
    lerTudo<{ id: string; dia: number; titulo: string | null }>("roteiro_dias", (q) => q.eq("expedicao_id", expId), "id, dia, titulo"),
    lerTudo<{ passeio_opcional_id: string }>("passeio_opcional_compras", (q) => q.eq("passageiro_id", paxId), "id, passeio_opcional_id"),
  ]);
  const dia = new Map(dias.map((d) => [d.id, d]));
  const set = new Set(comp.map((c) => c.passeio_opcional_id));
  return ps
    .map((p) => ({ p, d: dia.get(p.roteiro_dia_id) }))
    .sort((a, b) => (a.d?.dia ?? 0) - (b.d?.dia ?? 0) || (a.p.titulo ?? "").localeCompare(b.p.titulo ?? "", "pt-BR"))
    .map(({ p, d }) => ({ id: p.id, titulo: p.titulo || "Passeio opcional", detalhe: d ? `Dia ${d.dia}${d.titulo ? ` · ${d.titulo}` : ""}` : null, marcado: set.has(p.id) }));
}

export async function marcarPasseio(paxId: string, passeioId: string, marcar: boolean) {
  if (marcar) erroOuDados(await supabase.from("passeio_opcional_compras").upsert({ passageiro_id: paxId, passeio_opcional_id: passeioId }, { onConflict: "passageiro_id,passeio_opcional_id", ignoreDuplicates: true }));
  else erroOuDados(await supabase.from("passeio_opcional_compras").delete().eq("passageiro_id", paxId).eq("passeio_opcional_id", passeioId));
}

// ── Integrações (rota /api/expedicoes do QS) ────────────────────────────────

/** POST /api/expedicoes?acao=… com o token da sessão. Devolve o JSON ou lança o erro em português. */
export async function chamarRotaExpedicoes<T = Record<string, unknown>>(acao: string, corpo: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const res = await fetch(`/api/expedicoes?acao=${encodeURIComponent(acao)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(corpo),
  });
  let json: (T & { ok?: boolean; error?: string }) | null = null;
  try { json = await res.json(); } catch { /* resposta vazia */ }
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Falha (${res.status})`);
  return json;
}

export type ResultadoSyncBitrix = {
  coluna: string; negocios: number; criados: number; atualizados: number; limite?: boolean;
  sem_grupo: { deal: string; nome: string }[]; erros: { deal: string; erro: string }[];
};

/**
 * "Atualizar do Bitrix" (app antigo: bitrix-sync-actions.ts, que passava pelo n8n).
 * Agora o servidor do QS fala direto com o Bitrix: puxa os negócios da coluna desta
 * expedição e já devolve quantos passageiros criou/atualizou.
 */
export const sincronizarDoBitrix = (expId: string) =>
  chamarRotaExpedicoes<ResultadoSyncBitrix>("sincronizar-bitrix", { expedicao_id: expId });

/** Frase curta pro aviso da tela. */
export function resumoSyncBitrix(r: ResultadoSyncBitrix): string {
  const partes = [`${r.negocios} negócio(s) na coluna do Bitrix`, `${r.criados} novo(s)`, `${r.atualizados} conferido(s)`];
  if (r.sem_grupo?.length) {
    const nomes = r.sem_grupo.slice(0, 5).map((x) => x.nome || x.deal).join(", ");
    partes.push(`${r.sem_grupo.length} sem grupo definido (a coluna é de mais de uma expedição — adicione pela tela): ${nomes}${r.sem_grupo.length > 5 ? "…" : ""}`);
  }
  if (r.erros?.length) partes.push(`${r.erros.length} com erro`);
  if (r.limite) partes.push("parou em 500 negócios");
  return partes.join(" · ");
}
