// src/rel/clientes/ficha/fontes.ts
// -----------------------------------------------------------------------------
// FICHA COMPLETA (Bruno, 30/10/2026): "a ficha tem que ter TUDO que o cliente já
// passou — contratos, laudos, passaporte, receitas — pra numa próxima viagem a
// gente não pedir de novo". Inventário: docs/INVENTARIO-FICHA.md.
//
// Este arquivo só LÊ e grava o que as abas novas da ficha precisam:
//   • idasCompletas(clienteId)      passageiros da pessoa com TUDO (saúde, perfil,
//                                   emergência, receita 0223, passaporte, contrato…)
//   • perfilDaFicha / salvarPerfil  rel_clientes.perfil (0228) — dados de viagem
//                                   da PESSOA; sem a 0228 → null e a tela usa o que
//                                   veio da última inscrição (só leitura)
//   • contratosDoCliente            TODOS os contratos (0228 RPC + PDFs em
//                                   rel_documentos + "contrato assinado" das idas)
//   • laudosDoCliente               cad_laudos_medicos (outro agente — lido de forma
//                                   tolerante: sem a tabela → { ativo: false })
//   • passaportesDaPessoa           todos os números/validades já informados
//   • completudeProximaViagem       "ficha X% completa / falta: …"
// Tudo degrada: tabela/coluna/RPC que não existe vira "ainda não disponível".
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { SaudePassageiro, PerfilViajante } from "@/expedicoes/lib/database";
import { PERGUNTAS_SAUDE } from "@/expedicoes/lib/saude";
import type { Cliente } from "../../lib/clientes";
import type { Pessoa } from "@/clientes/cadastro";
import type { TimelineItem } from "@/components/ui";

type ErroBanco = { message?: string; code?: string } | null | undefined;
/** Coluna/tabela/função que ainda não existe no banco (migration não aplicada). */
export const faltaNoBanco = (e: ErroBanco) =>
  !!e && (e.code === "42703" || e.code === "42P01" || e.code === "PGRST202" || e.code === "PGRST204" || e.code === "PGRST205" || e.code === "42883"
    || /does not exist|could not find|schema cache/i.test(e.message ?? ""));

const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

// ── Idas (passageiros) com tudo ─────────────────────────────────────────────

export interface IdaCompleta {
  id: string;
  expedicao_id: string;
  nome_completo: string;
  status_reserva: string;
  created_at: string;
  cpf: string | null;
  passaporte: string | null;
  validade_passaporte: string | null;
  passaporte_arquivo_id: string | null;
  contrato_assinado: boolean | null;
  contato_emergencia_nome: string | null;
  contato_emergencia_fone: string | null;
  contato_emergencia_vinculo: string | null;
  restricoes_alimentares: string | null;
  condicoes_medicas: string | null;
  saude: SaudePassageiro | null;
  perfil_viajante: PerfilViajante | null;
  pref_marcar_assento: boolean | null;
  pref_upgrade_classe: string | null;
  ja_viajou_internacional: boolean | null;
  paises_visitados: string | null;
  acompanhante_nome: string | null;
  acompanhante_vinculo: string | null;
  /** 0223 */
  receita_pendente?: boolean | null;
  receita_enviada_em?: string | null;
  receita_enviada_por?: string | null;
  expedicao: { id: string; codigo: string; nome: string; data_embarque: string | null; data_retorno: string | null; status: string; tipo: string } | null;
}

const COLS_IDA_BASE = "id, expedicao_id, nome_completo, status_reserva, created_at, cpf, passaporte, validade_passaporte, passaporte_arquivo_id, contrato_assinado, contato_emergencia_nome, contato_emergencia_fone, contato_emergencia_vinculo, restricoes_alimentares, condicoes_medicas, saude, perfil_viajante, pref_marcar_assento, pref_upgrade_classe, ja_viajou_internacional, paises_visitados, acompanhante_nome, acompanhante_vinculo, expedicao:expedicoes(id, codigo, nome, data_embarque, data_retorno, status, tipo)";
const COLS_RECEITA = ", receita_pendente, receita_enviada_em, receita_enviada_por";

