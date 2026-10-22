// src/rel/viagens/ViagensPage.tsx
// -----------------------------------------------------------------------------
// VIAGENS (Fase 3). Cada venda do Bitrix ("Em emissão" ou "Venda realizada")
// vira uma viagem aqui sozinha — a sincronização roda a cada 30 minutos, e o
// botão "Sincronizar com o Bitrix" puxa na hora. Também dá pra criar à mão.
//
// "Próximas" vem em ordem de embarque: é a fila de trabalho do pós-venda.
// Agrupar por expedição junta o grupo inteiro (ex.: Japão e China G2).
//
// 13/10: três visões no topo — PAINEL (mapa + quadro de partidas), CALENDÁRIO
// (embarques, voltas, trechos e check-ins) e a LISTA de sempre. A visão
// escolhida fica guardada no navegador.
//
// 20/10 (Bruno: "fechamos grupos de 20 pessoas pras expedições; ao invés de
// mostrar as pessoas, mostrar 1 grupo e quantas pessoas estão nele — ao abrir,
// aí sim quem são"): na Lista, cada saída de expedição (mesmo lugar + mesma
// data de embarque, como no quadro do Painel) é UMA linha com o total de
// pessoas; clicando, abre a lista de passageiros. Busca e as filas de
// arrumação (sem data / classificar) seguem pessoa por pessoa.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  FASES, SERVICOS, TIPOS_VIAGEM, criarViagem, dataBR, grupoDe, importarDoBitrix, listarEquipeRel, listarViagens, periodo, proximoVoo, quandoEmbarca, sincronizarBitrix,
  type FiltroViagens, type ResultadoSync, type TipoViagem, type Viagem,
} from "../lib/viagens";
import { buscarClientes, type Cliente } from "../lib/clientes";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import { TOM_FASE } from "./ViagensDoCliente";
import PainelViagens from "./PainelViagens";
import CalendarioViagens from "./CalendarioViagens";
import ConferirRepetidas from "./ConferirRepetidas";
import ConferirVoos from "./ConferirVoos";
import SeletorServico from "./SeletorServico";
import { ProximoVooCurto } from "./ProximoVoo";
import { COR_EXP, MarcaTipo } from "./MapaMundi";
import { lugaresDe } from "./destinos";
import DonoViagem from "./DonoViagem";
import BarraLote from "./BarraLote";
import { arquivamentosDe, sugeridaParaArquivar, type Arquivada } from "../lib/operacao";
import { podeGerirRelacionamento } from "../equipe/permissao";

type Visao = "painel" | "calendario" | "lista" | "repetidas" | "voos";
const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "painel", rotulo: "Painel" },
  { id: "calendario", rotulo: "Calendário" },
  { id: "lista", rotulo: "Lista" },
  { id: "repetidas", rotulo: "Conferir repetidas" },
  // 0154: voo que não bate com as datas da venda
  { id: "voos", rotulo: "Conferir voos" },
];
const CHAVE_VISAO = "rel_viagens_visao";
function visaoSalva(): Visao {
  try { const v = localStorage.getItem(CHAVE_VISAO); return v === "calendario" || v === "lista" || v === "repetidas" || v === "voos" ? v : "painel"; } catch { return "painel"; }
}

const FILTROS: { id: FiltroViagens; rotulo: string }[] = [
  { id: "proximas", rotulo: "Próximas" },
  { id: "em_viagem", rotulo: "Em viagem" },
  // 0184: o dono da viagem
  { id: "minhas", rotulo: "Minhas" },
  { id: "sem_dono", rotulo: "Sem dono" },
  // 0148: o que falta pro time arrumar — fica fora de "Próximas" pra não poluir
  { id: "sem_data", rotulo: "Precisa de data" },
  { id: "classificar", rotulo: "Classificar" },
  { id: "arquivadas", rotulo: "Arquivadas" },
  { id: "concluidas", rotulo: "Concluídas" },
  { id: "canceladas", rotulo: "Canceladas" },
  { id: "todas", rotulo: "Todas" },
];

function resumoSync(r: ResultadoSync): string {
  const partes = [`${r.lidos} lido${r.lidos === 1 ? "" : "s"}`];
  if (r.criados) partes.push(`${r.criados} viagem(ns) nova(s)`);
  if (r.atualizados) partes.push(`${r.atualizados} atualizada(s)`);
  if (r.passageiros) partes.push(`${r.passageiros} acompanhante(s)`);
  if (r.cancelados) partes.push(`${r.cancelados} cancelada(s)`);
  if (r.erros) partes.push(`${r.erros} com erro`);
  return partes.join(" · ") + (r.completo ? "." : " — ainda tem mais; clique de novo para continuar.");
}

