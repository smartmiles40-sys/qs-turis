// src/venda/ExtratoAnalise.tsx
// -----------------------------------------------------------------------------
// O EXTRATO da análise pós-venda (0230): status da venda, contagem, cada item
// (OK / falta emitir / divergente / fora do apresentado) e os riscos com nível
// e motivo. Usado na etapa "Análise pós-venda" do Subir venda e no painel
// "Vendas com pendência".
// -----------------------------------------------------------------------------
import { Aviso, Etiqueta } from "@/rel/ui";
import { TIPOS, dataBr, type TipoItem } from "@/propostas/lib";
import { NIVEL, SITUACAO, STATUS_ANALISE, type LinhaExtrato, type Risco, type Situacao, type StatusAnalise } from "./analise";

const ORDEM: Situacao[] = ["falta", "divergente", "extra", "ok"];
const FONTE: Record<string, string> = { trecho: "trecho da viagem", documento: "arquivo da viagem", venda: "item emitido", expedicao: "vaga na expedição" };

export function EtiquetaStatus({ status }: { status: StatusAnalise }) {
  const s = STATUS_ANALISE[status] ?? STATUS_ANALISE.em_analise;
  return <Etiqueta tom={s.tom}>{s.rotulo}</Etiqueta>;
}

export interface ExtratoProps {
  status: StatusAnalise;
  base?: string | null;
  contagens: { ok: number; falta: number; divergente: number; extra: number; total: number };
  linhas: LinhaExtrato[];
  riscos: Risco[];
  resumo?: string | null;
  proposta?: { numero?: number; opcao?: string } | null;
  ia?: { usada: boolean; aviso?: string | null; texto?: string | null } | null;
}

export default function ExtratoAnalise({ status, base, contagens, linhas, riscos, resumo, proposta, ia }: ExtratoProps) {
  const porSit = ORDEM.map((s) => [s, linhas.filter((l) => l.situacao === s)] as const).filter(([, l]) => l.length);
  return (
    <div className="space-y-3">
      <div className="rel-card p-4 flex flex-wrap items-center gap-3">
        <EtiquetaStatus status={status} />
        <span className="text-[13.5px] flex-1 min-w-[220px]" style={{ color: "var(--ink)" }}>{resumo}</span>
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
          {base === "proposta"
            ? `Conferido contra a proposta${proposta?.numero ? ` nº ${proposta.numero}` : ""}${proposta?.opcao ? ` — "${proposta.opcao}"` : ""}`
            : "Sem proposta aprovada: conferido contra os itens da venda"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(["ok", "falta", "divergente", "extra"] as Situacao[]).map((s) => (
          <div key={s} className="rel-card px-3 py-2">
            <div className="text-[20px] font-bold" style={{ color: contagens[s] ? SITUACAO[s].cor : "var(--ink3)" }}>{contagens[s] ?? 0}</div>
            <div className="text-[12px]" style={{ color: "var(--ink3)" }}>{SITUACAO[s].rotulo}</div>
          </div>
        ))}
      </div>

      {porSit.map(([s, ls]) => (
        <section key={s} className="rel-card p-4">
          <h4 className="text-[13px] font-bold mb-2" style={{ color: SITUACAO[s].cor }}>{SITUACAO[s].icone} {SITUACAO[s].rotulo} ({ls.length})</h4>
          <ul className="space-y-2">
            {ls.map((l) => (
              <li key={l.chave} className="text-[13px]" style={{ color: "var(--ink)" }}>
                <div className="flex flex-wrap gap-x-2">
                  <span aria-hidden>{TIPOS[l.tipo as TipoItem]?.emoji ?? "•"}</span>
                  <b>{l.nome}</b>
                  {l.apresentado?.data_inicio && <span style={{ color: "var(--ink3)" }}>{dataBr(l.apresentado.data_inicio)}{l.apresentado.data_fim && l.apresentado.data_fim !== l.apresentado.data_inicio ? ` → ${dataBr(l.apresentado.data_fim)}` : ""}</span>}
                  {l.voo_interno && <Etiqueta tom="aviso">voo interno</Etiqueta>}
                </div>
                {l.emitido && (
                  <div className="text-[12px] pl-6" style={{ color: "var(--ink3)" }}>
                    Emitido: {l.emitido.nome}{l.emitido.localizador ? ` · loc. ${l.emitido.localizador}` : ""} ({FONTE[l.emitido.fonte] ?? l.emitido.fonte})
                  </div>
                )}
                {l.motivos.length > 0 && <div className="text-[12px] pl-6" style={{ color: SITUACAO[s].cor }}>{l.motivos.join(" · ")}</div>}
                {l.nota && <div className="text-[12px] pl-6" style={{ color: "var(--ink3)" }}>{l.nota}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="rel-card p-4">
        <h4 className="text-[13px] font-bold mb-2" style={{ color: "var(--ink)" }}>Risco da venda</h4>
        {riscos.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum risco apontado.</p> : (
          <ul className="space-y-1.5">
            {riscos.map((r, n) => (
              <li key={n} className="text-[13px] flex gap-2" style={{ color: "var(--ink)" }}>
                <span className="font-bold shrink-0 w-14" style={{ color: NIVEL[r.nivel]?.cor }}>{NIVEL[r.nivel]?.rotulo ?? r.nivel}</span>
                <span className="flex-1">{r.motivo}</span>
                {r.fonte === "ia" && <span className="text-[11px] shrink-0" style={{ color: "var(--ink3)" }}>IA</span>}
              </li>
            ))}
          </ul>
        )}
        {ia?.usada && ia.texto && <p className="text-[12.5px] mt-3 pt-3 border-t" style={{ color: "var(--ink2)", borderColor: "var(--line)" }}><b>Parecer da IA:</b> {ia.texto}</p>}
      </section>
      {ia && !ia.usada && ia.aviso && <Aviso>{ia.aviso}</Aviso>}
    </div>
  );
}
