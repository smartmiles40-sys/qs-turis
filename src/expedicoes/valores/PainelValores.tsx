// src/expedicoes/valores/PainelValores.tsx
// Aba "Valores" da expedição: quanto cada cliente contratou, em que condição
// (padrão / sem aéreo / ExpedAmigo / especial), quanto já pagou e o saldo, com os
// totais da expedição (vendido, recebido, a receber) e o preço de referência com e
// sem aéreo. Edição na própria célula; o banco registra quem mudou (0220).
// Também exporta <BlocoValoresPax>, o mesmo editor pra gaveta do passageiro.
// Cockpit (redesign 29/10, spec §3.2 Financeiro): faixa âmbar quando falta valor
// ("Nenhum dos N passageiros tem valor lançado") com "Definir preço padrão", e os
// totais viram 4 StatCards (Vendido, Recebido, A receber, Preço por pessoa).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Botao, Vazio } from "@/rel/ui";
import { Btn, StatCard } from "@/components/ui";
import { Busca, Carregando, CelulaEditavel, Selo, useAoVivo } from "../ui";
import { useExp } from "../contexto";
import { formatBRL, formatDate } from "../lib/utils";
import type { CondicaoPagamento, ExpedicaoComAgregados, ExpedicaoRow } from "../lib/database";
import {
  CONDICOES, TOM_STATUS, carregarValores, nomeCampo, precoSugerido, rotuloCondicao, salvarPrecoReferencia, salvarValores,
  statusFin, totais, type Historico, type PaxValor, type PlanoFin, type StatusFin,
} from "./dados";

const n = (v: unknown) => Number(v ?? 0) || 0;

