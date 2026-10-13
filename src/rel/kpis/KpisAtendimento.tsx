// src/rel/kpis/KpisAtendimento.tsx
// -----------------------------------------------------------------------------
// TME e TMA do WhatsApp do Relacionamento (Bruno, 13/10/2026). A conta é feita
// no banco (rel_kpi_atendimento, migration 0120):
//   TME = quanto o cliente esperou pela 1ª resposta (minutos úteis, só conversas
//         que contam no prazo).
//   TMA = duração de cada atendimento: da 1ª mensagem do cliente até a última
//         resposta nossa, numa sequência de mensagens com menos de 1 h entre elas.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { carregarAtendimento, minutos, type KpiAtendimento } from "../lib/kpis";
import { Aviso, Vazio } from "../ui";

const PERIODOS = [{ d: 7, r: "7 dias" }, { d: 30, r: "30 dias" }, { d: 90, r: "90 dias" }];

function Cartao({ rotulo, valor, dica }: { rotulo: string; valor: string; dica: string }) {
  return (
    <div className="rel-card p-4">
      <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: "var(--ink)" }}>{valor}</span>
      <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{dica}</span>
    </div>
  );
}

export default function KpisAtendimento() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<KpiAtendimento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let atual = true;
    setDados(null);
    setErro(null);
    carregarAtendimento(dias).then((d) => { if (atual) setDados(d); })
      .catch((e) => { if (atual) setErro(e instanceof Error ? e.message : "Falhou."); });
    return () => { atual = false; };
  }, [dias]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--card2)", border: "1px solid var(--line)" }} role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.d} onClick={() => setDias(p.d)} aria-pressed={dias === p.d} className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold"
              style={dias === p.d ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--ink2)" }}>
              {p.r}
            </button>
          ))}
        </div>
      </div>

      {erro ? <Aviso tom="erro">{erro}</Aviso> : !dados ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="rel-card h-24 animate-pulse" />)}</div>
      ) : dados.tme.n === 0 && dados.tma.n === 0 ? (
        <div className="rel-card"><Vazio titulo="Sem atendimentos no período" texto="Quando o WhatsApp do Relacionamento tiver conversas respondidas, o TME e o TMA aparecem aqui." /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Cartao rotulo="TME (tempo médio de espera)" valor={minutos(dados.tme.media)} dica={`mediana ${minutos(dados.tme.mediana)} · ${dados.tme.n} respostas`} />
            <Cartao rotulo="TMA (tempo médio de atendimento)" valor={minutos(dados.tma.media)} dica={`mediana ${minutos(dados.tma.mediana)} · ${dados.tma.n} atendimentos`} />
            <Cartao rotulo="Respostas medidas" valor={String(dados.tme.n)} dica="cliente esperando → resposta de uma pessoa" />
            <Cartao rotulo="Atendimentos" valor={String(dados.tma.n)} dica="sessões com mensagem do cliente e resposta nossa" />
          </div>

          <section className="rel-card p-4 space-y-2">
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--ink3)" }}>
              <b>TME</b>: quanto tempo o cliente esperou até alguém do time responder — só conta o horário de atendimento
              e só conversas que contam no prazo (grupo e "não conta no prazo" ficam fora). <b>TMA</b>: quanto durou cada
              atendimento — da primeira mensagem do cliente até a última resposta nossa, juntando mensagens com menos de
              1 hora entre elas. Histórico do celular e mensagens automáticas não entram. A <b>mediana</b> mostra o caso
              típico (não é puxada por um atendimento muito longo).
            </p>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-[13px] min-w-[480px]">
                <thead>
                  <tr className="text-[11px] text-left" style={{ color: "var(--ink2)" }}>
                    <th className="py-1 font-semibold">Atendente</th>
                    <th className="text-right font-semibold">TME</th><th className="text-right font-semibold">Respostas</th>
                    <th className="text-right font-semibold">TMA</th><th className="text-right font-semibold">Atendimentos</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.por_atendente.slice().sort((a, b) => (b.tme_n + b.tma_n) - (a.tme_n + a.tma_n)).map((a) => (
                    <tr key={a.atendente_id ?? "sem"} style={{ borderTop: "1px solid var(--line2)", color: "var(--ink)" }}>
                      <td className="py-1.5">{a.nome ?? (a.atendente_id ? "—" : "Pelo celular / sem atendente")}</td>
                      <td className="text-right tabular-nums">{minutos(a.tme_media)}</td>
                      <td className="text-right tabular-nums">{a.tme_n}</td>
                      <td className="text-right tabular-nums">{minutos(a.tma_media)}</td>
                      <td className="text-right tabular-nums">{a.tma_n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
