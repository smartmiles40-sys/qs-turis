// src/fin/comissoes/Planilha.tsx
// -----------------------------------------------------------------------------
// A "planilha" card a card (Bruno, 06/11; regras do PDF em 09/11). Mesma tabela
// no Financeiro (com as ações de ajuste e o lucro editável) e em "Minhas
// comissões" do SDR/closer (só leitura).
//   SDR:    ID | Nome | R.R | Valor da venda | Tipo | Expedição | Lucro | Data | Comissão (+ a conta)
//   Closer: ID | Nome |       Valor da venda | Tipo | Expedição | Lucro | Data | Comissão (+ a conta)
// Depois dos cards vêm as cotações de aéreo e os bônus diários do SDR.
// -----------------------------------------------------------------------------
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { dataBr, explicacao, numeroBr, ROTULO_DESTINO, type Linha, type Papel } from "./calculo";
import { ehIdBitrix, linkBitrix } from "./dados";

export const brl = (n: number) => `R$ ${numeroBr(n)}`;

const TOM_DO_SELO: Record<string, "danger" | "warn" | "ok" | "info"> = {
  "Venda cancelada": "danger", "Não comissiona": "danger", "Sem dono": "danger",
  "Sem tipo": "warn", "Falta lucro": "warn", "Expedição sem nome": "warn", "Valor ajustado": "info",
};

export default function Planilha({ linhas, papel, acoes, onLucro, vazio }: {
  linhas: Linha[];
  papel: Papel;
  /** Só no Financeiro: botão por linha (ajustar). */
  acoes?: (l: Linha) => ReactNode;
  /** Só no Financeiro: clicar no lucro abre a edição. */
  onLucro?: (l: Linha) => void;
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
  const apagado = { color: "var(--ink3)" };
  const ROTULO_QS: Record<string, string> = { qs: "Venda QS", rr: "R.R QS", ag: "Agend. QS", cotv: "Aéreo QS" };

  const celulaLucro = (l: Linha) => {
    if (l.tipo_linha !== "card" || !l.venda_no_mes || l.cancelada) return <span style={apagado}>—</span>;
    const texto = l.lucro != null ? brl(l.lucro) : l.usa_lucro ? "Falta" : "—";
    const titulo = l.lucro_origem === "bitrix" ? (ehIdBitrix(l.bitrix_id) ? "Total − custo do Bitrix" : "Valor − custo registrados no QS") : l.lucro_origem === "digitado" ? "Digitado pelo Financeiro" : undefined;
    const cor = l.lucro == null && l.usa_lucro ? "var(--warn-ink, #B45309)" : l.lucro == null ? "var(--ink3)" : "var(--ink)";
    if (!onLucro) return <span style={{ color: cor }} title={titulo}>{texto}</span>;
    return (
      <button type="button" onClick={() => onLucro(l)} title={titulo ?? "Digitar o lucro deste card"}
        style={{ color: cor, background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline dotted", font: "inherit" }}>
        {texto}
      </button>
    );
  };

  return (
    <div className="qs-card" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: papel === "sdr" ? 1000 : 920 }}>
          <thead style={{ background: "var(--card2)" }}>
            <tr>
              <th style={th}>ID</th>
              <th style={th}>Nome</th>
              {papel === "sdr" && <th style={th}>R.R</th>}
              <th style={{ ...th, ...dir }}>Valor da venda</th>
              <th style={th}>Tipo da venda</th>
              <th style={th}>Expedição</th>
              <th style={{ ...th, ...dir }}>Lucro</th>
              <th style={th}>Data</th>
              <th style={{ ...th, ...dir }}>Comissão</th>
              {acoes && <th style={th}><span className="sr-only">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const card = l.tipo_linha === "card";
              const conta = explicacao(l);
              return (
                <tr key={l.chave} style={card ? undefined : { background: "color-mix(in srgb, var(--card2) 55%, transparent)" }}>
                  <td style={td}>
                    {card && !ehIdBitrix(l.bitrix_id)
                      ? <span style={{ fontWeight: 600 }} title="Registrado no QS">{ROTULO_QS[l.bitrix_id.split(":")[0]] ?? "QS"}</span>
                      : card
                      ? <a href={linkBitrix(l.bitrix_id)} target="_blank" rel="noreferrer" style={{ color: "var(--rel-ink, var(--accent))", fontWeight: 600 }} title="Abrir o card no Bitrix">{l.bitrix_id}</a>
                      : <span style={apagado}>{l.tipo_linha === "bonus_dia" ? "Bônus" : "Cotação"}</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 220 }}>
                    <span style={{ color: "var(--ink)" }}>{l.cliente}</span>
                    {l.fase && <span style={{ display: "block", fontSize: 11.5, color: "var(--ink3)" }}>{l.fase}</span>}
                  </td>
                  {papel === "sdr" && (
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {!card ? "" : l.rr_no_mes ? <>Sim <span style={apagado}>{dataBr(l.rr_data).slice(0, 5)}</span></>
                        : l.rr ? <span style={apagado} title="A R.R deste card conta no mês da reunião">Em {dataBr(l.rr_data).slice(3)}</span>
                        : <span style={apagado}>Não</span>}
                    </td>
                  )}
                  <td style={{ ...td, ...dir }}>{l.venda_no_mes ? (l.cancelada ? <s style={apagado}>cancelada</s> : brl(l.valor_venda)) : <span style={apagado}>—</span>}</td>
                  <td style={td}>{card ? (l.venda_no_mes ? (l.tipo_venda ?? <span style={apagado}>Sem tipo</span>) : "") : l.tipo_venda}</td>
                  <td style={{ ...td, maxWidth: 180 }}>
                    {l.venda_no_mes && l.expedicao ? l.expedicao : ""}
                    {l.destino && <span style={{ display: "block", fontSize: 11.5, color: "var(--ink3)" }}>{ROTULO_DESTINO[l.destino]}</span>}
                  </td>
                  <td style={{ ...td, ...dir }}>{celulaLucro(l)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{card ? (l.venda_no_mes ? dataBr(l.data_venda) : "") : dataBr(l.data_ref)}</td>
                  <td style={{ ...td, ...dir }}>
                    <strong style={{ color: "var(--ink)" }}>{brl(l.comissao)}</strong>
                    {conta && <span style={{ display: "block", fontSize: 11, color: "var(--ink3)", whiteSpace: "normal", maxWidth: 230, marginLeft: "auto" }}>{conta}</span>}
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
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--card2)" }}>
              <td style={{ ...td, fontWeight: 700 }} colSpan={2}>{linhas.filter((l) => l.tipo_linha === "card").length} cards</td>
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
