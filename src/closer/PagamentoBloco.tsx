// src/closer/PagamentoBloco.tsx
// -----------------------------------------------------------------------------
// O PAGAMENTO dentro do cartão do closer (0181, 22/10/2026). Sem gateway
// (Pagar.me/Asaas ficaram pra depois — Bruno): tudo à mão ou pelo Financeiro.
//
//   • "Colar link" → o link que o closer mandou ao cliente; cartão vai para
//     "Pagamento enviado".
//   • "Marcar pago" → cartão vai para "Pago". Se a venda já tem plano de
//     pagamento (ficha consolidada), dá pra escolher a parcela e ela recebe
//     baixa no Contas a receber do Financeiro.
//   • "Pedir link ao Financeiro" (crédito recorrente / pagamento futuro) →
//     solicitação na Central. Quando o Financeiro conclui colando o link na
//     resolução, o link aparece aqui sozinho.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { FORMAS_PAGAMENTO, brl, dataBr, dataHoraBr, hojeISO, type FormaPagamento, type Negocio } from "./lib";
import {
  MODALIDADES, pagamentoLimpar, pagamentoLink, pagamentoPago, parcelasDoCartao, pedirLinkAoFinanceiro,
  type Modalidade, type ParcelaAberta,
} from "./contrato";

const STATUS_PAG: Record<string, { t: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  enviado: { t: "Link enviado", tom: "aviso" }, parcial: { t: "Pago em parte", tom: "aviso" }, pago: { t: "Pago", tom: "rel" }, cancelado: { t: "Cancelado", tom: "neutro" },
};
const STATUS_SOL: Record<string, string> = {
  nova: "aguardando o Financeiro", em_andamento: "o Financeiro está gerando", aguardando: "o Financeiro está aguardando algo",
  concluida: "concluída", recusada: "recusada", cancelada: "cancelada",
};

interface PedidoFin { id: string; numero: number; status: string; resolucao: string | null; prazo: string | null }

