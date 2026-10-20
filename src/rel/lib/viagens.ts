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
  // 0148: o que foi vendido e quanto acompanhamento pede
  servico: Servico | null;
  acompanhamento: Acompanhamento;
  servico_manual: Servico | null;
}

// ── Serviço vendido × acompanhamento (0148, Bruno 20/10) ───────────────────
// Só vira "viagem" no painel o que precisa de acompanhamento. Seguro sozinho,
// concierge e conta liminar ficam só na ficha do cliente.

export type Servico = "expedicao" | "pacote" | "aereo" | "hospedagem" | "passeio" | "cruzeiro" | "seguro" | "concierge" | "conta_liminar" | "outro";
export type Acompanhamento = "expedicao" | "completo" | "leve" | "nenhum" | "classificar";

export const SERVICOS: Record<Servico, string> = {
  pacote: "Pacote",
  aereo: "Aéreo",
  hospedagem: "Hotel",
  passeio: "Passeio / transfer",
  cruzeiro: "Cruzeiro",
  expedicao: "Expedição",
  seguro: "Seguro viagem",
  concierge: "Concierge",
  conta_liminar: "Conta liminar",
  outro: "Outro (sem acompanhamento)",
};

/** Mesma regra do rel_acompanhamento() no banco — pra mostrar o efeito antes de salvar. */
export function acompanhamentoDe(s: Servico | null): Acompanhamento {
  if (s === "expedicao") return "expedicao";
  if (s === "pacote" || s === "aereo" || s === "cruzeiro") return "completo";
  if (s === "hospedagem" || s === "passeio") return "leve";
  if (s) return "nenhum";
  return "classificar";
}

export const ACOMPANHAMENTOS: Record<Acompanhamento, string> = {
  expedicao: "Expedição",
  completo: "Esteira completa",
  leve: "Revisão + D-3",
  nenhum: "Sem acompanhamento",
  classificar: "Falta classificar",
};

/** O que entra no painel, na lista de próximas e no calendário. */
export const COM_ACOMPANHAMENTO: Acompanhamento[] = ["expedicao", "completo", "leve"];

