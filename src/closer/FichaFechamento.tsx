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
// 09/11 (0338, "tudo digitado UMA vez"): com a venda registrada (qs_vendas +
// qs_venda_itens), a ficha NÃO pede de novo serviço, destino, datas,
// passageiros nem valor — mostra o que está na venda (sempre o atual, a cada
// abertura) e manda corrigir lá. O plano já vem montado do pagamento da venda
// (entrada + nº de parcelas + 1ª parcela); o closer só confere vencimentos,
// forma e observações. Só a ficha tem: preferências, observação pro Financeiro
// e responsável no Relacionamento. Sem venda registrada (cartão antigo), segue
// o formulário de antes.
//
// Ao consolidar: o banco grava a viagem (rel_viagens), o plano (fin_planos /
// fin_parcelas) e põe o cartão em "Venda consolidada"; depois o QS espelha no
// Bitrix (api/closer.js). Se o Bitrix falhar, a venda continua gravada e o
// cartão mostra "Reenviar ao Bitrix".
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import { carregarProposta, tipoVendaBitrix, totaisDaOpcao, TIPOS, type TipoItem } from "@/propostas/lib";
import { listarItensDaVenda, nomeSugerido } from "./vendaItens";
import {
  FORMAS_PAGAMENTO, SERVICOS, brl, consolidar, dataBr, espelharNoBitrix, hojeISO, nomeDoLead, responsaveisDoRel, somarMeses, vendaDoCartao,
  type Ficha, type FormaPagamento, type Negocio, type ParcelaFicha, type Servico,
} from "./lib";
import { planoBate, planoDaVenda, somaDoPlano, type PagamentoDaVenda } from "./planoDaVenda";

const SELECT_CLS = "rel-input";
const vazio = (): Ficha => ({
  servico: "pacote", destino: "", data_ida: "", data_volta: "", qtd_passageiros: null, passageiros: [], valor_total: 0,
  proposta_id: null, opcao_id: null, itens: [],
  plano: { entrada: null, parcelas: [], observacao_financeiro: "" },
  preferencias: { gostos: "", alergias: "", restricoes: "", ocasiao: "", outras: "" },
  rel_responsavel_id: null,
});

const CONDICAO_TXT: Record<string, string> = { avista: "À vista", parcelado: "Parcelado", entrada: "Entrada + parcelas" };

/** Tipos dos itens → serviço da viagem. */
function servicoDosItens(tipos: string[]): Servico {
  if (tipos.includes("expedicao")) return "expedicao";
  if (tipos.includes("pacote")) return "pacote";
  const t = new Set(tipos);
  if (t.size === 1 && t.has("aereo")) return "aereo";
  if (t.size === 1 && t.has("hospedagem")) return "hospedagem";
  if (t.size === 1 && t.has("cruzeiro")) return "cruzeiro";
  if (t.size === 1 && t.has("seguro")) return "seguro";
  if (t.size === 1 && t.has("passeio")) return "passeio";
  if (t.size === 1 && t.has("concierge")) return "concierge";
  return "pacote";
}
/** Serviço da ficha → tipo do catálogo (pro "Tipo de venda" do Bitrix). */
const TIPO_DO_SERVICO: Record<Servico, TipoItem> = {
  pacote: "pacote", aereo: "aereo", hospedagem: "hospedagem", expedicao: "expedicao", passeio: "passeio",
  cruzeiro: "cruzeiro", seguro: "seguro", concierge: "concierge", outro: "outro",
};

