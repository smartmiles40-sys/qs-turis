// src/rel/viagens/ServicosViagens.tsx
// -----------------------------------------------------------------------------
// Aba SERVIÇOS das Viagens (Bruno, 11/11: "hoje está muito confuso tudo junto:
// hotel, pacote, aéreo, seguro… dificulta a visualização e os filtros").
//
// Cada serviço vira as AÇÕES do cliente com data e hora — check-in do hotel,
// check-out, passeio começa, transfer, trem, voo parte, check-in online abre —
// separadas por TIPO (Aéreo · Hotel · Passeio · Transfer · Trem · Seguro ·
// Outros) e filtráveis por:
//   • DATA DA AÇÃO (o que acontece de hoje a X dias / num intervalo), ou
//   • DATA DE EMBARQUE (as viagens que embarcam no intervalo, com tudo delas).
// Venda de hotel/passeio/seguro sem voucher cadastrado entra pelas datas da
// venda ("sem horário"). Regra em src/rel/lib/agendaServicos.ts (com teste).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { carregarAcoesDoPeriodo, carregarAcoesPorEmbarque } from "../lib/agendaDados";
import { CATEGORIAS_ACAO, ROTULO_EVENTO, contarPorCategoria, montarAcoes, type Acao, type CategoriaAcao, type TrechoAgenda, type ViagemAgenda } from "../lib/agendaServicos";
import { hojeSP, horaDoLugar, type Servico } from "../lib/viagens";
import { TIPOS_FILTRO, tipoDoServico, type TipoFiltro } from "../lib/tiposViagem";
import { Aviso, Entrada, Etiqueta, Vazio } from "../ui";

type Modo = "acao" | "embarque";
const PRESETS: { id: string; rotulo: string; dias: number }[] = [
  { id: "hoje", rotulo: "Hoje", dias: 1 },
  { id: "3d", rotulo: "3 dias", dias: 3 },
  { id: "7d", rotulo: "7 dias", dias: 7 },
  { id: "30d", rotulo: "30 dias", dias: 30 },
];
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** 00:00 de São Paulo do dia, em ISO. */
const inicioDoDia = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString();
/** "dd/mm" do lugar (o dia local pode não ser o de Brasília). */
const diaDaAcao = (a: Acao) => horaDoLugar(a.quando, a.fuso).texto.slice(0, 5);
const chaveDia = (a: Acao) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(a.quando));

const COR_CAT: Record<CategoriaAcao, string> = {
  aereo: "#2563EB", hotel: "#7C3AED", passeio: "#0E7C6A", transfer: "#B45309", trem: "#475569", seguro: "#DB2777", outro: "var(--line)",
};

