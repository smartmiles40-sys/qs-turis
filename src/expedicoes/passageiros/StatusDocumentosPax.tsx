// "Status de documentos por passageiro" (era o 2º bloco da aba Documentos do app
// antigo: expedicoes/[id]/documentos/page.tsx). Redesign 29/10: o Drive foi pra aba
// Arquivos (detalhe/abas/AbaArquivos.tsx) e este bloco virou uma seção recolhível
// da aba Passageiros (a matriz já mostra visto/seguro pelos REQUISITOS; aqui fica
// o cadastro antigo da tabela `documentos`, que nada no QS grava mais).
// Só leitura: passaporte, validade, visto, seguro, apólice, voo nacional e o status
// geral — sem passaporte ou validade fora da regra única (lib/passaporte.ts: 6 meses
// depois da VOLTA) = Crítico; seguro não emitido ou visto pendente = Pendente.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useExp } from "../contexto";
import { Carregando, Selo, useAoVivo, type Tom } from "../ui";
import { lerPorIds, lerTudo } from "../lib/banco";
import type { DocumentoRow, ExpedicaoRow, PassageiroRow } from "../lib/database";
import { formatDate } from "../lib/utils";
import { avaliarValidadePassaporte } from "../lib/passaporte";

type StatusGeral = "OK" | "Pendente" | "Crítico";

export default function StatusDocumentosPax({ exp }: { exp: ExpedicaoRow }) {
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
  // Bug corrigido (29/10): o link do passageiro era fixo em "expedicoes" e quebrava em pacote.
  const tela = exp.tipo === "pacote" ? "pacotes" : "expedicoes";
  const validade = (p: PassageiroRow) => avaliarValidadePassaporte(p, exp);

  function statusGeral(p: PassageiroRow): StatusGeral {
    const d = docPorPax.get(p.id);
    if (!p.passaporte) return "Crítico";
    if (p.validade_passaporte && validade(p).estado !== "ok") return "Crítico";
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
      <section>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <div className="flex-1 min-w-[200px]">
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{pax?.length ?? 0} passageiro(s) · cadastro antigo (tabela documentos), só leitura</p>
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
                  const alertaValidade = !!p.validade_passaporte && validade(p).estado !== "ok";
                  const sg = statusGeral(p);
                  const perfil = () => ir(tela, `${exp.id}/passageiros/pax/${p.id}`);
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
