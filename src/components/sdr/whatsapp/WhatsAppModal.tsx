// src/components/sdr/whatsapp/WhatsAppModal.tsx
// -----------------------------------------------------------------------------
// Modal de WhatsApp para um lead. O envio sai pelo canal NATIVO do QS
// (/api/wa-send: Chatwoot → Evolution → WhatsApp) — a mesma conversa do inbox,
// assinada com o nome do SDR no servidor. Fallback: abrir no wa.me.
// Também oferece ligar pelo NÚMERO OFICIAL (Cloud API Calling).
// Cada interação é registrada em qs_whatsapp_messages.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  waChatLink,
  normalizePhoneBR,
  formatPhoneDisplay,
  isDialablePhone,
  fillTemplate,
  logWhatsApp,
  sendWhatsAppMessage,
  WA_TEMPLATES,
} from "@/lib/whatsapp";
import { dialViaOficial } from "@/lib/qs/waCall";
import {
  carregarPermissao, pedirPermissao, permissaoVale, validadeEmTexto,
  type Permissao,
} from "@/lib/qs/permissaoLigacao";
import { confirmar } from "@/lib/qs/confirmar";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { assinarTexto, loadSignatureName } from "@/lib/qs/waSignature";

export interface WhatsAppLead {
  id?: string | null;
  name?: string | null;
  phone?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  lead: WhatsAppLead;
  ownerId?: string | null;
  /** Texto inicial opcional (ex.: script da cadência). */
  defaultText?: string;
  /** Callback após enviar/abrir a conversa (ex.: registrar atividade/concluir tarefa). */
  onSent?: () => void;
}

const WA_GREEN = "#25D366";
const QS_BLUE = "#0147FF";

