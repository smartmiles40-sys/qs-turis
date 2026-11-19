// src/rel/viagens/FiltrosPainel.tsx
// -----------------------------------------------------------------------------
// Os filtros que ficam no topo do PAINEL de Viagens (Bruno, 19/11: "deve ficar
// no filtro do painel mesmo" + "tem como deixar de uma forma mais visual?").
//
//   • LINHA DO TEMPO: uma barra por semana (pacote âmbar + expedição verde) com
//     quantas viagens caem nela pela data escolhida. Clicar numa barra filtra a
//     semana; arrastar por cima junta várias. As semanas fora do período ficam
//     apagadas.
//   • Botões com ÍCONE e o NÚMERO de viagens de cada opção (com os outros
//     filtros valendo). Opção sem nenhuma fica apagada.
//   • ETIQUETAS dos filtros ligados, cada uma com × pra tirar.
// Regras em src/rel/lib/filtroViagens.ts.
// -----------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import {
  CAMPOS_DATA, FILTRO_PADRAO, PERIODOS, SERVICOS_FILTRO, SITUACOES, TEM_NO_ROTEIRO, alternarTem, contarOpcoes, contarPorSemana, intervaloDoPeriodo,
  quantosAtivos, semanasDaLinha, type ContextoFiltro, type FiltroPainel, type TemNoRoteiro,
} from "../lib/filtroViagens";
import { FASES, SERVICOS, TIPOS_VIAGEM, dataBR, grupoDe, hojeSP, proximoVoo, type Servico, type Viagem } from "../lib/viagens";
import { Entrada } from "../ui";
import { COR_EXP, COR_PAC } from "./MapaMundi";

// ── Ícones (traço, 16px, herdam a cor) ──────────────────────────────────────

const ICONES: Record<string, ReactNode> = {
  aviao: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  interno: <><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /><circle cx="5" cy="5" r="2.2" /></>,
  semVoo: <><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /><path d="M3 3l18 18" /></>,
  hotel: <><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" /><path d="M2 16h20" /><path d="M6 10V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></>,
  transfer: <><path d="M3 6h13l4 5v5h-2" /><path d="M3 6v10h2" /><path d="M9 16h6" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M3 11h17" /></>,
  passeio: <><path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" /><path d="M13 5v2M13 17v2M13 11v2" /></>,
  trem: <><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 11h14M9 21l-2-4M15 21l2-4" /><circle cx="9" cy="14" r=".6" /><circle cx="15" cy="14" r=".6" /></>,
  calendario: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  pessoa: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  busca: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  bandeira: <><path d="M4 22V4" /><path d="M4 4h12l-2 4 2 4H4" /></>,
};
function Icone({ nome, tamanho = 15 }: { nome: string; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-shrink-0">
      {ICONES[nome]}
    </svg>
  );
}

const ICONE_TEM: Record<TemNoRoteiro, string> = { voo_interno: "interno", voo: "aviao", sem_voo: "semVoo", hospedagem: "hotel", transfer: "transfer", passeio: "passeio", trem: "trem" };
export const COR_SERVICO: Partial<Record<Servico, string>> = { expedicao: COR_EXP, pacote: COR_PAC, aereo: "#60A5FA", hospedagem: "#A78BFA", passeio: "#2DD4BF", cruzeiro: "#F472B6" };

// ── Peças ───────────────────────────────────────────────────────────────────

function Chip({ ativo, onClick, children, title, n, apagado }: { ativo: boolean; onClick: () => void; children: ReactNode; title?: string; n?: number; apagado?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} title={title}
      className="rel-linha inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-opacity"
      style={{
        ...(ativo ? { background: "var(--rel-soft)", color: "var(--rel-ink)", boxShadow: "inset 0 0 0 1.5px var(--rel)" } : { color: "var(--ink2)", boxShadow: "inset 0 0 0 1px var(--line)" }),
        opacity: apagado && !ativo ? 0.45 : 1,
      }}>
      {children}
      {n != null && (
        <span className="tabular-nums text-[11px] font-bold px-1.5 rounded-md min-w-[22px] text-center"
          style={ativo ? { background: "var(--rel)", color: "#fff" } : { background: "var(--card2)", color: "var(--ink3)" }}>{n}</span>
      )}
    </button>
  );
}

function Grupo({ titulo, icone, children }: { titulo: string; icone: string; children: ReactNode }) {
  return (
    <div className="rounded-xl p-3 min-w-0" style={{ background: "var(--card2)", border: "1px solid var(--line2)" }}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink3)" }}><Icone nome={icone} tamanho={13} />{titulo}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Etiqueta({ children, onTirar }: { children: ReactNode; onTirar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[12px] font-semibold" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>
      {children}
      <button type="button" onClick={onTirar} aria-label="Tirar este filtro" className="w-5 h-5 rounded-full inline-flex items-center justify-center hover:brightness-90" style={{ background: "rgba(0,0,0,.08)" }}>×</button>
    </span>
  );
}

