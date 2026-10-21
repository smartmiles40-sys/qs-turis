// src/propostas/PropostaPublica.tsx
// -----------------------------------------------------------------------------
// /proposta/<token> — o CLIENTE abre sem login (0156). Quem fala com o banco é
// o servidor (api/proposta.js); esta página só mostra e manda a escolha.
// ?equipe=1 (botão "Abrir link" do QS) não conta como visualização do cliente.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import PropostaView from "./PropostaView";
import { tituloDaProposta, type PropostaVM } from "./lib";

export default function PropostaPublica({ token }: { token: string }) {
  const [p, setP] = useState<PropostaVM | null>(null);
  const [falha, setFalha] = useState(false);
  const equipe = new URLSearchParams(window.location.search).get("equipe") === "1";

  const carregar = useCallback(async (contar: boolean) => {
    const r = await fetch(`/api/proposta?token=${encodeURIComponent(token)}${contar && !equipe ? "" : "&equipe=1"}`).catch(() => null);
    if (!r?.ok) { setFalha(true); return; }
    const j = (await r.json()) as PropostaVM;
    setP(j);
    document.title = `${tituloDaProposta(j)} · Se Tu For, Eu Vou! Viagens`;
  }, [token, equipe]);

  useEffect(() => { void carregar(true); }, [carregar]);

  async function escolher(opcaoId: string, nome: string) {
    const r = await fetch("/api/proposta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, opcaoId, nome }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || "Não conseguimos registrar agora. Tente de novo.");
    await carregar(false);
  }

  if (falha) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center" style={{ background: "#F8F6F7", color: "#1C2B2D" }}>
        <div className="max-w-sm space-y-2">
          <p className="text-[18px] font-bold">Proposta não encontrada</p>
          <p className="text-[14px]" style={{ color: "#5B6B6D" }}>O link pode ter mudado. Fale com seu consultor da Se Tu For, Eu Vou! Viagens que ele manda de novo.</p>
        </div>
      </div>
    );
  }
  if (!p) return <div className="min-h-screen" style={{ background: "#F8F6F7" }} />;
  return <PropostaView p={p} onEscolher={escolher} />;
}
