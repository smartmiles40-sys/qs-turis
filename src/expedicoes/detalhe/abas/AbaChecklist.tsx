// src/expedicoes/detalhe/abas/AbaChecklist.tsx
// -----------------------------------------------------------------------------
// ABA "CHECKLIST" DO COCKPIT (Bruno, 30/10: "o checklist padrão tem que ficar
// DENTRO do cockpit da expedição, como uma ABA, entre Logística e Financeiro").
// Até 29/10 era uma seção recolhível dentro da Logística.
//
// Tarefas da expedição por fase (app antigo: checklist/page.tsx + ChecklistTabela),
// com subtarefas; visões Timeline | Gráfico | Kanban. Novo em 30/10:
//   • filtro "Minhas tarefas" / "Atrasadas" e por setor (PARA QUEM é cada tarefa);
//   • quem marcou feita e quando (0224);
//   • "Editar o padrão" abre o editor do checklist padrão (Ops edita, os outros veem);
//   • quando o padrão ganhou tarefas que esta expedição ainda não tem, um aviso
//     oferece trazê-las (prévia na hora);
//   • "+ Tarefa avulsa" = só desta expedição.
// Estado vazio: gera o checklist pelo padrão do banco (0224) ou, sem ela, pelo
// padrão do código (23 processos, como antes).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../../contexto";
import { Carregando, useAoVivo } from "../../ui";
import { faseAtualChecklist } from "../../lib/constants";
import { daysUntil } from "../../lib/utils";
import { resumoChecklist } from "../../lib/checklistResumo";
import { dataSP } from "../../lib/fase";
import type { ChecklistItemRow } from "../../lib/database";
import { NOME_SETOR, SETORES_CK, estaAtrasada, filtrarChecklist, type FiltroQuem, type SetorCk } from "../../lib/checklist/modelo";
import { gerarChecklistPadrao, listarChecklist, reordenar } from "../../checklist/dados";
import { aplicarModelo, meuId, modeloNoBanco, type LinhaAplicacao } from "../../checklist/modeloDados";
import { ChipsFases, Grafico, Kanban, Tabela, Triagem } from "../../checklist/Visoes";
import { GavetaTarefa, type ModoGaveta } from "../../checklist/GavetaTarefa";
import { EditorPadrao } from "../../checklist/EditorPadrao";
import type { PropsAba } from "../ExpedicaoDetalhe";

type Visao = "timeline" | "grafico" | "kanban";
const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "timeline", rotulo: "☰ Timeline" }, { id: "grafico", rotulo: "▥ Gráfico" }, { id: "kanban", rotulo: "▦ Kanban" },
];

