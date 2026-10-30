// src/lib/qs/disparos.ts
// -----------------------------------------------------------------------------
// DISPARO EM MASSA (0217) — o lado da tela, pro Comercial e pro Relacionamento.
//
// Ler (campanhas, envios) vai direto no banco: a RLS da 0217 só mostra o que o
// cargo pode ver. Tudo que ESCREVE passa por /api/disparos (service_role),
// que confere permissão, monta o público e guarda a fila.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

// "marketing" (0242): pelo número NOVO do Marketing — telas em src/mkt/disparos/.
export type SetorDisparo = "comercial" | "relacionamento" | "marketing";

// ── Variáveis do modelo ─────────────────────────────────────────────────────

export type Fonte = "nome" | "sdr" | "destino" | "link_grupo" | "texto" | "campo";
export type MapaVariaveis = Record<string, { fonte: Fonte; valor?: string }>;

export const FONTES: { id: Fonte; rotulo: string; dica: string; setores: SetorDisparo[] }[] = [
  { id: "nome", rotulo: "Primeiro nome da pessoa", dica: "Maria", setores: ["comercial", "relacionamento", "marketing"] },
  { id: "sdr", rotulo: "Primeiro nome do SDR dono", dica: "Victor", setores: ["comercial"] },
  { id: "destino", rotulo: "Destino (da fonte do lead ou da última viagem)", dica: "Japão", setores: ["comercial", "relacionamento", "marketing"] },
  { id: "link_grupo", rotulo: "Link do grupo da expedição", dica: "https://chat.whatsapp.com/…", setores: ["relacionamento"] },
  { id: "texto", rotulo: "Texto fixo", dica: "o que você escrever", setores: ["comercial", "relacionamento", "marketing"] },
  { id: "campo", rotulo: "Campo do contato (coluna do CSV)", dica: "valor do campo", setores: ["marketing"] },
];

export const variaveisDoCorpo = (corpo: string) =>
  [...new Set([...corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]))];

export function preverTexto(corpo: string, mapa: MapaVariaveis, grupoLink?: string) {
  return corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, k: string) => {
    const c = mapa[k];
    if (!c) return `[${k}]`;
    if (c.fonte === "texto") return c.valor || `[${k}]`;
    if (c.fonte === "link_grupo") return grupoLink || "https://chat.whatsapp.com/…";
    if (c.fonte === "campo") return c.valor ? `[${c.valor}]` : `[${k}]`;
    return FONTES.find((f) => f.id === c.fonte)?.dica ?? `[${k}]`;
  });
}

// ── Modelos (qs_settings.disparo_modelos) ───────────────────────────────────

export type StatusModelo = "rascunho" | "enviado" | "aprovado" | "recusado";
export interface ModeloDisparo {
  nome: string;
  idioma: string;
  categoria: "MARKETING" | "UTILITY";
  corpo: string;
  cabecalho?: string | null;
  rodape?: string | null;
  exemplos?: Record<string, string>;
  botaoParar?: boolean;
  status: StatusModelo;
  setor?: SetorDisparo;
  atualizado_em?: string;
  atualizado_por?: string;
}

export const ROTULO_STATUS_MODELO: Record<StatusModelo, string> = {
  rascunho: "rascunho", enviado: "na análise da Meta", aprovado: "aprovado", recusado: "recusado",
};

// ── Público ─────────────────────────────────────────────────────────────────

export interface PublicoComercial {
  segmentos?: string[];
  sdrs?: string[];
  status?: string[];
  cadencias?: string[];
  entrada_de?: string;
  entrada_ate?: string;
  tags?: string[];
  respondeu?: "" | "sim" | "nao";
}
export interface PublicoRel {
  expedicao?: string;
  destino?: string;
  retorno_de?: string;
  retorno_ate?: string;
  sem_viagem_futura?: boolean;
  niveis?: string[];
  viajou?: "" | "sim" | "nao";
}
export type Publico = PublicoComercial & PublicoRel;

export const NIVEIS = ["Estreante", "Viajante", "Explorador", "Aventureiro", "Lenda"];
export const STATUS_LEAD: { id: string; rotulo: string }[] = [
  { id: "nao_iniciado", rotulo: "Não iniciado" },
  { id: "em_prospeccao", rotulo: "Em prospecção" },
  { id: "perdido", rotulo: "Perdido (resgate)" },
];

