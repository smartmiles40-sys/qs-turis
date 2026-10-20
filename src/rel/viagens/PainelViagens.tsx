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
  SERVICOS, grupoDe, grupoTipo, horaDoLugar, hojeSP, pendenciasViagens, proximosTrechos, revisoesDe, viagensEmAndamento, TIPOS_TRECHO,
  type FiltroViagens, type PendenciasViagens, type Revisao, type Trecho, type Viagem,
} from "../lib/viagens";
import { Aviso } from "../ui";
import MapaMundi, { COR_EXP, COR_PAC, MarcaTipo, type PontoMapa } from "./MapaMundi";
import { lugaresDe } from "./destinos";
import { conferirViagens, contar, type Analise } from "../lib/problemas";

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
    trechos.filter((t) => t.checkin_em && !t.checkin_feito_em && new Date(t.checkin_em).getTime() <= agora && new Date(t.partida_em).getTime() > agora)
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
      chave, tipo, data: v.data_embarque, destino: (tipo === "expedicao" && lugar?.nome) || v.destino || v.titulo, grupo: "", passageiros: 0, viagens: [], revisadas: 0, situacao: "pendente" as Situacao,
    };
    p.viagens.push(v);
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
  return [...m.values()].sort((a, b) => (a.data ?? "9999").localeCompare(b.data ?? "9999"));
}

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
                <th className="px-4 py-2 font-semibold">DATA</th>
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
                      aria-label={`${p.tipo === "expedicao" ? "Expedição" : "Pacote"} ${p.grupo || p.destino}, ${dataBoard(p.data)}, ${p.passageiros} passageiros, ${s.texto.replace(" ✓", "")}${p.viagens.length > 1 ? ` — ${p.viagens.length} vendas, abre a lista` : ""}`}>
                      <td className="px-4 py-2 whitespace-nowrap" style={{ color: "#FFD54F" }}><Flap texto={dataBoard(p.data)} atraso={atraso} /></td>
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

type SituacaoPac = "pendente" | "revisado" | "ida" | "volta";
const SITUACAO_PAC: Record<SituacaoPac, { texto: string; cor: string }> = {
  pendente: { texto: "PENDENTE CHECAGEM", cor: "#FFFFFF" },
  revisado: { texto: "REVISADO ✓", cor: "#5BE3B0" },
  ida: { texto: "VIAGEM DE IDA", cor: "#7CC4FF" },
  volta: { texto: "VIAGEM DE VOLTA", cor: "#FF8A65" },
};

interface LinhaPac { v: Viagem; voo: Trecho | null; situacao: SituacaoPac; alertas: { alta: number; media: number } }

function situacaoPac(v: Viagem, revisada: boolean): SituacaoPac {
  const hoje = hojeISO();
  if (v.data_retorno && v.data_retorno === hoje && (v.fase === "em_viagem" || v.data_embarque !== hoje)) return "volta";
  if (v.fase === "em_viagem" || v.data_embarque === hoje) return "ida";
  return revisada ? "revisado" : "pendente";
}

