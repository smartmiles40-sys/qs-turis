// src/components/sdr/carteira/CarteiraPage.tsx
// -----------------------------------------------------------------------------
// A CARTEIRA DO SDR.
//
// Substitui a "Cobertura de Leads", que respondia "quem está esperando contato
// AGORA" — uma pergunta de plantão, não de relacionamento. Some quando zera, e
// zerada ela não diz nada sobre a base que o SDR construiu ao longo de meses.
//
// A carteira responde outra: QUEM É MEU. Inclui quem já foi trabalhado, quem
// esfriou e quem nunca respondeu — e é exatamente aí que está o trabalho que
// ninguém estava fazendo, porque a fila do dia nunca aponta pra lá.
//
// -- A TELA TEM TRÊS ANDARES (03/09/2026) ------------------------------------
//
//   1. SAÚDE DA CARTEIRA — a nota de 0 a 100 por SDR, medindo a velocidade da
//      primeira atividade, mais as quatro métricas do dia. Ver SaudeCarteira.
//   2. INICIAR N LEADS — "quero 30 leads pra hoje": sorteia da carteira e joga
//      na fila de uma vez. É o botão que transforma estoque parado em trabalho.
//   3. A BUSCA — achar alguém específico (nome, telefone ou ID do Bitrix) e
//      reiniciar, sozinho ou em lote.
//
// -- FILTROS (12/11/2026) -----------------------------------------------------
//
// Lead Score, tempo sem contato e cadência — os mesmos do Gerenciamento de
// Leads. Moram DENTRO da janela "Iniciar leads hoje" (13/11, pedido do Bruno):
// o SDR escolhe ali "30 quentes sem contato há 30+ dias" em vez de 30
// quaisquer, vendo na hora quantos leads livres batem. "Sem contato" é a
// última atividade CONCLUÍDA (view qs_lead_ultimo_contato, 0375), não o
// updated_at — que muda com qualquer sync do Bitrix.
//
// -- O RETRABALHO NÃO PODE VIRAR DÍVIDA --------------------------------------
//
// A atividade criada aqui nasce pra HOJE e morre hoje (decisão do Bruno,
// 01/09). Se o SDR não executar, ela fecha sozinha como "não executada" e o
// lead volta pra carteira inteiro, pronto pra ser reiniciado outro dia.
//
// Isso é o oposto da cadência normal, e de propósito: retrabalho é trabalho
// EXTRA, feito quando sobra tempo. Se ele virasse atrasado, a primeira semana de
// uso encheria a fila de todo mundo com uma dívida que ninguém pediu — e a
// lição das 124 reuniões sem desfecho é que fila que não zera deixa de ser fila
// e vira ruído.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  varrerRetrabalhoVencido, reiniciarLead, reiniciarLeadHoje, reiniciarEmLote,
  sortear, TAG_RETRABALHO,
} from "@/lib/qs/carteira";
import {
  getRegua, fetchSaude, fetchSerie,
  type ReguaVelocidade, type SaudeSdr, type PontoSerie,
} from "@/lib/qs/carteiraSaude";
import { fetchActivityGoals, fetchAllRows } from "@/lib/qs/queries";
import {
  casaFiltrosCarteira, diasSemContato, temFiltroCarteira,
  FILTROS_CARTEIRA_VAZIOS, SEM_CADENCIA, SEM_SCORE, SEM_CONTATO_OPCOES,
  type FiltrosCarteira, type SemContatoFiltro,
} from "@/lib/qs/carteiraFiltro";
import { normalizeTemperature, type LeadTemperature } from "@/lib/leadScore";
import SaudeCarteira from "./SaudeCarteira";

/** O pedaço do lead que a carteira usa. */
interface LeadDaCarteira {
  id: string; full_name: string | null; phone: string | null; bitrix_id: string | null;
  status: string; segment: string | null; owner_id: string | null; cadence_id: string | null;
  lead_score: string | null;
  updated_at: string; created_at: string;
}

// Mesmos rótulos do filtro de temperatura do Gerenciamento de Leads.
const TEMP_ROTULO: Record<LeadTemperature, string> = {
  quente: "🔥 Quente",
  morno: "🌤️ Morno",
  frio: "❄️ Frio",
};

interface Props {
  onOpenLead: (leadId: string) => void;
}

