// src/components/sdr/telefone/TelefoneOnboarding.tsx
// -----------------------------------------------------------------------------
// Onboarding do TELEFONE (BravoTech) do SDR. Aparece automaticamente quando o
// SDR abre o QS e ainda não configurou o softphone NESTA máquina — pra ele não
// ter que caçar instalador nem credenciais. Um navegador NÃO instala programa
// sozinho (trava de segurança), então isto é um passo a passo com download de
// 1 clique + o ramal do SDR já pronto pra copiar.
//
// "Configurado" é por MÁQUINA (localStorage), porque o softphone é instalado no
// PC — trocou de computador, o onboarding reaparece. O admin mapeia o ramal de
// cada SDR em Configurações → Telefone (SIP).
// -----------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from "react";
import { getSipInstallerUrl, getSipRamalForUser, type SipRamalInfo } from "@/lib/sip";

interface Props {
  user: { id: string; name: string } | null;
}

// "Configurado" é permanente por máquina (localStorage). "Adiado" ("Fazer
// depois") vale só até fechar a aba (sessionStorage) — reabre na próxima sessão.
function doneKey(userId: string): string {
  return `qs_tel_setup_done_${userId}`;
}
function snoozeKey(userId: string): string {
  return `qs_tel_setup_snoozed_${userId}`;
}

export default function TelefoneOnboarding({ user }: Props) {
  const [ramal, setRamal] = useState<SipRamalInfo | null>(null);
  const [installerUrl, setInstallerUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Depende do ID (string estável), não do objeto `user` — o SdrLayout recria
  // esse objeto a cada render, e depender dele reabria o modal em loop.
  const userId = user?.id ?? null;

  useEffect(() => {
    let alive = true;
    if (!userId) return;
    // Já configurou nesta máquina (permanente) ou adiou nesta sessão? Não incomoda.
    if (localStorage.getItem(doneKey(userId)) === "1") return;
    if (sessionStorage.getItem(snoozeKey(userId)) === "1") return;
    Promise.all([getSipRamalForUser(userId), getSipInstallerUrl()]).then(([r, url]) => {
      if (!alive) return;
      setRamal(r);
      setInstallerUrl(url);
      // Só abre se o admin já mapeou um ramal pra este SDR.
      if (r) setOpen(true);
    });
    return () => { alive = false; };
  }, [userId]);

  if (!open || !user || !ramal) return null;

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => { /* clipboard bloqueado — ignora */ });
  }

  // "Já configurei": marca a máquina como pronta pra sempre.
  function finish() {
    if (userId) localStorage.setItem(doneKey(userId), "1");
    setOpen(false);
  }

  // "Fazer depois"/fechar: silencia só nesta sessão (reabre depois).
  function snooze() {
    if (userId) sessionStorage.setItem(snoozeKey(userId), "1");
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={snooze} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Cabeçalho */}
        <div className="px-6 pt-6 pb-4 shrink-0" style={{ background: "linear-gradient(135deg,#0147FF,#3B82F6)" }}>
          <div className="flex items-center gap-3 text-white">
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight">Configure seu telefone</h2>
              <p className="text-[13px] text-white/80">Só na 1ª vez neste computador — leva 2 minutos.</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Ramal do SDR */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Seu ramal</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-gray-900 font-mono">{ramal.ramal}</span>
              <button onClick={() => copy(ramal.ramal, "ramal")} className="text-[11px] px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-white">
                {copied === "ramal" ? "Copiado ✓" : "Copiar"}
              </button>
            </div>
            {ramal.login && (
              <div className="flex items-center gap-2 mt-2 text-[13px] text-gray-600">
                <span className="font-mono truncate">{ramal.login}</span>
                <button onClick={() => copy(ramal.login as string, "login")} className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-white">
                  {copied === "login" ? "Copiado ✓" : "Copiar"}
                </button>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">A senha do ramal está com o gestor — cole no softphone quando ele pedir.</p>
          </div>

          {/* Passos */}
          <ol className="space-y-3">
            <Step n={1} title="Baixe o telefone (BravoTech)">
              {installerUrl ? (
                <a href={installerUrl} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-2 mt-1 px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "#0147FF" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  Baixar instalador
                </a>
              ) : (
                <p className="text-[12px] text-amber-600 mt-1">O link do instalador ainda não foi configurado — peça ao gestor.</p>
              )}
            </Step>
            <Step n={2} title="Instale e abra o programa">
              Rode o arquivo baixado (o Windows vai pedir permissão — pode confirmar) e abra o BravoTech.
            </Step>
            <Step n={3} title="Entre com o seu ramal">
              No softphone, use o ramal <b className="font-mono">{ramal.ramal}</b> e a senha do gestor. Se perguntar, marque para tornar padrão.
            </Step>
            <Step n={4} title="Pronto — é só ligar">
              Volte ao QS e clique em <b>Ligar</b> em qualquer lead. A chamada toca no seu telefone.
            </Step>
          </ol>
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
          <button onClick={snooze} className="text-[13px] text-gray-500 hover:text-gray-700">Fazer depois</button>
          <button onClick={finish} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: "#16A34A" }}>
            Já configurei ✓
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-blue-50 text-blue-700 text-[12px] font-bold">{n}</span>
      <div className="text-[13px] text-gray-600">
        <p className="font-semibold text-gray-900">{title}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </li>
  );
}
