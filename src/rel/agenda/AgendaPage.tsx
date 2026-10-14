// src/rel/agenda/AgendaPage.tsx
// -----------------------------------------------------------------------------
// AGENDA DO RELACIONAMENTO (Bruno, 14/10/2026 — "Etapa 2": "cada pessoa tenha
// a sua própria agenda, assim conseguimos ter uma visão panorâmica de como está
// a agenda do pessoal").
//
// Duas visões:
//   • Minha agenda — Dia | Semana | Mês, grade das 7h às 21h. Clicar ou
//     arrastar num horário vazio cria; clicar no compromisso abre. A gestora
//     escolhe de quem é a agenda que está olhando.
//   • Panorama do time — uma linha por pessoa, o dia (ou a semana) inteiro de
//     relance: quem está ocupado agora, quantos compromissos, quantas horas.
//
// Compromisso particular de outra pessoa aparece só como "Ocupado" (a view
// rel_agenda_v já devolve mascarado). Embarques das viagens entram como uma
// camada só de leitura, ligável.
//
// Atalhos: T = hoje · ← → = navegar · N = novo (fora de campos de texto).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ME } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { podeGerirRelacionamento } from "../equipe/permissao";
import { usePode } from "../equipe/usePode";
import {
  DIA_MS, TIPOS_EVENTO, diaIso, duracaoCurta, horaCurtaBR, inicioDaSemana, inicioDoDia, inicioDoMes,
  comHora, fmtSP, listarEmbarques, listarEventos, listarTime, mesmoDia, minutosNoPeriodo, somarDias, somarMeses, sp,
  type Embarque, type Evento, type PessoaDoTime, type TipoEvento,
} from "../lib/agenda";
import { Aviso, Avatar, Botao, Etiqueta } from "../ui";
import EventoModal, { type RascunhoEvento } from "./EventoModal";

type Visao = "minha" | "panorama";
type Modo = "dia" | "semana" | "mes";

const HORA_INI = 7;
const HORA_FIM = 21;
const PX_HORA = 52;
const SNAP_MIN = 15;
const DIAS_CURTOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function useEstreito() {
  const [e, setE] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const f = () => setE(window.innerWidth < 768);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return e;
}

/** O período que a tela precisa carregar. */
function periodo(visao: Visao, modo: Modo, ref: Date, estreito: boolean): { de: Date; ate: Date; dias: Date[] } {
  const m: Modo = visao === "panorama" ? (modo === "mes" ? "semana" : modo) : (estreito && modo === "semana" ? "dia" : modo);
  if (m === "dia") { const d = inicioDoDia(ref); return { de: d, ate: somarDias(d, 1), dias: [d] }; }
  if (m === "semana") { const d = inicioDaSemana(ref); return { de: d, ate: somarDias(d, 7), dias: Array.from({ length: 7 }, (_, i) => somarDias(d, i)) }; }
  const d = inicioDaSemana(inicioDoMes(ref));
  return { de: d, ate: somarDias(d, 42), dias: Array.from({ length: 42 }, (_, i) => somarDias(d, i)) };
}

function tituloDoPeriodo(modo: Modo, ref: Date, dias: Date[]) {
  if (modo === "mes") return fmtSP(ref, { month: "long", year: "numeric" });
  if (dias.length === 1) return fmtSP(ref, { weekday: "long", day: "2-digit", month: "long" });
  const a = dias[0], b = dias[dias.length - 1];
  return sp(a).mes === sp(b).mes
    ? `${sp(a).dia}–${sp(b).dia} de ${fmtSP(b, { month: "long", year: "numeric" })}`
    : `${fmtSP(a, { day: "2-digit", month: "short" })} – ${fmtSP(b, { day: "2-digit", month: "short", year: "numeric" })}`;
}

/** Distribui eventos sobrepostos em colunas lado a lado (como no Google Agenda). */
function emColunas(evs: Evento[]): { e: Evento; col: number; cols: number }[] {
  const ord = [...evs].sort((a, b) => a.inicio.localeCompare(b.inicio) || b.fim.localeCompare(a.fim));
  const saida: { e: Evento; col: number; cols: number }[] = [];
  let grupo: { e: Evento; col: number }[] = [];
  let fimGrupo = 0;
  const fechar = () => {
    const n = Math.max(1, ...grupo.map((g) => g.col + 1));
    grupo.forEach((g) => saida.push({ ...g, cols: n }));
    grupo = [];
  };
  for (const e of ord) {
    const i = new Date(e.inicio).getTime();
    const f = Math.max(new Date(e.fim).getTime(), i + 20 * 60_000);
    if (grupo.length && i >= fimGrupo) fechar();
    const ocupadas = new Set(grupo.filter((g) => Math.max(new Date(g.e.fim).getTime(), new Date(g.e.inicio).getTime() + 20 * 60_000) > i).map((g) => g.col));
    let col = 0;
    while (ocupadas.has(col)) col++;
    grupo.push({ e, col });
    fimGrupo = Math.max(fimGrupo, f);
  }
  if (grupo.length) fechar();
  return saida;
}

