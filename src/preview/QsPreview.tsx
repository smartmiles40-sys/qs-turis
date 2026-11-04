// src/preview/QsPreview.tsx
// -----------------------------------------------------------------------------
// PREVIEW LOCAL do QS INTEIRO, sem login e sem banco (04/11), servida em
// http://localhost:5184/qs-preview.html no `npx vite`.
//
// Por que existe: pra acertar o QS no CELULAR (Fila, ficha do lead, Agenda,
// Closer) sem a senha do Bruno. Monta o <App/> de verdade com uma sessão de
// mentira e um "banco" de mentira em memória: poucos leads, uma fila, umas
// reuniões. Não é fiel em regra de negócio — é fiel em LAYOUT, que é o que
// importa aqui.
//
// SEM BANCO, por construção: TODO fetch que sairia pro Supabase ou pro /api
// (que no `vite dev` roda o handler de verdade, com chave de serviço!) é
// respondido aqui. Gravação (POST/PATCH/DELETE) não sai da aba. O realtime vira
// canal de mentira. Nada disso entra no build (o build só empacota o index.html).
//
//   ?papel=sdr|closer   quem está "logado"           [sdr]
//   #comercial/lead/l1  já abre a ficha do lead
//   #comercial/agenda/… a agenda;  #closer          a casa do closer
// -----------------------------------------------------------------------------

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../index.css";
import "../styles/ponte.css";
import { supabase } from "../lib/supabase";
import App from "../App";

const qs = new URLSearchParams(location.search);
const PAPEL = qs.get("papel") === "closer" ? "closer" : "sdr";
try { localStorage.setItem("qs_area", "comercial"); } catch { /* anônimo */ }

// ── O "banco" ────────────────────────────────────────────────────────────────
const agora = Date.now();
const iso = (min: number) => new Date(agora + min * 60_000).toISOString();
const hojeAs = (h: number, m = 0) => { const d = new Date(agora); d.setHours(h, m, 0, 0); return d.toISOString(); };

const EU = PAPEL === "closer" ? "u3" : "u1";
const users = [
  { id: "u1", name: "Yanca Manuella", email: "yanca@exemplo.com", role: "sdr", is_active: true, setores: ["comercial"], created_at: iso(-99999) },
  { id: "u2", name: "Victor Hugo", email: "victor@exemplo.com", role: "sdr", is_active: true, setores: ["comercial"], created_at: iso(-99999) },
  { id: "u3", name: "Talita Carvalho", email: "talita@exemplo.com", role: "closer", is_active: true, setores: ["comercial"], created_at: iso(-99999) },
];

const lead = (id: string, nome: string, phone: string, extra: Record<string, unknown> = {}) => ({
  id, first_name: nome.split(" ")[0], last_name: nome.split(" ").slice(1).join(" ") || null, full_name: nome,
  job_title: null, department: null, company_name: null, state: "SP", city: "São Paulo", website: null,
  company_linkedin: null, company_size: null, segment: null, phone, email: `${id}@exemplo.com`, linkedin_url: null,
  source: "inbound", status: "em_contato", location: null, owner_id: "u1", cadence_id: "c1", loss_reason_id: null,
  estimated_value: 34000, closed_value: null, cadence_started_at: iso(-60 * 24 * 2), created_at: iso(-60 * 24 * 3),
  updated_at: iso(-30), utm_source: "facebook", utm_campaign: "japao-marco-2027", tags: ["Japão Março", "live"],
  ...extra,
});
const leads = [
  lead("l1", "Mariana Albuquerque Figueiredo", "5511991234567", { status: "novo" }),
  lead("l2", "João Pedro Santos", "5521998765432"),
  lead("l3", "Família Nakamura", "5511970001122", { status: "qualificado" }),
  lead("l4", "Carla Mendes", "5531988887777"),
  lead("l5", "Roberto Siqueira", "5541977776666", { status: "reuniao_agendada" }),
];

const task = (id: string, leadId: string, canal: string, min: number, extra: Record<string, unknown> = {}) => ({
  id, lead_id: leadId, cadence_id: "c1", owner_id: "u1", channel_type: canal, priority: "alta",
  scheduled_at: iso(min), status: min < 0 ? "atrasada" : "pendente", is_extra: false,
  notes: "Ligar e confirmar interesse na expedição de março. Perguntar quantas pessoas e se já tem passaporte.",
  tags: ["dia:1", "tentativa:2"], completed_at: null, created_at: iso(-600), ...extra,
});
const tasks = [
  task("t1", "l1", "ligacao", -20),
  task("t2", "l2", "whatsapp", 30),
  task("t3", "l3", "ligacao", 90),
  task("t4", "l4", "email", 180, { is_extra: true }),
];

