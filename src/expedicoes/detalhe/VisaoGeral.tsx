// src/expedicoes/detalhe/VisaoGeral.tsx
// -----------------------------------------------------------------------------
// VISÃO GERAL DO COCKPIT (redesign 29/10, spec §3.3). O bloco de cima MUDA POR FASE:
//   em viagem           → "Hoje" (fundo --primary) + "Próximos dias"
//   embarque/preparação → "Contagem para o embarque" (dias, % aptos, 3 maiores pendências)
//   vendendo            → "Vendas" (ocupação, vagas, entradas dos últimos 30 dias)
//   concluída           → "Viagem concluída" (quem embarcou + pendências administrativas)
// Comum a todas: "A viagem inteira" (dias × hotéis pelas datas dos quartos), "Saúde
// da expedição" (4 cartões que levam à aba certa) e "Ações da operação" (alertas
// do roteiro do líder). Embaixo, o que a Visão Geral antiga já mostrava — prazos de
// 7 dias, documentos pendentes (top 5), resumo + observações e momentos especiais —
// pra nenhuma informação sumir.
// Só lê: os dados vêm do cockpit (detalhe/cockpit/dados.ts); nada aqui grava.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Btn } from "@/components/ui";
import { useExp } from "../contexto";
import { Carregando } from "../ui";
import { listPessoas, type PessoaAgregada } from "../lib/pessoas";
import { construirPosicoesFidelidade, ehMarco } from "../lib/fidelidade";
import { aniversarioNoMesDaExpedicao, daysUntil, formatBRL, formatDate } from "../lib/utils";
import { resumoChecklist } from "../lib/checklistResumo";
import {
  ROTULO_NIVEL, acoesDaOperacao, ddmm, diaDaSemana, hotelDoDia, montarDiasRoteiro, montarFaixaViagem, proximosDias,
} from "../lib/cockpit/viagem";
import { maioresPendencias, posEmbarque, resumoProntidao } from "../lib/cockpit/matriz";
import { TOM_TAG, cartoesSaude } from "../lib/cockpit/saude";
import { calcularRooming } from "../rooming/calculos";
import { prontidaoDosPax } from "./cockpit/dados";
import type { PropsAba } from "./ExpedicaoDetalhe";

const TOM_BARRA = { ok: "ok", warn: "warn", danger: "danger" } as const;

