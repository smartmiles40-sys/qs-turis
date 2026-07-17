// src/components/sdr/settings/ChangePasswordModal.tsx
// -----------------------------------------------------------------------------
// Modal "Trocar minha senha" — aberto pelo menu do avatar (SdrLayout). Troca a
// senha da PRÓPRIA sessão via Supabase Auth. Não pede a senha atual: o Supabase
// não exige pra uma sessão ativa (updateUser autentica pelo token da sessão).
// -----------------------------------------------------------------------------

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ open, onClose }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setPassword("");
    setConfirm("");
    setShow(false);
    setError(null);
    setSaving(false);
  }

  function handleClose() {
    if (saving) return; // não fecha no meio da gravação
    reset();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Validação no cliente antes de bater no servidor.
    if (password.length < 6) { setError("A senha deve ter ao menos 6 caracteres."); return; }
    if (password !== confirm) { setError("As senhas não conferem."); return; }

    setSaving(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(err.message || "Não foi possível trocar a senha.");
        notifyError("Não foi possível trocar a senha — tente novamente.");
        setSaving(false);
        return;
      }
      notifySuccess("Senha trocada com sucesso.");
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao trocar a senha.");
      notifyError("Erro de rede ao trocar a senha — tente de novo.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 md:p-6">
        <h3 className="text-base font-bold text-gray-900 mb-1">Trocar minha senha</h3>
        <p className="text-xs text-gray-500 mb-4">Defina uma nova senha para a sua conta (mín. 6 caracteres).</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Nova senha</label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="Nova senha"
                autoComplete="new-password"
                autoFocus
                className="w-full pl-3 pr-10 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                title={show ? "Ocultar senha" : "Mostrar senha"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
              >
                {show ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Confirmar nova senha</label>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(null); }}
              placeholder="Repita a nova senha"
              autoComplete="new-password"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
            />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || !password || !confirm}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#0147FF" }}
            >
              {saving ? "Salvando..." : "Trocar senha"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
