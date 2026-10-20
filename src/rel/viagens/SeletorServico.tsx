// src/rel/viagens/SeletorServico.tsx
// -----------------------------------------------------------------------------
// O que foi vendido (0148, Bruno 20/10). O Bitrix diz pelo "Tipo de venda"; quando
// ele não diz (ou diz "Outros"), o time escolhe aqui. A escolha decide se a venda
// entra no painel e na Esteira:
//   Pacote / Aéreo / Cruzeiro → Esteira completa
//   Hotel / Passeio           → Revisão + D-3
//   Seguro / Concierge / …    → só na ficha do cliente
// -----------------------------------------------------------------------------
import { useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { ACOMPANHAMENTOS, SERVICOS, acompanhamentoDe, classificarServico, type Servico, type Viagem } from "../lib/viagens";

const ORDEM: Servico[] = ["pacote", "aereo", "cruzeiro", "hospedagem", "passeio", "expedicao", "seguro", "concierge", "conta_liminar", "outro"];

export default function SeletorServico({ v, onMudou, compacto = false }: { v: Pick<Viagem, "id" | "servico" | "servico_manual" | "acompanhamento">; onMudou: () => void; compacto?: boolean }) {
  const { currentUser } = useQsAuth();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(valor: string) {
    setSalvando(true); setErro(null);
    try { await classificarServico(v.id, (valor || null) as Servico | null, currentUser?.id ?? ""); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  const falta = v.acompanhamento === "classificar";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <select className="rel-input" aria-label="O que foi vendido" disabled={salvando}
        style={{ width: "auto", padding: compacto ? "4px 8px" : undefined, fontSize: 12.5, ...(falta ? { borderColor: "#D97706", background: "rgba(245,158,11,.08)" } : {}) }}
        value={v.servico ?? ""} onChange={(e) => void escolher(e.target.value)}>
        {falta && <option value="">Escolha o que foi vendido…</option>}
        {ORDEM.map((s) => <option key={s} value={s}>{SERVICOS[s]} — {ACOMPANHAMENTOS[acompanhamentoDe(s)]}</option>)}
      </select>
      {v.servico_manual && !compacto && (
        <button className="text-[11.5px] underline" style={{ color: "var(--ink3)" }} disabled={salvando} onClick={() => void escolher("")}
          title="Volta pro que o Bitrix diz no Tipo de venda">usar o do Bitrix</button>
      )}
      {erro && <span className="text-[11.5px]" style={{ color: "#DC2626" }}>{erro}</span>}
    </span>
  );
}
