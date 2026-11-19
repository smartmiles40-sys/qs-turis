// src/rel/viagens/CalendarioViagens.tsx
// -----------------------------------------------------------------------------
// CALENDÁRIO de Viagens = calendário de CHECK-INS DOS PACOTES.
//
// Bruno, 19/11: "sinto que tem coisa pra krl aqui, mas nada é visual ou simples
// de entender… aqui só vai entrar os check-ins dos voos, e nada mais
// (exclusivamente dos pacotes); pode deixar sem o check-in das expedições".
// Antes misturava embarque, volta, trechos e check-ins de tudo.
//
// Cada voo de pacote (com bilhete) aparece UMA vez, no dia em que o check-in
// abre, com a cor do que fazer: vermelho = aberto, âmbar = abre em < 24h,
// cinza = agendado, verde riscado = feito. Clicar no dia lista os voos e deixa
// marcar "Check-in feito" ali mesmo (mesma RPC da aba Check-ins).
// Regra pura: checkinsDoCalendario() em src/rel/lib/agendaServicos.ts (com teste).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { carregarVoosDoPeriodo } from "../lib/agendaDados";
import { ROTULO_SITUACAO_CAL, TEXTO_ESTIMADO, checkinsDoCalendario, type CheckinCal, type SituacaoCal, type TrechoAgenda, type ViagemAgenda } from "../lib/agendaServicos";
import { checkinDoTrecho } from "../lib/correcoes";
import { codigoDe } from "../lib/statusViagem";
import { horaDoLugar, hojeSP } from "../lib/viagens";
import { Aviso, Botao } from "../ui";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// cores por situação; o texto muda com o tema (contraste nos dois)
const CSS_CAL = `
:root { --cal-aberto: #B91C1C; --cal-logo: #92400E; --cal-futuro: #334155; --cal-feito: #15803D; --cal-nao: #7F1D1D; }
html.dark { --cal-aberto: #FCA5A5; --cal-logo: #FCD34D; --cal-futuro: #CBD5E1; --cal-feito: #86EFAC; --cal-nao: #FDA4AF; }
`;
const COR: Record<SituacaoCal, { fundo: string; texto: string; borda: string }> = {
  aberto: { fundo: "rgba(220,38,38,.14)", texto: "var(--cal-aberto)", borda: "#DC2626" },
  abre_logo: { fundo: "rgba(245,158,11,.16)", texto: "var(--cal-logo)", borda: "#F59E0B" },
  futuro: { fundo: "rgba(100,116,139,.12)", texto: "var(--cal-futuro)", borda: "#94A3B8" },
  feito: { fundo: "rgba(22,163,74,.12)", texto: "var(--cal-feito)", borda: "#16A34A" },
  nao_marcado: { fundo: "transparent", texto: "var(--cal-nao)", borda: "#BE123C" },
};
const ORDEM_LEGENDA: SituacaoCal[] = ["aberto", "abre_logo", "futuro", "feito", "nao_marcado"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const inicioSemana = (d: Date) => addDias(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
const FMT_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const diaSP = (ms: number) => FMT_DIA.format(new Date(ms));
const horaSP = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const nomeVoo = (t: TrechoAgenda) => [t.companhia, t.numero].filter(Boolean).join(" ") || "voo";
const rota = (t: TrechoAgenda) => [codigoDe(t.origem_codigo, t.origem) || t.origem, codigoDe(t.destino_codigo, t.destino) || t.destino].filter(Boolean).join(" → ");
const primeiroNome = (n?: string | null) => (n || "").trim().split(/\s+/)[0] || "Cliente";

function Chip({ c, v, onClick }: { c: CheckinCal; v?: ViagemAgenda; onClick: () => void }) {
  const cor = COR[c.situacao];
  const riscado = c.situacao === "feito";
  return (
    <button onClick={onClick}
      title={`${ROTULO_SITUACAO_CAL[c.situacao]} · ${v?.cliente_nome ?? ""} · ${nomeVoo(c.t)} ${rota(c.t)}`}
      aria-label={`Check-in ${ROTULO_SITUACAO_CAL[c.situacao]}: ${v?.cliente_nome ?? "cliente"}, ${nomeVoo(c.t)}, abre ${horaSP(c.abre)}`}
      className="w-full flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-semibold text-left truncate hover:brightness-95"
      style={{ background: cor.fundo, color: cor.texto, border: c.situacao === "nao_marcado" ? `1px dashed ${cor.borda}` : undefined, borderLeft: `3px solid ${cor.borda}`, textDecoration: riscado ? "line-through" : undefined, opacity: riscado ? 0.7 : 1 }}>
      <span className="tabular-nums flex-shrink-0">{c.estimado ? "~" : ""}{horaSP(c.abre)}</span>
      <span className="truncate">{primeiroNome(v?.cliente_nome)} · {c.t.numero || rota(c.t)}</span>
    </button>
  );
}

export default function CalendarioViagens({ onAbrirViagem }: { onAbrirViagem: (id: string) => void }) {
  const [modo, setModo] = useState<"mes" | "semana">("mes");
  const [ref, setRef] = useState(() => new Date());
  const [dados, setDados] = useState<{ trechos: TrechoAgenda[]; viagens: Map<string, ViagemAgenda> } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setAgora(Date.now()), 60_000); return () => clearInterval(i); }, []);

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
    setDados(null);
    carregarVoosDoPeriodo(`${de}T00:00:00-03:00`, `${ate}T00:00:00-03:00`)
      .then((d) => { if (vivo) { setDados(d); setErro(null); } })
      .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou o calendário."); setDados({ trechos: [], viagens: new Map() }); } });
    return () => { vivo = false; };
  }, [de, ate, versao]);

  const itens = useMemo(() => (dados ? checkinsDoCalendario(dados.trechos, dados.viagens, agora) : null), [dados, agora]);
  const porDia = useMemo(() => {
    const m = new Map<string, CheckinCal[]>();
    for (const c of itens ?? []) {
      const d = diaSP(c.abre);
      if (d < de || d >= ate) continue;
      const l = m.get(d); if (l) l.push(c); else m.set(d, [c]);
    }
    return m;
  }, [itens, de, ate]);
  const conta = useMemo(() => {
    const c: Record<SituacaoCal, number> = { aberto: 0, abre_logo: 0, futuro: 0, feito: 0, nao_marcado: 0 };
    for (const l of porDia.values()) for (const x of l) c[x.situacao]++;
    return c;
  }, [porDia]);

  function mover(n: number) {
    const x = new Date(ref);
    if (modo === "mes") { x.setDate(1); x.setMonth(x.getMonth() + n); } else x.setDate(x.getDate() + 7 * n);
    setRef(x); setDiaAberto(null);
  }
  async function marcar(c: CheckinCal, feito: boolean) {
    setOcupado(c.chave); setErro(null);
    try { for (const id of c.trechoIds) await checkinDoTrecho(id, feito); setVersao((x) => x + 1); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não marcou."); }
    finally { setOcupado(null); }
  }

  const hoje = hojeSP();
  const titulo = modo === "mes"
    ? `${MESES[ref.getMonth()]} de ${ref.getFullYear()}`
    : `${dias[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} a ${dias[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  const doDia = diaAberto ? porDia.get(diaAberto) ?? [] : [];

  return (
    <div className="space-y-3">
      <style>{CSS_CAL}</style>
      <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
        Só os <b>check-ins dos voos dos pacotes</b>, no dia em que o check-in abre (as expedições ficam fora).
        Hora com <b>~</b> = estimada em 48h antes do voo.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Botao variante="secundario" onClick={() => mover(-1)} aria-label="Anterior">‹</Botao>
          <h2 className="text-[16px] font-bold capitalize min-w-[150px] sm:min-w-[190px] text-center" style={{ color: "var(--ink)" }} aria-live="polite">{titulo}</h2>
          <Botao variante="secundario" onClick={() => mover(1)} aria-label="Próximo">›</Botao>
          <Botao variante="fantasma" onClick={() => { setRef(new Date()); setDiaAberto(null); }}>Hoje</Botao>
        </div>
        <div className="flex gap-1 rel-card p-1" role="group" aria-label="Período">
          {([["mes", "Mês"], ["semana", "Semana"]] as ["mes" | "semana", string][]).map(([id, r]) => (
            <button key={id} onClick={() => setModo(id)} aria-pressed={modo === id} className="rel-linha px-3 py-2 rounded-lg text-[12.5px] font-semibold"
              style={modo === id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>{r}</button>
          ))}
        </div>
      </div>

      {/* legenda que também é o resumo do período */}
      <div className="flex flex-wrap gap-2" aria-label="Resumo do período">
        {ORDEM_LEGENDA.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold"
            style={{ background: COR[s].fundo, color: COR[s].texto, border: s === "nao_marcado" ? `1px dashed ${COR[s].borda}` : undefined, borderLeft: `3px solid ${COR[s].borda}` }}>
            <span className="tabular-nums text-[14px]">{itens ? conta[s] : "…"}</span> {ROTULO_SITUACAO_CAL[s]}
          </span>
        ))}
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
            const temAberto = lista.some((c) => c.situacao === "aberto");
            return (
              <div key={k} className="p-1 flex flex-col gap-0.5 cursor-pointer min-w-0"
                style={{
                  minHeight: modo === "semana" ? 260 : 78, borderTop: "1px solid var(--line2)", borderLeft: d.getDay() ? "1px solid var(--line2)" : undefined,
                  background: diaAberto === k ? "var(--rel-soft)" : fora ? "var(--card2)" : undefined, opacity: fora ? 0.7 : 1,
                }}
                onClick={() => setDiaAberto(k === diaAberto ? null : k)}>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); setDiaAberto(k === diaAberto ? null : k); }}
                  aria-label={`${d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}${lista.length ? ` — ${lista.length} check-in${lista.length > 1 ? "s" : ""}` : ""}`}
                  aria-pressed={diaAberto === k}
                  className="text-[12px] font-bold self-end w-7 h-7 inline-flex items-center justify-center rounded-full"
                  style={k === hoje ? { background: "var(--rel)", color: "#fff" } : { color: fora ? "var(--ink3)" : "var(--ink2)" }}>{d.getDate()}</button>
                {/* celular: só a bolinha com quantos */}
                {itens !== null && modo === "mes" && lista.length > 0 && (
                  <span className="sm:hidden self-center text-[11px] font-bold px-1.5 rounded-full" aria-hidden
                    style={{ background: temAberto ? "#DC2626" : "var(--rel-soft)", color: temAberto ? "#fff" : "var(--rel-ink)" }}>{lista.length}</span>
                )}
                {itens !== null && lista.slice(0, max).map((c) => (
                  <div key={c.chave} className={modo === "mes" ? "hidden sm:block" : undefined} onClick={(ev) => ev.stopPropagation()}>
                    <Chip c={c} v={dados?.viagens.get(c.viagem_id)} onClick={() => setDiaAberto(k)} />
                  </div>
                ))}
                {lista.length > max && <span className={`text-[11px] font-semibold px-1 ${modo === "mes" ? "hidden sm:inline" : ""}`} style={{ color: "var(--ink2)" }}>+{lista.length - max} mais</span>}
              </div>
            );
          })}
        </div>
      </div>
      {itens === null && <p className="text-[13px]" style={{ color: "var(--ink3)" }} aria-live="polite">Carregando o período…</p>}
      {itens !== null && porDia.size === 0 && !erro && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum check-in de pacote neste período.</p>}

      {diaAberto && (
        <section className="rel-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>
              Check-ins de {new Date(diaAberto + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            </h3>
            <button className="text-[12px] font-semibold px-2 py-1.5 -mr-2 rounded-md" style={{ color: "var(--ink2)" }} onClick={() => setDiaAberto(null)}>fechar</button>
          </div>
          {doDia.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum check-in neste dia.</p>
          ) : (
            <ul className="space-y-1.5">
              {doDia.map((c) => {
                const cor = COR[c.situacao];
                const v = dados?.viagens.get(c.viagem_id);
                const t = c.t;
                return (
                  <li key={c.chave} className="rounded-lg px-3 py-2.5 flex flex-wrap sm:flex-nowrap items-center gap-3" style={{ background: cor.fundo, borderLeft: `4px solid ${cor.borda}` }}>
                    <span className="w-[120px] flex-shrink-0">
                      <span className="block text-[11px] font-bold uppercase" style={{ color: cor.texto }}>{ROTULO_SITUACAO_CAL[c.situacao]}</span>
                      <span className="block text-[12px] tabular-nums" style={{ color: "var(--ink2)" }} title={c.estimado ? TEXTO_ESTIMADO : "horário informado pela companhia"}>
                        abre {horaSP(c.abre)}{c.estimado ? " · estimado" : ""}
                      </span>
                    </span>
                    <button className="min-w-0 flex-1 text-left" onClick={() => onAbrirViagem(c.viagem_id)}>
                      <span className="block text-[14px] font-bold truncate" style={{ color: "var(--ink)", textDecoration: c.situacao === "feito" ? "line-through" : undefined }}>
                        {v?.cliente_nome || "sem cliente"} <span style={{ color: "var(--ink2)" }}>· {nomeVoo(t)}</span>
                      </span>
                      <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                        {rota(t) || "rota a confirmar"} · voo <b style={{ color: "var(--ink2)" }}>{horaDoLugar(t.partida_em, t.partida_fuso).texto}</b>
                        {t.localizador ? ` · loc. ${t.localizador}` : ""}{c.passageiros.length ? ` · ${c.passageiros.length} passageiro${c.passageiros.length > 1 ? "s" : ""}` : ""}
                      </span>
                    </button>
                    {c.situacao === "feito" ? (
                      <Botao variante="fantasma" disabled={ocupado === c.chave} onClick={() => void marcar(c, false)}>{ocupado === c.chave ? "…" : "Desfazer"}</Botao>
                    ) : c.situacao !== "nao_marcado" ? (
                      <Botao variante={c.situacao === "aberto" ? "primario" : "secundario"} disabled={ocupado === c.chave} onClick={() => void marcar(c, true)}>{ocupado === c.chave ? "Salvando…" : "Check-in feito"}</Botao>
                    ) : (
                      <Botao variante="fantasma" disabled={ocupado === c.chave} onClick={() => void marcar(c, true)}>{ocupado === c.chave ? "…" : "Marcar como feito"}</Botao>
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
