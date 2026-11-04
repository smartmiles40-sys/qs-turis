// src/mkt/trafego/CampanhasAba.tsx — o que está na Meta (0265).
// Status, orçamento diário que está valendo, gasto no período e o destino que o
// QS leu do nome — com correção à mão quando o nome não diz (ex.: "[sem vídeo]").
import { useState } from "react";
import { notifyError } from "@/lib/qs/notify";
import { useTrafego } from "./MetaAdsPage";
import { definirDestino } from "./api";
import { brl, num, StatusMeta, Tabela, TD, TH } from "./ui";

export default function CampanhasAba() {
  const { painel, recarregar } = useTrafego();
  const [so, setSo] = useState<"ativas" | "todas">("ativas");
  const [salvando, setSalvando] = useState<string | null>(null);
  if (!painel || painel.faltaBanco) return null;
  const pode = !!painel.podeEditar;
  const lista = (painel.campanhas ?? []).filter((c) => so === "todas" || c.effective_status === "ACTIVE" || c.gasto > 0);
  const destinos = painel.destinos ?? [];

  async function trocar(id: string, destino: string) {
    setSalvando(id);
    try { await definirDestino(id, destino); await recarregar(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          Orçamento diário ativo somado: <b style={{ color: "var(--ink)" }}>{brl(painel.orcamento?.diario ?? 0)}/dia</b>
          {painel.orcamento?.vitalicias ? ` · ${painel.orcamento.vitalicias} com orçamento vitalício` : ""}
        </p>
        <select className="rel-input max-w-[260px]" value={so} onChange={(e) => setSo(e.target.value as "ativas" | "todas")} aria-label="Mostrar">
          <option value="ativas">No ar ou com gasto no período</option>
          <option value="todas">Todas (inclui pausadas sem gasto)</option>
        </select>
      </div>
      {lista.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma campanha lida ainda.</p> : (
        <Tabela>
          <thead style={{ color: "var(--ink3)" }}><tr>
            <th className={TH}>Status</th><th className={TH}>Campanha</th><th className={TH}>Destino</th><th className={TH}>Orç. diário</th>
            <th className={TH}>Gasto período</th><th className={TH}>Hoje</th><th className={TH}>Leads Meta</th>
          </tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className={TD}><StatusMeta s={c.effective_status} />{c.liberada_ate && Date.parse(c.liberada_ate) > Date.now() ? <span className="ml-1 text-[11px]" style={{ color: "var(--ink3)" }} title="Reativada pelo QS: as travas só avisam até o fim do dia">liberada</span> : null}</td>
                <td className={`${TD} max-w-[380px] truncate`} title={c.nome} style={{ color: "var(--ink)" }}>{c.nome}{c.tipo === "live" ? <span className="ml-1 text-[11px]" style={{ color: "var(--ink3)" }}>live</span> : null}</td>
                <td className={TD}>
                  {pode ? (
                    <select className="rel-input !py-1 text-[12.5px]" value={c.destino_manual ?? ""} disabled={salvando === c.id}
                      onChange={(e) => void trocar(c.id, e.target.value)} aria-label={`Destino de ${c.nome}`}
                      style={!c.destino ? { borderColor: "var(--warn-line)" } : undefined}>
                      <option value="">{c.destino_auto ? `Pelo nome: ${destinos.find((d) => d.chave === c.destino_auto)?.rotulo ?? c.destino_auto}` : "Pelo nome: sem destino"}</option>
                      <option value="*">Vários destinos (rateio pelos leads)</option>
                      {destinos.map((d) => <option key={d.chave} value={d.chave}>{d.rotulo}</option>)}
                    </select>
                  ) : c.destinoRotulo}
                </td>
                <td className={TD}>{c.orcamentoDiario ? brl(c.orcamentoDiario) : c.lifetime_budget ? `vitalício ${brl(c.lifetime_budget)}` : "—"}</td>
                <td className={TD}>{brl(c.gasto)}</td><td className={TD}>{brl(c.gastoHoje)}</td><td className={TD}>{num(c.leadsMeta)}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </div>
  );
}
