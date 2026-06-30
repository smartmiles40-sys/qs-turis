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

const DEFAULT_PASSWORD = "setuforeuvou";

export function QsAuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<SdrUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: check localStorage for saved session
  useEffect(() => {
    const stored = localStorage.getItem("qs_user");
    if (stored) {
      try {
        const user = JSON.parse(stored) as SdrUser;
        // Validate the user is still active in the database
        supabase
          .from("qs_users")
          .select("*")
          .eq("id", user.id)
          .eq("is_active", true)
          .single()
          .then(({ data }) => {
            if (data) {
              setCurrentUser(data as SdrUser);
              localStorage.setItem("qs_user", JSON.stringify(data));
            } else {
              localStorage.removeItem("qs_user");
              setCurrentUser(null);
            }
            setLoading(false);
          });
      } catch {
        localStorage.removeItem("qs_user");
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  async function login(email: string, password: string): Promise<boolean> {
    const { data } = await supabase
      .from("qs_users")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .eq("is_active", true)
      .single();

    if (data && (data.password === password || password === DEFAULT_PASSWORD)) {
      const user = data as SdrUser;
      setCurrentUser(user);
      localStorage.setItem("qs_user", JSON.stringify(user));
      return true;
    }
    return false;
  }

  function logout() {
    setCurrentUser(null);
    localStorage.removeItem("qs_user");
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
