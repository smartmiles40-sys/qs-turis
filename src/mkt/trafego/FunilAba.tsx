// src/mkt/trafego/FunilAba.tsx — o funil do tráfego pago (0265).
// Gasto (Meta) × o que aconteceu no QS com os leads que ENTRARAM no período
// (safra): agendou, fez reunião, comprou. Por destino+canal (pelo nome da
// campanha × a Fonte do lead) e por campanha (pelo utm_campaign, quando vier).
import { Aviso } from "@/rel/ui";
import { useTrafego } from "./MetaAdsPage";
import type { LinhaFunil } from "./tipos";
import { brl, custo, dataBr, num, pct, Tabela, TD, TH } from "./ui";

function Colunas() {
  return (<>
    <th className={TH}>Gasto</th><th className={TH}>Leads</th><th className={TH}>CPL</th>
    <th className={TH}>Agend.</th><th className={TH}>Custo/agend.</th>
    <th className={TH}>Reuniões</th><th className={TH}>Custo/reunião</th>
    <th className={TH}>Vendas</th><th className={TH}>CAC</th><th className={TH}>Faturamento</th><th className={TH}>ROAS</th>
  </>);
}
function Celulas({ l }: { l: LinhaFunil }) {
  return (<>
    <td className={TD}>{brl(l.gasto)}</td><td className={TD}>{num(l.leads)}</td><td className={TD}>{custo(l.cpl, l.gasto)}</td>
    <td className={TD}>{num(l.agendamentos)}</td><td className={TD}>{custo(l.custoAgendamento, l.gasto)}</td>
    <td className={TD}>{num(l.realizadas)}</td><td className={TD}>{custo(l.custoReuniao, l.gasto)}</td>
    <td className={TD}>{num(l.vendas)}</td><td className={TD}>{custo(l.cac, l.gasto)}</td><td className={TD}>{brl(l.faturamento)}</td>
    <td className={TD}>{l.roas == null ? "—" : `${l.roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`}</td>
  </>);
}

