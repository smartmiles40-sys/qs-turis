// src/venda/BlocosDaVenda.tsx
// -----------------------------------------------------------------------------
// A VENDA EM BLOCOS (sprint final, decisão 8 do Bruno): Marketing / SDR /
// Closer / Pós-venda, preenchidos sozinhos a partir do lead (RPC venda_blocos).
// Banco sem a RPC → o bloco some (não atrapalha a venda).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { dataHoraBr } from "@/closer/lib";
import { blocosDaVenda, type BlocosVenda } from "./api";

const Linha = ({ r, v }: { r: string; v?: string | null }) => (
  <p className="text-[12.5px] flex gap-1.5" style={{ color: "var(--ink2)" }}>
    <span style={{ color: "var(--ink3)" }}>{r}:</span>
    <span className="min-w-0 truncate" style={{ color: v ? "var(--ink)" : "var(--ink3)" }}>{v || "—"}</span>
  </p>
);

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3 space-y-0.5" style={{ border: "1px solid var(--line)" }}>
      <p className="text-[12px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink3)" }}>{titulo}</p>
      {children}
    </div>
  );
}

export default function BlocosDaVenda({ vendaId }: { vendaId: string | null }) {
  const [b, setB] = useState<BlocosVenda | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!vendaId) { setB(undefined); return; }
    let vivo = true;
    setErro(null);
    blocosDaVenda(vendaId).then((x) => vivo && setB(x)).catch((e) => { if (vivo) { setErro((e as Error).message); setB(null); } });
    return () => { vivo = false; };
  }, [vendaId]);

  if (!vendaId) {
    return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Marketing, SDR, Closer e Pós-venda aparecem aqui depois que a venda for salva.</p>;
  }
  if (b === undefined) return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Carregando quem participou…</p>;
  if (erro) return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Não deu pra ler quem participou da venda ({erro}).</p>;
  if (!b) return null;
  const m = b.marketing;
  return (
    <section className="rel-card p-4">
      <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--ink)" }}>Quem participou da venda</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Cartao titulo="Marketing">
          <Linha r="Origem" v={m?.origem} />
          <Linha r="Campanha" v={m?.utm_campaign} />
          <Linha r="Anúncio" v={m?.utm_content} />
          <Linha r="Fonte" v={m?.utm_source} />
          <Linha r="Página" v={m?.lp} />
        </Cartao>
        <Cartao titulo="SDR">
          <Linha r="Quem agendou" v={b.sdr?.nome} />
          <Linha r="Agendou em" v={b.sdr?.agendou_em ? dataHoraBr(b.sdr.agendou_em) : null} />
        </Cartao>
        <Cartao titulo="Closer"><Linha r="Quem vendeu" v={b.closer?.nome} /></Cartao>
        <Cartao titulo="Pós-venda"><Linha r="Quem acompanha" v={b.pos_venda?.nome} /></Cartao>
      </div>
    </section>
  );
}
