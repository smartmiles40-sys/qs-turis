// src/gestao/GestaoApp.tsx
// -----------------------------------------------------------------------------
// PAINEL DE GESTÃO — todos os setores numa tela (Bruno, 27/10/2026: "temos que
// fazer um painel de gestão para todos os setores").
//
// Só admin e gestor (./acesso). Abre pelo seletor de setor, no endereço #gestao,
// e usa a mesma sidebar dos setores (AppShell). Três partes:
//   1. "Precisa de atenção hoje": alertas que se calculam sozinhos, cada um com
//      o botão que leva à tela onde se resolve;
//   2. um bloco por setor com os números do período (hoje, 7 dias, mês);
//   3. quem fez o quê no SDR e no Closer.
// Cada setor só aparece pra quem enxerga aquele setor (o banco esconderia as
// linhas e o painel mostraria zero de mentira). Os números saem de ./dados.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import AppShell from "@/components/ui/AppShell";
import { Button, DataTable, KpiCard, ListRow, Page, PageHeader, Segmented, type Column } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import SinoDeAvisos from "@/avisos/SinoDeAvisos";
import { comercialDividido } from "@/area/CascaDeArea";
import type { Setor } from "@/components/sdr/types";
import { sairDaGestao } from "./acesso";
import FonteSdrGestao from "@/controle-comercial/FonteSdrGestao";
import {
  ALERTAS, NOME_SETOR_GESTAO, PERIODOS, brl, carregarCloser, carregarFin, carregarOps, carregarRel, carregarSdr,
  type Alerta, type BlocoCloser, type BlocoSdr, type LinhaCloser, type LinhaSdr, type Numero, type Periodo, type SetorGestao,
} from "./dados";

const SETOR_DO_BLOCO: Record<SetorGestao, Setor> = {
  sdr: "comercial", closer: "comercial", rel: "relacionamento", fin: "financeiro", ops: "operacional",
};
const COR_DO_BLOCO: Record<SetorGestao, string> = {
  sdr: "var(--sector-comercial)", closer: "var(--sector-comercial)", rel: "var(--sector-relacionamento)",
  fin: "var(--sector-financeiro)", ops: "var(--sector-operacoes)",
};

