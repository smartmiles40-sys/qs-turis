// src/expedicoes/detalhe/ExpedicaoDetalhe.tsx
// -----------------------------------------------------------------------------
// COCKPIT DA EXPEDIÇÃO (redesign 29/10, docs/ref-expedicoes/qs-redesign-expedicoes.md §3;
// mockup ref-expedicao.dc.html). Vale também pra pacote (sem a aba Logística).
//
// Cabeçalho: nome base + chip do grupo + chip da fase ("Em viagem · Dia 4 de 18"),
// metadados (código, destino, datas, líderes, responsáveis), Portal do líder e
// Editar, e a barra das 5 fases. Saíram o degradê e os 3 anéis (Ocupação,
// Checklist, Prontidão) — esses números estão na "Saúde" da Visão geral.
//
// Abas: de 10 para 6 (lib/cockpit/rota.ts). A aba ativa vai na query do hash
// (?aba=logistica&secao=rooming) por replaceState — não remonta a tela nem enche
// o "voltar". Endereços antigos (<id>%2Frooming, <id>/valores, ?aba=rooming)
// redirecionam pra aba nova e o endereço é reescrito no formato novo.
// Os sub-endereços de Passageiros (pax/<id>, pax/<id>/perfil, prontidao/<id>)
// continuam no caminho.
// -----------------------------------------------------------------------------
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Btn } from "@/components/ui";
import { useExp } from "../contexto";
import { Carregando, useAoVivo } from "../ui";
import { expedicaoComAgregados } from "../lib/agregados";
import { formatDate } from "../lib/utils";
import type { ExpedicaoComAgregados } from "../lib/database";
import { EditarExpedicao } from "../lista/FormExpedicao";
import { META_FASE, dataSP, divergenciaStatus, infoFase, type Fase, type InfoFase } from "../lib/fase";
import { nomeDaExpedicao } from "../lib/nomeExpedicao";
import { ABAS_COCKPIT, ABAS_FORA_DO_PACOTE, hashCanonico, resolverRotaCockpit, type AbaCockpit, type SecaoCockpit } from "../lib/cockpit/rota";
import { contagensMatriz, type LinhaMatriz } from "../lib/cockpit/matriz";
import { carregarResumoCockpit, linhasDaMatriz, type ResumoCockpit } from "./cockpit/dados";
import VisaoGeral from "./VisaoGeral";
import "./cockpit.css";

/** O que o cockpit já leu e calculou — as abas aproveitam em vez de ler de novo. */
export interface Cockpit {
  hoje: string;
  info: InfoFase;
  /** null enquanto carrega. */
  resumo: ResumoCockpit | null;
  /** Matriz de passageiros (mesma conta do badge da aba). */
  linhas: LinhaMatriz[];
  secao: SecaoCockpit | null;
  irAba: (aba: AbaCockpit, secao?: SecaoCockpit | null) => void;
  recarregarResumo: () => void;
}

export interface PropsAba {
  exp: ExpedicaoComAgregados;
  sub: string[];
  onMudou: () => void;
  /** Contexto do cockpit (redesign 29/10). Opcional pra quem ainda monta a aba solta. */
  cockpit?: Cockpit;
}

const COMPONENTES: Record<Exclude<AbaCockpit, "geral">, React.LazyExoticComponent<ComponentType<PropsAba>>> = {
  passageiros: lazy(() => import("./abas/AbaPassageiros")),
  logistica: lazy(() => import("./abas/AbaLogistica")),
  financeiro: lazy(() => import("./abas/AbaFinanceiro")),
  arquivos: lazy(() => import("./abas/AbaArquivos")),
  portal: lazy(() => import("./abas/AbaPortal")),
};

/** Barra de fases: Vendas → Preparação → Embarque → Em viagem → Pós-viagem. */
const BARRA_FASES: { fase: Fase; rotulo: string }[] = [
  { fase: "vendendo", rotulo: "Vendas" }, { fase: "preparacao", rotulo: "Preparação" }, { fase: "embarque", rotulo: "Embarque" },
  { fase: "em_viagem", rotulo: "Em viagem" }, { fase: "concluida", rotulo: "Pós-viagem" },
];

function textoChipFase(i: InfoFase): string {
  switch (i.fase) {
    case "em_viagem": return `Em viagem · Dia ${i.diaDaViagem} de ${i.totalDias}`;
    case "embarque": return i.diasParaInicio === 1 ? "Embarca amanhã" : `Embarca em ${i.diasParaInicio} dias`;
    case "preparacao": return `Preparação · embarca em ${i.diasParaInicio} dias`;
    case "vendendo": return Number.isFinite(i.diasParaInicio) ? `Vendas abertas · embarca em ${i.diasParaInicio} dias` : "Vendas abertas · sem data";
    case "concluida": return i.diasParaFim === -1 ? "Concluída · voltou ontem" : `Concluída · voltou há ${-i.diasParaFim} dias`;
  }
}

