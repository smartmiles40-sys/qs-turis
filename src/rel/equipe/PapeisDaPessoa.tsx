// src/rel/equipe/PapeisDaPessoa.tsx
// -----------------------------------------------------------------------------
// O QUE CADA UM FAZ NO SETOR (0222, Bruno 29/10: "separar o que cada pessoa do
// setor vai fazer e quais demandas são atreladas àquela pessoa — CX, CS e
// Hunter"). Chips liga/desliga no Time. O papel decide quem recebe cada tipo de
// solicitação no rodízio (Tipos e prazos → "Quem recebe").
// Sem a 0222 aplicada (papeis = null), não aparece.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { DICA_PAPEL, NOME_PAPEL, PAPEIS, definirPapeis, type Papel } from "@/solicitacoes/lib";

export default function PapeisDaPessoa({ userId, papeis, podeMudar, onMudou }: {
  userId: string; papeis: Papel[]; podeMudar: boolean; onMudou: (p: Papel[]) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar(p: Papel) {
    const novos = papeis.includes(p) ? papeis.filter((x) => x !== p) : [...papeis, p];
    setSalvando(true); setErro(null);
    try { await definirPapeis(userId, novos); onMudou(novos); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5" role="group" aria-label="Papel no setor">
      <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Recebe como:</span>
      {PAPEIS.map((p) => {
        const ligado = papeis.includes(p);
        return (
          <button key={p} type="button" disabled={!podeMudar || salvando} aria-pressed={ligado} title={DICA_PAPEL[p]}
            onClick={() => void alternar(p)}
            className="h-7 px-2.5 rounded-full text-[12px] font-semibold border disabled:cursor-default"
            style={ligado
              ? { background: "var(--rel)", color: "#fff", borderColor: "var(--rel)" }
              : { background: "transparent", color: "var(--ink2)", borderColor: "var(--line)" }}>
            {NOME_PAPEL[p]}
          </button>
        );
      })}
      {!papeis.length && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>nenhum (recebe só tipos do setor todo)</span>}
      {erro && <span className="text-[12px]" style={{ color: "var(--err-ink)" }}>{erro}</span>}
    </div>
  );
}
