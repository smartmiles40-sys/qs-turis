import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
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

type SettingsSection = "produtos" | "canais" | "campos" | "motivos" | "voip" | "usuarios";

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
  { key: "voip", label: "Configuração VoIP", group: "PLATAFORMA" },
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

function CamposSection() {
  const [activeScope, setActiveScope] = useState<CustomFieldScope>("pessoal");
  const [allFields, setAllFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      setLoading(true);
      const { data, error } = await supabase.from("qs_custom_fields").select("*").order("label");
      if (error) console.warn("Erro ao buscar campos:", error);
      else setAllFields((data as CustomField[]) ?? []);
      setLoading(false);
    }
    fetch();
  }, []);

  const fields = allFields.filter((f) => f.scope === activeScope);

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Campos Personalizados</h2>
        <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] transition-colors">
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
                ? "bg-[#F97316] text-white"
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

      <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
        {fields.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum campo neste escopo.</div>
        ) : (
          <table className="w-full text-sm">
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
                      <span className="text-xs text-[#F97316] font-medium">Personalizado</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {field.is_system ? (
                      <span className="text-xs text-gray-300">--</span>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Editar"><PencilIcon /></button>
                        <button
                          onClick={async () => {
                            const { error } = await supabase.from("qs_custom_fields").delete().eq("id", field.id);
                            if (error) console.warn("Erro ao excluir campo:", error);
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
    </div>
  );
}

// ── Motivos de Perda ─────────────────────────────────────────────────────────

function MotivosSection() {
  const [showArchived, setShowArchived] = useState(false);
  const [reasons, setReasons] = useState<LossReason[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      setLoading(true);
      const { data, error } = await supabase.from("qs_loss_reasons").select("*").order("label");
      if (error) console.warn("Erro ao buscar motivos:", error);
      else setReasons((data as LossReason[]) ?? []);
      setLoading(false);
    }
    fetch();
  }, []);

  const predefined = reasons.filter((r) => r.is_predefined);
  const custom = reasons.filter((r) => !r.is_predefined && (showArchived || !r.is_archived));

  async function toggleArchive(reason: LossReason) {
    const { error } = await supabase.from("qs_loss_reasons").update({ is_archived: !reason.is_archived }).eq("id", reason.id);
    if (error) console.warn("Erro ao arquivar/desarquivar:", error);
    else setReasons((prev) => prev.map((r) => r.id === reason.id ? { ...r, is_archived: !r.is_archived } : r));
  }

  async function deleteReason(id: string) {
    const { error } = await supabase.from("qs_loss_reasons").delete().eq("id", id);
    if (error) console.warn("Erro ao excluir motivo:", error);
    else setReasons((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Motivos de Perda</h2>
        <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] transition-colors">
          <PlusIcon /> Novo Motivo
        </button>
      </div>

      <div>
        <h3 className="text-xs font-medium text-gray-500 mb-3 flex items-center gap-1.5"><LockIcon /> Predefinidos</h3>
        <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
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
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showArchived ? "bg-[#F97316]" : "bg-gray-200"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${showArchived ? "translate-x-4" : "translate-x-0.5"}`} />
            </span>
            Mostrar arquivados
          </label>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
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
                        <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Editar"><PencilIcon /></button>
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
    </div>
  );
}

// ── Usuários ─────────────────────────────────────────────────────────────────

function UsuariosSection() {
  const [users, setUsers] = useState<SdrUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<SdrUser | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "sdr" as UserRole, password: "setuforeuvou" });
  const [saving, setSaving] = useState(false);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase.from("qs_users").select("*").order("name");
    setUsers((data as SdrUser[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  function openAdd() {
    setEditUser(null);
    setForm({ name: "", email: "", role: "sdr", password: "setuforeuvou" });
    setShowModal(true);
  }

  function openEdit(u: SdrUser) {
    setEditUser(u);
    setForm({ name: u.name, email: u.email, role: u.role, password: "" });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name || !form.email) return;
    setSaving(true);
    if (editUser) {
      const updateData: any = { name: form.name, email: form.email, role: form.role };
      if (form.password) updateData.password = form.password;
      await supabase.from("qs_users").update(updateData).eq("id", editUser.id);
    } else {
      await supabase.from("qs_users").insert({ name: form.name, email: form.email, role: form.role, password: form.password || "setuforeuvou" });
    }
    setSaving(false);
    setShowModal(false);
    loadUsers();
  }

  async function toggleActive(u: SdrUser) {
    await supabase.from("qs_users").update({ is_active: !u.is_active }).eq("id", u.id);
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
  }

  async function deleteUser(u: SdrUser) {
    if (!confirm(`Excluir ${u.name} permanentemente? Os leads dele ficarão sem responsável.`)) return;
    // Remover referências antes de deletar
    await supabase.from("qs_leads").update({ owner_id: null }).eq("owner_id", u.id);
    await supabase.from("qs_tasks").update({ owner_id: null }).eq("owner_id", u.id);
    await supabase.from("qs_cadence_owners").delete().eq("user_id", u.id);
    await supabase.from("qs_handovers").update({ from_user_id: null }).eq("from_user_id", u.id);
    await supabase.from("qs_handovers").update({ to_user_id: null }).eq("to_user_id", u.id);
    await supabase.from("qs_notes").update({ author_id: null }).eq("author_id", u.id);
    await supabase.from("qs_meetings").update({ owner_id: null }).eq("owner_id", u.id);
    await supabase.from("qs_goals").delete().eq("owner_id", u.id);
    // Agora deleta o usuário
    await supabase.from("qs_users").delete().eq("id", u.id);
    setUsers(prev => prev.filter(x => x.id !== u.id));
  }

  if (loading) return <p className="text-sm text-gray-500 py-6 text-center">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Usuários e Permissões</h2>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] transition-colors">
          <PlusIcon /> Adicionar Usuário
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
        {users.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum usuário cadastrado.</div>
        ) : (
          <table className="w-full text-sm">
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
                      <div className="w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-white text-xs font-semibold shrink-0">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4">{editUser ? "Editar Usuário" : "Adicionar Usuário"}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nome *</label>
                <input type="text" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Nome completo" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">E-mail *</label>
                <input type="email" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@empresa.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Papel</label>
                <select value={form.role} onChange={(e) => setForm(p => ({ ...p, role: e.target.value as UserRole }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400">
                  <option value="sdr">Qualificador</option>
                  <option value="closer">Closer</option>
                  <option value="gestor">Gestor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{editUser ? "Nova senha (deixe vazio para manter)" : "Senha *"}</label>
                <input type="password" value={form.password} onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))} placeholder={editUser ? "••••••••" : "Senha de acesso"} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400" />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button onClick={handleSave} disabled={saving || !form.name || !form.email} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#F97316" }}>
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
    await supabase.from("qs_products").delete().eq("id", id);
    setProducts(prev => prev.filter(p => p.id !== id));
  }

  if (loading) return <div className="p-6 text-gray-400">Carregando...</div>;

  return (
    <div className="p-6">
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
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400"
        />
        <button
          onClick={addProduct}
          disabled={!newProduct.trim()}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
          style={{ background: "#F97316" }}
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
                style={{ background: p.is_active ? "#F97316" : "#D1D5DB" }}
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
    { type: "ligacao", label: "Ligação", enabled: true, description: "Ligações telefônicas via VoIP ou manual" },
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
    if (error) console.warn("Erro ao atualizar canal:", error);
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
              ch.enabled ? "border-[#F97316]/20" : "border-gray-100"
            }`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                ch.enabled ? "bg-[#F97316]/10 text-[#F97316]" : "bg-gray-100 text-gray-400"
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
                  VoIP Disponível
                </span>
              )}
              <button
                onClick={() => toggleChannel(ch.type)}
                className="relative w-11 h-6 rounded-full transition-colors duration-200"
                style={{ background: ch.enabled ? "#F97316" : "#D1D5DB" }}
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

      <div className="p-4 bg-[#F97316]/5 border border-[#F97316]/10 rounded-xl">
        <p className="text-xs text-[#F97316]">
          <strong>Dica:</strong> Os canais habilitados aparecerão como opções na construção de cadências e no painel de atividades.
          Canais desabilitados não serão removidos de cadências existentes.
        </p>
      </div>
    </div>
  );
}

