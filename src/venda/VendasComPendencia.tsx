// src/venda/VendasComPendencia.tsx
// -----------------------------------------------------------------------------
// PAINEL "VENDAS COM PENDÊNCIA" (0230). Toda venda que subiu passa pela análise
// pós-venda; aqui o Relacionamento (e o Ops) vê o STATUS de cada uma — em
// análise / tudo emitido ✓ / faltam emissões / divergência / risco alto —,
// abre o extrato, corrige (marca o item como emitido com o localizador) e
// reanalisa. A solicitação "Emissões pendentes" aberta pra venda aparece com o nº.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "@/rel/ui";
import { TIPOS, brl, dataBr } from "@/propostas/lib";
import ExtratoAnalise, { EtiquetaStatus } from "./ExtratoAnalise";
import {
  STATUS_ANALISE, analisarVendaGravada, ehPendente, historicoDaVenda, itensDaVendaGravada, listarVendasAnalise, marcarItemEmitido,
  marcarVendaRevisada, revisoesDasVendas,
  type Analise, type AnaliseGuardada, type ItemDaVenda, type RevisaoDaVenda, type StatusAnalise, type VendaAnaliseLinha,
} from "./analise";

type Filtro = "pendentes" | "nao_revisadas" | "todas" | StatusAnalise;
const ORIGEM: Record<string, string> = { closer: "Comercial", rel: "Relacionamento", ops: "Operacional" };

