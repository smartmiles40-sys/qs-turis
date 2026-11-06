// src/components/sdr/produto/PainelDemandaProduto.tsx
// -----------------------------------------------------------------------------
// Desempenho › Demanda por produto (Bruno, 06/11/2026). Quanto cada SDR mandou
// pros closers, por produto (Aéreo · Pacote · Expedição · Outros), e quantos
// aéreos ele mesmo emitiu. Conta a 1ª reunião agendada no período (data em que
// foi agendada) — retomada, cancelada e a linha antiga do reagendamento ficam
// fora, como nas taxas de reunião.
// -----------------------------------------------------------------------------
import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchQsUsers } from "@/lib/qs/queries";
import { PRODUTOS, demandaPorProduto, somarDemanda, type LinhaDemanda } from "@/lib/qs/produtoGanho";
import { fetchBaseDemanda } from "@/lib/qs/produtoGanhoDados";

export default function PainelDemandaProduto({ from, to, ownerId }: { from: string; to: string; ownerId?: string }) {
  const [linhas, setLinhas] = useState<LinhaDemanda[] | null>(null);
  const [semMigration, setSemMigration] = useState(false);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let vivo = true;
    setLinhas(null);
    // `to` vem como fim do dia (23:59:59.999); +1 ms vira o limite exclusivo.
    fetchBaseDemanda(new Date(from), new Date(new Date(to).getTime() + 1), ownerId ?? null).then((b) => {
      if (!vivo) return;
      setSemMigration(b.semMigration);
      setLinhas(demandaPorProduto(b.reunioes, b.ganhosSdr));
    });
    return () => { vivo = false; };
  }, [from, to, ownerId]);
  useEffect(() => {
    fetchQsUsers().then((us) => setNomes(new Map(us.map((u) => [u.id, u.name]))));
  }, []);

  const total = useMemo(() => (linhas ? somarDemanda(linhas) : null), [linhas]);
  const temSemProduto = !!total && total.semProduto > 0;

  const celula = (n: number) => (
    <td className="px-3 py-2 text-right tabular-nums" style={{ color: n ? undefined : "#cbd5e1" }}>{n}</td>
  );

  return (
    <div>
      <h2 className="text-sm font-medium text-gray-700 mb-1">Demanda por produto</h2>
      <p className="text-xs text-gray-500 mb-3">
        O que cada SDR passou pros closers no período, pelo produto escolhido no "Ganho / Agendou" — e os
        aéreos que ele mesmo emitiu. Conta a 1ª reunião pelo dia em que foi agendada (retomada fica fora).
      </p>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
        {linhas === null ? (
          <p className="text-sm text-gray-500 text-center py-6">Carregando...</p>
        ) : semMigration ? (
          <p className="text-sm text-gray-500 text-center py-6">A migration 0321 ainda não foi aplicada — sem dados de produto.</p>
        ) : linhas.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">Nenhum agendamento no período.</p>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 font-medium">SDR</th>
                {PRODUTOS.map((p) => (
                  <th key={p.tipo} className="px-3 py-2 font-medium text-right">{p.rotulo}</th>
                ))}
                {temSemProduto && (
                  <th className="px-3 py-2 font-medium text-right" title="Reuniões agendadas antes do seletor de produto (ou por fora dele)">Sem produto</th>
                )}
                <th className="px-3 py-2 font-medium text-right">Pro closer</th>
                <th className="px-3 py-2 font-medium text-right" title="Aéreo que o próprio SDR emitiu, sem reunião">Aéreo do SDR</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.ownerId} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2 text-gray-800">{nomes.get(l.ownerId) ?? "—"}</td>
                  {PRODUTOS.map((p) => <Fragment key={p.tipo}>{celula(l.closer[p.tipo])}</Fragment>)}
                  {temSemProduto && celula(l.semProduto)}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{l.totalCloser}</td>
                  {celula(l.aereoSdr)}
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{l.total}</td>
                </tr>
              ))}
              {total && linhas.length > 1 && (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-2 text-gray-800">Time</td>
                  {PRODUTOS.map((p) => <td key={p.tipo} className="px-3 py-2 text-right tabular-nums">{total.closer[p.tipo]}</td>)}
                  {temSemProduto && <td className="px-3 py-2 text-right tabular-nums">{total.semProduto}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{total.totalCloser}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total.aereoSdr}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{total.total}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
