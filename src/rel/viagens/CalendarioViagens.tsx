// src/rel/viagens/CalendarioViagens.tsx
// -----------------------------------------------------------------------------
// CALENDÁRIO de Viagens (pedido do Bruno, 13/10): quando cada cliente embarca,
// quando volta, os trechos (voos internos, trens...) e quando fazer o
// CHECK-IN. Sempre separando Expedição × Pacote (cor e etiqueta), com filtro.
//
// Mês ou semana. Clicar no dia abre a lista do dia; cada item leva pra viagem.
// Um grupo de expedição que embarca junto vira UM item ("Tailândia G1 · 18
// pax"), que abre a lista de clientes.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { grupoTipo, hojeSP, listarTrechosPeriodo, viagensNoPeriodo, TIPOS_TRECHO, type Trecho, type Viagem } from "../lib/viagens";
import { Aviso, Botao } from "../ui";
import { MarcaTipo } from "./MapaMundi";

type Filtro = "todos" | "expedicao" | "pacote";
type Tipo = "expedicao" | "pacote";
type Especie = "embarque" | "retorno" | "trecho" | "checkin";

interface Evento {
  chave: string;
  dia: string;              // AAAA-MM-DD
  hora?: string;            // HH:MM (trechos e check-ins)
  especie: Especie;
  tipo: Tipo;
  titulo: string;
  detalhe: string;
  viagens: { id: string; nome: string }[];
  feito?: boolean;          // check-in já feito
}

