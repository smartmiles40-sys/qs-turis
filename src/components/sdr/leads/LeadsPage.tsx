import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import WhatsAppModal from "@/components/sdr/whatsapp/WhatsAppModal";
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
import { createCadenceTasks, closeOpenCadenceTasks, transferLead } from "@/lib/qs/queries";
import { normalizeTemperature, type LeadTemperature } from "@/lib/leadScore";
import { planCadenceDates } from "@/lib/workHours";
import { dialViaSip } from "@/lib/sip";
import { dialViaWebphone, isWebphoneConfigured } from "@/lib/webphone";

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
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<LeadSource | "">("");
  const [filterStatus, setFilterStatus] = useState<LeadStatus | "">("");
  const [filterCadence, setFilterCadence] = useState("");
  const [filterOwner, setFilterOwner] = useState("");
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
  const [csvRows, setCsvRows] = useState<Array<{ nome: string; empresa: string; telefone: string; email: string; segmento: string }>>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportedCount, setCsvImportedCount] = useState<number | null>(null);
  const [csvCadenceId, setCsvCadenceId] = useState("");
  const [csvProgress, setCsvProgress] = useState(0);
  // Quantos leads o import de fato vai gravar (depois dos dedupes) — denominador
  // da barra de progresso; e quantos foram pulados (duplicados no arquivo/banco).
  const [csvPlanned, setCsvPlanned] = useState<number | null>(null);
  const [csvSkipped, setCsvSkipped] = useState<{ file: number; db: number } | null>(null);

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
  const [leads, setLeads] = useState<Lead[]>([]);
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
  const isManager = currentUser?.role === "admin" || currentUser?.role === "gestor";

  // ── Fetch data ──
  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_leads")
      .select("*, owner:qs_users(*), loss_reason:qs_loss_reasons(*)")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Erro ao buscar leads:", error);
      // Erro de rede NÃO pode virar "Nenhum lead encontrado" — a tela mostra o
      // erro com "Tentar novamente" (e mantém a lista antiga, se houver).
      setLoadError("Não foi possível carregar os leads — verifique a conexão.");
      return;
    }
    setLoadError(null);
    setLeads((data as Lead[]) ?? []);
  }, []);

  async function retryFetchLeads() {
    setLoading(true);
    await fetchLeads();
    setLoading(false);
  }

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      await fetchLeads();

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

      setLoading(false);
    }
    loadAll();
  }, [fetchLeads]);

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
    const { data, error } = await supabase
      .from("qs_leads")
      .select("id, full_name, email, phone, owner:qs_users(name)");
    if (error) {
      console.warn("Erro na checagem de duplicado:", error);
      return { ok: false, dup: null };
    }
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

  // `force` = "Cadastrar mesmo assim" (só gestor/admin) pulando a checagem.
  async function handleCreateLead(force = false) {
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
      notifySuccess(
        finalOwner && inserted.owner_id !== currentUser.id
          ? `Lead ${fullName} cadastrado — responsável: ${finalOwner}.`
          : `Lead ${fullName} cadastrado.`
      );
      await fetchLeads();
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
    await fetchLeads();
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
  const handoverPoolSize = useMemo(
    () => leads.filter((l) => l.owner_id === handoverFromId && l.status !== "ganho" && l.status !== "perdido").length,
    [leads, handoverFromId]
  );

  async function handleHandoverQuantity() {
    const qty = parseInt(handoverQty, 10);
    if (!handoverFromId || !handoverCloserId || !qty || qty < 1) return;
    if (handoverFromId === handoverCloserId) { setHandoverError("Origem e destino devem ser SDRs diferentes."); return; }
    setHandoverSaving(true);
    setHandoverError(null);
    try {
      // leads ativos do SDR de origem (ignora ganhos/perdidos), ordenados por chegada
      const pool = leads
        .filter((l) => l.owner_id === handoverFromId && l.status !== "ganho" && l.status !== "perdido")
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

  // ── Filtering (client-side) ──
  const filteredLeads = useMemo(() => {
    let result = [...leads];

    // Role-based filtering: SDR and closer only see their own leads
    if (currentUser && !canSeeAllData(currentUser.role)) {
      result = result.filter((l) => l.owner_id === currentUser.id);
    }

    if (search) {
      const q = search.toLowerCase();
      // Telefone: compara só os DÍGITOS — "(85) 9…" precisa achar "5585…".
      const qDigits = q.replace(/\D/g, "");
      result = result.filter(
        (l) =>
          l.full_name?.toLowerCase().includes(q) ||
          l.company_name?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          (qDigits.length >= 4 && (l.phone ?? "").replace(/\D/g, "").includes(qDigits)) ||
          l.bitrix_id?.toLowerCase().includes(q)
      );
    }
    if (filterSource) result = result.filter((l) => l.source === filterSource);
    if (filterStatus) result = result.filter((l) => l.status === filterStatus);
    if (filterCadence) result = result.filter((l) => l.cadence_id === filterCadence);
    if (filterOwner) result = result.filter((l) => l.owner_id === filterOwner);
    if (filterLossReason) result = result.filter((l) => l.loss_reason_id === filterLossReason);
    // Temperatura: compara o rótulo NORMALIZADO (o Bitrix manda "Quente"/"hot"/etc.).
    if (filterTemp) result = result.filter((l) => normalizeTemperature(l.lead_score) === filterTemp);
    return result;
  }, [leads, search, filterSource, filterStatus, filterCadence, filterOwner, filterLossReason, filterTemp, currentUser]);

  // Seleção NÃO sobrevive a filtro/busca: mantém marcado só o que continua
  // VISÍVEL na lista filtrada — antes dava pra selecionar, trocar o filtro e as
  // ações em massa agiam sobre leads fora da tela (ninguém via o que ia junto).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredLeads.map((l) => l.id));
      const next = new Set(Array.from(prev).filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredLeads]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / ITEMS_PER_PAGE));
  // Filtro/exclusão pode reduzir o total: sem o clamp a página atual fica vazia.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const paginatedLeads = filteredLeads.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

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

  // Fecha o modal de CSV — mas NUNCA no meio da importação: fechar deixava o
  // import rodando escondido, sem barra de progresso nem resultado na tela.
  function closeCsvModal() {
    if (csvImporting) return;
    setShowCsvModal(false);
    setCsvRows([]);
    setCsvImportedCount(null);
    setCsvSkipped(null);
    setCsvPlanned(null);
  }

  // ── Cadence name helper ──
  function cadenceName(id: string | null) {
    if (!id) return "\u2014";
    return cadences.find((c) => c.id === id)?.name ?? "\u2014";
  }

  // ── Active filter helpers ──
  const hasActiveFilters = filterSource || filterStatus || filterCadence || filterOwner || filterLossReason || filterTemp;

  function clearFilters() {
    setFilterSource("");
    setFilterStatus("");
    setFilterCadence("");
    setFilterOwner("");
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
            {leads.length} leads cadastrados &middot; {filteredLeads.length} visíveis
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setHandoverError(null); setShowHandover(true); }}
            className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Realizar Handover
          </button>
          <button
            onClick={() => {
              // Exporta a LISTA FILTRADA atual (o que está na tela) em CSV pro Excel.
              const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
              const header = ["Nome", "Empresa", "Telefone", "E-mail", "Fonte/Segmento", "Status", "Origem", "ID Bitrix", "Valor estimado", "Criado em"];
              const lines = filteredLeads.map((l) => [
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
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            title={`Exportar os ${filteredLeads.length} leads visíveis em CSV`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exportar
          </button>
          <button
            onClick={() => setShowCsvModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Importar CSV
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Cadastrar Lead
          </button>
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
          onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
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
                // Leads FECHADOS (ganho/perdido) ficam FORA do vínculo em massa —
                // antes o update virava todos pra em_prospeccao e RESSUSCITAVA
                // lead fechado sem confirmação. Reativar é ato explícito no
                // detalhe do lead, não efeito colateral de uma ação em lote.
                const closedIds = allIds.filter((id) => {
                  const st = leads.find((l) => l.id === id)?.status;
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
                    const leadOwner = leads.find((l) => l.id === id)?.owner_id ?? null;
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
                  setLeads(prev => prev.map(l => linkedIds.has(l.id) ? { ...l, cadence_id: cadId, status: "em_prospeccao" as LeadStatus } : l));
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
                // Reusa o MESMO fluxo da transferência individual (transferLead):
                // troca o dono, registra o histórico em qs_handovers e leva as
                // tarefas abertas junto — e MEDE lead a lead o que o banco aceitou
                // (RLS pode recusar em silêncio; antes a tela fingia sucesso total).
                const okIds = new Set<string>();
                for (const id of ids) {
                  const fromId = leads.find((l) => l.id === id)?.owner_id ?? null;
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
        <div className="overflow-x-auto">
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
            Mostrando {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredLeads.length)}-
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredLeads.length)} de {filteredLeads.length}
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

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                // Arrow de propósito: handleCreateLead(force?) — o evento do clique
                // NÃO pode entrar como "force" (seria sempre truthy).
                onClick={() => handleCreateLead()}
                disabled={saving || !formFirstName.trim()}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] disabled:opacity-50 transition-colors"
              >
                {saving ? "Salvando..." : "Cadastrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV Import Modal (Change 15) ──────────────────────────────── */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeCsvModal}
          />
          <div className="relative bg-white rounded-xl border border-gray-100 shadow-none w-full max-w-2xl mx-4 p-4 md:p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900">Importar Leads via CSV</h2>
              <button
                onClick={closeCsvModal}
                disabled={csvImporting}
                title={csvImporting ? "Aguarde a importação terminar" : undefined}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {csvImportedCount !== null ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-semibold text-gray-900 mb-2">{csvImportedCount} leads importados</p>
                {/* Transparência do dedupe: quantos ficaram de fora e por quê. */}
                {csvSkipped && (csvSkipped.db > 0 || csvSkipped.file > 0) && (
                  <p className="text-sm text-gray-500 mb-4">
                    {csvSkipped.db > 0 && <>{csvSkipped.db} pulado{csvSkipped.db > 1 ? "s" : ""} (já existia{csvSkipped.db > 1 ? "m" : ""} no banco)</>}
                    {csvSkipped.db > 0 && csvSkipped.file > 0 && " · "}
                    {csvSkipped.file > 0 && <>{csvSkipped.file} duplicado{csvSkipped.file > 1 ? "s" : ""} no próprio arquivo</>}
                  </p>
                )}
                <button
                  onClick={closeCsvModal}
                  className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] transition-colors"
                >
                  Fechar
                </button>
              </div>
            ) : (
              <>
                {csvRows.length === 0 ? (
                  <div>
                    <p className="text-sm text-gray-500 mb-4">
                      Selecione um arquivo CSV com as colunas: <strong>nome, empresa, telefone, email, segmento</strong>
                    </p>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const text = ev.target?.result as string;
                          if (!text) return;
                          // Divisor de linha com aspas padrão CSV (RFC 4180 simplificado):
                          // "Empresa, Ltda" é UMA coluna, "" dentro de aspas vira aspa
                          // literal. Campos com QUEBRA DE LINHA dentro de aspas não são
                          // suportados (o parse segue linha a linha).
                          const splitCsvLine = (line: string, sep: string): string[] => {
                            const out: string[] = [];
                            let cur = "";
                            let inQuotes = false;
                            for (let i = 0; i < line.length; i++) {
                              const ch = line[i];
                              if (inQuotes) {
                                if (ch === '"') {
                                  if (line[i + 1] === '"') { cur += '"'; i++; } // "" escapada
                                  else inQuotes = false;
                                } else cur += ch;
                              } else if (ch === '"') inQuotes = true;
                              else if (ch === sep) { out.push(cur); cur = ""; }
                              else cur += ch;
                            }
                            out.push(cur);
                            return out.map((c) => c.trim());
                          };
                          const lines = text.split(/\r?\n/).filter((l) => l.trim());
                          if (lines.length < 2) return;
                          // Separador: o que aparecer mais no cabeçalho (Excel pt-BR usa ";").
                          const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";

                          // Parse header
                          const header = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase().replace(/['"]/g, ""));
                          const colNome = header.findIndex((h) => h === "nome" || h === "name");
                          const colEmpresa = header.findIndex((h) => h === "empresa" || h === "company" || h === "company_name");
                          const colTelefone = header.findIndex((h) => h === "telefone" || h === "phone" || h === "tel");
                          const colEmail = header.findIndex((h) => h === "email" || h === "e-mail");
                          const colSegmento = header.findIndex((h) => h === "segmento" || h === "segment");

                          const rows = lines.slice(1).map((line) => {
                            const cols = splitCsvLine(line, sep);
                            return {
                              nome: colNome >= 0 ? cols[colNome] || "" : "",
                              empresa: colEmpresa >= 0 ? cols[colEmpresa] || "" : "",
                              telefone: colTelefone >= 0 ? cols[colTelefone] || "" : "",
                              email: colEmail >= 0 ? cols[colEmail] || "" : "",
                              segmento: colSegmento >= 0 ? cols[colSegmento] || "" : "",
                            };
                          }).filter((r) => r.nome.trim());

                          setCsvRows(rows);
                        };
                        reader.readAsText(file);
                      }}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#0147FF]/10 file:text-[#0147FF] hover:file:bg-[#0147FF]/20"
                    />
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-700 mb-4 font-medium">
                      {csvRows.length} lead{csvRows.length !== 1 ? "s" : ""} encontrado{csvRows.length !== 1 ? "s" : ""}
                    </p>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto border border-gray-100 rounded-lg mb-4">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Nome</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Empresa</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Telefone</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">E-mail</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Segmento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.map((row, idx) => (
                            <tr key={idx} className="border-t border-gray-50">
                              <td className="px-3 py-2 text-gray-900">{row.nome}</td>
                              <td className="px-3 py-2 text-gray-700">{row.empresa}</td>
                              <td className="px-3 py-2 text-gray-700">{row.telefone}</td>
                              <td className="px-3 py-2 text-gray-700">{row.email}</td>
                              <td className="px-3 py-2 text-gray-700">{row.segmento}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Cadência de destino: o gatilho divide os leads igualmente entre os SDRs dela */}
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Cadência de destino (distribui pros SDRs dela e cria as atividades)</label>
                      <select
                        value={csvCadenceId}
                        onChange={(e) => setCsvCadenceId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#0147FF]"
                      >
                        <option value="">Sem cadência (distribuição geral, sem atividades)</option>
                        {cadences.filter((c) => c.status === "disponivel").map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    {csvImporting && (
                      <div className="mb-3">
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                          {/* Denominador = o que VAI ser gravado (depois dos dedupes). */}
                          <div className="h-full rounded-full bg-[#0147FF] transition-all" style={{ width: `${Math.round((csvProgress / Math.max(csvPlanned ?? csvRows.length, 1)) * 100)}%` }} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1 tabular-nums">Importando {csvProgress}/{csvPlanned ?? csvRows.length}… Não feche esta janela.</p>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setCsvRows([])}
                        disabled={csvImporting}
                        className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={async () => {
                          setCsvImporting(true);
                          // try/finally: se QUALQUER await lançar no meio, o modal não
                          // pode ficar travado em "Importando..." (closeCsvModal barra
                          // o fechamento enquanto csvImporting=true).
                          try {
                          setCsvProgress(0);
                          setCsvSkipped(null);
                          setCsvPlanned(null);

                          // Dedupe dentro do arquivo (mesmo e-mail ou telefone = 1 lead só).
                          const seen = new Set<string>();
                          const rows = csvRows.filter((r) => {
                            const key = (r.email.trim().toLowerCase() || r.telefone.replace(/\D/g, "") || r.nome.trim().toLowerCase());
                            if (!key || seen.has(key)) return false;
                            seen.add(key);
                            return true;
                          });
                          const skippedFile = csvRows.length - rows.length;

                          // Dedupe contra o BANCO (auditoria 2026-07-14): telefone (só
                          // dígitos) ou e-mail (minúsculo) que já existem são PULADOS —
                          // antes o dedupe era só intra-arquivo e reimportar a mesma
                          // planilha duplicava a base inteira. Busca leve (email/phone)
                          // feita na hora; a RLS limita ao que o usuário pode ler
                          // (gestor/admin, que é quem importa, enxerga a base toda).
                          const { data: existing, error: dedupeErr } = await supabase
                            .from("qs_leads")
                            .select("email, phone");
                          if (dedupeErr) {
                            // Sem a checagem não dá pra importar com segurança (criaria
                            // duplicados em massa) — cancela e o usuário tenta de novo.
                            console.warn("[CSV] checagem de duplicados no banco falhou:", dedupeErr);
                            notifyError("Não foi possível checar duplicados no banco — importação cancelada, tente novamente.");
                            setCsvImporting(false);
                            return;
                          }
                          const dbEmails = new Set(
                            (existing ?? []).map((l) => (l.email ?? "").trim().toLowerCase()).filter(Boolean)
                          );
                          const dbPhones = new Set(
                            (existing ?? []).map((l) => (l.phone ?? "").replace(/\D/g, "")).filter((p) => p.length >= 8)
                          );
                          let skippedDb = 0;
                          const newRows = rows.filter((r) => {
                            const em = r.email.trim().toLowerCase();
                            const ph = r.telefone.replace(/\D/g, "");
                            const exists = (!!em && dbEmails.has(em)) || (ph.length >= 8 && dbPhones.has(ph));
                            if (exists) skippedDb++;
                            return !exists;
                          });
                          setCsvSkipped({ file: skippedFile, db: skippedDb });
                          setCsvPlanned(newRows.length); // denominador honesto da barra
                          if (newRows.length === 0) {
                            notifyError("Nenhum lead novo para importar — todos já existiam no banco (ou eram duplicados no arquivo).");
                            setCsvImportedCount(0);
                            setCsvImporting(false);
                            return;
                          }

                          // Dias/atividades da cadência (1 busca só, reusada em todos os leads).
                          //
                          // CÓPIA-ESPELHO de createCadenceTasks (src/lib/qs/queries.ts) —
                          // mantida INLINE de propósito: aqui é 1 busca de cadência pro LOTE
                          // inteiro (vs 1 busca por lead na canônica). Qualquer mudança lá
                          // precisa ser refletida aqui: datas via planCadenceDates, ordenação
                          // por order_index, prioridade pelo período (manhã=alta, >=12:30=
                          // média, sem horário=baixa), status "pendente", is_extra false e
                          // owner_id = dono FINAL do lead inserido (inserted.owner_id).
                          let cadDays: { day_number: number; activities: { channel_type: string; scheduled_time: string | null; order_index: number }[] }[] = [];
                          // Datas reais de cada "Dia N" respeitando os dias de execução da
                          // cadência (mesmo helper do createCadenceTasks) — antes o "Dia 2"
                          // de uma importação na sexta caía no sábado.
                          let csvDateByDay = new Map<number, Date>();
                          if (csvCadenceId) {
                            const [{ data }, { data: cadRow }] = await Promise.all([
                              supabase
                                .from("qs_cadence_days")
                                .select("day_number, activities:qs_cadence_activities(channel_type, scheduled_time, order_index)")
                                .eq("cadence_id", csvCadenceId)
                                .order("day_number"),
                              supabase
                                .from("qs_cadences")
                                .select("execution_weekdays, offday_policy")
                                .eq("id", csvCadenceId)
                                .maybeSingle(),
                            ]);
                            cadDays = (data ?? []) as typeof cadDays;
                            const plan = cadRow as { execution_weekdays: number[] | null; offday_policy: string | null } | null;
                            csvDateByDay = planCadenceDates(
                              cadDays.map((d) => d.day_number ?? 1),
                              plan?.execution_weekdays ?? null,
                              plan?.offday_policy ?? null
                            );
                          }

                          // Insere UM POR VEZ: cada insert é uma transação própria, então o
                          // round-robin do banco rotaciona os SDRs (em lote cairia tudo no mesmo).
                          let ok = 0, fail = 0, tasksFail = 0;
                          for (const row of newRows) {
                            const nameParts = row.nome.trim().split(/\s+/);
                            const { data: inserted, error } = await supabase
                              .from("qs_leads")
                              .insert({
                                first_name: nameParts[0] || "",
                                last_name: nameParts.slice(1).join(" ") || null,
                                full_name: row.nome.trim(),
                                email: row.email.trim() || null,
                                phone: row.telefone.trim() || null,
                                company_name: row.empresa.trim() || null,
                                segment: row.segmento.trim() || null,
                                source: "importacao" as LeadSource,
                                status: csvCadenceId ? ("em_prospeccao" as LeadStatus) : ("nao_iniciado" as LeadStatus),
                                cadence_id: csvCadenceId || null,
                                cadence_started_at: csvCadenceId ? new Date().toISOString() : null,
                                arrived_at: new Date().toISOString(),
                              })
                              .select("id, owner_id")
                              .single();

                            if (error || !inserted) { fail++; setCsvProgress((p) => p + 1); continue; }
                            ok++;

                            // Tarefas da cadência pro DONO que o gatilho escolheu.
                            if (csvCadenceId && cadDays.length > 0) {
                              const taskRows = cadDays.flatMap((d) =>
                                [...d.activities].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((a) => {
                                  // Data do dia já ajustada pros dias de execução (csvDateByDay).
                                  const when = new Date(csvDateByDay.get(d.day_number ?? 1) ?? new Date());
                                  const [h, m] = (a.scheduled_time || "09:00").split(":");
                                  when.setHours(Number(h) || 9, Number(m) || 0, 0, 0);
                                  return {
                                    lead_id: inserted.id,
                                    cadence_id: csvCadenceId,
                                    owner_id: inserted.owner_id,
                                    channel_type: a.channel_type,
                                    // Prioridade pelo PERÍODO da atividade (manhã=alta,
                                    // tarde>=12:30=média, dia todo/sem horário=baixa) —
                                    // mesma regra do createCadenceTasks e do serverless.
                                    priority: (!a.scheduled_time ? "baixa" : a.scheduled_time >= "12:30" ? "media" : "alta"),
                                    scheduled_at: when.toISOString(),
                                    status: "pendente",
                                    is_extra: false,
                                  };
                                })
                              );
                              if (taskRows.length > 0) {
                                // Erro aqui NÃO pode ser silencioso: o lead ficaria
                                // em prospecção sem NENHUMA atividade (zumbi fora da
                                // fila de todo mundo).
                                const { error: taskErr } = await supabase.from("qs_tasks").insert(taskRows);
                                if (taskErr) { tasksFail++; console.warn("[CSV] tarefas não criadas p/ lead", inserted.id, taskErr.message); }
                              }
                            }
                            setCsvProgress((p) => p + 1);
                          }

                          if (fail > 0) notifyError(`${fail} lead(s) não puderam ser importados — confira o arquivo.`);
                          if (tasksFail > 0) notifyError(`${tasksFail} lead(s) entraram SEM atividades — vincule a cadência deles de novo (senão ficam fora da fila).`);
                          setCsvImportedCount(ok);
                          await fetchLeads();
                          } catch (e) {
                            console.warn("[CSV] importação falhou:", e);
                            notifyError("Falha inesperada na importação — tente novamente.");
                          } finally {
                            setCsvImporting(false);
                          }
                        }}
                        disabled={csvImporting}
                        className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] disabled:opacity-50 transition-colors"
                      >
                        {csvImporting ? "Importando..." : `Confirmar importação (${csvRows.length})`}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal de Handover (SDR → Closer) */}
      {showHandover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !handoverSaving && setShowHandover(false)}
          />
          <div className="relative bg-white rounded-xl border border-gray-100 shadow-xl w-full max-w-md mx-4 p-4 md:p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Handover de leads</h2>

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
                      <p className="text-[11px] text-gray-400 mt-1">{handoverPoolSize} lead(s) ativo(s) disponível(is) para transferir.</p>
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
                {handoverSaving ? "Enviando..." : "Confirmar handover"}
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
