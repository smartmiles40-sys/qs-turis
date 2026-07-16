// src/contexts/QsAuthContext.tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { SdrUser, UserRole } from "@/components/sdr/types";

interface QsAuthContextType {
  currentUser: SdrUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  /** Aviso de sessão encerrada à força (ex.: conta desativada) — o LoginPage exibe. */
  sessionNotice: string | null;
  /** false = credenciais erradas; "inactive" = senha certa mas conta desativada. */
  login: (email: string, password: string) => Promise<boolean | "inactive">;
  logout: () => void;
}

const QsAuthContext = createContext<QsAuthContextType>({
  currentUser: null,
  loading: true,
  isAuthenticated: false,
  sessionNotice: null,
  login: async () => false,
  logout: () => {},
});

export function useQsAuth() {
  return useContext(QsAuthContext);
}

// ── Role-based permission helpers ──────────────────────────────────────────

const MENU_ACCESS: Record<UserRole, string[]> = {
  admin: ["*"], // all
  gestor: ["painel", "cobertura", "leads", "cadencias", "reunioes", "agenda", "dashboard", "metas", "lead-detail", "cadencia-criar", "cadencia-editar"],
  sdr: ["painel", "cobertura", "leads", "agenda", "lead-detail"],
  closer: ["leads", "agenda", "lead-detail"],
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

// Mensagem única para conta desativada/perfil removido — mostrada no login.
const DEACTIVATED_MSG =
  "Sua conta foi desativada por um administrador e a sessão foi encerrada. Fale com a gestão para reativar o acesso.";

export function QsAuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<SdrUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

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
        else {
          // sem perfil ativo → derruba a sessão, avisando o porquê no login
          setSessionNotice(DEACTIVATED_MSG);
          await supabase.auth.signOut();
        }
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

  // A9 — desativação vale para a sessão JÁ ABERTA (antes só barrava o próximo
  // login). Re-checa o is_active a cada 60s (mesmo ritmo do fallback do painel)
  // e quando a aba volta ao foco; se o perfil foi desativado/removido, encerra
  // a sessão na hora com aviso. Erro de rede NÃO derruba ninguém — só resposta
  // definitiva do banco (inativo ou sem linha) desloga.
  useEffect(() => {
    if (!currentUser) return;
    const uid = currentUser.id;
    let cancelled = false;
    let checking = false;

    async function recheckActive() {
      if (cancelled || checking || document.hidden) return;
      checking = true;
      try {
        const { data, error } = await supabase
          .from("qs_users")
          .select("is_active")
          .eq("id", uid)
          .maybeSingle();
        if (cancelled || error) return;
        if (!data || data.is_active === false) {
          setSessionNotice(DEACTIVATED_MSG);
          await supabase.auth.signOut();
          if (!cancelled) setCurrentUser(null);
        }
      } finally {
        checking = false;
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void recheckActive();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const intervalId = setInterval(() => { void recheckActive(); }, 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(intervalId);
    };
  }, [currentUser]);

  async function login(email: string, password: string): Promise<boolean | "inactive"> {
    setSessionNotice(null); // tentativa nova limpa o aviso anterior
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error || !data.user) return false;

    const profile = await loadProfile(data.user.id);
    if (!profile) {
      // Senha correta, mas perfil desativado/removido → avisa o motivo real
      // (antes caía no genérico "e-mail ou senha incorretos").
      setSessionNotice(DEACTIVATED_MSG);
      await supabase.auth.signOut();
      return "inactive";
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
        sessionNotice,
        login,
        logout,
      }}
    >
      {children}
    </QsAuthContext.Provider>
  );
}