export default function AgendaPage({ onAbrirCliente, onAbrirViagem, onAbrirConversa }: {
  onAbrirCliente?: (id: string) => void;
  onAbrirViagem?: (id: string) => void;
  onAbrirConversa?: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  // A agenda dos outros: gestora, ou quem o cargo libera (0135).
  const agendaTime = usePode("relacionamento.agenda_time");
  const gestor = podeGerirRelacionamento(currentUser) || agendaTime === true;
  const estreito = useEstreito();

  const [visao, setVisao] = useState<Visao>(() => (localStorage.getItem("rel_agenda_visao") as Visao) || "minha");
  const [modo, setModo] = useState<Modo>(() => (localStorage.getItem("rel_agenda_modo") as Modo) || "semana");
  const [ref, setRef] = useState(() => new Date());
  const [donoVisto, setDonoVisto] = useState<string>(meuId);
  const [time, setTime] = useState<PessoaDoTime[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [embarques, setEmbarques] = useState<Embarque[]>([]);
  const [verEmbarques, setVerEmbarques] = useState(() => localStorage.getItem("rel_agenda_embarques") === "1");
  const [tiposOcultos, setTiposOcultos] = useState<Set<TipoEvento>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ evento: Evento | null; rascunho: RascunhoEvento | null } | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => { if (meuId && !donoVisto) setDonoVisto(meuId); }, [meuId, donoVisto]);
  useEffect(() => { localStorage.setItem("rel_agenda_visao", visao); }, [visao]);
  useEffect(() => { localStorage.setItem("rel_agenda_modo", modo); }, [modo]);
  useEffect(() => { localStorage.setItem("rel_agenda_embarques", verEmbarques ? "1" : "0"); }, [verEmbarques]);
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { listarTime().then(setTime).catch(() => setTime([])); }, []);

  const modoEfetivo: Modo = visao === "panorama" ? (modo === "mes" ? "semana" : modo) : modo;
  const { de, ate, dias } = useMemo(() => periodo(visao, modo, ref, estreito), [visao, modo, ref, estreito]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [evs, emb] = await Promise.all([
        listarEventos(de, ate, visao === "minha" ? donoVisto || meuId : null),
        verEmbarques ? listarEmbarques(de, ate).catch(() => [] as Embarque[]) : Promise.resolve([] as Embarque[]),
      ]);
      setEventos(evs);
      setEmbarques(emb);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui ler a agenda.");
    } finally {
      setCarregando(false);
    }
  }, [de, ate, visao, donoVisto, meuId, verEmbarques]);

  useEffect(() => { setCarregando(true); void carregar(); }, [carregar]);

  const visiveis = useMemo(() => eventos.filter((e) => !tiposOcultos.has(e.tipo)), [eventos, tiposOcultos]);

  function navegar(passo: number) {
    if (modoEfetivo === "mes") { setRef(somarMeses(ref, passo)); return; }
    const pulo = modoEfetivo === "semana" && !(estreito && visao === "minha") ? 7 : 1;
    setRef(somarDias(ref, passo * pulo));
  }

  function novo(inicio?: Date, fim?: Date, dono?: string, diaInteiro = false) {
    const base = inicio ?? comHora(ref, Math.max(HORA_INI, Math.min(HORA_FIM - 1, sp(new Date()).hora + 1)));
    setAberto({ evento: null, rascunho: { inicio: base, fim: fim ?? new Date(base.getTime() + 3600_000), dono_id: dono || (visao === "minha" ? donoVisto || meuId : meuId), dia_inteiro: diaInteiro } });
  }

  // Atalhos de teclado (fora de campo de texto e com nada aberto).
  const atalhoRef = useRef({ navegar, novo, aberto });
  atalhoRef.current = { navegar, novo, aberto };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (atalhoRef.current.aberto || e.ctrlKey || e.metaKey || e.altKey) return;
      if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setRef(new Date()); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); atalhoRef.current.navegar(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); atalhoRef.current.navegar(1); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); atalhoRef.current.novo(); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const podeCriarPara = (dono: string) => gestor || dono === meuId;
  const donoAtual = visao === "minha" ? donoVisto || meuId : meuId;
  const nomeDono = time.find((p) => p.id === donoAtual)?.name;

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold mr-2" style={{ color: "var(--ink)" }}>Agenda</h1>
        <div className="inline-flex rounded-full p-0.5 border" style={{ borderColor: "var(--line)" }} role="tablist" aria-label="Visão">
          {([["minha", "Minha agenda"], ["panorama", "Panorama do time"]] as [Visao, string][]).map(([v, r]) => (
            <button key={v} role="tab" aria-selected={visao === v} onClick={() => setVisao(v)}
              className="h-8 px-3.5 rounded-full text-[13px] font-semibold"
              style={visao === v ? { background: "var(--rel)", color: "#fff" } : { color: "var(--ink2)" }}>{r}</button>
          ))}
        </div>
        <span className="flex-1" />
        <Botao variante="primario" onClick={() => novo()} title="Novo compromisso (N)">+ Novo</Botao>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={() => setRef(new Date())} title="Hoje (T)">Hoje</Botao>
        <div className="inline-flex">
          <button onClick={() => navegar(-1)} className="w-9 h-9 rounded-full inline-flex items-center justify-center rel-linha" aria-label="Anterior (←)" style={{ color: "var(--ink2)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button onClick={() => navegar(1)} className="w-9 h-9 rounded-full inline-flex items-center justify-center rel-linha" aria-label="Próximo (→)" style={{ color: "var(--ink2)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
        <h2 className="text-[16px] font-semibold capitalize" style={{ color: "var(--ink)" }} aria-live="polite">{tituloDoPeriodo(modoEfetivo, ref, dias)}</h2>
        <span className="flex-1" />
        {visao === "minha" && gestor && time.length > 0 && (
          <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
            Agenda de
            <select className="rel-input !w-auto !py-1.5" value={donoVisto || meuId} onChange={(e) => setDonoVisto(e.target.value)}>
              {time.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === meuId ? " (eu)" : ""}</option>)}
            </select>
          </label>
        )}
        <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--line)" }} role="tablist" aria-label="Período">
          {((visao === "panorama" ? ["dia", "semana"] : ["dia", "semana", "mes"]) as Modo[]).map((m) => (
            <button key={m} role="tab" aria-selected={modoEfetivo === m} onClick={() => setModo(m)}
              className="h-8 px-3 text-[13px] font-semibold"
              style={modoEfetivo === m ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
              {m === "dia" ? "Dia" : m === "semana" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(TIPOS_EVENTO) as TipoEvento[]).map((t) => {
          const oculto = tiposOcultos.has(t);
          return (
            <button key={t} aria-pressed={!oculto}
              onClick={() => setTiposOcultos((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
              className="h-7 px-2.5 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1.5"
              style={{ borderColor: "var(--line)", color: oculto ? "var(--ink3)" : "var(--ink2)", opacity: oculto ? 0.55 : 1 }}>
              <span className="w-2 h-2 rounded-full" style={{ background: TIPOS_EVENTO[t].cor }} aria-hidden />
              {TIPOS_EVENTO[t].rotulo}
            </button>
          );
        })}
        <label className="ml-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={verEmbarques} onChange={(e) => setVerEmbarques(e.target.checked)} /> Embarques das viagens
        </label>
        {visao === "minha" && donoAtual !== meuId && nomeDono && <Etiqueta tom="rel">Olhando a agenda de {nomeDono.split(" ")[0]}</Etiqueta>}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {visao === "minha" ? (
        modoEfetivo === "mes" ? (
          <Mes dias={dias} ref_={ref} eventos={visiveis} embarques={embarques} carregando={carregando}
            onDia={(d) => { setRef(d); setModo("dia"); }} onAbrir={(e) => setAberto({ evento: e, rascunho: null })}
            onNovo={podeCriarPara(donoAtual) ? (d) => novo(comHora(d, 9)) : undefined}
            onEmbarque={onAbrirViagem} />
        ) : estreito ? (
          <ListaDoDia dia={dias[0]} eventos={visiveis} embarques={embarques} carregando={carregando}
            onAbrir={(e) => setAberto({ evento: e, rascunho: null })} onEmbarque={onAbrirViagem} />
        ) : (
          <Grade dias={dias} eventos={visiveis} embarques={embarques} agora={agora} carregando={carregando}
            onAbrir={(e) => setAberto({ evento: e, rascunho: null })}
            onCriar={podeCriarPara(donoAtual) ? (i, f, inteiro) => novo(i, f, donoAtual, inteiro) : undefined}
            onEmbarque={onAbrirViagem} />
        )
      ) : (
        <Panorama dias={dias} time={time} eventos={visiveis} embarques={embarques} agora={agora} carregando={carregando} meuId={meuId}
          onAbrir={(e) => setAberto({ evento: e, rascunho: null })}
          onCriar={(dono, i, f) => { if (podeCriarPara(dono)) novo(i, f, dono); }}
          podeCriarPara={podeCriarPara} onEmbarque={onAbrirViagem}
          onVerPessoa={(id) => { if (gestor || id === meuId) { setDonoVisto(id); setVisao("minha"); setModo("semana"); } }} />
      )}

      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        Atalhos: <b>T</b> hoje · <b>←</b> <b>→</b> navegar · <b>N</b> novo compromisso. Compromisso marcado como particular aparece pro time só como "Ocupado".
      </p>

      <EventoModal aberto={!!aberto} evento={aberto?.evento ?? null} rascunho={aberto?.rascunho ?? null}
        meuId={meuId} gestor={gestor} time={time.length ? time : (currentUser ? [{ id: meuId, name: currentUser.name, role: currentUser.role }] : [])}
        onFechar={() => setAberto(null)} onSalvo={() => { setAberto(null); void carregar(); }}
        onAbrirCliente={onAbrirCliente} onAbrirViagem={onAbrirViagem} onAbrirConversa={onAbrirConversa} />
    </div>
  );
}

// ── Bloquinho de evento ─────────────────────────────────────────────────────

function corDe(e: Evento) { return e.mascarado ? "#94A3B8" : TIPOS_EVENTO[e.tipo]?.cor || "#0E7C6A"; }

function ChipEvento({ e, onAbrir, compacto }: { e: Evento; onAbrir: (e: Evento) => void; compacto?: boolean }) {
  return (
    <button onClick={(x) => { x.stopPropagation(); onAbrir(e); }}
      className="w-full text-left rounded-md px-1.5 py-0.5 text-[11.5px] truncate flex items-center gap-1"
      style={{ background: `${corDe(e)}22`, color: "var(--ink)", borderLeft: `3px solid ${corDe(e)}` }}
      title={`${e.dia_inteiro ? "Dia inteiro" : `${horaCurtaBR(e.inicio)}–${horaCurtaBR(e.fim)}`} · ${e.titulo}`}>
      {!e.dia_inteiro && !compacto && <span style={{ color: "var(--ink3)" }}>{horaCurtaBR(e.inicio)}</span>}
      <span className="truncate font-semibold">{e.privado && !e.mascarado ? "🔒 " : ""}{e.titulo || "(sem título)"}</span>
    </button>
  );
}

function ChipEmbarque({ v, onAbrir }: { v: Embarque; onAbrir?: (id: string) => void }) {
  return (
    <button onClick={(x) => { x.stopPropagation(); onAbrir?.(v.id); }} disabled={!onAbrir}
      className="w-full text-left rounded-md px-1.5 py-0.5 text-[11.5px] truncate"
      style={{ background: "#DB277718", color: "var(--ink)", border: "1px dashed #DB2777" }}
      title={`Embarque: ${v.titulo}${v.cliente_nome ? ` — ${v.cliente_nome}` : ""}`}>
      ✈️ <b>{v.cliente_nome || v.titulo}</b>
    </button>
  );
}

const embarquesDoDia = (embarques: Embarque[], d: Date) => embarques.filter((v) => v.data_embarque?.slice(0, 10) === diaIso(d));
const doDia = (evs: Evento[], d: Date) => {
  const a = d.getTime(), b = a + DIA_MS;
  return evs.filter((e) => new Date(e.inicio).getTime() < b && (new Date(e.fim).getTime() > a || new Date(e.inicio).getTime() >= a));
};
const inteiroOuLongo = (e: Evento) => e.dia_inteiro || new Date(e.fim).getTime() - new Date(e.inicio).getTime() >= DIA_MS;

// ── Grade de horas (Dia / Semana) ───────────────────────────────────────────

function Grade({ dias, eventos, embarques, agora, carregando, onAbrir, onCriar, onEmbarque }: {
  dias: Date[]; eventos: Evento[]; embarques: Embarque[]; agora: Date; carregando: boolean;
  onAbrir: (e: Evento) => void; onCriar?: (inicio: Date, fim: Date, diaInteiro?: boolean) => void; onEmbarque?: (id: string) => void;
}) {
  const horas = Array.from({ length: HORA_FIM - HORA_INI }, (_, i) => HORA_INI + i);
  const altura = (HORA_FIM - HORA_INI) * PX_HORA;
  const rolar = useRef<HTMLDivElement>(null);
  const [arrasto, setArrasto] = useState<{ dia: number; a: number; b: number } | null>(null);
  const arrastoRef = useRef(arrasto);
  arrastoRef.current = arrasto;

  // Minutos desde HORA_INI no ponto do mouse, com ímã de 15 min.
  const minutoDo = (ev: { clientY: number }, el: HTMLElement) => {
    const y = ev.clientY - el.getBoundingClientRect().top;
    const m = Math.round(((y / PX_HORA) * 60) / SNAP_MIN) * SNAP_MIN;
    return Math.max(0, Math.min((HORA_FIM - HORA_INI) * 60, m));
  };

  function comecar(ev: ME<HTMLDivElement>, i: number) {
    if (!onCriar || ev.button !== 0) return;
    const el = ev.currentTarget;
    const m = Math.min(minutoDo(ev, el), (HORA_FIM - HORA_INI) * 60 - SNAP_MIN);
    const inicioM = Math.floor(m / 30) * 30;
    setArrasto({ dia: i, a: inicioM, b: inicioM });
    const mover = (e: MouseEvent) => setArrasto((s) => (s ? { ...s, b: minutoDo(e, el) } : s));
    const soltar = () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
      const s = arrastoRef.current;
      setArrasto(null);
      if (!s) return;
      let a = Math.min(s.a, s.b), b = Math.max(s.a, s.b);
      if (b - a < SNAP_MIN) b = a + 60; // clique simples = 1 hora
      const base = inicioDoDia(dias[s.dia]);
      onCriar(new Date(base.getTime() + (HORA_INI * 60 + a) * 60_000), new Date(base.getTime() + (HORA_INI * 60 + b) * 60_000));
    };
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
  }

  // Abre já perto da hora atual.
  useEffect(() => {
    const h = sp(new Date()).hora;
    if (rolar.current) rolar.current.scrollTop = Math.max(0, (h - HORA_INI - 1) * PX_HORA);
  }, []);

  const cols = `56px repeat(${dias.length}, minmax(0, 1fr))`;
  const temTopo = dias.some((d) => doDia(eventos, d).some(inteiroOuLongo) || embarquesDoDia(embarques, d).length);

  return (
    <div className="rel-card overflow-hidden" aria-busy={carregando}>
      {/* Cabeçalho dos dias */}
      <div className="grid border-b" style={{ gridTemplateColumns: cols, borderColor: "var(--line)" }}>
        <span />
        {dias.map((d) => {
          const hoje = mesmoDia(d, agora);
          return (
            <div key={d.toISOString()} className="py-2 text-center border-l" style={{ borderColor: "var(--line)" }}>
              <span className="block text-[11px] font-bold uppercase" style={{ color: hoje ? "var(--rel-ink)" : "var(--ink3)" }}>{DIAS_CURTOS[(sp(d).dow + 6) % 7]}</span>
              <span className="inline-flex w-8 h-8 mt-0.5 rounded-full items-center justify-center text-[17px] font-semibold"
                style={hoje ? { background: "var(--rel)", color: "#fff" } : { color: "var(--ink)" }}>{sp(d).dia}</span>
            </div>
          );
        })}
      </div>
      {/* Dia inteiro + embarques */}
      {temTopo && (
        <div className="grid border-b" style={{ gridTemplateColumns: cols, borderColor: "var(--line)" }}>
          <span className="text-[10.5px] px-1 py-1 text-right" style={{ color: "var(--ink3)" }}>dia todo</span>
          {dias.map((d) => (
            <div key={d.toISOString()} className="border-l p-1 space-y-0.5 min-h-[28px]" style={{ borderColor: "var(--line)" }}>
              {doDia(eventos, d).filter(inteiroOuLongo).map((e) => <ChipEvento key={e.id} e={e} onAbrir={onAbrir} compacto />)}
              {embarquesDoDia(embarques, d).map((v) => <ChipEmbarque key={v.id} v={v} onAbrir={onEmbarque} />)}
            </div>
          ))}
        </div>
      )}
      {/* Horas */}
      <div ref={rolar} className="overflow-y-auto" style={{ maxHeight: "calc(100dvh - 330px)", minHeight: 360 }}>
        <div className="grid relative" style={{ gridTemplateColumns: cols, height: altura }}>
          <div className="relative">
            {horas.map((h, i) => (
              <span key={h} className="absolute right-1.5 text-[10.5px] -translate-y-1/2" style={{ top: i * PX_HORA, color: "var(--ink3)" }}>{i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</span>
            ))}
          </div>
          {dias.map((d, di) => {
            const base = inicioDoDia(d).getTime() + HORA_INI * 3600_000;
            const fimDia = inicioDoDia(d).getTime() + HORA_FIM * 3600_000;
            const doHorario = doDia(eventos, d).filter((e) => !inteiroOuLongo(e));
            const hoje = mesmoDia(d, agora);
            const yAgora = ((agora.getTime() - base) / 3600_000) * PX_HORA;
            return (
              <div key={d.toISOString()} className="relative border-l select-none" style={{ borderColor: "var(--line)", cursor: onCriar ? "cell" : "default" }}
                onMouseDown={(ev) => comecar(ev, di)}>
                {horas.map((h, i) => <div key={h} className="absolute left-0 right-0 border-t" style={{ top: i * PX_HORA, borderColor: "var(--line2, var(--line))" }} />)}
                {emColunas(doHorario).map(({ e, col, cols: n }) => {
                  const i = Math.max(new Date(e.inicio).getTime(), base);
                  const f = Math.min(Math.max(new Date(e.fim).getTime(), new Date(e.inicio).getTime() + 20 * 60_000), fimDia);
                  if (f <= base || i >= fimDia) return null;
                  const top = ((i - base) / 3600_000) * PX_HORA;
                  const h = Math.max(20, ((f - i) / 3600_000) * PX_HORA - 2);
                  return (
                    <button key={e.id} onMouseDown={(x) => x.stopPropagation()} onClick={() => onAbrir(e)}
                      className="absolute rounded-md px-1.5 py-0.5 text-left overflow-hidden text-[11.5px] leading-tight"
                      style={{
                        top, height: h, left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)`,
                        background: e.mascarado ? "repeating-linear-gradient(45deg, #94A3B833 0 6px, #94A3B81a 6px 12px)" : `${corDe(e)}26`,
                        borderLeft: `3px solid ${corDe(e)}`, color: "var(--ink)",
                      }}
                      title={`${horaCurtaBR(e.inicio)}–${horaCurtaBR(e.fim)} · ${e.titulo}`}>
                      <span className="block font-semibold truncate">{e.privado && !e.mascarado ? "🔒 " : ""}{e.titulo || "(sem título)"}</span>
                      {h > 30 && <span className="block truncate" style={{ color: "var(--ink3)" }}>{horaCurtaBR(e.inicio)}–{horaCurtaBR(e.fim)}{e.cliente_nome ? ` · ${e.cliente_nome}` : ""}</span>}
                    </button>
                  );
                })}
                {arrasto && arrasto.dia === di && (
                  <div className="absolute left-1 right-1 rounded-md pointer-events-none" style={{
                    top: (Math.min(arrasto.a, arrasto.b) / 60) * PX_HORA,
                    height: Math.max(PX_HORA / 4, (Math.abs(arrasto.b - arrasto.a) / 60) * PX_HORA),
                    background: "var(--rel-soft)", border: "2px solid var(--rel)",
                  }} />
                )}
                {hoje && yAgora >= 0 && yAgora <= altura && (
                  <div className="absolute left-0 right-0 pointer-events-none" style={{ top: yAgora }} aria-label="Agora">
                    <span className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full" style={{ background: "#EA4335" }} />
                    <span className="block h-0.5" style={{ background: "#EA4335" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Lista do dia (celular) ──────────────────────────────────────────────────

function ListaDoDia({ dia, eventos, embarques, carregando, onAbrir, onEmbarque }: {
  dia: Date; eventos: Evento[]; embarques: Embarque[]; carregando: boolean; onAbrir: (e: Evento) => void; onEmbarque?: (id: string) => void;
}) {
  const evs = doDia(eventos, dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const emb = embarquesDoDia(embarques, dia);
  return (
    <div className="rel-card divide-y" style={{ borderColor: "var(--line)" }} aria-busy={carregando}>
      {!carregando && !evs.length && !emb.length && <p className="p-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nada marcado neste dia.</p>}
      {emb.map((v) => <div key={v.id} className="p-2"><ChipEmbarque v={v} onAbrir={onEmbarque} /></div>)}
      {evs.map((e) => (
        <button key={e.id} onClick={() => onAbrir(e)} className="rel-linha w-full text-left p-3 flex gap-3 items-start">
          <span className="w-14 flex-shrink-0 text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>{e.dia_inteiro ? "dia todo" : horaCurtaBR(e.inicio)}</span>
          <span className="w-1 self-stretch rounded" style={{ background: corDe(e) }} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{e.titulo || "(sem título)"}</span>
            <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
              {TIPOS_EVENTO[e.tipo].rotulo}{!e.dia_inteiro && ` · até ${horaCurtaBR(e.fim)}`}{e.cliente_nome ? ` · ${e.cliente_nome}` : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Mês ─────────────────────────────────────────────────────────────────────

function Mes({ dias, ref_, eventos, embarques, carregando, onDia, onAbrir, onNovo, onEmbarque }: {
  dias: Date[]; ref_: Date; eventos: Evento[]; embarques: Embarque[]; carregando: boolean;
  onDia: (d: Date) => void; onAbrir: (e: Evento) => void; onNovo?: (d: Date) => void; onEmbarque?: (id: string) => void;
}) {
  const hoje = new Date();
  return (
    <div className="rel-card overflow-hidden" aria-busy={carregando}>
      <div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--line)" }}>
        {DIAS_CURTOS.map((d) => <span key={d} className="py-1.5 text-center text-[11px] font-bold uppercase" style={{ color: "var(--ink3)" }}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((d, i) => {
          const evs = doDia(eventos, d).sort((a, b) => a.inicio.localeCompare(b.inicio));
          const emb = embarquesDoDia(embarques, d);
          const itens = [...emb.map((v) => ({ k: `v${v.id}`, n: <ChipEmbarque key={`v${v.id}`} v={v} onAbrir={onEmbarque} /> })), ...evs.map((e) => ({ k: e.id, n: <ChipEvento key={e.id} e={e} onAbrir={onAbrir} /> }))];
          const fora = sp(d).mes !== sp(ref_).mes;
          return (
            <div key={d.toISOString()} className="min-h-[104px] p-1 border-t border-l space-y-0.5"
              style={{ borderColor: "var(--line)", background: fora ? "var(--card2)" : undefined, borderLeftWidth: i % 7 ? 1 : 0 }}
              onDoubleClick={() => onNovo?.(d)}>
              <button onClick={() => onDia(d)} className="w-7 h-7 rounded-full text-[12.5px] font-semibold inline-flex items-center justify-center"
                style={mesmoDia(d, hoje) ? { background: "var(--rel)", color: "#fff" } : { color: fora ? "var(--ink3)" : "var(--ink)" }}
                aria-label={`Abrir ${fmtSP(d, {})}`}>{sp(d).dia}</button>
              {itens.slice(0, 3).map((x) => x.n)}
              {itens.length > 3 && <button onClick={() => onDia(d)} className="text-[11px] font-semibold px-1" style={{ color: "var(--rel-ink)" }}>+{itens.length - 3} mais</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Panorama do time ────────────────────────────────────────────────────────

function Panorama({ dias, time, eventos, embarques, agora, carregando, meuId, onAbrir, onCriar, podeCriarPara, onEmbarque, onVerPessoa }: {
  dias: Date[]; time: PessoaDoTime[]; eventos: Evento[]; embarques: Embarque[]; agora: Date; carregando: boolean; meuId: string;
  onAbrir: (e: Evento) => void; onCriar: (dono: string, inicio: Date, fim: Date) => void; podeCriarPara: (dono: string) => boolean;
  onEmbarque?: (id: string) => void; onVerPessoa: (id: string) => void;
}) {
  const dia = dias.length === 1;
  const de = dias[0];
  const ate = somarDias(dias[dias.length - 1], 1);
  const horas = Array.from({ length: HORA_FIM - HORA_INI }, (_, i) => HORA_INI + i);
  const pessoas = useMemo(() => {
    const ids = new Set(time.map((p) => p.id));
    // Alguém com compromisso que não está mais no time (saiu do setor) também aparece.
    const extras = [...new Map(eventos.filter((e) => !ids.has(e.dono_id)).map((e) => [e.dono_id, { id: e.dono_id, name: e.dono_nome || "—", role: "" }])).values()];
    return [...time, ...extras].sort((a, b) => (a.id === meuId ? -1 : b.id === meuId ? 1 : a.name.localeCompare(b.name)));
  }, [time, eventos, meuId]);

  if (!carregando && !pessoas.length) {
    return <Aviso>Ninguém no time do Relacionamento ainda. Cadastre em Equipe (pessoas com o setor Relacionamento).</Aviso>;
  }

  const minutosUteis = (HORA_FIM - HORA_INI) * 60 * dias.length;

  return (
    <div className="rel-card overflow-x-auto" aria-busy={carregando}>
      <div className="min-w-[760px]">
        {/* Cabeçalho */}
        <div className="grid border-b sticky top-0 z-[1]" style={{ gridTemplateColumns: "220px 1fr", borderColor: "var(--line)", background: "var(--card)" }}>
          <span className="px-3 py-2 text-[11px] font-bold uppercase" style={{ color: "var(--ink3)" }}>Pessoa</span>
          {dia ? (
            <div className="relative h-8">
              {horas.map((h, i) => (
                <span key={h} className="absolute top-2 text-[10.5px] -translate-x-1/2" style={{ left: `${(i / horas.length) * 100}%`, color: "var(--ink3)" }}>{i ? `${h}h` : ""}</span>
              ))}
            </div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
              {dias.map((d) => (
                <span key={d.toISOString()} className="py-2 text-center text-[11.5px] font-semibold border-l" style={{ borderColor: "var(--line)", color: mesmoDia(d, agora) ? "var(--rel-ink)" : "var(--ink2)" }}>
                  {DIAS_CURTOS[(sp(d).dow + 6) % 7]} {sp(d).dia}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Embarques do período (do time todo) */}
        {embarques.length > 0 && (
          <div className="grid border-b" style={{ gridTemplateColumns: "220px 1fr", borderColor: "var(--line)" }}>
            <span className="px-3 py-2 text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>✈️ Embarques</span>
            {dia ? (
              <div className="p-1.5 flex flex-wrap gap-1">{embarques.map((v) => <span key={v.id} className="max-w-[220px]"><ChipEmbarque v={v} onAbrir={onEmbarque} /></span>)}</div>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                {dias.map((d) => (
                  <div key={d.toISOString()} className="border-l p-1 space-y-0.5" style={{ borderColor: "var(--line)" }}>
                    {embarquesDoDia(embarques, d).map((v) => <ChipEmbarque key={v.id} v={v} onAbrir={onEmbarque} />)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {pessoas.map((p) => {
          const dele = eventos.filter((e) => e.dono_id === p.id);
          const ocupadoMin = Math.min(minutosUteis, dele.filter((e) => !e.dia_inteiro).reduce((s, e) => s + minutosNoPeriodo(e, de, ate), 0));
          const agoraEv = dele.find((e) => new Date(e.inicio) <= agora && new Date(e.fim) > agora && !e.dia_inteiro);
          const proximo = dele.filter((e) => new Date(e.inicio) > agora && !e.dia_inteiro).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
          const pode = podeCriarPara(p.id);
          return (
            <div key={p.id} className="grid border-b" style={{ gridTemplateColumns: "220px 1fr", borderColor: "var(--line)" }}>
              <button onClick={() => onVerPessoa(p.id)} className="rel-linha px-3 py-2 flex items-center gap-2.5 text-left min-w-0" title="Abrir a agenda desta pessoa">
                <Avatar nome={p.name} tamanho={32} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold truncate" style={{ color: "var(--ink)" }}>{p.name}{p.id === meuId ? " (eu)" : ""}</span>
                  <span className="block text-[11.5px] truncate" style={{ color: "var(--ink3)" }}>
                    {dele.length} compromisso{dele.length === 1 ? "" : "s"} · {duracaoCurta(ocupadoMin)} ocupado
                  </span>
                  <span className="block text-[11.5px] font-semibold truncate" style={{ color: agoraEv ? "#B42318" : "var(--rel-ink)" }}>
                    {agoraEv ? `● Ocupado agora até ${horaCurtaBR(agoraEv.fim)}` : `● Livre agora${proximo && mesmoDia(new Date(proximo.inicio), agora) ? ` · próximo ${horaCurtaBR(proximo.inicio)}` : ""}`}
                  </span>
                </span>
              </button>
              {dia ? (
                <LinhaDoDia d={de} eventos={dele} agora={agora} onAbrir={onAbrir}
                  onCriar={pode ? (i, f) => onCriar(p.id, i, f) : undefined} />
              ) : (
                <div className="grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                  {dias.map((d) => {
                    const evs = doDia(dele, d).sort((a, b) => a.inicio.localeCompare(b.inicio));
                    const min = evs.filter((e) => !e.dia_inteiro).reduce((s, e) => s + minutosNoPeriodo(e, d, somarDias(d, 1)), 0);
                    const carga = Math.min(1, min / ((HORA_FIM - HORA_INI) * 60));
                    return (
                      <div key={d.toISOString()} className="border-l p-1 space-y-0.5 min-h-[64px]"
                        style={{ borderColor: "var(--line)", background: carga > 0 ? `rgba(14,124,106,${0.04 + carga * 0.16})` : undefined, cursor: pode ? "cell" : "default" }}
                        onDoubleClick={() => { if (pode) { const i = comHora(d, 9); onCriar(p.id, i, new Date(i.getTime() + 3600_000)); } }}
                        title={min ? `${duracaoCurta(min)} ocupado` : "Livre"}>
                        {evs.slice(0, 3).map((e) => <ChipEvento key={e.id} e={e} onAbrir={onAbrir} />)}
                        {evs.length > 3 && <span className="block text-[11px] px-1 font-semibold" style={{ color: "var(--rel-ink)" }}>+{evs.length - 3}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinhaDoDia({ d, eventos, agora, onAbrir, onCriar }: {
  d: Date; eventos: Evento[]; agora: Date; onAbrir: (e: Evento) => void; onCriar?: (inicio: Date, fim: Date) => void;
}) {
  const base = inicioDoDia(d).getTime() + HORA_INI * 3600_000;
  const total = (HORA_FIM - HORA_INI) * 3600_000;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - base) / total) * 100));
  const horas = HORA_FIM - HORA_INI;
  const xAgora = mesmoDia(d, agora) ? pct(agora.getTime()) : -1;
  const inteiros = eventos.filter((e) => e.dia_inteiro);
  return (
    <div className="relative h-[64px]" style={{ cursor: onCriar ? "cell" : "default" }}
      onClick={(ev) => {
        if (!onCriar) return;
        const r = ev.currentTarget.getBoundingClientRect();
        const min = Math.floor((((ev.clientX - r.left) / r.width) * horas * 60) / 30) * 30;
        const i = new Date(base + min * 60_000);
        onCriar(i, new Date(i.getTime() + 3600_000));
      }}>
      {Array.from({ length: horas }, (_, i) => (
        <span key={i} className="absolute top-0 bottom-0 border-l" style={{ left: `${(i / horas) * 100}%`, borderColor: "var(--line2, var(--line))" }} />
      ))}
      {inteiros.length > 0 && (
        <div className="absolute left-1 right-1 top-1 flex gap-1">
          {inteiros.map((e) => <span key={e.id} className="max-w-[200px]"><ChipEvento e={e} onAbrir={onAbrir} compacto /></span>)}
        </div>
      )}
      {eventos.filter((e) => !e.dia_inteiro).map((e) => {
        const a = pct(new Date(e.inicio).getTime());
        const b = pct(Math.max(new Date(e.fim).getTime(), new Date(e.inicio).getTime() + 20 * 60_000));
        if (b <= 0 || a >= 100) return null;
        return (
          <button key={e.id} onClick={(x) => { x.stopPropagation(); onAbrir(e); }}
            className="absolute rounded-md px-1.5 text-left overflow-hidden text-[11.5px] leading-tight"
            style={{
              left: `${a}%`, width: `calc(${Math.max(1.5, b - a)}% - 2px)`, top: inteiros.length ? 26 : 8, bottom: 8,
              background: e.mascarado ? "repeating-linear-gradient(45deg, #94A3B833 0 6px, #94A3B81a 6px 12px)" : `${corDe(e)}2e`,
              borderLeft: `3px solid ${corDe(e)}`, color: "var(--ink)",
            }}
            title={`${horaCurtaBR(e.inicio)}–${horaCurtaBR(e.fim)} · ${e.titulo}`}>
            <span className="block font-semibold truncate mt-1">{e.titulo || "(sem título)"}</span>
            <span className="block truncate" style={{ color: "var(--ink3)" }}>{horaCurtaBR(e.inicio)}–{horaCurtaBR(e.fim)}</span>
          </button>
        );
      })}
      {xAgora >= 0 && xAgora <= 100 && (
        <span className="absolute top-0 bottom-0 w-0.5 pointer-events-none" style={{ left: `${xAgora}%`, background: "#EA4335" }} aria-label="Agora" />
      )}
    </div>
  );
}
