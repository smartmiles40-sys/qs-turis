// src/expedicoes/detalhe/ExpedicaoDetalhe.tsx
// Página de uma expedição (ou pacote): cabeçalho com ocupação/checklist/
// prontidão, abas iguais ao app antigo e a Visão Geral. Cada aba é um arquivo
// em ./abas/ e recebe { exp, sub, onMudou } — `sub` é o resto do endereço
// (#ops/expedicoes/<id>/<aba>/<sub...>). Pacote não tem Rooming, Checklist nem
// Roteiro do Líder.
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../contexto";
import { Abas, Anel, Carregando, PilulaStatus, useAoVivo } from "../ui";
import { expedicaoComAgregados } from "../lib/agregados";
import { daysUntil, formatDate, formatPercent } from "../lib/utils";
import type { ExpedicaoComAgregados } from "../lib/database";
import { EditarExpedicao } from "../lista/FormExpedicao";
import VisaoGeral from "./VisaoGeral";

export interface PropsAba { exp: ExpedicaoComAgregados; sub: string[]; onMudou: () => void }

const ABAS = [
  { id: "", rotulo: "Visão Geral" },
  { id: "passageiros", rotulo: "Passageiros" },
  { id: "rooming", rotulo: "Rooming" },
  { id: "checklist", rotulo: "Checklist" },
  { id: "documentos", rotulo: "Documentos" },
  { id: "links", rotulo: "Links" },
  { id: "grupos", rotulo: "Divisões" },
  { id: "portal", rotulo: "ExpedAmigo" },
  { id: "roteiro-lider", rotulo: "Roteiro do Líder" },
] as const;
type IdAba = (typeof ABAS)[number]["id"];
const OCULTAS_PACOTE = new Set<string>(["rooming", "checklist", "roteiro-lider", "grupos"]);

const COMPONENTES: Record<Exclude<IdAba, "">, React.LazyExoticComponent<ComponentType<PropsAba>>> = {
  passageiros: lazy(() => import("./abas/AbaPassageiros")),
  rooming: lazy(() => import("./abas/AbaRooming")),
  checklist: lazy(() => import("./abas/AbaChecklist")),
  documentos: lazy(() => import("./abas/AbaDocumentos")),
  links: lazy(() => import("./abas/AbaLinks")),
  grupos: lazy(() => import("./abas/AbaGrupos")),
  portal: lazy(() => import("./abas/AbaPortal")),
  "roteiro-lider": lazy(() => import("./abas/AbaRoteiroLider")),
};

