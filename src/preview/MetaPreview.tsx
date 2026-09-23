// Preview isolado do painel "WhatsApp (Meta)" — dados falsos, sem Meta e sem
// servidor. Rode:  npm run dev  →  /src/preview/meta-preview.html
import { createRoot } from "react-dom/client";
import ConexaoMeta from "../components/sdr/settings/ConexaoMeta";
import { supabase } from "../lib/supabase";
import "../index.css";

supabase.auth.getSession = (async () => ({
  data: { session: { access_token: "preview" } }, error: null,
})) as typeof supabase.auth.getSession;

const painel = {
  numeros: [
    { phoneId: "1126057943914647", numero: "+55 11 4863-6051", nome: "Se Tu For, Eu Vou!", modo: "env", status: "conectado",
      origem: "vercel", dono: null, donoId: null, conectadoEm: null, qualidade: "GREEN", limite: "TIER_1K",
      statusMeta: "CONNECTED", metaErro: null, ultimaEntrada: "2026-09-01T22:20:36Z" },
    { phoneId: "2", numero: "+55 11 91017-6414", nome: "Mariana — STFV", modo: "coexistencia", status: "conectado",
      origem: "painel", dono: "Mariana", donoId: "m", conectadoEm: "2026-09-23T15:00:00Z", qualidade: "YELLOW", limite: "TIER_250",
      statusMeta: "CONNECTED", metaErro: null, ultimaEntrada: "2026-09-23T14:58:00Z" },
  ],
  cadastro: { appId: "123456789012345", configId: null, podeTrocarCodigo: true },
  entrada: { ok: false, motivo: "nao-chega" },
  sdrs: [{ id: "m", nome: "Mariana" }, { id: "y", nome: "Yanca Manuella Ruivo" }, { id: "v", nome: "Victor Hugo" }],
};

const fetchOriginal = window.fetch;
window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (!url.includes("/api/wa-config")) return fetchOriginal(entrada, init);
  const corpo = JSON.parse(String(init?.body ?? "{}"));
  if (corpo.acao === "meta-cadastro-salvar") painel.cadastro.configId = corpo.configId || null;
  return new Response(JSON.stringify({ ok: true, ...painel }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
  <div style={{ maxWidth: 900, margin: "0 auto", padding: 24, background: "#fff", minHeight: "100vh" }}>
    <ConexaoMeta />
  </div>
);
