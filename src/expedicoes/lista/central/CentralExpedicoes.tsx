// src/expedicoes/lista/central/CentralExpedicoes.tsx
// -----------------------------------------------------------------------------
// CENTRAL DE EXPEDIÇÕES (redesign 29/10, docs/ref-expedicoes/qs-redesign-expedicoes.md §2;
// mockup ref-expedicoes.dc.html). Substitui a lista em cards/tabela por ano
// (lista/ExpedicoesLista.tsx — que continua servindo os PACOTES).
//
//   cabeçalho (total + hoje, Exportar, Nova) → 5 indicadores por fase →
//   barra (visão, busca, Destino, Resp. operacional, Status, Período) →
//   Por fase | Linha do tempo | Tabela.
//
// 29/10 (Bruno): saiu o "Precisa de atenção" ("não tem tanta importância").
// Depois: "tem que ser algo de fácil acesso, entrar fácil e fazer as alterações
// rápido; uma expedição do lado da outra só com as informações principais" →
// a tela virou BUSCA + GRADE DE CARTÕES (VisaoCartoes), com TODAS as expedições
// (canceladas e concluídas no fim). Saíram os indicadores, o Por fase e a Linha
// do tempo; a Tabela fica como alternativa (ordenar, reordenar arrastando).
//
// A fase vem das DATAS (lib/fase.ts), não do status manual. Visão, busca,
// filtros e ordenação ficam na query do hash (#ops/expedicoes?visao=tabela&q=…),
// pra dar pra mandar o link. Nenhuma ação da lista antiga sumiu — ver
// docs/MAPA-EXPEDICOES.md › "Central: onde ficou cada ação da lista antiga".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, SearchInput, Segmented } from "@/components/ui";
import { Botao, Modal } from "@/rel/ui";
import { gravarParamNoHash, lerParamDoHash } from "@/lib/hashQuery";
import { useExp } from "../../contexto";
import { Carregando, useAoVivo } from "../../ui";
import { supabase, listarExpedicoes, traduzirErro } from "../../lib/banco";
import { agregarExpedicoes } from "../../lib/agregados";
import { esquecer } from "../../lib/cache";
import { STATUS_EXPEDICAO } from "../../lib/constants";
import { META_FASE, dataSP } from "../../lib/fase.ts";
import type { ExpedicaoComAgregados, StatusExpedicao } from "../../lib/database";
import { EditarExpedicao, NovaExpedicao, salvarCampoExpedicao } from "../FormExpedicao";
import { ORDENACAO_PADRAO, csvDasLinhas, lerOrdenacao, montarLinha, porInicio, type Ordenacao } from "./linhas";
import { type AcoesDaLinha } from "./menu";
import VisaoCartoes from "./VisaoCartoes";
import VisaoTabela from "./VisaoTabela";
import "./central.css";

type Visao = "cartoes" | "tabela";
const VISOES: { value: Visao; label: string }[] = [{ value: "cartoes", label: "Cartões" }, { value: "tabela", label: "Tabela" }];
const PERIODOS = [
  { id: "", rotulo: "Todas" }, { id: "30", rotulo: "Próx. 30d" }, { id: "60", rotulo: "Próx. 60d" },
  { id: "90", rotulo: "Próx. 90d" }, { id: "ano", rotulo: "Este ano" },
] as const;
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const lerVisao = (): Visao => (lerParamDoHash("visao") === "tabela" ? "tabela" : "cartoes");

