// src/closer/NegocioPainel.tsx
// -----------------------------------------------------------------------------
// O CARTÃO ABERTO do pipeline do closer: tudo do cliente numa tela só.
//
//   • dados do lead (e o botão pro detalhe completo);
//   • reuniões, propostas (vista? aprovada?), mensagens recentes do WhatsApp,
//     solicitações a outros setores;
//   • próxima ação + valor previsto, mover de etapa, perdido com motivo;
//   • histórico do cartão (o que o sistema moveu sozinho e quem mexeu);
//   • CONTRATO (0180: gera pelo Google + ZapSign, ou manual) e PAGAMENTO
//     (0181: link colado, marcar pago, pedir link ao Financeiro);
//   • FICHA DE FECHAMENTO (consolidar a venda) e, depois dela, o resumo + o
//     estado do espelho no Bitrix com "Reenviar".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { STATUS_PROPOSTA, TOM_PROPOSTA, type StatusProposta } from "@/propostas/lib";
import FichaFechamento from "./FichaFechamento";
import FichaFechamentoResumo from "./FichaFechamentoResumo";
import ContratoBloco from "./ContratoBloco";
import PagamentoBloco from "./PagamentoBloco";
import {
  ETAPAS, NOME_ETAPA, brl, carregarNegocio, dataBr, dataHoraBr, espelharNoBitrix, eventosDoNegocio, moverNegocio,
  nomeDoLead, notaNoNegocio, salvarNegocio, type Etapa, type EventoNegocio, type Negocio,
} from "./lib";

export interface LinksDoPainel {
  onAbrirLead: (leadId: string) => void;
  onNovaProposta: (leadId: string, nome: string) => void;
  onAbrirProposta: (id: string) => void;
  onAbrirSolicitacao: (id: string) => void;
}

interface Reuniao { id: string; scheduled_at: string; status: string; title: string | null; venda_valor: number | null }
interface PropostaLinha { id: string; numero: number; titulo: string | null; destino: string | null; status: StatusProposta; enviada_em: string | null; vista_em: string | null; visualizacoes: number | null; aprovada_em: string | null; aprovada_nome: string | null }
interface Mensagem { id: string; direction: string; content: string | null; sent_at: string | null; created_at: string }
interface Solicitacao { id: string; numero: number; titulo: string; status: string; para_setor: string; criado_em: string }

const STATUS_REUNIAO: Record<string, string> = {
  agendada: "Agendada", confirmada: "Confirmada", realizada: "Realizada", no_show: "No-show", reagendada: "Reagendada",
  cancelada: "Cancelada", arquivada: "Arquivada", desistencia: "Desistência",
};