export default function AbaChecklist({ exp, onMudou, cockpit }: PropsAba) {
  const { somenteLeitura, usuarios, avisar } = useExp();
  const [itens, setItens] = useState<ChecklistItemRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>("timeline");
  const [gaveta, setGaveta] = useState<ModoGaveta | null>(null);
  const [gerando, setGerando] = useState(false);
  const [quem, setQuem] = useState<FiltroQuem>("todas");
  const [setor, setSetor] = useState<SetorCk | "">("");
  const [eu, setEu] = useState<string | null>(null);
  const [noBanco, setNoBanco] = useState(false);
  const [faltam, setFaltam] = useState<LinhaAplicacao[]>([]);
  const [verFaltam, setVerFaltam] = useState(false);
  const [editor, setEditor] = useState(false);

  const carregar = useCallback(async () => {
    try { setItens(await listarChecklist(exp.id)); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, [exp.id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "checklist_itens", filtro: `expedicao_id=eq.${exp.id}` }], carregar, 300);
  useEffect(() => { void meuId().then(setEu); void modeloNoBanco().then(setNoBanco); }, []);

  // O padrão tem tarefa que esta expedição ainda não tem? (só com a 0224)
  const conferirPadrao = useCallback(async () => {
    if (!noBanco || somenteLeitura) { setFaltam([]); return; }
    try { setFaltam(await aplicarModelo({ expedicoes: [exp.id], simular: true })); } catch { setFaltam([]); }
  }, [noBanco, somenteLeitura, exp.id]);
  useEffect(() => { void conferirPadrao(); }, [conferirPadrao]);

  const mudou = useCallback(() => { void carregar(); onMudou(); cockpit?.recarregarResumo(); }, [carregar, onMudou, cockpit]);
  const mapaUsuarios = useMemo(() => new Map(usuarios.map((u) => [u.id, u])), [usuarios]);
  const faseAtual = faseAtualChecklist(daysUntil(exp.data_embarque));
  const hoje = dataSP(new Date());
  const filtrando = quem !== "todas" || setor !== "";
  const visiveis = useMemo(() => (itens ? filtrarChecklist(itens, { quem, eu, setor, hoje }) : []), [itens, quem, eu, setor, hoje]);

  const reordenarOtimista = async (ids: string[]) => {
    if (filtrando) { avisar("Tire o filtro pra mudar a ordem", "erro"); return; }
    const pos = new Map(ids.map((id, i) => [id, i + 1]));
    setItens((cur) => cur?.map((i) => (pos.has(i.id) ? { ...i, ordem: pos.get(i.id)! } : i)) ?? cur);
    try { await reordenar(ids); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar nova ordem", "erro"); void carregar(); }
  };

  const gerar = async () => {
    setGerando(true);
    try {
      const n = noBanco
        ? (await aplicarModelo({ expedicoes: [exp.id], simular: false })).length
        : await gerarChecklistPadrao(exp, usuarios);
      avisar(n ? `Checklist criado · ${n} itens` : "O padrão não tem tarefas pra este tipo de produto");
      mudou(); void conferirPadrao();
    } catch (e) { avisar(e instanceof Error ? `Não foi possível gerar: ${e.message}` : "Não foi possível gerar", "erro"); }
    finally { setGerando(false); }
  };

  const trazerDoPadrao = async () => {
    setGerando(true);
    try {
      const n = (await aplicarModelo({ expedicoes: [exp.id], simular: false })).length;
      avisar(`${n} tarefa${n === 1 ? "" : "s"} do padrão adicionada${n === 1 ? "" : "s"}`);
      setVerFaltam(false); mudou(); void conferirPadrao();
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao aplicar o padrão", "erro"); }
    finally { setGerando(false); }
  };

  const editorEl = <EditorPadrao aberto={editor} onFechar={() => setEditor(false)} onAplicado={() => { mudou(); void conferirPadrao(); }} />;
  const botaoPadrao = <Botao onClick={() => setEditor(true)} title="O checklist que toda expedição nova recebe">Editar o padrão</Botao>;

  if (erro) return <p className="py-10 text-center text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>;
  if (!itens) return <Carregando />;

  const gavetaEl = <GavetaTarefa expedicaoId={exp.id} modo={gaveta} itens={itens} comSetor={noBanco} onFechar={() => setGaveta(null)} onSalvo={() => { setGaveta(null); mudou(); }} />;

  if (itens.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ border: "1px dashed var(--line)", background: "var(--card2)" }}>
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full text-[20px]" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>✦</div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Nenhuma tarefa no checklist</h3>
        <p className="mx-auto mt-1 max-w-md text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Gere o checklist pelo <b>padrão</b>: as tarefas de cada fase, já com responsável e prazo calculados a partir da data de embarque.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {!somenteLeitura && <Botao variante="primario" onClick={gerar} disabled={gerando}>{gerando ? "Gerando…" : "✦ Gerar pelo checklist padrão"}</Botao>}
          {!somenteLeitura && <Botao onClick={() => setGaveta({ tipo: "nova" })}>+ Tarefa avulsa</Botao>}
          {botaoPadrao}
        </div>
        {!exp.data_embarque && (
          <p className="mt-3 text-[11.5px]" style={{ color: "var(--warn-ink)" }}>Defina a data de embarque da expedição para prazos precisos (sem ela, os prazos ficam em branco).</p>
        )}
        {gavetaEl}{editorEl}
      </div>
    );
  }

  const topo = visiveis.filter((i) => !i.parent_id);
  // §4.1: a MESMA conta da Saúde e do cabeçalho (lib/checklistResumo.ts) — sempre sobre TODAS as tarefas.
  const resumo = resumoChecklist(itens, hoje);
  const nMinhas = eu ? itens.filter((i) => i.responsavel_id === eu && i.status !== "Concluído").length : 0;
  const nAtrasadas = itens.filter((i) => estaAtrasada(i, hoje)).length;
  const setoresPresentes = SETORES_CK.filter((s) => itens.some((i) => i.setor === s));
  const procFaltam = faltam.filter((l) => !l.o_sub).length;

  const chip = (id: FiltroQuem, rotulo: string, n?: number, perigo = false) => (
    <button type="button" aria-pressed={quem === id} onClick={() => setQuem(id)} className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={quem === id ? { background: "var(--ink)", color: "var(--bg)", border: "1px solid var(--ink)" }
        : { background: "var(--card)", color: perigo && n ? "var(--err-ink)" : "var(--ink2)", border: `1px solid ${perigo && n ? "var(--err-line)" : "var(--line)"}` }}>
      {rotulo}{n != null && <span className="ml-1 tabular-nums">{n}</span>}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Checklist</h2>
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: "#16A34A" }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#16A34A" }} />ao vivo</span>
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {resumo.concluidas}/{resumo.total} tarefas concluídas ({Math.round(resumo.pct * 100)}%)
            {resumo.atrasadas > 0 && <> · <b style={{ color: "var(--danger)" }}>{resumo.atrasadas} atrasada{resumo.atrasadas === 1 ? "" : "s"}</b></>}
            {faseAtual && <> · fase atual: <b style={{ color: "var(--ink)" }}>{faseAtual}</b></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }} role="tablist" aria-label="Visão">
            {VISOES.map((v) => (
              <button key={v.id} role="tab" aria-selected={visao === v.id} onClick={() => setVisao(v.id)} className="px-2.5 py-1.5 text-[12px] font-semibold"
                style={visao === v.id ? { background: "var(--ink)", color: "var(--bg)" } : { background: "var(--card)", color: "var(--ink2)" }}>{v.rotulo}</button>
            ))}
          </div>
          {botaoPadrao}
          {!somenteLeitura && <Botao variante="primario" onClick={() => setGaveta({ tipo: "nova" })}>+ Tarefa avulsa</Botao>}
        </div>
      </div>

      {faltam.length > 0 && (
        <div className="rounded-xl px-4 py-2.5 text-[12.5px]" style={{ background: "var(--rel-soft)", border: "1px solid var(--line)", color: "var(--ink)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1">
              O checklist padrão tem <b>{procFaltam ? `${procFaltam} tarefa${procFaltam === 1 ? "" : "s"}` : `${faltam.length} passo${faltam.length === 1 ? "" : "s"}`}</b> que esta expedição ainda não tem.
            </span>
            <button type="button" className="text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => setVerFaltam((v) => !v)}>{verFaltam ? "Esconder" : "Ver quais"}</button>
            <Botao variante="primario" disabled={gerando} onClick={trazerDoPadrao}>{gerando ? "Trazendo…" : "Trazer do padrão"}</Botao>
          </div>
          {verFaltam && (
            <ul className="mt-2 space-y-0.5">
              {faltam.map((l, i) => <li key={i} className={l.o_sub ? "pl-5" : ""} style={{ color: l.o_sub ? "var(--ink3)" : "var(--ink2)" }}>{l.o_sub ? "↳ " : "• "}{l.o_tarefa}{!l.o_sub && ` · ${l.o_etapa}`}</li>)}
            </ul>
          )}
        </div>
      )}

      <Triagem itens={itens} usuarios={mapaUsuarios} />

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar tarefas">
        {chip("todas", "Todas")}
        {chip("minhas", "Minhas tarefas", nMinhas)}
        {chip("atrasadas", "Atrasadas", nAtrasadas, true)}
        {setoresPresentes.length > 0 && (
          <select aria-label="Setor" className="rel-input ml-1" style={{ width: "auto", paddingTop: 4, paddingBottom: 4, fontSize: 12 }}
            value={setor} onChange={(e) => setSetor(e.target.value as SetorCk | "")}>
            <option value="">Todos os setores</option>
            {setoresPresentes.map((s) => <option key={s} value={s}>{NOME_SETOR[s]}</option>)}
          </select>
        )}
        {quem === "minhas" && !eu && <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Não deu pra saber quem é você.</span>}
      </div>

      <ChipsFases itens={topo} faseAtual={faseAtual} />

      {filtrando && visiveis.length === 0 ? (
        <p className="rounded-xl py-8 text-center text-[13px]" style={{ border: "1px dashed var(--line)", color: "var(--ink3)" }}>
          {quem === "minhas" ? "Nenhuma tarefa com você nesta expedição." : quem === "atrasadas" ? "Nada atrasado. 🎉" : "Nenhuma tarefa neste setor."}
        </p>
      ) : visao === "timeline" ? (
        <Tabela itens={visiveis} usuarios={mapaUsuarios} faseAtual={faseAtual} onMudou={mudou} onReordenar={reordenarOtimista}
          onEditar={(item) => setGaveta({ tipo: "editar", item })} onSubtarefa={(pai) => setGaveta({ tipo: "sub", pai })} />
      ) : visao === "grafico" ? (
        <Grafico itens={topo} usuarios={mapaUsuarios} faseAtual={faseAtual} onMudou={mudou} />
      ) : (
        <Kanban itens={topo} usuarios={mapaUsuarios} />
      )}
      {!somenteLeitura && visao === "timeline" && !filtrando && (
        <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Dica: arraste pelo ⠿ pra mudar a ordem dentro da fase (ou das subtarefas dentro do processo). Pra trocar de fase, use ✎ Editar.</p>
      )}
      {gavetaEl}{editorEl}
    </div>
  );
}
