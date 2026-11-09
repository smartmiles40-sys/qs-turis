// src/solicitacoes/SolicitacoesPage.tsx
// -----------------------------------------------------------------------------
// A CENTRAL DE SOLICITAÇÕES de um setor (0149, Bruno 20/10/2026). A mesma tela
// mora nas 4 áreas (Rel, Fin, Ops, Comercial/Closer); muda só o setor.
//
// Redesign 29/10 (docs/ref/qs-redesign-ficha-solicitacoes.md, seção 4):
//   cabeçalho (Tipos e prazos · Pedir a outro setor) → indicadores do setor →
//   UMA barra de controles: escopo (Recebidas · Pedidas por nós · Histórico),
//   busca, visualização (Quadro · Lista · Prazos), setor e dono. Tudo vai pra
//   URL: #rel/solicitacoes?escopo=pedidas&ver=lista&dono=comigo&s=<id>.
//   O pedido abre num MODAL central (SolicitacaoDetalhe) com setas pra navegar
//   na lista filtrada.
//
// O que veio das versões anteriores e continua:
//   0158 — colunas com a semântica da cotação: Novas (esperando aprovação) ·
//          Aguardando ajustes (falta info de quem pediu) · Em andamento (inclui
//          esperando cliente/fornecedor) · Concluídas; no Ops, o total de
//          cotações entregues e os desfechos. Em "Pedidas", o que espera o MEU
//          ajuste, o desfecho e a confirmação fica em cima ("Precisa de você").
//   0197 — "Só as que eu pedi" (o pedido é de quem pediu).
//   0203 — filtro por QUEM PEDIU com abertas/atrasadas (lembrado por setor).
//   0222 — o Relacionamento recebe com dono automático: o filtro "Dono: Comigo"
//          é a lista de "minhas demandas" de cada um (também lembrado).
// Recusadas e canceladas saem do quadro e ficam no Histórico.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { useAvisos } from "@/avisos/AvisosProvider";
import { PainelConversa, QuadroQ } from "./QuadroConversa";
import { passaNoFiltro, totalNaoLidas, type FiltroQ } from "./conversa";
import { Avatar, Btn, FilterPill, SearchInput, SectorChip, SectorDot, StatCard, StatusChip, type ChipTone } from "@/components/ui";
import { lerParamDoHash } from "@/lib/hashQuery";
import NovaSolicitacao from "./NovaSolicitacao";
import SolicitacaoDetalhe, { type LinksSol } from "./SolicitacaoDetalhe";
import TiposPrazos from "./TiposPrazos";
import { rotuloStatus } from "./cotacao";
import {
  AGUARDANDO, NOME_SETOR, agir, setoresDaCentral, aoMudarSolicitacao, buscar, contarEntregues, haQuanto, listarDoSetor, listarDoTime, listarMinhas, meuTime, type PessoaDoTime, primeiroNome, textoPrazo,
  type Entregues, type Setor, type Solicitacao,
} from "./lib";
import {
  atrasada, clienteDo, colunaDe, estadoInicial, faixaDe, gravarEstado, idDoCaminho, lembrar, lembrarDono, lembrarOrigem, naRotaDaCentral,
  ordenar, tirarIdDoCaminho, tomDoPrazo, venceHoje, type Coluna, type Dono, type Escopo, type EstadoTela, type Faixa, type Ver,
} from "./visao";
import "./solicitacoes.css";

/** Nome curto do setor nos chips dos cartões. */
const CURTO: Record<Setor, string> = { comercial: "Comercial", relacionamento: "Relac.", financeiro: "Financeiro", operacional: "Operações", marketing: "Marketing" };

