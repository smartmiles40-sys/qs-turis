// src/expedicoes/divisoes/Componentes.tsx
// Peças da aba Divisões: o cartão de cada grupo (app antigo: GruposPageCliente.tsx)
// e a lista "quem está em cada grupo" (novo no QS — no antigo só dava pra marcar
// G1/G2 pela aba Passageiros, e grupos com outros nomes não tinham como receber gente).
import { useMemo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useExp } from "../contexto";
import { BotaoExcluir, Busca, CelulaEditavel, Selo } from "../ui";
import { formatDate } from "../lib/utils";
import type { GrupoExpedicaoRow, PassageiroRow } from "../lib/database";
import { definirGrupoDoPax, excluirGrupo, salvarGrupo, type CampoGrupo } from "./dados";

export function CartaoGrupo({ g, qtdPax, qtdVoos, divisaoAtiva, onMudou }: {
  g: GrupoExpedicaoRow; qtdPax: number; qtdVoos: number; divisaoAtiva: boolean; onMudou: () => void;
}) {
  const { somenteLeitura, avisar } = useExp();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: g.id, disabled: somenteLeitura });
  const salvar = (campo: CampoGrupo) => async (v: string | number | null) => {
    if (campo === "nome" && divisaoAtiva && (g.nome === "G1" || g.nome === "G2") && String(v ?? "").trim() !== g.nome) {
      avisar(`Atenção: sem um grupo chamado exatamente "${g.nome}", a divisão G1/G2 deixa de valer em Passageiros, Rooming e Área do Líder.`, "erro");
    }
    await salvarGrupo(g.id, campo, v);
    onMudou();
  };
  const ehDivisao = g.nome === "G1" || g.nome === "G2";
  return (
    <div ref={setNodeRef} className="rel-card p-3.5 space-y-2.5"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      <div className="flex items-start gap-2">
        {!somenteLeitura && (
          <button {...attributes} {...listeners} aria-label="Arrastar pra reordenar" title="Arrastar pra reordenar"
            className="cursor-grab pt-0.5 text-[14px] leading-none" style={{ color: "var(--ink3)" }}>⠿</button>
        )}
        <div className="flex-1 min-w-0 text-[15px] font-bold" style={{ color: "var(--ink)" }}>
          <CelulaEditavel valor={g.nome} onSalvar={salvar("nome")} />
        </div>
        {ehDivisao && divisaoAtiva && <Selo tom="lista" titulo="Faz parte da divisão G1/G2">divisão</Selo>}
        <BotaoExcluir titulo={`Remover grupo "${g.nome}"?`} sucesso="Grupo removido"
          descricao={<div className="space-y-1.5">
            <p>{qtdPax > 0 ? `${qtdPax} passageiro(s) vinculado(s) ficarão sem grupo.` : "Nenhum passageiro está neste grupo."}</p>
            {qtdVoos > 0 && <p style={{ color: "var(--warn-ink)" }}><b>{qtdVoos} voo(s)</b> marcados “Só {g.nome}” no ExpedAmigo passam a aparecer pra <b>todos</b> os viajantes.</p>}
            {ehDivisao && divisaoAtiva && <p style={{ color: "var(--warn-ink)" }}>Sem o {g.nome}, a divisão G1/G2 deixa de valer.</p>}
          </div>}
          onConfirmar={async () => { await excluirGrupo(g.id); onMudou(); }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Selo tom={qtdPax ? "ok" : "neutro"}>{qtdPax} passageiro{qtdPax === 1 ? "" : "s"}</Selo>
        {qtdVoos > 0 && <Selo tom="aviso" titulo="Voos do ExpedAmigo que só esse grupo vê">{qtdVoos} voo{qtdVoos === 1 ? "" : "s"} só deste grupo</Selo>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <Info rotulo="Embarque"><CelulaEditavel tipo="date" valor={g.data_embarque?.slice(0, 10) ?? null} formatar={(v) => formatDate(String(v))} onSalvar={salvar("data_embarque")} /></Info>
        <Info rotulo="Retorno"><CelulaEditavel tipo="date" valor={g.data_retorno?.slice(0, 10) ?? null} formatar={(v) => formatDate(String(v))} onSalvar={salvar("data_retorno")} /></Info>
        <Info rotulo="Pax planejados"><CelulaEditavel tipo="number" valor={g.pax_planejados} onSalvar={salvar("pax_planejados")} /></Info>
        <Info rotulo="Observações"><CelulaEditavel valor={g.observacoes} onSalvar={salvar("observacoes")} /></Info>
      </div>
    </div>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10.5px] uppercase tracking-wide font-semibold" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <div style={{ color: "var(--ink)" }}>{children}</div>
    </div>
  );
}

