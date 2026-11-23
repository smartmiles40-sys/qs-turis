// src/mkt/automacoes/EditorFluxo.tsx
// -----------------------------------------------------------------------------
// O EDITOR DE FLUXO, feito à mão (o QS não tem @xyflow/react): blocos são divs
// posicionadas num "papel" grande, as setas são um SVG por baixo. Arrastar um
// bloco = pointer events no cabeçalho; ligar = arrastar da bolinha da saída até
// outro bloco (ou, no celular, escolher o destino numa lista).
//
// No celular (< 768 px) o canvas vira LISTA: os blocos na ordem do fluxo, cada
// saída com um seletor "vai para…". Mesma estrutura, outro desenho.
//
// 23/11/2026 — "igual ManyChat", grupo 1 (jeito de montar):
//   • o bloco mostra a mensagem como BALÃO do WhatsApp (texto, mídia, modelo);
//   • vários blocos selecionados (Shift+clique, Shift+arrastar no vazio, Ctrl+A),
//     arrastados juntos; arrastar no vazio move o quadro;
//   • Ctrl+C / Ctrl+V (vale entre fluxos), Ctrl+D duplica, Delete apaga;
//   • Ctrl+Z / Ctrl+Shift+Z (ou Ctrl+Y) desfaz e refaz;
//   • bloco NOTA (só o time vê, o motor ignora);
//   • RASCUNHO × PUBLICADO: fluxo já publicado guarda a edição em
//     grafo_rascunho; quem está no fluxo segue a versão publicada até "Publicar".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { escalaTela } from "@/lib/escala";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  COR_NOTA, ROTULO_TIPO, canalDo, novoId, noPadrao, saidasDoNo, validarGrafo,
  type Acao, type Fluxo, type Grafo, type Ligacao, type No, type TipoNo, type CampoPersonalizado,
} from "./tipos";
import { acao, estatisticas, lerFluxo, listarCampos, listarFluxos, listarModelos, listarUsuarios, salvarFluxo, type EstatBloco, type ModeloMkt } from "./api";
import { Aviso, Botao, COR, COR_SUAVE, Carregando, Chip, Modal } from "./ui";
import PainelBloco from "./PainelBloco";
import Simulacao, { type ResultadoSimulacao } from "./Simulacao";
import RelatorioFluxo from "./RelatorioFluxo";

const LARGURA = 250;
const TOPO = 64;          // cabeçalho + resumo do bloco
const TOPO_PREVIA = 150;  // blocos que mostram o balão (mensagem, template, pergunta)
const LINHA = 26;         // cada saída
const NOTA = { w: 240, h: 130 };
const PAPEL = { w: 4000, h: 3000 };
const HISTORICO_MAX = 100;
const CHAVE_COPIA = "qs_fluxo_copia";

const COR_TIPO: Record<TipoNo, string> = {
  inicio: "#059669", mensagem: "#2563EB", template: "#0891B2", pergunta: "#7C3AED", aguardar: "#D97706",
  condicao: "#DB2777", acao: "#4B5563", randomizador: "#9333EA", ir_para: "#0D9488", fim: "#DC2626", nota: "#CA8A04",
};
const TIPOS_NOVOS: TipoNo[] = ["mensagem", "pergunta", "template", "aguardar", "condicao", "acao", "randomizador", "ir_para", "fim", "nota"];
// 09/11/2026: Instagram não tem Template (modelo aprovado da Meta é só do WhatsApp).
const TIPOS_NOVOS_IG: TipoNo[] = TIPOS_NOVOS.filter((t) => t !== "template");
const COM_PREVIA: TipoNo[] = ["mensagem", "template", "pergunta"];
const topoDe = (no: No) => (COM_PREVIA.includes(no.tipo) ? TOPO_PREVIA : TOPO);

/**
 * 19/11/2026 (0409): o MESMO editor serve o Relacionamento. O adaptador diz de
 * onde o fluxo vem e pra onde vai (rel_fluxos + número do Rel); sem adaptador,
 * é o Marketing de sempre.
 */
export interface AdaptadorFluxo {
  lerFluxo: (id: string) => Promise<Fluxo | null>;
  listarFluxos: () => Promise<Fluxo[]>;
  salvarFluxo: (id: string, patch: Partial<Pick<Fluxo, "grafo" | "status" | "grafo_rascunho">>) => Promise<void>;
  /** filtro = recorte dos números (ex.: um disparo); null = tudo. */
  estatisticas: (id: string, filtro?: string | null) => Promise<Awaited<ReturnType<typeof estatisticas>>>;
  /** 23/11 (0415): opções do "Números de:" na barra (ex.: cada disparo do fluxo). */
  filtrosEstat?: (fluxoId: string) => Promise<{ id: string; rotulo: string }[]>;
  /** Recorte já escolhido ao abrir (ex.: clicou no disparo no Histórico). */
  filtroInicial?: string | null;
  listarModelos: () => Promise<{ modelos?: ModeloMkt[]; erro?: string; aviso?: string }>;
  listarUsuarios: () => Promise<{ id: string; name: string }[]>;
  listarCampos: () => Promise<CampoPersonalizado[]>;
  simular: (fluxoId: string, grafo: Grafo) => Promise<ResultadoSimulacao>;
  testar: (fluxoId: string) => Promise<void>;
  /** Texto do "Testar no meu WhatsApp" (qual número manda). */
  avisoTeste: string;
  /** Sem relatório (o do Marketing lê mkt_*). */
  semRelatorio?: boolean;
  acoesPermitidas?: Acao["tipo"][];
  /** O que o bloco Início diz. */
  resumoInicio?: string;
  ajuda?: ReactNode;
  /** Botões a mais na barra (ex.: "Disparar pra um público"). */
  extraBarra?: (f: Fluxo, sujo: boolean) => ReactNode;
  voltarRotulo?: string;
}

const PADRAO: AdaptadorFluxo = {
  lerFluxo, listarFluxos, salvarFluxo, estatisticas, listarModelos, listarUsuarios, listarCampos,
  simular: (fluxoId, grafo) => acao<ResultadoSimulacao>({ acao: "simular", fluxoId, grafo }),
  testar: async (fluxoId) => { await acao({ acao: "testar", fluxoId }); },
  avisoTeste: "Isto MANDA as mensagens de verdade, pelo número do Marketing, para o WhatsApp cadastrado no seu perfil do QS. A janela de 24 h vale: mande um 'oi' para o número antes, ou comece o fluxo por um Template. Continuar?",
};
let resumoInicioAtual = "Quando um gatilho dispara";

