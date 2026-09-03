// src/components/sdr/carteira/SaudeCarteira.tsx
// -----------------------------------------------------------------------------
// O BLOCO "SAÚDE DA CARTEIRA" — um card por SDR.
//
// A nota (0–100) mede UMA coisa: a velocidade com que o SDR conclui a PRIMEIRA
// atividade de cada lead novo. Não é índice composto, e isso é decisão, não
// simplificação — ver src/lib/qs/carteiraSaude.ts.
//
// As outras quatro métricas ficam AO LADO da nota, nunca dentro dela. Se
// volume, atraso e cadência entrassem na conta, um SDR rápido e um SDR
// produtivo empatariam em 78 e ninguém saberia qual dos dois consertar.
//
// O gestor vê um card por pessoa (a RLS já devolve o time inteiro pra ele); o
// SDR vê só o dele, pelo mesmo motivo e sem filtro de tela.
// -----------------------------------------------------------------------------

import { faixaDaNota, horasHumanas, type SaudeSdr, type PontoSerie } from "@/lib/qs/carteiraSaude";

/** A barra da nota. Número grande porque é o que a pessoa vem ler. */
function Medidor({ nota }: { nota: number | null }) {
  const faixa = faixaDaNota(nota);
  const pct = nota === null ? 0 : Math.max(0, Math.min(100, nota));
  return (
    <div className="flex items-end gap-3">
      <div className="shrink-0">
        <div className="flex items-baseline gap-1">
          <span className="text-[34px] font-extrabold leading-none" style={{ color: faixa.cor, fontVariantNumeric: "tabular-nums" }}>
            {nota === null ? "—" : Math.round(nota)}
          </span>
          {nota !== null && <span className="text-[15px] font-bold" style={{ color: faixa.cor }}>%</span>}
        </div>
        <span
          className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ background: faixa.fundo, color: faixa.cor }}
        >
          {faixa.rotulo}
        </span>
      </div>
      <div className="flex-1 min-w-0 pb-1.5">
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(100,116,139,.14)" }}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: faixa.cor }} />
        </div>
      </div>
    </div>
  );
}

/**
 * A linha dos últimos 14 dias. Um número sozinho diz onde a pessoa está; a
 * linha diz pra onde ela vai — que é a informação que muda o que o gestor faz.
 *
 * Dias sem lead nenhum não viram zero: viram buraco. Zerar seria dizer que o
 * SDR foi péssimo num sábado em que não entrou lead.
 */
