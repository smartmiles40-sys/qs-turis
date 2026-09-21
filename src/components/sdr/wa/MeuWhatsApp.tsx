// src/components/sdr/wa/MeuWhatsApp.tsx
// -----------------------------------------------------------------------------
// "MEU WHATSAPP" — cada SDR conecta o chip dele no QS lendo o QR (0082).
//
// Fica na aba WhatsApp (e não em Configurações) de propósito: Configurações só
// abre pro admin, e quem precisa conectar é o SDR. O botão no topo mostra o
// estado com uma bolinha — verde no ar, âmbar esperando o QR, vermelha caído —
// porque número caído descoberto na hora de responder o cliente é tarde demais.
//
// Gestão e closer veem, embaixo, o WhatsApp de cada pessoa do time.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { confirmar } from "@/lib/qs/confirmar";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  acaoDaLinha, formatarNumero, linhasDoTime, marcarMinhaLinha, recarregarMinhaLinha, useMinhaLinha,
  type LinhaDoTime,
} from "@/lib/qs/waLinha";

const COR_DO_ESTADO: Record<string, string> = {
  open: "var(--wa-bright)",
  connecting: "var(--orange)",
  close: "var(--wa-err-ink)",
};

function rotuloDoEstado(status: string | undefined | null): string {
  if (status === "open") return "conectado";
  if (status === "connecting") return "esperando o QR";
  if (status === "close") return "desconectado";
  return "não conectado";
}

