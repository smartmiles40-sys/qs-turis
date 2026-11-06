// src/components/sdr/produto/ProdutoGanhoPicker.tsx
// -----------------------------------------------------------------------------
// Seletor do PRODUTO no "Ganho / Agendou" (Bruno, 06/11/2026).
// 4 botões (Aéreo · Pacote · Expedição · Outros) + o detalhe:
//   · Expedição → lista das expedições à venda no Operacional (ou "outra").
//   · Aéreo     → "Eu mesmo emito" × "Passar pro closer" (só no painel de tarefas;
//                 no agendamento pela Agenda já é sempre pro closer).
//   · Pacote/Outros → destino em texto livre.
// O título da reunião sai daqui (tituloDoProduto) — o mesmo texto que o
// comercial já escrevia à mão no campo "Produto" do Bitrix.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import {
  PRODUTOS, mesAno, type EscolhaProduto, type ExpedicaoAVenda, type ProdutoTipo,
} from "@/lib/qs/produtoGanho";
import { fetchExpedicoesAVenda } from "@/lib/qs/produtoGanhoDados";

const OUTRA = "__outra__";

export default function ProdutoGanhoPicker({
  value,
  onChange,
  onExpedicoes,
  permitirSdrFaz = false,
  disabled = false,
  cor = "#16A34A",
  labelClassName = "text-xs font-medium text-gray-500 block mb-1",
  inputClassName = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none",
}: {
  value: EscolhaProduto;
  onChange: (v: EscolhaProduto) => void;
  /** Devolve a lista carregada (pro título da reunião usar o nome da expedição). */
  onExpedicoes?: (lista: ExpedicaoAVenda[]) => void;
  permitirSdrFaz?: boolean;
  disabled?: boolean;
  cor?: string;
  labelClassName?: string;
  inputClassName?: string;
}) {
  const [expedicoes, setExpedicoes] = useState<ExpedicaoAVenda[] | null>(null);
  const [outra, setOutra] = useState(false);

  useEffect(() => {
    if (value.tipo !== "expedicao" || expedicoes) return;
    let vivo = true;
    fetchExpedicoesAVenda().then((l) => {
      if (!vivo) return;
      setExpedicoes(l);
      onExpedicoes?.(l);
      if (l.length === 0) setOutra(true);
    });
    return () => { vivo = false; };
  }, [value.tipo, expedicoes, onExpedicoes]);

  const escolherTipo = (tipo: ProdutoTipo) => {
    if (disabled) return;
    setOutra(false);
    onChange({ tipo, detalhe: tipo === value.tipo ? value.detalhe : "", expedicaoId: null, quemFaz: "closer" });
  };

  const placeholder: Record<ProdutoTipo, string> = {
    aereo: "Destino / trecho (ex.: Lisboa, São Paulo → Tóquio)",
    pacote: "Destino do pacote (ex.: Japão/China/Coreia)",
    expedicao: "Destino da expedição",
    outros: "O que é (ex.: Personalizado Maldivas, Concierge)",
  };

  return (
    <div>
      <label className={labelClassName}>
        Produto <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Produto">
        {PRODUTOS.map((p) => {
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
              className="py-2 rounded-lg text-[13px] font-semibold border transition-colors disabled:opacity-50"
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

      {value.tipo === "aereo" && permitirSdrFaz && (
        <div className="mt-2.5">
          <span className="text-[11px] font-medium text-gray-500 block mb-1">Quem faz esse aéreo?</span>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { v: "sdr" as const, rotulo: "Eu mesmo emito", sub: "Sem reunião — o lead fica comigo" },
              { v: "closer" as const, rotulo: "Passar pro closer", sub: "Agenda a reunião normal" },
            ]).map((op) => {
              const on = value.quemFaz === op.v;
              return (
                <button
                  key={op.v}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => onChange({ ...value, quemFaz: op.v })}
                  className="px-2.5 py-2 rounded-lg border text-left transition-colors disabled:opacity-50"
                  style={on ? { borderColor: cor, background: `${cor}14` } : { borderColor: "#e5e7eb", background: "#fff" }}
                >
                  <span className="block text-[13px] font-semibold" style={{ color: on ? cor : "#374151" }}>{op.rotulo}</span>
                  <span className="block text-[10.5px] text-gray-500 mt-0.5">{op.sub}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value.tipo === "expedicao" && (
        <div className="mt-2.5">
          {expedicoes === null ? (
            <p className="text-[11px] text-gray-400">Carregando as expedições do Operacional…</p>
          ) : expedicoes.length > 0 ? (
            <select
              value={outra ? OUTRA : value.expedicaoId ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OUTRA) { setOutra(true); onChange({ ...value, expedicaoId: null }); return; }
                setOutra(false);
                onChange({ ...value, expedicaoId: v || null, detalhe: "" });
              }}
              className={inputClassName}
              aria-label="Qual expedição"
            >
              <option value="">Qual expedição?</option>
              {expedicoes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}{x.data_embarque && !x.nome.includes(String(x.data_embarque).slice(0, 4)) ? ` · ${mesAno(x.data_embarque)}` : ""}
                  {x.status && x.status !== "Vendas Abertas" ? ` (${x.status})` : ""}
                </option>
              ))}
              <option value={OUTRA}>Outra / ainda não está na lista…</option>
            </select>
          ) : (
            <p className="text-[11px] text-gray-400 mb-1">Não consegui carregar a lista do Operacional — escreva o destino.</p>
          )}
        </div>
      )}

      {value.tipo && (value.tipo !== "expedicao" || outra) && (
        <input
          type="text"
          value={value.detalhe}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, detalhe: e.target.value })}
          placeholder={placeholder[value.tipo]}
          className={`${inputClassName} mt-2`}
          aria-label="Detalhe do produto"
        />
      )}
    </div>
  );
}
