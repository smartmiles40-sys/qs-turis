// src/rel/viagens/PainelViagens.tsx
// -----------------------------------------------------------------------------
// PAINEL de Viagens (pedido do Bruno, 13/10): em cima o mapa-múndi com um ponto
// de luz em cada destino com viajante; embaixo, cards (próximo embarque,
// próximo voo interno, próximo check-in, revisadas) e o QUADRO DE PARTIDAS,
// igual ao de aeroporto, mostrando se cada saída já foi revisada.
//
// Sempre separando EXPEDIÇÃO de PACOTE: dois quadros, cores diferentes no
// mapa e o filtro no topo vale pra tudo.
//
// Uma "partida" é uma saída: numa expedição, o grupo inteiro (mesmo lugar e
// mesma data de embarque) vira UMA linha, com a soma dos passageiros.
//
// 20/10 (0148, "está constando +431 viagens"): o painel é SÓ o que vai
// acontecer e pede acompanhamento. Sem data e sem classificação viram duas
// caixinhas que abrem a fila na Lista; seguro sozinho, concierge etc. ficam só
// na ficha do cliente. Expedição agrupa pelo LUGAR (o Bitrix e o sistema de
// Expedições escrevem o nome do grupo diferente) e a mesma pessoa vinda das
// duas fontes conta uma vez só.
// -----------------------------------------------------------------------------
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  SERVICOS, grupoDe, grupoTipo, horaDoLugar, hojeSP, momentoDoProximo, proximoVoo, pendenciasViagens, proximosTrechos, revisoesDe, viagensEmAndamento, TIPOS_TRECHO,
  type FiltroViagens, type PendenciasViagens, type Revisao, type Trecho, type Viagem,
} from "../lib/viagens";
import { Aviso } from "../ui";
import MapaMundi, { COR_EXP, COR_PAC, MarcaTipo, type PontoMapa } from "./MapaMundi";
import { lugaresDe } from "./destinos";
import { conferirViagens, contar, type Analise } from "../lib/problemas";
import { codigoDe, localizadoresDoVoo, momentoDaViagem, proximaDataDaVenda, resumirVoos, vooDaVez, type Momento, type MomentoChave } from "../lib/statusViagem";
import { ehVooQueVale } from "../lib/agendaServicos";
import { FILTRO_QUADRO_VAZIO, PERIODOS_VOO, lerFiltroQuadro, passaNoQuadro, quantosAtivosQuadro, somaDias, type FiltroQuadro, type LinhaFiltravel, type PeriodoVoo } from "../lib/filtroQuadro";
// 0359: check-in só de voo de verdade (a data do Bitrix de venda de hotel não é voo); trem segue
const pedeCheckin = (t: Trecho) => t.tipo === "trem" || ehVooQueVale(t);

type Filtro = "todos" | "expedicao" | "pacote";
const SEM_DESTINO = "\u0000sem-destino";
type Situacao = "em_viagem" | "embarcando" | "checkin" | "revisada" | "pendente";

interface Partida {
  chave: string;
  tipo: "expedicao" | "pacote";
  data: string | null;
  destino: string;
  grupo: string;
  passageiros: number;
  viagens: Viagem[];
  revisadas: number;
  situacao: Situacao;
  /** 0152: a venda com o voo mais próximo da saída (quem já viaja tem conexão / volta). */
  proximo: Viagem | null;
}

const SITUACAO: Record<Situacao, { texto: string; cor: string }> = {
  em_viagem: { texto: "EM VIAGEM", cor: "#7CC4FF" },
  embarcando: { texto: "EMBARCANDO", cor: "#FF8A65" },
  checkin: { texto: "CHECK-IN ABERTO", cor: "#FFD54F" },
  revisada: { texto: "REVISADA ✓", cor: "#5BE3B0" },
  pendente: { texto: "PENDENTE", cor: "#FFFFFF" },
};