// ── VoIP Config ─────────────────────────────────────────────────────────────

function VoipSection() {
  const [provider, setProvider] = React.useState("manual");
  const [sipUri, setSipUri] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Configuração VoIP</h2>
        <p className="text-sm text-gray-500 mt-0.5">Configure a integração de telefonia para ligações diretas pelo sistema</p>
      </div>

      {/* Modo de ligação */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Modo de Ligação</h3>
        <div className="space-y-2">
          {[
            { id: "manual", label: "Manual", desc: "O qualificador liga pelo telefone e registra manualmente no sistema" },
            { id: "voip", label: "VoIP Integrado", desc: "Ligação direta pelo sistema com gravação e métricas" },
            { id: "click-to-call", label: "Click-to-Call", desc: "Sistema inicia a chamada no softphone configurado" },
          ].map((opt) => (
            <label
              key={opt.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                provider === opt.id ? "border-[#F97316] bg-[#F97316]/5" : "border-gray-200"
              }`}
            >
              <input
                type="radio"
                name="voip-mode"
                checked={provider === opt.id}
                onChange={() => setProvider(opt.id)}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Config VoIP */}
      {provider === "voip" && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Configuração do Provedor VoIP</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">SIP URI / Servidor</label>
              <input
                type="text"
                value={sipUri}
                onChange={(e) => setSipUri(e.target.value)}
                placeholder="sip.provedor.com.br"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/10"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">API Key / Token</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••••••••"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/10"
              />
            </div>
            <button className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] transition-colors">
              Testar Conexão
            </button>
          </div>
        </div>
      )}

      {/* Status */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Status</h3>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: provider === "voip" ? "#059669" : "#D97706" }} />
          <span className="text-sm text-gray-600">
            {provider === "manual" && "Modo manual — qualificadores registram ligações manualmente"}
            {provider === "voip" && "VoIP integrado — pronto para configurar provedor"}
            {provider === "click-to-call" && "Click-to-Call — abre softphone externo"}
          </span>
        </div>
      </div>
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
    <div className="flex gap-6 min-h-[600px]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Internal Sidebar */}
      <aside className="w-56 shrink-0">
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
                            ? "bg-[#F97316]/5 text-[#F97316] font-medium"
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
        {activeSection === "voip" && <VoipSection />}
        {activeSection === "usuarios" && <UsuariosSection />}
      </main>
    </div>
  );
}