export default function PagamentoBloco({ negocio, onMudou, onAbrirSolicitacao }: { negocio: Negocio; onMudou: () => void; onAbrirSolicitacao: (id: string) => void }) {
  const [parcelas, setParcelas] = useState<ParcelaAberta[]>([]);
  const [pedido, setPedido] = useState<PedidoFin | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "aviso" | "erro"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [janela, setJanela] = useState<null | "link" | "pago" | "pedir">(null);
  const [link, setLink] = useState("");
  const [pago, setPago] = useState({ parcela: "", data: hojeISO(), valor: "", obs: "" });
  const [ped, setPed] = useState({ modalidade: "recorrente" as Modalidade, valor: "", parcelas: "", vencimento: "", obs: "", prioridade: "normal" as "normal" | "alta" | "urgente" });

  const carregar = useCallback(async () => {
    setParcelas(await parcelasDoCartao(negocio.id).catch(() => []));
    if (negocio.pagamento_solicitacao_id) {
      const { data } = await supabase.from("qs_solicitacoes").select("id, numero, status, resolucao, prazo").eq("id", negocio.pagamento_solicitacao_id).maybeSingle();
      setPedido((data as PedidoFin | null) ?? null);
    } else setPedido(null);
  }, [negocio.id, negocio.pagamento_solicitacao_id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function rodar(f: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    setAviso(null);
    try { await f(); setAviso({ tom: "ok", t: ok }); setJanela(null); await carregar(); onMudou(); }
    catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  const abertas = parcelas.filter((p) => p.status === "a_receber");
  const st = negocio.status_pagamento ? STATUS_PAG[negocio.status_pagamento] : null;
  const perdido = negocio.etapa === "perdido";
  const valorBase = negocio.ficha?.valor_total ?? negocio.valor_previsto ?? null;
  const pedidoAberto = pedido && ["nova", "em_andamento", "aguardando"].includes(pedido.status);

  return (
    <section className="rel-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Pagamento</h2>
        {st && <Etiqueta tom={st.tom}>{st.t}</Etiqueta>}
      </div>
      {aviso && <div className="mb-2"><Aviso tom={aviso.tom}>{aviso.t}</Aviso></div>}

      {negocio.pagamento_link ? (
        <div className="text-[13px] space-y-1">
          <p style={{ color: "var(--ink2)" }}>
            Link de pagamento{negocio.pagamento_link_origem === "financeiro" ? " (gerado pelo Financeiro)" : ""}
            {negocio.pagamento_link_em ? ` · ${dataHoraBr(negocio.pagamento_link_em)}` : ""}:
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <a href={negocio.pagamento_link} target="_blank" rel="noreferrer" className="font-semibold underline break-all" style={{ color: "var(--rel-ink)" }}>{negocio.pagamento_link}</a>
            <button type="button" className="text-[12px] underline" style={{ color: "var(--ink3)" }} onClick={() => void navigator.clipboard?.writeText(negocio.pagamento_link ?? "")}>copiar</button>
          </div>
          {negocio.pagamento_link_origem === "financeiro" && negocio.status_pagamento !== "enviado" && negocio.status_pagamento !== "pago" && !perdido && (
            <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(() => pagamentoLink(negocio.id, negocio.pagamento_link ?? ""), "Marcado: link enviado ao cliente.")}>
              Mandei este link ao cliente
            </Botao>
          )}
        </div>
      ) : (
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Nenhum link de pagamento ainda.</p>
      )}
      {negocio.pago_em && negocio.status_pagamento === "pago" && (
        <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>Pago em {dataBr(negocio.pago_em)}{negocio.pagamento_obs ? ` · ${negocio.pagamento_obs}` : ""}</p>
      )}

      {pedido && (
        <div className="mt-2 text-[12px] rounded-lg px-3 py-2" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
          Pedido ao Financeiro nº {pedido.numero}: <b>{STATUS_SOL[pedido.status] ?? pedido.status}</b>
          {pedidoAberto && pedido.prazo ? ` · prazo ${dataHoraBr(pedido.prazo)}` : ""}
          {pedido.status === "recusada" && pedido.resolucao ? ` — ${pedido.resolucao}` : ""}
          {" · "}<button type="button" className="underline" onClick={() => onAbrirSolicitacao(pedido.id)}>abrir</button>
        </div>
      )}

      {parcelas.length > 0 && (
        <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>
          Plano no Financeiro: {parcelas.filter((p) => p.status === "pago").length} de {parcelas.length} {parcelas.length === 1 ? "parcela paga" : "parcelas pagas"}.
        </p>
      )}

      {!perdido && (
        <div className="flex flex-wrap gap-2 mt-3">
          <Botao disabled={ocupado} onClick={() => { setLink(negocio.pagamento_link ?? ""); setJanela("link"); }}>Colar link enviado</Botao>
          {negocio.status_pagamento !== "pago" && (
            <Botao variante="primario" disabled={ocupado} onClick={() => {
              const p = abertas[0];
              setPago({ parcela: p?.id ?? "", data: hojeISO(), valor: p ? String(p.valor) : valorBase ? String(valorBase) : "", obs: "" });
              setJanela("pago");
            }}>Marcar pago</Botao>
          )}
          {!pedidoAberto && (
            <Botao variante="fantasma" disabled={ocupado} onClick={() => {
              setPed({ modalidade: "recorrente", valor: valorBase ? String(valorBase) : "", parcelas: "", vencimento: "", obs: "", prioridade: "normal" });
              setJanela("pedir");
            }}>Pedir link ao Financeiro</Botao>
          )}
          {negocio.status_pagamento && (
            <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(() => pagamentoLimpar(negocio.id), "Status do pagamento desfeito.")}>Desfazer status</Botao>
          )}
        </div>
      )}

      {/* ── Colar link ── */}
      <Modal aberto={janela === "link"} titulo="Link de pagamento enviado" onFechar={() => setJanela(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setJanela(null)}>Voltar</Botao>
          <Botao variante="primario" disabled={ocupado || !/^https?:\/\//i.test(link.trim())}
            onClick={() => void rodar(() => pagamentoLink(negocio.id, link.trim()), "Link salvo — cartão em \"Pagamento enviado\".")}>Salvar</Botao>
        </>}>
        <Campo rotulo="Link que você mandou ao cliente" dica="Asaas, Pagar.me, maquininha, banco… O QS só guarda o link.">
          <Entrada value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" autoFocus />
        </Campo>
      </Modal>

      {/* ── Marcar pago ── */}
      <Modal aberto={janela === "pago"} titulo="Marcar pagamento recebido" onFechar={() => setJanela(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setJanela(null)}>Voltar</Botao>
          <Botao variante="primario" disabled={ocupado}
            onClick={() => void rodar(() => pagamentoPago(negocio.id, {
              parcelaId: pago.parcela || null, data: pago.data || null, valor: pago.valor ? Number(pago.valor) : null, obs: pago.obs.trim() || undefined,
            }), pago.parcela ? "Pago — e a parcela recebeu baixa no Financeiro." : "Marcado como pago.")}>Confirmar</Botao>
        </>}>
        <div className="space-y-3">
          {abertas.length > 0 ? (
            <Campo rotulo="Dar baixa em qual parcela do plano?" dica="A baixa aparece no Contas a receber do Financeiro (ele pode desfazer).">
              <select className="rel-input" value={pago.parcela} onChange={(e) => {
                const p = abertas.find((x) => x.id === e.target.value);
                setPago({ ...pago, parcela: e.target.value, valor: p ? String(p.valor) : pago.valor });
              }}>
                <option value="">Nenhuma (só marcar o cartão)</option>
                {abertas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.numero === 0 ? "Entrada" : `Parcela ${p.numero}`} · {brl(p.valor)} · vence {dataBr(p.vencimento)} · {FORMAS_PAGAMENTO[p.forma as FormaPagamento] ?? p.forma}
                  </option>
                ))}
              </select>
            </Campo>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Esta venda ainda não tem plano de pagamento no Financeiro (ele nasce na ficha de fechamento) — só o cartão é marcado.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Data do pagamento"><Entrada type="date" max={hojeISO()} value={pago.data} onChange={(e) => setPago({ ...pago, data: e.target.value })} /></Campo>
            <Campo rotulo="Valor recebido (R$)"><Entrada type="number" min={0} step="0.01" value={pago.valor} onChange={(e) => setPago({ ...pago, valor: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Observação"><Entrada value={pago.obs} onChange={(e) => setPago({ ...pago, obs: e.target.value })} placeholder="Ex.: Pix da entrada, comprovante no WhatsApp" /></Campo>
        </div>
      </Modal>

      {/* ── Pedir link ao Financeiro ── */}
      <Modal aberto={janela === "pedir"} titulo="Pedir link de pagamento ao Financeiro" onFechar={() => setJanela(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setJanela(null)}>Voltar</Botao>
          <Botao variante="primario" disabled={ocupado || !(Number(ped.valor) > 0)}
            onClick={() => void rodar(() => pedirLinkAoFinanceiro(negocio.id, {
              modalidade: ped.modalidade, valor: Number(ped.valor), parcelas: ped.parcelas ? Number(ped.parcelas) : null,
              vencimento: ped.vencimento || null, obs: ped.obs.trim() || undefined, prioridade: ped.prioridade,
            }), "Pedido enviado ao Financeiro. Quando ele concluir, o link aparece aqui.")}>Enviar pedido</Botao>
        </>}>
        <div className="space-y-3">
          <Campo rotulo="Tipo">
            <select className="rel-input" value={ped.modalidade} onChange={(e) => setPed({ ...ped, modalidade: e.target.value as Modalidade })}>
              {(Object.keys(MODALIDADES) as Modalidade[]).map((m) => <option key={m} value={m}>{MODALIDADES[m]}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Valor (R$) *"><Entrada type="number" min={0} step="0.01" value={ped.valor} onChange={(e) => setPed({ ...ped, valor: e.target.value })} /></Campo>
            <Campo rotulo="Parcelas"><Entrada type="number" min={1} max={48} value={ped.parcelas} onChange={(e) => setPed({ ...ped, parcelas: e.target.value })} placeholder="Ex.: 10" /></Campo>
            <Campo rotulo="1º vencimento / cobrança"><Entrada type="date" value={ped.vencimento} onChange={(e) => setPed({ ...ped, vencimento: e.target.value })} /></Campo>
            <Campo rotulo="Prioridade">
              <select className="rel-input" value={ped.prioridade} onChange={(e) => setPed({ ...ped, prioridade: e.target.value as typeof ped.prioridade })}>
                <option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
              </select>
            </Campo>
          </div>
          <Campo rotulo="Observação para o Financeiro"><textarea className="rel-input" rows={2} value={ped.obs} onChange={(e) => setPed({ ...ped, obs: e.target.value })} /></Campo>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Vira uma solicitação na Central (Financeiro → "Gerar link de pagamento"), já amarrada a este cliente.</p>
        </div>
      </Modal>
    </section>
  );
}
