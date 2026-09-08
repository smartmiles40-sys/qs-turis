// Preview isolado da tela "Números do WhatsApp" — só pra OLHAR e CLICAR o
// desenho, sem logar no QS, sem Supabase e sem servidor nenhum. Não entra no
// build do app (nenhum arquivo de src/preview entra).
//
// A tela real conversa com /api/sdr-pool. Aqui a gente troca só a CAMADA DE
// REDE por dados na memória — o componente é exatamente o mesmo arquivo que vai
// pra produção, então o que você vê aqui é o que o time comercial vai ver.
//
// Rode:  npm run dev   →   http://localhost:3000/numeros-preview.html
import { createRoot } from "react-dom/client";
import NumerosWhatsApp from "../components/sdr/settings/NumerosWhatsApp";
import { supabase } from "../lib/supabase";
import type { CardSdr, NumeroReserva, NumeroQueimado } from "../lib/qs/sdrPool";
import "../index.css";

// ── Estado de mentira, mas que muda de verdade ──────────────────────────────
// Os botões precisam FUNCIONAR no preview: metade das decisões de desenho desta
// tela é sobre o que acontece depois do clique (a confirmação, o número novo
// aparecendo, o chip velho indo pro histórico). Um mock estático esconderia
// justamente isso.
const banco: {
  dias: number;
  sdrs: CardSdr[];
  proximo_sdr_id: string | null;
  reservas: NumeroReserva[];
  queimados: NumeroQueimado[];
} = {
  dias: 7,
  sdrs: [
    { sdr_id: "1", nome: "Mariana", email: "mariana.rodrigues@agenciasetuforeuvou.com",
      pool_id: "p1", numero: "5511988880001", status: "ativo", desde: "2026-08-20T12:00:00Z",
      leads_7d: 41, reservas_7d: 12 },
    { sdr_id: "2", nome: "Victor Hugo", email: "victor.hugo@agenciasetuforeuvou.com",
      pool_id: "p2", numero: "5511988880002", status: "ativo", desde: "2026-08-20T12:00:00Z",
      leads_7d: 38, reservas_7d: 11 },
    { sdr_id: "3", nome: "Yanca Manuella Ruivo", email: "yanca.manuella@agenciasetuforeuvou.com",
      pool_id: null, numero: null, status: "sem-numero", desde: null,
      leads_7d: 29, reservas_7d: 8 },
  ],
  proximo_sdr_id: "2",
  reservas: [
    { id: "r1", numero: "5511977770001", created_at: "2026-07-02T10:00:00Z" },
    { id: "r2", numero: "5511977770002", created_at: "2026-07-19T10:00:00Z" },
  ],
  queimados: [
    { id: "q1", numero: "5511966660009", sdr_nome: "Yanca Manuella Ruivo", updated_at: "2026-09-01T09:00:00Z" },
  ],
};

function retrato() {
  return JSON.parse(JSON.stringify({ ok: true, ...banco }));
}

// A tela pede o token da sessão antes de chamar a rota. Sem Supabase aqui, a
// gente responde um token qualquer — quem valida de verdade é o servidor.
supabase.auth.getSession = (async () => ({
  data: { session: { access_token: "preview" } }, error: null,
})) as typeof supabase.auth.getSession;

const fetchOriginal = window.fetch;
window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (!url.includes("/api/sdr-pool")) return fetchOriginal(entrada, init);

  const { action, sdr_id } = JSON.parse(String(init?.body ?? "{}"));
  await new Promise((r) => setTimeout(r, 350));          // latência, pra ver o estado "Aplicando…"

  const card = banco.sdrs.find((s) => s.sdr_id === sdr_id);

  if (action === "desativar" && card?.numero) {
    banco.queimados.unshift({ id: `q${Date.now()}`, numero: card.numero, sdr_nome: card.nome, updated_at: new Date().toISOString() });
    card.numero = null; card.pool_id = null; card.status = "sem-numero"; card.desde = null;
  }

  if (action === "trocar") {
    if (!banco.reservas.length) {
      return new Response(JSON.stringify({ ok: false, error: "Não há número reserva disponível. Cadastre um chip novo antes de trocar." }),
        { status: 409, headers: { "Content-Type": "application/json" } });
    }
    const nova = banco.reservas.shift()!;
    if (card?.numero) {
      banco.queimados.unshift({ id: `q${Date.now()}`, numero: card.numero, sdr_nome: card.nome, updated_at: new Date().toISOString() });
    }
    if (card) {
      card.numero = nova.numero; card.pool_id = nova.id; card.status = "ativo"; card.desde = new Date().toISOString();
    }
  }

  // Quem é o próximo, recalculado como o servidor faz: o seguinte na roda,
  // considerando só quem tem chip.
  const fila = banco.sdrs.filter((s) => s.status === "ativo");
  if (fila.length) {
    const i = fila.findIndex((s) => s.sdr_id === banco.proximo_sdr_id);
    banco.proximo_sdr_id = fila[i >= 0 ? i : 0].sdr_id;
  } else {
    banco.proximo_sdr_id = null;
  }

  return new Response(JSON.stringify(retrato()), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
  <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, background: "#fff", minHeight: "100vh" }}>
    <div style={{ marginBottom: 20, padding: "10px 14px", background: "#FEF0C7", color: "#B54708",
                  borderRadius: 8, fontSize: 13 }}>
      <strong>Preview.</strong> Dados de mentira, botões funcionando. Números falsos — nenhum WhatsApp
      real aparece aqui. A Yanca está de propósito sem número, pra mostrar o estado “fora do rodízio”.
    </div>
    <NumerosWhatsApp />
  </div>
);
