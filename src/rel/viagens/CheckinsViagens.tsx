// src/rel/viagens/CheckinsViagens.tsx
// -----------------------------------------------------------------------------
// Aba CHECK-INS das Viagens (Bruno, 11/11: "uma aba onde só deve ter aéreo e
// todos em sequência de novos check-ins"). Só voo de verdade (nunca a data do
// hotel/seguro vinda do Bitrix — 0359), que ainda vai sair, em ordem de
// ABERTURA do check-in. Regra em src/rel/lib/agendaServicos.ts (com teste).
//
// Abertura: a que a cia informou (campo "check-in abre" do trecho) ou, sem ela,
// estimada em 48h antes do voo — a linha diz "estimado". Marcar feito usa a RPC
// rel_trecho_checkin (0227, fica no histórico de correções da viagem).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { carregarVoosFuturos } from "../lib/agendaDados";
import { ROTULO_SITUACAO_CHECKIN, TEXTO_ESTIMADO, filaDeCheckins, textoQuemFez, type ItemCheckin, type SituacaoCheckin, type TrechoAgenda, type ViagemAgenda } from "../lib/agendaServicos";
import { checkinDoTrecho } from "../lib/correcoes";
import { horaDoLugar, type Servico } from "../lib/viagens";
import { TIPOS_FILTRO, tipoDoServico, type TipoFiltro } from "../lib/tiposViagem";
import { Aviso, Botao, Entrada, Etiqueta, Vazio } from "../ui";

type Janela = "48h" | "7d" | "30d" | "tudo";
const JANELAS: { id: Janela; rotulo: string; horas: number | null }[] = [
  { id: "48h", rotulo: "Abre em até 48h", horas: 48 },
  { id: "7d", rotulo: "7 dias", horas: 24 * 7 },
  { id: "30d", rotulo: "30 dias", horas: 24 * 30 },
  { id: "tudo", rotulo: "Todos", horas: null },
];

const COR: Record<SituacaoCheckin, string> = { aberto: "#DC2626", abre_logo: "#B45309", futuro: "var(--line)", feito: "#16A34A" };
const TOM: Record<SituacaoCheckin, "erro" | "aviso" | "neutro" | "rel"> = { aberto: "erro", abre_logo: "aviso", futuro: "neutro", feito: "rel" };

const dataHoraSP = (ms: number) => new Date(ms).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const diaSP = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ms));
const tituloDia = (d: string, hoje: string, amanha: string) =>
  d === hoje ? "Hoje" : d === amanha ? "Amanhã" : new Date(`${d}T12:00:00-03:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });

function emQuanto(ms: number, agora: number): string {
  const min = Math.round((ms - agora) / 60_000);
  if (min <= 0) return "aberto";
  if (min < 60) return `abre em ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `abre em ${h}h` : `abre em ${Math.round(h / 24)} dias`;
}

