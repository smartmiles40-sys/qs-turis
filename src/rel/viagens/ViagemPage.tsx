// src/rel/viagens/ViagemPage.tsx
// -----------------------------------------------------------------------------
// A VIAGEM (Fase 3): dados da venda, quem viaja, a JORNADA do Relacionamento
// (tarefas com prazo contado a partir da venda, do embarque e da volta) e os
// documentos de todos os passageiros.
//
// A jornada nasce do modelo em rel_config.jornada. Mudou a data de embarque?
// O banco refaz os prazos das tarefas pendentes sozinho — as feitas ficam.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  FASES, TIPOS_VIAGEM, adicionarPassageiro, apagarTarefa, carregarViagem, criarTarefa, dataBR, linkBitrix,
  listarEquipeRel, listarPassageiros, listarTarefas, marcarTarefa, quandoEmbarca, removerPassageiro, resumoDaVenda, salvarViagem,
  type Passageiro, type Tarefa, type TipoViagem, type Viagem, type ViagemInput,
} from "../lib/viagens";
import { buscarClientes, formatarTelefone, mesesParaVencer, type Cliente } from "../lib/clientes";
import { conversasDoCliente, type Conversa } from "../lib/whatsapp";
import { Aviso, Avatar, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";
import DocumentosPainel from "./DocumentosPainel";
import RevisaoIaViagem from "./RevisaoIaViagem";
import { RevisaoViagem } from "./TrechosViagem";
import RoteiroViagem from "./RoteiroViagem";
import ArquivosViagem from "./ArquivosViagem";
import ConformidadeViagem, { RequisitosEntrada } from "./ConformidadeViagem";
import AlertasViagem, { CSS_PISCA } from "./AlertasViagem";
import LinhaDoTempo from "./LinhaDoTempo";
import { conferirViagens, type Analise } from "../lib/problemas";
import { TOM_FASE } from "./ViagensDoCliente";

function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rel-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-1.5">
      <dt className="text-[12px] sm:w-36 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</dt>
      <dd className="text-[14px] min-w-0 break-words" style={{ color: "var(--ink)" }}>{children || <span style={{ color: "var(--ink3)" }}>—</span>}</dd>
    </div>
  );
}

