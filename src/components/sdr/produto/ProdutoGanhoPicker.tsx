// src/components/sdr/produto/ProdutoGanhoPicker.tsx
// -----------------------------------------------------------------------------
// Seletor do PRODUTO no desfecho do SDR (spec 06/11). 4 chips grandes, um clique.
// O produto decide a rota (produto_rota): reunião → agendamento; cotação →
// formulário de cotação (FormularioCotacao). Expedição ganha um campo OPCIONAL
// com a expedição específica (lista do Operacional).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import {
  PRODUTOS, ROTA_PADRAO, mesAno,
  type EscolhaProduto, type ExpedicaoAVenda, type ProdutoTipo, type Rota,
} from "@/lib/qs/produtoGanho";
import { fetchExpedicoesAVenda } from "@/lib/qs/produtoGanhoDados";

export default function ProdutoGanhoPicker({
  value,
  onChange,
  onExpedicoes,
  rotas = ROTA_PADRAO,
  soRotaReuniao = false,
  disabled = false,
  cor = "#16A34A",
  labelClassName = "text-xs font-medium text-gray-500 block mb-1",
  inputClassName = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none",
}: {
  value: EscolhaProduto;
  onChange: (v: EscolhaProduto) => void;
  /** Devolve a lista carregada (pro título da reunião usar o nome da expedição). */
  onExpedicoes?: (lista: ExpedicaoAVenda[]) => void;
  rotas?: Record<ProdutoTipo, Rota>;
  /** Agendamento pela Agenda: produto de rota cotação não vira reunião (some). */
  soRotaReuniao?: boolean;
  disabled?: boolean;
  cor?: string;
  labelClassName?: string;
  inputClassName?: string;
}) {
  const [expedicoes, setExpedicoes] = useState<ExpedicaoAVenda[] | null>(null);

  useEffect(() => {
    if (value.tipo !== "expedicao" || expedicoes) return;
    let vivo = true;
    fetchExpedicoesAVenda().then((l) => {
      if (!vivo) return;
      setExpedicoes(l);
      onExpedicoes?.(l);
    });
    return () => { vivo = false; };
  }, [value.tipo, expedicoes, onExpedicoes]);

  const opcoes = soRotaReuniao ? PRODUTOS.filter((p) => rotas[p.tipo] === "reuniao") : PRODUTOS;
  const rotaAtual = value.tipo ? rotas[value.tipo] : null;

  const escolherTipo = (tipo: ProdutoTipo) => {
    if (disabled) return;
    onChange({ tipo, detalhe: tipo === value.tipo ? value.detalhe : "", expedicaoId: null });
  };

  return (
    <div>
      <label className={labelClassName}>
        Produto <span className="text-red-500">*</span>
      </label>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${opcoes.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Produto">
        {opcoes.map((p) => {
          const on = value.tipo === p.tipo;
          return (
            <button
              key={p.tipo}
              type="button"
              role="radio"
              aria-checked={on}
              title={p.dica}
              disabled={disabled}
              onClick={() => escolherTipo(p.tipo)}
              className="py-2.5 rounded-lg text-[13px] font-semibold border transition-colors disabled:opacity-50"
              style={
                on
                  ? { background: cor, borderColor: cor, color: "#fff" }
                  : { background: "#fff", borderColor: "#e5e7eb", color: "#4b5563" }
              }
            >
              {p.rotulo}
            </button>
          );
        })}
      </div>
      {rotaAtual === "cotacao" && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          Este produto não gera reunião: vira uma <b>cotação</b>. Preencha o pedido abaixo — você mesmo cota ou repassa a um closer.
        </p>
      )}

      {value.tipo === "expedicao" && (
        <div className="mt-2.5">
          {expedicoes === null ? (
            <p className="text-[11px] text-gray-400">Carregando as expedições do Operacional…</p>
          ) : (
            <select
              value={value.expedicaoId ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, expedicaoId: e.target.value || null })}
              className={inputClassName}
              aria-label="Qual expedição (opcional)"
            >
              <option value="">Qual expedição? (opcional)</option>
              {expedicoes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}{x.data_embarque && !x.nome.includes(String(x.data_embarque).slice(0, 4)) ? ` · ${mesAno(x.data_embarque)}` : ""}
                  {x.status && x.status !== "Vendas Abertas" ? ` (${x.status})` : ""}
                </option>
              ))}
            </select>
          )}
          {!value.expedicaoId && (
            <input
              type="text"
              value={value.detalhe}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, detalhe: e.target.value })}
              placeholder="…ou o destino, se ainda não sabe a turma"
              className={`${inputClassName} mt-2`}
              aria-label="Destino da expedição"
            />
          )}
        </div>
      )}

      {(value.tipo === "pacote" || value.tipo === "outros") && rotaAtual === "reuniao" && (
        <input
          type="text"
          value={value.detalhe}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, detalhe: e.target.value })}
          placeholder={value.tipo === "pacote" ? "Destino do pacote (ex.: Japão/China/Coreia)" : "O que é (ex.: Personalizado Maldivas, Concierge)"}
          className={`${inputClassName} mt-2`}
          aria-label="Detalhe do produto"
        />
      )}
    </div>
  );
}
