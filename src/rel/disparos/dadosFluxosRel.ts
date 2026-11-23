// src/rel/disparos/dadosFluxosRel.ts
// -----------------------------------------------------------------------------
// FLUXOS DO RELACIONAMENTO (0409) — o lado da tela.
// O editor é o do Marketing (src/mkt/automacoes/EditorFluxo.tsx) com este
// ADAPTADOR: lê/grava rel_fluxos (RLS rel_tem_acesso) e fala com o motor do Rel
// (api/_relFluxoMotor.js) pelas ações rel_fluxo_* de /api/disparos.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { PublicoRel } from "@/lib/qs/disparos";
import type { AdaptadorFluxo } from "@/mkt/automacoes/EditorFluxo";
import type { ResultadoSimulacao } from "@/mkt/automacoes/Simulacao";
import { novoId, noPadrao, type Acao, type Fluxo, type Grafo, type No } from "@/mkt/automacoes/tipos";
import type { EstatBloco, ModeloMkt } from "@/mkt/automacoes/api";
import { chamar, type NumeroTeste } from "./oficialRel";

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(/rel_fluxo|schema cache|does not exist/i.test(r.error.message) ? "Os fluxos do Relacionamento precisam da migration 0409 aplicada no banco." : r.error.message);
  return r.data as T;
}

export const listarFluxosRel = async () => ok(await supabase.from("rel_fluxos").select("*").order("atualizado_em", { ascending: false })) as Fluxo[];
export const lerFluxoRel = async (id: string) => ok(await supabase.from("rel_fluxos").select("*").eq("id", id).maybeSingle()) as Fluxo | null;
export async function criarFluxoRel(nome: string, grafo: Grafo, criadoPor?: string | null) {
  return ok(await supabase.from("rel_fluxos").insert({ nome, grafo, criado_por: criadoPor ?? null }).select().single()) as Fluxo;
}
export async function salvarFluxoRel(id: string, patch: Partial<Pick<Fluxo, "nome" | "grafo" | "status" | "grafo_rascunho">>) {
  ok(await supabase.from("rel_fluxos").update(patch).eq("id", id).select("id"));
}
export async function apagarFluxoRel(id: string) { ok(await supabase.from("rel_fluxos").delete().eq("id", id).select("id")); }

async function estatisticasRel(fluxoId: string) {
  const [{ data }, funil] = await Promise.all([
    supabase.rpc("rel_fluxo_estatisticas", { p_fluxo: fluxoId }),
    // 0414: enviadas → entregues → lidas → clicaram no link, por bloco.
    supabase.rpc("rel_fluxo_funil_blocos", { p_fluxo: fluxoId }).then((r) => r.data ?? [], () => []),
  ]);
  const m = new Map<string, EstatBloco>();
  for (const l of (data ?? []) as { no_id: string; tipo: string; saida: string; total: number }[]) {
    const e = m.get(l.no_id) ?? { entrou: 0, saidas: {}, erros: 0 };
    if (l.tipo === "entrou") e.entrou += Number(l.total);
    if (l.tipo === "erro") e.erros += Number(l.total);
    if (l.tipo === "saida") e.saidas[l.saida] = (e.saidas[l.saida] ?? 0) + Number(l.total);
    m.set(l.no_id, e);
  }
  for (const l of funil as { no_id: string; enviadas: number; entregues: number; lidas: number; falharam: number; clicaram_link: number }[]) {
    const e = m.get(l.no_id) ?? { entrou: 0, saidas: {}, erros: 0 };
    e.envio = { enviadas: Number(l.enviadas), entregues: Number(l.entregues), lidas: Number(l.lidas), falharam: Number(l.falharam), cliques: Number(l.clicaram_link) };
    m.set(l.no_id, e);
  }
  return m;
}

async function usuariosRel(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("qs_users").select("id,name,setores,role").eq("is_active", true).order("name");
  return ((data ?? []) as { id: string; name: string; setores: string[] | null; role: string }[])
    .filter((u) => u.role === "admin" || (u.setores ?? []).includes("relacionamento"))
    .map(({ id, name }) => ({ id, name }));
}

export const ACOES_REL: Acao["tipo"][] = ["adicionar_tag", "remover_tag", "avisar_humano", "parar_outros_fluxos", "descadastrar", "reinscrever"];

/** O adaptador do editor (o resto — botões extra, ajuda — a página completa). */
export function adaptadorRel(extra: Partial<AdaptadorFluxo> = {}, numerosTeste: NumeroTeste[] = []): AdaptadorFluxo {
  const nomes = numerosTeste.map((n) => n.nome).join(", ");
  return {
    lerFluxo: lerFluxoRel,
    listarFluxos: listarFluxosRel,
    salvarFluxo: salvarFluxoRel,
    estatisticas: estatisticasRel,
    listarModelos: () => chamar<{ modelos?: ModeloMkt[]; aviso?: string }>({ acao: "rel_fluxo_modelos" }),
    listarUsuarios: usuariosRel,
    // "Destino" vem da viagem do cliente — dá pra usar {{destino}} e testar na Condição.
    listarCampos: async () => [{ id: "destino", chave: "destino", rotulo: "Destino da viagem", tipo: "texto", descricao: null }],
    simular: (fluxoId, grafo) => chamar<ResultadoSimulacao>({ acao: "rel_fluxo_simular", fluxoId, grafo }),
    testar: async (fluxoId) => {
      // Com números de teste configurados: vai pra todos eles, sem perguntar.
      if (numerosTeste.length) {
        const r = await chamar<{ enviados: string[]; erros: { nome: string; erro: string }[] }>({ acao: "rel_fluxo_testar", fluxoId, paraTeste: true });
        if (r.erros?.length) throw new Error(`Saiu pra ${r.enviados.join(", ") || "ninguém"}. Falhou: ${r.erros.map((e) => `${e.nome} (${e.erro})`).join("; ")}`);
        return;
      }
      let telefone: string | null = null;
      try { telefone = localStorage.getItem("rel_disparo_tel_teste"); } catch { /* sem storage */ }
      const t = window.prompt("Mandar o fluxo de verdade pra qual WhatsApp? (DDD + número)", telefone ?? "");
      if (!t) throw new Error("Teste cancelado.");
      try { localStorage.setItem("rel_disparo_tel_teste", t); } catch { /* sem storage */ }
      await chamar({ acao: "rel_fluxo_testar", fluxoId, telefone: t });
    },
    avisoTeste: numerosTeste.length
      ? `Isto MANDA o fluxo de verdade, pelo número do Relacionamento, pros ${numerosTeste.length} número(s) de teste: ${nomes}. Comece o fluxo por um Template. Continuar?`
      : "Isto MANDA as mensagens de verdade, pelo número do Relacionamento, só pro número que você digitar (dica: cadastre números de teste na aba Número e ritmo). Comece o fluxo por um Template (ou mande um 'oi' pro número antes). Continuar?",
    semRelatorio: true,
    acoesPermitidas: ACOES_REL,
    resumoInicio: "Quando você dispara pra um público",
    voltarRotulo: "Fluxos",
    ...extra,
  };
}

