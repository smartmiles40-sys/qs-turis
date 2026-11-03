// src/rel/viagens/ViagemPage.tsx
// -----------------------------------------------------------------------------
// A VIAGEM (Fase 3): dados da venda, quem viaja, a JORNADA do Relacionamento
// (tarefas com prazo contado a partir da venda, do embarque e da volta) e os
// documentos de todos os passageiros.
//
// A jornada nasce do modelo em rel_config.jornada. Mudou a data de embarque?
// O banco refaz os prazos das tarefas pendentes sozinho — as feitas ficam.
//
// 03/11: layout do desenho "Viagem" (Claude Design) — ver "Página" mais abaixo.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  ACOMPANHAMENTOS, FASES, SERVICOS, TIPOS_DOC, TIPOS_VIAGEM, adicionarPassageiro, grupoDe, hojeSP, apagarTarefa, carregarViagem, criarTarefa, dataBR, linkBitrix,
  listarEquipeRel, listarPassageiros, listarTarefas, marcarTarefa, removerPassageiro, resumoDaVenda, salvarViagem,
  type Passageiro, type Tarefa, type TipoDocumento, type TipoViagem, type Trecho, type Viagem, type ViagemInput,
} from "../lib/viagens";
import { buscarClientes, formatarTelefone, type Cliente } from "../lib/clientes";
import { conversasDoCliente, type Conversa } from "../lib/whatsapp";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";
import DocumentosPainel from "./DocumentosPainel";
import RevisaoIaViagem from "./RevisaoIaViagem";
import { AgoraEProximo, titulo as tituloTrecho } from "./RoteiroViagem";
import ArquivosViagem from "./ArquivosViagem";
import ConformidadeViagem, { RequisitosEntrada } from "./ConformidadeViagem";
import AlertasViagem, { CSS_PISCA } from "./AlertasViagem";
import LinhaDoTempo from "./LinhaDoTempo";
import EtapasViagem from "./EtapasViagem";
import SeletorServico from "./SeletorServico";
import { ProximoVooDestaque } from "./ProximoVoo";
import { temEsteira } from "../lib/etapas";
import { RevisaoViagem } from "./TrechosViagem";
import { conferirViagens, diaLocal, mapaDasNoites, type Analise } from "../lib/problemas";
import { codigoDe, resumirVoos } from "../lib/statusViagem";
import { carregarComponentes, documentosDaViagem, type Componente, type DocResumo } from "../lib/componentes";
import { estadoDocumento, estadoPassaporte, noitesEntre, prontidaoDaViagem, seloEmbarque, type EstadoPront } from "../lib/prontidao";
import { gruposDaViagem, type Grupo } from "../lib/grupos";
import { TOM_FASE } from "./ViagensDoCliente";
import { BotaoPedirOutroSetor, BotaoPedirPagamento, PedidosSobre } from "@/solicitacoes/PedirOutroSetor";
import ConferirVoos from "./ConferirVoos";
import DonoViagem, { HistoricoViagem } from "./DonoViagem";
import PreferenciasViagem from "./PreferenciasViagem";
import FichaFechamentoResumo from "@/closer/FichaFechamentoResumo";
import { atribuirViagens, desarquivarViagens } from "../lib/operacao";
import { podeGerirRelacionamento } from "../equipe/permissao";
import { BotaoSubirVenda } from "@/venda/SubirVenda";
import TudoDaViagem from "./TudoDaViagem";
import { SeloDaViagem } from "@/prioridades/SeloPrioridade";
import VoosDaViagem from "./VoosDaViagem";
import RoteiroCartoes, { type InfoVoo } from "./RoteiroCartoes";
import { correcaoDisponivel, correcoesDaViagem, type Correcao } from "../lib/correcoes";
import { conferidosDoHistorico, jaAconteceu } from "../lib/conferencia";
import "./viagem-ficha.css";

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-1.5">
      <dt className="text-[12px] sm:w-36 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</dt>
      <dd className="text-[14px] min-w-0 break-words" style={{ color: "var(--ink)" }}>{children || <span style={{ color: "var(--ink3)" }}>—</span>}</dd>
    </div>
  );
}

