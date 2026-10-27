// src/lib/discador/controlador.ts
// -----------------------------------------------------------------------------
// CONTROLADOR DO DISCADOR — executa o que o motor.ts decide.
//
// Abre as N chamadas (pernas) pelo webfone, traduz os eventos da JsSIP em
// eventos do motor, manda CANCEL/BYE, promove a 1ª que atender a chamada do
// SDR, grava as tentativas (qs_discador_tentativas, migration 0209) e entrega
// os desfechos das tarefas pra Fila de hoje aplicar com as MESMAS funções do
// Painel (o controlador não conhece regra de cadência).
//
// Liga/desliga: qs_settings.discador_ativo (desligado por padrão).
// Config:       qs_settings.discador_config (ver docs/DISCADOR.md).
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/qsSettings";
import {
  abrirPerna, encerrarDiscador, marcarDiscadorAtivo, prepararDiscador, promoverPerna, webphoneEmChamada,
  type PernaWebphone,
} from "@/lib/webphone";
import {
  aplicarEvento, acaoDaTarefa, detectarLimiteCanais, fecharLote, itensDevolvidos, leadsConsumidos, loteResolvido,
  marcarRecusasDaCentral, normalizarConfig, novaSessao, novoLote, proximoLote, reenfileirar,
  type ConfigDiscador, type EventoPerna, type ItemFila, type Lote, type SessaoDiscador,
} from "./motor";

// ── Config (qs_settings) ─────────────────────────────────────────────────────
export const DISCADOR_ATIVO_KEY = "discador_ativo";
export const DISCADOR_CONFIG_KEY = "discador_config";

export async function discadorLigado(): Promise<boolean> {
  return (await getSetting<boolean>(DISCADOR_ATIVO_KEY)) === true;
}
export async function carregarConfigDiscador(): Promise<ConfigDiscador> {
  return normalizarConfig(await getSetting<Partial<ConfigDiscador>>(DISCADOR_CONFIG_KEY));
}
export async function salvarConfigDiscador(ativo: boolean, cfg: ConfigDiscador): Promise<boolean> {
  const [a, b] = await Promise.all([
    setSetting(DISCADOR_ATIVO_KEY, ativo),
    setSetting(DISCADOR_CONFIG_KEY, normalizarConfig(cfg)),
  ]);
  return a && b;
}

// ── Contrato com a tela ──────────────────────────────────────────────────────
export interface DiscadorDeps {
  ownerId: string;
  /** Fila na ordem da Fila de hoje (já filtrada: dono, canal, telefone). */
  montarFila(): ItemFila[];
  /** Mesmo efeito do botão "Não atendeu"/"Nº errado" do Painel. */
  aplicarDesfecho(item: ItemFila, resultado: "nao_atendeu" | "numero_errado", detalhe: string): Promise<void>;
  /** Atendeu e foi derrubado: cria a extra urgente de retorno. */
  retornoUrgente(item: ItemFila): Promise<void>;
  /** A 1ª que atendeu: abre o lead/tarefa no card ativo. */
  abrirAtendida(item: ItemFila): void;
  dentroDoHorario(): boolean;
  /** Depois de cada lote (recarregar a fila). */
  aposLote(): void | Promise<void>;
}

export type FaseDiscador =
  | "parado" | "preparando" | "discando" | "processando" | "em_chamada" | "aguardando_sdr"
  | "pausado" | "fim" | "bloqueado";

export interface EstadoDiscador {
  fase: FaseDiscador;
  cfg: ConfigDiscador | null;
  sessao: SessaoDiscador | null;
  lote: Lote | null;
  /** Quantos ainda esperam na fila desta sessão. */
  naFila: number;
  mensagem: string | null;
  /** Lead em conversa (fase em_chamada / aguardando_sdr). */
  atendida: ItemFila | null;
}

const ESTADO_INICIAL: EstadoDiscador = {
  fase: "parado", cfg: null, sessao: null, lote: null, naFila: 0, mensagem: null, atendida: null,
};

function hojeYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function chaveLocal(uid: string): string {
  return `qs_discador_discados_${uid}_${hojeYmd()}`;
}
function lerLocal(uid: string): string[] {
  try { const v = localStorage.getItem(chaveLocal(uid)); return v ? (JSON.parse(v) as string[]) : []; } catch { return []; }
}
function gravarLocal(uid: string, ids: Iterable<string>): void {
  try { localStorage.setItem(chaveLocal(uid), JSON.stringify([...ids])); } catch { /* sem storage: segue só na memória */ }
}

/** Leads que o discador já ligou HOJE (banco + este navegador). */
async function carregarDiscadosHoje(uid: string): Promise<Set<string>> {
  const set = new Set(lerLocal(uid));
  try {
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("qs_discador_tentativas")
      .select("lead_id")
      .eq("owner_id", uid)
      .gte("iniciou_em", inicio.toISOString())
      .in("resultado", ["vencedora", "derrubada", "nao_atendeu", "ocupado", "invalido"])
      .limit(1000);
    if (!error) for (const r of (data ?? []) as { lead_id: string | null }[]) if (r.lead_id) set.add(r.lead_id);
  } catch { /* tabela ainda não criada (0209): fica o que o navegador lembra */ }
  return set;
}

let avisouTabela = false;
async function gravarTentativas(sessaoId: string, uid: string, lote: Lote): Promise<void> {
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const linhas = lote.pernas.map((p) => ({
    sessao_id: sessaoId,
    lote: lote.numero,
    owner_id: uid,
    lead_id: p.item.leadId,
    tarefa_id: p.item.tarefaId,
    telefone: p.item.telefone,
    resultado: p.status,
    sip_code: p.sipCode,
    iniciou_em: iso(p.inicioMs),
    tocou_em: iso(p.tocouMs),
    atendeu_em: iso(p.atendeuMs),
    terminou_em: iso(p.fimMs),
  }));
  try {
    const { error } = await supabase.from("qs_discador_tentativas").insert(linhas);
    if (error && !avisouTabela) { avisouTabela = true; console.warn("[discador] tentativas não gravadas (0209 aplicada?):", error.message); }
  } catch (e) {
    if (!avisouTabela) { avisouTabela = true; console.warn("[discador] tentativas não gravadas:", e); }
  }
}

// ── O controlador ────────────────────────────────────────────────────────────
export interface Discador {
  iniciar(): Promise<void>;
  continuar(): void;
  pausar(): void;
  parar(): void;
  subscribe(cb: (e: EstadoDiscador) => void): () => void;
  estado(): EstadoDiscador;
}