/** Todas as idas da pessoa, a mais recente primeiro. Sem a 0223, vem sem as colunas de receita. */
export async function idasCompletas(clienteId: string): Promise<IdaCompleta[]> {
  const ler = (cols: string) => supabase.from("passageiros").select(cols).eq("cliente_id", clienteId)
    .then(({ data, error }) => ({ data: data as unknown as IdaCompleta[] | null, error }));
  let r = await ler(COLS_IDA_BASE + COLS_RECEITA);
  if (r.error && faltaNoBanco(r.error)) r = await ler(COLS_IDA_BASE);
  if (r.error) throw r.error;
  return (r.data ?? [])
    .sort((a, b) => (b.expedicao?.data_embarque ?? b.created_at ?? "").localeCompare(a.expedicao?.data_embarque ?? a.created_at ?? ""));
}

const idaValida = (i: IdaCompleta) => i.status_reserva !== "Cancelado";

// ── Perfil de viagem (0228) ─────────────────────────────────────────────────

/** Mesma lista de cad_campos_perfil() na 0228. */
export const CAMPOS_PERFIL = [
  "contato_emergencia_nome", "contato_emergencia_fone", "contato_emergencia_vinculo",
  "restricoes_alimentares", "camiseta", "profissao", "instagram",
  "pref_marcar_assento", "pref_upgrade_classe", "ja_viajou_internacional", "paises_visitados", "obs_viagem", "saude",
] as const;
export type CampoPerfil = (typeof CAMPOS_PERFIL)[number];

export interface PerfilViagem {
  contato_emergencia_nome?: string;
  contato_emergencia_fone?: string;
  contato_emergencia_vinculo?: string;
  restricoes_alimentares?: string;
  camiseta?: string;
  profissao?: string;
  instagram?: string;
  pref_marcar_assento?: boolean;
  pref_upgrade_classe?: string;
  ja_viajou_internacional?: boolean;
  paises_visitados?: string;
  obs_viagem?: string;
  saude?: SaudePassageiro;
  atualizado_em?: string;
  atualizado_por?: string;
}

/** O perfil gravado na ficha. null = a 0228 ainda não foi aplicada (a coluna não existe). */
export async function perfilDaFicha(clienteId: string): Promise<PerfilViagem | null> {
  const { data, error } = await supabase.from("rel_clientes").select("perfil").eq("id", clienteId).maybeSingle();
  if (error) { if (faltaNoBanco(error)) return null; throw error; }
  const p = (data as { perfil?: unknown } | null)?.perfil;
  return p && typeof p === "object" ? (p as PerfilViagem) : {};
}

export class PerfilInativo extends Error {
  constructor() { super("O perfil de viagem da ficha (migration 0228) ainda não foi ativado no banco."); this.name = "PerfilInativo"; }
}

/** Grava SÓ as chaves enviadas ("" / null apaga). Auditado em rel_auditoria (trigger de rel_clientes). */
export async function salvarPerfil(clienteId: string, campos: Partial<Record<CampoPerfil, unknown>>): Promise<PerfilViagem> {
  const { data, error } = await supabase.rpc("cad_salvar_perfil", { p: clienteId, p_campos: campos });
  if (error) {
    if (faltaNoBanco(error)) throw new PerfilInativo();
    if (error.code === "42501") throw new Error("Sem permissão pra editar este cadastro.");
    throw new Error(error.message || "Não consegui salvar.");
  }
  return (data ?? {}) as PerfilViagem;
}

/** Um valor do perfil + de onde veio (ficha ou inscrição de uma ida). */
export interface ValorComOrigem<T> { valor: T; origem: "ficha" | "inscricao"; ida?: IdaCompleta }

const temTexto = (v: unknown) => typeof v === "string" ? v.trim() !== "" : v != null;

/**
 * O perfil "efetivo": o que está na ficha (0228) e, campo a campo, o que a pessoa
 * já respondeu na inscrição mais recente quando a ficha ainda não tem.
 */
