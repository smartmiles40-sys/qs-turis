// src/rel/vendas/PipelinePage.tsx
// -----------------------------------------------------------------------------
// PIPELINE DE VENDAS DO RELACIONAMENTO (0218, 28/10/2026).
//
// "O cliente fica 100% com o Relacionamento" — então o Rel vende pra base. Os
// hunters (cargo com "É hunter", tela Time) recebem as oportunidades que nascem
// sozinhas; qualquer pessoa do Rel cria e move cartão.
//
// Três abas:
//   • Quadro  — Oportunidade → Contato feito → Proposta enviada → Negociação →
//               Ganho / Perdido (arrastar o cartão muda a etapa; Ganho pede o
//               valor, Perdido pede o motivo). Fechados: últimos 30 dias.
//   • Números — por pessoa: criadas, abertas, ganhas, valor, conversão. SEM
//               meta por enquanto (Bruno: "vamos estipular futuramente,
//               baseadas em KPIs"); os números ficam prontos pra isso.
//   • Origens automáticas (supervisão) — liga/desliga e regula as fontes de
//               cartão: voltou de viagem, embarca sem seguro, aniversário.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/ui";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  ETAPAS, gerarOportunidades, lerConfig, listarHunters, listarOportunidades, mudarOportunidade, nomeCurto, numerosDoPipeline, ORIGENS, ORIGENS_AUTO,
  PRODUTOS, reais, salvarConfig, situacaoAcao, type Etapa, type NumerosPessoa, type Oportunidade, type RotinasConfig,
} from "../lib/vendas";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Vazio } from "../ui";
import { podeGerirRelacionamento } from "../equipe/permissao";
import NovaOportunidade from "./NovaOportunidade";
import OportunidadeModal, { Fechamento } from "./OportunidadeModal";

type Aba = "quadro" | "numeros" | "origens";
const hojeIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

// ── Quadro ──────────────────────────────────────────────────────────────────
function Cartao({ o, onAbrir }: { o: Oportunidade; onAbrir: () => void }) {
  const acao = o.etapa === "ganho" || o.etapa === "perdido" ? null : situacaoAcao(o.proxima_acao_em);
  const prod = PRODUTOS.find((p) => p.id === o.produto);
  return (
    <button type="button" draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onAbrir} className="rel-card w-full text-left p-2.5 space-y-1 transition-shadow hover:shadow-md cursor-grab active:cursor-grabbing">
      <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{o.cliente?.nome ?? "—"}</span>
      <span className="block text-[12px] leading-snug line-clamp-2" style={{ color: "var(--ink2)" }}>{prod ? `${prod.emoji} ` : ""}{o.titulo}</span>
      <span className="flex flex-wrap items-center gap-1 text-[11px]" style={{ color: "var(--ink3)" }}>
        {(o.valor_ganho ?? o.valor_estimado) != null && <b style={{ color: "var(--ink)" }}>{reais(o.valor_ganho ?? o.valor_estimado)}</b>}
        <span>· {o.dono?.name ? nomeCurto(o.dono.name).split(" ")[0] : "sem dono"}</span>
        {o.origem !== "manual" && <span>· {ORIGENS[o.origem]}</span>}
      </span>
      {acao && <Etiqueta tom={acao.tom}>{acao.texto}</Etiqueta>}
      {o.etapa === "perdido" && o.motivo_perda && <span className="block text-[11px]" style={{ color: "var(--err-ink)" }}>{o.motivo_perda}</span>}
    </button>
  );
}

