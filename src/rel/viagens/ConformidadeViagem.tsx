// src/rel/viagens/ConformidadeViagem.tsx
// -----------------------------------------------------------------------------
// QUANTO DA VENDA BATE (15/10/2026). Bruno: "porcentagem de informações que
// batem — a IA analisa, só documentação, passagens e roteiro". O número vem da
// revisão da IA (api/rel-viagem-ia.js → ia_revisao.conformidade): cada item é
// uma conferência sim/não; aqui mostramos o total, as três áreas e o que falhou.
//
// Também aqui o espaço dos REQUISITOS DE ENTRADA (Sherpa) — a ligar quando a
// chave da API chegar.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { AREAS_CONFORMIDADE, carregarRevisao, revisarViagem, type AreaConformidade, type EstadoRevisao } from "../lib/viagemIa";
import { Aviso, Botao } from "../ui";

const corDoPct = (n: number) => (n >= 90 ? "var(--rel)" : n >= 60 ? "#D97706" : "#DC2626");

export default function ConformidadeViagem({ viagemId, versao, onRevisado }: { viagemId: string; versao: number; onRevisado: () => void }) {
  const [estado, setEstado] = useState<EstadoRevisao | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [verItens, setVerItens] = useState(false);

  useEffect(() => { carregarRevisao(viagemId).then(setEstado).catch(() => setEstado(null)); }, [viagemId, versao]);

  async function revisar() {
    setRodando(true); setErro(null);
    try { await revisarViagem(viagemId); onRevisado(); }
    catch (e) { setErro(e instanceof Error ? e.message : "A revisão falhou."); }
    finally { setRodando(false); }
  }

  const c = estado?.ia_revisao?.conformidade ?? null;
  const falhas = (c?.itens ?? []).filter((i) => !i.ok);
  return (
    <div className="rounded-xl p-3" style={{ border: "1px solid var(--line)", background: "var(--card2)" }} aria-busy={rodando}>
      <div className="flex items-center gap-3">
        <div className="text-center flex-shrink-0" style={{ minWidth: 72 }}>
          <div className="text-[30px] leading-none font-extrabold tabular-nums" style={{ color: c ? corDoPct(c.pct) : "var(--ink3)" }}>{c ? `${c.pct}%` : "—"}</div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wide mt-1" style={{ color: "var(--ink3)" }}>bate</div>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          {(Object.keys(AREAS_CONFORMIDADE) as AreaConformidade[]).map((a) => {
            const x = c?.areas?.[a];
            const pct = x && x.total ? Math.round((x.ok / x.total) * 100) : null;
            return (
              <div key={a}>
                <div className="flex justify-between text-[11.5px]" style={{ color: "var(--ink2)" }}>
                  <span>{AREAS_CONFORMIDADE[a]}</span>
                  <span className="tabular-nums">{x && x.total ? `${x.ok}/${x.total}` : "—"}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }} role="progressbar" aria-label={AREAS_CONFORMIDADE[a]} aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: pct === null ? "transparent" : corDoPct(pct) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        <Botao variante="secundario" disabled={rodando} onClick={() => void revisar()}>{rodando ? "IA revisando… (até 1 min)" : c ? "Revisar de novo com IA" : "Revisar com IA"}</Botao>
        {falhas.length > 0 && (
          <button className="text-[12px] font-semibold" style={{ color: "var(--err-ink)" }} aria-expanded={verItens} onClick={() => setVerItens((v) => !v)}>
            {verItens ? "Esconder" : "Ver"} {falhas.length} que não bate{falhas.length > 1 ? "m" : ""}
          </button>
        )}
        {!c && estado?.ia_revisao && <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Revisão antiga, sem porcentagem — revise de novo.</span>}
      </div>
      {verItens && (
        <ul className="mt-2 space-y-1">
          {falhas.map((i, k) => (
            <li key={k} className="text-[12.5px] flex gap-2" style={{ color: "var(--ink)" }}>
              <span style={{ color: "#DC2626" }} aria-hidden>✗</span>
              <span><b className="font-semibold" style={{ color: "var(--ink2)" }}>{AREAS_CONFORMIDADE[i.area]}:</b> {i.texto}</span>
            </li>
          ))}
        </ul>
      )}
      {erro && <div className="mt-2"><Aviso tom="erro">{erro}</Aviso></div>}
    </div>
  );
}

/** Requisitos de entrada do destino (visto, vacina, passaporte…) — virá da API do Sherpa. */
export function RequisitosEntrada({ destino }: { destino: string | null }) {
  return (
    <div className="text-[13px] space-y-1.5" style={{ color: "var(--ink2)" }}>
      <p>
        Aqui vão aparecer, para <b style={{ color: "var(--ink)" }}>{destino || "o destino"}</b> e a nacionalidade de cada passageiro: visto, validade mínima do passaporte,
        vacinas e formulários de entrada — puxados da API do <b>Sherpa</b>.
      </p>
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Aguardando a chave da API do Sherpa para ligar.</p>
    </div>
  );
}
