// src/components/sdr/gloria/PipelineIAPage.tsx
// -----------------------------------------------------------------------------
// ATENDIMENTO IA — o quadro da Glória.
//
// Duas coisas ao mesmo tempo, e é de propósito:
//
// 1. É O ACOMPANHAMENTO. Quantos leads a IA está atendendo agora, em que ponto
//    da qualificação cada um está, quem sumiu, quem ela devolveu pro time e por
//    quê. Sem isto, "a IA está funcionando?" só se responde abrindo conversa por
//    conversa no WhatsApp.
//
// 2. É O SANDBOX. Quem está aqui é atendido pela IA; quem não está, não é. A
//    trava mora no banco (`gloria_so_pipeline`, migration 0060) — esta tela é o
//    jeito de ver e mexer nela sem SQL.
//
// A COLUNA DO CARD NÃO É UM CAMPO. Ela é calculada pela view `qs_gloria_pipeline`
// a partir do estado real (sessão ativa? quantas respostas? quantos toques? quem
// falou por último?). Guardar a coluna numa coluna seria guardar a mesma verdade
// em dois lugares — e os dois divergem no primeiro caso estranho.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

// ── Tipos ───────────────────────────────────────────────────────────────────

interface LinhaPipeline {
  lead_id: string;
  nome: string;
  full_name: string | null;
  phone: string | null;
  expedicao: string | null;
  dono: string | null;
  ativa: boolean;
  etapa: string;
  motivo: string | null;
  temperatura: string | null;
  respondidas: number;
  toques: number;
  resumo: string | null;
  entrou_em: string | null;
  ultimo_toque_em: string | null;
  ultima_mensagem: string | null;
  parado_min: number | null;
  coluna: string;
}

interface Passo {
  ordem: number;
  atraso_min: number;
  tipo: string;
  instrucao: string;
  ativo: boolean;
}

interface Achado {
  id: string;
  full_name: string | null;
  phone: string | null;
  segment: string | null;
}

