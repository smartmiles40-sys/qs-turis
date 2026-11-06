// src/components/sdr/desempenho/OperacaoSdr.tsx
// -----------------------------------------------------------------------------
// Página 3 · Operação (spec 06/11, Fase 5): ligações (qs_call_logs via 0323),
// faixas de velocidade do 1º contato (mesma coorte do qs_desempenho), entrada
// de leads por dia, mapa de calor de atendimento e ligações gravadas recentes.
// Usa os tokens da DesempenhoSdr (.dsp).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import {
  duracaoTxt, fetchGravacoesRecentes, fetchOperacao, horasTxt, pctTxt, taxa,
  type GravacaoRecente, type Operacao,
} from "@/lib/qs/desempenho";
import { baixarGravacao, linkDaGravacao } from "@/lib/gravacaoLigacao";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const HORAS = Array.from({ length: 13 }, (_, i) => 8 + i);
const n = (v: number) => v.toLocaleString("pt-BR");

export default function OperacaoSdr({ de, ate, sdrId, velocidade, gestor }: {
  de: string; ate: string; sdrId: string | null; gestor: boolean;
  velocidade: { faixa: string; ordem: number; leads: number; marcou: number }[];
}) {
  const [op, setOp] = useState<Operacao | null>(null);
  const [grav, setGrav] = useState<GravacaoRecente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [tocando, setTocando] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    fetchOperacao(de, ate, sdrId).then((o) => vivo && setOp(o)).catch((e) => vivo && setErro(e?.message ?? "Erro ao carregar."));
    fetchGravacoesRecentes(de, ate, sdrId).then((g) => vivo && setGrav(g));
    return () => { vivo = false; };
  }, [de, ate, sdrId]);

  if (erro) return <div className="dsp-card p-5 text-sm" style={{ color: "var(--warn)" }}>{erro}</div>;
  if (!op) return <div className="dsp-card p-10 text-center text-sm dsp-mut">Carregando…</div>;

  const L = op.time.ligacoes, C = op.time.conversa;
  const maxEnt = Math.max(...op.entrada_dia.map((d) => d.leads), 1);
  const heat = new Map(op.heatmap.map((h) => [`${h.dow}-${h.hora}`, h]));
  const maxVel = Math.max(...velocidade.map((v) => v.leads), 1);

  return (
    <>
      <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Ind rotulo="Ligações" valor={n(L.ligacoes)} sub={`${n(L.leads_ligados)} leads diferentes`} />
        <Ind rotulo="Atendidas" valor={pctTxt(taxa(L.atendidas, L.ligacoes))} sub={`${n(L.atendidas)} de ${n(L.ligacoes)}`} />
        <Ind rotulo="Tempo médio quando atende" valor={duracaoTxt(L.media_atendida_seg)} />
        <Ind rotulo="Total em conversa" valor={duracaoTxt(L.total_conversa_seg)} />
        <Ind rotulo="Tentativas até a 1ª conversa" valor={C.tentativas_ate_conversa === null ? "—" : String(C.tentativas_ate_conversa).replace(".", ",")}
          sub={`${n(C.com_conversa)} de ${n(C.leads_coorte)} leads novos conversaram`} />
        <Ind rotulo="Entrada → 1ª conversa" valor={horasTxt(C.horas_ate_conversa)} sub="mediana em horas úteis" />
      </section>

      {gestor && !sdrId && op.sdrs.length > 0 && (
        <section className="dsp-card flex flex-col gap-4 p-6">
          <h2 className="m-0 text-[18px] font-semibold">Ligações por SDR</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[14px]">
              <thead><tr><th>SDR</th><th>Ligações</th><th>Atendidas</th><th>% atend.</th><th>Média atendida</th><th>Em conversa</th><th>Tentativas até conversar</th><th>Até a 1ª conversa</th></tr></thead>
              <tbody>
                {op.sdrs.map((s) => (
                  <tr key={s.sdr_id}>
                    <td className="font-semibold">{s.nome}</td>
                    <td>{n(s.ligacoes.ligacoes)}</td><td>{n(s.ligacoes.atendidas)}</td>
                    <td>{pctTxt(taxa(s.ligacoes.atendidas, s.ligacoes.ligacoes))}</td>
                    <td>{duracaoTxt(s.ligacoes.media_atendida_seg)}</td><td>{duracaoTxt(s.ligacoes.total_conversa_seg)}</td>
                    <td>{s.conversa.tentativas_ate_conversa === null ? "—" : String(s.conversa.tentativas_ate_conversa).replace(".", ",")}</td>
                    <td>{horasTxt(s.conversa.horas_ate_conversa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))" }}>
        <section className="dsp-card flex flex-col gap-4 p-6">
          <div><h2 className="m-0 text-[18px] font-semibold">Velocidade do 1º contato</h2><div className="mt-1 text-[13px] dsp-mut">leads novos por faixa de tempo e % que virou reunião</div></div>
          {velocidade.map((v) => (
            <div key={v.faixa} className="grid items-center gap-3" style={{ gridTemplateColumns: "110px minmax(0,1fr) 110px" }}>
              <span className="text-[14px] font-medium">{v.faixa}</span>
              <div className="overflow-hidden" style={{ height: 14, borderRadius: 999, background: "var(--track)" }}>
                <div style={{ width: `${(v.leads / maxVel) * 100}%`, height: "100%", borderRadius: 999, background: v.ordem >= 4 ? "var(--warn)" : "var(--ink)" }} />
              </div>
              <span className="text-right text-[13px]"><strong>{n(v.leads)}</strong> <span className="dsp-mut">· {pctTxt(taxa(v.marcou, v.leads))} reunião</span></span>
            </div>
          ))}
        </section>

        <section className="dsp-card flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div><h2 className="m-0 text-[18px] font-semibold">Entrada de leads por dia</h2><div className="mt-1 text-[13px] dsp-mut">fim de semana em azul</div></div>
            <div className="text-[13px] dsp-mut">{n(op.entrada_dia.reduce((a, d) => a + d.leads, 0))} no período</div>
          </div>
          <div className="flex items-end gap-1 overflow-x-auto" style={{ height: 160 }}>
            {op.entrada_dia.map((d) => (
              <div key={d.dia} className="flex min-w-[14px] flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}
                title={`${new Date(`${d.dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}: ${d.leads} leads`}>
                <span className="text-[10px] dsp-mut">{d.leads || ""}</span>
                <div style={{ width: "100%", height: `${(d.leads / maxEnt) * 120}px`, minHeight: d.leads ? 2 : 0, borderRadius: 4, background: d.dow >= 6 ? "var(--accent)" : "var(--ink)" }} />
                <span className="text-[10px] dsp-mut">{d.dia.slice(8)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="dsp-card flex flex-col gap-4 p-6">
        <div><h2 className="m-0 text-[18px] font-semibold">Mapa de calor de atendimento</h2><div className="mt-1 text-[13px] dsp-mut">% de ligações atendidas por dia da semana e hora · mais escuro = atende mais</div></div>
        <div className="overflow-x-auto">
          <table className="border-collapse text-[12px]" style={{ minWidth: 640 }}>
            <thead><tr><th style={{ padding: 4 }} />{HORAS.map((h) => <th key={h} style={{ padding: 4, textAlign: "center" }}>{h}h</th>)}</tr></thead>
            <tbody>
              {DIAS.map((dia, i) => (
                <tr key={dia}>
                  <td style={{ padding: "4px 8px 4px 0", border: 0 }} className="font-semibold">{dia}</td>
                  {HORAS.map((h) => {
                    const c = heat.get(`${i + 1}-${h}`);
                    const t = c ? taxa(c.atendidas, c.ligacoes) : null;
                    return (
                      <td key={h} style={{ padding: 2, border: 0 }}>
                        <div title={c ? `${dia} ${h}h: ${c.atendidas}/${c.ligacoes} atendidas` : `${dia} ${h}h: sem ligações`}
                          className="flex items-center justify-center rounded"
                          style={{ width: 40, height: 30, background: c ? `color-mix(in srgb, var(--ink) ${Math.round(15 + (t ?? 0) * 85)}%, var(--card))` : "var(--card2)",
                                   color: c && (t ?? 0) > 0.45 ? "var(--bg)" : "var(--muted)" }}>
                          {c ? pctTxt(t) : ""}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dsp-card flex flex-col gap-4 p-6">
        <h2 className="m-0 text-[18px] font-semibold">Ligações gravadas recentes</h2>
        {grav.length === 0 && <p className="text-[13px] dsp-mut">Nenhuma ligação gravada no período.</p>}
        <div className="flex flex-col">
          {grav.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]" style={{ borderTop: "1px solid var(--border)" }}>
              <span className="w-[110px] dsp-mut">{new Date(g.inicio).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="min-w-[140px] flex-1 font-medium">{g.lead?.full_name ?? g.telefone ?? "—"}</span>
              <span className="w-[120px] dsp-mut">{g.sdr?.name ?? ""}</span>
              <span className="w-[60px] tabular-nums">{duracaoTxt(g.duracao_seg)}</span>
              {tocando?.id === g.id
                ? <audio src={tocando.url} controls autoPlay className="h-8" />
                : <button type="button" className="dsp-chip" style={{ minHeight: 32 }} onClick={async () => { const url = await linkDaGravacao(g.storage_path); if (url) setTocando({ id: g.id, url }); }}>Ouvir</button>}
              <button type="button" className="dsp-chip" style={{ minHeight: 32 }} onClick={() => void baixarGravacao(g)}>Baixar</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Ind({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="dsp-card flex min-w-0 flex-col gap-2 p-5">
      <div className="dsp-lbl">{rotulo}</div>
      <div className="text-[30px] font-bold leading-none tracking-tight">{valor}</div>
      {sub && <div className="text-[13px] dsp-mut">{sub}</div>}
    </div>
  );
}
