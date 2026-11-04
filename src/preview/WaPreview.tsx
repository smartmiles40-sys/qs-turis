// src/preview/WaPreview.tsx
// -----------------------------------------------------------------------------
// Página de PREVIEW LOCAL do WhatsApp dentro do QS (04/11), servida em
// http://localhost:5184/wa-preview.html no `npx vite`.
//
// Por que existe: o WhatsApp do comercial vira API e o time inteiro passa a
// atender por DENTRO do QS — inclusive pelo celular. Pra acertar a tela no
// celular sem o login do Bruno, esta página monta os componentes REAIS
// (QsWaDock, WaPage, WaThreadList, WaConversation) com conversas de mentira.
//
// SEM BANCO, de propósito e por construção: TODO fetch que sairia pro Supabase
// ou pro /api (que no `vite dev` roda o handler de verdade!) é respondido aqui
// mesmo, e o realtime vira um canal de mentira. Nada é lido nem gravado.
// Nada disso entra no build de produção (o build só empacota o index.html).
//
//   ?tela=dock    → o painel lateral (no celular ele vira tela cheia)  [padrão]
//   ?tela=pagina  → a aba WhatsApp do menu do Comercial
//   &lead=l1      → já abre a conversa (l1 = conversa cheia: áudio, imagem…)
//   &tema=escuro  → modo noturno
// -----------------------------------------------------------------------------

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../components/ui/ui.css";
import { supabase } from "../lib/supabase";
import { ChatAppDockProvider, useChatAppDock } from "../contexts/ChatAppDockContext";
import QsWaDock from "../components/sdr/wa/QsWaDock";
import WaPage from "../components/sdr/wa/WaPage";

const qs = new URLSearchParams(location.search);
const TELA = qs.get("tela") === "pagina" ? "pagina" : "dock";
const LEAD = qs.get("lead");
if (qs.get("tema") === "escuro") document.documentElement.classList.add("dark");

// ── Dados de mentira ─────────────────────────────────────────────────────────
const agora = Date.now();
const iso = (minAtras: number) => new Date(agora - minAtras * 60_000).toISOString();

const NOMES = [
  ["l1", "Mariana Albuquerque Figueiredo", "5511991234567", "Novo", 3, 12],
  ["l2", "João Pedro", "5521998765432", "Em contato", 0, 45],
  ["l3", "Família Nakamura (Japão Março)", "5511970001122", "Qualificado", 1, 130],
  ["l4", "Carla", "5531988887777", "Novo", 0, 60 * 26],
  ["l5", "Roberto Siqueira", "5541977776666", "Reunião agendada", 2, 60 * 50],
  ["l6", "Ana Beatriz Lopes", "5511966665555", "Em contato", 0, 60 * 72],
] as const;

const THREADS = NOMES.map(([id, nome, phone, status, unread, min], i) => ({
  lead_id: id,
  last_message: i === 0 ? "Oi! Vi a live do Japão, ainda tem vaga pra março? 😍" : i === 2 ? "🎤 Áudio" : "Combinado, obrigado pelo retorno!",
  last_direction: i % 2 ? "out" : "in",
  last_at: iso(min),
  last_in_at: iso(min + (i % 2 ? 5 : 0)),
  last_out_at: iso(min + 3),
  unread,
  can_reply: min < 60 * 24,
  synced_at: iso(1),
  history_synced: true,
  avatar_url: null,
  lead: { id, full_name: nome, first_name: nome.split(" ")[0], phone, status, owner_id: "u1" },
}));

const IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='420'><rect width='640' height='420' fill='#7aa7d6'/><circle cx='480' cy='110' r='60' fill='#ffd36b'/><path d='M0 420 L220 170 L380 330 L470 250 L640 420Z' fill='#2f5d3a'/><path d='M150 250 L220 170 L290 250Z' fill='#fff'/></svg>`
);
// Áudio de 2 s de silêncio (WAV) — só pro player desenhar.
function wavSilencio(seg = 2): string {
  const sr = 8000, n = sr * seg, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let bin = ""; new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return "data:audio/wav;base64," + btoa(bin);
}
const AUDIO = wavSilencio();

let seq = 0;
const msg = (lead: string, direction: "in" | "out", content: string | null, minAtras: number, extra: Record<string, unknown> = {}) => ({
  id: `m${++seq}`, lead_id: lead, direction, content, attachments: [], sender_name: null,
  sent_at: iso(minAtras), reactions: [], status: direction === "out" ? "read" : null, ...extra,
});

const MENSAGENS: Record<string, unknown[]> = {
  l1: [
    msg("l1", "in", "Oi! Vi a live do Japão ontem à noite", 60 * 20),
    msg("l1", "in", "Ainda tem vaga pra expedição de março? Somos em 2 adultos e uma criança de 9 anos", 60 * 20 - 1),
    msg("l1", "out", "Oi, Mariana! Tudo bem? Aqui é a *Yanca*, da Se Tu For, Eu Vou 😊\n\nTem sim! A turma de março está com as últimas vagas. Posso te mandar o roteiro completo?", 60 * 19, { reactions: [{ emoji: "❤️", autor: "x", nome: "Mariana" }] }),
    msg("l1", "in", null, 60 * 18, { attachments: [{ type: "image", url: IMG }] }),
    msg("l1", "in", "Esse é o lugar que minha filha mais quer ver 🗻", 60 * 18 - 1),
    msg("l1", "out", null, 60 * 17, { attachments: [{ type: "audio", url: AUDIO }], transcricao: "Que lindo! O Fuji entra no dia 6 do roteiro, com pernoite em ryokan na beira do lago Kawaguchiko." }),
    msg("l1", "in", null, 50, { attachments: [{ type: "audio", url: AUDIO }] }),
    msg("l1", "in", "😍", 14),
    msg("l1", "in", "Oi! Vi a live do Japão, ainda tem vaga pra março? 😍", 12, { reply_preview: "Tem sim! A turma de março está com as últimas vagas." }),
  ],
};
for (const [id] of NOMES) {
  if (!MENSAGENS[id]) MENSAGENS[id] = [
    msg(id, "in", "Boa tarde! Queria saber mais sobre o pacote", 200),
    msg(id, "out", "Boa tarde! Claro — qual destino te interessou?", 190),
    msg(id, "in", "Combinado, obrigado pelo retorno!", 180),
  ];
}

const USERS = [
  { id: "u1", name: "Yanca Manuella", role: "sdr", is_active: true },
  { id: "u2", name: "Victor Hugo", role: "sdr", is_active: true },
  { id: "u3", name: "Talita Carvalho", role: "closer", is_active: true },
];

const CONFIG = {
  respostas: [
    { atalho: "roteiro", texto: "Te mando o roteiro completo, {nome}! Qualquer dúvida é só chamar." },
    { atalho: "valores", texto: "Os valores começam em R$ 16.982,46 por pessoa em quarto duplo." },
  ],
  modelos: [
    { nome: "retomada_contato", idioma: "pt_BR", categoria: "MARKETING", cabecalho: null,
      corpo: "Oi {{1}}! Aqui é da Se Tu For, Eu Vou. Ainda posso te ajudar com a viagem?", rodape: null, variaveis: ["1"], exemplos: ["Mariana"] },
  ],
};

// ── O "servidor" de mentira ──────────────────────────────────────────────────
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Content-Range": "0-0/*" } });

const fetchOriginal = window.fetch.bind(window);
window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  const local = url.startsWith("/") || url.startsWith(location.origin);
  // Arquivos do próprio vite passam; QUALQUER outra coisa é respondida aqui.
  if (local && !url.includes("/api/")) return fetchOriginal(entrada, init);

  const headers = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
  const umSo = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
  const u = new URL(url, location.origin);
  const leadEq = (u.searchParams.get("lead_id") ?? "").replace(/^eq\./, "");

  if (u.pathname.includes("/api/wa-config")) return json(u.searchParams.has("modelos_lead") ? { modelos: CONFIG.modelos } : CONFIG);
  if (u.pathname.includes("/api/wa-sync")) {
    const t = THREADS.find((x) => x.lead_id === u.searchParams.get("leadId"));
    return json({ lead: t?.lead ?? null, notas: [], tarefas: [], reunioes: [], conversa: [] });
  }
  if (u.pathname.includes("/api/")) return json({ ok: true });
  if (u.pathname.includes("/rest/v1/qs_wa_threads")) {
    if (umSo) return json(THREADS.find((t) => t.lead_id === leadEq) ?? null);
    return json(leadEq ? THREADS.filter((t) => t.lead_id === leadEq) : THREADS);
  }
  if (u.pathname.includes("/rest/v1/qs_wa_messages")) {
    const lista = [...(MENSAGENS[leadEq] ?? [])].reverse();   // a tela pede descendente
    return json(lista);
  }
  if (u.pathname.includes("/rest/v1/qs_users")) return json(umSo ? USERS[0] : USERS);
  if (u.pathname.includes("/rest/v1/rpc/")) return json(null);
  return json(umSo ? null : []);
}) as typeof window.fetch;

supabase.auth.getSession = (async () => ({
  data: { session: { access_token: "preview", user: { id: "u1" } } }, error: null,
})) as unknown as typeof supabase.auth.getSession;
supabase.auth.getUser = (async () => ({ data: { user: { id: "u1" } }, error: null })) as unknown as typeof supabase.auth.getUser;
// Realtime de mentira: o painel assina, mas nada sai daqui.
const canalFalso: Record<string, unknown> = {};
canalFalso.on = () => canalFalso;
canalFalso.subscribe = () => canalFalso;
canalFalso.unsubscribe = async () => "ok";
supabase.channel = (() => canalFalso) as unknown as typeof supabase.channel;
supabase.removeChannel = (async () => "ok") as unknown as typeof supabase.removeChannel;

// ── A tela ───────────────────────────────────────────────────────────────────
function AbreDock() {
  const { openForLead, open } = useChatAppDock();
  useEffect(() => {
    const t = THREADS.find((x) => x.lead_id === LEAD);
    if (t) openForLead({ leadId: t.lead_id, name: t.lead.full_name, phone: t.lead.phone, ownerId: "u1" });
    else open();
  }, [openForLead, open]);
  return null;
}

function AbrePagina() {
  const { openForLead } = useChatAppDock();
  useEffect(() => {
    const t = THREADS.find((x) => x.lead_id === LEAD);
    if (t) openForLead({ leadId: t.lead_id, name: t.lead.full_name, phone: t.lead.phone, ownerId: "u1" });
  }, [openForLead]);
  return null;
}

/** Imita o shell do Comercial: app à esquerda, dock dividindo a tela à direita. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="qs-shell" style={{ height: "100dvh", overflow: "hidden" }}>
      <main className="qs-main" style={{ minHeight: 0, overflow: "auto", padding: 24 }}>
        <p style={{ fontWeight: 600 }}>Fila de atividades (de mentira)</p>
        <p style={{ color: "var(--ink3)", marginTop: 8 }}>O QS continua aqui do lado enquanto o WhatsApp está aberto.</p>
      </main>
      {children}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChatAppDockProvider>
      {TELA === "dock" ? (
        <Shell>
          <AbreDock />
          <QsWaDock onOpenLead={(id) => alert(`Abriria o card do lead ${id}`)} />
        </Shell>
      ) : (
        <div className="qs-shell" style={{ height: "100dvh", overflow: "hidden", flexDirection: "column" }}>
          <AbrePagina />
          <main className="qs-main" style={{ minHeight: 0, overflow: "hidden", flex: 1 }}>
            <WaPage onOpenLead={(id) => alert(`Abriria o card do lead ${id}`)} />
          </main>
        </div>
      )}
    </ChatAppDockProvider>
  </StrictMode>
);
