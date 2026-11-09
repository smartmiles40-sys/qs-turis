// src/mkt/automacoes/EditorFluxo.tsx
// -----------------------------------------------------------------------------
// O EDITOR DE FLUXO, feito à mão (o QS não tem @xyflow/react): blocos são divs
// posicionadas num "papel" grande, as setas são um SVG por baixo. Arrastar um
// bloco = pointer events no cabeçalho; ligar = arrastar da bolinha da saída até
// outro bloco (ou, no celular, escolher o destino numa lista).
//
// No celular (< 768 px) o canvas vira LISTA: os blocos na ordem do fluxo, cada
// saída com um seletor "vai para…". Mesma estrutura, outro desenho.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  ROTULO_TIPO, novoId, noPadrao, saidasDoNo, validarGrafo,
  type Fluxo, type Grafo, type No, type TipoNo, type CampoPersonalizado,
} from "./tipos";
import { acao, estatisticas, lerFluxo, listarCampos, listarFluxos, listarModelos, listarUsuarios, salvarFluxo, type ModeloMkt } from "./api";
import { Aviso, Botao, COR, COR_SUAVE, Carregando, Chip, Modal } from "./ui";
import PainelBloco from "./PainelBloco";
import Simulacao, { type ResultadoSimulacao } from "./Simulacao";

const LARGURA = 250;
const TOPO = 64;      // cabeçalho + resumo do bloco
const LINHA = 26;     // cada saída
const PAPEL = { w: 4000, h: 3000 };

const COR_TIPO: Record<TipoNo, string> = {
  inicio: "#059669", mensagem: "#2563EB", template: "#0891B2", pergunta: "#7C3AED", aguardar: "#D97706",
  condicao: "#DB2777", acao: "#4B5563", randomizador: "#9333EA", ir_para: "#0D9488", fim: "#DC2626",
};
const TIPOS_NOVOS: TipoNo[] = ["mensagem", "pergunta", "template", "aguardar", "condicao", "acao", "randomizador", "ir_para", "fim"];

export function resumoDoNo(no: No): string {
  switch (no.tipo) {
    case "inicio": return "Quando um gatilho dispara";
    case "mensagem": {
      const t = no.dados.blocos.find((b) => b.tipo === "texto");
      const txt = t && t.tipo === "texto" ? t.texto : `${no.dados.blocos.length} mídia(s)`;
      return txt || "(vazia)";
    }
    case "template": return no.dados.nome ? `Modelo: ${no.dados.nome}` : "(escolha o modelo)";
    case "pergunta": return no.dados.pergunta || "(escreva a pergunta)";
    case "aguardar": return `Espera ${no.dados.quantidade} ${no.dados.unidade}${no.dados.janelaInicio ? ` · só ${no.dados.janelaInicio}–${no.dados.janelaFim}` : ""}`;
    case "condicao": return `${no.dados.regras.length} regra(s) · ${no.dados.combinar === "todas" ? "todas" : "qualquer uma"}`;
    case "acao": return no.dados.acoes.length ? no.dados.acoes.map((a) => a.tipo.replace(/_/g, " ")).join(", ") : "(sem ações)";
    case "randomizador": return no.dados.variantes.map((v) => `${v.nome} ${v.peso}%`).join(" · ");
    case "ir_para": return no.dados.fluxoId ? "Vai para outro fluxo" : "(escolha o fluxo)";
    case "fim": return "Encerra o fluxo";
  }
}

function useCelular() {
  const [cel, setCel] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const f = () => setCel(window.innerWidth < 768);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return cel;
}

/** Ordem de leitura (para a lista do celular): a partir do Início, em largura; soltos no fim. */
function ordemDoFluxo(g: Grafo): No[] {
  const vistos = new Set<string>();
  const fila = g.nos.filter((n) => n.tipo === "inicio").map((n) => n.id);
  const out: No[] = [];
  while (fila.length) {
    const id = fila.shift() as string;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const no = g.nos.find((n) => n.id === id);
    if (!no) continue;
    out.push(no);
    for (const s of saidasDoNo(no)) {
      const l = g.ligacoes.find((x) => x.de === id && x.saida === s.id);
      if (l) fila.push(l.para);
    }
  }
  return [...out, ...g.nos.filter((n) => !vistos.has(n.id))];
}

