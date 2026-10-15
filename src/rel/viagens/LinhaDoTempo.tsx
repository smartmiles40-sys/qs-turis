// src/rel/viagens/LinhaDoTempo.tsx
// -----------------------------------------------------------------------------
// LINHA DO TEMPO DIA A DIA (15/10/2026). A viagem inteira como o passageiro vai
// viver: cada dia com o que acontece em ordem (hora LOCAL do lugar) e, no fim,
// ONDE ELE DORME — o hotel daquela noite, "noite no avião" ou, em vermelho,
// "SEM HOSPEDAGEM". Os riscos do conferente aparecem colados no trecho que
// causa o problema, então nada fica escondido numa lista.
// -----------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { TIPOS_TRECHO, type Trecho } from "../lib/viagens";
import { NIVEL, diaBR, diaLocal, horaLocal, mapaDasNoites, type Nivel, type Problema } from "../lib/problemas";
import { Botao } from "../ui";
import { EditarTrecho } from "./TrechosViagem";
import { Icone, titulo } from "./RoteiroViagem";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ordemNivel: Record<Nivel, number> = { alta: 0, media: 1, info: 2 };

interface Evento { chave: string; t: Trecho; quando: number; hora: string; tipo: "inicio" | "checkout" }

function pior(ps: Problema[]): Nivel | null {
  return ps.length ? ps.reduce<Nivel>((a, p) => (ordemNivel[p.nivel] < ordemNivel[a] ? p.nivel : a), "info") : null;
}