export default function CentralExpedicoes() {
  const { somenteLeitura, usuarios, ir, avisar } = useExp();
  const [lista, setLista] = useState<ExpedicaoComAgregados[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>(lerVisao);
  const [busca, setBusca] = useState(() => lerParamDoHash("q") ?? "");
  const [destino, setDestino] = useState(() => lerParamDoHash("destino") ?? "");
  const [respOp, setRespOp] = useState(() => lerParamDoHash("resp") ?? "");
  const [status, setStatus] = useState(() => lerParamDoHash("status") ?? "");
  const [periodo, setPeriodo] = useState(() => lerParamDoHash("periodo") ?? "");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(() => lerOrdenacao(lerParamDoHash("ord")));
  const [nova, setNova] = useState(false);
  const [editando, setEditando] = useState<ExpedicaoComAgregados | null>(null);
  const [excluindo, setExcluindo] = useState<ExpedicaoComAgregados | null>(null);
  const [indo, setIndo] = useState(false);

  const hoje = dataSP(new Date());

  // Estado → URL (sem navegar; ver lib/hashQuery.ts)
  useEffect(() => { gravarParamNoHash("visao", visao === "cartoes" ? null : visao); }, [visao]);
  useEffect(() => { gravarParamNoHash("q", busca.trim() || null); }, [busca]);
  useEffect(() => { gravarParamNoHash("destino", destino || null); }, [destino]);
  useEffect(() => { gravarParamNoHash("resp", respOp || null); }, [respOp]);
  useEffect(() => { gravarParamNoHash("status", status || null); }, [status]);
  useEffect(() => { gravarParamNoHash("periodo", periodo || null); }, [periodo]);
  useEffect(() => {
    const igual = ordenacao.col === ORDENACAO_PADRAO.col && ordenacao.dir === ORDENACAO_PADRAO.dir;
    gravarParamNoHash("ord", igual ? null : `${ordenacao.col}:${ordenacao.dir}`);
  }, [ordenacao]);

  // Mesma leitura da lista antiga (lib/cache.ts): aproveita a de outra tela ao abrir.
  const carregar = useCallback(async (fresco = true) => {
    if (fresco) esquecer("expedicoes");
    try {
      const l = await agregarExpedicoes(await listarExpedicoes("expedicao"));
      setLista(l); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, []);
  useEffect(() => { void carregar(false); }, [carregar]);
  useAoVivo([{ tabela: "expedicoes" }], carregar, 300);

  // Atalho "n" = nova (igual à lista antiga) e "/" = busca.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" && !somenteLeitura) setNova(true);
      if (e.key === "/") { e.preventDefault(); document.getElementById("cx-busca")?.focus(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [somenteLeitura]);

  const linhas = useMemo(() => (lista ?? []).map((e) => montarLinha(e, hoje)), [lista, hoje]);
  const ordemDe = useMemo(() => new Map((lista ?? []).map((e, i) => [e.id, i])), [lista]);
  const destinos = useMemo(() => [...new Set(linhas.map((l) => l.e.destino).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [linhas]);
  const responsaveis = useMemo(() => usuarios.filter((u) => u.papel === "operacional" || u.papel === "admin"), [usuarios]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const ano = hoje.slice(0, 4);
    return linhas.filter((l) => {
      const e = l.e;
      if (q && !`${e.codigo} ${e.nome} ${e.destino}`.toLowerCase().includes(q)) return false;
      if (destino && e.destino !== destino) return false;
      if (respOp && e.responsavel_operacional_id !== respOp) return false;
      if (status && e.status !== status) return false;
      if (periodo === "ano") return (e.data_embarque ?? "").startsWith(ano);
      if (periodo) { const d = l.inf.diasParaInicio; if (!e.data_embarque || d < 0 || d > Number(periodo)) return false; }
      return true;
    });
  }, [linhas, busca, destino, respOp, status, periodo, hoje]);
  const filtrosAtivos = [busca.trim(), destino, respOp, status, periodo].filter(Boolean).length;

  const ativas = filtradas.filter((l) => !l.cancelada);

  const proximaId = useMemo(() => {
    const prox = ativas.filter((l) => l.e.data_embarque && l.inf.diasParaInicio >= 0).sort(porInicio)[0];
    return prox?.e.id ?? null;
  }, [ativas]);

  const abrir = (id: string, aba = "") => ir("expedicoes", aba ? `${id}/${aba}` : id);

  const acoes: AcoesDaLinha | null = somenteLeitura ? null : {
    onEditar: (l) => setEditando(l.e),
    onExcluir: (l) => setExcluindo(l.e),
    onStatus: (l, s: StatusExpedicao) => {
      void salvarCampoExpedicao(l.e.id, "status", s)
        .then(() => { avisar(`Status: ${s}`); void carregar(); })
        .catch((er) => avisar(er instanceof Error ? er.message : "Erro ao salvar", "erro"));
    },
  };

  const reordenar = async (idsVisiveis: string[]) => {
    // Os ids visíveis ocupam as MESMAS posições que tinham na ordem global, na nova sequência.
    const global = (lista ?? []).map((e) => e.id);
    const vis = new Set(idsVisiveis);
    let i = 0;
    const nova = global.map((id) => (vis.has(id) ? idsVisiveis[i++] : id));
    setLista((l) => l && [...l].sort((a, b) => nova.indexOf(a.id) - nova.indexOf(b.id)));
    const { error } = await supabase.rpc("exp_reordenar", { p_ids: nova });
    if (error) { avisar("Erro ao salvar nova ordem", "erro"); void carregar(); }
  };

  const exportar = () => {
    const rotulo = (f: keyof typeof META_FASE) => META_FASE[f].curto;
    const linhasCsv = [...filtradas].sort(porInicio);
    const blob = new Blob([csvDasLinhas(linhasCsv, rotulo)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `expedicoes-${hoje}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };


  const hojeTexto = `${DIAS_SEMANA[new Date(`${hoje}T12:00:00Z`).getUTCDay()]} ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`;
  const nTotal = linhas.filter((l) => !l.cancelada).length;

  return (
    <div className="cx-page">
      <header className="cx-head">
        <div>
          <h1>Expedições</h1>
          <p>{lista ? `${nTotal} ${nTotal === 1 ? "expedição" : "expedições"}` : "…"} · hoje, {hojeTexto}
            {filtrosAtivos > 0 && ` · ${filtrosAtivos} filtro${filtrosAtivos > 1 ? "s" : ""} ativo${filtrosAtivos > 1 ? "s" : ""}`}</p>
        </div>
        <div className="cx-acts">
          <Btn onClick={exportar} disabled={!lista?.length} title="Baixar CSV das expedições visíveis">Exportar</Btn>
          {!somenteLeitura && <Btn variant="primary" onClick={() => setNova(true)} title="Atalho: n">Nova expedição</Btn>}
        </div>
      </header>

      {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{erro}</p>}

      {!lista ? <Carregando /> : (
        <>
          <section className="cx-bar" aria-label="Controles">
            <Segmented label="Visualização" options={VISOES} value={visao} onChange={setVisao} />
            <div className="cx-bar__f">
              <SearchInput id="cx-busca" placeholder="Buscar expedição por nome, código ou destino  [/]" value={busca}
                onChange={(e) => setBusca(e.target.value)} aria-label="Buscar expedição" autoFocus />
              <Seletor rotulo="Destino" valor={destino} onMudar={setDestino} opcoes={destinos.map((x) => ({ v: x, r: x }))} />
              <Seletor rotulo="Resp. operacional" valor={respOp} onMudar={setRespOp}
                opcoes={responsaveis.map((u) => ({ v: u.id, r: u.nome.split(" ")[0] }))} />
              <Seletor rotulo="Status" valor={status} onMudar={setStatus} opcoes={STATUS_EXPEDICAO.map((x) => ({ v: x, r: x }))} />
              <Seletor rotulo="Período" valor={periodo} onMudar={setPeriodo} todos="Todas"
                opcoes={PERIODOS.filter((p) => p.id).map((p) => ({ v: p.id, r: p.rotulo }))} />
              {filtrosAtivos > 0 && (
                <Btn variant="ghost" onClick={() => { setBusca(""); setDestino(""); setRespOp(""); setStatus(""); setPeriodo(""); }}>Limpar</Btn>
              )}
            </div>
          </section>

          {lista.length === 0 ? (
            <div className="cx-sec cx-vazio">
              Nenhuma expedição ainda. Crie a primeira viagem em grupo para organizar passageiros, prazos, rooming e prontidão.
              {!somenteLeitura && <div style={{ marginTop: 12 }}><Btn variant="primary" onClick={() => setNova(true)}>Criar primeira expedição</Btn></div>}
            </div>
          ) : visao === "cartoes" ? (
            <VisaoCartoes linhas={filtradas} proximaId={proximaId} abrir={abrir} acoes={acoes} />
          ) : (
            <VisaoTabela linhas={filtradas} ordemDe={ordemDe} ordenacao={ordenacao} onOrdenar={setOrdenacao} abrir={abrir} acoes={acoes}
              proximaId={proximaId} onReordenar={reordenar} podeArrastar={filtrosAtivos === 0} />
          )}
        </>
      )}

      <NovaExpedicao aberta={nova} tipo="expedicao" onFechar={() => setNova(false)} onCriada={(id) => { setNova(false); abrir(id); }} />
      <EditarExpedicao exp={editando} onFechar={() => setEditando(null)} onSalva={() => { setEditando(null); void carregar(); }} />
      <Modal aberto={!!excluindo} titulo={excluindo ? `Excluir "${excluindo.nome}"?` : ""} onFechar={() => setExcluindo(null)} largura={440}
        rodape={<>
          <Botao onClick={() => setExcluindo(null)}>Cancelar</Botao>
          <Botao variante="perigo" disabled={indo} onClick={async () => {
            if (!excluindo) return;
            setIndo(true);
            const { error } = await supabase.from("expedicoes").delete().eq("id", excluindo.id);
            setIndo(false);
            if (error) { avisar(traduzirErro(error.message), "erro"); return; }
            setExcluindo(null); avisar("Expedição excluída"); void carregar();
          }}>{indo ? "Excluindo…" : "Excluir"}</Botao>
        </>}>
        <div style={{ fontSize: 13.5, color: "var(--muted)" }}>Apaga também passageiros, custos, pagamentos e checklist desta expedição. Não dá pra desfazer.</div>
      </Modal>
    </div>
  );
}

function Seletor({ rotulo, valor, onMudar, opcoes, todos = "Todos" }: {
  rotulo: string; valor: string; onMudar: (v: string) => void; opcoes: { v: string; r: string }[]; todos?: string;
}) {
  return (
    <label className="cx-sel">
      <span>{rotulo}</span>
      <select value={valor} onChange={(e) => onMudar(e.target.value)}>
        <option value="">{todos}</option>
        {opcoes.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
      </select>
    </label>
  );
}