export function resumoDoNo(no: No): string {
  switch (no.tipo) {
    case "inicio": return resumoInicioAtual;
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
    case "nota": return no.dados.texto || "(nota vazia)";
  }
}

const ICONE_MIDIA = { imagem: "📷 Imagem", video: "🎬 Vídeo", audio: "🎧 Áudio", documento: "📄 Documento" } as const;

/** O balão do WhatsApp dentro do bloco (o que a pessoa vai ler). */
function PreviaBalao({ no, modelos, st }: { no: No; modelos: ModeloMkt[] | null; st?: EstatBloco }) {
  // 0415: com números de envio, a faixa Enviado/Entregue/Clicado ocupa o topo do balão (igual ManyChat).
  const envio = st?.envio && (no.tipo === "template" || no.tipo === "mensagem") ? st.envio : null;
  const cliques = envio ? cliquesDoBloco(no, st!) : 0;
  const linhas: ReactNode[] = [];
  if (no.tipo === "mensagem") {
    no.dados.blocos.forEach((b, i) => {
      if (b.tipo === "texto") linhas.push(<div key={i} className="whitespace-pre-wrap">{b.texto || <i style={{ color: "var(--ink3)" }}>(texto vazio)</i>}</div>);
      else linhas.push(<div key={i} className="font-semibold" style={{ color: "var(--ink2)" }}>{ICONE_MIDIA[b.tipo]}{"legenda" in b && b.legenda ? ` · ${b.legenda}` : ""}</div>);
    });
    const it = no.dados.interacao;
    if (it?.tipo === "link") linhas.push(<div key="link" className="mt-1 font-semibold" style={{ color: "#0284C7" }}>🔗 {it.rotulo || "Abrir"}{envio ? <span className="ml-1 font-normal">· CTR {pctTxt(envio.cliques, envio.entregues)}</span> : null}</div>);
    if (it?.tipo === "lista") linhas.push(<div key="lista" className="mt-1 font-semibold" style={{ color: "#0284C7" }}>☰ {it.rotuloBotao || "Ver opções"}</div>);
  } else if (no.tipo === "template") {
    const m = modelos?.find((x) => x.nome === no.dados.nome && x.idioma === no.dados.idioma) ?? modelos?.find((x) => x.nome === no.dados.nome);
    const corpo = m ? m.corpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => no.dados.variaveis?.[n] || `{{${n}}}`) : "";
    linhas.push(no.dados.nome
      ? <div key="t" className="whitespace-pre-wrap">{corpo || `Modelo: ${no.dados.nome}`}</div>
      : <i key="t" style={{ color: "var(--ink3)" }}>(escolha o modelo)</i>);
  } else if (no.tipo === "pergunta") {
    linhas.push(<div key="p" className="whitespace-pre-wrap">{no.dados.pergunta || <i style={{ color: "var(--ink3)" }}>(escreva a pergunta)</i>}</div>);
    if ((no.dados.sugestoes ?? []).length) linhas.push(<div key="s" className="mt-1 font-semibold" style={{ color: "#0284C7" }}>{no.dados.sugestoes!.join(" · ")}</div>);
  }
  return (
    <>
    {envio && (
      <div className="mt-1 grid grid-cols-3 text-center leading-tight" style={{ height: FAIXA }} title={`${envio.enviadas} enviadas · ${envio.entregues} entregues · ${envio.lidas} lidas · ${cliques} clicaram`}>
        <div><div className="text-[13px] font-semibold" style={{ color: "#2563EB" }}>{envio.enviadas}</div><div className="text-[9.5px]" style={{ color: "var(--ink3)" }}>Enviado</div></div>
        <div><div className="text-[13px] font-semibold" style={{ color: "#2563EB" }}>{pctTxt(envio.entregues, envio.enviadas)}</div><div className="text-[9.5px]" style={{ color: "var(--ink3)" }}>Entregue</div></div>
        <div><div className="text-[13px] font-semibold" style={{ color: "#2563EB" }}>{pctTxt(cliques, envio.entregues)}</div><div className="text-[9.5px]" style={{ color: "var(--ink3)" }}>Clicado</div></div>
      </div>
    )}
    <div className="relative mt-1 rounded-lg rounded-tl-none px-2 py-1.5 text-[12px] leading-snug overflow-hidden"
      style={{ height: TOPO_PREVIA - 46 - (envio ? FAIXA + 4 : 0), background: "color-mix(in srgb, #25D366 16%, var(--card))", color: "var(--ink)" }}>
      {linhas}
      <div className="absolute inset-x-0 bottom-0 h-5" style={{ background: "linear-gradient(transparent, color-mix(in srgb, #25D366 16%, var(--card)))" }} />
    </div>
    </>
  );
}

const FAIXA = 30;
/** 12,3% (ou — sem base). */
const pctTxt = (n: number, de: number) => (de > 0 ? `${((n / de) * 100).toFixed(1).replace(".", ",")}%` : "—");
/** Quem clicou no bloco: botões (saídas botao_*) + link rastreado. */
function cliquesDoBloco(no: No, st: EstatBloco) {
  const botoes = Object.entries(st.saidas).filter(([k]) => k.startsWith("botao_") || (no.tipo === "mensagem" && !["proximo", "sem_resposta", "falha", "pulou"].includes(k))).reduce((a, [, v]) => a + v, 0);
  return botoes + (st.envio?.cliques ?? 0);
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

/** Copia blocos (e as setas entre eles) com ids novos, deslocados. O Início nunca é copiado. */
export function colarBlocos(copia: { nos: No[]; ligacoes: Ligacao[] }, deslocar = 40): { nos: No[]; ligacoes: Ligacao[] } {
  const mapa = new Map<string, string>();
  const nos = copia.nos.filter((n) => n.tipo !== "inicio").map((n) => {
    const id = novoId(n.tipo.slice(0, 3));
    mapa.set(n.id, id);
    return { ...JSON.parse(JSON.stringify(n)), id, x: n.x + deslocar, y: n.y + deslocar } as No;
  });
  const ligacoes = copia.ligacoes
    .filter((l) => mapa.has(l.de) && mapa.has(l.para))
    .map((l) => ({ id: novoId("l"), de: mapa.get(l.de) as string, saida: l.saida, para: mapa.get(l.para) as string }));
  return { nos, ligacoes };
}

const digitando = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
};

