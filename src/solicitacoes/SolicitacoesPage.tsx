// src/solicitacoes/SolicitacoesPage.tsx
// -----------------------------------------------------------------------------
// A CENTRAL DE SOLICITAÇÕES de um setor (0149, Bruno 20/10/2026). A mesma tela
// mora nas 4 áreas; muda só o setor:
//
//   Recebidas   — a fila de trabalho do setor, em colunas
//                 (Novas · Em andamento · Aguardando · Concluídas)
//   Pedidas     — o que o setor pediu aos outros e em que pé está
//                 (concluída esperando "resolveu" fica em cima)
//   Buscar      — histórico por número, cliente ou assunto
//
// Gestor/admin vê em vermelho o que ninguém pegou em 2h úteis e o que venceu.
//
// 0158 (Bruno 21/10): as colunas seguem as etapas da cotação — Nova solicitação
// (esperando aprovação) · Aguardando ajustes · Em cotação · Cotação entregue
// (com o total de sempre e os desfechos). Em "Pedidas", em cima: o que espera
// o MEU ajuste e as cotações entregues que precisam do desfecho.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Botao, Entrada, Etiqueta, Vazio } from "@/rel/ui";
import NovaSolicitacao from "./NovaSolicitacao";
import SolicitacaoDetalhe, { SetorChip, type LinksSol } from "./SolicitacaoDetalhe";
import TiposPrazos from "./TiposPrazos";
import { rotuloStatus, tomStatus } from "./cotacao";
import {
  AGUARDANDO, COR_SETOR, NOME_SETOR, PRIORIDADE_SOL, SIGLA, buscar, contarEntregues, haQuanto, listarDoSetor, listarMinhas,
  primeiroNome, textoPrazo, type Entregues, type Setor, type Solicitacao,
} from "./lib";

type Aba = "recebidas" | "pedidas" | "buscar";
type Filtro = "todas" | "comigo" | "sem_dono";

const PESO_PRIORIDADE = { urgente: 0, alta: 1, normal: 2 } as const;
/** O que vence primeiro em cima; urgente na frente. */
function ordenar(a: Solicitacao, b: Solicitacao) {
  const p = PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade];
  if (p) return p;
  return (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999");
}

