// src/expedicoes/lista/painel/PainelViagens.tsx
// -----------------------------------------------------------------------------
// PAINEL DAS VIAGENS (03/11/2026, docs/REL-UNIFICACAO.md §4.1/§5).
//
// Bruno: "Expedições, pacotes e Inscrições… ainda não está de uma forma visual
// e bem distribuída… o relacionamento é a ponte entre a agência e a experiência
// do cliente". Antes, pra saber se UMA viagem estava em dia, o time abria o
// cockpit, a aba Passageiros, a aba Checklist, a fila de Inscrições e a Saúde.
//
// Aqui fica tudo numa tela só, por data de embarque:
//   números grandes (embarcam em 30 dias · em viagem · inscrições · sem
//   passaporte · saúde p/ médico) → filtros rápidos → um cartão por expedição /
//   pacote cadastrado, com contagem regressiva, ocupação, responsável e as
//   PENDÊNCIAS em chips que levam direto pra onde se resolve → os pacotes
//   personalizados do Bitrix (rel_viagens) dos próximos 90 dias.
//
// Só leitura e só consultas que já existem (listarExpedicoes, agregarExpedicoes,
// lerPaxProntidao, carregarFila da Saúde, inscricoes_pendentes, rel_wa_grupos,
// rel_viagens_v). Nenhuma regra nova: os números são os mesmos das telas de origem.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as KE, type ReactNode } from "react";
import { SearchInput } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { periodo as periodoViagem, quandoEmbarca, type Viagem } from "@/rel/lib/viagens";
import { useExp } from "../../contexto";
import { Carregando, useAoVivo } from "../../ui";
import { listarExpedicoes, lerPaxProntidao } from "../../lib/banco";
import { agregarExpedicoes } from "../../lib/agregados";
import { esquecer } from "../../lib/cache";
import { carregarFila, pendenteMedico } from "../../lib/saudeFila";
import { META_FASE, dataSP, diasEntre, infoFase, type InfoFase } from "../../lib/fase.ts";
import { nomeDaExpedicao } from "../../lib/nomeExpedicao.ts";
import type { ExpedicaoComAgregados } from "../../lib/database";
import "../central/central.css";
import "./painel.css";

// ── janelas (dias até o embarque) em que cada pendência vira "urgente" ──
const URGENTE_PASSAPORTE = 90;
const URGENTE_SAUDE = 45; // mesmo prazo do selo "Saúde · médico" do menu
const MOSTRAR_CHECKLIST = 60;
const MOSTRAR_SEGURO = 30;
const MOSTRAR_GRUPO = 60;
const JANELA_PACOTES = 90;

type Tom = "erro" | "aviso" | "neutro";
type Destino = { tipo: "aba"; aba: string } | { tipo: "inscricoes" } | { tipo: "saude" };
interface Pendencia { chave: string; texto: string; tom: Tom; destino?: Destino; dica?: string }

interface Card {
  e: ExpedicaoComAgregados;
  base: string;
  grupo: string | null;
  inf: InfoFase;
  pendencias: Pendencia[];
  urgentes: number;
}

type Pacote = Pick<Viagem, "id" | "titulo" | "destino" | "data_embarque" | "data_retorno" | "status" | "fase" | "dias_para_embarque"
  | "cliente_nome" | "responsavel_nome" | "passageiros" | "qtd_passageiros" | "tarefas_atrasadas" | "tarefas_pendentes">;
const COLUNAS_PACOTE = "id,titulo,destino,data_embarque,data_retorno,status,fase,dias_para_embarque,cliente_nome,responsavel_nome,passageiros,qtd_passageiros,tarefas_atrasadas,tarefas_pendentes";

interface Dados {
  cards: Card[];
  pacotes: Pacote[];
  insc: { total: number; jaSairam: number };
  semPassaporteUrgente: number;
  saudeUrgente: number;
}