function Bloco({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="rel-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}
const Nada = ({ t }: { t: string }) => <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{t}</p>;

export default function NegocioPainel({ id, onVoltar, links }: { id: string; onVoltar: () => void; links: LinksDoPainel }) {
  const [n, setN] = useState<Negocio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "aviso" | "erro"; t: string } | null>(null);
  const [reunioes, setReunioes] = useState<Reuniao[]>([]);
  const [propostas, setPropostas] = useState<PropostaLinha[]>([]);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [sols, setSols] = useState<Solicitacao[]>([]);
  const [eventos, setEventos] = useState<EventoNegocio[]>([]);
  const [prox, setProx] = useState({ acao: "", em: "", valor: "" });
  const [nota, setNota] = useState("");
  const [fichaAberta, setFichaAberta] = useState(false);
  const [perdendo, setPerdendo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const neg = await carregarNegocio(id);
      if (!neg) { setErro("Cartão não encontrado (ou é de outro closer)."); return; }
      setN(neg);
      setProx({
        acao: neg.proxima_acao ?? "",
        em: neg.proxima_acao_em ? new Date(neg.proxima_acao_em).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16).replace(" ", "T") : "",
        valor: neg.valor_previsto != null ? String(neg.valor_previsto) : "",
      });
      const lead = neg.lead_id;
      const { data: s } = await supabase.from("qs_solicitacoes").select("id, numero, titulo, status, para_setor, criado_em").eq("lead_id", lead).order("criado_em", { ascending: false }).limit(20);
      const solList = (s ?? []) as Solicitacao[];
      setSols(solList);
      const ids = solList.map((x) => x.id);
      let qp = supabase.from("qs_propostas").select("id, numero, titulo, destino, status, enviada_em, vista_em, visualizacoes, aprovada_em, aprovada_nome").order("criado_em", { ascending: false }).limit(20);
      qp = ids.length ? qp.or(`lead_id.eq.${lead},solicitacao_id.in.(${ids.join(",")})`) : qp.eq("lead_id", lead);
      const [r, p, m, ev] = await Promise.all([
        supabase.from("qs_meetings").select("id, scheduled_at, status, title, venda_valor").eq("lead_id", lead).order("scheduled_at", { ascending: false }).limit(10),
        qp,
        supabase.from("qs_wa_messages").select("id, direction, content, sent_at, created_at").eq("lead_id", lead).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
        eventosDoNegocio(id),
      ]);
      setReunioes((r.data ?? []) as Reuniao[]);
      setPropostas((p.data ?? []) as PropostaLinha[]);
      setMsgs((m.data ?? []) as Mensagem[]);
      setEventos(ev);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function rodar(f: () => Promise<void>, ok?: string) {
    setOcupado(true);
    setAviso(null);
    try { await f(); if (ok) setAviso({ tom: "ok", t: ok }); await carregar(); }
    catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  if (erro) return <div className="space-y-3"><Botao onClick={onVoltar}>← Voltar ao pipeline</Botao><Aviso tom="erro">{erro}</Aviso></div>;
  if (!n) return <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  const nome = nomeDoLead(n.lead);
  const consolidada = n.etapa === "consolidada";

  return (
    <div className="max-w-[1100px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Botao variante="fantasma" onClick={onVoltar}>← Pipeline</Botao>
        <h1 className="text-[22px] font-bold flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{nome}</h1>
        <Etiqueta tom={n.etapa === "perdido" ? "erro" : "rel"}>{NOME_ETAPA[n.etapa]}</Etiqueta>
      </div>
      {aviso && <Aviso tom={aviso.tom}>{aviso.t}</Aviso>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="space-y-4">
          {/* ── Contrato (0180) e pagamento (0181) ── */}
          <ContratoBloco negocio={n} onMudou={() => void carregar()} />
          <PagamentoBloco negocio={n} onMudou={() => void carregar()} onAbrirSolicitacao={links.onAbrirSolicitacao} />

          {/* ── Fechamento ── */}
          <Bloco titulo={consolidada ? "Venda consolidada" : "Fechar a venda"}
            acao={n.etapa !== "perdido" ? <Botao variante={consolidada ? "secundario" : "primario"} onClick={() => setFichaAberta(true)}>{consolidada ? "Corrigir ficha" : "Preencher ficha de fechamento"}</Botao> : undefined}>
            {consolidada && n.viagem_id ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span style={{ color: "var(--ink2)" }}>Bitrix:</span>
                  {n.bitrix_status === "ok" && <Etiqueta tom="rel">espelhado {n.bitrix_enviado_em ? dataHoraBr(n.bitrix_enviado_em) : ""}</Etiqueta>}
                  {n.bitrix_status === "pendente" && <Etiqueta tom="aviso">pendente</Etiqueta>}
                  {n.bitrix_status === "erro" && <Etiqueta tom="erro">falhou</Etiqueta>}
                  {n.bitrix_status === "sem_card" && <Etiqueta>cliente sem card no Bitrix</Etiqueta>}
                  {n.bitrix_status !== "ok" && n.bitrix_status !== "sem_card" && (
                    <Botao disabled={ocupado} onClick={() => void rodar(async () => {
                      const r = await espelharNoBitrix(n.id);
                      if (!r.ok) throw new Error(r.mensagem || "O Bitrix não aceitou.");
                    }, "Bitrix atualizado.")}>Reenviar ao Bitrix</Botao>
                  )}
                </div>
                {n.bitrix_erro && <p className="text-[12px]" style={{ color: "var(--err-ink)" }}>{n.bitrix_erro}</p>}
                <FichaFechamentoResumo key={n.consolidada_em ?? ""} viagemId={n.viagem_id} />
              </div>
            ) : n.etapa === "perdido" ? (
              <Nada t={`Perdido: ${n.motivo_perda ?? ""}. Mova de volta pra uma etapa aberta se o cliente voltou.`} />
            ) : (
              <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
                Quando o cliente fechar, preencha a ficha: o que foi vendido, o plano de pagamento e as preferências. A viagem
                nasce no Relacionamento, o plano vai pro Financeiro e o Bitrix é atualizado.
              </p>
            )}
          </Bloco>

          {/* ── Propostas ── */}
          <Bloco titulo="Propostas" acao={<Botao onClick={() => links.onNovaProposta(n.lead_id, nome)}>+ Nova proposta</Botao>}>
            {!propostas.length ? <Nada t="Nenhuma proposta ligada a este cliente." /> : (
              <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
                {propostas.map((p) => (
                  <li key={p.id}>
                    <button className="w-full text-left py-2 flex flex-wrap items-center gap-2 rel-linha rounded px-1" onClick={() => links.onAbrirProposta(p.id)}>
                      <span className="text-[13px] font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>
                        nº {p.numero} · {p.titulo || p.destino || "Proposta"}
                      </span>
                      <Etiqueta tom={TOM_PROPOSTA[p.status]}>{STATUS_PROPOSTA[p.status]}</Etiqueta>
                      <span className="text-[12px] w-full" style={{ color: "var(--ink3)" }}>
                        {p.enviada_em ? `enviada ${dataBr(p.enviada_em)}` : "não enviada"}
                        {p.vista_em ? ` · cliente viu ${p.visualizacoes ?? 1}x (1ª em ${dataBr(p.vista_em)})` : p.enviada_em ? " · cliente ainda não abriu" : ""}
                        {p.aprovada_em ? ` · aprovada ${dataBr(p.aprovada_em)}${p.aprovada_nome ? ` por ${p.aprovada_nome}` : ""}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>

          {/* ── Reuniões ── */}
          <Bloco titulo="Reuniões">
            {!reunioes.length ? <Nada t="Sem reuniões." /> : (
              <ul className="space-y-1">
                {reunioes.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                    <span className="w-28" style={{ color: "var(--ink2)" }}>{dataHoraBr(r.scheduled_at)}</span>
                    <span className="flex-1 min-w-0 truncate">{r.title || "Reunião"}</span>
                    <Etiqueta>{STATUS_REUNIAO[r.status] ?? r.status}</Etiqueta>
                    {r.venda_valor ? <span style={{ color: "var(--ink3)" }}>{brl(r.venda_valor)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Bloco>

          {/* ── Mensagens ── */}
          <Bloco titulo="Mensagens recentes (WhatsApp)">
            {!msgs.length ? <Nada t="Nenhuma mensagem registrada no QS." /> : (
              <ul className="space-y-1.5">
                {msgs.map((m) => (
                  <li key={m.id} className={`text-[13px] rounded-lg px-3 py-1.5 max-w-[85%] ${m.direction === "out" || m.direction === "outgoing" ? "ml-auto" : ""}`}
                    style={{ background: m.direction === "out" || m.direction === "outgoing" ? "var(--rel-soft)" : "var(--card2)", color: "var(--ink)" }}>
                    <span className="block whitespace-pre-wrap break-words">{(m.content || "[mídia]").slice(0, 280)}</span>
                    <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{dataHoraBr(m.sent_at ?? m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>

          {/* ── Solicitações ── */}
          <Bloco titulo="Solicitações a outros setores">
            {!sols.length ? <Nada t="Nenhuma solicitação ligada a este cliente." /> : (
              <ul className="space-y-1">
                {sols.map((s) => (
                  <li key={s.id}>
                    <button className="w-full text-left flex gap-2 text-[13px] rel-linha rounded px-1 py-1" onClick={() => links.onAbrirSolicitacao(s.id)} style={{ color: "var(--ink)" }}>
                      <span className="flex-1 min-w-0 truncate">nº {s.numero} · {s.titulo}</span>
                      <Etiqueta>{s.status.replace(/_/g, " ")}</Etiqueta>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>

        {/* ── Coluna da direita ── */}
        <div className="space-y-4">
          <Bloco titulo="Cliente" acao={<Botao variante="fantasma" onClick={() => links.onAbrirLead(n.lead_id)}>Abrir lead</Botao>}>
            <p className="text-[13px]" style={{ color: "var(--ink)" }}>{n.lead?.phone || "sem telefone"}</p>
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{n.lead?.email || "sem e-mail"}</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>
              {n.lead?.bitrix_id ? `Bitrix: negócio ${n.lead.bitrix_id}` : "Sem card no Bitrix"}{n.closer?.name ? ` · closer ${n.closer.name}` : ""}
            </p>
          </Bloco>

          <Bloco titulo="Etapa">
            <select className="rel-input" value={n.etapa} disabled={ocupado || consolidada} aria-label="Mover para"
              onChange={(e) => {
                const et = e.target.value as Etapa;
                if (et === "perdido") { setPerdendo(""); return; }
                if (et === "consolidada") { setFichaAberta(true); return; }
                void rodar(() => moverNegocio(n.id, et), `Movido para ${NOME_ETAPA[et]}.`);
              }}>
              {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
            </select>
            <p className="text-[12px] mt-1.5" style={{ color: "var(--ink3)" }}>
              Desde {dataBr(n.etapa_em)}. O cartão anda sozinho quando a proposta é enviada/aprovada e quando contrato e pagamento avançam.
            </p>
            {(n.status_contrato || n.status_pagamento) && (
              <p className="text-[12px] mt-1" style={{ color: "var(--ink2)" }}>
                {n.status_contrato ? `Contrato: ${n.status_contrato}. ` : ""}{n.status_pagamento ? `Pagamento: ${n.status_pagamento}.` : ""}
              </p>
            )}
          </Bloco>

          <Bloco titulo="Próxima ação">
            <div className="space-y-2">
              <Campo rotulo="O que fazer"><Entrada value={prox.acao} onChange={(e) => setProx({ ...prox, acao: e.target.value })} placeholder="Ex.: ligar pra fechar as datas" /></Campo>
              <Campo rotulo="Quando"><Entrada type="datetime-local" value={prox.em} onChange={(e) => setProx({ ...prox, em: e.target.value })} /></Campo>
              <Campo rotulo="Valor previsto (R$)"><Entrada type="number" min={0} step="0.01" value={prox.valor} onChange={(e) => setProx({ ...prox, valor: e.target.value })} /></Campo>
              <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(() => salvarNegocio(n.id, {
                proxima_acao: prox.acao,
                proxima_acao_em: prox.em ? new Date(`${prox.em}:00-03:00`).toISOString() : null,
                valor_previsto: prox.valor ? Number(prox.valor) : null,
              }), "Salvo.")}>Salvar</Botao>
            </div>
          </Bloco>

          <Bloco titulo="Histórico">
            <div className="flex gap-2 mb-2">
              <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Anotar algo…" aria-label="Nota" />
              <Botao disabled={!nota.trim() || ocupado} onClick={() => void rodar(async () => { await notaNoNegocio(n.id, nota); setNota(""); })}>Anotar</Botao>
            </div>
            <ul className="space-y-2 max-h-[360px] overflow-y-auto">
              {eventos.map((e) => (
                <li key={e.id} className="text-[12px]" style={{ color: "var(--ink2)" }}>
                  <span style={{ color: "var(--ink3)" }}>{dataHoraBr(e.criado_em)} · {e.autor?.name?.split(" ")[0] ?? "QS"}</span>
                  <span className="block" style={{ color: "var(--ink)" }}>
                    {e.para_etapa && e.tipo !== "criado" ? `${e.de_etapa ? `${NOME_ETAPA[e.de_etapa as Etapa] ?? e.de_etapa} → ` : ""}${NOME_ETAPA[e.para_etapa as Etapa] ?? e.para_etapa}. ` : ""}
                    {e.texto ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </Bloco>
        </div>
      </div>

      {fichaAberta && (
        <FichaFechamento negocio={n} aberto={fichaAberta} onFechar={() => setFichaAberta(false)}
          onConsolidado={(msg) => { setFichaAberta(false); setAviso({ tom: msg.includes("Bitrix atualizado") ? "ok" : "aviso", t: msg }); void carregar(); }} />
      )}

      <Modal aberto={perdendo !== null} titulo="Marcar como perdido" onFechar={() => setPerdendo(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setPerdendo(null)}>Cancelar</Botao>
          <Botao variante="perigo" disabled={!perdendo?.trim() || ocupado}
            onClick={() => { const m = perdendo ?? ""; setPerdendo(null); void rodar(() => moverNegocio(n.id, "perdido", m), "Marcado como perdido."); }}>Marcar perdido</Botao>
        </>}>
        <label className="block text-[13px] font-semibold mb-1" style={{ color: "var(--ink2)" }} htmlFor="motivo-perda-painel">Por que não fechou?</label>
        <textarea id="motivo-perda-painel" className="rel-input" rows={3} value={perdendo ?? ""} onChange={(e) => setPerdendo(e.target.value)} />
      </Modal>
    </div>
  );
}
