// src/contexts/QsAuthContext.tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { SdrUser, UserRole } from "@/components/sdr/types";

interface QsAuthContextType {
  currentUser: SdrUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const QsAuthContext = createContext<QsAuthContextType>({
  currentUser: null,
  loading: true,
  isAuthenticated: false,
  login: async () => false,
  logout: () => {},
});

export function useQsAuth() {
  return useContext(QsAuthContext);
}

// ── Role-based permission helpers ──────────────────────────────────────────

const MENU_ACCESS: Record<UserRole, string[]> = {
  admin: ["*"], // all
  gestor: ["painel", "cobertura", "leads", "cadencias", "reunioes", "dashboard", "metas", "lead-detail", "cadencia-criar", "cadencia-editar"],
  sdr: ["painel", "cobertura", "leads", "lead-detail"],
  closer: ["leads", "lead-detail"],
};

export function canAccessNav(role: UserRole, navId: string): boolean {
  const access = MENU_ACCESS[role];
  if (!access) return false;
  if (access.includes("*")) return true;
  return access.includes(navId);
}

export function canSeeAllData(role: UserRole): boolean {
  return role === "admin" || role === "gestor";
}

// ── Provider ───────────────────────────────────────────────────────────────
// Autenticação via Supabase Auth (email + senha). A tabela qs_users guarda o
// PERFIL (nome, role, ativo), vinculada 1:1 pelo id ao usuário de auth.

export function QsAuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<SdrUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Carrega o perfil qs_users do usuário autenticado (id = auth.uid()).
  async function loadProfile(userId: string): Promise<SdrUser | null> {
    const { data } = await supabase
      .from("qs_users")
      .select("*")
      .eq("id", userId)
      .eq("is_active", true)
      .single();
    return (data as SdrUser) ?? null;
  }

  useEffect(() => {
    let active = true;

    // Sessão atual (o supabase-js persiste sozinho no localStorage).
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      if (session?.user) {
        const profile = await loadProfile(session.user.id);
        if (!active) return;
        if (profile) setCurrentUser(profile);
        else await supabase.auth.signOut(); // sem perfil ativo → derruba a sessão
      }
      setLoading(false);
    });

    // Reage a logout externo / troca de sessão.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setCurrentUser(null);
      if (event === "SIGNED_IN" && session?.user) {
        loadProfile(session.user.id).then((p) => { if (active && p) setCurrentUser(p); });
      }
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  async function login(email: string, password: string): Promise<boolean> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error || !data.user) return false;

    const profile = await loadProfile(data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      return false;
    }
    setCurrentUser(profile);
    return true;
  }

  async function logout() {
    await supabase.auth.signOut();
    setCurrentUser(null);
  }

  return (
    <QsAuthContext.Provider
      value={{
        currentUser,
        loading,
        isAuthenticated: !!currentUser,
        login,
        logout,
      }}
    >
      {children}
    </QsAuthContext.Provider>
  );
}