export function descreverPublico(setor: SetorDisparo, p: Publico): string {
  const partes: string[] = [];
  // Marketing (0242): a base de origem vem em p.fonte (contatos | leads | clientes).
  if (setor === "marketing") {
    const m = p as Publico & { fonte?: string; listas?: string[]; sem_tags?: string[]; tags_modo?: string; sequencia_id?: string; passo?: number };
    if (m.fonte === "sequencia") return `Sequência — passo ${m.passo ?? "?"}`;
    if (m.fonte === "leads") return descreverPublico("comercial", p).replace(/^Leads/, "Leads do QS").replace(/^Todos os leads/, "Todos os leads do QS");
    if (m.fonte === "clientes") return descreverPublico("relacionamento", p).replace(/^Clientes/, "Clientes do QS").replace(/^Todos os clientes/, "Todos os clientes do QS");
    if (m.listas?.length) partes.push(`${m.listas.length} lista(s)`);
    if (m.tags?.length) partes.push(`tags ${m.tags_modo === "todas" ? "(todas)" : "(qualquer)"}: ${m.tags.join(", ")}`);
    if (m.sem_tags?.length) partes.push(`sem as tags: ${m.sem_tags.join(", ")}`);
    return partes.length ? `Contatos — ${partes.join(" · ")}` : "Todos os contatos do Marketing";
  }
  if (setor === "comercial") {
    if (p.segmentos?.length) partes.push(`fonte: ${p.segmentos.length === 1 ? p.segmentos[0] : `${p.segmentos.length} fontes`}`);
    if (p.status?.length) partes.push(`etapa: ${p.status.map((s) => STATUS_LEAD.find((x) => x.id === s)?.rotulo ?? s).join(", ")}`);
    if (p.sdrs?.length) partes.push(`${p.sdrs.length} SDR(s)`);
    if (p.cadencias?.length) partes.push(`${p.cadencias.length} cadência(s)`);
    if (p.entrada_de || p.entrada_ate) partes.push(`entrada ${p.entrada_de ? `de ${br(p.entrada_de)}` : ""} ${p.entrada_ate ? `até ${br(p.entrada_ate)}` : ""}`.trim());
    if (p.tags?.length) partes.push(`tags: ${p.tags.join(", ")}`);
    if (p.respondeu === "sim") partes.push("já respondeu alguma vez");
    if (p.respondeu === "nao") partes.push("nunca respondeu");
    return partes.length ? `Leads — ${partes.join(" · ")}` : "Todos os leads";
  }
  if (p.expedicao) partes.push(`expedição "${p.expedicao}"`);
  if (p.destino) partes.push(`destino "${p.destino}"`);
  if (p.retorno_de || p.retorno_ate) partes.push(`voltou ${p.retorno_de ? `de ${br(p.retorno_de)}` : ""} ${p.retorno_ate ? `até ${br(p.retorno_ate)}` : ""}`.trim());
  if (p.sem_viagem_futura) partes.push("sem viagem futura");
  if (p.niveis?.length) partes.push(`nível: ${p.niveis.join(", ")}`);
  if (p.viajou === "sim") partes.push("já viajou com a gente");
  if (p.viajou === "nao") partes.push("nunca viajou");
  return partes.length ? `Clientes — ${partes.join(" · ")}` : "Todos os clientes";
}
const br = (iso: string) => iso.split("-").reverse().join("/");

// ── Campanhas e envios ──────────────────────────────────────────────────────

export type StatusCampanha = "rascunho" | "agendada" | "enviando" | "pausada" | "cancelada" | "concluida";
export interface Campanha {
  id: string;
  setor: SetorDisparo;
  nome: string;
  modelo_nome: string;
  modelo_idioma: string;
  modelo_corpo: string | null;
  params: MapaVariaveis;
  publico: Publico;
  cadence_id: string | null;
  grupo_link: string | null;
  status: StatusCampanha;
  total: number;
  ultimo_erro: string | null;
  criado_em: string;
  iniciada_em: string | null;
  concluida_em: string | null;
  // 0242 (Marketing)
  agendada_para?: string | null;
  recorrencia_id?: string | null;
  sequencia_id?: string | null;
  sequencia_passo?: number | null;
}

export type StatusEnvio = "pendente" | "pulado" | "enviado" | "entregue" | "lido" | "respondeu" | "erro" | "cancelado";

