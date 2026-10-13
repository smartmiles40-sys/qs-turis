// src/rel/clientes/CategoriaChip.tsx
// O selo da categoria do cliente (Bronze / Silver / Black / Green) com a cor
// definida em Configurações.
import type { CategoriaId } from "../lib/clientes";
import type { Cat } from "./KpisClientes";

export default function CategoriaChip({ categoria, cats }: { categoria: CategoriaId; cats: Cat[] }) {
  const c = cats.find((x) => x.id === categoria);
  if (!c || categoria === "sem_categoria") return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{ background: `${c.cor}1F`, color: "var(--ink)", border: `1px solid ${c.cor}66` }}>
      <span className="w-2 h-2 rounded-full" aria-hidden style={{ background: c.cor, boxShadow: "inset 0 0 0 1px rgba(127,127,127,.45)" }} />
      {c.nome}
    </span>
  );
}
