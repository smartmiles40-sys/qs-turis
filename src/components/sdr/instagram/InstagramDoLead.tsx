// src/components/sdr/instagram/InstagramDoLead.tsx
// -----------------------------------------------------------------------------
// INSTAGRAM NA CONVERSA DO SDR (Bruno, 27/11/2026).
//
// As DMs que o lead manda pro @ da agência (webhook do Marketing) ficam
// amarradas ao lead pelo @ (0430). Aqui a SDR lê e responde sem sair do QS.
//
// Regra da Meta: só dá pra responder até 24 h depois da última mensagem do
// cliente, e não dá pra puxar conversa. Fora da janela a caixa de texto vira o
// botão "Abrir no Instagram" (o celular/computador da agência).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/qs/waInbox";
import { urlDoInstagram } from "@/lib/instagram";

export interface ConversaIg {
  id: string;
  username: string | null;
  nome: string | null;
  ultima_entrada_em: string | null;
  ultima_mensagem_em: string | null;
  nao_lidas: number;
}
interface MsgIg { id: string; direcao: "entrada" | "saida"; texto: string | null; tipo: string; origem: string; status: string; erro: string | null; criado_em: string }

const JANELA_MS = 24 * 3_600_000;

/** A conversa de Instagram deste lead (a mais recente). null = nenhuma DM ainda. */
export async function conversaIgDoLead(leadId: string): Promise<ConversaIg | null> {
  const { data, error } = await supabase
    .from("mkt_ig_conversas" as never)
    .select("id,username,nome,ultima_entrada_em,ultima_mensagem_em,nao_lidas")
    .eq("lead_id", leadId)
    .order("ultima_mensagem_em", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) { console.warn("[ig] conversa do lead:", error.message); return null; }
  return ((data ?? []) as unknown as ConversaIg[])[0] ?? null;
}