export default function EditorFluxo({ fluxoId, onVoltar }: { fluxoId: string; onVoltar: () => void }) {
  const celular = useCelular();
  const [fluxo, setFluxo] = useState<Fluxo | null>(null);
  const [grafo, setGrafo] = useState<Grafo>({ nos: [], ligacoes: [] });
  const [sujo, setSujo] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [setaSel, setSetaSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [campos, setCampos] = useState<CampoPersonalizado[]>([]);
  const [fluxos, setFluxos] = useState<Fluxo[]>([]);
  const [modelos, setModelos] = useState<ModeloMkt[] | null>(null);
  const [usuarios, setUsuarios] = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof estatisticas>>>(new Map());
  const [ocupado, setOcupado] = useState(false);
  const [simulacao, setSimulacao] = useState<ResultadoSimulacao | null>(null);
  const [ligando, setLigando] = useState<{ de: string; saida: string; x: number; y: number } | null>(null);
  const papelRef = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [f, cs, fs, us, st] = await Promise.all([lerFluxo(fluxoId), listarCampos().catch(() => []), listarFluxos().catch(() => []), listarUsuarios().catch(() => []), estatisticas(fluxoId).catch(() => new Map())]);
        if (!vivo) return;
        if (!f) { notifyError("Fluxo não encontrado."); onVoltar(); return; }
        setFluxo(f);
        setGrafo({ nos: f.grafo?.nos ?? [], ligacoes: f.grafo?.ligacoes ?? [] });
        setCampos(cs); setFluxos(fs.filter((x) => x.id !== fluxoId)); setUsuarios(us); setStats(st);
      } catch (e) {
        notifyError(e instanceof Error ? e.message : "Não consegui abrir o fluxo.");
        // 04/11/2026: sem isso o editor ficava em "Carregando…" pra sempre; volta pra lista.
        if (vivo) onVoltar();
      }
    })();
    return () => { vivo = false; };
  }, [fluxoId, onVoltar]);

  // Os modelos só são buscados quando alguém abre um bloco Template.
  const precisaModelos = useCallback(() => {
    if (modelos !== null) return;
    setModelos([]);
    listarModelos().then((r) => { setModelos(r.modelos ?? []); if (r.erro || r.aviso) notifyError(r.erro || r.aviso || ""); }).catch(() => setModelos([]));
  }, [modelos]);

  const mudarGrafo = useCallback((f: (g: Grafo) => Grafo) => { setGrafo((g) => f(g)); setSujo(true); }, []);
  const problemas = useMemo(() => validarGrafo(grafo), [grafo]);
  const graves = problemas.filter((p) => p.grave);
  const noSel = grafo.nos.find((n) => n.id === sel) ?? null;

  function adicionar(tipo: TipoNo) {
    const el = papelRef.current?.parentElement;
    const x = el ? (el.scrollLeft + el.clientWidth / 2) / zoom - LARGURA / 2 : 400;
    const y = el ? (el.scrollTop + el.clientHeight / 3) / zoom : 200;
    const no = noPadrao(tipo, Math.max(10, Math.round(x)), Math.max(10, Math.round(y)));
    mudarGrafo((g) => ({ ...g, nos: [...g.nos, no] }));
    setSel(no.id);
  }

  function ligar(de: string, saida: string, para: string | null) {
    if (de === para) return;
    mudarGrafo((g) => ({
      ...g,
      ligacoes: [...g.ligacoes.filter((l) => !(l.de === de && l.saida === saida)), ...(para ? [{ id: novoId("l"), de, saida, para }] : [])],
    }));
  }

  function apagarNo(id: string) {
    const no = grafo.nos.find((n) => n.id === id);
    if (!no || no.tipo === "inicio") return;
    mudarGrafo((g) => ({ nos: g.nos.filter((n) => n.id !== id), ligacoes: g.ligacoes.filter((l) => l.de !== id && l.para !== id) }));
    setSel(null);
  }

  function duplicarNo(id: string) {
    const no = grafo.nos.find((n) => n.id === id);
    if (!no || no.tipo === "inicio") return;
    const copia = { ...JSON.parse(JSON.stringify(no)), id: novoId(no.tipo.slice(0, 3)), x: no.x + 30, y: no.y + 30 } as No;
    mudarGrafo((g) => ({ ...g, nos: [...g.nos, copia] }));
    setSel(copia.id);
  }

  // ── arrastar bloco / ligar seta (pointer events na janela) ──
  useEffect(() => {
    const mover = (e: PointerEvent) => {
      const papel = papelRef.current?.getBoundingClientRect();
      if (!papel) return;
      const px = (e.clientX - papel.left) / zoom;
      const py = (e.clientY - papel.top) / zoom;
      if (arrasto.current) {
        const { id, dx, dy } = arrasto.current;
        setGrafo((g) => ({ ...g, nos: g.nos.map((n) => (n.id === id ? { ...n, x: Math.max(0, Math.round(px - dx)), y: Math.max(0, Math.round(py - dy)) } : n)) }));
        setSujo(true);
      }
      if (ligando) setLigando((l) => (l ? { ...l, x: px, y: py } : l));
    };
    const soltar = (e: PointerEvent) => {
      arrasto.current = null;
      if (ligando) {
        const alvo = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-no-id]") as HTMLElement | null;
        const para = alvo?.dataset.noId;
        if (para && para !== ligando.de) ligar(ligando.de, ligando.saida, para);
        setLigando(null);
      }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, ligando]);

  async function salvar(status?: Fluxo["status"]) {
    if (!fluxo) return;
    if (status === "ativo" && graves.length) { notifyError(`Corrija ${graves.length} problema(s) antes de ativar.`); return; }
    setOcupado(true);
    try {
      await salvarFluxo(fluxo.id, { grafo, ...(status ? { status } : {}) });
      setFluxo({ ...fluxo, grafo, status: status ?? fluxo.status });
      setSujo(false);
      notifySuccess(status === "ativo" ? "Fluxo ativado." : status === "pausado" ? "Fluxo pausado." : "Fluxo salvo.");
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não consegui salvar."); }
    finally { setOcupado(false); }
  }

  async function simular() {
    setOcupado(true);
    try { setSimulacao(await acao<ResultadoSimulacao>({ acao: "simular", fluxoId, grafo })); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não consegui simular."); }
    finally { setOcupado(false); }
  }

  async function testarNoMeuWhatsApp() {
    if (sujo) { notifyError("Salve o fluxo antes de testar."); return; }
    if (!window.confirm("Isto MANDA as mensagens de verdade, pelo número do Marketing, para o WhatsApp cadastrado no seu perfil do QS. A janela de 24 h vale: mande um 'oi' para o número antes, ou comece o fluxo por um Template. Continuar?")) return;
    setOcupado(true);
    try { await acao({ acao: "testar", fluxoId }); notifySuccess("Teste iniciado — confira seu WhatsApp."); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não consegui testar."); }
    finally { setOcupado(false); }
  }

  if (!fluxo) return <Carregando />;

  const posSaida = (no: No, i: number) => ({ x: no.x + LARGURA, y: no.y + TOPO + i * LINHA + LINHA / 2 });
  const posEntrada = (no: No) => ({ x: no.x, y: no.y + 20 });
  const curva = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  const barra = (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <Botao variante="fantasma" onClick={() => { if (!sujo || window.confirm("Sair sem salvar?")) onVoltar(); }}>← Fluxos</Botao>
      <strong className="text-[15px] mr-1" style={{ color: "var(--ink)" }}>{fluxo.nome}</strong>
      <Chip cor={fluxo.status === "ativo" ? "#059669" : fluxo.status === "pausado" ? "#D97706" : "#6B7280"}>{fluxo.status}</Chip>
      {sujo && <Chip cor="#D97706">não salvo</Chip>}
      <div className="flex-1" />
      <Botao onClick={() => void simular()} disabled={ocupado} title="Anda pelo fluxo e mostra o que sairia — não manda nada">Simular</Botao>
      <Botao onClick={() => void testarNoMeuWhatsApp()} disabled={ocupado}>Testar no meu WhatsApp</Botao>
      <Botao onClick={() => void salvar()} disabled={ocupado || !sujo}>Salvar</Botao>
      {fluxo.status === "ativo"
        ? <Botao onClick={() => void salvar("pausado")} disabled={ocupado}>Pausar</Botao>
        : <Botao variante="primario" onClick={() => void salvar("ativo")} disabled={ocupado}>Salvar e ativar</Botao>}
    </div>
  );

  const paleta = (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {TIPOS_NOVOS.map((t) => (
        <button key={t} type="button" onClick={() => adicionar(t)} className="px-2.5 py-1 rounded-md text-[12px] font-semibold" style={{ background: `${COR_TIPO[t]}18`, color: COR_TIPO[t] }}>
          + {ROTULO_TIPO[t]}
        </button>
      ))}
      {!celular && (
        <span className="ml-auto flex gap-1">
          <Botao variante="fantasma" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} aria-label="Diminuir">−</Botao>
          <span className="text-[12px] self-center" style={{ color: "var(--ink3)" }}>{Math.round(zoom * 100)}%</span>
          <Botao variante="fantasma" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="Aumentar">+</Botao>
        </span>
      )}
    </div>
  );

  const listaProblemas = problemas.length > 0 && (
    <details className="mb-2" open={graves.length > 0}>
      <summary className="text-[12.5px] cursor-pointer" style={{ color: graves.length ? "var(--err-ink, #B91C1C)" : "var(--ink3)" }}>
        {graves.length ? `${graves.length} problema(s) impedem ativar` : `${problemas.length} aviso(s)`}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {problemas.map((p, i) => (
          <li key={i}><button type="button" className="text-left text-[12px] hover:underline" style={{ color: p.grave ? "var(--err-ink, #B91C1C)" : "var(--ink2)" }} onClick={() => p.noId && setSel(p.noId)}>{p.grave ? "●" : "○"} {p.mensagem}</button></li>
        ))}
      </ul>
    </details>
  );

  const painel = noSel && (
    <PainelBloco no={noSel} campos={campos} fluxos={fluxos} modelos={modelos} usuarios={usuarios} precisaModelos={precisaModelos}
      onMudar={(novo) => mudarGrafo((g) => {
        // saídas que sumiram (botão apagado) levam junto as setas
        const validas = new Set(saidasDoNo(novo).map((s) => s.id));
        return { nos: g.nos.map((n) => (n.id === novo.id ? novo : n)), ligacoes: g.ligacoes.filter((l) => l.de !== novo.id || validas.has(l.saida)) };
      })}
      onApagar={() => apagarNo(noSel.id)} onDuplicar={() => duplicarNo(noSel.id)} onFechar={() => setSel(null)} />
  );

  // ── CELULAR: lista ──
  if (celular) {
    const ordem = ordemDoFluxo(grafo);
    return (
      <div>
        {barra}{paleta}{listaProblemas}
        <ol className="space-y-2">
          {ordem.map((no) => {
            const st = stats.get(no.id);
            return (
              <li key={no.id} className="mkt-card p-3" style={{ borderLeft: `4px solid ${COR_TIPO[no.tipo]}` }}>
                <button type="button" className="w-full text-left" onClick={() => setSel(no.id)}>
                  <div className="text-[11px] font-bold uppercase" style={{ color: COR_TIPO[no.tipo] }}>{ROTULO_TIPO[no.tipo]}{st ? ` · ${st.entrou} entraram` : ""}</div>
                  <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{no.titulo || resumoDoNo(no)}</div>
                </button>
                {saidasDoNo(no).map((s) => {
                  const l = grafo.ligacoes.find((x) => x.de === no.id && x.saida === s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-2 mt-1.5 text-[12px]" style={{ color: s.secundaria ? "var(--ink3)" : "var(--ink2)" }}>
                      <span className="w-28 truncate">{s.rotulo}{st?.saidas[s.id] ? ` (${st.saidas[s.id]})` : ""} →</span>
                      <select className="mkt-input !py-1 flex-1" value={l?.para ?? ""} onChange={(e) => ligar(no.id, s.id, e.target.value || null)}>
                        <option value="">(nada)</option>
                        {grafo.nos.filter((n) => n.id !== no.id && n.tipo !== "inicio").map((n) => <option key={n.id} value={n.id}>{ROTULO_TIPO[n.tipo]}: {(n.titulo || resumoDoNo(n)).slice(0, 40)}</option>)}
                      </select>
                    </label>
                  );
                })}
              </li>
            );
          })}
        </ol>
        <Modal aberto={!!noSel} titulo={noSel ? ROTULO_TIPO[noSel.tipo] : ""} onFechar={() => setSel(null)} largura={640}>{painel}</Modal>
        <Simulacao resultado={simulacao} grafo={grafo} onFechar={() => setSimulacao(null)} />
      </div>
    );
  }

  // ── COMPUTADOR: canvas ──
  return (
    <div>
      {barra}{paleta}{listaProblemas}
      <div className="flex gap-3" style={{ height: "calc(100vh - 230px)", minHeight: 460 }}>
        <div className="mkt-card flex-1 overflow-auto relative" style={{ background: "var(--bg)", backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: `${20 * zoom}px ${20 * zoom}px` }}
          onPointerDown={(e) => { if (e.target === e.currentTarget || e.target === papelRef.current) { setSel(null); setSetaSel(null); } }}>
          <div ref={papelRef} style={{ width: PAPEL.w, height: PAPEL.h, transform: `scale(${zoom})`, transformOrigin: "0 0", position: "relative" }}>
            <svg width={PAPEL.w} height={PAPEL.h} style={{ position: "absolute", inset: 0 }}>
              {grafo.ligacoes.map((l) => {
                const de = grafo.nos.find((n) => n.id === l.de);
                const para = grafo.nos.find((n) => n.id === l.para);
                if (!de || !para) return null;
                const i = saidasDoNo(de).findIndex((s) => s.id === l.saida);
                if (i < 0) return null;
                const d = curva(posSaida(de, i), posEntrada(para));
                const ativa = setaSel === l.id;
                return (
                  <g key={l.id} onClick={() => setSetaSel(l.id)} style={{ cursor: "pointer" }}>
                    <path d={d} stroke="transparent" strokeWidth={14} fill="none" />
                    <path d={d} stroke={ativa ? "#DC2626" : "var(--ink3)"} strokeWidth={ativa ? 2.5 : 1.6} fill="none" markerEnd="url(#seta)" />
                  </g>
                );
              })}
              {ligando && (() => {
                const de = grafo.nos.find((n) => n.id === ligando.de);
                const i = de ? saidasDoNo(de).findIndex((s) => s.id === ligando.saida) : -1;
                return de && i >= 0 ? <path d={curva(posSaida(de, i), { x: ligando.x, y: ligando.y })} stroke={COR} strokeDasharray="5 4" strokeWidth={2} fill="none" /> : null;
              })()}
              <defs><marker id="seta" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink3)" /></marker></defs>
            </svg>
            {grafo.nos.map((no) => {
              const st = stats.get(no.id);
              const saidas = saidasDoNo(no);
              const temProblema = problemas.some((p) => p.noId === no.id && p.grave);
              return (
                <div key={no.id} data-no-id={no.id} className="absolute rounded-xl shadow-sm select-none"
                  style={{ left: no.x, top: no.y, width: LARGURA, background: "var(--card)", border: `${sel === no.id ? 2 : 1}px solid ${sel === no.id ? COR : temProblema ? "#DC2626" : "var(--line)"}` }}>
                  <span className="absolute rounded-full" style={{ left: -6, top: 14, width: 12, height: 12, background: "var(--card)", border: "2px solid var(--ink3)" }} aria-hidden />
                  <div className="px-3 pt-2 cursor-grab active:cursor-grabbing" style={{ height: TOPO }}
                    onPointerDown={(e) => {
                      const papel = papelRef.current?.getBoundingClientRect();
                      if (!papel) return;
                      arrasto.current = { id: no.id, dx: (e.clientX - papel.left) / zoom - no.x, dy: (e.clientY - papel.top) / zoom - no.y };
                      setSel(no.id); setSetaSel(null);
                    }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: COR_TIPO[no.tipo] }}>{ROTULO_TIPO[no.tipo]}</span>
                      {st && <span className="ml-auto text-[10.5px] font-semibold" style={{ color: "var(--ink3)" }} title="Pessoas que entraram neste bloco">{st.entrou} ▸{st.erros ? ` · ${st.erros} erro` : ""}</span>}
                    </div>
                    <div className="text-[12.5px] leading-tight mt-0.5 overflow-hidden" style={{ color: "var(--ink)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {no.titulo ? <strong>{no.titulo}: </strong> : null}{resumoDoNo(no)}
                    </div>
                  </div>
                  {saidas.map((s) => (
                    <div key={s.id} className="relative flex items-center justify-end pr-4 text-[11.5px] border-t" style={{ height: LINHA, borderColor: "var(--line)", color: s.secundaria ? "var(--ink3)" : "var(--ink2)" }}>
                      <span className="truncate">{s.rotulo}{st?.saidas[s.id] ? ` · ${st.saidas[s.id]}` : ""}</span>
                      <span role="button" tabIndex={0} aria-label={`Ligar a saída ${s.rotulo}`}
                        className="absolute rounded-full cursor-crosshair" style={{ right: -7, top: LINHA / 2 - 7, width: 14, height: 14, background: s.secundaria ? "var(--card)" : COR, border: `2px solid ${COR}` }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const p = posSaida(no, saidas.indexOf(s));
                          setLigando({ de: no.id, saida: s.id, x: p.x, y: p.y });
                        }} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {setaSel && (
            <div className="sticky bottom-3 left-3 inline-flex gap-2 p-2 mkt-card shadow" style={{ background: "var(--card)" }}>
              <Botao variante="perigo" onClick={() => { mudarGrafo((g) => ({ ...g, ligacoes: g.ligacoes.filter((l) => l.id !== setaSel) })); setSetaSel(null); }}>Apagar seta</Botao>
              <Botao variante="fantasma" onClick={() => setSetaSel(null)}>Cancelar</Botao>
            </div>
          )}
        </div>
        {noSel ? (
          <aside className="mkt-card w-[380px] shrink-0 overflow-y-auto p-4">{painel}</aside>
        ) : (
          <aside className="mkt-card w-[280px] shrink-0 p-4 text-[12.5px] space-y-2" style={{ color: "var(--ink2)" }}>
            <strong style={{ color: "var(--ink)" }}>Como usar</strong>
            <p>Arraste o bloco pelo topo. Para ligar, puxe a bolinha da saída até outro bloco. Clique numa seta para apagar.</p>
            <p>Texto, botões e perguntas só saem com a <b>janela de 24 h aberta</b> (a pessoa escreveu nas últimas 24 h). Fluxo que começa pela LP deve começar por um <b>Template</b>.</p>
            <Aviso>Os números em cima de cada bloco são quantas pessoas passaram por ele (desde a criação).</Aviso>
            <div style={{ background: COR_SUAVE }} className="rounded-lg p-2">Os gatilhos (palavra-chave, link, anúncio…) ficam nas outras abas e apontam para este fluxo.</div>
          </aside>
        )}
      </div>
      <Simulacao resultado={simulacao} grafo={grafo} onFechar={() => setSimulacao(null)} />
    </div>
  );
}
