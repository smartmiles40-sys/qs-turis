// src/mkt/email/ui.tsx — peças das telas de e-mail. Usa os componentes do QS
// (src/rel/ui.tsx) e as cores da área (--rel = magenta dentro do Marketing), então
// o modo noturno e o foco de teclado vêm de graça.
import { useState, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Aviso as AvisoRel, Botao as BotaoRel, Campo, Entrada, Etiqueta as EtiquetaRel, Modal, Vazio } from "@/rel/ui";

export { Campo, Entrada, Modal, Vazio };

type Variante = "primario" | "secundario" | "fantasma" | "perigo";
/** Botão do QS, mas `type="button"` por padrão (não envia formulário sem querer). */
export function Botao(p: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return <BotaoRel type="button" {...p} />;
}

export const Area = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`rel-input ${p.className ?? ""}`} />;
export const Escolha = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`rel-input ${p.className ?? ""}`} />;

/** Aviso do QS com o respiro de baixo que as telas de e-mail usam. */
export function Aviso({ tom = "aviso", children }: { tom?: "aviso" | "erro" | "ok"; children: ReactNode }) {
  return <div className="mb-3" role={tom === "erro" ? "alert" : "status"}><AvisoRel tom={tom}>{children}</AvisoRel></div>;
}

export type Tom = "neutro" | "ok" | "aviso" | "erro" | "ativo";
export function Etiqueta({ children, tom = "neutro" }: { children: ReactNode; tom?: Tom }) {
  const t = tom === "ok" || tom === "ativo" ? "rel" : tom;
  return <EtiquetaRel tom={t}>{children}</EtiquetaRel>;
}

/** Linha logo abaixo das abas: explicação curta à esquerda, ações à direita. */
export function Topo({ titulo, texto, acoes }: { titulo?: ReactNode; texto?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        {titulo ? <h2 className="text-[17px] font-bold leading-tight" style={{ color: "var(--ink)" }}>{titulo}</h2> : null}
        {texto ? <p className="text-[13px] mt-0.5" style={{ color: "var(--ink3)" }}>{texto}</p> : null}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </div>
  );
}