// ── As colunas do quadro ────────────────────────────────────────────────────
// A ordem é a da vida do lead, da esquerda pra direita. As três últimas são
// finais: ninguém sai delas sozinho.
const COLUNAS: { id: string; label: string; cor: string; ajuda: string }[] = [
  { id: "nova",         label: "Nova",              cor: "#0147FF", ajuda: "Ela entrou na conversa. Nenhuma das 5 perguntas respondida ainda." },
  { id: "qualificando", label: "Qualificando",      cor: "#7C3AED", ajuda: "O lead está respondendo. De 1 a 4 das 5 perguntas." },
  { id: "em_follow_up", label: "Em follow-up",      cor: "#EA580C", ajuda: "O lead sumiu no meio. A cadência da IA está tocando (3 toques dentro das 24h)." },
  { id: "qualificada",  label: "Qualificada",       cor: "#16A34A", ajuda: "As 5 respostas. Daqui sai a call com o especialista." },
  { id: "transferida",  label: "Devolvida ao time", cor: "#0891B2", ajuda: "A IA saiu e deixou nota + tarefa pro dono do lead." },
  { id: "com_o_time",   label: "Assumida por gente", cor: "#64748B", ajuda: "Alguém do time respondeu no meio — a IA se desligou sozinha nesta conversa." },
  { id: "sem_resposta", label: "Sem resposta",      cor: "#B4242A", ajuda: "A cadência terminou e o lead não voltou. Já virou tarefa pra uma pessoa." },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function tempoCurto(min: number | null): string {
  if (min == null || !Number.isFinite(min)) return "—";
  if (min < 60) return `${Math.max(min, 0)}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function corDaTemperatura(t: string | null): { bg: string; text: string } | null {
  switch (t) {
    case "Quente": return { bg: "#FEF2F2", text: "#B4242A" };
    case "Morno":  return { bg: "#FFF7ED", text: "#9A3412" };
    case "Frio":   return { bg: "#EFF6FF", text: "#1D4ED8" };
    default: return null;
  }
}

// O `motivo` é escrito por quem desligou a sessão — banco, rota ou gatilho.
// Aqui ele vira frase de gente.
const MOTIVOS: Record<string, string> = {
  qualificado: "qualificação concluída",
  pedido_humano: "o lead pediu uma pessoa",
  urgencia: "urgência",
  reclamacao: "reclamação",
  duvida_sem_resposta: "pergunta fora da base",
  fora_da_janela_24h: "fora da janela de 24h",
  erro_da_ia: "erro da IA",
  sem_resposta: "cadência esgotada",
  "humano assumiu a conversa": "alguém do time respondeu",
  saiu_do_pipeline: "tirado do pipeline",
};

// ── Página ──────────────────────────────────────────────────────────────────

export default function PipelineIAPage({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const [linhas, setLinhas] = useState<LinhaPipeline[]>([]);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Achado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [adicionando, setAdicionando] = useState<string | null>(null);

  const carregar = useCallback(async (inicial = false) => {
    if (inicial) setCarregando(true);
    try {
      const [quadro, cadencia, chaves] = await Promise.all([
        supabase.from("qs_gloria_pipeline").select("*").eq("no_pipeline", true).order("atualizada_em", { ascending: false }),
        supabase.from("qs_gloria_passos").select("ordem, atraso_min, tipo, instrucao, ativo").order("ordem"),
        supabase.from("qs_settings").select("key, value")
          .in("key", ["gloria_ativa", "gloria_so_pipeline", "gloria_toque_inicio", "gloria_toque_fim"]),
      ]);

      if (quadro.error) throw quadro.error;
      setLinhas((quadro.data ?? []) as LinhaPipeline[]);
      setPassos(((cadencia.data ?? []) as Passo[]).filter((p) => p.ativo));
      setConfig(Object.fromEntries(((chaves.data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])));
      setErro(null);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "falha ao carregar";
      // Tabela/view ausente = a 0060 ainda não foi colada. É o erro mais
      // provável na primeira vez, e merece uma frase que diga o que fazer.
      setErro(/qs_gloria_pipeline|qs_gloria_passos|does not exist|schema cache/i.test(msg)
        ? "A migration 0060 ainda não foi aplicada no banco — cole supabase/migrations/0060_gloria_pipeline.sql no SQL Editor do Supabase."
        : msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(true);
    // O quadro é feito de tempo parado ("sumiu há 4h"): congelado até o F5 ele
    // engana. 60s é o mesmo ritmo dos outros painéis do QS.
    const t = setInterval(() => { if (!document.hidden) void carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  // ── Busca pra colocar um lead no pipeline ────────────────────────────────
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 3) { setAchados([]); return; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const digitos = termo.replace(/\D/g, "");
        const filtro = digitos.length >= 4
          ? `full_name.ilike.%${termo}%,phone.ilike.%${digitos}%`
          : `full_name.ilike.%${termo}%`;
        const { data } = await supabase
          .from("qs_leads")
          .select("id, full_name, phone, segment")
          .or(filtro)
          .not("status", "in", "(ganho,perdido)")
          .limit(8);
        if (vivo) setAchados((data ?? []) as Achado[]);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca]);

  const colocarNoPipeline = useCallback(async (leadId: string, nome: string) => {
    setAdicionando(leadId);
    try {
      const { data, error } = await supabase.rpc("qs_gloria_entrar_no_pipeline", { p_lead: leadId });
      if (error) throw error;
      const r = data as { ok?: boolean; motivo?: string; tarefas_encerradas?: number };
      if (!r?.ok) {
        const porque: Record<string, string> = {
          lead_ganho: "esse lead já é cliente",
          tem_reuniao_marcada: "esse lead tem reunião marcada — a IA não entra por cima disso",
          sem_cadencia_de_ia: "não existe cadência de IA no banco (rode a 0060)",
          sem_permissao: "você não é dono desse lead",
          lead_inexistente: "lead não encontrado",
        };
        notifyError(`Não deu pra colocar ${nome} no pipeline: ${porque[r?.motivo ?? ""] ?? r?.motivo ?? "motivo desconhecido"}`);
        return;
      }
      notifySuccess(
        `${nome} entrou no atendimento por IA` +
        (r.tarefas_encerradas ? ` — ${r.tarefas_encerradas} atividade(s) do plano humano foram encerradas` : "")
      );
      setBusca("");
      setAchados([]);
      void carregar();
    } catch (e: unknown) {
      notifyError((e as { message?: string })?.message ?? "falha ao colocar no pipeline");
    } finally {
      setAdicionando(null);
    }
  }, [carregar]);

  const tirarDoPipeline = useCallback(async (leadId: string, nome: string) => {
    try {
      const { error } = await supabase.rpc("qs_gloria_tirar_do_pipeline", { p_lead: leadId, p_cadencia: null });
      if (error) throw error;
      notifySuccess(`${nome} saiu do atendimento por IA. O lead ficou sem cadência — vincule a uma cadência humana se for seguir com ele.`);
      void carregar();
    } catch (e: unknown) {
      notifyError((e as { message?: string })?.message ?? "falha ao tirar do pipeline");
    }
  }, [carregar]);

  // ── Derivados ────────────────────────────────────────────────────────────
  const porColuna = useMemo(() => {
    const mapa = new Map<string, LinhaPipeline[]>();
    for (const c of COLUNAS) mapa.set(c.id, []);
    for (const l of linhas) {
      if (!mapa.has(l.coluna)) mapa.set(l.coluna, []);
      mapa.get(l.coluna)!.push(l);
    }
    return mapa;
  }, [linhas]);

  const ativos = useMemo(
    () => linhas.filter((l) => ["nova", "qualificando", "em_follow_up", "qualificada"].includes(l.coluna)).length,
    [linhas]
  );
  const qualificadas = useMemo(() => linhas.filter((l) => l.respondidas >= 5).length, [linhas]);
  const responderam = useMemo(() => linhas.filter((l) => l.respondidas > 0).length, [linhas]);

  const ligada = String(config.gloria_ativa) === "true";
  const soPipeline = config.gloria_so_pipeline === undefined || String(config.gloria_so_pipeline) === "true";

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 md:px-6 py-4 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[18px] font-bold text-gray-900">Atendimento IA</h1>
            <p className="text-[13px] text-gray-500 mt-0.5 max-w-2xl">
              O pipeline da Glória. Quem está aqui é atendido por ela: responde, qualifica,
              faz follow-up quando o lead some e devolve pro time. Quem não está aqui não é atendido pela IA.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[12px] font-semibold px-2.5 py-1 rounded-full"
              style={ligada
                ? { background: "#E1F5F0", color: "#0F766E" }
                : { background: "#F3F4F6", color: "#4B5563" }}
              title={ligada ? "qs_settings.gloria_ativa = true" : "qs_settings.gloria_ativa = false"}
            >
              {ligada ? "IA ligada" : "IA desligada"}
            </span>
            {soPipeline && (
              <span
                className="text-[12px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: "#EEF4FF", color: "#0147FF" }}
                title="qs_settings.gloria_so_pipeline = true"
              >
                só o pipeline
              </span>
            )}
            <button
              onClick={() => void carregar()}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Atualizar
            </button>
          </div>
        </div>

        <div className="px-4 md:px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center flex-wrap gap-4 text-[13px] text-gray-600">
          <span><strong className="text-gray-900">{ativos}</strong> em atendimento agora</span>
          <span className="text-gray-300">|</span>
          <span><strong className="text-gray-900">{responderam}</strong> responderam alguma pergunta</span>
          <span className="text-gray-300">|</span>
          <span><strong className="text-gray-900">{qualificadas}</strong> qualificados (5/5)</span>
          <span className="text-gray-300">|</span>
          <span><strong className="text-gray-900">{linhas.length}</strong> no total</span>
        </div>
      </div>

      {erro && (
        <div
          className="rounded-xl px-4 py-3 text-[13px] font-medium"
          style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err-ink)" }}
        >
          {erro}
        </div>
      )}

      {/* ── Colocar lead no pipeline ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 md:px-6 py-4">
        <p className="text-[13px] font-semibold text-gray-900 mb-1">Colocar um lead no atendimento por IA</p>
        <p className="text-[12px] text-gray-500 mb-3">
          As atividades pendentes do plano humano são encerradas — é o que se está pedindo ao mover o lead.
          Reunião marcada e cliente ganho não entram.
        </p>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome ou telefone do lead (3 letras já buscam)"
          className="w-full max-w-lg text-[13px] border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 focus:outline-none focus:border-blue-400"
        />
        {buscando && <p className="text-[12px] text-gray-400 mt-2">procurando…</p>}
        {achados.length > 0 && (
          <div className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-lg max-w-lg">
            {achados.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-gray-900 truncate">{a.full_name || "Sem nome"}</p>
                  <p className="text-[11px] text-gray-400 truncate">{a.phone || "sem telefone"}{a.segment ? ` · ${a.segment}` : ""}</p>
                </div>
                <button
                  disabled={adicionando === a.id}
                  onClick={() => void colocarNoPipeline(a.id, a.full_name || "o lead")}
                  className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
                  style={{ background: "#0147FF" }}
                >
                  {adicionando === a.id ? "…" : "Colocar na IA"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── O quadro ──────────────────────────────────────────────────────── */}
      {carregando ? (
        <p className="text-[13px] text-gray-400 px-1">carregando o quadro…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUNAS.map((col) => {
            const cards = porColuna.get(col.id) ?? [];
            return (
              <div key={col.id} className="shrink-0 w-[268px] bg-white rounded-xl border border-gray-200 flex flex-col">
                <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2" title={col.ajuda}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col.cor }} />
                  <span className="text-[13px] font-semibold text-gray-900 flex-1">{col.label}</span>
                  <span className="text-[12px] font-bold text-gray-400">{cards.length}</span>
                </div>

                <div className="p-2 space-y-2 min-h-[80px]">
                  {cards.length === 0 && (
                    <p className="text-[11px] text-gray-300 px-1 py-3">vazio</p>
                  )}
                  {cards.map((l) => {
                    const temp = corDaTemperatura(l.temperatura);
                    return (
                      <div key={l.lead_id} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2 hover:bg-white transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => onOpenLead?.(l.lead_id)}
                            className="text-left text-[13px] font-semibold text-gray-900 truncate hover:text-[#0147FF] hover:underline min-w-0"
                            title="Abrir o lead"
                          >
                            {l.nome}
                          </button>
                          {temp && (
                            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: temp.bg, color: temp.text }}>
                              {l.temperatura}
                            </span>
                          )}
                        </div>

                        {l.expedicao && l.expedicao !== "nao informada" && (
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{l.expedicao}</p>
                        )}

                        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
                          <span title="respostas da qualificação">{l.respondidas}/5</span>
                          {l.toques > 0 && <span title="toques da cadência da IA">· {l.toques} toque{l.toques > 1 ? "s" : ""}</span>}
                          <span title="tempo desde a última mensagem">· parado {tempoCurto(l.parado_min)}</span>
                        </div>

                        {!l.ativa && l.motivo && (
                          <p className="text-[11px] text-gray-500 mt-1 truncate" title={l.motivo}>
                            {MOTIVOS[l.motivo] ?? l.motivo}
                          </p>
                        )}

                        <div className="flex items-center justify-between gap-2 mt-1.5">
                          <span className="text-[10px] text-gray-400 truncate">{l.dono ?? "sem dono"}</span>
                          <button
                            onClick={() => void tirarDoPipeline(l.lead_id, l.nome)}
                            className="text-[10px] font-semibold text-gray-400 hover:text-[#B4242A]"
                            title="Tirar este lead do atendimento por IA"
                          >
                            tirar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── A cadência ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 md:px-6 py-4">
        <p className="text-[13px] font-semibold text-gray-900">A cadência da Glória</p>
        <p className="text-[12px] text-gray-500 mt-0.5 mb-3">
          O que ela faz quando o lead some no meio da conversa. Os três toques cabem dentro de 24 horas
          porque, fora disso, o WhatsApp só entrega template aprovado — e template é decisão comercial, não de IA.
          Passou disso sem resposta, a conversa vira nota e tarefa pro dono do lead.
          {config.gloria_toque_inicio != null && (
            <> Os toques só saem entre {String(config.gloria_toque_inicio)}h e {String(config.gloria_toque_fim)}h.</>
          )}
        </p>
        <div className="space-y-2">
          {passos.map((p) => (
            <div key={p.ordem} className="flex items-start gap-3 text-[12px]">
              <span className="shrink-0 font-bold text-gray-900 w-16">
                +{p.atraso_min >= 60 ? `${Math.round(p.atraso_min / 60)}h` : `${p.atraso_min}min`}
              </span>
              <span className="text-gray-600">{p.instrucao}</span>
            </div>
          ))}
          {passos.length === 0 && <p className="text-[12px] text-gray-400">nenhum passo cadastrado</p>}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Para mudar os toques: <code>qs_gloria_passos</code> no Supabase. O relógio conta do último
          silêncio do lead, então quem responde e some de novo recomeça a régua.
        </p>
      </div>
    </div>
  );
}