export default function VisaoGeral({ exp, cockpit }: PropsAba) {
  const { ir } = useExp();
  const [pessoas, setPessoas] = useState<PessoaAgregada[]>([]);
  useEffect(() => { listPessoas().then(setPessoas).catch(() => setPessoas([])); }, []);

  const resumo = cockpit?.resumo ?? null;
  const hoje = cockpit?.hoje ?? "";
  const info = cockpit?.info;
  const linhas = cockpit?.linhas ?? [];
  const pacote = exp.tipo === "pacote";
  const tela = pacote ? "pacotes" : "expedicoes";
  const pax = resumo?.rooming.passageiros ?? [];

  const pront = useMemo(() => (resumo ? prontidaoDosPax(exp, resumo.rooming.passageiros, resumo.requisitos) : new Map()), [exp, resumo]);
  const dias = useMemo(() => (resumo ? montarDiasRoteiro({ inicio: exp.data_embarque, portal: resumo.diasPortal, lider: resumo.diasLider }) : []), [exp.data_embarque, resumo]);
  const faixa = useMemo(() => montarFaixaViagem({ inicio: exp.data_embarque, fim: exp.data_retorno, hoje, quartos: resumo?.rooming.quartos ?? [] }), [exp.data_embarque, exp.data_retorno, hoje, resumo]);
  const alocados = useMemo(() => {
    if (!resumo || !resumo.rooming.quartos.length) return null;
    const r = calcularRooming(resumo.rooming, resumo.rooming.alocacoes);
    if (!r.trechos.length) return null;
    const faltando = new Set(r.trechos.flatMap((t) => r.semQuarto(t).map((p) => p.id)));
    const emTodos = r.paxAtivos.filter((p) => !faltando.has(p.id)).length;
    return { emTodos, total: r.paxAtivos.length };
  }, [resumo]);
  const checklist = useMemo(() => (resumo && !pacote ? resumoChecklist(resumo.checklist, hoje) : null), [resumo, pacote, hoje]);

  if (!cockpit || !info) return <Carregando />;
  if (!resumo) return <Carregando texto="Montando a visão geral…" />;

  const fase = info.fase;
  const pos = posEmbarque(fase);
  const nomes = new Map(pax.map((p) => [p.id, p.nome_completo] as const));
  const rp = resumoProntidao(fase, [...pront.values()]);
  const ativos = pax.filter((p) => p.status_reserva !== "Cancelado");
  const abrirPax = (id: string, modo: "pax" | "prontidao" = "prontidao") => ir(tela, `${exp.id}/passageiros/${modo}/${id}`);

  // ── Bloco por fase ──
  let blocoFase: React.ReactNode;
  if (fase === "em_viagem") {
    const diaHoje = dias.find((d) => d.data === hoje);
    const hotel = hotelDoDia(faixa.barras, hoje);
    const lideresAtivos = ativos.filter((p) => p.tipo === "Líder");
    const pagantes = ativos.filter((p) => p.tipo === "Pagante").length;
    const cortesias = ativos.filter((p) => p.tipo === "Cortesia").length;
    const emCampo = diaHoje?.lideres?.split(/\s*[·,]\s*/).filter(Boolean) ?? lideresAtivos.map((p) => p.nome_completo.split(/\s+/)[0]);
    const prox = proximosDias(dias, hoje, 2);
    blocoFase = (
      <div className="ck-row2">
        <section className="ck-hoje" aria-label="Hoje">
          <div className="ck-hoje__l">
            <span className="ck-hoje__k">Hoje · {diaDaSemana(hoje, true)}, {ddmm(hoje)} · Dia {info.diaDaViagem}</span>
            {/* Fuso em relação a Brasília: não existe no banco (ver MAPA-EXPEDICOES §6). */}
            <span>{diaHoje?.cidade ?? hotel?.nome ?? exp.destino}</span>
          </div>
          <h2>{diaHoje?.titulo || `Dia ${info.diaDaViagem} de ${info.totalDias}`}</h2>
          <div className="ck-hoje__mini">
            <div><span>Hotel</span><b>{hotel?.nome ?? "Sem hotel hoje"}</b><span>{hotel ? `check-out ${ddmm(hotel.checkOut)}` : "nenhum quarto com estas datas"}</span></div>
            <div><span>No grupo</span><b>{ativos.length} pessoa{ativos.length === 1 ? "" : "s"}</b>
              <span>{pagantes} pagante{pagantes === 1 ? "" : "s"}{cortesias ? `, ${cortesias} cortesia${cortesias === 1 ? "" : "s"}` : ""} e {lideresAtivos.length} líder{lideresAtivos.length === 1 ? "" : "es"}</span></div>
            <div><span>Líderes em campo</span><b>{emCampo.length ? emCampo.join(", ") : "—"}</b><span>{diaHoje?.lideres ? "pelo roteiro do líder" : "cadastrados como Líder"}</span></div>
          </div>
        </section>
        <section className="ck-card" aria-label="Próximos dias">
          <h3 className="ck-h3">Próximos dias</h3>
          {prox.length === 0 ? <p className="ck-vazio">Nenhum dia cadastrado depois de hoje.</p> : prox.map((d) => (
            <div key={`${d.data}-${d.n}`} className="ck-prox">
              <span className="ck-dia">DIA<b>{d.n}</b></span>
              <div className="ck-prox__tx">
                <span className="ck-prox__d">{d.data ? `${diaDaSemana(d.data)} ${ddmm(d.data)}` : ""}{d.cidade ? ` · ${d.cidade}` : ""}</span>
                <span className="ck-prox__t">{d.titulo || "—"}</span>
                {d.alerta && <span className={`ck-tag ck-tag--${d.alerta.nivel === "critico" ? "danger" : "warn"}`}>
                  {ROTULO_NIVEL[d.alerta.nivel]}{d.alerta.acao || d.alerta.texto ? ` · ${encurtar(d.alerta.acao || d.alerta.texto || "", 60)}` : ""}</span>}
              </div>
            </div>
          ))}
          <Btn style={{ marginTop: "auto" }} onClick={() => cockpit.irAba("logistica", "roteiro")} disabled={pacote}>Roteiro completo</Btn>
        </section>
      </div>
    );
  } else if (fase === "embarque" || fase === "preparacao") {
    const pend = maioresPendencias(linhas, 3);
    const pctAptos = rp.modo === "prontidao" && rp.total ? Math.round((rp.aptos / rp.total) * 100) : 0;
    blocoFase = (
      <div className="ck-row2">
        <section className="ck-card" aria-label="Contagem para o embarque">
          <div className="ck-card__h">
            <h3 className="ck-h3">Contagem para o embarque</h3>
            <span className="ck-nota">{exp.data_embarque ? `embarque ${diaDaSemana(exp.data_embarque)} ${formatDate(exp.data_embarque)}` : ""}</span>
          </div>
          <div className="ck-cont">
            <div><div className="ck-cont__n">{info.diasParaInicio}</div><div className="ck-cont__s">dia{info.diasParaInicio === 1 ? "" : "s"} para embarcar</div></div>
            {rp.modo === "prontidao" && (
              <div><div className="ck-cont__n" style={{ color: fase === "embarque" && pctAptos < 50 ? "var(--danger)" : undefined }}>{pctAptos}%</div>
                <div className="ck-cont__s">{rp.aptos} de {rp.total} aptos</div></div>
            )}
            <ul className="ck-cont__lista" aria-label="Maiores pendências">
              {pend.length === 0 ? <li style={{ color: "var(--ok)" }}>Nenhuma pendência nos passageiros.</li> : pend.map((p) => (
                <li key={p.coluna}><span className="ck-tag ck-tag--warn">{p.qtd}</span>{p.texto.replace(/^\d+\s/, "")}</li>
              ))}
            </ul>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {/* TODO: não existe disparo de cobrança nas Expedições (MAPA §6). Quando existir, ligar aqui. */}
            <Btn variant="primary" disabled title="Ainda não existe disparo de mensagem nas Expedições">Cobrar todos</Btn>
            <Btn onClick={() => cockpit.irAba("passageiros")}>Ver passageiros</Btn>
          </div>
        </section>
        {!pacote ? <ProximosPrazos ck={resumo.checklist} /> : <DocumentosPendentes pront={pront} nomes={nomes} abrir={abrirPax} pos={pos} />}
      </div>
    );
  } else if (fase === "vendendo") {
    const vagas = Math.max(0, exp.pax_planejados - exp.pax_confirmados);
    const corte = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString(); })();
    const novos = ativos.filter((p) => p.tipo !== "Líder" && p.created_at >= corte).length;
    blocoFase = (
      <div className="ck-row2">
        <section className="ck-card" aria-label="Vendas">
          <h3 className="ck-h3">Vendas</h3>
          <div className="ck-cont">
            <div><div className="ck-cont__n">{exp.pax_confirmados}/{exp.pax_planejados || "—"}</div><div className="ck-cont__s">confirmados · líderes não contam</div></div>
            <div><div className="ck-cont__n">{exp.pax_planejados ? vagas : "—"}</div><div className="ck-cont__s">{vagas === 0 && exp.pax_planejados ? "esgotada" : "vagas para vender"}</div></div>
            <div><div className="ck-cont__n">{novos}</div><div className="ck-cont__s">entraram nos últimos 30 dias<br />(pela data de cadastro do passageiro)</div></div>
          </div>
          <div className="ck-barra"><span style={{ width: `${exp.pax_planejados ? Math.min(100, (exp.pax_confirmados / exp.pax_planejados) * 100) : 0}%` }} /></div>
        </section>
        {!pacote ? <ProximosPrazos ck={resumo.checklist} /> : <DocumentosPendentes pront={pront} nomes={nomes} abrir={abrirPax} pos={pos} />}
      </div>
    );
  } else {
    const vendido = ativos.reduce((s, p) => s + Number(p.valor_contratado_brl || 0), 0);
    blocoFase = (
      <div className="ck-row2">
        <section className="ck-card" aria-label="Viagem concluída">
          <h3 className="ck-h3">Viagem concluída</h3>
          <div className="ck-cont">
            <div><div className="ck-cont__n">{ativos.length}</div><div className="ck-cont__s">embarcaram (líderes incluídos)</div></div>
            <div><div className="ck-cont__n" style={{ fontSize: 28 }}>{formatBRL(vendido)}</div><div className="ck-cont__s">vendido</div></div>
          </div>
        </section>
        <DocumentosPendentes pront={pront} nomes={nomes} abrir={abrirPax} pos />
      </div>
    );
  }

  const saude = cartoesSaude({ fase, pacote, confirmados: exp.pax_confirmados, planejados: exp.pax_planejados, linhas, checklist });
  const acoes = pacote ? [] : acoesDaOperacao(resumo.diasLider, hoje);
  const nCols = faixa.dias.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {blocoFase}

      {nCols > 0 && (
        <section className="ck-card" aria-label="A viagem inteira">
          <div className="ck-card__h">
            <h3 className="ck-h3">A viagem inteira</h3>
            <span className="ck-nota">
              {nCols} dia{nCols === 1 ? "" : "s"} · {faixa.hoteis} hote{faixa.hoteis === 1 ? "l" : "éis"}
              {alocados ? ` · ${alocados.emTodos}/${alocados.total} alocados em todos` : ""}
              {faixa.semDatas ? ` · ${faixa.semDatas} sem datas no rooming` : ""}
            </span>
          </div>
          <div className="ck-faixa">
            <div className="ck-faixa__g" style={{ gridTemplateColumns: `repeat(${nCols}, minmax(50px, 1fr))`, minWidth: nCols * 53 }}>
              {faixa.dias.map((d) => (
                <div key={d.n} className="ck-faixa__d" data-estado={d.estado} aria-current={d.estado === "hoje" ? "date" : undefined}>
                  <b>D{d.n}</b><span>{ddmm(d.data)}</span>
                </div>
              ))}
              {faixa.barras.map((b) => (
                <div key={b.chave} className="ck-faixa__h" data-tipo={b.tipo} data-pista={b.pista % 2}
                  style={{ gridRow: 2 + b.pista, gridColumn: `${b.colIni} / ${b.colFim}` }}
                  title={b.tipo === "hotel" ? `${b.nome} · ${formatDate(b.checkIn)} → ${formatDate(b.checkOut)} · ${b.quartos} quarto${b.quartos === 1 ? "" : "s"}${b.extensao ? " · extensão" : ""}` : "Dias sem hotel no rooming (voo/deslocamento)"}>
                  <b>{b.nome}</b><span>{b.tipo === "hotel" ? `${ddmm(b.checkIn)} → ${ddmm(b.checkOut)}${b.extensao ? " · extensão" : ""}` : `${ddmm(b.checkIn)} → ${ddmm(b.checkOut)}`}</span>
                </div>
              ))}
            </div>
          </div>
          {faixa.hoteis === 0 && <p className="ck-nota" style={{ margin: 0 }}>Nenhum hotel com datas no rooming ainda — os hotéis aparecem aqui pelos check-in e check-out dos quartos.</p>}
        </section>
      )}

      <section className="ck-saude" aria-label="Saúde da expedição">
        {saude.map((c) => {
          const tom = TOM_TAG[c.tag];
          return (
            <button key={c.id} type="button" className="ck-saude__c" onClick={() => cockpit.irAba(c.aba, c.secao)}>
              <span className="ck-saude__l"><span>{c.rotulo}</span><span className={`ck-tag ck-tag--${tom}`}>{c.tag}</span></span>
              <span className="ck-saude__v">{c.valor}</span>
              <span className={`ck-barra ck-barra--${TOM_BARRA[tom]}`}><span style={{ width: `${Math.max(2, Math.round(c.fracao * 100))}%` }} /></span>
              <span className="ck-saude__s">{c.sub}</span>
            </button>
          );
        })}
      </section>

      {!pacote && (
        <section className="ck-card" aria-label="Ações da operação">
          <div className="ck-card__h">
            <h3 className="ck-h3">Ações da operação</h3>
            <span className="ck-nota">vindas do roteiro do líder, até alguém dar baixa</span>
          </div>
          {acoes.length === 0 ? <p className="ck-vazio">Nenhuma ação aberta no roteiro do líder.</p> : acoes.map((a) => (
            <div key={a.id} className="ck-lin">
              <span className={`ck-tag ck-tag--${a.tom}`}>{a.tag}</span>
              <div className="ck-lin__tx">
                <span className="ck-lin__t">{a.titulo}</span>
                {a.descricao && <span className="ck-lin__s">{a.descricao}</span>}
              </div>
              {a.responsavel && <span className="ck-nota">{a.responsavel}</span>}
              {/* [SCHEMA] baixa da ação: resolvida_em/resolvida_por (docs/PROPOSTA-SCHEMA-EXPEDICOES.md §1). Não grava nada até a migration. */}
              <Btn size="sm" disabled title="Precisa da migration (resolvida_em / resolvida_por) — ver docs/PROPOSTA-SCHEMA-EXPEDICOES.md">Dar baixa</Btn>
            </div>
          ))}
          <div><Btn size="sm" variant="ghost" onClick={() => cockpit.irAba("logistica", "roteiro")}>Abrir roteiro do líder</Btn></div>
        </section>
      )}

      {/* O que a Visão Geral antiga mostrava (nada some). */}
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
        {!pacote && fase !== "embarque" && fase !== "preparacao" && fase !== "vendendo" && <ProximosPrazos ck={resumo.checklist} />}
        {/* Sem repetir o que o bloco da fase já mostrou lá em cima. */}
        {fase !== "concluida" && !(pacote && fase !== "em_viagem") && <DocumentosPendentes pront={pront} nomes={nomes} abrir={abrirPax} pos={pos} />}
        <section className="ck-card" aria-label="Resumo">
          <h3 className="ck-h3">Resumo</h3>
          <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
            <Par k="Passageiros" v={`${ativos.length} (${ativos.filter((p) => p.status_reserva === "Confirmado").length} confirmados)`} />
            {rp.modo === "prontidao"
              ? <Par k="Prontidão" v={`${rp.aptos}/${rp.total} aptos`} />
              : <Par k="Pendências administrativas" v={`${rp.comPendencia} de ${rp.total}`} />}
            {checklist && <Par k="Checklist" v={`${checklist.concluidas}/${checklist.total} tarefas concluídas`} />}
          </dl>
          {exp.observacoes && <p className="ck-nota" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{exp.observacoes}</p>}
        </section>
        <Momentos exp={exp} pax={ativos} pessoas={pessoas} />
      </div>
    </div>
  );
}