export default function CheckinsViagens({ onAbrirViagem, onAbrirCliente }: { onAbrirViagem: (id: string) => void; onAbrirCliente: (id: string) => void }) {
  const [dados, setDados] = useState<{ trechos: TrechoAgenda[]; viagens: Map<string, ViagemAgenda> } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [janela, setJanela] = useState<Janela>("7d");
  const [tipo, setTipo] = useState<TipoFiltro>("todos");
  const [feitos, setFeitos] = useState(false);
  const [semBilhete, setSemBilhete] = useState(false);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  // a fila anda sozinha: recalcula a cada minuto ("abre em 3h" → "aberto")
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setAgora(Date.now()), 60_000); return () => clearInterval(i); }, []);

  useEffect(() => {
    let vivo = true;
    carregarVoosFuturos().then((d) => { if (vivo) { setDados(d); setErro(null); } })
      .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou."); setDados({ trechos: [], viagens: new Map() }); } });
    return () => { vivo = false; };
  }, [versao]);

  const horas = JANELAS.find((j) => j.id === janela)?.horas ?? null;
  const base = useMemo(() => (dados ? filaDeCheckins(dados.trechos, dados.viagens, agora, { feitos, semBilhete, abreAte: horas == null ? null : agora + horas * 3600_000 }) : null), [dados, agora, feitos, semBilhete, horas]);
  // busca primeiro (os números do tipo respeitam a busca), depois o tipo da venda
  const { porTipo, lista } = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const viagens = dados?.viagens;
    const tipoDe = (it: ItemCheckin) => tipoDoServico((viagens?.get(it.viagem_id)?.servico ?? null) as Servico | null);
    const achados = (base ?? []).filter((it) => {
      if (!q) return true;
      const v = viagens?.get(it.viagem_id);
      return [v?.cliente_nome, v?.titulo, it.t.numero, it.t.companhia, it.t.localizador, it.t.origem, it.t.destino, ...it.passageiros].some((x) => (x || "").toLowerCase().includes(q));
    });
    const c = { todos: achados.length } as Record<TipoFiltro, number>;
    for (const t of TIPOS_FILTRO) if (t.id !== "todos") c[t.id] = 0;
    for (const it of achados) c[tipoDe(it)]++;
    return { porTipo: c, lista: tipo === "todos" ? achados : achados.filter((it) => tipoDe(it) === tipo) };
  }, [base, busca, tipo, dados]);
  const abertos = lista.filter((it) => it.situacao === "aberto").length;

  const hoje = diaSP(agora), amanha = diaSP(agora + 86_400_000);
  const dias = useMemo(() => {
    const m = new Map<string, ItemCheckin[]>();
    for (const it of lista) {
      const d = it.situacao === "aberto" ? hoje : diaSP(it.abre);
      const l = m.get(d); if (l) l.push(it); else m.set(d, [it]);
    }
    return [...m.entries()];
  }, [lista, hoje]);

  async function marcar(it: ItemCheckin, feito: boolean) {
    setOcupado(it.chave); setErro(null);
    try {
      for (const id of it.trechoIds) await checkinDoTrecho(id, feito);
      setVersao((x) => x + 1);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não marcou."); }
    finally { setOcupado(null); }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <p className="text-[13px] mb-3" style={{ color: "var(--ink3)" }}>
        Só <b>voos</b> (aéreo de verdade — hotel, seguro e passeio não entram), na ordem em que o check-in abre.
        Sem o horário da companhia, a abertura é <b>estimada em 48h antes do voo</b>.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 rel-card p-1 overflow-x-auto" role="group" aria-label="Quando o check-in abre">
          {JANELAS.map((j) => (
            <button key={j.id} onClick={() => setJanela(j.id)} aria-pressed={janela === j.id} className="rel-linha px-3 py-2 rounded-lg text-[12.5px] font-semibold whitespace-nowrap"
              style={janela === j.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
              {j.rotulo}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={feitos} onChange={(e) => setFeitos(e.target.checked)} /> Mostrar os feitos
        </label>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--ink2)" }} title="Voo que só tem a data do Bitrix (sem horário, sem número): não dá pra fazer check-in até cadastrar o bilhete">
          <input type="checkbox" checked={semBilhete} onChange={(e) => setSemBilhete(e.target.checked)} /> Incluir voos sem bilhete (só a data do Bitrix)
        </label>
      </div>
      <div className="flex gap-1 rel-card p-1 overflow-x-auto mb-3 w-fit max-w-full" role="group" aria-label="Filtrar por tipo de venda">
        {TIPOS_FILTRO.map((t) => (
          <button key={t.id} onClick={() => setTipo(t.id)} aria-pressed={tipo === t.id} title={t.dica}
            className="rel-linha px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
            style={tipo === t.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
            {t.rotulo}{base && <span className="ml-1 tabular-nums font-normal" style={{ color: "var(--ink3)" }}>{porTipo[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="mb-4">
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar check-ins" placeholder="Buscar por cliente, viagem, voo, localizador ou passageiro" />
      </div>

      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      {abertos > 0 && <div className="mb-3"><Aviso tom="aviso"><b>{abertos}</b> check-in{abertos > 1 ? "s" : ""} já aberto{abertos > 1 ? "s" : ""} esperando — comece por cima.</Aviso></div>}

      {base === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhum check-in aqui" texto={busca ? "Nada com essa busca." : "Nenhum voo com check-in nessa janela. Aumente o período ou inclua os voos sem bilhete."} /></div>
      ) : (
        <div className="space-y-4">
          {dias.map(([d, its]) => (
            <section key={d}>
              <h2 className="text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>
                {d === hoje && its.some((x) => x.situacao === "aberto") ? "Abertos agora / hoje" : tituloDia(d, hoje, amanha)} <span className="tabular-nums" style={{ color: "var(--ink3)" }}>{its.length}</span>
              </h2>
              <ul className="space-y-1.5">
                {its.map((it) => {
                  const v = dados?.viagens.get(it.viagem_id);
                  const t = it.t;
                  const voo = [t.companhia, t.numero].filter(Boolean).join(" ") || "voo sem número";
                  const rota = [t.origem_codigo || t.origem, t.destino_codigo || t.destino].filter(Boolean).join(" → ");
                  const partida = it.semBilhete ? `${new Date(t.partida_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })} (horário a confirmar)` : horaDoLugar(t.partida_em, t.partida_fuso).texto;
                  return (
                    <li key={it.chave} className="rel-card px-3 py-2.5 flex flex-wrap sm:flex-nowrap items-center gap-3" style={{ borderLeft: `4px solid ${COR[it.situacao]}` }}>
                      <span className="w-[150px] flex-shrink-0">
                        <span className="block"><Etiqueta tom={TOM[it.situacao]}>{it.situacao === "futuro" || it.situacao === "abre_logo" ? emQuanto(it.abre, agora) : ROTULO_SITUACAO_CHECKIN[it.situacao]}</Etiqueta></span>
                        <span className="block text-[11.5px] mt-0.5 tabular-nums" style={{ color: "var(--ink3)" }} title={it.estimado ? TEXTO_ESTIMADO : "horário informado pela companhia"}>
                          {it.situacao === "aberto" ? "desde " : "abre "}{dataHoraSP(it.abre)}{it.estimado ? " · estimado" : ""}
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>
                          {v?.cliente_id && v.cliente_nome
                            ? <button className="underline" onClick={() => onAbrirCliente(v.cliente_id!)}>{v.cliente_nome}</button>
                            : (v?.cliente_nome || "sem cliente")}
                          <span style={{ color: "var(--ink2)" }}> · {voo}</span>
                        </p>
                        <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                          {rota || "rota a confirmar"} · voo <b style={{ color: "var(--ink2)" }}>{partida}</b>{t.localizador ? ` · loc. ${t.localizador}` : ""}
                          {it.passageiros.length > 0 ? ` · ${it.passageiros.length} passageiro${it.passageiros.length > 1 ? "s" : ""}` : it.trechoIds.length > 1 ? ` · ${it.trechoIds.length} bilhetes` : ""}
                        </p>
                        <p className="text-[12px] truncate">
                          <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirViagem(it.viagem_id)}>{v?.titulo ?? "abrir viagem"}</button>
                          {v?.responsavel_nome ? <span style={{ color: "var(--ink3)" }}> · {v.responsavel_nome.replace(/\s*\|.*$/, "")}</span> : null}
                        </p>
                        {/* 0360: quem marcou e de onde (Rel ou sistema de Expedições) */}
                        {it.feito && (
                          <p className="text-[11.5px] truncate" style={{ color: it.feito.origem === "expedicoes" ? "#7C3AED" : "#16A34A" }}>
                            ✓ {textoQuemFez(it.feito, (iso) => dataHoraSP(new Date(iso).getTime()))}{it.situacao !== "feito" ? " — falta em outro bilhete desta viagem" : ""}
                          </p>
                        )}
                      </div>
                      {it.semBilhete ? (
                        <span className="text-[11.5px] flex-shrink-0 max-w-[160px]" style={{ color: "var(--ink3)" }}>cadastre o bilhete pra ter horário e check-in</span>
                      ) : it.situacao === "feito" ? (
                        <Botao variante="fantasma" disabled={ocupado === it.chave} onClick={() => void marcar(it, false)}>{ocupado === it.chave ? "…" : "Desfazer"}</Botao>
                      ) : (
                        <Botao variante={it.situacao === "aberto" ? "primario" : "secundario"} disabled={ocupado === it.chave} onClick={() => void marcar(it, true)}>{ocupado === it.chave ? "Salvando…" : "Check-in feito"}</Botao>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
