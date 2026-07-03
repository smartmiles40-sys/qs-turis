import { Component, type ReactNode } from "react";
import SdrLayout from "@/components/sdr/SdrLayout";
import LoginPage from "@/components/sdr/auth/LoginPage";
import { QsAuthProvider, useQsAuth } from "@/contexts/QsAuthContext";
import { ChatAppDockProvider } from "@/contexts/ChatAppDockContext";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "sans-serif" }}>
          <h2 style={{ color: "#DC2626" }}>Erro no QS</h2>
          <pre style={{ background: "#FEF2F2", padding: 16, borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap" }}>
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
  const { isAuthenticated, loading } = useQsAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8F9FA" }}>
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
      <QsAuthProvider>
        <AppContent />
      </QsAuthProvider>
    </ErrorBoundary>
  );
}
