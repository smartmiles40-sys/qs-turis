// Aba "Divisões" da expedição (app antigo: app/(app)/expedicoes/[id]/grupos/ —
// rota órfã sem aba — + "Adicionar/Remover divisão por grupos" da aba Passageiros).
// Subgrupos (G1, G2, grupos de voo…) com datas próprias, quem está em cada um e a
// chave da divisão G1/G2 (só admin). "Remover divisão" aqui apaga só G1 e G2 — no
// antigo apagava TODOS os grupos, inclusive os usados pelos voos do ExpedAmigo.
import { useCallback, useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { Botao, Entrada, Modal } from "@/rel/ui";
import { useExp } from "../../contexto";
import { Carregando, useAoVivo } from "../../ui";
import {
  ativarDivisao, carregarDivisoes, criarGrupo, removerDivisao, reordenarGrupos, souAdmin, usaDivisao, type DadosDivisoes,
} from "../../divisoes/dados";
import { CartaoGrupo, Membros } from "../../divisoes/Componentes";
import type { PropsAba } from "../ExpedicaoDetalhe";

export default function AbaGrupos({ exp, onMudou }: PropsAba) {
  const { somenteLeitura, avisar } = useExp();
  const [d, setD] = useState<DadosDivisoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [novo, setNovo] = useState("");
  const [criando, setCriando] = useState(false);
  const [confirmarRemover, setConfirmarRemover] = useState(false);
  const [mexendo, setMexendo] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const carregar = useCallback(async () => {
    try { setD(await carregarDivisoes(exp.id)); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, [exp.id]);
  useEffect(() => { void carregar(); souAdmin().then(setAdmin); }, [carregar]);
  useAoVivo([
    { tabela: "grupos_expedicao", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "passageiros", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "expedicao_voos", filtro: `expedicao_id=eq.${exp.id}` },
  ], carregar);
  const mudou = useCallback(() => { void carregar(); onMudou(); }, [carregar, onMudou]);

  if (erro) return <p className="py-10 text-center text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>;
  if (!d) return <Carregando />;

  const { grupos, pax, voosPorGrupo } = d;
  const divisao = usaDivisao(grupos);
  const paxPorGrupo = (id: string) => pax.filter((p) => p.grupo_id === id && p.status_reserva !== "Cancelado").length;
  const paxNaDivisao = pax.filter((p) => p.grupo_id && grupos.some((g) => g.id === p.grupo_id && (g.nome === "G1" || g.nome === "G2"))).length;
  const voosNaDivisao = grupos.filter((g) => g.nome === "G1" || g.nome === "G2").reduce((s, g) => s + (voosPorGrupo.get(g.id) ?? 0), 0);

  const adicionar = async () => {
    setCriando(true);
    try { await criarGrupo(exp.id, novo, grupos); setNovo(""); avisar("Grupo criado"); mudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao criar", "erro"); }
    finally { setCriando(false); }
  };

  const fimArraste = async (ev: DragEndEvent) => {
    if (!ev.over || ev.active.id === ev.over.id) return;
    const lista = grupos.map((g) => g.id);
    const nova = arrayMove(lista, lista.indexOf(String(ev.active.id)), lista.indexOf(String(ev.over.id)));
    setD({ ...d, grupos: nova.map((id, i) => ({ ...grupos.find((g) => g.id === id)!, ordem: i + 1 })) });
    try { await reordenarGrupos(nova); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar a ordem", "erro"); void carregar(); }
  };

  const ligar = async () => {
    setMexendo(true);
    try { await ativarDivisao(exp.id); avisar("Divisão G1/G2 ligada"); mudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } finally { setMexendo(false); }
  };
  const desligar = async () => {
    setMexendo(true);
    try { const n = await removerDivisao(exp.id); setConfirmarRemover(false); avisar(`Divisão removida · ${n} passageiro(s) ficaram sem grupo`); mudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } finally { setMexendo(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Divisões e grupos</h2>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Crie subgrupos (G1, G2, G3…) com datas próprias dentro desta expedição.</p>
        </div>
        {!somenteLeitura && (
          <div className="flex items-center gap-2">
            <Entrada placeholder="Nome do grupo (ex: G1)" value={novo} maxLength={60} style={{ width: 200 }}
              onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void adicionar(); }} />
            <Botao variante="primario" disabled={criando} onClick={adicionar}>+ Adicionar</Botao>
          </div>
        )}
      </div>

      <section className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" style={{ border: "1px solid var(--line)", background: divisao ? "var(--rel-soft)" : "var(--card2)" }}>
        <div className="flex-1 min-w-[220px]">
          <p className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Divisão G1/G2 {divisao ? "ligada" : "desligada"}</p>
          <p className="text-[12px]" style={{ color: "var(--ink2)" }}>
            {divisao
              ? "Passageiros, Rooming e Área do Líder separam a turma em Grupo 1 e Grupo 2."
              : "Liga quando a turma viaja em duas levas. Vale só com grupos chamados exatamente “G1” e “G2”."}
          </p>
        </div>
        {!somenteLeitura && admin && (divisao
          ? <Botao variante="perigo" disabled={mexendo} onClick={() => setConfirmarRemover(true)}>Remover divisão</Botao>
          : <Botao disabled={mexendo} onClick={ligar}>{mexendo ? "Ligando…" : "Adicionar divisão por grupos"}</Botao>)}
        {!somenteLeitura && !admin && <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Só o admin liga ou desliga.</span>}
      </section>

      {grupos.length === 0 ? (
        <div className="rel-card py-12 text-center">
          <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Nenhum grupo ainda</p>
          <p className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>Útil quando a mesma expedição tem várias saídas com datas diferentes.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={fimArraste}>
          <SortableContext items={grupos.map((g) => g.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {grupos.map((g) => (
                <CartaoGrupo key={g.id} g={g} qtdPax={paxPorGrupo(g.id)} qtdVoos={voosPorGrupo.get(g.id) ?? 0} divisaoAtiva={divisao} onMudou={mudou} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {grupos.length > 0 && <Membros grupos={grupos} pax={pax} onMudou={mudou} />}

      <Modal aberto={confirmarRemover} titulo="Remover a divisão G1/G2?" onFechar={() => setConfirmarRemover(false)} largura={460}
        rodape={<><Botao onClick={() => setConfirmarRemover(false)}>Cancelar</Botao><Botao variante="perigo" disabled={mexendo} onClick={desligar}>{mexendo ? "Removendo…" : "Remover divisão"}</Botao></>}>
        <div className="space-y-2 text-[13.5px]" style={{ color: "var(--ink2)" }}>
          <p>Apaga só os grupos <b>G1</b> e <b>G2</b> desta expedição e tira o grupo dos <b>{paxNaDivisao}</b> passageiro(s) que estavam neles. A coluna Grupo some. Não afeta os quartos já montados.</p>
          {grupos.some((g) => g.nome !== "G1" && g.nome !== "G2") && <p>Os outros grupos (ex.: grupos de voo) continuam como estão.</p>}
          {voosNaDivisao > 0 && <p style={{ color: "var(--warn-ink)" }}><b>{voosNaDivisao} voo(s)</b> marcados “Só G1/G2” no ExpedAmigo passam a aparecer pra todos os viajantes.</p>}
        </div>
      </Modal>
    </div>
  );
}
