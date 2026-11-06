// src/fin/comissoes/comuns.tsx — peças das duas telas de comissão (Financeiro e "Minhas comissões").
import { Badge, Button } from "@/components/ui";
import { dataBr } from "./calculo";
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