const moeda = (n: number | null) => (n == null ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
// dia de São Paulo — o UTC marcava "atrasada" a partir das 21h (22/10)
const hoje = () => hojeSP();

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
// 03/11 (Bruno, desenho "Viagem" no Claude Design): a ficha no layout novo.
//   topo       — nome, selos (embarque, serviço · esteira), rota/datas/pax/valor,
//                Card no Bitrix, Pedir pagamento, Mais ações; Comprou / Vendido por
//                / Relacionamento (sem dono = vermelho + Assumir)
//   prontidão  — barra + 8 quadrinhos (lib/prontidao.ts) + a % da IA, se houver
//   alertas    — o conferente; a esteira do Relacionamento
//   colunas    — Roteiro em cartões (dia a dia / por tipo) + Voos e check-ins
//                | Quem viaja, Requisitos de entrada, Documentos, Relacionamento,
//                  revisão da IA, outras tarefas, ficha de fechamento
//   embaixo    — Tudo da viagem (itens da venda), Arquivos e documentos, Dados da
//                venda e histórico
// Nada da ficha antiga sumiu — ver a tabela no commit "Ficha da viagem no desenho novo".

function Quadro({ rotulo, children, onClick, alerta }: { rotulo: string; children: ReactNode; onClick?: () => void; alerta?: boolean }) {
  const cls = `vf-quadro${alerta ? " vf-quadro--alerta" : ""}`;
  if (onClick) return <button type="button" className={cls} onClick={onClick}><span className="vf-rot">{rotulo}</span>{children}</button>;
  return <div className={cls}><span className="vf-rot">{rotulo}</span>{children}</div>;
}

const ICONE_ESTADO: Record<EstadoPront, ReactNode> = {
  ok: <path d="M20 6L9 17l-5-5" />,
  atencao: <path d="M12 8v5M12 17h.01" />,
  falta: <path d="M18 6L6 18M6 6l12 12" />,
  neutro: <path d="M6 12h12" />,
};
const ROTULO_ESTADO: Record<EstadoPront, string> = { ok: "pronto", atencao: "atenção", falta: "falta", neutro: "sem dado ou não se aplica" };

function Prontidao({ p, carregando, children }: { p: ReturnType<typeof prontidaoDaViagem>; carregando: boolean; children?: ReactNode }) {
  return (
    <section className="vf-card vf-pront" aria-label="Prontidão da viagem" aria-busy={carregando}>
      <div className="vf-pront__top">
        <div className="flex flex-col gap-0.5">
          <h2 className="vf-h2">Prontidão da viagem</h2>
          <span className="vf-sub">
            {carregando ? "Conferindo…" : `${p.prontos} de ${p.aplicaveis} itens prontos para embarcar`}
            {!carregando && p.quadros.length > p.aplicaveis ? ` · ${p.quadros.length - p.aplicaveis} sem dado ou não se aplica` : ""}
          </span>
        </div>
        <div className="vf-barra" role="progressbar" aria-label="Prontidão" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${carregando ? 0 : p.pct}%` }} />
        </div>
      </div>
      <div className="vf-tiles">
        {p.quadros.map((t) => (
          <div key={t.chave} className={`vf-tile vf-tile--${t.estado}`}>
            <div className="vf-tile__r">
              <span className="vf-tile__rot">{t.rotulo}</span>
              <span className={`vf-ico vf-ico--${t.estado}`} role="img" aria-label={ROTULO_ESTADO[t.estado]}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONE_ESTADO[t.estado]}</svg>
              </span>
            </div>
            <span className="vf-tile__v">{carregando ? "…" : t.valor}</span>
            <span className="vf-tile__d">{carregando ? "" : t.detalhe}</span>
          </div>
        ))}
      </div>
      {children}
    </section>
  );
}

const iniciais = (n: string) => n.trim().split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const PAPEL_VAZIO = new Map<string, InfoVoo>();

export default function ViagemPage({ id, onVoltar, onAbrirCliente, onAbrirConversa, onAbrirExpedicao }: {
  id: string; onVoltar: () => void; onAbrirCliente: (id: string) => void; onAbrirConversa: (conversaId: string) => void;
  /** 0208: o componente "Expedição" abre a expedição no Ops */
  onAbrirExpedicao?: (expedicaoId: string, tipo: string | null) => void;
}) {
  const { currentUser } = useQsAuth();
  // desarquivar (0184) é só a gestão — o banco recusa os outros, então nem mostra o botão
  const gestor = podeGerirRelacionamento(currentUser);
  const [v, setV] = useState<Viagem | null>(null);
  // a revisão da IA grava trechos e o %: muda a versão pra roteiro/arquivos/% recarregarem
  const [versao, setVersao] = useState(0);
  const [pass, setPass] = useState<Passageiro[]>([]);
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [venda, setVenda] = useState<{ closer: string | null; de: string | null; para: string | null }>({ closer: null, de: null, para: null });
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [sinalPedidos, setSinalPedidos] = useState(0);
  const [addPass, setAddPass] = useState(false);
  const [maisAcoes, setMaisAcoes] = useState(false);
  const [assumindo, setAssumindo] = useState(false);
  // o conferente (lib/problemas.ts): riscos + os trechos que a linha do tempo desenha
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [aba, setAba] = useState<"dia" | "tipo">("dia");
  // pra prontidão e a lateral (o TudoDaViagem e a Jornada carregam os seus)
  const [comps, setComps] = useState<Componente[] | null>(null);
  const [docs, setDocs] = useState<DocResumo[] | null>(null);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  // 0227/0310: o histórico de correções — de onde sai quem conferiu cada voo
  const [hist, setHist] = useState<Correcao[]>([]);

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
  useEffect(() => { gruposDaViagem(id).then(setGrupos).catch(() => setGrupos([])); }, [id]);
  useEffect(() => {
    carregarComponentes(id).then((r) => setComps(r.itens)).catch(() => setComps([]));
    documentosDaViagem(id).then(setDocs).catch(() => setDocs([]));
    listarTarefas(id).then(setTarefas).catch(() => setTarefas([]));
    correcoesDaViagem(id).then(setHist).catch(() => setHist([]));
  }, [id, versao]);
  const conferidos = useMemo(() => conferidosDoHistorico(hist), [hist]);
  const chaveConf = v ? `${v.id}|${v.data_embarque}|${v.data_retorno}|${v.status}|${v.tipo}|${pass.length}|${versao}` : "";
  useEffect(() => {
    if (!v) return;
    let vivo = true;
    conferirViagens([v]).then((m) => { if (vivo) setAnalise(m.get(v.id) ?? { problemas: [], trechos: [] }); }).catch(() => { if (vivo) setAnalise({ problemas: [], trechos: [] }); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveConf]);
  // alerta clicado → mostra o dia a dia pra ele achar o trecho
  useEffect(() => {
    const ir = () => setAba("dia");
    window.addEventListener("rel-ir-trecho", ir);
    return () => window.removeEventListener("rel-ir-trecho", ir);
  }, []);

  const pessoas = useMemo(() => pass.filter((p) => p.cliente).map((p) => ({ id: p.cliente_id, nome: p.cliente!.nome })), [pass]);

  // os voos pela régua única (statusViagem): papel (ida/volta/interno), estado e se valem
  const resumo = useMemo(() => (v && analise ? resumirVoos({
    data_embarque: v.data_embarque, data_retorno: v.data_retorno, status: v.status, titulo: v.titulo, expedicao: v.expedicao, servico: v.servico,
    fase_manual: v.fase_manual ?? null, fase_manual_motivo: v.fase_manual_motivo ?? null, fase_manual_ate: v.fase_manual_ate ?? null,
    alertas_ignorados: v.alertas_ignorados ?? null,
  }, analise.trechos) : null), [v, analise]);
  const infoVoos = useMemo(() => {
    if (!resumo) return PAPEL_VAZIO;
    return new Map<string, InfoVoo>(resumo.voos.map((x) => [x.t.id, { papel: x.papel, estado: x.estado, valido: x.valido, motivoFora: x.motivoFora }]));
  }, [resumo]);

  const pront = useMemo(() => {
    const trechos = analise?.trechos ?? [];
    const agora = Date.now();
    const hojeDia = hojeSP();
    // o que já aconteceu (voado, chegada/check-out no passado) não é pendência
    const passou = (t: Trecho) => jaAconteceu(t, agora, infoVoos.get(t.id)?.estado);
    const noites = mapaDasNoites(trechos.filter((t) => !(t.tipo === "voo_internacional" || t.tipo === "voo_interno") || (infoVoos.get(t.id)?.valido ?? true)));
    const nNoites = (t: Trecho) => {
      if (!t.chegada_em) return null;
      const a = diaLocal(t.partida_em, t.partida_fuso), b = diaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso);
      return a && b ? noitesEntre(a, b) : null;
    };
    return prontidaoDaViagem({
      servico: v?.servico ?? null, acompanhamento: v?.acompanhamento ?? null,
      voos: (resumo?.voos ?? []).map((x) => ({
        id: x.t.id, papel: x.papel, valido: x.valido, cancelado: x.estado === "cancelado", semHora: x.t.fonte === "bitrix",
        localizador: x.t.localizador, partida_em: x.t.partida_em, partida_fuso: x.t.partida_fuso,
        conferido: conferidos.has(x.t.id), passou: passou(x.t),
        origem: codigoDe(x.t.origem_codigo, x.t.origem) || x.t.origem, destino: codigoDe(x.t.destino_codigo, x.t.destino) || x.t.destino,
      })),
      hoteis: trechos.filter((t) => t.tipo === "hospedagem").map((t) => ({ nome: tituloTrecho(t), noites: nNoites(t) })),
      noitesSemHotel: [...noites.semHotel].filter((d) => d >= hojeDia).length,
      passeios: trechos.filter((t) => t.tipo === "passeio" && !passou(t)).map((t) => ({ nome: tituloTrecho(t), comVoucher: !!t.documento_id })),
      itens: (comps ?? []).filter((c) => c.fonte === "venda").map((c) => ({ tipo: c.tipo, status: c.status, nome: c.nome })),
      docs: docs ?? [],
      passageiros: pass.filter((p) => p.cliente).map((p) => ({ nome: p.cliente!.nome, passaporte: p.cliente!.passaporte, passaporte_validade: p.cliente!.passaporte_validade })),
      qtdVendida: v?.qtd_passageiros ?? null,
      dataReferencia: v ? v.data_retorno || v.data_embarque : null,
      sherpa: null, // a API do Sherpa ainda não está ligada (ConformidadeViagem → RequisitosEntrada)
    }, hojeSP());
  }, [v, analise, resumo, infoVoos, comps, docs, pass, conferidos]);

  if (erro && !v) return <div className="max-w-4xl mx-auto"><Aviso tom="erro">{erro}</Aviso></div>;
  if (!v) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando viagem…</p>;

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); await carregar(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  const ativa = v.status === "ativa";
  const revisou = () => { setVersao((n) => n + 1); void carregar(); };
  const mudouTrecho = () => setVersao((n) => n + 1);
  const comprador = pass.find((p) => p.cliente_id === v.cliente_id)?.cliente?.nome || v.cliente_nome;
  const sobre = [comprador, v.expedicao || v.titulo].filter(Boolean).join(" · ");
  const selo = seloEmbarque(v.fase, v.dias_para_embarque, v.status);
  const noites = noitesEntre(v.data_embarque, v.data_retorno);
  const nPax = v.qtd_passageiros || pass.length || v.passageiros;
  const carregandoPront = !analise || comps === null || docs === null;
  const donoNome = v.responsavel_id ? (equipe.find((u) => u.id === v.responsavel_id)?.name ?? v.responsavel_nome ?? "alguém do time").replace(/\s*\|.*$/, "") : null;
  const souDono = !!v.responsavel_id && v.responsavel_id === currentUser?.id;

  // a rota: pelos voos que valem (cidade de saída → paradas → chegada); sem voo, o que o Bitrix diz
  const rota = (() => {
    const vs = (resumo?.voos ?? []).filter((x) => x.valido && x.estado !== "cancelado").map((x) => x.t);
    if (!vs.length) return venda.de || venda.para || v.destino ? `${venda.de || "—"} → ${venda.para || v.destino || "—"}` : "";
    const cod = (c?: string | null, n?: string | null) => codigoDe(c, n) || n || "?";
    const pontos = [cod(vs[0].origem_codigo, vs[0].origem)];
    vs.forEach((t, i) => {
      const prox = vs[i + 1];
      const conexao = prox && t.chegada_em && Date.parse(prox.partida_em) - Date.parse(t.chegada_em) < 24 * 3600_000;
      if (!conexao) pontos.push(cod(t.destino_codigo, t.destino));
    });
    return pontos.filter((p, i) => p !== pontos[i - 1]).join(" → ");
  })();

  const tarefaDe = (re: RegExp) => tarefas.find((t) => re.test(t.titulo));
  const boasVindas = tarefaDe(/boas-vindas de volta/i);
  const recompra = tarefaDe(/recompra|indica/i);
  const textoTarefa = (t?: Tarefa) => (!t ? "Nada agendado" : t.feita_em ? `feita em ${new Date(t.feita_em).toLocaleDateString("pt-BR")}` : t.prazo ? dataBR(t.prazo) : "sem prazo");

  const irPara = (id: string, _abrirDocs = false) => {
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <div className="vf">
      <style>{CSS_PISCA}</style>
      <button onClick={onVoltar} className="vf-voltar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        Viagens
      </button>

      {/* ── Cabeçalho ── */}
      <header className="vf-card vf-head">
        <div className="vf-head__top">
          <div className="vf-head__titulo">
            <div className="vf-linha">
              <h1 className="vf-h1">{v.titulo}</h1>
              <span className={`vf-pill vf-pill--${selo.tom}`}>{selo.texto}</span>
              <span className="vf-pill vf-pill--neutro">{v.servico ? SERVICOS[v.servico] : "Serviço a classificar"} · {ACOMPANHAMENTOS[v.acompanhamento]}</span>
            </div>
            <div className="vf-meta">
              {rota && <span>{rota}</span>}
              <span>{v.data_embarque ? `${dataBR(v.data_embarque).slice(0, 5)} a ${dataBR(v.data_retorno) || "—"}` : "Sem data"}{noites != null ? ` · ${noites} noite${noites === 1 ? "" : "s"}` : ""}</span>
              <span>{nPax} passageiro{nPax === 1 ? "" : "s"}{v.qtd_passageiros && pass.length !== v.qtd_passageiros ? ` (${pass.length} com ficha)` : ""}</span>
              {v.valor != null && <span>{moeda(v.valor)}</span>}
              {v.expedicao && <span>Expedição: {v.expedicao}</span>}
            </div>
            <div className="vf-linha">
              <Etiqueta tom={TOM_FASE[v.fase]}>{FASES[v.fase]}</Etiqueta>
              {ativa && <ProximoVooDestaque v={v} />}
              {v.tarefas_atrasadas > 0 && <Etiqueta tom="erro">{v.tarefas_atrasadas} tarefa{v.tarefas_atrasadas > 1 ? "s" : ""} atrasada{v.tarefas_atrasadas > 1 ? "s" : ""}</Etiqueta>}
              <SeloDaViagem v={v} />
            </div>
          </div>
          <div className="vf-acoes">
            {v.bitrix_deal_id && <a className="vf-btn" href={linkBitrix(v.bitrix_deal_id)} target="_blank" rel="noreferrer">Card no Bitrix #{v.bitrix_deal_id}</a>}
            <BotaoPedirPagamento deSetor="relacionamento" onCriada={() => setSinalPedidos((n) => n + 1)} alvo={{ viagemId: v.id, clienteId: v.cliente_id, sobre }} />
            <button type="button" className="vf-btn" aria-expanded={maisAcoes} aria-controls="vf-mais-acoes" onClick={() => setMaisAcoes((x) => !x)}>
              Mais ações
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: maisAcoes ? "rotate(180deg)" : undefined }}><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
        </div>

        {/* Mais ações: fica aberto (não é popover) — os botões abrem os próprios modais */}
        {maisAcoes && (
          <div id="vf-mais-acoes" className="vf-caixa" role="group" aria-label="Mais ações">
            <div className="flex flex-wrap items-center gap-2">
              <Botao onClick={() => setEditando(true)}>Editar viagem</Botao>
              {/* 0214: venda nova nesta viagem (seguro, passeio, upgrade…) pela tela única de venda. */}
              {ativa && <BotaoSubirVenda origem="rel" viagemId={v.id} rotulo="Nova venda nesta viagem"
                cliente={v.cliente_id ? { id: v.cliente_id, nome: comprador || "Cliente da viagem" } : undefined} />}
              {/* Central de Solicitações (0149): ex. pedir emissão/alteração pra Operações */}
              <BotaoPedirOutroSetor deSetor="relacionamento" onCriada={() => setSinalPedidos((n) => n + 1)} alvo={{ viagemId: v.id, clienteId: v.cliente_id, sobre }} />
              {ativa && <Botao onClick={() => setAddPass(true)}>+ Passageiro</Botao>}
              {/* arquivada (0184) volta pela função do banco: limpa o motivo e fica no histórico (só a gestão) */}
              {!ativa && (v.status !== "arquivada" || gestor) && <Botao onClick={() => void acao(() => (v.status === "arquivada" ? desarquivarViagens({ ids: [v.id] }) : salvarViagem(v.id, { status: "ativa" })))}>{v.status === "arquivada" ? "Desarquivar" : "Reativar"}</Botao>}
              {v.cliente_id && <Botao onClick={() => onAbrirCliente(v.cliente_id!)}>Abrir ficha do cliente</Botao>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="vf-sub">O que foi vendido:</span>
              <SeletorServico v={v} onMudou={revisou} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span className="vf-sub">Ir para:</span>
              <button type="button" className="vf-link" onClick={() => irPara("vf-voos")}>Voos e check-ins</button>
              <button type="button" className="vf-link" onClick={() => irPara("vf-tudo")}>Itens da venda</button>
              <button type="button" className="vf-link" onClick={() => irPara("vf-arquivos", true)}>Arquivos e documentos</button>
              <button type="button" className="vf-link" onClick={() => irPara("vf-tarefas")}>Outras tarefas</button>
            </div>
          </div>
        )}

        <div className="vf-quadros">
          <Quadro rotulo="Comprou" onClick={v.cliente_id ? () => onAbrirCliente(v.cliente_id!) : undefined}>
            <b>{comprador || "sem cliente ligado"}</b>
          </Quadro>
          <Quadro rotulo="Vendido por">
            <b>{[venda.closer || "closer não informado", v.data_venda && `em ${dataBR(v.data_venda)}`].filter(Boolean).join(" · ")}</b>
          </Quadro>
          {/* 0184: o dono da viagem — sem dono, ninguém sente que a viagem é sua */}
          <div className={`vf-quadro${donoNome ? "" : " vf-quadro--alerta"}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="vf-rot">Relacionamento</span>
                <b>{donoNome ? (souDono ? `${donoNome} (você)` : donoNome) : "Ninguém cuidando"}</b>
              </div>
              {!donoNome && ativa && (
                <button type="button" className="vf-btn vf-btn--sm vf-btn--claro" disabled={assumindo || !currentUser?.id}
                  onClick={() => { setAssumindo(true); void acao(() => atribuirViagens([v.id], currentUser!.id)).finally(() => { setAssumindo(false); setVersao((n) => n + 1); }); }}>
                  {assumindo ? "Assumindo…" : "Assumir"}
                </button>
              )}
            </div>
            <div className="pt-1"><DonoViagem viagemId={v.id} responsavelId={v.responsavel_id} equipe={equipe} onMudou={revisou} soTrocar /></div>
          </div>
        </div>
      </header>

      <PedidosSobre alvo={{ viagemId: v.id }} recarregar={sinalPedidos} links={{ onAbrirCliente, onAbrirConversa }} />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {/* ── Prontidão (lib/prontidao.ts) + a % da revisão da IA, quando existe ── */}
      <Prontidao p={pront} carregando={carregandoPront}>
        <ConformidadeViagem viagemId={v.id} versao={versao} onRevisado={revisou} />
      </Prontidao>

      {/* O que pode dar errado — sempre à vista */}
      <AlertasViagem problemas={analise?.problemas ?? null} />

      {/* A esteira do Relacionamento (16/10): pacote, aéreo e cruzeiro completos; hotel/passeio só Revisão + D-3 (0148) */}
      {ativa && temEsteira(v) && <EtapasViagem viagem={v} trechos={analise?.trechos ?? []} equipe={equipe} onMudou={revisou} />}
      {/* Expedição não tem esteira — sem isto ela nunca podia ser marcada como revisada ("0 de 564", 19/10) */}
      {ativa && grupoDe(v) === "expedicao" && (
        <section className="rel-card p-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px]" style={{ color: "var(--ink2)" }}><b style={{ color: "var(--ink)" }}>Revisão</b> · passageiros, documentos, voos e reservas conferidos</span>
          <RevisaoViagem viagemId={v.id} equipe={equipe} />
        </section>
      )}

      <div className="vf-cols">
        {/* ── Coluna principal: o roteiro ── */}
        <main className="vf-main">
          <section className="vf-card" aria-label="Roteiro">
            <div className="vf-rot__top">
              <h2 className="vf-h2">Roteiro</h2>
              <div className="vf-toggle" role="tablist" aria-label="Ver o roteiro">
                {([["dia", "Dia a dia"], ["tipo", "Por tipo"]] as const).map(([k, r]) => (
                  <button key={k} type="button" role="tab" aria-selected={aba === k} onClick={() => setAba(k)}>{r}</button>
                ))}
              </div>
            </div>
            {ativa && <ConferirVoos key={versao} viagemId={v.id} onMudou={() => { mudouTrecho(); void carregar(); }} />}
            {analise && v.fase === "em_viagem" && <AgoraEProximo trechos={analise.trechos} />}
            <RoteiroCartoes viagemId={v.id} trechos={analise ? analise.trechos : null} problemas={analise?.problemas ?? []} voos={infoVoos}
              quadros={carregandoPront ? [] : pront.quadros} dataIda={v.data_embarque} dataVolta={v.data_retorno} ativa={ativa} modo={aba}
              onMudou={revisou} onAnexar={() => irPara("vf-arquivos", true)} conferidos={conferidos} correcao={correcaoDisponivel(v)} />
            {analise && analise.trechos.length > 0 && (
              <details className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: "var(--muted)" }}>Linha do tempo completa (noites, dias livres, trechos fora das datas)</summary>
                <div className="mt-3">
                  <LinhaDoTempo viagemId={v.id} trechos={analise.trechos} problemas={analise.problemas} dataIda={v.data_embarque} dataVolta={v.data_retorno} ativa={ativa} onMudou={mudouTrecho} />
                </div>
              </details>
            )}
          </section>

          {/* 30/10 (0227): os voos que valem, voo interno sim/não, check-ins e a correção manual pelo supervisor */}
          <div id="vf-voos"><VoosDaViagem v={v} trechos={analise ? analise.trechos : null} onMudou={revisou} /></div>
        </main>

        {/* ── Coluna lateral ── */}
        <aside className="vf-aside">
          <section className="vf-card vf-card--aside" aria-label="Quem viaja">
            <div className="flex justify-between items-center gap-2">
              <h2 className="vf-h2 vf-h2--sm">Quem viaja</h2>
              {ativa && <button type="button" className="vf-link" onClick={() => setAddPass(true)}>+ Passageiro</button>}
            </div>
            {pass.length === 0 && <p className="vf-sub">Nenhum passageiro com ficha.</p>}
            {pass.map((p) => {
              const c = p.cliente;
              if (!c) return null;
              const pp = estadoPassaporte(c, v.data_retorno || v.data_embarque, hojeSP());
              return (
                <div key={p.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 justify-between">
                    <button type="button" className="vf-pessoa text-left" onClick={() => onAbrirCliente(c.id)}>
                      <span className="vf-ini" aria-hidden>{iniciais(c.nome)}</span>
                      <span className="flex flex-col min-w-0">
                        <b className="truncate">{c.nome}</b>
                        <span className="vf-sub">{formatarTelefone(c.telefone) || "sem telefone"}{c.id === v.cliente_id ? " · comprou" : ""}{p.bitrix_deal_id ? ` · card #${p.bitrix_deal_id}` : ""}</span>
                      </span>
                    </button>
                    {c.id !== v.cliente_id && ativa && (
                      <button type="button" className="vf-link" style={{ color: "var(--danger)" }} title="Tirar da viagem" aria-label={`Tirar ${c.nome} da viagem`}
                        onClick={() => { if (window.confirm(`Tirar ${c.nome} desta viagem?`)) void acao(() => removerPassageiro(p.id)); }}>×</button>
                    )}
                  </div>
                  <div className="vf-caixa">
                    <span className="vf-sub">Passaporte{c.passaporte ? ` ${c.passaporte}` : ""}</span>
                    <b className={`vf-tx-${pp.estado}`}>{pp.texto}</b>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="vf-card vf-card--aside" aria-label="Requisitos de entrada">
            <div className="flex justify-between items-baseline gap-2 flex-wrap">
              <h2 className="vf-h2 vf-h2--sm">Requisitos de entrada</h2>
              <span className="vf-rot">{venda.para || v.destino || "destino"} · via Sherpa</span>
            </div>
            <div className="vf-lin"><span>Situação</span><b className="vf-tx-neutro">Não ligado</b></div>
            <RequisitosEntrada destino={venda.para || v.destino} />
          </section>

          <section className="vf-card vf-card--aside" aria-label="Documentos">
            <h2 className="vf-h2 vf-h2--sm">Documentos</h2>
            {docs === null ? <div className="h-10 rounded-lg animate-pulse" style={{ background: "var(--surface-2)" }} />
              : docs.length === 0 ? <p className="vf-sub">Nenhum documento enviado nesta viagem.</p>
              : docs.map((d, i) => {
                const e = estadoDocumento(d.status);
                const dono = pessoas.length > 1 ? pessoas.find((p) => p.id === d.cliente_id)?.nome.split(" ")[0] : null;
                return (
                  <div key={i} className="vf-lin vf-lin--borda">
                    <span style={{ color: "var(--text)" }}>{TIPOS_DOC[d.tipo as TipoDocumento] ?? d.tipo}{dono ? ` · ${dono}` : ""}</span>
                    <span className={`vf-pill vf-pill--${e.estado}`}>{e.rotulo}</span>
                  </div>
                );
              })}
            <button type="button" className="vf-link self-start" onClick={() => irPara("vf-arquivos", true)}>Gerenciar arquivos</button>
          </section>

          <section className="vf-card vf-card--aside" aria-label="Relacionamento">
            <h2 className="vf-h2 vf-h2--sm">Relacionamento</h2>
            {/* 0219: os grupos do WhatsApp ligados a esta viagem ou à expedição dela */}
            <div className="vf-lin">
              <span>Grupo do WhatsApp</span>
              {grupos === null ? <b>…</b> : grupos.length === 0
                ? <button type="button" className="vf-link" title="Em Grupos: abra o grupo → dados do grupo → Viagem" onClick={() => { window.location.hash = "#rel/grupos"; }}>Não ligado</button>
                : <span className="flex flex-col items-end">{grupos.map((g) => (
                  <button key={g.jid} type="button" className="vf-link text-right" onClick={() => { window.location.hash = `#rel/grupos/${encodeURIComponent(g.jid)}`; }}>
                    {g.nome || "Grupo sem nome"}{(g.nao_lidas ?? 0) > 0 ? ` (${g.nao_lidas})` : ""}
                  </button>))}</span>}
            </div>
            {/* 0184: preferências da pessoa — fácil de preencher e cobradas perto do embarque */}
            <details>
              <summary className="vf-lin cursor-pointer"><span>Preferências</span><b>{v.necessidades ? "ver e editar" : "anotar"}</b></summary>
              <div className="pt-2"><PreferenciasViagem key={`${v.id}${versao}`} viagemId={v.id} necessidades={v.necessidades} diasParaEmbarque={v.dias_para_embarque} ativa={ativa} equipe={equipe} /></div>
            </details>
            <div className="vf-lin"><span>Boas-vindas de volta</span><b>{textoTarefa(boasVindas)}</b></div>
            <div className="vf-lin"><span>Recompra / indicação</span><b>{textoTarefa(recompra)}</b></div>
            <div className="vf-lin" style={{ alignItems: "flex-start" }}>
              <span>Recado do Comercial</span>
              <b className="text-[13px] whitespace-pre-wrap" style={{ fontWeight: v.observacoes ? 500 : 600 }}>{v.observacoes || "Nada anotado"}</b>
            </div>
            {v.cliente_id && (conversa
              ? <button type="button" className="vf-btn vf-btn--wa" onClick={() => onAbrirConversa(conversa.id)}>Abrir conversa no WhatsApp</button>
              : <button type="button" className="vf-btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => onAbrirCliente(v.cliente_id!)}>Falar com o cliente (ficha)</button>)}
          </section>

          <RevisaoIaViagem key={versao} viagemId={v.id} onRevisado={revisou} />

          <section id="vf-tarefas" className="vf-card vf-card--aside" aria-label="Outras tarefas">
            <h2 className="vf-h2 vf-h2--sm">Outras tarefas</h2>
            <Jornada viagemId={v.id} ativa={ativa} recarregarViagem={() => { setVersao((n) => n + 1); void carregar(); }} />
          </section>

          {/* 0176: o que o closer consolidou (itens, plano de pagamento, preferências). Sem venda consolidada não aparece nada. */}
          <FichaFechamentoResumo viagemId={v.id} />
        </aside>
      </div>

      {/* 0208: itens da venda por tipo (aéreo, hotel, seguro, expedição…), o que falta e as próximas datas */}
      <div id="vf-tudo"><TudoDaViagem v={v} pass={pass} versao={versao} onMudou={revisou} onAbrirExpedicao={onAbrirExpedicao} /></div>

      {/* 03/11: o envio e a revisão (Aprovar / Recusar no cartão) à vista; com a prontidão
          incompleta, o topo vira "soltar arquivo" + "Ajustar a venda" (o mesmo Editar viagem) */}
      <section id="vf-arquivos" className="vf-card flex flex-col gap-3" aria-label="Arquivos da viagem">
        <h2 className="vf-h2">Arquivos da viagem</h2>
        <DocumentosPainel pessoas={pessoas} viagemId={v.id} onMudou={() => setVersao((n) => n + 1)}
          ficha={{ incompleto: !carregandoPront && pront.quadros.some((q) => q.estado === "atencao" || q.estado === "falta"), onAjustarVenda: () => setEditando(true) }} />
        <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <ArquivosViagem viagemId={v.id} pessoas={pessoas} versao={versao} />
        </div>
      </section>

      <details className="vf-mais">
        <summary>Dados da venda e histórico <span>{v.origem === "bitrix" ? "veio do Bitrix" : "lançada no QS"}</span></summary>
        <div className="vf-mais__corpo">
          <dl>
            <Linha rotulo="Ida × volta">{v.data_embarque ? `${dataBR(v.data_embarque)} × ${dataBR(v.data_retorno) || "—"}` : ""}</Linha>
            <Linha rotulo="De → para">{venda.de || venda.para || v.destino ? `${venda.de || "—"} → ${venda.para || v.destino || "—"}` : ""}</Linha>
            <Linha rotulo="Venda">{[dataBR(v.data_venda), venda.closer && `por ${venda.closer}`].filter(Boolean).join(" ")}</Linha>
            <Linha rotulo="Passageiros">{v.qtd_passageiros ? `${v.qtd_passageiros} vendido(s) · ${v.passageiros} com ficha` : `${v.passageiros} com ficha`}</Linha>
            {v.expedicao && <Linha rotulo="Expedição">{v.expedicao}</Linha>}
            <Linha rotulo="Valor">{moeda(v.valor)}</Linha>
            <Linha rotulo="Necessidades">{v.necessidades ?? ""}</Linha>
          </dl>
          <HistoricoViagem viagemId={v.id} equipe={equipe} versao={versao} />
        </div>
      </details>

      <EditarViagem aberto={editando} v={v} onFechar={() => setEditando(false)} onSalvo={() => { setEditando(false); void carregar(); }} />
      <AdicionarPassageiro aberto={addPass} viagemId={v.id} onFechar={() => setAddPass(false)} onAdicionado={() => { setAddPass(false); void carregar(); }} />
    </div>
  );
}
