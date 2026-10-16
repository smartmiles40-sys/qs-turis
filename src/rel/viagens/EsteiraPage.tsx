// src/rel/viagens/EsteiraPage.tsx
// -----------------------------------------------------------------------------
// ESTEIRA DO RELACIONAMENTO (0141, 16/10/2026) — a tela de trabalho do time.
//   HOJE      — o que fazer hoje: etapas atrasadas, etapas que abriram,
//               check-ins abertos, quem embarca e quem volta
//   ESTEIRA   — as 8 etapas como colunas; cada viagem na etapa em que está
//   EM VIAGEM — quem está viajando, onde está agora, onde dorme hoje,
//               o próximo passo e o contato
// Clicar em qualquer viagem abre o card dela.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { supabase } from "@/lib/supabase";
import { ETAPA, ETAPAS, estadoDaEsteira, etapasDe, diasAte, type EstadoEtapa, type EtapaId, type RegistroEtapa } from "../lib/etapas";
import { TIPOS_TRECHO, grupoTipo, hojeSP, marcarCheckin, trechosDasViagens, type Trecho, type Viagem } from "../lib/viagens";
import { diaBR, diaLocal, horaLocal, mapaDasNoites } from "../lib/problemas";
import { formatarTelefone } from "../lib/clientes";
import { Aviso, Entrada } from "../ui";
import { MarcaTipo } from "./MapaMundi";
import { COR_SITUACAO, quandoTexto } from "./EtapasViagem";

type Aba = "hoje" | "esteira" | "viagem";
type Filtro = "todos" | "pacote" | "expedicao";
interface Item { v: Viagem; etapas: EstadoEtapa[]; atual: EstadoEtapa | null; trechos: Trecho[] }

const CHAVE_ABA = "rel_esteira_aba";
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nomeDe = (v: Viagem) => v.cliente_nome || v.titulo;
const ehVoo = (t: Trecho) => t.tipo === "voo_internacional" || t.tipo === "voo_interno";

async function viagensDaEsteira(): Promise<Viagem[]> {
  const hoje = hojeSP();
  const { data, error } = await supabase.from("rel_viagens_v").select("*").eq("status", "ativa")
    .or(`fase.in.(antes,em_viagem),and(fase.eq.concluida,data_retorno.gte.${somaDias(hoje, -10)})`)
    .order("data_embarque", { ascending: true, nullsFirst: false }).limit(2000);
  if (error) throw error;
  return (data ?? []) as Viagem[];
}

function Selo({ e }: { e: EstadoEtapa }) {
  const cor = COR_SITUACAO[e.situacao];
  return <span className="inline-block text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${cor}1F`, color: cor }}>{quandoTexto(e)}</span>;
}

