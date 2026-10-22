// src/fin/pagamentos/PagamentosPage.tsx
// -----------------------------------------------------------------------------
// PAGAMENTOS — os pedidos de pagamento ao Financeiro numa tela só (0201, Bruno
// 22/10/2026: "preciso que o financeiro consiga ter uma visualização fácil").
//
//   A fazer      → pedidos abertos (Pix, link, cartão, provisão), por tipo
//   Provisionado → parcelas "a pagar" das provisões, por semana ou mês, com o
//                  total de cada moeda
//   Feitos       → o que já foi pago / enviado / provisionado (60 dias)
//
// Em cima: atrasados, vence hoje e esta semana. Clicar numa linha abre a
// solicitação (a mesma da Central): ali o Financeiro assume, pede ajuste,
// cola o link, marca pago com comprovante ou provisiona.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import SolicitacaoDetalhe from "@/solicitacoes/SolicitacaoDetalhe";
import { NOME_SETOR, agir, primeiroNome, type Setor } from "@/solicitacoes/lib";
import {
  NOME_TIPO_PAG, TIPO_PAG_DO, acaoParcela, dataBr, dinheiro, lerPagamento, listarPagamentos, listarParcelas, rotuloPagamento,
  textoFinalidade, valorDe, venceEm, type Pagamento, type ParcelaPag, type TipoPag,
} from "@/solicitacoes/pagamento";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";

type Aba = "fazer" | "provisionado" | "feitos";
type Agrupar = "semana" | "mes";

const hojeIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
function somaDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Segunda-feira da semana da data. */
function segunda(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return somaDias(iso, -((d.getUTCDay() + 6) % 7));
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** { BRL: 1200, USD: 300 } → "R$ 1.200,00 + US$ 300,00" */
type Totais = Record<string, number>;
function somar(t: Totais, moeda: string, v: number) { t[moeda] = (t[moeda] ?? 0) + (Number.isFinite(v) ? v : 0); }
function textoTotais(t: Totais) {
  const k = Object.keys(t).sort((a, b) => (a === "BRL" ? -1 : b === "BRL" ? 1 : a.localeCompare(b)));
  return k.length ? k.map((m) => dinheiro(t[m], m)).join(" + ") : "—";
}

/** O que mostrar em "Cliente / viagem ou finalidade". */
function deQue(s: { sobre_nome: string | null; formulario: unknown }) {
  const f = lerPagamento(s.formulario);
  if (f?.vinculo === "finalidade") return { texto: textoFinalidade(f), finalidade: true };
  if (f?.vinculo === "expedicao") return { texto: s.sobre_nome ?? `Expedição ${f.expedicao_nome}`, finalidade: false };
  return { texto: s.sobre_nome ?? "—", finalidade: false };
}

function Cartao({ titulo, valor, n, tom }: { titulo: string; valor: string; n: number; tom?: "erro" | "aviso" }) {
  return (
    <div className="rel-card p-3">
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{titulo} <span className="tabular-nums">· {n}</span></p>
      <p className="text-[16px] font-bold leading-tight mt-0.5" style={{ color: tom === "erro" && n ? "var(--err-ink)" : tom === "aviso" && n ? "var(--warn-ink)" : "var(--ink)" }}>{valor}</p>
    </div>
  );
}

export default function PagamentosPage({ abrirId, onAbrirId, onMudou }: { abrirId?: string | null; onAbrirId?: (id: string | null) => void; onMudou?: () => void }) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const [aba, setAba] = useState<Aba>("fazer");
  const [tipo, setTipo] = useState<TipoPag | "todos">("todos");
  const [agrupar, setAgrupar] = useState<Agrupar>("semana");
  const [busca, setBusca] = useState("");
  const [pedidos, setPedidos] = useState<Pagamento[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaPag[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(abrirId ?? null);
  const [baixa, setBaixa] = useState<{ p: ParcelaPag; data: string; valor: string; obs: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setAberto(abrirId ?? null); }, [abrirId]);

  const carregar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([listarPagamentos(), listarParcelas()]);
      setPedidos(a); setParcelas(b); setErro(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Não carregou.";
      setErro(/fin_pagamentos_v|fin_pag_parcelas_v|does not exist|schema cache/i.test(m) ? "A tela de pagamentos ainda não está ligada no banco (falta aplicar a migration 0201)." : m);
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => {
    void carregar();
    const t = setInterval(() => { if (!document.hidden) void carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const abrir = (id: string | null) => { setAberto(id); onAbrirId?.(id); };
  const hoje = hojeIso();
  const fimSemana = somaDias(segunda(hoje), 6);

  const b = busca.trim().toLowerCase();
  const casa = (txt: (string | null | undefined)[]) => !b || txt.some((x) => (x ?? "").toLowerCase().includes(b));

  const abertos = useMemo(() => pedidos.filter((p) => p.aberta), [pedidos]);
  const feitos = useMemo(() => pedidos.filter((p) => !p.aberta).sort((x, y) => (y.concluido_em ?? "").localeCompare(x.concluido_em ?? "")), [pedidos]);
  const aPagar = useMemo(() => parcelas.filter((x) => x.status === "a_pagar"), [parcelas]);

  // Totais do topo: pedidos abertos (pela data do pedido) + parcelas a pagar.
  const resumo = useMemo(() => {
    const r = { atrasado: { t: {} as Totais, n: 0 }, hoje: { t: {} as Totais, n: 0 }, semana: { t: {} as Totais, n: 0 } };
    const conta = (data: string | null, moeda: string, v: number) => {
      if (!data) return;
      if (data < hoje) { somar(r.atrasado.t, moeda, v); r.atrasado.n++; }
      if (data === hoje) { somar(r.hoje.t, moeda, v); r.hoje.n++; }
      if (data >= hoje && data <= fimSemana) { somar(r.semana.t, moeda, v); r.semana.n++; }
    };
    for (const p of abertos) {
      const f = lerPagamento(p.formulario);
      if (!f || f.tipo === "link") continue; // link não é dinheiro saindo
      // Provisão ainda não provisionada: conta a 1ª parcela (as outras entram quando o Financeiro provisionar).
      conta(venceEm(f), f.tipo === "pix" ? "BRL" : f.moeda, valorDe(f));
    }
    for (const x of aPagar) conta(x.vencimento, x.moeda, Number(x.valor));
    return r;
  }, [abertos, aPagar, hoje, fimSemana]);

  const porTipo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of abertos) { const k = TIPO_PAG_DO[p.tipo_id ?? ""]; if (k) c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [abertos]);

  const listaFazer = abertos
    .filter((p) => tipo === "todos" || TIPO_PAG_DO[p.tipo_id ?? ""] === tipo)
    .filter((p) => casa([p.titulo, p.sobre_nome, p.criado_por_nome, String(p.numero)]))
    .sort((x, y) => (venceEm(lerPagamento(x.formulario)) ?? "9999").localeCompare(venceEm(lerPagamento(y.formulario)) ?? "9999"));

  // Provisionado: grupos por semana ou mês.
  const grupos = useMemo(() => {
    const m = new Map<string, { rotulo: string; itens: ParcelaPag[]; t: Totais }>();
    for (const x of aPagar) {
      if (!casa([x.titulo, x.sobre_nome, x.criado_por_nome, (x.formulario as { fornecedor?: string } | null)?.fornecedor])) continue;
      const atras = x.vencimento < hoje;
      let chave: string, rotulo: string;
      if (atras) { chave = "0000"; rotulo = "Atrasadas"; }
      else if (agrupar === "semana") {
        chave = segunda(x.vencimento);
        rotulo = chave === segunda(hoje) ? "Esta semana" : `Semana de ${dataBr(chave).slice(0, 5)} a ${dataBr(somaDias(chave, 6)).slice(0, 5)}`;
      } else {
        chave = x.vencimento.slice(0, 7);
        rotulo = `${MESES[Number(chave.slice(5, 7)) - 1]} de ${chave.slice(0, 4)}`;
      }
      if (!m.has(chave)) m.set(chave, { rotulo, itens: [], t: {} });
      const g = m.get(chave)!;
      g.itens.push(x); somar(g.t, x.moeda, Number(x.valor));
    }
    return [...m.entries()].sort((a, c) => a[0].localeCompare(c[0])).map(([, g]) => g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aPagar, agrupar, hoje, b]);
  const totalProvisionado = useMemo(() => { const t: Totais = {}; for (const x of aPagar) somar(t, x.moeda, Number(x.valor)); return t; }, [aPagar]);
  const parcelasPagas = parcelas.filter((x) => x.status === "pago").sort((x, y) => (y.pago_em ?? "").localeCompare(x.pago_em ?? ""));

  async function assumir(p: Pagamento) {
    setOcupado(true);
    try { await agir(p.id, "aceitar"); await carregar(); onMudou?.(); } catch (e) { setErro(e instanceof Error ? e.message : "Não assumiu."); } finally { setOcupado(false); }
  }
  async function darBaixa() {
    if (!baixa) return;
    setOcupado(true);
    try {
      const v = valorDe({ valor: baixa.valor });
      await acaoParcela(baixa.p.id, "pago", { data: baixa.data, valor: v > 0 ? v : null, obs: baixa.obs });
      setBaixa(null); await carregar(); onMudou?.();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não deu baixa."); } finally { setOcupado(false); }
  }

  const ABAS: [Aba, string, number][] = [["fazer", "A fazer", abertos.length], ["provisionado", "Provisionado", aPagar.length], ["feitos", "Feitos", feitos.length]];

  return (
    <div className="max-w-[1150px] space-y-4">
      <div>
        <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>Pagamentos</h1>
        <p className="text-[13px] mt-0.5" style={{ color: "var(--ink2)" }}>
          Pedidos de Pix, link de pagamento, cartão da empresa e provisões que o Comercial, o Relacionamento e Operações fizeram ao Financeiro.
          Clique num pedido pra resolver.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Cartao titulo="Atrasados" valor={textoTotais(resumo.atrasado.t)} n={resumo.atrasado.n} tom="erro" />
        <Cartao titulo="Vence hoje" valor={textoTotais(resumo.hoje.t)} n={resumo.hoje.n} tom="aviso" />
        <Cartao titulo="Esta semana" valor={textoTotais(resumo.semana.t)} n={resumo.semana.n} />
        <Cartao titulo="Provisionado a pagar" valor={textoTotais(totalProvisionado)} n={aPagar.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--card2)" }} role="tablist" aria-label="Pagamentos">
          {ABAS.map(([k, r, n]) => (
            <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
              className="rounded-lg px-3 h-8 text-[13px] font-semibold"
              style={aba === k ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--ink3)" }}>
              {r} <span className="tabular-nums" style={{ color: "var(--ink3)", fontWeight: 400 }}>{n}</span>
            </button>
          ))}
        </div>
        <input className="rel-input" style={{ maxWidth: 260 }} placeholder="Buscar cliente, fornecedor, quem pediu, nº" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        {aba === "provisionado" && (
          <select className="rel-input" style={{ maxWidth: 170 }} value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)} aria-label="Agrupar por">
            <option value="semana">Agrupar por semana</option>
            <option value="mes">Agrupar por mês</option>
          </select>
        )}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {carregando ? <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p> : (<>

        {aba === "fazer" && (<>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo">
            {([["todos", "Todos"], ...(Object.entries(NOME_TIPO_PAG) as [TipoPag, string][])] as [TipoPag | "todos", string][]).map(([k, r]) => {
              const n = k === "todos" ? abertos.length : porTipo[k] ?? 0;
              return (
                <button key={k} role="radio" aria-checked={tipo === k} onClick={() => setTipo(k)} className="rounded-full px-3 h-8 text-[12.5px] border"
                  style={tipo === k ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "var(--rel)", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
                  {r} <span className="tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
          {!listaFazer.length ? <Vazio titulo="Nada a fazer aqui" texto="Quando alguém pedir um Pix, link, cartão ou provisão ao Financeiro, aparece nesta lista." /> : (
            <div className="rel-card overflow-x-auto">
              <table className="w-full text-[13px]" style={{ color: "var(--ink)" }}>
                <thead>
                  <tr className="text-left text-[12px]" style={{ color: "var(--ink3)" }}>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Quem pediu</th>
                    <th className="px-3 py-2 font-semibold">Cliente / viagem ou para que é</th>
                    <th className="px-3 py-2 font-semibold text-right">Valor</th>
                    <th className="px-3 py-2 font-semibold">Vence em</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {listaFazer.map((p) => {
                    const f = lerPagamento(p.formulario);
                    const k = TIPO_PAG_DO[p.tipo_id ?? ""];
                    const v = venceEm(f);
                    const dq = deQue(p);
                    const atras = !!v && v < hoje;
                    return (
                      <tr key={p.id} className="border-t rel-linha cursor-pointer" style={{ borderColor: "var(--line)" }} onClick={() => abrir(p.id)}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-semibold">{k ? NOME_TIPO_PAG[k] : p.tipo_rotulo}</span>
                          <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>#{p.numero}{p.prioridade !== "normal" ? ` · ${p.prioridade === "urgente" ? "URGENTE" : "alta"}` : ""}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {p.criado_por_nome ?? "—"}
                          <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{NOME_SETOR[p.de_setor as Setor] ?? p.de_setor}</span>
                        </td>
                        <td className="px-3 py-2 max-w-[300px]">
                          <span className="block truncate" style={{ color: dq.finalidade ? "var(--ink2)" : "var(--ink)" }}>{dq.texto}</span>
                          <span className="block text-[11px] truncate" style={{ color: "var(--ink3)" }}>{p.titulo}</span>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap font-semibold tabular-nums">
                          {f ? dinheiro(f.valor, f.tipo === "pix" ? "BRL" : f.moeda) : "—"}
                          {f?.tipo === "provisao" && Number(f.parcelas) > 1 && <span className="block text-[11px] font-normal" style={{ color: "var(--ink3)" }}>× {f.parcelas} parcelas</span>}
                          {f?.tipo === "link" && Number(f.parcelas_max) > 1 && <span className="block text-[11px] font-normal" style={{ color: "var(--ink3)" }}>até {f.parcelas_max}x</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: atras ? "var(--err-ink)" : v === hoje ? "var(--warn-ink)" : "var(--ink)", fontWeight: atras || v === hoje ? 600 : 400 }}>
                          {v ? (v === hoje ? "hoje" : dataBr(v)) : "—"}{atras && <span className="block text-[11px]">atrasado</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Etiqueta tom={p.status === "nova" ? "aviso" : p.aguardando_quem === "solicitante" ? "aviso" : "rel"}>{rotuloPagamento(p)}</Etiqueta>
                          {p.responsavel_nome && <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>com {p.responsavel_id === meuId ? "você" : primeiroNome(p.responsavel_nome)}</span>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {!p.responsavel_id && <Botao disabled={ocupado} onClick={() => void assumir(p)}>Assumir</Botao>}
                          {p.responsavel_id && <Botao variante="primario" onClick={() => abrir(p.id)}>{k === "link" ? "Colar link" : k === "provisao" ? "Provisionar" : "Marcar pago"}</Botao>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>)}

        {aba === "provisionado" && (!grupos.length ? <Vazio titulo="Nenhuma conta provisionada a pagar" texto="Quando o Financeiro provisionar um pedido, as parcelas aparecem aqui por vencimento." /> : (
          <div className="space-y-3">
            {grupos.map((g) => (
              <section key={g.rotulo} className="rel-card overflow-x-auto" aria-label={g.rotulo}>
                <div className="flex flex-wrap items-baseline gap-x-3 px-3 pt-2.5 pb-1">
                  <h2 className="text-[14px] font-bold" style={{ color: g.rotulo === "Atrasadas" ? "var(--err-ink)" : "var(--ink)" }}>{g.rotulo}</h2>
                  <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>{textoTotais(g.t)}</span>
                  <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{g.itens.length} parcela{g.itens.length > 1 ? "s" : ""}</span>
                </div>
                <table className="w-full text-[13px]" style={{ color: "var(--ink)" }}>
                  <tbody>
                    {g.itens.map((x) => {
                      const f = lerPagamento(x.formulario);
                      const dq = deQue(x);
                      return (
                        <tr key={x.id} className="border-t rel-linha cursor-pointer" style={{ borderColor: "var(--line)" }} onClick={() => abrir(x.solicitacao_id)}>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: x.situacao === "atrasado" ? "var(--err-ink)" : "var(--ink)" }}>{dataBr(x.vencimento)}</td>
                          <td className="px-3 py-2">
                            <span className="font-semibold">{f?.fornecedor || x.titulo}</span>
                            <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{[f?.para_que, dq.texto !== "—" ? dq.texto : ""].filter(Boolean).join(" · ")}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ink2)" }}>parcela {x.numero}/{x.total_parcelas}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ink2)" }}>{primeiroNome(x.criado_por_nome)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap font-semibold tabular-nums">{dinheiro(x.valor, x.moeda)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <Botao variante="primario" disabled={ocupado} onClick={() => setBaixa({ p: x, data: hoje, valor: String(x.valor).replace(".", ","), obs: "" })}>Marcar paga</Botao>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        ))}

        {aba === "feitos" && (
          <div className="space-y-3">
            {!feitos.length ? <Vazio titulo="Nada feito nos últimos 60 dias" /> : (
              <div className="rel-card overflow-x-auto">
                <table className="w-full text-[13px]" style={{ color: "var(--ink)" }}>
                  <thead>
                    <tr className="text-left text-[12px]" style={{ color: "var(--ink3)" }}>
                      <th className="px-3 py-2 font-semibold">Tipo</th>
                      <th className="px-3 py-2 font-semibold">Quem pediu</th>
                      <th className="px-3 py-2 font-semibold">Cliente / viagem ou para que é</th>
                      <th className="px-3 py-2 font-semibold text-right">Valor</th>
                      <th className="px-3 py-2 font-semibold">Quando</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feitos.filter((p) => casa([p.titulo, p.sobre_nome, p.criado_por_nome, String(p.numero)])).map((p) => {
                      const f = lerPagamento(p.formulario);
                      const k = TIPO_PAG_DO[p.tipo_id ?? ""];
                      return (
                        <tr key={p.id} className="border-t rel-linha cursor-pointer" style={{ borderColor: "var(--line)" }} onClick={() => abrir(p.id)}>
                          <td className="px-3 py-2 whitespace-nowrap"><span className="font-semibold">{k ? NOME_TIPO_PAG[k] : p.tipo_rotulo}</span><span className="block text-[11px]" style={{ color: "var(--ink3)" }}>#{p.numero}</span></td>
                          <td className="px-3 py-2 whitespace-nowrap">{p.criado_por_nome ?? "—"}</td>
                          <td className="px-3 py-2 max-w-[300px]"><span className="block truncate">{deQue(p).texto}</span>
                            <span className="block text-[11px] truncate" style={{ color: "var(--ink3)" }}>{p.status === "concluida" ? p.resolucao : p.resolucao ? `Motivo: ${p.resolucao}` : ""}</span></td>
                          <td className="px-3 py-2 text-right whitespace-nowrap font-semibold tabular-nums">
                            {p.pag_pago_valor != null ? dinheiro(p.pag_pago_valor, p.pag_pago_moeda ?? "BRL") : f ? dinheiro(f.valor, f.tipo === "pix" ? "BRL" : f.moeda) : "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{dataBr(p.pag_pago_em ?? p.concluido_em)}{p.pag_feito_por_nome && <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{primeiroNome(p.pag_feito_por_nome)}</span>}</td>
                          <td className="px-3 py-2 whitespace-nowrap"><Etiqueta tom={p.status === "concluida" ? "rel" : "neutro"}>{rotuloPagamento(p)}</Etiqueta></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {parcelasPagas.length > 0 && (
              <section className="rel-card p-3" aria-label="Parcelas pagas">
                <h2 className="text-[13px] font-bold mb-1.5" style={{ color: "var(--ink)" }}>Parcelas de provisão pagas</h2>
                <ul className="text-[13px] divide-y" style={{ borderColor: "var(--line)" }}>
                  {parcelasPagas.map((x) => (
                    <li key={x.id} className="py-1.5 flex flex-wrap gap-x-3 cursor-pointer" onClick={() => abrir(x.solicitacao_id)}>
                      <span className="tabular-nums" style={{ color: "var(--ink3)" }}>{dataBr(x.pago_em)}</span>
                      <span className="font-semibold">{lerPagamento(x.formulario)?.fornecedor || x.titulo}</span>
                      <span style={{ color: "var(--ink3)" }}>parcela {x.numero}/{x.total_parcelas}</span>
                      <span className="ml-auto font-semibold tabular-nums">{dinheiro(x.pago_valor ?? x.valor, x.moeda)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </>)}

      <Modal aberto={!!baixa} titulo="Marcar parcela como paga" onFechar={() => setBaixa(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setBaixa(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={ocupado || !baixa?.data} onClick={() => void darBaixa()}>Confirmar pagamento</Botao>
        </>}>
        {baixa && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
              {lerPagamento(baixa.p.formulario)?.fornecedor || baixa.p.titulo} — parcela {baixa.p.numero}/{baixa.p.total_parcelas} de {dinheiro(baixa.p.valor, baixa.p.moeda)}, vencimento {dataBr(baixa.p.vencimento)}.
            </p>
            <Campo rotulo="Data do pagamento"><Entrada type="date" max={hoje} value={baixa.data} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} /></Campo>
            <Campo rotulo={`Valor pago (${baixa.p.moeda})`}><Entrada inputMode="decimal" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} /></Campo>
            <Campo rotulo="Observação"><Entrada value={baixa.obs} onChange={(e) => setBaixa({ ...baixa, obs: e.target.value })} placeholder="Ex.: pago via TED, comprovante no pedido" /></Campo>
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Pra anexar o comprovante, abra o pedido (clique na linha).</p>
          </div>
        )}
      </Modal>

      <SolicitacaoDetalhe id={aberto} onFechar={() => abrir(null)} onMudou={() => { void carregar(); onMudou?.(); }} />
    </div>
  );
}