export default function FunilAba() {
  const { painel } = useTrafego();
  const f = painel?.funil;
  if (!painel || painel.faltaBanco) return null;
  if (!f) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Sem dados ainda.</p>;
  const p = painel.periodo;
  const s = f.semCasar;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
        {p ? <>Leads que entraram de {dataBr(p.inicio)} a {dataBr(p.fim)} e o gasto da Meta no mesmo período.</> : "Últimos 7 dias (sem período de verba cadastrado)."}
        {" "}Só leads com Fonte "<b>[Destino] - Tráfego</b>" ou "<b>[Destino] - Live</b>" (Orgânico e Google Ads ficam de fora).
      </p>

      {s.pctGastoCasado != null && s.pctGastoCasado < 90 && (
        <Aviso tom="aviso">
          Só <b>{pct(s.pctGastoCasado)}</b> do gasto tem destino no nome da campanha. {brl(s.gastoSemDestino)} ficaram sem destino
          {s.campanhasSemDestino[0] ? <> (a maior: "{s.campanhasSemDestino[0].nome}")</> : null} — dá pra marcar o destino dessas à mão na aba Campanhas
          (inclusive "vários destinos", que rateia pelos leads).
        </Aviso>
      )}

      <section>
        <h2 className="mb-2 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>Por destino</h2>
        <Tabela>
          <thead style={{ color: "var(--ink3)" }}><tr><th className={TH}>Destino · canal</th><Colunas /></tr></thead>
          <tbody>
            {f.porDestino.map((g) => (
              <tr key={g.chave} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className={`${TD} font-medium`} style={{ color: "var(--ink)" }}>
                  {g.rotulo}
                  {g.gastoRateado > 0 && <span className="ml-1 text-[11px]" title="Parte do gasto veio de campanha de vários destinos, rateada pelos leads" style={{ color: "var(--ink3)" }}>({brl(g.gastoRateado)} rateado)</span>}
                </td>
                <Celulas l={g} />
              </tr>
            ))}
            <tr className="border-t font-semibold" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
              <td className={TD}>Total (todo o gasto)</td><Celulas l={f.total} />
            </tr>
          </tbody>
        </Tabela>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rel-card px-4 py-3">
          <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Gasto sem destino ({brl(s.gastoSemDestino)})</p>
          {s.campanhasSemDestino.length === 0 ? <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink3)" }}>Todo gasto casou com um destino.</p> : (
            <ul className="mt-1 space-y-0.5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
              {s.campanhasSemDestino.slice(0, 12).map((c) => <li key={c.id} className="flex justify-between gap-3"><span className="truncate">{c.nome}</span><span className="tabular-nums">{brl(c.gasto)}</span></li>)}
            </ul>
          )}
        </div>
        <div className="rel-card px-4 py-3">
          <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Leads pagos sem campanha que case</p>
          {s.leadsSemCampanha.length === 0 ? <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink3)" }}>Todos os leads pagos acharam campanha.</p> : (
            <ul className="mt-1 space-y-0.5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
              {s.leadsSemCampanha.slice(0, 12).map((l) => <li key={l.rotulo} className="flex justify-between gap-3"><span className="truncate">{l.rotulo}</span><span className="tabular-nums">{num(l.leads)}</span></li>)}
            </ul>
          )}
          <p className="mt-2 text-[12px]" style={{ color: "var(--ink3)" }}>{num(s.leadsComUtm)} de {num(s.leadsPagos)} leads pagos trouxeram utm_campaign.</p>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>Por campanha</h2>
        <p className="mb-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Leads, CPL da Meta = o que o pixel/formulário contou. As colunas do QS só aparecem quando o lead chegou com utm_campaign (até lá, use a visão por destino).
        </p>
        <Tabela>
          <thead style={{ color: "var(--ink3)" }}><tr>
            <th className={TH}>Campanha</th><th className={TH}>Destino</th><th className={TH}>Gasto</th><th className={TH}>Leads Meta</th><th className={TH}>CPL Meta</th>
            <th className={TH}>Leads QS</th><th className={TH}>Custo/agend.</th><th className={TH}>Custo/reunião</th><th className={TH}>CAC</th>
          </tr></thead>
          <tbody>
            {f.porCampanha.map((c) => (
              <tr key={c.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className={`${TD} max-w-[360px] truncate`} title={c.nome} style={{ color: "var(--ink)" }}>{c.nome}</td>
                <td className={TD}>{c.destinoRotulo}{c.tipo === "live" ? " · Live" : ""}</td>
                <td className={TD}>{brl(c.gasto)}</td><td className={TD}>{num(c.leadsMeta)}</td><td className={TD}>{custo(c.cplMeta, c.gasto)}</td>
                {c.qs ? (<>
                  <td className={TD}>{num(c.qs.leads)}</td><td className={TD}>{custo(c.qs.custoAgendamento, c.gasto)}</td>
                  <td className={TD}>{custo(c.qs.custoReuniao, c.gasto)}</td><td className={TD}>{custo(c.qs.cac, c.gasto)}</td>
                </>) : <td className={TD} colSpan={4} style={{ color: "var(--ink3)" }}>sem UTM</td>}
              </tr>
            ))}
          </tbody>
        </Tabela>
      </section>

      <details className="rel-card px-4 py-3 text-[12.5px]" style={{ color: "var(--ink2)" }}>
        <summary className="cursor-pointer font-semibold">Como os números são contados</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Safra</b>: o lead que entrou no período leva junto tudo que aconteceu com ele depois (mesmo que a reunião ou a venda seja no mês seguinte).</li>
          <li><b>Agendamento</b>: lead com pelo menos uma reunião marcada (a remarcada não conta duas vezes).</li>
          <li><b>Reunião realizada</b>: reunião com status "realizada".</li>
          <li><b>Venda</b>: cartão do closer com pré-venda ou ficha de fechamento, tirando Passagens aéreas e venda cancelada — a mesma conta do Desempenho do closer. O valor “em negociação” que o closer informa no desfecho da reunião <b>não</b> é venda. <b>Faturamento</b> = soma das vendas (ficha → pré-venda → previsto). <b>CAC</b> = gasto ÷ vendas. <b>ROAS</b> = faturamento ÷ gasto.</li>
          <li><b>Destino</b>: o "[Destino]" da Fonte do lead casa com o destino que aparece no nome da campanha (sem emoji/acento/caixa). Campanha de LIVE/INSCRIÇÃO paga o lead "- Live"; as outras, o "- Tráfego".</li>
          <li>Card duplicado da mesma pessoa conta como lead de novo (é o que o QS tem).</li>
        </ul>
      </details>
    </div>
  );
}