// ── Disparar o fluxo ────────────────────────────────────────────────────────

export interface DisparoFluxo {
  id: string; fluxo_id: string; publico: PublicoRel; status: "agendado" | "rodando" | "concluido" | "cancelado";
  agendado_para: string; total: number; excluidos: { motivo: string; n: number }[]; criado_em: string; iniciado_em: string | null; concluido_em: string | null;
}
export const dispararFluxo = (fluxoId: string, publico: PublicoRel, agendadoPara: string | null) =>
  chamar<{ disparo: DisparoFluxo }>({ acao: "rel_fluxo_disparar", fluxoId, publico, agendadoPara });
export const cancelarDisparo = (disparoId: string) => chamar<{ ok: true }>({ acao: "rel_fluxo_disparo_cancelar", disparoId });

/** 0414: o funil de cada disparo, igual ManyChat. */
export interface FunilDisparo { pessoas: number; enviadas: number; entregues: number; lidas: number; falharam: number; clicaram: number; terminaram: number }

export async function disparosDoFluxo(fluxoId: string): Promise<{ disparos: DisparoFluxo[]; andamento: Map<string, Record<string, number>>; funil: Map<string, FunilDisparo> }> {
  const [d, r, f] = await Promise.all([
    supabase.from("rel_fluxo_disparos").select("*").eq("fluxo_id", fluxoId).order("criado_em", { ascending: false }).limit(20),
    supabase.rpc("rel_fluxo_disparo_resumo", { p_fluxo: fluxoId }),
    supabase.rpc("rel_fluxo_disparo_funil", { p_fluxo: fluxoId }).then((x) => x.data ?? [], () => []),
  ]);
  const funil = new Map<string, FunilDisparo>();
  for (const l of f as (Record<keyof FunilDisparo, number> & { disparo_id: string })[]) {
    funil.set(l.disparo_id, { pessoas: Number(l.pessoas), enviadas: Number(l.enviadas), entregues: Number(l.entregues), lidas: Number(l.lidas), falharam: Number(l.falharam), clicaram: Number(l.clicaram), terminaram: Number(l.terminaram) });
  }
  const andamento = new Map<string, Record<string, number>>();
  for (const l of (r.data ?? []) as { disparo_id: string; estado: string; total: number }[]) {
    const x = andamento.get(l.disparo_id) ?? {};
    x[l.estado] = Number(l.total);
    andamento.set(l.disparo_id, x);
  }
  return { disparos: ok(d) as DisparoFluxo[], andamento, funil };
}

// ── Fluxo pronto pra começar ────────────────────────────────────────────────

/**
 * "Campanha de ativação": Início → Template (o modelo aprovado, com botões) →
 * pra quem tocar no 1º botão, uma mensagem + etiqueta + aviso pro time. A
 * pessoa troca o modelo, escreve as mensagens e liga os outros botões.
 */
export function grafoAtivacao(): Grafo {
  const inicio = noPadrao("inicio", 40, 200);
  const tpl = noPadrao("template", 330, 160);
  const msg = noPadrao("mensagem", 680, 60) as Extract<No, { tipo: "mensagem" }>;
  msg.titulo = "Quem quis saber mais";
  msg.dados = { ...msg.dados, blocos: [{ tipo: "texto", texto: "Oba, {{primeiro_nome}}! 😍 Já já alguém do time te chama aqui com todos os detalhes." }] };
  const acao = noPadrao("acao", 1030, 60) as Extract<No, { tipo: "acao" }>;
  acao.dados = { acoes: [{ tipo: "adicionar_tag", tag: "ativação: quer saber mais" }, { tipo: "avisar_humano", usuarios: [], mensagem: "{{primeiro_nome}} quer saber mais (campanha de ativação)." }] };
  return {
    nos: [inicio, tpl, msg, acao],
    ligacoes: [
      { id: novoId("l"), de: inicio.id, saida: "proximo", para: tpl.id },
      { id: novoId("l"), de: msg.id, saida: "proximo", para: acao.id },
    ],
  };
}

export function grafoVazio(): Grafo {
  const inicio = noPadrao("inicio", 40, 200);
  const tpl = noPadrao("template", 330, 160);
  return { nos: [inicio, tpl], ligacoes: [{ id: novoId("l"), de: inicio.id, saida: "proximo", para: tpl.id }] };
}
