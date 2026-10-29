// src/expedicoes/portal/CopiarDeOutra.tsx
// Janela "Copiar de outra expedição" do ExpedAmigo (regras em ./copiar.ts).
// Sugere primeiro as do MESMO destino que já têm conteúdo, a mais recente no topo.
import { useEffect, useMemo, useState } from "react";
import { Botao, Modal } from "@/rel/ui";
import { useExp } from "../contexto";
import { listarExpedicoes } from "../lib/banco";
import type { ExpedicaoRow } from "../lib/database";
import { formatDate } from "../lib/utils";
import { copiarPortal, PEDACOS_COPIA, resumoDoPortal, type PedacoCopia, type ResumoOrigem } from "./copiar";

const total = (r?: ResumoOrigem) => (r ? r.info + r.avisos + r.passeios + r.extensoes + r.roteiro : 0);

export function CopiarDeOutra({ aberto, onFechar, destino, temRoteiro, onCopiou }: {
  aberto: boolean;
  onFechar: () => void;
  destino: Pick<ExpedicaoRow, "id" | "destino" | "data_embarque">;
  /** A expedição já tem dias no roteiro (aí o roteiro não copia). */
  temRoteiro: boolean;
  onCopiou: () => void;
}) {
  const { avisar } = useExp();
  const [lista, setLista] = useState<ExpedicaoRow[] | null>(null);
  const [resumo, setResumo] = useState<Map<string, ResumoOrigem>>(new Map());
  const [origem, setOrigem] = useState("");
  const [pedacos, setPedacos] = useState<Set<PedacoCopia>>(new Set(["info", "avisos"]));
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    if (!aberto || lista) return;
    void (async () => {
      try {
        const todas = (await listarExpedicoes()).filter((e) => e.id !== destino.id);
        const r = await resumoDoPortal(todas.map((e) => e.id));
        setResumo(r);
        setLista(todas.filter((e) => total(r.get(e.id)) > 0));
      } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao carregar", "erro"); }
    })();
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mesmo destino primeiro; dentro, a mais recente primeiro.
  const opcoes = useMemo(() => [...(lista ?? [])].sort((a, b) =>
    Number(b.destino === destino.destino) - Number(a.destino === destino.destino)
    || (b.data_embarque ?? "").localeCompare(a.data_embarque ?? "")), [lista, destino.destino]);
  useEffect(() => { if (!origem && opcoes[0]) setOrigem(opcoes[0].id); }, [opcoes, origem]);

  const r = resumo.get(origem);
  const qtd = (p: PedacoCopia) => r?.[p] ?? 0;
  const marcar = (p: PedacoCopia) => setPedacos((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const escolhidos = PEDACOS_COPIA.filter((p) => pedacos.has(p.id) && qtd(p.id) > 0 && !(p.id === "roteiro" && temRoteiro));

  async function copiar() {
    setIndo(true);
    try {
      const res = await copiarPortal(origem, destino, escolhidos.map((p) => p.id));
      const feitos = PEDACOS_COPIA.filter((p) => res.copiados[p.id]).map((p) => `${res.copiados[p.id]} em ${p.rotulo}`);
      avisar(`Copiado: ${feitos.join(", ") || "nada"}${res.semAnexo ? ` · ${res.semAnexo} sem o anexo (anexe de novo)` : ""}${res.pulados.length ? ` · ${res.pulados.map((p) => p.motivo).join("; ")}` : ""}`);
      onCopiou();
      onFechar();
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao copiar", "erro"); }
    finally { setIndo(false); }
  }

  return (
    <Modal aberto={aberto} titulo="Copiar de outra expedição" onFechar={onFechar} largura={560}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={indo || !origem || !escolhidos.length} onClick={() => void copiar()}>{indo ? "Copiando…" : "Copiar"}</Botao>
      </>}>
      <div className="space-y-4 text-[13.5px]" style={{ color: "var(--ink)" }}>
        <p style={{ color: "var(--ink3)", margin: 0 }}>Traz o conteúdo de outra edição como ponto de partida. Só acrescenta (não apaga nada daqui). PDFs, vouchers e fotos não vêm — cada edição tem os seus.</p>
        {!lista ? <p>Carregando…</p> : !opcoes.length ? <p>Nenhuma outra expedição tem conteúdo no ExpedAmigo ainda.</p> : (
          <>
            <label className="block">
              <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Copiar de</span>
              <select className="w-full rounded-lg px-3 py-2" style={{ border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" }}
                value={origem} onChange={(e) => setOrigem(e.target.value)}>
                {opcoes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.destino === destino.destino ? "★ " : ""}{e.nome} · {e.codigo}{e.data_embarque ? ` · ${formatDate(e.data_embarque)}` : ""}
                  </option>
                ))}
              </select>
              <span className="block text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>★ = mesmo destino desta</span>
            </label>
            <fieldset className="space-y-1.5" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>O que copiar</legend>
              {PEDACOS_COPIA.map((p) => {
                const n = qtd(p.id);
                const bloqueado = n === 0 || (p.id === "roteiro" && temRoteiro);
                return (
                  <label key={p.id} className="flex items-start gap-2" style={{ opacity: bloqueado ? 0.5 : 1, cursor: bloqueado ? "default" : "pointer" }}>
                    <input type="checkbox" disabled={bloqueado} checked={!bloqueado && pedacos.has(p.id)} onChange={() => marcar(p.id)} style={{ marginTop: 3 }} />
                    <span>
                      <b>{p.rotulo}</b> <span style={{ color: "var(--ink3)" }}>({n})</span>
                      <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
                        {p.id === "roteiro" && temRoteiro ? "esta expedição já tem roteiro — não copia pra não duplicar" : p.dica}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  );
}