export default function LinhaDoTempo({ viagemId, trechos, problemas, dataIda, dataVolta, ativa, onMudou }: {
  viagemId: string; trechos: Trecho[]; problemas: Problema[]; dataIda: string | null; dataVolta: string | null; ativa: boolean; onMudou: () => void;
}) {
  const [editando, setEditando] = useState<Trecho | null | undefined>(undefined);
  const { hotelDaNoite, semHotel } = useMemo(() => mapaDasNoites(trechos), [trechos]);

  const { dias, porDia, noAviao } = useMemo(() => {
    const eventos: (Evento & { dia: string })[] = [];
    const noAviao = new Set<string>();
    for (const t of trechos) {
      const soDia = t.fonte === "bitrix";
      const d = soDia ? diaLocal(t.partida_em) : diaLocal(t.partida_em, t.partida_fuso);
      if (!d) continue;
      eventos.push({ chave: `${t.id}-i`, t, dia: d, quando: new Date(t.partida_em).getTime(), hora: soDia ? "--:--" : horaLocal(t.partida_em, t.partida_fuso), tipo: "inicio" });
      if (t.tipo === "hospedagem" && t.chegada_em) {
        const co = diaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso)!;
        eventos.push({ chave: `${t.id}-o`, t, dia: co, quando: new Date(t.chegada_em).getTime(), hora: horaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso), tipo: "checkout" });
      }
      // dormiu voando: o voo sai num dia e pousa em outro
      if ((t.tipo === "voo_internacional" || t.tipo === "voo_interno" || t.tipo === "trem") && t.chegada_em && !soDia) {
        const c = diaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso)!;
        for (let x = d; x < c; x = somaDias(x, 1)) noAviao.add(x);
      }
    }
    const todosDias = eventos.map((e) => e.dia).concat([dataIda, dataVolta].filter(Boolean) as string[]).sort();
    const dias: string[] = [];
    if (todosDias.length) for (let d = todosDias[0]; d <= todosDias[todosDias.length - 1] && dias.length < 120; d = somaDias(d, 1)) dias.push(d);
    const porDia = new Map<string, Evento[]>();
    for (const e of eventos.sort((a, b) => a.quando - b.quando)) porDia.set(e.dia, [...(porDia.get(e.dia) ?? []), e]);
    return { dias, porDia, noAviao };
  }, [trechos, dataIda, dataVolta]);

  const doTrecho = useMemo(() => {
    const m = new Map<string, Problema[]>();
    for (const p of problemas) for (const id of p.trechos) m.set(id, [...(m.get(id) ?? []), p]);
    return m;
  }, [problemas]);
  // problemas do dia que não estão presos a nenhum trecho
  const soltosDoDia = useMemo(() => {
    const m = new Map<string, Problema[]>();
    for (const p of problemas) if (p.dia && !p.trechos.length) m.set(p.dia, [...(m.get(p.dia) ?? []), p]);
    return m;
  }, [problemas]);

  if (!trechos.length) {
    return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum trecho ainda. Anexe bilhetes e vouchers e clique em "Revisar com IA", ou cadastre à mão na aba "Por tipo".</p>;
  }

  return (
    <div>
      <ol className="relative">
        {dias.map((d, i) => {
          const evs = porDia.get(d) ?? [];
          const hotel = hotelDaNoite.get(d);
          const semCama = semHotel.has(d);
          const voando = noAviao.has(d);
          const soltos = soltosDoDia.get(d) ?? [];
          const dt = new Date(`${d}T12:00:00Z`);
          const fora = (dataIda && d < dataIda) || (dataVolta && d > dataVolta);
          const vazio = !evs.length && !hotel && !semCama && !voando && !soltos.length;
          return (
            <li key={d} className="relative pl-5 pb-3" style={{ borderLeft: `2px solid ${semCama ? NIVEL.alta.cor : "var(--line)"}`, marginLeft: 6 }}>
              <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full" style={{ background: evs.length ? "var(--rel)" : "var(--line)", boxShadow: "0 0 0 3px var(--card)" }} aria-hidden />
              <h3 className="flex flex-wrap items-baseline gap-2 mb-1.5">
                <span className="text-[13px] font-extrabold uppercase tracking-wide" style={{ color: fora ? "var(--ink3)" : "var(--ink)" }}>
                  {SEMANA[dt.getUTCDay()]} {diaBR(d)}
                </span>
                <span className="text-[11px] font-semibold" style={{ color: "var(--ink3)" }}>dia {i + 1}{fora ? " · fora das datas da venda" : ""}</span>
              </h3>

              {soltos.map((p, k) => (
                <p key={k} className="text-[12.5px] font-semibold mb-1 px-2 py-1 rounded" style={{ background: NIVEL[p.nivel].fundo, color: NIVEL[p.nivel].cor }}>{p.titulo}</p>
              ))}

              {vazio && <p className="text-[12px] italic mb-1" style={{ color: "var(--ink3)" }}>dia livre</p>}

              <ul className="space-y-1.5">
                {evs.map((e) => {
                  const t = e.t;
                  const ps = (doTrecho.get(t.id) ?? []).filter((p) => e.tipo === "inicio" || p.categoria === "hotel");
                  const nv = pior(ps);
                  const ehBusca = t.tipo === "transfer" || t.tipo === "passeio";
                  const cor = nv ? NIVEL[nv].cor : "var(--line)";
                  const detalhes = e.tipo === "checkout" ? [] : [
                    t.localizador && `loc. ${t.localizador}`,
                    t.terminal_partida && `terminal ${t.terminal_partida}`,
                    t.assento && `assento ${t.assento}`,
                    t.ponto_encontro && `encontro: ${t.ponto_encontro}`,
                    t.contato && `contato ${t.contato}`,
                    t.chegada_em && t.tipo !== "hospedagem" && `chega ${horaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso)}${diaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso) !== d ? ` (${diaBR(diaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso))})` : ""}`,
                  ].filter(Boolean) as string[];
                  return (
                    <li key={e.chave} id={e.tipo === "inicio" ? `trecho-${t.id}` : undefined}
                      className="rounded-xl px-3 py-2 flex gap-3 items-start"
                      style={{ border: `1px solid ${nv ? cor : "var(--line)"}`, borderLeftWidth: nv ? 4 : 1, background: nv ? NIVEL[nv].fundo : "var(--card)" }}>
                      <span className="text-[15px] font-extrabold tabular-nums w-[48px] flex-shrink-0 pt-1" style={{ color: "var(--ink)" }}>{e.hora}</span>
                      <Icone tipo={t.tipo} tamanho={28} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-bold leading-snug" style={{ color: "var(--ink)" }}>
                          {e.tipo === "checkout" ? "Check-out · " : t.tipo === "hospedagem" ? "Check-in · " : ehBusca ? `${TIPOS_TRECHO[t.tipo]} — busca · ` : `${TIPOS_TRECHO[t.tipo]} · `}
                          {titulo(t)}
                          {(t.companhia || t.numero) && e.tipo === "inicio" && <span className="font-semibold" style={{ color: "var(--ink2)" }}> {[t.companhia, t.numero].filter(Boolean).join(" ")}</span>}
                        </p>
                        {detalhes.length > 0 && <p className="text-[12px]" style={{ color: "var(--ink2)" }}>{detalhes.join(" · ")}</p>}
                        {ps.map((p, k) => (
                          <p key={k} className="text-[12px] font-semibold mt-1 flex gap-1.5" style={{ color: NIVEL[p.nivel].cor }}>
                            <span aria-hidden>{p.nivel === "alta" ? "⚠" : "•"}</span>{p.titulo}
                          </p>
                        ))}
                      </div>
                      {ativa && e.tipo === "inicio" && <Botao variante="fantasma" onClick={() => setEditando(t)} aria-label={`Editar ${titulo(t)}`}>Editar</Botao>}
                    </li>
                  );
                })}
              </ul>

              {/* onde dorme */}
              {hotel ? (
                <p className="mt-1.5 text-[12.5px] flex items-center gap-1.5" style={{ color: "var(--ink2)" }}>
                  <span aria-hidden>🌙</span> Noite: <b style={{ color: "var(--ink)" }}>{titulo(hotel)}</b>
                </p>
              ) : semCama ? (
                <p className="mt-1.5 text-[13px] font-extrabold flex items-center gap-1.5 px-2 py-1 rounded" style={{ color: NIVEL.alta.cor, background: NIVEL.alta.fundo }}>
                  <span aria-hidden>🌙</span> SEM HOSPEDAGEM NESTA NOITE
                </p>
              ) : voando ? (
                <p className="mt-1.5 text-[12.5px] flex items-center gap-1.5" style={{ color: "var(--ink3)" }}><span aria-hidden>✈</span> Noite no avião/trem</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] mt-1" style={{ color: "var(--ink3)" }}>Horários na hora local de cada lugar (quando o fuso é conhecido); sem fuso, horário de Brasília.</p>
      <EditarTrecho aberto={editando !== undefined} viagemId={viagemId} trecho={editando ?? null}
        onFechar={() => setEditando(undefined)} onSalvo={() => { setEditando(undefined); onMudou(); }} />
    </div>
  );
}