function Cartao({ s, lado, meuId, onAbrir }: { s: Solicitacao; lado: "para" | "de"; meuId: string; onAbrir: () => void }) {
  const prazo = textoPrazo(s);
  const outro: Setor = lado === "para" ? s.de_setor : s.para_setor;
  const alerta = (s.aberta && (s.vencida || s.sem_dono_atrasada)) || s.desfecho_atrasado;
  return (
    <button onClick={onAbrir} className="rel-card rel-linha w-full text-left p-3 space-y-1.5 relative"
      style={alerta ? { borderColor: "var(--err-line)", boxShadow: "inset 3px 0 0 var(--err-ink)" } : undefined}
      aria-label={`Solicitação #${s.numero}: ${s.titulo}${alerta ? " — atrasada" : ""}`}>
      {s.novidade && <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full" style={{ background: "var(--rel)" }} title="Tem novidade" aria-label="Tem novidade" />}
      <span className="flex items-center gap-2 text-[11.5px] pr-4" style={{ color: "var(--ink3)" }}>
        <b>#{s.numero}</b>
        <span className="inline-flex items-center gap-1 font-bold" style={{ color: COR_SETOR[outro] }}>
          {lado === "para" ? "de" : "pra"} {SIGLA[outro]}
        </span>
        <span className="truncate">{s.tipo_rotulo}</span>
      </span>
      <span className="block text-[14px] font-semibold leading-snug line-clamp-2" style={{ color: "var(--ink)" }}>{s.titulo}</span>
      {s.sobre_nome ? <span className="block text-[12.5px] truncate" style={{ color: "var(--ink2)" }}>{s.sobre_nome}</span>
        : <span className="block text-[12px] font-semibold" style={{ color: "var(--warn-ink)" }}>sem cliente amarrado</span>}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        {s.prioridade !== "normal" && <span className="font-bold" style={{ color: s.prioridade === "urgente" ? "var(--err-ink)" : "var(--warn-ink)" }}>{PRIORIDADE_SOL[s.prioridade]}</span>}
        <span style={{ color: prazo.tom === "erro" ? "var(--err-ink)" : prazo.tom === "aviso" ? "var(--warn-ink)" : "var(--ink3)", fontWeight: prazo.tom === "neutro" ? 400 : 600 }}>{prazo.texto}</span>
        <span style={{ color: s.sem_dono_atrasada ? "var(--err-ink)" : "var(--ink3)", fontWeight: s.sem_dono_atrasada ? 600 : 400 }}>
          · {s.responsavel_id ? (s.responsavel_id === meuId ? "com você" : `com ${primeiroNome(s.responsavel_nome)}`) : `ninguém pegou (pedido ${haQuanto(s.criado_em)})`}
        </span>
        {lado === "para" && s.criado_por_nome && <span style={{ color: "var(--ink3)" }}>· pediu {primeiroNome(s.criado_por_nome)}</span>}
        {s.status === "aguardando" && s.aguardando_quem && <span style={{ color: s.aguardando_quem === "solicitante" ? "var(--warn-ink)" : "var(--ink2)", fontWeight: s.aguardando_quem === "solicitante" ? 600 : 400 }}>· {s.aguardando_quem === "solicitante" ? "esperando ajuste de quem pediu" : `esperando ${AGUARDANDO[s.aguardando_quem]}`}</span>}
        {s.desfecho_atrasado && <span className="font-semibold" style={{ color: "var(--err-ink)" }}>· desfecho atrasado</span>}
        {s.desfecho && <span style={{ color: s.desfecho === "fechou" ? "var(--rel-ink)" : "var(--ink3)", fontWeight: 600 }}>· {s.desfecho === "fechou" ? "fechou ✅" : "não seguiu"}</span>}
        {s.reaberturas > 0 && <span style={{ color: "var(--warn-ink)" }}>· reaberta</span>}
      </span>
    </button>
  );
}

type Coluna = "nova" | "ajustes" | "andamento" | "fechadas";
/** Em qual etapa o cartão está (0158). */
function colunaDe(s: Solicitacao): Coluna {
  if (!s.aberta) return "fechadas";
  if (s.status === "nova") return "nova";
  if (s.status === "aguardando" && s.aguardando_quem === "solicitante") return "ajustes";
  return "andamento";
}
const COLUNAS: { id: Coluna; rotulo: string; dica: string }[] = [
  { id: "nova", rotulo: "Novas", dica: "esperando alguém aprovar" },
  { id: "ajustes", rotulo: "Aguardando ajustes", dica: "falta info de quem pediu" },
  { id: "andamento", rotulo: "Em andamento", dica: "inclui esperando cliente/fornecedor" },
  { id: "fechadas", rotulo: "Concluídas", dica: "últimos 14 dias" },
];
/** No Operações, os nomes das etapas da cotação (Bruno 21/10). */
const COLUNAS_OPS: Record<Coluna, { rotulo: string; dica: string }> = {
  nova: { rotulo: "Nova solicitação", dica: "esperando aprovação" },
  ajustes: { rotulo: "Aguardando ajustes", dica: "falta info de quem pediu" },
  andamento: { rotulo: "Em cotação", dica: "e demais pedidos em andamento" },
  fechadas: { rotulo: "Cotação entregue", dica: "últimos 14 dias" },
};

export default function SolicitacoesPage({ setor, links, abrirId, onAbrirId, onMudou }: {
  setor: Setor;
  links?: LinksSol;
  /** Solicitação aberta pelo endereço (#area/solicitacoes/<id>). */
  abrirId?: string | null;
  onAbrirId?: (id: string | null) => void;
  /** Avisa a casca pra recontar as bolinhas do menu. */
  onMudou?: () => void;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const gestor = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const [aba, setAba] = useState<Aba>("recebidas");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [soMinhas, setSoMinhas] = useState(true); // 0197: o pedido é de quem pediu
  const [recebidas, setRecebidas] = useState<Solicitacao[] | null>(null);
  const [pedidas, setPedidas] = useState<Solicitacao[] | null>(null);
  const [termo, setTermo] = useState("");
  const [achadas, setAchadas] = useState<Solicitacao[] | null>(null);
  const [nova, setNova] = useState(false);
  const [tipos, setTipos] = useState(false);
  const [aberta, setAberta] = useState<string | null>(abrirId ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [entregues, setEntregues] = useState<Entregues | null>(null);
  useEffect(() => { if (abrirId !== undefined) setAberta(abrirId); }, [abrirId]);

  const carregar = useCallback(async () => {
    try {
      const [r, p, m] = await Promise.all([listarDoSetor(setor, "para"), listarDoSetor(setor, "de"), meuId ? listarMinhas(meuId) : Promise.resolve([])]);
      setRecebidas(r);
      // Pedidas = do setor + as que EU pedi estando em outra área (admin/gestor de várias áreas).
      const ids = new Set(p.map((x) => x.id));
      setPedidas([...p, ...m.filter((x) => !ids.has(x.id) && x.para_setor !== setor)]);
      if (r.some((x) => x.cotacao) || setor === "operacional") contarEntregues(setor).then(setEntregues).catch(() => undefined);
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [setor, meuId]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void carregar(); }, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  const mudou = useCallback(() => { void carregar(); onMudou?.(); }, [carregar, onMudou]);
  const abrir = (id: string | null) => { setAberta(id); onAbrirId?.(id); };

  const filtradas = useMemo(() => (recebidas ?? []).filter((s) =>
    filtro === "todas" ? true : filtro === "comigo" ? s.responsavel_id === meuId : !s.responsavel_id), [recebidas, filtro, meuId]);
  const porColuna = useMemo(() => {
    const m: Record<Coluna, Solicitacao[]> = { nova: [], ajustes: [], andamento: [], fechadas: [] };
    for (const s of filtradas) m[colunaDe(s)].push(s);
    m.nova.sort(ordenar); m.ajustes.sort(ordenar); m.andamento.sort(ordenar);
    m.fechadas.sort((a, b) => (b.concluido_em ?? "").localeCompare(a.concluido_em ?? ""));
    return m;
  }, [filtradas]);

  const semDono = (recebidas ?? []).filter((s) => s.sem_dono_atrasada).length;
  const vencidas = (recebidas ?? []).filter((s) => s.vencida).length;
  const novasN = (recebidas ?? []).filter((s) => s.status === "nova").length;

  const pedidasVisiveis = useMemo(() => (pedidas ?? []).filter((s) => !soMinhas || s.criado_por === meuId), [pedidas, soMinhas, meuId]);
  const paraConfirmar = pedidasVisiveis.filter((s) => s.status === "concluida" && !s.confirmado_em && s.criado_por === meuId && !s.falta_desfecho);
  const paraAjustar = pedidasVisiveis.filter((s) => s.status === "aguardando" && s.aguardando_quem === "solicitante").sort(ordenar);
  const paraDesfecho = pedidasVisiveis.filter((s) => s.falta_desfecho && !s.desfecho)
    .sort((a, b) => (a.desfecho_prazo ?? "").localeCompare(b.desfecho_prazo ?? ""));
  const abertasPedidas = pedidasVisiveis.filter((s) => s.aberta && !paraAjustar.includes(s)).sort(ordenar);
  const fechadasPedidas = pedidasVisiveis.filter((s) => !s.aberta && !paraConfirmar.includes(s) && !paraDesfecho.includes(s)).sort((a, b) => (b.concluido_em ?? "").localeCompare(a.concluido_em ?? ""));
  const novidadesPedidas = pedidasVisiveis.filter((s) => s.novidade && s.criado_por === meuId).length;

  async function fazerBusca() {
    try { setAchadas(await buscar(setor, termo)); } catch (e) { setErro(e instanceof Error ? e.message : "Não buscou."); }
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Solicitações</h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--ink3)" }}>
            Pedidos entre setores, com dono e prazo. Você está em <SetorChip s={setor} />.
          </p>
        </div>
        {gestor && <Botao variante="fantasma" onClick={() => setTipos(true)}>Tipos e prazos</Botao>}
        <Botao variante="primario" onClick={() => setNova(true)}>+ Pedir a outro setor</Botao>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Visões">
        <Aba ativa={aba === "recebidas"} onClick={() => setAba("recebidas")} n={novasN} alerta={semDono + vencidas > 0}>Recebidas por {NOME_SETOR[setor]}</Aba>
        <Aba ativa={aba === "pedidas"} onClick={() => setAba("pedidas")} n={novidadesPedidas}>Pedidas</Aba>
        <Aba ativa={aba === "buscar"} onClick={() => setAba("buscar")}>Buscar</Aba>
      </div>

      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}

      {aba === "recebidas" && (
        <>
          {gestor && (semDono > 0 || vencidas > 0) && (
            <div className="rel-card px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" style={{ borderColor: "var(--err-line)", background: "var(--err-bg)", color: "var(--err-ink)" }} role="status">
              <b>Atenção, gestor(a):</b>
              {semDono > 0 && <span>{semDono} sem ninguém pegar há mais de 2h úteis</span>}
              {vencidas > 0 && <span>{vencidas} passaram do prazo</span>}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtro">
            {([["todas", "Todas"], ["comigo", "Comigo"], ["sem_dono", "Sem dono"]] as [Filtro, string][]).map(([k, r]) => (
              <button key={k} role="radio" aria-checked={filtro === k} onClick={() => setFiltro(k)} className="rounded-full px-3 h-8 text-[12.5px] border"
                style={filtro === k ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "transparent", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{r}</button>
            ))}
          </div>
          {recebidas === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : recebidas.length === 0 ? (
            <div className="rel-card"><Vazio titulo={`Nenhuma solicitação pro ${NOME_SETOR[setor]}`} texto="Quando outro setor pedir alguma coisa, ela aparece aqui com prazo e quem pediu." /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 items-start">
              {COLUNAS.map((c0) => ({ ...c0, ...(setor === "operacional" ? COLUNAS_OPS[c0.id] : {}) })).map((c) => (
                <section key={c.id} className="rounded-2xl p-2.5 space-y-2" style={{ background: "var(--card2)" }} aria-label={c.rotulo}>
                  <header className="flex items-baseline gap-2 px-1">
                    <h2 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>{c.rotulo}</h2>
                    <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{porColuna[c.id].length}</span>
                    <span className="text-[11px] ml-auto" style={{ color: "var(--ink3)" }}>{c.dica}</span>
                  </header>
                  {c.id === "fechadas" && entregues && entregues.total > 0 && (
                    <div className="rounded-xl px-2.5 py-2 text-[12px] space-y-0.5" style={{ background: "var(--card)", color: "var(--ink2)" }}>
                      <p><b style={{ color: "var(--ink)" }}>{entregues.total}</b> cotaç{entregues.total === 1 ? "ão entregue" : "ões entregues"} desde o início</p>
                      <p>
                        <span style={{ color: "var(--rel-ink)", fontWeight: 600 }}>{entregues.fechou} fecharam</span> · {entregues.naoSeguiu} não seguiram · {entregues.semDesfecho} sem desfecho
                        {entregues.atrasado > 0 && <span style={{ color: "var(--err-ink)", fontWeight: 600 }}> ({entregues.atrasado} atrasado{entregues.atrasado > 1 ? "s" : ""})</span>}
                      </p>
                    </div>
                  )}
                  {porColuna[c.id].map((s) => <Cartao key={s.id} s={s} lado="para" meuId={meuId} onAbrir={() => abrir(s.id)} />)}
                  {porColuna[c.id].length === 0 && <p className="text-[12px] px-1 py-3 text-center" style={{ color: "var(--ink3)" }}>—</p>}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {aba === "pedidas" && (
        <>
          <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
            <input type="checkbox" checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} /> Só as que eu pedi
          </label>
          {pedidas === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : pedidasVisiveis.length === 0 ? (
            <div className="rel-card"><Vazio titulo="Nada pedido ainda" texto="Use “+ Pedir a outro setor” — ou o botão “Pedir a outro setor” dentro da viagem, da ficha ou do lead." /></div>
          ) : (
            <div className="space-y-5">
              {paraAjustar.length > 0 && (
                <Lista titulo="Aguardando seus ajustes" dica="O outro setor precisa de mais informação. Abra e clique em “Enviar ajustes”." itens={paraAjustar} meuId={meuId} abrir={abrir} destaque />
              )}
              {paraDesfecho.length > 0 && (
                <Lista titulo="Cotações entregues — dê o desfecho" dica="Conte se fechou ou por que não seguiu, até o prazo de cada uma." itens={paraDesfecho} meuId={meuId} abrir={abrir} destaque />
              )}
              {paraConfirmar.length > 0 && (
                <Lista titulo="Concluídas — confira e confirme" dica="Abra, veja o que foi feito e clique em “Resolveu” (ou reabra)." itens={paraConfirmar} meuId={meuId} abrir={abrir} destaque />
              )}
              <Lista titulo="Em aberto" itens={abertasPedidas} meuId={meuId} abrir={abrir} />
              {fechadasPedidas.length > 0 && <Lista titulo="Fechadas (últimos 14 dias)" itens={fechadasPedidas} meuId={meuId} abrir={abrir} />}
            </div>
          )}
        </>
      )}

      {aba === "buscar" && (
        <div className="space-y-3">
          <form className="flex gap-2 max-w-xl" onSubmit={(e) => { e.preventDefault(); void fazerBusca(); }}>
            <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Número (#12), nome do cliente ou assunto" aria-label="Buscar solicitação" />
            <Botao variante="primario" type="submit">Buscar</Botao>
          </form>
          {achadas && (achadas.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nada encontrado.</p> : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {achadas.map((s) => (
                <div key={s.id} className="space-y-1">
                  <Cartao s={s} lado={s.para_setor === setor ? "para" : "de"} meuId={meuId} onAbrir={() => abrir(s.id)} />
                  <span className="px-1"><Etiqueta tom={tomStatus(s)}>{rotuloStatus(s, true)}</Etiqueta></span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <NovaSolicitacao aberto={nova} deSetor={setor} onFechar={() => setNova(false)}
        onCriada={(id) => { setNova(false); setAba("pedidas"); mudou(); abrir(id); }} />
      <SolicitacaoDetalhe id={aberta} onFechar={() => abrir(null)} onMudou={mudou} links={links} />
      {tipos && <TiposPrazos onFechar={() => setTipos(false)} />}
    </div>
  );
}

function Aba({ ativa, onClick, n, alerta, children }: { ativa: boolean; onClick: () => void; n?: number; alerta?: boolean; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={ativa} onClick={onClick} className="inline-flex items-center gap-2 px-3.5 h-9 rounded-lg text-[13.5px] font-semibold border"
      style={ativa ? { background: "var(--rel)", color: "#fff", borderColor: "var(--rel)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
      {children}
      {!!n && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none"
        style={alerta ? { background: "var(--err-bg)", color: "var(--err-ink)" } : { background: ativa ? "rgba(255,255,255,.25)" : "var(--warn-bg)", color: ativa ? "#fff" : "var(--warn-ink)" }}>{n}</span>}
    </button>
  );
}

function Lista({ titulo, dica, itens, meuId, abrir, destaque }: { titulo: string; dica?: string; itens: Solicitacao[]; meuId: string; abrir: (id: string) => void; destaque?: boolean }) {
  return (
    <section aria-label={titulo}>
      <h2 className="text-[13px] font-bold mb-0.5" style={{ color: destaque ? "var(--rel-ink)" : "var(--ink)" }}>{titulo} <span style={{ color: "var(--ink3)" }}>{itens.length}</span></h2>
      {dica && <p className="text-[12px] mb-2" style={{ color: "var(--ink3)" }}>{dica}</p>}
      {itens.length === 0 ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhuma.</p> : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 mt-2">
          {itens.map((s) => (
            <div key={s.id} className="space-y-1">
              <Cartao s={s} lado="de" meuId={meuId} onAbrir={() => abrir(s.id)} />
              <span className="px-1">
                <Etiqueta tom={tomStatus(s)}>{rotuloStatus(s)}</Etiqueta>
                {s.falta_desfecho && s.desfecho_prazo && !s.desfecho && (
                  <span className="ml-2 text-[11.5px]" style={{ color: s.desfecho_atrasado ? "var(--err-ink)" : "var(--ink3)", fontWeight: s.desfecho_atrasado ? 600 : 400 }}>
                    desfecho {s.desfecho_atrasado ? "venceu" : "até"} {new Date(s.desfecho_prazo).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