function LinhaViagem({ it, abrir, extra }: { it: Item; abrir: () => void; extra?: React.ReactNode }) {
  const d = diasAte(it.v.data_embarque);
  return (
    <li>
      <button onClick={abrir} className="rel-linha w-full text-left px-3 py-2 rounded-lg flex items-center gap-3">
        <span className="text-[13px] font-extrabold tabular-nums w-[46px] flex-shrink-0" style={{ color: "var(--ink)" }}>{it.v.data_embarque ? diaBR(it.v.data_embarque) : "—"}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13.5px] font-bold truncate" style={{ color: "var(--ink)" }}><MarcaTipo tipo={grupoTipo(it.v.tipo)} tamanho={8} />{nomeDe(it.v)}</span>
          <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{it.v.destino || it.v.titulo}{d !== null && d >= 0 ? ` · embarca ${d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`}` : ""}</span>
        </span>
        {extra}
      </button>
    </li>
  );
}

function Bloco({ titulo, cor, n, children, vazio }: { titulo: string; cor: string; n: number; children: React.ReactNode; vazio: string }) {
  return (
    <section className="rel-card p-3 min-w-0">
      <h2 className="flex items-center gap-2 text-[12.5px] font-extrabold uppercase tracking-wide mb-1.5 px-1" style={{ color: cor }}>
        {titulo}<span className="px-1.5 rounded-full text-[11px]" style={{ background: `${cor}1F` }}>{n}</span>
      </h2>
      {n ? <ul className="space-y-0.5 max-h-[420px] overflow-y-auto">{children}</ul> : <p className="text-[12.5px] px-1 py-2" style={{ color: "var(--ink3)" }}>{vazio}</p>}
    </section>
  );
}

// ── HOJE ────────────────────────────────────────────────────────────────────

function Hoje({ itens, abrir, onMudou }: { itens: Item[]; abrir: (id: string) => void; onMudou: () => void }) {
  const { currentUser } = useQsAuth();
  const hoje = hojeSP();
  const agora = Date.now();
  const atrasadas = itens.filter((it) => it.atual?.situacao === "atrasada" && (diasAte(it.v.data_embarque) ?? 999) <= 45)
    .sort((a, b) => String(a.v.data_embarque).localeCompare(String(b.v.data_embarque)));
  const paraHoje = itens.filter((it) => it.atual?.situacao === "a_fazer" && (it.atual.prazo === hoje || it.atual.abre === hoje || (diasAte(it.atual.prazo) ?? 99) <= 1));
  const checkins = itens.flatMap((it) => it.trechos.filter((t) => ehVoo(t) && t.checkin_em && !t.checkin_feito_em && new Date(t.checkin_em).getTime() <= agora + 24 * 3600_000 && new Date(t.partida_em).getTime() > agora).map((t) => ({ it, t })))
    .sort((a, b) => a.t.partida_em.localeCompare(b.t.partida_em));
  const embarcam = itens.filter((it) => it.v.data_embarque === hoje || it.v.data_embarque === somaDias(hoje, 1));
  const voltam = itens.filter((it) => it.v.data_retorno === hoje);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
      <Bloco titulo="Atrasadas" cor="#DC2626" n={atrasadas.length} vazio="Nenhuma etapa atrasada nas viagens dos próximos 45 dias.">
        {atrasadas.map((it) => <LinhaViagem key={it.v.id} it={it} abrir={() => abrir(it.v.id)} extra={<span className="text-right flex-shrink-0"><span className="block text-[12px] font-bold" style={{ color: "var(--ink)" }}>{ETAPA[it.atual!.id].curto}</span><Selo e={it.atual!} /></span>} />)}
      </Bloco>
      <Bloco titulo="Check-ins a fazer (24h)" cor="#B45309" n={checkins.length} vazio="Nenhum check-in aberto ou abrindo nas próximas 24h.">
        {checkins.map(({ it, t }) => (
          <li key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg rel-linha">
            <input type="checkbox" className="w-4 h-4 flex-shrink-0" style={{ accentColor: "var(--rel)" }} aria-label={`Check-in feito: ${t.numero || ""}`}
              onChange={async (e) => { if (e.target.checked) { await marcarCheckin(t.id, true, currentUser?.id ?? "").catch(() => null); onMudou(); } }} />
            <button onClick={() => abrir(it.v.id)} className="min-w-0 flex-1 text-left">
              <span className="block text-[13px] font-bold truncate" style={{ color: "var(--ink)" }}>{nomeDe(it.v)} · {[t.companhia, t.numero].filter(Boolean).join(" ")}</span>
              <span className="block text-[12px] truncate" style={{ color: "var(--ink2)" }}>
                {[t.origem_codigo || t.origem, t.destino_codigo || t.destino].filter(Boolean).join(" → ")} · voo {diaBR(diaLocal(t.partida_em, t.partida_fuso))} {horaLocal(t.partida_em, t.partida_fuso)}{t.localizador ? ` · loc. ${t.localizador}` : ""}
              </span>
            </button>
            <span className="text-[11px] font-bold flex-shrink-0" style={{ color: new Date(t.checkin_em!).getTime() <= agora ? "#DC2626" : "#B45309" }}>{new Date(t.checkin_em!).getTime() <= agora ? "ABERTO" : `abre ${horaLocal(t.checkin_em, null)}`}</span>
          </li>
        ))}
      </Bloco>
      <Bloco titulo="Etapas para hoje" cor="#D97706" n={paraHoje.length} vazio="Nenhuma etapa vence hoje.">
        {paraHoje.map((it) => <LinhaViagem key={it.v.id} it={it} abrir={() => abrir(it.v.id)} extra={<span className="text-right flex-shrink-0"><span className="block text-[12px] font-bold" style={{ color: "var(--ink)" }}>{ETAPA[it.atual!.id].curto}</span><Selo e={it.atual!} /></span>} />)}
      </Bloco>
      <Bloco titulo="Embarcam hoje e amanhã" cor="#0369A1" n={embarcam.length} vazio="Ninguém embarca hoje nem amanhã.">
        {embarcam.map((it) => <LinhaViagem key={it.v.id} it={it} abrir={() => abrir(it.v.id)} />)}
      </Bloco>
      <Bloco titulo="Voltam hoje" cor="#BE185D" n={voltam.length} vazio="Ninguém volta hoje.">
        {voltam.map((it) => <LinhaViagem key={it.v.id} it={it} abrir={() => abrir(it.v.id)} />)}
      </Bloco>
    </div>
  );
}

// ── ESTEIRA (colunas) ───────────────────────────────────────────────────────

function Quadro({ itens, abrir }: { itens: Item[]; abrir: (id: string) => void }) {
  const [verTudo, setVerTudo] = useState<Set<EtapaId>>(new Set());
  const porEtapa = new Map<EtapaId, Item[]>(ETAPAS.map((e) => [e.id, []]));
  for (const it of itens) if (it.atual) porEtapa.get(it.atual.id)!.push(it);
  const ordem = { atrasada: 0, a_fazer: 1, aguardando: 2, feita: 3, nao_se_aplica: 4 };
  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1">
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(8, minmax(220px, 1fr))", minWidth: 8 * 225 }}>
        {ETAPAS.map((e) => {
          const lista = (porEtapa.get(e.id) ?? []).sort((a, b) => ordem[a.atual!.situacao] - ordem[b.atual!.situacao] || String(a.v.data_embarque).localeCompare(String(b.v.data_embarque)));
          const atrasadas = lista.filter((x) => x.atual!.situacao === "atrasada").length;
          const mostra = verTudo.has(e.id) ? lista : lista.slice(0, 30);
          return (
            <section key={e.id} className="rounded-xl flex flex-col min-w-0" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
              <header className="px-3 py-2 rounded-t-xl" style={{ borderTop: `4px solid ${e.cor}` }}>
                <h3 className="text-[13px] font-extrabold" style={{ color: "var(--ink)" }}>{e.nome}</h3>
                <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{lista.length} viage{lista.length === 1 ? "m" : "ns"}{atrasadas ? <b style={{ color: "#DC2626" }}> · {atrasadas} atrasada{atrasadas > 1 ? "s" : ""}</b> : null}</p>
              </header>
              <ul className="p-1.5 space-y-1.5 overflow-y-auto" style={{ maxHeight: "70vh" }}>
                {mostra.map((it) => {
                  const cor = COR_SITUACAO[it.atual!.situacao];
                  return (
                    <li key={it.v.id}>
                      <button onClick={() => abrir(it.v.id)} className="w-full text-left rounded-lg px-2.5 py-2 hover:brightness-[.98]" style={{ background: "var(--card)", border: "1px solid var(--line)", borderLeft: `4px solid ${cor}` }}>
                        <span className="flex items-center gap-1.5 text-[13px] font-bold truncate" style={{ color: "var(--ink)" }}><MarcaTipo tipo={grupoTipo(it.v.tipo)} tamanho={7} />{nomeDe(it.v)}</span>
                        <span className="block text-[11.5px] truncate" style={{ color: "var(--ink3)" }}>{it.v.destino || it.v.titulo}</span>
                        <span className="flex items-center justify-between mt-1 gap-1">
                          <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: "var(--ink2)" }}>ida {it.v.data_embarque ? diaBR(it.v.data_embarque) : "—"}</span>
                          <Selo e={it.atual!} />
                        </span>
                        {it.etapas.some((x) => x.registro?.houve_alteracao) && <span className="block text-[10.5px] font-bold mt-0.5" style={{ color: "#DC2626" }}>⚠ teve alteração na reserva</span>}
                      </button>
                    </li>
                  );
                })}
                {lista.length > mostra.length && (
                  <li><button className="w-full text-[12px] font-semibold py-1.5" style={{ color: "var(--rel-ink)" }} onClick={() => setVerTudo((s) => new Set(s).add(e.id))}>ver mais {lista.length - mostra.length}</button></li>
                )}
                {!lista.length && <li className="text-[12px] px-2 py-3 text-center" style={{ color: "var(--ink3)" }}>vazio</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── EM VIAGEM ───────────────────────────────────────────────────────────────

function EmViagem({ itens, abrir }: { itens: Item[]; abrir: (id: string) => void }) {
  const hoje = hojeSP();
  const agora = Date.now();
  const lista = itens.filter((it) => it.v.fase === "em_viagem").sort((a, b) => String(a.v.data_retorno).localeCompare(String(b.v.data_retorno)));
  if (!lista.length) return <p className="rel-card p-4 text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém viajando agora.</p>;
  return (
    <div className="rel-card overflow-x-auto">
      <table className="w-full text-[13px]" style={{ minWidth: 1000 }}>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink3)" }}>
            <th className="px-3 py-2">Cliente</th><th className="px-2 py-2">Dia</th><th className="px-2 py-2">Onde está agora</th>
            <th className="px-2 py-2">Dorme hoje em</th><th className="px-2 py-2">Próximo passo</th><th className="px-3 py-2">Contato</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((it) => {
            const ts = it.trechos;
            const { hotelDaNoite } = mapaDasNoites(ts);
            const hotel = hotelDaNoite.get(hoje);
            const chegou = ts.filter((t) => t.tipo !== "hospedagem" && new Date(t.chegada_em || t.partida_em).getTime() <= agora).pop();
            const emCurso = ts.find((t) => t.tipo !== "hospedagem" && new Date(t.partida_em).getTime() <= agora && t.chegada_em && new Date(t.chegada_em).getTime() > agora);
            const prox = ts.find((t) => t.tipo !== "hospedagem" && new Date(t.partida_em).getTime() > agora);
            const total = it.v.data_embarque && it.v.data_retorno ? (diasAte(it.v.data_retorno, it.v.data_embarque) ?? 0) + 1 : null;
            const dia = it.v.data_embarque ? -(diasAte(it.v.data_embarque) ?? 0) + 1 : null;
            const onde = emCurso ? `em trânsito: ${TIPOS_TRECHO[emCurso.tipo]} ${[emCurso.origem_codigo || emCurso.origem, emCurso.destino_codigo || emCurso.destino].filter(Boolean).join(" → ")}`
              : hotel ? (hotel.destino || hotel.origem || hotel.descricao || "hotel")
              : chegou ? (chegou.destino || chegou.descricao || "—") : (it.v.destino || "—");
            const tel = (it.v.cliente_telefone || "").replace(/\D/g, "");
            const checkinPendente = ts.some((t) => ehVoo(t) && t.checkin_em && !t.checkin_feito_em && new Date(t.checkin_em).getTime() <= agora && new Date(t.partida_em).getTime() > agora);
            return (
              <tr key={it.v.id} className="rel-linha cursor-pointer" style={{ borderTop: "1px solid var(--line2)" }} onClick={() => abrir(it.v.id)}>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5 font-bold" style={{ color: "var(--ink)" }}><MarcaTipo tipo={grupoTipo(it.v.tipo)} tamanho={8} />{nomeDe(it.v)}</span>
                  <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>{it.v.destino || it.v.titulo} · volta {diaBR(it.v.data_retorno)}</span>
                </td>
                <td className="px-2 py-2.5 tabular-nums font-semibold" style={{ color: "var(--ink)" }}>{dia && total ? `${dia} de ${total}` : "—"}</td>
                <td className="px-2 py-2.5" style={{ color: "var(--ink)" }}>{onde}</td>
                <td className="px-2 py-2.5" style={{ color: hotel ? "var(--ink)" : "var(--ink3)" }}>{hotel ? (hotel.descricao || hotel.destino) : "—"}</td>
                <td className="px-2 py-2.5">
                  {prox ? <><b style={{ color: "var(--ink)" }}>{diaBR(diaLocal(prox.partida_em, prox.partida_fuso))} {horaLocal(prox.partida_em, prox.partida_fuso)}</b> <span style={{ color: "var(--ink2)" }}>{TIPOS_TRECHO[prox.tipo]} {[prox.companhia, prox.numero].filter(Boolean).join(" ")} {[prox.origem_codigo || prox.origem, prox.destino_codigo || prox.destino].filter(Boolean).join(" → ")}</span></> : <span style={{ color: "var(--ink3)" }}>—</span>}
                  {checkinPendente && <span className="block text-[11.5px] font-bold" style={{ color: "#DC2626" }}>check-in aberto e não feito</span>}
                </td>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {tel ? <a className="underline font-semibold" style={{ color: "var(--rel-ink)" }} href={`https://wa.me/${tel}`} target="_blank" rel="noreferrer">{formatarTelefone(it.v.cliente_telefone)}</a> : <span style={{ color: "var(--ink3)" }}>sem telefone</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function EsteiraPage({ onAbrirViagem }: { onAbrirViagem: (id: string) => void }) {
  const [aba, setAbaEstado] = useState<Aba>(() => { try { const a = localStorage.getItem(CHAVE_ABA); return a === "esteira" || a === "viagem" ? a : "hoje"; } catch { return "hoje"; } });
  const setAba = (a: Aba) => { setAbaEstado(a); try { localStorage.setItem(CHAVE_ABA, a); } catch { /* sem memória */ } };
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [dados, setDados] = useState<{ vs: Viagem[]; regs: Map<string, RegistroEtapa[]>; trechos: Map<string, Trecho[]> } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const vs = await viagensDaEsteira();
      const hoje = hojeSP();
      // trechos só de quem embarca em até 3 dias ou está viajando (check-in e "em viagem")
      const perto = vs.filter((v) => v.fase === "em_viagem" || (v.data_embarque && v.data_embarque <= somaDias(hoje, 3))).map((v) => v.id);
      const [regs, ts] = await Promise.all([etapasDe(vs.map((v) => v.id)), trechosDasViagens(perto)]);
      const trechos = new Map<string, Trecho[]>();
      for (const t of ts) trechos.set(t.viagem_id, [...(trechos.get(t.viagem_id) ?? []), t]);
      setDados({ vs, regs, trechos }); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); setDados({ vs: [], regs: new Map(), trechos: new Map() }); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const itens = useMemo<Item[]>(() => {
    if (!dados) return [];
    const q = busca.trim().toLowerCase();
    return dados.vs
      .filter((v) => v.data_embarque) // sem data não entra na esteira
      .filter((v) => filtro === "todos" || grupoTipo(v.tipo) === filtro)
      .filter((v) => !q || `${v.cliente_nome ?? ""} ${v.titulo} ${v.destino ?? ""} ${v.expedicao ?? ""}`.toLowerCase().includes(q))
      .map((v) => { const e = estadoDaEsteira(v, dados.regs.get(v.id) ?? []); return { v, etapas: e.etapas, atual: e.atual, trechos: (dados.trechos.get(v.id) ?? []).sort((a, b) => a.partida_em.localeCompare(b.partida_em)) }; });
  }, [dados, filtro, busca]);

  const semData = dados ? dados.vs.filter((v) => !v.data_embarque).length : 0;
  const nViagem = itens.filter((it) => it.v.fase === "em_viagem").length;
  const nAtrasadas = itens.filter((it) => it.atual?.situacao === "atrasada" && (diasAte(it.v.data_embarque) ?? 999) <= 45).length;

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Esteira do Relacionamento</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Passagem de bastão → Revisão → D-30 → D-7 → D-3 → Check-in → Em viagem → Retorno</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rel-card p-1" role="group" aria-label="Mostrar">
            {([["todos", "Todos"], ["pacote", "Pacotes"], ["expedicao", "Expedições"]] as [Filtro, string][]).map(([id, r]) => (
              <button key={id} onClick={() => setFiltro(id)} aria-pressed={filtro === id} className="rel-linha px-3 py-1.5 rounded-lg text-[12.5px] font-semibold"
                style={filtro === id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>{r}</button>
            ))}
          </div>
          <div style={{ width: 240 }}><Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou destino" aria-label="Buscar" /></div>
        </div>
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--line)" }} role="tablist">
        {([["hoje", `Hoje${nAtrasadas ? ` · ${nAtrasadas} atrasada${nAtrasadas > 1 ? "s" : ""}` : ""}`], ["esteira", "Esteira"], ["viagem", `Em viagem · ${nViagem}`]] as [Aba, string][]).map(([id, r]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className="px-4 py-2.5 text-[13.5px] font-semibold -mb-px"
            style={aba === id ? { color: "var(--rel-ink)", borderBottom: "2px solid var(--rel)" } : { color: "var(--ink2)", borderBottom: "2px solid transparent" }}>{r}</button>
        ))}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!dados ? <div className="rel-card h-64 animate-pulse" style={{ background: "var(--card2)" }} /> : (
        <>
          {aba === "hoje" && <Hoje itens={itens} abrir={onAbrirViagem} onMudou={() => void carregar()} />}
          {aba === "esteira" && <Quadro itens={itens} abrir={onAbrirViagem} />}
          {aba === "viagem" && <EmViagem itens={itens} abrir={onAbrirViagem} />}
          {semData > 0 && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{semData} viagem(ns) sem data de ida não entram na esteira — ajuste a data na viagem.</p>}
        </>
      )}
    </div>
  );
}