interface ItemCarteira {
  chave: string;
  sdrId: string;
  sdrNome: string | null;
  substitutoNome: string | null;
  substitutoAte: string | null;
  /** O card mais recente deste telefone — é ele que o SDR abre e retrabalha. */
  leadId: string | null;
  /** Dono do CARD (não da chave): é dele a fila que vai receber a atividade. */
  donoId: string | null;
  nome: string | null;
  telefone: string | null;
  bitrixId: string | null;
  status: string | null;
  segmento: string | null;
  /** Lead Score cru do Bitrix (normalizado no filtro/chip). */
  leadScore: string | null;
  /**
   * Última atividade CONCLUÍDA (view qs_lead_ultimo_contato, 0375). null = nunca
   * houve contato. Sem a view no banco, cai no updated_at do lead (aproximado).
   */
  ultimoContato: string | null;
  cadenceId: string | null;
  temAtividadeAberta: boolean;
  temCadencia: boolean;
}

interface Cadencia { id: string; name: string }

const STATUS_ROTULO: Record<string, string> = {
  nao_iniciado: "Não iniciado",
  em_prospeccao: "Em prospecção",
  ganho: "Ganho",
  perdido: "Perdido",
};

/** Só dígitos — pra busca por telefone casar "(11) 99999-8888" com "1199999". */
function digitos(s: string): string {
  return s.replace(/\D/g, "");
}

