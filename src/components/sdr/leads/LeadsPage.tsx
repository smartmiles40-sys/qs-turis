import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData, podeExecutar } from "@/contexts/QsAuthContext";
import WhatsAppModal from "@/components/sdr/whatsapp/WhatsAppModal";
import ImportarListaCsv from "./ImportarListaCsv";
import type {
  Lead,
  LeadStatus,
  LeadSource,
  SdrUser,
  Cadence,
  LossReason,
} from "../types";
import { STATUS_LABELS, SOURCE_LABELS } from "../types";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { createCadenceTasks, closeOpenCadenceTasks, transferLead, fetchAllRows, fetchPorIds, LEAD_SELECT } from "@/lib/qs/queries";
import { aplicarFiltrosLeads, type FiltrosLeads } from "@/lib/qs/leadsFiltro";
import type { LeadTemperature } from "@/lib/leadScore";
import { dialViaSip } from "@/lib/sip";
import { dialViaWebphone, isWebphoneConfigured } from "@/lib/webphone";
import { lerFiltroDaUrl, useFiltrosNaUrl, useFontes } from "@/controle-comercial/filtroUrl";

// ── Props ────────────────────────────────────────────────────────────────────

interface LeadsPageProps {
  onOpenLead: (leadId: string) => void;
  onOpenCadenceCreate: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<LeadStatus, { bg: string; text: string }> = {
  nao_iniciado: { bg: "bg-gray-100", text: "text-gray-700" },
  em_prospeccao: { bg: "bg-blue-50", text: "text-blue-700" },
  ganho: { bg: "bg-green-50", text: "text-green-700" },
  perdido: { bg: "bg-red-50", text: "text-red-700" },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Rótulos do filtro de temperatura (lead_score vem do Bitrix; normalizado em leadScore.ts).
const TEMP_FILTER_LABELS: Record<LeadTemperature, string> = {
  quente: "🔥 Quente",
  morno: "🌤️ Morno",
  frio: "❄️ Frio",
};

// Paginação COMPACTA: primeira / … / vizinhas da atual / … / última.
// Antes era 1 botão por página (300 botões com 3k leads).
function pageItems(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1, current - 1, current, current + 1, total]
    .filter((p, i, arr) => p >= 1 && p <= total && arr.indexOf(p) === i)
    .sort((a, b) => a - b);
  const out: (number | "...")[] = [];
  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev === 2) out.push(prev + 1); // buraco de 1 = mostra o número
    else if (prev && p - prev > 2) out.push("...");
    out.push(p);
    prev = p;
  }
  return out;
}

const ITEMS_PER_PAGE = 10;

// ── Component ────────────────────────────────────────────────────────────────