function Quadro({ lista, eu, onAbrir, onMover }: {
  lista: Oportunidade[]; eu: string; onAbrir: (id: string) => void; onMover: (o: Oportunidade, e: Etapa) => void;
}) {
  const [quem, setQuem] = useState<"todos" | "meus" | "sem">("todos");
  const [busca, setBusca] = useState("");
  const [sobre, setSobre] = useState<Etapa | null>(null);
  const t = busca.trim().toLowerCase();
  const visiveis = lista.filter((o) =>
    (quem === "todos" || (quem === "meus" ? o.dono_id === eu : !o.dono_id))
    && (!t || `${o.cliente?.nome ?? ""} ${o.titulo}`.toLowerCase().includes(t)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="De quem" value={quem} onChange={(v) => setQuem(v as typeof quem)}
          options={[{ value: "todos", label: "Todos" }, { value: "meus", label: "Meus" }, { value: "sem", label: "Sem dono", count: lista.filter((o) => !o.dono_id && o.etapa !== "ganho" && o.etapa !== "perdido").length || undefined }]} />
        <div className="flex-1 min-w-[180px] max-w-xs"><Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou pedido" /></div>
      </div>
      <div className="overflow-x-auto pb-2 -mx-1">
        <div className="grid gap-2 px-1" style={{ gridTemplateColumns: `repeat(${ETAPAS.length}, minmax(210px, 1fr))`, minWidth: ETAPAS.length * 220 }}>
          {ETAPAS.map((et) => {
            const col = visiveis.filter((o) => o.etapa === et.id);
            const soma = col.reduce((s, o) => s + (Number(o.valor_ganho ?? o.valor_estimado) || 0), 0);
            return (
              <section key={et.id}
                onDragOver={(e) => { e.preventDefault(); setSobre(et.id); }}
                onDragLeave={() => setSobre((s) => (s === et.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault(); setSobre(null);
                  const o = lista.find((x) => x.id === e.dataTransfer.getData("text/plain"));
                  if (o && o.etapa !== et.id) onMover(o, et.id);
                }}
                className="rounded-xl p-2 space-y-2 min-h-[200px]"
                style={{ background: sobre === et.id ? "var(--rel-soft)" : "var(--card2)", border: "1px solid var(--line2)" }}>
                <header className="px-1" title={et.dica}>
                  <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: et.id === "ganho" ? "var(--rel-ink)" : et.id === "perdido" ? "var(--err-ink)" : "var(--ink2)" }}>
                    {et.rotulo} <span className="tabular-nums">({col.length})</span>
                  </p>
                  <p className="text-[11px] tabular-nums" style={{ color: "var(--ink3)" }}>{soma ? reais(soma) : "—"}{(et.id === "ganho" || et.id === "perdido") ? " · 30 dias" : ""}</p>
                </header>
                {col.map((o) => <Cartao key={o.id} o={o} onAbrir={() => onAbrir(o.id)} />)}
              </section>
            );
          })}
        </div>
      </div>
      <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Arraste o cartão pra mudar de etapa. Ganho pede o valor; Perdido pede o motivo.</p>
    </div>
  );
}