export async function listarCampanhas(setor: SetorDisparo): Promise<Campanha[]> {
  const { data, error } = await supabase.from("qs_disparo_campanhas").select("*").eq("setor", setor)
    .order("criado_em", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Campanha[];
}

/** Contagem por estado de várias campanhas (lista da tela). */
export async function contagens(ids: string[]): Promise<Record<string, Partial<Record<StatusEnvio, number>>>> {
  if (!ids.length) return {};
  const out: Record<string, Partial<Record<StatusEnvio, number>>> = {};
  for (const id of ids) {
    const { data } = await supabase.rpc("qs_disparo_resumo", { p_campanha: id });
    const r = (data ?? {}) as Record<string, number>;
    out[id] = { pendente: r.pendentes, enviado: r.enviados, respondeu: r.responderam, erro: r.erros, pulado: r.pulados };
  }
  return out;
}

// ── Servidor ────────────────────────────────────────────────────────────────

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/disparos", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export interface Ritmo { por_hora: number; por_dia: number; inicio: string; fim: string; dias: number[]; intervalo_dias: number }
export interface ConfigDisparo {
  simulacao: boolean;
  envioRealPlugado: boolean;
  ritmo: Ritmo;
  modelos: ModeloDisparo[];
  numerosSdr: { sdr_id: string; nome: string; numero: string | null }[];
  numeroRel: { numero: string | null; conectado: boolean } | null;
  /** Só no setor marketing (0242). null = o Marketing não envia. */
  numeroMkt?: { phone_number_id: string; numero: string | null; rotulo: string } | null;
}
export const lerConfig = (setor: SetorDisparo) => chamar<ConfigDisparo>({ acao: "config", setor });

export interface Previa {
  total: number;
  excluidos: { motivo: string; n: number }[];
  porSdr: { sdr_id: string; nome: string; n: number }[];
  amostra: { nome: string; telefone: string; sdr: string | null; destino: string | null }[];
  numeroOk: boolean;
  /** Marketing: até 200 de quem recebe (nome + final do telefone). */
  lista?: { nome: string; telefone: string; contato_id: string | null }[];
}
export const previa = (setor: SetorDisparo, publico: Publico) => chamar<Previa>({ acao: "previa", setor, publico });

export const criarCampanha = (setor: SetorDisparo, c: {
  nome: string; modelo_nome: string; modelo_idioma: string; params: MapaVariaveis; publico: Publico;
  cadence_id?: string | null; grupo_link?: string | null;
}) => chamar<{ campanha: Campanha }>({ acao: "criar", setor, ...c });

export const acaoCampanha = (acao: "iniciar" | "pausar" | "retomar" | "cancelar" | "apagar", campanhaId: string) =>
  chamar<{ ok: true; total?: number; simulacao?: boolean }>({ acao, campanhaId });

export interface Painel {
  resumo: { total: number; pendentes: number; pulados: number; cancelados: number; erros: number; enviados: number; entregues: number; lidos: number; responderam: number; simulados: number; na_cadencia: number };
  porSdr: { sdr_id: string; nome: string; total: number; enviados: number; responderam: number }[];
  respostas: { nome: string | null; lead_id: string | null; cliente_id: string | null; sdr: string | null; respondeu_em: string }[];
  erros: { nome: string | null; motivo: string | null; status: StatusEnvio }[];
}
export const painel = (campanhaId: string) => chamar<Painel>({ acao: "painel", campanhaId });

export const salvarModelo = (setor: SetorDisparo, modelo: ModeloDisparo, remover = false) =>
  chamar<{ ok: true; modelo?: ModeloDisparo; pacote?: unknown }>({ acao: "salvar_modelo", setor, modelo, remover });

export const salvarRitmo = (ritmo: Ritmo) => chamar<{ ok: true; ritmo: Ritmo }>({ acao: "salvar_ritmo", ritmo });

/** O pacote da Meta, montado na tela (mesmo formato do servidor). */
export function pacoteDaMeta(m: ModeloDisparo) {
  const vars = variaveisDoCorpo(m.corpo).map(Number).sort((a, b) => a - b);
  const components: Record<string, unknown>[] = [];
  if (m.cabecalho?.trim()) components.push({ type: "HEADER", format: "TEXT", text: m.cabecalho.trim() });
  const body: Record<string, unknown> = { type: "BODY", text: m.corpo.trim() };
  if (vars.length) body.example = { body_text: [vars.map((n) => m.exemplos?.[String(n)] || `exemplo ${n}`)] };
  components.push(body);
  if (m.rodape?.trim()) components.push({ type: "FOOTER", text: m.rodape.trim() });
  if (m.botaoParar !== false) components.push({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Parar de receber" }] });
  return { name: m.nome, category: m.categoria, language: m.idioma || "pt_BR", components };
}

/** Mesmas regras de validarModelo (api/_meta.js) — avisa antes de salvar. */
export function problemaDoModelo(m: Pick<ModeloDisparo, "nome" | "corpo" | "categoria">): string | null {
  const n = m.nome.trim();
  if (!n) return "Dê um nome ao modelo.";
  if (!/^[a-z0-9_]+$/.test(n)) return "Nome: só minúsculas, números e _ (ex.: retomada_outubro).";
  const c = m.corpo.trim();
  if (!c) return "Escreva o texto da mensagem.";
  if (c.length > 1024) return "O texto passa de 1024 caracteres.";
  const vars = [...c.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((x) => x[1].trim());
  if (vars.length) {
    if (!vars.every((v) => /^\d+$/.test(v))) return "Variáveis numeradas: {{1}}, {{2}}… (não {{nome}}).";
    const nums = vars.map(Number);
    const max = Math.max(...nums);
    if (!Array.from({ length: max }, (_, i) => i + 1).every((e) => nums.includes(e))) return `Falta alguma variável entre {{1}} e {{${max}}}.`;
    if (/^\s*{{/.test(c) || /}}\s*$/.test(c)) return "O texto não pode começar nem terminar com variável.";
  }
  return null;
}
