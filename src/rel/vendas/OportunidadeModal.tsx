// src/rel/vendas/OportunidadeModal.tsx
// -----------------------------------------------------------------------------
// O cartão aberto (0218): cliente, viagem, dono, produto, valor, próxima ação,
// proposta e o histórico (o banco escreve as mudanças; a pessoa, as notas).
// Ganho pede o valor fechado; Perdido pede o motivo (vira "por que perdemos").
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { listarPropostas, STATUS_PROPOSTA, type PropostaResumo } from "@/propostas/lib";
import { equipeRelacionamento, paraInputLocal, deInputLocal } from "../lib/pos";
import {
  anotar, apagarOportunidade, carregarOportunidade, criarPropostaDoCartao, ETAPAS, eventos, MOTIVOS_PERDA, mudarOportunidade,
  nomeCurto, ORIGENS, PRODUTOS, reais, type Etapa, type Evento, type Oportunidade,
} from "../lib/vendas";
import type { TipoItem } from "@/propostas/lib";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";
import { podeGerirRelacionamento } from "../equipe/permissao";
import SubirVenda from "@/venda/SubirVenda";
import { PROPOSTAS_NO_QS, TEXTO_EM_BREVE } from "@/propostas/disponivel";
import { SeloEmBreve } from "@/propostas/EmBreve";