type Arrasto =
  | { tipo: "blocos"; ids: string[]; px0: number; py0: number; pos0: Record<string, { x: number; y: number }>; registrado: boolean }
  | { tipo: "quadro"; cx0: number; cy0: number; sl0: number; st0: number }
  | { tipo: "laco"; px0: number; py0: number; px: number; py: number; somar: boolean };

export default function EditorFluxo({ fluxoId, onVoltar, adaptador }: { fluxoId: string; onVoltar: () => void; adaptador?: AdaptadorFluxo }) {
  const api = adaptador ?? PADRAO;
  resumoInicioAtual = api.resumoInicio ?? "Quando um gatilho dispara";
  const celular = useCelular();
  const [fluxo, setFluxo] = useState<Fluxo | null>(null);
  const [grafo, setGrafoEstado] = useState<Grafo>({ nos: [], ligacoes: [] });
  const [sujo, setSujo] = useState(false);
  const [selecao, setSelecao] = useState<string[]>([]);
  const [setaSel, setSetaSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [campos, setCampos] = useState<CampoPersonalizado[]>([]);
  const [fluxos, setFluxos] = useState<Fluxo[]>([]);
  const [modelos, setModelos] = useState<ModeloMkt[] | null>(null);
  const [usuarios, setUsuarios] = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof estatisticas>>>(new Map());
  const [filtro, setFiltro] = useState<string | null>(adaptador?.filtroInicial ?? null);
  const [opcoesFiltro, setOpcoesFiltro] = useState<{ id: string; rotulo: string }[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [simulacao, setSimulacao] = useState<ResultadoSimulacao | null>(null);
  const [ligando, setLigando] = useState<{ de: string; saida: string; x: number; y: number } | null>(null);
  const [laco, setLaco] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [relatorio, setRelatorio] = useState(false);
  const [, setVersaoHist] = useState(0);
  const papelRef = useRef<HTMLDivElement>(null);
  const telaRef = useRef<HTMLDivElement>(null);
  const arrasto = useRef<Arrasto | null>(null);
  const grafoRef = useRef(grafo);
  const hist = useRef<{ passado: Grafo[]; futuro: Grafo[]; ultimo: number }>({ passado: [], futuro: [], ultimo: 0 });
  // 23/11/2026: onVoltar chega como arrow nova a cada render do pai. Estava nas
  // deps do carregamento → qualquer re-render da tela (ex.: bolinhas do menu do
  // Rel se atualizando) relia o fluxo do banco e APAGAVA o que não foi salvo
  // (o template escolhido "sumia" depois de uns segundos). Recarrega só ao trocar de fluxo.
  const onVoltarRef = useRef(onVoltar);
  onVoltarRef.current = onVoltar;

  const sel = selecao.length === 1 ? selecao[0] : null;
  const setSel = (id: string | null) => setSelecao(id ? [id] : []);
  const setGrafo = useCallback((g: Grafo) => { grafoRef.current = g; setGrafoEstado(g); }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [f, cs, fs, us, st] = await Promise.all([api.lerFluxo(fluxoId), api.listarCampos().catch(() => []), api.listarFluxos().catch(() => []), api.listarUsuarios().catch(() => []), api.estatisticas(fluxoId, filtro).catch(() => new Map())]);
        if (!vivo) return;
        if (!f) { notifyError("Fluxo não encontrado."); onVoltarRef.current(); return; }
        setFluxo(f);
        const base = f.grafo_rascunho ?? f.grafo;
        setGrafo({ nos: base?.nos ?? [], ligacoes: base?.ligacoes ?? [] });
        hist.current = { passado: [], futuro: [], ultimo: 0 };
        // ir_para só entre fluxos do MESMO canal (a conversa é de um canal só).
        setCampos(cs); setFluxos(fs.filter((x) => x.id !== fluxoId && canalDo(x) === canalDo(f))); setUsuarios(us); setStats(st);
      } catch (e) {
        notifyError(e instanceof Error ? e.message : "Não consegui abrir o fluxo.");
        // 04/11/2026: sem isso o editor ficava em "Carregando…" pra sempre; volta pra lista.
        if (vivo) onVoltarRef.current();
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fluxoId]);

  // 0415: números ao vivo (30 s) e no recorte escolhido ("Números de:").
  useEffect(() => {
    let vivo = true;
    const ler = () => void api.estatisticas(fluxoId, filtro).then((st) => { if (vivo) setStats(st); }).catch(() => null);
    ler();
    const t = setInterval(ler, 30_000);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fluxoId, filtro]);
  useEffect(() => {
    if (!api.filtrosEstat) return;
    void api.filtrosEstat(fluxoId).then(setOpcoesFiltro).catch(() => setOpcoesFiltro([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fluxoId]);

  // Os modelos só são buscados quando há (ou abrem) um bloco Template — o balão precisa do texto.
  const precisaModelos = useCallback(() => {
    if (modelos !== null) return;
    setModelos([]);
    api.listarModelos().then((r) => { setModelos(r.modelos ?? []); if (r.erro || r.aviso) notifyError(r.erro || r.aviso || ""); }).catch(() => setModelos([]));
  }, [modelos, api]);
  useEffect(() => { if (fluxo && grafoRef.current.nos.some((n) => n.tipo === "template")) precisaModelos(); }, [fluxo, precisaModelos]);

  // ── desfazer / refazer ──
  /** Guarda o grafo de agora no histórico. `agrupar`: digitação seguida vira um passo só. */
  const registrar = useCallback((agrupar = false) => {
    const h = hist.current;
    const agora = Date.now();
    if (agrupar && agora - h.ultimo < 800) { h.ultimo = agora; return; }
    h.passado.push(grafoRef.current);
    if (h.passado.length > HISTORICO_MAX) h.passado.shift();
    h.futuro = [];
    h.ultimo = agrupar ? agora : 0;
    setVersaoHist((v) => v + 1);
  }, []);
  const mudarGrafo = useCallback((f: (g: Grafo) => Grafo, agrupar = false) => {
    registrar(agrupar);
    setGrafo(f(grafoRef.current));
    setSujo(true);
  }, [registrar, setGrafo]);
  const desfazer = useCallback(() => {
    const h = hist.current;
    const g = h.passado.pop();
    if (!g) return;
    h.futuro.push(grafoRef.current);
    h.ultimo = 0;
    setGrafo(g); setSujo(true); setVersaoHist((v) => v + 1);
  }, [setGrafo]);
  const refazer = useCallback(() => {
    const h = hist.current;
    const g = h.futuro.pop();
    if (!g) return;
    h.passado.push(grafoRef.current);
    h.ultimo = 0;
    setGrafo(g); setSujo(true); setVersaoHist((v) => v + 1);
  }, [setGrafo]);

  const canal = canalDo(fluxo);
  const problemas = useMemo(() => validarGrafo(grafo, canal), [grafo, canal]);
  const graves = problemas.filter((p) => p.grave);
  const noSel = grafo.nos.find((n) => n.id === sel) ?? null;
  const temRascunho = !!fluxo?.grafo_rascunho;
  const publicado = fluxo ? fluxo.status !== "rascunho" : false;

  function centroDaTela() {
    const el = telaRef.current;
    return {
      x: el ? (el.scrollLeft + el.clientWidth / 2) / zoom - LARGURA / 2 : 400,
      y: el ? (el.scrollTop + el.clientHeight / 3) / zoom : 200,
    };
  }

  function adicionar(tipo: TipoNo) {
    const c = centroDaTela();
    const no = noPadrao(tipo, Math.max(10, Math.round(c.x)), Math.max(10, Math.round(c.y)));
    mudarGrafo((g) => ({ ...g, nos: [...g.nos, no] }));
    setSel(no.id);
  }

  function ligar(de: string, saida: string, para: string | null) {
    if (de === para) return;
    if (para && grafoRef.current.nos.find((n) => n.id === para)?.tipo === "nota") return;
    mudarGrafo((g) => ({
      ...g,
      ligacoes: [...g.ligacoes.filter((l) => !(l.de === de && l.saida === saida)), ...(para ? [{ id: novoId("l"), de, saida, para }] : [])],
    }));
  }

  const apagarBlocos = useCallback((ids: string[]) => {
    const alvo = new Set(ids.filter((id) => grafoRef.current.nos.find((n) => n.id === id)?.tipo !== "inicio"));
    if (!alvo.size) return;
    mudarGrafo((g) => ({ nos: g.nos.filter((n) => !alvo.has(n.id)), ligacoes: g.ligacoes.filter((l) => !alvo.has(l.de) && !alvo.has(l.para)) }));
    setSelecao([]);
  }, [mudarGrafo]);

  const copiar = useCallback((ids: string[]) => {
    const g = grafoRef.current;
    const set = new Set(ids);
    const nos = g.nos.filter((n) => set.has(n.id) && n.tipo !== "inicio");
    if (!nos.length) return false;
    const ligacoes = g.ligacoes.filter((l) => set.has(l.de) && set.has(l.para));
    try { localStorage.setItem(CHAVE_COPIA, JSON.stringify({ nos, ligacoes })); } catch { /* sem storage */ }
    return true;
  }, []);

  const colar = useCallback(() => {
    let copia: { nos: No[]; ligacoes: Ligacao[] } | null = null;
    try { copia = JSON.parse(localStorage.getItem(CHAVE_COPIA) || "null"); } catch { copia = null; }
    if (!copia?.nos?.length) return;
    const novos = colarBlocos(copia);
    if (!novos.nos.length) return;
    mudarGrafo((g) => ({ nos: [...g.nos, ...novos.nos], ligacoes: [...g.ligacoes, ...novos.ligacoes] }));
    setSelecao(novos.nos.map((n) => n.id));
  }, [mudarGrafo]);

  const duplicar = useCallback((ids: string[]) => {
    const g = grafoRef.current;
    const set = new Set(ids);
    const novos = colarBlocos({ nos: g.nos.filter((n) => set.has(n.id)), ligacoes: g.ligacoes.filter((l) => set.has(l.de) && set.has(l.para)) }, 30);
    if (!novos.nos.length) return;
    mudarGrafo((gg) => ({ nos: [...gg.nos, ...novos.nos], ligacoes: [...gg.ligacoes, ...novos.ligacoes] }));
    setSelecao(novos.nos.map((n) => n.id));
  }, [mudarGrafo]);

  // ── teclado ──
  const modalAberto = !!simulacao || relatorio;
  useEffect(() => {
    if (celular) return;
    const tecla = (e: KeyboardEvent) => {
      if (modalAberto || digitando(e)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "z" && !e.shiftKey) { e.preventDefault(); desfazer(); return; }
      if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); refazer(); return; }
      if (ctrl && k === "a") { e.preventDefault(); setSelecao(grafoRef.current.nos.map((n) => n.id)); return; }
      if (ctrl && k === "c" && selecao.length) { if (copiar(selecao)) { e.preventDefault(); notifySuccess(`${selecao.length} bloco(s) copiado(s). Ctrl+V cola (aqui ou noutro fluxo).`); } return; }
      if (ctrl && k === "v") { e.preventDefault(); colar(); return; }
      if (ctrl && k === "d" && selecao.length) { e.preventDefault(); duplicar(selecao); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && (selecao.length || setaSel)) {
        e.preventDefault();
        if (setaSel) { mudarGrafo((g) => ({ ...g, ligacoes: g.ligacoes.filter((l) => l.id !== setaSel) })); setSetaSel(null); return; }
        if (selecao.length > 1 && !window.confirm(`Apagar ${selecao.length} blocos e as setas deles?`)) return;
        apagarBlocos(selecao);
        return;
      }
      if (e.key === "Escape") { setSelecao([]); setSetaSel(null); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [celular, modalAberto, selecao, setaSel, desfazer, refazer, copiar, colar, duplicar, apagarBlocos, mudarGrafo]);

  // ── arrastar bloco(s) / mover o quadro / laço de seleção / ligar seta ──
  const pontoNoPapel = (clientX: number, clientY: number) => {
    const papel = papelRef.current?.getBoundingClientRect();
    if (!papel) return null;
    return { px: (clientX - papel.left) / (zoom * escalaTela()), py: (clientY - papel.top) / (zoom * escalaTela()) };
  };

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      const a = arrasto.current;
      if (a?.tipo === "quadro") {
        const el = telaRef.current;
        if (el) { el.scrollLeft = a.sl0 - (e.clientX - a.cx0); el.scrollTop = a.st0 - (e.clientY - a.cy0); }
        return;
      }
      const p = pontoNoPapel(e.clientX, e.clientY);
      if (!p) return;
      if (a?.tipo === "blocos") {
        const dx = p.px - a.px0;
        const dy = p.py - a.py0;
        if (!a.registrado) { if (Math.abs(dx) + Math.abs(dy) < 2) return; registrar(); a.registrado = true; }
        const g = grafoRef.current;
        setGrafo({ ...g, nos: g.nos.map((n) => (a.pos0[n.id] ? { ...n, x: Math.max(0, Math.round(a.pos0[n.id].x + dx)), y: Math.max(0, Math.round(a.pos0[n.id].y + dy)) } : n)) });
        setSujo(true);
      }
      if (a?.tipo === "laco") {
        a.px = p.px; a.py = p.py;
        setLaco({ x: Math.min(a.px0, p.px), y: Math.min(a.py0, p.py), w: Math.abs(p.px - a.px0), h: Math.abs(p.py - a.py0) });
      }
      if (ligando) setLigando((l) => (l ? { ...l, x: p.px, y: p.py } : l));
    };
    const soltar = (e: PointerEvent) => {
      const a = arrasto.current;
      arrasto.current = null;
      if (a?.tipo === "laco") {
        setLaco(null);
        const x1 = Math.min(a.px0, a.px); const x2 = Math.max(a.px0, a.px);
        const y1 = Math.min(a.py0, a.py); const y2 = Math.max(a.py0, a.py);
        if (x2 - x1 < 4 && y2 - y1 < 4) { if (!a.somar) setSelecao([]); setSetaSel(null); }
        else {
          const dentro = grafoRef.current.nos.filter((n) => {
            const w = n.tipo === "nota" ? NOTA.w : LARGURA;
            const h = n.tipo === "nota" ? NOTA.h : topoDe(n) + saidasDoNo(n).length * LINHA;
            return n.x < x2 && n.x + w > x1 && n.y < y2 && n.y + h > y1;
          }).map((n) => n.id);
          setSelecao((s) => (a.somar ? [...new Set([...s, ...dentro])] : dentro));
        }
      }
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

  function pegarBloco(e: React.PointerEvent, no: No) {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSetaSel(null);
    if (e.shiftKey) {
      setSelecao((s) => (s.includes(no.id) ? s.filter((x) => x !== no.id) : [...s, no.id]));
      return;
    }
    const ids = selecao.includes(no.id) ? selecao : [no.id];
    if (!selecao.includes(no.id)) setSelecao([no.id]);
    const p = pontoNoPapel(e.clientX, e.clientY);
    if (!p) return;
    const pos0: Record<string, { x: number; y: number }> = {};
    for (const n of grafoRef.current.nos) if (ids.includes(n.id)) pos0[n.id] = { x: n.x, y: n.y };
    arrasto.current = { tipo: "blocos", ids, px0: p.px, py0: p.py, pos0, registrado: false };
  }

  function pegarQuadro(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const vazio = t === e.currentTarget || t === papelRef.current || t.tagName.toLowerCase() === "svg";
    if (!vazio) return;
    if (e.shiftKey) {
      const p = pontoNoPapel(e.clientX, e.clientY);
      if (!p) return;
      arrasto.current = { tipo: "laco", px0: p.px, py0: p.py, px: p.px, py: p.py, somar: true };
      return;
    }
    const el = telaRef.current;
    if (!el) return;
    setSelecao([]); setSetaSel(null);
    arrasto.current = { tipo: "quadro", cx0: e.clientX, cy0: e.clientY, sl0: el.scrollLeft, st0: el.scrollTop };
  }

  // ── gravar: rascunho × publicado ──
  type Modo = "salvar" | "publicar" | "ativar" | "pausar" | "descartar";
  async function gravar(modo: Modo) {
    if (!fluxo) return;
    if ((modo === "publicar" || modo === "ativar") && graves.length) { notifyError(`Corrija ${graves.length} problema(s) antes de ${modo === "ativar" ? "ativar" : "publicar"}.`); return; }
    if (modo === "descartar" && !window.confirm("Descartar o rascunho e voltar pra versão publicada?")) return;
    let patch: Partial<Pick<Fluxo, "grafo" | "status" | "grafo_rascunho">>;
    if (modo === "salvar") patch = publicado ? { grafo_rascunho: grafo } : { grafo };
    else if (modo === "publicar") patch = { grafo, grafo_rascunho: null };
    else if (modo === "ativar") patch = { grafo, grafo_rascunho: null, status: "ativo" };
    else if (modo === "pausar") patch = { status: "pausado", ...(sujo ? { grafo_rascunho: grafo } : {}) };
    else patch = { grafo_rascunho: null };
    setOcupado(true);
    try {
      await api.salvarFluxo(fluxo.id, patch);
      const novo: Fluxo = { ...fluxo, ...patch };
      setFluxo(novo);
      if (modo === "descartar") { setGrafo({ nos: fluxo.grafo?.nos ?? [], ligacoes: fluxo.grafo?.ligacoes ?? [] }); hist.current = { passado: [], futuro: [], ultimo: 0 }; setSelecao([]); }
      if (modo !== "pausar" || sujo) setSujo(false);
      notifySuccess({
        salvar: publicado ? "Rascunho salvo. Quem já está no fluxo segue a versão publicada até você clicar em Publicar." : "Fluxo salvo.",
        publicar: "Publicado: daqui pra frente o fluxo anda nesta versão.",
        ativar: "Fluxo publicado e ativo.",
        pausar: "Fluxo pausado.",
        descartar: "Rascunho descartado.",
      }[modo]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui salvar.";
      notifyError(/grafo_rascunho/.test(msg) ? "O banco ainda não tem o rascunho (migration 0410). Avise o Bruno." : msg);
    } finally { setOcupado(false); }
  }

  async function simular() {
    setOcupado(true);
    try { setSimulacao(await api.simular(fluxoId, grafo)); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não consegui simular."); }
    finally { setOcupado(false); }
  }

  async function testarNoMeuWhatsApp() {
    if (sujo) { notifyError("Salve o fluxo antes de testar."); return; }
    if (temRascunho && !window.confirm("O teste usa a versão PUBLICADA (o rascunho ainda não vale). Testar mesmo assim?")) return;
    if (!window.confirm(api.avisoTeste)) return;
    setOcupado(true);
    try { await api.testar(fluxoId); notifySuccess("Teste iniciado — confira seu WhatsApp."); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não consegui testar."); }
    finally { setOcupado(false); }
  }

  if (!fluxo) return <Carregando />;

  const posSaida = (no: No, i: number) => ({ x: no.x + LARGURA, y: no.y + topoDe(no) + i * LINHA + LINHA / 2 });
  const posEntrada = (no: No) => ({ x: no.x, y: no.y + 20 });
  const curva = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };
  const podeDesfazer = hist.current.passado.length > 0;
  const podeRefazer = hist.current.futuro.length > 0;

  const barra = (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <Botao variante="fantasma" onClick={() => { if (!sujo || window.confirm("Sair sem salvar?")) onVoltar(); }}>← {api.voltarRotulo ?? "Fluxos"}</Botao>
      <strong className="text-[15px] mr-1" style={{ color: "var(--ink)" }}>{fluxo.nome}</strong>
      <Chip cor={fluxo.status === "ativo" ? "#059669" : fluxo.status === "pausado" ? "#D97706" : "#6B7280"}>{fluxo.status}</Chip>
      {canal === "instagram" && <Chip cor="#C13584">Instagram</Chip>}
      {sujo && <Chip cor="#D97706">não salvo</Chip>}
      {publicado && (temRascunho || sujo) && <Chip cor="#7C3AED">rascunho não publicado</Chip>}
      <div className="flex-1" />
      {!celular && (
        <span className="flex gap-0.5">
          <Botao variante="fantasma" onClick={desfazer} disabled={!podeDesfazer} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">↶</Botao>
          <Botao variante="fantasma" onClick={refazer} disabled={!podeRefazer} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">↷</Botao>
        </span>
      )}
      <Botao onClick={() => void simular()} disabled={ocupado} title="Anda pelo fluxo e mostra o que sairia — não manda nada">Simular</Botao>
      {!api.semRelatorio && <Botao onClick={() => setRelatorio(true)} title="Quantos começaram, onde param, cliques por botão">Relatório</Botao>}
      {canal === "whatsapp" && <Botao onClick={() => void testarNoMeuWhatsApp()} disabled={ocupado}>Testar no meu WhatsApp</Botao>}
      {!publicado ? (
        <>
          <Botao onClick={() => void gravar("salvar")} disabled={ocupado || !sujo}>Salvar</Botao>
          <Botao variante="primario" onClick={() => void gravar("ativar")} disabled={ocupado}>Salvar e ativar</Botao>
        </>
      ) : (
        <>
          <Botao onClick={() => void gravar("salvar")} disabled={ocupado || !sujo} title="Guarda sem mexer em quem já está no fluxo">Salvar rascunho</Botao>
          {temRascunho && !sujo && <Botao variante="fantasma" onClick={() => void gravar("descartar")} disabled={ocupado}>Descartar rascunho</Botao>}
          {fluxo.status === "ativo"
            ? <>
                <Botao onClick={() => void gravar("pausar")} disabled={ocupado}>Pausar</Botao>
                <Botao variante="primario" onClick={() => void gravar("publicar")} disabled={ocupado || (!sujo && !temRascunho)} title="A versão em edição passa a valer">Publicar</Botao>
              </>
            : <Botao variante="primario" onClick={() => void gravar("ativar")} disabled={ocupado}>Publicar e ativar</Botao>}
        </>
      )}
      {api.extraBarra?.(fluxo, sujo)}
      {api.filtrosEstat && (
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink3)" }}>
          Números de:
          <select className="mkt-input" style={{ width: "auto", padding: "4px 8px" }} value={filtro ?? ""} onChange={(e) => setFiltro(e.target.value || null)}>
            <option value="">Todos os envios</option>
            {opcoesFiltro.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
        </label>
      )}
    </div>
  );

  const paleta = (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {(canal === "instagram" ? TIPOS_NOVOS_IG : TIPOS_NOVOS).map((t) => (
        <button key={t} type="button" onClick={() => adicionar(t)} className="px-2.5 py-1 rounded-md text-[12px] font-semibold" style={{ background: `${COR_TIPO[t]}18`, color: COR_TIPO[t] }}>
          + {ROTULO_TIPO[t]}
        </button>
      ))}
      {!celular && (
        <span className="ml-auto flex gap-1">
          {selecao.length > 1 && (
            <>
              <span className="text-[12px] self-center mr-1" style={{ color: "var(--ink2)" }}>{selecao.length} selecionados</span>
              <Botao variante="fantasma" onClick={() => duplicar(selecao)}>Duplicar</Botao>
              <Botao variante="fantasma" onClick={() => { if (copiar(selecao)) notifySuccess("Copiados. Ctrl+V cola (aqui ou noutro fluxo)."); }}>Copiar</Botao>
              <Botao variante="perigo" onClick={() => { if (window.confirm(`Apagar ${selecao.length} blocos?`)) apagarBlocos(selecao); }}>Apagar</Botao>
            </>
          )}
          <Botao variante="fantasma" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} aria-label="Diminuir">−</Botao>
          <span className="text-[12px] self-center" style={{ color: "var(--ink3)" }}>{Math.round(zoom * 100)}%</span>
          <Botao variante="fantasma" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="Aumentar">+</Botao>
        </span>
      )}
    </div>
  );

  const ajudaIg = canal === "instagram" && (
    <p className="mb-2 text-[12px]" style={{ color: "var(--ink3)" }}>
      Instagram: até 13 respostas rápidas, botões só de link (até 3), texto até 1000 caracteres. Se o fluxo começou num comentário, a 1ª mensagem vai como
      resposta privada (uma só, até 7 dias); o resto segue quando a pessoa responder.
    </p>
  );

  const relatorioModal = relatorio && <RelatorioFluxo fluxoId={fluxo.id} nome={fluxo.nome} grafo={grafo} onFechar={() => setRelatorio(false)} />;

  const listaProblemas = problemas.length > 0 && (
    <details className="mb-2" open={graves.length > 0}>
      <summary className="text-[12.5px] cursor-pointer" style={{ color: graves.length ? "var(--err-ink, #B91C1C)" : "var(--ink3)" }}>
        {graves.length ? `${graves.length} problema(s) impedem ${publicado ? "publicar" : "ativar"}` : `${problemas.length} aviso(s)`}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {problemas.map((p, i) => (
          <li key={i}><button type="button" className="text-left text-[12px] hover:underline" style={{ color: p.grave ? "var(--err-ink, #B91C1C)" : "var(--ink2)" }} onClick={() => p.noId && setSel(p.noId)}>{p.grave ? "●" : "○"} {p.mensagem}</button></li>
        ))}
      </ul>
    </details>
  );

  const painel = noSel && (
    <PainelBloco no={noSel} campos={campos} fluxos={fluxos} modelos={modelos} usuarios={usuarios} precisaModelos={precisaModelos} acoesPermitidas={api.acoesPermitidas}
      onMudar={(novo) => mudarGrafo((g) => {
        // saídas que sumiram (botão apagado) levam junto as setas
        const validas = new Set(saidasDoNo(novo).map((s) => s.id));
        return { nos: g.nos.map((n) => (n.id === novo.id ? novo : n)), ligacoes: g.ligacoes.filter((l) => l.de !== novo.id || validas.has(l.saida)) };
      }, true)}
      onApagar={() => apagarBlocos([noSel.id])} onDuplicar={() => duplicar([noSel.id])} onFechar={() => setSel(null)} />
  );

  // ── CELULAR: lista ──
  if (celular) {
    const ordem = ordemDoFluxo(grafo);
    return (
      <div>
        {barra}{paleta}{ajudaIg}{listaProblemas}
        <ol className="space-y-2">
          {ordem.map((no) => {
            const st = stats.get(no.id);
            return (
              <li key={no.id} className="mkt-card p-3" style={{ borderLeft: `4px solid ${COR_TIPO[no.tipo]}`, ...(no.tipo === "nota" ? { background: COR_NOTA[no.dados.cor ?? "amarelo"], color: "#1F2937" } : {}) }}>
                <button type="button" className="w-full text-left" onClick={() => setSel(no.id)}>
                  <div className="text-[11px] font-bold uppercase" style={{ color: COR_TIPO[no.tipo] }}>{ROTULO_TIPO[no.tipo]}{st ? ` · ${st.entrou} entraram` : ""}</div>
                  <div className="text-[13px] font-semibold whitespace-pre-wrap" style={{ color: no.tipo === "nota" ? "#1F2937" : "var(--ink)" }}>{no.titulo || resumoDoNo(no)}</div>
                </button>
                {saidasDoNo(no).map((s) => {
                  const l = grafo.ligacoes.find((x) => x.de === no.id && x.saida === s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-2 mt-1.5 text-[12px]" style={{ color: s.secundaria ? "var(--ink3)" : "var(--ink2)" }}>
                      <span className="w-28 truncate">{s.rotulo}{st?.saidas[s.id] ? ` (${st.saidas[s.id]})` : ""} →</span>
                      <select className="mkt-input !py-1 flex-1" value={l?.para ?? ""} onChange={(e) => ligar(no.id, s.id, e.target.value || null)}>
                        <option value="">(nada)</option>
                        {grafo.nos.filter((n) => n.id !== no.id && n.tipo !== "inicio" && n.tipo !== "nota").map((n) => <option key={n.id} value={n.id}>{ROTULO_TIPO[n.tipo]}: {(n.titulo || resumoDoNo(n)).slice(0, 40)}</option>)}
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
        {relatorioModal}
      </div>
    );
  }

  // ── COMPUTADOR: canvas ──
  const selSet = new Set(selecao);
  return (
    <div>
      {barra}{paleta}{ajudaIg}{listaProblemas}
      <div className="flex gap-3" style={{ height: "calc(calc(100vh/var(--qs-zoom,1)) - 230px)", minHeight: 460 }}>
        <div ref={telaRef} className="mkt-card flex-1 overflow-auto relative" style={{ background: "var(--bg)", backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: `${20 * zoom}px ${20 * zoom}px`, cursor: arrasto.current?.tipo === "quadro" ? "grabbing" : "default" }}
          onPointerDown={pegarQuadro}>
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
                  <g key={l.id} onPointerDown={(e) => { e.stopPropagation(); setSetaSel(l.id); setSelecao([]); }} style={{ cursor: "pointer" }}>
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
              const marcado = selSet.has(no.id);
              if (no.tipo === "nota") {
                return (
                  <div key={no.id} data-no-id={no.id} className="absolute rounded-lg shadow select-none cursor-grab active:cursor-grabbing p-2.5 overflow-hidden"
                    style={{ left: no.x, top: no.y, width: NOTA.w, height: NOTA.h, background: COR_NOTA[no.dados.cor ?? "amarelo"], color: "#1F2937", outline: marcado ? `2px solid ${COR}` : "none" }}
                    onPointerDown={(e) => pegarBloco(e, no)}>
                    <div className="text-[10px] font-bold uppercase tracking-wide opacity-60">Nota</div>
                    <div className="text-[12.5px] leading-snug whitespace-pre-wrap">{no.dados.texto || <i className="opacity-60">(clique e escreva no painel)</i>}</div>
                  </div>
                );
              }
              const st = stats.get(no.id);
              const saidas = saidasDoNo(no);
              const temProblema = problemas.some((p) => p.noId === no.id && p.grave);
              const topo = topoDe(no);
              return (
                <div key={no.id} data-no-id={no.id} className="absolute rounded-xl shadow-sm select-none"
                  style={{ left: no.x, top: no.y, width: LARGURA, background: "var(--card)", border: `${marcado ? 2 : 1}px solid ${marcado ? COR : temProblema ? "#DC2626" : "var(--line)"}` }}>
                  <span className="absolute rounded-full" style={{ left: -6, top: 14, width: 12, height: 12, background: "var(--card)", border: "2px solid var(--ink3)" }} aria-hidden />
                  <div className="px-3 pt-2 cursor-grab active:cursor-grabbing" style={{ height: topo }} onPointerDown={(e) => pegarBloco(e, no)}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: COR_TIPO[no.tipo] }}>{ROTULO_TIPO[no.tipo]}</span>
                      {st && <span className="ml-auto text-[10.5px] font-semibold whitespace-nowrap" style={{ color: "var(--ink3)" }} title={tituloEstat(st)}>{st.entrou} ▸{st.envio?.enviadas ? ` · ✓✓${st.envio.entregues} · 👁${st.envio.lidas}${st.envio.cliques ? ` · 🔗${st.envio.cliques}` : ""}` : ""}{st.erros ? ` · ${st.erros} erro` : ""}</span>}
                    </div>
                    {COM_PREVIA.includes(no.tipo) ? (
                      <>
                        <div className="text-[12px] font-semibold truncate" style={{ color: "var(--ink)" }}>{no.titulo || " "}</div>
                        <PreviaBalao no={no} modelos={modelos} st={st} />
                      </>
                    ) : (
                      <div className="text-[12.5px] leading-tight mt-0.5 overflow-hidden" style={{ color: "var(--ink)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {no.titulo ? <strong>{no.titulo}: </strong> : null}{resumoDoNo(no)}
                      </div>
                    )}
                  </div>
                  {saidas.map((s) => {
                    const botao = !s.secundaria && (no.tipo === "template" ? s.id.startsWith("botao_") : no.tipo === "mensagem" && (no.dados.interacao?.tipo === "botoes" || no.dados.interacao?.tipo === "lista"));
                    const pct = st?.entrou && st.saidas[s.id] ? Math.round((st.saidas[s.id] / st.entrou) * 100) : null;
                    const ctr = botao && st?.envio?.entregues ? pctTxt(st.saidas[s.id] ?? 0, st.envio.entregues) : null;
                    const raio = ((no.dados as { acoesSaida?: Record<string, unknown[]> }).acoesSaida?.[s.id]?.length ?? 0) > 0 ? "⚡ " : "";
                    return (
                      <div key={s.id} className="relative flex items-center justify-end pr-4 text-[11.5px] border-t" style={{ height: LINHA, borderColor: "var(--line)", color: s.secundaria ? "var(--ink3)" : "var(--ink2)" }}>
                        {botao
                          ? <span className="mx-2 flex-1 truncate rounded-md text-center font-semibold" style={{ color: "#0284C7", background: "color-mix(in srgb, #0284C7 8%, var(--card))" }}>{raio}{s.rotulo}{ctr ? <span className="font-normal"> · CTR {ctr}</span> : st?.saidas[s.id] ? ` · ${st.saidas[s.id]}${pct !== null ? ` (${pct}%)` : ""}` : ""}</span>
                          : <span className="truncate">{raio}{s.rotulo}{st?.saidas[s.id] ? ` · ${st.saidas[s.id]}` : ""}</span>}
                        <span role="button" tabIndex={0} aria-label={`Ligar a saída ${s.rotulo}`}
                          className="absolute rounded-full cursor-crosshair" style={{ right: -7, top: LINHA / 2 - 7, width: 14, height: 14, background: s.secundaria ? "var(--card)" : COR, border: `2px solid ${COR}` }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const p = posSaida(no, saidas.indexOf(s));
                            setLigando({ de: no.id, saida: s.id, x: p.x, y: p.y });
                          }} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {laco && <div className="absolute pointer-events-none rounded" style={{ left: laco.x, top: laco.y, width: laco.w, height: laco.h, border: `1.5px dashed ${COR}`, background: "color-mix(in srgb, #BE185D 8%, transparent)" }} />}
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
          <aside className="mkt-card w-[280px] shrink-0 overflow-y-auto p-4 text-[12.5px] space-y-2" style={{ color: "var(--ink2)" }}>
            <strong style={{ color: "var(--ink)" }}>Como usar</strong>
            <p>Arraste o bloco pelo topo. Para ligar, puxe a bolinha da saída até outro bloco. Clique numa seta para apagar.</p>
            {api.ajuda ?? <>
            <p>Texto, botões e perguntas só saem com a <b>janela de 24 h aberta</b> (a pessoa escreveu nas últimas 24 h). {canal === "instagram" ? "No Instagram não existe Template: o fluxo só começa quando a pessoa comenta, manda DM ou abre o link." : <>Fluxo que começa pela LP deve começar por um <b>Template</b>.</>}</p>
            <Aviso>Os números em cima de cada bloco são quantas pessoas passaram por ele (desde a criação).</Aviso>
            <div style={{ background: COR_SUAVE }} className="rounded-lg p-2">Os gatilhos (palavra-chave, link, anúncio…) ficam nas outras abas e apontam para este fluxo.</div>
            </>}
            <details>
              <summary className="cursor-pointer font-semibold" style={{ color: "var(--ink)" }}>Atalhos</summary>
              <ul className="mt-1 space-y-0.5">
                <li><b>Arrastar no vazio</b>: move o quadro</li>
                <li><b>Shift + arrastar no vazio</b>: seleciona vários</li>
                <li><b>Shift + clique</b>: junta/tira da seleção</li>
                <li><b>Ctrl+A</b>: seleciona tudo</li>
                <li><b>Ctrl+C / Ctrl+V</b>: copia e cola (até noutro fluxo)</li>
                <li><b>Ctrl+D</b>: duplica</li>
                <li><b>Delete</b>: apaga bloco ou seta</li>
                <li><b>Ctrl+Z / Ctrl+Shift+Z</b>: desfaz / refaz</li>
              </ul>
            </details>
            {publicado && <Aviso>Fluxo publicado: o que você muda fica como <b>rascunho</b> e só vale depois de <b>Publicar</b>. Quem já está no fluxo não sente nada.</Aviso>}
          </aside>
        )}
      </div>
      <Simulacao resultado={simulacao} grafo={grafo} onFechar={() => setSimulacao(null)} />
      {relatorioModal}
    </div>
  );
}

/** 0414: o funil do bloco por extenso (dica ao passar o mouse). */
function tituloEstat(st: { entrou: number; erros: number; envio?: { enviadas: number; entregues: number; lidas: number; falharam: number; cliques: number } }) {
  const pct = (n: number, de: number) => (de ? ` (${Math.round((n / de) * 100)}%)` : "");
  const linhas = [`${st.entrou} pessoa(s) entraram neste bloco`];
  const e = st.envio;
  if (e?.enviadas) {
    linhas.push(`${e.enviadas} mensagem(ns) enviada(s)`, `${e.entregues} entregue(s)${pct(e.entregues, e.enviadas)}`, `${e.lidas} lida(s)${pct(e.lidas, e.enviadas)}`);
    if (e.cliques) linhas.push(`${e.cliques} clicaram no link${pct(e.cliques, e.enviadas)}`);
    if (e.falharam) linhas.push(`${e.falharam} falharam`);
  }
  if (st.erros) linhas.push(`${st.erros} erro(s)`);
  return linhas.join("\n");
}