const COR: Record<Tipo, { fundo: string; texto: string; borda: string }> = {
  expedicao: { fundo: "var(--rel-soft)", texto: "var(--rel-ink)", borda: "#0E7C6A" },
  // texto do pacote muda com o tema (ver CSS_CAL): #9A6A00 fixo dava 4,3:1 no claro e 2,8:1 no escuro
  pacote: { fundo: "rgba(245,185,66,.16)", texto: "var(--rel-pac-ink)", borda: "#E0A21C" },
};
const CSS_CAL = `
:root { --rel-pac-ink: #7A5200; }
html.dark { --rel-pac-ink: #F5C25A; }
`;
const NOME_TIPO: Record<Tipo, string> = { expedicao: "Expedição", pacote: "Pacote" };
const ESPECIE: Record<Especie, { rotulo: string; icone: string }> = {
  embarque: { rotulo: "Embarque", icone: "M2 22h20M6.4 16.4 3 13l2-1 3 1.5 4-3.5-7-5 2.5-1L17 7l3.4-2.6a1.6 1.6 0 0 1 2.2 2.3L20 10l1 9.5-1 2.5-5-7-3.5 4L13 21l-1 2-3.4-3.4" },
  retorno: { rotulo: "Volta", icone: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" },
  trecho: { rotulo: "Trecho", icone: "M5 12h14M13 6l6 6-6 6" },
  checkin: { rotulo: "Check-in", icone: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const inicioSemana = (d: Date) => addDias(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
const pax = (v: Viagem) => Math.max(v.passageiros || 0, v.qtd_passageiros || 0, 1);
const horaDe = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaDe = (s: string) => iso(new Date(s));

function montarEventos(viagens: Viagem[], trechos: Trecho[]): Evento[] {
  const ev = new Map<string, Evento>();
  const juntar = (e: Omit<Evento, "viagens">, v: { id: string; nome: string }) => {
    const ja = ev.get(e.chave);
    if (ja) { if (!ja.viagens.some((x) => x.id === v.id)) ja.viagens.push(v); return; }
    ev.set(e.chave, { ...e, viagens: [v] });
  };
  // Embarque e volta: grupo de expedição (mesma expedição + mesma data) vira um item só.
  const grupos = new Map<string, number>();
  for (const v of viagens) {
    const tipo = grupoTipo(v.tipo);
    const nome = v.cliente_nome || v.titulo;
    const grupo = tipo === "expedicao" && v.expedicao ? v.expedicao : null;
    for (const [especie, dia] of [["embarque", v.data_embarque], ["retorno", v.data_retorno]] as [Especie, string | null][]) {
      if (!dia || (especie === "retorno" && dia === v.data_embarque)) continue;
      const chave = grupo ? `${especie}|${grupo}|${dia}` : `${especie}|${v.id}`;
      grupos.set(chave, (grupos.get(chave) ?? 0) + pax(v));
      juntar({ chave, dia, especie, tipo, titulo: grupo || v.destino || v.titulo, detalhe: "" }, { id: v.id, nome });
    }
  }
  for (const e of ev.values()) {
    const n = grupos.get(e.chave) ?? 1;
    e.detalhe = `${ESPECIE[e.especie].rotulo} · ${n} pax`;
  }
  for (const t of trechos) {
    const tipo = grupoTipo(t.viagem_tipo);
    const nome = t.viagem_titulo;
    const rota = [t.origem, t.destino].filter(Boolean).join(" → ");
    const quem = t.expedicao || t.viagem_titulo;
    // trecho igual (mesmo voo, mesma hora) de várias viagens do grupo → um item só
    const id = `${t.tipo}|${t.numero || rota}|${t.partida_em}|${t.expedicao || t.viagem_id}`;
    juntar({
      // Trecho do Pós-Venda (Bitrix) só tem o dia: sem hora no calendário.
      chave: `trecho|${id}`, dia: diaDe(t.partida_em), hora: t.fonte === "bitrix" ? undefined : horaDe(t.partida_em), especie: "trecho", tipo,
      titulo: `${TIPOS_TRECHO[t.tipo]}${t.numero ? ` ${t.numero}` : ""}`, detalhe: [rota, quem].filter(Boolean).join(" · "),
    }, { id: t.viagem_id, nome });
    if (t.checkin_em) {
      juntar({
        chave: `checkin|${id}`, dia: diaDe(t.checkin_em), hora: horaDe(t.checkin_em), especie: "checkin", tipo,
        titulo: `Check-in ${t.numero || TIPOS_TRECHO[t.tipo].toLowerCase()}`, detalhe: [rota, quem].filter(Boolean).join(" · "),
        feito: !!t.checkin_feito_em,
      }, { id: t.viagem_id, nome });
    }
  }
  const ordem: Record<Especie, number> = { checkin: 0, embarque: 1, trecho: 2, retorno: 3 };
  return [...ev.values()].sort((a, b) => a.dia.localeCompare(b.dia) || ordem[a.especie] - ordem[b.especie] || (a.hora ?? "").localeCompare(b.hora ?? ""));
}

function Icone({ d, cor }: { d: string; cor: string }) {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-shrink-0"><path d={d} /></svg>;
}

function Chip({ e, onClick }: { e: Evento; onClick: () => void }) {
  const c = COR[e.tipo];
  return (
    <button onClick={onClick} title={`${NOME_TIPO[e.tipo]} · ${e.titulo} — ${e.detalhe}${e.feito ? " (check-in feito)" : ""}`}
      aria-label={`${NOME_TIPO[e.tipo]}: ${ESPECIE[e.especie].rotulo}${e.hora ? ` às ${e.hora}` : ""} — ${e.titulo}${e.feito ? ", check-in feito" : ""}`}
      className="w-full flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-semibold text-left truncate hover:brightness-95"
      style={{ background: c.fundo, color: c.texto, borderLeft: `3px solid ${c.borda}`, opacity: e.feito ? 0.6 : 1, textDecoration: e.feito ? "line-through" : undefined }}>
      <MarcaTipo tipo={e.tipo} tamanho={6} />
      <Icone d={ESPECIE[e.especie].icone} cor={c.texto} />
      <span className="truncate">{e.hora ? `${e.hora} ` : ""}{e.titulo}</span>
    </button>
  );
}

export default function CalendarioViagens({ onAbrirViagem }: { onAbrirViagem: (id: string) => void }) {
  const [modo, setModo] = useState<"mes" | "semana">("mes");
  const [ref, setRef] = useState(() => new Date());
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);

  // Dias visíveis na grade
  const dias = useMemo(() => {
    if (modo === "semana") { const ini = inicioSemana(ref); return Array.from({ length: 7 }, (_, i) => addDias(ini, i)); }
    const primeiro = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const ini = inicioSemana(primeiro);
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    const n = Math.ceil((ultimo.getDate() + primeiro.getDay()) / 7) * 7;
    return Array.from({ length: n }, (_, i) => addDias(ini, i));
  }, [modo, ref]);

  const de = iso(dias[0]), ate = iso(addDias(dias[dias.length - 1], 1));

  useEffect(() => {
    let vivo = true;
    setEventos(null);
    const deTs = new Date(de + "T00:00:00").toISOString(), ateTs = new Date(ate + "T00:00:00").toISOString();
    let semTrechos = false;
    Promise.all([viagensNoPeriodo(de, ate), listarTrechosPeriodo(deTs, ateTs).catch(() => { semTrechos = true; return [] as Trecho[]; })])
      .then(([vs, ts]) => {
        if (!vivo) return;
        setEventos(montarEventos(vs, ts));
        setErro(semTrechos ? "Os voos, trechos e check-ins não carregaram — o calendário mostra só embarques e voltas." : null);
      })
      .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou o calendário."); setEventos([]); } });
    return () => { vivo = false; };
  }, [de, ate]);

  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of eventos ?? []) {
      if (filtro !== "todos" && e.tipo !== filtro) continue;
      m.set(e.dia, [...(m.get(e.dia) ?? []), e]);
    }
    return m;
  }, [eventos, filtro]);

  const totais = useMemo(() => {
    const t = { expedicao: 0, pacote: 0, checkins: 0 };
    for (const e of eventos ?? []) {
      if (e.especie === "embarque") t[e.tipo] += 1;
      if (e.especie === "checkin" && !e.feito && (filtro === "todos" || e.tipo === filtro)) t.checkins += 1;
    }
    return t;
  }, [eventos, filtro]);

  function mover(n: number) {
    const x = new Date(ref);
    if (modo === "mes") { x.setDate(1); x.setMonth(x.getMonth() + n); } else x.setDate(x.getDate() + 7 * n);
    setRef(x); setDiaAberto(null);
  }

  const hoje = hojeSP();
  const titulo = modo === "mes"
    ? `${MESES[ref.getMonth()]} de ${ref.getFullYear()}`
    : `${dias[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} a ${dias[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  const doDia = diaAberto ? porDia.get(diaAberto) ?? [] : [];
  const abrirEvento = (e: Evento) => {
    if (e.viagens.length === 1) onAbrirViagem(e.viagens[0].id);
    else { setDiaAberto(e.dia); setGrupoAberto(e.chave); }
  };

  return (
    <div className="space-y-3">
      <style>{CSS_CAL}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Botao variante="secundario" onClick={() => mover(-1)} aria-label="Anterior">‹</Botao>
          <h2 className="text-[16px] font-bold capitalize min-w-[150px] sm:min-w-[190px] text-center" style={{ color: "var(--ink)" }} aria-live="polite">{titulo}</h2>
          <Botao variante="secundario" onClick={() => mover(1)} aria-label="Próximo">›</Botao>
          <Botao variante="fantasma" onClick={() => { setRef(new Date()); setDiaAberto(null); }}>Hoje</Botao>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 rel-card p-1" role="group" aria-label="Mostrar">
            {([["todos", "Todos"], ["expedicao", "Expedições"], ["pacote", "Pacotes"]] as [Filtro, string][]).map(([id, r]) => (
              <button key={id} onClick={() => setFiltro(id)} aria-pressed={filtro === id} className="rel-linha inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold"
                style={filtro === id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
                {id !== "todos" && <MarcaTipo tipo={id} tamanho={8} />}{r}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rel-card p-1" role="group" aria-label="Período">
            {([["mes", "Mês"], ["semana", "Semana"]] as ["mes" | "semana", string][]).map(([id, r]) => (
              <button key={id} onClick={() => setModo(id)} aria-pressed={modo === id} className="rel-linha px-3 py-2 rounded-lg text-[12.5px] font-semibold"
                style={modo === id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>{r}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]" style={{ color: "var(--ink2)" }}>
        <span className="inline-flex items-center gap-1.5"><MarcaTipo tipo="expedicao" tamanho={9} />Expedição (círculo) · {totais.expedicao} embarque(s)</span>
        <span className="inline-flex items-center gap-1.5"><MarcaTipo tipo="pacote" tamanho={9} />Pacote (losango) · {totais.pacote} embarque(s)</span>
        {(Object.keys(ESPECIE) as Especie[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1"><Icone d={ESPECIE[k].icone} cor="var(--ink2)" />{ESPECIE[k].rotulo}</span>
        ))}
        {totais.checkins > 0 && <span className="font-semibold" style={{ color: "var(--warn-ink)" }}>{totais.checkins} check-in(s) a fazer neste período</span>}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="rel-card overflow-hidden">
        <div className="grid grid-cols-7 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)", background: "var(--card2)" }}>
          {SEMANA.map((s) => <div key={s} className="px-2 py-1.5">{s}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {dias.map((d) => {
            const k = iso(d);
            const lista = porDia.get(k) ?? [];
            const fora = modo === "mes" && d.getMonth() !== ref.getMonth();
            const max = modo === "semana" ? 40 : 3;
            return (
              <div key={k} className="p-1 flex flex-col gap-0.5 cursor-pointer min-w-0"
                style={{
                  minHeight: modo === "semana" ? 260 : 72, borderTop: "1px solid var(--line2)", borderLeft: d.getDay() ? "1px solid var(--line2)" : undefined,
                  background: diaAberto === k ? "var(--rel-soft)" : fora ? "var(--card2)" : undefined, opacity: fora ? 0.7 : 1,
                }}
                onClick={() => { setDiaAberto(k === diaAberto ? null : k); setGrupoAberto(null); }}>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); setDiaAberto(k === diaAberto ? null : k); setGrupoAberto(null); }}
                  aria-label={`${d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}${lista.length ? ` — ${lista.length} evento${lista.length > 1 ? "s" : ""}` : ""}`}
                  aria-pressed={diaAberto === k}
                  className="text-[12px] font-bold self-end w-7 h-7 inline-flex items-center justify-center rounded-full"
                  style={k === hoje ? { background: "var(--rel)", color: "#fff" } : { color: fora ? "var(--ink3)" : "var(--ink2)" }}>{d.getDate()}</button>
                {eventos !== null && modo === "mes" && lista.length > 0 && (
                  <span className="sm:hidden flex flex-wrap items-center justify-center gap-1 pt-0.5" aria-hidden>
                    {lista.slice(0, 4).map((e) => <MarcaTipo key={e.chave} tipo={e.tipo} tamanho={7} />)}
                    {lista.length > 4 && <span className="text-[10px] font-bold" style={{ color: "var(--ink2)" }}>+{lista.length - 4}</span>}
                  </span>
                )}
                {eventos === null ? null : lista.slice(0, max).map((e) => (
                  <div key={e.chave} className={modo === "mes" ? "hidden sm:block" : undefined} onClick={(ev) => ev.stopPropagation()}><Chip e={e} onClick={() => abrirEvento(e)} /></div>
                ))}
                {lista.length > max && <span className={`text-[11px] font-semibold px-1 ${modo === "mes" ? "hidden sm:inline" : ""}`} style={{ color: "var(--ink2)" }}>+{lista.length - max} mais</span>}
              </div>
            );
          })}
        </div>
      </div>
      {eventos === null && <p className="text-[13px]" style={{ color: "var(--ink3)" }} aria-live="polite">Carregando o período…</p>}

      {diaAberto && (
        <section className="rel-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>
              {new Date(diaAberto + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </h3>
            <button className="text-[12px] font-semibold px-2 py-1.5 -mr-2 rounded-md" style={{ color: "var(--ink2)" }} onClick={() => setDiaAberto(null)}>fechar</button>
          </div>
          {doDia.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nada neste dia.</p>
          ) : (
            <ul className="space-y-1.5">
              {doDia.map((e) => {
                const c = COR[e.tipo];
                const aberto = grupoAberto === e.chave;
                return (
                  <li key={e.chave} className="rounded-lg px-3 py-2" style={{ background: c.fundo, borderLeft: `3px solid ${c.borda}` }}>
                    <button className="w-full flex items-center gap-2 text-left" onClick={() => (e.viagens.length === 1 ? onAbrirViagem(e.viagens[0].id) : setGrupoAberto(aberto ? null : e.chave))}>
                      <Icone d={ESPECIE[e.especie].icone} cor={c.texto} />
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase px-1.5 rounded flex-shrink-0" style={{ color: c.texto, border: `1px solid ${c.borda}` }}><MarcaTipo tipo={e.tipo} tamanho={6} />{NOME_TIPO[e.tipo]}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13.5px] font-semibold truncate" style={{ color: "var(--ink)", textDecoration: e.feito ? "line-through" : undefined }}>
                          {e.hora ? `${e.hora} · ` : ""}{e.titulo}{e.feito ? " (feito)" : ""}
                        </span>
                        <span className="block text-[12px] truncate" style={{ color: "var(--ink2)" }}>{e.detalhe}</span>
                      </span>
                      <span className="text-[12px] font-semibold flex-shrink-0" style={{ color: c.texto }}>
                        {e.viagens.length === 1 ? "abrir ›" : `${e.viagens.length} vendas ${aberto ? "▴" : "▾"}`}
                      </span>
                    </button>
                    {aberto && e.viagens.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {e.viagens.map((v) => (
                          <button key={v.id} onClick={() => onAbrirViagem(v.id)} className="rel-linha px-2.5 py-1.5 rounded text-[12px]"
                            style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}>{v.nome}</button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
