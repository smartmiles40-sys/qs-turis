// src/components/sdr/whatsapp/WhatsAppModal.tsx
// -----------------------------------------------------------------------------
// Modal de WhatsApp para um lead. O envio de mensagem é feito pelo ChatApp:
// ao clicar, abre o cabinet do ChatApp em nova aba (o token da API do ChatApp
// expira, então não dá pra enviar direto pelo servidor). A mensagem escrita é
// copiada para a área de transferência, para colar no ChatApp.
// Também oferece abrir a conversa no WhatsApp (wa.me) e ligar.
// Cada interação é registrada em qs_whatsapp_messages.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  openChatApp,
  waChatLink,
  startWhatsAppCall,
  normalizePhoneBR,
  formatPhoneDisplay,
  isDialablePhone,
  fillTemplate,
  logWhatsApp,
  WA_TEMPLATES,
} from "@/lib/whatsapp";

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
  /** Callback após abrir o ChatApp (ex.: registrar atividade/concluir tarefa). */
  onSent?: () => void;
}

const WA_GREEN = "#25D366";
const CHATAPP_BLUE = "#0147FF";

export default function WhatsAppModal({ open, onClose, lead, ownerId, defaultText, onSent }: Props) {
  const [text, setText] = useState(defaultText ?? "");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const phone = useMemo(() => normalizePhoneBR(lead.phone), [lead.phone]);
  const dialable = isDialablePhone(lead.phone);
  const firstName = (lead.name || "").split(/\s+/)[0] || "lead";

  useEffect(() => {
    if (open) {
      setText(defaultText ?? "");
      setResult(null);
    }
  }, [open, defaultText]);

  if (!open) return null;

  async function copyText(): Promise<boolean> {
    const t = text.trim();
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      return false;
    }
  }

  async function handleOpenChatApp() {
    const copied = await copyText();
    logWhatsApp({ leadId: lead.id ?? null, ownerId: ownerId ?? null, phone, body: text.trim() || null, status: "pending", kind: "message" });
    openChatApp();
    setResult({
      ok: true,
      msg: copied
        ? "ChatApp aberto em nova aba — a mensagem foi copiada, é só colar na conversa do lead."
        : "ChatApp aberto em nova aba. Abra a conversa do lead para enviar.",
    });
    onSent?.();
  }

  async function handleCopy() {
    const ok = await copyText();
    setResult(ok ? { ok: true, msg: "Mensagem copiada." } : { ok: false, msg: "Escreva a mensagem antes de copiar." });
  }

  function handleOpenChat() {
    if (!dialable) return;
    logWhatsApp({ leadId: lead.id ?? null, ownerId: ownerId ?? null, phone, body: text.trim() || null, status: "pending", kind: "message" });
    window.open(waChatLink(lead.phone, text.trim() || undefined), "_blank", "noopener,noreferrer");
  }

  function handleCall() {
    if (!dialable) return;
    logWhatsApp({ leadId: lead.id ?? null, ownerId: ownerId ?? null, phone, status: "pending", kind: "call", body: "Ligação iniciada via WhatsApp" });
    startWhatsAppCall(lead.phone);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
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
                onClick={() => setText(fillTemplate(t.text, lead))}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Mensagem */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-500">Mensagem (copie e cole no ChatApp)</label>
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
          </div>

          {result && (
            <div className={`text-xs rounded-lg px-3 py-2 ${result.ok ? "text-green-700 bg-green-50 border border-green-100" : "text-red-700 bg-red-50 border border-red-100"}`}>
              {result.msg}
            </div>
          )}

          {/* Ações */}
          <div className="space-y-2">
            <button
              onClick={handleOpenChatApp}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: CHATAPP_BLUE }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" />
              </svg>
              Enviar pelo ChatApp
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleOpenChat}
                disabled={!dialable}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                WhatsApp
              </button>
              <button
                onClick={handleCall}
                disabled={!dialable}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                Ligar
              </button>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 text-center">
            "Enviar pelo ChatApp" abre o ChatApp em nova aba com a mensagem copiada. "WhatsApp" abre a conversa direto no WhatsApp. "Ligar" abre a conversa para você iniciar a chamada.
          </p>
        </div>
      </div>
    </div>
  );
}
