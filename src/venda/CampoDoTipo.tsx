// src/venda/CampoDoTipo.tsx
// Um campo do catálogo (TIPOS[tipo].campos em src/propostas/lib.ts) — o mesmo
// desenho do "Registrar venda" do closer (src/closer/RegistrarVenda.tsx).
import { Campo, Entrada } from "@/rel/ui";
import type { CampoTipo } from "@/propostas/lib";

export default function CampoDoTipo({ c, valor, onMudar }: { c: CampoTipo; valor: string; onMudar: (v: string) => void }) {
  return (
    <div className={c.largo ? "sm:col-span-2" : ""}>
      <Campo rotulo={c.rotulo} dica={c.dica}>
        {c.tipo === "select" ? (
          <select className="rel-input" value={valor} onChange={(e) => onMudar(e.target.value)}>
            {(c.opcoes ?? []).map((o) => <option key={o} value={o}>{o || "Escolha…"}</option>)}
          </select>
        ) : c.tipo === "area" ? (
          <textarea className="rel-input" rows={3} value={valor} onChange={(e) => onMudar(e.target.value)} />
        ) : (
          <Entrada type={c.tipo === "hora" ? "time" : c.tipo === "numero" ? "number" : c.tipo === "data" ? "date" : "text"}
            value={valor} onChange={(e) => onMudar(e.target.value)} />
        )}
      </Campo>
    </div>
  );
}