export function perfilEfetivo(perfil: PerfilViagem | null, idas: IdaCompleta[]): {
  [K in Exclude<CampoPerfil, "saude">]?: ValorComOrigem<NonNullable<PerfilViagem[K]>>;
} & { saude: { valor: SaudePassageiro; origem: "ficha" | "inscricao" | null; ida?: IdaCompleta } } {
  const vivas = idas.filter(idaValida);
  const daIda = (f: (i: IdaCompleta) => unknown) => {
    for (const i of vivas) { const v = f(i); if (temTexto(v)) return { v, i }; }
    return null;
  };
  const de = <K extends Exclude<CampoPerfil, "saude">>(k: K, f: (i: IdaCompleta) => unknown) => {
    const pv = perfil?.[k];
    if (temTexto(pv)) return { valor: pv as NonNullable<PerfilViagem[K]>, origem: "ficha" as const };
    const r = daIda(f);
    return r ? { valor: r.v as NonNullable<PerfilViagem[K]>, origem: "inscricao" as const, ida: r.i } : undefined;
  };
  const saudeFicha = perfil?.saude && Object.keys(perfil.saude).length ? perfil.saude : null;
  const saudeIda = daIda((i) => (i.saude && typeof i.saude === "object" && Object.keys(i.saude).length ? i.saude : null));
  return {
    contato_emergencia_nome: de("contato_emergencia_nome", (i) => i.contato_emergencia_nome),
    contato_emergencia_fone: de("contato_emergencia_fone", (i) => i.contato_emergencia_fone),
    contato_emergencia_vinculo: de("contato_emergencia_vinculo", (i) => i.contato_emergencia_vinculo),
    restricoes_alimentares: de("restricoes_alimentares", (i) => i.restricoes_alimentares),
    camiseta: de("camiseta", (i) => i.perfil_viajante?.camiseta),
    profissao: de("profissao", (i) => i.perfil_viajante?.profissao),
    instagram: de("instagram", (i) => i.perfil_viajante?.instagram),
    pref_marcar_assento: de("pref_marcar_assento", (i) => i.pref_marcar_assento),
    pref_upgrade_classe: de("pref_upgrade_classe", (i) => i.pref_upgrade_classe),
    ja_viajou_internacional: de("ja_viajou_internacional", (i) => i.ja_viajou_internacional),
    paises_visitados: de("paises_visitados", (i) => i.paises_visitados),
    obs_viagem: de("obs_viagem", () => null),
    saude: saudeFicha ? { valor: saudeFicha, origem: "ficha" }
      : saudeIda ? { valor: saudeIda.v as SaudePassageiro, origem: "inscricao", ida: saudeIda.i }
        : { valor: {}, origem: null },
  };
}

export type PerfilEfetivo = ReturnType<typeof perfilEfetivo>;

export const ROTULO_PERFIL: Record<CampoPerfil, string> = {
  contato_emergencia_nome: "Contato de emergência (nome)", contato_emergencia_fone: "Contato de emergência (telefone)",
  contato_emergencia_vinculo: "Contato de emergência (vínculo)", restricoes_alimentares: "Restrição alimentar (observação)",
  camiseta: "Tamanho de camiseta", profissao: "Profissão", instagram: "Instagram",
  pref_marcar_assento: "Quer marcar assento", pref_upgrade_classe: "Upgrade de classe", ja_viajou_internacional: "Já viajou pra fora",
  paises_visitados: "Países que já visitou", obs_viagem: "Observações de viagem", saude: "Saúde",
};

export const TAMANHOS_CAMISETA = ["PP", "P", "M", "G", "GG", "XG", "XGG"];

// ── Contratos ───────────────────────────────────────────────────────────────

export type OrigemContrato = "zapsign" | "manual" | "cartao" | "arquivo" | "expedicao";
export interface ContratoDaFicha {
  chave: string;
  origem: OrigemContrato;
  titulo: string;
  status: string;
  tom: "ok" | "warn" | "danger" | "neutral";
  em: string | null;
  detalhe: string | null;
  /** link pronto (ZapSign / Drive) */
  url?: string | null;
  /** PDF no bucket rel-documentos (gera link assinado no clique) */
  arquivoPath?: string | null;
  /** abre a ida na expedição */
  ida?: { expedicaoId: string; tipo: string; passageiroId: string };
}

const ROTULO_STATUS: Record<string, string> = {
  gerando: "gerando", enviado: "enviado pra assinar", visualizado: "visualizado pela cliente", assinado: "assinado",
  recusado: "recusado", cancelado: "cancelado", erro: "erro no envio",
};
const tomStatus = (s: string): ContratoDaFicha["tom"] =>
  s === "assinado" ? "ok" : s === "recusado" || s === "erro" ? "danger" : s === "cancelado" ? "neutral" : "warn";

