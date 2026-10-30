// Marketing › E-mail › relatórios. Não é mais tela do menu: <ResumoEnvios/> vai no
// topo da aba Campanhas e <RelatorioCampanha/> dentro de cada campanha enviada.
// Abertura medida pelo pixel do QS (quem bloqueia imagem não conta; clique conta
// como abertura). Entregue, bounce e spam vêm do webhook do Resend.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pct, type Metricas } from "../lib/api";
import { Numero } from "../ui";

/** Soma de todas as campanhas (topo da aba Campanhas). Some se nada saiu ainda. */
export function ResumoEnvios({ metricas }: { metricas: Metricas[] }) {
  const t = useMemo(() => metricas.reduce((a, m) => ({
    enviados: a.enviados + m.enviados, abriram: a.abriram + m.abriram, clicaram: a.clicaram + m.clicaram,
    descadastros: a.descadastros + m.descadastros, problemas: a.problemas + m.bounces + m.spam,
  }), { enviados: 0, abriram: 0, clicaram: 0, descadastros: 0, problemas: 0 }), [metricas]);
  if (t.enviados === 0) return null;
  return (
    <section aria-label="Resumo dos envios" className="mb-5">
      <div className="text-xs font-semibold mb-2" style={{ color: "var(--ink3)" }}>Todas as campanhas até hoje</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Numero rotulo="Enviados" valor={t.enviados.toLocaleString("pt-BR")} />
        <Numero rotulo="Abriram" valor={pct(t.abriram, t.enviados)} sub={`${t.abriram.toLocaleString("pt-BR")} pessoas`} />
        <Numero rotulo="Clicaram" valor={pct(t.clicaram, t.enviados)} sub={`${t.clicaram.toLocaleString("pt-BR")} pessoas`} />
        <Numero rotulo="Descadastros" valor={pct(t.descadastros, t.enviados)} sub={String(t.descadastros)} />
        <Numero rotulo="Bounce + spam" valor={pct(t.problemas, t.enviados)} sub={String(t.problemas)} />
      </div>
    </section>
  );
}

/** Barra de quanto da fila já saiu. */
export function BarraProgresso({ feito, total }: { feito: number; total: number }) {
  const p = total > 0 ? Math.min(100, Math.round((feito / total) * 100)) : 0;
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${p}%`, background: "var(--rel)" }} />
    </div>
  );
}

/** O relatório de UMA campanha (dentro do detalhe dela). */
export function RelatorioCampanha({ campanhaId, metricas }: { campanhaId: string; metricas: Metricas | undefined }) {
  const [links, setLinks] = useState<{ url: string; cliques: number; pessoas: number }[]>([]);
  useEffect(() => {
    supabase.rpc("mkt_email_links", { p_campanha: campanhaId }).then(({ data }) => setLinks((data ?? []) as typeof links));
  }, [campanhaId]);
  const m = metricas;
  if (!m) return <p className="text-[13px] mb-4" style={{ color: "var(--ink3)" }}>Esta campanha ainda não montou a fila de envio.</p>;
  return (
    <div className="space-y-4">
      <div className="rel-card p-4">
        <div className="flex justify-between text-[13px] mb-1.5" style={{ color: "var(--ink2)" }}>
          <span><b style={{ color: "var(--ink)" }}>{m.enviados.toLocaleString("pt-BR")}</b> de {m.total.toLocaleString("pt-BR")} enviados</span>
          <span>{m.pendentes} na fila · {m.falhas} falhas</span>
        </div>
        <BarraProgresso feito={m.enviados + m.falhas} total={m.total} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Numero rotulo="Entregues" valor={pct(m.entregues, m.enviados)} sub={String(m.entregues)} />
        <Numero rotulo="Abriram" valor={pct(m.abriram, m.enviados)} sub={String(m.abriram)} />
        <Numero rotulo="Clicaram" valor={pct(m.clicaram, m.enviados)} sub={`${m.clicaram} · ${pct(m.clicaram, m.abriram)} de quem abriu`} />
        <Numero rotulo="Descadastros" valor={pct(m.descadastros, m.enviados)} sub={String(m.descadastros)} />
        <Numero rotulo="Bounce" valor={pct(m.bounces, m.enviados)} sub={String(m.bounces)} />
        <Numero rotulo="Spam" valor={pct(m.spam, m.enviados)} sub={String(m.spam)} />
      </div>
      <div className="rel-card overflow-x-auto">
        <div className="px-3 pt-3 text-xs font-semibold" style={{ color: "var(--ink3)" }}>Links mais clicados</div>
        <table className="w-full text-[13px]">
          <thead><tr className="text-left" style={{ color: "var(--ink3)" }}><th className="p-3">Link</th><th className="p-3 text-right">Cliques</th><th className="p-3 text-right">Pessoas</th></tr></thead>
          <tbody>
            {links.length === 0 ? <tr><td className="p-3" colSpan={3} style={{ color: "var(--ink3)" }}>Nenhum clique ainda.</td></tr> : links.map((l) => (
              <tr key={l.url} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="p-3 break-all">{l.url}</td><td className="p-3 text-right tabular-nums">{l.cliques}</td><td className="p-3 text-right tabular-nums">{l.pessoas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
