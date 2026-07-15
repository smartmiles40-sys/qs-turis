import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { createQsAuthUser, updateQsAuthUser, deleteQsAuthUser } from "@/lib/adminUsers";
import { loadWorkHours, saveWorkHours, DEFAULT_WORK_HOURS, WEEKDAY_NAMES, type WorkHours } from "@/lib/workHours";
import { loadMeetingTeam, saveMeetingTeam, getSetting, setSetting } from "@/lib/qsSettings";
import { notifyError } from "@/lib/qs/notify";
import { WAVOIP_TOKEN_KEY } from "@/lib/wavoip";
import { SIP_ENABLED_KEY, SIP_HOST_KEY, SIP_USER_KEY, SIP_PREFIX_KEY, SIP_INSTALLER_URL_KEY, SIP_RAMAIS_KEY, DEFAULT_SIP_HOST } from "@/lib/sip";
import { getSipSharedConfig, saveSipSharedConfig, listSipLines, saveSipLine, deleteSipLine, type SipLineAdmin } from "@/lib/webphone";
import { getAgendaEmbed, saveAgendaEmbed, buildAgendaEmbedSrc } from "@/lib/qs/agenda";
import type {
  CustomField,
  CustomFieldScope,
  LossReason,
  SdrUser,
  UserRole,
} from "../types";

// ── Label Maps ──────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  gestor: "Gestor",
  sdr: "Qualificador",
  closer: "Closer",
};

const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  admin: "bg-purple-50 text-purple-700",
  gestor: "bg-blue-50 text-blue-700",
  sdr: "bg-green-50 text-green-700",
  closer: "bg-amber-50 text-amber-700",
};

const SCOPE_LABELS: Record<CustomFieldScope, string> = {
  pessoal: "Pessoal",
  empresa: "Empresa",
  contato: "Contato",
};

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Seleção",
  email: "E-mail",
  phone: "Telefone",
  url: "URL",
};

// ── Sidebar nav ──────────────────────────────────────────────────────────────

type SettingsSection = "produtos" | "canais" | "campos" | "motivos" | "horario" | "equipe" | "agenda" | "webfone" | "webfone-webrtc" | "telefone-sip" | "usuarios";

interface SidebarItem {
  key: SettingsSection;
  label: string;
  group: string;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { key: "produtos", label: "Produtos", group: "PLATAFORMA" },
  { key: "canais", label: "Canais de Contato", group: "PLATAFORMA" },
  { key: "campos", label: "Campos Personalizados", group: "PLATAFORMA" },
  { key: "motivos", label: "Motivos de Perda", group: "PLATAFORMA" },
  { key: "horario", label: "Horário de Trabalho", group: "EMPRESA" },
  { key: "equipe", label: "Equipe da Reunião", group: "EMPRESA" },
  { key: "agenda", label: "Agenda (Google)", group: "EMPRESA" },
  { key: "webfone", label: "Webfone (Wavoip)", group: "EMPRESA" },
  { key: "webfone-webrtc", label: "Webfone WebRTC (VoxFree)", group: "EMPRESA" },
  { key: "telefone-sip", label: "Telefone (SIP)", group: "EMPRESA" },
  { key: "usuarios", label: "Usuários e Permissões", group: "EMPRESA" },
];

// ── Inline SVG Icons ────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ── Channel Icons (inline SVG) ──────────────────────────────────────────────

function ChannelSvgIcon({ type }: { type: string }) {
  switch (type) {
    case "pesquisa":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
    case "email":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>;
    case "ligacao":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
    case "ligacao_whatsapp":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" /><path d="M14.7 13.4c-.25-.13-1.02-.5-1.18-.56-.16-.06-.27-.09-.39.09-.11.17-.44.55-.54.66-.1.12-.2.13-.37.05-.17-.09-.72-.27-1.37-.85-.5-.45-.85-1.01-.95-1.18-.1-.17-.01-.26.08-.35.08-.08.17-.2.26-.3.09-.11.11-.18.17-.3.06-.11.03-.21-.01-.3-.05-.09-.39-.93-.53-1.28-.14-.33-.28-.29-.39-.29h-.33c-.11 0-.3.04-.45.21-.16.17-.6.58-.6 1.42s.61 1.65.7 1.76c.09.12 1.2 1.84 2.92 2.58.41.18.72.28.97.36.41.13.78.11 1.07.07.33-.05 1.02-.42 1.16-.82.14-.4.14-.74.1-.82-.04-.07-.15-.11-.32-.19z" fill="currentColor" stroke="none" /></svg>;
    case "whatsapp":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>;
    case "linkedin":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>;
    case "instagram":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>;
    case "tiktok":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12a4 4 0 104 4V4a5 5 0 005 5" /></svg>;
    case "youtube":
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29 29 0 001 11.75a29 29 0 00.46 5.33A2.78 2.78 0 003.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 001.94-2 29 29 0 00.46-5.25 29 29 0 00-.46-5.43z" /><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" /></svg>;
    default:
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>;
  }
}

// ── Campos Personalizados ────────────────────────────────────────────────────

const FIELD_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Seleção" },
];