function quando(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ── O botão do topo da aba WhatsApp ─────────────────────────────────────────

export function BotaoMeuWhatsApp({ onAbrir }: { onAbrir: () => void }) {
  const { linha, carregado } = useMinhaLinha();
  if (!carregado) return null;
  const cor = linha ? (COR_DO_ESTADO[linha.status] ?? "var(--ink3)") : "var(--ink3)";
  return (
    <button onClick={onAbrir}
            title={`Meu WhatsApp: ${rotuloDoEstado(linha?.status)}`}
            className="shrink-0 flex items-center gap-2 px-3 h-9 rounded-lg text-[13px] font-semibold"
            style={{ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" }}>
      <span className={`w-2.5 h-2.5 rounded-full ${linha?.status === "connecting" ? "animate-pulse" : ""}`}
            style={{ background: cor }} aria-hidden />
      <span className="hidden sm:inline">Meu WhatsApp</span>
      {!linha && <span className="sm:hidden">Conectar</span>}
    </button>
  );
}

// ── O painel ────────────────────────────────────────────────────────────────

export default function MeuWhatsApp({ onFechar }: { onFechar: () => void }) {
  const { currentUser } = useQsAuth();
  const { linha } = useMinhaLinha();
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "conectar" | "desconectar" | "historico">(null);
  const [segundos, setSegundos] = useState(0);
  const [progresso, setProgresso] = useState<{ feitas: number; total: number; importadas: number } | null>(null);
  const [time, setTime] = useState<LinhaDoTime[]>([]);
  const vivo = useRef(true);
  const verTime = currentUser?.role === "admin" || currentUser?.role === "gestor" || currentUser?.role === "closer";

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  useEffect(() => {
    if (verTime) void linhasDoTime().then((l) => { if (vivo.current) setTime(l); });
  }, [verTime, linha?.status]);

  const conectar = useCallback(async () => {
    setOcupado("conectar");
    setErro(null);
    setQr(null);
    setPairing(null);
    const r = await acaoDaLinha("conectar");
    if (!vivo.current) return;
    setOcupado(null);
    if (!r.ok) { setErro(r.error || "Não consegui gerar o QR."); return; }
    await recarregarMinhaLinha();
    if (r.jaConectada) { notifySuccess("Seu WhatsApp já está conectado ao QS."); return; }
    setQr(r.base64 ?? null);
    setPairing(r.pairingCode ?? null);
    setSegundos(0);
  }, []);

  // Enquanto o QR está na tela: conta os segundos (o código vence em ~40s) e,
  // de 3 em 3, pergunta se já pareou. O WhatsApp não avisa ninguém — quem
  // escaneia vê "OK" no celular e ficaria olhando pra uma tela parada.
  useEffect(() => {
    if (!qr) return;
    let n = 0;
    const t = window.setInterval(async () => {
      n += 1;
      setSegundos(n);
      if (n % 3 !== 0) return;
      const r = await acaoDaLinha("estado");
      if (!vivo.current || !r.ok || r.estado !== "open") return;
      setQr(null);
      setPairing(null);
      marcarMinhaLinha({ status: "open", numero: r.numero ?? null });
      await recarregarMinhaLinha();
      notifySuccess("WhatsApp conectado! As mensagens agora saem pelo QS.");
    }, 1000);
    return () => window.clearInterval(t);
  }, [qr]);

  const desconectar = useCallback(async () => {
    const ok = await confirmar({
      titulo: "Desconectar seu WhatsApp do QS?",
      mensagem: "As mensagens deixam de sair e de chegar por aqui até você ler o QR de novo. O histórico continua no QS.",
      confirmarLabel: "Desconectar",
      recusarLabel: "Cancelar",
      perigo: true,
    });
    if (!ok) return;
    setOcupado("desconectar");
    const r = await acaoDaLinha("desconectar");
    setOcupado(null);
    if (!r.ok) { notifyError(r.error || "Não consegui desconectar."); return; }
    await recarregarMinhaLinha();
  }, []);

  // A importação roda em fatias (a Vercel corta cada chamada em 60s): chama de
  // novo com o cursor até o servidor dizer que terminou.
  const importar = useCallback(async () => {
    setOcupado("historico");
    let cursor = 0;
    let importadas = 0;
    let leads = 0;
    let semLead = 0;
    for (let volta = 0; volta < 60; volta++) {
      const r = await acaoDaLinha("historico", { cursor });
      if (!vivo.current) return;
      if (!r.ok) { notifyError(r.error || "A importação parou no meio. Pode tentar de novo — nada duplica."); break; }
      importadas += r.importadas ?? 0;
      leads += r.leads ?? 0;
      semLead += r.resumo?.semLead ?? 0;
      cursor = r.cursor ?? cursor;
      setProgresso({ feitas: cursor, total: r.total ?? 0, importadas });
      if (r.fim) {
        // O WhatsApp manda o histórico aos poucos nos primeiros minutos depois
        // do QR — importar cedo demais acha quase nada e parecia "pronto".
        if (r.aindaSincronizando) {
          notifyError("O WhatsApp ainda está mandando o histórico pro QS. Espere uns 5 minutos e clique de novo em \"Importar conversas antigas\".");
        } else {
          notifySuccess(importadas
            ? `${importadas} mensagens de ${leads} leads trazidas pro QS.${semLead ? ` (${semLead} conversas com quem não é lead ficaram só no celular.)` : ""}`
            : `Histórico conferido — nada novo pra trazer (${r.total ?? 0} conversas no celular, ${semLead} com quem não é lead).`);
        }
        break;
      }
    }
    setOcupado(null);
    await recarregarMinhaLinha();
  }, []);

  const noAr = linha?.status === "open";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onFechar}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-5 shadow-xl"
           style={{ background: "var(--card)", color: "var(--ink)" }}
           onClick={(e) => e.stopPropagation()}
           role="dialog" aria-label="Meu WhatsApp">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold">Meu WhatsApp</h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>
              O número da empresa que está com você. Conectado aqui, suas conversas saem e chegam pelo QS.
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar"
                  className="wa-icon-btn w-8 h-8 grid place-items-center rounded-lg shrink-0 text-[18px]">×</button>
        </div>

        {/* Estado */}
        <div className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5"
             style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
          <span className="w-3 h-3 rounded-full shrink-0"
                style={{ background: linha ? (COR_DO_ESTADO[linha.status] ?? "var(--ink3)") : "var(--ink3)" }} aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold">
              {noAr && linha?.numero ? formatarNumero(linha.numero) : rotuloDoEstado(linha?.status)}
            </p>
            {noAr && linha?.conectado_em && (
              <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>conectado desde {quando(linha.conectado_em)}</p>
            )}
            {linha && !noAr && linha.status_em && (
              <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>desde {quando(linha.status_em)}</p>
            )}
          </div>
        </div>

        {/* QR */}
        {!noAr && (
          <div className="mt-4">
            {!qr && (
              <>
                <ol className="text-[12.5px] leading-relaxed list-decimal pl-5" style={{ color: "var(--ink2)" }}>
                  <li>Pegue o celular com o <b>chip da empresa</b>.</li>
                  <li>WhatsApp → Configurações → <b>Aparelhos conectados</b> → Conectar um aparelho.</li>
                  <li>Aponte a câmera pro código que vai aparecer aqui.</li>
                </ol>
                <p className="text-[11.5px] mt-2" style={{ color: "var(--ink3)" }}>
                  O celular e o WhatsApp Web continuam funcionando — o QS entra como mais um aparelho conectado.
                </p>
                <button onClick={() => void conectar()} disabled={ocupado === "conectar"}
                        className="mt-3 w-full h-10 rounded-xl text-[13px] font-bold text-white disabled:opacity-60"
                        style={{ background: "var(--wa)" }}>
                  {ocupado === "conectar" ? "gerando o código…" : linha ? "Reconectar (gerar QR)" : "Conectar meu WhatsApp"}
                </button>
              </>
            )}
            {qr && (
              <div className="flex flex-col items-center">
                {/* O QR fica em fundo branco mesmo no modo noturno: câmera não lê QR invertido. */}
                <div className="rounded-xl p-2" style={{ background: "#fff" }}>
                  <img src={qr} alt="Código QR para conectar o WhatsApp" className="w-56 h-56" />
                </div>
                {pairing && (
                  <p className="text-[12px] mt-2" style={{ color: "var(--ink2)" }}>
                    Ou digite o código: <b className="tracking-widest">{pairing}</b>
                  </p>
                )}
                <p className="text-[11.5px] mt-2 text-center" style={{ color: "var(--ink3)" }}>
                  {segundos < 40
                    ? "Esperando você escanear… esta tela muda sozinha quando conectar."
                    : "Este código venceu — gere outro."}
                </p>
                <button onClick={() => void conectar()} disabled={ocupado === "conectar"}
                        className="mt-2 px-3 h-8 rounded-lg text-[12px] font-semibold disabled:opacity-60"
                        style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
                  gerar outro código
                </button>
              </div>
            )}
            {erro && (
              <p className="mt-3 text-[12.5px] rounded-lg px-3 py-2"
                 style={{ background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }}>{erro}</p>
            )}
          </div>
        )}

        {/* No ar: histórico e desconectar */}
        {noAr && (
          <div className="mt-4 grid gap-3">
            <div className="rounded-xl px-3 py-3" style={{ border: "1px solid var(--line)" }}>
              <p className="text-[13px] font-semibold">Conversas antigas</p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>
                Traz pro QS o que você conversou com <b>leads</b> pelo celular/WhatsApp Web nos últimos 45 dias.
                Conversa com quem não é lead fica só no celular. Pode rodar de novo quando quiser — nada duplica.
              </p>
              {linha?.historico_em && !progresso && (
                <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>última importação: {quando(linha.historico_em)}</p>
              )}
              {progresso && (
                <div className="mt-2">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card2)" }}>
                    <div className="h-full rounded-full transition-all"
                         style={{ width: `${progresso.total ? Math.round((progresso.feitas / progresso.total) * 100) : 0}%`, background: "var(--wa-bright)" }} />
                  </div>
                  <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>
                    {progresso.feitas} de {progresso.total} conversas · {progresso.importadas} mensagens trazidas
                  </p>
                </div>
              )}
              <button onClick={() => void importar()} disabled={ocupado != null}
                      className="mt-2 px-3 h-9 rounded-lg text-[12.5px] font-bold text-white disabled:opacity-60"
                      style={{ background: "var(--wa)" }}>
                {ocupado === "historico" ? "importando…" : "Importar conversas antigas"}
              </button>
            </div>
            <button onClick={() => void desconectar()} disabled={ocupado != null}
                    className="justify-self-start text-[12px] font-semibold underline underline-offset-2 disabled:opacity-60"
                    style={{ color: "var(--wa-err-ink)" }}>
              {ocupado === "desconectar" ? "desconectando…" : "Desconectar (trocar de chip ou aparelho)"}
            </button>
          </div>
        )}

        {/* O time — gestão e closer */}
        {verTime && (
          <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
            <p className="text-[13px] font-semibold">WhatsApp do time</p>
            {time.length === 0 ? (
              <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>Ninguém conectou ainda.</p>
            ) : (
              <ul className="mt-2 grid gap-1.5">
                {time.map((l) => (
                  <li key={l.user_id} className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COR_DO_ESTADO[l.status] ?? "var(--ink3)" }} aria-hidden />
                    <span className="flex-1 min-w-0 truncate">{l.usuario?.name ?? "—"}</span>
                    <span className="shrink-0 tabular-nums" style={{ color: "var(--ink3)" }}>
                      {l.status === "open" && l.numero ? formatarNumero(l.numero) : rotuloDoEstado(l.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
