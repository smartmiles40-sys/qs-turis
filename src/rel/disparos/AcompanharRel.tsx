// src/rel/disparos/AcompanharRel.tsx
// -----------------------------------------------------------------------------
// ACOMPANHAR OS DISPAROS (0412, 23/11/2026) — pedido do Bruno: "mandei teste e
// não chegou; queria algo pra acompanhar os disparos".
//   1. O que está travando (env da Vercel, simulação, número, token) em cima.
//   2. Testes recentes: quem mandou, pra quem, por qual número, e o MOTIVO do erro
//      — ou o recibo (enviado → entregue → lido).
//   3. Funil por número (hoje e 7 dias): enviadas → entregues → lidas → clicaram.
//   4. Disparos em andamento (na fila, pausados com o motivo).
//   5. Últimos envios, um por linha.
// Atualiza sozinho a cada 15 s. Dados: acao 'rel_acompanhar' (api/_relDisparoOficial.js).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Aviso, Botao, Etiqueta, Vazio } from "@/rel/ui";
import { chamar, type EstadoRel, type NumeroDisparo } from "./oficialRel";

interface Funil { phone_number_id: string | null; enviados: number; entregues: number; lidos: number; clicaram: number; responderam: number; erros: number; pulados: number; na_fila: number; simulados: number }
interface Teste { id: string; criado_em: string; user_nome: string | null; origem: string; telefone: string | null; phone_number_id: string | null; modelo_nome: string | null; ok: boolean; erro: string | null; status: string | null }
interface Ativa { id: string; nome: string; status: string; phone_number_id: string | null; modelo_nome: string; ultimo_erro: string | null; agendada_para: string | null; pendentes: number | null }
interface Envio { nome: string | null; telefone: string | null; status: string; motivo: string | null; simulado: boolean; enviado_em: string; clicou_em: string | null; botao: string | null; phone_number_id: string | null; campanha: string }
interface Dados { semTabela: boolean; numeros: NumeroDisparo[]; semana: Funil[]; hoje: Funil[]; testes: Teste[]; ativas: Ativa[]; envios: Envio[] }

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const ROTULO_RECIBO: Record<string, { t: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  sent: { t: "saiu (aguardando entregar)", tom: "neutro" }, delivered: { t: "entregue", tom: "rel" }, read: { t: "lido", tom: "rel" }, failed: { t: "a Meta não entregou", tom: "erro" },
};
const ROTULO_ENVIO: Record<string, { t: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  enviado: { t: "enviado", tom: "neutro" }, entregue: { t: "entregue", tom: "rel" }, lido: { t: "lido", tom: "rel" }, respondeu: { t: "respondeu", tom: "rel" },
  erro: { t: "erro", tom: "erro" }, pulado: { t: "pulado", tom: "aviso" },
};

