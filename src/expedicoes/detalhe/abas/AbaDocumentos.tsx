// Aba "Documentos" da expedição (app antigo: expedicoes/[id]/documentos/page.tsx).
// 1) Drive da expedição — arquivos compartilhados, sem passageiro (os anexos do
//    portal e os documentos do líder também moram aqui).
// 2) Status de documentos por passageiro — só leitura: passaporte, validade,
//    visto, seguro, apólice, voo nacional e o status geral (mesma regra do antigo:
//    sem passaporte ou passaporte que vence < 180 dias depois do embarque = Crítico;
//    seguro não emitido ou visto pendente = Pendente).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PropsAba } from "../ExpedicaoDetalhe";
import { useExp } from "../../contexto";
import { Cartao, Carregando, Selo, useAoVivo, type Tom } from "../../ui";
import { lerPorIds, lerTudo } from "../../lib/banco";
import type { DocumentoRow, PassageiroRow } from "../../lib/database";
import { daysUntil, formatDate } from "../../lib/utils";
import Drive from "../../drive/Drive";

type StatusGeral = "OK" | "Pendente" | "Crítico";

export default function AbaDocumentos({ exp }: PropsAba) {
  const { ir, avisar } = useExp();
  const [pax, setPax] = useState<PassageiroRow[] | null>(null);
  const [docs, setDocs] = useState<DocumentoRow[]>([]);

  const carregar = useCallback(async () => {
    try {
      const p = await lerTudo<PassageiroRow>("passageiros", (q) => q.eq("expedicao_id", exp.id));
      p.sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, "pt-BR"));
      const d = p.length ? await lerPorIds<DocumentoRow>("documentos", "passageiro_id", p.map((x) => x.id)) : [];
      setPax(p); setDocs(d);
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao carregar", "erro"); setPax([]); }
  }, [exp.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "passageiros", filtro: `expedicao_id=eq.${exp.id}` }, { tabela: "documentos" }], carregar, 800);

  const docPorPax = useMemo(() => new Map(docs.map((d) => [d.passageiro_id, d])), [docs]);
  const embarqueDias = daysUntil(exp.data_embarque) ?? 0;

  function statusGeral(p: PassageiroRow): StatusGeral {
    const d = docPorPax.get(p.id);
    if (!p.passaporte) return "Crítico";
    const v = daysUntil(p.validade_passaporte);
    if (v != null && v - embarqueDias < 180) return "Crítico";
    if (d?.seguro_status !== "Emitido") return "Pendente";
    if (d?.visto_necessario && d?.status_visto !== "Aprovado") return "Pendente";
    return "OK";
  }
  const tomStatus: Record<StatusGeral, Tom> = { OK: "ok", Pendente: "aviso", Crítico: "erro" };
  const resumo = useMemo(() => {
    const c = { OK: 0, Pendente: 0, Crítico: 0 } as Record<StatusGeral, number>;
    for (const p of pax ?? []) if (p.status_reserva !== "Cancelado") c[statusGeral(p)]++;
    return c;
  }, [pax, docPorPax]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <Cartao titulo={<>Drive da expedição<span className="block text-[11.5px] font-normal mt-0.5" style={{ color: "var(--ink3)" }}>
        Arquivos compartilhados (não vinculados a um passageiro). Pra anexar algo de um passageiro específico, abra o perfil dele em Passageiros.</span></>}>
        <Drive expedicaoId={exp.id} />
      </Cartao>

      <section>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <div className="flex-1 min-w-[200px]">
            <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Status de documentos por passageiro</h2>
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{pax?.length ?? 0} passageiro(s)</p>
          </div>
          {pax && pax.length > 0 && (
            <div className="flex gap-1.5">
              <Selo tom="ok">{resumo.OK} OK</Selo>
              <Selo tom="aviso">{resumo.Pendente} pendente(s)</Selo>
              <Selo tom="erro">{resumo.Crítico} crítico(s)</Selo>
            </div>
          )}
        </div>
        {pax === null ? <Carregando /> : (
          <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
            <table className="w-full text-[12.5px]">
              <thead style={{ background: "var(--card2)" }}>
                <tr>
                  {["Passageiro", "Passaporte", "Validade", "Visto", "Status visto", "Seguro", "Apólice", "Voos nac.", "Status geral"].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap px-2.5 py-2" style={{ color: "var(--ink3)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pax.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8" style={{ color: "var(--ink3)" }}>Sem passageiros nessa expedição.</td></tr>
                ) : pax.map((p) => {
                  const d = docPorPax.get(p.id);
                  const v = daysUntil(p.validade_passaporte);
                  const alertaValidade = v != null && v - embarqueDias < 180;
                  const sg = statusGeral(p);
                  const perfil = () => ir("expedicoes", `${exp.id}/passageiros/pax/${p.id}`);
                  return (
                    <tr key={p.id} className="border-t rel-linha" style={{ borderColor: "var(--line)", opacity: p.status_reserva === "Cancelado" ? 0.6 : 1 }}>
                      <td className="px-2.5 py-1.5 font-semibold whitespace-nowrap">
                        <button type="button" className="hover:underline text-left" style={{ color: "var(--ink)" }} onClick={perfil}>{p.nome_completo}</button>
                        {p.status_reserva === "Cancelado" && <span className="ml-1.5"><Selo tom="erro">Cancelado</Selo></span>}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-[12px]">{p.passaporte ?? <span style={{ color: "var(--err-ink)" }}>Falta</span>}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap" style={alertaValidade ? { color: "var(--err-ink)", fontWeight: 600 } : undefined}>{p.validade_passaporte ? formatDate(p.validade_passaporte) : "—"}</td>
                      <td className="px-2.5 py-1.5">{d?.visto_necessario ? <Selo tom="aviso">Sim</Selo> : <Selo>Não</Selo>}</td>
                      <td className="px-2.5 py-1.5" style={{ color: "var(--ink2)" }}>{d?.status_visto ?? "—"}</td>
                      <td className="px-2.5 py-1.5"><Selo tom={d?.seguro_status === "Emitido" ? "ok" : d?.seguro_status === "Solicitado" ? "aviso" : "neutro"}>{d?.seguro_status ?? "—"}</Selo></td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        {d?.apolice_url ? (
                          <a href={d.apolice_url} target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "var(--rel-ink)" }}>Ver</a>
                        ) : (
                          <button type="button" onClick={perfil} className="text-[11.5px] hover:underline" style={{ color: "var(--ink3)" }}>Anexar no perfil</button>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5" style={{ color: "var(--ink2)" }}>{p.voo_nacional_necessario ? "Sim" : "—"}</td>
                      <td className="px-2.5 py-1.5"><Selo tom={tomStatus[sg]}>{sg}</Selo></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