/** O time diz o que foi vendido (null = volta pro que o Bitrix disse). */
export async function classificarServico(id: string, servico: Servico | null, userId: string) {
  const { error } = await supabase.from("rel_viagens")
    .update({ servico_manual: servico, servico_por: servico ? userId || null : null, servico_em: servico ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export interface PendenciasViagens { semData: number; classificar: number }

/** As duas caixinhas do painel: o que falta pro time arrumar (não conta como viagem). */
export async function pendenciasViagens(): Promise<PendenciasViagens> {
  const [a, b] = await Promise.all([
    supabase.from("rel_viagens_v").select("id", { count: "exact", head: true })
      .eq("status", "ativa").eq("fase", "sem_data").in("acompanhamento", ["completo", "leve", "expedicao"]),
    supabase.from("rel_viagens_v").select("id", { count: "exact", head: true })
      .eq("status", "ativa").eq("acompanhamento", "classificar").in("fase", ["antes", "em_viagem", "sem_data"]),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return { semData: a.count ?? 0, classificar: b.count ?? 0 };
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

export type TipoDocumento = "passaporte" | "rg_cnh" | "visto" | "vacina" | "seguro" | "voucher" | "bilhete" | "contrato" | "comprovante" | "foto" | "outro";

export const TIPOS_DOC: Record<TipoDocumento, string> = {
  passaporte: "Passaporte",
  rg_cnh: "RG ou CNH",
  visto: "Visto",
  vacina: "Comprovante de vacina",
  seguro: "Seguro viagem",
  voucher: "Voucher (hotel, passeio)",
  bilhete: "Bilhete aéreo / passagem",
  contrato: "Contrato",
  comprovante: "Comprovante de pagamento",
  foto: "Foto / imagem",
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

export type FiltroViagens = "proximas" | "em_viagem" | "sem_data" | "classificar" | "concluidas" | "canceladas" | "todas";

/** Tira o que quebraria o filtro `or=(...)` do PostgREST. */
const limparBusca = (t: string) => t.replace(/[,()*%\\:"']/g, " ").trim();

export async function listarViagens(filtro: FiltroViagens, busca = ""): Promise<Viagem[]> {
  let q = supabase.from("rel_viagens_v").select("*").limit(500);
  // Próximas / Em viagem: só o que vai acontecer e pede acompanhamento (0148).
  // Sem data e sem classificação têm fila própria — não poluem a de trabalho.
  if (filtro === "proximas") q = q.eq("status", "ativa").eq("fase", "antes").in("acompanhamento", COM_ACOMPANHAMENTO).order("data_embarque", { ascending: true });
  else if (filtro === "em_viagem") q = q.eq("status", "ativa").eq("fase", "em_viagem").in("acompanhamento", COM_ACOMPANHAMENTO).order("data_retorno", { ascending: true });
  else if (filtro === "sem_data") q = q.eq("status", "ativa").eq("fase", "sem_data").in("acompanhamento", COM_ACOMPANHAMENTO).order("criado_em", { ascending: false });
  else if (filtro === "classificar") q = q.eq("status", "ativa").eq("acompanhamento", "classificar").in("fase", ["antes", "em_viagem", "sem_data"]).order("data_embarque", { ascending: true, nullsFirst: false });
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
    .map((u) => ({ id: u.id, name: u.name.replace(/\s*\|.*$/, "") })); // "Mariane | Relacionamento" é a assinatura do WhatsApp, não o nome
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
  // Fora daqui: "Arquivos e fotos" da ficha (foto/outro que o time subiu solto, sem pedido nem viagem).
  q = q.or("tipo.not.in.(foto,outro),enviado_por.neq.time,pedido_id.not.is.null,viagem_id.not.is.null");
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
  const { data, error } = await supabase.from("rel_alertas").select("*").order("data", { ascending: true }).limit(5000);
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

// ── Trechos (voos, trens, transfers) e check-in — migration 0106 ───────────

export type TipoTrecho = "voo_internacional" | "voo_interno" | "trem" | "transfer" | "hospedagem" | "passeio" | "outro";

export const TIPOS_TRECHO: Record<TipoTrecho, string> = {
  voo_internacional: "Voo internacional",
  voo_interno: "Voo interno",
  trem: "Trem",
  transfer: "Transfer",
  hospedagem: "Hospedagem",
  passeio: "Passeio",
  outro: "Outro",
};

export interface Trecho {
  id: string;
  viagem_id: string;
  tipo: TipoTrecho;
  descricao: string | null;
  origem: string | null;
  destino: string | null;
  partida_em: string;
  chegada_em: string | null;
  companhia: string | null;
  numero: string | null;
  localizador: string | null;
  checkin_abre_em: string | null;
  /** De onde veio o trecho (0115): manual, expedicoes, bitrix ou ia. */
  fonte?: "manual" | "expedicoes" | "bitrix" | "ia";
  /** Documento de onde a IA tirou o trecho (0115) — passeio sem ele = sem voucher. */
  documento_id?: string | null;
  checkin_feito_em: string | null;
  checkin_feito_por: string | null;
  // Tudo que está no bilhete/voucher (0139) — a IA preenche; dá pra editar à mão.
  origem_codigo?: string | null;
  destino_codigo?: string | null;
  /** Fuso do lugar (ex.: +09:00): mostra a hora LOCAL, a do bilhete. */
  partida_fuso?: string | null;
  chegada_fuso?: string | null;
  terminal_partida?: string | null;
  terminal_chegada?: string | null;
  classe?: string | null;
  bagagem?: string | null;
  assento?: string | null;
  numero_bilhete?: string | null;
  passageiros?: string[];
  /** Transfer/passeio: onde encontrar o motorista/guia. A hora da busca é a partida. */
  ponto_encontro?: string | null;
  contato?: string | null;
  endereco?: string | null;
  observacoes?: string | null;
  // da view rel_trechos_v
  checkin_em: string | null;
  viagem_tipo: TipoViagem;
  viagem_titulo: string;
  viagem_destino: string | null;
  expedicao: string | null;
  viagem_status: "ativa" | "cancelada";
}

/** "Hoje" no fuso do time (São Paulo), em AAAA-MM-DD — igual ao rel_hoje() do banco. */
export const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Expedição ou pacote — "aereo", "hospedagem" e "outro" contam como pacote (é o que não é expedição). */
export const grupoTipo = (t: TipoViagem): "expedicao" | "pacote" => (t === "expedicao" ? "expedicao" : "pacote");

/** Expedição ou pacote pelo SERVIÇO (0148): "Expedições 2027" marcada como "outro" no Bitrix vai pro quadro certo. */
export const grupoDe = (v: Pick<Viagem, "tipo" | "servico">): "expedicao" | "pacote" =>
  (v.servico ? (v.servico === "expedicao" ? "expedicao" : "pacote") : grupoTipo(v.tipo));

export type TrechoInput = Partial<Pick<Trecho,
  "tipo" | "descricao" | "origem" | "destino" | "partida_em" | "chegada_em" | "companhia" | "numero" | "localizador" | "checkin_abre_em"
  | "origem_codigo" | "destino_codigo" | "partida_fuso" | "chegada_fuso" | "terminal_partida" | "terminal_chegada" | "classe" | "bagagem"
  | "assento" | "numero_bilhete" | "passageiros" | "ponto_encontro" | "contato" | "endereco" | "observacoes">>;

/** Trechos de várias viagens (quadro de partidas: o voo de ida de cada pacote). */
export async function trechosDasViagens(ids: string[]): Promise<Trecho[]> {
  const out: Trecho[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from("rel_trechos_v").select("*").in("viagem_id", ids.slice(i, i + 150)).order("partida_em");
    if (error) throw error;
    out.push(...((data ?? []) as Trecho[]));
  }
  return out;
}

/** Hora LOCAL do lugar (a do bilhete) quando o fuso é conhecido; senão, a de Brasília. */
export function horaDoLugar(iso: string | null | undefined, fuso?: string | null, comAno = false): { texto: string; local: boolean } {
  if (!iso) return { texto: "", local: false };
  const d = new Date(iso);
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(fuso || ""));
  const p = (n: number) => String(n).padStart(2, "0");
  if (m) {
    const min = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    const l = new Date(d.getTime() + min * 60_000);
    return { texto: `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)}${comAno ? `/${String(l.getUTCFullYear()).slice(2)}` : ""} ${p(l.getUTCHours())}:${p(l.getUTCMinutes())}`, local: true };
  }
  return { texto: d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", ...(comAno ? { year: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }), local: false };
}

/** Quem vendeu e de onde/para onde, como está no card da venda no Bitrix. */
export async function resumoDaVenda(viagemId: string): Promise<{ closer: string | null; de: string | null; para: string | null }> {
  const { data } = await supabase.from("rel_viagens").select("bitrix_dados").eq("id", viagemId).maybeSingle();
  const b = (data?.bitrix_dados ?? {}) as Record<string, unknown>;
  const campo = (rotulo: string) => {
    const k = Object.keys(b).find((x) => x.startsWith(rotulo));
    const v = k ? b[k] : null;
    const t = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
    return t.trim() && t.trim() !== "-" ? t.trim() : null;
  };
  return { closer: campo("Vendedor ["), de: campo("Origem ["), para: campo("Destino [") };
}

export async function listarTrechos(viagemId: string): Promise<Trecho[]> {
  const { data, error } = await supabase.from("rel_trechos_v").select("*").eq("viagem_id", viagemId).order("partida_em");
  if (error) throw error;
  return (data ?? []) as Trecho[];
}

/** Trechos de viagens ativas com partida OU check-in dentro do período (ISO). */
export async function listarTrechosPeriodo(de: string, ate: string): Promise<Trecho[]> {
  const { data, error } = await supabase.from("rel_trechos_v").select("*")
    .eq("viagem_status", "ativa")
    .or(`and(partida_em.gte.${de},partida_em.lt.${ate}),and(checkin_em.gte.${de},checkin_em.lt.${ate})`)
    .order("partida_em").limit(1000);
  if (error) throw error;
  return (data ?? []) as Trecho[];
}

/** Próximos trechos (a partir de agora) — alimenta os cards do painel. */
export async function proximosTrechos(limite = 200): Promise<Trecho[]> {
  const agora = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data, error } = await supabase.from("rel_trechos_v").select("*")
    .eq("viagem_status", "ativa").gte("partida_em", agora).order("partida_em").limit(limite);
  if (error) throw error;
  return (data ?? []) as Trecho[];
}

export async function criarTrecho(viagemId: string, t: TrechoInput & { partida_em: string }) {
  const { error } = await supabase.from("rel_viagem_trechos").insert({ ...t, viagem_id: viagemId });
  if (error) throw new Error(/chegada_em/.test(error.message) ? "A chegada não pode ser antes da partida." : error.message);
}

export async function salvarTrecho(id: string, t: TrechoInput) {
  const { error } = await supabase.from("rel_viagem_trechos").update(t).eq("id", id);
  if (error) throw new Error(/chegada_em/.test(error.message) ? "A chegada não pode ser antes da partida." : error.message);
}

export async function apagarTrecho(id: string) {
  const { error } = await supabase.from("rel_viagem_trechos").delete().eq("id", id);
  if (error) throw error;
}

export async function marcarCheckin(id: string, feito: boolean, userId: string) {
  const { error } = await supabase.from("rel_viagem_trechos")
    .update(feito ? { checkin_feito_em: new Date().toISOString(), checkin_feito_por: userId || null } : { checkin_feito_em: null, checkin_feito_por: null })
    .eq("id", id);
  if (error) throw error;
}

// ── Revisão da viagem ("tudo conferido") ────────────────────────────────────

export interface Revisao { id: string; revisado_em: string | null; revisado_por: string | null; revisao_obs: string | null }

/** A view rel_viagens_v é anterior à 0106; a revisão vem direto da tabela. */
export async function revisoesDe(ids: string[]): Promise<Map<string, Revisao>> {
  const m = new Map<string, Revisao>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("rel_viagens").select("id, revisado_em, revisado_por, revisao_obs").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as Revisao[]) m.set(r.id, r);
  }
  return m;
}

export async function marcarRevisada(id: string, revisada: boolean, userId: string, obs?: string | null) {
  const { error } = await supabase.from("rel_viagens")
    .update(revisada
      ? { revisado_em: new Date().toISOString(), revisado_por: userId || null, revisao_obs: obs?.trim() || null }
      : { revisado_em: null, revisado_por: null, revisao_obs: null })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Viagens que VÃO acontecer ou estão acontecendo e pedem acompanhamento (0148).
 * Sem data, já voltou, arquivada, seguro sozinho… ficam fora — o painel é só o futuro.
 */
export async function viagensEmAndamento(): Promise<Viagem[]> {
  const { data, error } = await supabase.from("rel_viagens_v").select("*")
    .eq("status", "ativa").in("fase", ["antes", "em_viagem"]).in("acompanhamento", COM_ACOMPANHAMENTO)
    .order("data_embarque", { ascending: true, nullsFirst: false }).limit(1000);
  if (error) throw error;
  return (data ?? []) as Viagem[];
}

/** Viagens ativas que tocam o período [de, ate) — embarque ou volta dentro dele (datas AAAA-MM-DD). */
export async function viagensNoPeriodo(de: string, ate: string): Promise<Viagem[]> {
  const { data, error } = await supabase.from("rel_viagens_v").select("*")
    .eq("status", "ativa").in("acompanhamento", COM_ACOMPANHAMENTO)
    .or(`and(data_embarque.gte.${de},data_embarque.lt.${ate}),and(data_retorno.gte.${de},data_retorno.lt.${ate})`)
    .order("data_embarque").limit(1000);
  if (error) throw error;
  return (data ?? []) as Viagem[];
}