function Linha14Dias({ pontos }: { pontos: PontoSerie[] }) {
  const validos = pontos.filter((p) => p.nota !== null);
  if (validos.length < 2) return null;

  const W = 128, H = 30;
  const passo = validos.length > 1 ? W / (validos.length - 1) : W;
  const y = (n: number) => H - 2 - (Math.max(0, Math.min(100, n)) / 100) * (H - 4);
  const d = validos.map((p, i) => `${i === 0 ? "M" : "L"}${(i * passo).toFixed(1)},${y(p.nota!).toFixed(1)}`).join(" ");

  const primeiro = validos[0].nota!;
  const ultimo = validos[validos.length - 1].nota!;
  const delta = Math.round(ultimo - primeiro);
  const cor = delta > 2 ? "#0E7C6A" : delta < -2 ? "#DC2626" : "#64748B";

  return (
    <div className="flex items-center gap-2">
      <svg width={W} height={H} className="shrink-0 overflow-visible" aria-hidden>
        <path d={d} fill="none" stroke={cor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={(validos.length - 1) * passo} cy={y(ultimo)} r="2.6" fill={cor} />
      </svg>
      <span className="text-[11px] font-semibold shrink-0" style={{ color: cor }}>
        {delta > 0 ? `+${delta}` : delta} <span className="font-normal text-gray-400">em 14 dias</span>
      </span>
    </div>
  );
}

function Metrica({ rotulo, valor, detalhe, alerta }: {
  rotulo: string; valor: string; detalhe?: string; alerta?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">{rotulo}</p>
      <p className={`text-[16px] font-extrabold leading-tight ${alerta ? "text-amber-700" : "text-gray-900"}`}
         style={{ fontVariantNumeric: "tabular-nums" }}>
        {valor}
      </p>
      {detalhe && <p className="text-[11px] text-gray-500 leading-tight truncate">{detalhe}</p>}
    </div>
  );
}

interface Props {
  linhas: SaudeSdr[];
  serie: Map<string, PontoSerie[]>;
  /** Meta de atividades do dia, por SDR (qs_goals). */
  metaDia: number | null;
  /** Clicar em "leads esquecidos" filtra a lista abaixo. */
  onVerEsquecidos?: (ownerId: string) => void;
}

export default function SaudeCarteira({ linhas, serie, metaDia, onVerEsquecidos }: Props) {
  if (linhas.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-bold text-gray-900">Saúde da carteira</h2>
        <p className="text-[11px] text-gray-500">
          Velocidade da 1ª atividade · 30 dias · horas de expediente
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {linhas.map((l) => {
          const pontos = serie.get(l.owner_id) ?? [];
          const metaTxt = metaDia ? `${l.concluidas_hoje}/${metaDia}` : String(l.concluidas_hoje);
          const pctMeta = metaDia ? Math.round((l.concluidas_hoje / metaDia) * 100) : null;
          const noPrazo = l.atividades_abertas > 0
            ? Math.round(((l.atividades_abertas - l.atividades_atrasadas) / l.atividades_abertas) * 100)
            : null;

          return (
            <article key={l.owner_id} className="rounded-2xl border bg-white p-4"
                     style={{ borderColor: "var(--line, #E8EBF0)" }}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-[13.5px] font-bold text-gray-900 truncate">{l.nome ?? "Sem nome"}</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 shrink-0">{l.papel}</span>
              </div>

              <Medidor nota={l.nota} />

              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11.5px] text-gray-500">
                  {l.horas_mediana !== null
                    ? <>Metade dos leads em <b className="text-gray-700">{horasHumanas(l.horas_mediana)}</b></>
                    : "Sem lead medido na janela"}
                </p>
                <Linha14Dias pontos={pontos} />
              </div>

              <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3" style={{ borderColor: "var(--line, #E8EBF0)" }}>
                <Metrica
                  rotulo="Sendo trabalhados"
                  valor={String(l.leads_trabalhando)}
                  detalhe={`de ${l.leads_ativos} ativos`}
                />
                {/* O buraco que não aparecia em lugar nenhum do QS: lead vivo,
                    sem atividade aberta, que a fila do dia nunca aponta. */}
                <button
                  type="button"
                  onClick={() => onVerEsquecidos?.(l.owner_id)}
                  disabled={l.leads_esquecidos === 0}
                  className="text-left min-w-0 disabled:cursor-default group"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">Parados sem atividade</p>
                  <p className={`text-[16px] font-extrabold leading-tight ${l.leads_esquecidos > 0 ? "text-amber-700 group-hover:underline" : "text-gray-900"}`}
                     style={{ fontVariantNumeric: "tabular-nums" }}>
                    {l.leads_esquecidos}
                  </p>
                  <p className="text-[11px] text-gray-500 leading-tight truncate">
                    {l.leads_esquecidos > 0 ? "ver na lista" : "nenhum esquecido"}
                  </p>
                </button>
                <Metrica
                  rotulo="Atividades no prazo"
                  valor={noPrazo === null ? "—" : `${noPrazo}%`}
                  detalhe={l.atividades_atrasadas > 0 ? `${l.atividades_atrasadas} atrasada(s)` : `${l.atividades_abertas} abertas`}
                  alerta={noPrazo !== null && noPrazo < 90}
                />
                <Metrica
                  rotulo="Concluídas hoje"
                  valor={metaTxt}
                  detalhe={pctMeta !== null ? `${pctMeta}% da meta` : "sem meta cadastrada"}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
