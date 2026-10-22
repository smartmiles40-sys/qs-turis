// src/closer/FichaFechamentoResumo.tsx
// -----------------------------------------------------------------------------
// A FICHA DE FECHAMENTO, só pra ler (0176). Feita pra ser plugada no card da
// viagem do Relacionamento (e em qualquer lugar que tenha o id da viagem):
//
//   <FichaFechamentoResumo viagemId={v.id} />
//
// Mostra o que o closer vendeu, o plano de pagamento (com a situação de cada
// parcela no Financeiro) e as preferências do cliente. Viagem sem venda
// consolidada não mostra nada (devolve null) — dá pra plugar sem condição.
//
// Lê pela RPC closer_ficha_da_viagem (Relacionamento, Financeiro, Operações,
// gestão e o closer dono). Usa só as variáveis de cor do app (--ink, --line…),
// então fica certo em qualquer área e no modo noturno.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FORMAS_PAGAMENTO, SERVICOS, brl, dataBr, type Ficha, type FormaPagamento, type Servico } from "./lib";

interface ParcelaResumo { numero: number; valor: number; vencimento: string; forma: string; recorrente: boolean; status: string; atrasada: boolean }
interface Resumo {
  negocio_id: string;
  ficha: Ficha;
  consolidada_em: string;
  closer_nome: string | null;
  consolidada_por_nome: string | null;
  responsavel_nome: string | null;
  bitrix_status: string | null;
  parcelas: ParcelaResumo[];
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px] py-1">
      <span className="w-32 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <span className="flex-1 min-w-0" style={{ color: "var(--ink)" }}>{children}</span>
    </div>
  );
}

export default function FichaFechamentoResumo({ viagemId }: { viagemId: string }) {
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    supabase.rpc("closer_ficha_da_viagem", { p_viagem: viagemId }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setErro(error.message.includes("sem-permissao") ? "Sem acesso à ficha desta venda." : "Não consegui ler a ficha de fechamento.");
      else setR((data as Resumo | null) ?? null);
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, [viagemId]);

  if (carregando) return null;
  if (erro) return <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{erro}</p>;
  if (!r?.ficha) return null;

  const f = r.ficha;
  const p = f.preferencias ?? { gostos: "", alergias: "", restricoes: "", ocasiao: "", outras: "" };
  const prefs = ([["Gostos", p.gostos], ["Alergias", p.alergias], ["Restrições", p.restricoes], ["Ocasião especial", p.ocasiao], ["Outras", p.outras]] as const)
    .filter(([, v]) => v && v.trim());
  const pagas = r.parcelas.filter((x) => x.status === "pago").reduce((s, x) => s + Number(x.valor), 0);

  return (
    <section className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--line)" }} aria-label="Ficha de fechamento">
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <h3 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Ficha de fechamento</h3>
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          Consolidada em {dataBr(r.consolidada_em)}{r.closer_nome ? ` · closer ${r.closer_nome}` : ""}
        </span>
      </div>

      <Linha rotulo="Serviço">{SERVICOS[f.servico as Servico] ?? f.servico}{f.destino ? ` — ${f.destino}` : ""}</Linha>
      <Linha rotulo="Datas">{dataBr(f.data_ida)} → {dataBr(f.data_volta)}</Linha>
      <Linha rotulo="Passageiros">
        {f.qtd_passageiros ?? "—"}
        {f.passageiros?.length ? ` (${f.passageiros.map((x) => x.nome).join(", ")})` : ""}
      </Linha>
      <Linha rotulo="Valor total"><b>{brl(f.valor_total)}</b>{pagas > 0 && <span style={{ color: "var(--ink3)" }}> · recebido {brl(pagas)}</span>}</Linha>
      <Linha rotulo="No Relacionamento">{r.responsavel_nome ?? "Sem dono (fila)"}</Linha>

      {f.itens?.length > 0 && (
        <div className="mt-2">
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>O que foi vendido</p>
          <ul className="space-y-0.5">
            {f.itens.map((it, i) => (
              <li key={i} className="flex gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                <span className="flex-1 min-w-0 truncate">{it.nome || it.tipo}</span>
                {it.valor_total > 0 && <span style={{ color: "var(--ink3)" }}>{brl(it.valor_total)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.parcelas.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Plano de pagamento</p>
          <ul className="space-y-0.5">
            {r.parcelas.map((x) => (
              <li key={x.numero} className="flex flex-wrap gap-x-2 text-[13px]" style={{ color: "var(--ink)" }}>
                <span className="w-20">{x.numero === 0 ? "Entrada" : `Parcela ${x.numero}`}</span>
                <span className="w-24">{brl(x.valor)}</span>
                <span className="w-24" style={{ color: "var(--ink3)" }}>{dataBr(x.vencimento)}</span>
                <span className="flex-1" style={{ color: "var(--ink3)" }}>
                  {FORMAS_PAGAMENTO[x.forma as FormaPagamento] ?? x.forma}{x.recorrente ? " · recorrente" : ""}
                </span>
                <span className="font-semibold" style={{ color: x.status === "pago" ? "var(--ok-ink, #047857)" : x.atrasada ? "var(--err-ink)" : "var(--ink3)" }}>
                  {x.status === "pago" ? "pago" : x.status === "cancelado" ? "cancelado" : x.atrasada ? "atrasado" : "a receber"}
                </span>
              </li>
            ))}
          </ul>
          {f.plano?.observacao_financeiro && (
            <p className="text-[12px] mt-1" style={{ color: "var(--ink2)" }}>Obs. pro Financeiro: {f.plano.observacao_financeiro}</p>
          )}
        </div>
      )}

      {prefs.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Preferências do cliente</p>
          {prefs.map(([k, v]) => <Linha key={k} rotulo={k}>{v}</Linha>)}
        </div>
      )}
    </section>
  );
}