export default function CarteiraPage({ onOpenLead }: Props) {
  const { currentUser } = useQsAuth();
  const gestor = currentUser ? canSeeAllData(currentUser.role) : false;

  const [itens, setItens] = useState<ItemCarteira[]>([]);
  const [cadencias, setCadencias] = useState<Cadencia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "esquecidos" | "sem_resposta">("todos");
  /** Lead Score, tempo sem contato e cadência — os mesmos do Gerenciamento de Leads. */
  const [filtros, setFiltros] = useState<FiltrosCarteira>(FILTROS_CARTEIRA_VAZIOS);
  /** true = a view 0375 não respondeu e o "sem contato" está usando updated_at. */
  const [contatoAproximado, setContatoAproximado] = useState(false);
  /** Quando o card de um SDR manda "ver esquecidos", a lista também filtra por ele. */
  const [donoFiltro, setDonoFiltro] = useState<string | null>(null);

  // ── Saúde ────────────────────────────────────────────────────────────────
  const [saude, setSaude] = useState<SaudeSdr[]>([]);
  const [serie, setSerie] = useState<Map<string, PontoSerie[]>>(new Map());
  const [metaDia, setMetaDia] = useState<number | null>(null);
  const [regua, setRegua] = useState<ReguaVelocidade | null>(null);

  // ── Reiniciar (um) ───────────────────────────────────────────────────────
  const [reiniciando, setReiniciando] = useState<ItemCarteira | null>(null);
  const [cadenciaEscolhida, setCadenciaEscolhida] = useState("");
  const [salvando, setSalvando] = useState(false);

  // ── Seleção múltipla + lote ──────────────────────────────────────────────
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [loteCadencia, setLoteCadencia] = useState<string | null>(null); // null = modal fechado
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);

  // ── Sortear N ────────────────────────────────────────────────────────────
  const [sorteioAberto, setSorteioAberto] = useState(false);
  const [quantidade, setQuantidade] = useState("30");
  const [sorteioCadencia, setSorteioCadencia] = useState(""); // "" = a própria de cada lead

  const carregar = useCallback(async () => {
    if (!currentUser) return;
    setCarregando(true);
    setErro(null);
    try {
      // A RLS da 0073 já corta pro dono (e pra quem está cobrindo). PAGINADO
      // (25/09): o PostgREST devolve no máximo 1000 linhas, em silêncio — a
      // Yanca via 536 dos 789 leads dela, e o gestor 1000 de 1.303 atividades
      // abertas (lead com atividade aparecia "livre" e o Iniciar duplicava).
      // 04/11: nomes, cadências e atividades abertas não dependem da carteira —
      // saem já, junto com ela (antes esperavam carteira e leads terminarem).
      const extrasP = Promise.all([
        supabase.from("qs_users").select("id, name"),
        supabase.from("qs_cadences").select("id, name").neq("status", "congelada").order("name"),
        fetchAllRows<{ lead_id: string }>((de, ate) =>
          supabase.from("qs_tasks").select("lead_id").in("status", ["pendente", "atrasada"]).order("id").range(de, ate)
        ),
        // Último contato = última atividade concluída (0375). Se a view ainda
        // não existe, devolve null e a tela cai no updated_at, avisando.
        fetchAllRows<{ lead_id: string; ultimo_contato: string }>((de, ate) =>
          supabase.from("qs_lead_ultimo_contato").select("lead_id, ultimo_contato").order("lead_id").range(de, ate)
        ).catch((e) => { console.warn("[carteira/ultimo_contato]", e); return null; }),
      ]);
      extrasP.catch(() => { /* tratado no await lá embaixo */ });
      const linhas = await fetchAllRows<{
        chave_telefone: string; sdr_id: string;
        substituto_id: string | null; substituto_ate: string | null;
      }>((de, ate) =>
        supabase
          .from("qs_carteira")
          .select("chave_telefone, sdr_id, substituto_id, substituto_ate")
          .order("chave_telefone")
          .range(de, ate)
      );

      const chaves = (linhas ?? []) as {
        chave_telefone: string; sdr_id: string;
        substituto_id: string | null; substituto_ate: string | null;
      }[];
      if (!chaves.length) { setItens([]); return; }

      // Os leads de quem está na carteira. A carteira é por TELEFONE e o lead é
      // por card, então casa-se pelo dono: o SDR só enxerga os cards dele mesmo,
      // que é o que ele vai retrabalhar.
      const donos = [...new Set(chaves.map((c) => c.substituto_id ?? c.sdr_id))];
      const leads = await fetchAllRows<LeadDaCarteira>((de, ate) =>
        supabase
          .from("qs_leads")
          .select("id, full_name, phone, bitrix_id, status, segment, owner_id, cadence_id, lead_score, updated_at, created_at")
          .in("owner_id", donos)
          .order("created_at", { ascending: false })
          .order("id")
          .range(de, ate)
      );

      const [{ data: usuarios }, { data: cads }, abertas, contatos] = await extrasP;

      const nomeDe = new Map((usuarios ?? []).map((u: { id: string; name: string }) => [u.id, u.name]));
      const comAtividade = new Set((abertas ?? []).map((t: { lead_id: string }) => t.lead_id));
      const ultimoContatoDe = contatos ? new Map(contatos.map((c) => [c.lead_id, c.ultimo_contato])) : null;
      setContatoAproximado(!ultimoContatoDe);
      setCadencias((cads ?? []) as Cadencia[]);

      // O card MAIS RECENTE de cada dono+telefone. Sem a chave do banco aqui, o
      // casamento é pelo dono — que basta: a carteira é dele.
      // 04/11: índice dono+fim do telefone, montado UMA vez. Antes, cada linha
      // da carteira varria todos os leads do dono (milhares × milhares no gestor).
      // A lista vem do mais recente pro mais antigo: o 1º que entra no índice é
      // o mesmo que o `find` achava.
      const porDonoTel = new Map<string, LeadDaCarteira>();
      for (const l of (leads ?? [])) {
        const k = `${l.owner_id}|${(l.phone ?? "").replace(/\D/g, "").slice(-8)}`;
        if (!porDonoTel.has(k)) porDonoTel.set(k, l);
      }

      const montados: ItemCarteira[] = [];
      for (const c of chaves) {
        const dono = c.substituto_id ?? c.sdr_id;
        // A chave da carteira são os 8 últimos dígitos (DDD+8). Comparar por aí
        // é o mesmo critério do banco, sem reimplementar qs_wa_key no navegador.
        const fim = c.chave_telefone.replace(/\D/g, "").slice(-8);
        const lead = porDonoTel.get(`${dono}|${fim}`) ?? null;
        montados.push({
          chave: c.chave_telefone,
          sdrId: c.sdr_id,
          sdrNome: nomeDe.get(c.sdr_id) ?? null,
          substitutoNome: c.substituto_id ? nomeDe.get(c.substituto_id) ?? null : null,
          substitutoAte: c.substituto_ate,
          leadId: lead?.id ?? null,
          donoId: lead?.owner_id ?? dono,
          nome: lead?.full_name ?? null,
          telefone: lead?.phone ?? null,
          bitrixId: lead?.bitrix_id ?? null,
          status: lead?.status ?? null,
          segmento: lead?.segment ?? null,
          leadScore: lead?.lead_score ?? null,
          ultimoContato: lead
            ? (ultimoContatoDe ? ultimoContatoDe.get(lead.id) ?? null : lead.updated_at)
            : null,
          cadenceId: lead?.cadence_id ?? null,
          temAtividadeAberta: lead ? comAtividade.has(lead.id) : false,
          temCadencia: !!lead?.cadence_id,
        });
      }
      // Sem card visível não há o que retrabalhar — a linha só faria volume.
      setItens(montados.filter((i) => i.leadId));
    } catch (e: unknown) {
      console.warn("[carteira]", e);
      setErro(
        (e as { message?: string })?.message?.includes("qs_carteira")
          ? "A carteira ainda não existe no banco — aplique a migration 0073."
          : "Não consegui carregar a carteira."
      );
    } finally {
      setCarregando(false);
    }
  }, [currentUser, gestor]);

  /**
   * A saúde vem por RPC (migration 0074) e não por consulta solta: a carteira do
   * time passa do teto de 1000 do PostgREST, e média sobre lista truncada não dá
   * erro — dá um número errado com cara de certo.
   */
  const carregarSaude = useCallback(async () => {
    // Espera a régua chegar em vez de buscá-la aqui: sem isso este callback
    // mudava de identidade ao gravar a régua e a tela fazia todas as consultas
    // duas vezes na abertura.
    if (!currentUser || !regua) return;
    try {
      const r = regua;
      const [linhas, pontos, metas] = await Promise.all([
        fetchSaude(r, 30),
        fetchSerie(r, 14),
        fetchActivityGoals(gestor ? null : currentUser.id),
      ]);
      setSaude(linhas);
      const m = new Map<string, PontoSerie[]>();
      for (const p of pontos) {
        const arr = m.get(p.owner_id) ?? [];
        arr.push(p);
        m.set(p.owner_id, arr);
      }
      setSerie(m);
      // Meta POR PESSOA: o card é de uma pessoa, então a soma do time (que o
      // fetchActivityGoals devolve pro admin) mentiria em cada card.
      const porPessoa = gestor ? (await fetchActivityGoals(currentUser.id)).daily : metas.daily;
      setMetaDia(porPessoa ?? metas.daily);
    } catch (e: unknown) {
      // A tela toda não pode cair porque a 0074 ainda não foi aplicada.
      console.warn("[carteira/saude]", e);
      setSaude([]);
    }
  }, [currentUser, gestor, regua]);

  useEffect(() => { void carregar(); }, [carregar]);
  // A régua primeiro, a saúde depois — ela é parâmetro das duas consultas.
  useEffect(() => { void getRegua().then(setRegua); }, []);
  useEffect(() => { void carregarSaude(); }, [carregarSaude]);
  // O retrabalho de ontem fecha sozinho. Idempotente e barato: uma varredura
  // por abertura de tela, no mesmo espírito do sweepOutcomeTasks.
  useEffect(() => { void varrerRetrabalhoVencido(); }, []);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const termoDigitos = digitos(termo);
    return itens.filter((i) => {
      if (donoFiltro && i.donoId !== donoFiltro) return false;
      if (termo) {
        // Três chaves de busca, e a do Bitrix é exata: digitar "123" não pode
        // trazer o lead 51234 no meio de quem procura o card 123.
        const porNome = (i.nome ?? "").toLowerCase().includes(termo);
        const porBitrix = (i.bitrixId ?? "").toLowerCase() === termo;
        const porFone = termoDigitos.length >= 4 && digitos(i.telefone ?? "").includes(termoDigitos);
        if (!porNome && !porBitrix && !porFone) return false;
      }
      if (filtro === "esquecidos") {
        return !i.temAtividadeAberta && i.status !== "ganho" && i.status !== "perdido";
      }
      if (filtro === "sem_resposta") return i.status === "perdido" || i.status === "nao_iniciado";
      return true;
    });
  }, [itens, busca, filtro, donoFiltro]);

  /** Quem pode receber atividade nova (sem atividade aberta), dentro da busca/aba da tela. */
  const livres = useMemo(
    () => visiveis.filter((i) => i.leadId && !i.temAtividadeAberta && i.status !== "ganho"),
    [visiveis]
  );

  /**
   * O "Iniciar leads hoje" sorteia daqui: os livres que batem com os filtros
   * de Lead Score / tempo sem contato / cadência escolhidos NA JANELA do sorteio.
   */
  const disponiveis = useMemo(() => {
    const agora = Date.now();
    return livres.filter((i) => casaFiltrosCarteira(i, filtros, agora));
  }, [livres, filtros]);

  const nomeCadencia = useMemo(() => new Map(cadencias.map((c) => [c.id, c.name])), [cadencias]);

  /** O recorte da TELA (aba, SDR, busca) que o sorteio também respeita — a janela avisa. */
  const resumoTela = useMemo(() => {
    const partes: string[] = [];
    if (filtro === "esquecidos") partes.push("parados sem atividade");
    if (filtro === "sem_resposta") partes.push("perdidos / não iniciados");
    if (donoFiltro) partes.push(`só ${saude.find((s) => s.owner_id === donoFiltro)?.nome ?? "um SDR"}`);
    if (busca.trim()) partes.push(`busca "${busca.trim()}"`);
    return partes;
  }, [filtro, donoFiltro, busca, saude]);
  const sorteioFiltrado = temFiltroCarteira(filtros) || resumoTela.length > 0;

  const listados = useMemo(() => visiveis.slice(0, 200), [visiveis]);

  function alternarSelecao(chave: string) {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
  }

  const selecionaveis = useMemo(
    () => listados.filter((i) => !i.temAtividadeAberta),
    [listados]
  );
  const todosSelecionados = selecionaveis.length > 0 && selecionaveis.every((i) => selecionados.has(i.chave));

  // ── Ações ────────────────────────────────────────────────────────────────

  async function reiniciarUmHoje(item: ItemCarteira) {
    if (!item.leadId || salvando) return;
    setSalvando(true);
    const r = await reiniciarLeadHoje(item.leadId, item.donoId ?? currentUser?.id ?? null);
    setSalvando(false);
    if (!r.ok) { notifyError(r.error); return; }
    notifySuccess(`${item.nome ?? "Lead"} na fila de hoje — ${r.tarefas} atividade(s).`);
    void carregar();
  }

  async function confirmarReinicio() {
    if (!reiniciando?.leadId || !cadenciaEscolhida) return;
    setSalvando(true);
    const r = await reiniciarLead(reiniciando.leadId, cadenciaEscolhida, reiniciando.donoId ?? currentUser?.id ?? null);
    setSalvando(false);
    if (!r.ok) { notifyError(r.error); return; }
    notifySuccess(
      `${reiniciando.nome ?? "Lead"} reiniciado — ${r.tarefas} atividade(s) na fila de HOJE. ` +
      "O que não for feito hoje fecha sozinho, sem virar atraso."
    );
    setReiniciando(null);
    setCadenciaEscolhida("");
    void carregar();
  }

  /** O caminho do lote: usado tanto pelo sorteio quanto pela seleção da busca. */
  async function rodarLote(alvos: ItemCarteira[], cadenceId: string | null) {
    if (alvos.length === 0) return;
    setProgresso({ feitos: 0, total: alvos.length });
    const r = await reiniciarEmLote(
      // Cada lead vai pro DONO dele (25/09): o gestor que dispara o lote não
      // pode virar dono das atividades da carteira do SDR.
      alvos.map((i) => ({ id: i.leadId!, nome: i.nome, donoId: i.donoId ?? null })),
      cadenceId,
      currentUser?.id ?? null,
      (feitos, total) => setProgresso({ feitos, total })
    );
    setProgresso(null);
    setSelecionados(new Set());

    if (r.reiniciados > 0) {
      notifySuccess(
        `${r.reiniciados} lead(s) na fila de hoje — ${r.tarefas} atividade(s). ` +
        "O que não for feito hoje fecha sozinho."
      );
    }
    if (r.falhas.length > 0) {
      // Falha silenciosa aqui seria o pior caso: o SDR acha que 30 entraram e
      // trabalha 24 sem saber. O primeiro motivo já explica o padrão.
      notifyError(
        `${r.falhas.length} não entrou(entraram). Primeiro: ${r.falhas[0].nome ?? "lead"} — ${r.falhas[0].motivo}`
      );
    }
    void carregar();
    void carregarSaude();
  }

  async function confirmarSorteio() {
    const n = Math.max(1, Math.min(200, parseInt(quantidade, 10) || 0));
    const alvos = sortear(disponiveis, n);
    setSorteioAberto(false);
    if (alvos.length === 0) {
      notifyError(sorteioFiltrado
        ? "Nenhum lead livre nesses filtros — afrouxe algum filtro e tente de novo."
        : "Não há lead livre na carteira pra iniciar — todos já têm atividade aberta.");
      return;
    }
    if (alvos.length < n) {
      notifySuccess(`Só havia ${alvos.length} lead(s) livre(s) ${sorteioFiltrado ? "nesses filtros" : "na carteira"}. Vou com esses.`);
    }
    await rodarLote(alvos, sorteioCadencia || null);
  }

  if (carregando) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-3">
        <div className="h-8 w-64 rounded bg-gray-100 animate-pulse" />
        <div className="h-32 rounded-xl bg-gray-100 animate-pulse" />
        <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  const totalEsquecidos = itens.filter(
    (i) => !i.temAtividadeAberta && i.status !== "ganho" && i.status !== "perdido"
  ).length;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Carteira de Leads</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {gestor
              ? "Quem é de quem. Cliente que volta cai sempre com o mesmo SDR, mesmo entrando por outro card."
              : "Seus clientes. Quem já é seu continua seu — mesmo voltando com outro card ou outro ID do Bitrix."}
          </p>
        </div>
        <button
          onClick={() => { setSorteioAberto(true); setQuantidade("30"); setSorteioCadencia(""); }}
          disabled={livres.length === 0 || !!progresso}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-[#0147FF] text-white text-sm font-bold hover:bg-[#0139cc] disabled:opacity-50"
          title={livres.length === 0
            ? (resumoTela.length ? "Nenhum lead livre no recorte atual" : "Todos os leads da carteira já têm atividade aberta")
            : `Escolha Lead Score, tempo sem contato e cadência e sorteie pra fila de hoje (${livres.length} livres)`}
        >
          Iniciar leads hoje
        </button>
      </header>

      {erro && <p className="mb-4 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-800">{erro}</p>}

      <SaudeCarteira
        linhas={saude}
        serie={serie}
        metaDia={metaDia}
        onVerEsquecidos={(ownerId) => {
          setFiltro("esquecidos");
          setDonoFiltro(gestor ? ownerId : null);
          setBusca("");
        }}
      />

      {/* ── Busca e filtros ─────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome, telefone ou ID do Bitrix…"
          className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
        />
        {([
          ["todos", `Todos (${itens.length})`],
          ["esquecidos", `Parados sem atividade (${totalEsquecidos})`],
          ["sem_resposta", "Perdidos / não iniciados"],
        ] as const).map(([k, rotulo]) => (
          <button
            key={k}
            onClick={() => { setFiltro(k); if (k !== "esquecidos") setDonoFiltro(null); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${
              filtro === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            {rotulo}
          </button>
        ))}
        {donoFiltro && (
          <button
            onClick={() => setDonoFiltro(null)}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-amber-200 bg-amber-50 text-amber-800"
          >
            Só {saude.find((s) => s.owner_id === donoFiltro)?.nome ?? "um SDR"} ✕
          </button>
        )}
      </div>

      {/* ── Barra do lote ───────────────────────────────────────────────── */}
      {selecionados.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#0147FF]/30 bg-[#0147FF]/[0.04] px-3 py-2">
          <span className="text-[13px] font-bold text-gray-900">{selecionados.size} selecionado(s)</span>
          <button
            onClick={() => void rodarLote(itens.filter((i) => selecionados.has(i.chave)), null)}
            disabled={!!progresso}
            className="px-3 py-1.5 rounded-lg bg-[#0147FF] text-white text-xs font-bold disabled:opacity-50"
          >
            Reiniciar hoje
          </button>
          <button
            onClick={() => setLoteCadencia("")}
            disabled={!!progresso}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-bold disabled:opacity-50"
          >
            Reiniciar com outra cadência
          </button>
          <button onClick={() => setSelecionados(new Set())} className="text-xs font-semibold text-gray-500 hover:underline">
            limpar seleção
          </button>
        </div>
      )}

      {progresso && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <p className="text-[13px] font-semibold text-gray-800">
            Colocando na fila… {progresso.feitos} de {progresso.total}
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-[#0147FF] transition-[width]" style={{ width: `${(progresso.feitos / progresso.total) * 100}%` }} />
          </div>
        </div>
      )}

      {visiveis.length === 0 ? (
        <p className="text-sm text-gray-500 py-10 text-center">
          {itens.length === 0
            ? "Sua carteira está vazia — ela se preenche sozinha conforme os leads entram."
            : "Nada nesse filtro."}
        </p>
      ) : (
        <>
          {selecionaveis.length > 0 && (
            <label className="mb-2 flex items-center gap-2 text-[12px] text-gray-600 select-none">
              <input
                type="checkbox"
                checked={todosSelecionados}
                onChange={() => setSelecionados(todosSelecionados
                  ? new Set()
                  : new Set(selecionaveis.map((i) => i.chave)))}
              />
              Selecionar os {selecionaveis.length} livres desta lista
            </label>
          )}

          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden bg-white">
            {listados.map((i) => {
              const dias = diasSemContato(i.ultimoContato);
              const temp = normalizeTemperature(i.leadScore);
              return (
                <li key={i.chave} className="flex items-center gap-3 px-4 py-3">
                  {!i.temAtividadeAberta && (
                    <input
                      type="checkbox"
                      checked={selecionados.has(i.chave)}
                      onChange={() => alternarSelecao(i.chave)}
                      className="shrink-0"
                      aria-label={`Selecionar ${i.nome ?? "lead"}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => i.leadId && onOpenLead(i.leadId)}
                      className="text-sm font-semibold text-gray-900 hover:text-[#0147FF] truncate block text-left"
                    >
                      {i.nome ?? "Sem nome"}
                    </button>
                    <p className="text-[11.5px] text-gray-500 truncate">
                      {STATUS_ROTULO[i.status ?? ""] ?? i.status ?? "—"}
                      {i.bitrixId ? ` · #${i.bitrixId}` : ""}
                      {temp ? ` · ${TEMP_ROTULO[temp]}` : ""}
                      {i.cadenceId ? ` · ${nomeCadencia.get(i.cadenceId) ?? "cadência congelada"}` : ""}
                      {i.segmento ? ` · ${i.segmento}` : ""}
                      {dias !== null
                        ? ` · sem contato há ${dias} dia${dias === 1 ? "" : "s"}`
                        : contatoAproximado ? "" : " · nunca contatado"}
                      {gestor && i.sdrNome ? ` · ${i.sdrNome}` : ""}
                      {i.substitutoNome ? ` · coberto por ${i.substitutoNome} até ${i.substitutoAte}` : ""}
                    </p>
                  </div>
                  {i.temAtividadeAberta ? (
                    // Já está na fila: reiniciar criaria atividade em cima de
                    // atividade e o SDR trabalharia o mesmo lead duas vezes.
                    <span className="shrink-0 text-[11px] text-gray-400 px-2">já está na fila</span>
                  ) : (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button
                        onClick={() => void reiniciarUmHoje(i)}
                        disabled={salvando || !i.temCadencia}
                        title={i.temCadencia
                          ? "Repete a cadência que ele já tinha, com as atividades caindo hoje"
                          : "Esse lead nunca esteve numa cadência — use Reiniciar cadência"}
                        className="px-3 py-1.5 rounded-lg bg-[#0147FF] text-white text-xs font-bold hover:bg-[#0139cc] disabled:opacity-40"
                      >
                        Reiniciar hoje
                      </button>
                      <button
                        onClick={() => { setReiniciando(i); setCadenciaEscolhida(""); }}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-bold hover:bg-gray-50"
                        title="Escolher outra cadência pra este lead"
                      >
                        Reiniciar cadência
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {visiveis.length > 200 && (
        <p className="mt-3 text-[12px] text-gray-500">
          Mostrando 200 de {visiveis.length}. Use a busca pra chegar em alguém específico.
        </p>
      )}

      {/* ── Sortear N leads ─────────────────────────────────────────────── */}
      {sorteioAberto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <h2 className="text-base font-bold text-gray-900">Iniciar leads hoje</h2>
            <p className="mt-1 text-[13px] text-gray-600">
              Escolha de onde sortear. Só entram leads sem nenhuma atividade aberta — quem já está na fila fica de
              fora, senão você trabalharia o mesmo lead duas vezes.
            </p>
            {resumoTela.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-gray-500">Respeitando a tela:</span>
                {resumoTela.map((p) => (
                  <span key={p} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">{p}</span>
                ))}
              </div>
            )}

            {/* Lead Score, tempo sem contato e cadência (mesmos do Gerenciamento de Leads) */}
            <label className="block mt-4 text-xs font-medium text-gray-700 mb-1">Lead Score</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TEMP_ROTULO) as LeadTemperature[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filtros.temp === k}
                  onClick={() => setFiltros((f) => ({ ...f, temp: f.temp === k ? "" : k }))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    filtros.temp === k ? "bg-[#0147FF] text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {TEMP_ROTULO[k]}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={filtros.temp === SEM_SCORE}
                onClick={() => setFiltros((f) => ({ ...f, temp: f.temp === SEM_SCORE ? "" : SEM_SCORE }))}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  filtros.temp === SEM_SCORE ? "bg-[#0147FF] text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Sem score
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sorteio-sem-contato" className="block text-xs font-medium text-gray-700 mb-1">Tempo sem contato</label>
                <select
                  id="sorteio-sem-contato"
                  value={filtros.semContato}
                  onChange={(e) => setFiltros((f) => ({ ...f, semContato: e.target.value as SemContatoFiltro }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
                >
                  <option value="">Qualquer</option>
                  {SEM_CONTATO_OPCOES.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="sorteio-cadencia-atual" className="block text-xs font-medium text-gray-700 mb-1">Cadência atual do lead</label>
                <select
                  id="sorteio-cadencia-atual"
                  value={filtros.cadenceId}
                  onChange={(e) => setFiltros((f) => ({ ...f, cadenceId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
                >
                  <option value="">Qualquer</option>
                  <option value={SEM_CADENCIA}>Sem cadência</option>
                  {cadencias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#0147FF]/[0.06] px-3 py-2">
              <span className="text-[13px] text-gray-800" aria-live="polite">
                <strong>{disponiveis.length}</strong> lead(s) livre(s) {temFiltroCarteira(filtros) ? "nesses filtros" : "na carteira"}
              </span>
              {temFiltroCarteira(filtros) && (
                <button
                  type="button"
                  onClick={() => setFiltros(FILTROS_CARTEIRA_VAZIOS)}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Limpar filtros
                </button>
              )}
            </div>
            {contatoAproximado && (
              <p className="mt-1 text-[11px] text-amber-700">"Sem contato" aproximado pela última alteração do lead.</p>
            )}

            <label className="block mt-4 text-xs font-medium text-gray-700 mb-1">Quantos leads</label>
            <input
              type="number"
              min={1}
              max={Math.min(200, Math.max(1, disponiveis.length))}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
            />

            <label className="block mt-3 text-xs font-medium text-gray-700 mb-1">Iniciar com a cadência</label>
            <select
              value={sorteioCadencia}
              onChange={(e) => setSorteioCadencia(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
            >
              <option value="">A mesma que cada lead já tinha</option>
              {cadencias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              O que você não fizer hoje <strong>fecha sozinho</strong> à meia-noite e não vira atraso.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSorteioAberto(false)} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={() => void confirmarSorteio()}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-white text-sm font-semibold"
              >
                Sortear e colocar na fila
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reiniciar UM com cadência escolhida ─────────────────────────── */}
      {reiniciando && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <h2 className="text-base font-bold text-gray-900">Reiniciar {reiniciando.nome ?? "lead"}</h2>
            <p className="mt-1 text-[13px] text-gray-600">
              Escolha a cadência. As atividades entram na fila de <strong>hoje</strong>.
            </p>

            <label className="block mt-4 text-xs font-medium text-gray-700 mb-1">Cadência</label>
            <select
              value={cadenciaEscolhida}
              onChange={(e) => setCadenciaEscolhida(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
            >
              <option value="">— escolha —</option>
              {cadencias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              O que você não fizer hoje <strong>fecha sozinho</strong> à meia-noite e não vira atraso.
              O lead volta pra carteira e pode ser reiniciado outro dia.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setReiniciando(null)} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={() => void confirmarReinicio()}
                disabled={!cadenciaEscolhida || salvando}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-white text-sm font-semibold disabled:opacity-50"
              >
                {salvando ? "Criando…" : "Colocar na fila de hoje"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reiniciar o LOTE com cadência escolhida ─────────────────────── */}
      {loteCadencia !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <h2 className="text-base font-bold text-gray-900">
              Reiniciar {selecionados.size} lead(s) com outra cadência
            </h2>
            <p className="mt-1 text-[13px] text-gray-600">
              Todos entram na mesma cadência, com as atividades caindo hoje.
            </p>

            <select
              value={loteCadencia}
              onChange={(e) => setLoteCadencia(e.target.value)}
              className="mt-4 w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
            >
              <option value="">— escolha —</option>
              {cadencias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setLoteCadencia(null)} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const cad = loteCadencia;
                  const alvos = itens.filter((i) => selecionados.has(i.chave));
                  setLoteCadencia(null);
                  void rodarLote(alvos, cad || null);
                }}
                disabled={!loteCadencia}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-white text-sm font-semibold disabled:opacity-50"
              >
                Colocar na fila de hoje
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 text-[11px] text-gray-400">
        As atividades de retrabalho ficam marcadas com <code>{TAG_RETRABALHO}</code> e não entram na conta de atraso.
        A nota da saúde mede a velocidade da 1ª atividade — a régua fica em Configurações → Carteira.
      </p>
    </div>
  );
}
