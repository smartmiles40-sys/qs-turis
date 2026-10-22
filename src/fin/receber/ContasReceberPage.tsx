// src/fin/receber/ContasReceberPage.tsx
// -----------------------------------------------------------------------------
// CONTAS A RECEBER (0175, 22/10/2026). As parcelas vêm da FICHA DE FECHAMENTO
// do closer (venda consolidada, 0176): entrada + parcelas, por vencimento.
//
// Situação: a receber | atrasado | pago | cancelado. "Atrasado" não é gravado:
// é parcela a receber com vencimento antes de hoje (fin_contas_receber_v).
// Dar baixa / desfazer: fin_parcela_baixa (só quem é do Financeiro).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";

interface Parcela {
  id: string; plano_id: string; numero: number; valor: number; vencimento: string; forma: string; recorrente: boolean;
  observacao: string | null; status: "a_receber" | "pago" | "cancelado"; situacao: "a_receber" | "atrasado" | "pago" | "cancelado";
  pago_em: string | null; pago_valor: number | null; baixa_obs: string | null;
  cliente_nome: string | null; viagem_id: string | null; valor_total: number; plano_observacao: string | null;
  closer_nome: string | null; total_parcelas: number;
}

const FORMA: Record<string, string> = { pix: "Pix", boleto: "Boleto", cartao: "Cartão", link: "Link", transferencia: "Transferência", dinheiro: "Dinheiro", outro: "Outra" };
const SITUACAO: Record<Parcela["situacao"], { rotulo: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  a_receber: { rotulo: "A receber", tom: "aviso" },
  atrasado: { rotulo: "Atrasado", tom: "erro" },
  pago: { rotulo: "Pago", tom: "rel" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};
const brl = (v: number | null | undefined) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

type Filtro = "abertas" | "atrasado" | "a_receber" | "pago" | "todas";

export default function ContasReceberPage({ onMudou }: { onMudou?: () => void }) {
  const [lista, setLista] = useState<Parcela[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [busca, setBusca] = useState("");
  const [baixa, setBaixa] = useState<{ p: Parcela; data: string; valor: string; obs: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    let q = supabase.from("fin_contas_receber_v").select("*").order("vencimento", { ascending: filtro !== "pago" }).limit(1000);
    if (filtro === "abertas") q = q.eq("status", "a_receber");
    else if (filtro !== "todas") q = q.eq("situacao", filtro);
    const { data, error } = await q;
    if (error) setErro(error.message);
    setLista((data ?? []) as Parcela[]);
    setCarregando(false);
  }, [filtro]);
  useEffect(() => { void carregar(); }, [carregar]);

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? lista.filter((p) => (p.cliente_nome ?? "").toLowerCase().includes(b)) : lista;
  }, [lista, busca]);
  const somar = (fn: (p: Parcela) => boolean) => filtradas.filter(fn).reduce((s, p) => s + Number(p.valor), 0);

  async function acao(p: Parcela, tipo: "pago" | "desfazer", extra?: { data: string; valor: string; obs: string }) {
    setOcupado(true);
    const { error } = await supabase.rpc("fin_parcela_baixa", {
      p_id: p.id, p_acao: tipo,
      p_data: extra?.data || null, p_valor: extra?.valor ? Number(extra.valor) : null, p_obs: extra?.obs || null,
    });
    setOcupado(false);
    if (error) { setErro(error.message.includes("sem-permissao") ? "Só o Financeiro dá baixa em parcela." : error.message); return; }
    setBaixa(null);
    await carregar();
    onMudou?.();
  }

  return (
    <div className="max-w-[1100px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold flex-1" style={{ color: "var(--ink)" }}>Contas a receber</h1>
      </div>
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
        As parcelas nascem da ficha de fechamento do closer (venda consolidada). Marque como pago quando o dinheiro entrar.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rel-card p-3"><p className="text-[12px]" style={{ color: "var(--ink3)" }}>A receber (na lista)</p><p className="text-lg font-bold" style={{ color: "var(--ink)" }}>{brl(somar((p) => p.status === "a_receber"))}</p></div>
        <div className="rel-card p-3"><p className="text-[12px]" style={{ color: "var(--ink3)" }}>Atrasado</p><p className="text-lg font-bold" style={{ color: "var(--err-ink)" }}>{brl(somar((p) => p.situacao === "atrasado"))}</p></div>
        <div className="rel-card p-3"><p className="text-[12px]" style={{ color: "var(--ink3)" }}>Recebido (na lista)</p><p className="text-lg font-bold" style={{ color: "var(--rel-ink)" }}>{brl(filtradas.filter((p) => p.status === "pago").reduce((s, p) => s + Number(p.pago_valor ?? p.valor), 0))}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="rel-input" style={{ maxWidth: 260 }} placeholder="Buscar cliente" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cliente" />
        <select className="rel-input" style={{ maxWidth: 220 }} value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} aria-label="Situação">
          <option value="abertas">Em aberto (a receber + atrasado)</option>
          <option value="atrasado">Só atrasadas</option>
          <option value="a_receber">Só a vencer</option>
          <option value="pago">Pagas</option>
          <option value="todas">Todas</option>
        </select>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {carregando ? <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p> : !filtradas.length ? (
        <Vazio titulo="Nenhuma parcela aqui" texto="Quando um closer consolidar uma venda, o plano de pagamento aparece nesta lista." />
      ) : (
        <div className="rel-card overflow-x-auto">
          <table className="w-full text-[13px]" style={{ color: "var(--ink)" }}>
            <thead>
              <tr className="text-left text-[12px]" style={{ color: "var(--ink3)" }}>
                <th className="px-3 py-2 font-semibold">Vencimento</th>
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">Parcela</th>
                <th className="px-3 py-2 font-semibold">Forma</th>
                <th className="px-3 py-2 font-semibold text-right">Valor</th>
                <th className="px-3 py-2 font-semibold">Situação</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtradas.map((p) => (
                <tr key={p.id} className="border-t rel-linha" style={{ borderColor: "var(--line)" }}>
                  <td className="px-3 py-2 whitespace-nowrap">{dataBr(p.vencimento)}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{p.cliente_nome ?? "—"}</span>
                    <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>
                      venda {brl(p.valor_total)}{p.closer_nome ? ` · ${p.closer_nome}` : ""}
                      {p.observacao ? ` · ${p.observacao}` : ""}{p.plano_observacao && p.numero <= 1 ? ` · ${p.plano_observacao}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.numero === 0 ? "Entrada" : `${p.numero}/${p.total_parcelas}`}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{FORMA[p.forma] ?? p.forma}{p.recorrente ? " · recorrente" : ""}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">{brl(p.valor)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Etiqueta tom={SITUACAO[p.situacao].tom}>{SITUACAO[p.situacao].rotulo}</Etiqueta>
                    {p.status === "pago" && <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>em {dataBr(p.pago_em)}{p.pago_valor != null && Number(p.pago_valor) !== Number(p.valor) ? ` · ${brl(p.pago_valor)}` : ""}</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {p.status === "a_receber" && <Botao variante="primario" disabled={ocupado} onClick={() => setBaixa({ p, data: hoje(), valor: String(p.valor), obs: "" })}>Marcar pago</Botao>}
                    {p.status === "pago" && <Botao variante="fantasma" disabled={ocupado} onClick={() => void acao(p, "desfazer")}>Desfazer</Botao>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal aberto={!!baixa} titulo="Marcar parcela como paga" onFechar={() => setBaixa(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setBaixa(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={ocupado || !baixa?.data} onClick={() => baixa && void acao(baixa.p, "pago", baixa)}>Confirmar pagamento</Botao>
        </>}>
        {baixa && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
              {baixa.p.cliente_nome} — {baixa.p.numero === 0 ? "entrada" : `parcela ${baixa.p.numero}`} de {brl(baixa.p.valor)}, vencimento {dataBr(baixa.p.vencimento)}.
            </p>
            <Campo rotulo="Data do pagamento"><Entrada type="date" value={baixa.data} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} /></Campo>
            <Campo rotulo="Valor recebido (R$)"><Entrada type="number" min={0} step="0.01" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} /></Campo>
            <Campo rotulo="Observação"><Entrada value={baixa.obs} onChange={(e) => setBaixa({ ...baixa, obs: e.target.value })} placeholder="Ex.: comprovante no WhatsApp" /></Campo>
          </div>
        )}
      </Modal>
    </div>
  );
}
