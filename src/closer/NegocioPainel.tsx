// src/closer/NegocioPainel.tsx
// -----------------------------------------------------------------------------
// O CARTÃO ABERTO do pipeline do closer: tudo do cliente numa tela só.
//
//   • dados do lead (e o botão pro detalhe completo);
//   • reuniões, propostas (vista? aprovada?), mensagens recentes do WhatsApp,
//     solicitações a outros setores;
//   • próxima ação + valor previsto, mover de etapa, perdido com motivo;
//   • histórico do cartão (o que o sistema moveu sozinho e quem mexeu);
//
// A VENDA, UM CAMINHO SÓ (Bruno, 27/10 — "tudo o mais simples"):
//   1. "Registrar venda" → itens por tipo (0207) e, no último passo, "Salvar e
//      marcar como venda": já conta no Dashboard (pré-venda pelo Bitrix).
//      Selo: "Venda registrada (falta fechar)". O "desfazer" fica num link
//      discreto no bloco.
//   2. "Fechar: pagamento e contrato" → a ficha de fechamento (já preenchida
//      com os itens) gera a viagem no Rel e o plano no Financeiro. Aqui também
//      ficam o PAGAMENTO (0181) e o CONTRATO (0180 — some se o ZapSign/Google
//      não estiverem ligados na Vercel). Selo: "Fechada".
// O Bitrix é automático (cron a cada 10 min); a tela só fala dele se falhar.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { STATUS_PROPOSTA, TIPOS, TOM_PROPOSTA, type StatusProposta } from "@/propostas/lib";
import FichaFechamento from "./FichaFechamento";
import FichaFechamentoResumo from "./FichaFechamentoResumo";
import ContratoBloco from "./ContratoBloco";
import PagamentoBloco from "./PagamentoBloco";
// 28/10 (0214): a venda do closer usa a tela única de venda (src/venda/SubirVenda.tsx).
import SubirVenda from "@/venda/SubirVenda";
import { ListaPropostasAnexadas } from "@/venda/PropostasAnexadas";
import { PROPOSTAS_NO_QS } from "@/propostas/disponivel";
import { SeloEmBreve } from "@/propostas/EmBreve";
import CadastroDoLead from "@/clientes/cadastro/CadastroDoLead";
import ReunioesDoCliente from "@/controle-comercial/ReunioesDoCliente";
import RespostasDoFormulario from "@/components/sdr/leads/RespostasDoFormulario";
import { desfazerPreVenda, listarItensDaVenda, nomeSugerido, somaDosItens, type ItemVenda } from "./vendaItens";
import {
  ETAPAS, ETAPAS_COM_MOTIVO, NOME_ETAPA, brl, carregarNegocio, dataBr, dataHoraBr, emPreVenda, espelharNoBitrix, eventosDoNegocio, listarClosersAtivos, moverNegocio,
  nomeDoLead, notaNoNegocio, salvarNegocio, seloDaVenda, trocarCloser, type Etapa, type EventoNegocio, type Negocio,
} from "./lib";

export interface LinksDoPainel {
  onAbrirLead: (leadId: string) => void;
  onNovaProposta: (leadId: string, nome: string) => void;
  onAbrirProposta: (id: string) => void;
  onAbrirSolicitacao: (id: string) => void;
}