interface LinhaRpc {
  origem: "qs_contratos" | "negocio"; id: string; tipo: string | null; modo: string | null; status: string | null; erro: string | null;
  titulo: string | null; valor: string | null; em: string | null; enviado_por?: string | null;
  link_assinatura?: string | null; pdf_assinado_url?: string | null; drive_pdf_url?: string | null;
}

/**
 * TODOS os contratos da pessoa, de qualquer origem. `rpcAtiva=false` = a 0228 não
 * está no banco: os envios do closer (qs_contratos) não aparecem pra quem não é
 * closer/gestor — a tela avisa.
 */
export async function contratosDoCliente(clienteId: string, idas: IdaCompleta[]): Promise<{ lista: ContratoDaFicha[]; rpcAtiva: boolean; erro?: string }> {
  const lista: ContratoDaFicha[] = [];
  let rpcAtiva = true;
  let erro: string | undefined;

  const rpc = await supabase.rpc("cad_contratos_do_cliente", { p: clienteId });
  if (rpc.error) {
    if (faltaNoBanco(rpc.error)) rpcAtiva = false; else erro = rpc.error.message;
  } else {
    for (const k of (rpc.data ?? []) as LinhaRpc[]) {
      const st = k.status ?? "—";
      lista.push({
        chave: `${k.origem}:${k.id}`,
        origem: k.origem === "negocio" ? "cartao" : k.modo === "manual" ? "manual" : "zapsign",
        titulo: k.titulo || (k.tipo === "pacote" ? "Contrato de pacote" : k.tipo === "expedicao" ? "Contrato de expedição" : "Contrato"),
        status: ROTULO_STATUS[st] ?? st, tom: tomStatus(st), em: k.em,
        detalhe: [k.origem === "negocio" ? "status no cartão do closer" : k.modo === "manual" ? "PDF gerado (sem ZapSign)" : "ZapSign",
          k.valor ? `R$ ${k.valor}` : null, k.enviado_por ? `por ${k.enviado_por}` : null, k.erro].filter(Boolean).join(" · ") || null,
        url: k.pdf_assinado_url || k.drive_pdf_url || k.link_assinatura || null,
      });
    }
  }

  // PDFs/arquivos de contrato guardados na ficha (rel_documentos: tipo 'contrato' ou nome/descrição com "contrat")
  const docs = await supabase.from("rel_documentos")
    .select("id, tipo, descricao, arquivo_nome, arquivo_path, enviado_em, status")
    .eq("cliente_id", clienteId)
    .or("tipo.eq.contrato,arquivo_nome.ilike.*contrat*,descricao.ilike.*contrat*")
    .order("enviado_em", { ascending: false }).limit(200);
  if (!docs.error) {
    for (const d of (docs.data ?? []) as { id: string; tipo: string; descricao: string | null; arquivo_nome: string | null; arquivo_path: string; enviado_em: string | null; status: string }[]) {
      lista.push({
        chave: `doc:${d.id}`, origem: "arquivo", titulo: d.descricao || d.arquivo_nome || "Contrato (arquivo)",
        status: d.status === "recusado" ? "arquivo recusado" : "arquivo guardado", tom: d.status === "recusado" ? "danger" : "ok",
        em: d.enviado_em, detalhe: d.arquivo_nome, arquivoPath: d.arquivo_path,
      });
    }
  }

  // "Contrato assinado" marcado na ida da expedição/pacote (Operações)
  for (const i of idas) {
    if (!i.expedicao) continue;
    lista.push({
      chave: `pax:${i.id}`, origem: "expedicao", titulo: i.expedicao.nome,
      status: i.contrato_assinado ? "assinado (marcado no Operações)" : i.status_reserva === "Cancelado" ? "reserva cancelada" : "não marcado como assinado",
      tom: i.contrato_assinado ? "ok" : i.status_reserva === "Cancelado" ? "neutral" : "warn",
      em: i.expedicao.data_embarque, detalhe: `${i.expedicao.tipo === "pacote" ? "Pacote" : "Expedição"} · ${i.status_reserva}`,
      ida: { expedicaoId: i.expedicao_id, tipo: i.expedicao.tipo, passageiroId: i.id },
    });
  }

  lista.sort((a, b) => (b.em ?? "").localeCompare(a.em ?? ""));
  return { lista, rpcAtiva, erro };
}