// mesmo "hoje" do banco (fase da viagem vem de rel_hoje(), fuso de São Paulo)
const hojeISO = hojeSP;
const pax = (v: Viagem) => Math.max(v.passageiros || 0, v.qtd_passageiros || 0, 1);
/** Dia (AAAA-MM-DD) de um instante, em São Paulo — voo do Bitrix é 00:00 de lá. */
const hojeDe = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const dataBoard = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "--/--/--");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function diasAte(d: string | null): string {
  if (!d) return "";
  const n = Math.round((new Date(d + "T12:00:00").getTime() - new Date(hojeISO() + "T12:00:00").getTime()) / 86400000);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

function montarPartidas(viagens: Viagem[], rev: Map<string, Revisao>, trechos: Trecho[]): Partida[] {
  const agora = Date.now();
  const checkinAberto = new Set(
    trechos.filter((t) => pedeCheckin(t) && t.checkin_em && !t.checkin_feito_em && !t.status_manual && new Date(t.checkin_em).getTime() <= agora && new Date(t.partida_em).getTime() > agora)
      .map((t) => t.viagem_id),
  );
  const hoje = hojeISO();
  const m = new Map<string, Partida>();
  const nomes = new Map<string, Map<string, number>>(); // saída → nome do grupo → vendas
  for (const v of viagens) {
    const tipo = grupoDe(v);
    const lugar = tipo === "expedicao" ? [v.expedicao, v.destino, v.titulo].map((t) => lugaresDe(t)).find((x) => x.length)?.[0] : undefined;
    const chave = tipo === "expedicao" ? `exp|${lugar?.id ?? (v.expedicao || v.id)}|${v.data_embarque ?? ""}` : `v|${v.id}`;
    const p = m.get(chave) ?? {
      chave, tipo, data: v.data_embarque, destino: (tipo === "expedicao" && lugar?.nome) || v.destino || v.titulo, grupo: "", passageiros: 0, viagens: [], revisadas: 0, situacao: "pendente" as Situacao, proximo: null,
    };
    p.viagens.push(v);
    if (v.proximo_voo_em && (!p.proximo || v.proximo_voo_em < p.proximo.proximo_voo_em!)) p.proximo = v;
    if (rev.get(v.id)?.revisado_em) p.revisadas += 1;
    if (v.expedicao) { const n = nomes.get(chave) ?? new Map<string, number>(); n.set(v.expedicao, (n.get(v.expedicao) ?? 0) + 1); nomes.set(chave, n); }
    m.set(chave, p);
  }
  for (const p of m.values()) {
    // mesma pessoa em duas vendas da saída (Bitrix + Expedições): conta uma vez só
    const porCliente = new Map<string, number>();
    let soltos = 0;
    for (const v of p.viagens) {
      if (v.cliente_id) porCliente.set(v.cliente_id, Math.max(porCliente.get(v.cliente_id) ?? 0, pax(v)));
      else soltos += pax(v);
    }
    p.passageiros = soltos + [...porCliente.values()].reduce((a, b) => a + b, 0);
    // o nome de grupo mais usado na saída ("Islândia G1/ Fev 2027")
    const n = nomes.get(p.chave);
    p.grupo = n ? [...n.entries()].sort((a, b) => b[1] - a[1])[0][0] : (p.tipo === "pacote" ? p.viagens[0].titulo : "");
    if (p.viagens.some((v) => v.fase === "em_viagem")) p.situacao = "em_viagem";
    else if (p.data === hoje) p.situacao = "embarcando";
    else if (p.viagens.some((v) => checkinAberto.has(v.id))) p.situacao = "checkin";
    else if (p.revisadas === p.viagens.length) p.situacao = "revisada";
    else p.situacao = "pendente";
  }
  // na ordem do que acontece primeiro: o próximo voo (senão a data de embarque)
  const momento = (p: Partida) => Math.min(...p.viagens.map(momentoDoProximo));
  return [...m.values()].sort((a, b) => momento(a) - momento(b));
}

/** Data do quadro: o próximo voo, com hora local ("✈ 23/10 14:35"); sem voo, a data de embarque. */
const dataDoQuadro = (v: Viagem | null, data: string | null) => {
  const p = v ? proximoVoo(v) : null;
  return p?.situacao === "proximo" ? `✈ ${p.quando}` : dataBoard(data);
};

// ── Quadro de partidas ──────────────────────────────────────────────────────

const CSS_QUADRO = `
.rel-flap { display: inline-block; animation: rel-flap .5s cubic-bezier(.3,.7,.4,1) both; transform-origin: 50% 50%; backface-visibility: hidden; }
@keyframes rel-flap { 0% { transform: rotateX(-90deg); opacity: .2 } 60% { transform: rotateX(12deg); opacity: 1 } 100% { transform: rotateX(0); opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .rel-flap { animation: none } }
.rel-quadro-linha { transition: background-color .15s cubic-bezier(.25,1,.5,1); }
.rel-quadro-linha:hover { background: rgba(255,255,255,.05); }
/* o quadro é sempre escuro: aqui o anel de foco é o amarelo do painel, não o verde da área */
.rel-quadro :is(tr, button):focus-visible { outline: 2px solid #FFD54F; outline-offset: -2px; border-radius: 0; }
`;

/** Texto com efeito de plaquinha virando (letra por letra, bem rápido). */
function Flap({ texto, atraso, cor }: { texto: string; atraso: number; cor?: string }) {
  return (
    <span style={{ color: cor }} aria-label={texto}>
      {[...texto].map((c, i) => (
        <span key={i} aria-hidden className="rel-flap" style={{ animationDelay: `${atraso + i * 0.018}s` }}>{c === " " ? " " : c}</span>
      ))}
    </span>
  );
}

function Quadro({ titulo, cor, partidas, onAbrirViagem }: { titulo: string; cor: string; partidas: Partida[]; onAbrirViagem: (id: string) => void }) {
  const [todas, setTodas] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const lista = todas ? partidas : partidas.slice(0, 10);
  const mono = { fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace" };
  return (
    <section className="rel-quadro rounded-2xl overflow-hidden" aria-label={`Quadro de partidas — ${titulo}`} style={{ background: "#0B0F12", border: "1px solid #1C2328", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)" }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "#11171B", borderBottom: "1px solid #1C2328" }}>
        <h3 className="text-[13px] font-bold tracking-[.18em] uppercase flex items-center gap-2" style={{ color: cor, ...mono }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></svg>
          Partidas · {titulo}
        </h3>
        <span className="text-[11px]" style={{ color: "#8A979E", ...mono }}>{partidas.length} saída{partidas.length === 1 ? "" : "s"}</span>
      </div>
      {partidas.length === 0 ? (
        <p className="px-4 py-6 text-[13px]" style={{ color: "#8A979E", ...mono }}>NENHUMA SAÍDA PROGRAMADA</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ ...mono, color: "#F2F2F2", minWidth: 640 }}>
            <thead>
              <tr className="text-left text-[10.5px] tracking-[.14em]" style={{ color: "#7D8A91" }}>
                <th className="px-4 py-2 font-semibold">PRÓXIMO VOO</th>
                <th className="px-2 py-2 font-semibold">DESTINO</th>
                <th className="px-2 py-2 font-semibold">GRUPO</th>
                <th className="px-2 py-2 font-semibold">TIPO</th>
                <th className="px-2 py-2 font-semibold text-right">PAX</th>
                <th className="px-4 py-2 font-semibold text-right">SITUAÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p, i) => {
                const s = SITUACAO[p.situacao];
                const atraso = Math.min(i, 12) * 0.06;
                const abrir = () => (p.viagens.length === 1 ? onAbrirViagem(p.viagens[0].id) : setAberta((x) => (x === p.chave ? null : p.chave)));
                return (
                  <Fragment key={p.chave}>
                    <tr className="rel-quadro-linha cursor-pointer" style={{ borderTop: "1px solid #182026" }} onClick={abrir}
                      tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } }}
                      aria-expanded={p.viagens.length > 1 ? aberta === p.chave : undefined}
                      aria-label={`${p.tipo === "expedicao" ? "Expedição" : "Pacote"} ${p.grupo || p.destino}, ${dataDoQuadro(p.proximo, p.data)}, ${p.passageiros} passageiros, ${s.texto.replace(" ✓", "")}${p.viagens.length > 1 ? ` — ${p.viagens.length} vendas, abre a lista` : ""}`}>
                      <td className="px-4 py-2 whitespace-nowrap" style={{ color: "#FFD54F" }}><Flap texto={dataDoQuadro(p.proximo, p.data)} atraso={atraso} /></td>
                      <td className="px-2 py-2 uppercase max-w-[200px] truncate"><Flap texto={p.destino.slice(0, 22)} atraso={atraso} /></td>
                      <td className="px-2 py-2 uppercase max-w-[220px] truncate" style={{ color: "#B9C4C9" }}>{p.grupo ? <Flap texto={p.grupo.slice(0, 26)} atraso={atraso} /> : "—"}</td>
                      <td className="px-2 py-2"><span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold" style={{ background: p.tipo === "expedicao" ? "rgba(60,207,179,.15)" : "rgba(245,185,66,.15)", color: p.tipo === "expedicao" ? COR_EXP : COR_PAC }}><MarcaTipo tipo={p.tipo} tamanho={7} />{p.tipo === "expedicao" ? "EXP" : "PAC"}</span></td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: "#FFD54F" }}>{String(p.passageiros).padStart(2, "0")}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap font-bold">
                        <Flap texto={p.situacao === "pendente" && p.viagens.length > 1 ? `PENDENTE ${p.revisadas}/${p.viagens.length}` : s.texto} atraso={atraso + 0.1} cor={s.cor} />
                      </td>
                    </tr>
                    {aberta === p.chave && (
                      <tr style={{ background: "#0F1519" }}>
                        <td colSpan={6} className="px-4 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {p.viagens.map((v) => (
                              <button key={v.id} onClick={() => onAbrirViagem(v.id)} className="px-2.5 py-1.5 rounded text-[12px] hover:brightness-125"
                                style={{ background: "#182128", color: "#E6EEF1", border: "1px solid #24313A" }}>
                                {v.cliente_nome || v.titulo}{pax(v) > 1 ? ` +${pax(v) - 1}` : ""}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {partidas.length > 10 && (
        <button onClick={() => setTodas((x) => !x)} className="rel-quadro-linha w-full py-3 text-[11.5px] tracking-[.12em] font-semibold" style={{ color: "#B9C4C9", borderTop: "1px solid #182026", ...mono }}>
          {todas ? "MOSTRAR MENOS" : `VER TODAS AS ${partidas.length} SAÍDAS`}
        </button>
      )}
    </section>
  );
}

// ── Quadro dos PACOTES (Bruno, 15/10) ───────────────────────────────────────
// Pacote é onde mais tem o que cruzar: cada linha é uma venda, com o voo de ida
// (de onde, pra onde, hora local e localizador) e a situação da checagem.

// 24/11 (Bruno): a SITUAÇÃO é o que está acontecendo com a pessoa AGORA
// (momentoDaViagem em statusViagem.ts) — em voo, check-in pendente, em passeio,
// na hospedagem… Antes da viagem, sem nada a fazer, fica a situação da checagem.
type SituacaoPac = MomentoChave | "pendente" | "revisado" | "voos";
const SITUACAO_PAC: Record<SituacaoPac, { texto: string; cor: string }> = {
  em_voo: { texto: "EM VOO ✈", cor: "#7CC4FF" },
  checkin: { texto: "CHECK-IN PENDENTE", cor: "#FFD54F" },
  em_passeio: { texto: "EM PASSEIO", cor: "#5BE3B0" },
  em_transfer: { texto: "EM TRANSFER", cor: "#C4B5FD" },
  em_trem: { texto: "EM TREM", cor: "#C4B5FD" },
  na_hospedagem: { texto: "NA HOSPEDAGEM", cor: "#F0ABFC" },
  embarca_hoje: { texto: "EMBARCA HOJE", cor: "#7CC4FF" },
  volta_hoje: { texto: "VIAGEM DE VOLTA", cor: "#FF8A65" },
  em_viagem: { texto: "EM VIAGEM", cor: "#93C5FD" },
  // 30/10: voo fora das datas (ex.: Vinícius, card do Pós-Venda de mar/2026 numa viagem de jun/2027)
  voos: { texto: "VOOS A CONFERIR", cor: "#FF5252" },
  pendente: { texto: "PENDENTE CHECAGEM", cor: "#FFFFFF" },
  revisado: { texto: "REVISADO ✓", cor: "#5BE3B0" },
  // 19/11: não sobra nenhum voo — riscada, no fim da fila
  concluida: { texto: "VIAGEM CONCLUÍDA", cor: "#6B7A82" },
};

interface LinhaPac {
  v: Viagem; voo: Trecho | null; situacao: SituacaoPac; detalhe: string | null;
  /** dia do PRÓXIMO VOO: o voo da vez; sem voo, a data da venda que ainda não passou */
  dia: string | null; volta: boolean;
  localizadores: string[];
  alertas: { alta: number; media: number }; interno: number | null;
}

function situacaoPac(m: Momento | null, revisada: boolean, voosErrados: boolean): { situacao: SituacaoPac; detalhe: string | null } {
  if (m) return { situacao: m.chave, detalhe: m.detalhe };
  return { situacao: voosErrados ? "voos" : revisada ? "revisado" : "pendente", detalhe: null };
}

// 19/11 (Bruno): um filtro embaixo de cada coluna (src/rel/lib/filtroQuadro.ts),
// guardado no navegador. Somam entre si; o título mostra "X de Y vendas".
const CHAVE_FILTRO_QUADRO = "rel_quadro_pacotes_filtro";
const ESTILO_CAMPO: React.CSSProperties = {
  width: "100%", background: "#0F1519", border: "1px solid #24313A", borderRadius: 6, color: "#E6EEF1",
  fontSize: 11, padding: "4px 6px", fontFamily: "inherit", letterSpacing: 0, textTransform: "none", fontWeight: 500, outline: "none",
};
const ESTILO_ATIVO: React.CSSProperties = { borderColor: "#FFD54F", background: "rgba(255,213,79,.08)" };

const aeroDe = (codigo?: string | null, nome?: string | null) => codigoDe(codigo, nome) || (nome || "").trim();

function linhaFiltravel({ v, voo, situacao, alertas, interno, dia, localizadores }: LinhaPac): LinhaFiltravel {
  return {
    cliente: v.cliente_nome || v.titulo,
    servico: v.servico,
    de: voo ? [voo.origem_codigo, voo.origem].filter(Boolean).join(" ") : "",
    para: voo ? [voo.destino_codigo, voo.destino, v.destino].filter(Boolean).join(" ") : [v.destino, v.titulo].filter(Boolean).join(" "),
    dia,
    temLocalizador: localizadores.length > 0,
    interno, pax: pax(v), alertas, situacao,
  };
}

function QuadroPacotes({ linhas, onAbrirViagem }: { linhas: LinhaPac[]; onAbrirViagem: (id: string) => void }) {
  const [todas, setTodas] = useState(false);
  const [f, setFState] = useState<FiltroQuadro>(() => { try { return lerFiltroQuadro(localStorage.getItem(CHAVE_FILTRO_QUADRO)); } catch { return FILTRO_QUADRO_VAZIO; } });
  const guardar = (n: FiltroQuadro) => { try { localStorage.setItem(CHAVE_FILTRO_QUADRO, JSON.stringify(n)); } catch { /* sem localStorage */ } return n; };
  const setF = (p: Partial<FiltroQuadro>) => setFState((x) => guardar({ ...x, ...p }));
  const ativos = quantosAtivosQuadro(f);
  const hoje = hojeISO();
  const filtradas = useMemo(() => (ativos ? linhas.filter((l) => passaNoQuadro(linhaFiltravel(l), f, hoje)) : linhas), [linhas, f, ativos, hoje]);
  const lista = todas ? filtradas : filtradas.slice(0, 12);
  const concluidas = linhas.filter((l) => l.situacao === "concluida").length;
  // opções e sugestões: o que existe no quadro
  const servicos = useMemo(() => [...new Set(linhas.map((l) => l.v.servico).filter((s): s is NonNullable<typeof s> => !!s))], [linhas]);
  const sugestoes = useMemo(() => {
    const de = new Set<string>(), para = new Set<string>();
    for (const { v, voo } of linhas) {
      const o = voo ? aeroDe(voo.origem_codigo, voo.origem) : "", d = (voo ? aeroDe(voo.destino_codigo, voo.destino) : "") || v.destino;
      if (o) de.add(o.trim());
      if (d) para.add(d.trim());
    }
    return { de: [...de].sort(), para: [...para].sort() };
  }, [linhas]);
  const ativo = (on: boolean) => (on ? { ...ESTILO_CAMPO, ...ESTILO_ATIVO } : ESTILO_CAMPO);
  const mono = { fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace" };
  return (
    <section className="rel-quadro rounded-2xl overflow-hidden" aria-label="Quadro de partidas — Pacotes e serviços" style={{ background: "#0B0F12", border: "1px solid #1C2328", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)" }}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ background: "#11171B", borderBottom: "1px solid #1C2328" }}>
        <h3 className="text-[13px] font-bold tracking-[.18em] uppercase flex items-center gap-2" style={{ color: COR_PAC, ...mono }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></svg>
          Partidas · Pacotes e serviços
        </h3>
        <span className="flex items-center gap-3 text-[11px]" style={{ color: "#8A979E", ...mono }} aria-live="polite">
          {ativos > 0 && (
            <button onClick={() => setFState(guardar(FILTRO_QUADRO_VAZIO))} className="underline hover:brightness-125" style={{ color: "#FFD54F" }}>
              LIMPAR FILTROS ({ativos})
            </button>
          )}
          {ativos > 0 ? `${filtradas.length} de ${linhas.length} vendas` : `${linhas.length} venda${linhas.length === 1 ? "" : "s"}`}
          {concluidas > 0 && <span title="Sem mais nenhum voo: ficam riscadas no fim da fila"> · {concluidas} concluída{concluidas > 1 ? "s" : ""}</span>}
        </span>
      </div>
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-[13px]" style={{ color: "#8A979E", ...mono }}>NENHUMA SAÍDA PROGRAMADA</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ ...mono, color: "#F2F2F2", minWidth: 1080 }}>
            <thead>
              <tr className="text-left text-[10.5px] tracking-[.14em]" style={{ color: "#7D8A91" }}>
                <th className="px-4 pt-2 pb-1 font-semibold">RESPONSÁVEL DA COMPRA</th>
                <th className="px-2 pt-2 pb-1 font-semibold">SERVIÇO</th>
                <th className="px-2 pt-2 pb-1 font-semibold">DE</th>
                <th className="px-2 pt-2 pb-1 font-semibold">PARA</th>
                <th className="px-2 pt-2 pb-1 font-semibold">PRÓXIMO VOO</th>
                <th className="px-2 pt-2 pb-1 font-semibold">LOCALIZADOR</th>
                <th className="px-2 pt-2 pb-1 font-semibold text-center" title="Voo interno: os voos que não são a ida nem a volta internacional">INTERNO</th>
                <th className="px-2 pt-2 pb-1 font-semibold text-right">PAX</th>
                <th className="px-2 pt-2 pb-1 font-semibold text-center">ALERTAS</th>
                <th className="px-4 pt-2 pb-1 font-semibold text-right">SITUAÇÃO</th>
              </tr>
              {/* a linha dos filtros: um embaixo de cada coluna */}
              <tr className="align-top" style={{ borderBottom: "1px solid #182026" }}>
                <th className="px-4 pb-2 font-normal" style={{ minWidth: 170 }}>
                  <input style={ativo(!!f.responsavel.trim())} value={f.responsavel} onChange={(e) => setF({ responsavel: e.target.value })} placeholder="Buscar nome…" aria-label="Filtrar responsável da compra" />
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 92 }}>
                  <select style={ativo(!!f.servico)} value={f.servico} onChange={(e) => setF({ servico: e.target.value })} aria-label="Filtrar serviço">
                    <option value="">Todos</option>
                    {servicos.map((s) => <option key={s} value={s}>{SERVICOS[s]}</option>)}
                  </select>
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 80 }}>
                  <input style={ativo(!!f.de.trim())} value={f.de} onChange={(e) => setF({ de: e.target.value })} placeholder="GRU…" list="rel-quadro-de" aria-label="Filtrar de onde sai" />
                  <datalist id="rel-quadro-de">{sugestoes.de.map((x) => <option key={x} value={x} />)}</datalist>
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 90 }}>
                  <input style={ativo(!!f.para.trim())} value={f.para} onChange={(e) => setF({ para: e.target.value })} placeholder="Destino…" list="rel-quadro-para" aria-label="Filtrar para onde vai" />
                  <datalist id="rel-quadro-para">{sugestoes.para.map((x) => <option key={x} value={x} />)}</datalist>
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 150 }}>
                  <select style={ativo(f.voo !== "tudo")} value={f.voo} aria-label="Filtrar data do próximo voo"
                    onChange={(e) => { const voo = e.target.value as PeriodoVoo; setF(voo === "livre" && !f.vooDe ? { voo, vooDe: hoje, vooAte: somaDias(hoje, 6) } : { voo }); }}>
                    {PERIODOS_VOO.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
                  </select>
                  {f.voo === "livre" && (
                    <span className="flex flex-col gap-1 mt-1">
                      <input type="date" style={{ ...ESTILO_CAMPO, colorScheme: "dark" }} value={f.vooDe} onChange={(e) => setF({ vooDe: e.target.value })} aria-label="Próximo voo de" />
                      <input type="date" style={{ ...ESTILO_CAMPO, colorScheme: "dark" }} value={f.vooAte} onChange={(e) => setF({ vooAte: e.target.value })} aria-label="Próximo voo até" />
                    </span>
                  )}
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 92 }}>
                  <select style={ativo(!!f.localizador)} value={f.localizador} onChange={(e) => setF({ localizador: e.target.value as FiltroQuadro["localizador"] })} aria-label="Filtrar localizador">
                    <option value="">Todos</option><option value="com">Com</option><option value="sem">Sem</option>
                  </select>
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 84 }}>
                  <select style={ativo(!!f.interno)} value={f.interno} onChange={(e) => setF({ interno: e.target.value as FiltroQuadro["interno"] })} aria-label="Filtrar voo interno">
                    <option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option><option value="sem_voo">Sem voos</option>
                  </select>
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 62 }}>
                  <select style={ativo(!!f.pax)} value={f.pax} onChange={(e) => setF({ pax: e.target.value as FiltroQuadro["pax"] })} aria-label="Filtrar passageiros">
                    <option value="">Todos</option><option value="1">1</option><option value="2">2</option><option value="3+">3+</option>
                  </select>
                </th>
                <th className="px-2 pb-2 font-normal" style={{ minWidth: 96 }}>
                  <select style={ativo(!!f.alertas)} value={f.alertas} onChange={(e) => setF({ alertas: e.target.value as FiltroQuadro["alertas"] })} aria-label="Filtrar alertas">
                    <option value="">Todos</option><option value="urgente">Urgentes ⚠</option><option value="algum">Com alerta</option><option value="nenhum">Sem alerta ✓</option>
                  </select>
                </th>
                <th className="px-4 pb-2 font-normal" style={{ minWidth: 140 }}>
                  <select style={ativo(!!f.situacao)} value={f.situacao} onChange={(e) => setF({ situacao: e.target.value })} aria-label="Filtrar situação">
                    <option value="">Todas</option>
                    {(Object.keys(SITUACAO_PAC) as SituacaoPac[]).map((s) => <option key={s} value={s}>{SITUACAO_PAC[s].texto.replace(" ✓", "")}</option>)}
                  </select>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-6 text-[13px]" style={{ color: "#8A979E" }}>NENHUMA VENDA COM ESSES FILTROS</td></tr>
              )}
              {lista.map(({ v, voo, situacao, detalhe, dia, volta, localizadores, alertas, interno }, i) => {
                const s = SITUACAO_PAC[situacao];
                const atraso = Math.min(i, 12) * 0.06;
                const fim = situacao === "concluida";
                const de = voo ? (aeroDe(voo.origem_codigo, voo.origem) || "—") : "—";
                const para = voo ? (aeroDe(voo.destino_codigo, voo.destino) || v.destino || "—") : (v.destino || v.titulo);
                // 24/11: sem voo cadastrado, a data da venda que ainda não passou (Gabriela Sobral: a ida 04/11 já foi → mostra a volta)
                const ida = fim ? "CONCLUÍDA" : voo ? (voo.fonte === "bitrix" ? dataBoard(hojeDe(voo.partida_em)) : horaDoLugar(voo.partida_em, voo.partida_fuso).texto) : `${volta ? "VOLTA " : ""}${dataBoard(dia)}`;
                const loc = localizadores[0] ?? null;
                const abrir = () => onAbrirViagem(v.id);
                return (
                  <tr key={v.id} className="rel-quadro-linha cursor-pointer" style={{ borderTop: "1px solid #182026", ...(fim ? { opacity: 0.45, textDecoration: "line-through" } : {}) }} onClick={abrir}
                    tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } }}
                    aria-label={`${v.cliente_nome || v.titulo}, ${v.servico ? SERVICOS[v.servico] : ""}, de ${de} para ${para}, próximo voo ${ida}, ${pax(v)} passageiros, ${s.texto.replace(" ✓", "")}`}>
                    <td className="px-4 py-2 uppercase max-w-[240px] truncate"><Flap texto={(v.cliente_nome || v.titulo).slice(0, 28)} atraso={atraso} /></td>
                    <td className="px-2 py-2 uppercase whitespace-nowrap text-[11px] font-bold" style={{ color: "#B9C4C9" }}>{v.servico ? SERVICOS[v.servico].split(" ")[0] : "—"}</td>
                    <td className="px-2 py-2 uppercase max-w-[140px] truncate" style={{ color: "#B9C4C9" }}><Flap texto={de.slice(0, 16)} atraso={atraso} /></td>
                    <td className="px-2 py-2 uppercase max-w-[160px] truncate"><Flap texto={para.slice(0, 18)} atraso={atraso} /></td>
                    <td className="px-2 py-2 whitespace-nowrap" style={{ color: "#FFD54F" }}><Flap texto={ida} atraso={atraso} /></td>
                    <td className="px-2 py-2 whitespace-nowrap tracking-wider" style={{ color: loc ? "#F2F2F2" : "#5C6A71" }}
                      title={localizadores.length > 1 ? `Um localizador por passageiro neste voo: ${localizadores.join(", ")}` : undefined}>
                      {loc ? <><Flap texto={loc} atraso={atraso} />{localizadores.length > 1 && <span className="ml-1 text-[10.5px]" style={{ color: "#8A979E" }}>+{localizadores.length - 1}</span>}</> : "——"}
                    </td>
                    <td className="px-2 py-2 text-center whitespace-nowrap font-bold" style={{ color: interno ? "#C4B5FD" : "#5C6A71" }}
                      aria-label={interno == null ? "sem voos" : interno ? `${interno} voos internos` : "sem voo interno"}>
                      {interno == null ? "——" : interno ? `SIM · ${interno}` : "NÃO"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums" style={{ color: "#FFD54F" }}>{String(pax(v)).padStart(2, "0")}</td>
                    <td className="px-2 py-2 text-center whitespace-nowrap font-bold" aria-label={`${alertas.alta} urgentes, ${alertas.media} pra conferir`}>
                      {alertas.alta > 0 && <span className="inline-block px-1.5 rounded mr-1" style={{ background: "#DC2626", color: "#fff" }}>⚠ {alertas.alta}</span>}
                      {alertas.media > 0 && <span className="inline-block px-1.5 rounded" style={{ background: "rgba(245,158,11,.25)", color: "#FBBF24" }}>{alertas.media}</span>}
                      {!alertas.alta && !alertas.media && <span style={{ color: "#5BE3B0" }}>✓</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap font-bold" title={detalhe ?? undefined}>
                      <Flap texto={s.texto} atraso={atraso + 0.1} cor={s.cor} />
                      {detalhe && <span className="block max-w-[200px] ml-auto truncate text-[10.5px] font-medium normal-case" style={{ color: "#8A979E", textDecoration: "none" }}>{detalhe}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtradas.length > 12 && (
        <button onClick={() => setTodas((x) => !x)} className="rel-quadro-linha w-full py-3 text-[11.5px] tracking-[.12em] font-semibold" style={{ color: "#B9C4C9", borderTop: "1px solid #182026", ...mono }}>
          {todas ? "MOSTRAR MENOS" : `VER TODAS AS ${filtradas.length} VENDAS`}
        </button>
      )}
    </section>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

function Card({ titulo, children, rodape }: { titulo: string; children: React.ReactNode; rodape?: React.ReactNode }) {
  return (
    <div className="rel-card p-3.5 flex flex-col min-w-0">
      <h3 className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>{titulo}</h3>
      <div className="flex-1 min-w-0">{children}</div>
      {rodape && <div className="mt-2 text-[11.5px]" style={{ color: "var(--ink3)" }}>{rodape}</div>}
    </div>
  );
}

function LinhaCard({ cor, rotulo, valor, sub, onClick }: { cor: string; rotulo: string; valor: string; sub?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={`${onClick ? "rel-linha " : ""}w-full text-left flex items-start gap-2 py-1.5 px-1.5 -mx-1.5 rounded-lg min-w-0 disabled:cursor-default`}>
      <span className="mt-1"><MarcaTipo tipo={cor === COR_PAC ? "pacote" : "expedicao"} tamanho={9} /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold" style={{ color: "var(--ink3)" }}>{rotulo}</span>
        <span className="block text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{valor}</span>
        {sub && <span className="block text-[12px] truncate" style={{ color: "var(--ink2)" }}>{sub}</span>}
      </span>
    </button>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function PainelViagens({ onAbrirViagem, onVerFila }: { onAbrirViagem: (id: string) => void; onVerFila?: (f: FiltroViagens) => void }) {
  const [pend, setPend] = useState<PendenciasViagens | null>(null);
  useEffect(() => { pendenciasViagens().then(setPend).catch(() => setPend(null)); }, []);
  const [viagens, setViagens] = useState<Viagem[] | null>(null);
  const [rev, setRev] = useState<Map<string, Revisao>>(new Map());
  const [trechos, setTrechos] = useState<Trecho[]>([]);
  // 19/11: o próximo voo anda com o relógio (voo pousou → próximo trecho → concluída)
  const [relogio, setRelogio] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setRelogio(Date.now()), 60_000); return () => clearInterval(i); }, []);
  const [analises, setAnalises] = useState<Map<string, Analise> | null>(null);
  const [resumos, setResumos] = useState<Map<string, ReturnType<typeof resumirVoos<Trecho>>>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  // Falha parcial (trechos ou revisões): o painel abre, mas avisa — senão
  // "nenhum voo" ou "tudo PENDENTE" pareceria verdade.
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const falhas: string[] = [];
        const [vs, ts] = await Promise.all([viagensEmAndamento(), proximosTrechos().catch(() => { falhas.push("os voos e trechos"); return [] as Trecho[]; })]);
        const [rv, tp] = await Promise.all([
          revisoesDe(vs.map((v) => v.id)).catch(() => { falhas.push("as revisões"); return new Map<string, Revisao>(); }),
          // o conferente roda em todas: dá os riscos E os trechos (o voo de ida de cada pacote)
          conferirViagens(vs).catch(() => { falhas.push("a conferência de riscos"); return new Map<string, Analise>(); }),
        ]);
        // o voo de cada pacote no quadro = o PRÓXIMO voo que VALE (statusViagem.ts:
        // dentro das datas, não cancelado, partida ≥ agora). 30/10: antes, sem voo
        // futuro caía no "1º da viagem" — e o Vinícius (Turquia jun/2027) mostrava
        // 21/03/2026, a data do card do Pós-Venda de outra viagem. Sem voo futuro = sem voo.
        const rs = new Map<string, ReturnType<typeof resumirVoos<Trecho>>>();
        for (const v of vs) {
          const r = resumirVoos(v, tp.get(v.id)?.trechos ?? []);
          rs.set(v.id, r);
        }
        if (!vivo) return;
        // só os trechos das viagens do painel (arquivada, seguro sozinho e sem classificação ficam fora)
        const doPainel = new Set(vs.map((v) => v.id));
        setViagens(vs); setTrechos(ts.filter((t) => doPainel.has(t.viagem_id) && t.status_manual !== "cancelado")); setRev(rv); setResumos(rs); setAnalises(tp); setErro(null);
        setAviso(falhas.length ? `Não consegui carregar ${falhas.join(" e ")} — os números abaixo podem estar incompletos.` : null);
      } catch (e) {
        if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou o painel."); setViagens([]); }
      }
    })();
    return () => { vivo = false; };
  }, []);

  const vale = (t: "expedicao" | "pacote") => filtro === "todos" || filtro === t;

  const { pontos, semLugar, semDestino } = useMemo(() => {
    const m = new Map<string, PontoMapa>();
    const sem = new Map<string, number>();
    for (const v of viagens ?? []) {
      const tipo = grupoDe(v);
      if (!vale(tipo)) continue;
      // destino → expedição → título ("Antonia Exp Tailandia" só tem o lugar no título)
      const lugares = [v.destino, v.expedicao, v.titulo].map((t) => lugaresDe(t)).find((x) => x.length) ?? [];
      if (!lugares.length) {
        // Sem texto de lugar nenhum ("-", ".", "Venda — #49991"): conta à parte, não é apelido faltando.
        const k = [v.destino, v.expedicao].find((t) => t && /[a-z]{3}/i.test(t)) || SEM_DESTINO;
        sem.set(k, (sem.get(k) ?? 0) + pax(v)); continue;
      }
      for (const l of lugares) {
        const k = `${l.id}|${tipo}`;
        const p = m.get(k) ?? { lugar: l, tipo, passageiros: 0, viagens: 0, proximoEmbarque: null };
        p.passageiros += pax(v); p.viagens += 1;
        if (v.data_embarque && (!p.proximoEmbarque || v.data_embarque < p.proximoEmbarque)) p.proximoEmbarque = v.data_embarque;
        m.set(k, p);
      }
    }
    const semDestino = sem.get(SEM_DESTINO) ?? 0;
    sem.delete(SEM_DESTINO);
    return { pontos: [...m.values()], semLugar: [...sem.entries()].sort((a, b) => b[1] - a[1]), semDestino };
  }, [viagens, filtro]);

  const partidas = useMemo(() => montarPartidas(viagens ?? [], rev, trechos), [viagens, rev, trechos]);
  const partidasExp = partidas.filter((p) => p.tipo === "expedicao");
  const linhasPac = useMemo<LinhaPac[]>(() => (viagens ?? [])
    .filter((v) => grupoDe(v) === "pacote")
    .map((v) => {
      const c = contar(analises?.get(v.id)?.problemas ?? []);
      const r = resumos.get(v.id);
      const voosErrados = !!r?.inconsistencias.some((i) => !i.ignorada && i.chave.startsWith("voo_fora:"));
      const vez = r ? vooDaVez(r, relogio, v) : { voo: null, concluida: false };
      // 24/11: o que está acontecendo agora (hotel, passeio, check-in…) — os trechos que não são voo vêm do conferente
      const outros = (analises?.get(v.id)?.trechos ?? []).filter((t) => t.tipo !== "voo_internacional" && t.tipo !== "voo_interno");
      const momento = vez.concluida ? { chave: "concluida" as const, detalhe: null } : r ? momentoDaViagem(v, r, outros, relogio) : null;
      const sit = situacaoPac(momento, !!rev.get(v.id)?.revisado_em, voosErrados);
      const prox = vez.voo ? null : proximaDataDaVenda(v, relogio);
      return { v, voo: vez.voo, ...sit, alertas: { alta: c.alta, media: c.media },
        dia: vez.voo ? hojeDe(vez.voo.partida_em) : prox?.dia ?? null, volta: prox?.qual === "volta",
        localizadores: r ? localizadoresDoVoo(vez.voo, r) : [],
        interno: r && r.voos.some((x) => x.valido) ? r.internos : null };
    })
    // concluídas saem da fila: vão pro fim
    .sort((a, b) => Number(a.situacao === "concluida") - Number(b.situacao === "concluida")
      || (a.voo?.partida_em ?? a.dia ?? "9999").localeCompare(b.voo?.partida_em ?? b.dia ?? "9999")),
  [viagens, rev, analises, resumos, relogio]);

  const hoje = hojeISO();
  const proxEmbarque = (t: "expedicao" | "pacote") => partidas.find((p) => p.tipo === t && p.data && p.data >= hoje && p.situacao !== "em_viagem");
  const agora = relogio;
  const trechosVale = trechos.filter((t) => vale(grupoTipo(t.viagem_tipo)));
  const proxVooInterno = trechosVale.find((t) => t.tipo === "voo_interno" && new Date(t.partida_em).getTime() >= agora);
  const proxCheckin = trechosVale
    .filter((t) => pedeCheckin(t) && t.checkin_em && !t.checkin_feito_em && !t.status_manual && new Date(t.partida_em).getTime() > agora)
    .sort((a, b) => a.checkin_em!.localeCompare(b.checkin_em!))[0];
  const contaRev = (t: "expedicao" | "pacote") => {
    const vs = (viagens ?? []).filter((v) => grupoDe(v) === t);
    return { feitas: vs.filter((v) => rev.get(v.id)?.revisado_em).length, total: vs.length };
  };
  const revExp = contaRev("expedicao"), revPac = contaRev("pacote");
  const emViagem = (viagens ?? []).filter((v) => v.fase === "em_viagem" && vale(grupoDe(v))).reduce((s, v) => s + pax(v), 0);
  const totalPax = (viagens ?? []).filter((v) => vale(grupoDe(v))).reduce((s, v) => s + pax(v), 0);

  if (viagens === null) return (
    <div className="space-y-4" aria-busy="true">
      <div className="rounded-2xl animate-pulse flex items-center justify-center text-[13px]"
        style={{ aspectRatio: "960 / 500", background: "radial-gradient(ellipse at 50% 40%, #0F2230 0%, #081219 70%)", border: "1px solid #14262F", color: "#8FB0BE" }}>
        Carregando o painel…
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="rel-card h-[104px] animate-pulse" style={{ background: "var(--card2)" }} />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <style>{CSS_QUADRO}</style>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {aviso && <Aviso tom="aviso">{aviso}</Aviso>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rel-card p-1" role="group" aria-label="Mostrar">
          {([["todos", "Todos"], ["pacote", "Pacotes"], ["expedicao", "Expedições"]] as [Filtro, string][]).map(([id, r]) => (
            <button key={id} onClick={() => setFiltro(id)} aria-pressed={filtro === id} className="rel-linha inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold"
              style={filtro === id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
              {id !== "todos" && <MarcaTipo tipo={id} tamanho={8} />}{r}
            </button>
          ))}
        </div>
        <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
          <b style={{ color: "var(--ink)" }}>{totalPax}</b> viajante{totalPax === 1 ? "" : "s"} com viagem marcada
          {emViagem > 0 && <> · <b style={{ color: "var(--ink)" }}>{emViagem}</b> viajando agora</>}
          {" "}· {pontos.length} destino{pontos.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* 16/11 (Bruno, limpeza): as pendências "sem dono / para classificar / sem data"
          só aparecem se a tela pedir a fila (onVerFila) — o Painel do Rel não pede mais:
          0 ações nessas filas desde que existem. */}
      {onVerFila && pend && (pend.semData > 0 || pend.classificar > 0 || pend.semDono > 0) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="O que falta arrumar (não conta como viagem)">
          {/* 0184: pacote/aéreo/hotel que vai acontecer e ninguém cuida */}
          {pend.semDono > 0 && <Pendencia n={pend.semDono} titulo="sem dono" texto="ninguém do time cuida" onClick={onVerFila ? () => onVerFila("sem_dono") : undefined} />}
          {pend.classificar > 0 && <Pendencia n={pend.classificar} titulo="para classificar" texto="o Bitrix não diz o que foi vendido" onClick={onVerFila ? () => onVerFila("classificar") : undefined} />}
          {pend.semData > 0 && <Pendencia n={pend.semData} titulo="sem data de embarque" texto="preencher a ida no Bitrix" onClick={onVerFila ? () => onVerFila("sem_data") : undefined} />}
        </div>
      )}

      {/* Tela cheia (15/10): mapa à esquerda, cards à direita — tudo numa olhada. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] gap-4 items-start">
        <div className="space-y-3 min-w-0">
      <MapaMundi pontos={pontos} />

      {semLugar.length > 0 && (
        <details className="rel-card px-4 py-2.5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
          <summary className="cursor-pointer font-semibold">{semLugar.length} destino{semLugar.length === 1 ? "" : "s"} sem lugar no mapa{semDestino ? ` · ${semDestino} passageiro${semDestino === 1 ? "" : "s"} sem destino informado no Bitrix` : ""}</summary>
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink3)" }}>O texto do destino não foi reconhecido. Ajuste o destino na viagem (ex.: "Japão", "Madri") ou peça pra incluir o apelido.</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {semLugar.map(([nome, n]) => (
              <li key={nome} className="px-2 py-0.5 rounded-full text-[11.5px]" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>{nome.slice(0, 60)} · {n}</li>
            ))}
          </ul>
        </details>
      )}

        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3 content-start">
        <Card titulo="Próximo embarque">
          {vale("pacote") && (() => { const p = proxEmbarque("pacote"); return (
            <LinhaCard cor={COR_PAC} rotulo="Pacote" valor={p ? `${dataBoard(p.data)} · ${diasAte(p.data)}` : "nenhum"} sub={p ? `${p.destino} · ${p.passageiros} pax` : undefined}
              onClick={p ? () => onAbrirViagem(p.viagens[0].id) : undefined} />); })()}
          {vale("expedicao") && (() => { const p = proxEmbarque("expedicao"); return (
            <LinhaCard cor={COR_EXP} rotulo="Expedição" valor={p ? `${dataBoard(p.data)} · ${diasAte(p.data)}` : "nenhum"} sub={p ? `${p.grupo || p.destino} · ${p.passageiros} pax` : undefined}
              onClick={p ? () => onAbrirViagem(p.viagens[0].id) : undefined} />); })()}
        </Card>
        <Card titulo="Próximo voo interno" rodape={trechos.length === 0 ? "Cadastre os voos em cada viagem (seção Trechos)." : undefined}>
          {proxVooInterno ? (
            <LinhaCard cor={grupoTipo(proxVooInterno.viagem_tipo) === "expedicao" ? COR_EXP : COR_PAC} rotulo={grupoTipo(proxVooInterno.viagem_tipo) === "expedicao" ? "Expedição" : "Pacote"}
              valor={proxVooInterno.fonte === "bitrix" ? `${new Date(proxVooInterno.partida_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · horário a confirmar` : dataHora(proxVooInterno.partida_em)}
              sub={`${[proxVooInterno.origem, proxVooInterno.destino].filter(Boolean).join(" → ") || TIPOS_TRECHO.voo_interno} · ${proxVooInterno.expedicao || proxVooInterno.viagem_titulo}`}
              onClick={() => onAbrirViagem(proxVooInterno.viagem_id)} />
          ) : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum voo interno cadastrado.</p>}
        </Card>
        <Card titulo="Próximo check-in" rodape={trechos.length === 0 ? "Check-in abre 48h antes de cada voo cadastrado." : undefined}>
          {proxCheckin ? (
            <LinhaCard cor={grupoTipo(proxCheckin.viagem_tipo) === "expedicao" ? COR_EXP : COR_PAC}
              /* Aberto: a data que importa é a do VOO (a de abertura já passou e confundia — "18/10, aberto agora" no dia 19). */
              rotulo={`${grupoTipo(proxCheckin.viagem_tipo) === "expedicao" ? "Expedição" : "Pacote"} · ${new Date(proxCheckin.checkin_em!).getTime() <= agora ? `check-in aberto desde ${dataHora(proxCheckin.checkin_em!)} · voo em` : "check-in abre em"}`}
              valor={new Date(proxCheckin.checkin_em!).getTime() > agora ? dataHora(proxCheckin.checkin_em!)
                : proxCheckin.fonte === "bitrix" ? `${new Date(proxCheckin.partida_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · horário a confirmar`
                : dataHora(proxCheckin.partida_em)}
              sub={`${TIPOS_TRECHO[proxCheckin.tipo]}${proxCheckin.numero ? ` ${proxCheckin.numero}` : ""} · ${proxCheckin.expedicao || proxCheckin.viagem_titulo}`}
              onClick={() => onAbrirViagem(proxCheckin.viagem_id)} />
          ) : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum check-in pendente.</p>}
        </Card>
        <Card titulo="Viagens revisadas">
          {vale("pacote") && <Barra cor={COR_PAC} rotulo="Pacotes" {...revPac} />}
          {vale("expedicao") && <Barra cor={COR_EXP} rotulo="Expedições" {...revExp} />}
        </Card>
        </div>
      </div>

      {/* Pacotes primeiro (Bruno, 15/10): é onde o Relacionamento mais cruza informação. */}
      {vale("pacote") && <QuadroPacotes linhas={linhasPac} onAbrirViagem={onAbrirViagem} />}
      {vale("expedicao") && <Quadro titulo="Expedições" cor={COR_EXP} partidas={partidasExp} onAbrirViagem={onAbrirViagem} />}
    </div>
  );
}

