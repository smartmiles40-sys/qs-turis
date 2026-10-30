// Marketing › E-mail › Relatórios: por campanha — enviados, entregues, aberturas,
// cliques, descadastros, bounce e spam + links mais clicados.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dataHora, lerMetricas, listarCampanhas, pct, STATUS_ROTULO, type Campanha, type Metricas } from "../lib/api";
import { Escolha, Numero, Tela, Vazio } from "../ui";

export default function Relatorios() {
  const [camps, setCamps] = useState<Campanha[] | null>(null);
  const [met, setMet] = useState<Metricas[]>([]);
  const [sel, setSel] = useState<string>("");
  const [links, setLinks] = useState<{ url: string; cliques: number; pessoas: number }[]>([]);

  useEffect(() => {
    Promise.all([listarCampanhas(), lerMetricas()]).then(([c, m]) => {
      const enviadas = c.filter((x) => x.status !== "rascunho");
      setCamps(enviadas); setMet(m);
      if (enviadas[0]) setSel(enviadas[0].id);
    });
  }, []);
  useEffect(() => {
    if (!sel) return;
    supabase.rpc("mkt_email_links", { p_campanha: sel }).then(({ data }) => setLinks((data ?? []) as typeof links));
  }, [sel]);

  const totais = useMemo(() => met.reduce((a, m) => ({
    enviados: a.enviados + m.enviados, abriram: a.abriram + m.abriram, clicaram: a.clicaram + m.clicaram,
    descadastros: a.descadastros + m.descadastros, bounces: a.bounces + m.bounces, spam: a.spam + m.spam,
  }), { enviados: 0, abriram: 0, clicaram: 0, descadastros: 0, bounces: 0, spam: 0 }), [met]);

  const m = met.find((x) => x.campanha_id === sel);
  const c = camps?.find((x) => x.id === sel);

  return (
    <Tela titulo="Relatórios de e-mail" sub="Abertura medida pelo pixel do QS (clientes que bloqueiam imagem não contam; clique conta como abertura). Entregue, bounce e spam vêm do webhook do Resend.">
      {camps === null ? <p className="text-sm">Carregando…</p> : camps.length === 0 ? <Vazio texto="Nenhuma campanha enviada ainda." /> : (
        <>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--ink2)" }}>Todas as campanhas</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <Numero rotulo="Enviados" valor={totais.enviados.toLocaleString("pt-BR")} />
            <Numero rotulo="Abertura" valor={pct(totais.abriram, totais.enviados)} sub={`${totais.abriram} pessoas`} />
            <Numero rotulo="Clique" valor={pct(totais.clicaram, totais.enviados)} sub={`${totais.clicaram} pessoas`} />
            <Numero rotulo="Descadastro" valor={pct(totais.descadastros, totais.enviados)} sub={String(totais.descadastros)} />
            <Numero rotulo="Bounce" valor={pct(totais.bounces, totais.enviados)} sub={String(totais.bounces)} />
            <Numero rotulo="Spam" valor={pct(totais.spam, totais.enviados)} sub={String(totais.spam)} />
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="w-80"><Escolha value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Campanha">
              {camps.map((x) => <option key={x.id} value={x.id}>{x.nome} — {STATUS_ROTULO[x.status]}</option>)}
            </Escolha></div>
            {c ? <span className="text-xs" style={{ color: "var(--ink2)" }}>Início {dataHora(c.iniciada_em)} · fim {dataHora(c.concluida_em)}</span> : null}
          </div>
          {m ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <Numero rotulo="Na fila" valor={m.total} sub={`${m.pendentes} pendentes · ${m.falhas} falhas`} />
              <Numero rotulo="Enviados" valor={m.enviados} />
              <Numero rotulo="Entregues" valor={pct(m.entregues, m.enviados)} sub={String(m.entregues)} />
              <Numero rotulo="Abriram" valor={pct(m.abriram, m.enviados)} sub={String(m.abriram)} />
              <Numero rotulo="Clicaram" valor={pct(m.clicaram, m.enviados)} sub={`${m.clicaram} · ${pct(m.clicaram, m.abriram)} de quem abriu`} />
              <Numero rotulo="Descadastros" valor={pct(m.descadastros, m.enviados)} sub={String(m.descadastros)} />
              <Numero rotulo="Bounce" valor={pct(m.bounces, m.enviados)} sub={String(m.bounces)} />
              <Numero rotulo="Spam" valor={pct(m.spam, m.enviados)} sub={String(m.spam)} />
            </div>
          ) : <p className="text-sm mb-6" style={{ color: "var(--ink2)" }}>Esta campanha ainda não montou a fila.</p>}
          <div className="mke-card overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: "var(--ink2)" }}><th className="p-3">Link</th><th className="p-3 text-right">Cliques</th><th className="p-3 text-right">Pessoas</th></tr></thead>
              <tbody>
                {links.length === 0 ? <tr><td className="p-3" colSpan={3} style={{ color: "var(--ink2)" }}>Nenhum clique ainda.</td></tr> : links.map((l) => (
                  <tr key={l.url} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="p-3 break-all">{l.url}</td><td className="p-3 text-right tabular-nums">{l.cliques}</td><td className="p-3 text-right tabular-nums">{l.pessoas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Tela>
  );
}