export default function PainelValores({ exp, onMudou }: { exp: ExpedicaoComAgregados; onMudou: () => void }) {
  const { avisar, somenteLeitura } = useExp();
  const [dados, setDados] = useState<Awaited<ReturnType<typeof carregarValores>> | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<StatusFin | null>(null);
  const [verHist, setVerHist] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  const carregar = useCallback(async () => {
    try { setDados(await carregarValores(exp.id)); } catch (e) { avisarRef.current(e instanceof Error ? e.message : "Erro ao carregar", "erro"); }
  }, [exp.id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "passageiros", filtro: `expedicao_id=eq.${exp.id}` }], () => void carregar(), 500);

  const t = useMemo(() => totais(dados?.pax ?? []), [dados]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (dados?.pax ?? []).filter((p) =>
      (!q || `${p.nome_completo} ${p.cpf ?? ""}`.toLowerCase().includes(q))
      && (!filtro || (p.status_reserva !== "Cancelado" && statusFin(n(p.valor_contratado_brl), n(p.valor_pago_brl)) === filtro)));
  }, [dados, busca, filtro]);

  if (!dados) return <Carregando />;
  const editavel = !somenteLeitura && dados.migracao;

  const salvarPreco = (campo: "preco_venda_brl" | "preco_sem_aereo_brl") => async (v: string | number | null) => {
    await salvarPrecoReferencia(exp.id, campo, v == null ? null : n(v));
    onMudou();
  };

  // Quem está sem valor (cancelados, líderes e cortesias não pagam: fora da conta).
  const semValor = dados.pax.filter((p) => p.status_reserva !== "Cancelado" && p.tipo !== "Líder" && p.tipo !== "Cortesia"
    && statusFin(n(p.valor_contratado_brl), n(p.valor_pago_brl)) === "Sem valor");

  /** Lança o preço de referência em quem está sem valor — só com clique + confirmação. */
  async function definirPrecoPadrao() {
    const alvo = semValor.map((p) => ({ p, v: precoSugerido(p.condicao_pagamento, n(exp.preco_venda_brl), exp.preco_sem_aereo_brl) }));
    const comPreco = alvo.filter((a): a is { p: PaxValor; v: number } => a.v != null);
    if (!comPreco.length) { avisar("Defina antes o preço por pessoa (com aéreo e, se precisar, sem aéreo) no cartão ao lado.", "erro"); return; }
    const pulados = alvo.length - comPreco.length;
    const msg = `Lançar o preço de referência em ${comPreco.length} passageiro${comPreco.length === 1 ? "" : "s"} sem valor?`
      + `\n\nCom aéreo: ${formatBRL(n(exp.preco_venda_brl))} · Sem aéreo: ${exp.preco_sem_aereo_brl ? formatBRL(n(exp.preco_sem_aereo_brl)) : "—"}`
      + (pulados ? `\n${pulados} fica${pulados === 1 ? "" : "m"} de fora (ExpedAmigo/especial ou sem preço pra condição) — lance à mão.` : "")
      + "\n\nCada mudança fica no histórico com o seu nome.";
    if (!window.confirm(msg)) return;
    setAplicando(true);
    let ok = 0;
    try {
      for (const { p, v } of comPreco) { await salvarValores(p.id, { valor_contratado_brl: v }); ok++; }
      avisar(`Preço lançado em ${ok} passageiro${ok === 1 ? "" : "s"}`);
    } catch (e) {
      avisar(`${ok ? `${ok} lançado${ok === 1 ? "" : "s"}; ` : ""}${e instanceof Error ? e.message : "Erro ao lançar"}`, "erro");
    } finally {
      setAplicando(false);
      await carregar();
      onMudou();
    }
  }

  return (
    <div className="space-y-3">
      {!dados.migracao && (
        <div className="rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: "var(--err-bg)", color: "var(--err-ink)" }}>
          Falta aplicar a migration <b>0220</b> no banco. Por enquanto os valores só aparecem (todos zerados); editar fica liberado depois dela.
        </div>
      )}

      {semValor.length > 0 && (
        <div className="ck-banner" role="status">
          <div className="ck-banner__tx">
            <b>{semValor.length === t.ativos ? `Nenhum dos ${t.ativos} passageiros tem valor lançado` : `${semValor.length} passageiro${semValor.length === 1 ? "" : "s"} sem valor lançado`}</b>
            <span>Os totais abaixo ficam incompletos até lançar. Líderes e cortesias não entram nesta conta.</span>
          </div>
          {editavel && (
            <Btn variant="primary" disabled={aplicando} onClick={() => void definirPrecoPadrao()}
              title="Lança o preço de referência (com ou sem aéreo, pela condição) em quem está sem valor">
              {aplicando ? "Lançando…" : "Definir preço padrão"}
            </Btn>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
        <StatCard label="Vendido" value={formatBRL(t.vendido)} sub={`${t.ativos - t.porStatus["Sem valor"]} de ${t.ativos} com valor`} />
        <StatCard label="Recebido" value={formatBRL(t.recebido)} tone="ok" sub={t.vendido ? `${Math.round((t.recebido / t.vendido) * 100)}% do vendido` : "—"} />
        <StatCard label="A receber" value={formatBRL(t.aReceber)} tone={t.aReceber > 0 ? "warn" : "default"} sub={`${t.porStatus["Em aberto"] + t.porStatus.Parcial} com saldo`} />
        <StatCard label="Preço por pessoa"
          value={<CelulaEditavel tipo="number" valor={n(exp.preco_venda_brl) || null} onSalvar={salvarPreco("preco_venda_brl")} formatar={(v) => formatBRL(n(v))} placeholder="definir" />}
          sub={<span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>com aéreo · sem aéreo:{" "}
            {dados.migracao
              ? <CelulaEditavel tipo="number" valor={exp.preco_sem_aereo_brl ?? null} onSalvar={salvarPreco("preco_sem_aereo_brl")} formatar={(v) => formatBRL(n(v))} placeholder="definir" />
              : <span>—</span>}</span>} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar cliente… (nome, CPF)" /></div>
        <div className="flex flex-wrap gap-1">
          <Pilula ativo={!filtro} onClick={() => setFiltro(null)}>Todos</Pilula>
          {(["Sem valor", "Em aberto", "Parcial", "Quitado"] as StatusFin[]).map((s) => (
            <Pilula key={s} ativo={filtro === s} onClick={() => setFiltro(filtro === s ? null : s)}>{s} · {t.porStatus[s]}</Pilula>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
          {CONDICOES.filter((c) => t.porCondicao[c.id]).map((c) => `${t.porCondicao[c.id]} ${c.rotulo.toLowerCase()}`).join(" · ")}
        </span>
      </div>

      {dados.pax.length === 0 ? (
        <section className="rel-card"><Vazio titulo="Nenhum passageiro ainda" texto="Os valores aparecem aqui quando a expedição tiver passageiros." /></section>
      ) : (
        <section className="rel-card p-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead style={{ color: "var(--ink3)" }}>
              <tr className="text-left">
                <th className="px-2 py-2 font-semibold">Cliente</th>
                <th className="px-2 py-2 font-semibold">Condição</th>
                <th className="px-2 py-2 font-semibold text-right">Contratado</th>
                <th className="px-2 py-2 font-semibold text-right">Pago</th>
                <th className="px-2 py-2 font-semibold text-right">Saldo</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Financeiro</th>
                <th className="px-2 py-2 font-semibold">Última mudança</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <LinhaValor key={p.id} p={p} exp={exp} plano={dados.planos.get(p.id)} editavel={editavel} onSalvo={() => void carregar()} />
              ))}
              {!lista.length && <tr><td colSpan={8} className="px-2 py-6 text-center" style={{ color: "var(--ink3)" }}>Ninguém no filtro atual.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t font-bold" style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
                <td className="px-2 py-2" colSpan={2}>Total ({t.ativos} ativos)</td>
                <td className="px-2 py-2 text-right">{formatBRL(t.vendido)}</td>
                <td className="px-2 py-2 text-right">{formatBRL(t.recebido)}</td>
                <td className="px-2 py-2 text-right">{formatBRL(t.aReceber)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
          {editavel && <p className="text-[11.5px] mt-2" style={{ color: "var(--ink3)" }}>Clique no valor pra editar (Enter salva). Cancelados não entram nos totais. Toda mudança fica registrada com o nome de quem fez.</p>}
        </section>
      )}

      {dados.historico.length > 0 && (
        <section className="rel-card p-3">
          <button className="text-[13px] font-bold" style={{ color: "var(--ink)" }} onClick={() => setVerHist((v) => !v)}>
            {verHist ? "▾" : "▸"} Histórico de mudanças <span className="font-normal text-[11.5px]" style={{ color: "var(--ink3)" }}>({dados.historico.length} mais recentes)</span>
          </button>
          {verHist && <ListaHistorico itens={dados.historico} nomes={new Map(dados.pax.map((p) => [p.id, p.nome_completo]))} />}
        </section>
      )}
    </div>
  );
}

function LinhaValor({ p, exp, plano, editavel, onSalvo }: { p: PaxValor; exp: ExpedicaoRow; plano?: PlanoFin; editavel: boolean; onSalvo: () => void }) {
  const cancelado = p.status_reserva === "Cancelado";
  return (
    <tr className="border-t align-top rel-linha" style={{ borderColor: "var(--line)", opacity: cancelado ? 0.5 : 1 }}>
      <td className="px-2 py-2 min-w-[190px]">
        <div className="font-semibold" style={{ color: "var(--ink)" }}>{p.nome_completo}</div>
        <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{p.tipo} · {p.status_reserva}</div>
      </td>
      <EditoresValor p={p} exp={exp} plano={plano} editavel={editavel} onSalvo={onSalvo} modo="linha" />
    </tr>
  );
}

/**
 * Os campos editáveis (condição, contratado, pago, saldo, status, financeiro, última
 * mudança). modo "linha" = células de tabela; modo "bloco" = grade da gaveta.
 */
function EditoresValor({ p, exp, plano, editavel, onSalvo, modo }: {
  p: PaxValor; exp: ExpedicaoRow; plano?: PlanoFin; editavel: boolean; onSalvo: () => void; modo: "linha" | "bloco";
}) {
  const { avisar } = useExp();
  const [pedirTexto, setPedirTexto] = useState(false);
  const [texto, setTexto] = useState(p.condicao_obs ?? "");
  const contratado = n(p.valor_contratado_brl), pago = n(p.valor_pago_brl);
  const st = statusFin(contratado, pago);
  const sugerido = precoSugerido(p.condicao_pagamento, n(exp.preco_venda_brl), exp.preco_sem_aereo_brl);

  const salvar = async (patch: Parameters<typeof salvarValores>[1]) => {
    await salvarValores(p.id, patch);
    onSalvo();
  };
  const tentar = (fn: () => Promise<void>) => () => { fn().catch((e) => avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro")); };

  const condicao = (
    <div className="min-w-[150px]">
      {editavel ? (
        <select className="rel-input" style={{ padding: "3px 6px", fontSize: 12 }} aria-label="Condição" value={p.condicao_pagamento ?? "padrao"}
          onChange={(e) => {
            const v = e.target.value as CondicaoPagamento;
            if (v === "especial") { setPedirTexto(true); return; }
            tentar(() => salvar({ condicao_pagamento: v }))();
          }}>
          {CONDICOES.map((c) => <option key={c.id} value={c.id} title={c.dica}>{c.rotulo}</option>)}
        </select>
      ) : <span>{rotuloCondicao(p.condicao_pagamento)}</span>}
      {(p.condicao_pagamento === "especial" || pedirTexto) && (
        editavel && (pedirTexto || !p.condicao_obs) ? (
          <div className="mt-1 flex gap-1">
            <input className="rel-input" style={{ padding: "3px 6px", fontSize: 12 }} placeholder="Ex.: entrada + 10x sem juros" value={texto} autoFocus
              onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setPedirTexto(false); }} />
            <Botao className="!px-2 !py-0.5 text-[11.5px]" disabled={!texto.trim()}
              onClick={tentar(async () => { await salvar({ condicao_pagamento: "especial", condicao_obs: texto.trim() }); setPedirTexto(false); })}>OK</Botao>
          </div>
        ) : (
          <button className="block text-left text-[11px] mt-0.5 italic" style={{ color: "var(--ink2)" }} disabled={!editavel}
            onClick={() => { setTexto(p.condicao_obs ?? ""); setPedirTexto(true); }}>{p.condicao_obs}</button>
        )
      )}
    </div>
  );

  const contratadoEl = (
    <div className={modo === "linha" ? "text-right" : ""}>
      {editavel
        ? <CelulaEditavel tipo="number" valor={contratado || null} placeholder="R$ —" formatar={(v) => formatBRL(n(v))}
            onSalvar={async (v) => {
              await salvar({ valor_contratado_brl: v == null ? 0 : n(v) });
              // 0338: o valor volta pra venda do closer (item, total, ficha, viagem e Bitrix).
              if (p.venda_id) avisar("Valor salvo — a venda do closer, a ficha e o Bitrix acompanham.");
            }} />
        : <span>{contratado ? formatBRL(contratado) : "—"}</span>}
      {editavel && !contratado && sugerido && (
        <button className="block ml-auto text-[11px] underline" style={{ color: "var(--rel-ink)" }}
          onClick={tentar(() => salvar({ valor_contratado_brl: sugerido }))}>usar {formatBRL(sugerido, 0)}</button>
      )}
    </div>
  );
  const pagoEl = (
    <div className={modo === "linha" ? "text-right" : ""}>
      {editavel
        ? <CelulaEditavel tipo="number" valor={pago || null} placeholder="R$ —" formatar={(v) => formatBRL(n(v))}
            onSalvar={async (v) => salvar({ valor_pago_brl: v == null ? 0 : n(v) })} />
        : <span>{pago ? formatBRL(pago) : "—"}</span>}
    </div>
  );
  const saldoEl = <span style={{ color: contratado - pago > 0 ? "#B45309" : "var(--ink2)" }}>{contratado ? formatBRL(contratado - pago) : "—"}</span>;
  const statusEl = <Selo tom={TOM_STATUS[st]}>{st}</Selo>;
  const finEl = plano ? (
    <div className="text-[11.5px] min-w-[150px]" style={{ color: "var(--ink2)" }}
      title={plano.pax_no_plano > 1 ? `O plano cobre ${plano.pax_no_plano} pessoas desta expedição (venda conjunta).` : undefined}>
      <div>Plano {formatBRL(n(plano.plano_total), 0)}{plano.pax_no_plano > 1 ? ` (${plano.pax_no_plano} pax)` : ""}</div>
      <div>Recebido {formatBRL(n(plano.recebido), 0)} · {plano.parcelas_abertas} parcela{plano.parcelas_abertas === 1 ? "" : "s"} aberta{plano.parcelas_abertas === 1 ? "" : "s"}</div>
      {plano.proximo_vencimento && <div>Próx. venc. {formatDate(plano.proximo_vencimento)}</div>}
      {editavel && plano.pax_no_plano === 1 && n(plano.recebido) !== pago && (
        <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={tentar(() => salvar({ valor_pago_brl: n(plano.recebido) }))}>usar recebido como pago</button>
      )}
    </div>
  ) : <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>sem plano</span>;
  const quemEl = p.valor_atualizado_em ? (
    <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{p.valor_atualizado_por_nome || "—"}<br />{formatDate(p.valor_atualizado_em, "dd/MM HH:mm")}</span>
  ) : <span className="text-[11px]" style={{ color: "var(--ink3)" }}>—</span>;

  if (modo === "linha") {
    return (
      <>
        <td className="px-2 py-2">{condicao}</td>
        <td className="px-2 py-2 min-w-[110px]">{contratadoEl}</td>
        <td className="px-2 py-2 min-w-[110px]">{pagoEl}</td>
        <td className="px-2 py-2 text-right whitespace-nowrap">{saldoEl}</td>
        <td className="px-2 py-2">{statusEl}</td>
        <td className="px-2 py-2">{finEl}</td>
        <td className="px-2 py-2 whitespace-nowrap">{quemEl}</td>
      </>
    );
  }
  const item = (rotulo: string, el: React.ReactNode) => (
    <div><div className="text-[11px] font-semibold mb-0.5" style={{ color: "var(--ink3)" }}>{rotulo}</div>{el}</div>
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12.5px]">
      {item("Condição", condicao)}
      {item("Contratado", contratadoEl)}
      {item("Pago", pagoEl)}
      {item("Saldo", saldoEl)}
      {item("Status", statusEl)}
      {item("Última mudança", quemEl)}
      <div className="col-span-2 sm:col-span-3">{item("Financeiro", finEl)}</div>
    </div>
  );
}

/** Bloco "Valores" pra gaveta do passageiro (mesmos editores da aba). */
export function BlocoValoresPax({ exp, paxId }: { exp: ExpedicaoRow; paxId: string }) {
  const { somenteLeitura } = useExp();
  const [d, setD] = useState<{ p: PaxValor; plano?: PlanoFin; migracao: boolean } | null>(null);
  const carregar = useCallback(async () => {
    try {
      const r = await carregarValores(exp.id);
      const p = r.pax.find((x) => x.id === paxId);
      setD(p ? { p, plano: r.planos.get(paxId), migracao: r.migracao } : null);
    } catch { setD(null); }
  }, [exp.id, paxId]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!d) return null;
  return (
    <section className="rounded-xl p-3.5" style={{ border: "1px solid var(--line)" }}>
      <h4 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Valores</h4>
      {!d.migracao && <p className="text-[11.5px] mt-0.5" style={{ color: "var(--err-ink)" }}>Falta aplicar a migration 0220 pra editar.</p>}
      <div className="mt-2"><EditoresValor p={d.p} exp={exp} plano={d.plano} editavel={!somenteLeitura && d.migracao} onSalvo={() => void carregar()} modo="bloco" /></div>
    </section>
  );
}

function ListaHistorico({ itens, nomes }: { itens: Historico[]; nomes: Map<string, string> }) {
  const fmt = (campo: string, v: string | null) => {
    if (v == null || v === "") return "vazio";
    if (campo === "valor_contratado_brl" || campo === "valor_pago_brl") return formatBRL(n(v));
    if (campo === "condicao_pagamento") return rotuloCondicao(v as CondicaoPagamento);
    return `"${v}"`;
  };
  return (
    <ul className="mt-2 space-y-1 text-[12px]">
      {itens.map((h) => (
        <Fragment key={h.id}>
          <li style={{ color: "var(--ink2)" }}>
            <span style={{ color: "var(--ink3)" }}>{formatDate(h.criado_em, "dd/MM HH:mm")}</span> · <b>{h.usuario_nome || "—"}</b> mudou{" "}
            <b>{nomeCampo(h.campo)}</b> de {nomes.get(h.passageiro_id) ?? "passageiro"}: {fmt(h.campo, h.antes)} → {fmt(h.campo, h.depois)}
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

function Pilula({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="px-2.5 py-1 rounded-full text-[12px] font-semibold"
      style={{ background: ativo ? "var(--rel-soft)" : "var(--card)", color: ativo ? "var(--rel-ink)" : "var(--ink2)", border: `1px solid ${ativo ? "transparent" : "var(--line)"}` }}>{children}</button>
  );
}