function quando(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function restanteJanela(ultimaEntrada: string | null): string | null {
  if (!ultimaEntrada) return null;
  const falta = Date.parse(ultimaEntrada) + JANELA_MS - Date.now();
  if (falta <= 0) return null;
  const h = Math.floor(falta / 3_600_000);
  const m = Math.floor((falta % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function InstagramDoLead({ leadId, instagram, nome, aberto, onFechar, onMudou }: {
  leadId: string;
  /** @ cadastrado no lead (sem o @). */
  instagram: string | null;
  nome: string;
  aberto: boolean;
  onFechar: () => void;
  /** Avisa a ficha pra atualizar o selo de não lidas. */
  onMudou?: () => void;
}) {
  const [conv, setConv] = useState<ConversaIg | null>(null);
  const [msgs, setMsgs] = useState<MsgIg[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const marcouLida = useRef(false);

  const carregar = useCallback(async () => {
    const c = await conversaIgDoLead(leadId);
    setConv(c);
    if (c) {
      const { data } = await supabase
        .from("mkt_ig_mensagens" as never)
        .select("id,direcao,texto,tipo,origem,status,erro,criado_em")
        .eq("conversa_id", c.id)
        .order("criado_em", { ascending: true })
        .limit(300);
      setMsgs((data ?? []) as unknown as MsgIg[]);
      if (c.nao_lidas > 0 && !marcouLida.current) {
        marcouLida.current = true;
        void fetch("/api/sdr-instagram", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ leadId, acao: "lida" }) })
          .then(() => onMudou?.()).catch(() => null);
      }
    } else setMsgs([]);
    setCarregando(false);
  }, [leadId, onMudou]);

  useEffect(() => {
    if (!aberto) return;
    marcouLida.current = false;
    setCarregando(true); setErro(null);
    void carregar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 15_000);
    return () => window.clearInterval(id);
  }, [aberto, carregar]);

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  const resta = restanteJanela(conv?.ultima_entrada_em ?? null);
  const perfil = instagram || conv?.username || null;

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true); setErro(null);
    try {
      const res = await fetch("/api/sdr-instagram", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ leadId, texto: t }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(j?.error || "Não consegui enviar."); return; }
      setTexto("");
      await carregar();
      onMudou?.();
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally { setEnviando(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Instagram de ${nome}`}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,.45)" }} onClick={onFechar} />
      <div className="relative flex h-[min(640px,92vh)] w-full max-w-[520px] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}>
        <header className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
          <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ background: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{nome}</div>
            <div className="truncate text-[12.5px]" style={{ color: "var(--ink3)" }}>
              {perfil ? <a href={urlDoInstagram(perfil)} target="_blank" rel="noopener noreferrer" style={{ color: "#DB2777", fontWeight: 600 }}>@{perfil}</a> : "sem @ cadastrado"}
              {" · Instagram da agência"}
            </div>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg px-2 py-1 text-[20px] leading-none" aria-label="Fechar" style={{ color: "var(--ink3)" }}>×</button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3" style={{ background: "var(--card2)" }}>
          {carregando && <div className="py-10 text-center text-sm" style={{ color: "var(--ink3)" }}>Carregando…</div>}
          {!carregando && !conv && (
            <div className="py-10 text-center text-sm" style={{ color: "var(--ink3)" }}>
              {perfil ? <>@{perfil} ainda não mandou DM pro Instagram da agência.</> : <>Cadastre o @ do lead pra conversa do Instagram aparecer aqui.</>}
              <div className="mt-2 text-[12.5px]">Pelo Instagram não dá pra puxar conversa pelo QS: mande a 1ª mensagem pelo app. Quando o cliente responder, a conversa cai aqui.</div>
            </div>
          )}
          {!carregando && conv && msgs.length === 0 && <div className="py-10 text-center text-sm" style={{ color: "var(--ink3)" }}>Nenhuma mensagem ainda.</div>}
          <div className="flex flex-col gap-2">
            {msgs.map((m) => {
              const minha = m.direcao === "saida";
              return (
                <div key={m.id} className={`flex ${minha ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[80%] rounded-2xl px-3 py-2 text-[14px]"
                    style={minha
                      ? { background: "#8134AF", color: "#fff", borderBottomRightRadius: 6 }
                      : { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)", borderBottomLeftRadius: 6 }}>
                    <div className="whitespace-pre-wrap break-words">{m.texto || `[${m.tipo}]`}</div>
                    <div className="mt-1 text-right text-[11px]" style={{ opacity: 0.75 }}>
                      {m.origem === "automacao" ? "robô · " : m.origem === "eco" ? "pelo app · " : ""}{quando(m.criado_em)}
                      {m.status === "falha" && <span title={m.erro ?? undefined}> · não enviada</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={fimRef} />
          </div>
        </div>

        <footer className="flex flex-col gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--line)" }}>
          {conv && resta && (
            <div className="text-[12px]" style={{ color: "var(--ink3)" }}>Dá pra responder por aqui por mais <b>{resta}</b> (regra da Meta: 24 h depois da última mensagem do cliente).</div>
          )}
          {conv && !resta && (
            <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
              Passou de 24 h desde a última mensagem do cliente: a Meta não deixa responder pelo QS. Responda pelo app do Instagram; quando o cliente escrever de novo, a conversa volta a abrir aqui.
            </div>
          )}
          {erro && <div className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</div>}
          {conv && resta ? (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={1000}
                placeholder="Escreva a resposta…" aria-label="Resposta no Instagram"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                className="min-h-[44px] flex-1 resize-none rounded-xl px-3 py-2 text-[14px]"
                style={{ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" }} />
              <button type="submit" disabled={!texto.trim() || enviando} className="min-h-[44px] rounded-xl px-4 text-[14px] font-semibold text-white disabled:opacity-50"
                style={{ background: "#8134AF" }}>{enviando ? "Enviando…" : "Enviar"}</button>
            </form>
          ) : perfil ? (
            <a href={urlDoInstagram(perfil)} target="_blank" rel="noopener noreferrer"
              className="flex min-h-[44px] items-center justify-center rounded-xl text-[14px] font-semibold text-white" style={{ background: "#8134AF" }}>
              Abrir @{perfil} no Instagram
            </a>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