export default function ExpedicaoDetalhe({ caminho }: { caminho: string }) {
  const { ir, somenteLeitura } = useExp();
  const [id, abaBruta = "", ...sub] = caminho.split("/");
  const [exp, setExp] = useState<ExpedicaoComAgregados | null | undefined>(undefined);
  const [editando, setEditando] = useState(false);

  const carregar = useCallback(async () => {
    try { setExp(await expedicaoComAgregados(id)); } catch { setExp(null); }
  }, [id]);
  useEffect(() => { setExp(undefined); void carregar(); }, [carregar]);
  // O cabeçalho só recarrega os NÚMEROS (expedicaoComAgregados lê colunas leves);
  // cada aba cuida dos próprios dados. passageiro_requisitos não tem expedicao_id
  // (não dá pra filtrar no realtime) → espera de 2,5 s, pra edição em outra
  // expedição não ficar refazendo o cabeçalho a cada clique.
  useAoVivo([
    { tabela: "expedicoes", filtro: `id=eq.${id}` },
    { tabela: "passageiros", filtro: `expedicao_id=eq.${id}` },
    { tabela: "checklist_itens", filtro: `expedicao_id=eq.${id}` },
  ], carregar, 600);
  useAoVivo([{ tabela: "passageiro_requisitos" }], carregar, 2500);

  const pacote = exp?.tipo === "pacote";
  const abas = useMemo(() => ABAS.filter((a) => !(pacote && OCULTAS_PACOTE.has(a.id))), [pacote]);
  const aba = (abas.some((a) => a.id === abaBruta) ? abaBruta : "") as IdAba;
  const telaLista = pacote ? "pacotes" : "expedicoes";

  if (exp === undefined) return <Carregando />;
  if (exp === null) {
    return (
      <div className="text-center py-16">
        <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Expedição não encontrada.</p>
        <Botao className="mt-3" onClick={() => ir("expedicoes")}>Voltar pra lista</Botao>
      </div>
    );
  }

  const d = daysUntil(exp.data_embarque);
  const Comp = aba ? COMPONENTES[aba] : null;
  return (
    <div className="space-y-4">
      <header className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--line)" }}>
        <div className="px-5 py-4 text-white" style={{ background: "linear-gradient(135deg, #1F2937, #B45309)" }}>
          <button onClick={() => ir(telaLista)} className="text-[12px] opacity-80 hover:opacity-100">← {pacote ? "Pacotes" : "Expedições"}</button>
          <div className="mt-1 flex flex-wrap items-start gap-4">
            <div className="flex-1 min-w-[220px]">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-bold leading-tight">{exp.nome}</h1>
                <PilulaStatus status={exp.status} />
              </div>
              <p className="text-[12.5px] opacity-85 mt-1">
                <span className="font-mono">{exp.codigo}</span> · {exp.destino} · {formatDate(exp.data_embarque)} → {formatDate(exp.data_retorno)}
              </p>
              <p className="text-[12px] opacity-75 mt-0.5">
                {exp.responsavel_op_nome && <>Op: {exp.responsavel_op_nome}</>}
                {exp.responsavel_op_nome && exp.responsavel_com_nome && " · "}
                {exp.responsavel_com_nome && <>Com: {exp.responsavel_com_nome}</>}
              </p>
            </div>
            <div className="text-right">
              {d == null ? <span className="text-[13px]">—</span> : d >= 0 ? (
                <>
                  <div className="text-[30px] font-bold leading-none">{d}</div>
                  <div className="text-[11.5px] opacity-85">{d === 0 ? "embarca hoje" : d === 1 ? "dia p/ embarcar" : "dias p/ embarcar"}</div>
                </>
              ) : <div className="text-[14px] font-semibold">✈ Embarcou</div>}
              {!somenteLeitura && <button onClick={() => setEditando(true)} className="mt-2 text-[12px] px-2.5 py-1 rounded-md" style={{ background: "rgba(255,255,255,.15)" }}>Editar</button>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
          <Indicador rotulo="Ocupação" texto={`${exp.pax_confirmados}/${exp.pax_planejados}`} dica="confirmados" fracao={exp.pax_planejados ? exp.pax_confirmados / exp.pax_planejados : 0} cor="#B45309" />
          {pacote ? <Indicador rotulo="Passageiros" texto={String(exp.prontidao_total)} dica="no pacote" fracao={0} vazio /> :
            <Indicador rotulo="Checklist" texto={formatPercent(exp.checklist_pct, 0)} dica="concluído" fracao={exp.checklist_pct} cor="var(--rel)" />}
          <Indicador rotulo="Prontidão" texto={`${exp.prontidao_aptos}/${exp.prontidao_total}`} dica="aptos p/ embarque" fracao={exp.prontidao_total ? exp.prontidao_aptos / exp.prontidao_total : 0} vazio={!exp.prontidao_total} />
        </div>
      </header>

      <Abas abas={abas.map((a) => ({ id: a.id, rotulo: a.rotulo }))} ativa={aba} onTrocar={(t) => ir(telaLista, t ? `${exp.id}/${t}` : exp.id)} />

      {Comp ? (
        <Suspense fallback={<Carregando />}><Comp exp={exp} sub={sub} onMudou={carregar} /></Suspense>
      ) : (
        <VisaoGeral exp={exp} sub={sub} onMudou={carregar} />
      )}

      {editando && <EditarExpedicao exp={exp} onFechar={() => setEditando(false)} onSalva={() => { setEditando(false); void carregar(); }} />}
    </div>
  );
}

function Indicador({ rotulo, texto, dica, fracao, cor = "auto", vazio }: { rotulo: string; texto: string; dica: string; fracao: number; cor?: string; vazio?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" style={{ borderColor: "var(--line)" }}>
      <Anel fracao={fracao} cor={cor} vazio={vazio} tamanho={40}>{" "}</Anel>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</div>
        <div className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{texto} <span className="text-[11.5px] font-normal" style={{ color: "var(--ink3)" }}>{dica}</span></div>
      </div>
    </div>
  );
}