export default function AcompanharRel({ est }: { est: EstadoRel | null }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [periodo, setPeriodo] = useState<"hoje" | "semana">("hoje");
  const ler = useCallback(() => {
    chamar<Dados>({ acao: "rel_acompanhar" }).then((x) => { setD(x); setErro(""); }).catch((e) => setErro(e instanceof Error ? e.message : "Não carregou."));
  }, []);
  useEffect(() => { ler(); const t = setInterval(ler, 15_000); return () => clearInterval(t); }, [ler]);

  const nomeDo = (ph: string | null) => {
    const n = (d?.numeros ?? est?.numeros ?? []).find((x) => x.phone_number_id === ph);
    return n ? n.rotulo : ph ? `número …${ph.slice(-4)}` : "Relacionamento";
  };
  const funil = (periodo === "hoje" ? d?.hoje : d?.semana) ?? [];

  return (
    <div className="space-y-5">
      {est && !est.real && (
        <Aviso tom={est.envLigado ? "aviso" : "erro"}>
          <b>Por que pode não estar chegando:</b>
          <ul className="mt-1 list-disc pl-5">
            {!est.envLigado && <li><b>Teste e envio real travados:</b> falta a variável <code>REL_DISPARO_ENVIO=1</code> na Vercel (projeto qs-turis → Settings → Environment Variables), e depois um novo deploy.</li>}
            {est.simulacao && <li><b>Modo simulação ligado:</b> os disparos andam na fila, mas nada sai (o teste não depende disso).</li>}
            {est.faltam.filter((f) => !/REL_DISPARO_ENVIO|simula/i.test(f)).map((f) => <li key={f}>{f}</li>)}
          </ul>
        </Aviso>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {d?.semTabela && <Aviso>O registro dos testes ainda não foi ligado no banco (migração 0412). O resto da tela funciona.</Aviso>}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-[15px] font-bold" style={{ color: "var(--ink)" }}>Testes recentes</h2>
          <Botao variante="fantasma" onClick={ler}>Atualizar</Botao>
        </div>
        {!d ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
          : !d.testes.length ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum teste registrado ainda. Os próximos “Mandar teste” aparecem aqui, com o motivo quando falhar.</p>
          : (
            <ul className="divide-y rounded-xl border" style={{ borderColor: "var(--line)" }}>
              {d.testes.map((t) => {
                const rec = t.status ? ROTULO_RECIBO[t.status] : null;
                return (
                  <li key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3 text-[13px]" style={{ borderColor: "var(--line)" }}>
                    <span className="w-[92px] shrink-0 tabular-nums" style={{ color: "var(--ink3)" }}>{hora(t.criado_em)}</span>
                    <span className="min-w-0 flex-1" style={{ color: "var(--ink)" }}>
                      <b>{t.origem === "fluxo" ? "Fluxo" : t.modelo_nome || "Disparo"}</b> pra {t.telefone ?? "?"} · por {nomeDo(t.phone_number_id)}
                      <span style={{ color: "var(--ink3)" }}>{t.user_nome ? ` · ${t.user_nome.split(" ")[0]}` : ""}</span>
                      {t.erro && <span className="mt-0.5 block" style={{ color: "var(--err-ink)" }}>{t.erro}</span>}
                    </span>
                    {t.ok ? <Etiqueta tom={rec?.tom ?? "neutro"}>{rec?.t ?? "saiu"}</Etiqueta> : <Etiqueta tom="erro">não saiu</Etiqueta>}
                  </li>
                );
              })}
            </ul>
          )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-[15px] font-bold" style={{ color: "var(--ink)" }}>Funil por número</h2>
          <select className="rel-input w-auto" value={periodo} onChange={(e) => setPeriodo(e.target.value as "hoje" | "semana")}>
            <option value="hoje">Hoje</option><option value="semana">Últimos 7 dias</option>
          </select>
        </div>
        {d && !funil.length ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum disparo {periodo === "hoje" ? "hoje" : "nos últimos 7 dias"}.</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {funil.map((f) => (
              <div key={f.phone_number_id ?? "rel"} className="rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
                <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{nomeDo(f.phone_number_id)}</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[["Enviadas", f.enviados, null], ["Entregues", f.entregues, pct(f.entregues, f.enviados)], ["Lidas", f.lidos, pct(f.lidos, f.entregues)], ["Clicaram", f.clicaram, pct(f.clicaram, f.entregues)]].map(([r, v, p]) => (
                    <div key={String(r)} className="rounded-lg p-2" style={{ background: "var(--card2)" }}>
                      <p className="text-[18px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{v}</p>
                      <p className="text-[11px]" style={{ color: "var(--ink3)" }}>{r}{p ? ` · ${p}` : ""}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[12px]" style={{ color: "var(--ink3)" }}>
                  {f.responderam} responderam · {f.na_fila} na fila · {f.erros} com erro · {f.pulados} pulados{f.simulados ? ` · ${f.simulados} simulados (não saíram)` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Em andamento</h2>
        {d && !d.ativas.length ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum disparo enviando, agendado ou pausado.</p> : (
          <ul className="space-y-2">
            {(d?.ativas ?? []).map((c) => (
              <li key={c.id} className="rounded-xl border p-3 text-[13px]" style={{ borderColor: "var(--line)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <b style={{ color: "var(--ink)" }}>{c.nome}</b>
                  <Etiqueta tom={c.status === "pausada" ? "erro" : c.status === "agendada" ? "neutro" : "rel"}>{c.status === "enviando" ? "enviando" : c.status === "agendada" ? `agendado ${hora(c.agendada_para)}` : "pausado"}</Etiqueta>
                  <span className="ml-auto" style={{ color: "var(--ink3)" }}>{nomeDo(c.phone_number_id)} · {c.pendentes ?? "?"} na fila</span>
                </div>
                {c.ultimo_erro && <p className="mt-1" style={{ color: c.status === "pausada" ? "var(--err-ink)" : "var(--warn-ink)" }}>{c.ultimo_erro}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Últimos envios</h2>
        {d && !d.envios.length ? <Vazio titulo="Nenhum envio ainda" texto="Quando um disparo rodar, cada mensagem aparece aqui com o que aconteceu com ela." /> : (
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--line)" }}>
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead style={{ background: "var(--card2)", color: "var(--ink3)" }}>
                <tr><th className="p-2">Quando</th><th className="p-2">Cliente</th><th className="p-2">Disparo</th><th className="p-2">Número</th><th className="p-2">Situação</th></tr>
              </thead>
              <tbody>
                {(d?.envios ?? []).map((e, i) => {
                  const r = ROTULO_ENVIO[e.status] ?? { t: e.status, tom: "neutro" as const };
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
                      <td className="p-2 tabular-nums" style={{ color: "var(--ink3)" }}>{hora(e.enviado_em)}</td>
                      <td className="p-2">{e.nome ?? "—"} <span style={{ color: "var(--ink3)" }}>{e.telefone}</span></td>
                      <td className="p-2">{e.campanha}</td>
                      <td className="p-2" style={{ color: "var(--ink3)" }}>{nomeDo(e.phone_number_id)}</td>
                      <td className="p-2">
                        <Etiqueta tom={r.tom}>{e.simulado ? "simulado" : r.t}</Etiqueta>
                        {e.clicou_em && <span className="ml-1" style={{ color: "var(--rel-ink)" }}>tocou em “{e.botao}”</span>}
                        {e.motivo && e.status !== "enviado" && <span className="block" style={{ color: "var(--ink3)" }}>{e.motivo}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
