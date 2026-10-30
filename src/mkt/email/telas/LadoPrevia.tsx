// A coluna da direita dos editores de e-mail (como no SendFlow): a prévia real e,
// embaixo, "Mande um teste para você". E-mail enviado não volta: o teste vem antes.
import { useState } from "react";
import { useEmail } from "../contexto";
import { Botao, Entrada, PreviaEmail } from "../ui";

export function LadoPrevia({ html, assunto, preheader, remetente, onTeste }: {
  html: string; assunto?: string | null; preheader?: string | null; remetente?: string | null;
  /** Salva e manda o teste; devolve a mensagem de erro (ou null se foi). */
  onTeste?: (para: string) => Promise<string | null>;
}) {
  const { conectado } = useEmail();
  const [para, setPara] = useState("");
  const [res, setRes] = useState<{ ok: boolean; texto: string } | null>(null);
  const [indo, setIndo] = useState(false);
  const testar = async () => {
    if (!onTeste) return;
    setIndo(true); setRes(null);
    const erro = await onTeste(para.trim());
    setRes(erro ? { ok: false, texto: erro } : { ok: true, texto: `Teste enviado para ${para.trim()}. Abertura e clique do teste não contam no relatório.` });
    setIndo(false);
  };
  return (
    <aside className="lg:sticky lg:top-4 self-start space-y-3">
      <PreviaEmail html={html} assunto={assunto ?? null} preheader={preheader} remetente={remetente} altura={520} />
      {onTeste ? (
        <div className="rel-card p-3">
          <div className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--ink)" }}>Mande um teste para você</div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (para.trim()) void testar(); }}>
            <Entrada type="email" placeholder="voce@agencia.com" value={para} onChange={(e) => setPara(e.target.value)} aria-label="E-mail para o teste" />
            <Botao type="submit" disabled={!conectado || indo || !para.trim()}>{indo ? "Enviando…" : "Enviar"}</Botao>
          </form>
          {!conectado ? <p className="text-[11px] mt-1.5" style={{ color: "var(--ink3)" }}>O teste libera quando o e-mail estiver conectado (selo lá em cima).</p> : null}
          {res ? <p className="text-[12px] mt-1.5" role="status" style={{ color: res.ok ? "var(--rel-ink)" : "var(--err-ink)" }}>{res.texto}</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
