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
import type { DragEvent } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useQsAuth } from "@/contexts/QsAuthContext";

// ── Tipos ───────────────────────────────────────────────────────────────────

/** O que a rota de agendamento grava em qs_meetings.scheduled_by. */
const ASSINATURA_IA = "Glória (IA)";

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

/**
 * O PLACAR DELA.
 *
 * O quadro conta quem está em atendimento AGORA. Isso não responde a única
 * pergunta que decide se ela fica ou sai: ela está ajudando ou está entupindo a
 * agenda do especialista?
 *
 * A resposta já estava no banco e ninguém olhava. Toda reunião que ela marca
 * nasce com `scheduled_by = 'Glória (IA)'`, e o desfecho que o closer registra
 * vira o status. Então dá pra ler o funil inteiro sem tabela nova: marcou →
 * aconteceu → não apareceu.
 *
 * REUNIÃO MARCADA NÃO É A MÉTRICA. No-show alto custa mais caro que agenda
 * vazia — foi por isso que a regra dela virou "agendar certo, não agendar
 * muito". Por isso o número grande aqui é o de reuniões que ACONTECERAM, e o
 * de no-show fica do lado, sem eufemismo.
 */
interface Placar {
  marcadas: number;
  agendadas: number;
  realizadas: number;
  noShow: number;
  outras: number;
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

/**
 * De onde cada coluna VEM.
 *
 * Usada quando alguém tenta soltar um card numa coluna que não aceita. A
 * resposta útil ali não é "não pode": é dizer que aquela coluna é consequência
 * de uma coisa que aconteceu na conversa, e por isso não é um lugar onde se
 * põe card.
 */
const PORQUE_A_COLUNA: Record<string, string> = {
  nova: "o começo do atendimento",
  qualificando: "quantas das 5 perguntas o lead já respondeu",
  qualificada: "o lead ter respondido as 5",
  em_follow_up: "a cadência estar tocando porque o lead sumiu",
  transferida: "a IA ter entregado a conversa pro time",
  com_o_time: "alguém do time ter respondido na conversa",
  sem_resposta: "a cadência ter terminado sem o lead voltar",
};

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

// ── Lead de teste ───────────────────────────────────────────────────────────
// A expedição de interesse NÃO é um campo: a view a extrai de `segment` pelo
// que estiver entre colchetes (`[Islândia] - Tráfego`). O prompt da Glória
// recebe esse valor, e sem ele ela abre a conversa sem saber de qual viagem se
// está falando — que é justamente o que o teste precisa exercitar.
const EXPEDICOES = [
  "Islândia", "Egito", "Japão", "Tailândia", "Turquia e Grécia",
  "Itália", "Peru", "Amazônia", "Japão e China",
];

/** O sufixo que marca o lead como teste no lugar de `Tráfego` / `Orgânico`. */
const ORIGEM_TESTE = "Teste IA";

/**
 * Mesma regra do servidor (`waKey` em api/_wa.js): a comparação de telefone que
 * sobrevive a qualquer formatação são os 8 dígitos finais.
 */
function ultimos8(raw: string): string {
  return raw.replace(/\D/g, "").slice(-8);
}

/** Guarda no formato dos outros leads: só dígitos, com o 55 na frente. */
function telefoneCanonico(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function PipelineIAPage({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const [linhas, setLinhas] = useState<LinhaPipeline[]>([]);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [placar, setPlacar] = useState<Placar | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Achado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [adicionando, setAdicionando] = useState<string | null>(null);

  const { currentUser } = useQsAuth();
  const [formTeste, setFormTeste] = useState(false);
  const [teste, setTeste] = useState({ nome: "", telefone: "", expedicao: EXPEDICOES[0] });
  const [salvandoTeste, setSalvandoTeste] = useState(false);

  const carregar = useCallback(async (inicial = false) => {
    if (inicial) setCarregando(true);
    try {
      const [quadro, cadencia, chaves, reunioes] = await Promise.all([
        supabase.from("qs_gloria_pipeline").select("*").eq("no_pipeline", true).order("atualizada_em", { ascending: false }),
        supabase.from("qs_gloria_passos").select("ordem, atraso_min, tipo, instrucao, ativo").order("ordem"),
        supabase.from("qs_settings").select("key, value")
          .in("key", ["gloria_ativa", "gloria_so_pipeline", "gloria_toque_inicio", "gloria_toque_fim"]),
        // O placar. `scheduled_by` é texto livre no banco (o n8n do Bitrix lê
        // dele), e a rota de agendamento dela grava sempre esta frase exata.
        supabase.from("qs_meetings").select("status").eq("scheduled_by", ASSINATURA_IA),
      ]);

      if (quadro.error) throw quadro.error;
      setLinhas((quadro.data ?? []) as LinhaPipeline[]);
      setPassos(((cadencia.data ?? []) as Passo[]).filter((p) => p.ativo));
      setConfig(Object.fromEntries(((chaves.data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])));

      // O placar não pode derrubar a tela: ele é o extra, o quadro é o
      // essencial. Se a consulta falhar (RLS, coluna nova), fica sem placar.
      const status = ((reunioes.data ?? []) as { status: string }[]).map((m) => m.status);
      setPlacar(reunioes.error ? null : {
        marcadas: status.length,
        // "confirmada" ainda vai acontecer, então conta junto com "agendada":
        // são as que ainda estão de pé, esperando o dia chegar.
        agendadas: status.filter((s) => s === "agendada" || s === "confirmada").length,
        realizadas: status.filter((s) => s === "realizada").length,
        noShow: status.filter((s) => s === "no_show").length,
        outras: status.filter((s) => s === "reagendada" || s === "cancelada").length,
      });
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

  /**
   * REABRIR: devolver um lead de uma coluna final para "Nova".
   *
   * É a mesma `qs_gloria_entrar_no_pipeline` que a busca usa, e isso não é
   * economia de código, é a definição certa: "voltar pra Nova" É uma estadia
   * nova. Ela liga a sessão, limpa o motivo, zera os toques e carimba
   * `entrou_em = now()` — e esse carimbo é o que dá os 30 minutos de carência
   * da 0061. Sem ele, um lead calado há 20h voltaria pro quadro e levaria o
   * toque 3 (a despedida da cadência) no minuto seguinte, porque a fila conta
   * pelo silêncio do lead, não pelo tempo de pipeline.
   *
   * A etapa não é escolhida por quem arrasta: ela é recalculada do que o lead
   * já respondeu. Quem tinha 3 de 5 volta pra "Qualificando", não pra "Nova" —
   * e está certo, porque a coluna é leitura do estado, não um lugar onde a
   * gente guarda o card.
   */
  const reabrir = useCallback(async (leadId: string, nome: string) => {
    await colocarNoPipeline(leadId, nome);
  }, [colocarNoPipeline]);

  /**
   * ARRASTAR CARD, MAS SÓ PRO QUE EXISTE.
   *
   * Kanban comum guarda a coluna do card. Aqui não: a coluna é CALCULADA pela
   * view a partir do estado real (a sessão está ligada? quantas respostas? quem
   * falou por último?). Arrastar um card pra "Qualificada" não faria o lead ter
   * respondido as 5 perguntas — faria a tela mentir, e no primeiro F5 o card
   * voltaria pro lugar, o que é pior do que não deixar arrastar.
   *
   * Então soltar só vale onde existe uma AÇÃO por trás. Hoje é uma: "Nova",
   * que reabre o atendimento. As outras recusam e dizem de onde a coluna vem —
   * é a mesma informação que o `title` do cabeçalho dá, na hora em que a
   * pessoa está perguntando.
   */
  const soltarEm = useCallback(async (coluna: string, e: DragEvent) => {
    e.preventDefault();
    setAlvo(null);
    const leadId = e.dataTransfer.getData("text/lead");
    const nome = e.dataTransfer.getData("text/nome") || "o lead";
    setArrastando(null);
    if (!leadId) return;
    if (coluna === "nova") { await reabrir(leadId, nome); return; }
    notifyError(
      `"${COLUNAS.find((c) => c.id === coluna)?.label}" não é um lugar onde se põe o card: ela é ` +
      `${PORQUE_A_COLUNA[coluna] ?? "calculada do estado do lead"}. Pra trazer ${nome} de volta pra IA, ` +
      `solte em "Nova".`
    );
  }, [reabrir]);

  /**
   * CADASTRAR UM LEAD DE TESTE e já jogar no pipeline, numa tacada.
   *
   * O trabalho de verdade daqui é o passo 2, não o insert: **se já existe um
   * lead com esse telefone, ele é REAPROVEITADO**. O webhook do WhatsApp casa a
   * mensagem com o lead pelos 8 dígitos finais e desempata por `updated_at`
   * (`findLeadByPhone`, api/_wa.js) — dois leads com o mesmo número brigam pela
   * conversa, e a mensagem de teste cai naquele que por acaso foi tocado por
   * último. Quem estivesse testando veria a Glória "não responder" sem nunca
   * descobrir que a conversa foi parar no lead gêmeo.
   *
   * O dono é quem cadastrou, de propósito: sem `owner_id` o gatilho de rodízio
   * (0008) entrega o lead de teste pra uma SDR de verdade, que abre a fila e
   * encontra um cliente que não existe.
   */
  const cadastrarTeste = useCallback(async () => {
    const nome = teste.nome.trim();
    const digitos = teste.telefone.replace(/\D/g, "");
    if (nome.length < 2) { notifyError("Dê um nome ao lead de teste."); return; }
    if (digitos.length < 10) { notifyError("Telefone incompleto — precisa de DDD + número."); return; }

    setSalvandoTeste(true);
    try {
      // 1. Esse telefone já é de alguém?
      const chave = ultimos8(digitos);
      const { data: existentes } = await supabase
        .from("qs_leads")
        .select("id, full_name, phone, status")
        .ilike("phone", `%${chave}%`)
        .order("updated_at", { ascending: false })
        .limit(20);

      const gemeo = ((existentes ?? []) as { id: string; full_name: string | null; phone: string | null; status: string }[])
        .find((l) => ultimos8(l.phone ?? "") === chave);

      if (gemeo) {
        notifySuccess(`Esse número já é do lead "${gemeo.full_name || "sem nome"}" — reaproveitei em vez de criar um duplicado.`);
        setFormTeste(false);
        setTeste({ nome: "", telefone: "", expedicao: EXPEDICOES[0] });
        await colocarNoPipeline(gemeo.id, gemeo.full_name || nome);
        return;
      }

      // 2. Não existe: cadastra.
      const partes = nome.split(" ");
      const { data: criado, error } = await supabase
        .from("qs_leads")
        .insert({
          full_name: nome,
          first_name: partes[0],
          last_name: partes.slice(1).join(" ") || null,
          phone: telefoneCanonico(digitos),
          segment: `[${teste.expedicao}] - ${ORIGEM_TESTE}`,
          owner_id: currentUser?.id ?? null,
          source: "manual",
          status: "nao_iniciado",
          arrived_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error || !criado) throw error ?? new Error("o banco não devolveu o lead criado");

      setFormTeste(false);
      setTeste({ nome: "", telefone: "", expedicao: EXPEDICOES[0] });
      await colocarNoPipeline(criado.id, nome);
    } catch (e: unknown) {
      notifyError((e as { message?: string })?.message ?? "não deu pra cadastrar o lead de teste");
    } finally {
      setSalvandoTeste(false);
    }
  }, [teste, currentUser, colocarNoPipeline]);

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

      {/* ── O placar ──────────────────────────────────────────────────────── */}
      {placar && placar.marcadas > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 md:px-6 py-4">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div>
              <p className="text-[13px] font-semibold text-gray-900">O que ela já entregou</p>
              <p className="text-[12px] text-gray-500 mt-0.5">
                Reuniões marcadas pela Glória, pelo desfecho que o especialista registrou.
                O número que vale é o das que aconteceram.
              </p>
            </div>
          </div>

          <div className="flex items-stretch flex-wrap gap-3">
            <div className="rounded-lg px-4 py-3 min-w-[110px]" style={{ background: "#F0FDF4" }}>
              <p className="text-[24px] font-bold leading-none" style={{ color: "#16A34A" }}>{placar.realizadas}</p>
              <p className="text-[12px] text-gray-600 mt-1.5">aconteceram</p>
            </div>
            <div className="rounded-lg px-4 py-3 min-w-[110px]" style={{ background: "#EEF4FF" }}>
              <p className="text-[24px] font-bold leading-none" style={{ color: "#0147FF" }}>{placar.agendadas}</p>
              <p className="text-[12px] text-gray-600 mt-1.5">ainda de pé</p>
            </div>
            <div className="rounded-lg px-4 py-3 min-w-[110px]" style={{ background: placar.noShow > 0 ? "#FEF2F2" : "#F9FAFB" }}>
              <p className="text-[24px] font-bold leading-none" style={{ color: placar.noShow > 0 ? "#B4242A" : "#9CA3AF" }}>{placar.noShow}</p>
              <p className="text-[12px] text-gray-600 mt-1.5">não apareceram</p>
            </div>
            {placar.outras > 0 && (
              <div className="rounded-lg px-4 py-3 min-w-[110px]" style={{ background: "#F9FAFB" }}>
                <p className="text-[24px] font-bold leading-none text-gray-500">{placar.outras}</p>
                <p className="text-[12px] text-gray-600 mt-1.5">remarcadas ou canceladas</p>
              </div>
            )}
            <div className="flex items-center px-2 text-[12px] text-gray-500 max-w-xs">
              {placar.realizadas + placar.noShow === 0
                ? `${placar.marcadas} marcada${placar.marcadas > 1 ? "s" : ""}, nenhuma com desfecho registrado ainda. O placar de verdade começa quando a primeira acontecer.`
                : `${Math.round((placar.realizadas / (placar.realizadas + placar.noShow)) * 100)}% de comparecimento nas que já tiveram desfecho.`}
            </div>
          </div>
        </div>
      )}

      {/* ── Colocar lead no pipeline ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 md:px-6 py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="text-[13px] font-semibold text-gray-900 mb-1">Colocar um lead no atendimento por IA</p>
            <p className="text-[12px] text-gray-500">
              As atividades pendentes do plano humano são encerradas — é o que se está pedindo ao mover o lead.
              Reunião marcada e cliente ganho não entram.
            </p>
          </div>
          <button
            onClick={() => setFormTeste((v) => !v)}
            className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            {formTeste ? "Cancelar" : "Cadastrar lead de teste"}
          </button>
        </div>

        {/* ── Lead de teste ─────────────────────────────────────────────────
            Existe pra não obrigar quem está testando a sair da tela, ir em
            Leads, cadastrar, voltar e procurar. E, principalmente, pra que o
            teste use SEMPRE um lead de teste: colocar um cliente de verdade no
            pipeline encerra as atividades pendentes dele na fila de uma SDR. */}
        {formTeste && (
          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-3 max-w-lg">
            <p className="text-[12px] text-gray-600 mb-3">
              Use o seu próprio celular. <strong>Você</strong> tem que mandar a primeira mensagem pro número
              oficial: fora da janela de 24h do WhatsApp só passa template aprovado, e a Glória não tem nenhum.
            </p>
            <div className="space-y-2">
              <input
                value={teste.nome}
                onChange={(e) => setTeste((t) => ({ ...t, nome: e.target.value }))}
                placeholder="Nome (ex.: Arthur Teste IA)"
                className="w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 focus:outline-none focus:border-blue-400"
              />
              <input
                value={teste.telefone}
                onChange={(e) => setTeste((t) => ({ ...t, telefone: e.target.value }))}
                placeholder="WhatsApp com DDD (ex.: 11 99222-1156)"
                inputMode="tel"
                className="w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 focus:outline-none focus:border-blue-400"
              />
              <label className="block">
                <span className="text-[11px] text-gray-500">Expedição de interesse</span>
                <select
                  value={teste.expedicao}
                  onChange={(e) => setTeste((t) => ({ ...t, expedicao: e.target.value }))}
                  className="mt-0.5 w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 focus:outline-none focus:border-blue-400"
                >
                  {EXPEDICOES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                <span className="text-[11px] text-gray-400">
                  É o que a Glória vê como interesse do lead. Pergunte o preço dessa mesma expedição no teste —
                  citar o valor da viagem errada é o erro mais caro que ela pode cometer.
                </span>
              </label>
            </div>
            <button
              disabled={salvandoTeste}
              onClick={() => void cadastrarTeste()}
              className="mt-3 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
              style={{ background: "#0147FF" }}
            >
              {salvandoTeste ? "cadastrando…" : "Cadastrar e colocar na IA"}
            </button>
            {!ligada && (
              <p className="text-[11px] mt-2" style={{ color: "#9A3412" }}>
                A IA está desligada (<code>gloria_ativa = false</code>) — o lead entra no quadro, mas ela não
                responde até alguém ligar.
              </p>
            )}
          </div>
        )}
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
      {!carregando && linhas.length > 0 && (
        <p className="text-[12px] text-gray-500 px-1">
          As colunas são <strong className="text-gray-700">leitura do estado</strong>, não gavetas: elas saem do que
          aconteceu na conversa. Por isso só dá pra arrastar um card de volta pra <strong className="text-gray-700">Nova</strong>,
          que é a única que tem ação por trás — reabre o atendimento pela IA, zera os toques e dá 30 minutos de carência.
        </p>
      )}
      {carregando ? (
        <p className="text-[13px] text-gray-400 px-1">carregando o quadro…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUNAS.map((col) => {
            const cards = porColuna.get(col.id) ?? [];
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  // preventDefault é o que AUTORIZA o drop. Só na "Nova": nas
                  // outras o cursor continua de "não pode", que é a resposta
                  // certa antes de a pessoa soltar.
                  if (!arrastando || col.id !== "nova") return;
                  e.preventDefault();
                  setAlvo(col.id);
                }}
                onDragLeave={() => setAlvo((a) => (a === col.id ? null : a))}
                onDrop={(e) => void soltarEm(col.id, e)}
                className="shrink-0 w-[268px] bg-white rounded-xl border flex flex-col transition-colors"
                style={alvo === col.id
                  ? { borderColor: col.cor, background: "#F8FAFF" }
                  : { borderColor: "#E5E7EB" }}
              >
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
                      <div
                        key={l.lead_id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/lead", l.lead_id);
                          e.dataTransfer.setData("text/nome", l.nome);
                          e.dataTransfer.effectAllowed = "move";
                          setArrastando(l.lead_id);
                        }}
                        onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                        className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2 hover:bg-white transition-colors cursor-grab active:cursor-grabbing"
                        style={arrastando === l.lead_id ? { opacity: 0.4 } : undefined}
                      >
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
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Arrastar é bonito e ninguém descobre sozinho. Nas
                                colunas finais o botão faz a mesma coisa. */}
                            {!l.ativa && (
                              <button
                                onClick={() => void reabrir(l.lead_id, l.nome)}
                                disabled={adicionando === l.lead_id}
                                className="text-[10px] font-semibold text-[#0147FF] hover:underline disabled:opacity-50"
                                title="Reabrir o atendimento por IA: liga a sessão de novo, zera os toques e dá 30 min de carência antes do próximo"
                              >
                                {adicionando === l.lead_id ? "…" : "reabrir"}
                              </button>
                            )}
                            <button
                              onClick={() => void tirarDoPipeline(l.lead_id, l.nome)}
                              className="text-[10px] font-semibold text-gray-400 hover:text-[#B4242A]"
                              title="Tirar este lead do atendimento por IA"
                            >
                              tirar
                            </button>
                          </div>
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
