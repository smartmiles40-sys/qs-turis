// src/fin/comissoes/Planilha.tsx
// -----------------------------------------------------------------------------
// A "planilha" card a card (Bruno, 06/11). Mesma tabela no Financeiro (com as
// ações de ajuste) e em "Minhas comissões" do SDR/closer (só leitura).
//   SDR:    ID | Nome | R.R | Valor da venda | Tipo da venda | Expedição | Data da venda | Pipeline | Comissão
//   Closer: ID | Nome |       Valor da venda | Tipo da venda | Expedição | Data da venda | Pipeline | Comissão
// -----------------------------------------------------------------------------
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { dataBr, numeroBr, type Linha, type Papel } from "./calculo";
import { linkBitrix } from "./dados";

export const brl = (n: number) => `R$ ${numeroBr(n)}`;

const TOM_DO_SELO: Record<string, "danger" | "warn" | "ok" | "info"> = {
  "Venda cancelada": "danger", "Não comissiona": "danger", "Sem dono": "danger",
  "Sem regra": "warn", "Sem tipo": "warn", "Valor ajustado": "info",
};

export default function Planilha({ linhas, papel, acoes, vazio }: {
  linhas: Linha[];
  papel: Papel;
  /** Só no Financeiro: botão por linha (ajustar). */
  acoes?: (l: Linha) => ReactNode;
  vazio?: ReactNode;
}) {
  if (!linhas.length) {
    return <div className="qs-card" style={{ padding: 24, textAlign: "center", color: "var(--ink3)", fontSize: 13 }}>{vazio ?? "Nenhum card neste mês."}</div>;
  }
  const soma = linhas.reduce((s, l) => s + l.valor_venda, 0);
  const total = linhas.reduce((s, l) => s + l.comissao, 0);
  const rr = linhas.filter((l) => l.rr_no_mes).length;
  const td = { padding: "8px 10px", fontSize: 13, verticalAlign: "top" as const, borderTop: "1px solid var(--line)" };
  const th = { padding: "8px 10px", fontSize: 11.5, fontWeight: 600, textAlign: "left" as const, color: "var(--ink2)", whiteSpace: "nowrap" as const };
  const dir = { textAlign: "right" as const, whiteSpace: "nowrap" as const, fontVariantNumeric: "tabular-nums" as const };

  return (
    <div className="qs-card" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: papel === "sdr" ? 980 : 900 }}>
          <thead style={{ background: "var(--card2)" }}>
            <tr>
              <th style={th}>ID</th>
              <th style={th}>Nome</th>
              {papel === "sdr" && <th style={th}>R.R</th>}
              <th style={{ ...th, ...dir }}>Valor da venda</th>
              <th style={th}>Tipo da venda</th>
              <th style={th}>Expedição</th>
              <th style={th}>Data da venda</th>
              <th style={th}>Pipeline</th>
              <th style={{ ...th, ...dir }}>Comissão</th>
              {acoes && <th style={th}><span className="sr-only">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave}>
                <td style={td}>
                  <a href={linkBitrix(l.bitrix_id)} target="_blank" rel="noreferrer" style={{ color: "var(--rel-ink, var(--accent))", fontWeight: 600 }}
                    title="Abrir o card no Bitrix">{l.bitrix_id}</a>
                </td>
                <td style={{ ...td, maxWidth: 220 }}>
                  <span style={{ color: "var(--ink)" }}>{l.cliente}</span>
                  {l.fase && <span style={{ display: "block", fontSize: 11.5, color: "var(--ink3)" }}>{l.fase}</span>}
                </td>
                {papel === "sdr" && (
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {l.rr_no_mes ? <>Sim <span style={{ color: "var(--ink3)" }}>{dataBr(l.rr_data).slice(0, 5)}</span></>
                      : l.rr ? <span style={{ color: "var(--ink3)" }} title="A R.R deste card conta no mês da reunião">Em {dataBr(l.rr_data).slice(3)}</span>
                      : <span style={{ color: "var(--ink3)" }}>Não</span>}
                  </td>
                )}
                <td style={{ ...td, ...dir }}>{l.venda_no_mes ? (l.cancelada ? <s style={{ color: "var(--ink3)" }}>cancelada</s> : brl(l.valor_venda)) : <span style={{ color: "var(--ink3)" }}>—</span>}</td>
                <td style={td}>{l.venda_no_mes ? (l.tipo_venda ?? <span style={{ color: "var(--ink3)" }}>Sem tipo</span>) : ""}</td>
                <td style={{ ...td, maxWidth: 180 }}>{l.venda_no_mes ? (l.expedicao ?? "") : ""}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{l.venda_no_mes ? dataBr(l.data_venda) : ""}</td>
                <td style={{ ...td, fontSize: 12, color: "var(--ink2)" }}>{l.pipeline}</td>
                <td style={{ ...td, ...dir }}>
                  <strong style={{ color: "var(--ink)" }}>{brl(l.comissao)}</strong>
                  {l.ajuste && l.comissao !== l.comissao_calculada && (
                    <span style={{ display: "block", fontSize: 11, color: "var(--ink3)" }}>calculado {brl(l.comissao_calculada)}</span>
                  )}
                  {l.selos.length > 0 && (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", marginTop: 4 }}>
                      {l.selos.map((s) => <Badge key={s} tone={TOM_DO_SELO[s]}>{s}</Badge>)}
                    </span>
                  )}
                  {l.ajuste && <span style={{ display: "block", fontSize: 11, color: "var(--ink3)", marginTop: 2, whiteSpace: "normal" }}>Motivo: {l.ajuste.motivo}</span>}
                </td>
                {acoes && <td style={{ ...td, whiteSpace: "nowrap" }}>{acoes(l)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--card2)" }}>
              <td style={{ ...td, fontWeight: 700 }} colSpan={2}>{linhas.length} card{linhas.length === 1 ? "" : "s"}</td>
              {papel === "sdr" && <td style={{ ...td, fontWeight: 700 }}>{rr} R.R</td>}
              <td style={{ ...td, ...dir, fontWeight: 700 }}>{brl(soma)}</td>
              <td style={td} colSpan={4} />
              <td style={{ ...td, ...dir, fontWeight: 700 }}>{brl(total)}</td>
              {acoes && <td style={td} />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
