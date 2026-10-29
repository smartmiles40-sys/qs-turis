// src/expedicoes/paginas/ChecklistPadrao.tsx
// -----------------------------------------------------------------------------
// CHECKLIST PADRÃO (Bruno, 29/10): "preciso ter na parte de expedições qual é o
// check-list das tarefas que são padrão em todas as expedições, assim
// conseguindo ter a divisão de todos os setores".
//
// Mostra o que TODA expedição nova recebe (lib/processos/template.ts), por fase
// de antecedência e por setor, e — pra cada tarefa — como ela está nas
// expedições em andamento (feitas / total / atrasadas), lendo checklist_itens.
// As tarefas dos outros setores ainda são sugestão (PROCESSOS_SUGERIDOS): ficam
// marcadas e não entram nas expedições até a 0223 (padrão editável no banco).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { FASES_CHECKLIST } from "../lib/constants";
import { lerTudo, listarExpedicoes } from "../lib/banco";
import { dataSP, infoFase } from "../lib/fase.ts";
import type { EtapaChecklist, StatusChecklist } from "../lib/database";
import {
  COR_SETOR_CHECKLIST, NOME_SETOR_CHECKLIST, PROCESSOS_EXPEDICAO, PROCESSOS_SUGERIDOS, setorDoProcesso,
  type ProcessoTemplate, type SetorChecklist,
} from "../lib/processos/template";
import { Carregando } from "../ui";
import "../lista/central/central.css";

const SETORES: SetorChecklist[] = ["operacional", "comercial", "financeiro", "relacionamento"];
type Andamento = { feitas: number; total: number; atrasadas: number };
type Linha = ProcessoTemplate & { setor: SetorChecklist; sugestao: boolean };

const chave = (etapa: string, tarefa: string) => `${etapa}|${tarefa.trim().toLowerCase()}`;

