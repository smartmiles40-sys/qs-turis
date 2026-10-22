// src/closer/PipelinePage.tsx
// -----------------------------------------------------------------------------
// O PIPELINE DO CLOSER (0174, 22/10/2026): um cartão por cliente atendido.
//
//   Reunião feita → Proposta enviada → Negociando → Contrato enviado →
//   Contrato assinado → Pagamento enviado → Pago → Venda consolidada (+ Perdido)
//
// O cartão anda SOZINHO quando há fato (proposta enviada/aprovada, contrato,
// pagamento) e dá pra arrastar à mão (ou usar "Mover para" no painel).
// Filtros: período (quando entrou no pipeline), etapa e closer (só a gestão).
// Cada coluna mostra quantos cartões e quanto vale.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Etiqueta, Modal, Vazio } from "@/rel/ui";
import { ETAPAS, brl, dataBr, listarNegocios, moverNegocio, nomeDoLead, type Etapa, type Negocio } from "./lib";
import NegocioPainel, { type LinksDoPainel } from "./NegocioPainel";

const PERIODOS = [
  { id: "30", rotulo: "Últimos 30 dias" },
  { id: "90", rotulo: "Últimos 90 dias" },
  { id: "365", rotulo: "Último ano" },
  { id: "tudo", rotulo: "Tudo" },
];