// ── Carga com estado (dados | erro | carregando) ─────────────────────────────
interface Carga<T> { dado: T | null; erro: string | null }
function useCarga<T>(fn: (() => Promise<T>) | null, chave: string): Carga<T> {
  const [c, setC] = useState<Carga<T>>({ dado: null, erro: null });
  useEffect(() => {
    if (!fn) return;
    let vivo = true;
    setC({ dado: null, erro: null });
    fn().then((d) => { if (vivo) setC({ dado: d, erro: null }); })
      .catch((e: unknown) => { if (vivo) setC({ dado: null, erro: e instanceof Error ? e.message : "não carregou" }); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return c;
}

const irPara = (hash: string) => { window.location.hash = hash; };

export default function GestaoApp() {
  const { currentUser, area } = useQsAuth();
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [rodada, setRodada] = useState(0);
  const [hora, setHora] = useState(() => new Date());
  // Chave em texto: setoresDe devolve um array novo a cada render e o efeito dos
  // alertas rodaria sem parar.
  const chaveSetores = setoresDe(currentUser).join(",");
  const setores = useMemo(() => chaveSetores.split(",").filter(Boolean) as Setor[], [chaveSetores]);
  const ve = useCallback((s: SetorGestao) => setores.includes(SETOR_DO_BLOCO[s]), [setores]);
  const atualizar = () => { setRodada((r) => r + 1); setHora(new Date()); };

  if (!currentUser) return null;
  const chave = `${periodo}:${rodada}`;
  return (
    <AppShell setor={area} naGestao groups={[{ items: [{ id: "inicio", label: "Painel de gestão", icon: Icon.grafico }] }]}
      active="inicio" onNavigate={() => window.scrollTo(0, 0)} notifications={<SinoDeAvisos />}
      comercial={comercialDividido(currentUser, "sdr")} onBeforeSwitch={sairDaGestao}>
      <Page wide>
        <PageHeader title="Gestão" crumb="Todos os setores"
          subtitle={`O que precisa de atenção hoje, em todos os setores. Metas e TV continuam no Dashboard. Atualizado às ${hora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`}
          actions={<>
            <Segmented label="Período" options={PERIODOS.map((p) => ({ value: p.id, label: p.rotulo }))} value={periodo} onChange={setPeriodo} />
            <Button onClick={atualizar}>Atualizar</Button>
          </>} />

        <Atencao rodada={rodada} ve={ve} />

        {ve("sdr") && <SecaoSdr periodo={periodo} chave={chave} />}
        {ve("sdr") && <FonteSdrGestao periodo={periodo} chave={chave} />}
        {ve("closer") && <SecaoCloser periodo={periodo} chave={chave} />}
        {ve("rel") && <SecaoRel chave={chave} />}
        {ve("fin") && <SecaoFin periodo={periodo} chave={chave} />}
        {ve("ops") && <SecaoOps chave={chave} />}
        {setores.length < 4 && (
          <p className="qs-label">Aparecem só os setores que você acompanha. Para ver os outros, peça ao administrador.</p>
        )}
      </Page>
    </AppShell>
  );
}

// ── Precisa de atenção hoje ──────────────────────────────────────────────────
type EstadoAlerta = Alerta | { id: string; setor: SetorGestao; carregando: true };

function Atencao({ rodada, ve }: { rodada: number; ve: (s: SetorGestao) => boolean }) {
  const lista = useMemo(() => ALERTAS.filter((a) => ve(a.setor)), [ve]);
  const [estado, setEstado] = useState<EstadoAlerta[]>([]);
  useEffect(() => {
    let vivo = true;
    setEstado(lista.map((a, i) => ({ id: `c${i}`, setor: a.setor, carregando: true as const })));
    lista.forEach((a, i) => {
      a.carregar()
        .catch((e: unknown): Alerta => ({ id: `e${i}`, setor: a.setor, titulo: "Um dos alertas não carregou", n: null, tom: "warn", erro: e instanceof Error ? e.message : "erro" }))
        .then((r) => { if (vivo) setEstado((s) => s.map((x, j) => (j === i ? r : x))); });
    });
    return () => { vivo = false; };
  }, [lista, rodada]);

  const prontos = estado.filter((x): x is Alerta => !("carregando" in x));
  const carregando = estado.length - prontos.length;
  const acesos = prontos.filter((a) => (a.n ?? 0) > 0)
    .sort((a, b) => (a.tom === b.tom ? 0 : a.tom === "danger" ? -1 : 1));
  const problemas = prontos.filter((a) => a.erro || a.semDados);
  const emDia = prontos.filter((a) => a.n === 0);

  return (
    <section aria-labelledby="g-atencao" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 id="g-atencao" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Precisa de atenção hoje</h2>
      <div className="qs-card" style={{ overflow: "hidden" }}>
        {acesos.map((a) => (
          <ListRow key={a.id} tone={a.tom}
            title={<><span className={`qs-num qs-tone-${a.tom}`} style={{ marginRight: 8 }}>{a.n?.toLocaleString("pt-BR")}</span>{a.titulo}</>}
            meta={<><SetorTag s={a.setor} />{a.detalhe ? ` · ${a.detalhe}` : ""}</>}
            action={a.link ? <Button size="sm" onClick={() => irPara(a.link!)}>{a.linkRotulo ?? "Abrir"}</Button> : undefined} />
        ))}
        {problemas.map((a) => (
          <ListRow key={a.id} tone="text" title={a.titulo}
            meta={<><SetorTag s={a.setor} /> · {a.semDados ? `sem dados ainda: ${a.semDados}` : `não carregou (${a.erro})`}</>} />
        ))}
        {Array.from({ length: carregando }).map((_, i) => (
          <div key={`sk${i}`} className="qs-row" aria-hidden><div className="animate-pulse rounded" style={{ height: 32, flex: 1, background: "var(--surface-2)" }} /></div>
        ))}
        {!carregando && !acesos.length && !problemas.length && (
          <ListRow tone="ok" title="Nada pedindo atenção agora" meta="Todos os alertas abaixo estão zerados." />
        )}
      </div>
      {emDia.length > 0 && (
        <p className="qs-label" style={{ margin: 0 }}>
          Em dia: {emDia.map((a) => a.titulo.charAt(0).toLowerCase() + a.titulo.slice(1)).join("; ")}.
        </p>
      )}
      {carregando > 0 && <span className="sr-only" role="status">Carregando alertas</span>}
    </section>
  );
}

function SetorTag({ s }: { s: SetorGestao }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span className="qs-dot" style={{ background: COR_DO_BLOCO[s] }} aria-hidden />{NOME_SETOR_GESTAO[s]}
    </span>
  );
}

// ── Blocos por setor ─────────────────────────────────────────────────────────
function Secao({ setor, nota, children }: { setor: SetorGestao; nota?: string; children: ReactNode }) {
  return (
    <section aria-label={NOME_SETOR_GESTAO[setor]} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="qs-dot" style={{ background: COR_DO_BLOCO[setor], width: 9, height: 9 }} aria-hidden />{NOME_SETOR_GESTAO[setor]}
        </h2>
        {nota && <span className="qs-label">{nota}</span>}
      </div>
      {children}
    </section>
  );
}

function Numeros({ carga, qtd = 4 }: { carga: Carga<Numero[]>; qtd?: number }) {
  if (carga.erro) return <div className="qs-card" style={{ padding: 16 }}><span className="qs-tone-danger">Não carregou: {carga.erro}</span></div>;
  if (!carga.dado) return <Esqueleto qtd={qtd} />;
  return (
    <div className="qs-kpis">
      {carga.dado.map((n) => (
        <KpiCard key={n.rotulo} label={n.rotulo} tone={n.valor == null ? undefined : n.tom}
          value={n.valor ?? <span className="qs-tone-subtle" style={{ fontSize: 16, fontWeight: 500 }}>sem dados ainda</span>}
          hint={n.dica} />
      ))}
    </div>
  );
}

function Esqueleto({ qtd }: { qtd: number }) {
  return (
    <div className="qs-kpis" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: qtd }).map((_, i) => <div key={i} className="qs-card animate-pulse" style={{ height: 108 }} />)}
    </div>
  );
}

