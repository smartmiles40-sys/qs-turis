// src/closer/FichaFechamento.tsx
// -----------------------------------------------------------------------------
// FICHA DE FECHAMENTO — a VENDA CONSOLIDADA (0176, 22/10/2026).
//
// "QS manda, Bitrix espelha" (Bruno). O closer preenche:
//   1. o que foi vendido (puxa da proposta APROVADA se houver);
//   2. o plano de pagamento (entrada + parcelas, forma, recorrente, obs. pro Fin);
//   3. as preferências do cliente (gostos, alergias, restrições, ocasião);
//   4. quem cuida no Relacionamento (opcional — vazio = fila "sem dono").
//
// Ao consolidar: o banco grava a viagem (rel_viagens), o plano (fin_planos /
// fin_parcelas) e põe o cartão em "Venda consolidada"; depois o QS espelha no
// Bitrix (api/closer.js). Se o Bitrix falhar, a venda continua gravada e o
// cartão mostra "Reenviar ao Bitrix".
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import { carregarProposta, totaisDaOpcao, TIPOS, type TipoItem } from "@/propostas/lib";
import {
  FORMAS_PAGAMENTO, SERVICOS, brl, consolidar, espelharNoBitrix, hojeISO, nomeDoLead, responsaveisDoRel, somarMeses,
  type Ficha, type FormaPagamento, type Negocio, type ParcelaFicha, type Servico,
} from "./lib";

const SELECT_CLS = "rel-input";
const vazio = (): Ficha => ({
  servico: "pacote", destino: "", data_ida: "", data_volta: "", qtd_passageiros: null, passageiros: [], valor_total: 0,
  proposta_id: null, opcao_id: null, itens: [],
  plano: { entrada: null, parcelas: [], observacao_financeiro: "" },
  preferencias: { gostos: "", alergias: "", restricoes: "", ocasiao: "", outras: "" },
  rel_responsavel_id: null,
});

/** Tipo do item da proposta → serviço da viagem. */
function servicoDosItens(tipos: string[]): Servico {
  if (tipos.includes("pacote")) return "pacote";
  const t = new Set(tipos);
  if (t.size === 1 && t.has("aereo")) return "aereo";
  if (t.size === 1 && t.has("hospedagem")) return "hospedagem";
  if (t.size === 1 && t.has("cruzeiro")) return "cruzeiro";
  if (t.size === 1 && t.has("seguro")) return "seguro";
  if (t.size === 1 && t.has("passeio")) return "passeio";
  return "pacote";
}