/** Tom do chip de status (cor só pra estado). */
function tomChip(s: Solicitacao): ChipTone {
  if (s.status === "aguardando" && s.aguardando_quem === "solicitante") return "warn";
  if (s.status === "concluida") return s.desfecho_atrasado ? "danger" : s.desfecho === "nao_seguiu" ? "neutral" : "ok";
  return ({ nova: "warn", em_andamento: "info", aguardando: "neutral", concluida: "ok", recusada: "danger", cancelada: "neutral" } as const)[s.status];
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Busca local (Recebidas/Pedidas): número, título, cliente/viagem, tipo, descrição. */
function bate(s: Solicitacao, q: string) {
  const t = q.trim();
  if (!t) return true;
  if (/^#?\d+$/.test(t)) return String(s.numero) === t.replace("#", "");
  const n = semAcento(t);
  return [s.titulo, s.sobre_nome, s.tipo_rotulo, s.descricao, String(s.numero)].some((x) => x && semAcento(x).includes(n));
}

const COLUNAS: { id: Coluna; rotulo: string; dica: string }[] = [
  { id: "nova", rotulo: "Novas", dica: "esperando alguém aprovar" },
  { id: "ajustes", rotulo: "Aguardando ajustes", dica: "falta info de quem pediu" },
  { id: "andamento", rotulo: "Em andamento", dica: "inclui esperando cliente/fornecedor" },
  { id: "concluida", rotulo: "Concluídas", dica: "últimos 14 dias" },
];
/** No Operações (0158; 0203 sem nome de cotação — vale pra qualquer pedido). */
const COLUNAS_OPS: Partial<Record<Coluna, { rotulo: string; dica: string }>> = {
  nova: { rotulo: "Novas solicitações", dica: "esperando alguém aprovar" },
  concluida: { rotulo: "Concluídas / entregues", dica: "últimos 14 dias" },
};

const FAIXAS: { id: Faixa; rotulo: string; cor: string; vazio: string }[] = [
  { id: "atrasadas", rotulo: "Atrasadas", cor: "var(--danger)", vazio: "Nada atrasado." },
  { id: "hoje", rotulo: "Vencem hoje", cor: "var(--warn)", vazio: "Nada vence hoje." },
  { id: "semana", rotulo: "Próximos 7 dias", cor: "var(--info)", vazio: "Nada neste período." },
  { id: "depois", rotulo: "Mais adiante ou sem prazo", cor: "var(--subtle)", vazio: "Nada neste período." },
  { id: "concluidas", rotulo: "Concluídas (14 dias)", cor: "var(--ok)", vazio: "Nada concluído nos últimos 14 dias." },
];

export default function SolicitacoesPage({ setor, links, abrirId, onAbrirId, onMudou }: {
  setor: Setor;
  links?: LinksSol;
  /** Solicitação aberta pelo endereço (#area/solicitacoes/<id>) ou pelo aviso. */
  abrirId?: string | null;
  onAbrirId?: (id: string | null) => void;
  /** Avisa a casca pra recontar as bolinhas do menu. */
  onMudou?: () => void;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const gestor = currentUser?.role === "admin" || currentUser?.role === "gestor";
  // 0266 (04/11/2026): no Marketing, o próprio time ajusta os tipos de pedido
  // que o setor recebe (o banco libera só setor = 'marketing' pra ele).
  const ajustaTipos = gestor || (setor === "marketing" && currentUser?.role === "marketing");

  // ── Estado da tela (vai pra URL) ──
  const [estado, setEstado] = useState<EstadoTela>(() => estadoInicial(setor));
  const muda = (p: Partial<EstadoTela>) => setEstado((e) => ({ ...e, ...p }));
  const setOrigem = (o: EstadoTela["origem"]) => { muda({ origem: o }); lembrarOrigem(setor, o); };
  const setDono = (d: Dono) => { muda({ dono: d }); lembrarDono(setor, d); };
  const { escopo, ver, origem, dono, q, minhas } = estado;

  const [aberta, setAbertaEstado] = useState<string | null>(() => abrirId ?? idDoCaminho() ?? (naRotaDaCentral() ? lerParamDoHash("s") : null));
  const abertaRef = useRef(aberta);
  const setAberta = (id: string | null) => { abertaRef.current = id; setAbertaEstado(id); };
  const empurrou = useRef(false); // abriu o modal empilhando no histórico
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  // Link antigo "#area/solicitacoes/<id>" → "#area/solicitacoes?…&s=<id>"
  useEffect(() => { if (idDoCaminho()) tirarIdDoCaminho(); }, []);
  // A casca mandou abrir (aviso, "abrir solicitação" de outra tela). null não fecha:
  // quem fecha é a própria tela (e a casca relê o endereço sem o id).
  const abrirIdAnterior = useRef(abrirId);
  useEffect(() => {
    if (abrirId && abrirId !== abrirIdAnterior.current) setAberta(abrirId);
    abrirIdAnterior.current = abrirId;
  }, [abrirId]);
  // Estado → URL
  useEffect(() => { if (naRotaDaCentral()) gravarEstado(estado, aberta); }, [estado, aberta]);
  // URL → estado (link colado, aviso, voltar do navegador)
  useEffect(() => {
    const onHash = () => {
      if (!naRotaDaCentral()) return;
      const id = idDoCaminho() ?? lerParamDoHash("s");
      if (idDoCaminho()) tirarIdDoCaminho();
      if (!id) empurrou.current = false;
      if (id !== abertaRef.current) setAberta(id);
      gravarEstado(estadoRef.current, id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ── Dados ──
  const [recebidas, setRecebidas] = useState<Solicitacao[] | null>(null);
  const [pedidas, setPedidas] = useState<Solicitacao[] | null>(null);
  const [achadas, setAchadas] = useState<Solicitacao[] | null>(null);
  const [entregues, setEntregues] = useState<Entregues | null>(null);
  const [nova, setNova] = useState(false);
  const [tipos, setTipos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  // 0336: quem está abaixo de mim na hierarquia (vazio = não sou chefe de ninguém).
  const [time, setTime] = useState<PessoaDoTime[]>([]);
  useEffect(() => { void meuTime().then(setTime); }, [meuId]);
  const timeSet = useMemo(() => new Set(time.map((t) => t.id)), [time]);

  const carregar = useCallback(async () => {
    try {
      const [r, p, m, t] = await Promise.all([listarDoSetor(setor, "para"), listarDoSetor(setor, "de"), meuId ? listarMinhas(meuId) : Promise.resolve([]),
        listarDoTime([...timeSet]).catch(() => [] as Solicitacao[])]);
      setRecebidas(r);
      // Pedidas = do setor + as que EU pedi estando em outra área (admin/gestor de várias áreas)
      // + as do MEU TIME que não estão em nenhuma das duas (0336: ex.: pedidas em outro setor).
      const ids = new Set([...p.map((x) => x.id), ...r.map((x) => x.id)]);
      const extras = [...m.filter((x) => x.para_setor !== setor), ...t];
      const juntas = [...p];
      for (const x of extras) if (!ids.has(x.id)) { ids.add(x.id); juntas.push(x); }
      setPedidas(juntas);
      if (r.some((x) => x.cotacao) || setor === "operacional") contarEntregues(setor).then(setEntregues).catch(() => undefined);
      setAgora(Date.now());
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [setor, meuId, timeSet]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void carregar(); }, 30_000);
    // Aviso de solicitação chegou pelo Realtime (AvisosProvider): recarrega já.
    const desliga = aoMudarSolicitacao(() => { void carregar(); });
    return () => { clearInterval(t); desliga(); };
  }, [carregar]);

  // Histórico: busca no banco (número, cliente, assunto), esperando parar de digitar.
  const buscarHistorico = useCallback(async (termo: string) => {
    try { setAchadas(await buscar(setor, termo)); } catch (e) { setErro(e instanceof Error ? e.message : "Não buscou."); }
  }, [setor]);
  useEffect(() => {
    if (escopo !== "historico") return;
    const t = setTimeout(() => void buscarHistorico(q), 350);
    return () => clearTimeout(t);
  }, [escopo, q, buscarHistorico]);

  const mudou = useCallback(() => {
    void carregar();
    if (estadoRef.current.escopo === "historico") void buscarHistorico(estadoRef.current.q);
    onMudou?.();
  }, [carregar, buscarHistorico, onMudou]);

  // Abrir/fechar. Nas áreas com endereço (#rel, #fin, #ops, #closer) o modal vira
  // uma entrada no histórico (?s=<id>): o "voltar" do navegador fecha, e a casca
  // não remonta nem rola a página. No Comercial do SDR (sem endereço) avisa a casca.
  const abrir = (id: string) => {
    if (naRotaDaCentral()) {
      if (!abertaRef.current) { history.pushState(history.state, "", window.location.href); empurrou.current = true; }
      setAberta(id); // o efeito "Estado → URL" grava o ?s=
    } else {
      setAberta(id);
      onAbrirId?.(id);
    }
  };
  const fechar = () => {
    setAberta(null);
    if (naRotaDaCentral()) {
      if (empurrou.current) { empurrou.current = false; history.back(); }
    } else onAbrirId?.(null);
  };

  // ── O que entra no escopo ──
  /** O setor "do outro lado" do pedido, visto deste setor. */
  const outro = (s: Solicitacao): Setor => (s.para_setor === setor ? s.de_setor : s.para_setor);
  const doMeuTime = useCallback((s: Solicitacao) => passaNoFiltro(s, "time", meuId, 0, timeSet), [meuId, timeSet]);
  /** "Só as que eu pedi" não esconde o time quando o filtro "Meu time" está ligado. */
  const vendoTime = dono === "time";
  const pedidasVisiveis = useMemo(() => (pedidas ?? []).filter((s) => !minhas || s.criado_por === meuId || (vendoTime && doMeuTime(s))),
    [pedidas, minhas, meuId, vendoTime, doMeuTime]);
  const base = useMemo<Solicitacao[] | null>(() => {
    if (escopo === "recebidas") return recebidas && recebidas.filter((s) => colunaDe(s) !== "encerrada");
    if (escopo === "pedidas") return pedidas && pedidasVisiveis.filter((s) => colunaDe(s) !== "encerrada");
    return achadas;
  }, [escopo, recebidas, pedidas, pedidasVisiveis, achadas]);
  const doEscopo = useMemo(() => (base ?? []).filter((s) => escopo === "historico" || bate(s, q)), [base, escopo, q]);

  /** Contadores do filtro de setor (abertas e atrasadas de cada um). */
  const porOrigem = useMemo(() => {
    const m = new Map<Setor, { abertas: number; atrasadas: number }>();
    for (const s of setoresDaCentral()) if (s !== setor) m.set(s, { abertas: 0, atrasadas: 0 });
    for (const s of doEscopo) {
      const o = m.get(outro(s)); if (!o || !s.aberta) continue;
      o.abertas++; if (atrasada(s, agora) || s.sem_dono_atrasada) o.atrasadas++;
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doEscopo, setor, agora]);
  const daOrigem = useMemo(() => doEscopo.filter((s) => origem === "todas" || outro(s) === origem),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doEscopo, origem, setor]);
  const nComigo = daOrigem.filter((s) => s.aberta && s.responsavel_id === meuId).length;
  const nComigoAtrasadas = daOrigem.filter((s) => s.aberta && s.responsavel_id === meuId && atrasada(s, agora)).length;
  const nSemDono = daOrigem.filter((s) => s.aberta && !s.responsavel_id).length;
  const nTime = daOrigem.filter((s) => s.aberta && doMeuTime(s)).length;
  const itens = useMemo(() => daOrigem.filter((s) => dono === "todas" ? true : dono === "comigo" ? s.responsavel_id === meuId
    : dono === "time" ? doMeuTime(s) : !s.responsavel_id),
    [daOrigem, dono, meuId, doMeuTime]);

  // ── Indicadores do setor (sempre o que o setor RECEBE) ──
  const ind = useMemo(() => {
    const r = recebidas ?? [];
    const abertas = r.filter((s) => s.aberta);
    return {
      abertas: abertas.length,
      novas: abertas.filter((s) => s.status === "nova").length,
      hoje: abertas.filter((s) => venceHoje(s, agora)).length,
      atrasadas: abertas.filter((s) => atrasada(s, agora)).length,
      semDono: abertas.filter((s) => !s.responsavel_id).length,
      semDonoAtrasada: abertas.filter((s) => s.sem_dono_atrasada).length,
      concluidas: r.filter((s) => s.status === "concluida" && s.concluido_em && agora - new Date(s.concluido_em).getTime() <= 14 * 86_400_000).length,
    };
  }, [recebidas, agora]);

  // ── "Precisa de você" (Pedidas por nós) ──
  const paraAjustar = pedidasVisiveis.filter((s) => s.status === "aguardando" && s.aguardando_quem === "solicitante").sort(ordenar);
  const paraDesfecho = pedidasVisiveis.filter((s) => s.falta_desfecho && !s.desfecho).sort((a, b) => (a.desfecho_prazo ?? "").localeCompare(b.desfecho_prazo ?? ""));
  const paraConfirmar = pedidasVisiveis.filter((s) => s.status === "concluida" && !s.confirmado_em && s.criado_por === meuId && !s.falta_desfecho);
  const novidadesPedidas = pedidasVisiveis.filter((s) => s.novidade && s.criado_por === meuId).length;

  // ── Visões ──
  const comHistorico = escopo === "historico";
  const colunas = useMemo(() => {
    const cs = COLUNAS.map((c) => ({ ...c, ...(setor === "operacional" ? COLUNAS_OPS[c.id] : {}) }))
      .map((c) => (comHistorico && c.id === "concluida" ? { ...c, dica: "" } : c));
    if (comHistorico) cs.push({ id: "encerrada", rotulo: "Recusadas e canceladas", dica: "" });
    const m: Record<Coluna, Solicitacao[]> = { nova: [], ajustes: [], andamento: [], concluida: [], encerrada: [] };
    for (const s of itens) m[colunaDe(s)].push(s);
    return cs.map((c) => ({ ...c, itens: m[c.id].sort(ordenar) }));
  }, [itens, setor, comHistorico]);
  const linhas = useMemo(() => [...itens].sort(ordenar), [itens]);
  const faixas = useMemo(() => {
    const m: Record<Faixa, Solicitacao[]> = { atrasadas: [], hoje: [], semana: [], depois: [], concluidas: [] };
    for (const s of itens) { const f = faixaDe(s, agora); if (f) m[f].push(s); }
    return FAIXAS.map((f) => ({ ...f, itens: m[f.id].sort(ordenar) }));
  }, [itens, agora]);

  /** A ordem em que as setas do modal andam: a mesma da visão na tela. */
  const ordemNav = useMemo(() => (ver === "quadro" ? colunas.flatMap((c) => c.itens) : ver === "lista" ? linhas : faixas.flatMap((f) => f.itens)).map((s) => s.id),
    [ver, colunas, linhas, faixas]);
  const pos = aberta ? ordemNav.indexOf(aberta) : -1;
  const navegar = (delta: 1 | -1) => {
    if (!ordemNav.length) return;
    const i = pos < 0 ? 0 : (pos + delta + ordemNav.length) % ordemNav.length;
    setAberta(ordemNav[i]); // troca sem empilhar no "voltar" do navegador (a URL é atualizada pelo efeito)
  };

  const lado = (s: Solicitacao): "para" | "de" => (s.para_setor === setor ? "para" : "de");
  const carregando = base === null;
  const rotuloOrigem = escopo === "recebidas" ? "Quem pediu" : escopo === "pedidas" ? "Pra quem" : "Setor";

  // ── 05/11: QUADRO + CONVERSA (Recebidas e Pedidas por nós) ──
  // O "Buscar" (escopo historico) continua com a tela antiga (quadro/lista/prazos
  // + modal). No quadro, o cartão abre o pedido num MODAL CENTRAL (0316); o completo
  // (SolicitacaoDetalhe) abre pelo "Ver tudo e mais ações".
  const modoQuadro = ehQuadro(escopo);
  const meusSetores = setoresDe(currentUser);
  const avisos = useAvisos();
  const [filtroQ, setFiltroQEstado] = useState<FiltroQ>(() => {
    try { const v = localStorage.getItem(`qs_sol_filtro_${setor}`); return v === "atrasados" || v === "comigo" || v === "time" ? v : "todos"; } catch { return "todos"; }
  });
  const setFiltroQ = (f: FiltroQ) => { setFiltroQEstado(f); lembrar(`qs_sol_filtro_${setor}`, f); };
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [conviteFechado, setConviteFechado] = useState(() => { try { return !!localStorage.getItem("qs_sol_convite_notif"); } catch { return false; } });
  const fecharConvite = () => { setConviteFechado(true); lembrar("qs_sol_convite_notif", "1"); };

  const doQuadro = useMemo(() => (base ?? []).filter((s) => origem === "todas" || outro(s) === origem),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, origem, setor]);
  const noQuadro = useMemo(() => doQuadro.filter((s) => passaNoFiltro(s, filtroQ, meuId, agora, timeSet)), [doQuadro, filtroQ, meuId, agora, timeSet]);
  const nTimeQ = doQuadro.filter((s) => s.aberta && doMeuTime(s)).length;
  const nAtrasadosQ = doQuadro.filter((s) => s.aberta && passaNoFiltro(s, "atrasados", meuId, agora)).length;
  const nComigoQ = doQuadro.filter((s) => s.aberta && s.responsavel_id === meuId).length;
  /** Selo das abas: não lidas (0315) — antes dela, o que já existia (novas / novidades). */
  const temNaoLidas = (recebidas ?? []).some((s) => typeof s.nao_lidas === "number");
  const seloRecebidas = temNaoLidas ? totalNaoLidas(recebidas ?? []) : ind.novas;
  const seloPedidas = temNaoLidas ? totalNaoLidas(pedidasVisiveis) : novidadesPedidas + paraAjustar.length + paraDesfecho.length;

  // Pedido aberto pelo aviso que só está em "Pedidas por nós": troca de aba sozinho.
  useEffect(() => {
    if (!aberta || escopo !== "recebidas" || !recebidas || !pedidas) return;
    if (!recebidas.some((s) => s.id === aberta) && pedidas.some((s) => s.id === aberta)) muda({ escopo: "pedidas" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, recebidas, pedidas]);

  // Foi pro "Buscar" com uma conversa aberta: fecha a conversa (lá o pedido abre no modal).
  const escopoAntes = useRef(escopo);
  useEffect(() => {
    const mudouDeAba = escopoAntes.current !== escopo;
    escopoAntes.current = escopo;
    if (mudouDeAba && escopo === "historico" && abertaRef.current) { empurrou.current = false; setAberta(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopo]);

  const pegar = useCallback(async (id: string) => {
    try { await agir(id, "aceitar"); mudou(); abrir(id); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não deu pra pegar."); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mudou]);

  if (modoQuadro) {
    return (
      <div className="sol" style={{ maxWidth: "none", gap: 0 }}>
        <div className="solq">
          <header className="solq-top">
            <div className="solq-top__tx">
              <h1>Solicitações</h1>
              <p>{NOME_SETOR[setor]} · clique num cartão para abrir o pedido</p>
            </div>
            <div className="solq-seg" role="tablist" aria-label="Escopo">
              <button type="button" role="tab" aria-selected={escopo === "recebidas"} onClick={() => muda({ escopo: "recebidas" })}>
                Recebidas{seloRecebidas > 0 && <span className="solq-seg__n" aria-label={`${seloRecebidas} não lidas`}>{seloRecebidas}</span>}
              </button>
              <button type="button" role="tab" aria-selected={escopo === "pedidas"} onClick={() => muda({ escopo: "pedidas" })}>
                Pedidas por nós{seloPedidas > 0 && <span className="solq-seg__n" aria-label={`${seloPedidas} não lidas`}>{seloPedidas}</span>}
              </button>
              <button type="button" role="tab" aria-selected={false} onClick={() => muda({ escopo: "historico" })}>Buscar</button>
            </div>
            <div className="solq-filtros" role="group" aria-label="Filtro">
              {([["todos", "Todos", 0], ["atrasados", "Atrasados", nAtrasadosQ], ["comigo", "Comigo", nComigoQ],
                ...(time.length ? [["time", "Meu time", nTimeQ]] : [])] as [FiltroQ, string, number][]).map(([f, r, n]) => (
                <button key={f} type="button" className="solq-pill" aria-pressed={filtroQ === f} onClick={() => setFiltroQ(f)}>
                  {r}{n > 0 && <span className="solq-pill__n">{n}</span>}
                </button>
              ))}
              <label className="sr-only" htmlFor={`solq-origem-${setor}`}>{rotuloOrigem}</label>
              <select id={`solq-origem-${setor}`} className="solq-select" value={origem} onChange={(e) => setOrigem(e.target.value as EstadoTela["origem"])}>
                <option value="todas">{escopo === "recebidas" ? "De todos os setores" : "Pra todos os setores"}</option>
                {porOrigem.map(([s, o]) => (
                  <option key={s} value={s}>{escopo === "recebidas" ? "Do " : "Pro "}{NOME_SETOR[s]}{o.abertas ? ` (${o.abertas})` : ""}</option>
                ))}
              </select>
            </div>
            {gestor && <button type="button" className="solq-btn" onClick={() => setTipos(true)}>Tipos e prazos</button>}
            <button type="button" className="solq-btn solq-btn--pri" onClick={() => setNova(true)}>Pedir a outro setor</button>
          </header>

          {avisos && avisos.permissao === "default" && !conviteFechado && (
            <div className="solq-convite" role="note">
              <span>Quer um aviso do navegador quando responderem um pedido seu, mesmo com o QS em outra aba?</span>
              <button type="button" className="solq-btn solq-btn--pri" onClick={() => { void avisos.pedirPermissao().finally(fecharConvite); }}>Ativar avisos</button>
              <button type="button" className="solq-btn" onClick={fecharConvite}>Agora não</button>
            </div>
          )}
          {erro && <p className="sol-erro" role="alert" style={{ marginTop: 12 }}>{erro}</p>}

          {escopo === "pedidas" && (paraAjustar.length > 0 || paraDesfecho.length > 0 || paraConfirmar.length > 0) && (
            <section className="sol-precisa" aria-label="Precisa de você" style={{ marginTop: 16 }}>
              <h2>Precisa de você</h2>
              {paraAjustar.length > 0 && <GrupoPrecisa titulo="Voltaram pra você — responda o que falta" itens={paraAjustar} abrir={abrir} setor={setor} agora={agora} />}
              {paraDesfecho.length > 0 && <GrupoPrecisa titulo="Cotações entregues — conte se fechou ou por que não seguiu" itens={paraDesfecho} abrir={abrir} setor={setor} agora={agora} />}
              {paraConfirmar.length > 0 && <GrupoPrecisa titulo="Concluídas — confira e clique em “Resolveu”" itens={paraConfirmar} abrir={abrir} setor={setor} agora={agora} />}
            </section>
          )}

          <div className="solq-corpo">
            {carregando ? <p className="sol-carregando" style={{ padding: "20px 0" }}>Carregando…</p> : (
              <QuadroQ itens={noQuadro} meuId={meuId} recebo={(s) => meusSetores.includes(s.para_setor)} aberta={aberta} agora={agora}
                onAbrir={abrir} onPegar={pegar} onHistorico={() => muda({ escopo: "historico" })} />
            )}
            {aberta && <PainelConversa key={aberta} id={aberta} onFechar={fechar} onMudou={mudou} onVerTudo={setDetalhe} links={links} />}
          </div>
        </div>

        <NovaSolicitacao aberto={nova} deSetor={setor} onFechar={() => setNova(false)}
          onCriada={(id) => { setNova(false); muda({ escopo: "pedidas" }); mudou(); abrir(id); }} />
        <SolicitacaoDetalhe id={detalhe} onFechar={() => setDetalhe(null)} onMudou={mudou} links={links} />
        {tipos && <TiposPrazos onFechar={() => setTipos(false)} />}
      </div>
    );
  }

  return (
    <div className="sol">
      {/* 1. Cabeçalho */}
      <header className="sol-head">
        <div className="sol-head__tx">
          <h1>Solicitações</h1>
          <p>Pedidos entre setores, com dono e prazo. Você está em <span className="sol-setor"><SectorDot setor={setor} />{NOME_SETOR[setor]}</span></p>
        </div>
        <div className="sol-head__acts">
          {ajustaTipos && <Btn onClick={() => setTipos(true)}>Tipos e prazos</Btn>}
          <Btn variant="primary" onClick={() => setNova(true)}>Pedir a outro setor</Btn>
        </div>
      </header>

      {/* 2. Indicadores do setor */}
      <section className="sol-stats" aria-label={`Resumo do ${NOME_SETOR[setor]}`}>
        <StatCard label="Abertas" value={recebidas ? ind.abertas : "—"} sub={ind.novas ? `${ind.novas} nova${ind.novas === 1 ? "" : "s"}, ninguém pegou` : "recebidas pelo setor"}
          onClick={() => muda({ escopo: "recebidas", ver: "quadro" })} />
        <StatCard label="Vencem hoje" value={recebidas ? ind.hoje : "—"} tone={ind.hoje ? "warn" : "default"} sub="no horário de Brasília"
          onClick={() => muda({ escopo: "recebidas", ver: "prazos" })} />
        <StatCard label="Atrasadas" value={recebidas ? ind.atrasadas : "—"} tone={ind.atrasadas ? "danger" : "default"} sub={ind.atrasadas ? "passaram do prazo" : "nada atrasado"}
          onClick={() => muda({ escopo: "recebidas", ver: "prazos" })} />
        <StatCard label="Sem dono" value={recebidas ? ind.semDono : "—"} tone={ind.semDonoAtrasada ? "danger" : ind.semDono ? "warn" : "default"}
          sub={ind.semDonoAtrasada ? `${ind.semDonoAtrasada} há +2h úteis` : "ninguém assumiu"}
          onClick={() => { muda({ escopo: "recebidas" }); setDono("sem_dono"); }} />
        <StatCard label="Concluídas" value={recebidas ? ind.concluidas : "—"} tone={ind.concluidas ? "ok" : "default"} sub="últimos 14 dias"
          onClick={() => muda({ escopo: "recebidas", ver: "prazos" })} />
      </section>

      {/* 3. Barra de controles */}
      <section className="sol-ctrl" aria-label="Filtros">
        <div className="sol-ctrl__l1">
          <div className="sol-seg" role="tablist" aria-label="Escopo">
            <BotaoSeg ativo={escopo === "recebidas"} onClick={() => muda({ escopo: "recebidas" })} n={ind.novas}>Recebidas</BotaoSeg>
            <BotaoSeg ativo={escopo === "pedidas"} onClick={() => muda({ escopo: "pedidas" })} n={novidadesPedidas + paraAjustar.length + paraDesfecho.length}>Pedidas por nós</BotaoSeg>
            <BotaoSeg ativo={escopo === "historico"} onClick={() => muda({ escopo: "historico" })}>Buscar</BotaoSeg>
          </div>
          <div className="sol-ctrl__busca">
            <SearchInput value={q} onChange={(e) => muda({ q: e.target.value })} placeholder="Buscar por cliente, viagem ou número"
              aria-label={comHistorico ? "Buscar no histórico (número, cliente ou assunto)" : "Buscar por cliente, viagem ou número"} />
          </div>
          <div className="sol-seg" role="group" aria-label="Visualização">
            {([["quadro", "Quadro"], ["lista", "Lista"], ["prazos", "Prazos"]] as [Ver, string][]).map(([v, r]) => (
              <button key={v} type="button" aria-pressed={ver === v} onClick={() => muda({ ver: v })}>{r}</button>
            ))}
          </div>
        </div>
        <div className="sol-ctrl__l2">
          <span className="sol-ctrl__rot" id="sol-rot-dono">Dono</span>
          <div className="sol-ctrl__l2" role="group" aria-labelledby="sol-rot-dono">
            <FilterPill active={dono === "todas"} onClick={() => setDono("todas")}>Todas</FilterPill>
            <FilterPill active={dono === "comigo"} onClick={() => setDono("comigo")} count={nComigo} countTone={nComigoAtrasadas ? "danger" : undefined}>Comigo</FilterPill>
            <FilterPill active={dono === "sem_dono"} onClick={() => setDono("sem_dono")} count={nSemDono} countTone={nSemDono ? "warn" : undefined}>Sem dono</FilterPill>
            {time.length > 0 && (
              <FilterPill active={dono === "time"} onClick={() => setDono("time")} count={nTime}>Meu time</FilterPill>
            )}
          </div>
          <span className="sol-ctrl__sep" aria-hidden />
          <span className="sol-ctrl__rot" id="sol-rot-setor">{rotuloOrigem}</span>
          <div className="sol-ctrl__l2" role="group" aria-labelledby="sol-rot-setor">
            <FilterPill active={origem === "todas"} onClick={() => setOrigem("todas")}>Todos</FilterPill>
            {porOrigem.map(([s, o]) => (
              <FilterPill key={s} active={origem === s} onClick={() => setOrigem(s)} count={o.abertas} countTone={o.atrasadas ? "danger" : undefined}>
                <SectorDot setor={s} />{NOME_SETOR[s]}
                {o.atrasadas > 0 && <span className="sr-only">, {o.atrasadas} atrasada{o.atrasadas === 1 ? "" : "s"}</span>}
              </FilterPill>
            ))}
          </div>
          {escopo === "pedidas" && (
            <>
              <span className="sol-ctrl__sep" aria-hidden />
              <FilterPill active={minhas} onClick={() => muda({ minhas: !minhas })}>Só as que eu pedi</FilterPill>
            </>
          )}
        </div>
      </section>

      {erro && <p className="sol-erro" role="alert">{erro}</p>}

      {/* Pedidas por nós: o que depende de quem pediu, em cima (0158/0197) */}
      {escopo === "pedidas" && (paraAjustar.length > 0 || paraDesfecho.length > 0 || paraConfirmar.length > 0) && (
        <section className="sol-precisa" aria-label="Precisa de você">
          <h2>Precisa de você</h2>
          {paraAjustar.length > 0 && <GrupoPrecisa titulo="Aguardando seus ajustes — abra e clique em “Enviar ajustes”" itens={paraAjustar} abrir={abrir} setor={setor} agora={agora} />}
          {paraDesfecho.length > 0 && <GrupoPrecisa titulo="Cotações entregues — conte se fechou ou por que não seguiu" itens={paraDesfecho} abrir={abrir} setor={setor} agora={agora} />}
          {paraConfirmar.length > 0 && <GrupoPrecisa titulo="Concluídas — confira e clique em “Resolveu”" itens={paraConfirmar} abrir={abrir} setor={setor} agora={agora} />}
        </section>
      )}

      {/* 4–6. Quadro, Lista e Prazos */}
      {carregando ? <p className="sol-carregando">Carregando…</p> : (
        <>
          {ver === "quadro" && (
            <div className="sol-board" aria-label="Quadro">
              {colunas.map((c) => (
                <section key={c.id} className="sol-col" aria-label={`${c.rotulo}: ${c.itens.length}`}>
                  <header className="sol-col__h">
                    <h2 className="sol-col__t">{c.rotulo}<span className="sol-col__n">{c.itens.length}</span></h2>
                    {c.dica && <span className="sol-col__d">{c.dica}</span>}
                  </header>
                  {c.id === "concluida" && escopo === "recebidas" && entregues && entregues.total > 0 && (
                    <div className="sol-entregues">
                      <span><b style={{ color: "var(--text)" }}>{entregues.total}</b> cotaç{entregues.total === 1 ? "ão entregue" : "ões entregues"} desde o início</span>
                      <span>
                        <span className="sol-to">{entregues.fechou} fecharam</span> · {entregues.naoSeguiu} não seguiram · {entregues.semDesfecho} sem desfecho
                        {entregues.atrasado > 0 && <span className="sol-td"> ({entregues.atrasado} atrasado{entregues.atrasado > 1 ? "s" : ""})</span>}
                      </span>
                    </div>
                  )}
                  {c.itens.length === 0 && <div className="sol-vazio">Nada por aqui</div>}
                  {c.itens.map((s) => <Cartao key={s.id} s={s} lado={lado(s)} meuId={meuId} agora={agora} onAbrir={() => abrir(s.id)} />)}
                </section>
              ))}
            </div>
          )}

          {ver === "lista" && (
            linhas.length === 0 ? <Vazio escopo={escopo} setor={setor} /> : (
              <div className="sol-tabela">
                <table>
                  <thead>
                    <tr><th scope="col">Pedido</th><th scope="col">Cliente · viagem</th><th scope="col">Setor</th><th scope="col">Prazo</th><th scope="col">Dono</th><th scope="col">Status</th></tr>
                  </thead>
                  <tbody>
                    {linhas.map((s) => {
                      const cli = clienteDo(s);
                      const pz = textoPrazo(s);
                      return (
                        <tr key={s.id} onClick={() => abrir(s.id)}>
                          <td>
                            <button type="button" className="sol-tabela__ped" onClick={(e) => { e.stopPropagation(); abrir(s.id); }}>
                              <small>#{s.numero} · {s.tipo_rotulo ?? "Pedido"}{s.prioridade === "urgente" && s.aberta ? " · Urgente" : ""}</small>
                              <span>{s.titulo}</span>
                            </button>
                          </td>
                          <td>{cli ? <>{cli.nome}{cli.viagem && <> · {cli.viagem}</>}</> : <span className="sol-tw">Sem cliente vinculado</span>}</td>
                          <td><SectorChip setor={outro(s)}>{lado(s) === "para" ? "de " : "pra "}{CURTO[outro(s)]}</SectorChip></td>
                          <td><ChipPrazo s={s} agora={agora} texto={pz.texto} /></td>
                          <td>{s.responsavel_id ? (s.responsavel_id === meuId ? "Você" : s.responsavel_nome) : <span className={s.sem_dono_atrasada ? "sol-td" : "sol-tw"}>Sem dono</span>}</td>
                          <td><StatusChip tone={tomChip(s)}>{rotuloStatus(s, true)}</StatusChip></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {ver === "prazos" && (
            <div className="sol-prazos">
              {faixas.map((f) => (
                <section key={f.id} className="sol-faixa" aria-label={`${f.rotulo}: ${f.itens.length}`}>
                  <div className="sol-faixa__h">
                    <span className="qs-dot" style={{ background: f.cor }} aria-hidden />
                    <h2>{f.rotulo}</h2>
                    <span className="sol-col__n">{f.itens.length}</span>
                  </div>
                  {f.itens.length === 0 ? <p className="sol-col__d" style={{ margin: 0 }}>{f.vazio}</p>
                    : f.itens.map((s) => <LinhaPrazo key={s.id} s={s} agora={agora} meuId={meuId} onAbrir={() => abrir(s.id)} />)}
                </section>
              ))}
            </div>
          )}

          {ver === "quadro" && itens.length === 0 && (base?.length ?? 0) > 0 && (
            <p className="sol-carregando">Nada com esses filtros. Troque o dono ou o setor acima.</p>
          )}
        </>
      )}

      <NovaSolicitacao aberto={nova} deSetor={setor} onFechar={() => setNova(false)}
        onCriada={(id) => { setNova(false); muda({ escopo: "pedidas" }); mudou(); abrir(id); }} />
      <SolicitacaoDetalhe id={aberta} onFechar={fechar} onMudou={mudou} links={links}
        nav={pos >= 0 ? { pos: pos + 1, total: ordemNav.length, onIr: navegar } : undefined} />
      {tipos && <TiposPrazos onFechar={() => setTipos(false)} />}
    </div>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────────

/** Recebidas e Pedidas usam o quadro + conversa; o Buscar (historico), a tela antiga. */
function ehQuadro(e: Escopo): boolean { return e !== "historico"; }

function BotaoSeg({ ativo, onClick, n, children }: { ativo: boolean; onClick: () => void; n?: number; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={ativo} onClick={onClick}>
      {children}{!!n && <span className="sol-seg__n" aria-label={`${n} com novidade`}>{n}</span>}
    </button>
  );
}

function ChipPrazo({ s, agora, texto }: { s: Solicitacao; agora: number; texto: string }) {
  const t = tomDoPrazo(s, agora);
  return <StatusChip tone={t === "neutral" ? "neutral" : t}>{texto}</StatusChip>;
}

/** Cartão do quadro: número, setor, tipo, Urgente, título, cliente, prazo e "dono · de quem pediu". */
function Cartao({ s, lado, meuId, agora, onAbrir }: { s: Solicitacao; lado: "para" | "de"; meuId: string; agora: number; onAbrir: () => void }) {
  const outro: Setor = lado === "para" ? s.de_setor : s.para_setor;
  const cli = clienteDo(s);
  const alerta = (s.aberta && (atrasada(s, agora) || s.sem_dono_atrasada)) || s.desfecho_atrasado;
  const pz = textoPrazo(s);
  const dono = s.responsavel_id ? (s.responsavel_id === meuId ? "Você" : primeiroNome(s.responsavel_nome)) : null;
  const extras: ReactNode[] = [];
  if (s.prioridade === "alta" && s.aberta) extras.push(<span key="a" className="sol-tw">Prioridade alta</span>);
  if (s.status === "aguardando" && s.aguardando_quem && s.aguardando_quem !== "solicitante") extras.push(<span key="w">esperando {AGUARDANDO[s.aguardando_quem]}</span>);
  if (s.desfecho_atrasado) extras.push(<span key="d" className="sol-td">desfecho atrasado</span>);
  if (s.desfecho) extras.push(<span key="f" className={s.desfecho === "fechou" ? "sol-to" : undefined}>{s.desfecho === "fechou" ? "fechou" : "não seguiu"}</span>);
  if (s.reaberturas > 0) extras.push(<span key="r" className="sol-tw">reaberta</span>);
  return (
    <button type="button" onClick={onAbrir} data-sol={s.id}
      className={`sol-card${alerta ? " sol-card--alerta" : ""}${s.aberta ? "" : " sol-card--fechada"}`}
      aria-label={`Solicitação #${s.numero}: ${s.titulo}${alerta ? " — atrasada" : ""}${s.novidade ? " — tem novidade" : ""}`}>
      {s.novidade && <span className="sol-novidade" aria-hidden title="Tem novidade" />}
      <span className="sol-card__top">
        <span className="sol-card__meta">
          <span className="sol-card__num">#{s.numero}</span>
          <SectorChip setor={outro}>{lado === "para" ? "de " : "pra "}{CURTO[outro]}</SectorChip>
          <span className="sol-card__tipo">{s.tipo_rotulo}</span>
        </span>
        {s.prioridade === "urgente" && s.aberta && <StatusChip tone="danger">Urgente</StatusChip>}
      </span>
      <span className="sol-card__titulo">{s.titulo}</span>
      {cli ? (
        <span className="sol-card__cli"><Avatar name={cli.nome} size={24} /><span>{cli.nome}{cli.viagem && ` · ${cli.viagem}`}</span></span>
      ) : <span className="sol-card__semcli">Sem cliente vinculado</span>}
      {extras.length > 0 && <span className="sol-card__extra">{extras}</span>}
      <span className="sol-card__pe">
        <ChipPrazo s={s} agora={agora} texto={pz.texto} />
        <span>
          {dono ?? <span className={s.sem_dono_atrasada ? "sol-td" : "sol-tw"}>Sem dono{s.sem_dono_atrasada ? ` (${haQuanto(s.criado_em)})` : ""}</span>}
          {s.criado_por_nome && <> · de {primeiroNome(s.criado_por_nome)}</>}
        </span>
      </span>
    </button>
  );
}

function LinhaPrazo({ s, agora, meuId, onAbrir }: { s: Solicitacao; agora: number; meuId: string; onAbrir: () => void }) {
  const cli = clienteDo(s);
  const pz = textoPrazo(s);
  const t = tomDoPrazo(s, agora);
  return (
    <button type="button" className="sol-linha" onClick={onAbrir} data-sol={s.id}>
      <span className={t === "danger" ? "sol-td" : t === "warn" ? "sol-tw" : t === "ok" ? "sol-to" : undefined}>{pz.texto}</span>
      <b>#{s.numero} · {s.titulo}</b>
      <span>{cli ? `${cli.nome}${cli.viagem ? ` · ${cli.viagem}` : ""}` : "Sem cliente vinculado"}</span>
      <span>{s.responsavel_id ? (s.responsavel_id === meuId ? "Você" : primeiroNome(s.responsavel_nome)) : "Sem dono"}</span>
    </button>
  );
}

function GrupoPrecisa({ titulo, itens, abrir, setor, agora }: { titulo: string; itens: Solicitacao[]; abrir: (id: string) => void; setor: Setor; agora: number }) {
  return (
    <div className="sol-precisa__g">
      <span className="sol-precisa__t">{titulo} · {itens.length}</span>
      {itens.map((s) => {
        const cli = clienteDo(s);
        const atrasou = s.desfecho_atrasado || atrasada(s, agora);
        return (
          <button key={s.id} type="button" className="sol-linha" onClick={() => abrir(s.id)} data-sol={s.id}>
            <span className={atrasou ? "sol-td" : undefined}>
              {s.falta_desfecho && s.desfecho_prazo && !s.desfecho
                ? `desfecho ${s.desfecho_atrasado ? "venceu" : "até"} ${new Date(s.desfecho_prazo).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}`
                : rotuloStatus(s, true)}
            </span>
            <b>#{s.numero} · {s.titulo}</b>
            <span>{cli ? cli.nome : "Sem cliente vinculado"}</span>
            <span>pra {NOME_SETOR[s.para_setor === setor ? s.de_setor : s.para_setor]}</span>
          </button>
        );
      })}
    </div>
  );
}

function Vazio({ escopo, setor }: { escopo: Escopo; setor: Setor }) {
  const t = escopo === "recebidas"
    ? [`Nada pro ${NOME_SETOR[setor]} com esses filtros`, "Quando outro setor pedir alguma coisa, ela aparece aqui com prazo e quem pediu."]
    : escopo === "pedidas"
      ? ["Nada pedido com esses filtros", "Use “Pedir a outro setor” — ou o botão dentro da viagem, da ficha ou do lead."]
      : ["Nada encontrado", "Busque pelo número (#12), nome do cliente ou assunto."];
  return (
    <div className="qs-card2" style={{ textAlign: "center" }}>
      <p style={{ margin: 0, fontWeight: 600 }}>{t[0]}</p>
      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--subtle)" }}>{t[1]}</p>
    </div>
  );
}