export default function VendasComPendencia({ compacto = false }: { compacto?: boolean }) {
  const [lista, setLista] = useState<VendaAnaliseLinha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("pendentes");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<VendaAnaliseLinha | null>(null);
  const [recolhido, setRecolhido] = useState(compacto);
  const [revisoes, setRevisoes] = useState<Record<string, RevisaoDaVenda>>({});

  const carregar = useCallback(() => {
    listarVendasAnalise().then((l) => {
      setLista(l); setErro(null);
      void revisoesDasVendas(l.map((v) => v.id)).then(setRevisoes);
    }).catch((e) => { setLista([]); setErro((e as Error).message); });
  }, []);
  const revisada = useCallback((id: string) => !!revisoes[id]?.revisado_em, [revisoes]);
  useEffect(carregar, [carregar]);

  const pendentes = useMemo(() => (lista ?? []).filter((v) => ehPendente(v.analise_status)).length, [lista]);
  const naoRevisadas = useMemo(() => (lista ?? []).filter((v) => !revisada(v.id)).length, [lista, revisada]);
  const vistas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (lista ?? []).filter((v) => (filtro === "todas" ? true : filtro === "pendentes" ? ehPendente(v.analise_status) : filtro === "nao_revisadas" ? !revisada(v.id) : v.analise_status === filtro))
      .filter((v) => !b || (v.cliente_nome ?? "").toLowerCase().includes(b) || String(v.solicitacao_numero ?? "").includes(b));
  }, [lista, filtro, busca, revisada]);

  const contar = (s: StatusAnalise) => (lista ?? []).filter((v) => v.analise_status === s).length;

  return (
    <section className="rel-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-bold flex-1" style={{ color: "var(--ink)" }}>
          Vendas com pendência {lista && <span style={{ color: pendentes ? "#B45309" : "var(--ink3)" }}>({pendentes})</span>}
        </h2>
        {compacto && <Botao variante="fantasma" onClick={() => setRecolhido(!recolhido)}>{recolhido ? "Abrir" : "Recolher"}</Botao>}
        {!recolhido && <Botao variante="fantasma" onClick={carregar}>Atualizar</Botao>}
      </div>
      {!recolhido && <>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Cada venda que sobe passa pela análise pós-venda: proposta apresentada × o que foi emitido. Abra pra ver o extrato, corrigir e reanalisar.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {(["pendentes", "nao_revisadas", "faltam_emissoes", "divergencia", "risco_alto", "em_analise", "tudo_emitido", "todas"] as Filtro[]).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} aria-pressed={filtro === f}
              className="rounded-full px-3 py-1 text-[12.5px] font-semibold"
              style={{ border: `1px solid ${filtro === f ? "var(--rel)" : "var(--line)"}`, background: filtro === f ? "var(--rel-soft)" : "var(--card)", color: "var(--ink)" }}>
              {f === "pendentes" ? `Pendentes (${pendentes})` : f === "nao_revisadas" ? `Não revisadas (${naoRevisadas})` : f === "todas" ? `Todas (${lista?.length ?? 0})` : `${STATUS_ANALISE[f].rotulo} (${contar(f)})`}
            </button>
          ))}
          <div className="flex-1 min-w-[180px]"><Entrada placeholder="Buscar cliente ou nº do pedido" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        </div>
        {erro && <Aviso tom={/0230/.test(erro) ? "aviso" : "erro"}>{erro}</Aviso>}
        {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
          : !vistas.length ? (!erro && <Vazio titulo={filtro === "pendentes" ? "Nenhuma venda com pendência" : "Nada neste filtro"} texto="As vendas aparecem aqui assim que alguém sobe uma venda no QS." />)
          : (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {vistas.map((v) => {
                const c = v.analise_resumo?.contagens;
                return (
                  <li key={v.id}>
                    <button type="button" className="w-full text-left py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1" onClick={() => setAberta(v)}>
                      <span className="text-[13.5px] font-semibold flex-1 min-w-[180px]" style={{ color: "var(--ink)" }}>{v.cliente_nome || "Cliente sem nome"}</span>
                      <EtiquetaStatus status={v.analise_status} />
                      {revisada(v.id) ? <Etiqueta tom="rel">Revisada ✓</Etiqueta> : <Etiqueta tom="aviso">Falta revisar</Etiqueta>}
                      {c && (c.falta > 0 || c.divergente + c.extra > 0) && (
                        <span className="text-[12px]" style={{ color: "var(--ink2)" }}>
                          {c.falta > 0 && `${c.falta} por emitir`}{c.falta > 0 && c.divergente + c.extra > 0 && " · "}{c.divergente + c.extra > 0 && `${c.divergente + c.extra} divergente(s)`}
                        </span>
                      )}
                      {v.solicitacao_numero && <Etiqueta tom={v.solicitacao_status === "concluida" ? "neutro" : "rel"}>Pedido nº {v.solicitacao_numero}</Etiqueta>}
                      <span className="text-[12px] w-full sm:w-auto" style={{ color: "var(--ink3)" }}>
                        {ORIGEM[v.origem] ?? v.origem}{v.criado_por_nome ? ` · ${v.criado_por_nome}` : ""} · {dataBr(v.criado_em.slice(0, 10))}{v.valor_total ? ` · ${brl(v.valor_total)}` : ""}
                        {v.analise_resumo?.inicio ? ` · embarca ${dataBr(v.analise_resumo.inicio)}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
      </>}
      {aberta && <DetalheDaVenda venda={aberta} revisao={revisoes[aberta.id] ?? null} onFechar={() => setAberta(null)} onMudou={carregar} />}
    </section>
  );
}

function DetalheDaVenda({ venda, revisao, onFechar, onMudou }: { venda: VendaAnaliseLinha; revisao: RevisaoDaVenda | null; onFechar: () => void; onMudou: () => void }) {
  const [hist, setHist] = useState<AnaliseGuardada[] | null>(null);
  const [itens, setItens] = useState<ItemDaVenda[]>([]);
  const [agora, setAgora] = useState<Analise | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [emitindo, setEmitindo] = useState<ItemDaVenda | null>(null);
  const [loc, setLoc] = useState("");
  const [obs, setObs] = useState("");

  const carregar = useCallback(() => {
    historicoDaVenda(venda.id).then(setHist).catch((e) => { setHist([]); setErro((e as Error).message); });
    itensDaVendaGravada(venda.id).then(setItens).catch(() => setItens([]));
  }, [venda.id]);
  useEffect(carregar, [carregar]);

  async function reanalisar(motivo: "reanalise" | "correcao") {
    setRodando(true); setErro(null); setInfo(null);
    try {
      const a = await analisarVendaGravada(venda.id, motivo);
      setAgora(a);
      const sol = a.solicitacao;
      setInfo(`${STATUS_ANALISE[a.status].rotulo}.${sol?.nova ? ` Solicitação nº ${sol.numero} aberta pro Relacionamento.` : sol ? ` Atualizado no pedido nº ${sol.numero}.` : ""}${a.gravado === false && a.aviso ? ` ${a.aviso}` : ""}`);
      carregar(); onMudou();
    } catch (e) { setErro((e as Error).message); } finally { setRodando(false); }
  }

  async function confirmarEmitido() {
    if (!emitindo) return;
    setErro(null);
    try {
      await marcarItemEmitido(emitindo.id, loc, obs);
      setEmitindo(null); setLoc(""); setObs("");
      await reanalisar("correcao");
    } catch (e) { setErro((e as Error).message); }
  }

  const ultima = agora ?? (hist?.[0] ? { ...hist[0], ia: { usada: hist[0].ia_usada, aviso: hist[0].ia_aviso, texto: hist[0].texto_ia } } : null);
  return (
    <Modal aberto titulo={`Análise pós-venda — ${venda.cliente_nome || "venda"}`} onFechar={onFechar} largura={860}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Fechar</Botao>
        <Botao variante="primario" onClick={() => void reanalisar("reanalise")} disabled={rodando}>{rodando ? "Analisando…" : "Reanalisar agora"}</Botao>
      </>}>
      <div className="space-y-4">
        {info && <Aviso tom="ok">{info}</Aviso>}
        {erro && <Aviso tom={/0230/.test(erro) ? "aviso" : "erro"}>{erro}</Aviso>}
        {hist === null && !agora ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
          : ultima ? (
            <ExtratoAnalise status={ultima.status} base={ultima.base} contagens={ultima.contagens} linhas={ultima.linhas ?? []} riscos={ultima.riscos ?? []}
              resumo={ultima.resumo} proposta={agora?.proposta ?? null} ia={ultima.ia} />
          ) : <Vazio titulo="Ainda sem análise guardada" texto="Toque em Reanalisar agora." />}

        <RevisaoDoOperacional vendaId={venda.id} revisao={revisao} onMudou={onMudou} />

        {itens.length > 0 && (
          <section className="rel-card p-4">
            <h4 className="text-[13px] font-bold mb-2" style={{ color: "var(--ink)" }}>Corrigir: itens da venda</h4>
            <ul className="space-y-1.5">
              {itens.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                  <span aria-hidden>{TIPOS[i.tipo]?.emoji}</span>
                  <span className="flex-1 min-w-[160px]">{i.nome}{i.data_inicio ? ` · ${dataBr(i.data_inicio)}` : ""}</span>
                  {i.status === "emitido"
                    ? <Etiqueta tom="rel">emitido{typeof i.dados?.localizador === "string" ? ` · ${i.dados.localizador}` : ""}</Etiqueta>
                    : i.status === "cancelado" ? <Etiqueta>cancelado</Etiqueta>
                    : <Botao variante="fantasma" onClick={() => { setEmitindo(i); setLoc(""); setObs(""); }}>Marcar emitido</Botao>}
                </li>
              ))}
            </ul>
            {emitindo && (
              <div className="mt-3 pt-3 border-t grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end" style={{ borderColor: "var(--line)" }}>
                <Campo rotulo={`Localizador de "${emitindo.nome}" *`} dica="Ou nº do bilhete, apólice, voucher."><Entrada value={loc} onChange={(e) => setLoc(e.target.value)} autoFocus /></Campo>
                <Campo rotulo="Observação"><Entrada value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
                <div className="flex gap-2"><Botao variante="fantasma" onClick={() => setEmitindo(null)}>Cancelar</Botao><Botao variante="primario" onClick={() => void confirmarEmitido()} disabled={!loc.trim() || rodando}>Salvar e reanalisar</Botao></div>
              </div>
            )}
          </section>
        )}

        {hist && hist.length > 1 && (
          <section className="rel-card p-4">
            <h4 className="text-[13px] font-bold mb-2" style={{ color: "var(--ink)" }}>Histórico das análises</h4>
            <ul className="space-y-1">
              {hist.map((h) => (
                <li key={h.id} className="text-[12.5px] flex flex-wrap gap-2 items-center" style={{ color: "var(--ink2)" }}>
                  <span className="w-[130px]">{new Date(h.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                  <EtiquetaStatus status={h.status} />
                  <span>{h.motivo === "subir_venda" ? "ao subir a venda" : h.motivo === "correcao" ? "depois de correção" : "reanálise"}</span>
                  <span style={{ color: "var(--ink3)" }}>{h.resumo}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

/** O Operacional confere a venda (tipo, expedição, valor, pax). Não é aprovação: a venda já vale desde que subiu. */
function RevisaoDoOperacional({ vendaId, revisao, onMudou }: { vendaId: string; revisao: RevisaoDaVenda | null; onMudou: () => void }) {
  const [obs, setObs] = useState(revisao?.revisao_obs ?? "");
  const [feita, setFeita] = useState(revisao?.revisado_em ?? null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function marcar(desfazer: boolean) {
    setOcupado(true); setErro(null);
    try {
      await marcarVendaRevisada(vendaId, obs.trim() || null, desfazer);
      setFeita(desfazer ? null : new Date().toISOString());
      onMudou();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return (
    <section className="rel-card p-4 space-y-2">
      <h4 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Revisão do Operacional</h4>
      <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
        Confira tipo, expedição, valor e passageiros. Se algo estiver errado, corrija o item abaixo; a comissão e o Financeiro acompanham. Revisar não aprova nem trava nada.
      </p>
      {feita
        ? <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Revisada em {new Date(feita).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}{obs.trim() ? ` · ${obs.trim()}` : ""}</p>
        : <Campo rotulo="Anotação (opcional)" dica="Ex.: corrigi a expedição para Peru G2."><Entrada value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex gap-2">
        {feita
          ? <Botao variante="fantasma" disabled={ocupado} onClick={() => void marcar(true)}>Desfazer revisão</Botao>
          : <Botao variante="primario" disabled={ocupado} onClick={() => void marcar(false)}>{ocupado ? "Salvando…" : "Marcar como revisada"}</Botao>}
      </div>
    </section>
  );
}
