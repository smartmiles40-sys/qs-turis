// src/rel/disparos/HistoricoRel.tsx
// -----------------------------------------------------------------------------
// HISTÓRICO DOS DISPAROS (0415, 23/11/2026) — igual ao do ManyChat (print do
// Bruno): Tipo · Nome · Início · Enviado · Entregue (%) · Lido (%) · Clicado (%).
// Entregue % sobre o enviado; Lido % e Clicado % sobre o entregue (conta do ManyChat).
// Clicar num disparo de fluxo (ou teste) abre o fluxo com os números DAQUELE envio.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Aviso, Botao, Etiqueta, Vazio } from "@/rel/ui";
import { historicoDisparos, type LinhaHistorico } from "./dadosFluxosRel";

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const pct = (n: number, de: number) => (de > 0 ? `${((n / de) * 100).toFixed(2).replace(".", ",")}%` : "0%");
const TIPO: Record<LinhaHistorico["tipo"], { t: string; tom: "rel" | "neutro" | "aviso" }> = {
  fluxo: { t: "Fluxo", tom: "rel" }, simples: { t: "Simples", tom: "neutro" }, teste: { t: "Teste", tom: "aviso" },
};
const STATUS: Record<string, string> = { agendado: "agendado", agendada: "agendado", rodando: "enviando", enviando: "enviando", pausada: "pausado", cancelado: "cancelado", cancelada: "cancelado" };

export default function HistoricoRel({ onAbrirFluxo }: { onAbrirFluxo: (fluxoId: string, filtro: string | null) => void }) {
  const [linhas, setLinhas] = useState<LinhaHistorico[] | null>(null);
  const [erro, setErro] = useState("");
  const [limite, setLimite] = useState(10);
  const ler = useCallback(() => {
    historicoDisparos(limite).then((x) => { setLinhas(x); setErro(""); }).catch((e) => setErro(e instanceof Error ? e.message : "Não carregou."));
  }, [limite]);
  useEffect(() => { ler(); const t = setInterval(ler, 30_000); return () => clearInterval(t); }, [ler]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (linhas === null) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (!linhas.length) return <Vazio titulo="Nenhum disparo ainda" texto="Quando você disparar um fluxo (ou testar), ele aparece aqui com enviadas, entregues, lidas e cliques." />;

  return (
    <div className="space-y-3">
      <h2 className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>Histórico</h2>
      <div className="rel-card overflow-x-auto p-0">
        <table className="w-full text-[13.5px]" style={{ color: "var(--ink)" }}>
          <thead>
            <tr className="text-left" style={{ borderBottom: "1px solid var(--line)" }}>
              {["Tipo", "Nome", "Início", "Enviado", "Entregue (%)", "Lido (%)", "Clicado (%)"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => {
              const abre = l.fluxo_id ? () => onAbrirFluxo(l.fluxo_id!, l.tipo === "teste" ? "testes" : l.id) : undefined;
              const st = STATUS[l.status];
              return (
                <tr key={`${l.tipo}-${l.id ?? i}`} onClick={abre} className={abre ? "cursor-pointer hover:bg-black/[0.03]" : ""}
                  style={{ borderBottom: i < linhas.length - 1 ? "1px solid var(--line)" : undefined }}
                  title={abre ? "Abrir o fluxo com os números deste envio" : undefined}>
                  <td className="px-4 py-4"><Etiqueta tom={TIPO[l.tipo].tom}>{TIPO[l.tipo].t}</Etiqueta></td>
                  <td className="px-4 py-4 max-w-[260px]">
                    <span className="block truncate">{l.nome}</span>
                    {st && <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{st}</span>}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">{quando(l.inicio)}</td>
                  <td className="px-4 py-4">{l.enviadas}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{l.entregues} <span style={{ color: "var(--ink3)" }}>({pct(l.entregues, l.enviadas)})</span></td>
                  <td className="px-4 py-4 whitespace-nowrap">{l.lidas} <span style={{ color: "var(--ink3)" }}>({pct(l.lidas, l.entregues)})</span></td>
                  <td className="px-4 py-4 whitespace-nowrap">{l.enviadas ? <>{l.clicaram} <span style={{ color: "var(--ink3)" }}>({pct(l.clicaram, l.entregues)})</span></> : "N/A"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {linhas.length >= limite && (
          <div className="flex justify-center p-3"><Botao onClick={() => setLimite((n) => n + 30)}>Ver mais</Botao></div>
        )}
      </div>
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        Entregue (%) é sobre o enviado; Lido e Clicado são sobre o entregue. Clicado = tocou num botão ou abriu um link do fluxo. Clique numa linha de fluxo pra ver os números em cada bloco.
      </p>
    </div>
  );
}