/** Fechar como Ganho (valor) ou Perdido (motivo). Também usado pelo arrastar do quadro. */
export function Fechamento({ op, etapa, onFechar, onFeito }: {
  op: Oportunidade | null; etapa: "ganho" | "perdido" | null; onFechar: () => void; onFeito: (o: Oportunidade) => void;
}) {
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!op) return;
    setValor(op.valor_estimado != null ? String(op.valor_estimado) : ""); setMotivo(""); setDetalhe(""); setErro(null);
  }, [op, etapa]);

  async function confirmar() {
    if (!op || !etapa) return;
    if (etapa === "perdido" && !motivo) { setErro("Escolha o motivo."); return; }
    setSalvando(true); setErro(null);
    try {
      const o = await mudarOportunidade(op.id, etapa === "ganho"
        ? { etapa, valor_ganho: valor ? Number(valor.replace(/\./g, "").replace(",", ".")) || null : null }
        : { etapa, motivo_perda: detalhe.trim() ? `${motivo}: ${detalhe.trim()}` : motivo });
      onFeito(o);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto={!!op && !!etapa} titulo={etapa === "ganho" ? "Vendeu! 🎉" : "Não rolou"} onFechar={onFechar} largura={460}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={confirmar}>{salvando ? "Salvando…" : "Confirmar"}</Botao></>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{op?.cliente?.nome} · {op?.titulo}</p>
        {etapa === "ganho" ? (
          <Campo rotulo="Valor vendido (R$)" dica="Vai pros números do pipeline. A venda em si é registrada no fluxo de vendas.">
            <Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
          </Campo>
        ) : (
          <>
            <Campo rotulo="Motivo *">
              <select className="rel-input" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                <option value="">Escolha…</option>
                {MOTIVOS_PERDA.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Detalhe (opcional)"><Entrada value={detalhe} onChange={(e) => setDetalhe(e.target.value)} /></Campo>
          </>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

export default function OportunidadeModal({ id, onFechar, onMudou, onAbrirCliente, onAbrirViagem, onAbrirProposta }: {
  id: string | null;
  onFechar: () => void;
  onMudou: () => void;
  onAbrirCliente: (id: string) => void;
  onAbrirViagem: (id: string) => void;
  onAbrirProposta: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const supervisao = podeGerirRelacionamento(currentUser);
  const [op, setOp] = useState<Oportunidade | null>(null);
  const [hist, setHist] = useState<Evento[]>([]);
  const [time, setTime] = useState<{ id: string; name: string }[]>([]);
  const [propostas, setPropostas] = useState<PropostaResumo[]>([]);
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [fechando, setFechando] = useState<"ganho" | "perdido" | null>(null);
  // A venda do Rel usa a mesma tela do Closer e do Ops (src/venda/SubirVenda.tsx);
  // gravada a venda, o cartão segue pro Ganho pra registrar o valor no pipeline.
  const [vendendo, setVendendo] = useState(false);
  // rascunho dos campos editáveis (salvam ao sair do campo)
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const [acao, setAcao] = useState("");
  const [acaoEm, setAcaoEm] = useState("");

  const carregar = useCallback(async () => {
    if (!id) return;
    try {
      const o = await carregarOportunidade(id);
      setOp(o);
      if (o) {
        setTitulo(o.titulo); setValor(o.valor_estimado != null ? String(o.valor_estimado) : "");
        setAcao(o.proxima_acao ?? ""); setAcaoEm(paraInputLocal(o.proxima_acao_em));
        listarPropostas({ clienteId: o.cliente_id }).then(setPropostas).catch(() => setPropostas([]));
      }
      setHist(await eventos(id));
    } catch (e) { setErro(e instanceof Error ? e.message : "Não abriu."); }
  }, [id]);
  useEffect(() => { setOp(null); setHist([]); setErro(null); void carregar(); }, [carregar]);
  useEffect(() => { equipeRelacionamento().then(setTime).catch(() => setTime([])); }, []);

  async function mudar(m: Parameters<typeof mudarOportunidade>[1]) {
    if (!op) return;
    setErro(null);
    try { setOp(await mudarOportunidade(op.id, m)); setHist(await eventos(op.id)); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
  }

  function trocarEtapa(e: Etapa) {
    if (e === "ganho" || e === "perdido") { setFechando(e); return; }
    void mudar({ etapa: e });
  }

  async function montarProposta() {
    if (!PROPOSTAS_NO_QS) return;
    if (!op) return;
    setErro(null);
    try { const pid = await criarPropostaDoCartao(op); onMudou(); onAbrirProposta(pid); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui criar a proposta."); }
  }

  async function salvarNota() {
    if (!op || !nota.trim() || !currentUser) return;
    try { await anotar(op.id, nota, currentUser.id); setNota(""); setHist(await eventos(op.id)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou a nota."); }
  }

  const ligada = propostas.find((p) => p.id === op?.proposta_id);
  const fechada = op?.etapa === "ganho" || op?.etapa === "perdido";

  return (
    <>
      <Modal aberto={!!id} titulo={op ? op.cliente?.nome ?? "Oportunidade" : "Carregando…"} onFechar={onFechar} largura={720}>
        {!op ? (
          erro ? <Aviso tom="erro">{erro}</Aviso> : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <button type="button" className="underline font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirCliente(op.cliente_id)}>Abrir ficha do cliente</button>
              {op.viagem_id && (
                <button type="button" className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirViagem(op.viagem_id!)}>
                  Viagem: {op.viagem?.titulo ?? "abrir"}
                </button>
              )}
              <Etiqueta>{ORIGENS[op.origem]}</Etiqueta>
              {op.etapa === "ganho" && <Etiqueta tom="rel">Ganho · {reais(op.valor_ganho ?? op.valor_estimado)}</Etiqueta>}
              {op.etapa === "perdido" && <Etiqueta tom="erro">Perdido · {op.motivo_perda}</Etiqueta>}
            </div>

            <Campo rotulo="O que o cliente quer">
              <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} onBlur={() => titulo.trim() && titulo !== op.titulo && void mudar({ titulo: titulo.trim() })} />
            </Campo>

            <div className="grid sm:grid-cols-2 gap-3">
              <Campo rotulo="Etapa">
                <select className="rel-input" value={op.etapa} onChange={(e) => trocarEtapa(e.target.value as Etapa)}>
                  {ETAPAS.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Dono">
                <select className="rel-input" value={op.dono_id ?? ""} onChange={(e) => void mudar({ dono_id: e.target.value || null })}>
                  <option value="">Sem dono</option>
                  {time.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === currentUser?.id ? " (eu)" : ""}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Produto de interesse">
                <select className="rel-input" value={op.produto ?? ""} onChange={(e) => void mudar({ produto: (e.target.value || null) as TipoItem | null })}>
                  <option value="">Ainda não sei</option>
                  {PRODUTOS.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Valor estimado (R$)">
                <Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
                  onBlur={() => {
                    const n = valor ? Number(valor.replace(/\./g, "").replace(",", ".")) : null;
                    if ((n ?? null) !== (op.valor_estimado ?? null) && !(n != null && Number.isNaN(n))) void mudar({ valor_estimado: n });
                  }} />
              </Campo>
            </div>

            {!fechada && (
              <div className="grid sm:grid-cols-[1fr_210px_auto] gap-3 items-end">
                <Campo rotulo="Próxima ação"><Entrada value={acao} onChange={(e) => setAcao(e.target.value)} placeholder="Ex.: mandar opções de hotel" /></Campo>
                <Campo rotulo="Quando (lembrete no sino)"><Entrada type="datetime-local" value={acaoEm} onChange={(e) => setAcaoEm(e.target.value)} /></Campo>
                <Botao onClick={() => void mudar({ proxima_acao: acao.trim() || null, proxima_acao_em: deInputLocal(acaoEm) })}>Salvar ação</Botao>
              </div>
            )}

            <section className="rel-card p-3 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Proposta</p>
              {ligada ? (
                <button type="button" className="text-[13px] underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirProposta(ligada.id)}>
                  Nº {ligada.numero} · {ligada.titulo || ligada.destino || "Proposta"} · {STATUS_PROPOSTA[ligada.status]}
                </button>
              ) : op.proposta_id ? (
                <button type="button" className="text-[13px] underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirProposta(op.proposta_id!)}>Abrir a proposta</button>
              ) : (
                <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhuma proposta ligada.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {!fechada && PROPOSTAS_NO_QS && <Botao variante="primario" onClick={() => void montarProposta()}>Montar proposta</Botao>}
                {!fechada && !PROPOSTAS_NO_QS && <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink3)" }}>Montar proposta <SeloEmBreve /></span>}
                {propostas.filter((p) => p.id !== op.proposta_id).length > 0 && (
                  <select className="rel-input" style={{ maxWidth: 320 }} value="" onChange={(e) => e.target.value && void mudar({ proposta_id: e.target.value })}>
                    <option value="">Ligar uma proposta que já existe…</option>
                    {propostas.filter((p) => p.id !== op.proposta_id).map((p) => (
                      <option key={p.id} value={p.id}>Nº {p.numero} · {p.titulo || p.destino || "Proposta"} · {STATUS_PROPOSTA[p.status]}</option>
                    ))}
                  </select>
                )}
              </div>
              {!fechada && !PROPOSTAS_NO_QS && <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>{TEXTO_EM_BREVE}</p>}
            </section>

            <div className="flex flex-wrap gap-2">
              {!fechada && <Botao variante="primario" onClick={() => setVendendo(true)}>Registrar venda</Botao>}
              {!fechada && <Botao variante="perigo" onClick={() => setFechando("perdido")}>Perdido</Botao>}
              {fechada && <Botao onClick={() => void mudar({ etapa: "negociacao" })}>Reabrir</Botao>}
              {supervisao && (
                <Botao variante="fantasma" onClick={async () => {
                  if (!window.confirm("Apagar esta oportunidade? O histórico vai junto. (Pra não vendeu, use Perdido.)")) return;
                  try { await apagarOportunidade(op.id); onMudou(); onFechar(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
                }}>Apagar</Botao>
              )}
            </div>
            {erro && <Aviso tom="erro">{erro}</Aviso>}

            <section>
              <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>Histórico</p>
              <div className="flex gap-2 mb-2">
                <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Escrever uma nota (ex.: cliente pediu pra ligar depois das 18h)"
                  onKeyDown={(e) => { if (e.key === "Enter") void salvarNota(); }} />
                <Botao disabled={!nota.trim()} onClick={() => void salvarNota()}>Anotar</Botao>
              </div>
              <ul className="space-y-1.5">
                {hist.map((h) => (
                  <li key={h.id} className="text-[12.5px] flex gap-2" style={{ color: h.tipo === "nota" ? "var(--ink)" : "var(--ink2)" }}>
                    <span className="flex-shrink-0 tabular-nums" style={{ color: "var(--ink3)" }}>
                      {new Date(h.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="min-w-0">
                      {h.tipo === "nota" ? <b>{nomeCurto(h.autor?.name) || "Alguém"}: </b> : h.autor?.name ? <span style={{ color: "var(--ink3)" }}>{nomeCurto(h.autor.name)} · </span> : null}
                      {h.texto}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </Modal>
      {op && (
        <SubirVenda origem="rel" aberto={vendendo} onFechar={() => setVendendo(false)}
          cliente={{ id: op.cliente_id, nome: op.cliente?.nome ?? "" }} viagemId={op.viagem_id ?? null}
          onSalvo={() => { setVendendo(false); setFechando("ganho"); }} />
      )}
      <Fechamento op={fechando ? op : null} etapa={fechando} onFechar={() => setFechando(null)}
        onFeito={(o) => { setFechando(null); setOp(o); void eventos(o.id).then(setHist); onMudou(); }} />
    </>
  );
}