export default function ServicosViagens({ onAbrirViagem, onAbrirCliente }: { onAbrirViagem: (id: string) => void; onAbrirCliente: (id: string) => void }) {
  const hoje = hojeSP();
  const [modo, setModo] = useState<Modo>("acao");
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(somaDias(hoje, 6));
  const [cats, setCats] = useState<Set<CategoriaAcao>>(new Set());
  const [tipo, setTipo] = useState<TipoFiltro>("todos");
  const [busca, setBusca] = useState("");
  const [dados, setDados] = useState<{ trechos: TrechoAgenda[]; viagens: Map<string, ViagemAgenda>; cortado?: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!de || !ate || ate < de) return;
    let vivo = true;
    setDados(null);
    const p = modo === "acao" ? carregarAcoesDoPeriodo(inicioDoDia(de), inicioDoDia(somaDias(ate, 1))) : carregarAcoesPorEmbarque(de, ate);
    p.then((d) => { if (vivo) { setDados(d); setErro(null); } })
      .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou."); setDados({ trechos: [], viagens: new Map() }); } });
    return () => { vivo = false; };
  }, [modo, de, ate]);

  // todas as ações do recorte (sem o filtro de categoria — é ele que dá os números das abas)
  const todas = useMemo(() => {
    if (!dados) return null;
    const f = modo === "acao"
      ? { de: new Date(inicioDoDia(de)).getTime(), ate: new Date(inicioDoDia(somaDias(ate, 1))).getTime() }
      : { embarqueDe: de, embarqueAte: ate };
    const q = busca.trim().toLowerCase();
    return montarAcoes(dados.trechos, dados.viagens, f).filter((a) => {
      const v = dados.viagens.get(a.viagem_id);
      if (tipo !== "todos" && tipoDoServico((v?.servico ?? null) as Servico | null) !== tipo) return false;
      return !q || [v?.cliente_nome, v?.titulo, a.titulo, a.detalhe].some((x) => (x || "").toLowerCase().includes(q));
    });
  }, [dados, modo, de, ate, tipo, busca]);
  const contagem = useMemo(() => (todas ? contarPorCategoria(todas) : null), [todas]);
  const lista = useMemo(() => (todas ? todas.filter((a) => !cats.size || cats.has(a.categoria)) : null), [todas, cats]);
  const dias = useMemo(() => {
    const m = new Map<string, Acao[]>();
    for (const a of lista ?? []) { const k = chaveDia(a); const l = m.get(k); if (l) l.push(a); else m.set(k, [a]); }
    return [...m.entries()];
  }, [lista]);

  const alternarCat = (c: CategoriaAcao) => setCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const preset = (dias: number) => { setDe(hoje); setAte(somaDias(hoje, dias - 1)); };

  return (
    <div className="max-w-5xl mx-auto">
      <p className="text-[13px] mb-3" style={{ color: "var(--ink3)" }}>
        Cada serviço separado por tipo, com o que o cliente faz e quando: check-in e check-out do hotel, passeio, transfer, trem, voo.
        A hora é a <b>do lugar</b> quando o voucher traz o fuso; senão, a de Brasília.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 rel-card p-1" role="group" aria-label="Filtrar pela data">
          {([["acao", "Data da ação"], ["embarque", "Data de embarque"]] as [Modo, string][]).map(([id, r]) => (
            <button key={id} onClick={() => setModo(id)} aria-pressed={modo === id} className="rel-linha px-3 py-2 rounded-lg text-[12.5px] font-semibold whitespace-nowrap"
              style={modo === id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>{r}</button>
          ))}
        </div>
        <div className="flex gap-1 rel-card p-1 overflow-x-auto" role="group" aria-label="Período rápido">
          {PRESETS.map((p) => {
            const ativo = de === hoje && ate === somaDias(hoje, p.dias - 1);
            return (
              <button key={p.id} onClick={() => preset(p.dias)} aria-pressed={ativo} className="rel-linha px-3 py-2 rounded-lg text-[12.5px] font-semibold whitespace-nowrap"
                style={ativo ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>{p.rotulo}</button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
          de <input type="date" className="rel-input" style={{ width: 150 }} value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" />
        </label>
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
          até <input type="date" className="rel-input" style={{ width: 150 }} value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" />
        </label>
      </div>

      {/* o tipo do SERVIÇO (abas) — pode marcar mais de um */}
      <div className="flex gap-1 rel-card p-1 overflow-x-auto mb-2 w-fit max-w-full" role="group" aria-label="Tipo de serviço">
        <button onClick={() => setCats(new Set())} aria-pressed={!cats.size} className="rel-linha px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
          style={!cats.size ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
          Todos{todas && <span className="ml-1 tabular-nums font-normal" style={{ color: "var(--ink3)" }}>{todas.length}</span>}
        </button>
        {CATEGORIAS_ACAO.map((c) => (
          <button key={c.id} onClick={() => alternarCat(c.id)} aria-pressed={cats.has(c.id)} className="rel-linha px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
            style={cats.has(c.id) ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
            <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: COR_CAT[c.id] }} aria-hidden />
            {c.rotulo}{contagem && <span className="ml-1 tabular-nums font-normal" style={{ color: "var(--ink3)" }}>{contagem[c.id]}</span>}
          </button>
        ))}
      </div>
      {/* o tipo da VENDA (o mesmo da Lista) */}
      <div className="flex gap-1 rel-card p-1 overflow-x-auto mb-3 w-fit max-w-full" role="group" aria-label="Tipo de venda">
        {TIPOS_FILTRO.map((t) => (
          <button key={t.id} onClick={() => setTipo(t.id)} aria-pressed={tipo === t.id} title={t.dica}
            className="rel-linha px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
            style={tipo === t.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
            {t.rotulo}
          </button>
        ))}
      </div>
      <div className="mb-4">
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar serviços" placeholder="Buscar por cliente, viagem, hotel, passeio ou voo" />
      </div>

      {ate < de && <div className="mb-3"><Aviso tom="erro">O "até" está antes do "de".</Aviso></div>}
      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      {dados?.cortado && <div className="mb-3"><Aviso tom="aviso">Mais de 1000 viagens embarcam nesse intervalo — mostrando as 1000 primeiras. Encurte o período.</Aviso></div>}

      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhum serviço nesse recorte" texto="Troque o tipo, o período ou a busca." /></div>
      ) : (
        <div className="space-y-4">
          {dias.map(([d, as]) => (
            <section key={d}>
              <h2 className="text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>
                {d === hoje ? "Hoje" : new Date(`${d}T12:00:00-03:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
                {" "}<span className="tabular-nums" style={{ color: "var(--ink3)" }}>{as.length}</span>
              </h2>
              <ul className="rel-card overflow-hidden">
                {as.map((a, i) => {
                  const v = dados?.viagens.get(a.viagem_id);
                  const hora = a.semHora ? "sem horário" : (/\d{2}:\d{2}$/.exec(horaDoLugar(a.quando, a.fuso).texto)?.[0] ?? "");
                  return (
                    <li key={a.chave} className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: i ? "1px solid var(--line2)" : undefined, borderLeft: `4px solid ${COR_CAT[a.categoria]}` }}>
                      <span className="w-[86px] flex-shrink-0 leading-tight">
                        <span className="block text-[14px] font-bold tabular-nums" style={{ color: a.semHora ? "var(--ink3)" : "var(--ink)" }}>{hora}</span>
                        <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{a.fuso ? `${diaDaAcao(a)} local` : a.estimado ? "estimado" : ""}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                          {ROTULO_EVENTO[a.evento]} <span className="font-normal" style={{ color: "var(--ink2)" }}>· {a.titulo}</span>
                        </p>
                        <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                          {v?.cliente_id && v.cliente_nome
                            ? <button className="underline" onClick={() => onAbrirCliente(v.cliente_id!)}>{v.cliente_nome}</button>
                            : (v?.cliente_nome || "sem cliente")}
                          {" · "}<button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirViagem(a.viagem_id)}>{v?.titulo ?? "viagem"}</button>
                          {a.detalhe ? ` · ${a.detalhe}` : ""}
                        </p>
                      </div>
                      <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                        {a.daVenda && <Etiqueta tom="aviso">sem voucher</Etiqueta>}
                        {a.evento === "checkin_online" && <Etiqueta tom={a.feito ? "rel" : "neutro"}>{a.feito ? "feito" : "a fazer"}</Etiqueta>}
                        <Etiqueta>{CATEGORIAS_ACAO.find((c) => c.id === a.categoria)?.rotulo}</Etiqueta>
                      </span>
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