export default function LeadsPage({ onOpenLead }: LeadsPageProps) {
  const { currentUser } = useQsAuth();
  // Espectador (marketing) vê tudo e não muda nada. O banco recusa de verdade
  // (gatilho da 0036); aqui só evitamos oferecer botão que vai falhar.
  const executa = podeExecutar(currentUser?.role);
  const [search, setSearch] = useState("");
  // A busca vai pro BANCO desde 04/11 — espera a pessoa parar de digitar
  // (300 ms) em vez de mandar uma consulta por tecla.
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [filterSource, setFilterSource] = useState<LeadSource | "">("");
  const [filterStatus, setFilterStatus] = useState<LeadStatus | "">("");
  const [filterCadence, setFilterCadence] = useState("");
  // Fonte (segment) e SDR responsável ficam no endereço (?fonte=&sdr=), 28/10.
  const [filterOwner, setFilterOwner] = useState(() => lerFiltroDaUrl("sdr"));
  const [filterFonte, setFilterFonte] = useState(() => lerFiltroDaUrl("fonte"));
  useFiltrosNaUrl(filterFonte, filterOwner);
  const [filterLossReason, setFilterLossReason] = useState("");
  // Temperatura (lead_score do Bitrix, agora editável no detalhe): Quente/Morno/Frio.
  const [filterTemp, setFilterTemp] = useState<LeadTemperature | "">("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Vínculo em massa à cadência em andamento — desabilita o select durante o
  // loop (evita disparar um segundo vínculo por cima do primeiro).
  const [cadenceLinking, setCadenceLinking] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);

  // ── Handover state ──
  const [showHandover, setShowHandover] = useState(false);
  const [handoverCloserId, setHandoverCloserId] = useState(""); // destino
  const [handoverBriefing, setHandoverBriefing] = useState("");
  const [handoverSaving, setHandoverSaving] = useState(false);
  const [handoverError, setHandoverError] = useState<string | null>(null);
  // Item 6 — handover por quantidade (admin): tira N leads de um SDR e manda pra outro
  const [handoverMode, setHandoverMode] = useState<"selecao" | "quantidade">("selecao");
  const [handoverFromId, setHandoverFromId] = useState("");
  const [handoverQty, setHandoverQty] = useState("10");
  const [handoverAge, setHandoverAge] = useState<"novos" | "antigos">("novos");
  const isHandoverAdmin = currentUser?.role === "admin" || currentUser?.role === "gestor";

  // ── WhatsApp modal state ──
  const [waLead, setWaLead] = useState<{ id: string; name: string | null; phone: string | null } | null>(null);

  // ── Data state ──
  // `leads` = SÓ A PÁGINA da tela (10 linhas) desde 04/11. Antes era a base
  // inteira; tudo que precisa do conjunto (exportar, ações em lote, handover
  // por quantidade) agora busca no banco NA HORA da ação, com os mesmos filtros.
  const [leads, setLeads] = useState<Lead[]>([]);
  // Quantos leads passam nos filtros (count "exact" da própria página).
  const [totalFiltrado, setTotalFiltrado] = useState(0);
  // Fonte de cada lead visível pra este usuário — alimenta o select "Fonte"
  // com contagem e o "N leads cadastrados". Busca só a coluna segment, em
  // segundo plano: a lista não espera por ela.
  const [segmentos, setSegmentos] = useState<{ segment: string | null }[] | null>(null);
  // Troca de página/filtro: a tabela continua na tela, só esmaece.
  const [carregandoPagina, setCarregandoPagina] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [users, setUsers] = useState<SdrUser[]>([]);
  const [cadences, setCadences] = useState<Cadence[]>([]);
  const [lossReasons, setLossReasons] = useState<LossReason[]>([]);
  const [loading, setLoading] = useState(true);
  // Erro de rede/RLS ao carregar: sem isso a tela mentia "Nenhum lead encontrado".
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Create Lead form state ──
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formSource, setFormSource] = useState<LeadSource>("manual");
  // Responsável do lead manual: SDR/closer = sempre o próprio (fixo); gestor/admin
  // pode escolher ("" = automático → round-robin do banco). Sem isso o trigger
  // dava o lead a OUTRO SDR e ele sumia da tela de quem cadastrou.
  const [formOwnerId, setFormOwnerId] = useState("");
  // Duplicado encontrado na checagem pré-insert (telefone/e-mail já existem).
  const [dupLead, setDupLead] = useState<{ id: string; name: string | null; ownerName: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  // ABRIR (OU NÃO) O NEGÓCIO NO BITRIX — escolha explícita no cadastro manual
  // (Bruno, 09/09). Guardada em estado porque o caminho do DUPLICADO ("Cadastrar
  // mesmo assim") é um segundo clique, noutro botão: sem lembrar o que a pessoa
  // escolheu, o lead forçado ia sempre pro caminho errado, calado.
  const [criarNoBitrix, setCriarNoBitrix] = useState(false);
  const isManager = currentUser?.role === "admin" || currentUser?.role === "gestor";

  // ── Filtros (vão pro banco) ──
  // SDR/closer só veem a própria carteira nesta tela — era o filtro por papel
  // que rodava no navegador; virou um eq no banco. A RLS continua sendo quem
  // protege de verdade.
  const somenteDoDono = currentUser && !canSeeAllData(currentUser.role) ? currentUser.id : null;
  const filtros = useMemo<FiltrosLeads>(() => ({
    busca: buscaAplicada,
    source: filterSource,
    status: filterStatus,
    cadenceId: filterCadence,
    ownerId: filterOwner,
    fonte: filterFonte,
    lossReasonId: filterLossReason,
    temp: filterTemp,
    somenteDoDono,
  }), [buscaAplicada, filterSource, filterStatus, filterCadence, filterOwner, filterFonte, filterLossReason, filterTemp, somenteDoDono]);

  // Busca com espera: só consulta quando a pessoa para de digitar.
  useEffect(() => {
    if (search === buscaAplicada) return;
    const t = setTimeout(() => { setBuscaAplicada(search); setCurrentPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search, buscaAplicada]);

  // ── Fetch data ──
  // Só a resposta da ÚLTIMA consulta vale: trocar de página/filtro rápido
  // dispara várias, e uma lenta chegando depois não pode pintar a tela velha.
  const ultimaConsulta = useRef(0);
  const fetchLeads = useCallback(async () => {
    // PAGINADO NO SERVIDOR desde 04/11: antes baixava a base inteira (5.784
    // leads × ~1 KB ≈ 6 MB, 2,7–3,3 s no ar) pra mostrar 10 linhas. Agora o
    // banco filtra, ordena e conta (`count: "exact"`) e devolve só a página.
    // O `id` no order desempata created_at igual (lote de importação) pra
    // nenhuma página repetir ou pular linha.
    const seq = ++ultimaConsulta.current;
    setCarregandoPagina(true);
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    try {
      const { data, error, count } = await aplicarFiltrosLeads(
        supabase.from("qs_leads").select(LEAD_SELECT, { count: "exact" }),
        filtros
      )
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, from + ITEMS_PER_PAGE - 1);
      if (seq !== ultimaConsulta.current) return;
      if (error) {
        // Página além do fim (exclusão/transferência encolheu a lista): o
        // PostgREST responde 416. Não é erro pra mostrar — volta pra página 1.
        if (error.code === "PGRST103" && currentPage > 1) { setCurrentPage(1); return; }
        throw error;
      }
      setLoadError(null);
      setLeads((data ?? []) as unknown as Lead[]);
      setTotalFiltrado(count ?? 0);
    } catch (e) {
      if (seq !== ultimaConsulta.current) return;
      const error = e as { code?: string; message?: string };
      console.warn("Erro ao buscar leads:", error);
      // Erro de rede NÃO pode virar "Nenhum lead encontrado" — a tela mostra o
      // erro com "Tentar novamente" (e mantém a lista antiga, se houver).
      // O código do erro vai junto: em 2026-07-28 a tela acusou "verifique a
      // conexão" por DUAS SEMANAS enquanto o problema real era um PGRST201
      // (embed ambíguo). Culpar a internet escondeu a causa — agora ela aparece.
      const code = error.code;
      setLoadError(
        code && code !== "PGRST301"
          ? `Não foi possível carregar os leads (erro ${code}).`
          : "Não foi possível carregar os leads — verifique a conexão."
      );
    } finally {
      if (seq === ultimaConsulta.current) {
        setCarregandoPagina(false);
        setLoading(false);
      }
    }
  }, [filtros, currentPage]);

  // Página/filtro mudou → busca de novo (inclui a primeira carga).
  useEffect(() => { void fetchLeads(); }, [fetchLeads]);

  // Fontes + total da base, em segundo plano. Só a coluna segment (≈40 bytes
  // por lead em vez de ~1 KB), paginada por id pra passar do teto de 1.000.
  // Falhou? A lista segue funcionando; só o select "Fonte" fica sem opções.
  const carregarSegmentos = useCallback(async () => {
    try {
      const rows = await fetchAllRows<{ segment: string | null }>((from, to) =>
        supabase.from("qs_leads").select("segment").order("id").range(from, to) as unknown as
          PromiseLike<{ data: { segment: string | null }[] | null; error: { message?: string } | null }>
      );
      setSegmentos(rows);
    } catch (e) {
      console.warn("Erro ao buscar as fontes dos leads:", e);
    }
  }, []);

  // Depois de cadastrar/excluir/importar: a página E o total/fontes mudam.
  const recarregarTudo = useCallback(async () => {
    await Promise.all([fetchLeads(), carregarSegmentos()]);
  }, [fetchLeads, carregarSegmentos]);

  async function retryFetchLeads() {
    setLoading(true);
    await fetchLeads();
  }

  useEffect(() => {
    void carregarSegmentos();
    async function loadAll() {
      const [usersRes, cadencesRes, lossRes] = await Promise.all([
        supabase.from("qs_users").select("*").eq("is_active", true),
        // "status" incluso: o modal CSV filtra cadências "disponivel" — sem a
        // coluna no select, o filtro zerava as opções e ninguém conseguia
        // importar COM cadência.
        supabase.from("qs_cadences").select("id, name, status"),
        supabase.from("qs_loss_reasons").select("*").eq("is_archived", false),
      ]);

      if (usersRes.error) console.warn("Erro ao buscar users:", usersRes.error);
      else setUsers((usersRes.data as SdrUser[]) ?? []);

      if (cadencesRes.error) console.warn("Erro ao buscar cadences:", cadencesRes.error);
      else setCadences((cadencesRes.data as Cadence[]) ?? []);

      if (lossRes.error) console.warn("Erro ao buscar loss reasons:", lossRes.error);
      else setLossReasons((lossRes.data as LossReason[]) ?? []);
      // O "Carregando..." agora sai quando a 1ª PÁGINA chega (fetchLeads), sem
      // esperar estas listas — os selects se preenchem logo em seguida.
    }
    loadAll();
  }, [carregarSegmentos]);

  // ── Create Lead ──
  // Checagem de duplicado ANTES do insert (auditoria 2026-07-14): dois SDRs podem
  // cadastrar o mesmo lead. Compara telefone (só dígitos, casando sufixo — cobre
  // o "55" na frente) OU e-mail (minúsculo) contra o que o BANCO devolve na hora.
  // Implementada INLINE (não em queries.ts) pra não colidir com a sprint paralela.
  // Obs.: a busca enxerga o que a RLS deixa este usuário ler — gestor vê a base
  // toda; SDR vê a própria carteira (checagem entre carteiras pede RPC/migration).
  async function findDuplicateLead(
    email: string,
    phone: string
  ): Promise<{ ok: boolean; dup: { id: string; name: string | null; ownerName: string | null } | null }> {
    const emailNorm = email.trim().toLowerCase();
    const phoneDigits = phone.replace(/\D/g, "");
    if (!emailNorm && phoneDigits.length < 8) return { ok: true, dup: null }; // sem contato comparável

    // Busca DIRIGIDA em vez de baixar a base: o select seco cortava em 1.000
    // (teto do PostgREST) e a base tem 1.398 — a checagem deixava duplicado
    // passar justamente nos leads que a tela também não mostrava. Peneira
    // grossa no banco (e-mail exato / últimos 8 dígitos), decisão fina no JS
    // logo abaixo, que segue idêntica.
    // FK explícita: ver comentário do LEAD_SELECT (qs_wa_pins tornou o embed ambíguo).
    const COLS = "id, full_name, email, phone, owner:qs_users!qs_leads_owner_id_fkey(name)";
    const [porEmail, porFone] = await Promise.all([
      emailNorm
        ? supabase.from("qs_leads").select(COLS).ilike("email", emailNorm).limit(20)
        : Promise.resolve({ data: [], error: null }),
      phoneDigits.length >= 8
        ? supabase.from("qs_leads").select(COLS).ilike("phone", `%${phoneDigits.slice(-8)}%`).limit(20)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const error = porEmail.error ?? porFone.error;
    if (error) {
      console.warn("Erro na checagem de duplicado:", error);
      return { ok: false, dup: null };
    }
    const data = [...(porEmail.data ?? []), ...(porFone.data ?? [])];
    const rows = (data ?? []) as unknown as Array<{
      id: string; full_name: string | null; email: string | null; phone: string | null;
      owner: { name: string | null } | null;
    }>;
    const hit = rows.find((l) => {
      const le = (l.email ?? "").trim().toLowerCase();
      const lp = (l.phone ?? "").replace(/\D/g, "");
      const emailHit = !!emailNorm && le === emailNorm;
      const phoneHit =
        phoneDigits.length >= 8 && lp.length >= 8 && (lp.endsWith(phoneDigits) || phoneDigits.endsWith(lp));
      return emailHit || phoneHit;
    });
    return { ok: true, dup: hit ? { id: hit.id, name: hit.full_name, ownerName: hit.owner?.name ?? null } : null };
  }

  /**
   * Abre o negócio no Bitrix para um lead que ACABOU de nascer no QS.
   *
   * O trabalho é o mesmo que o webhook e o WhatsApp já faziam sozinhos
   * (`vincularLeadAoBitrix`): mesmo funil, mesma etapa, mesmo casamento de
   * contato por telefone. O cadastro manual era o único caminho sem essa perna.
   *
   * NÃO desfaz o lead se falhar: o cadastro no QS já está feito e é o que
   * importa. Devolve o erro pra tela poder dizer a verdade — "o lead entrou, o
   * card não" — em vez de um sucesso que esconde metade do serviço.
   */
  async function abrirNegocioNoBitrix(leadId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers["Authorization"] = `Bearer ${data.session.access_token}`;
      const res = await fetch("/api/lead-bitrix", {
        method: "POST",
        headers,
        body: JSON.stringify({ lead_id: leadId, criar: true }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) return { ok: false, error: json?.error ?? `O Bitrix recusou (HTTP ${res.status}).` };
      return { ok: true };
    } catch {
      return { ok: false, error: "Sem conexão com o servidor do QS." };
    }
  }

  // `force` = "Cadastrar mesmo assim" (só gestor/admin) pulando a checagem.
  // `bitrix` = qual dos dois botões de cadastro foi clicado; quando não vem,
  // vale a última escolha (o caminho do duplicado).
  async function handleCreateLead(force = false, bitrix?: boolean) {
    const comBitrix = bitrix ?? criarNoBitrix;
    if (!formFirstName.trim() || !currentUser) return;
    setSaving(true);
    if (!force) {
      const check = await findDuplicateLead(formEmail, formPhone);
      if (!check.ok) {
        // Checagem falhou (rede/RLS): NÃO segue às cegas — padrão da casa é
        // gravação medida, sem fail-open. O usuário tenta de novo.
        notifyError("Não foi possível verificar se o lead já existe — tente novamente.");
        setSaving(false);
        return;
      }
      if (check.dup) {
        setDupLead(check.dup); // o modal mostra o aviso com "Abrir lead" / "Cadastrar mesmo assim"
        setSaving(false);
        return;
      }
    }
    const fullName = [formFirstName.trim(), formLastName.trim()].filter(Boolean).join(" ");
    const { data: inserted, error } = await supabase
      .from("qs_leads")
      .insert({
        first_name: formFirstName.trim(),
        last_name: formLastName.trim() || null,
        full_name: fullName,
        email: formEmail.trim() || null,
        phone: formPhone.trim() || null,
        company_name: formCompany.trim() || null,
        source: formSource,
        status: "nao_iniciado" as LeadStatus,
        // Dono explícito: o trigger round-robin só age quando owner_id vem null.
        // SDR/closer: sempre o próprio (senão o lead sumia da tela do criador);
        // gestor/admin: o selecionado, ou null = "automático" (rodízio do banco).
        owner_id: isManager ? formOwnerId || null : currentUser.id,
        // CSV e inbound já gravam arrived_at; o modal não gravava e o lead manual
        // ficava sem horário de chegada (quebra métricas de fila/atraso).
        arrived_at: new Date().toISOString(),
      })
      // Lê de volta o dono FINAL decidido pelo banco (se "automático", foi o
      // round-robin) — qualquer criação futura de tarefas aqui deve usar
      // inserted.owner_id, nunca o valor do form.
      .select("id, owner_id")
      .single();
    if (error || !inserted) {
      console.warn("Erro ao cadastrar lead:", error);
      notifyError("Não foi possível cadastrar o lead — confira os dados e tente novamente.");
    } else {
      const finalOwner = users.find((u) => u.id === inserted.owner_id)?.name;
      const dono = finalOwner && inserted.owner_id !== currentUser.id ? ` — responsável: ${finalOwner}` : "";

      // O card do Bitrix, quando foi isso que a pessoa pediu. É esperado (e não
      // fire-and-forget) porque ela CLICOU nisso: se falhar, ela precisa saber
      // agora, e não descobrir daqui a uma semana que o comercial nunca viu o
      // cliente. O lead já está salvo de qualquer forma.
      let avisoBitrix = "";
      if (comBitrix) {
        const r = await abrirNegocioNoBitrix(inserted.id);
        if (r.ok) {
          avisoBitrix = " e o negócio foi aberto no Bitrix";
        } else {
          notifyError(
            `Lead ${fullName} foi salvo no QS, mas o negócio NÃO foi criado no Bitrix: ${r.error} ` +
            `Dá pra tentar de novo pelo perfil do lead.`
          );
        }
      }
      if (!comBitrix || avisoBitrix) {
        notifySuccess(`Lead ${fullName} cadastrado${avisoBitrix}${dono}.`);
      }

      await recarregarTudo();
      setShowCreateModal(false);
      resetForm();
    }
    setSaving(false);
  }

  // ── Delete selected ──
  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    // Exclusão em massa é DEFINITIVA (leva junto tarefas, notas e reuniões) —
    // um clique errado não pode apagar a carteira sem confirmação.
    const ok = window.confirm(
      `Excluir ${ids.length} lead(s) DEFINITIVAMENTE?\n\nIsso apaga também o histórico, as atividades e as reuniões desses leads. Essa ação não pode ser desfeita.`
    );
    if (!ok) return;
    // Mede o que foi REALMENTE excluído: o `.select('id')` devolve as linhas
    // que o banco apagou. Sem isso, a RLS recusa em SILÊNCIO (sem erro, 0
    // linhas — ex.: SDR não pode excluir) e a tela dizia "excluído" mesmo assim.
    const { data: deleted, error } = await supabase
      .from("qs_leads")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) {
      console.warn("Erro ao excluir leads:", error);
      notifyError("Não foi possível excluir os leads — tente novamente.");
      return;
    }
    const deletedIds = new Set((deleted ?? []).map((d) => d.id));
    const refused = ids.length - deletedIds.size;
    if (deletedIds.size === 0) {
      notifyError("Nenhum lead foi excluído — o banco recusou por falta de permissão (excluir leads é restrito a gestor/admin).");
    } else if (refused > 0) {
      notifyError(`${deletedIds.size} lead(s) excluído(s), mas ${refused} foram recusados por falta de permissão.`);
    } else {
      notifySuccess(`${deletedIds.size} lead(s) excluído(s).`);
    }
    await recarregarTudo();
    // Mantém selecionados só os recusados (que continuam na lista).
    setSelectedIds(new Set(ids.filter((id) => !deletedIds.has(id))));
  }

  // ── Handover: passa o(s) lead(s) selecionado(s) para um Closer ──
  async function handleHandover() {
    if (selectedIds.size === 0 || !handoverCloserId || !currentUser) return;
    setHandoverSaving(true);
    setHandoverError(null);
    const ids = Array.from(selectedIds);
    // Reusa o MESMO fluxo da transferência individual (transferLead): troca o
    // dono, registra o histórico em qs_handovers (DEPOIS da troca — antes o
    // histórico era gravado primeiro e ficava registrado mesmo com a troca
    // recusada) e leva as tarefas abertas junto. E MEDE lead a lead o que o
    // banco aceitou — a RLS pode recusar em silêncio (sem erro, 0 linhas).
    const okIds = new Set<string>();
    for (const leadId of ids) {
      const ok = await transferLead(leadId, currentUser.id, handoverCloserId, handoverBriefing, { notify: false });
      if (ok) okIds.add(leadId);
    }
    const fail = ids.length - okIds.size;
    await fetchLeads();
    // Mantém selecionados só os que falharam (pra dar pra tentar de novo).
    setSelectedIds(new Set(ids.filter((id) => !okIds.has(id))));
    if (fail > 0) {
      setHandoverError(
        okIds.size === 0
          ? "Nenhum lead foi transferido — o banco recusou (sem permissão ou erro; detalhes no console)."
          : `${okIds.size} lead(s) transferido(s), mas ${fail} foram recusados (sem permissão ou erro; detalhes no console).`
      );
    } else {
      notifySuccess(`${okIds.size} lead(s) transferido(s) — histórico registrado e atividades abertas levadas junto.`);
      setShowHandover(false);
      setHandoverCloserId("");
      setHandoverBriefing("");
    }
    setHandoverSaving(false);
  }

  // ── Handover por quantidade (item 6): tira N leads de um SDR e manda pra outro ──
  // Contagem no BANCO (head + count) desde 04/11 — a tela não tem mais a base
  // inteira na memória. Mesma regra: leads do SDR de origem, fora ganho/perdido.
  const [handoverPoolSize, setHandoverPoolSize] = useState<number | null>(null);
  useEffect(() => {
    setHandoverPoolSize(null);
    if (!handoverFromId) return;
    let vivo = true;
    supabase
      .from("qs_leads")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", handoverFromId)
      .not("status", "in", "(ganho,perdido)")
      .then(({ count, error }) => {
        if (!vivo) return;
        if (error) console.warn("Erro ao contar leads do SDR de origem:", error);
        else setHandoverPoolSize(count ?? 0);
      });
    return () => { vivo = false; };
  }, [handoverFromId]);

  async function handleHandoverQuantity() {
    const qty = parseInt(handoverQty, 10);
    if (!handoverFromId || !handoverCloserId || !qty || qty < 1) return;
    if (handoverFromId === handoverCloserId) { setHandoverError("Origem e destino devem ser SDRs diferentes."); return; }
    setHandoverSaving(true);
    setHandoverError(null);
    try {
      // leads ativos do SDR de origem (ignora ganhos/perdidos), ordenados por chegada.
      // Buscados AGORA no banco (só id + datas): a tela só tem a página atual.
      // A ordenação segue no navegador porque é por arrived_at OU created_at
      // (o PostgREST não ordena por coalesce).
      type Candidato = { id: string; arrived_at: string | null; created_at: string };
      const candidatos = await fetchAllRows<Candidato>((from, to) =>
        supabase
          .from("qs_leads")
          .select("id, arrived_at, created_at")
          .eq("owner_id", handoverFromId)
          .not("status", "in", "(ganho,perdido)")
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: Candidato[] | null; error: { message?: string } | null }>
      );
      const pool = candidatos
        .sort((a, b) => {
          const ta = new Date(a.arrived_at || a.created_at).getTime();
          const tb = new Date(b.arrived_at || b.created_at).getTime();
          return handoverAge === "novos" ? tb - ta : ta - tb;
        })
        .slice(0, qty);
      if (pool.length === 0) { setHandoverError("Esse SDR não tem leads ativos para transferir."); setHandoverSaving(false); return; }
      const ids = pool.map((l) => l.id);
      const briefing = handoverBriefing.trim() || `Handover de ${pool.length} lead(s) — ${handoverAge === "novos" ? "mais novos" : "mais antigos"}`;
      // Reusa o MESMO fluxo da transferência individual (transferLead): dono +
      // histórico + tarefas abertas, MEDINDO lead a lead o que o banco aceitou
      // (a RLS pode recusar em silêncio — antes a tela fingia sucesso total).
      let okCount = 0;
      for (const leadId of ids) {
        const ok = await transferLead(leadId, handoverFromId, handoverCloserId, briefing, { notify: false });
        if (ok) okCount++;
      }
      const fail = ids.length - okCount;
      await fetchLeads();
      if (fail > 0) {
        setHandoverError(
          okCount === 0
            ? "Nenhum lead foi transferido — o banco recusou (sem permissão ou erro; detalhes no console)."
            : `${okCount} lead(s) transferido(s), mas ${fail} foram recusados (sem permissão ou erro; detalhes no console).`
        );
        return; // o finally reseta o handoverSaving
      }
      notifySuccess(`${okCount} lead(s) transferido(s) — histórico registrado e atividades abertas levadas junto.`);
      setShowHandover(false);
      setHandoverCloserId(""); setHandoverBriefing(""); setHandoverFromId(""); setHandoverQty("10");
    } catch (err) {
      console.warn("Erro no handover por quantidade:", err);
      const msg = (err as { message?: string })?.message || "erro desconhecido";
      setHandoverError(`Não foi possível transferir os leads: ${msg}`);
    } finally {
      setHandoverSaving(false);
    }
  }

  // Contagem por fonte sobre a base visível pra este usuário (como antes,
  // quando `leads` era a base inteira). Vazia até a coluna segment chegar.
  const fontes = useFontes(segmentos ?? []);

  // ── Filtering ──
  // Desde 04/11 quem filtra é o BANCO (ver aplicarFiltrosLeads em
  // src/lib/qs/leadsFiltro.ts, com a tradução regra a regra do que rodava aqui).

  // Seleção NÃO sobrevive a filtro/busca: mantém marcado só o que continua
  // VISÍVEL na lista filtrada — antes dava pra selecionar, trocar o filtro e as
  // ações em massa agiam sobre leads fora da tela (ninguém via o que ia junto).
  // A lista filtrada não está mais na memória, então pergunta ao banco quais
  // dos selecionados ainda passam nos filtros novos.
  const selecionadosRef = useRef(selectedIds);
  selecionadosRef.current = selectedIds;
  useEffect(() => {
    const ids = Array.from(selecionadosRef.current);
    if (ids.length === 0) return;
    let vivo = true;
    fetchPorIds<{ id: string }>(ids, (lote) =>
      aplicarFiltrosLeads(supabase.from("qs_leads").select("id"), filtros).in("id", lote) as unknown as
        PromiseLike<{ data: { id: string }[] | null; error: { message?: string; code?: string } | null }>
    )
      .then((rows) => {
        if (!vivo) return;
        const visible = new Set(rows.map((r) => r.id));
        setSelectedIds((prev) => {
          const next = new Set(Array.from(prev).filter((id) => visible.has(id)));
          return next.size === prev.size ? prev : next;
        });
      })
      // Falhou a conferência: mantém a seleção (melhor que desmarcar às cegas);
      // as ações em lote ainda medem lead a lead o que o banco aceitou.
      .catch((e) => console.warn("Erro ao conferir a seleção com os filtros:", e));
    return () => { vivo = false; };
  }, [filtros]);

  const totalPages = Math.max(1, Math.ceil(totalFiltrado / ITEMS_PER_PAGE));
  // Filtro/exclusão pode reduzir o total: sem o clamp a página atual fica vazia.
  useEffect(() => {
    if (!carregandoPagina && currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages, carregandoPagina]);
  // A página já vem cortada do banco.
  const paginatedLeads = leads;

  // Leads selecionados com o que as ações em lote precisam (status e dono),
  // lidos do banco NA HORA — a seleção pode atravessar páginas que não estão
  // mais na memória. Lead que não voltou (excluído/sem acesso) fica de fora
  // do mapa e cai no "recusado" medido pela própria ação.
  async function lerSelecionados(ids: string[]): Promise<Map<string, { status: LeadStatus; owner_id: string | null }>> {
    type Linha = { id: string; status: LeadStatus; owner_id: string | null };
    const rows = await fetchPorIds<Linha>(ids, (lote) =>
      supabase.from("qs_leads").select("id, status, owner_id").in("id", lote) as unknown as
        PromiseLike<{ data: Linha[] | null; error: { message?: string; code?: string } | null }>
    );
    return new Map(rows.map((r) => [r.id, { status: r.status, owner_id: r.owner_id }]));
  }

  // ── Exportar: a LISTA FILTRADA inteira, buscada na hora com os mesmos filtros ──
  async function exportarCsv() {
    if (exportando) return;
    setExportando(true);
    try {
      type LinhaCsv = Pick<Lead, "full_name" | "company_name" | "phone" | "email" | "segment" | "status" | "source" | "bitrix_id" | "estimated_value" | "created_at">;
      const rows = await fetchAllRows<LinhaCsv>((from, to) =>
        aplicarFiltrosLeads(
          supabase.from("qs_leads").select("full_name, company_name, phone, email, segment, status, source, bitrix_id, estimated_value, created_at"),
          filtros
        )
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: LinhaCsv[] | null; error: { message?: string } | null }>
      );
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const header = ["Nome", "Empresa", "Telefone", "E-mail", "Fonte/Segmento", "Status", "Origem", "ID Bitrix", "Valor estimado", "Criado em"];
      const lines = rows.map((l) => [
        l.full_name, l.company_name, l.phone, l.email, l.segment,
        STATUS_LABELS[l.status], SOURCE_LABELS[l.source] ?? l.source, l.bitrix_id,
        l.estimated_value ?? "", l.created_at?.slice(0, 10),
      ].map(esc).join(";"));
      const csv = "﻿" + header.map(esc).join(";") + "\r\n" + lines.join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-qs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("Erro ao exportar leads:", e);
      const code = (e as { code?: string })?.code;
      notifyError(`Não foi possível exportar os leads${code ? ` (erro ${code})` : ""} — tente novamente.`);
    } finally {
      setExportando(false);
    }
  }

  // ── Selection ──
  const allOnPageSelected =
    paginatedLeads.length > 0 && paginatedLeads.every((l) => selectedIds.has(l.id));

  function toggleAll() {
    if (allOnPageSelected) {
      const next = new Set(selectedIds);
      paginatedLeads.forEach((l) => next.delete(l.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      paginatedLeads.forEach((l) => next.add(l.id));
      setSelectedIds(next);
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function resetForm() {
    setFormFirstName("");
    setFormLastName("");
    setFormEmail("");
    setFormPhone("");
    setFormCompany("");
    setFormSource("manual");
    setFormOwnerId("");
    setDupLead(null);
  }


  // ── Cadence name helper ──
  function cadenceName(id: string | null) {
    if (!id) return "\u2014";
    return cadences.find((c) => c.id === id)?.name ?? "\u2014";
  }

  // ── Active filter helpers ──
  const hasActiveFilters = filterSource || filterStatus || filterCadence || filterOwner || filterLossReason || filterTemp || filterFonte;

  function clearFilters() {
    setFilterSource("");
    setFilterStatus("");
    setFilterCadence("");
    setFilterOwner("");
    setFilterFonte("");
    setFilterLossReason("");
    setFilterTemp("");
    setCurrentPage(1);
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6 flex items-center justify-center" style={{ fontFamily: "inherit" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6" style={{ fontFamily: "inherit" }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Gerenciamento de Leads</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {segmentos ? <>{segmentos.length} leads cadastrados &middot; </> : null}{totalFiltrado} visíveis
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setHandoverError(null); setShowHandover(true); }}
            className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Transferir leads
          </button>
          <button
            // Exporta a LISTA FILTRADA inteira (não só a página) em CSV pro
            // Excel — buscada no banco na hora do clique, com os mesmos filtros.
            onClick={() => void exportarCsv()}
            disabled={exportando}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-wait"
            title={`Exportar os ${totalFiltrado} leads visíveis em CSV`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exportando ? "Exportando..." : "Exportar"}
          </button>
          {/* Exportar continua acima para todos — é leitura. O que MUDA dado
              some para o espectador (marketing). */}
          {executa && (
            <button
              onClick={() => setShowCsvModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Importar lista (CSV)
            </button>
          )}
          {executa && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Cadastrar Lead
            </button>
          )}
        </div>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquise por ID, nome, empresa, e-mail ou telefone..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF] transition-colors"
        />
      </div>

      {/* ── Filter Pills ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Source */}
        {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((k) => (
          <button
            key={k}
            onClick={() => { setFilterSource(filterSource === k ? "" : k); setCurrentPage(1); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filterSource === k
                ? "bg-[#0147FF] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {SOURCE_LABELS[k]}
          </button>
        ))}

        <span className="w-px h-5 bg-gray-200" />

        {/* Status */}
        {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((k) => (
          <button
            key={k}
            onClick={() => { setFilterStatus(filterStatus === k ? "" : k); setCurrentPage(1); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filterStatus === k
                ? "bg-[#0147FF] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {STATUS_LABELS[k]}
          </button>
        ))}

        <span className="w-px h-5 bg-gray-200" />

        {/* Temperatura (lead_score do Bitrix, editável no detalhe do lead) */}
        {(Object.keys(TEMP_FILTER_LABELS) as LeadTemperature[]).map((k) => (
          <button
            key={k}
            onClick={() => { setFilterTemp(filterTemp === k ? "" : k); setCurrentPage(1); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filterTemp === k
                ? "bg-[#0147FF] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {TEMP_FILTER_LABELS[k]}
          </button>
        ))}

        <span className="w-px h-5 bg-gray-200" />

        {/* Cadence select */}
        <select
          value={filterCadence}
          onChange={(e) => { setFilterCadence(e.target.value); setCurrentPage(1); }}
          className="rounded-full px-3 py-1.5 text-xs border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
        >
          <option value="">Cadência</option>
          {cadences.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Owner select */}
        <select
          value={filterOwner}
          onChange={(e) => { setFilterOwner(e.target.value); setCurrentPage(1); }}
          className="rounded-full px-3 py-1.5 text-xs border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
        >
          <option value="">Responsável</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>

        {/* Fonte = de onde o lead veio (qs_leads.segment: "[Japão] - Tráfego"…) */}
        <select
          value={filterFonte}
          onChange={(e) => { setFilterFonte(e.target.value); setCurrentPage(1); }}
          aria-label="Fonte"
          className="rounded-full px-3 py-1.5 text-xs border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 max-w-[220px]"
        >
          <option value="">Fonte</option>
          {fontes.map((f) => (
            <option key={f.valor} value={f.valor}>{f.rotulo} ({f.n})</option>
          ))}
        </select>

        {/* Loss Reason select */}
        <select
          value={filterLossReason}
          onChange={(e) => { setFilterLossReason(e.target.value); setCurrentPage(1); }}
          className="rounded-full px-3 py-1.5 text-xs border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
        >
          <option value="">Motivo de Perda</option>
          {lossReasons.map((lr) => (
            <option key={lr.id} value={lr.id}>{lr.label}</option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-white hover:bg-red-50 transition-colors"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* ── Bulk Actions ────────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 rounded-xl bg-[#0147FF]/5 border border-[#0147FF]/10">
          <span className="text-sm font-medium text-[#0147FF]">
            {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} selecionado{selectedIds.size > 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <select
              onChange={async (e) => {
                const cadId = e.target.value;
                if (!cadId || cadenceLinking) return;
                e.target.value = "";
                const allIds = Array.from(selectedIds);
                // Status e dono dos selecionados lidos do banco agora (a seleção
                // pode estar em páginas que não estão mais na memória).
                let infoSel: Map<string, { status: LeadStatus; owner_id: string | null }>;
                try {
                  infoSel = await lerSelecionados(allIds);
                } catch (err) {
                  console.warn("Erro ao ler os leads selecionados:", err);
                  notifyError("Não foi possível ler os leads selecionados — tente novamente.");
                  return;
                }
                // Leads FECHADOS (ganho/perdido) ficam FORA do vínculo em massa —
                // antes o update virava todos pra em_prospeccao e RESSUSCITAVA
                // lead fechado sem confirmação. Reativar é ato explícito no
                // detalhe do lead, não efeito colateral de uma ação em lote.
                const closedIds = allIds.filter((id) => {
                  const st = infoSel.get(id)?.status;
                  return st === "ganho" || st === "perdido";
                });
                const ids = allIds.filter((id) => !closedIds.includes(id));
                if (ids.length === 0) {
                  notifyError("Todos os leads selecionados estão fechados (ganho/perdido) — reative-os no detalhe do lead antes de vincular uma cadência.");
                  return;
                }
                const cadName = cadences.find((c) => c.id === cadId)?.name ?? "cadência";
                const skipNote = closedIds.length > 0 ? `\n\n(${closedIds.length} lead(s) fechados serão pulados — reativação é feita no detalhe.)` : "";
                if (!window.confirm(`Vincular ${ids.length} lead(s) à cadência "${cadName}" e criar as atividades a partir de hoje?${skipNote}`)) return;
                setCadenceLinking(true);
                try {
                  // Mede o que o banco REALMENTE vinculou: a RLS pode recusar em
                  // silêncio (sem erro, 0 linhas) e a tela fingia sucesso total.
                  // O guarda de status também vale no BANCO (estado da tela pode
                  // estar velho): fechado nunca entra no update.
                  const { data: linked, error } = await supabase
                    .from("qs_leads")
                    .update({ cadence_id: cadId, status: "em_prospeccao", cadence_started_at: new Date().toISOString() })
                    .in("id", ids)
                    .not("status", "in", "(ganho,perdido)")
                    .select("id");
                  if (error) {
                    console.warn("Erro ao vincular cadência:", error);
                    notifyError("Não foi possível vincular a cadência — tente novamente.");
                    return;
                  }
                  const linkedIds = new Set((linked ?? []).map((l) => l.id));
                  const refused = ids.length - linkedIds.size;
                  if (linkedIds.size === 0) {
                    notifyError("Nenhum lead foi vinculado — o banco recusou (falta de permissão ou leads já fechados).");
                    return;
                  }
                  // Gera as TAREFAS da cadência SÓ pros leads que o banco aceitou —
                  // antes o vínculo em massa não criava atividade nenhuma e os leads
                  // sumiam da fila de todo mundo.
                  let tasksFail = 0;
                  for (const id of linkedIds) {
                    const leadOwner = infoSel.get(id)?.owner_id ?? null;
                    // Encerra o plano ANTIGO antes de criar o novo — sem isso, trocar
                    // o lead de cadência DUPLICAVA a carga (as duas sequências
                    // conviviam na fila e o SDR contatava em dobro). Se o encerramento
                    // falhar, NÃO cria o plano novo por cima: o lead cai no aviso de
                    // "vincule de novo" e a retentativa encerra e recria.
                    const closed = await closeOpenCadenceTasks(id);
                    if (!closed) { tasksFail++; continue; }
                    const created = await createCadenceTasks(id, cadId, leadOwner);
                    if (created === null) tasksFail++;
                  }
                  // Recarrega a página do banco: com filtro de status/cadência
                  // ativo, o lead vinculado pode sair (ou entrar) na lista.
                  await fetchLeads();
                  // Mantém selecionados os recusados E os fechados pulados (pra
                  // ficar visível o que NÃO foi processado).
                  setSelectedIds(new Set(allIds.filter((id) => !linkedIds.has(id))));
                  if (refused > 0) notifyError(`${linkedIds.size} lead(s) vinculados à ${cadName}, mas ${refused} foram recusados (sem permissão ou lead fechado).`);
                  else if (tasksFail === 0) notifySuccess(`${linkedIds.size} lead(s) vinculados à ${cadName} — atividades criadas.`);
                  if (tasksFail > 0) notifyError(`${tasksFail} lead(s) ficaram sem atividades — vincule a cadência deles de novo.`);
                  if (closedIds.length > 0) notifyError(`${closedIds.length} lead(s) fechados (ganho/perdido) foram pulados — reativação é feita no detalhe do lead.`);
                } finally {
                  setCadenceLinking(false);
                }
              }}
              disabled={cadenceLinking}
              className="px-3 py-1.5 rounded-lg bg-[#0147FF] text-xs font-medium text-white cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              defaultValue=""
            >
              <option value="" disabled>Vincular à Cadência</option>
              {cadences.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              onChange={async (e) => {
                const ownerId = e.target.value;
                if (!ownerId) return;
                e.target.value = "";
                const ids = Array.from(selectedIds);
                const owner = users.find(u => u.id === ownerId);
                // Dono ATUAL de cada selecionado, lido do banco agora (a seleção
                // pode estar em páginas que não estão mais na memória).
                let infoSel: Map<string, { status: LeadStatus; owner_id: string | null }>;
                try {
                  infoSel = await lerSelecionados(ids);
                } catch (err) {
                  console.warn("Erro ao ler os leads selecionados:", err);
                  notifyError("Não foi possível ler os leads selecionados — tente novamente.");
                  return;
                }
                // Reusa o MESMO fluxo da transferência individual (transferLead):
                // troca o dono, registra o histórico em qs_handovers e leva as
                // tarefas abertas junto — e MEDE lead a lead o que o banco aceitou
                // (RLS pode recusar em silêncio; antes a tela fingia sucesso total).
                const okIds = new Set<string>();
                for (const id of ids) {
                  const fromId = infoSel.get(id)?.owner_id ?? null;
                  if (fromId === ownerId) { okIds.add(id); continue; } // já é o dono — nada a fazer
                  const ok = await transferLead(id, fromId, ownerId, "Atribuição em massa de responsável", { notify: false });
                  if (ok) okIds.add(id);
                }
                const fail = ids.length - okIds.size;
                // Recarrega do banco (fonte da verdade) em vez de assumir sucesso.
                await fetchLeads();
                // Mantém selecionados só os que falharam (pra dar pra tentar de novo).
                setSelectedIds(new Set(ids.filter((id) => !okIds.has(id))));
                if (fail === 0) {
                  notifySuccess(`${okIds.size} lead(s) atribuído(s) a ${owner?.name ?? "o responsável"} — atividades abertas levadas junto.`);
                } else if (okIds.size === 0) {
                  notifyError("Nenhum lead foi atribuído — o banco recusou (sem permissão ou erro; detalhes no console).");
                } else {
                  notifyError(`${okIds.size} lead(s) atribuído(s) a ${owner?.name ?? "o responsável"}, mas ${fail} foram recusados (sem permissão ou erro).`);
                }
              }}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 cursor-pointer"
              defaultValue=""
            >
              <option value="" disabled>Atribuir Responsável</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button
              onClick={handleDeleteSelected}
              className="px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              Excluir selecionados
            </button>
          </div>
        </div>
      )}

      {/* ── Erro de carga (com lista antiga na tela) ─────────────────────── */}
      {loadError && leads.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100">
          <span className="text-sm text-red-700">{loadError} A lista abaixo pode estar desatualizada.</span>
          <button
            onClick={retryFetchLeads}
            className="px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
        {/* Trocando página/filtro: a tabela antiga fica, esmaecida, até a nova chegar. */}
        <div className={`overflow-x-auto transition-opacity ${carregandoPagina ? "opacity-60" : ""}`} aria-busy={carregandoPagina}>
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-[#0147FF] focus:ring-[#0147FF]/20"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Lead
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Origem
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Cadência Vinculada
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Responsável
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Contato
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.map((lead) => {
                const statusColor = STATUS_COLORS[lead.status];
                return (
                  <tr
                    key={lead.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => onOpenLead(lead.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        className="w-4 h-4 rounded border-gray-300 text-[#0147FF] focus:ring-[#0147FF]/20"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{lead.full_name}</p>
                        <p className="text-xs text-gray-500">
                          {lead.company_name ?? "\u2014"}
                          {lead.bitrix_id && <span className="ml-2 text-gray-400 tabular-nums">\u00b7 ID {lead.bitrix_id}</span>}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-gray-700">{SOURCE_LABELS[lead.source]}</p>
                        <p className="text-xs text-gray-400">{formatDate(lead.created_at)}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusColor.bg} ${statusColor.text}`}
                      >
                        {STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700">{cadenceName(lead.cadence_id)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700">{lead.owner?.name ?? <span className="text-gray-400">Não atribuído</span>}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center justify-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {lead.phone && (
                          <>
                            <button
                              onClick={() => setWaLead({ id: lead.id, name: lead.full_name, phone: lead.phone })}
                              title={`WhatsApp: ${lead.phone}`}
                              className="p-1.5 rounded-lg hover:bg-green-50 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                              </svg>
                            </button>
                            <button
                              onClick={async () => {
                                // Webfone WebRTC (VoxFree) se o ramal estiver provisionado; senão softphone.
                                if (await isWebphoneConfigured()) {
                                  const r = await dialViaWebphone(lead.phone, { leadName: lead.full_name, leadId: lead.id });
                                  if (!r.ok) notifyError(r.error || "Webfone WebRTC indisponível.");
                                  return;
                                }
                                const r = await dialViaSip(lead.phone);
                                if (!r.ok) notifyError(r.error || "Não foi possível abrir o softphone (BravoTech).");
                              }}
                              title={`Ligar: ${lead.phone}`}
                              className="inline-flex p-1.5 rounded-lg hover:bg-green-50 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5 text-[#12A18A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                            </button>
                          </>
                        )}
                        {lead.email && (
                          <a
                            href={`mailto:${lead.email}`}
                            title={`E-mail: ${lead.email}`}
                            className="inline-flex p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginatedLeads.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                    {/* Erro de rede NÃO é "nenhum lead": mostra o erro + retry. */}
                    {loadError ? (
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-red-600">{loadError}</span>
                        <button
                          onClick={retryFetchLeads}
                          className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] transition-colors"
                        >
                          Tentar novamente
                        </button>
                      </div>
                    ) : (
                      "Nenhum lead encontrado com os filtros atuais."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            Mostrando {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, totalFiltrado)}-
            {Math.min(currentPage * ITEMS_PER_PAGE, totalFiltrado)} de {totalFiltrado}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {/* Compacta: primeira / … / vizinhas / … / última (antes eram
                totalPages botões — 300 botões com 3k leads). */}
            {pageItems(currentPage, totalPages).map((page, idx) =>
              page === "..." ? (
                <span key={`gap-${idx}`} className="w-8 h-8 flex items-center justify-center text-xs text-gray-400 select-none">
                  …
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors tabular-nums ${
                    page === currentPage
                      ? "bg-[#0147FF] text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {page}
                </button>
              )
            )}
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Create Lead Modal ─────────────────────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => { setShowCreateModal(false); resetForm(); }}
          />
          <div className="relative bg-white rounded-xl border border-gray-100 shadow-none w-full max-w-lg mx-4 p-4 md:p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900">Cadastrar Lead</h2>
              <button
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Nome</label>
                  <input
                    type="text"
                    value={formFirstName}
                    onChange={(e) => setFormFirstName(e.target.value)}
                    placeholder="Nome"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Sobrenome</label>
                  <input
                    type="text"
                    value={formLastName}
                    onChange={(e) => setFormLastName(e.target.value)}
                    placeholder="Sobrenome"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">E-mail</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => { setFormEmail(e.target.value); setDupLead(null); }}
                  placeholder="email@exemplo.com.br"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Telefone</label>
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => { setFormPhone(e.target.value); setDupLead(null); }}
                  placeholder="(00) 00000-0000"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Empresa</label>
                <input
                  type="text"
                  value={formCompany}
                  onChange={(e) => setFormCompany(e.target.value)}
                  placeholder="Nome da empresa"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Origem</label>
                <select
                  value={formSource}
                  onChange={(e) => setFormSource(e.target.value as LeadSource)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                >
                  {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((k) => (
                    <option key={k} value={k}>{SOURCE_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Responsável</label>
                {isManager ? (
                  // Gestor/admin escolhe o dono — ou deixa o rodízio do banco decidir.
                  <select
                    value={formOwnerId}
                    onChange={(e) => setFormOwnerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                  >
                    <option value="">Automático (rodízio entre os SDRs)</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
                    ))}
                  </select>
                ) : (
                  // SDR/closer: o lead fica com quem cadastrou (visível, não editável) —
                  // sem isso o round-robin dava o lead a outro SDR e ele sumia da tela.
                  <>
                    <input
                      type="text"
                      value={currentUser?.name ?? ""}
                      disabled
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500 cursor-not-allowed"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Leads cadastrados manualmente ficam com você.</p>
                  </>
                )}
              </div>
            </div>

            {/* Aviso de duplicado: telefone/e-mail já existem no banco. */}
            {dupLead && (
              <div className="mt-4 px-3 py-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm text-amber-800 font-medium mb-2">
                  Lead já existe{dupLead.name ? `: ${dupLead.name}` : ""} (dono: {dupLead.ownerName ?? "não atribuído"}).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      const id = dupLead.id;
                      setShowCreateModal(false);
                      resetForm();
                      onOpenLead(id);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#0147FF] text-xs font-medium text-white hover:bg-[#0139D6] transition-colors"
                  >
                    Abrir lead
                  </button>
                  {isManager && (
                    // Só gestor/admin pode forçar o cadastro duplicado.
                    <button
                      onClick={() => handleCreateLead(true)}
                      disabled={saving}
                      className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                    >
                      Cadastrar mesmo assim
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* DOIS BOTÕES, NENHUM PADRÃO ESCONDIDO (Bruno, 09/09).
                O cadastro manual nascia só no QS — o comercial não via o cliente
                no funil, e ninguém sabia disso porque a tela não perguntava
                nada. Agora a escolha é do momento do cadastro e está escrita nos
                dois botões: quem manda o lead pro Bitrix é quem cadastrou, não
                uma regra invisível. */}
            <div className="mt-6 pt-4 border-t border-gray-100">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  onClick={() => { setShowCreateModal(false); resetForm(); }}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  // Arrow de propósito: handleCreateLead(force?, bitrix?) — o
                  // evento do clique NÃO pode entrar como "force".
                  onClick={() => { setCriarNoBitrix(false); void handleCreateLead(false, false); }}
                  disabled={saving || !formFirstName.trim()}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Salvando..." : "Cadastrar só no QS"}
                </button>
                <button
                  onClick={() => { setCriarNoBitrix(true); void handleCreateLead(false, true); }}
                  disabled={saving || !formFirstName.trim()}
                  className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] disabled:opacity-50 transition-colors"
                >
                  {saving ? "Salvando..." : "Cadastrar e criar no Bitrix"}
                </button>
              </div>
              <p className="mt-2 text-right text-[11.5px] text-gray-400">
                "Criar no Bitrix" abre o negócio no funil de Pré-Vendas, com o dono do lead como responsável.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Importar lista (CSV) — 27/10 */}
      {showCsvModal && currentUser && (
        <ImportarListaCsv
          currentUser={currentUser}
          isManager={isManager}
          users={users}
          cadences={cadences}
          onClose={() => setShowCsvModal(false)}
          onImported={recarregarTudo}
        />
      )}

      {/* Modal de Handover (SDR → Closer) */}
      {showHandover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !handoverSaving && setShowHandover(false)}
          />
          <div className="relative bg-white rounded-xl border border-gray-100 shadow-xl w-full max-w-md mx-4 p-4 md:p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Transferir leads</h2>

            {isHandoverAdmin && (
              <div className="flex gap-1 p-1 rounded-lg bg-gray-100 mt-2 mb-3">
                <button onClick={() => { setHandoverMode("selecao"); setHandoverError(null); }} className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${handoverMode === "selecao" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  Por seleção ({selectedIds.size})
                </button>
                <button onClick={() => { setHandoverMode("quantidade"); setHandoverError(null); }} className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${handoverMode === "quantidade" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  Por quantidade
                </button>
              </div>
            )}

            <div className="space-y-3">
              {handoverMode === "selecao" ? (
                <>
                  <p className="text-sm text-gray-500">
                    Passar {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""} selecionado{selectedIds.size !== 1 ? "s" : ""} para outro usuário.
                  </p>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Destino *</label>
                    <select value={handoverCloserId} onChange={(e) => setHandoverCloserId(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400">
                      <option value="">Selecione um usuário...</option>
                      {users.filter((u) => u.is_active && u.id !== currentUser?.id).map((u) => (
                        <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">De (SDR de origem) *</label>
                    <select value={handoverFromId} onChange={(e) => setHandoverFromId(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400">
                      <option value="">Selecione o SDR de origem...</option>
                      {users.filter((u) => u.is_active).map((u) => (
                        <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
                      ))}
                    </select>
                    {handoverFromId && (
                      <p className="text-[11px] text-gray-400 mt-1">{handoverPoolSize ?? "…"} lead(s) ativo(s) disponível(is) para transferir.</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Para (destino) *</label>
                    <select value={handoverCloserId} onChange={(e) => setHandoverCloserId(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400">
                      <option value="">Selecione o destino...</option>
                      {users.filter((u) => u.is_active && u.id !== handoverFromId).map((u) => (
                        <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Quantidade *</label>
                      <input type="number" min={1} value={handoverQty} onChange={(e) => setHandoverQty(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Quais leads?</label>
                      <select value={handoverAge} onChange={(e) => setHandoverAge(e.target.value as "novos" | "antigos")} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400">
                        <option value="novos">Os mais novos</option>
                        <option value="antigos">Os mais antigos</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Briefing</label>
                <textarea
                  value={handoverBriefing}
                  onChange={(e) => setHandoverBriefing(e.target.value)}
                  rows={3}
                  placeholder="Contexto do lead, próximos passos, combinados..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 resize-none"
                />
              </div>
              {handoverError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{handoverError}</div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowHandover(false)}
                disabled={handoverSaving}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handoverMode === "quantidade" ? handleHandoverQuantity : handleHandover}
                disabled={handoverSaving || !handoverCloserId || (handoverMode === "selecao" ? selectedIds.size === 0 : (!handoverFromId || !parseInt(handoverQty, 10)))}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: "#0147FF" }}
              >
                {handoverSaving ? "Enviando..." : "Transferir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de WhatsApp */}
      <WhatsAppModal
        open={!!waLead}
        onClose={() => setWaLead(null)}
        lead={waLead ?? { id: null, name: null, phone: null }}
        ownerId={currentUser?.id ?? null}
      />
    </div>
  );
}