export async function linkArquivoFicha(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("rel-documentos").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error("Não consegui abrir o arquivo.");
  return data.signedUrl;
}

// ── Laudos médicos (tabela do agente v2-saude) ──────────────────────────────

/**
 * Contrato do agente v2-saude (docs/CONTRATO-LAUDOS.md daquele worktree, migration
 * 0225 NÃO aplicada): cad_laudos_medicos, 1 linha por passageiro (viagem).
 *   status a_fazer | em_andamento | emitido | dispensado — "laudo válido" = emitido
 *   apto   sim | nao | ressalvas (+ ressalvas), parecer, arquivo_path no bucket
 *   PRIVADO laudos-medicos, emitido_em / emitido_por_nome.
 * RLS: quem não passa em exp_pode_ver_saude() recebe lista VAZIA (não é erro).
 * Sem a 0225 a tabela não existe → a ficha esconde o bloco (sem erro).
 */
export interface LaudoMedico {
  id: string;
  status: string | null;
  apto: string | null;
  ressalvas: string | null;
  parecer: string | null;
  arquivo_path: string | null;
  arquivo_nome: string | null;
  emitido_em: string | null;
  emitido_por_nome: string | null;
  expedicao_id: string | null;
  atualizado_em: string | null;
  expedicao?: { id: string; nome: string; data_embarque: string | null } | null;
}
export const BUCKET_LAUDOS = "laudos-medicos";
export const ROTULO_STATUS_LAUDO: Record<string, string> = { a_fazer: "a fazer", em_andamento: "em andamento", emitido: "emitido", dispensado: "dispensado" };
export const SELO_APTO: Record<string, { texto: string; tom: "ok" | "warn" | "danger" }> = {
  sim: { texto: "Apto", tom: "ok" }, ressalvas: { texto: "Apto com ressalvas", tom: "warn" }, nao: { texto: "Não apto", tom: "danger" },
};

export async function laudosDoCliente(clienteId: string): Promise<{ ativo: boolean; lista: LaudoMedico[]; erro?: string }> {
  const { data, error } = await supabase.from("cad_laudos_medicos")
    .select("id,status,apto,ressalvas,parecer,arquivo_path,arquivo_nome,emitido_em,emitido_por_nome,expedicao_id,atualizado_em,expedicao:expedicoes(id,nome,data_embarque)")
    .eq("cliente_id", clienteId).order("atualizado_em", { ascending: false }).limit(200);
  // contrato: sem a tabela (ou qualquer erro de leitura) → esconde o bloco, sem mostrar erro
  if (error) return { ativo: false, lista: [], erro: faltaNoBanco(error) ? undefined : error.message };
  return { ativo: true, lista: (data ?? []) as unknown as LaudoMedico[] };
}

export async function linkLaudo(path: string): Promise<string> {
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await supabase.storage.from(BUCKET_LAUDOS).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error("Não consegui abrir o laudo (o arquivo mora em outro lugar?).");
  return data.signedUrl;
}

// ── Passaportes ─────────────────────────────────────────────────────────────

export interface PassaporteDaPessoa {
  numero: string;
  validade: string | null;
  /** de onde veio cada informação ("Ficha", "Expedição X", "Documento enviado") */
  fontes: string[];
  atual: boolean;
}

