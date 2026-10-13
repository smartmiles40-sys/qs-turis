// src/rel/clientes/ClientesPage.tsx
// Lista de clientes com busca por nome, CPF, telefone, e-mail ou passaporte.
// No topo, os 4 KPIs da carteira (categoria, LTV, contato, cadastro) — clicar
// num deles filtra a lista.
//
// Expedições × Pacotes (Bruno, 13/10/2026: "às vezes temos que ver quantas
// expedições ou pacotes o cliente fez"): cada linha mostra os números dele,
// a lista ordena por eles e tem filtros rápidos (2+ expedições, só pacote,
// expedição e pacote, nunca viajou).
import { useEffect, useMemo, useState } from "react";
import {
  CAMPOS_CADASTRO, METAS_PADRAO, REGRAS_PADRAO, buscarClientes, moeda, carregarMetricas, carregarRegras, formatarCpf,
  formatarTelefone, mesesParaVencer, type Cliente, type Metrica, type MetasContato, type RegrasCategorias,
} from "../lib/clientes";
import KpisClientes, { categoriasDe, diasParado, foraDaMeta, type FiltroKpi } from "./KpisClientes";
import CategoriaChip from "./CategoriaChip";
import { Aviso, Avatar, Botao, Entrada, Etiqueta, Vazio } from "../ui";
import ClienteForm from "./ClienteForm";

type Rapido = "exp2" | "so_pacote" | "exp_e_pacote" | "so_avulsa";
const RAPIDOS: { id: Rapido; rotulo: string; teste: (m: Metrica) => boolean }[] = [
  { id: "exp2", rotulo: "2+ expedições", teste: (m) => m.expedicoes >= 2 },
  { id: "so_pacote", rotulo: "Só pacote", teste: (m) => m.pacotes > 0 && m.expedicoes === 0 },
  { id: "exp_e_pacote", rotulo: "Expedição e pacote", teste: (m) => m.expedicoes > 0 && m.pacotes > 0 },
  { id: "so_avulsa", rotulo: "Nunca viajou (só avulsas)", teste: (m) => m.viagens_compradas === 0 && (m.compras_avulsas ?? 0) > 0 },
];
type Ordem = "nome" | "expedicoes" | "pacotes" | "ltv" | "avulsas";
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "nome", rotulo: "Nome" }, { id: "expedicoes", rotulo: "Mais expedições" }, { id: "pacotes", rotulo: "Mais pacotes" },
  { id: "ltv", rotulo: "Maior LTV" }, { id: "avulsas", rotulo: "Mais compras avulsas" },
];

/** "3 (2 feitas)" — realizadas só aparecem se a 0120 já estiver no banco. */
function contagem(total: number, feitas: number | undefined) {
  return feitas == null || feitas === total ? String(total) : `${total} (${feitas} feita${feitas === 1 ? "" : "s"})`;
}

function NumerosViagem({ m }: { m: Metrica }) {
  const chip = (rotulo: string, valor: string, forma: "circulo" | "losango" | "quadrado", ativo: boolean) => (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] tabular-nums whitespace-nowrap"
      style={{ background: ativo ? "var(--rel-soft)" : "var(--card2)", color: ativo ? "var(--rel-ink)" : "var(--ink3)" }} title={rotulo}>
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        {forma === "circulo" ? <circle cx="5" cy="5" r="4" fill="currentColor" />
          : forma === "losango" ? <rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill="currentColor" />
            : <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      </svg>
      <span className="sr-only">{rotulo}: </span>{valor}
    </span>
  );
  return (
    <span className="flex items-center gap-1 flex-wrap justify-end">
      {chip("Expedições", contagem(m.expedicoes, m.expedicoes_realizadas), "circulo", m.expedicoes > 0)}
      {chip("Pacotes", contagem(m.pacotes, m.pacotes_realizados), "losango", m.pacotes > 0)}
      {(m.compras_avulsas ?? 0) > 0 && chip("Compras avulsas", String(m.compras_avulsas), "quadrado", false)}
      <span className="text-[11px] tabular-nums px-1" style={{ color: "var(--ink2)" }} title="LTV (valor gasto como titular)">{moeda(m.valor_total)}</span>
    </span>
  );
}

