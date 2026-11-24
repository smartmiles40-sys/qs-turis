// src/venda/EmissaoDoItem.tsx
// -----------------------------------------------------------------------------
// "QUANDO EMITE?" em cada item do Subir venda (24/11/2026). Bruno: o trem-bala
// só abre 3 meses antes — o QS tem que saber disso desde a venda pra lembrar o
// Relacionamento na hora certa (aba Emissão futura + Rotina).
//
// Grava em dados: emite_depois ("sim"/"nao"), emitir_de, emitir_ate e
// emissao_auto ("sim" enquanto as datas forem as da regra — aí elas
// acompanham a data de uso; mexeu à mão, para de recalcular).
// Item que tem regra com "abre X dias antes" já nasce como emissão futura.
// -----------------------------------------------------------------------------
import { useEffect } from "react";
import { Campo, Entrada } from "@/rel/ui";
import { regraPara, sugerirDatas, textoDoItem, type RegraEmissao } from "@/lib/emissao";

export default function EmissaoDoItem({ tipo, nome, uso, dados, regras, onDados }: {
  tipo: string; nome: string; uso: string; dados: Record<string, string>; regras: RegraEmissao[];
  onDados: (d: Record<string, string>) => void;
}) {
  const regra = regraPara(regras, tipo, textoDoItem(nome, dados));
  const depois = dados.emite_depois === "sim";
  const auto = dados.emissao_auto === "sim";

  // A regra liga sozinha (só se ninguém decidiu ainda) e recalcula enquanto as datas forem automáticas.
  useEffect(() => {
    if (!regra || !uso) return;
    const s = sugerirDatas(regra, uso);
    const de = s.emitir_de ?? "", ate = s.emitir_ate ?? "";
    if (dados.emite_depois === undefined || dados.emite_depois === "") {
      if (regra.abre_dias == null) return;
      onDados({ ...dados, emite_depois: "sim", emitir_de: de, emitir_ate: ate, emissao_auto: "sim" });
    } else if (depois && auto && (dados.emitir_de !== de || dados.emitir_ate !== ate)) {
      onDados({ ...dados, emitir_de: de, emitir_ate: ate });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regra?.id, uso, depois, auto]);

  function alternar(sim: boolean) {
    if (!sim) { onDados({ ...dados, emite_depois: "nao", emitir_de: "", emitir_ate: "", emissao_auto: "" }); return; }
    const s = sugerirDatas(regra, uso || null);
    onDados({ ...dados, emite_depois: "sim", emitir_de: s.emitir_de ?? "", emitir_ate: s.emitir_ate ?? "", emissao_auto: s.emitir_de || s.emitir_ate ? "sim" : "" });
  }

  const explica = regra
    ? `${regra.rotulo}: ${regra.abre_dias != null ? `abre ${regra.abre_dias} dias antes` : "pode emitir quando quiser"}${regra.limite_dias != null ? `, emitir até ${regra.limite_dias} dias antes` : ""}.`
    : null;

  return (
    <div className="sm:col-span-2 rounded-lg p-3 space-y-2" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
      <label className="flex items-start gap-2 text-[13px] cursor-pointer" style={{ color: "var(--ink2)" }}>
        <input type="checkbox" className="mt-0.5" checked={depois} onChange={(e) => alternar(e.target.checked)} />
        <span>
          <b>Emissão futura</b> — só dá pra emitir mais perto da data (ex.: trem-bala, ingresso com venda por data)
          {explica && <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>Regra {explica}</span>}
        </span>
      </label>
      {depois && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Abre para emissão em" dica={uso ? undefined : "Coloque a data de uso acima que o QS calcula."}>
            <Entrada type="date" value={dados.emitir_de ?? ""} onChange={(e) => onDados({ ...dados, emitir_de: e.target.value, emissao_auto: "" })} />
          </Campo>
          <Campo rotulo="Emitir até" dica="Vazio = até a data de uso.">
            <Entrada type="date" value={dados.emitir_ate ?? ""} onChange={(e) => onDados({ ...dados, emitir_ate: e.target.value, emissao_auto: "" })} />
          </Campo>
          <p className="sm:col-span-2 text-[12px]" style={{ color: "var(--ink3)" }}>
            O Relacionamento recebe a atividade na rotina quando a emissão abrir.
          </p>
        </div>
      )}
    </div>
  );
}
