// src/rel/lib/viagens.ts
// -----------------------------------------------------------------------------
// Viagens, jornada e documentos do Relacionamento (Fase 3 — migration 0103).
//
// Ler e editar vai direto no banco (RLS: rel_tem_acesso). Sincronizar com o
// Bitrix passa pelo servidor (/api/rel-viagens), que tem a chave do Bitrix.
// Documentos ficam no bucket PRIVADO `rel-documentos`: o time sobe direto
// pelo supabase-js e abre por link assinado de poucos minutos.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type TipoViagem = "expedicao" | "pacote" | "aereo" | "hospedagem" | "outro";
export type FaseViagem = "antes" | "em_viagem" | "concluida" | "cancelada" | "sem_data";

export const TIPOS_VIAGEM: Record<TipoViagem, string> = {
  expedicao: "Expedição",
  pacote: "Pacote",
  aereo: "Aéreo",
  hospedagem: "Hospedagem",
  outro: "Outro",
};

export const FASES: Record<FaseViagem, string> = {
  antes: "Antes do embarque",
  em_viagem: "Em viagem",
  concluida: "Concluída",
  cancelada: "Cancelada",
  sem_data: "Sem data",
};

export interface Viagem {
  id: string;
  titulo: string;
  destino: string | null;
  expedicao: string | null;
  tipo: TipoViagem;
  data_venda: string | null;
  data_embarque: string | null;
  data_retorno: string | null;
  valor: number | null;
  qtd_passageiros: number | null;
  cliente_id: string | null;
  responsavel_id: string | null;
  bitrix_deal_id: string | null;
  status: "ativa" | "cancelada";
  observacoes: string | null;
  necessidades: string | null;
  origem: "bitrix" | "manual";
  criado_em: string;
  atualizado_em: string;
  // da view rel_viagens_v
  cliente_nome: string | null;
  cliente_telefone: string | null;
  responsavel_nome: string | null;
  fase: FaseViagem;
  dias_para_embarque: number | null;
  passageiros: number;
  tarefas_atrasadas: number;
  tarefas_pendentes: number;
  tarefas_total: number;
}

export interface Passageiro {
  id: string;
  viagem_id: string;
  cliente_id: string;
  bitrix_deal_id: string | null;
  cliente: { id: string; nome: string; telefone: string | null; passaporte: string | null; passaporte_validade: string | null; nascimento: string | null } | null;
}

export interface Tarefa {
  id: string;
  viagem_id: string;
  titulo: string;
  descricao: string | null;
  referencia: "venda" | "embarque" | "retorno" | "manual";
  dias: number | null;
  prazo: string | null;
  ordem: number;
  feita_em: string | null;
  feita_por: string | null;
}

export type TipoDocumento = "passaporte" | "rg_cnh" | "visto" | "vacina" | "seguro" | "voucher" | "contrato" | "comprovante" | "outro";

export const TIPOS_DOC: Record<TipoDocumento, string> = {
  passaporte: "Passaporte",
  rg_cnh: "RG ou CNH",
  visto: "Visto",
  vacina: "Comprovante de vacina",
  seguro: "Seguro viagem",
  voucher: "Voucher / bilhete",
  contrato: "Contrato",
  comprovante: "Comprovante de pagamento",
  outro: "Outro",
};

export interface Documento {
  id: string;
  cliente_id: string;
  viagem_id: string | null;
  pedido_id: string | null;
  tipo: TipoDocumento;
  descricao: string | null;
  arquivo_path: string;
  arquivo_nome: string | null;
  mime: string | null;
  tamanho: number | null;
  validade: string | null;
  status: "recebido" | "aprovado" | "recusado";
  motivo_recusa: string | null;
  enviado_por: "cliente" | "time";
  enviado_em: string;
  revisado_em: string | null;
}

export interface PedidoDocs {
  id: string;
  token: string;
  cliente_id: string;
  viagem_id: string | null;
  tipos: TipoDocumento[];
  mensagem: string | null;
  expira_em: string;
  criado_em: string;
  concluido_em: string | null;
}

export interface Alerta {
  tipo: "passaporte" | "sem_passaporte" | "tarefa" | "documentos" | "chamado" | "aniversario" | "embarque";
  gravidade: "alta" | "media" | "baixa";
  cliente_id: string | null;
  viagem_id: string | null;
  titulo: string;
  detalhe: string | null;
  data: string | null;
}

// ── Formatação ──────────────────────────────────────────────────────────────

export function dataBR(v: string | null | undefined): string {
  if (!v) return "";
  const [a, m, d] = v.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : v;
}