// ── Linha do tempo ──────────────────────────────────────────────────────────

const N_SEMANAS = 12;

function LinhaDoTempo({ vs, f, ctx, onEscolher }: { vs: Viagem[]; f: FiltroPainel; ctx: ContextoFiltro; onEscolher: (de: string, ate: string) => void }) {
  const paraTras = f.campo === "venda";
  const semanas = useMemo(() => semanasDaLinha(ctx.hoje, N_SEMANAS, paraTras), [ctx.hoje, paraTras]);
  const contas = useMemo(() => contarPorSemana(vs, f, ctx, semanas, grupoDe), [vs, f, ctx, semanas]);
  const max = Math.max(1, ...contas.map((c) => c.expedicao + c.pacote));
  const { de, ate } = intervaloDoPeriodo(f, ctx.hoje);
  const temPeriodo = !!(de || ate);
  const [arrasto, setArrasto] = useState<{ a: number; b: number } | null>(null);
  const noArrasto = (i: number) => arrasto && i >= Math.min(arrasto.a, arrasto.b) && i <= Math.max(arrasto.a, arrasto.b);
  const soltar = () => {
    if (!arrasto) return;
    const i = Math.min(arrasto.a, arrasto.b), j = Math.max(arrasto.a, arrasto.b);
    setArrasto(null);
    onEscolher(semanas[i].de, semanas[j].ate);
  };

  return (
    <div className="select-none" onPointerLeave={() => arrasto && soltar()}>
      <div className="flex items-end gap-1 h-[92px]" role="group" aria-label="Viagens por semana — clique ou arraste pra filtrar">
        {semanas.map((s, i) => {
          const c = contas[i], total = c.expedicao + c.pacote;
          const naSelecao = arrasto ? noArrasto(i) : temPeriodo && (!ate || s.de <= ate) && (!de || s.ate >= de);
          const apagada = (arrasto || temPeriodo) && !naSelecao;
          const ehHoje = ctx.hoje >= s.de && ctx.hoje <= s.ate;
          const h = (n: number) => `${Math.max(n ? 6 : 0, (n / max) * 64)}px`;
          return (
            <button key={s.de} type="button"
              onPointerDown={(e) => { e.preventDefault(); setArrasto({ a: i, b: i }); }}
              onPointerEnter={() => arrasto && setArrasto({ ...arrasto, b: i })}
              onPointerUp={soltar}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEscolher(s.de, s.ate); } }}
              aria-label={`Semana de ${dataBR(s.de)} a ${dataBR(s.ate)}: ${total} viage${total === 1 ? "m" : "ns"} (${c.pacote} pacotes, ${c.expedicao} expedições)`}
              title={`${dataBR(s.de)} a ${dataBR(s.ate)} · ${c.pacote} pacote${c.pacote === 1 ? "" : "s"} · ${c.expedicao} expedição${c.expedicao === 1 ? "" : "ões"}`}
              className="flex-1 min-w-0 h-full flex flex-col items-center justify-end rounded-md pt-1 transition-opacity hover:bg-[var(--card2)] cursor-pointer"
              style={{ opacity: apagada ? 0.3 : 1, background: naSelecao ? "var(--rel-soft)" : undefined }}>
              <span className="text-[10.5px] font-bold tabular-nums mb-0.5" style={{ color: total ? "var(--ink2)" : "var(--ink3)" }}>{total || ""}</span>
              <span className="w-full max-w-[34px] flex flex-col justify-end rounded-t overflow-hidden">
                <span style={{ height: h(c.pacote), background: COR_PAC }} />
                <span style={{ height: h(c.expedicao), background: COR_EXP }} />
                {!total && <span style={{ height: 2, background: "var(--line)" }} />}
              </span>
              <span className="w-full h-[3px] mt-0.5 rounded-full" style={{ background: ehHoje ? "var(--rel)" : "transparent" }} />
            </button>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {semanas.map((s) => {
          const ehHoje = ctx.hoje >= s.de && ctx.hoje <= s.ate;
          return (
            <span key={s.de} className="flex-1 min-w-0 text-center leading-tight">
              <span className="block text-[10px] tabular-nums truncate" style={{ color: ehHoje ? "var(--rel-ink)" : "var(--ink3)", fontWeight: ehHoje ? 700 : 400 }}>{ehHoje ? "hoje" : s.rotulo}</span>
              <span className="block text-[10px] font-bold uppercase" style={{ color: "var(--ink2)" }}>{s.mes ?? " "}</span>
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--ink3)" }}>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COR_PAC }} />Pacotes e serviços</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COR_EXP }} />Expedições</span>
        <span>· clique numa semana ou arraste pra juntar várias</span>
      </p>
    </div>
  );
}

// ── Planilha ────────────────────────────────────────────────────────────────

const servicoDe = (v: Viagem) => (v.servico ? SERVICOS[v.servico] : TIPOS_VIAGEM[v.tipo]);

/** Planilha das viagens filtradas (";" + BOM: o Excel em pt-BR abre certinho). */
export function baixarCsv(lista: Viagem[]) {
  const cab = ["Cliente", "Viagem", "Serviço", "Ida", "Volta", "Próximo voo", "Voos internos", "Voos", "Passageiros", "Dono", "Situação", "Venda", "Nº Bitrix"];
  const esc = (x: unknown) => { const s = x == null ? "" : String(x); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = lista.map((v) => [
    v.cliente_nome, v.titulo, servicoDe(v), dataBR(v.data_embarque), dataBR(v.data_retorno), v.proximo_voo_em ? proximoVoo(v).quando : "",
    v.voos_internos ?? 0, v.voos_total ?? 0, v.passageiros, v.responsavel_nome ?? "", FASES[v.fase], dataBR(v.data_venda), v.bitrix_deal_id ?? "",
  ].map(esc).join(";"));
  const blob = new Blob(["﻿" + [cab.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `viagens-${hojeSP()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Painel de filtros ───────────────────────────────────────────────────────

const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);

export default function FiltrosPainel({ f, onMudar, equipe, viagens, ctx }: {
  f: FiltroPainel; onMudar: (f: FiltroPainel) => void; equipe: { id: string; name: string }[];
  /** as viagens do painel (já com o Todos/Pacotes/Expedições aplicado) — pros números */
  viagens: Viagem[]; ctx: ContextoFiltro;
}) {
  const mudar = (p: Partial<FiltroPainel>) => onMudar({ ...f, ...p });
  const intervalo = intervaloDoPeriodo(f, ctx.hoje);
  const ativos = quantosAtivos(f);
  const extras = ativos - (f.periodo !== "tudo" ? 1 : 0);
  const [mais, setMais] = useState(extras > 0);
  const nServ = useMemo(() => contarOpcoes(viagens, f, ctx, "servicos"), [viagens, f, ctx]);
  const nTem = useMemo(() => contarOpcoes(viagens, f, ctx, "tem"), [viagens, f, ctx]);
  const campo = CAMPOS_DATA.find((c) => c.id === f.campo)!;
  const nomeDono = f.dono === "minhas" ? "as minhas" : f.dono === "sem_dono" ? "sem dono" : equipe.find((u) => u.id === f.dono)?.name ?? "—";
  const textoPeriodo = f.periodo === "livre"
    ? `${intervalo.de ? dataBR(intervalo.de).slice(0, 5) : "…"} a ${intervalo.ate ? dataBR(intervalo.ate).slice(0, 5) : "…"}`
    : PERIODOS.find((p) => p.id === f.periodo)?.rotulo;

  return (
    <section className="rel-card p-3.5 space-y-3" aria-label="Filtrar o painel">
      {/* topo: qual data + atalhos */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mr-1" style={{ color: "var(--ink3)" }}><Icone nome="calendario" tamanho={13} />Data</span>
        <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "var(--card2)" }} role="group" aria-label="Qual data">
          {CAMPOS_DATA.map((c) => (
            <button key={c.id} type="button" onClick={() => mudar({ campo: c.id })} aria-pressed={f.campo === c.id} title={c.dica}
              className="px-2.5 py-1 rounded-md text-[12px] font-semibold whitespace-nowrap"
              style={f.campo === c.id ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 2px rgba(0,0,0,.15)" } : { color: "var(--ink3)" }}>
              {c.rotulo}
            </button>
          ))}
        </div>
        <span className="w-px h-5 mx-1" style={{ background: "var(--line)" }} />
        {PERIODOS.filter((p) => p.id !== "livre").map((p) => (
          <Chip key={p.id} ativo={f.periodo === p.id} onClick={() => mudar({ periodo: p.id })}>{p.rotulo}</Chip>
        ))}
        <span className="flex items-center gap-1 text-[12px]" style={{ color: "var(--ink2)" }}>
          <input type="date" className="rel-input" style={{ width: 138, paddingTop: 5, paddingBottom: 5 }} value={f.periodo === "livre" ? f.de : ""} aria-label="De"
            onChange={(e) => mudar({ periodo: "livre", de: e.target.value, ate: f.periodo === "livre" ? f.ate : "" })} />
          a
          <input type="date" className="rel-input" style={{ width: 138, paddingTop: 5, paddingBottom: 5 }} value={f.periodo === "livre" ? f.ate : ""} aria-label="Até"
            onChange={(e) => mudar({ periodo: "livre", ate: e.target.value, de: f.periodo === "livre" ? f.de : "" })} />
        </span>
      </div>

      <LinhaDoTempo vs={viagens} f={f} ctx={ctx} onEscolher={(de, ate) => mudar({ periodo: "livre", de, ate })} />

      {/* filtros ligados + abrir o resto */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: "1px solid var(--line2)" }}>
        {f.periodo !== "tudo" && <Etiqueta onTirar={() => mudar({ periodo: "tudo" })}><Icone nome="calendario" tamanho={12} />{campo.rotulo}: {textoPeriodo}</Etiqueta>}
        {f.servicos.map((s) => (
          <Etiqueta key={s} onTirar={() => mudar({ servicos: f.servicos.filter((x) => x !== s) })}>
            <span className="w-2 h-2 rounded-full" style={{ background: COR_SERVICO[s] ?? "var(--ink3)" }} />{SERVICOS_FILTRO.find((x) => x.id === s)?.rotulo}
          </Etiqueta>
        ))}
        {f.tem.map((t) => (
          <Etiqueta key={t} onTirar={() => mudar({ tem: f.tem.filter((x) => x !== t) })}><Icone nome={ICONE_TEM[t]} tamanho={12} />{TEM_NO_ROTEIRO.find((x) => x.id === t)?.rotulo}</Etiqueta>
        ))}
        {f.situacao !== "ativas" && <Etiqueta onTirar={() => mudar({ situacao: "ativas" })}><Icone nome="bandeira" tamanho={12} />{SITUACOES.find((x) => x.id === f.situacao)?.rotulo}</Etiqueta>}
        {f.dono !== "todos" && <Etiqueta onTirar={() => mudar({ dono: "todos" })}><Icone nome="pessoa" tamanho={12} />{nomeDono}</Etiqueta>}
        {f.busca.trim() && <Etiqueta onTirar={() => mudar({ busca: "" })}><Icone nome="busca" tamanho={12} />“{f.busca.trim()}”</Etiqueta>}
        {ativos === 0 && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Nenhum filtro: o painel mostra tudo o que vai acontecer.</span>}
        <span className="flex-1" />
        {ativos > 0 && <button type="button" className="underline text-[12px] px-1" style={{ color: "var(--ink3)" }} onClick={() => onMudar(FILTRO_PADRAO)}>Limpar tudo</button>}
        <button type="button" onClick={() => setMais((x) => !x)} aria-expanded={mais}
          className="rel-linha inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold" style={{ color: extras ? "var(--rel-ink)" : "var(--ink2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden style={{ transform: mais ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><path d="m6 9 6 6 6-6" /></svg>
          {mais ? "Menos filtros" : "Mais filtros"}{extras > 0 ? ` (${extras})` : ""}
        </button>
      </div>

      {mais && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          <Grupo titulo="Serviço vendido" icone="bandeira">
            {SERVICOS_FILTRO.map((s) => {
              const n = nServ.get(s.id) ?? 0;
              return (
                <Chip key={s.id} ativo={f.servicos.includes(s.id)} n={n} apagado={!n} onClick={() => mudar({ servicos: alternar<Servico>(f.servicos, s.id) })}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: COR_SERVICO[s.id] }} />{s.rotulo}
                </Chip>
              );
            })}
          </Grupo>
          <Grupo titulo="Tem no roteiro" icone="aviao">
            {TEM_NO_ROTEIRO.map((t) => {
              const n = nTem.get(t.id) ?? 0;
              return (
                <Chip key={t.id} ativo={f.tem.includes(t.id)} n={n} apagado={!n} title={t.dica} onClick={() => mudar({ tem: alternarTem(f.tem, t.id) })}>
                  <Icone nome={ICONE_TEM[t.id]} />{t.rotulo}
                </Chip>
              );
            })}
            {f.tem.length > 1 && <span className="text-[11.5px] self-center" style={{ color: "var(--ink3)" }}>precisa ter todos</span>}
          </Grupo>
          <Grupo titulo="Situação e dono" icone="pessoa">
            {SITUACOES.map((s) => <Chip key={s.id} ativo={f.situacao === s.id} onClick={() => mudar({ situacao: s.id })}>{s.rotulo}</Chip>)}
            <select className="rel-input" style={{ width: "auto", paddingTop: 5, paddingBottom: 5 }} value={f.dono} aria-label="Quem cuida" onChange={(e) => mudar({ dono: e.target.value })}>
              <option value="todos">Qualquer dono</option>
              <option value="minhas">As minhas</option>
              <option value="sem_dono">Sem dono</option>
              {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Grupo>
          <Grupo titulo="Buscar" icone="busca">
            <div className="w-full"><Entrada value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} aria-label="Buscar viagens" placeholder="Cliente, viagem, destino, expedição ou nº do Bitrix" /></div>
          </Grupo>
        </div>
      )}
    </section>
  );
}
