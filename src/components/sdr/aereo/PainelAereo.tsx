// src/components/sdr/aereo/PainelAereo.tsx
// -----------------------------------------------------------------------------
// Desempenho › Cotações de aéreo (0206, Bruno 27/10/2026). Quantas cotações cada
// SDR marcou no período e quanto tempo elas tomaram. Não é meta, é pra enxergar
// o tempo que sai da fila pra cotar aéreo.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { fetchQsUsers } from "@/lib/qs/queries";
import { duracaoSeg, fetchCotacoesAereo, formatarDuracao, type CotacaoAereo } from "@/lib/qs/aereo";

export default function PainelAereo({ from, to, ownerId }: { from: string; to: string; ownerId?: string }) {
  const [lista, setLista] = useState<CotacaoAereo[] | null>(null);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let vivo = true;
    setLista(null);
    // `to` vem como fim do dia (23:59:59.999); +1 ms vira o limite exclusivo.
    fetchCotacoesAereo(new Date(from), new Date(new Date(to).getTime() + 1), ownerId ?? null)
      .then((l) => { if (vivo) setLista(l); });
    return () => { vivo = false; };
  }, [from, to, ownerId]);
  useEffect(() => {
    fetchQsUsers().then((us) => setNomes(new Map(us.map((u) => [u.id, u.name]))));
  }, []);

  const linhas = useMemo(() => {
    const agora = Date.now();
    const por = new Map<string, { qtd: number; seg: number }>();
    for (const c of lista ?? []) {
      const r = por.get(c.owner_id) ?? { qtd: 0, seg: 0 };
      r.qtd += 1; r.seg += duracaoSeg(c, agora);
      por.set(c.owner_id, r);
    }
    return [...por.entries()]
      .map(([id, r]) => ({ id, nome: nomes.get(id) ?? "—", ...r }))
      .sort((a, b) => b.seg - a.seg);
  }, [lista, nomes]);

  const total = linhas.reduce((s, l) => ({ qtd: s.qtd + l.qtd, seg: s.seg + l.seg }), { qtd: 0, seg: 0 });

  return (
    <div>
      <h2 className="text-sm font-medium text-gray-700 mb-1">Cotações de aéreo</h2>
      <p className="text-xs text-gray-500 mb-3">
        Marcadas pelo SDR no card do lead ("Cotando aéreo" → "Terminei"). Não é meta: mostra quanto tempo saiu da fila pra cotar.
      </p>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {lista === null ? (
          <p className="text-sm text-gray-500 text-center py-6">Carregando...</p>
        ) : linhas.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">Nenhuma cotação de aéreo registrada no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 font-medium">SDR</th>
                <th className="px-4 py-2 font-medium text-right">Cotações</th>
                <th className="px-4 py-2 font-medium text-right">Tempo total</th>
                <th className="px-4 py-2 font-medium text-right">Média por cotação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2 text-gray-800">{l.nome}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.qtd}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatarDuracao(l.seg)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatarDuracao(Math.round(l.seg / l.qtd))}</td>
                </tr>
              ))}
              {linhas.length > 1 && (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-2 text-gray-800">Time</td>
                  <td className="px-4 py-2 text-right tabular-nums">{total.qtd}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatarDuracao(total.seg)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatarDuracao(Math.round(total.seg / total.qtd))}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