export function criarDiscador(deps: DiscadorDeps): Discador {
  let est: EstadoDiscador = { ...ESTADO_INICIAL };
  const ouvintes = new Set<(e: EstadoDiscador) => void>();
  const set = (patch: Partial<EstadoDiscador>) => {
    est = { ...est, ...patch };
    for (const cb of ouvintes) { try { cb(est); } catch { /* um ouvinte não derruba os outros */ } }
  };

  let cfg: ConfigDiscador | null = null;
  let sessao: SessaoDiscador | null = null;
  let fila: ItemFila[] = [];
  let consumidos = new Set<string>();
  const devolucoes = new Map<string, number>();
  let lote: Lote | null = null;
  let pernasDoLote: (PernaWebphone | null)[] = [];
  let relogio: ReturnType<typeof setInterval> | null = null;
  let proximoTimer: ReturnType<typeof setTimeout> | null = null;
  let loteFinalizado = false; // cada lote fecha a conta UMA vez só
  let pausarAposLote = false;
  let parado = true;
  let sessaoId = "";
  // Cada iniciar() ganha um número; um iniciar antigo que acorda depois de um
  // parar() (ou do duplo-efeito do React em dev) não pode seguir discando.
  let geracao = 0;

  const limparTimers = () => {
    if (relogio) { clearInterval(relogio); relogio = null; }
    if (proximoTimer) { clearTimeout(proximoTimer); proximoTimer = null; }
  };

  function despachar(ev: EventoPerna) {
    if (!lote || !cfg) return;
    const r = aplicarEvento(lote, ev);
    lote = r.lote;
    for (const c of r.comandos) {
      const perna = pernasDoLote[c.idx];
      const item = lote.pernas[c.idx]?.item;
      if (c.tipo === "promover") {
        if (perna && promoverPerna(perna.id) && item) {
          set({ fase: "em_chamada", atendida: item, mensagem: null });
          try { deps.abrirAtendida(item); } catch { /* tela */ }
        }
      } else {
        perna?.encerrar();
      }
    }
    // A conversa do SDR terminou?
    if (lote.vencedora !== null && lote.vencedoraEncerrada && est.fase === "em_chamada") {
      set({ fase: "aguardando_sdr" });
    }
    set({ lote });
    if (loteResolvido(lote) && !loteFinalizado) void finalizarLote();
  }

  async function finalizarLote() {
    if (!lote || !cfg || !sessao || loteFinalizado) return;
    loteFinalizado = true;
    if (relogio) { clearInterval(relogio); relogio = null; }
    const temVencedora = lote.vencedora !== null;
    if (!temVencedora) set({ fase: "processando" });
    try {
      const diag = detectarLimiteCanais(lote, cfg);
      lote = marcarRecusasDaCentral(lote, diag);
      sessao = fecharLote(sessao, lote, diag, cfg);
      for (const id of leadsConsumidos(lote)) consumidos.add(id);
      gravarLocal(deps.ownerId, consumidos);
      const r = reenfileirar(fila, itensDevolvidos(lote), devolucoes);
      fila = r.fila;
      set({ lote, sessao, naFila: fila.length, mensagem: sessao.avisos.at(-1) ?? est.mensagem });

      void gravarTentativas(sessaoId, deps.ownerId, lote);

      // Desfechos UM A UM (mesma razão do lote do Painel: corrida no banco e
      // rate limit do Bitrix). A vencedora fica com o SDR.
      for (const p of lote.pernas) {
        const acao = acaoDaTarefa(p.status);
        try {
          if (acao === "nao_atendeu" || acao === "numero_errado") {
            const detalhe = p.status === "ocupado" ? "ocupado" : p.status === "invalido" ? `número inválido${p.sipCode ? ` (${p.sipCode})` : ""}` : "não atendeu no discador";
            await deps.aplicarDesfecho(p.item, acao, detalhe);
          } else if (acao === "retorno") {
            await deps.retornoUrgente(p.item);
          }
        } catch (e) {
          console.warn("[discador] desfecho falhou:", e);
        }
      }
      try { await deps.aposLote(); } catch { /* tela */ }
    } catch (e) {
      console.warn("[discador] falha ao fechar o lote:", e);
    }

    if (sessao.bloqueio) { encerrar("bloqueado", sessao.bloqueio); return; }
    if (parado) return;
    if (temVencedora) {
      // Pausa até o SDR terminar a conversa e clicar Continuar.
      if (lote.vencedoraEncerrada) set({ fase: "aguardando_sdr" });
      return;
    }
    agendarProximo();
  }

  function agendarProximo() {
    if (parado) return;
    if (pausarAposLote) { pausarAposLote = false; set({ fase: "pausado", mensagem: "Pausado. Clique em Continuar quando quiser." }); return; }
    if (!fila.length) { encerrar("fim", "Acabou a fila de ligações de hoje."); return; }
    set({ fase: "discando" });
    proximoTimer = setTimeout(() => { proximoTimer = null; void discarLote(); }, cfg?.intervaloMs ?? 1500);
  }

  async function discarLote() {
    if (parado || !cfg || !sessao) return;
    if (!deps.dentroDoHorario()) { set({ fase: "pausado", mensagem: "Fora do horário de trabalho — o discador não liga agora." }); return; }
    if (webphoneEmChamada()) { set({ fase: "pausado", mensagem: "Você está em outra ligação — termine e clique em Continuar." }); return; }
    const { itens, resto } = proximoLote(fila, sessao.nAtual, consumidos);
    fila = resto;
    if (!itens.length) { encerrar("fim", "Acabou a fila de ligações de hoje."); return; }

    const t0 = Date.now();
    lote = novoLote(sessao.lotes + 1, itens, t0);
    pernasDoLote = [];
    loteFinalizado = false;
    set({ fase: "discando", lote, naFila: fila.length, atendida: null });

    itens.forEach((item, idx) => {
      const r = abrirPerna(item.telefone, { leadId: item.leadId, ownerId: deps.ownerId, leadName: item.nome ?? null }, {
        onTocando: () => despachar({ tipo: "tocando", idx, t: Date.now() }),
        onAtendeu: () => despachar({ tipo: "atendeu", idx, t: Date.now() }),
        onFalhou: (sipCode, cause) => {
          despachar({ tipo: "falhou", idx, t: Date.now(), sipCode, cause });
          despachar({ tipo: "encerrou", idx, t: Date.now() });
        },
        onEncerrou: () => despachar({ tipo: "encerrou", idx, t: Date.now() }),
      });
      if ("error" in r) {
        pernasDoLote[idx] = null;
        despachar({ tipo: "falhou", idx, t: Date.now(), sipCode: null, cause: r.error });
      } else {
        pernasDoLote[idx] = r;
      }
    });

    const toqueMs = cfg.toqueSeg * 1000;
    relogio = setInterval(() => despachar({ tipo: "relogio", t: Date.now(), toqueMs }), 250);
  }

  function encerrar(fase: FaseDiscador, mensagem: string | null) {
    parado = true;
    geracao += 1;
    limparTimers();
    marcarDiscadorAtivo(false);
    encerrarDiscador();
    set({ fase, mensagem });
  }

  return {
    async iniciar() {
      if (!parado) return;
      parado = false;
      const g = ++geracao;
      const valeAinda = () => !parado && g === geracao;
      pausarAposLote = false;
      set({ ...ESTADO_INICIAL, fase: "preparando", mensagem: "Conectando o ramal e o microfone…" });
      cfg = await carregarConfigDiscador();
      if (!valeAinda()) return;
      if (!(await discadorLigado())) { encerrar("parado", "O discador está desligado nas Configurações."); return; }
      if (!deps.dentroDoHorario()) { encerrar("parado", "Fora do horário de trabalho."); return; }
      const prep = await prepararDiscador();
      if (!prep.ok) { encerrar("parado", prep.error); return; }
      if (!valeAinda()) return; // clicou Parar enquanto preparava
      marcarDiscadorAtivo(true);
      sessao = novaSessao(cfg);
      consumidos = await carregarDiscadosHoje(deps.ownerId);
      if (!valeAinda()) return;
      devolucoes.clear();
      fila = deps.montarFila().filter((i) => !consumidos.has(i.leadId));
      sessaoId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
      set({ cfg, sessao, naFila: fila.length, mensagem: null });
      if (!fila.length) { encerrar("fim", "Nenhuma ligação com telefone discável na sua fila agora (ou todas já foram discadas hoje)."); return; }
      void discarLote();
    },
    continuar() {
      if (est.fase !== "aguardando_sdr" && est.fase !== "pausado") return;
      if (webphoneEmChamada()) { set({ mensagem: "Termine a ligação atual antes de continuar." }); return; }
      pausarAposLote = false;
      // A fila pode ter mudado (o SDR deu desfecho, chegou lead novo): mescla
      // os novos no fim sem repetir.
      const jaNaFila = new Set(fila.map((i) => i.tarefaId));
      for (const i of deps.montarFila()) if (!consumidos.has(i.leadId) && !jaNaFila.has(i.tarefaId)) fila.push(i);
      set({ fase: "discando", atendida: null, mensagem: null, naFila: fila.length });
      void discarLote();
    },
    pausar() {
      if (proximoTimer) { clearTimeout(proximoTimer); proximoTimer = null; set({ fase: "pausado", mensagem: "Pausado." }); return; }
      if (est.fase === "aguardando_sdr") { set({ fase: "pausado", mensagem: "Pausado." }); return; }
      pausarAposLote = true;
      set({ mensagem: "Vai pausar quando este lote terminar." });
    },
    parar() {
      if (lote && !loteResolvido(lote)) despachar({ tipo: "parar", t: Date.now() });
      encerrar("parado", "Discador parado.");
    },
    subscribe(cb) {
      ouvintes.add(cb);
      cb(est);
      return () => ouvintes.delete(cb);
    },
    estado: () => est,
  };
}
