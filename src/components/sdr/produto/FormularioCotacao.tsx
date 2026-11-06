// src/components/sdr/produto/FormularioCotacao.tsx
// -----------------------------------------------------------------------------
// Formulário curto da cotação (rota COTACAO — spec 06/11, seção 4): trecho,
// datas, passageiros, bagagem, flexibilidade, orçamento e QUEM COTA ("Eu mesmo
// cotar" é o padrão; ou um closer, que marca a cotação como repassada).
// -----------------------------------------------------------------------------
import type { DadosCotacao } from "@/lib/qs/produtoGanho";

export default function FormularioCotacao({
  value,
  onChange,
  closers,
  euId,
  disabled = false,
  inputClassName = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none",
  labelClassName = "text-xs font-medium text-gray-500 block mb-1",
}: {
  value: DadosCotacao;
  onChange: (v: DadosCotacao) => void;
  closers: { id: string; name: string }[];
  euId: string | null;
  disabled?: boolean;
  inputClassName?: string;
  labelClassName?: string;
}) {
  const set = <K extends keyof DadosCotacao>(k: K, v: DadosCotacao[K]) => onChange({ ...value, [k]: v });
  const pax = (k: "adultos" | "criancas" | "bebes", rotulo: string) => (
    <div>
      <label className={labelClassName}>{rotulo}</label>
      <input
        type="number" min={0} max={20} inputMode="numeric" disabled={disabled}
        value={value[k]}
        onChange={(e) => set(k, Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
        className={inputClassName}
      />
    </div>
  );

  return (
    <div className="space-y-3 rounded-xl border border-gray-100 bg-white p-3">
      <p className="text-[12px] font-semibold text-gray-700">Pedido de cotação</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Origem *</label>
          <input type="text" disabled={disabled} value={value.origem} onChange={(e) => set("origem", e.target.value)} placeholder="São Paulo (GRU)" className={inputClassName} />
        </div>
        <div>
          <label className={labelClassName}>Destino *</label>
          <input type="text" disabled={disabled} value={value.destino} onChange={(e) => set("destino", e.target.value)} placeholder="Lisboa (LIS)" className={inputClassName} />
        </div>
        <div>
          <label className={labelClassName}>Ida *</label>
          <input type="date" disabled={disabled} value={value.dataIda} onChange={(e) => set("dataIda", e.target.value)} className={inputClassName} />
        </div>
        <div>
          <label className={labelClassName}>Volta <span className="font-normal text-gray-400">(vazio = só ida)</span></label>
          <input type="date" disabled={disabled} min={value.dataIda || undefined} value={value.dataVolta} onChange={(e) => set("dataVolta", e.target.value)} className={inputClassName} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {pax("adultos", "Adultos")}
        {pax("criancas", "Crianças")}
        {pax("bebes", "Bebês")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Bagagem</label>
          <input type="text" disabled={disabled} value={value.bagagem} onChange={(e) => set("bagagem", e.target.value)} placeholder="1 despachada por pessoa" className={inputClassName} />
        </div>
        <div>
          <label className={labelClassName}>Flexibilidade de datas</label>
          <input type="text" disabled={disabled} value={value.flexibilidade} onChange={(e) => set("flexibilidade", e.target.value)} placeholder="± 3 dias" className={inputClassName} />
        </div>
      </div>
      <div>
        <label className={labelClassName}>Orçamento do cliente (R$)</label>
        <input type="text" inputMode="decimal" disabled={disabled} value={value.orcamento} onChange={(e) => set("orcamento", e.target.value)} placeholder="Opcional" className={inputClassName} />
      </div>
      <div>
        <label className={labelClassName}>Quem vai cotar?</label>
        <select
          disabled={disabled}
          value={value.responsavelId ?? ""}
          onChange={(e) => set("responsavelId", e.target.value || null)}
          className={inputClassName}
        >
          <option value="">Eu mesmo cotar</option>
          {closers.filter((c) => c.id !== euId).map((c) => (
            <option key={c.id} value={c.id}>Repassar para {c.name}</option>
          ))}
        </select>
        {value.responsavelId && (
          <p className="mt-1 text-[10.5px] text-gray-500">A cotação vai pro quadro de Cotações do closer, marcada como repassada.</p>
        )}
      </div>
    </div>
  );
}