function QuadroPacotes({ linhas, onAbrirViagem }: { linhas: LinhaPac[]; onAbrirViagem: (id: string) => void }) {
  const [todas, setTodas] = useState(false);
  const lista = todas ? linhas : linhas.slice(0, 12);
  const mono = { fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace" };
  return (
    <section className="rel-quadro rounded-2xl overflow-hidden" aria-label="Quadro de partidas — Pacotes e serviços" style={{ background: "#0B0F12", border: "1px solid #1C2328", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)" }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "#11171B", borderBottom: "1px solid #1C2328" }}>
        <h3 className="text-[13px] font-bold tracking-[.18em] uppercase flex items-center gap-2" style={{ color: COR_PAC, ...mono }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></svg>
          Partidas · Pacotes e serviços
        </h3>
        <span className="text-[11px]" style={{ color: "#8A979E", ...mono }}>{linhas.length} venda{linhas.length === 1 ? "" : "s"}</span>
      </div>
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-[13px]" style={{ color: "#8A979E", ...mono }}>NENHUMA SAÍDA PROGRAMADA</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ ...mono, color: "#F2F2F2", minWidth: 980 }}>
            <thead>
              <tr className="text-left text-[10.5px] tracking-[.14em]" style={{ color: "#7D8A91" }}>
                <th className="px-4 py-2 font-semibold">RESPONSÁVEL DA COMPRA</th>
                <th className="px-2 py-2 font-semibold">SERVIÇO</th>
                <th className="px-2 py-2 font-semibold">DE</th>
                <th className="px-2 py-2 font-semibold">PARA</th>
                <th className="px-2 py-2 font-semibold">IDA</th>
                <th className="px-2 py-2 font-semibold">LOCALIZADOR</th>
                <th className="px-2 py-2 font-semibold text-right">PAX</th>
                <th className="px-2 py-2 font-semibold text-center">ALERTAS</th>
                <th className="px-4 py-2 font-semibold text-right">SITUAÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(({ v, voo, situacao, alertas }, i) => {
                const s = SITUACAO_PAC[situacao];
                const atraso = Math.min(i, 12) * 0.06;
                const de = voo ? (voo.origem_codigo || voo.origem || "—") : "—";
                const para = voo ? (voo.destino_codigo || voo.destino || v.destino || "—") : (v.destino || v.titulo);
                const ida = voo ? horaDoLugar(voo.partida_em, voo.partida_fuso).texto : dataBoard(v.data_embarque);
                const abrir = () => onAbrirViagem(v.id);
                return (
                  <tr key={v.id} className="rel-quadro-linha cursor-pointer" style={{ borderTop: "1px solid #182026" }} onClick={abrir}
                    tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } }}
                    aria-label={`${v.cliente_nome || v.titulo}, ${v.servico ? SERVICOS[v.servico] : ""}, de ${de} para ${para}, ida ${ida}, ${pax(v)} passageiros, ${s.texto.replace(" ✓", "")}`}>
                    <td className="px-4 py-2 uppercase max-w-[240px] truncate"><Flap texto={(v.cliente_nome || v.titulo).slice(0, 28)} atraso={atraso} /></td>
                    <td className="px-2 py-2 uppercase whitespace-nowrap text-[11px] font-bold" style={{ color: "#B9C4C9" }}>{v.servico ? SERVICOS[v.servico].split(" ")[0] : "—"}</td>
                    <td className="px-2 py-2 uppercase max-w-[140px] truncate" style={{ color: "#B9C4C9" }}><Flap texto={de.slice(0, 16)} atraso={atraso} /></td>
                    <td className="px-2 py-2 uppercase max-w-[160px] truncate"><Flap texto={para.slice(0, 18)} atraso={atraso} /></td>
                    <td className="px-2 py-2 whitespace-nowrap" style={{ color: "#FFD54F" }}><Flap texto={ida} atraso={atraso} /></td>
                    <td className="px-2 py-2 whitespace-nowrap tracking-wider" style={{ color: voo?.localizador ? "#F2F2F2" : "#5C6A71" }}>{voo?.localizador ? <Flap texto={voo.localizador} atraso={atraso} /> : "——"}</td>
                    <td className="px-2 py-2 text-right tabular-nums" style={{ color: "#FFD54F" }}>{String(pax(v)).padStart(2, "0")}</td>
                    <td className="px-2 py-2 text-center whitespace-nowrap font-bold" aria-label={`${alertas.alta} urgentes, ${alertas.media} pra conferir`}>
                      {alertas.alta > 0 && <span className="inline-block px-1.5 rounded mr-1" style={{ background: "#DC2626", color: "#fff" }}>⚠ {alertas.alta}</span>}
                      {alertas.media > 0 && <span className="inline-block px-1.5 rounded" style={{ background: "rgba(245,158,11,.25)", color: "#FBBF24" }}>{alertas.media}</span>}
                      {!alertas.alta && !alertas.media && <span style={{ color: "#5BE3B0" }}>✓</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap font-bold"><Flap texto={s.texto} atraso={atraso + 0.1} cor={s.cor} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {linhas.length > 12 && (
        <button onClick={() => setTodas((x) => !x)} className="rel-quadro-linha w-full py-3 text-[11.5px] tracking-[.12em] font-semibold" style={{ color: "#B9C4C9", borderTop: "1px solid #182026", ...mono }}>
          {todas ? "MOSTRAR MENOS" : `VER TODAS AS ${linhas.length} VENDAS`}
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
  const [voosPac, setVoosPac] = useState<Map<string, Trecho>>(new Map());
  const [analises, setAnalises] = useState<Map<string, Analise> | null>(null);
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
        const vp = new Map<string, Trecho>();
        for (const a of tp.values()) for (const t of a.trechos) if ((t.tipo === "voo_internacional" || t.tipo === "voo_interno") && !vp.has(t.viagem_id)) vp.set(t.viagem_id, t);
        if (!vivo) return;
        // só os trechos das viagens do painel (arquivada, seguro sozinho e sem classificação ficam fora)
        const doPainel = new Set(vs.map((v) => v.id));
        setViagens(vs); setTrechos(ts.filter((t) => doPainel.has(t.viagem_id))); setRev(rv); setVoosPac(vp); setAnalises(tp); setErro(null);
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
    .map((v) => { const c = contar(analises?.get(v.id)?.problemas ?? []); return { v, voo: voosPac.get(v.id) ?? null, situacao: situacaoPac(v, !!rev.get(v.id)?.revisado_em), alertas: { alta: c.alta, media: c.media } }; })
    .sort((a, b) => (a.voo?.partida_em ?? a.v.data_embarque ?? "9999").localeCompare(b.voo?.partida_em ?? b.v.data_embarque ?? "9999")),
  [viagens, voosPac, rev, analises]);

  const hoje = hojeISO();
  const proxEmbarque = (t: "expedicao" | "pacote") => partidas.find((p) => p.tipo === t && p.data && p.data >= hoje && p.situacao !== "em_viagem");
  const agora = Date.now();
  const trechosVale = trechos.filter((t) => vale(grupoTipo(t.viagem_tipo)));
  const proxVooInterno = trechosVale.find((t) => t.tipo === "voo_interno" && new Date(t.partida_em).getTime() >= agora);
  const proxCheckin = trechosVale
    .filter((t) => t.checkin_em && !t.checkin_feito_em && new Date(t.partida_em).getTime() > agora)
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

      {pend && (pend.semData > 0 || pend.classificar > 0) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="O que falta arrumar (não conta como viagem)">
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