interface PropostaLinha { id: string; numero: number; titulo: string | null; destino: string | null; status: StatusProposta; enviada_em: string | null; vista_em: string | null; visualizacoes: number | null; aprovada_em: string | null; aprovada_nome: string | null }
interface Mensagem { id: string; direction: string; content: string | null; sent_at: string | null; created_at: string }
interface Solicitacao { id: string; numero: number; titulo: string; status: string; para_setor: string; criado_em: string }

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
  const [propostas, setPropostas] = useState<PropostaLinha[]>([]);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [sols, setSols] = useState<Solicitacao[]>([]);
  const [eventos, setEventos] = useState<EventoNegocio[]>([]);
  const [prox, setProx] = useState({ acao: "", em: "", valor: "" });
  const [nota, setNota] = useState("");
  const [fichaAberta, setFichaAberta] = useState(false);
  // 0207: venda por itens + pré-venda
  const [itensVenda, setItensVenda] = useState<ItemVenda[]>([]);
  const [registrarAberto, setRegistrarAberto] = useState(false);
  // 0295: recarrega a lista de propostas anexadas depois de subir a venda
  const [versaoAnexos, setVersaoAnexos] = useState(0);
  // Motivo pedido ao mover pra Perdido ou Venda cancelada.
  const [perdendo, setPerdendo] = useState<{ etapa: Etapa; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // 0334: trocar o responsável (gestor: qualquer cartão; closer: o próprio).
  const { currentUser } = useQsAuth();
  const [trocando, setTrocando] = useState(false);

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
      // As reuniões (com Meet, convidados, desfecho e gravação) carregam no <ReunioesDoCliente>.
      const [p, m, ev] = await Promise.all([
        qp,
        supabase.from("qs_wa_messages").select("id, direction, content, sent_at, created_at").eq("lead_id", lead).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
        eventosDoNegocio(id),
      ]);
      setItensVenda(await listarItensDaVenda(id).catch(() => []));
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
  const consolidada = !!n.consolidada_em;
  const encerrado = n.etapa === "perdido" || n.etapa === "venda_cancelada";
  const preVenda = emPreVenda(n);
  const totalItens = somaDosItens(itensVenda);
  const selo = seloDaVenda(n);
  const gestao = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const podeTrocar = gestao || (!!currentUser?.id && n.closer_id === currentUser.id);
  /** Venda registrada (pré-venda) ou fechada: daí em diante aparecem pagamento e contrato. */
  const vendaRegistrada = preVenda || consolidada;
  async function rodarPreVenda(f: () => Promise<{ tom: "ok" | "aviso"; mensagem: string }>) {
    setOcupado(true);
    setAviso(null);
    try { const r = await f(); setAviso({ tom: r.tom, t: r.mensagem }); await carregar(); }
    catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); }
    finally { setOcupado(false); }
  }
  /** Move no QS e manda pro Bitrix na hora (se falhar, o cron reenvia). */
  const moverEEspelhar = async (et: Etapa, motivo?: string) => {
    await moverNegocio(n.id, et, motivo);
    const r = await espelharNoBitrix(n.id).catch(() => null);
    if (r && !r.ok && r.status === "erro") throw new Error(`Movido no QS, mas o Bitrix recusou: ${r.mensagem}`);
  };

  return (
    <div className="max-w-[1100px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Botao variante="fantasma" onClick={onVoltar}>← Pipeline</Botao>
        {/* Celular (04/11): o nome cortava em "Mariana Albu…" — vai pra linha própria, inteiro. */}
        <h1 className="text-[22px] font-bold flex-1 min-w-0 truncate max-md:order-last max-md:basis-full max-md:whitespace-normal" style={{ color: "var(--ink)" }}>{nome}</h1>
        {selo && <Etiqueta tom={selo.tom}>{selo.t}</Etiqueta>}
        <Etiqueta tom={encerrado ? "erro" : "neutro"}>{NOME_ETAPA[n.etapa]}</Etiqueta>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
        <span>Responsável: <b style={{ color: "var(--ink)" }}>{n.closer?.name ?? "ninguém"}</b></span>
        {podeTrocar && <Botao variante="fantasma" disabled={ocupado} onClick={() => setTrocando(true)}>Trocar responsável</Botao>}
      </div>
      {aviso && <Aviso tom={aviso.tom}>{aviso.t}</Aviso>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="space-y-4">
          {/* ── 1. A venda (0207): itens por tipo; salvar já marca como venda ── */}
          {!encerrado && (
            <Bloco titulo={vendaRegistrada ? "A venda" : "1. Registrar a venda"}
              acao={<Botao variante={vendaRegistrada ? "secundario" : "primario"} disabled={ocupado} onClick={() => setRegistrarAberto(true)}>
                {vendaRegistrada ? "Editar itens" : itensVenda.length ? "Continuar registro" : "Registrar venda"}
              </Botao>}>
              {itensVenda.length ? (
                <ul className="space-y-1 mb-3">
                  {itensVenda.map((i) => (
                    <li key={i.k} className="flex flex-wrap gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                      <span className="flex-1 min-w-0 truncate"><span aria-hidden>{TIPOS[i.tipo]?.emoji ?? "•"}</span> {i.nome || nomeSugerido(i)}</span>
                      {i.status && i.status !== "vendido" && <Etiqueta tom="rel">{i.status}</Etiqueta>}
                      <span style={{ color: "var(--ink2)" }}>{brl(i.valor)}</span>
                    </li>
                  ))}
                  <li className="flex gap-2 text-[13px] font-bold pt-1 border-t" style={{ color: "var(--ink)", borderColor: "var(--line)" }}>
                    <span className="flex-1">Total</span><span>{brl(totalItens)}</span>
                  </li>
                </ul>
              ) : (
                <p className="text-[13px] mb-1" style={{ color: "var(--ink2)" }}>
                  Fechou? Registre o que o cliente comprou (aéreo, pacote, expedição, seguro…) em 3 passos. Ao salvar, a venda já
                  conta no Dashboard. Depois vem o passo 2: pagamento e contrato.
                </p>
              )}
              {preVenda ? (
                <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
                  Registrada em {dataHoraBr(n.pre_venda_em)} — já conta no Dashboard. Falta fechar o pagamento e o contrato (abaixo).{" "}
                  <button type="button" className="underline text-[12px]" style={{ color: "var(--ink3)" }} disabled={ocupado} onClick={() => {
                    if (!window.confirm("Desfazer a venda registrada? Ela deixa de contar no Dashboard e o negócio volta pra etapa atual no Bitrix. Os itens ficam salvos.")) return;
                    void rodarPreVenda(() => desfazerPreVenda(n.id));
                  }}>desfazer</button>
                </p>
              ) : !consolidada && itensVenda.length ? (
                <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
                  Rascunho: ainda não conta como venda. Clique em "Continuar registro" e use "Salvar e marcar como venda".
                </p>
              ) : null}
            </Bloco>
          )}

          {/* ── 2. Fechar: pagamento e contrato (ficha de fechamento) ── */}
          {(vendaRegistrada || encerrado) && (
            <Bloco titulo={consolidada ? "Venda fechada" : encerrado ? NOME_ETAPA[n.etapa] : "2. Fechar: pagamento e contrato"}
              acao={!encerrado ? <Botao variante={consolidada ? "secundario" : "primario"} onClick={() => setFichaAberta(true)}>{consolidada ? "Corrigir fechamento" : "Fechar a venda"}</Botao> : undefined}>
              {consolidada && n.viagem_id ? (
                <FichaFechamentoResumo key={n.consolidada_em ?? ""} viagemId={n.viagem_id} />
              ) : encerrado ? (
                <Nada t={`${n.motivo_perda ? `Motivo: ${n.motivo_perda}. ` : ""}Mova de volta pra uma etapa aberta se o cliente voltou.`} />
              ) : (
                <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
                  Os itens já vêm preenchidos. Falta o plano de pagamento (entrada e parcelas) e as preferências do cliente. Ao
                  fechar, a viagem nasce no Relacionamento e o plano vai pro Financeiro.
                </p>
              )}
            </Bloco>
          )}
          {(vendaRegistrada || n.status_pagamento || n.status_contrato) && (
            <PagamentoBloco negocio={n} onMudou={() => void carregar()} onAbrirSolicitacao={links.onAbrirSolicitacao} />
          )}
          {/* Contrato à parte da venda (29/10): sempre no cartão, antes ou depois de consolidar; sem ZapSign, modo manual. */}
          {(!encerrado || n.status_contrato) && (
            <ContratoBloco negocio={n} onMudou={() => void carregar()} />
          )}

          {/* ── 0295: a proposta enviada ao cliente, anexada ao registrar a venda ── */}
          <Bloco titulo="Proposta enviada ao cliente">
            <ListaPropostasAnexadas negocioId={n.id} mostrarVazio versao={versaoAnexos} />
          </Bloco>

          {/* ── Propostas montadas no QS (geração "Em breve": só aparecem as que já existem) ── */}
          {(PROPOSTAS_NO_QS || propostas.length > 0) && (
          <Bloco titulo="Propostas do QS" acao={PROPOSTAS_NO_QS ? <Botao onClick={() => links.onNovaProposta(n.lead_id, nome)}>+ Nova proposta</Botao> : <SeloEmBreve />}>
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
          )}

          {/* ── Reuniões ── */}
          <Bloco titulo="Reuniões (Google Meet)">
            <ReunioesDoCliente leadId={n.lead_id} />
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
            {/* 0213: cadastro único (nome, DN, CPF, passaporte, endereço, quem viaja junto) */}
            <div className="mt-3"><CadastroDoLead leadId={n.lead_id} modo="cartao" /></div>
          </Bloco>

          {/* O que o cliente respondeu na LP (some sozinho quando não há resposta). */}
          <RespostasDoFormulario leadId={n.lead_id} variante="ficha" />

          <Bloco titulo="Etapa">
            <select className="rel-input" value={n.etapa} disabled={ocupado} aria-label="Mover para"
              onChange={(e) => {
                const et = e.target.value as Etapa;
                if (et === "aguardando_emissao" && !consolidada) { if (vendaRegistrada) setFichaAberta(true); else setRegistrarAberto(true); return; }
                if ((et === "venda_realizada" || et === "venda_cancelada") && !consolidada) {
                  setAviso({ tom: "erro", t: `${NOME_ETAPA[et]} vale só pra venda fechada. Primeiro "Registrar venda", depois "Fechar a venda".` });
                  return;
                }
                if (ETAPAS_COM_MOTIVO.includes(et)) { setPerdendo({ etapa: et, motivo: "" }); return; }
                void rodar(() => moverEEspelhar(et), `Movido para ${NOME_ETAPA[et]}.`);
              }}>
              {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
            </select>
            <p className="text-[12px] mt-1.5" style={{ color: "var(--ink3)" }}>
              Desde {dataBr(n.etapa_em)}. Anda sozinho com a reunião (reagendou, no-show, realizada) e com a proposta enviada.
              Aguardando emissão = venda fechada (pagamento definido).
            </p>
            {/* Bitrix é automático (cron a cada 10 min): só aparece quando precisa de alguém. */}
            {n.bitrix_status === "erro" && (
              <div className="mt-2 text-[12px] space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Etiqueta tom="erro">Bitrix não atualizou</Etiqueta>
                  <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(async () => {
                    const r = await espelharNoBitrix(n.id);
                    if (!r.ok) throw new Error(r.mensagem || "O Bitrix não aceitou.");
                  }, "Bitrix atualizado.")}>Tentar agora</Botao>
                </div>
                {n.bitrix_erro && <p style={{ color: "var(--err-ink)" }}>{n.bitrix_erro}</p>}
                <p style={{ color: "var(--ink3)" }}>O QS tenta de novo sozinho a cada hora.</p>
              </div>
            )}
            {n.bitrix_status === "sem_card" && (
              <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Este cliente não tem card no Bitrix: fica só no QS (o Dashboard não vê).</p>
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

      {registrarAberto && (
        <SubirVenda origem="closer" negocio={n} aberto={registrarAberto} onFechar={() => setRegistrarAberto(false)}
          onSalvo={(r) => { setRegistrarAberto(false); setAviso({ tom: r.tom, t: r.mensagem }); setVersaoAnexos((v) => v + 1); void carregar(); }} />
      )}

      {fichaAberta && (
        <FichaFechamento negocio={n} aberto={fichaAberta} onFechar={() => setFichaAberta(false)}
          onConsolidado={(msg) => { setFichaAberta(false); setAviso({ tom: msg.includes("Bitrix atualizado") ? "ok" : "aviso", t: msg }); void carregar(); }} />
      )}

      <Modal aberto={perdendo !== null} titulo={perdendo?.etapa === "venda_cancelada" ? "Cancelar a venda" : "Marcar como perdido"} onFechar={() => setPerdendo(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setPerdendo(null)}>Cancelar</Botao>
          <Botao variante="perigo" disabled={!perdendo?.motivo.trim() || ocupado}
            onClick={() => {
              if (!perdendo) return;
              const { etapa, motivo } = perdendo;
              setPerdendo(null);
              void rodar(() => moverEEspelhar(etapa, motivo), `Movido para ${NOME_ETAPA[etapa]}.`);
            }}>{perdendo?.etapa === "venda_cancelada" ? "Cancelar venda" : "Marcar perdido"}</Botao>
        </>}>
        <label className="block text-[13px] font-semibold mb-1" style={{ color: "var(--ink2)" }} htmlFor="motivo-perda-painel">{perdendo?.etapa === "venda_cancelada" ? "Por que a venda foi cancelada?" : "Por que não fechou?"}</label>
        <textarea id="motivo-perda-painel" className="rel-input" rows={3} value={perdendo?.motivo ?? ""} onChange={(e) => perdendo && setPerdendo({ ...perdendo, motivo: e.target.value })} />
      </Modal>
      {trocando && (
        <TrocarResponsavel atual={n.closer_id} atualNome={n.closer?.name ?? null} onFechar={() => setTrocando(false)}
          onTrocar={async (closerId, nomeNovo, motivo) => {
            await trocarCloser(n.id, closerId, motivo);   // erro aparece dentro da janela
            setTrocando(false);
            setAviso({ tom: "ok", t: `Cartão passado pra ${nomeNovo}.` });
            await carregar();
          }} />
      )}
    </div>
  );
}

/** Escolhe o novo closer do cartão. O lead vai junto se estava com o closer antigo; fica no histórico. */
function TrocarResponsavel({ atual, atualNome, onFechar, onTrocar }: {
  atual: string | null; atualNome: string | null; onFechar: () => void;
  onTrocar: (closerId: string, nome: string, motivo: string | null) => Promise<void>;
}) {
  const [closers, setClosers] = useState<{ id: string; name: string }[] | null>(null);
  const [para, setPara] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    listarClosersAtivos().then((l) => setClosers(l.filter((c) => c.id !== atual))).catch((e) => { setClosers([]); setErro((e as Error).message); });
  }, [atual]);
  const escolhido = closers?.find((c) => c.id === para);
  async function salvar() {
    if (!escolhido) return;
    setOcupado(true); setErro(null);
    try { await onTrocar(escolhido.id, escolhido.name, motivo.trim() || null); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return (
    <Modal aberto titulo="Trocar responsável" onFechar={onFechar}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={!escolhido || ocupado} onClick={() => void salvar()}>{ocupado ? "Passando…" : escolhido ? `Passar pra ${escolhido.name}` : "Passar"}</Botao>
      </>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          Hoje está com <b>{atualNome ?? "ninguém"}</b>. O cartão (e o lead, se estava com {atualNome ?? "ele"}) passa pro closer escolhido, com o histórico todo. Fica registrado quem trocou.
        </p>
        <Campo rotulo="Passar para">
          <select className="rel-input" value={para} onChange={(e) => setPara(e.target.value)} autoFocus>
            <option value="">{closers === null ? "Carregando…" : "Escolha o closer…"}</option>
            {(closers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Motivo (opcional)" dica="Ex.: a venda foi do Bruno; férias; redistribuição.">
          <Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
