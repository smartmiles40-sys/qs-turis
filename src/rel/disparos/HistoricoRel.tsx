// src/rel/disparos/HistoricoRel.tsx
// -----------------------------------------------------------------------------
// HISTÓRICO DOS DISPAROS (0415, 23/11/2026) — cópia do Histórico do ManyChat
// (print do Bruno): ⋮ · Tipo (bolinha do WhatsApp) · Nome · Início · Enviado ·
// Entregue (%) · Lido (%) · Clicado (%) · "Veja todas as N mensagens".
// Entregue % sobre o enviado; Lido % e Clicado % sobre o entregue (conta do ManyChat).
// Abrir (⋮ ou clique na linha) leva ao fluxo com os números DAQUELE envio.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Aviso, Vazio } from "@/rel/ui";
import IconeWhatsApp from "@/components/ui/IconeWhatsApp";
import { historicoDisparos, type LinhaHistorico } from "./dadosFluxosRel";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/** "17 Nov 2026, 20:04 (UTC -03:00)" — o formato do ManyChat. */
function quando(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const off = -d.getTimezoneOffset();
  const fuso = `UTC ${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} (${fuso})`;
}
const pct = (n: number, de: number) => `${de > 0 ? ((n / de) * 100).toFixed(2) : "0"}%`;
const STATUS: Record<string, string> = { agendado: "Agendado", agendada: "Agendado", rodando: "Enviando…", enviando: "Enviando…", pausada: "Pausado", cancelado: "Cancelado", cancelada: "Cancelado" };

const CINZA = "#8A8F98";

export default function HistoricoRel({ onAbrirFluxo }: { onAbrirFluxo: (fluxoId: string, filtro: string | null) => void }) {
  const [linhas, setLinhas] = useState<LinhaHistorico[] | null>(null);
  const [erro, setErro] = useState("");
  const [limite, setLimite] = useState(5);
  const [menu, setMenu] = useState<number | null>(null);
  const ler = useCallback(() => {
    historicoDisparos(limite).then((x) => { setLinhas(x); setErro(""); }).catch((e) => setErro(e instanceof Error ? e.message : "Não carregou."));
  }, [limite]);
  useEffect(() => { ler(); const t = setInterval(ler, 30_000); return () => clearInterval(t); }, [ler]);
  useEffect(() => {
    if (menu === null) return;
    const fechar = () => setMenu(null);
    window.addEventListener("click", fechar);
    return () => window.removeEventListener("click", fechar);
  }, [menu]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (linhas === null) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (!linhas.length) return <Vazio titulo="Nenhum disparo ainda" texto="Quando você disparar um fluxo (ou testar), ele aparece aqui com enviadas, entregues, lidas e cliques." />;
  const total = linhas[0]?.total ?? linhas.length;
  const abrir = (l: LinhaHistorico) => (l.fluxo_id ? () => onAbrirFluxo(l.fluxo_id!, l.tipo === "teste" ? "testes" : l.id) : undefined);

  return (
    <div className="space-y-3" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <h2 className="text-[18px] font-medium" style={{ color: "var(--ink)" }}>Histórico</h2>
      <div className="overflow-x-auto rounded-xl" style={{ background: "var(--card)", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <table className="w-full text-[15px]" style={{ color: "var(--ink)" }}>
          <thead>
            <tr className="text-left" style={{ borderBottom: "1px solid var(--line)" }}>
              <th className="w-14" />
              {["Tipo", "Nome", "Início", "Enviado", "Entregue (%)", "Lido (%)", "Clicado (%)"].map((h) => (
                <th key={h} className="px-4 py-4 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => {
              const ab = abrir(l);
              const sub = l.tipo === "teste" ? "Teste" : STATUS[l.status] ?? (l.tipo === "simples" ? "Disparo simples" : null);
              return (
                <tr key={`${l.tipo}-${l.id ?? i}`} onClick={ab} className={ab ? "cursor-pointer" : ""}
                  style={{ borderBottom: i < linhas.length - 1 ? "1px solid var(--line)" : undefined, height: 88 }}>
                  <td className="relative pl-6" onClick={(e) => e.stopPropagation()}>
                    <button type="button" aria-label="Opções" className="rounded px-1.5 py-1 text-[18px] leading-none" style={{ color: "var(--ink2)" }}
                      onClick={(e) => { e.stopPropagation(); setMenu(menu === i ? null : i); }}>⋮</button>
                    {menu === i && (
                      <div className="absolute left-10 top-12 z-20 min-w-[190px] rounded-lg py-1 text-[14px] shadow-lg" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
                        {ab
                          ? <button type="button" className="block w-full px-3 py-2 text-left hover:bg-black/5" onClick={() => { setMenu(null); ab(); }}>Ver no fluxo</button>
                          : <span className="block px-3 py-2" style={{ color: "var(--ink3)" }}>Disparo simples (sem fluxo)</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4"><IconeWhatsApp tamanho={30} /></td>
                  <td className="px-4 max-w-[280px]">
                    <span className="block truncate">{l.nome}</span>
                    {sub && <span className="block text-[12px]" style={{ color: CINZA }}>{sub}</span>}
                  </td>
                  <td className="px-4 whitespace-nowrap">{quando(l.inicio)}</td>
                  <td className="px-4">{l.enviadas}</td>
                  <td className="px-4 whitespace-nowrap">{l.entregues} <span style={{ color: CINZA }}>({pct(l.entregues, l.enviadas)})</span></td>
                  <td className="px-4 whitespace-nowrap">{l.lidas} <span style={{ color: CINZA }}>({pct(l.lidas, l.entregues)})</span></td>
                  <td className="px-4 whitespace-nowrap">{l.enviadas ? <>{l.clicaram} <span style={{ color: CINZA }}>({pct(l.clicaram, l.entregues)})</span></> : "N/A"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {total > linhas.length && (
          <div className="flex justify-center pb-5 pt-2">
            <button type="button" className="rounded-md px-4 py-2 text-[15px]" style={{ border: "1px solid var(--line)", color: "var(--ink)", background: "var(--card)" }}
              onClick={() => setLimite(Math.min(total, 200))}>Veja todas as {total} mensagens</button>
          </div>
        )}
      </div>
    </div>
  );
}