export default function FichaFechamento({ negocio, aberto, onFechar, onConsolidado, onCorrigirVenda }: {
  negocio: Negocio;
  aberto: boolean;
  onFechar: () => void;
  onConsolidado: (msg: string) => void;
  /** 0338: abre o "Registrar venda" do cartão (onde se corrige item, valor, passageiros e pagamento). */
  onCorrigirVenda?: () => void;
}) {
  const [f, setF] = useState<Ficha>(() => negocio.ficha ? { ...vazio(), ...negocio.ficha } : vazio());
  const [passageirosTxt, setPassageirosTxt] = useState(() => (negocio.ficha?.passageiros ?? []).map((p) => p.nome).join("\n"));
  const [responsaveis, setResponsaveis] = useState<{ id: string; name: string }[]>([]);
  const [daProposta, setDaProposta] = useState<string | null>(null);
  const [gerar, setGerar] = useState({ n: 1, primeiro: somarMeses(hojeISO(), 1), forma: "boleto" as FormaPagamento });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // 0338: a venda registrada é a fonte. null = carregando/sem venda.
  const [daVenda, setDaVenda] = useState(false);
  const [pagVenda, setPagVenda] = useState<PagamentoDaVenda | null>(null);
  const [planoDaVendaAtivo, setPlanoDaVendaAtivo] = useState(false);
  const [avisoPlano, setAvisoPlano] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // A cada abertura: a venda registrada (sempre a atual) → senão, na 1ª vez, a proposta aprovada.
  useEffect(() => {
    if (!aberto) return;
    void responsaveisDoRel().then(setResponsaveis);
    let vivo = true;
    setCarregando(true);
    (async () => {
      const [regTodos, venda] = await Promise.all([
        listarItensDaVenda(negocio.id).catch(() => []),
        vendaDoCartao(negocio.id).catch(() => null),
      ]);
      // Item cancelado não conta (mesma conta da propagação da 0338).
      const reg = regTodos.filter((i) => i.status !== "cancelado");
      if (!vivo) return;
      if (reg.length) {
        const datasIni = reg.map((i) => i.data_inicio).filter(Boolean).sort();
        const datasFim = reg.map((i) => i.data_fim || i.data_inicio).filter(Boolean).sort();
        const nomes = reg.flatMap((i) => i.passageiros.map((p) => p.nome)).filter(Boolean);
        const unicos = [...new Set(nomes)];
        const destino = reg.find((i) => i.dados.destino)?.dados.destino || reg.find((i) => i.dados.expedicao)?.dados.expedicao || "";
        const total = Math.round(reg.reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
        const pg = venda?.pagamento ?? null;
        const montado = planoDaVenda(total, pg, hojeISO());
        // Plano: o já salvo na ficha vale se ainda fecha com o total; senão, o montado pela venda.
        const salvo = negocio.ficha?.plano ?? vazio().plano;
        const temSalvo = !!(salvo.entrada || salvo.parcelas.length);
        const salvoServe = temSalvo && planoBate(salvo, total);
        const plano = !salvoServe && montado
          ? { ...montado, observacao_financeiro: salvo.observacao_financeiro || montado.observacao_financeiro }
          : salvo;
        setPagVenda(pg);
        setDaVenda(true);
        setPlanoDaVendaAtivo(!!montado);
        setAvisoPlano(temSalvo && !salvoServe
          ? montado
            ? `O plano salvo somava ${brl(somaDoPlano(salvo))} e a venda agora é ${brl(total)} — remontei as parcelas pelo pagamento da venda. Confira os vencimentos.`
            : `O plano salvo soma ${brl(somaDoPlano(salvo))} e a venda agora é ${brl(total)} — ajuste as parcelas.`
          : null);
        setF((x) => {
          return {
            ...x,
            de_itens_da_venda: true,
            destino: destino || x.destino, data_ida: datasIni[0] || x.data_ida, data_volta: datasFim[datasFim.length - 1] || x.data_volta,
            qtd_passageiros: unicos.length || x.qtd_passageiros,
            passageiros: unicos.length ? unicos.map((nome) => ({ nome })) : x.passageiros,
            valor_total: total,
            servico: servicoDosItens(reg.map((i) => i.tipo)),
            itens: reg.map((i) => ({ tipo: i.tipo, nome: i.nome || nomeSugerido(i), descricao: "", valor_total: Number(i.valor) || 0 })),
            plano,
          };
        });
        if (unicos.length) setPassageirosTxt(unicos.join("\n"));
        setDaProposta(null);
        setCarregando(false);
        return;
      }
      setDaVenda(false);
      setCarregando(false);
      if (negocio.ficha) return; // cartão antigo já fechado: o que está salvo
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
    })().catch(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [aberto, negocio.ficha, negocio.id, negocio.lead_id, negocio.valor_previsto]);

  const mudar = (p: Partial<Ficha>) => setF((x) => ({ ...x, ...p }));
  const mudarPlano = (p: Partial<Ficha["plano"]>) => setF((x) => ({ ...x, plano: { ...x.plano, ...p } }));
  const mudarPref = (k: keyof Ficha["preferencias"], v: string) => setF((x) => ({ ...x, preferencias: { ...x.preferencias, [k]: v } }));
  const mudarParcela = (i: number, p: Partial<ParcelaFicha>) =>
    mudarPlano({ parcelas: f.plano.parcelas.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const soma = useMemo(() => somaDoPlano(f.plano), [f.plano]);
  const diferenca = Math.round((Number(f.valor_total) - soma) * 100) / 100;
  // Valores das parcelas travados quando o plano vem da venda (corrige-se na venda).
  const valoresTravados = daVenda && planoDaVendaAtivo;

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

  /** Remonta o plano pelo pagamento da venda (descarta o que foi mexido aqui). */
  function remontarPelaVenda() {
    const m = planoDaVenda(Number(f.valor_total), pagVenda, hojeISO());
    if (!m) return;
    mudarPlano({ entrada: m.entrada, parcelas: m.parcelas, observacao_financeiro: f.plano.observacao_financeiro || m.observacao_financeiro });
    setAvisoPlano(null);
  }

  async function enviar() {
    setErro(null);
    if (!f.valor_total || f.valor_total <= 0) { setErro(daVenda ? "A venda registrada está sem valor — corrija no Registrar venda." : "Informe o valor total da venda."); return; }
    if (Math.abs(diferenca) > 0.05) { setErro(`O plano soma ${brl(soma)} e a venda é ${brl(f.valor_total)} — ajuste antes de fechar.`); return; }
    setSalvando(true);
    try {
      const ficha: Ficha = {
        ...f,
        // Com venda registrada, os nomes vêm dela (já estão em f.passageiros).
        passageiros: daVenda ? f.passageiros : passageirosTxt.split("\n").map((s) => s.trim()).filter(Boolean).map((nome) => ({ nome })),
        // Pré-venda já mandou o tipo; senão, o do serviço (o servidor só preenche se o card estiver vazio).
        tipo_bitrix: negocio.pre_venda_tipo_bitrix || tipoVendaBitrix(TIPO_DO_SERVICO[f.servico] ?? "outro").id,
      };
      await consolidar(negocio.id, ficha);
      let msg = "Venda fechada! A viagem já está no Relacionamento e o plano no Financeiro.";
      try {
        const b = await espelharNoBitrix(negocio.id);
        msg += b.ok ? " Bitrix atualizado." : ` Bitrix: ${b.mensagem ?? "não atualizou"} — o QS tenta de novo sozinho.`;
      } catch (e) {
        msg += ` Bitrix não respondeu (${(e as Error).message}) — o QS tenta de novo sozinho.`;
      }
      onConsolidado(msg);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const h = (t: string) => <h3 className="text-[13px] font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: "var(--rel-ink)" }}>{t}</h3>;
  const linha = (rotulo: string, valor: React.ReactNode) => (
    <div className="flex gap-3 text-[13px] py-0.5">
      <span className="w-28 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <span className="flex-1 min-w-0" style={{ color: "var(--ink)" }}>{valor || "—"}</span>
    </div>
  );

  return (
    <Modal aberto={aberto} titulo={`Fechar: pagamento e contrato — ${nomeDoLead(negocio.lead)}`} onFechar={onFechar} largura={820}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar} disabled={salvando}>Cancelar</Botao>
        <Botao variante="primario" onClick={() => void enviar()} disabled={salvando || carregando}>{salvando ? "Fechando…" : !!negocio.consolidada_em ? "Salvar correção" : "Fechar a venda"}</Botao>
      </>}>
      {daProposta && <Aviso tom="ok">{daProposta}</Aviso>}
      {!negocio.consolidada_em && negocio.pre_venda_em && (
        <div className="mt-2"><Aviso>
          A venda já conta no Dashboard desde {new Date(negocio.pre_venda_em).toLocaleDateString("pt-BR")}. Fechar cria a viagem no
          Relacionamento e o plano no Financeiro — <b>não conta a venda de novo</b>.
        </Aviso></div>
      )}
      {!!negocio.consolidada_em && (
        <div className="mt-2"><Aviso>Esta venda já foi fechada. Salvar de novo corrige a viagem e refaz o plano (só se o Financeiro ainda não deu baixa em nenhuma parcela).</Aviso></div>
      )}

      {h("1. O que foi vendido")}
      {carregando ? (
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Lendo a venda registrada…</p>
      ) : daVenda ? (
        // 0338: só leitura — a venda registrada é a fonte. Corrige-se lá e tudo acompanha.
        <div className="rel-card p-3">
          <div className="flex flex-wrap items-start gap-2 mb-1">
            <p className="text-[12.5px] flex-1 min-w-[220px]" style={{ color: "var(--ink2)" }}>
              Vem da <b>venda registrada</b> — não precisa digitar de novo. Mudou algo? Corrija na venda: a ficha, a viagem, o Financeiro e o Bitrix acompanham.
            </p>
            {onCorrigirVenda && <Botao variante="fantasma" onClick={onCorrigirVenda}>Corrigir no Registrar venda</Botao>}
          </div>
          {linha("Serviço", SERVICOS[f.servico])}
          {linha("Destino", f.destino)}
          {linha("Datas", f.data_ida || f.data_volta ? `${dataBr(f.data_ida || null)} → ${dataBr(f.data_volta || null)}` : "")}
          {linha("Passageiros", f.passageiros.length ? `${f.passageiros.length} · ${f.passageiros.map((p) => p.nome).join(", ")}` : f.qtd_passageiros ? String(f.qtd_passageiros) : "")}
          {linha("Valor total", <b>{brl(f.valor_total)}</b>)}
          {f.itens.length > 0 && (
            <ul className="space-y-0.5 mt-2 pt-2 border-t" style={{ borderColor: "var(--line)" }}>
              {f.itens.map((it, i) => (
                <li key={i} className="flex gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                  <span className="flex-1 min-w-0 truncate">{TIPOS[it.tipo as TipoItem]?.emoji ?? "•"} {it.nome}</span>
                  <span style={{ color: "var(--ink3)" }}>{brl(it.valor_total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
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
          {onCorrigirVenda && (
            <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>
              Dica: registre a venda pelo <button type="button" className="underline" onClick={onCorrigirVenda}>Registrar venda</button> — aí a ficha já vem pronta e o valor fica igual em tudo.
            </p>
          )}
        </>
      )}

      {h("2. Plano de pagamento")}
      <div className="rel-card p-3 space-y-3">
        {valoresTravados && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12.5px] flex-1 min-w-[220px]" style={{ color: "var(--ink2)" }}>
              Montado pelo pagamento da venda: <b>{CONDICAO_TXT[String(pagVenda?.condicao)] ?? "—"}</b>
              {pagVenda?.forma ? <> · {FORMAS_PAGAMENTO[pagVenda.forma as FormaPagamento] ?? pagVenda.forma}</> : null}.
              Confira os vencimentos; valor, entrada e nº de parcelas se mudam na venda.
            </p>
            <Botao variante="fantasma" onClick={remontarPelaVenda}>Remontar pela venda</Botao>
          </div>
        )}
        {avisoPlano && <Aviso>{avisoPlano}</Aviso>}
        {daVenda && !planoDaVendaAtivo && !carregando && (
          <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
            A venda não diz como o cliente vai pagar — monte o plano abaixo (ou preencha "Como vai pagar?" no Registrar venda e reabra a ficha).
          </p>
        )}

        {!valoresTravados && (
          <>
            <label className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
              <input type="checkbox" checked={!!f.plano.entrada}
                onChange={(e) => mudarPlano({ entrada: e.target.checked ? { valor: 0, vencimento: hojeISO(), forma: "pix", observacao: "" } : null })} />
              Tem entrada
            </label>
          </>
        )}
        {f.plano.entrada && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Campo rotulo="Valor da entrada">
              {valoresTravados
                ? <p className="rel-input" style={{ background: "var(--card2)" }}>{brl(f.plano.entrada.valor)}</p>
                : <Entrada type="number" min={0} step="0.01" value={f.plano.entrada.valor || ""}
                    onChange={(e) => mudarPlano({ entrada: { ...f.plano.entrada!, valor: Number(e.target.value) || 0 } })} />}
            </Campo>
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

        {!valoresTravados && (
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
        )}

        {f.plano.parcelas.length > 0 && (
          <div className="space-y-2">
            {f.plano.parcelas.map((p, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[60px_1fr_1fr_1fr_auto_1.4fr_auto] gap-2 items-center">
                <span className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{i + 1}ª</span>
                {valoresTravados
                  ? <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }} aria-label={`Valor da parcela ${i + 1}`}>{brl(p.valor)}</span>
                  : <Entrada aria-label={`Valor da parcela ${i + 1}`} type="number" min={0} step="0.01" value={p.valor || ""} onChange={(e) => mudarParcela(i, { valor: Number(e.target.value) || 0 })} />}
                <Entrada aria-label={`Vencimento da parcela ${i + 1}`} type="date" value={p.vencimento} onChange={(e) => mudarParcela(i, { vencimento: e.target.value })} />
                <select aria-label={`Forma da parcela ${i + 1}`} className={SELECT_CLS} value={p.forma} onChange={(e) => mudarParcela(i, { forma: e.target.value as FormaPagamento })}>
                  {Object.entries(FORMAS_PAGAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[12px]" style={{ color: "var(--ink2)" }}>
                  <input type="checkbox" checked={!!p.recorrente} onChange={(e) => mudarParcela(i, { recorrente: e.target.checked })} /> recorrente
                </label>
                <Entrada aria-label={`Observação da parcela ${i + 1}`} placeholder="Obs." value={p.observacao ?? ""} onChange={(e) => mudarParcela(i, { observacao: e.target.value })} />
                {valoresTravados
                  ? <span />
                  : <Botao variante="fantasma" aria-label={`Tirar a parcela ${i + 1}`} onClick={() => mudarPlano({ parcelas: f.plano.parcelas.filter((_, j) => j !== i) })}>✕</Botao>}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {!valoresTravados && (
            <Botao variante="fantasma" onClick={() => mudarPlano({ parcelas: [...f.plano.parcelas, { valor: 0, vencimento: somarMeses(gerar.primeiro, f.plano.parcelas.length), forma: gerar.forma, recorrente: false, observacao: "" }] })}>
              + Parcela
            </Botao>
          )}
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