type Filtro = "" | "30" | "90" | "pendencia" | "pacotes" | "viagem";
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "", rotulo: "Todas" }, { id: "30", rotulo: "Próx. 30 dias" }, { id: "90", rotulo: "Próx. 90 dias" },
  { id: "pendencia", rotulo: "Com pendência urgente" }, { id: "viagem", rotulo: "Em viagem" }, { id: "pacotes", rotulo: "Só pacotes" },
];

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Lê tudo o que o painel mostra. Cada fonte "extra" falha calada (sem acesso → some o chip, não a tela). */
async function carregar(hoje: string): Promise<Dados> {
  const todas = await listarExpedicoes();
  const embarqueDe = new Map(todas.map((e) => [e.id, e.data_embarque]));
  // Pela frente: não cancelada e ainda não voltou (sem data só se não estiver concluída).
  const vivas = todas.filter((e) => e.status !== "Cancelada" && (e.data_embarque
    ? (e.data_retorno ?? e.data_embarque) >= hoje
    : e.status !== "Concluída"));
  const ids = vivas.map((e) => e.id);

  const [agregadas, pax, fila, insc, grupos, pacotes] = await Promise.all([
    agregarExpedicoes(vivas),
    lerPaxProntidao(ids).catch(() => []),
    carregarFila(hoje).then((f) => f.casos).catch(() => []),
    supabase.from("inscricoes_pendentes").select("expedicao_id").eq("status", "pendente").limit(5000)
      .then(({ data }) => (data ?? []) as { expedicao_id: string | null }[]),
    supabase.from("rel_wa_grupos").select("expedicao_id").not("expedicao_id", "is", null).is("saiu_em", null).limit(5000)
      .then(({ data, error }) => (error ? null : (data ?? []) as { expedicao_id: string }[])),
    supabase.from("rel_viagens_v").select(COLUNAS_PACOTE).eq("servico", "pacote").eq("status", "ativa")
      .in("fase", ["antes", "em_viagem", "sem_data"]).order("data_embarque", { ascending: true, nullsFirst: false }).limit(1000)
      .then(({ data }) => (data ?? []) as Pacote[]),
  ]);

  const contar = <T,>(l: T[], chave: (x: T) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const x of l) { const k = chave(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const inscPor = contar(insc, (i) => i.expedicao_id);
  const grupoPor = grupos ? contar(grupos, (g) => g.expedicao_id) : null;
  const saudePor = contar(fila.filter(pendenteMedico), (c) => c.exp.id);
  const ativos = pax.filter((p) => p.status_reserva !== "Cancelado");
  const semPassPor = contar(ativos.filter((p) => !p.passaporte), (p) => p.expedicao_id);
  // Passaporte que vence antes de embarque + 6 meses (regra usual de entrada).
  const venceDe = contar(ativos.filter((p) => {
    const emb = p.expedicao_id ? embarqueDe.get(p.expedicao_id) : null;
    return !!(p.passaporte && p.validade_passaporte && emb && diasEntre(emb, p.validade_passaporte) < 180);
  }), (p) => p.expedicao_id);

  let semPassaporteUrgente = 0;
  let saudeUrgente = 0;
  const cards: Card[] = agregadas.map((e) => {
    const { base, grupo } = nomeDaExpedicao(e);
    const inf = infoFase(e.data_embarque, e.data_retorno, hoje);
    const d = e.data_embarque ? inf.diasParaInicio : Infinity;
    const antes = inf.fase !== "em_viagem";
    const ps: Pendencia[] = [];
    const nInsc = inscPor.get(e.id) ?? 0;
    if (nInsc) ps.push({ chave: "insc", texto: `${plural(nInsc, "inscrição", "inscrições")} p/ aprovar`, tom: "aviso", destino: { tipo: "inscricoes" } });
    const nSem = semPassPor.get(e.id) ?? 0;
    if (nSem && antes) {
      const urg = d <= URGENTE_PASSAPORTE;
      if (urg) semPassaporteUrgente += nSem;
      ps.push({ chave: "pass", texto: `${nSem} sem passaporte`, tom: urg ? "erro" : "neutro", destino: { tipo: "aba", aba: "passageiros" } });
    }
    const nVence = venceDe.get(e.id) ?? 0;
    if (nVence && antes) ps.push({ chave: "vence", texto: `${plural(nVence, "passaporte vence", "passaportes vencem")} < 6 meses`, tom: "erro", destino: { tipo: "aba", aba: "passageiros" }, dica: "Validade menor que 6 meses depois do embarque" });
    const nSaude = saudePor.get(e.id) ?? 0;
    if (nSaude && antes) {
      const urg = d <= URGENTE_SAUDE;
      if (urg) saudeUrgente += nSaude;
      ps.push({ chave: "saude", texto: `${nSaude} saúde p/ médico`, tom: urg ? "erro" : "aviso", destino: { tipo: "saude" } });
    }
    if (antes && d <= MOSTRAR_CHECKLIST && e.checklist_pct < 1) {
      ps.push({ chave: "ck", texto: `Checklist ${Math.round(e.checklist_pct * 100)}%`, tom: d <= 15 ? "erro" : "aviso", destino: { tipo: "aba", aba: "checklist" } });
    }
    if (antes && d <= MOSTRAR_SEGURO && (e.seguro_sem_apolice ?? 0) > 0) {
      ps.push({ chave: "seg", texto: `${e.seguro_sem_apolice} sem apólice de seguro`, tom: "aviso", destino: { tipo: "aba", aba: "passageiros" } });
    }
    if (grupoPor && antes && d <= MOSTRAR_GRUPO && !grupoPor.get(e.id)) {
      ps.push({ chave: "grupo", texto: "Sem grupo de WhatsApp ligado", tom: "neutro", dica: "Nenhum grupo do WhatsApp está ligado a esta expedição (Atendimento › Grupos)" });
    }
    return { e, base, grupo, inf, pendencias: ps, urgentes: ps.filter((p) => p.tom === "erro").length };
  });
  // Em viagem primeiro; depois por embarque (sem data no fim).
  cards.sort((a, b) => Number(b.inf.fase === "em_viagem") - Number(a.inf.fase === "em_viagem")
    || (a.e.data_embarque ?? "9999").localeCompare(b.e.data_embarque ?? "9999") || a.base.localeCompare(b.base, "pt-BR"));

  const jaSairam = insc.filter((i) => { const emb = i.expedicao_id ? embarqueDe.get(i.expedicao_id) : null; return !!emb && emb < hoje; }).length;
  return { cards, pacotes, insc: { total: insc.length, jaSairam }, semPassaporteUrgente, saudeUrgente };
}

/** Vai pra tela global na área em que a pessoa está (#rel/exp-… ou #ops/…), com estado na query. */
function irTelaGlobal(tela: "inscricoes" | "saude", query = "") {
  const rel = window.location.hash.startsWith("#rel");
  window.location.hash = `#${rel ? "rel" : "ops"}/${rel ? `exp-${tela}` : tela}${query}`;
  window.scrollTo(0, 0);
}

function abrirViagem(id: string) {
  const area = window.location.hash.startsWith("#rel") ? "rel" : "ops";
  window.location.hash = `#${area}/viagem/${encodeURIComponent(id)}`;
}

export default function PainelViagens() {
  const { ir } = useExp();
  const hoje = dataSP(new Date());
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("");
  const [busca, setBusca] = useState("");

  const ler = useCallback(async (fresco = true) => {
    if (fresco) esquecer("expedicoes");
    try { setDados(await carregar(hoje)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou"); }
  }, [hoje]);
  useEffect(() => { void ler(false); }, [ler]);
  useAoVivo([{ tabela: "expedicoes" }, { tabela: "passageiros" }, { tabela: "inscricoes_pendentes" }, { tabela: "rel_viagens" }], ler, 1500);

  const abrirExp = (e: ExpedicaoComAgregados, aba?: string) => ir(e.tipo === "pacote" ? "pacotes" : "expedicoes", aba ? `${e.id}/${aba}` : e.id);
  const seguir = (c: Card, p: Pendencia) => {
    if (!p.destino) return;
    if (p.destino.tipo === "aba") abrirExp(c.e, p.destino.aba);
    else if (p.destino.tipo === "inscricoes") irTelaGlobal("inscricoes", "?aba=aprovacao");
    else ir("saude");
  };

  const q = semAcento(busca.trim());
  const cardsVisiveis = useMemo(() => (dados?.cards ?? []).filter((c) => {
    if (q && !semAcento(`${c.e.codigo} ${c.e.nome} ${c.e.destino}`).includes(q)) return false;
    const d = c.e.data_embarque ? c.inf.diasParaInicio : Infinity;
    if (filtro === "30" || filtro === "90") return c.inf.fase === "em_viagem" || d <= Number(filtro);
    if (filtro === "pendencia") return c.urgentes > 0;
    if (filtro === "viagem") return c.inf.fase === "em_viagem";
    if (filtro === "pacotes") return c.e.tipo === "pacote";
    return true;
  }), [dados, q, filtro]);

  const pacotesVisiveis = useMemo(() => (dados?.pacotes ?? []).filter((p) => {
    if (q && !semAcento(`${p.titulo} ${p.destino ?? ""} ${p.cliente_nome ?? ""} ${p.responsavel_nome ?? ""}`).includes(q)) return false;
    const d = p.dias_para_embarque ?? Infinity;
    if (filtro === "30" || filtro === "90") return p.fase === "em_viagem" || d <= Number(filtro);
    if (filtro === "pendencia") return (p.tarefas_atrasadas ?? 0) > 0;
    if (filtro === "viagem") return p.fase === "em_viagem";
    return p.fase === "em_viagem" || d <= JANELA_PACOTES || filtro === "pacotes";
  }), [dados, q, filtro]);

  if (erro && !dados) return <div className="cx-page"><p style={{ color: "var(--danger)", fontSize: 13 }}>{erro}</p></div>;
  if (!dados) return <div className="cx-page"><Cabecalho /><Carregando /></div>;

  // ── números do topo ──
  const em30 = dados.cards.filter((c) => c.inf.fase !== "em_viagem" && c.e.data_embarque && c.inf.diasParaInicio <= 30);
  const pac30 = dados.pacotes.filter((p) => p.fase === "antes" && (p.dias_para_embarque ?? 99) <= 30);
  const pax30 = em30.reduce((s, c) => s + c.e.pax_confirmados, 0) + pac30.reduce((s, p) => s + (p.passageiros || p.qtd_passageiros || 0), 0);
  const emViagem = dados.cards.filter((c) => c.inf.fase === "em_viagem").length + dados.pacotes.filter((p) => p.fase === "em_viagem").length;

  return (
    <div className="cx-page">
      <Cabecalho />

      <section className="pv-kpis" aria-label="Resumo">
        <Kpi n={em30.length + pac30.length} rotulo="embarcam em 30 dias" sub={pax30 ? `${pax30} passageiros` : "ninguém nos próximos 30 dias"}
          ativo={filtro === "30"} onClick={() => setFiltro(filtro === "30" ? "" : "30")} />
        <Kpi n={emViagem} rotulo="em viagem agora" sub="expedições e pacotes" ativo={filtro === "viagem"} onClick={() => setFiltro(filtro === "viagem" ? "" : "viagem")} />
        <Kpi n={dados.insc.total} rotulo="inscrições p/ aprovar" tom={dados.insc.total ? "aviso" : undefined}
          sub={dados.insc.jaSairam ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>{dados.insc.jaSairam} de viagens que já saíram</span> : "fila em dia"}
          onClick={() => irTelaGlobal("inscricoes", "?aba=aprovacao")} />
        <Kpi n={dados.semPassaporteUrgente} rotulo="sem passaporte" sub={`embarcam em até ${URGENTE_PASSAPORTE} dias`} tom={dados.semPassaporteUrgente ? "erro" : undefined}
          ativo={filtro === "pendencia"} onClick={() => setFiltro(filtro === "pendencia" ? "" : "pendencia")} />
        <Kpi n={dados.saudeUrgente} rotulo="saúde p/ o médico" sub={`embarcam em até ${URGENTE_SAUDE} dias`} tom={dados.saudeUrgente ? "erro" : undefined}
          onClick={() => ir("saude")} />
      </section>

      {dados.insc.jaSairam > 0 && (
        <button type="button" className="pv-alerta" onClick={() => irTelaGlobal("inscricoes", "?aba=aprovacao&saiu=1")}>
          <strong>{plural(dados.insc.jaSairam, "inscrição está", "inscrições estão")} esperando decisão de viagens que já embarcaram.</strong>
          <span>Aprovar, recusar ou excluir — abrir a fila filtrada →</span>
        </button>
      )}

      <section className="cx-bar" aria-label="Filtros">
        <div className="pv-filtros" role="group" aria-label="Filtro rápido">
          {FILTROS.map((f) => (
            <button key={f.id || "todas"} type="button" aria-pressed={filtro === f.id} className="pv-filtro" onClick={() => setFiltro(f.id)}>{f.rotulo}</button>
          ))}
        </div>
        <div className="cx-bar__f">
          <SearchInput placeholder="Buscar expedição, código, destino ou cliente do pacote" value={busca}
            onChange={(e) => setBusca(e.target.value)} aria-label="Buscar viagem" />
        </div>
      </section>

      <section className="cx-ano" aria-label="Expedições e pacotes cadastrados">
        <h2 className="cx-ano__h">Expedições{filtro !== "pacotes" ? " e pacotes cadastrados" : ""}<span className="cx-sec__n">{cardsVisiveis.length}</span>
          <span className="cx-ano__c">clique no cartão para abrir a central da viagem; nos chips, direto na pendência</span></h2>
        {cardsVisiveis.length === 0
          ? <div className="cx-sec cx-vazio">{filtro === "pendencia" ? "Nenhuma viagem com pendência urgente. Tudo em dia." : "Nenhuma viagem com esse filtro."}</div>
          : <ul className="pv-cards">{cardsVisiveis.map((c) => <CartaoViagem key={c.e.id} c={c} abrir={() => abrirExp(c.e)} seguir={(p) => seguir(c, p)} />)}</ul>}
      </section>

      <section className="cx-ano" aria-label="Pacotes personalizados">
        <h2 className="cx-ano__h">Pacotes personalizados<span className="cx-sec__n">{pacotesVisiveis.length}</span>
          <span className="cx-ano__c">vendas de pacote do Bitrix{filtro === "" ? ` · em viagem e próximos ${JANELA_PACOTES} dias` : ""} ·{" "}
            <button type="button" className="pv-link" onClick={() => ir("pacotes")}>ver todos</button></span></h2>
        {pacotesVisiveis.length === 0
          ? <div className="cx-sec cx-vazio">Nenhum pacote personalizado nesse recorte.</div>
          : <ul className="pv-lista">{pacotesVisiveis.map((p) => <LinhaPacote key={p.id} p={p} />)}</ul>}
      </section>
    </div>
  );
}

function Cabecalho() {
  return (
    <header className="cx-head">
      <div>
        <h1>Painel das viagens</h1>
        <p>Expedições, pacotes e o que falta em cada uma — em uma tela só</p>
      </div>
    </header>
  );
}

function Kpi({ n, rotulo, sub, tom, ativo, onClick }: { n: number; rotulo: string; sub: ReactNode; tom?: "erro" | "aviso"; ativo?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`pv-kpi${tom ? ` pv-kpi--${tom}` : ""}`} aria-pressed={ativo} onClick={onClick}>
      <span className="pv-kpi__n">{n}</span>
      <span className="pv-kpi__r">{rotulo}</span>
      <span className="pv-kpi__s">{sub}</span>
    </button>
  );
}

/** Contagem regressiva grande, na cor da fase. */
function Regressiva({ inf, temData }: { inf: InfoFase; temData: boolean }) {
  const m = META_FASE[inf.fase];
  if (!temData) return <div className="pv-reg" style={{ background: m.bg, color: m.fg }}><span className="pv-reg__n">—</span><span>sem data</span></div>;
  if (inf.fase === "em_viagem") return <div className="pv-reg" style={{ background: m.bg, color: m.fg }}><span className="pv-reg__n">D{inf.diaDaViagem}</span><span>de {inf.totalDias}</span></div>;
  const d = inf.diasParaInicio;
  return (
    <div className="pv-reg" style={{ background: m.bg, color: m.fg }}>
      <span className="pv-reg__n">{d === 0 ? "hoje" : d}</span><span>{d === 0 ? "embarca" : d === 1 ? "dia" : "dias"}</span>
    </div>
  );
}

function CartaoViagem({ c, abrir, seguir }: { c: Card; abrir: () => void; seguir: (p: Pendencia) => void }) {
  const { e, inf } = c;
  const tecla = (ev: KE) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) abrir(); };
  const ocup = e.pax_planejados > 0 ? Math.min(1, e.pax_confirmados / e.pax_planejados) : 0;
  const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
  const datas = e.data_embarque ? `${ddmm(e.data_embarque)} → ${ddmm(e.data_retorno)}${e.data_retorno ? `/${e.data_retorno.slice(0, 4)}` : ""}` : "sem data";
  return (
    <li className={`pv-card${c.urgentes ? " pv-card--urg" : ""}`} tabIndex={0} onClick={abrir} onKeyDown={tecla} aria-label={`Abrir ${c.base}`}>
      <div className="pv-card__topo">
        <div className="pv-card__nome">
          <span className="cx-card__t">{c.base}</span>
          <span className="pv-card__meta">
            {c.grupo && <span className="cx-gr">{c.grupo}</span>}
            {e.tipo === "pacote" && <span className="cx-gr">Pacote</span>}
            <span className="cx-cod">{e.codigo}</span>
          </span>
          <span className="cx-card__datas">{datas}</span>
        </div>
        <Regressiva inf={inf} temData={!!e.data_embarque} />
      </div>

      <div className="cx-card__oc">
        <div className="cx-card__ocl">
          <span>{e.pax_confirmados}/{e.pax_planejados || "?"} pax</span>
          <span>{e.prontidao_total ? `${e.prontidao_aptos} aptos de ${e.prontidao_total}` : ""}</span>
        </div>
        <div className="cx-barra" aria-hidden><span style={{ width: `${Math.max(2, Math.round(ocup * 100))}%`, background: "var(--text)" }} /></div>
      </div>

      <div className="pv-pend">
        {c.pendencias.length === 0
          ? <span className="pv-chip pv-chip--ok">Tudo em dia</span>
          : c.pendencias.map((p) => p.destino ? (
            <button key={p.chave} type="button" className={`pv-chip pv-chip--${p.tom}`} title={p.dica}
              onClick={(ev) => { ev.stopPropagation(); seguir(p); }} onKeyDown={(ev) => ev.stopPropagation()}>{p.texto} →</button>
          ) : <span key={p.chave} className={`pv-chip pv-chip--${p.tom}`} title={p.dica}>{p.texto}</span>)}
      </div>

      <div className="pv-card__pe">
        <span style={e.responsavel_op_nome ? undefined : { color: "var(--warn)", fontWeight: 600 }}>
          {e.responsavel_op_nome ? `Op.: ${e.responsavel_op_nome.split(" ")[0]}` : "sem responsável operacional"}
        </span>
        {e.destino && <span>{e.destino}</span>}
      </div>
    </li>
  );
}

function LinhaPacote({ p }: { p: Pacote }) {
  const pax = p.passageiros || p.qtd_passageiros || 0;
  const tecla = (ev: KE) => { if (ev.key === "Enter") abrirViagem(p.id); };
  const perto = p.fase === "em_viagem" || (p.dias_para_embarque ?? 99) <= 15;
  return (
    <li className="pv-linha" tabIndex={0} onClick={() => abrirViagem(p.id)} onKeyDown={tecla} aria-label={`Abrir ${p.titulo}`}>
      <span className="pv-linha__nome"><strong>{p.cliente_nome ?? p.titulo}</strong><span>{p.destino ?? p.titulo}{pax ? ` · ${pax} pax` : ""}</span></span>
      <span className="pv-linha__d">{periodoViagem(p)}</span>
      <span className="cx-chip" style={perto ? { background: "var(--warn-bg)", color: "var(--warn)" } : undefined}>{quandoEmbarca(p)}</span>
      <span className="pv-linha__t" style={p.tarefas_atrasadas ? { color: "var(--danger)", fontWeight: 700 } : undefined}>
        {p.tarefas_atrasadas ? `${plural(p.tarefas_atrasadas, "tarefa atrasada", "tarefas atrasadas")}` : p.tarefas_pendentes ? `${p.tarefas_pendentes} a fazer` : "em dia"}
      </span>
      <span className="pv-linha__r" style={p.responsavel_nome ? undefined : { color: "var(--warn)" }}>{p.responsavel_nome ? p.responsavel_nome.split(" ")[0] : "sem dono"}</span>
    </li>
  );
}
