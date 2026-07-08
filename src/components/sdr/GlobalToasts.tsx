// src/components/sdr/GlobalToasts.tsx
// Desenha os toasts globais (notifyError/notifySuccess de @/lib/qs/notify).
// Montado UMA vez no SdrLayout — canto inferior direito, some sozinho em 5s.

import { useEffect, useState } from "react";
import { subscribeToasts, type AppToast } from "@/lib/qs/notify";

const LIFETIME_MS = 5000;

export default function GlobalToasts() {
  const [toasts, setToasts] = useState<AppToast[]>([]);

  useEffect(() => {
    return subscribeToasts((t) => {
      setToasts((prev) => [...prev.slice(-3), t]); // no máximo 4 na tela
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, LIFETIME_MS);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[90] bottom-5 right-5 flex flex-col gap-2 items-end pointer-events-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-2.5 pl-3.5 pr-4 py-3 rounded-xl shadow-lg text-[13.5px] font-semibold max-w-[360px]"
          style={{
            background: t.kind === "error" ? "#C4373D" : "#17202E",
            color: "#fff",
            animation: "qsToastIn .22s ease-out",
          }}
        >
          {t.kind === "error" ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <span className="leading-snug">{t.text}</span>
        </div>
      ))}
      <style>{`@keyframes qsToastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
