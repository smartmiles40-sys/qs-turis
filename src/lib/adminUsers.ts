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
  /** Cargo (0122) — nome da função; null tira. */
  cargo_id?: string | null;
}

type AdminResult = { success: boolean; error?: string; user?: unknown; equipe?: MembroEquipe[] };

/** Pessoa do time de uma área (listar_equipe — 13/10/2026; Fin/Ops 14/10). */
export interface MembroEquipe {
  id: string; name: string; email: string | null; role: UserRole; setores: Setor[] | null;
  is_active: boolean; whatsapp_number: string | null; ultimo_acesso: string | null; so_relacionamento: boolean;
  /** Só desta área (sem Comercial nem outra área) — o gestor da área pode mexer. */
  so_area?: boolean;
  cargo_id?: string | null;
}

/** Áreas que têm time próprio (gestor de área). */
export type AreaComTime = "relacionamento" | "financeiro" | "operacional";

async function callAdmin(action: "create" | "update" | "delete" | "listar_equipe", user: AdminUserInput, setor?: AreaComTime): Promise<AdminResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { success: false, error: "Sessão expirada. Faça login novamente para gerenciar usuários." };
  }
  const res = await fetch("/api/admin-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: session.access_token, action, user, ...(setor ? { setor } : {}) }),
  });
  return (await res.json()) as AdminResult;
}

export const createQsAuthUser = (u: AdminUserInput, setor?: AreaComTime) => callAdmin("create", u, setor);
export const updateQsAuthUser = (u: AdminUserInput, setor?: AreaComTime) => callAdmin("update", u, setor);
export const deleteQsAuthUser = (id: string) => callAdmin("delete", { id });
/** Time de uma área (admin ou gestor(a) da área). Padrão: Relacionamento. */
export const listarEquipe = (setor: AreaComTime = "relacionamento") => callAdmin("listar_equipe", {}, setor);
/** Time do Relacionamento (admin ou gestora do Relacionamento). */
export const listarEquipeRel = () => listarEquipe("relacionamento");

// ── Hierarquia (0336): a quem cada pessoa responde ──────────────────────────
/** superior_id de cada pessoa. null = a coluna ainda não existe (0336 não aplicada). */
export async function superioresDe(ids: string[]): Promise<Record<string, string | null> | null> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("qs_users").select("id, superior_id").in("id", ids);
  if (error) return null;
  return Object.fromEntries((data ?? []).map((r: { id: string; superior_id: string | null }) => [r.id, r.superior_id]));
}

/** Define a quem a pessoa responde (admin, ou gestor do mesmo setor). Quem está acima acompanha as demandas dela. */
export async function definirSuperior(usuario: string, superior: string | null) {
  const { error } = await supabase.rpc("qs_definir_superior", { p_usuario: usuario, p_superior: superior });
  if (error) {
    const m = error.message;
    throw new Error(/superior-ciclo/.test(m) ? "Não dá: essa pessoa já está abaixo dela na hierarquia."
      : /sem-permissao/.test(m) ? "Só o admin ou o gestor do setor define a hierarquia." : m);
  }
}