export default function ExpedicaoDetalhe({ caminho }: { caminho: string }) {
  const { ir, somenteLeitura } = useExp();
  const id = caminho.split("/")[0];
  const [exp, setExp] = useState<ExpedicaoComAgregados | null | undefined>(undefined);
  const [resumo, setResumo] = useState<ResumoCockpit | null>(null);
  const [editando, setEditando] = useState(false);

  // ── dados ──
  const carregar = useCallback(async () => {
    try { setExp(await expedicaoComAgregados(id)); } catch { setExp(null); }
  }, [id]);
  useEffect(() => { setExp(undefined); setResumo(null); void carregar(); }, [carregar]);
  const expCarregada = exp ?? null;
  const carregarResumo = useCallback(async () => {
    if (!expCarregada) return;
    try { setResumo(await carregarResumoCockpit(expCarregada)); } catch { /* o cabeçalho segue; os blocos mostram "—" */ }
  }, [expCarregada?.id, expCarregada?.tipo, expCarregada?.data_embarque, expCarregada?.data_retorno, expCarregada?.destino]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void carregarResumo(); }, [carregarResumo]);
  const recarregarTudo = useCallback(() => { void carregar(); void carregarResumo(); }, [carregar, carregarResumo]);

  // O cabeçalho só recarrega os NÚMEROS (expedicaoComAgregados lê colunas leves).
  // passageiro_requisitos / passageiro_quarto não têm expedicao_id (não dá pra
  // filtrar no realtime) → espera de 2,5 s, pra edição em outra expedição não
  // ficar refazendo o cockpit a cada clique.
  useAoVivo([
    { tabela: "expedicoes", filtro: `id=eq.${id}` },
    { tabela: "passageiros", filtro: `expedicao_id=eq.${id}` },
    { tabela: "checklist_itens", filtro: `expedicao_id=eq.${id}` },
  ], recarregarTudo, 600);
  useAoVivo([
    { tabela: "quartos", filtro: `expedicao_id=eq.${id}` },
    { tabela: "arquivos", filtro: `expedicao_id=eq.${id}` },
    { tabela: "roteiro_lider_dias", filtro: `expedicao_id=eq.${id}` },
    { tabela: "roteiro_dias", filtro: `expedicao_id=eq.${id}` },
  ], () => void carregarResumo(), 800);
  useAoVivo([{ tabela: "passageiro_requisitos" }, { tabela: "passageiro_quarto" }], recarregarTudo, 2500);

  // ── rota: aba + seção ──
  const pacote = exp?.tipo === "pacote";
  const [hashAtual, setHashAtual] = useState(() => window.location.hash);
  useEffect(() => {
    const f = () => setHashAtual(window.location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => { setHashAtual(window.location.hash); }, [caminho]);
  const rota = useMemo(() => resolverRotaCockpit({ caminho, hash: hashAtual, pacote }), [caminho, hashAtual, pacote]);
  const telaLista = pacote ? "pacotes" : "expedicoes";

  const trocarHash = useCallback((aba: AbaCockpit, secao: SecaoCockpit | null) => {
    const h = hashCanonico(window.location.hash, id, aba, secao);
    if (!h) { ir(telaLista, aba === "geral" ? id : `${id}/${aba}`); return; }
    if (h !== window.location.hash) history.replaceState(history.state, "", window.location.pathname + window.location.search + h);
    setHashAtual(h);
  }, [id, ir, telaLista]);
  // Endereço antigo → reescreve no formato novo (sem navegar). Só depois de saber se é pacote.
  useEffect(() => { if (exp && rota.normalizar) trocarHash(rota.aba, rota.secao); }, [exp, rota, trocarHash]);
  const irAba = useCallback((aba: AbaCockpit, secao?: SecaoCockpit | null) => trocarHash(aba, secao ?? null), [trocarHash]);

  // ── derivados ──
  const hoje = dataSP(new Date());
  const info = useMemo(() => infoFase(exp?.data_embarque, exp?.data_retorno, hoje), [exp?.data_embarque, exp?.data_retorno, hoje]);
  const linhas = useMemo(() => (exp && resumo ? linhasDaMatriz({
    exp, fase: info.fase, pax: resumo.rooming.passageiros, requisitos: resumo.requisitos, quartos: resumo.rooming.quartos, alocacoes: resumo.rooming.alocacoes,
  }) : []), [exp, resumo, info.fase]);
  const contagens = useMemo(() => contagensMatriz(linhas), [linhas]);
  const semValor = linhas.some((l) => l.celulas.pagamento.tom === "danger");
  const lideres = useMemo(() => (resumo?.rooming.passageiros ?? [])
    .filter((p) => p.tipo === "Líder" && p.status_reserva !== "Cancelado")
    .map((p) => p.nome_completo.trim().split(/\s+/)[0]), [resumo]);

  if (exp === undefined) return <Carregando />;
  if (exp === null) {
    return (
      <div className="ck-page" style={{ textAlign: "center", padding: "64px 0" }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Expedição não encontrada.</p>
        <div><Btn onClick={() => ir("expedicoes")}>Voltar pra lista</Btn></div>
      </div>
    );
  }

  const cockpit: Cockpit = { hoje, info, resumo, linhas, secao: rota.secao, irAba, recarregarResumo: () => void carregarResumo() };
  const { base, grupo } = nomeDaExpedicao(exp);
  const meta = META_FASE[info.fase];
  const cancelada = exp.status === "Cancelada";
  const divergencia = divergenciaStatus(exp.status, info.fase);
  const idxFase = BARRA_FASES.findIndex((f) => f.fase === info.fase);
  const abas = ABAS_COCKPIT.filter((a) => !(pacote && ABAS_FORA_DO_PACOTE.has(a.id)));
  const badge = (a: AbaCockpit): { txt: string; tom: "warn" | "danger" | "" } | null => {
    if (!resumo) return null;
    if (a === "passageiros" && contagens.pendencia) return { txt: String(contagens.pendencia), tom: "warn" };
    if (a === "financeiro" && semValor) return { txt: "!", tom: "danger" };
    if (a === "arquivos" && resumo.arquivos) return { txt: String(resumo.arquivos), tom: "" };
    return null;
  };
  const Comp = rota.aba !== "geral" ? COMPONENTES[rota.aba] : null;
  const metaLinha = [
    exp.destino,
    exp.data_embarque ? `${formatDate(exp.data_embarque)} → ${formatDate(exp.data_retorno)}` : "sem datas",
    lideres.length ? `${lideres.length === 1 ? "Líder" : "Líderes"} ${lideres.length === 1 ? lideres[0] : `${lideres.slice(0, -1).join(", ")} e ${lideres[lideres.length - 1]}`}` : null,
    exp.responsavel_op_nome ? `Op: ${exp.responsavel_op_nome}` : null,
    exp.responsavel_com_nome ? `Com: ${exp.responsavel_com_nome}` : null,
  ].filter(Boolean);

  return (
    <div className="ck-page">
      <button type="button" className="ck-voltar" onClick={() => ir(telaLista)}>← {pacote ? "Pacotes" : "Expedições"}</button>

      <section className="ck-head" aria-label="Expedição">
        <div className="ck-head__top">
          <div className="ck-head__tx">
            <div className="ck-head__l1">
              <h1>{base}</h1>
              {grupo && <span className="ck-gr">{grupo}</span>}
              {cancelada
                ? <span className="ck-fasechip" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>Cancelada</span>
                : <span className="ck-fasechip" style={{ background: meta.bg, color: meta.fg }}>{textoChipFase(info)}</span>}
            </div>
            <p className="ck-head__meta"><span className="ck-mono">{exp.codigo}</span>{metaLinha.map((t, i) => <span key={i}> · {t}</span>)}</p>
          </div>
          <div className="ck-head__acts">
            {/* TODO: a Área do Líder (/lider) segue no app antigo e não há endereço dela no QS. */}
            <Btn disabled title="A Área do Líder (/lider) ainda está no app antigo — sem endereço no QS">Portal do líder</Btn>
            {!somenteLeitura && <Btn onClick={() => setEditando(true)}>Editar</Btn>}
          </div>
        </div>
        {divergencia && <p className="ck-aviso" role="note" style={{ margin: 0 }}>{divergencia} A tela segue as datas; ajuste o status em Editar se precisar.</p>}
        {!cancelada && (
          <ol className="ck-fases" aria-label="Fases da expedição">
            {BARRA_FASES.map((f, i) => (
              <li key={f.fase} data-estado={i < idxFase ? "feita" : i === idxFase ? "atual" : "futura"} aria-current={i === idxFase ? "step" : undefined}>
                <span className="ck-fases__bar" />
                <span className="ck-fases__t">{f.rotulo}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div role="tablist" aria-label="Seções da expedição" className="ck-tabs">
        {abas.map((a) => {
          const b = badge(a.id);
          return (
            <button key={a.id} type="button" role="tab" id={`ck-tab-${a.id}`} aria-selected={rota.aba === a.id} aria-controls="ck-painel" className="ck-tab"
              onClick={() => irAba(a.id)}>
              {a.rotulo}
              {b && <span className={`ck-badge${b.tom ? ` ck-badge--${b.tom}` : ""}`} aria-label={a.id === "financeiro" ? "há passageiro sem valor" : undefined}>{b.txt}</span>}
            </button>
          );
        })}
      </div>

      <div id="ck-painel" role="tabpanel" aria-labelledby={`ck-tab-${rota.aba}`} style={{ minWidth: 0 }}>
        {Comp ? (
          <Suspense fallback={<Carregando />}><Comp exp={exp} sub={rota.sub} onMudou={recarregarTudo} cockpit={cockpit} /></Suspense>
        ) : (
          <VisaoGeral exp={exp} sub={[]} onMudou={recarregarTudo} cockpit={cockpit} />
        )}
      </div>

      {editando && <EditarExpedicao exp={exp} onFechar={() => setEditando(false)} onSalva={() => { setEditando(false); recarregarTudo(); }} />}
    </div>
  );
}
