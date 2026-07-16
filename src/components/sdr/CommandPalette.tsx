// src/components/sdr/CommandPalette.tsx
// -----------------------------------------------------------------------------
// Busca global (Ctrl+K / Cmd+K): de QUALQUER tela, digite nome, telefone,
// e-mail ou ID do cliente e abra o lead com Enter. A RLS já garante que o SDR
// só encontra os leads dele (gestor encontra todos).
// Montado uma vez no SdrLayout.
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { STATUS_LABELS } from "./types";
import type { LeadStatus } from "./types";

interface Hit {
  id: string;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  bitrix_id: string | null;
  status: LeadStatus;
}

const STATUS_DOT: Record<string, string> = {
  nao_iniciado: "#8B95A4",
  em_prospeccao: "#0147FF",
  ganho: "#12A18A",
  perdido: "#E5484D",
};

export default function CommandPalette({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const { currentUser } = useQsAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+K / Cmd+K abre; Esc fecha.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Foco no input ao abrir; limpa ao fechar.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery("");
      setHits([]);
      setSel(0);
    }
  }, [open]);

  // Busca com debounce. Telefone: compara só os dígitos.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSel(0); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const digits = q.replace(/\D/g, "");
      const ors = [
        `full_name.ilike.${like}`,
        `company_name.ilike.${like}`,
        `email.ilike.${like}`,
        `bitrix_id.ilike.${like}`,
      ];
      if (digits.length >= 4) ors.push(`phone.ilike.%${digits.slice(-8)}%`);
      let sq = supabase
        .from("qs_leads")
        .select("id, full_name, company_name, phone, email, bitrix_id, status")
        .or(ors.join(","));
      // Isolamento por dono: SDR/closer só acham o PRÓPRIO lead na busca global.
      // Backstop de tela — a garantia real é a RLS 0007/0008 no banco.
      if (currentUser && !canSeeAllData(currentUser.role)) {
        sq = sq.eq("owner_id", currentUser.id);
      }
      const { data } = await sq.order("updated_at", { ascending: false }).limit(8);
      setHits((data ?? []) as Hit[]);
      setSel(0);
      setSearching(false);
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, currentUser]);

  const pick = useCallback((h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    onOpenLead(h.id);
  }, [onOpenLead]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Busca global">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[560px] bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ border: "1px solid #E4E8EE" }}>
        {/* Input */}
        <div className="flex items-center gap-3 px-4 h-[54px] border-b" style={{ borderColor: "#F0F2F6" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B95A4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(hits[sel]); }
            }}
            placeholder="Buscar cliente por nome, telefone, e-mail ou ID…"
            className="flex-1 outline-none text-[15px] bg-transparent"
            style={{ color: "#17202E" }}
            aria-label="Buscar cliente"
          />
          <kbd className="text-[10.5px] font-bold px-1.5 py-0.5 rounded border" style={{ color: "#8B95A4", borderColor: "#E4E8EE" }}>ESC</kbd>
        </div>

        {/* Resultados */}
        <div className="max-h-[380px] overflow-y-auto py-1.5">
          {query.trim().length < 2 ? (
            <p className="px-4 py-6 text-center text-[13px]" style={{ color: "#8B95A4" }}>
              Digite pelo menos 2 caracteres. Dica: <b>Ctrl+K</b> abre esta busca de qualquer tela.
            </p>
          ) : searching && hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px]" style={{ color: "#8B95A4" }}>Buscando…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px]" style={{ color: "#8B95A4" }}>Nenhum cliente encontrado pra “{query.trim()}”.</p>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                onClick={() => pick(h)}
                onMouseEnter={() => setSel(i)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{ background: i === sel ? "#F0F4FF" : "transparent" }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_DOT[h.status] ?? "#8B95A4" }} title={STATUS_LABELS[h.status]} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-bold truncate" style={{ color: "#17202E" }}>{h.full_name || "Sem nome"}</span>
                  <span className="block text-[12px] truncate" style={{ color: "#8B95A4" }}>
                    {[h.company_name, h.phone ? formatPhoneDisplay(h.phone) : null, h.email].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                {h.bitrix_id && (
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums" style={{ background: "#F0F2F6", color: "#47536B" }}>
                    ID {h.bitrix_id}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