function encurtar(s: string, n: number) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

function Par({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><dt style={{ color: "var(--muted)" }}>{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>;
}

/** "Próximos prazos (7 dias)" do checklist — da Visão Geral antiga. */
function ProximosPrazos({ ck }: { ck: { id: string; prazo: string | null; status: string; tarefa: string; etapa: string }[] }) {
  const prazos = ck
    .map((c) => ({ c, d: daysUntil(c.prazo) }))
    .filter(({ c, d }) => d != null && d >= 0 && d <= 7 && c.status !== "Concluído")
    .sort((a, b) => (a.c.prazo ?? "").localeCompare(b.c.prazo ?? ""));
  return (
    <section className="ck-card" aria-label="Próximos prazos">
      <h3 className="ck-h3">Próximos prazos (7 dias)</h3>
      {prazos.length === 0 ? <p className="ck-vazio">Nenhum prazo próximo no checklist.</p> : prazos.slice(0, 8).map(({ c, d }) => (
        <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div className="ck-lin__tx" style={{ flex: 1 }}>
            <span className="ck-lin__t" style={{ fontSize: 13 }}>{c.tarefa}</span>
            <span className="ck-lin__s" style={{ fontSize: 12 }}>{c.etapa} · {formatDate(c.prazo)}</span>
          </div>
          <span className={`ck-tag ck-tag--${d! <= 1 ? "danger" : d! <= 3 ? "warn" : "info"}`}>{d === 0 ? "Hoje" : `${d}d`}</span>
        </div>
      ))}
    </section>
  );
}

type ResultadoMin = { passageiro_id: string; checagens: { tipo: string; semaforo: string }[] };

/**
 * "Documentos pendentes" (top 5, da Visão Geral antiga). Depois do embarque (§4.2)
 * vira "Pendências administrativas": sem bloqueio, só o que ficou faltando.
 */
function DocumentosPendentes({ pront, nomes, abrir, pos }: { pront: Map<string, ResultadoMin>; nomes: Map<string, string>; abrir: (id: string) => void; pos: boolean }) {
  const lista = [...pront.values()]
    .map((r) => {
      const faltas = r.checagens.filter((c) => c.semaforo === "atencao" || c.semaforo === "bloqueio");
      return { r, faltas, bloqueio: !pos && faltas.some((c) => c.semaforo === "bloqueio") };
    })
    .filter((x) => x.faltas.length > 0)
    .sort((a, b) => Number(b.bloqueio) - Number(a.bloqueio) || (nomes.get(a.r.passageiro_id) ?? "").localeCompare(nomes.get(b.r.passageiro_id) ?? "", "pt-BR"));
  return (
    <section className="ck-card" aria-label={pos ? "Pendências administrativas" : "Documentos pendentes"}>
      <div className="ck-card__h">
        <h3 className="ck-h3">{pos ? "Pendências administrativas" : "Documentos pendentes"}</h3>
        {lista.length > 0 && <span className="ck-nota">{lista.length} passageiro{lista.length === 1 ? "" : "s"}</span>}
      </div>
      {pos && <p className="ck-nota" style={{ margin: 0 }}>A viagem já começou: nada aqui bloqueia. É só o que ficou faltando de documento.</p>}
      {lista.length === 0 ? <p className="ck-vazio" style={{ color: "var(--ok)" }}>Tudo em dia.</p> : lista.slice(0, 5).map(({ r, faltas, bloqueio }) => (
        <button key={r.passageiro_id} type="button" className="ck-lin" style={{ background: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" }}
          onClick={() => abrir(r.passageiro_id)}>
          <div className="ck-lin__tx">
            <span className="ck-lin__t">{nomes.get(r.passageiro_id) ?? "Passageiro"}</span>
            <span className="ck-lin__s">{faltas.map((c) => c.tipo).join(" · ")}</span>
          </div>
          <span className={`ck-tag ck-tag--${bloqueio ? "danger" : "warn"}`}>{faltas.length}</span>
        </button>
      ))}
    </section>
  );
}

function Momentos({ exp, pax, pessoas }: { exp: PropsAba["exp"]; pax: { id: string; nome_completo: string; data_nascimento: string | null; status_reserva: string }[]; pessoas: PessoaAgregada[] }) {
  const pos = construirPosicoesFidelidade(pessoas, exp.id);
  const marcos = pax.filter((p) => ehMarco(pos[p.id])).map((p) => ({ p, pos: pos[p.id] })).sort((a, b) => b.pos - a.pos);
  const aniversarios = pax
    .map((p) => ({ p, a: aniversarioNoMesDaExpedicao(p.data_nascimento, exp.data_embarque, exp.data_retorno) }))
    .filter((x): x is { p: typeof pax[number]; a: NonNullable<typeof x.a> } => x.a != null)
    .sort((x, y) => x.a.data.localeCompare(y.a.data));
  const estreantes = pessoas.length ? pax.filter((p) => pos[p.id] === 1) : [];
  const grupos = [
    { t: "Marcos", itens: marcos.map(({ p, pos: n }) => ({ id: p.id, nome: p.nome_completo, tx: `${n}ª expedição com a gente` })) },
    { t: "Aniversariantes do mês", itens: aniversarios.map(({ p, a }) => ({ id: p.id, nome: p.nome_completo, tx: `${formatDate(a.data)}${a.idade != null ? ` · faz ${a.idade} anos` : ""}${a.naViagem ? " · durante a viagem" : ""}` })) },
    { t: "Estreantes", itens: estreantes.map((p) => ({ id: p.id, nome: p.nome_completo, tx: "Primeira viagem com a gente" })) },
  ].filter((g) => g.itens.length);
  return (
    <section className="ck-card" aria-label="Momentos especiais">
      <h3 className="ck-h3">Momentos especiais</h3>
      {!grupos.length ? <p className="ck-vazio">Nada em destaque por enquanto — marcos de fidelidade, aniversários e estreantes aparecem aqui.</p> : grupos.map((g) => (
        <div key={g.t} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="ck-nota" style={{ fontWeight: 700 }}>{g.t}</span>
          {g.itens.map((i) => <div key={i.id}><div style={{ fontWeight: 600, fontSize: 14 }}>{i.nome}</div><div className="ck-nota" style={{ fontSize: 12 }}>{i.tx}</div></div>)}
        </div>
      ))}
    </section>
  );
}
