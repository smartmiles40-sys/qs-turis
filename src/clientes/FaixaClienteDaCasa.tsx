// src/clientes/FaixaClienteDaCasa.tsx
// -----------------------------------------------------------------------------
// FAIXA "CLIENTE DA CASA" (visão cruzada, 13/11/2026) — na ficha do lead (SDR)
// e no painel do negócio (closer). Somente leitura e compacta: viagens, chamado
// aberto no Rel, oportunidade do Rel ("recompra é do Rel") e parcela vencida.
//
// Regras de comportamento (as mesmas do RespostasDoFormulario):
//   • NÃO OCUPA ESPAÇO QUANDO NÃO TEM O QUE DIZER — sem ficha, sem nada na casa,
//     sem a migration 0381 ou sem acesso → não renderiza nada.
//   • NÃO PISCA — carga silenciosa, sem "carregando…".
// Só tokens globais (--text, --muted, --border…): funciona dentro da ficha do
// lead (.fl-*) e do painel do closer (.rel-*).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { resumoDoLead } from "./visaoCruzada";
import { itensDaFaixa, type ItemFaixa, type TomFaixa } from "./visaoCruzadaRegras";

const COR: Record<TomFaixa, string> = { info: "var(--info)", warn: "var(--warn)", danger: "var(--danger)" };

export default function FaixaClienteDaCasa({ leadId }: { leadId: string | null | undefined }) {
  const [itens, setItens] = useState<ItemFaixa[]>([]);

  useEffect(() => {
    setItens([]);
    if (!leadId) return;
    let vivo = true; // trocou de lead antes da resposta: não pinta no card errado
    void resumoDoLead(leadId).then((r) => { if (vivo) setItens(itensDaFaixa(r)); });
    return () => { vivo = false; };
  }, [leadId]);

  if (!itens.length) return null;

  return (
    <section aria-label="Cliente da casa"
      style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "10px 14px",
        display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 16px", fontSize: 13 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)" }}>
        Cliente da casa
      </span>
      {itens.map((i) => (
        <span key={i.chave} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: COR[i.tom], flexShrink: 0, alignSelf: "center" }} />
          <span style={{ fontWeight: 600, color: "var(--text)" }}>{i.texto}</span>
          {i.detalhe && <span style={{ color: "var(--muted)", overflowWrap: "anywhere" }}>{i.detalhe}</span>}
        </span>
      ))}
    </section>
  );
}
