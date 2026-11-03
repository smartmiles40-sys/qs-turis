// src/components/sdr/leads/ficha/VendaResumo.tsx
// -----------------------------------------------------------------------------
// Card "Venda" da ficha do closer (desenho de 03/11): Reunião → Proposta →
// Contrato → Pagamento + pacote + valor. Lê o cartão do pipeline do cliente
// (qs_closer_negocios, mesma escolha da VendaDoCliente: aberto no quadro antes
// de encerrado, depois o arquivo), os itens da venda e as propostas ANEXADAS
// na venda (0295) — as propostas geradas pelo QS seguem "Em breve".
// Não grava nada: contrato e link de pagamento abrem o bloco "Venda" da
// Atividade (ContratoBloco/PagamentoBloco de sempre); a venda é a SubirVenda.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ETAPAS_FINAIS, NOME_ETAPA, brl, type Negocio } from "@/closer/lib";
import { itemPrincipal, listarItensDaVenda, nomeSugerido, somaDosItens, type ItemVenda } from "@/closer/vendaItens";
import { listarPropostasDaVenda } from "@/venda/propostaAnexo";
import { passosDaVenda } from "./regras";

const SELECT = "*, lead:qs_leads(id, full_name, first_name, last_name, phone, email, bitrix_id), closer:qs_users!qs_closer_negocios_closer_id_fkey(name)";

export interface VendaDoLead {
  negocio: Negocio | null;
  itens: ItemVenda[];
  propostas: number;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
}

export function useVendaDoLead(leadId: string, ligado: boolean): VendaDoLead {
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [propostas, setPropostas] = useState(0);
  const [carregando, setCarregando] = useState(ligado);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    (async () => {
      setErro(null);
      const { data, error } = await supabase.from("qs_closer_negocios").select(SELECT)
        .eq("lead_id", leadId)
        .order("arquivado_em", { ascending: false, nullsFirst: true })
        .order("criado_em", { ascending: false })
        .limit(5);
      if (!vivo) return;
      if (error) { setErro(error.message); setCarregando(false); return; }
      const lista = (data ?? []) as unknown as Negocio[];
      const noQuadro = lista.filter((x) => !x.arquivado_em);
      const n = noQuadro.find((x) => !ETAPAS_FINAIS.includes(x.etapa)) ?? noQuadro[0] ?? lista[0] ?? null;
      setNegocio(n);
      const [it, pr] = await Promise.all([
        n ? listarItensDaVenda(n.id).catch(() => [] as ItemVenda[]) : Promise.resolve([] as ItemVenda[]),
        listarPropostasDaVenda({ negocioId: n?.id ?? null, leadId }).catch(() => []),
      ]);
      if (!vivo) return;
      setItens(it);
      setPropostas(pr.length);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [leadId, ligado, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { negocio, itens, propostas, carregando, erro, recarregar };
}

export default function VendaResumo({ venda, reuniaoRealizada, pacoteDoLead, onAbrirVenda }: {
  venda: VendaDoLead; reuniaoRealizada: boolean; pacoteDoLead: string | null; onAbrirVenda: () => void;
}) {
  const { negocio: n, itens, propostas, carregando, erro } = venda;
  const passos = passosDaVenda({
    reuniaoRealizada, etapa: n?.etapa ?? null, propostasAnexadas: propostas,
    statusContrato: n?.status_contrato ?? null, statusPagamento: n?.status_pagamento ?? null,
  });
  const atual = passos.findIndex((p) => p.estado !== "feito");
  const principal = itemPrincipal(itens);
  const pacote = principal ? (principal.nome || nomeSugerido(principal)) : n?.pre_venda_tipo || pacoteDoLead;
  const valor = Number(n?.ficha?.valor_total ?? n?.pre_venda_valor ?? (itens.length ? somaDosItens(itens) : null) ?? n?.valor_previsto ?? 0);
  const contratoFeito = n?.status_contrato === "assinado";

  return (
    <section className="fl-card" aria-label="Venda">
      <div className="fl-card__topo">
        <h2>Venda</h2>
        {n && <span className="fl-card__meta">{NOME_ETAPA[n.etapa]}{n.arquivado_em ? " · no arquivo" : ""}</span>}
      </div>
      <div className="fl-barras" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }} role="list" aria-label="Andamento da venda">
        {passos.map((p, i) => (
          <div key={p.rotulo} role="listitem" title={p.detalhe} aria-label={`${p.rotulo}: ${p.detalhe}`}
            className={`fl-barra${p.estado === "feito" ? " fl-barra--feito" : p.estado === "andamento" || i === atual ? " fl-barra--agora" : ""}`} />
        ))}
      </div>
      <div className="fl-barras__rot" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }} aria-hidden="true">
        {passos.map((p, i) => <span key={p.rotulo} className={i === atual ? "fl-ativo" : undefined}>{p.rotulo}</span>)}
      </div>
      {carregando ? <p className="fl-mudo">Carregando a venda…</p>
        : erro ? <p className="fl-mudo">Não consegui ler o cartão do pipeline: {erro}</p>
        : (
          <>
            <div className="fl-linha"><span>Pacote</span><span>{pacote || "—"}</span></div>
            <div className="fl-linha"><span>Valor</span><span>{valor ? brl(valor) : "—"}</span></div>
            {atual >= 0 && <p className="fl-mudo">{passos[atual].detalhe}.</p>}
            {!n && <p className="fl-mudo">Este cliente ainda não tem cartão no pipeline.</p>}
          </>
        )}
      <button type="button" className="fl-btn" onClick={onAbrirVenda}>
        {!n ? "Trazer pro pipeline" : contratoFeito ? "Ver contrato e pagamento" : n.status_contrato ? "Acompanhar contrato" : "Enviar contrato"}
      </button>
    </section>
  );
}
