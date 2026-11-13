// src/components/sdr/leads/RespostasDoFormulario.tsx
// -----------------------------------------------------------------------------
// O QUE O CLIENTE JÁ CONTOU, NA FRENTE DE QUEM VAI LIGAR.
//
// O pedido (Bruno, 14/09): "como nossos SDRs ficam ligando e mandando msg
// direto, acaba que eles não veem o que as pessoas cadastram nas respostas que
// temos como padrão... em cima da parte de ligação e dentro do card do cliente,
// aparecer os campos que ele preencheu".
//
// São as perguntas da landing page — se a data faz sentido, se a faixa de
// investimento faz sentido, em quanto tempo pretende decidir, com quem viaja.
// Quem tem isso é o card do Bitrix; quem lê é o `/api/lead-formulario`.
//
// DUAS REGRAS DE COMPORTAMENTO, as duas por causa da ligação:
//
//   1. NÃO OCUPA ESPAÇO QUANDO NÃO TEM O QUE DIZER. Lead sem card, sem resposta
//      ou com o Bitrix fora do ar → não renderiza nada. Um bloco "nenhuma
//      resposta" em todo card empurraria o botão de ligar pra baixo em troca de
//      informação zero.
//   2. NÃO PISCA. A carga é silenciosa: nada de esqueleto nem "carregando…"
//      pulando na frente do SDR que está discando. O bloco aparece quando tem
//      conteúdo, e daí não sai mais (o `formulario.ts` guarda por lead).
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  carregarRespostasDoFormulario,
  respostasEmCache,
  type RespostaFormulario,
} from "@/lib/qs/formulario";

export interface RespostasDoFormularioProps {
  leadId: string | null | undefined;
  /**
   * "hero" = dentro do card da atividade, logo acima do botão de ligar. Compacto
   * e sem título grande: ali o SDR está lendo de relance, com o telefone na mão.
   * "ficha" = card claro (painel do negócio do closer).
   * "coluna" = card da coluna esquerda da ficha do lead (redesenho de 03/11).
   */
  variante?: "hero" | "ficha" | "coluna";
  /**
   * Respostas já em mãos (visão cruzada, 13/11): a ficha do Rel / gaveta do Ops
   * recebe o cache qs_lead_form_answers pela RPC pessoa_contexto_comercial (0382)
   * — o /api/lead-formulario dá 403 pra quem não é do Comercial. Com isto, o
   * componente só desenha, sem ir ao servidor.
   */
  respostasProntas?: RespostaFormulario[];
}

function IconeFormulario({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export default function RespostasDoFormulario({ leadId, variante = "hero", respostasProntas }: RespostasDoFormularioProps) {
  const [respostas, setRespostas] = useState<RespostaFormulario[]>(
    () => respostasProntas ?? ((leadId && respostasEmCache(leadId)?.respostas) || [])
  );

  useEffect(() => {
    if (respostasProntas) { setRespostas(respostasProntas); return; }
    if (!leadId) { setRespostas([]); return; }
    const guardado = respostasEmCache(leadId);
    setRespostas(guardado?.respostas ?? []);

    // `vivo` evita o clássico: o SDR pula de card antes da resposta chegar e as
    // respostas do lead anterior pintam no card errado.
    let vivo = true;
    void carregarRespostasDoFormulario(leadId).then((r) => {
      if (vivo) setRespostas(r.respostas);
    });
    return () => { vivo = false; };
  }, [leadId, respostasProntas]);

  if (!respostas.length) return null;

  if (variante === "ficha") {
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Respostas do formulário</h3>
        <p className="text-xs text-gray-500 mb-3">O que o cliente preencheu na landing page antes de virar lead.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          {respostas.map((r) => (
            <div key={r.campo} className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 m-0">{r.rotulo}</p>
              <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5 break-words">{r.valor}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variante === "coluna") {
    // Card da coluna da ficha do lead (desenho de 03/11): classes .fl-* de
    // src/components/sdr/leads/ficha/ficha.css, só tokens.
    return (
      <section className="fl-card" aria-label="Respostas do formulário">
        <div>
          <h2>Respostas do formulário</h2>
          <p className="fl-mudo" style={{ marginTop: 4 }}>O que o cliente preencheu na landing page antes de virar lead.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {respostas.map((r) => (
            <div key={r.campo} className="fl-linha"><span>{r.rotulo}</span><span>{r.valor}</span></div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div
      className="rounded-xl px-3.5 py-2.5"
      style={{ border: "1px solid rgba(18,161,138,.28)", background: "rgba(18,161,138,.05)" }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: "#0E7C6A" }}>
        <IconeFormulario />
        <span className="text-[12px] font-bold">O que o cliente respondeu no formulário</span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr" }}>
        {respostas.map((r) => (
          <div key={r.campo} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{r.rotulo}</span>
            <span className="text-[12.5px] font-bold" style={{ color: "var(--ink)" }}>{r.valor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
