import { Component, type ReactNode } from "react";
import SdrLayout from "@/components/sdr/SdrLayout";
import LoginPage from "@/components/sdr/auth/LoginPage";
import { QsAuthProvider, useQsAuth } from "@/contexts/QsAuthContext";
import { ChatAppDockProvider } from "@/contexts/ChatAppDockContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "sans-serif" }}>
          <h2 style={{ color: "#DC2626" }}>Erro no QS</h2>
          <pre style={{ background: "var(--err-bg)", padding: 16, borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap" }}>
            {this.state.error.message}{"\n\n"}{this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: "8px 20px", background: "#0147FF", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { isAuthenticated, loading, bootFalhou } = useQsAuth();

  // ── O SERVIDOR NÃO RESPONDEU ──────────────────────────────────────────────
  // Em 20/08 o gateway do Supabase ficou inalcançável da rede do escritório por
  // alguns minutos. O QS estava no ar, o banco também — mas o app não sabia
  // dizer isso: ficava em "Carregando..." pra sempre. O time entendeu como "o
  // QS quebrou", e não havia nem um botão pra tentar de novo.
  //
  // Aqui a falha vira uma frase e um botão. Não conserta a rede; conserta o
  // não-saber — que é o que faz alguém ficar 40 minutos olhando pra tela.
  if (bootFalhou && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg)" }}>
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl text-white font-bold text-sm" style={{ background: "#B42318" }}>
            QS
          </div>
          <p className="text-base font-semibold" style={{ color: "var(--ink)" }}>
            Não consegui falar com o servidor
          </p>
          <p className="text-sm leading-snug" style={{ color: "var(--ink3)" }}>
            Sua conta está certa e nada foi perdido — é a conexão com o banco de dados que não
            respondeu. Costuma ser a internet do escritório. Tente de novo em alguns instantes.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-1 px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: "#0147FF" }}
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-xl text-white font-bold text-sm animate-pulse"
            style={{ background: "#0147FF" }}
          >
            QS
          </div>
          <p className="text-sm text-gray-400">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <ChatAppDockProvider>
      <SdrLayout />
    </ChatAppDockProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QsAuthProvider>
          <AppContent />
        </QsAuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