/** Todos os passaportes já informados (ficha, idas, documentos enviados), por número. */
export function passaportesDaPessoa(c: Cliente, idas: IdaCompleta[], docs: { numero?: string | null; validade?: string | null; fonte: string }[] = []): PassaporteDaPessoa[] {
  const mapa = new Map<string, PassaporteDaPessoa>();
  const por = (num: string | null | undefined, validade: string | null | undefined, fonte: string) => {
    const n = (num ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!n) return;
    const x = mapa.get(n) ?? { numero: n, validade: null, fontes: [], atual: false };
    if (validade && (!x.validade || validade > x.validade)) x.validade = validade.slice(0, 10);
    if (!x.fontes.includes(fonte)) x.fontes.push(fonte);
    mapa.set(n, x);
  };
  por(c.passaporte, c.passaporte_validade, "Ficha");
  for (const i of idas) por(i.passaporte, i.validade_passaporte, i.expedicao ? `${i.expedicao.tipo === "pacote" ? "Pacote" : "Expedição"} ${i.expedicao.nome}` : "Expedição");
  for (const d of docs) por(d.numero, d.validade, d.fonte);
  const atualN = (c.passaporte ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const lista = [...mapa.values()].map((p) => ({ ...p, atual: p.numero === atualN }));
  return lista.sort((a, b) => Number(b.atual) - Number(a.atual) || (b.validade ?? "").localeCompare(a.validade ?? ""));
}

/**
 * Alerta da regra de 6 meses: o passaporte tem que valer 6 meses DEPOIS da volta
 * da próxima viagem (sem viagem: 6 meses a partir de hoje).
 */
export function alertaSeisMeses(validade: string | null, voltaProxima: string | null): { tom: "danger" | "warn" | "ok"; texto: string } | null {
  if (!validade) return null;
  const hoje = hojeISO();
  if (validade < hoje) return { tom: "danger", texto: "Vencido" };
  const base = voltaProxima && voltaProxima >= hoje ? voltaProxima.slice(0, 10) : hoje;
  const d = new Date(`${base}T12:00:00`); d.setMonth(d.getMonth() + 6);
  const limite = d.toISOString().slice(0, 10);
  if (validade < limite) {
    return { tom: "warn", texto: voltaProxima && voltaProxima >= hoje ? "Vence menos de 6 meses depois da volta da próxima viagem" : "Vence em menos de 6 meses" };
  }
  return { tom: "ok", texto: "Válido (mais de 6 meses)" };
}

// ── Completude pra próxima viagem ───────────────────────────────────────────

export interface ItemCompletude { chave: string; rotulo: string; ok: boolean; secao: "pessoais" | "documentos" | "endereco" | "viagem" | "saude" }

/**
 * O que a próxima viagem pede. Usa a Pessoa (0213: endereço) quando houver e o
 * perfil efetivo (ficha + última inscrição) — o que a cliente já passou conta.
 */
export function completudeProximaViagem(c: Cliente, pessoa: Pessoa | null | undefined, pe: PerfilEfetivo, semFoto: boolean | null): { pct: number; itens: ItemCompletude[]; falta: ItemCompletude[] } {
  const end = pessoa ?? null;
  const itens: ItemCompletude[] = [
    { chave: "nome", rotulo: "nome completo", ok: (c.nome ?? "").trim().split(/\s+/).length >= 2, secao: "pessoais" },
    { chave: "cpf", rotulo: "CPF", ok: !!c.cpf, secao: "pessoais" },
    { chave: "nascimento", rotulo: "nascimento", ok: !!c.nascimento, secao: "pessoais" },
    { chave: "telefone", rotulo: "telefone", ok: !!c.telefone, secao: "pessoais" },
    { chave: "email", rotulo: "e-mail", ok: !!c.email, secao: "pessoais" },
    { chave: "passaporte", rotulo: "passaporte", ok: !!c.passaporte, secao: "documentos" },
    { chave: "passaporte_validade", rotulo: "validade do passaporte", ok: !!c.passaporte_validade, secao: "documentos" },
    { chave: "doc_passaporte", rotulo: "foto do passaporte", ok: semFoto !== true, secao: "documentos" },
    { chave: "endereco", rotulo: "endereço", ok: !!(end?.endereco_cep && end?.endereco_rua && end?.endereco_cidade), secao: "endereco" },
    { chave: "emergencia", rotulo: "contato de emergência", ok: !!(pe.contato_emergencia_nome && pe.contato_emergencia_fone), secao: "viagem" },
    { chave: "camiseta", rotulo: "tamanho de camiseta", ok: !!pe.camiseta, secao: "viagem" },
    { chave: "saude", rotulo: "questionário de saúde", ok: PERGUNTAS_SAUDE.filter((q) => q.campo !== "gravidez").every((q) => temTexto(pe.saude.valor[q.campo])), secao: "saude" },
  ];
  const falta = itens.filter((i) => !i.ok);
  return { pct: Math.round(((itens.length - falta.length) / itens.length) * 100), itens, falta };
}

// ── Receitas (0223) na ficha ────────────────────────────────────────────────

export const DIAS_RECEITA = 20;
export function situacaoReceita(i: IdaCompleta): { texto: string; tom: "ok" | "warn" | "danger" | "neutral"; limite: string | null } | null {
  if (!i.receita_pendente && !i.receita_enviada_em) return null;
  if (i.receita_enviada_em) return { texto: "receita enviada", tom: "ok", limite: null };
  const emb = i.expedicao?.data_embarque?.slice(0, 10) ?? null;
  if (!emb) return { texto: "receita a enviar (sem data de embarque)", tom: "warn", limite: null };
  const d = new Date(`${emb}T12:00:00`); d.setDate(d.getDate() - DIAS_RECEITA);
  const limite = d.toISOString().slice(0, 10);
  const hoje = hojeISO();
  if (emb < hoje) return { texto: "viagem já embarcou sem marcar a receita", tom: "neutral", limite };
  if (limite < hoje) return { texto: "prazo da receita passou", tom: "danger", limite };
  return { texto: "receita a enviar", tom: "warn", limite };
}

// ── Itens de venda (0207 — "subir venda") ───────────────────────────────────

export interface VendaItemFicha { id: string; tipo: string; nome: string | null; valor: number | null; status: string | null; criado_em: string; data_inicio: string | null }
export async function vendaItensDoCliente(clienteId: string): Promise<VendaItemFicha[]> {
  const { data, error } = await supabase.from("qs_venda_itens").select("id, tipo, nome, valor, status, criado_em, data_inicio")
    .eq("cliente_id", clienteId).order("criado_em", { ascending: false }).limit(200);
  if (error) return []; // sem permissão / sem tabela: a linha do tempo segue sem eles
  return (data ?? []) as VendaItemFicha[];
}

// ── Linha do tempo: o que a ficha completa acrescenta ───────────────────────

const quandoTl = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const soData = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a}`; };

/** Idas (inscrição em expedição/pacote), contratos, laudos, receitas e itens de venda. */
export function eventosDaFichaCompleta(f: {
  idas: IdaCompleta[]; contratos: ContratoDaFicha[]; laudos: LaudoMedico[]; vendaItens: VendaItemFicha[]; usuarios: Record<string, string>;
}): (TimelineItem & { em: string })[] {
  const out: (TimelineItem & { em: string })[] = [];
  for (const i of f.idas) {
    if (i.created_at) {
      out.push({ id: `ida${i.id}`, em: i.created_at, when: quandoTl(i.created_at), setor: "operacional",
        title: `Entrou ${i.expedicao?.tipo === "pacote" ? "no pacote" : "na expedição"} ${i.expedicao?.nome ?? ""}`.trim(),
        sub: [i.status_reserva, i.expedicao?.data_embarque ? `embarca ${soData(i.expedicao.data_embarque)}` : null].filter(Boolean).join(" · ") });
    }
    if (i.receita_enviada_em) {
      out.push({ id: `rec${i.id}`, em: i.receita_enviada_em, when: quandoTl(i.receita_enviada_em), tone: "ok",
        title: `Receita enviada — ${i.expedicao?.nome ?? "viagem"}`, sub: i.receita_enviada_por ? f.usuarios[i.receita_enviada_por] : undefined });
    }
  }
  for (const c of f.contratos) {
    if (c.origem === "expedicao" || !c.em) continue;
    out.push({ id: `ct${c.chave}`, em: c.em, when: quandoTl(c.em), tone: c.tom === "ok" ? "ok" : c.tom === "danger" ? "danger" : "warn",
      title: `Contrato ${c.status}: ${c.titulo}`, sub: c.detalhe ?? undefined });
  }
  for (const l of f.laudos) {
    if (l.status !== "emitido" || !l.emitido_em) continue; // só laudo válido entra no histórico
    const selo = l.apto ? SELO_APTO[l.apto] : null;
    out.push({ id: `ld${l.id}`, em: l.emitido_em, when: quandoTl(l.emitido_em), tone: selo ? selo.tom : "info",
      title: `Laudo médico${selo ? ` — ${selo.texto.toLowerCase()}` : ""}${l.expedicao?.nome ? ` (${l.expedicao.nome})` : ""}`,
      sub: [l.emitido_por_nome, l.ressalvas].filter(Boolean).join(" · ") || undefined });
  }
  for (const v of f.vendaItens) {
    out.push({ id: `vi${v.id}`, em: v.criado_em, when: quandoTl(v.criado_em), setor: "comercial",
      title: `Item de venda: ${v.nome ?? v.tipo}`, sub: [v.tipo, v.valor != null ? v.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null, v.status].filter(Boolean).join(" · ") });
  }
  return out;
}