const moeda = (n: number | null) => (n == null ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const hoje = () => new Date().toISOString().slice(0, 10);

// ── Editar ──────────────────────────────────────────────────────────────────

function EditarViagem({ aberto, v, onFechar, onSalvo }: { aberto: boolean; v: Viagem; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState<ViagemInput>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    setF({
      titulo: v.titulo, destino: v.destino, expedicao: v.expedicao, tipo: v.tipo, data_venda: v.data_venda,
      data_embarque: v.data_embarque, data_retorno: v.data_retorno, valor: v.valor, qtd_passageiros: v.qtd_passageiros,
      observacoes: v.observacoes, necessidades: v.necessidades,
    });
    setErro(null);
  }, [aberto, v]);
  const set = <K extends keyof ViagemInput>(k: K, val: ViagemInput[K]) => setF((x) => ({ ...x, [k]: val }));

  async function salvar() {
    if (!f.titulo || f.titulo.trim().length < 2) { setErro("Dê um nome para a viagem."); return; }
    if (f.data_retorno && f.data_embarque && f.data_retorno < f.data_embarque) { setErro("A volta não pode ser antes da ida."); return; }
    setOcupado(true); setErro(null);
    try {
      await salvarViagem(v.id, {
        ...f,
        titulo: f.titulo.trim(),
        destino: f.destino?.trim() || null,
        expedicao: f.expedicao?.trim() || null,
        data_venda: f.data_venda || null, data_embarque: f.data_embarque || null, data_retorno: f.data_retorno || null,
        observacoes: f.observacoes?.trim() || null, necessidades: f.necessidades?.trim() || null,
      });
      onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }

  return (
    <Modal aberto={aberto} titulo="Editar viagem" onFechar={onFechar} largura={620}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={salvar} disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="space-y-3">
        {v.origem === "bitrix" && (
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            Esta viagem veio do Bitrix. O que você mudar aqui fica — a sincronização só preenche o que estiver vazio e o que mudar no card.
          </p>
        )}
        <Campo rotulo="Nome da viagem"><Entrada value={f.titulo ?? ""} onChange={(e) => set("titulo", e.target.value)} /></Campo>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Destino"><Entrada value={f.destino ?? ""} onChange={(e) => set("destino", e.target.value)} /></Campo>
          <Campo rotulo="Expedição (grupo)"><Entrada value={f.expedicao ?? ""} onChange={(e) => set("expedicao", e.target.value)} /></Campo>
          <Campo rotulo="Tipo">
            <select className="rel-input" value={f.tipo ?? "outro"} onChange={(e) => set("tipo", e.target.value as TipoViagem)}>
              {(Object.keys(TIPOS_VIAGEM) as TipoViagem[]).map((t) => <option key={t} value={t}>{TIPOS_VIAGEM[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Vendida em"><Entrada type="date" value={f.data_venda ?? ""} onChange={(e) => set("data_venda", e.target.value)} /></Campo>
          <Campo rotulo="Ida"><Entrada type="date" value={f.data_embarque ?? ""} onChange={(e) => set("data_embarque", e.target.value)} /></Campo>
          <Campo rotulo="Volta"><Entrada type="date" value={f.data_retorno ?? ""} onChange={(e) => set("data_retorno", e.target.value)} /></Campo>
          <Campo rotulo="Valor (R$)"><Entrada type="number" step="0.01" value={f.valor ?? ""} onChange={(e) => set("valor", e.target.value ? Number(e.target.value) : null)} /></Campo>
          <Campo rotulo="Passageiros (qtd. vendida)"><Entrada type="number" min={1} value={f.qtd_passageiros ?? ""} onChange={(e) => set("qtd_passageiros", e.target.value ? Number(e.target.value) : null)} /></Campo>
        </div>
        <Campo rotulo="Observações do Comercial"><textarea className="rel-input" rows={3} value={f.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} /></Campo>
        <Campo rotulo="Necessidades especiais / restrições"><textarea className="rel-input" rows={2} value={f.necessidades ?? ""} onChange={(e) => set("necessidades", e.target.value)} /></Campo>
        {f.data_embarque !== v.data_embarque && (
          <Aviso>Mudou a data: os prazos das tarefas pendentes da jornada serão recalculados.</Aviso>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Passageiros ─────────────────────────────────────────────────────────────

function AdicionarPassageiro({ aberto, viagemId, onFechar, onAdicionado }: { aberto: boolean; viagemId: string; onFechar: () => void; onAdicionado: () => void }) {
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) { setBusca(""); setLista([]); setErro(null); } }, [aberto]);
  useEffect(() => {
    if (!busca.trim()) { setLista([]); return; }
    const t = setTimeout(() => { buscarClientes(busca, 10).then(setLista).catch(() => setLista([])); }, 250);
    return () => clearTimeout(t);
  }, [busca]);
  async function add(c: Cliente) {
    try { await adicionarPassageiro(viagemId, c.id); onAdicionado(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não adicionou."); }
  }
  return (
    <Modal aberto={aberto} titulo="Adicionar passageiro" onFechar={onFechar}>
      <div className="space-y-3">
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ficha por nome, CPF ou telefone" autoFocus />
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Quem ainda não tem ficha: crie em Clientes e volte aqui.</p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <ul className="rel-card overflow-hidden">
          {lista.map((c) => (
            <li key={c.id}>
              <button onClick={() => void add(c)} className="rel-linha w-full text-left px-3 py-2 text-[13px] flex justify-between gap-2" style={{ color: "var(--ink)" }}>
                <span className="font-semibold">{c.nome}</span>
                <span style={{ color: "var(--ink3)" }}>{formatarTelefone(c.telefone)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ── Jornada ─────────────────────────────────────────────────────────────────

function Jornada({ viagemId, ativa, recarregarViagem }: { viagemId: string; ativa: boolean; recarregarViagem: () => void }) {
  const { currentUser } = useQsAuth();
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null);
  const [nova, setNova] = useState({ titulo: "", prazo: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [verFeitas, setVerFeitas] = useState(false);

  const carregar = useCallback(() => {
    listarTarefas(viagemId).then(setTarefas).catch((e) => { setErro(e instanceof Error ? e.message : "Falhou."); setTarefas([]); });
  }, [viagemId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); carregar(); recarregarViagem(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  if (!tarefas) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  const pendentes = tarefas.filter((t) => !t.feita_em);
  const feitas = tarefas.filter((t) => t.feita_em);
  const h = hoje();

  return (
    <div className="space-y-2">
      {!ativa && <Aviso>Viagem cancelada: a jornada parou.</Aviso>}
      {pendentes.length === 0 && ativa && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Tudo em dia. 🎉</p>}
      <ul className="space-y-1">
        {pendentes.map((t) => {
          const atrasada = !!t.prazo && t.prazo < h;
          const hojeMesmo = t.prazo === h;
          return (
            <li key={t.id} className="flex items-start gap-2.5 p-2 rounded-lg" style={atrasada ? { background: "var(--err-bg)" } : undefined}>
              <input type="checkbox" className="mt-1" checked={false} onChange={() => void acao(() => marcarTarefa(t.id, true, currentUser?.id ?? ""))} aria-label={`Marcar "${t.titulo}" como feita`} />
              <span className="flex-1 min-w-0">
                <span className="block text-[14px]" style={{ color: atrasada ? "var(--err-ink)" : "var(--ink)" }}>{t.titulo}</span>
                {t.descricao && <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>{t.descricao}</span>}
              </span>
              <span className="text-[12px] whitespace-nowrap font-semibold" style={{ color: atrasada ? "var(--err-ink)" : hojeMesmo ? "var(--warn-ink)" : "var(--ink3)" }}>
                {t.prazo ? (atrasada ? `atrasada · ${dataBR(t.prazo)}` : hojeMesmo ? "hoje" : dataBR(t.prazo)) : "sem prazo"}
              </span>
              {t.referencia === "manual" && (
                <button className="text-[12px]" style={{ color: "var(--ink3)" }} title="Apagar tarefa" onClick={() => void acao(() => apagarTarefa(t.id))}>×</button>
              )}
            </li>
          );
        })}
      </ul>

      {ativa && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Entrada value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} placeholder="Nova tarefa (ex.: confirmar transfer)" style={{ flex: "1 1 220px" }} />
          <Entrada type="date" value={nova.prazo} onChange={(e) => setNova({ ...nova, prazo: e.target.value })} style={{ width: 160 }} />
          <Botao disabled={nova.titulo.trim().length < 3} onClick={() => void acao(async () => { await criarTarefa(viagemId, nova.titulo.trim(), nova.prazo || null); setNova({ titulo: "", prazo: "" }); })}>Adicionar</Botao>
        </div>
      )}

      {feitas.length > 0 && (
        <div className="pt-1">
          <button className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }} onClick={() => setVerFeitas((x) => !x)}>
            {verFeitas ? "Esconder" : "Ver"} {feitas.length} feita{feitas.length > 1 ? "s" : ""}
          </button>
          {verFeitas && (
            <ul className="space-y-1 mt-1">
              {feitas.map((t) => (
                <li key={t.id} className="flex items-center gap-2.5 px-2 py-1">
                  <input type="checkbox" checked onChange={() => void acao(() => marcarTarefa(t.id, false, currentUser?.id ?? ""))} aria-label={`Desfazer "${t.titulo}"`} />
                  <span className="flex-1 text-[13px] line-through" style={{ color: "var(--ink3)" }}>{t.titulo}</span>
                  <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{new Date(t.feita_em!).toLocaleDateString("pt-BR")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────
// 15/10 (Bruno): ocupa a TELA TODA e dá pra entender tudo numa olhada.
//   topo  — quem comprou, Bitrix, editar, o % que bate e "marcar como revisada"
//   esq.  — dados da venda, quem viaja, recado do Comercial
//   meio  — roteiro: voo principal, internos, trens, transfers, hotéis
//   dir.  — revisão da IA, requisitos de entrada, jornada de revisão
//   baixo — todos os arquivos, visuais

export default function ViagemPage({ id, onVoltar, onAbrirCliente, onAbrirConversa }: {
  id: string; onVoltar: () => void; onAbrirCliente: (id: string) => void; onAbrirConversa: (conversaId: string) => void;
}) {
  const [v, setV] = useState<Viagem | null>(null);
  // a revisão da IA grava trechos e o %: muda a versão pra roteiro/arquivos/% recarregarem
  const [versao, setVersao] = useState(0);
  const [pass, setPass] = useState<Passageiro[]>([]);
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [venda, setVenda] = useState<{ closer: string | null; de: string | null; para: string | null }>({ closer: null, de: null, para: null });
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [addPass, setAddPass] = useState(false);
  // o conferente (lib/problemas.ts): riscos + os trechos que a linha do tempo desenha
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [aba, setAba] = useState<"dia" | "tipo">("dia");

  const carregar = useCallback(async () => {
    try {
      const viagem = await carregarViagem(id);
      if (!viagem) { setErro("Viagem não encontrada."); return; }
      setV(viagem);
      const [ps, conv, rv] = await Promise.all([
        listarPassageiros(id),
        viagem.cliente_id ? conversasDoCliente(viagem.cliente_id).catch(() => []) : Promise.resolve([]),
        resumoDaVenda(id).catch(() => ({ closer: null, de: null, para: null })),
      ]);
      setPass(ps);
      setConversa(conv[0] ?? null);
      setVenda(rv);
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não abriu a viagem."); }
  }, [id]);
  useEffect(() => { setV(null); void carregar(); }, [carregar]);
  useEffect(() => { listarEquipeRel().then(setEquipe).catch(() => setEquipe([])); }, []);
  const chaveConf = v ? `${v.id}|${v.data_embarque}|${v.data_retorno}|${v.status}|${v.tipo}|${pass.length}|${versao}` : "";
  useEffect(() => {
    if (!v) return;
    let vivo = true;
    conferirViagens([v]).then((m) => { if (vivo) setAnalise(m.get(v.id) ?? { problemas: [], trechos: [] }); }).catch(() => { if (vivo) setAnalise({ problemas: [], trechos: [] }); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveConf]);
  // alerta clicado → mostra a linha do tempo pra ele achar o trecho
  useEffect(() => {
    const ir = () => setAba("dia");
    window.addEventListener("rel-ir-trecho", ir);
    return () => window.removeEventListener("rel-ir-trecho", ir);
  }, []);

  const pessoas = useMemo(() => pass.filter((p) => p.cliente).map((p) => ({ id: p.cliente_id, nome: p.cliente!.nome })), [pass]);

  if (erro && !v) return <div className="max-w-4xl mx-auto"><Aviso tom="erro">{erro}</Aviso></div>;
  if (!v) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando viagem…</p>;

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); await carregar(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  const ativa = v.status === "ativa";
  const revisou = () => { setVersao((n) => n + 1); void carregar(); };
  const mudouTrecho = () => setVersao((n) => n + 1);
  const retornoMaisSeis = (() => {
    const base = v.data_retorno || v.data_embarque;
    if (!base) return null;
    const d = new Date(base + "T12:00:00");
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const comprador = pass.find((p) => p.cliente_id === v.cliente_id)?.cliente?.nome || v.cliente_nome;

  return (
    <div className="w-full space-y-4">
      <style>{CSS_PISCA}</style>
      <button onClick={onVoltar} className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: "var(--ink3)" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        Viagens
      </button>

      {/* Cabeçalho */}
      <div className="rel-card p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight" style={{ color: "var(--ink)" }}>{v.titulo}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <Etiqueta tom={TOM_FASE[v.fase]}>{FASES[v.fase]}</Etiqueta>
              <Etiqueta>{TIPOS_VIAGEM[v.tipo]}</Etiqueta>
              <span className="text-[13px]" style={{ color: "var(--ink2)" }}>{quandoEmbarca(v)}</span>
              {v.tarefas_atrasadas > 0 && <Etiqueta tom="erro">{v.tarefas_atrasadas} tarefa{v.tarefas_atrasadas > 1 ? "s" : ""} atrasada{v.tarefas_atrasadas > 1 ? "s" : ""}</Etiqueta>}
              {!ativa && <Etiqueta tom="erro">Cancelada</Etiqueta>}
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Responsável da compra</dt>
                <dd className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                  {v.cliente_id && comprador ? <button className="underline-offset-2 hover:underline" onClick={() => onAbrirCliente(v.cliente_id!)}>{comprador}</button> : "sem cliente"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Ida × volta</dt>
                <dd className="text-[15px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{dataBR(v.data_embarque) || "—"} <span style={{ color: "var(--ink3)" }}>×</span> {dataBR(v.data_retorno) || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>De → para</dt>
                <dd className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{venda.de || "—"} → {venda.para || v.destino || "—"}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {v.bitrix_deal_id && (
                <a href={linkBitrix(v.bitrix_deal_id)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center px-3.5 py-2 rounded-lg text-[13px] font-semibold"
                  style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}>
                  Card no Bitrix #{v.bitrix_deal_id}
                </a>
              )}
              <Botao onClick={() => setEditando(true)}>Editar</Botao>
              {/* "Cancelar viagem" saiu daqui (Bruno, 15/10). Cancelada no Bitrix, cancela sozinha; reativar continua. */}
              {!ativa && <Botao onClick={() => void acao(() => salvarViagem(v.id, { status: "ativa" }))}>Reativar</Botao>}
              {ativa && <RevisaoViagem viagemId={v.id} equipe={equipe} />}
            </div>
          </div>
          <ConformidadeViagem viagemId={v.id} versao={versao} onRevisado={revisou} />
        </div>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {/* O que pode dar errado — sempre à vista, logo abaixo do topo */}
      <AlertasViagem problemas={analise?.problemas ?? null} />

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[minmax(300px,1fr)_minmax(0,1.6fr)_minmax(320px,1.1fr)] gap-4 items-start">
        {/* Esquerda — a venda e as pessoas */}
        <div className="space-y-4 min-w-0">
          <Secao titulo="Dados da venda">
            <dl>
              <Linha rotulo="Ida × volta">{v.data_embarque ? `${dataBR(v.data_embarque)} × ${dataBR(v.data_retorno) || "—"}` : ""}</Linha>
              <Linha rotulo="De → para">{venda.de || venda.para || v.destino ? `${venda.de || "—"} → ${venda.para || v.destino || "—"}` : ""}</Linha>
              <Linha rotulo="Venda">{[dataBR(v.data_venda), venda.closer && `por ${venda.closer}`].filter(Boolean).join(" ")}</Linha>
              <Linha rotulo="Passageiros">{v.qtd_passageiros ? `${v.qtd_passageiros} vendido(s) · ${v.passageiros} com ficha` : `${v.passageiros} com ficha`}</Linha>
              {v.expedicao && <Linha rotulo="Expedição">{v.expedicao}</Linha>}
              <Linha rotulo="Valor">{moeda(v.valor)}</Linha>
              <Linha rotulo="Cuida no Rel.">
                <select className="rel-input" style={{ padding: "5px 8px", fontSize: 13, width: "auto", minWidth: 160 }}
                  value={v.responsavel_id ?? ""}
                  onChange={(e) => void acao(() => salvarViagem(v.id, { responsavel_id: e.target.value || null }))}>
                  <option value="">ninguém</option>
                  {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Linha>
            </dl>
          </Secao>

          <Secao titulo="Quem viaja" acao={ativa ? <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setAddPass(true)}>+ Passageiro</Botao> : undefined}>
            {pass.length === 0 && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum passageiro com ficha.</p>}
            <ul>
              {pass.map((p) => {
                const c = p.cliente;
                if (!c) return null;
                const meses = mesesParaVencer(c.passaporte_validade);
                const passaporteCurto = !!(c.passaporte_validade && retornoMaisSeis && c.passaporte_validade < retornoMaisSeis);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-2" style={{ borderTop: "1px solid var(--line2)" }}>
                    <Avatar nome={c.nome} tamanho={32} />
                    <button onClick={() => onAbrirCliente(c.id)} className="flex-1 min-w-0 text-left">
                      <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                        {c.nome}{c.id === v.cliente_id ? <span className="font-normal" style={{ color: "var(--ink3)" }}> · comprou</span> : null}
                      </span>
                      <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
                        {formatarTelefone(c.telefone) || "sem telefone"}
                        {c.passaporte ? ` · passaporte ${c.passaporte}` : " · sem passaporte"}
                        {c.passaporte_validade ? ` até ${dataBR(c.passaporte_validade)}` : ""}
                      </span>
                    </button>
                    {passaporteCurto && <Etiqueta tom="erro">passaporte vence antes de 6 meses da volta</Etiqueta>}
                    {!passaporteCurto && meses !== null && meses < 0 && <Etiqueta tom="erro">passaporte vencido</Etiqueta>}
                    {p.bitrix_deal_id && <Etiqueta>card #{p.bitrix_deal_id}</Etiqueta>}
                    {c.id !== v.cliente_id && ativa && (
                      <Botao variante="fantasma" title="Tirar da viagem" onClick={() => { if (window.confirm(`Tirar ${c.nome} desta viagem?`)) void acao(() => removerPassageiro(p.id)); }}>×</Botao>
                    )}
                  </li>
                );
              })}
            </ul>
          </Secao>

          <Secao titulo="Do Comercial para o Relacionamento">
            {v.observacoes || v.necessidades ? (
              <div className="space-y-2">
                {v.observacoes && <p className="text-[14px] whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{v.observacoes}</p>}
                {v.necessidades && <Aviso><b>Necessidade especial:</b> {v.necessidades}</Aviso>}
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma observação. No Bitrix é o campo "Observações finais para o time de relacionamento".</p>
            )}
            {v.cliente_id && (
              <div className="mt-3 pt-3 flex flex-wrap gap-2" style={{ borderTop: "1px solid var(--line2)" }}>
                {conversa
                  ? <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirConversa(conversa.id)}>Abrir conversa no WhatsApp</Botao>
                  : <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirCliente(v.cliente_id!)}>Falar com o cliente (ficha)</Botao>}
              </div>
            )}
          </Secao>
        </div>

        {/* Meio — o roteiro */}
        <div className="min-w-0">
          <Secao titulo="Roteiro" acao={
            <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "var(--card2)" }} role="tablist" aria-label="Ver o roteiro">
              {([["dia", "Dia a dia"], ["tipo", "Por tipo"]] as const).map(([id, r]) => (
                <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold"
                  style={aba === id ? { background: "var(--card)", color: "var(--rel-ink)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--ink2)" }}>{r}</button>
              ))}
            </div>
          }>
            {aba === "dia"
              ? (analise
                ? <LinhaDoTempo viagemId={v.id} trechos={analise.trechos} problemas={analise.problemas} dataIda={v.data_embarque} dataVolta={v.data_retorno} ativa={ativa} onMudou={mudouTrecho} />
                : <div className="h-40 rounded-xl animate-pulse" style={{ background: "var(--card2)" }} />)
              : <RoteiroViagem viagemId={v.id} ativa={ativa} versao={versao} onMudou={mudouTrecho} />}
          </Secao>
        </div>

        {/* Direita — revisão e o que falta */}
        <div className="space-y-4 min-w-0 lg:col-span-2 2xl:col-span-1">
          <RevisaoIaViagem key={versao} viagemId={v.id} onRevisado={revisou} />
          <Secao titulo="Requisitos de entrada">
            <RequisitosEntrada destino={venda.para || v.destino} />
          </Secao>
          <Secao titulo="Jornada de revisão">
            <Jornada viagemId={v.id} ativa={ativa} recarregarViagem={() => void carregar()} />
          </Secao>
        </div>
      </div>

      <Secao titulo="Arquivos da viagem">
        <ArquivosViagem viagemId={v.id} pessoas={pessoas} versao={versao} />
        <details className="mt-4 pt-3" style={{ borderTop: "1px solid var(--line2)" }}>
          <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }}>Gerenciar documentos (enviar, aprovar, pedir ao cliente)</summary>
          <div className="mt-3"><DocumentosPainel pessoas={pessoas} viagemId={v.id} /></div>
        </details>
      </Secao>

      <EditarViagem aberto={editando} v={v} onFechar={() => setEditando(false)} onSalvo={() => { setEditando(false); void carregar(); }} />
      <AdicionarPassageiro aberto={addPass} viagemId={v.id} onFechar={() => setAddPass(false)} onAdicionado={() => { setAddPass(false); void carregar(); }} />
    </div>
  );
}
