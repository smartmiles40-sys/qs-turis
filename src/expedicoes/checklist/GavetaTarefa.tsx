// src/expedicoes/checklist/GavetaTarefa.tsx
// Gaveta de criar/editar tarefa do checklist (app antigo: NovoChecklistDrawer.tsx).
// Novo no QS: edita todos os campos (no antigo só status/observações eram editáveis)
// e cria SUBTAREFA (no antigo a UI nunca mandava parent_id).
import { useEffect, useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { useExp } from "../contexto";
import { Gaveta } from "../ui";
import { ETAPA_CHECKLIST, PRIORIDADE, STATUS_CHECKLIST } from "../lib/constants";
import type { ChecklistItemRow, EtapaChecklist, Prioridade, StatusChecklist } from "../lib/database";
import { criarTarefa, moverEtapa, salvarVarios } from "./dados";

export type ModoGaveta =
  | { tipo: "nova" }
  | { tipo: "sub"; pai: ChecklistItemRow }
  | { tipo: "editar"; item: ChecklistItemRow };

export function GavetaTarefa({ expedicaoId, modo, itens, onFechar, onSalvo }: {
  expedicaoId: string; modo: ModoGaveta | null; itens: ChecklistItemRow[]; onFechar: () => void; onSalvo: () => void;
}) {
  const { usuarios, avisar } = useExp();
  const [f, setF] = useState({
    tarefa: "", etapa: "6 a 2 meses" as EtapaChecklist, prioridade: "Média" as Prioridade, prazo: "",
    responsavel_id: "", observacoes: "", status: "Pendente" as StatusChecklist,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setErro(null);
    if (!modo) return;
    if (modo.tipo === "editar") {
      const i = modo.item;
      setF({ tarefa: i.tarefa, etapa: i.etapa, prioridade: i.prioridade, prazo: i.prazo ?? "", responsavel_id: i.responsavel_id ?? "", observacoes: i.observacoes ?? "", status: i.status });
    } else if (modo.tipo === "sub") {
      const p = modo.pai;
      setF({ tarefa: "", etapa: p.etapa, prioridade: p.prioridade, prazo: p.prazo ?? "", responsavel_id: p.responsavel_id ?? "", observacoes: "", status: "Pendente" });
    } else {
      setF({ tarefa: "", etapa: "6 a 2 meses", prioridade: "Média", prazo: "", responsavel_id: "", observacoes: "", status: "Pendente" });
    }
  }, [modo]);

  if (!modo) return null;
  const ehSub = modo.tipo === "sub" || (modo.tipo === "editar" && !!modo.item.parent_id);
  const titulo = modo.tipo === "editar" ? (ehSub ? "Editar subtarefa" : "Editar tarefa") : modo.tipo === "sub" ? "Nova subtarefa" : "Nova tarefa";

  const salvar = async () => {
    if (f.tarefa.trim().length < 2) { setErro("Mínimo 2 caracteres"); return; }
    setSalvando(true);
    try {
      if (modo.tipo === "editar") {
        const i = modo.item;
        const mud: Record<string, unknown> = {};
        if (f.tarefa.trim() !== i.tarefa) mud.tarefa = f.tarefa.trim();
        if (f.prioridade !== i.prioridade) mud.prioridade = f.prioridade;
        if ((f.prazo || null) !== i.prazo) mud.prazo = f.prazo || null;
        if ((f.responsavel_id || null) !== i.responsavel_id) mud.responsavel_id = f.responsavel_id || null;
        if ((f.observacoes.trim() || null) !== i.observacoes) mud.observacoes = f.observacoes.trim() || null;
        if (f.status !== i.status) mud.status = f.status;
        await salvarVarios(i.id, mud);
        if (!i.parent_id && f.etapa !== i.etapa) await moverEtapa(i.id, f.etapa);
        avisar("Tarefa salva");
      } else {
        await criarTarefa(expedicaoId, {
          tarefa: f.tarefa, etapa: f.etapa, prioridade: f.prioridade, prazo: f.prazo || null, responsavel_id: f.responsavel_id || null,
          observacoes: f.observacoes || null, parent_id: modo.tipo === "sub" ? modo.pai.id : null,
        }, itens);
        avisar(modo.tipo === "sub" ? "Subtarefa criada" : "Tarefa criada");
      }
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally { setSalvando(false); }
  };

  const sel = "rel-input";
  return (
    <Gaveta aberta titulo={titulo} largura={480} onFechar={onFechar}
      subtitulo={modo.tipo === "sub" ? <>Dentro de “{modo.pai.tarefa}”</> : modo.tipo === "nova" ? "Tarefa avulsa, fora do checklist padrão." : undefined}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : modo.tipo === "editar" ? "Salvar" : "Criar"}</Botao></>}>
      <div className="space-y-3.5">
        <Campo rotulo="Tarefa" erro={erro}>
          <Entrada autoFocus value={f.tarefa} onChange={(e) => setF({ ...f, tarefa: e.target.value })} placeholder="Ex.: Confirmar transfer do aeroporto"
            onKeyDown={(e) => { if (e.key === "Enter") void salvar(); }} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Etapa" dica={ehSub ? "Subtarefa segue a etapa do processo." : undefined}>
            <select className={sel} value={f.etapa} disabled={ehSub} onChange={(e) => setF({ ...f, etapa: e.target.value as EtapaChecklist })}>
              {ETAPA_CHECKLIST.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Prioridade">
            <select className={sel} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value as Prioridade })}>
              {PRIORIDADE.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Prazo">
            <Entrada type="date" value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} />
          </Campo>
          {modo.tipo === "editar" && (
            <Campo rotulo="Status">
              <select className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StatusChecklist })}>
                {STATUS_CHECKLIST.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Campo>
          )}
        </div>
        <Campo rotulo="Responsável">
          <select className={sel} value={f.responsavel_id} onChange={(e) => setF({ ...f, responsavel_id: e.target.value })}>
            <option value="">— sem responsável —</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Observações">
          <textarea className={sel} rows={3} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
        </Campo>
      </div>
    </Gaveta>
  );
}