export default function FichaFechamento({ negocio, aberto, onFechar, onConsolidado }: {
  negocio: Negocio;
  aberto: boolean;
  onFechar: () => void;
  onConsolidado: (msg: string) => void;
}) {
  const [f, setF] = useState<Ficha>(() => negocio.ficha ? { ...vazio(), ...negocio.ficha } : vazio());
  const [passageirosTxt, setPassageirosTxt] = useState(() => (negocio.ficha?.passageiros ?? []).map((p) => p.nome).join("\n"));
  const [responsaveis, setResponsaveis] = useState<{ id: string; name: string }[]>([]);
  const [daProposta, setDaProposta] = useState<string | null>(null);
  const [gerar, setGerar] = useState({ n: 1, primeiro: somarMeses(hojeISO(), 1), forma: "boleto" as FormaPagamento });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Responsáveis do Relacionamento + proposta aprovada (só na 1ª vez, sem ficha salva).
  useEffect(() => {
    if (!aberto) return;
    void responsaveisDoRel().then(setResponsaveis);
    if (negocio.ficha) return;
    let vivo = true;
    (async () => {
      // A proposta aprovada mais recente do cliente (direto no lead ou pela solicitação dele).
      const { data: sols } = await supabase.from("qs_solicitacoes").select("id").eq("lead_id", negocio.lead_id);
      const solIds = (sols ?? []).map((s) => s.id as string);
      let q = supabase.from("qs_propostas").select("id").eq("status", "aprovada").order("aprovada_em", { ascending: false }).limit(1);
      q = solIds.length ? q.or(`lead_id.eq.${negocio.lead_id},solicitacao_id.in.(${solIds.join(",")})`) : q.eq("lead_id", negocio.lead_id);
      const { data: ap } = await q;
      const pid = (ap?.[0]?.id as string | undefined) ?? null;
      if (!pid || !vivo) {
        if (vivo && negocio.valor_previsto) setF((x) => ({ ...x, valor_total: Number(negocio.valor_previsto) }));
        return;
      }
      const p = await carregarProposta(pid);
      const op = p.opcoes.find((o) => o.id === p.aprovada_opcao_id) ?? p.opcoes[0];
      if (!op || !vivo) return;
      const tot = totaisDaOpcao(op);
      setF((x) => ({
        ...x,
        proposta_id: p.id ?? null, opcao_id: op.id ?? null,
        destino: p.destino || x.destino, data_ida: p.data_ida || x.data_ida, data_volta: p.data_volta || x.data_volta,
        qtd_passageiros: (p.adultos || 0) + (p.criancas || 0) + (p.bebes || 0) || x.qtd_passageiros,
        valor_total: Math.round(tot.total * 100) / 100,
        servico: servicoDosItens(op.itens.map((i) => i.tipo)),
        itens: op.itens.map((i) => ({ tipo: i.tipo, nome: i.nome || TIPOS[i.tipo as TipoItem]?.rotulo || i.tipo, descricao: i.descricao, valor_total: Number(i.valor_total) || 0 })),
      }));
      setDaProposta(`Puxado da proposta nº ${p.numero ?? ""} — opção "${op.titulo || "aprovada"}"${p.aprovada_nome ? `, aprovada por ${p.aprovada_nome}` : ""}.`);
    })().catch(() => undefined);
    return () => { vivo = false; };
  }, [aberto, negocio.ficha, negocio.lead_id, negocio.valor_previsto]);

  const mudar = (p: Partial<Ficha>) => setF((x) => ({ ...x, ...p }));
  const mudarPlano = (p: Partial<Ficha["plano"]>) => setF((x) => ({ ...x, plano: { ...x.plano, ...p } }));
  const mudarPref = (k: keyof Ficha["preferencias"], v: string) => setF((x) => ({ ...x, preferencias: { ...x.preferencias, [k]: v } }));
  const mudarParcela = (i: number, p: Partial<ParcelaFicha>) =>
    mudarPlano({ parcelas: f.plano.parcelas.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const soma = useMemo(() => (f.plano.entrada?.valor || 0) + f.plano.parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0), [f.plano]);
  const diferenca = Math.round((Number(f.valor_total) - soma) * 100) / 100;

  /** Divide o que falta (total − entrada) em N parcelas mensais. */
  function gerarParcelas() {
    const n = Math.max(1, Math.min(48, Math.floor(gerar.n) || 1));
    const resto = Math.max(0, Number(f.valor_total) - (f.plano.entrada?.valor || 0));
    const base = Math.floor((resto / n) * 100) / 100;
    const ultima = Math.round((resto - base * (n - 1)) * 100) / 100;
    mudarPlano({
      parcelas: Array.from({ length: n }, (_, i) => ({
        valor: i === n - 1 ? ultima : base, vencimento: somarMeses(gerar.primeiro, i), forma: gerar.forma,
        recorrente: gerar.forma === "cartao", observacao: "",
      })),
    });
  }

  async function enviar() {
    setErro(null);
    if (!f.valor_total || f.valor_total <= 0) { setErro("Informe o valor total da venda."); return; }
    if (Math.abs(diferenca) > 0.05) { setErro(`O plano soma ${brl(soma)} e a venda é ${brl(f.valor_total)} — ajuste antes de consolidar.`); return; }
    setSalvando(true);
    try {
      const ficha: Ficha = {
        ...f,
        passageiros: passageirosTxt.split("\n").map((s) => s.trim()).filter(Boolean).map((nome) => ({ nome })),
      };
      await consolidar(negocio.id, ficha);
      let msg = "Venda consolidada! A viagem já está no Relacionamento e o plano no Financeiro.";
      try {
        const b = await espelharNoBitrix(negocio.id);
        msg += b.ok ? " Bitrix atualizado." : ` Bitrix: ${b.mensagem ?? "não atualizou"} — dá pra reenviar no cartão.`;
      } catch (e) {
        msg += ` Bitrix não respondeu (${(e as Error).message}) — use "Reenviar ao Bitrix" no cartão.`;
      }
      onConsolidado(msg);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const h = (t: string) => <h3 className="text-[13px] font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: "var(--rel-ink)" }}>{t}</h3>;

  return (
    <Modal aberto={aberto} titulo={`Ficha de fechamento — ${nomeDoLead(negocio.lead)}`} onFechar={onFechar} largura={820}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar} disabled={salvando}>Cancelar</Botao>
        <Botao variante="primario" onClick={() => void enviar()} disabled={salvando}>{salvando ? "Consolidando…" : negocio.etapa === "consolidada" ? "Salvar correção" : "Consolidar venda"}</Botao>
      </>}>
      {daProposta && <Aviso tom="ok">{daProposta}</Aviso>}
      {negocio.etapa === "consolidada" && (
        <div className="mt-2"><Aviso>Esta venda já foi consolidada. Salvar de novo corrige a viagem e refaz o plano (só se o Financeiro ainda não deu baixa em nenhuma parcela).</Aviso></div>
      )}

      {h("1. O que foi vendido")}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo rotulo="Tipo de serviço">
          <select className={SELECT_CLS} value={f.servico} onChange={(e) => mudar({ servico: e.target.value as Servico })}>
            {Object.entries(SERVICOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Destino"><Entrada value={f.destino} onChange={(e) => mudar({ destino: e.target.value })} placeholder="Ex.: Itália" /></Campo>
        <Campo rotulo="Ida"><Entrada type="date" value={f.data_ida} onChange={(e) => mudar({ data_ida: e.target.value })} /></Campo>
        <Campo rotulo="Volta"><Entrada type="date" value={f.data_volta} onChange={(e) => mudar({ data_volta: e.target.value })} /></Campo>
        <Campo rotulo="Quantos passageiros">
          <Entrada type="number" min={1} value={f.qtd_passageiros ?? ""} onChange={(e) => mudar({ qtd_passageiros: e.target.value ? Number(e.target.value) : null })} />
        </Campo>
        <Campo rotulo="Valor total da venda (R$)">
          <Entrada type="number" min={0} step="0.01" value={f.valor_total || ""} onChange={(e) => mudar({ valor_total: Number(e.target.value) || 0 })} />
        </Campo>
      </div>
      <div className="mt-3">
        <Campo rotulo="Nomes dos passageiros (um por linha)" dica="Opcional — ajuda o Relacionamento a montar a ficha de cada um.">
          <textarea className="rel-input" rows={3} value={passageirosTxt} onChange={(e) => setPassageirosTxt(e.target.value)} />
        </Campo>
      </div>
      {f.itens.length > 0 && (
        <div className="mt-3 rel-card p-3">
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Itens da proposta aprovada</p>
          <ul className="space-y-0.5">
            {f.itens.map((it, i) => (
              <li key={i} className="flex gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                <span className="flex-1 min-w-0 truncate">{TIPOS[it.tipo as TipoItem]?.emoji ?? "•"} {it.nome}</span>
                <span style={{ color: "var(--ink3)" }}>{brl(it.valor_total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {h("2. Plano de pagamento")}
      <div className="rel-card p-3 space-y-3">
        <label className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
          <input type="checkbox" checked={!!f.plano.entrada}
            onChange={(e) => mudarPlano({ entrada: e.target.checked ? { valor: 0, vencimento: hojeISO(), forma: "pix", observacao: "" } : null })} />
          Tem entrada
        </label>
        {f.plano.entrada && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Campo rotulo="Valor da entrada"><Entrada type="number" min={0} step="0.01" value={f.plano.entrada.valor || ""}
              onChange={(e) => mudarPlano({ entrada: { ...f.plano.entrada!, valor: Number(e.target.value) || 0 } })} /></Campo>
            <Campo rotulo="Vencimento"><Entrada type="date" value={f.plano.entrada.vencimento}
              onChange={(e) => mudarPlano({ entrada: { ...f.plano.entrada!, vencimento: e.target.value } })} /></Campo>
            <Campo rotulo="Forma">
              <select className={SELECT_CLS} value={f.plano.entrada.forma} onChange={(e) => mudarPlano({ entrada: { ...f.plano.entrada!, forma: e.target.value as FormaPagamento } })}>
                {Object.entries(FORMAS_PAGAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Observação"><Entrada value={f.plano.entrada.observacao ?? ""}
              onChange={(e) => mudarPlano({ entrada: { ...f.plano.entrada!, observacao: e.target.value } })} /></Campo>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 pt-1 border-t" style={{ borderColor: "var(--line)" }}>
          <div className="w-24"><Campo rotulo="Parcelas"><Entrada type="number" min={1} max={48} value={gerar.n} onChange={(e) => setGerar({ ...gerar, n: Number(e.target.value) })} /></Campo></div>
          <div className="w-40"><Campo rotulo="1º vencimento"><Entrada type="date" value={gerar.primeiro} onChange={(e) => setGerar({ ...gerar, primeiro: e.target.value })} /></Campo></div>
          <div className="w-44"><Campo rotulo="Forma">
            <select className={SELECT_CLS} value={gerar.forma} onChange={(e) => setGerar({ ...gerar, forma: e.target.value as FormaPagamento })}>
              {Object.entries(FORMAS_PAGAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo></div>
          <Botao onClick={gerarParcelas}>Gerar parcelas do restante</Botao>
        </div>

        {f.plano.parcelas.length > 0 && (
          <div className="space-y-2">
            {f.plano.parcelas.map((p, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[60px_1fr_1fr_1fr_auto_1.4fr_auto] gap-2 items-center">
                <span className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{i + 1}ª</span>
                <Entrada aria-label={`Valor da parcela ${i + 1}`} type="number" min={0} step="0.01" value={p.valor || ""} onChange={(e) => mudarParcela(i, { valor: Number(e.target.value) || 0 })} />
                <Entrada aria-label={`Vencimento da parcela ${i + 1}`} type="date" value={p.vencimento} onChange={(e) => mudarParcela(i, { vencimento: e.target.value })} />
                <select aria-label={`Forma da parcela ${i + 1}`} className={SELECT_CLS} value={p.forma} onChange={(e) => mudarParcela(i, { forma: e.target.value as FormaPagamento })}>
                  {Object.entries(FORMAS_PAGAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[12px]" style={{ color: "var(--ink2)" }}>
                  <input type="checkbox" checked={!!p.recorrente} onChange={(e) => mudarParcela(i, { recorrente: e.target.checked })} /> recorrente
                </label>
                <Entrada aria-label={`Observação da parcela ${i + 1}`} placeholder="Obs." value={p.observacao ?? ""} onChange={(e) => mudarParcela(i, { observacao: e.target.value })} />
                <Botao variante="fantasma" aria-label={`Tirar a parcela ${i + 1}`} onClick={() => mudarPlano({ parcelas: f.plano.parcelas.filter((_, j) => j !== i) })}>✕</Botao>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Botao variante="fantasma" onClick={() => mudarPlano({ parcelas: [...f.plano.parcelas, { valor: 0, vencimento: somarMeses(gerar.primeiro, f.plano.parcelas.length), forma: gerar.forma, recorrente: false, observacao: "" }] })}>
            + Parcela
          </Botao>
          <span className="text-[13px] ml-auto" style={{ color: Math.abs(diferenca) > 0.05 ? "var(--err-ink)" : "var(--ink2)" }}>
            Plano: <b>{brl(soma)}</b> de {brl(f.valor_total)}{Math.abs(diferenca) > 0.05 ? ` — ${diferenca > 0 ? "faltam" : "sobram"} ${brl(Math.abs(diferenca))}` : " ✓"}
          </span>
        </div>
        <Campo rotulo="Observação para o Financeiro" dica="Ex.: cartão recorrente no nome da esposa; Pix com desconto combinado.">
          <textarea className="rel-input" rows={2} value={f.plano.observacao_financeiro} onChange={(e) => mudarPlano({ observacao_financeiro: e.target.value })} />
        </Campo>
      </div>

      {h("3. Preferências do cliente")}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo rotulo="Gostos"><Entrada value={f.preferencias.gostos} onChange={(e) => mudarPref("gostos", e.target.value)} placeholder="Vinho, museus, praia…" /></Campo>
        <Campo rotulo="Alergias"><Entrada value={f.preferencias.alergias} onChange={(e) => mudarPref("alergias", e.target.value)} /></Campo>
        <Campo rotulo="Restrições (alimentares, mobilidade…)"><Entrada value={f.preferencias.restricoes} onChange={(e) => mudarPref("restricoes", e.target.value)} /></Campo>
        <Campo rotulo="Ocasião especial"><Entrada value={f.preferencias.ocasiao} onChange={(e) => mudarPref("ocasiao", e.target.value)} placeholder="Lua de mel, aniversário…" /></Campo>
      </div>
      <div className="mt-3">
        <Campo rotulo="Outras observações"><textarea className="rel-input" rows={2} value={f.preferencias.outras} onChange={(e) => mudarPref("outras", e.target.value)} /></Campo>
      </div>

      {h("4. Quem cuida no Relacionamento")}
      <Campo rotulo="Responsável" dica="Deixe em branco pra viagem cair na fila &quot;sem dono&quot; do Relacionamento.">
        <select className={SELECT_CLS} value={f.rel_responsavel_id ?? ""} onChange={(e) => mudar({ rel_responsavel_id: e.target.value || null })}>
          <option value="">Sem dono (fila do Relacionamento)</option>
          {responsaveis.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Campo>

      {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}
    </Modal>
  );
}
