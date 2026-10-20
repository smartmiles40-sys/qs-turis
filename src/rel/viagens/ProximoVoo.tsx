// src/rel/viagens/ProximoVoo.tsx
// -----------------------------------------------------------------------------
// O PRÓXIMO VOO da viagem (0152, Bruno 20/10: "a coluna de ida … aparecer a
// próxima data que vai ter outro voo"). Na lista fica à direita (a ida original
// segue no período, embaixo do título); no cabeçalho da viagem vira um destaque.
// -----------------------------------------------------------------------------
import { proximoVoo, type Viagem } from "../lib/viagens";

/** Bloco compacto da lista: "✈ 23/10 14:35 · LIS→FCO" / "voo 2 de 4". */
export function ProximoVooCurto({ v, className = "" }: { v: Viagem; className?: string }) {
  const p = proximoVoo(v);
  if (p.situacao !== "proximo") {
    return <span className={`text-right text-[11px] ${className}`} style={{ color: "var(--ink3)" }}>{p.ordem}</span>;
  }
  return (
    <span className={`text-right leading-tight ${className}`} title="Próximo voo (hora local da partida)">
      <span className="block text-[12.5px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
        ✈ {p.quando}{p.trecho ? <span className="font-normal" style={{ color: "var(--ink2)" }}> · {p.trecho}</span> : null}
      </span>
      <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{p.ordem || "próximo voo"}</span>
    </span>
  );
}

/** Destaque do cabeçalho da viagem. Some quando não há voo cadastrado (o período já está ali). */
export function ProximoVooDestaque({ v }: { v: Viagem }) {
  const p = proximoVoo(v);
  if (p.situacao === "sem_voos") return <span className="text-[12px]" style={{ color: "var(--ink3)" }}>sem voos cadastrados</span>;
  if (p.situacao === "concluidos") return <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{p.ordem}{p.quando ? ` · último em ${p.quando}` : ""}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 rounded-lg px-2 py-0.5 text-[13px]" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>
      <b>Próximo voo</b>
      <span className="tabular-nums font-semibold">{p.quando}</span>
      {p.trecho && <span>· {p.trecho}</span>}
      {p.ordem && <span className="text-[11.5px] opacity-80">· {p.ordem}</span>}
    </span>
  );
}
