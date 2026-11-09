// src/mkt/disparos/PreviaWhatsApp.tsx
// -----------------------------------------------------------------------------
// A "prévia no WhatsApp" que fica ao lado de quem está montando um disparo ou
// uma automação (no SendFlow era o WhatsAppPreview). Só desenho: atualiza ao
// vivo com o que está sendo digitado. As cores aqui são as do próprio WhatsApp
// (fundo bege, balão verde-claro) pra parecer o celular de quem recebe — o
// resto da tela segue o magenta do Marketing.
// -----------------------------------------------------------------------------
import type { ReactNode } from "react";

export interface BalaoPrevia {
  /** Cabeçalho em negrito (modelo da Meta). */
  titulo?: string | null;
  texto: string;
  rodape?: string | null;
  /** Botões de resposta / link, em linhas embaixo do balão. */
  botoes?: string[];
  /** Mensagem que a PESSOA mandou (fica à esquerda, branca). */
  daPessoa?: boolean;
  /** Mídia no topo do modelo (0341): IMAGE mostra a foto; VIDEO/DOCUMENT, um quadro. */
  midia?: { tipo: string; link?: string };
}

/** {{primeiro_nome}} → "Ana" e {{1}} → "[1]", pra prévia ler como gente. */
export function textoDeExemplo(t: string): string {
  return t
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, "Ana")
    .replace(/\{\{\s*nome\s*\}\}/gi, "Ana Souza")
    .replace(/\{\{\s*usuario\s*\}\}/gi, "@ana.viaja")
    .replace(/\{\{\s*(\d+)\s*\}\}/g, "[$1]");
}

/** *negrito* e _itálico_ do WhatsApp, sem HTML cru. */
function formatar(t: string): ReactNode[] {
  return t.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <b key={i}>{p.slice(1, -1)}</b>;
    if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>;
    return <span key={i}>{p}</span>;
  });
}

export default function PreviaWhatsApp({ baloes, contato = "Se Tu For, Eu Vou!", rotulo = "Prévia no WhatsApp", vazio = "A mensagem aparece aqui enquanto você escreve." }: {
  baloes: BalaoPrevia[];
  contato?: string;
  rotulo?: string;
  vazio?: string;
}) {
  return (
    <figure aria-label={rotulo} className="m-0">
      <figcaption className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink3)" }}>{rotulo}</figcaption>
      <div className="overflow-hidden rounded-[20px] border shadow-sm" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ background: "#075E54", color: "#fff" }}>
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: "rgba(255,255,255,.2)" }}>ST</span>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{contato}</div>
            <div className="text-[11px] opacity-80">conta comercial</div>
          </div>
        </div>
        <div className="flex min-h-[260px] flex-col gap-2 px-3 py-4" style={{ background: "#EFE7DD" }}>
          {!baloes.some((b) => b.texto.trim()) ? (
            <p className="m-auto max-w-[220px] text-center text-[12px]" style={{ color: "#667781" }}>{vazio}</p>
          ) : baloes.map((b, i) => (
            <div key={i} className={`flex flex-col ${b.daPessoa ? "items-start" : "items-end"}`}>
              <div className="max-w-[88%] rounded-lg px-2.5 pb-1.5 pt-1.5 text-[13.5px] leading-[1.4] shadow-[0_1px_1px_rgba(0,0,0,.12)]"
                style={{ background: b.daPessoa ? "#FFFFFF" : "#D9FDD3", color: "#111B21" }}>
                {b.midia && (b.midia.tipo === "IMAGE" && b.midia.link
                  ? <img src={b.midia.link} alt="" className="mb-1 max-h-[160px] w-full rounded-md object-cover" />
                  : <div className="mb-1 flex h-[90px] items-center justify-center rounded-md text-[12px]" style={{ background: "#CFE9C9", color: "#4B5E52" }}>
                      {b.midia.tipo === "VIDEO" ? "vídeo no topo" : b.midia.tipo === "DOCUMENT" ? "documento no topo" : "imagem no topo"}{b.midia.link ? "" : " (cole o link)"}
                    </div>)}
                {b.titulo && <p className="mb-0.5 font-semibold">{textoDeExemplo(b.titulo)}</p>}
                <p className="whitespace-pre-wrap break-words">{formatar(textoDeExemplo(b.texto))}</p>
                {b.rodape && <p className="mt-1 text-[11.5px]" style={{ color: "#667781" }}>{b.rodape}</p>}
                <p className="mt-0.5 text-right text-[10.5px]" style={{ color: "#667781" }}>10:42</p>
              </div>
              {!!b.botoes?.length && (
                <div className="mt-1 flex w-[88%] max-w-[88%] flex-col gap-1">
                  {b.botoes.map((x, j) => (
                    <span key={j} className="rounded-lg py-1.5 text-center text-[13px] font-medium shadow-[0_1px_1px_rgba(0,0,0,.1)]" style={{ background: b.daPessoa ? "#FFFFFF" : "#F7FFF5", color: "#027EB5" }}>{x}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