function SecaoSdr({ periodo, chave }: { periodo: Periodo; chave: string }) {
  const c = useCarga<BlocoSdr>(() => carregarSdr(periodo), chave);
  const col: Column<LinhaSdr>[] = [
    { key: "n", header: "Pessoa", render: (r) => r.nome },
    { key: "rec", header: "Leads recebidos", align: "right", render: (r) => <N v={r.recebidos} /> },
    { key: "trab", header: "1º contato", align: "right", render: (r) => <N v={r.trabalhou} /> },
    { key: "ag", header: "Reuniões agendadas", align: "right", render: (r) => <N v={r.agendadas} /> },
    { key: "re", header: "Realizadas", align: "right", render: (r) => <N v={r.realizadas} /> },
    { key: "co", header: "Cotações aéreo", align: "right", render: (r) => <N v={r.cotacoes} /> },
  ];
  return (
    <Secao setor="sdr">
      <Numeros carga={{ dado: c.dado?.numeros ?? null, erro: c.erro }} qtd={5} />
      {c.dado && (
        <Ranking titulo="Quem fez o quê no período">
          <DataTable columns={col} rows={c.dado.ranking} rowKey={(r) => r.id} minWidth={640}
            empty={<p className="qs-label" style={{ padding: 16, margin: 0 }}>Ninguém registrou nada no período.</p>} />
        </Ranking>
      )}
    </Secao>
  );
}

function SecaoCloser({ periodo, chave }: { periodo: Periodo; chave: string }) {
  const c = useCarga<BlocoCloser>(() => carregarCloser(periodo), chave);
  const col: Column<LinhaCloser>[] = [
    { key: "n", header: "Closer", render: (r) => r.nome },
    { key: "re", header: "Realizadas", align: "right", render: (r) => <N v={r.realizadas} /> },
    { key: "ns", header: "No-show", align: "right", render: (r) => <N v={r.noShow} /> },
    { key: "pv", header: "Pré-vendas", align: "right", render: (r) => <N v={r.preVendas} /> },
    { key: "cs", header: "Consolidadas", align: "right", render: (r) => <N v={r.consolidadas} /> },
    { key: "vl", header: "Valor", align: "right", render: (r) => <span className="qs-num">{r.valor ? brl(r.valor) : "—"}</span> },
  ];
  return (
    <Secao setor="closer">
      <Numeros carga={{ dado: c.dado?.numeros ?? null, erro: c.erro }} qtd={5} />
      {c.dado && (
        <Ranking titulo="Quem fez o quê no período">
          <DataTable columns={col} rows={c.dado.ranking} rowKey={(r) => r.id} minWidth={600}
            empty={<p className="qs-label" style={{ padding: 16, margin: 0 }}>Nenhuma reunião realizada ou venda no período.</p>} />
        </Ranking>
      )}
    </Secao>
  );
}

function SecaoFin({ periodo, chave }: { periodo: Periodo; chave: string }) {
  const c = useCarga(() => carregarFin(periodo), chave);
  return <Secao setor="fin"><Numeros carga={c} qtd={3} /></Secao>;
}

// Rel e Operações olham pra frente (embarques): não mudam com o período.
function SecaoRel({ chave }: { chave: string }) {
  const c = useCarga(carregarRel, chave);
  return <Secao setor="rel" nota="Olha para a frente: não muda com o período."><Numeros carga={c} /></Secao>;
}
function SecaoOps({ chave }: { chave: string }) {
  const c = useCarga(carregarOps, chave);
  return <Secao setor="ops" nota="Olha para a frente: não muda com o período."><Numeros carga={c} qtd={3} /></Secao>;
}

function Ranking({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="qs-label">{titulo}</span>
      {children}
    </div>
  );
}

const N = ({ v }: { v: number }) => <span className={`qs-num${v ? "" : " qs-tone-subtle"}`}>{v ? v.toLocaleString("pt-BR") : "—"}</span>;
