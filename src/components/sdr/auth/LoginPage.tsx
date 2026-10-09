// src/components/sdr/auth/LoginPage.tsx
import { useState, type FormEvent } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import type { Setor } from "@/components/sdr/types";

// ── As duas portas do QS (09/10/2026) ───────────────────────────────────────
// Um sistema, um banco, uma porta por setor. A pessoa escolhe por onde entra;
// se a conta dela não é daquele setor, o login recusa com a frase certa (em vez
// de abrir uma tela vazia). A cor da porta acompanha a área inteira.
const PORTAS: Record<Setor, { titulo: string; sub: string; cor: string; corSoft: string }> = {
  comercial: {
    titulo: "Comercial",
    sub: "Leads, atividades e reuniões",
    cor: "#0147FF",
    corSoft: "rgba(1, 71, 255, 0.08)",
  },
  relacionamento: {
    titulo: "Relacionamento",
    sub: "Clientes, viagens e pós-venda",
    cor: "#0E7C6A",
    corSoft: "rgba(14, 124, 106, 0.09)",
  },
};

function lerUltimaPorta(): Setor {
  try { return localStorage.getItem("qs_area") === "relacionamento" ? "relacionamento" : "comercial"; }
  catch { return "comercial"; }
}

function IconeComercial() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconeRelacionamento() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, sessionNotice } = useQsAuth();
  const [porta, setPorta] = useState<Setor>(lerUltimaPorta);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const p = PORTAS[porta];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Preencha todos os campos.");
      return;
    }

    setLoading(true);
    const result = await login(email, password, porta);
    if (result === "bad_credentials") {
      setError("E-mail ou senha incorretos. Verifique suas credenciais.");
    } else if (result === "profile_error") {
      // Auth OK, mas o perfil não carregou (rede) — NÃO é conta desativada.
      setError("Não foi possível carregar seu perfil agora. Verifique sua conexão e tente de novo.");
    } else if (result === "sem_acesso") {
      const outra = porta === "comercial" ? "Relacionamento" : "Comercial";
      setError(`Sua conta não tem acesso ao ${p.titulo}. Tente entrar pelo ${outra} ou fale com a gestão.`);
    }
    // result === "inactive": conta desativada — o aviso vem pelo sessionNotice.
    setLoading(false);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "var(--bg)", fontFamily: "inherit" }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-7">
          <div
            className="flex items-center justify-center w-14 h-14 rounded-2xl text-white font-bold text-xl mb-4 transition-colors duration-300"
            style={{ background: p.cor }}
          >
            QS
          </div>
          <h1 className="text-lg font-bold" style={{ color: "var(--ink)" }}>QS</h1>
          <p className="text-[10px] font-medium mb-1" style={{ color: "var(--ink3)" }}>by STFV</p>
          <p className="text-sm" style={{ color: "var(--ink2)" }}>Por onde você vai entrar?</p>
        </div>

        {/* As duas portas */}
        <div role="radiogroup" aria-label="Área do sistema" className="grid grid-cols-2 gap-3 mb-4">
          {(Object.keys(PORTAS) as Setor[]).map((s) => {
            const item = PORTAS[s];
            const ativo = porta === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => { setPorta(s); setError(""); }}
                className="text-left rounded-xl p-4 border-2 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  background: ativo ? item.corSoft : "var(--card)",
                  borderColor: ativo ? item.cor : "var(--line)",
                  boxShadow: ativo ? "none" : "0 1px 2px rgba(16,24,40,0.04)",
                }}
              >
                <span
                  className="flex items-center justify-center w-9 h-9 rounded-lg mb-3 transition-colors"
                  style={{ background: ativo ? item.cor : "var(--card2)", color: ativo ? "#fff" : "var(--ink3)" }}
                >
                  {s === "comercial" ? <IconeComercial /> : <IconeRelacionamento />}
                </span>
                <span className="block text-sm font-bold" style={{ color: ativo ? item.cor : "var(--ink)" }}>
                  {item.titulo}
                </span>
                <span className="block text-[11px] leading-snug mt-0.5" style={{ color: "var(--ink3)" }}>
                  {item.sub}
                </span>
              </button>
            );
          })}
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl shadow-sm border p-6 space-y-4"
          style={{ background: "var(--card)", borderColor: "var(--line)" }}
        >
          {/* Erro do formulário tem prioridade; sem erro, mostra o aviso de
              sessão encerrada (ex.: conta desativada pelo administrador). */}
          {error ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-xs text-red-700">{error}</p>
            </div>
          ) : sessionNotice ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-xs text-amber-800">{sessionNotice}</p>
            </div>
          ) : null}

          {/* Email */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink2)" }}>
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 transition-colors"
              style={{ ["--tw-ring-color" as string]: p.corSoft }}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink2)" }}>
              Senha
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                className="w-full pl-3 pr-10 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 transition-colors"
                style={{ ["--tw-ring-color" as string]: p.corSoft }}
              />
              {/* Olho: alterna mostrar/ocultar a senha */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
            style={{ background: p.cor }}
          >
            {loading ? "Entrando..." : `Entrar no ${p.titulo}`}
          </button>
        </form>

        <p className="text-center text-[11px] mt-6" style={{ color: "var(--ink3)" }}>
          Grupo Inovvatur &middot; QS v1.0
        </p>
      </div>
    </div>
  );
}