export default function ChecklistPadrao() {
  const [setor, setSetor] = useState<SetorChecklist | "">("");
  const [andamento, setAndamento] = useState<Map<string, Andamento> | null>(null);
  const [nAtivas, setNAtivas] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const hoje = dataSP(new Date());

  useEffect(() => {
    void (async () => {
      const exps = (await listarExpedicoes("expedicao")).filter((e) =>
        e.status !== "Cancelada" && infoFase(e.data_embarque, e.data_retorno, hoje).fase !== "concluida");
      const ids = new Set(exps.map((e) => e.id));
      setNAtivas(ids.size);
      const itens = await lerTudo<{ expedicao_id: string; etapa: string; tarefa: string; status: StatusChecklist; prazo: string | null }>(
        "checklist_itens", (q) => q.is("parent_id", null), "expedicao_id,etapa,tarefa,status,prazo");
      const m = new Map<string, Andamento>();
      for (const i of itens) {
        if (!ids.has(i.expedicao_id)) continue;
        const k = chave(i.etapa, i.tarefa);
        const a = m.get(k) ?? { feitas: 0, total: 0, atrasadas: 0 };
        a.total++;
        if (i.status === "Concluído") a.feitas++;
        else if (i.prazo && i.prazo < hoje) a.atrasadas++;
        m.set(k, a);
      }
      setAndamento(m);
    })().catch(() => setAndamento(new Map()));
  }, [hoje]);

  const linhas: Linha[] = useMemo(() => [
    ...PROCESSOS_EXPEDICAO.map((p) => ({ ...p, setor: setorDoProcesso(p), sugestao: false })),
    ...PROCESSOS_SUGERIDOS.map((p) => ({ ...p, setor: setorDoProcesso(p), sugestao: true })),
  ], []);
  const porSetor = (s: SetorChecklist) => linhas.filter((l) => l.setor === s);
  const visiveis = setor ? linhas.filter((l) => l.setor === setor) : linhas;

  return (
    <div className="cx-page">
      <header className="cx-head">
        <div>
          <h1>Checklist padrão das expedições</h1>
          <p>O que toda expedição nova recebe, por fase e por setor · andamento nas {nAtivas} expedições em andamento</p>
        </div>
      </header>

      <section className="ckp-setores" aria-label="Divisão por setor">
        <button type="button" className={`ckp-setor${setor === "" ? " ckp-setor--on" : ""}`} onClick={() => setSetor("")}>
          <span className="ckp-setor__n">{linhas.filter((l) => !l.sugestao).length}</span><span>Todos os setores</span>
        </button>
        {SETORES.map((s) => {
          const ls = porSetor(s);
          const valendo = ls.filter((l) => !l.sugestao).length;
          return (
            <button key={s} type="button" className={`ckp-setor${setor === s ? " ckp-setor--on" : ""}`} onClick={() => setSetor(s)}
              style={{ borderLeft: `4px solid var(--sector-${COR_SETOR_CHECKLIST[s]})` }}>
              <span className="ckp-setor__n">{valendo}</span>
              <span>{NOME_SETOR_CHECKLIST[s]}{!valendo && ls.length ? <small> · {ls.length} sugeridas</small> : null}</span>
            </button>
          );
        })}
      </section>

      <p className="ckp-nota">
        Hoje só <b>Operações</b> tem tarefas no padrão. As de Comercial, Financeiro e Relacionamento aparecem como <b>sugestão</b> e ainda
        não entram nas expedições — falta aprovar a lista e liberar a edição do padrão (migration 0223).
      </p>

      {!andamento ? <Carregando /> : (
        <div className="cx-anos">
          {FASES_CHECKLIST.map((f) => {
            const ls = visiveis.filter((l) => l.etapa === f.etapa);
            if (!ls.length) return null;
            return (
              <section key={f.etapa} className="cx-ano" aria-label={f.etapa}>
                <h2 className="cx-ano__h">{f.etapa}<span className="cx-sec__n">{ls.length}</span><span className="cx-ano__c">{f.descricao}</span></h2>
                <ul className="ckp-lista">
                  {ls.map((l) => (
                    <Tarefa key={`${l.setor}|${l.tarefa}|${l.etapa}`} l={l} etapa={f.etapa} a={andamento.get(chave(l.etapa, l.tarefa))}
                      aberta={aberta === `${l.etapa}|${l.tarefa}`} onAbrir={() => setAberta((x) => (x === `${l.etapa}|${l.tarefa}` ? null : `${l.etapa}|${l.tarefa}`))} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tarefa({ l, a, aberta, onAbrir }: { l: Linha; etapa: EtapaChecklist; a?: Andamento; aberta: boolean; onAbrir: () => void }) {
  const cor = COR_SETOR_CHECKLIST[l.setor];
  const subs = l.subtarefas ?? [];
  return (
    <li className={`ckp-t${l.sugestao ? " ckp-t--sug" : ""}`}>
      <div className="ckp-t__l">
        <span className="ckp-chip" style={{ background: `var(--sector-${cor}-bg)`, color: `var(--sector-${cor}-fg)` }}>{NOME_SETOR_CHECKLIST[l.setor]}</span>
        <button type="button" className="ckp-t__nome" onClick={onAbrir} disabled={!subs.length} aria-expanded={subs.length ? aberta : undefined}>
          {l.tarefa}{subs.length > 0 && <span className="ckp-t__subs"> · {subs.length} passos {aberta ? "▾" : "▸"}</span>}
        </button>
        <span className={`ckp-prio ckp-prio--${l.prioridade === "Crítica" ? "c" : l.prioridade === "Alta" ? "a" : "n"}`}>{l.prioridade}</span>
        {l.sugestao ? <span className="ckp-sug">Sugestão</span> : (
          <span className="ckp-and" title="Nas expedições em andamento: concluídas / que têm a tarefa">
            {a ? <>{a.feitas}/{a.total} feitas{a.atrasadas > 0 && <b> · {a.atrasadas} atrasada{a.atrasadas > 1 ? "s" : ""}</b>}</> : "—"}
          </span>
        )}
      </div>
      {aberta && subs.length > 0 && <ol className="ckp-subs">{subs.map((s) => <li key={s}>{s}</li>)}</ol>}
    </li>
  );
}
