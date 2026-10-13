// src/lib/adminUsers.ts
// -----------------------------------------------------------------------------
// Helper do front para gerenciar usuários passando pela rota /api/admin-user,
// que sincroniza a conta de autenticação (Supabase Auth) com o perfil (qs_users).
// Envia o access_token da sessão atual para o servidor validar que é um admin.
// -----------------------------------------------------------------------------
import { supabase } from "./supabase";
import type { UserRole, Setor } from "@/components/sdr/types";

export interface AdminUserInput {
  id?: string;
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  setores?: Setor[];
  whatsapp_number?: string | null;
  is_active?: boolean;
}

type AdminResult = { success: boolean; error?: string; user?: unknown; equipe?: MembroEquipe[] };

/** Pessoa do time do Relacionamento (listar_equipe — 13/10/2026). */
export interface MembroEquipe {
  id: string; name: string; email: string | null; role: UserRole; setores: Setor[] | null;
  is_active: boolean; whatsapp_number: string | null; ultimo_acesso: string | null; so_relacionamento: boolean;
}

async function callAdmin(action: "create" | "update" | "delete" | "listar_equipe", user: AdminUserInput): Promise<AdminResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { success: false, error: "Sessão expirada. Faça login novamente para gerenciar usuários." };
  }
  const res = await fetch("/api/admin-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: session.access_token, action, user }),
  });
  return (await res.json()) as AdminResult;
}

export const createQsAuthUser = (u: AdminUserInput) => callAdmin("create", u);
export const updateQsAuthUser = (u: AdminUserInput) => callAdmin("update", u);
export const deleteQsAuthUser = (id: string) => callAdmin("delete", { id });
/** Time do Relacionamento (admin ou gestora do Relacionamento). */
export const listarEquipeRel = () => callAdmin("listar_equipe", {});