// ── Números ─────────────────────────────────────────────────────────────────
function Numeros({ fechadas }: { fechadas: Oportunidade[] }) {
  const [periodo, setPeriodo] = useState<"mes" | "passado" | "90">("mes");
  const [dados, setDados] = useState<NumerosPessoa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [de, ate] = useMemo(() => {
    const h = hojeIso();
    const [y, m] = h.split("-").map(Number);
    if (periodo === "mes") return [`${h.slice(0, 7)}-01`, h];
    if (periodo === "passado") {
      const ini = new Date(Date.UTC(y, m - 2, 1)); const fim = new Date(Date.UTC(y, m - 1, 0));
      return [ini.toISOString().slice(0, 10), fim.toISOString().slice(0, 10)];
    }
    return [new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10), h];
  }, [periodo]);
  useEffect(() => {
    setDados(null); setErro(null);
    numerosDoPipeline(de, ate).then(setDados).catch((e) => { setDados([]); setErro(e instanceof Error ? e.message : "Falhou."); });
  }, [de, ate]);

  const tot = (dados ?? []).reduce((s, x) => ({
    criadas: s.criadas + x.criadas, abertas: s.abertas + x.abertas, ganhas: s.ganhas + x.ganhas, perdidas: s.perdidas + x.perdidas,
    valor_ganho: s.valor_ganho + x.valor_ganho, valor_aberto: s.valor_aberto + x.valor_aberto,
  }), { criadas: 0, abertas: 0, ganhas: 0, perdidas: 0, valor_ganho: 0, valor_aberto: 0 });
  const conv = (g: number, p: number) => (g + p ? `${Math.round((g / (g + p)) * 100)}%` : "—");
  const motivos = new Map<string, number>();
  for (const o of fechadas) if (o.etapa === "perdido" && o.motivo_perda) { const k = o.motivo_perda.split(":")[0]; motivos.set(k, (motivos.get(k) ?? 0) + 1); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Período" value={periodo} onChange={(v) => setPeriodo(v as typeof periodo)}
          options={[{ value: "mes", label: "Este mês" }, { value: "passado", label: "Mês passado" }, { value: "90", label: "90 dias" }]} />
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{de.split("-").reverse().join("/")} a {ate.split("-").reverse().join("/")}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Vendido", reais(tot.valor_ganho), `${tot.ganhas} ganha(s)`],
          ["Conversão", conv(tot.ganhas, tot.perdidas), `${tot.ganhas} de ${tot.ganhas + tot.perdidas} decididas`],
          ["Em aberto", reais(tot.valor_aberto), `${tot.abertas} cartão(ões) hoje`],
          ["Criadas no período", String(tot.criadas), "oportunidades novas"],
        ].map(([r, v, d]) => (
          <div key={r} className="rel-card p-4">
            <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{r}</span>
            <span className="block text-2xl font-bold mt-1 tabular-nums" style={{ color: "var(--ink)" }}>{v}</span>
            <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{d}</span>
          </div>
        ))}
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <section className="rel-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: "var(--ink2)" }} className="text-left">
              {["Pessoa", "Criadas", "Abertas", "Em aberto (R$)", "Ganhas", "Vendido (R$)", "Perdidas", "Conversão"].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados === null ? <tr><td className="px-3 py-3" colSpan={8} style={{ color: "var(--ink3)" }}>Carregando…</td></tr>
              : dados.length === 0 ? <tr><td className="px-3 py-3" colSpan={8} style={{ color: "var(--ink3)" }}>Nenhuma oportunidade no período.</td></tr>
              : dados.map((x) => (
                <tr key={x.dono_id ?? "sem"} style={{ borderTop: "1px solid var(--line2)", color: "var(--ink)" }}>
                  <td className="px-3 py-2 font-semibold">{x.dono_nome}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.criadas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.abertas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{reais(x.valor_aberto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.ganhas}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{reais(x.valor_ganho)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.perdidas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{conv(x.ganhas, x.perdidas)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
      {motivos.size > 0 && (
        <section className="rel-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink2)" }}>Por que perdemos (últimos 30 dias)</p>
          <div className="flex flex-wrap gap-1.5">
            {[...motivos].sort((a, b) => b[1] - a[1]).map(([m, n]) => <Etiqueta key={m}>{m}: {n}</Etiqueta>)}
          </div>
        </section>
      )}
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        Sem metas por enquanto: estes números são a base dos KPIs e das metas que vão ser definidas depois.
        Conversão = ganhas ÷ (ganhas + perdidas) decididas no período.
      </p>
    </div>
  );
}

// ── Origens automáticas ─────────────────────────────────────────────────────
function Origens({ podeMudar, eu, onGerou }: { podeMudar: boolean; eu: string; onGerou: () => void }) {
  const [cfg, setCfg] = useState<RotinasConfig | null>(null);
  const [previa, setPrevia] = useState<Record<string, number> | null>(null);
  const [hunters, setHunters] = useState<{ id: string; nome: string }[]>([]);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    lerConfig().then(setCfg).catch((e) => setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }));
    listarHunters().then(setHunters).catch(() => setHunters([]));
  }, []);

  async function salvar(c: RotinasConfig) {
    setCfg(c); setMsg(null); setPrevia(null);
    try { await salvarConfig(c, eu); } catch (e) { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não salvou." }); }
  }
  async function rodar(simular: boolean) {
    setOcupado(true); setMsg(null);
    try {
      const r = await gerarOportunidades(simular);
      if (simular) setPrevia(r as unknown as Record<string, number>);
      else { setMsg({ tom: "ok", t: `Criadas: ${r.volta_viagem} (voltou de viagem), ${r.sem_seguro} (sem seguro), ${r.aniversario} (aniversário).` }); onGerou(); }
    } catch (e) { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); }
    finally { setOcupado(false); }
  }

  if (!cfg) return msg ? <Aviso tom="erro">{msg.t}</Aviso> : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
        Cartões que nascem sozinhos, uma vez por hora, pras origens ligadas. Ninguém ganha cartão repetido nem dois cartões abertos
        ao mesmo tempo. Tudo nasce desligado.
      </p>
      {ORIGENS_AUTO.map((o) => {
        const c = cfg.origens[o.id];
        return (
          <div key={o.id} className="rel-card p-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" disabled={!podeMudar} checked={c.ligado}
                onChange={() => void salvar({ ...cfg, origens: { ...cfg.origens, [o.id]: { ...c, ligado: !c.ligado } } })} />
              <Etiqueta tom={c.ligado ? "rel" : "neutro"}>{c.ligado ? "ligada" : "desligada"}</Etiqueta>
            </label>
            <div className="flex-1 min-w-[220px]">
              <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{o.rotulo}</p>
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Cliente que {o.frase(c.dias)}.{previa ? ` Hoje nasceriam: ${previa[o.id] ?? 0}.` : ""}</p>
            </div>
            <Campo rotulo="Dias">
              <Entrada type="number" min={0} max={400} disabled={!podeMudar} value={c.dias} style={{ width: 90 }}
                onChange={(e) => setCfg({ ...cfg, origens: { ...cfg.origens, [o.id]: { ...c, dias: Math.max(0, Math.min(400, Number(e.target.value) || 0)) } } })}
                onBlur={() => void salvar(cfg)} />
            </Campo>
          </div>
        );
      })}
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Teto por origem por dia">
          <Entrada type="number" min={1} max={500} disabled={!podeMudar} value={cfg.limite_por_dia} style={{ width: 110 }}
            onChange={(e) => setCfg({ ...cfg, limite_por_dia: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} onBlur={() => void salvar(cfg)} />
        </Campo>
        {podeMudar && <Botao disabled={ocupado} onClick={() => void rodar(true)}>Prévia de hoje</Botao>}
        {podeMudar && <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(false)}>Gerar agora</Botao>}
      </div>
      {msg && <Aviso tom={msg.tom}>{msg.t}</Aviso>}
      <section className="rel-card p-4">
        <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink2)" }}>Hunters (recebem os cartões no rodízio)</p>
        {hunters.length ? (
          <p className="text-[13px]" style={{ color: "var(--ink)" }}>{hunters.map((h) => h.nome).join(", ")}</p>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Ninguém ainda — os cartões automáticos nascem <b>sem dono</b>. Pra ter hunters: Time → Cargos → crie (ou edite) um cargo do
            Relacionamento com <b>"É hunter: recebe oportunidades de venda"</b> marcado e coloque a pessoa nele.
          </p>
        )}
      </section>
      {!podeMudar && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só a supervisão do Relacionamento muda as origens.</p>}
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────
export default function PipelinePage({ abrirId, onAbrirId, onAbrirCliente, onAbrirViagem, onAbrirProposta }: {
  abrirId: string | null;
  onAbrirId: (id: string | null) => void;
  onAbrirCliente: (id: string) => void;
  onAbrirViagem: (id: string) => void;
  onAbrirProposta: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const supervisao = podeGerirRelacionamento(currentUser);
  const eu = currentUser?.id ?? "";
  const [aba, setAba] = useState<Aba>("quadro");
  const [lista, setLista] = useState<Oportunidade[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [fechar, setFechar] = useState<{ o: Oportunidade; e: "ganho" | "perdido" } | null>(null);

  const carregar = useCallback(() => {
    listarOportunidades(30).then((l) => { setLista(l); setErro(null); })
      .catch((e) => { setLista([]); setErro(e instanceof Error ? e.message : "Não consegui carregar."); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  function mover(o: Oportunidade, e: Etapa) {
    if (e === "ganho" || e === "perdido") { setFechar({ o, e }); return; }
    // otimista: o cartão já muda de coluna; se o banco recusar, recarrega
    setLista((l) => (l ?? []).map((x) => (x.id === o.id ? { ...x, etapa: e } : x)));
    mudarOportunidade(o.id, { etapa: e }).catch((err) => { setErro(err instanceof Error ? err.message : "Não moveu."); carregar(); });
  }

  const abertas = (lista ?? []).filter((o) => o.etapa !== "ganho" && o.etapa !== "perdido");
  const fechadas = (lista ?? []).filter((o) => o.etapa === "ganho" || o.etapa === "perdido");

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Pipeline de vendas</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Vender pra quem já viaja com a gente. {lista && `${abertas.length} aberta(s) · ${reais(abertas.reduce((s, o) => s + (Number(o.valor_estimado) || 0), 0))} em jogo`}
          </p>
        </div>
        <Botao variante="primario" onClick={() => setNova(true)}>+ Nova oportunidade</Botao>
      </div>
      <Segmented label="Pipeline" value={aba} onChange={(v) => setAba(v as Aba)}
        options={[{ value: "quadro", label: "Quadro" }, { value: "numeros", label: "Números" }, { value: "origens", label: "Origens automáticas" }]} />
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {aba === "quadro" && (lista === null
        ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : lista.length === 0
          ? <div className="rel-card"><Vazio titulo="Nenhuma oportunidade ainda" texto="Crie a primeira, use a lista de Recompra ou ligue as origens automáticas." acao={<Botao variante="primario" onClick={() => setNova(true)}>Criar</Botao>} /></div>
          : <Quadro lista={lista} eu={eu} onAbrir={(id) => onAbrirId(id)} onMover={mover} />)}
      {aba === "numeros" && <Numeros fechadas={fechadas} />}
      {aba === "origens" && <Origens podeMudar={supervisao} eu={eu} onGerou={carregar} />}

      <NovaOportunidade aberto={nova} onFechar={() => setNova(false)} onCriada={(o) => { setNova(false); carregar(); onAbrirId(o.id); }} />
      <OportunidadeModal id={abrirId} onFechar={() => onAbrirId(null)} onMudou={carregar}
        onAbrirCliente={onAbrirCliente} onAbrirViagem={onAbrirViagem} onAbrirProposta={onAbrirProposta} />
      <Fechamento op={fechar?.o ?? null} etapa={fechar?.e ?? null} onFechar={() => setFechar(null)}
        onFeito={() => { setFechar(null); carregar(); }} />
    </div>
  );
}