// ── Nova viagem (manual) ────────────────────────────────────────────────────

function NovaViagem({ aberto, onFechar, onCriada }: { aberto: boolean; onFechar: () => void; onCriada: (id: string) => void }) {
  const [f, setF] = useState({ titulo: "", destino: "", tipo: "pacote" as TipoViagem, data_embarque: "", data_retorno: "", valor: "" });
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<Cliente[]>([]);
  const [dealId, setDealId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setF({ titulo: "", destino: "", tipo: "pacote", data_embarque: "", data_retorno: "", valor: "" });
    setCliente(null); setBusca(""); setDealId(""); setErro(null);
  }, [aberto]);
  useEffect(() => {
    if (!busca.trim()) { setOpcoes([]); return; }
    const t = setTimeout(() => { buscarClientes(busca, 8).then(setOpcoes).catch(() => setOpcoes([])); }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function criar() {
    if (f.titulo.trim().length < 2) { setErro("Dê um nome para a viagem (ex.: destino)."); return; }
    if (f.data_retorno && f.data_embarque && f.data_retorno < f.data_embarque) { setErro("A volta não pode ser antes da ida."); return; }
    setOcupado(true); setErro(null);
    try {
      const id = await criarViagem({
        titulo: f.titulo.trim(), destino: f.destino.trim() || null, tipo: f.tipo,
        data_embarque: f.data_embarque || null, data_retorno: f.data_retorno || null,
        valor: f.valor ? Number(f.valor.replace(/\./g, "").replace(",", ".")) || null : null,
        cliente_id: cliente?.id ?? null, data_venda: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()),
      });
      onCriada(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não criou."); }
    finally { setOcupado(false); }
  }

  async function importar() {
    if (!dealId.replace(/\D/g, "")) { setErro("Digite o número do negócio no Bitrix."); return; }
    setOcupado(true); setErro(null);
    try {
      const r = await importarDoBitrix(dealId);
      if (r.viagemId) onCriada(r.viagemId);
      else setErro("O negócio foi lido, mas não virou viagem (sem contato ou sem dados de venda).");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não importou."); }
    finally { setOcupado(false); }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Nova viagem"
      onFechar={onFechar}
      largura={600}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={criar} disabled={ocupado}>{ocupado ? "Salvando…" : "Criar viagem"}</Botao></>}
    >
      <div className="space-y-4">
        <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
          <p className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Já está no Bitrix? Traga pelo número do negócio:</p>
          <div className="flex gap-2">
            <Entrada value={dealId} onChange={(e) => setDealId(e.target.value)} placeholder="Ex.: 49655" inputMode="numeric" />
            <Botao onClick={importar} disabled={ocupado}>Importar</Botao>
          </div>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Ou crie à mão (venda que não passou pelo Bitrix):</p>
        <Campo rotulo="Nome da viagem *"><Entrada value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Lua de mel em Portugal" /></Campo>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Destino"><Entrada value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} /></Campo>
          <Campo rotulo="Tipo">
            <select className="rel-input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoViagem })}>
              {(Object.keys(TIPOS_VIAGEM) as TipoViagem[]).map((t) => <option key={t} value={t}>{TIPOS_VIAGEM[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Ida"><Entrada type="date" value={f.data_embarque} onChange={(e) => setF({ ...f, data_embarque: e.target.value })} /></Campo>
          <Campo rotulo="Volta"><Entrada type="date" value={f.data_retorno} onChange={(e) => setF({ ...f, data_retorno: e.target.value })} /></Campo>
          <Campo rotulo="Valor (R$)"><Entrada value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} inputMode="decimal" placeholder="0,00" /></Campo>
        </div>
        <Campo rotulo="Cliente (quem comprou)">
          {cliente ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
              <b>{cliente.nome}</b>
              <button className="underline text-[12px]" style={{ color: "var(--ink3)" }} onClick={() => setCliente(null)}>trocar</button>
            </div>
          ) : (
            <div className="relative">
              <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ficha por nome, CPF ou telefone" />
              {opcoes.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rel-card shadow-lg overflow-hidden">
                  {opcoes.map((c) => (
                    <button key={c.id} className="rel-linha w-full text-left px-3 py-2 text-[13px]" style={{ color: "var(--ink)" }}
                      onClick={() => { setCliente(c); setBusca(""); setOpcoes([]); }}>
                      {c.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Linha ───────────────────────────────────────────────────────────────────

interface ExtrasLinha {
  /** 0184: caixinha pra ação em lote */
  marcada?: boolean; onMarcar?: (v: boolean) => void;
  /** 0184: dono da viagem (com "Assumir") */
  equipe?: { id: string; name: string }[];
  /** fila Sem data: mostra quando foi vendida e se é sugerida pra arquivar */
  mostrarVenda?: boolean;
  arquivo?: Arquivada | null;
}

function Linha({ v, onAbrir, onAbrirCliente, classificar, onMudou, extras = {} }: { v: Viagem; onAbrir: () => void; onAbrirCliente: (id: string) => void; classificar?: boolean; onMudou?: () => void; extras?: ExtrasLinha }) {
  return (
    <li style={{ borderTop: "1px solid var(--line2)" }}>
      <div className="rel-linha flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onAbrir}
        role="link" tabIndex={0} aria-label={`Abrir viagem ${v.titulo}`}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onAbrir(); } }}>
        {extras.onMarcar && (
          <input type="checkbox" className="w-4 h-4 flex-shrink-0" style={{ accentColor: "var(--rel)" }} aria-label={`Marcar ${v.titulo}`}
            checked={!!extras.marcada} onClick={(e) => e.stopPropagation()} onChange={(e) => extras.onMarcar!(e.target.checked)} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{v.titulo}</p>
          <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
            {v.cliente_id && v.cliente_nome ? (
              <button className="underline" onClick={(e) => { e.stopPropagation(); onAbrirCliente(v.cliente_id!); }}>{v.cliente_nome}</button>
            ) : "sem cliente"}
            {v.passageiros > 1 ? ` + ${v.passageiros - 1}` : ""} · {periodo(v)} · {quandoEmbarca(v)}
            {v.proximo_voo_em && <span className="sm:hidden"> · ✈ {proximoVoo(v).quando}</span>}
          </p>
          {extras.mostrarVenda && (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              {v.data_venda ? `vendida em ${dataBR(v.data_venda)}` : "sem data de venda"}
              {sugeridaParaArquivar(v) && <b style={{ color: "#B45309" }}> · sugerida pra arquivar</b>}
            </p>
          )}
          {extras.arquivo && (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              arquivada{extras.arquivo.arquivado_em ? ` em ${new Date(extras.arquivo.arquivado_em).toLocaleDateString("pt-BR")}` : ""}{extras.arquivo.arquivado_motivo ? ` · “${extras.arquivo.arquivado_motivo}”` : ""}
            </p>
          )}
        </div>
        {extras.equipe && onMudou && <span className="hidden md:inline-flex flex-shrink-0"><DonoViagem viagemId={v.id} responsavelId={v.responsavel_id} equipe={extras.equipe} onMudou={onMudou} compacto /></span>}
        <ProximoVooCurto v={v} className="hidden sm:block flex-shrink-0 max-w-[230px]" />
        <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
          {v.tarefas_atrasadas > 0 && <Etiqueta tom="erro">{v.tarefas_atrasadas} atrasada{v.tarefas_atrasadas > 1 ? "s" : ""}</Etiqueta>}
          {v.tarefas_total > 0 && <span className="text-[11px] tabular-nums" style={{ color: "var(--ink3)" }}>{v.tarefas_total - v.tarefas_pendentes}/{v.tarefas_total}</span>}
          {!classificar && <Etiqueta>{v.servico ? SERVICOS[v.servico] : TIPOS_VIAGEM[v.tipo]}</Etiqueta>}
          <Etiqueta tom={TOM_FASE[v.fase]}>{FASES[v.fase]}</Etiqueta>
        </span>
        {classificar && onMudou && <SeletorServico v={v} onMudou={onMudou} compacto />}
      </div>
    </li>
  );
}

// ── Grupo de expedição (uma saída) ──────────────────────────────────────────

interface Grupo { chave: string; nome: string; vs: Viagem[]; pessoas: number }
type ItemLista = { k: "viagem"; v: Viagem } | { k: "grupo"; g: Grupo };

const pax = (v: Viagem) => Math.max(v.passageiros || 1, 1);

/** Junta as expedições por saída (lugar + data de embarque), na ordem da lista. */
function agruparExpedicoes(lista: Viagem[]): ItemLista[] {
  const out: ItemLista[] = [];
  const grupos = new Map<string, Grupo>();
  for (const v of lista) {
    if (grupoDe(v) !== "expedicao" || !v.data_embarque) { out.push({ k: "viagem", v }); continue; }
    const lugar = [v.expedicao, v.destino, v.titulo].map((t) => lugaresDe(t)).find((x) => x.length)?.[0];
    const chave = `${lugar?.id ?? (v.expedicao || v.titulo)}|${v.data_embarque}`;
    let g = grupos.get(chave);
    if (!g) { g = { chave, nome: lugar?.nome ?? v.expedicao ?? v.titulo, vs: [], pessoas: 0 }; grupos.set(chave, g); out.push({ k: "grupo", g }); }
    g.vs.push(v);
  }
  for (const g of grupos.values()) {
    // a mesma pessoa vinda do Bitrix e do sistema de Expedições conta uma vez
    const porCliente = new Map<string, number>();
    let soltos = 0;
    for (const v of g.vs) { if (v.cliente_id) porCliente.set(v.cliente_id, Math.max(porCliente.get(v.cliente_id) ?? 0, pax(v))); else soltos += pax(v); }
    g.pessoas = soltos + [...porCliente.values()].reduce((a, b) => a + b, 0);
    // o nome de grupo mais usado na saída ("Islândia G1/ Fev 2027"), se tiver
    const nomes = new Map<string, number>();
    for (const v of g.vs) if (v.expedicao) nomes.set(v.expedicao, (nomes.get(v.expedicao) ?? 0) + 1);
    const maisUsado = [...nomes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (maisUsado) g.nome = maisUsado;
    g.vs.sort((a, b) => (a.cliente_nome ?? "").localeCompare(b.cliente_nome ?? "", "pt-BR"));
  }
  return out;
}

function LinhaGrupo({ g, aberto, onAlternar, children }: { g: Grupo; aberto: boolean; onAlternar: () => void; children: ReactNode }) {
  const v0 = g.vs[0];
  const atrasadas = g.vs.reduce((s, v) => s + v.tarefas_atrasadas, 0);
  const fase = g.vs.some((v) => v.fase === "em_viagem") ? "em_viagem" : v0.fase;
  const retorno = g.vs.map((v) => v.data_retorno).filter(Boolean).sort().pop() ?? v0.data_retorno;
  return (
    <li style={{ borderTop: "1px solid var(--line2)" }}>
      <button type="button" onClick={onAlternar} aria-expanded={aberto}
        className="rel-linha w-full text-left flex items-center gap-3 px-4 py-3">
        <span className="text-[12px] w-3 flex-shrink-0" style={{ color: "var(--ink3)" }} aria-hidden>{aberto ? "▾" : "▸"}</span>
        <MarcaTipo tipo="expedicao" tamanho={9} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{g.nome}</p>
          <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
            Expedição · {periodo({ data_embarque: v0.data_embarque, data_retorno: retorno })} · {quandoEmbarca({ ...v0, fase })}
          </p>
        </div>
        <span className="flex items-center gap-2 flex-shrink-0">
          {atrasadas > 0 && <span className="hidden sm:inline"><Etiqueta tom="erro">{atrasadas} atrasada{atrasadas > 1 ? "s" : ""}</Etiqueta></span>}
          <span className="text-right leading-tight">
            <b className="text-[15px] tabular-nums" style={{ color: "var(--ink)" }}>{g.pessoas}</b>
            <span className="text-[12px]" style={{ color: "var(--ink2)" }}> pessoa{g.pessoas === 1 ? "" : "s"}</span>
          </span>
          <span className="hidden sm:inline"><Etiqueta tom={TOM_FASE[fase]}>{FASES[fase]}</Etiqueta></span>
        </span>
      </button>
      {aberto && <ul className="ml-6 mb-2" style={{ borderLeft: `2px solid ${COR_EXP}` }}>{children}</ul>}
    </li>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function ViagensPage({ onAbrirViagem, onAbrirCliente }: { onAbrirViagem: (id: string) => void; onAbrirCliente: (id: string) => void }) {
  const { currentUser } = useQsAuth();
  const gestor = podeGerirRelacionamento(currentUser);
  const [visao, setVisaoState] = useState<Visao>(visaoSalva);
  const setVisao = (v: Visao) => { setVisaoState(v); try { localStorage.setItem(CHAVE_VISAO, v); } catch { /* sem localStorage */ } };
  const [filtro, setFiltro] = useState<FiltroViagens>("proximas");
  // o painel abre a lista já numa fila ("Precisa de data" / "Classificar")
  const verFila = (f: FiltroViagens) => { setFiltro(f); setVisao("lista"); };
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Viagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // expedição: uma linha por saída (o grupo), abre pra ver as pessoas
  const [porGrupo, setPorGrupo] = useState(true);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) => setAbertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [sync, setSync] = useState<{ ocupado: boolean; msg: string | null; erro: boolean }>({ ocupado: false, msg: null, erro: false });
  const [nova, setNova] = useState(false);
  const [versao, setVersao] = useState(0);
  // 0184: dono + ações em lote
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { listarEquipeRel().then(setEquipe).catch(() => setEquipe([])); }, []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { setSel(new Set()); }, [filtro, busca]);
  const [arquivos, setArquivos] = useState<Map<string, Arquivada>>(new Map());
  useEffect(() => {
    if (filtro !== "arquivadas" || !lista?.length) { setArquivos(new Map()); return; }
    arquivamentosDe(lista.map((v) => v.id)).then(setArquivos).catch(() => setArquivos(new Map()));
  }, [filtro, lista]);

  useEffect(() => {
    if (visao !== "lista") return;
    let vivo = true;
    setLista(null);
    const t = setTimeout(() => {
      listarViagens(filtro, busca, currentUser?.id ?? "")
        .then((l) => { if (vivo) { setLista(l); setErro(null); } })
        .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); } });
    }, busca ? 300 : 0);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, busca, versao, visao]);

  async function sincronizar() {
    setSync({ ocupado: true, msg: "Buscando vendas no Bitrix… (pode levar até 1 minuto)", erro: false });
    try {
      const r = await sincronizarBitrix();
      setSync({ ocupado: false, msg: resumoSync(r), erro: false });
      setVersao((x) => x + 1);
    } catch (e) {
      setSync({ ocupado: false, msg: e instanceof Error ? e.message : "Falhou.", erro: true });
    }
  }

  // Busca e filas de arrumação ficam pessoa por pessoa.
  const agrupa = porGrupo && !busca.trim() && filtro !== "sem_data" && filtro !== "classificar" && filtro !== "arquivadas" && filtro !== "sem_dono";
  // quem tem caixinha de marcar (ações em lote, ver BarraLote)
  const comLote = filtro === "classificar" || (gestor && ["sem_data", "arquivadas", "sem_dono", "proximas", "em_viagem", "minhas"].includes(filtro));
  const comDono = ["proximas", "em_viagem", "minhas", "sem_dono"].includes(filtro);
  const itens = useMemo(() => (lista ? (agrupa ? agruparExpedicoes(lista) : lista.map((v) => ({ k: "viagem" as const, v }))) : null), [lista, agrupa]);

  return (
    <div className={visao === "lista" ? "max-w-5xl mx-auto" : "w-full"}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Viagens</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Toda venda do Bitrix vira viagem aqui, com a jornada do cliente até a volta.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao onClick={sincronizar} disabled={sync.ocupado}>{sync.ocupado ? "Sincronizando…" : "Sincronizar com o Bitrix"}</Botao>
          <Botao variante="primario" onClick={() => setNova(true)}>+ Nova viagem</Botao>
        </div>
      </div>

      {sync.msg && <div className="mb-3"><Aviso tom={sync.erro ? "erro" : "ok"}>{sync.msg}</Aviso></div>}

      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: "var(--line)" }} role="tablist" aria-label="Visão das viagens">
        {VISOES.map((x) => (
          <button key={x.id} role="tab" aria-selected={visao === x.id} onClick={() => setVisao(x.id)}
            className="px-4 py-2.5 text-[13px] font-semibold -mb-px"
            style={visao === x.id ? { color: "var(--rel-ink)", borderBottom: "2px solid var(--rel)" } : { color: "var(--ink2)", borderBottom: "2px solid transparent" }}>
            {x.rotulo}
          </button>
        ))}
      </div>

      {visao === "painel" && <PainelViagens key={versao} onAbrirViagem={onAbrirViagem} onVerFila={verFila} />}
      {visao === "calendario" && <CalendarioViagens key={versao} onAbrirViagem={onAbrirViagem} />}
      {visao === "repetidas" && <ConferirRepetidas key={versao} onAbrirViagem={onAbrirViagem} />}
      {visao === "voos" && <ConferirVoos key={versao} onAbrirViagem={onAbrirViagem} />}
      {visao === "lista" && <>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 rel-card p-1 overflow-x-auto" role="group" aria-label="Filtrar viagens">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id} className="rel-linha px-3 py-2 rounded-lg text-[12.5px] font-semibold whitespace-nowrap"
              style={filtro === f.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
              {f.rotulo}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={porGrupo} onChange={(e) => setPorGrupo(e.target.checked)} /> Expedições por grupo
        </label>
      </div>
      <div className="mb-4">
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar viagens" placeholder="Buscar por viagem, destino, expedição, cliente ou nº do Bitrix" />
      </div>

      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      {filtro === "sem_data" && <div className="mb-3"><Aviso tom="aviso">Vendas que pedem acompanhamento mas estão sem data de embarque no Bitrix. Preencha a ida (e a volta) no card do Bitrix — elas vão pro painel sozinhas na próxima sincronização.{gestor ? " Venda antiga que não vai acontecer: “Marcar as sugeridas” pega venda há mais de 12 meses ou sem data de venda — confira, escreva o motivo e arquive (dá pra desfazer)." : " Arquivar em lote é com a gestão."}</Aviso></div>}
      {filtro === "classificar" && <div className="mb-3"><Aviso tom="aviso">O Bitrix não diz o que foi vendido (Tipo de venda vazio ou "Outros"). Escolha ao lado de cada uma — ou marque várias e escolha uma vez só na barra: pacote, aéreo e cruzeiro entram na Esteira completa; hotel e passeio só Revisão + D-3; seguro, concierge e outros ficam só na ficha do cliente.</Aviso></div>}
      {filtro === "sem_dono" && <div className="mb-3"><Aviso tom="aviso">Pacotes, aéreos e hotéis que vão acontecer e ninguém do time cuida. Clique em <b>Assumir</b> nas suas{gestor ? " — ou marque várias e atribua de uma vez" : ""}.</Aviso></div>}
      {filtro === "minhas" && <div className="mb-3"><Aviso tom="ok">As viagens que você cuida. As etapas de cada uma aparecem em <b>Minhas atividades</b>.</Aviso></div>}
      {lista && <BarraLote key={filtro} filtro={filtro} lista={lista} sel={sel} setSel={setSel} gestor={gestor} equipe={equipe} onMudou={() => setVersao((x) => x + 1)} />}

      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="rel-card">
          <Vazio
            titulo={busca ? "Nenhuma viagem encontrada" : "Nenhuma viagem aqui"}
            texto={filtro === "proximas" && !busca ? "Clique em \"Sincronizar com o Bitrix\" para trazer as vendas — depois disso elas chegam sozinhas a cada 30 minutos." : undefined}
          />
        </div>
      ) : (
        <div className="rel-card overflow-hidden">
          <ul className="-mt-px">
            {itens!.map((it) => {
              const linha = (v: Viagem) => <Linha key={v.id} v={v} onAbrir={() => onAbrirViagem(v.id)} onAbrirCliente={onAbrirCliente} classificar={filtro === "classificar"} onMudou={() => setVersao((x) => x + 1)}
                extras={{
                  marcada: sel.has(v.id),
                  onMarcar: comLote ? (m) => setSel((s) => { const n = new Set(s); if (m) n.add(v.id); else n.delete(v.id); return n; }) : undefined,
                  equipe: comDono ? equipe : undefined,
                  mostrarVenda: filtro === "sem_data",
                  arquivo: filtro === "arquivadas" ? arquivos.get(v.id) ?? null : null,
                }} />;
              return it.k === "viagem" ? linha(it.v) : (
                <LinhaGrupo key={it.g.chave} g={it.g} aberto={abertos.has(it.g.chave)} onAlternar={() => alternar(it.g.chave)}>
                  {it.g.vs.map(linha)}
                </LinhaGrupo>
              );
            })}
          </ul>
        </div>
      )}
      {lista && lista.length >= 500 && (
        <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Mostrando as 500 primeiras — use a busca.</p>
      )}
      </>}

      <NovaViagem aberto={nova} onFechar={() => setNova(false)} onCriada={(id) => { setNova(false); onAbrirViagem(id); }} />
    </div>
  );
}