const meeting = (id: string, leadId: string, nome: string, h: number, status = "agendada") => ({
  id, lead_id: leadId, owner_id: "u1", closer_id: "u3", title: `Reunião — ${nome}`, scheduled_at: hojeAs(h),
  ends_at: hojeAs(h + 1), duration_min: 60, location: "Google Meet", meeting_link: "https://meet.google.com/abc-defg-hij",
  notes: "Casal + 1 criança. Quer Japão Março. Orçamento ok.", status, sal: null, lead_name: nome,
  scheduled_by: "Yanca Manuella", created_at: iso(-600),
});
const meetings = [
  meeting("m1", "l5", "Roberto Siqueira", 10),
  meeting("m2", "l3", "Família Nakamura", 14),
  meeting("m3", "l1", "Mariana Albuquerque Figueiredo", 16, "confirmada"),
];

const cadences = [{
  id: "c1", name: "Inbound — Lives", description: null, acquisition_channel: "inbound", objective: "reuniao",
  execution_mode: "manual", priority: "alta", status: "ativa", execution_weekdays: [1, 2, 3, 4, 5],
  auto_loss_days: 15, distribution_mode: "round_robin", offday_policy: "next", redirect_cadence_id: null, created_at: iso(-99999),
}];

const notes = [
  { id: "n1", lead_id: "l1", author_id: "u1", body: "Assistiu a live do Japão inteira. Quer levar a filha de 9 anos.", tags: [], created_at: iso(-300) },
];

const BANCO: Record<string, Record<string, unknown>[]> = {
  qs_users: users, qs_leads: leads, qs_tasks: tasks, qs_meetings: meetings, qs_cadences: cadences, qs_notes: notes,
};

// ── PostgREST de mentira (o mínimo de filtro pra ficha achar o lead certo) ───
function filtrar(linhas: Record<string, unknown>[], params: URLSearchParams) {
  let out = linhas;
  params.forEach((v, k) => {
    if (["select", "order", "limit", "offset", "or", "and", "on_conflict", "columns"].includes(k)) return;
    if (!out.length || !(k in out[0])) return;
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith("in.(")) {
      const vals = v.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, ""));
      out = out.filter((r) => vals.includes(String(r[k])));
    }
  });
  return out;
}

const resposta = (body: unknown, total?: number) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status: body === undefined ? 204 : 200,
    headers: { "Content-Type": "application/json", "Content-Range": `0-${Math.max((total ?? 1) - 1, 0)}/${total ?? "*"}` },
  });

const fetchOriginal = window.fetch.bind(window);
window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  const local = url.startsWith("/") || url.startsWith(location.origin);
  if (local && !url.includes("/api/")) return fetchOriginal(entrada, init);

  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
  const umSo = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
  const u = new URL(url, location.origin);

  if (u.pathname.includes("/api/")) return resposta({ ok: true, respostas: [], modelos: [], notas: [], tarefas: [], reunioes: [], conversa: [] });
  if (u.pathname.includes("/auth/v1/")) return resposta({});
  const m = u.pathname.match(/\/rest\/v1\/(rpc\/)?([a-z0-9_]+)/i);
  if (!m) return resposta(umSo ? null : []);
  if (m[1]) return resposta(umSo ? null : []);                         // rpc
  if (metodo !== "GET" && metodo !== "HEAD") return resposta(umSo ? null : []);   // gravação não sai daqui
  const linhas = filtrar(BANCO[m[2]] ?? [], u.searchParams);
  if (metodo === "HEAD") return resposta(undefined, linhas.length);
  return resposta(umSo ? (linhas[0] ?? null) : linhas, linhas.length);
}) as typeof window.fetch;

// Sessão de mentira: o QsAuthProvider acha um usuário logado e carrega o
// perfil do "banco" acima.
const sessao = { access_token: "preview", refresh_token: "preview", expires_at: Math.floor(agora / 1000) + 3600, user: { id: EU, email: users.find((x) => x.id === EU)!.email } };
supabase.auth.getSession = (async () => ({ data: { session: sessao }, error: null })) as unknown as typeof supabase.auth.getSession;
supabase.auth.getUser = (async () => ({ data: { user: sessao.user }, error: null })) as unknown as typeof supabase.auth.getUser;
supabase.auth.onAuthStateChange = (() => ({ data: { subscription: { unsubscribe() {} } } })) as unknown as typeof supabase.auth.onAuthStateChange;
supabase.auth.signOut = (async () => ({ error: null })) as unknown as typeof supabase.auth.signOut;
const canalFalso: Record<string, unknown> = {};
canalFalso.on = () => canalFalso;
canalFalso.subscribe = () => canalFalso;
canalFalso.unsubscribe = async () => "ok";
canalFalso.send = async () => "ok";
canalFalso.track = async () => "ok";
canalFalso.presenceState = () => ({});
supabase.channel = (() => canalFalso) as unknown as typeof supabase.channel;
supabase.removeChannel = (async () => "ok") as unknown as typeof supabase.removeChannel;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