export default function ClientesPage({ onAbrir }: { onAbrir: (id: string) => void }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [metricas, setMetricas] = useState<Metrica[]>([]);
  const [regras, setRegras] = useState<RegrasCategorias>(REGRAS_PADRAO);
  const [metas, setMetas] = useState<MetasContato>(METAS_PADRAO);
  const [filtro, setFiltro] = useState<FiltroKpi | null>(null);
  const [rapido, setRapido] = useState<Rapido | null>(null);
  const [ordem, setOrdem] = useState<Ordem>("nome");
  const [erroKpi, setErroKpi] = useState<string | null>(null);

  useEffect(() => {
    // Erro aqui aparece na tela: KPI sumido calado parecia "sem dados".
    carregarMetricas().then(setMetricas).catch((e) => { setMetricas([]); setErroKpi(e instanceof Error ? e.message : "erro desconhecido"); });
    carregarRegras().then((r) => { setRegras(r.regras); setMetas(r.metas); })
      .catch((e) => setErroKpi((x) => x ?? (e instanceof Error ? e.message : "erro desconhecido")));
  }, []);

  const cats = useMemo(() => categoriasDe(regras), [regras]);
  const porId = useMemo(() => new Map(metricas.map((m) => [m.id, m])), [metricas]);

  // Lista filtrada pelos KPIs (vem das métricas, não da busca no banco)
  // Modo "lista das métricas": filtro dos KPIs, filtro rápido ou ordenação por número.
  const modoMetricas = Boolean(filtro || rapido || ordem !== "nome");
  const filtrados = useMemo(() => {
    if (!modoMetricas) return [];
    const t = termo.trim().toLowerCase();
    let l = metricas.filter((m) => !filtro ? true
      : filtro.tipo === "categoria" ? m.categoria === filtro.categoria
        : filtro.tipo === "sem_contato" ? foraDaMeta(m)
          : m.viagens_compradas > 0 && (filtro.campo ? m.faltando.includes(filtro.campo) : !m.cadastro_completo));
    const r = RAPIDOS.find((x) => x.id === rapido);
    if (r) l = l.filter(r.teste);
    if (t) l = l.filter((m) => m.nome.toLowerCase().includes(t));
    const porNome = (a: Metrica, b: Metrica) => a.nome.localeCompare(b.nome);
    if (ordem === "expedicoes") return l.sort((a, b) => b.expedicoes - a.expedicoes || b.valor_total - a.valor_total);
    if (ordem === "pacotes") return l.sort((a, b) => b.pacotes - a.pacotes || b.valor_total - a.valor_total);
    if (ordem === "ltv") return l.sort((a, b) => b.valor_total - a.valor_total);
    if (ordem === "avulsas") return l.sort((a, b) => (b.compras_avulsas ?? 0) - (a.compras_avulsas ?? 0) || porNome(a, b));
    if (filtro?.tipo === "sem_contato") return l.sort((a, b) => diasParado(b) / b.meta_contato_dias - diasParado(a) / a.meta_contato_dias);
    if (filtro?.tipo === "incompletos") return l.sort((a, b) => b.faltando.length - a.faltando.length || porNome(a, b));
    if (filtro) return l.sort((a, b) => b.valor_total - a.valor_total);
    return l.sort(porNome);
  }, [modoMetricas, filtro, rapido, ordem, metricas, termo]);

  const rotuloRapido = RAPIDOS.find((x) => x.id === rapido)?.rotulo;
  const rotuloKpi = !filtro ? "" : filtro.tipo === "categoria" ? `Categoria: ${cats.find((c) => c.id === filtro.categoria)?.nome}`
    : filtro.tipo === "sem_contato" ? "Fora da meta de contato"
      : filtro.campo ? `Falta ${CAMPOS_CADASTRO[filtro.campo] ?? filtro.campo}` : "Cadastro incompleto";
  const rotuloFiltro = [rotuloKpi, rotuloRapido, ordem !== "nome" ? ORDENS.find((o) => o.id === ordem)?.rotulo : ""].filter(Boolean).join(" · ");

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const r = await buscarClientes(termo);
        if (vivo) { setLista(r); setErro(null); }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Não consegui carregar os clientes.");
      } finally {
        if (vivo) setCarregando(false);
      }
    }, termo ? 300 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Clientes</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Uma ficha por pessoa — documentos, contato e família.</p>
        </div>
        <Botao variante="primario" onClick={() => setNovo(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Novo cliente
        </Botao>
      </div>

      {erroKpi && <div className="mb-4"><Aviso tom="erro">Os indicadores da carteira não carregaram ({erroKpi}). A lista abaixo continua funcionando.</Aviso></div>}
      {metricas.length > 0 && <KpisClientes metricas={metricas} regras={regras} metas={metas} filtro={filtro} onFiltro={setFiltro} />}

      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <Entrada
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar por nome, CPF, telefone, e-mail ou passaporte"
          style={{ paddingLeft: 36 }}
          aria-label="Buscar clientes"
        />
      </div>

      {metricas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {RAPIDOS.map((r) => (
            <button key={r.id} onClick={() => setRapido(rapido === r.id ? null : r.id)} aria-pressed={rapido === r.id}
              className="px-2.5 py-1.5 rounded-full text-[12px] font-semibold border"
              style={rapido === r.id ? { background: "var(--rel)", color: "#fff", borderColor: "var(--rel)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
              {r.rotulo} <span className="tabular-nums opacity-80">{metricas.filter(r.teste).length}</span>
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
            Ordenar
            <select className="rel-input" style={{ padding: "6px 8px", fontSize: 12.5, width: "auto" }} value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
              {ORDENS.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
            </select>
          </label>
        </div>
      )}

      {modoMetricas && (
        <div className="flex items-center gap-2 mb-2" aria-live="polite">
          <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{rotuloFiltro} · {filtrados.length}</span>
          <button onClick={() => { setFiltro(null); setRapido(null); setOrdem("nome"); }} className="text-[12px] font-semibold underline px-1 py-1" style={{ color: "var(--rel-ink)" }}>limpar filtros</button>
        </div>
      )}

      {modoMetricas ? (
        <div className="rel-card overflow-hidden">
          {filtrados.length === 0 ? (
            <Vazio titulo="Ninguém aqui" texto="Nenhum cliente bate com esse filtro." />
          ) : (
            <ul>
              {filtrados.slice(0, 300).map((m, i) => (
                <li key={m.id} style={{ borderTop: i ? "1px solid var(--line2)" : undefined }}>
                  <button onClick={() => onAbrir(m.id)} className="rel-linha w-full flex items-center gap-3 px-4 py-3 text-left transition-colors">
                    <Avatar nome={m.nome} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{m.nome}</span>
                      <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                        {filtro?.tipo === "incompletos"
                          ? `Falta: ${m.faltando.map((x) => CAMPOS_CADASTRO[x] ?? x).join(", ")}`
                          : filtro?.tipo === "sem_contato"
                            ? `${m.dias_sem_contato == null ? "Nunca teve contato" : `${m.dias_sem_contato} dias sem contato`} · meta ${m.meta_contato_dias} dias`
                            : `${m.viagens_compradas} viage${m.viagens_compradas === 1 ? "m" : "ns"} · ${m.valor_total.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}`}
                      </span>
                    </span>
                    <span className="hidden sm:flex"><NumerosViagem m={m} /></span>
                    <CategoriaChip categoria={m.categoria} cats={cats} />
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {filtrados.length > 300 && <p className="px-4 py-2 text-[12px]" style={{ color: "var(--ink3)" }}>Mostrando 300 de {filtrados.length}.</p>}
        </div>
      ) : (
      <div className="rel-card overflow-hidden">
        {erro ? (
          <div className="p-4"><Aviso tom="erro">{erro}</Aviso></div>
        ) : carregando && lista.length === 0 ? (
          <ul aria-busy="true" aria-label="Carregando os clientes">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i ? "1px solid var(--line2)" : undefined }}>
                <span className="w-9 h-9 rounded-full animate-pulse" style={{ background: "var(--card2)" }} />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-3 w-1/3 rounded animate-pulse" style={{ background: "var(--card2)" }} />
                  <span className="block h-3 w-1/2 rounded animate-pulse" style={{ background: "var(--card2)" }} />
                </span>
              </li>
            ))}
          </ul>
        ) : lista.length === 0 ? (
          termo ? (
            <Vazio titulo="Ninguém encontrado" texto={`Nenhuma ficha bate com "${termo}".`} acao={<Botao variante="primario" onClick={() => setNovo(true)}>Criar ficha</Botao>} />
          ) : (
            <Vazio
              titulo="Nenhum cliente ainda"
              texto="Cadastre o primeiro cliente. Cada pessoa tem UMA ficha — o sistema avisa se você tentar criar alguém que já existe."
              acao={<Botao variante="primario" onClick={() => setNovo(true)}>Novo cliente</Botao>}
            />
          )
        ) : (
          <ul>
            {lista.map((c, i) => {
              const meses = mesesParaVencer(c.passaporte_validade);
              return (
                <li key={c.id} style={{ borderTop: i ? "1px solid var(--line2)" : undefined }}>
                  <button onClick={() => onAbrir(c.id)} className="rel-linha w-full flex items-center gap-3 px-4 py-3 text-left transition-colors">
                    <Avatar nome={c.nome} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{c.nome}</span>
                      <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                        {[c.cpf && formatarCpf(c.cpf), c.telefone && formatarTelefone(c.telefone), c.email].filter(Boolean).join(" · ") || "Sem documento nem contato"}
                      </span>
                    </span>
                    <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                      {porId.get(c.id) && <NumerosViagem m={porId.get(c.id)!} />}
                      {porId.get(c.id) && <CategoriaChip categoria={porId.get(c.id)!.categoria} cats={cats} />}
                      {c.titular_id && <Etiqueta tom="rel">Família</Etiqueta>}
                      {meses !== null && meses < 0 && <Etiqueta tom="erro">Passaporte vencido</Etiqueta>}
                      {meses !== null && meses >= 0 && meses < 6 && <Etiqueta tom="aviso">Passaporte vence em {meses || "<1"} mês{meses > 1 ? "es" : ""}</Etiqueta>}
                      {!c.lgpd_consentimento_em && <Etiqueta>Sem LGPD</Etiqueta>}
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}
      {!modoMetricas && lista.length >= 100 && (
        <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Mostrando os 100 primeiros em ordem alfabética — use a busca para achar alguém.</p>
      )}

      <ClienteForm
        aberto={novo}
        onFechar={() => setNovo(false)}
        onSalvo={(c) => { setNovo(false); onAbrir(c.id); }}
        onAbrirFicha={(id) => { setNovo(false); onAbrir(id); }}
      />
    </div>
  );
}