export function periodo(v: Pick<Viagem, "data_embarque" | "data_retorno">): string {
  if (!v.data_embarque) return "sem data";
  if (!v.data_retorno || v.data_retorno === v.data_embarque) return dataBR(v.data_embarque);
  return `${dataBR(v.data_embarque)} a ${dataBR(v.data_retorno)}`;
}

/** "embarca em 12 dias" / "embarca amanhã" / "em viagem" / "voltou". */
export function quandoEmbarca(v: Pick<Viagem, "fase" | "dias_para_embarque">): string {
  if (v.fase === "cancelada") return "cancelada";
  if (v.fase === "em_viagem") return "em viagem agora";
  if (v.fase === "concluida") return "já voltou";
  if (v.dias_para_embarque == null) return "sem data de embarque";
  if (v.dias_para_embarque === 0) return "embarca hoje";
  if (v.dias_para_embarque === 1) return "embarca amanhã";
  return `embarca em ${v.dias_para_embarque} dias`;
}

export const linkBitrix = (dealId: string) => `https://agenciasetuforeuvou.bitrix24.com.br/crm/deal/details/${dealId}/`;
export const linkDocumentos = (token: string) => `${window.location.origin}/documentos/${token}`;

export function tamanhoLegivel(b: number | null | undefined): string {
  if (!b) return "";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ── Viagens ─────────────────────────────────────────────────────────────────

export type FiltroViagens = "proximas" | "em_viagem" | "concluidas" | "canceladas" | "todas";

/** Tira o que quebraria o filtro `or=(...)` do PostgREST. */
const limparBusca = (t: string) => t.replace(/[,()*%\\:"']/g, " ").trim();

export async function listarViagens(filtro: FiltroViagens, busca = ""): Promise<Viagem[]> {
  let q = supabase.from("rel_viagens_v").select("*").limit(500);
  if (filtro === "proximas") q = q.in("fase", ["antes", "sem_data"]).order("data_embarque", { ascending: true, nullsFirst: false });
  else if (filtro === "em_viagem") q = q.eq("fase", "em_viagem").order("data_retorno", { ascending: true });
  else if (filtro === "concluidas") q = q.eq("fase", "concluida").order("data_retorno", { ascending: false });
  else if (filtro === "canceladas") q = q.eq("fase", "cancelada").order("atualizado_em", { ascending: false });
  else q = q.order("data_embarque", { ascending: false, nullsFirst: false });
  const t = limparBusca(busca);
  if (t) q = q.or(`titulo.ilike.*${t}*,destino.ilike.*${t}*,expedicao.ilike.*${t}*,cliente_nome.ilike.*${t}*,bitrix_deal_id.eq.${t.replace(/\D/g, "") || "0"}`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Viagem[];
}

export async function carregarViagem(id: string): Promise<Viagem | null> {
  const { data, error } = await supabase.from("rel_viagens_v").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Viagem | null;
}

/** Viagens em que o cliente é passageiro (o comprador também é). */
export async function viagensDoCliente(clienteId: string): Promise<Viagem[]> {
  const { data: ps } = await supabase.from("rel_viagem_passageiros").select("viagem_id").eq("cliente_id", clienteId);
  const ids = [...new Set((ps ?? []).map((p: { viagem_id: string }) => p.viagem_id))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from("rel_viagens_v").select("*").in("id", ids).order("data_embarque", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Viagem[];
}

export type ViagemInput = Partial<Pick<Viagem,
  "titulo" | "destino" | "expedicao" | "tipo" | "data_venda" | "data_embarque" | "data_retorno" | "valor" |
  "qtd_passageiros" | "cliente_id" | "responsavel_id" | "status" | "observacoes" | "necessidades">>;

function erroLegivel(msg: string): string {
  if (/data_retorno.*data_embarque|check constraint/i.test(msg)) return "A volta não pode ser antes da ida.";
  if (/row-level|permission/i.test(msg)) return "Sem permissão para mudar isso.";
  return msg;
}

export async function criarViagem(v: ViagemInput & { titulo: string }): Promise<string> {
  const { data, error } = await supabase.from("rel_viagens").insert({ ...v, origem: "manual" }).select("id").single();
  if (error) throw new Error(erroLegivel(error.message));
  return (data as { id: string }).id;
}

export async function salvarViagem(id: string, v: ViagemInput) {
  const { error } = await supabase.from("rel_viagens").update(v).eq("id", id);
  if (error) throw new Error(erroLegivel(error.message));
}

/** Gestão de usuários com acesso ao Relacionamento (pra escolher o responsável). */
export async function listarEquipeRel(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("qs_users").select("id, name, role, setores, is_active").eq("is_active", true).order("name");
  return ((data ?? []) as { id: string; name: string; role: string; setores: string[] | null }[])
    .filter((u) => u.role === "admin" || u.role === "relacionamento" || (u.setores ?? []).includes("relacionamento"))
    .map((u) => ({ id: u.id, name: u.name }));
}

// ── Passageiros ─────────────────────────────────────────────────────────────

export async function listarPassageiros(viagemId: string): Promise<Passageiro[]> {
  const { data, error } = await supabase
    .from("rel_viagem_passageiros")
    .select("id, viagem_id, cliente_id, bitrix_deal_id, cliente:rel_clientes(id, nome, telefone, passaporte, passaporte_validade, nascimento)")
    .eq("viagem_id", viagemId);
  if (error) throw error;
  return ((data ?? []) as unknown as Passageiro[]).sort((a, b) => (a.cliente?.nome || "").localeCompare(b.cliente?.nome || ""));
}

export async function adicionarPassageiro(viagemId: string, clienteId: string) {
  const { error } = await supabase.from("rel_viagem_passageiros").insert({ viagem_id: viagemId, cliente_id: clienteId });
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function removerPassageiro(id: string) {
  const { error } = await supabase.from("rel_viagem_passageiros").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Jornada ─────────────────────────────────────────────────────────────────

export async function listarTarefas(viagemId: string): Promise<Tarefa[]> {
  const { data, error } = await supabase
    .from("rel_viagem_tarefas").select("*").eq("viagem_id", viagemId)
    .order("prazo", { ascending: true, nullsFirst: false }).order("ordem");
  if (error) throw error;
  return (data ?? []) as Tarefa[];
}

export async function marcarTarefa(id: string, feita: boolean, userId: string) {
  const { error } = await supabase.from("rel_viagem_tarefas")
    .update(feita ? { feita_em: new Date().toISOString(), feita_por: userId } : { feita_em: null, feita_por: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function criarTarefa(viagemId: string, titulo: string, prazo: string | null, descricao?: string) {
  const { error } = await supabase.from("rel_viagem_tarefas").insert({
    viagem_id: viagemId, titulo, prazo: prazo || null, descricao: descricao || null, referencia: "manual", ordem: 100,
  });
  if (error) throw new Error(error.message);
}

export async function apagarTarefa(id: string) {
  const { error } = await supabase.from("rel_viagem_tarefas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Refaz as tarefas automáticas pendentes a partir do modelo (rel_config.jornada). */
export async function refazerJornada(viagemId: string) {
  const { error } = await supabase.rpc("rel_gerar_jornada", { p_viagem: viagemId });
  if (error) throw new Error(error.message);
}

// ── Documentos ──────────────────────────────────────────────────────────────

export async function listarDocumentos(filtro: { clienteId?: string; viagemId?: string }): Promise<Documento[]> {
  let q = supabase.from("rel_documentos").select("*").order("enviado_em", { ascending: false });
  if (filtro.clienteId) q = q.eq("cliente_id", filtro.clienteId);
  if (filtro.viagemId) q = q.eq("viagem_id", filtro.viagemId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Documento[];
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };

/** O time sobe um documento direto no bucket (a policy confere o acesso). */
export async function subirDocumento(p: { clienteId: string; viagemId?: string | null; tipo: TipoDocumento; arquivo: File; validade?: string | null; descricao?: string | null }) {
  if (p.arquivo.size > 20 * 1024 * 1024) throw new Error("Arquivo maior que 20 MB.");
  const ext = EXT[p.arquivo.type] || (p.arquivo.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  const path = `${p.clienteId}/${Date.now()}-${p.tipo}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await supabase.storage.from("rel-documentos").upload(path, p.arquivo, { contentType: p.arquivo.type || undefined, upsert: false });
  if (up.error) throw new Error(`Não subiu: ${up.error.message}`);
  const { error } = await supabase.from("rel_documentos").insert({
    cliente_id: p.clienteId, viagem_id: p.viagemId || null, tipo: p.tipo,
    arquivo_path: path, arquivo_nome: p.arquivo.name.slice(0, 160), mime: p.arquivo.type || null, tamanho: p.arquivo.size,
    validade: p.validade || null, descricao: p.descricao || null, enviado_por: "time", status: "aprovado",
  });
  if (error) {
    await supabase.storage.from("rel-documentos").remove([path]); // não deixa arquivo órfão
    throw new Error(error.message);
  }
}

/** Link de 5 minutos pra abrir o arquivo (o bucket é privado). */
export async function abrirDocumento(d: Documento): Promise<string> {
  const { data, error } = await supabase.storage.from("rel-documentos").createSignedUrl(d.arquivo_path, 300);
  if (error || !data?.signedUrl) throw new Error("Não consegui abrir o arquivo.");
  return data.signedUrl;
}

export async function revisarDocumento(id: string, status: "aprovado" | "recusado", userId: string, motivo?: string) {
  const { error } = await supabase.from("rel_documentos").update({
    status, motivo_recusa: status === "recusado" ? motivo || null : null, revisado_por: userId, revisado_em: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function atualizarValidade(id: string, validade: string | null) {
  const { error } = await supabase.from("rel_documentos").update({ validade }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function apagarDocumento(d: Documento) {
  const { error } = await supabase.from("rel_documentos").delete().eq("id", d.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from("rel-documentos").remove([d.arquivo_path]);
}

// ── Link de documentos ──────────────────────────────────────────────────────

export async function criarPedidoDocs(p: { clienteId: string; viagemId?: string | null; tipos: TipoDocumento[]; mensagem?: string | null }): Promise<PedidoDocs> {
  const { data, error } = await supabase.from("rel_doc_pedidos").insert({
    cliente_id: p.clienteId, viagem_id: p.viagemId || null, tipos: p.tipos, mensagem: p.mensagem || null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as PedidoDocs;
}

export async function listarPedidosDocs(filtro: { clienteId?: string; viagemId?: string }): Promise<PedidoDocs[]> {
  let q = supabase.from("rel_doc_pedidos").select("*").order("criado_em", { ascending: false }).limit(20);
  if (filtro.clienteId) q = q.eq("cliente_id", filtro.clienteId);
  if (filtro.viagemId) q = q.eq("viagem_id", filtro.viagemId);
  const { data } = await q;
  return (data ?? []) as PedidoDocs[];
}

// ── Alertas ─────────────────────────────────────────────────────────────────

export async function listarAlertas(): Promise<Alerta[]> {
  const { data, error } = await supabase.from("rel_alertas").select("*").order("data", { ascending: true }).limit(500);
  if (error) throw error;
  return (data ?? []) as Alerta[];
}

// ── Bitrix (servidor) ───────────────────────────────────────────────────────

export interface ResultadoSync { lidos: number; criados: number; atualizados: number; cancelados: number; passageiros: number; erros: number; completo: boolean; viagemId?: string | null }

async function apiViagens(corpo: Record<string, unknown>): Promise<ResultadoSync> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/rel-viagens", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as ResultadoSync;
}

export const sincronizarBitrix = () => apiViagens({ acao: "sincronizar" });
export const importarDoBitrix = (dealId: string) => apiViagens({ acao: "importar", dealId });

// ── Página pública (sem login) ──────────────────────────────────────────────

export interface PedidoPublico {
  nome: string | null;
  tipos: TipoDocumento[];
  mensagem: string | null;
  expirado: boolean;
  concluido: boolean;
  enviados: { tipo: TipoDocumento; arquivo_nome: string | null; status: string }[];
}

async function apiDocs<T>(metodo: "GET" | "POST", token: string, corpo?: Record<string, unknown>): Promise<T> {
  const r = await fetch(metodo === "GET" ? `/api/rel-docs?token=${encodeURIComponent(token)}` : "/api/rel-docs", {
    method: metodo,
    headers: metodo === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: metodo === "POST" ? JSON.stringify({ token, ...corpo }) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export const lerPedidoPublico = (token: string) => apiDocs<PedidoPublico>("GET", token);

/** Sobe um arquivo pelo link público: pede o endereço assinado, envia, confirma. */
export async function enviarPeloLink(token: string, tipo: TipoDocumento, arquivo: File | Blob, nome: string, validade?: string | null) {
  const mime = arquivo.type || "application/octet-stream";
  const { path, url } = await apiDocs<{ path: string; url: string }>("POST", token, { acao: "url", tipo, nome, mime, tamanho: arquivo.size });
  const put = await fetch(url, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" }, body: arquivo });
  if (!put.ok) throw new Error("O arquivo não subiu. Confira sua internet e tente de novo.");
  await apiDocs("POST", token, { acao: "confirmar", tipo, path, nome, mime, tamanho: arquivo.size, validade: validade || null });
}

export const concluirPeloLink = (token: string) => apiDocs("POST", token, { acao: "concluir" });