export function Cartao({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rel-card p-4 ${className}`}>{children}</div>;
}

export function Numero({ rotulo, valor, sub }: { rotulo: string; valor: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rel-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5" style={{ color: "var(--ink)" }}>{valor}</div>
      {sub ? <div className="text-xs mt-0.5" style={{ color: "var(--ink3)" }}>{sub}</div> : null}
    </div>
  );
}

/** Bolinha numerada (ou com ✓) dos passos e das listas de "como conectar". */
export function Bolinha({ n, feito, ativo }: { n: number | string; feito?: boolean; ativo?: boolean }) {
  const st = feito
    ? { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" }
    : ativo
      ? { background: "var(--rel-soft)", color: "var(--rel-ink)", border: "1px solid var(--rel)" }
      : { background: "var(--card)", color: "var(--ink3)", border: "1px solid var(--line)" };
  return (
    <span aria-hidden className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold flex-shrink-0" style={st}>
      {feito ? "✓" : n}
    </span>
  );
}

/** Trilha dos passos do assistente (Para quem → Conteúdo → Quando → Revisar). */
export function Passos<T extends string>({ passos, atual, pendencias, onIr }: {
  passos: { id: T; rotulo: string }[];
  atual: T;
  pendencias: Partial<Record<T, string[]>>;
  onIr: (id: T) => void;
}) {
  const iAtual = passos.findIndex((p) => p.id === atual);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 mb-4" aria-label="Passos">
      {passos.map((p, i) => {
        const ativo = p.id === atual;
        const feito = i < iAtual && !(pendencias[p.id]?.length);
        return (
          <li key={p.id} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 ? <span aria-hidden className="w-6 sm:w-10 h-px" style={{ background: i <= iAtual ? "var(--rel)" : "var(--line)" }} /> : null}
            <button type="button" onClick={() => onIr(p.id)} aria-current={ativo ? "step" : undefined}
              className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 text-[13px] font-semibold"
              style={{ color: ativo ? "var(--rel-ink)" : "var(--ink2)", background: ativo ? "var(--rel-soft)" : "transparent" }}>
              <Bolinha n={i + 1} feito={feito} ativo={ativo} />
              {p.rotulo}
              {i < iAtual && pendencias[p.id]?.length ? <span aria-label="tem pendência" style={{ color: "var(--warn-ink)" }}>!</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Cartão grande de escolha (rádio visual): "Enviar agora" / "Agendar", gatilhos… */
export function OpcaoCartao({ marcado, onEscolher, titulo, texto, icone, desligado }: {
  marcado: boolean; onEscolher: () => void; titulo: string; texto?: string; icone?: ReactNode; desligado?: boolean;
}) {
  return (
    <button type="button" role="radio" aria-checked={marcado} disabled={desligado} onClick={onEscolher}
      className="text-left rounded-xl p-3.5 flex gap-3 items-start transition-colors disabled:opacity-50"
      style={{ border: `1.5px solid ${marcado ? "var(--rel)" : "var(--line)"}`, background: marcado ? "var(--rel-soft)" : "var(--card)" }}>
      {icone ? <span aria-hidden className="text-[20px] leading-none mt-0.5">{icone}</span> : null}
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold" style={{ color: marcado ? "var(--rel-ink)" : "var(--ink)" }}>{titulo}</span>
        {texto ? <span className="block text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>{texto}</span> : null}
      </span>
    </button>
  );
}

/** Ficha que liga/desliga (listas do público). */
export function Ficha({ ligada, onAlternar, children, desligado }: { ligada: boolean; onAlternar: () => void; children: ReactNode; desligado?: boolean }) {
  return (
    <button type="button" aria-pressed={ligada} disabled={desligado} onClick={onAlternar}
      className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full font-medium disabled:opacity-50"
      style={ligada
        ? { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" }
        : { background: "var(--card)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
      {ligada ? "✓ " : ""}{children}
    </button>
  );
}

/** Prévia real do e-mail (iframe sem script), com troca computador/celular. */
export function PreviaEmail({ html, altura = 560, assunto, preheader, remetente }: {
  html: string; altura?: number; assunto?: string | null; preheader?: string | null; remetente?: string | null;
}) {
  const [celular, setCelular] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Prévia do e-mail</span>
        <span className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--line)" }} role="group" aria-label="Tamanho da prévia">
          {[false, true].map((c) => (
            <button key={String(c)} type="button" aria-pressed={celular === c} onClick={() => setCelular(c)}
              className="px-2 py-0.5 rounded-md text-[12px] font-semibold"
              style={celular === c ? { background: "var(--rel)", color: "#fff" } : { color: "var(--ink2)" }}>
              {c ? "Celular" : "Computador"}
            </button>
          ))}
        </span>
      </div>
      {assunto !== undefined ? (
        <div className="rel-card px-3 py-2 mb-2 text-[12px] leading-snug">
          <div className="font-semibold truncate" style={{ color: "var(--ink)" }}>{remetente || "Remetente"}</div>
          <div className="truncate" style={{ color: "var(--ink)" }}>{assunto || <i style={{ color: "var(--ink3)" }}>sem assunto</i>}</div>
          {preheader ? <div className="truncate" style={{ color: "var(--ink3)" }}>{preheader}</div> : null}
        </div>
      ) : null}
      <div className="flex justify-center rounded-xl" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
        <iframe title="Prévia do e-mail" sandbox="" srcDoc={html}
          style={{ width: celular ? 375 : "100%", maxWidth: "100%", height: altura, border: 0, background: "#fff", borderRadius: 12 }} />
      </div>
      <p className="text-[11px] mt-1" style={{ color: "var(--ink3)" }}>As variáveis ({"{{primeiro_nome}}"}…) aparecem cruas aqui; no envio viram o nome de cada pessoa. O rodapé com descadastro entra sempre.</p>
    </div>
  );
}

/** Miniatura do e-mail pros cartões de modelo (o iframe em escala, sem clique). */
export function Miniatura({ html, altura = 170 }: { html: string; altura?: number }) {
  const escala = 0.36;
  return (
    <div aria-hidden className="relative overflow-hidden rounded-lg pointer-events-none" style={{ height: altura, background: "#F3F4F6", border: "1px solid var(--line)" }}>
      <iframe title="" tabIndex={-1} sandbox="" srcDoc={html}
        style={{ width: `${100 / escala}%`, height: altura / escala, border: 0, transform: `scale(${escala})`, transformOrigin: "0 0" }} />
    </div>
  );
}