function Barra({ cor, rotulo, feitas, total }: { cor: string; rotulo: string; feitas: number; total: number }) {
  const pct = total ? Math.round((feitas / total) * 100) : 0;
  return (
    <div className="py-1">
      <div className="flex justify-between text-[12px]" style={{ color: "var(--ink2)" }}>
        <span className="inline-flex items-center gap-1.5"><MarcaTipo tipo={cor === COR_PAC ? "pacote" : "expedicao"} tamanho={8} />{rotulo}</span><span className="tabular-nums"><b style={{ color: "var(--ink)" }}>{feitas}</b> de {total}</span>
      </div>
      <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: "var(--card2)" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${rotulo} revisadas`}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor }} />
      </div>
    </div>
  );
}

/** Caixinha do que falta arrumar — abre a fila na Lista. Não entra na conta das viagens. */
function Pendencia({ n, titulo, texto, onClick }: { n: number; titulo: string; texto: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="rel-card rel-linha inline-flex items-center gap-2.5 px-3.5 py-2 text-left disabled:cursor-default"
      style={{ borderColor: "rgba(217,119,6,.45)" }}>
      <span className="text-[18px] font-bold tabular-nums" style={{ color: "#D97706" }}>{n}</span>
      <span className="leading-tight">
        <span className="block text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>{titulo}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{texto}{onClick ? " · ver fila →" : ""}</span>
      </span>
    </button>
  );
}
