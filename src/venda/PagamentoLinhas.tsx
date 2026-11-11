// src/venda/PagamentoLinhas.tsx
// -----------------------------------------------------------------------------
// PAGAMENTO EM LINHAS (sprint final, 11/11/2026 — docs/SUBIR-VENDA-FINAL.md):
// cada linha = forma, valor, data e nº de parcelas. Embaixo, "Soma R$ X = Total
// R$ Y ✓" ou a diferença em vermelho. Regras puras: ./vendaFinal.
// -----------------------------------------------------------------------------
import { Botao, Campo, Entrada } from "@/rel/ui";
import { FORMAS_LINHA, brl, conferirPagamento, linhaVazia, problemaDaLinha, type FormaLinha, type LinhaPagamento } from "./vendaFinal";

export default function PagamentoLinhas({ linhas, total, onLinhas }: {
  linhas: LinhaPagamento[];
  total: number;
  onLinhas: (l: LinhaPagamento[]) => void;
}) {
  const lista = linhas.length ? linhas : [linhaVazia()];
  const c = conferirPagamento(lista, total);
  const mudar = (chave: string, p: Partial<LinhaPagamento>) => onLinhas(lista.map((l) => (l.chave === chave ? { ...l, ...p } : l)));
  const tirar = (chave: string) => onLinhas(lista.length > 1 ? lista.filter((l) => l.chave !== chave) : [linhaVazia()]);
  // Nova linha já vem com o que falta pra fechar o total (a pessoa só ajusta).
  const adicionar = () => onLinhas([...lista, { ...linhaVazia(), valor: c.diferenca > 0 ? String(c.diferenca).replace(".", ",") : "" }]);

  return (
    <div className="space-y-3">
      {lista.map((l, n) => {
        const prob = problemaDaLinha(l, n + 1);
        return (
          <div key={l.chave} className="rounded-xl p-3" style={{ border: `1px solid ${prob ? "var(--red, #dc2626)" : "var(--line)"}` }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[13px] font-bold flex-1" style={{ color: "var(--ink)" }}>Pagamento {n + 1}</span>
              {(lista.length > 1 || l.valor || l.forma) && <Botao variante="fantasma" onClick={() => tirar(l.chave)}>Tirar</Botao>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Campo rotulo="Forma">
                <select className="rel-input" value={l.forma} onChange={(e) => mudar(l.chave, { forma: e.target.value as FormaLinha | "" })}>
                  <option value="">Escolha…</option>
                  {Object.entries(FORMAS_LINHA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Valor (R$)">
                <Entrada inputMode="decimal" placeholder="0,00" value={l.valor} onChange={(e) => mudar(l.chave, { valor: e.target.value })} />
              </Campo>
              <Campo rotulo={Number(l.parcelas) > 1 ? "1ª parcela em" : "Data"}>
                <Entrada type="date" value={l.data} onChange={(e) => mudar(l.chave, { data: e.target.value })} />
              </Campo>
              <Campo rotulo="Parcelas">
                <Entrada type="number" min={1} max={48} value={l.parcelas} onChange={(e) => mudar(l.chave, { parcelas: e.target.value })} />
              </Campo>
              <div className="col-span-2 sm:col-span-4">
                <Entrada value={l.obs} placeholder="Detalhe (opcional): ex.: cartão da mãe, sinal já caiu" aria-label={`Detalhe do pagamento ${n + 1}`}
                  onChange={(e) => mudar(l.chave, { obs: e.target.value })} />
              </div>
            </div>
            {prob && <p className="text-[12px] mt-1.5" style={{ color: "var(--err-ink)" }}>{prob}</p>}
          </div>
        );
      })}
      <button type="button" className="text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={adicionar}>
        + Outra forma de pagamento
      </button>
      <div className="rounded-lg px-3 py-2 text-[13.5px] font-semibold" role="status"
        style={{ background: c.bate ? "var(--rel-soft)" : "var(--card2)", color: c.bate ? "var(--rel-ink)" : c.soma > 0 ? "var(--err-ink)" : "var(--ink2)" }}>
        {c.bate
          ? <>Soma {brl(c.soma)} = Total {brl(c.total)} ✓</>
          : c.total <= 0
            ? <>Coloque o valor dos itens acima: o total ainda está zerado.</>
            : <>Soma {brl(c.soma)} ≠ Total {brl(c.total)} — {c.diferenca > 0 ? `faltam ${brl(c.diferenca)}` : `passou ${brl(-c.diferenca)}`}</>}
      </div>
    </div>
  );
}