export default function WhatsAppModal({ open, onClose, lead, ownerId, defaultText, onSent }: Props) {
  const { currentUser } = useQsAuth();
  const [text, setText] = useState(defaultText ?? "");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [calling, setCalling] = useState(false);
  // Só aparece quando a Meta recusou POR FALTA DE PERMISSÃO (138006). É o único
  // erro de ligação com conserto na hora — e o conserto é daqui mesmo, porque o
  // pedido exige conversa aberta e a conversa está aberta nesta tela.
  const [pedindoPermissao, setPedindoPermissao] = useState(false);
  const [semPermissao, setSemPermissao] = useState(false);
  // A permissão que o banco já conhece. Chega instantânea (o webhook mantém a
  // tabela em dia) e é o que decide a CARA do botão. A verdade absoluta só é
  // consultada na Meta no momento do clique — pintar botão com ida à Graph API
  // seria lento e, pior, inútil: a pessoa pode revogar entre a pintura e o
  // clique de qualquer jeito.
  const [permissao, setPermissao] = useState<Permissao | null>(null);
  const [lendoPermissao, setLendoPermissao] = useState(true);
  const [sending, setSending] = useState(false);
  // Nome que vai na primeira linha da mensagem. O envio pela API é assinado no
  // servidor; aqui a assinatura serve pro texto COPIADO e pro link wa.me, que
  // não passam por lá — e pra mostrar ao SDR como o cliente vai ver.
  const [assinatura, setAssinatura] = useState("");

  const phone = useMemo(() => normalizePhoneBR(lead.phone), [lead.phone]);
  const dialable = isDialablePhone(lead.phone);
  // Enquanto a permissão não carregou, o botão fica OTIMISTA: travar a ligação
  // por causa de uma consulta lenta seria trocar um erro raro (138006, que a
  // discagem trata) por um estorvo em toda ligação.
  const liberado = lendoPermissao ? true : permissaoVale(permissao);
  const validade = validadeEmTexto(permissao);
  // Já mandamos o pedido nas últimas 24h? A Meta só deixa 1 por dia, e insistir
  // queima o limite sem chegar em lugar nenhum.
  const pedidoRecente = !!permissao?.pedidoEm
    && Date.now() - new Date(permissao.pedidoEm).getTime() < 24 * 3_600_000;
  const firstName = (lead.name || "").split(/\s+/)[0] || "lead";

  useEffect(() => {
    if (open) {
      setText(defaultText ?? "");
      setResult(null);
    }
  }, [open, defaultText]);

  useEffect(() => {
    if (open) void loadSignatureName(currentUser).then(setAssinatura);
  }, [open, currentUser]);

  // Lê a permissão de ligação ao abrir. É consulta ao BANCO, não à Meta: chega
  // junto com o resto da tela e não segura a abertura do modal.
  useEffect(() => {
    if (!open || !lead.phone) { setLendoPermissao(false); return; }
    let vivo = true;
    setLendoPermissao(true);
    void carregarPermissao(lead.phone).then((p) => {
      if (!vivo) return;
      setPermissao(p);
      setLendoPermissao(false);
    });
    return () => { vivo = false; };
  }, [open, lead.phone]);

  if (!open) return null;

  /** O texto como o cliente vai receber: com o nome do SDR na primeira linha. */
  function textoAssinado(): string {
    return assinarTexto(text.trim(), assinatura);
  }

  async function copyText(): Promise<boolean> {
    const t = textoAssinado();
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      return false;
    }
  }

  async function handleSend() {
    const t = text.trim();
    if (!t) {
      setResult({ ok: false, msg: "Escreva a mensagem antes de enviar." });
      return;
    }
    if (sending) return;

    // Envia pelo canal nativo (/api/wa-send). O servidor valida a posse do lead,
    // assina com o nome do SDR e grava a bolha na MESMA conversa do inbox.
    setSending(true);
    const r = await sendWhatsAppMessage({
      leadId: lead.id ?? null,
      ownerId: ownerId ?? null,
      phone: lead.phone,
      text: t,
    });
    setSending(false);

    if (r.ok) {
      setResult({ ok: true, msg: "✓ Mensagem enviada — ela aparece na conversa do lead no inbox." });
      onSent?.();
      return;
    }
    setResult({ ok: false, msg: `${r.error} Se preferir, use o botão WhatsApp (abre no seu aparelho).` });
  }

  async function handleCopy() {
    const ok = await copyText();
    setResult(ok ? { ok: true, msg: "Mensagem copiada." } : { ok: false, msg: "Escreva a mensagem antes de copiar." });
  }

  function handleOpenChat() {
    if (!dialable) return;
    const t = textoAssinado();
    logWhatsApp({ leadId: lead.id ?? null, ownerId: ownerId ?? null, phone, body: t || null, status: "pending", kind: "message" });
    window.open(waChatLink(lead.phone, t || undefined), "_blank", "noopener,noreferrer");
  }

  async function handleWebfoneCall() {
    if (!dialable || calling) return;
    // Mesma confirmação da fila: a chamada toca no telefone do cliente, então
    // ela nunca sai de um clique só.
    const ok = await confirmar({
      titulo: "Você confirma querer ligar via WhatsApp?",
      mensagem: `A chamada vai tocar agora${lead.name ? ` para ${lead.name}` : ""}${
        lead.phone ? ` (${formatPhoneDisplay(lead.phone)})` : ""
      }.`,
      confirmarLabel: "Confirmar e ligar",
      recusarLabel: "Recusar",
    });
    if (!ok) return;
    setCalling(true);
    // O log da ligação sai automaticamente no fim, com desfecho e duração — quem
    // emite é o `setOnCallEndedOficial` do waCall.ts. Por isso não gravamos
    // "pending" aqui: linha de log a mais é pior que linha de log atrasada.
    const r = await dialViaOficial(lead.phone, {
      displayName: lead.name ?? undefined,
      leadName: lead.name ?? undefined,
      leadId: lead.id ?? null,
      ownerId: ownerId ?? null,
    });
    // A Meta recusou por falta de permissão: o selo e o botão têm que virar na
    // hora. Sem isto o "Ligar agora" continua verde depois de já ter sido
    // recusado, e a pessoa clica de novo.
    if (!r.ok && r.codigo === 138006) {
      setSemPermissao(true);
      setPermissao((p) => ({
        waId: p?.waId ?? "", status: "no_permission", expiraEm: null,
        pedidoEm: p?.pedidoEm ?? null, respondidoEm: p?.respondidoEm ?? null,
        fonte: "api", confirmado: true,
      }));
    } else {
      setSemPermissao(false);
    }
    setResult(r.ok ? { ok: true, msg: "Ligando pelo webfone… atenda pelo painel que abriu." } : { ok: false, msg: r.error });
    setCalling(false);
  }

  // Manda o "podemos te ligar?" — mensagem interativa, não template. A Meta só
  // aceita dentro da janela de 24h, então quem nunca respondeu não pode receber:
  // nesse caso o erro dela é o próprio recado pro SDR (primeiro faça o lead
  // responder). Limite: 1 pedido por 24h e 2 por semana, por pessoa.
  async function handlePedirPermissao() {
    if (!lead.phone || pedindoPermissao) return;
    setPedindoPermissao(true);
    const r = await pedirPermissao(lead.phone, lead.id ?? null);
    setResult(
      r.ok
        ? { ok: true, msg: "Pedido enviado no WhatsApp. Assim que o cliente autorizar, o botão de ligar libera sozinho." }
        : { ok: false, msg: r.error || "Não consegui mandar o pedido de permissão." },
    );
    if (r.ok) setSemPermissao(false);
    setPedindoPermissao(false);
  }


  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto md:max-h-none md:overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ background: WA_GREEN }}>
          <div className="flex items-center gap-3 text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            <div>
              <p className="text-sm font-bold leading-tight">{lead.name || "Lead"}</p>
              <p className="text-[11px] opacity-90 leading-tight">
                {dialable ? formatPhoneDisplay(lead.phone) : "sem telefone cadastrado"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/90 hover:text-white" aria-label="Fechar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Templates rápidos */}
          <div className="flex flex-wrap gap-2">
            {WA_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => {
                  // Não descarta texto digitado à mão sem perguntar.
                  const filled = fillTemplate(t.text, lead);
                  if (text.trim() && text.trim() !== filled.trim() && !window.confirm("Substituir a mensagem que você já escreveu por este template?")) return;
                  setText(filled);
                }}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Mensagem */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-500">Mensagem</label>
              <button type="button" onClick={handleCopy} className="text-[11px] font-medium text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copiar
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={`Escreva para ${firstName}...`}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-500 resize-none"
            />
            {assinatura && (
              <p className="mt-1 text-[11px] text-gray-400">
                {firstName} vai receber assinado como <b className="text-gray-600">{assinatura}</b>, na primeira linha.
              </p>
            )}
          </div>

          {result && (
            <div className={`text-xs rounded-lg px-3 py-2 ${result.ok ? "text-green-700 bg-green-50 border border-green-100" : "text-red-700 bg-red-50 border border-red-100"}`}>
              {result.msg}
              {semPermissao && (
                <button
                  onClick={() => void handlePedirPermissao()}
                  disabled={pedindoPermissao}
                  className="mt-2 block w-full rounded-md bg-red-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {pedindoPermissao ? "Mandando o pedido…" : "Pedir permissão pra ligar"}
                </button>
              )}
            </div>
          )}

          {/* ── MENSAGEM ─────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Mensagem</p>
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-2">
              <button
                onClick={handleSend}
                disabled={sending || !lead.id}
                title={lead.id ? "Enviar pela conversa do inbox do QS" : "Lead sem cadastro no QS — use o botão WhatsApp"}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
                style={{ background: QS_BLUE }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
                </svg>
                {sending ? "Enviando…" : "Enviar pelo QS"}
              </button>
              <button
                onClick={handleOpenChat}
                disabled={!dialable}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50"
                title="Abrir a conversa no seu WhatsApp"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                WhatsApp
              </button>
            </div>
          </div>

          {/* ── LIGAÇÃO (número oficial, Cloud API Calling) ───────────────── */}
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--card2)" }}>
              <span className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0" style={{ background: "rgba(18,161,138,.14)", color: "#0E7C6A" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold leading-tight text-gray-900">Telefone</p>
                <p className="text-[15px] font-extrabold leading-tight text-gray-800" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {dialable ? formatPhoneDisplay(lead.phone) : "sem telefone cadastrado"}
                </p>
              </div>
              {/* O SELO DA PERMISSÃO. Vale mais que o "Oficial" que estava aqui:
                  ninguém duvida de qual número sai a ligação, mas todo mundo
                  precisa saber se ela PODE sair. */}
              {lendoPermissao ? (
                <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 text-gray-400">…</span>
              ) : liberado ? (
                <span
                  className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: "var(--wa-ok-bg)", color: "#0E7C6A" }}
                  title={`O cliente autorizou receber ligação${validade ? ` — vale por ${validade}` : ""}.`}
                >
                  Liberado{validade ? ` · ${validade}` : ""}
                </span>
              ) : (
                <span
                  className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 bg-amber-50 text-amber-700"
                  title="A Meta só deixa ligar depois que o cliente autoriza."
                >
                  Sem permissão
                </span>
              )}
            </div>
            {/* SEM PERMISSÃO, O BOTÃO NÃO É "LIGAR" — É "PEDIR PERMISSÃO".
                Deixar o "Ligar agora" aceso e recusar depois é o pior dos dois
                mundos: o SDR já liberou o microfone, já esperou, e o cliente
                nem soube que existia uma ligação. Trocar o botão diz o que
                fazer AGORA pra poder ligar daqui a pouco. */}
            {liberado ? (
              <button
                onClick={handleWebfoneCall}
                disabled={!dialable || calling}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 text-[15px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: WA_GREEN }}
              >
                {calling ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Ligando…
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    Ligar agora
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => void handlePedirPermissao()}
                disabled={!dialable || pedindoPermissao || pedidoRecente}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 text-[15px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-60"
                style={{ background: pedidoRecente ? "#9CA3AF" : "#B45309" }}
                title={pedidoRecente
                  ? "Já mandamos o pedido nas últimas 24h — a Meta só deixa um por dia."
                  : "Manda a pergunta no WhatsApp do cliente. Exige conversa aberta (ele precisa ter escrito nas últimas 24h)."}
              >
                {pedindoPermissao ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Mandando o pedido…
                  </>
                ) : pedidoRecente ? (
                  "Pedido já enviado — aguardando o cliente"
                ) : (
                  "Pedir permissão pra ligar"
                )}
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-400 text-center">
            {liberado
              ? "A ligação toca no WhatsApp do cliente e sai pelo número oficial da empresa — o áudio é deste navegador."
              : "A Meta só permite ligar depois que o cliente autoriza. Ele responde no WhatsApp e o botão libera sozinho."}
          </p>
        </div>
      </div>
    </div>
  );
}
