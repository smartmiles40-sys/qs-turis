// src/components/sdr/instagram/MeuInstagram.tsx
// -----------------------------------------------------------------------------
// "Meu Instagram do trabalho" (Bruno, 27/11/2026) — menu do avatar.
//
// Cada SDR conecta o PRÓPRIO Instagram profissional. O botão leva pro login do
// Instagram (OAuth, /api/sdr-instagram) e volta pro QS com ?ig=ok|erro; daí em
// diante as DMs dessa conta caem na conversa dos leads dela (0430/0431).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/qs/waInbox";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

interface MinhaConta { id: string; username: string | null; status: string; ultimo_erro: string | null; token_expira_em: string | null; ultima_entrada_em: string | null }

export const EVENTO_ABRIR_MEU_IG = "qs:abrir-meu-instagram";

export default function MeuInstagram({ userId }: { userId: string | null }) {
  const [aberto, setAberto] = useState(false);
  const [conta, setConta] = useState<MinhaConta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    if (!userId) return;
    setCarregando(true);
    const { data, error } = await supabase
      .from("mkt_ig_contas" as never)
      .select("id,username,status,ultimo_erro,token_expira_em,ultima_entrada_em")
      .eq("dono_id", userId)
      .limit(1);
    if (error) console.warn("[ig] minha conta:", error.message);
    setConta(((data ?? []) as unknown as MinhaConta[])[0] ?? null);
    setCarregando(false);
  }, [userId]);

  // Abre pelo menu do avatar (evento) ou na volta do login do Instagram (?ig=).
  useEffect(() => {
    const abrir = () => { setAberto(true); void carregar(); };
    window.addEventListener(EVENTO_ABRIR_MEU_IG, abrir);
    const p = new URLSearchParams(window.location.search);
    const volta = p.get("ig");
    if (volta) {
      if (volta === "ok") notifySuccess("Instagram conectado! As DMs dessa conta agora chegam no QS.");
      else notifyError(p.get("ig_msg") || "Não consegui conectar o Instagram.");
      p.delete("ig"); p.delete("ig_msg");
      const qs = p.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
      abrir();
    }
    return () => window.removeEventListener(EVENTO_ABRIR_MEU_IG, abrir);
  }, [carregar]);

  async function conectar() {
    setOcupado(true);
    try {
      const r = await fetch("/api/sdr-instagram", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ acao: "link" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.url) { notifyError(j?.error || "Não consegui abrir o login do Instagram."); return; }
      window.location.href = j.url;
    } catch { notifyError("Sem conexão. Tente de novo."); }
    finally { setOcupado(false); }
  }

  async function desconectar() {
    if (!window.confirm("Desconectar o seu Instagram do QS? As DMs param de chegar aqui.")) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/sdr-instagram", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ acao: "desconectar" }) });
      if (!r.ok) { notifyError("Não consegui desconectar."); return; }
      notifySuccess("Instagram desconectado.");
      await carregar();
    } finally { setOcupado(false); }
  }

  if (!aberto) return null;
  const conectada = conta?.status === "conectada";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Meu Instagram do trabalho">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,.45)" }} onClick={() => setAberto(false)} />
      <div className="relative w-full max-w-[460px] rounded-2xl p-5" style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-[18px] font-semibold">Meu Instagram do trabalho</h2>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ink3)" }}>
              Conecte o Instagram que você usa com os clientes. As DMs dele chegam na conversa de cada lead seu, e você responde daqui.
            </p>
          </div>
          <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="text-[22px] leading-none" style={{ color: "var(--ink3)" }}>×</button>
        </div>

        <div className="mt-4 rounded-xl p-4" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
          {carregando ? <span className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</span>
            : conectada ? (
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold" style={{ color: "#C13584" }}>@{conta?.username ?? "conta conectada"}</span>
                <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
                  Conectado{conta?.ultima_entrada_em ? ` · última DM ${new Date(conta.ultima_entrada_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : " · nenhuma DM ainda"}
                </span>
                {conta?.ultimo_erro && <span className="text-[12.5px]" style={{ color: "var(--warn-ink)" }}>{conta.ultimo_erro}</span>}
              </div>
            ) : (
              <div className="flex flex-col gap-1 text-[13px]">
                <span className="font-semibold">{conta ? "Desconectado" : "Nenhum Instagram conectado"}</span>
                {conta?.ultimo_erro && <span style={{ color: "var(--warn-ink)" }}>{conta.ultimo_erro}</span>}
              </div>
            )}
        </div>

        <ul className="mt-3 list-disc pl-5 text-[12.5px]" style={{ color: "var(--ink3)" }}>
          <li>Precisa ser conta <b>profissional</b> (comercial ou criador de conteúdo). Pelo app: Configurações → Tipo de conta.</li>
          <li>Pela regra da Meta, você responde pelo QS até 24 h depois da última mensagem do cliente. Puxar conversa continua pelo app.</li>
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          {conectada && (
            <button type="button" onClick={() => void desconectar()} disabled={ocupado} className="min-h-[40px] rounded-xl px-4 text-[14px]"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}>Desconectar</button>
          )}
          <button type="button" onClick={() => void conectar()} disabled={ocupado} className="min-h-[40px] rounded-xl px-4 text-[14px] font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)" }}>
            {ocupado ? "Abrindo…" : conectada ? "Trocar de conta" : "Conectar meu Instagram"}
          </button>
        </div>
      </div>
    </div>
  );
}
