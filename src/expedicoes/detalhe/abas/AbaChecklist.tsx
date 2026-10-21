// Aba "Checklist" da expedição (app antigo: app/(app)/expedicoes/[id]/checklist/
// page.tsx + ChecklistTabela.tsx + NovoChecklistDrawer.tsx). Processos por fase de
// antecedência ao embarque, com subtarefas; visões Timeline | Gráfico | Kanban;
// estado vazio gera o checklist padrão (23 processos) numa tacada só (0169).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../../contexto";
import { Carregando, useAoVivo } from "../../ui";
import { faseAtualChecklist } from "../../lib/constants";
import { daysUntil } from "../../lib/utils";
import type { ChecklistItemRow } from "../../lib/database";
import { gerarChecklistPadrao, listarChecklist, reordenar } from "../../checklist/dados";
import { ChipsFases, Grafico, Kanban, Tabela, Triagem } from "../../checklist/Visoes";
import { GavetaTarefa, type ModoGaveta } from "../../checklist/GavetaTarefa";
import type { PropsAba } from "../ExpedicaoDetalhe";

type Visao = "timeline" | "grafico" | "kanban";
const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "timeline", rotulo: "☰ Timeline" }, { id: "grafico", rotulo: "▥ Gráfico" }, { id: "kanban", rotulo: "▦ Kanban" },
];

export default function AbaChecklist({ exp, onMudou }: PropsAba) {
  const { somenteLeitura, usuarios, avisar } = useExp();
  const [itens, setItens] = useState<ChecklistItemRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>("timeline");
  const [gaveta, setGaveta] = useState<ModoGaveta | null>(null);
  const [gerando, setGerando] = useState(false);

  const carregar = useCallback(async () => {
    try { setItens(await listarChecklist(exp.id)); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, [exp.id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "checklist_itens", filtro: `expedicao_id=eq.${exp.id}` }], carregar, 300);

  const mudou = useCallback(() => { void carregar(); onMudou(); }, [carregar, onMudou]);
  const mapaUsuarios = useMemo(() => new Map(usuarios.map((u) => [u.id, u])), [usuarios]);
  const faseAtual = faseAtualChecklist(daysUntil(exp.data_embarque));

  const reordenarOtimista = async (ids: string[]) => {
    const pos = new Map(ids.map((id, i) => [id, i + 1]));
    setItens((cur) => cur?.map((i) => (pos.has(i.id) ? { ...i, ordem: pos.get(i.id)! } : i)) ?? cur);
    try { await reordenar(ids); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar nova ordem", "erro"); void carregar(); }
  };

  const gerar = async () => {
    setGerando(true);
    try {
      const n = await gerarChecklistPadrao(exp, usuarios);
      avisar(`Checklist criado · ${n} itens`);
      mudou();
    } catch (e) { avisar(e instanceof Error ? `Não foi possível gerar: ${e.message}` : "Não foi possível gerar", "erro"); }
    finally { setGerando(false); }
  };

  if (erro) return <p className="py-10 text-center text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>;
  if (!itens) return <Carregando />;

  const gavetaEl = <GavetaTarefa expedicaoId={exp.id} modo={gaveta} itens={itens} onFechar={() => setGaveta(null)} onSalvo={() => { setGaveta(null); mudou(); }} />;

  if (itens.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ border: "1px dashed var(--line)", background: "var(--card2)" }}>
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full text-[20px]" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>✦</div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Nenhum processo cadastrado</h3>
        <p className="mx-auto mt-1 max-w-md text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Gere o checklist padrão com os <b>23 processos operacionais</b> da expedição, organizados nas 5 fases de antecedência.
          Os prazos são calculados automaticamente a partir da data de embarque.
        </p>
        {!somenteLeitura && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Botao variante="primario" onClick={gerar} disabled={gerando}>{gerando ? "Gerando…" : "✦ Gerar checklist padrão"}</Botao>
            <Botao onClick={() => setGaveta({ tipo: "nova" })}>+ Tarefa avulsa</Botao>
          </div>
        )}
        {!exp.data_embarque && (
          <p className="mt-3 text-[11.5px]" style={{ color: "var(--warn-ink)" }}>Defina a data de embarque da expedição para prazos precisos (sem ela, os prazos ficam em branco).</p>
        )}
        {gavetaEl}
      </div>
    );
  }

  const topo = itens.filter((i) => !i.parent_id);
  const concluidos = topo.filter((i) => i.status === "Concluído").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Checklist de processos</h2>
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: "#16A34A" }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#16A34A" }} />ao vivo</span>
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {concluidos}/{topo.length} processos concluídos
            {faseAtual && <> · fase atual: <b style={{ color: "var(--ink)" }}>{faseAtual}</b></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }} role="tablist" aria-label="Visão">
            {VISOES.map((v) => (
              <button key={v.id} role="tab" aria-selected={visao === v.id} onClick={() => setVisao(v.id)} className="px-2.5 py-1.5 text-[12px] font-semibold"
                style={visao === v.id ? { background: "var(--ink)", color: "var(--bg)" } : { background: "var(--card)", color: "var(--ink2)" }}>{v.rotulo}</button>
            ))}
          </div>
          {!somenteLeitura && <Botao variante="primario" onClick={() => setGaveta({ tipo: "nova" })}>+ Nova tarefa</Botao>}
        </div>
      </div>

      <Triagem itens={itens} usuarios={mapaUsuarios} />
      <ChipsFases itens={topo} faseAtual={faseAtual} />

      {visao === "timeline" ? (
        <Tabela itens={itens} usuarios={mapaUsuarios} faseAtual={faseAtual} onMudou={mudou} onReordenar={reordenarOtimista}
          onEditar={(item) => setGaveta({ tipo: "editar", item })} onSubtarefa={(pai) => setGaveta({ tipo: "sub", pai })} />
      ) : visao === "grafico" ? (
        <Grafico itens={topo} usuarios={mapaUsuarios} faseAtual={faseAtual} onMudou={mudou} />
      ) : (
        <Kanban itens={topo} usuarios={mapaUsuarios} />
      )}
      {!somenteLeitura && visao === "timeline" && (
        <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Dica: arraste pelo ⠿ pra mudar a ordem dentro da fase (ou das subtarefas dentro do processo). Pra trocar de fase, use ✎ Editar.</p>
      )}
      {gavetaEl}
    </div>
  );
}