export default function PipelinePage({ abrirId, onAbrirId, links }: {
  abrirId: string | null;
  onAbrirId: (id: string | null) => void;
  links: LinksDoPainel;
}) {
  const { currentUser } = useQsAuth();
  const gestao = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const [lista, setLista] = useState<Negocio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState(() => { try { return localStorage.getItem("qs_closer_periodo") || "90"; } catch { return "90"; } });
  const [etapaFiltro, setEtapaFiltro] = useState<Etapa | "">("");
  const [closerFiltro, setCloserFiltro] = useState("");
  const [closers, setClosers] = useState<{ id: string; name: string }[]>([]);
  const [busca, setBusca] = useState("");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [perdendo, setPerdendo] = useState<{ id: string; motivo: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const desde = periodo === "tudo" ? null : new Date(Date.now() - Number(periodo) * 86400000).toISOString();
      setLista(await listarNegocios({ desde, closerId: closerFiltro || null }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [periodo, closerFiltro]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { try { localStorage.setItem("qs_closer_periodo", periodo); } catch { /* sem memória */ } }, [periodo]);
  useEffect(() => {
    if (!gestao) return;
    void supabase.from("qs_users").select("id, name").eq("role", "closer").eq("is_active", true).order("name")
      .then(({ data }) => setClosers((data ?? []) as { id: string; name: string }[]));
  }, [gestao]);

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return lista.filter((n) => !b || nomeDoLead(n.lead).toLowerCase().includes(b) || (n.lead?.phone ?? "").includes(b));
  }, [lista, busca]);
  const colunas = useMemo(() => ETAPAS.filter((e) => !etapaFiltro || e.id === etapaFiltro), [etapaFiltro]);
  const porEtapa = useMemo(() => {
    const m = new Map<Etapa, Negocio[]>();
    for (const n of filtrados) m.set(n.etapa, [...(m.get(n.etapa) ?? []), n]);
    return m;
  }, [filtrados]);

  const abertos = filtrados.filter((n) => n.etapa !== "perdido" && n.etapa !== "consolidada");
  const consolidados = filtrados.filter((n) => n.etapa === "consolidada");

  async function soltar(id: string, etapa: Etapa) {
    const n = lista.find((x) => x.id === id);
    if (!n || n.etapa === etapa) return;
    if (etapa === "consolidada") { setAviso("Pra consolidar, abra o cartão e preencha a ficha de fechamento."); onAbrirId(id); return; }
    if (etapa === "perdido") { setPerdendo({ id, motivo: "" }); return; }
    try {
      setLista((l) => l.map((x) => (x.id === id ? { ...x, etapa } : x)));
      await moverNegocio(id, etapa);
    } catch (e) {
      setAviso((e as Error).message);
    }
    void carregar();
  }

  if (abrirId) {
    return <NegocioPainel id={abrirId} onVoltar={() => { onAbrirId(null); void carregar(); }} links={links} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold flex-1" style={{ color: "var(--ink)" }}>Pipeline</h1>
        <span className="text-[13px]" style={{ color: "var(--ink2)" }}>
          Em aberto: <b>{abertos.length}</b> · {brl(abertos.reduce((s, n) => s + Number(n.valor_previsto || 0), 0))}
          {"  "}· Consolidadas: <b>{consolidados.length}</b> · {brl(consolidados.reduce((s, n) => s + Number(n.valor_previsto || 0), 0))}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="rel-input" style={{ maxWidth: 240 }} placeholder="Buscar cliente ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cliente" />
        <select className="rel-input" style={{ maxWidth: 180 }} value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
        </select>
        <select className="rel-input" style={{ maxWidth: 200 }} value={etapaFiltro} onChange={(e) => setEtapaFiltro(e.target.value as Etapa | "")} aria-label="Etapa">
          <option value="">Todas as etapas</option>
          {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
        </select>
        {gestao && (
          <select className="rel-input" style={{ maxWidth: 200 }} value={closerFiltro} onChange={(e) => setCloserFiltro(e.target.value)} aria-label="Closer">
            <option value="">Todos os closers</option>
            {closers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {aviso && <Aviso>{aviso} <button className="underline ml-1" onClick={() => setAviso(null)}>ok</button></Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {carregando ? (
        <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : !filtrados.length ? (
        <Vazio titulo="Nenhum cliente no pipeline" texto="Quando você marcar uma reunião como realizada, o cliente aparece aqui em “Reunião feita”." />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollSnapType: "x proximity" }}>
          {colunas.map((col) => {
            const itens = porEtapa.get(col.id) ?? [];
            const total = itens.reduce((s, n) => s + Number(n.valor_previsto || 0), 0);
            return (
              <section key={col.id} aria-label={col.rotulo}
                className="flex-shrink-0 w-[264px] rounded-xl flex flex-col max-h-[calc(100dvh-230px)]"
                style={{ background: "var(--card2)", border: "1px solid var(--line)", scrollSnapAlign: "start" }}
                onDragOver={(e) => { if (arrastando) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); setArrastando(null); if (id) void soltar(id, col.id); }}>
                <header className="px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.cor }} aria-hidden />
                    <span className="text-[13px] font-bold flex-1" style={{ color: "var(--ink)" }}>{col.rotulo}</span>
                    <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{itens.length}</span>
                  </div>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>{brl(total)}</p>
                </header>
                <div className="px-2 pb-2 space-y-2 overflow-y-auto flex-1">
                  {itens.map((n) => {
                    const atrasada = n.proxima_acao_em && new Date(n.proxima_acao_em).getTime() < Date.now();
                    return (
                      <button key={n.id} draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", n.id); setArrastando(n.id); }}
                        onDragEnd={() => setArrastando(null)}
                        onClick={() => onAbrirId(n.id)}
                        className="w-full text-left rounded-lg p-2.5 rel-linha"
                        style={{ background: "var(--card)", border: "1px solid var(--line)", opacity: arrastando === n.id ? 0.5 : 1 }}>
                        <p className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{nomeDoLead(n.lead)}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--ink2)" }}>
                          {n.valor_previsto ? brl(n.valor_previsto) : "sem valor"}
                          {gestao && n.closer?.name ? <span style={{ color: "var(--ink3)" }}> · {n.closer.name.split(" ")[0]}</span> : null}
                        </p>
                        {n.proxima_acao && (
                          <p className="text-[12px] mt-1 truncate" style={{ color: atrasada ? "var(--err-ink)" : "var(--ink3)" }}>
                            → {n.proxima_acao}{n.proxima_acao_em ? ` (${dataBr(n.proxima_acao_em)})` : ""}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {n.etapa === "consolidada" && n.bitrix_status === "erro" && <Etiqueta tom="erro">Bitrix falhou</Etiqueta>}
                          {n.etapa === "consolidada" && n.bitrix_status === "pendente" && <Etiqueta tom="aviso">Bitrix pendente</Etiqueta>}
                          {n.etapa === "perdido" && n.motivo_perda && <Etiqueta>{n.motivo_perda.slice(0, 30)}</Etiqueta>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal aberto={!!perdendo} titulo="Marcar como perdido" onFechar={() => setPerdendo(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setPerdendo(null)}>Cancelar</Botao>
          <Botao variante="perigo" disabled={!perdendo?.motivo.trim()} onClick={async () => {
            if (!perdendo) return;
            try { await moverNegocio(perdendo.id, "perdido", perdendo.motivo); } catch (e) { setAviso((e as Error).message); }
            setPerdendo(null);
            void carregar();
          }}>Marcar perdido</Botao>
        </>}>
        <label className="block text-[13px] font-semibold mb-1" style={{ color: "var(--ink2)" }} htmlFor="motivo-perda">Por que não fechou?</label>
        <textarea id="motivo-perda" className="rel-input" rows={3} value={perdendo?.motivo ?? ""} onChange={(e) => perdendo && setPerdendo({ ...perdendo, motivo: e.target.value })} />
      </Modal>
    </div>
  );
}