function CamposSection() {
  const [activeScope, setActiveScope] = useState<CustomFieldScope>("pessoal");
  const [allFields, setAllFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editField, setEditField] = useState<CustomField | null>(null);
  const [form, setForm] = useState({ label: "", scope: "pessoal" as CustomFieldScope, field_type: "text" });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function loadFields() {
    setLoading(true);
    const { data, error } = await supabase.from("qs_custom_fields").select("*").order("label");
    if (error) console.warn("Erro ao buscar campos:", error);
    else setAllFields((data as CustomField[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { loadFields(); }, []);

  const fields = allFields.filter((f) => f.scope === activeScope);

  function openAdd() {
    setEditField(null);
    setForm({ label: "", scope: activeScope, field_type: "text" });
    setErrorMsg(null);
    setShowModal(true);
  }

  function openEdit(field: CustomField) {
    setEditField(field);
    setForm({ label: field.label, scope: field.scope, field_type: field.field_type });
    setErrorMsg(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.label.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    if (editField) {
      const { error } = await supabase
        .from("qs_custom_fields")
        .update({ label: form.label.trim(), scope: form.scope, field_type: form.field_type })
        .eq("id", editField.id);
      if (error) {
        console.warn("Erro ao atualizar campo:", error);
        setErrorMsg("Não foi possível salvar o campo. Tente novamente.");
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("qs_custom_fields")
        .insert({ label: form.label.trim(), scope: form.scope, field_type: form.field_type, is_system: false, is_archived: false });
      if (error) {
        console.warn("Erro ao criar campo:", error);
        setErrorMsg("Não foi possível criar o campo. Tente novamente.");
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setShowModal(false);
    await loadFields();
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Campos Personalizados</h2>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#0147FF] hover:bg-[#0139D6] transition-colors">
          <PlusIcon /> Novo Campo
        </button>
      </div>

      <div className="flex gap-1">
        {(["pessoal", "empresa", "contato"] as CustomFieldScope[]).map((scope) => (
          <button
            key={scope}
            onClick={() => setActiveScope(scope)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeScope === scope
                ? "bg-[#0147FF] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {SCOPE_LABELS[scope]}
            <span className={`ml-1.5 ${activeScope === scope ? "text-white/70" : "text-gray-400"}`}>
              {allFields.filter((f) => f.scope === scope).length}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-x-auto">
        {fields.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum campo neste escopo.</div>
        ) : (
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Campo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Origem</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-700 font-medium">{field.label}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}</td>
                  <td className="px-4 py-3">
                    {field.is_system ? (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-400"><LockIcon /> Sistema</span>
                    ) : (
                      <span className="text-xs text-[#0147FF] font-medium">Personalizado</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {field.is_system ? (
                      <span className="text-xs text-gray-300">--</span>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => openEdit(field)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Editar"><PencilIcon /></button>
                        <button
                          onClick={async () => {
                            // Excluir um campo apaga também os valores preenchidos nos leads.
                            if (!window.confirm(`Excluir o campo "${field.label}"? Os valores já preenchidos nos leads serão apagados.`)) return;
                            const { error } = await supabase.from("qs_custom_fields").delete().eq("id", field.id);
                            if (error) {
                              console.warn("Erro ao excluir campo:", error);
                              notifyError("Não foi possível excluir o campo — tente novamente.");
                            }
                            else setAllFields((prev) => prev.filter((f) => f.id !== field.id));
                          }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Excluir"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Criar/Editar Campo */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 md:p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-gray-900 mb-4">{editField ? "Editar Campo" : "Novo Campo"}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nome do campo *</label>
                <input type="text" value={form.label} onChange={(e) => setForm(p => ({ ...p, label: e.target.value }))} placeholder="Ex.: Orçamento estimado" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Escopo</label>
                <select value={form.scope} onChange={(e) => setForm(p => ({ ...p, scope: e.target.value as CustomFieldScope }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400">
                  <option value="pessoal">Pessoal</option>
                  <option value="empresa">Empresa</option>
                  <option value="contato">Contato</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Tipo</label>
                <select value={form.field_type} onChange={(e) => setForm(p => ({ ...p, field_type: e.target.value }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400">
                  {FIELD_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button onClick={handleSave} disabled={saving || !form.label.trim()} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#0147FF" }}>
                {saving ? "Salvando..." : editField ? "Salvar" : "Criar"}
              </button>
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Motivos de Perda ─────────────────────────────────────────────────────────

function MotivosSection() {
  const [showArchived, setShowArchived] = useState(false);
  const [reasons, setReasons] = useState<LossReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editReason, setEditReason] = useState<LossReason | null>(null);
  const [form, setForm] = useState({ label: "" });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function loadReasons() {
    setLoading(true);
    const { data, error } = await supabase.from("qs_loss_reasons").select("*").order("label");
    if (error) console.warn("Erro ao buscar motivos:", error);
    else setReasons((data as LossReason[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { loadReasons(); }, []);

  function openAdd() {
    setEditReason(null);
    setForm({ label: "" });
    setErrorMsg(null);
    setShowModal(true);
  }

  function openEdit(reason: LossReason) {
    setEditReason(reason);
    setForm({ label: reason.label });
    setErrorMsg(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.label.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    if (editReason) {
      const { error } = await supabase.from("qs_loss_reasons").update({ label: form.label.trim() }).eq("id", editReason.id);
      if (error) {
        console.warn("Erro ao atualizar motivo:", error);
        setErrorMsg("Não foi possível salvar o motivo. Tente novamente.");
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("qs_loss_reasons").insert({ label: form.label.trim(), is_predefined: false, is_archived: false });
      if (error) {
        console.warn("Erro ao criar motivo:", error);
        setErrorMsg("Não foi possível criar o motivo. Tente novamente.");
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setShowModal(false);
    await loadReasons();
  }

  const predefined = reasons.filter((r) => r.is_predefined);
  const custom = reasons.filter((r) => !r.is_predefined && (showArchived || !r.is_archived));

  async function toggleArchive(reason: LossReason) {
    const { error } = await supabase.from("qs_loss_reasons").update({ is_archived: !reason.is_archived }).eq("id", reason.id);
    if (error) console.warn("Erro ao arquivar/desarquivar:", error);
    else setReasons((prev) => prev.map((r) => r.id === reason.id ? { ...r, is_archived: !r.is_archived } : r));
  }

  async function deleteReason(id: string) {
    const label = reasons.find((r) => r.id === id)?.label ?? "este motivo";
    if (!window.confirm(`Excluir o motivo de perda "${label}"? Se preferir manter o histórico, use Arquivar.`)) return;
    const { error } = await supabase.from("qs_loss_reasons").delete().eq("id", id);
    if (error) {
      console.warn("Erro ao excluir motivo:", error);
      notifyError("Não foi possível excluir — provavelmente há leads perdidos usando esse motivo. Use Arquivar.");
    }
    else setReasons((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Motivos de Perda</h2>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#0147FF] hover:bg-[#0139D6] transition-colors">
          <PlusIcon /> Novo Motivo
        </button>
      </div>

      <div>
        <h3 className="text-xs font-medium text-gray-500 mb-3 flex items-center gap-1.5"><LockIcon /> Predefinidos</h3>
        <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-x-auto">
          {predefined.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum motivo predefinido.</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {predefined.map((reason) => (
                  <tr key={reason.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 text-sm text-gray-700">{reason.label}</td>
                    <td className="px-4 py-3 text-right"><span className="text-xs text-gray-300">Somente leitura</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-500">Personalizados</h3>
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
            <span
              onClick={() => setShowArchived(!showArchived)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showArchived ? "bg-[#0147FF]" : "bg-gray-200"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${showArchived ? "translate-x-4" : "translate-x-0.5"}`} />
            </span>
            Mostrar arquivados
          </label>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-x-auto">
          {custom.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum motivo personalizado.</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {custom.map((reason) => (
                  <tr key={reason.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/40 transition-colors ${reason.is_archived ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 text-sm text-gray-700 flex items-center gap-2">
                      {reason.label}
                      {reason.is_archived && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-400">Arquivado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => openEdit(reason)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Editar"><PencilIcon /></button>
                        <button onClick={() => toggleArchive(reason)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title={reason.is_archived ? "Desarquivar" : "Arquivar"}><ArchiveIcon /></button>
                        <button onClick={() => deleteReason(reason.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Excluir"><TrashIcon /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Criar/Editar Motivo */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 md:p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-gray-900 mb-4">{editReason ? "Editar Motivo" : "Novo Motivo"}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Motivo *</label>
                <input type="text" value={form.label} onChange={(e) => setForm({ label: e.target.value })} placeholder="Ex.: Sem orçamento no momento" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" autoFocus />
              </div>
              {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button onClick={handleSave} disabled={saving || !form.label.trim()} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#0147FF" }}>
                {saving ? "Salvando..." : editReason ? "Salvar" : "Criar"}
              </button>
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Usuários ─────────────────────────────────────────────────────────────────

function UsuariosSection() {
  const [users, setUsers] = useState<SdrUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<SdrUser | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "sdr" as UserRole, password: "", whatsapp_number: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase.from("qs_users").select("*").order("name");
    setUsers((data as SdrUser[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  function openAdd() {
    setEditUser(null);
    setForm({ name: "", email: "", role: "sdr", password: "", whatsapp_number: "" });
    setSaveError(null);
    setShowModal(true);
  }

  function openEdit(u: SdrUser) {
    setEditUser(u);
    setForm({ name: u.name, email: u.email, role: u.role, password: "", whatsapp_number: u.whatsapp_number ?? "" });
    setSaveError(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name || !form.email) return;
    if (!editUser && !form.password) { setSaveError("Defina uma senha para o novo usuário (mín. 6 caracteres)."); return; }
    setSaving(true);
    setSaveError(null);
    const res = editUser
      ? await updateQsAuthUser({
          id: editUser.id,
          name: form.name,
          email: form.email,
          role: form.role,
          whatsapp_number: form.whatsapp_number.trim() || null,
          ...(form.password ? { password: form.password } : {}),
        })
      : await createQsAuthUser({
          name: form.name,
          email: form.email,
          role: form.role,
          whatsapp_number: form.whatsapp_number.trim() || null,
          password: form.password,
        });
    setSaving(false);
    if (!res.success) { setSaveError(res.error || "Falha ao salvar usuário."); return; }
    setShowModal(false);
    loadUsers();
  }

  async function toggleActive(u: SdrUser) {
    await supabase.from("qs_users").update({ is_active: !u.is_active }).eq("id", u.id);
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
  }

  async function deleteUser(u: SdrUser) {
    if (!confirm(`Excluir ${u.name} permanentemente? Os leads dele ficarão sem responsável.`)) return;
    // O endpoint remove a conta de autenticação; o perfil sai via regras de FK
    // (leads/tarefas/reuniões ficam sem responsável; metas são apagadas).
    const res = await deleteQsAuthUser(u.id);
    if (!res.success) { alert(res.error || "Falha ao excluir usuário."); return; }
    setUsers(prev => prev.filter(x => x.id !== u.id));
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Usuários e Permissões</h2>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#0147FF] hover:bg-[#0139D6] transition-colors">
          <PlusIcon /> Adicionar Usuário
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-x-auto">
        {users.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum usuário cadastrado.</div>
        ) : (
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">E-mail</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Papel</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#0147FF] flex items-center justify-center text-white text-xs font-semibold shrink-0">
                        {user.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                      </div>
                      <span className="text-sm text-gray-900 font-medium">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${ROLE_BADGE_CLASSES[user.role]}`}>
                      {ROLE_LABELS[user.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(user)} className="cursor-pointer" title={user.is_active ? "Desativar" : "Ativar"}>
                      {user.is_active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-green-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> Inativo
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(user)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Editar">
                        <PencilIcon />
                      </button>
                      <button onClick={() => deleteUser(user)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Excluir">
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Adicionar/Editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 md:p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-gray-900 mb-4">{editUser ? "Editar Usuário" : "Adicionar Usuário"}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nome *</label>
                <input type="text" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Nome completo" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">E-mail *</label>
                <input type="email" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@empresa.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Papel</label>
                <select value={form.role} onChange={(e) => setForm(p => ({ ...p, role: e.target.value as UserRole }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400">
                  <option value="sdr">Qualificador</option>
                  <option value="closer">Closer</option>
                  <option value="gestor">Gestor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{editUser ? "Nova senha (deixe vazio para manter)" : "Senha *"}</label>
                <input type="password" value={form.password} onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))} placeholder={editUser ? "••••••••" : "Senha de acesso (mín. 6)"} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">WhatsApp do SDR (opcional)</label>
                <input type="tel" value={form.whatsapp_number} onChange={(e) => setForm(p => ({ ...p, whatsapp_number: e.target.value }))} placeholder="Ex.: (11) 99999-8888" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
                <p className="text-[10px] text-gray-400 mt-1">Número que este SDR usa para atender no WhatsApp.</p>
              </div>
            </div>
            {saveError && (
              <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</div>
            )}
            <div className="flex items-center gap-3 mt-5">
              <button onClick={handleSave} disabled={saving || !form.name || !form.email} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#0147FF" }}>
                {saving ? "Salvando..." : editUser ? "Salvar" : "Adicionar"}
              </button>
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Produtos ────────────────────────────────────────────────────────────────

function ProdutosSection() {
  const [products, setProducts] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [newProduct, setNewProduct] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("qs_products").select("*").order("name").then(({ data }) => {
      setProducts((data || []) as any);
      setLoading(false);
    });
  }, []);

  async function addProduct() {
    if (!newProduct.trim()) return;
    const { data } = await supabase.from("qs_products").insert({ name: newProduct.trim() }).select().single();
    if (data) {
      setProducts(prev => [...prev, data as any].sort((a, b) => a.name.localeCompare(b.name)));
      setNewProduct("");
    }
  }

  async function toggleProduct(id: string, active: boolean) {
    await supabase.from("qs_products").update({ is_active: !active }).eq("id", id);
    setProducts(prev => prev.map(p => p.id === id ? { ...p, is_active: !active } : p));
  }

  async function deleteProduct(id: string) {
    const name = products.find((p) => p.id === id)?.name ?? "este produto";
    if (!window.confirm(`Excluir o produto "${name}"? Se ele já foi usado em leads, prefira desativar.`)) return;
    const { error } = await supabase.from("qs_products").delete().eq("id", id);
    if (error) {
      console.warn("Erro ao excluir produto:", error);
      notifyError("Não foi possível excluir o produto — tente desativar em vez de excluir.");
      return;
    }
    setProducts(prev => prev.filter(p => p.id !== id));
  }

  if (loading) return <div className="p-4 md:p-6 text-gray-400">Carregando...</div>;

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Produtos</h2>
          <p className="text-sm text-gray-500 mt-1">Gerencie os produtos disponíveis para cadastro de leads</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={newProduct}
          onChange={(e) => setNewProduct(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addProduct()}
          placeholder="Nome do produto..."
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
        />
        <button
          onClick={addProduct}
          disabled={!newProduct.trim()}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
          style={{ background: "#0147FF" }}
        >
          + Adicionar
        </button>
      </div>

      <div className="space-y-2">
        {products.map(p => (
          <div key={p.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl">
            <span className={`text-sm ${p.is_active ? "text-gray-900" : "text-gray-400 line-through"}`}>{p.name}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleProduct(p.id, p.is_active)}
                className="relative w-10 h-5 rounded-full transition-colors"
                style={{ background: p.is_active ? "#0147FF" : "#D1D5DB" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                  style={{ transform: p.is_active ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
              <button
                onClick={() => deleteProduct(p.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
                title="Excluir"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Canais de Contato ────────────────────────────────────────────────────────

function CanaisSection() {
  const [channels, setChannels] = React.useState([
    { type: "pesquisa", label: "Pesquisa", enabled: true, description: "Pesquisa prévia sobre o lead antes do contato" },
    { type: "email", label: "E-mail", enabled: true, description: "Envio de e-mails de prospecção" },
    { type: "ligacao", label: "Ligação", enabled: true, description: "Ligações de voz pelo softphone BravoTech (SIP) instalado no PC do SDR" },
    { type: "ligacao_whatsapp", label: "Ligação WhatsApp", enabled: true, description: "Ligação de voz pelo WhatsApp (abre a conversa do lead)" },
    { type: "whatsapp", label: "WhatsApp", enabled: true, description: "Mensagens via WhatsApp Business" },
    { type: "linkedin", label: "LinkedIn", enabled: true, description: "Conexão e mensagens via LinkedIn" },
    { type: "instagram", label: "Instagram", enabled: false, description: "Contato via DM do Instagram" },
    { type: "tiktok", label: "TikTok", enabled: false, description: "Interação via TikTok" },
    { type: "youtube", label: "YouTube", enabled: false, description: "Contato via YouTube" },
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      setLoading(true);
      const { data, error } = await supabase.from("qs_channel_config").select("*");
      if (error) {
        console.warn("Erro ao buscar channel config:", error);
      } else if (data && data.length > 0) {
        setChannels((prev) =>
          prev.map((ch) => {
            const dbCh = (data as any[]).find((d) => d.type === ch.type);
            return dbCh ? { ...ch, enabled: dbCh.enabled } : ch;
          })
        );
      }
      setLoading(false);
    }
    fetch();
  }, []);

  async function toggleChannel(type: string) {
    const ch = channels.find((c) => c.type === type);
    if (!ch) return;
    const newEnabled = !ch.enabled;
    setChannels((prev) => prev.map((c) => c.type === type ? { ...c, enabled: newEnabled } : c));

    const { error } = await supabase
      .from("qs_channel_config")
      .upsert({ type, enabled: newEnabled }, { onConflict: "type" });
    if (error) {
      console.warn("Erro ao atualizar canal:", error);
      // Reverte o switch — sem isso ele aparentava salvo mesmo sem persistir.
      setChannels((prev) => prev.map((c) => c.type === type ? { ...c, enabled: !newEnabled } : c));
      notifyError("Não foi possível salvar o canal — tente novamente.");
    }
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Canais de Contato</h2>
        <p className="text-sm text-gray-500 mt-0.5">Configure quais canais estarão disponíveis nas cadências e atividades</p>
      </div>

      <div className="space-y-3">
        {channels.map((ch) => (
          <div
            key={ch.type}
            className={`flex items-center justify-between p-4 bg-white border rounded-xl ${
              ch.enabled ? "border-[#0147FF]/20" : "border-gray-100"
            }`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                ch.enabled ? "bg-[#0147FF]/10 text-[#0147FF]" : "bg-gray-100 text-gray-400"
              }`}>
                <ChannelSvgIcon type={ch.type} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{ch.label}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{ch.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {ch.type === "ligacao" && ch.enabled && (
                <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-green-50 text-green-600 border border-green-200">
                  Webfone
                </span>
              )}
              <button
                onClick={() => toggleChannel(ch.type)}
                className="relative w-11 h-6 rounded-full transition-colors duration-200"
                style={{ background: ch.enabled ? "#0147FF" : "#D1D5DB" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                  style={{ transform: ch.enabled ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 bg-[#0147FF]/5 border border-[#0147FF]/10 rounded-xl">
        <p className="text-xs text-[#0147FF]">
          <strong>Dica:</strong> Os canais habilitados aparecerão como opções na construção de cadências e no painel de atividades.
          Canais desabilitados não serão removidos de cadências existentes.
        </p>
      </div>
    </div>
  );
}

// ── Horário de Trabalho ─────────────────────────────────────────────────────

function HorarioSection() {
  const [wh, setWh] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadWorkHours().then((data) => { setWh(data); setLoading(false); });
  }, []);

  function setDay(day: number, patch: Partial<WorkHours[number]>) {
    setWh((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const ok = await saveWorkHours(wh);
    setSaving(false);
    setSaved(ok);
    if (ok) setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Horário de Trabalho</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Define o expediente da empresa. As métricas de tempo do Painel (ritmo, tempo restante) contam só o que está dentro do horário.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const d = wh[day];
          return (
            <div key={day} className={`flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0 ${d.enabled ? "" : "opacity-60"}`}>
              <button
                onClick={() => setDay(day, { enabled: !d.enabled })}
                className="relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0"
                style={{ background: d.enabled ? "#2563EB" : "#D1D5DB" }}
                title={d.enabled ? "Dia de trabalho" : "Folga"}
              >
                <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200" style={{ transform: d.enabled ? "translateX(20px)" : "translateX(0)" }} />
              </button>
              <span className="w-24 text-sm font-semibold text-gray-800">{WEEKDAY_NAMES[day]}</span>
              {d.enabled ? (
                <div className="flex items-center gap-2 text-sm">
                  <input type="time" value={d.start} onChange={(e) => setDay(day, { start: e.target.value })} className="px-2.5 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
                  <span className="text-gray-400">até</span>
                  <input type="time" value={d.end} onChange={(e) => setDay(day, { end: e.target.value })} className="px-2.5 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
                </div>
              ) : (
                <span className="text-sm text-gray-400">Folga</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#2563EB" }}>
          {saving ? "Salvando..." : "Salvar horário"}
        </button>
        {saved && <span className="text-sm font-medium text-green-600">Salvo ✓</span>}
      </div>
    </div>
  );
}

// ── Equipe da Reunião ───────────────────────────────────────────────────────
// Listas usadas no modal de agendamento do "Ganho": quem agenda e quem faz a
// reunião. Um nome por linha; salvas em qs_settings.

function EquipeSection() {
  const [schedulersText, setSchedulersText] = useState("");
  const [ownersText, setOwnersText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadMeetingTeam().then(({ schedulers, owners }) => {
      setSchedulersText(schedulers.join("\n"));
      setOwnersText(owners.join("\n"));
      setLoading(false);
    });
  }, []);

  const parse = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

  async function handleSave() {
    const schedulers = parse(schedulersText);
    const owners = parse(ownersText);
    if (schedulers.length === 0 || owners.length === 0) return;
    setSaving(true);
    const ok = await saveMeetingTeam(schedulers, owners);
    setSaving(false);
    setSaved(ok);
    if (ok) setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Equipe da Reunião</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Nomes que aparecem no agendamento quando um lead é marcado como <b>Ganho</b>. Um nome por linha.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-2">Quem faz o agendamento</label>
          <textarea
            value={schedulersText}
            onChange={(e) => { setSchedulersText(e.target.value); setSaved(false); }}
            rows={5}
            placeholder={"Mariana Rodrigues - SDR\nVictor Hugo - SDR"}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 resize-none"
          />
          <p className="text-[11px] text-gray-400 mt-1">{parse(schedulersText).length} nome(s)</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-2">Responsáveis pela reunião</label>
          <textarea
            value={ownersText}
            onChange={(e) => { setOwnersText(e.target.value); setSaved(false); }}
            rows={5}
            placeholder={"Talita Carvalho\nVictor Maldonado\nBruno Matheus\nJohn Italo"}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 resize-none"
          />
          <p className="text-[11px] text-gray-400 mt-1">{parse(ownersText).length} nome(s)</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || parse(schedulersText).length === 0 || parse(ownersText).length === 0}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "#2563EB" }}
        >
          {saving ? "Salvando..." : "Salvar equipe"}
        </button>
        {saved && <span className="text-sm font-medium text-green-600">Salvo ✓</span>}
      </div>
    </div>
  );
}

// ── Webfone (Wavoip) ─────────────────────────────────────────────────────────
// Token do dispositivo Wavoip (instância do WhatsApp) usado pelo webfone para
// fazer/receber chamadas de voz. Salvo em qs_settings (chave "wavoip_token").

function WebfoneSection() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    getSetting<string>(WAVOIP_TOKEN_KEY).then((t) => {
      setToken((t ?? "").trim());
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    const ok = await setSetting(WAVOIP_TOKEN_KEY, token.trim());
    setSaving(false);
    setSaved(ok);
    if (ok) setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Webfone (Wavoip)</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Ligações de voz pelo WhatsApp <b>dentro do sistema</b>. Cole aqui o token do dispositivo
          Wavoip (instância do WhatsApp). O botão do webfone fica no canto inferior esquerdo.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-4 max-w-xl">
        <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-2">
          Token do dispositivo
        </label>
        <div className="flex items-center gap-2">
          <input
            type={show ? "text" : "password"}
            value={token}
            onChange={(e) => { setToken(e.target.value); setSaved(false); }}
            placeholder="Ex.: a1b2c3d4-1234-5678-90ab-cdef12345678"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="px-3 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            {show ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Onde encontrar: painel da Wavoip → sua instância do WhatsApp → token do dispositivo.
          Um <code className="text-gray-500">VITE_WAVOIP_TOKEN</code> definido no ambiente, se existir, tem prioridade sobre este campo.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "#2563EB" }}
        >
          {saving ? "Salvando..." : "Salvar token"}
        </button>
        {saved && <span className="text-sm font-medium text-green-600">Salvo ✓ — recarregue a página para o webfone reconectar.</span>}
      </div>
    </div>
  );
}

// ── Telefone (SIP) ───────────────────────────────────────────────────────────
// Discagem por SIP como 2ª forma de contato. O navegador não fala SIP direto:
// quem disca é um softphone (MicroSIP/Zoiper) instalado no PC do SDR, registrado
// com estas credenciais. O CRM só monta o link sip: (click-to-dial). Guia: docs/SIP.md.

function SipSection() {
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState(DEFAULT_SIP_HOST);
  const [prefix, setPrefix] = useState("");
  const [user, setUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      getSetting<boolean>(SIP_ENABLED_KEY),
      getSetting<string>(SIP_HOST_KEY),
      getSetting<string>(SIP_USER_KEY),
      getSetting<string>(SIP_PREFIX_KEY),
    ]).then(([en, h, u, pf]) => {
      setEnabled(en === true);
      setHost((h ?? "").trim() || DEFAULT_SIP_HOST);
      setUser((u ?? "").trim());
      setPrefix((pf ?? "").trim());
      setLoading(false);
    });
  }, []);

  function markDirty() { setSaved(false); }

  async function handleSave() {
    setSaving(true);
    // A SENHA SIP não é mais persistida: qs_settings é legível por qualquer
    // usuário autenticado e o CRM nunca usa a senha (ela vive no softphone).
    // A migration 0011 apaga a linha antiga do banco.
    const ok = (await Promise.all([
      setSetting(SIP_ENABLED_KEY, enabled),
      setSetting(SIP_HOST_KEY, host.trim() || DEFAULT_SIP_HOST),
      setSetting(SIP_USER_KEY, user.trim()),
      setSetting(SIP_PREFIX_KEY, prefix.trim()),
    ])).every(Boolean);
    setSaving(false);
    setSaved(ok);
    if (ok) setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Telefone (SIP)</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          2ª forma de ligar: por um <b>softphone no computador</b> (MicroSIP no Windows, Zoiper).
          O botão "Ligar (SIP)" no lead abre o softphone e disca. Não roda dentro do navegador —
          o SDR instala o softphone uma vez com as credenciais abaixo. Passo a passo em <code className="text-gray-500">docs/SIP.md</code>.
        </p>
      </div>

      {/* Liga/desliga o botão SIP no CRM */}
      <div className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-4 py-3 max-w-xl">
        <div>
          <p className="text-sm font-semibold text-gray-900">Mostrar botão "Ligar (SIP)"</p>
          <p className="text-xs text-gray-400 mt-0.5">Só ative depois que o softphone estiver instalado e registrado.</p>
        </div>
        <button
          onClick={() => { setEnabled((v) => !v); markDirty(); }}
          className="relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0"
          style={{ background: enabled ? "#2563EB" : "#D1D5DB" }}
          title={enabled ? "Ativado" : "Desativado"}
        >
          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200" style={{ transform: enabled ? "translateX(20px)" : "translateX(0)" }} />
        </button>
      </div>

      {/* Credenciais (referência p/ configurar o softphone) */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 max-w-xl space-y-3">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1">Servidor (host/domínio)</label>
          <input
            type="text"
            value={host}
            onChange={(e) => { setHost(e.target.value); markDirty(); }}
            placeholder={DEFAULT_SIP_HOST}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1">Prefixo de discagem</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => { setPrefix(e.target.value); markDirty(); }}
            placeholder="ex.: 1*  ou  01*"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
            spellCheck={false}
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Vai na <b>frente do número</b> pra completar a ligação (a BravoTech pediu <code>1*</code> ou <code>01*</code> — teste e ajuste). Vazio = disca o número puro.
          </p>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1">Usuário SIP</label>
          <input
            type="text"
            value={user}
            onChange={(e) => { setUser(e.target.value); markDirty(); }}
            placeholder="Ex.: seu-usuario-sip"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <p className="text-[11px] text-gray-400">
          O usuário é só <b>referência</b> para configurar o softphone — o CRM não liga por ele,
          quem autentica é o softphone. A <b>senha do ramal fica SÓ no softphone</b> (por segurança o QS
          não guarda senha). O click-to-dial disca <b>prefixo + número</b> (o servidor só entra se você preencher um domínio próprio).
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#2563EB" }}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        {saved && <span className="text-sm font-medium text-green-600">Salvo ✓</span>}
      </div>

      <SipProvisioning />
    </div>
  );
}

// ── Provisionamento: link do instalador + ramal de cada SDR (admin) ──────────
// Guarda o link do instalador (sip_installer_url) e o mapa usuário→ramal
// (sip_ramais) em qs_settings. Alimenta o onboarding guiado que aparece pro SDR.
function SipProvisioning() {
  const [installerUrl, setInstallerUrl] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string | null }[]>([]);
  const [map, setMap] = useState<Record<string, { ramal: string; login: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const [urlRes, mapRes, usersRes] = await Promise.all([
        getSetting<string>(SIP_INSTALLER_URL_KEY),
        getSetting<Record<string, { ramal?: string; login?: string }>>(SIP_RAMAIS_KEY),
        supabase.from("qs_users").select("id, name").eq("is_active", true).order("name"),
      ]);
      setInstallerUrl((urlRes ?? "").trim());
      const m: Record<string, { ramal: string; login: string }> = {};
      const src = mapRes ?? {};
      Object.keys(src).forEach((k) => { m[k] = { ramal: src[k]?.ramal ?? "", login: src[k]?.login ?? "" }; });
      setMap(m);
      if (!usersRes.error) setUsers((usersRes.data as { id: string; name: string | null }[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  function setUserField(id: string, field: "ramal" | "login", value: string) {
    setMap((prev) => ({ ...prev, [id]: { ramal: prev[id]?.ramal ?? "", login: prev[id]?.login ?? "", [field]: value } }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    // Só guarda quem tem ramal preenchido (limpa os vazios).
    const clean: Record<string, { ramal: string; login?: string }> = {};
    Object.entries(map).forEach(([id, v]) => {
      if (v.ramal.trim()) clean[id] = { ramal: v.ramal.trim(), login: v.login.trim() || undefined };
    });
    const ok = (await Promise.all([
      setSetting(SIP_INSTALLER_URL_KEY, installerUrl.trim()),
      setSetting(SIP_RAMAIS_KEY, clean),
    ])).every(Boolean);
    setSaving(false);
    setSaved(ok);
    if (ok) setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return null;

  return (
    <div className="border-t border-gray-100 pt-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-gray-900">Onboarding do SDR (instalação guiada)</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Quando o SDR abre o QS, aparece um passo a passo pra instalar o telefone sem procurar nada — com o ramal dele já preenchido.
        </p>
      </div>

      <div className="max-w-xl">
        <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1">Link do instalador (BravoTech)</label>
        <input
          type="text"
          value={installerUrl}
          onChange={(e) => { setInstallerUrl(e.target.value); setSaved(false); }}
          placeholder="Deixe vazio para usar o instalador embarcado"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
          spellCheck={false}
        />
        <p className="text-[11px] text-gray-400 mt-1">
          Vazio = o SDR baixa o BravoTech já embarcado no QS. Preencha só se quiser servir uma versão diferente.
        </p>
      </div>

      <div className="max-w-xl">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Ramal de cada SDR</p>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-gray-700 truncate">{u.name ?? "—"}</span>
              <input
                type="text"
                value={map[u.id]?.ramal ?? ""}
                onChange={(e) => setUserField(u.id, "ramal", e.target.value)}
                placeholder="ramal"
                className="w-24 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
                spellCheck={false}
              />
              <input
                type="text"
                value={map[u.id]?.login ?? ""}
                onChange={(e) => setUserField(u.id, "login", e.target.value)}
                placeholder="login SIP (opcional)"
                className="w-44 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
                spellCheck={false}
              />
            </div>
          ))}
          {users.length === 0 && <p className="text-xs text-gray-400">Nenhum usuário ativo encontrado.</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#2563EB" }}>
          {saving ? "Salvando..." : "Salvar onboarding"}
        </button>
        {saved && <span className="text-sm font-medium text-green-600">Salvo ✓</span>}
      </div>
    </div>
  );
}

// ── Webfone WebRTC (VoxFree) ─────────────────────────────────────────────────
// Ligação de voz DENTRO do navegador (JsSIP). Duas partes:
//   • Config compartilhada (WSS/domínio/prefixo) → qs_settings (não-secreta).
//   • Ramal + senha POR SDR → qs_sip_lines (RLS por dono: cada SDR só lê a dele).
// Só admin/gestor grava (RLS). Requer a migration 0013_sip_lines.sql aplicada.

type QsUserLite = { id: string; name: string; email: string; role: string };

function WebfoneWebrtcSection() {
  const [wsUrl, setWsUrl] = useState("");
  const [prefix, setPrefix] = useState("");
  const [savingShared, setSavingShared] = useState(false);
  const [sharedSaved, setSharedSaved] = useState(false);

  const [users, setUsers] = useState<QsUserLite[]>([]);
  const [lines, setLines] = useState<Record<string, SipLineAdmin>>({});
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true);
    const [cfg, allLines, usersRes] = await Promise.all([
      getSipSharedConfig(),
      listSipLines(),
      supabase.from("qs_users").select("id, name, email, role").eq("is_active", true).order("name"),
    ]);
    setWsUrl(cfg.wsUrl); setPrefix(cfg.prefix);
    const map: Record<string, SipLineAdmin> = {};
    for (const l of allLines) map[l.user_id] = l;
    setLines(map);
    setUsers(((usersRes.data as QsUserLite[]) ?? []));
    setLoading(false);
  }

  async function handleSaveShared() {
    setSavingShared(true);
    const ok = await saveSipSharedConfig({ wsUrl, domain: "", prefix });
    setSavingShared(false);
    if (ok) { setSharedSaved(true); setTimeout(() => setSharedSaved(false), 2000); }
    else notifyError("Não foi possível salvar a configuração (apenas admin/gestor).");
  }

  function updateLine(userId: string, patch: Partial<SipLineAdmin>) {
    setLines((prev) => {
      const base: SipLineAdmin = prev[userId] ?? { user_id: userId, auth_user: "", password: "", ws_url: null, display_name: null, active: true };
      return { ...prev, [userId]: { ...base, ...patch, user_id: userId } };
    });
  }

  async function handleSaveUser(userId: string) {
    const line = lines[userId];
    if (!line || !line.auth_user.trim() || !line.password.trim()) { notifyError("Preencha o ramal e a senha."); return; }
    setSavingUser(userId);
    const ok = await saveSipLine({ ...line, user_id: userId });
    setSavingUser(null);
    if (ok) { setSavedUser(userId); setTimeout(() => setSavedUser(null), 2000); }
    else notifyError("Não foi possível salvar a linha (apenas admin/gestor).");
  }

  async function handleRemoveUser(userId: string) {
    const ok = await deleteSipLine(userId);
    if (ok) setLines((prev) => { const n = { ...prev }; delete n[userId]; return n; });
    else notifyError("Não foi possível remover a linha.");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Webfone WebRTC (VoxFree)</h2>
        <p className="text-sm text-gray-500 mt-1">
          Ligação de voz <b>dentro do navegador</b> — o SDR clica "Ligar" no lead e fala pelo microfone,
          sem instalar nada. Substitui o softphone no canal "Ligação" quando o ramal do SDR estiver preenchido aqui.
        </p>
      </div>

      {/* Config compartilhada: modelo de URL + prefixo. ATENÇÃO: no VoxFree o
          "box" muda POR RAMAL, então a URL WSS certa vai no ramal de cada SDR
          (abaixo). Aqui é só o modelo pra copiar/colar e o prefixo de saída. */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Padrões (compartilhados)</h3>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">URL do WebSocket — modelo</label>
          <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} placeholder="wss://box49.voxfree.com:5080"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
          <p className="text-[11px] text-gray-400 mt-1">
            Modelo pré-preenchido no campo de cada SDR. O <b>box muda por ramal</b>
            (o número do box = 2 últimos dígitos da porta de registro: 50049→box49, 50030→box30) — ajuste por SDR abaixo.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Prefixo de rota (saída)</label>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="(vazio = disca o número puro)"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleSaveShared} disabled={savingShared} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#2563EB" }}>
            {savingShared ? "Salvando..." : "Salvar padrões"}
          </button>
          {sharedSaved && <span className="text-sm font-medium text-green-600">Salvo ✓</span>}
        </div>
      </div>

      {/* Ramal + senha por SDR (secreto — só o dono lê a dele) */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center gap-1.5">
          <LockIcon />
          <h3 className="text-sm font-semibold text-gray-900">Ramais por SDR</h3>
        </div>
        <p className="text-xs text-gray-500">
          O <b>usuário de autorização</b> é o ramal do VoxFree (ex.: <code className="text-gray-600">2272_2001</code>).
          Cada SDR só enxerga o próprio ramal; a senha nunca fica visível para os outros.
        </p>
        {loading ? (
          <p className="text-sm text-gray-400">Carregando…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum usuário ativo. Crie os SDRs em "Usuários e Permissões".</p>
        ) : (
          <div className="space-y-3">
            {users.map((u) => {
              const line = lines[u.id];
              const has = !!line;
              return (
                <div key={u.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{u.name}</p>
                      <p className="text-[11px] text-gray-400">{u.email}</p>
                    </div>
                    {has && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input type="checkbox" checked={line.active} onChange={(e) => updateLine(u.id, { active: e.target.checked })} />
                        Ativo
                      </label>
                    )}
                  </div>
                  <div className="mb-2">
                    <input
                      value={line?.ws_url ?? ""}
                      onChange={(e) => updateLine(u.id, { ws_url: e.target.value })}
                      placeholder={wsUrl ? `URL WSS do box deste ramal (vazio = ${wsUrl})` : "URL WSS do box deste ramal — ex.: wss://box30.voxfree.com:5080"}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400 font-mono"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">O box muda por ramal (ex.: 2001→box49, 2002→box30). Vazio usa o modelo acima.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      value={line?.auth_user ?? ""}
                      onChange={(e) => updateLine(u.id, { auth_user: e.target.value })}
                      placeholder="Ramal (auth user) — ex.: 2272_2001"
                      className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
                    />
                    <input
                      value={line?.password ?? ""}
                      onChange={(e) => updateLine(u.id, { password: e.target.value })}
                      placeholder="Senha SIP"
                      autoComplete="new-password"
                      className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400 font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => handleSaveUser(u.id)} disabled={savingUser === u.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: "#2563EB" }}>
                      {savingUser === u.id ? "Salvando..." : "Salvar ramal"}
                    </button>
                    {has && (
                      <button onClick={() => handleRemoveUser(u.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50">
                        Remover
                      </button>
                    )}
                    {savedUser === u.id && <span className="text-xs font-medium text-green-600">Salvo ✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Requer a migration <code className="text-gray-500">0013_sip_lines.sql</code> aplicada no Supabase. Sem TURN configurado,
        o áudio depende do relay do próprio VoxFree (funciona na maioria das redes).
      </p>
    </div>
  );
}

// ── Agenda (Google) ──────────────────────────────────────────────────────────
// Embed da Google Agenda compartilhada dos closers (só visualização). O admin
// cola o ID da agenda ou a URL de incorporação; a aba "Agenda" monta o iframe.

function AgendaSection() {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { void getAgendaEmbed().then((v) => { setValue(v); setLoaded(true); }); }, []);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAgendaEmbed(value);
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    else notifyError("Não foi possível salvar (apenas admin/gestor).");
  }

  const previewSrc = buildAgendaEmbedSrc(value, "WEEK");

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Agenda (Google)</h2>
        <p className="text-sm text-gray-500 mt-1">
          A aba <b>Agenda</b> mostra a Google Agenda compartilhada dos closers embutida, pros SDRs verem
          todas as reuniões num lugar só. Só visualização — a criação segue pelo Bitrix.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <label className="block text-xs font-medium text-gray-500">ID da agenda compartilhada ou URL de incorporação</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ex.: abc123@group.calendar.google.com  (ou a URL completa do 'Incorporar')"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 font-mono"
        />
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving || !loaded} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#2563EB" }}>
            {saving ? "Salvando..." : "Salvar agenda"}
          </button>
          {saved && <span className="text-sm font-medium text-green-600">Salvo ✓</span>}
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 text-xs text-gray-500 space-y-1.5">
        <p className="font-semibold text-gray-700 text-sm">Onde achar o ID e como liberar pros SDRs</p>
        <p>1. Google Agenda → passe o mouse na agenda dos closers → <b>⋮ → Configurações e compartilhamento</b>.</p>
        <p>2. Em <b>Integrar agenda</b>, copie o <b>ID da agenda</b> (<code>…@group.calendar.google.com</code>) ou a URL do campo "Incorporar agenda".</p>
        <p>3. Em <b>Permissões de acesso</b>, deixe a agenda visível pro time (compartilhe com as contas Google dos SDRs) — ou "Tornar disponível ao público → Ver todos os detalhes". ⚠️ público expõe os títulos das reuniões; prefira compartilhar só com o time.</p>
        <p>Duas agendas (uma por closer)? Cole os dois IDs <b>separados por vírgula</b>.</p>
      </div>

      {previewSrc && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Prévia</p>
          <iframe src={previewSrc} title="Prévia da agenda" className="w-full h-72 rounded-xl border border-gray-200" />
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("produtos");

  const groups = SIDEBAR_ITEMS.reduce<Record<string, SidebarItem[]>>(
    (acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    },
    {}
  );

  return (
    <div className="flex flex-col md:flex-row gap-6 min-h-[600px]" style={{ fontFamily: "inherit" }}>
      {/* Internal Sidebar */}
      <aside className="w-full md:w-56 shrink-0">
        <div className="sticky top-0 space-y-5">
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Configurações
          </h1>

          <nav className="space-y-4">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-3">
                  {group}
                </span>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.key}>
                      <button
                        onClick={() => setActiveSection(item.key)}
                        className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                          activeSection === item.key
                            ? "bg-[#0147FF]/5 text-[#0147FF] font-medium"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0">
        {activeSection === "produtos" && <ProdutosSection />}
        {activeSection === "canais" && <CanaisSection />}
        {activeSection === "campos" && <CamposSection />}
        {activeSection === "motivos" && <MotivosSection />}
        {activeSection === "horario" && <HorarioSection />}
        {activeSection === "equipe" && <EquipeSection />}
        {activeSection === "agenda" && <AgendaSection />}
        {activeSection === "webfone" && <WebfoneSection />}
        {activeSection === "webfone-webrtc" && <WebfoneWebrtcSection />}
        {activeSection === "telefone-sip" && <SipSection />}
        {activeSection === "usuarios" && <UsuariosSection />}
      </main>
    </div>
  );
}
