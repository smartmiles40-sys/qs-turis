// src/contexts/QsAuthContext.tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { SdrUser, UserRole } from "@/components/sdr/types";

/**
 * Resultado do login:
 *  - "ok"              autenticado com perfil ativo.
 *  - "bad_credentials" e-mail/senha errados.
 *  - "inactive"        senha certa, mas conta desativada/removida (resposta
 *                      DEFINITIVA do banco) → sessão encerrada, aviso no login.
 *  - "profile_error"   auth OK, mas o perfil não carregou agora (rede oscilou).
 *                      Falha TRANSITÓRIA — não é "conta desativada"; tente de novo.
 */
export type LoginResult = "ok" | "bad_credentials" | "inactive" | "profile_error";

interface QsAuthContextType {
  currentUser: SdrUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  /** Aviso de sessão encerrada à força (ex.: conta desativada) — o LoginPage exibe. */
  sessionNotice: string | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
}

const QsAuthContext = createContext<QsAuthContextType>({
  currentUser: null,
  loading: true,
  isAuthenticated: false,
  sessionNotice: null,
  login: async () => "bad_credentials",
  logout: () => {},
});

export function useQsAuth() {
  return useContext(QsAuthContext);
}

// ── Role-based permission helpers ──────────────────────────────────────────

const MENU_ACCESS: Record<UserRole, string[]> = {
  admin: ["*"], // all
  gestor: ["painel", "cobertura", "leads", "cadencias", "reunioes", "agenda", "dashboard", "metas", "lead-detail", "cadencia-criar", "cadencia-editar"],
  sdr: ["painel", "cobertura", "leads", "reunioes", "agenda", "lead-detail"],
  closer: ["leads", "reunioes", "agenda", "lead-detail"],
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

  // Resultado do carregamento do perfil — DISTINGUE "sem perfil" (conta
  // desativada/removida → derruba a sessão) de "erro de rede/servidor"
  // (transitório → NÃO derruba). Antes ambos viravam null e o usuário caía com
  // "conta desativada" só porque a rede oscilou.
  type ProfileLoad =
    | { status: "ok"; profile: SdrUser }
    | { status: "no_profile" }
    | { status: "error" };

  // Carrega o perfil qs_users do usuário autenticado (id = auth.uid()).
  async function loadProfile(userId: string): Promise<ProfileLoad> {
    // maybeSingle (não single): 0 linhas vira data=null SEM erro — assim um
    // "sem perfil ativo" não se confunde com uma falha de rede/servidor (que
    // preenche `error`). É a distinção que evita o logout indevido.
    const { data, error } = await supabase
      .from("qs_users")
      .select("*")
      .eq("id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) return { status: "error" };
    if (!data) return { status: "no_profile" };
    return { status: "ok", profile: data as SdrUser };
  }

  // Só no carregamento inicial/login: erro de rede é transitório, então tenta
  // de novo 1–2x com backoff curto antes de desistir. "ok" e "no_profile" são
  // respostas DEFINITIVAS do banco — retornam na hora, sem repetir.
  async function loadProfileResilient(userId: string, tries = 3): Promise<ProfileLoad> {
    let last: ProfileLoad = { status: "error" };
    for (let i = 0; i < tries; i++) {
      last = await loadProfile(userId);
      if (last.status !== "error") return last;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    return last;
  }

  useEffect(() => {
    let active = true;

    // Sessão atual (o supabase-js persiste sozinho no localStorage).
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      if (session?.user) {
        const res = await loadProfileResilient(session.user.id);
        if (!active) return;
        if (res.status === "ok") setCurrentUser(res.profile);
        else if (res.status === "no_profile") {
          // sem perfil ativo → derruba a sessão, avisando o porquê no login
          setSessionNotice(DEACTIVATED_MSG);
          await supabase.auth.signOut();
        }
        // status "error": rede oscilou no boot — NÃO desloga e NÃO mostra o aviso
        // de "conta desativada" (era o bug). Mantém a sessão de auth; encerra o
        // loading e deixa o watchdog de 60s / um refresh revalidarem o perfil.
      }
      setLoading(false);
    });

    // Reage a logout externo / troca de sessão.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setCurrentUser(null);
      if (event === "SIGNED_IN" && session?.user) {
        // Só promove com perfil ativo; "no_profile"/"error" ficam por conta do
        // getSession inicial / login() (que sabem se devem derrubar ou não).
        loadProfile(session.user.id).then((r) => { if (active && r.status === "ok") setCurrentUser(r.profile); });
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

  async function login(email: string, password: string): Promise<LoginResult> {
    setSessionNotice(null); // tentativa nova limpa o aviso anterior
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error || !data.user) return "bad_credentials";

    const res = await loadProfileResilient(data.user.id, 2);
    if (res.status === "ok") { setCurrentUser(res.profile); return "ok"; }
    if (res.status === "no_profile") {
      // Senha correta, mas perfil desativado/removido → avisa o motivo real
      // (antes caía no genérico "e-mail ou senha incorretos").
      setSessionNotice(DEACTIVATED_MSG);
      await supabase.auth.signOut();
      return "inactive";
    }
    // Auth OK, mas o perfil não carregou agora (rede). NÃO desloga: a sessão é
    // válida e o perfil pode subir num refresh. Sinaliza falha TRANSITÓRIA pro
    // LoginPage ("tente de novo"), sem o alarme de "conta desativada".
    return "profile_error";
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
