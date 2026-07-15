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
import { createCadenceTasks } from "@/lib/qs/queries";
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvRows, setCsvRows] = useState<Array<{ nome: string; empresa: string; telefone: string; email: string; segmento: string }>>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportedCount, setCsvImportedCount] = useState<number | null>(null);
  const [csvCadenceId, setCsvCadenceId] = useState("");
  const [csvProgress, setCsvProgress] = useState(0);

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

  // ── Create Lead form state ──
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formSource, setFormSource] = useState<LeadSource>("manual");
  const [saving, setSaving] = useState(false);

  // ── Fetch data ──
  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_leads")
      .select("*, owner:qs_users(*), loss_reason:qs_loss_reasons(*)")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Erro ao buscar leads:", error);
      return;
    }
    setLeads((data as Lead[]) ?? []);
  }, []);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      await fetchLeads();

      const [usersRes, cadencesRes, lossRes] = await Promise.all([
        supabase.from("qs_users").select("*").eq("is_active", true),
        supabase.from("qs_cadences").select("id, name"),
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
  async function handleCreateLead() {
    if (!formFirstName.trim()) return;
    setSaving(true);
    const fullName = [formFirstName.trim(), formLastName.trim()].filter(Boolean).join(" ");
    const { error } = await supabase.from("qs_leads").insert({
      first_name: formFirstName.trim(),
      last_name: formLastName.trim() || null,
      full_name: fullName,
      email: formEmail.trim() || null,
      phone: formPhone.trim() || null,
      company_name: formCompany.trim() || null,
      source: formSource,
      status: "nao_iniciado" as LeadStatus,
    });
    if (error) {
      console.warn("Erro ao cadastrar lead:", error);
      notifyError("Não foi possível cadastrar o lead — confira os dados e tente novamente.");
    } else {
      notifySuccess(`Lead ${fullName} cadastrado.`);
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
    const { error } = await supabase.from("qs_leads").delete().in("id", ids);
    if (error) {
      console.warn("Erro ao excluir leads:", error);
      notifyError("Não foi possível excluir os leads — tente novamente.");
    } else {
      notifySuccess(`${ids.length} lead(s) excluído(s).`);
      await fetchLeads();
      setSelectedIds(new Set());
    }
  }

  // ── Handover: passa o(s) lead(s) selecionado(s) para um Closer ──
  async function handleHandover() {
    if (selectedIds.size === 0 || !handoverCloserId || !currentUser) return;
    setHandoverSaving(true);
    setHandoverError(null);
    const ids = Array.from(selectedIds);
    try {
      // 1. Registra um handover por lead
      const rows = ids.map((leadId) => ({
        lead_id: leadId,
        from_user_id: currentUser.id,
        to_user_id: handoverCloserId,
        briefing: handoverBriefing.trim(),
      }));
      const { error: handoverErr } = await supabase.from("qs_handovers").insert(rows);
      if (handoverErr) throw handoverErr;

      // 2. Transfere a titularidade dos leads para o closer
      const { error: leadErr } = await supabase
        .from("qs_leads")
        .update({ owner_id: handoverCloserId })
        .in("id", ids);
      if (leadErr) throw leadErr;

      // 3. Reatribui as tarefas abertas — sem isso elas ficavam na fila do SDR
      // antigo (que nem vê mais o lead) e o novo dono não recebia nada.
      await supabase
        .from("qs_tasks")
        .update({ owner_id: handoverCloserId })
        .in("lead_id", ids)
        .in("status", ["pendente", "atrasada"]);

      await fetchLeads();
      setSelectedIds(new Set());
      setShowHandover(false);
      setHandoverCloserId("");
      setHandoverBriefing("");
    } catch (err) {
      console.warn("Erro ao realizar handover:", err);
      // Mostra a CAUSA real (mensagem do Supabase) em vez de um texto genérico —
      // sem isso, um erro de RLS/constraint fica invisível e não dá pra corrigir.
      const msg = (err as { message?: string })?.message || "erro desconhecido";
      setHandoverError(`Não foi possível realizar o handover: ${msg}`);
    } finally {
      setHandoverSaving(false);
    }
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
      const rows = ids.map((leadId) => ({ lead_id: leadId, from_user_id: handoverFromId, to_user_id: handoverCloserId, briefing }));
      const { error: hErr } = await supabase.from("qs_handovers").insert(rows);
      if (hErr) throw hErr;
      const { error: lErr } = await supabase.from("qs_leads").update({ owner_id: handoverCloserId }).in("id", ids);
      if (lErr) throw lErr;
      await supabase.from("qs_tasks").update({ owner_id: handoverCloserId }).in("lead_id", ids).in("status", ["pendente", "atrasada"]);
      await fetchLeads();
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
    return result;
  }, [leads, search, filterSource, filterStatus, filterCadence, filterOwner, filterLossReason, currentUser]);

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
  }

  // ── Cadence name helper ──
  function cadenceName(id: string | null) {
    if (!id) return "\u2014";
    return cadences.find((c) => c.id === id)?.name ?? "\u2014";
  }

  // ── Active filter helpers ──
  const hasActiveFilters = filterSource || filterStatus || filterCadence || filterOwner || filterLossReason;

  function clearFilters() {
    setFilterSource("");
    setFilterStatus("");
    setFilterCadence("");
    setFilterOwner("");
    setFilterLossReason("");
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
                if (!cadId) return;
                e.target.value = "";
                const ids = Array.from(selectedIds);
                const cadName = cadences.find((c) => c.id === cadId)?.name ?? "cadência";
                if (!window.confirm(`Vincular ${ids.length} lead(s) à cadência "${cadName}" e criar as atividades a partir de hoje?`)) return;
                const { error } = await supabase
                  .from("qs_leads")
                  .update({ cadence_id: cadId, status: "em_prospeccao", cadence_started_at: new Date().toISOString() })
                  .in("id", ids);
                if (error) {
                  console.warn("Erro ao vincular cadência:", error);
                  notifyError("Não foi possível vincular a cadência — tente novamente.");
                  return;
                }
                // Gera as TAREFAS da cadência pra cada lead — antes o vínculo em massa
                // não criava atividade nenhuma e os leads sumiam da fila de todo mundo.
                let tasksFail = 0;
                for (const id of ids) {
                  const leadOwner = leads.find((l) => l.id === id)?.owner_id ?? null;
                  const created = await createCadenceTasks(id, cadId, leadOwner);
                  if (created === null) tasksFail++;
                }
                setLeads(prev => prev.map(l => ids.includes(l.id) ? { ...l, cadence_id: cadId, status: "em_prospeccao" as LeadStatus } : l));
                setSelectedIds(new Set());
                if (tasksFail === 0) notifySuccess(`${ids.length} lead(s) vinculados à ${cadName} — atividades criadas.`);
                else notifyError(`${tasksFail} lead(s) ficaram sem atividades — vincule a cadência deles de novo.`);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#0147FF] text-xs font-medium text-white cursor-pointer"
              defaultValue=""
            >
              <option value="" disabled>Vincular à Cadência</option>
              {cadences.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              onChange={async (e) => {
                const ownerId = e.target.value;
                if (!ownerId) return;
                const ids = Array.from(selectedIds);
                const owner = users.find(u => u.id === ownerId);
                // 1. Reatribui o lead — e CHECA o erro (antes ele era ignorado e a
                //    tela fingia sucesso mesmo quando a gravação falhava).
                const { error: leadErr } = await supabase.from("qs_leads").update({ owner_id: ownerId }).in("id", ids);
                if (leadErr) {
                  notifyError(`Não foi possível atribuir o responsável: ${leadErr.message}`);
                  e.target.value = "";
                  return;
                }
                // 2. Leva as tarefas abertas junto — senão o novo dono recebe o lead
                //    mas fica SEM atividades no Painel (e o antigo fica com tarefas órfãs).
                const { error: taskErr } = await supabase
                  .from("qs_tasks")
                  .update({ owner_id: ownerId })
                  .in("lead_id", ids)
                  .in("status", ["pendente", "atrasada"]);
                if (taskErr) console.warn("Reatribuição de tarefas falhou:", taskErr);
                // 3. Recarrega do banco (fonte da verdade) em vez de assumir sucesso.
                await fetchLeads();
                setSelectedIds(new Set());
                e.target.value = "";
                notifySuccess(`${ids.length} lead(s) atribuído(s) a ${owner?.name ?? "o responsável"}.`);
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
                    Nenhum lead encontrado com os filtros atuais.
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
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                  page === currentPage
                    ? "bg-[#0147FF] text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {page}
              </button>
            ))}
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
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="email@exemplo.com.br"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Telefone</label>
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
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
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateLead}
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
            onClick={() => { setShowCsvModal(false); setCsvRows([]); setCsvImportedCount(null); }}
          />
          <div className="relative bg-white rounded-xl border border-gray-100 shadow-none w-full max-w-2xl mx-4 p-4 md:p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900">Importar Leads via CSV</h2>
              <button
                onClick={() => { setShowCsvModal(false); setCsvRows([]); setCsvImportedCount(null); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
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
                <button
                  onClick={() => { setShowCsvModal(false); setCsvRows([]); setCsvImportedCount(null); }}
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
                          const lines = text.split("\n").filter((l) => l.trim());
                          if (lines.length < 2) return;

                          // Parse header
                          const header = lines[0].split(/[,;]/).map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
                          const colNome = header.findIndex((h) => h === "nome" || h === "name");
                          const colEmpresa = header.findIndex((h) => h === "empresa" || h === "company" || h === "company_name");
                          const colTelefone = header.findIndex((h) => h === "telefone" || h === "phone" || h === "tel");
                          const colEmail = header.findIndex((h) => h === "email" || h === "e-mail");
                          const colSegmento = header.findIndex((h) => h === "segmento" || h === "segment");

                          const rows = lines.slice(1).map((line) => {
                            const cols = line.split(/[,;]/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
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
                          <div className="h-full rounded-full bg-[#0147FF] transition-all" style={{ width: `${Math.round((csvProgress / Math.max(csvRows.length, 1)) * 100)}%` }} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1 tabular-nums">Importando {csvProgress}/{csvRows.length}…</p>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setCsvRows([])}
                        className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={async () => {
                          setCsvImporting(true);
                          setCsvProgress(0);

                          // Dedupe dentro do arquivo (mesmo e-mail ou telefone = 1 lead só).
                          const seen = new Set<string>();
                          const rows = csvRows.filter((r) => {
                            const key = (r.email.trim().toLowerCase() || r.telefone.replace(/\D/g, "") || r.nome.trim().toLowerCase());
                            if (!key || seen.has(key)) return false;
                            seen.add(key);
                            return true;
                          });

                          // Dias/atividades da cadência (1 busca só, reusada em todos os leads).
                          const cad = cadences.find((c) => c.id === csvCadenceId);
                          let cadDays: { day_number: number; activities: { channel_type: string; scheduled_time: string | null; order_index: number }[] }[] = [];
                          if (csvCadenceId) {
                            const { data } = await supabase
                              .from("qs_cadence_days")
                              .select("day_number, activities:qs_cadence_activities(channel_type, scheduled_time, order_index)")
                              .eq("cadence_id", csvCadenceId)
                              .order("day_number");
                            cadDays = (data ?? []) as typeof cadDays;
                          }

                          // Insere UM POR VEZ: cada insert é uma transação própria, então o
                          // round-robin do banco rotaciona os SDRs (em lote cairia tudo no mesmo).
                          let ok = 0, fail = 0;
                          for (const row of rows) {
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
                              const base = new Date();
                              const taskRows = cadDays.flatMap((d) =>
                                [...d.activities].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((a) => {
                                  const when = new Date(base);
                                  when.setDate(when.getDate() + Math.max(0, (d.day_number ?? 1) - 1));
                                  const [h, m] = (a.scheduled_time || "09:00").split(":");
                                  when.setHours(Number(h) || 9, Number(m) || 0, 0, 0);
                                  return {
                                    lead_id: inserted.id,
                                    cadence_id: csvCadenceId,
                                    owner_id: inserted.owner_id,
                                    channel_type: a.channel_type,
                                    priority: cad?.priority ?? "media",
                                    scheduled_at: when.toISOString(),
                                    status: "pendente",
                                    is_extra: false,
                                  };
                                })
                              );
                              if (taskRows.length > 0) await supabase.from("qs_tasks").insert(taskRows);
                            }
                            setCsvProgress((p) => p + 1);
                          }

                          if (fail > 0) notifyError(`${fail} lead(s) não puderam ser importados — confira o arquivo.`);
                          setCsvImportedCount(ok);
                          await fetchLeads();
                          setCsvImporting(false);
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
