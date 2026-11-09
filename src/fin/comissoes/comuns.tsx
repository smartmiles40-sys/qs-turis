// src/fin/comissoes/comuns.tsx — peças das duas telas de comissão (Financeiro e "Minhas comissões").
import { Badge, Button } from "@/components/ui";
import { dataBr, faixasDoSdr, numeroBr, valorDaFaixa, type Papel, type Regra, type ResumoPessoa } from "./calculo";
import { mesAnterior, mesAtual, rotuloMes, type Fechamento } from "./dados";

/** Seletor de mês: ‹ Outubro/2026 › (estilo próprio: o Comercial não tem o CSS das áreas). */
export function SeletorDeMes({ mes, onMes }: { mes: string; onMes: (m: string) => void }) {
  const atual = mesAtual();
  const opcoes = Array.from({ length: 13 }, (_, i) => mesAnterior(atual, i));
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Button size="sm" aria-label="Mês anterior" onClick={() => onMes(mesAnterior(mes))}>‹</Button>
      <select value={mes} onChange={(e) => onMes(e.target.value)} aria-label="Mês"
        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)", fontSize: 13 }}>
        {(opcoes.includes(mes) ? opcoes : [mes, ...opcoes]).map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
      </select>
      <Button size="sm" aria-label="Próximo mês" disabled={mes >= atual} onClick={() => onMes(mesAnterior(mes, -1))}>›</Button>
    </div>
  );
}

export function SeloStatus({ f }: { f: Fechamento | undefined }) {
  if (!f) return <Badge>Em aberto</Badge>;
  if (f.status === "pago") return <Badge tone="ok" dot>Pago {f.pago_em ? dataBr(f.pago_em) : ""}</Badge>;
  return <Badge tone="info" dot>Fechado</Badge>;
}

/**
 * "Como chegou nesse valor": o quadro em cima da planilha de uma pessoa.
 * SDR: R.R × faixa (e quanto falta pra próxima), vendas, cotações, bônus.
 * Closer: vendas. Os dois: quantos cards ainda sem lucro.
 */
export function ResumoDaConta({ r, papel, regras, pessoaId, mes }: {
  r: ResumoPessoa | undefined; papel: Papel; regras: Regra[]; pessoaId: string | null; mes: string;
}) {
  if (!r) return null;
  const fim = `${mes}-28`;
  const faixas = papel === "sdr" ? faixasDoSdr(regras, pessoaId, fim) : [];
  const { faixa, proxima } = valorDaFaixa(faixas, r.rr_faixa);
  const caixa = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)" } as const;
  const rot = { display: "block", fontSize: 11.5, color: "var(--ink3)" } as const;
  const val = { display: "block", fontSize: 16, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" } as const;
  const sub = { display: "block", fontSize: 12, color: "var(--ink2)", marginTop: 2 } as const;
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      {papel === "sdr" && (
        <div style={caixa}>
          <span style={rot}>Reuniões realizadas</span>
          <span style={val}>{brlC(r.total_rr)}</span>
          <span style={sub}>
            {r.rr} R.R × {brlC(r.valor_por_rr || Number(faixa?.valor) || 0)}
            {r.rr !== r.rr_faixa && ` (${r.rr_faixa} contam pra faixa)`}
          </span>
          {proxima && <span style={{ ...sub, color: "var(--ink3)" }}>Faltam {proxima.de - r.rr_faixa} pra {brlC(proxima.valor)} por R.R</span>}
        </div>
      )}
      <div style={caixa}>
        <span style={rot}>Vendas</span>
        <span style={val}>{brlC(r.total_vendas)}</span>
        <span style={sub}>{r.vendas} venda{r.vendas === 1 ? "" : "s"} · {brlC(r.soma_vendas)}</span>
        {r.falta_lucro > 0 && <span style={{ ...sub, color: "var(--warn-ink, #B45309)" }}>{r.falta_lucro} sem lucro digitado (saem R$ 0)</span>}
      </div>
      {papel === "sdr" && (
        <div style={caixa}>
          <span style={rot}>Bônus diário · Cotações</span>
          <span style={val}>{brlC(r.total_bonus + r.total_cotacoes)}</span>
          <span style={sub}>{r.dias_bonus} dia{r.dias_bonus === 1 ? "" : "s"} com bônus · {r.cotacoes} cotaç{r.cotacoes === 1 ? "ão" : "ões"}</span>
        </div>
      )}
      <div style={{ ...caixa, background: "var(--card2)" }}>
        <span style={rot}>A receber</span>
        <span style={{ ...val, fontSize: 20 }}>{brlC(r.total)}</span>
      </div>
    </div>
  );
}

const brlC = (n: number) => `R$ ${numeroBr(n)}`;
