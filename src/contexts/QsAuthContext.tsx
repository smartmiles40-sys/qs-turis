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
  /**
   * O servidor não respondeu na abertura do app.
   *
   * POR QUE EXISTE (20/08/2026): o gateway do Supabase ficou inalcançável a
   * partir da rede do escritório por alguns minutos. O `getSession()` não tem
   * timeout, então a promessa nunca resolvia, o `setLoading(false)` nunca
   * rodava e TODO SDR ficou olhando "Carregando..." pra sempre — sem erro, sem
   * botão, sem pista. O QS estava perfeito e o banco também; o que faltou foi o
   * app saber dizer "não consegui falar com o servidor".
   */
  bootFalhou: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
}

/**
 * Promessa com prazo. Sem isto, qualquer chamada de rede que fica pendurada
 * (rede do escritório caindo, gateway fora) trava a abertura do app pra sempre:
 * o `finally` que desligaria o "Carregando..." nunca chega a rodar.
 */
function comLimite<T>(p: PromiseLike<T>, ms: number, oQue: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`tempo esgotado: ${oQue}`)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Quanto o app espera o servidor antes de assumir que ele não vem. */
const LIMITE_BOOT_MS = 10_000;
const LIMITE_PERFIL_MS = 8_000;

const QsAuthContext = createContext<QsAuthContextType>({
  currentUser: null,
  loading: true,
  isAuthenticated: false,
  sessionNotice: null,
  bootFalhou: false,
  login: async () => "bad_credentials",
  logout: () => {},
});

export function useQsAuth() {
  return useContext(QsAuthContext);
}

// ── Role-based permission helpers ──────────────────────────────────────────

const MENU_ACCESS: Record<UserRole, string[]> = {
  admin: ["*"], // all
  // "atendimento-ia" entrou aqui em 24/08: a tela nasceu na 0060 com o item de
  // menu, mas ficou de fora desta lista — ou seja, existia só pro admin, e quem
  // precisa acompanhar o que a IA está fazendo com a carteira é justamente a
  // coordenação. Ninguém notou porque o Bruno entra como admin.
  gestor: ["minha-agenda", "painel", "whatsapp", "cobertura", "atendimento-ia", "leads", "cadencias", "reunioes", "dashboard", "analises", "lead-detail", "cadencia-criar", "cadencia-editar"],
  sdr: ["painel", "whatsapp", "cobertura", "leads", "reunioes", "dashboard", "lead-detail"],
  // O Painel entrou pro closer junto com a atividade de DESFECHO: sem ele, a
  // cobrança nasceria numa fila que o closer não enxerga.
  closer: ["minha-agenda", "painel", "whatsapp", "leads", "reunioes", "dashboard", "lead-detail"],
  // Espectador: enxerga o funil inteiro pra medir campanha. Fica de fora o
  // Painel e o WhatsApp (telas de EXECUÇÃO — quem não executa não atende) e as
  // Configurações (que só existem pra mudar coisa).
  marketing: ["leads", "lead-detail", "cobertura", "cadencias", "reunioes", "dashboard", "analises"],
};

export function canAccessNav(role: UserRole, navId: string): boolean {
  const access = MENU_ACCESS[role];
  if (!access) return false;
  if (access.includes("*")) return true;
  return access.includes(navId);
}

/**
 * Onde cada papel CAI ao entrar. O closer trabalha por reunião, não por fila de
 * atividade — até 07/08 ele aterrissava no Painel do SDR e precisava caçar a
 * própria agenda, e o resultado era 0 de 40 reuniões com desfecho registrado.
 */
export function telaInicial(role: UserRole | undefined | null): string {
  if (role === "closer") return "minha-agenda";
  if (role === "marketing") return "dashboard";
  return "painel";
}

export function canSeeAllData(role: UserRole): boolean {
  return role === "admin" || role === "gestor" || role === "marketing";
}

/**
 * Pode MUDAR alguma coisa? Marketing é espectador: vê tudo, não executa nada.
 *
 * Isto some com o botão — quem recusa de verdade é o banco (gatilho da migration
 * 0036). Esconder no front é educação com o usuário, não segurança: todo login
 * fala com o PostgREST com o próprio token, e botão escondido não impede um
 * PATCH pelo DevTools.
 */
export function podeExecutar(role: UserRole | undefined | null): boolean {
  return !!role && role !== "marketing";
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
  const [bootFalhou, setBootFalhou] = useState(false);

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
    // Com prazo: o supabase-js NAO tem timeout proprio, entao um servidor
    // pendurado aqui trava o boot do mesmo jeito que travava no getSession.
    let data, error;
    try {
      ({ data, error } = await comLimite(
        supabase.from("qs_users").select("*").eq("id", userId).eq("is_active", true).maybeSingle(),
        LIMITE_PERFIL_MS, "perfil",
      ));
    } catch { return { status: "error" }; }
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
    //
    // ⚠️ O `.catch` e o `comLimite` são obrigatórios aqui. Este `.then` é o
    // ÚNICO caminho que desliga o "Carregando..." da abertura. Sem prazo e sem
    // captura de erro, um servidor que não responde não vira erro — vira uma
    // promessa pendurada, e o app fica preso na tela de carregamento pra
    // sempre. Foi exatamente o que aconteceu em 20/08 com o time inteiro.
    comLimite(supabase.auth.getSession(), LIMITE_BOOT_MS, "sessão")
      .then(async ({ data: { session } }) => {
        if (!active) return;
        if (session?.user) {
          const res = await loadProfileResilient(session.user.id);
          if (!active) return;
          if (res.status === "ok") setCurrentUser(res.profile);
          else if (res.status === "no_profile") {
            // sem perfil ativo → derruba a sessão, avisando o porquê no login
            setSessionNotice(DEACTIVATED_MSG);
            await supabase.auth.signOut();
          } else {
            // status "error": as 3 tentativas falharam. NÃO desloga (a sessão é
            // válida e pode ser só a rede), mas agora DIZ isso na tela em vez
            // de mandar o SDR pro login sem explicação nenhuma.
            setBootFalhou(true);
          }
        }
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        console.warn("[QS] o servidor não respondeu na abertura:", e?.message);
        setBootFalhou(true);
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
        bootFalhou,
        login,
        logout,
      }}
    >
      {children}
    </QsAuthContext.Provider>
  );
}
