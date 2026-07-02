// src/lib/adminUsers.ts
// -----------------------------------------------------------------------------
// Helper do front para gerenciar usuários passando pela rota /api/admin-user,
// que sincroniza a conta de autenticação (Supabase Auth) com o perfil (qs_users).
// Envia o access_token da sessão atual para o servidor validar que é um admin.
// -----------------------------------------------------------------------------
import { supabase } from "./supabase";
import type { UserRole } from "@/components/sdr/types";

export interface AdminUserInput {
  id?: string;
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  whatsapp_number?: string | null;
  is_active?: boolean;
}

type AdminResult = { success: boolean; error?: string; user?: unknown };

async function callAdmin(action: "create" | "update" | "delete", user: AdminUserInput): Promise<AdminResult> {
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