/** Quem está em cada grupo: troca o grupo de cada passageiro. */
export function Membros({ grupos, pax, onMudou }: { grupos: GrupoExpedicaoRow[]; pax: PassageiroRow[]; onMudou: () => void }) {
  const { somenteLeitura, avisar } = useExp();
  const [filtro, setFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [verCancelados, setVerCancelados] = useState(false);
  const nomeGrupo = useMemo(() => new Map(grupos.map((g) => [g.id, g.nome])), [grupos]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return pax
      .filter((p) => verCancelados || p.status_reserva !== "Cancelado")
      .filter((p) => filtro === "todos" || (filtro === "sem" ? !p.grupo_id || !nomeGrupo.has(p.grupo_id) : p.grupo_id === filtro))
      .filter((p) => !b || p.nome_completo.toLowerCase().includes(b))
      .sort((a, z) => a.nome_completo.localeCompare(z.nome_completo, "pt-BR"));
  }, [pax, filtro, busca, verCancelados, nomeGrupo]);

  const ativos = pax.filter((p) => verCancelados || p.status_reserva !== "Cancelado");
  const semGrupo = ativos.filter((p) => !p.grupo_id || !nomeGrupo.has(p.grupo_id)).length;

  const trocar = async (p: PassageiroRow, grupoId: string) => {
    try { await definirGrupoDoPax(p.id, grupoId || null); avisar(grupoId ? `${p.nome_completo.split(" ")[0]} → ${nomeGrupo.get(grupoId)}` : "Grupo removido do passageiro"); onMudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
  };

  const chip = (id: string, rotulo: string, n: number) => (
    <button key={id} onClick={() => setFiltro(id)} className="px-2.5 py-1 rounded-full text-[12px] font-semibold"
      style={filtro === id ? { background: "var(--ink)", color: "var(--bg)" } : { background: "var(--card2)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
      {rotulo} <span className="opacity-70">{n}</span>
    </button>
  );

  return (
    <section className="rel-card p-4 space-y-3">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Quem está em cada grupo</h3>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          O grupo do passageiro decide quais voos ele vê no ExpedAmigo (voo “Só G1” aparece só pra quem é do G1) e, com a divisão G1/G2 ligada, onde ele aparece em Passageiros, Rooming e Área do Líder.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chip("todos", "Todos", ativos.length)}
        {grupos.map((g) => chip(g.id, g.nome, ativos.filter((p) => p.grupo_id === g.id).length))}
        {chip("sem", "Sem grupo", semGrupo)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar passageiro…  ( / )" /></div>
        <label className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={verCancelados} onChange={(e) => setVerCancelados(e.target.checked)} /> Mostrar cancelados
        </label>
      </div>
      {lista.length === 0 ? (
        <p className="py-6 text-center text-[12.5px]" style={{ color: "var(--ink3)" }}>Ninguém aqui.</p>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }}>
          {lista.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>
                {p.nome_completo}
                {p.status_reserva === "Cancelado" && <span className="ml-2"><Selo tom="erro">Cancelado</Selo></span>}
                {p.tipo !== "Pagante" && <span className="ml-2"><Selo>{p.tipo}</Selo></span>}
              </span>
              {somenteLeitura ? (
                <span style={{ color: "var(--ink2)" }}>{p.grupo_id ? nomeGrupo.get(p.grupo_id) ?? "—" : "—"}</span>
              ) : (
                <select aria-label={`Grupo de ${p.nome_completo}`} className="rel-input" style={{ width: 200, padding: "4px 8px" }}
                  value={p.grupo_id && nomeGrupo.has(p.grupo_id) ? p.grupo_id : ""} onChange={(e) => void trocar(p, e.target.value)}>
                  <option value="">— sem grupo —</option>
                  {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
