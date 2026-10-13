// src/rel/clientes/CarimboViagem.tsx
// -----------------------------------------------------------------------------
// Um "carimbo" do passaporte do cliente: cada viagem vira um cartão com o selo
// de entrada à esquerda. O SELO TEM A FORMA DO TIPO (regra do sistema):
//   Expedição = carimbo redondo · Pacote = carimbo em losango.
// Viagem que já aconteceu = carimbo "batido" (tinta cheia, levemente torto);
// viagem por vir = carimbo tracejado (ainda não carimbado); cancelada = riscado.
// Clique abre a viagem.
// -----------------------------------------------------------------------------
import type { CSSProperties, ReactNode } from "react";
import { TIPOS_VIAGEM, grupoTipo, type TipoDocumento, type Viagem } from "../lib/viagens";
import { moeda } from "../lib/clientes";
import { Etiqueta } from "../ui";
import { MarcaTipo } from "../viagens/MapaMundi";
import type { ExtraViagem, IaRevisao } from "./viagensCliente";
import { MESES, diaMes, duracaoDias, horaCurta, nomeDestino, situacao, type Situacao } from "./passaporte";

const SITUACAO: Record<Situacao, { rotulo: string; tom: "rel" | "aviso" | "neutro" | "erro" }> = {
  proxima: { rotulo: "Próxima", tom: "rel" },
  em_viagem: { rotulo: "Em viagem", tom: "aviso" },
  realizada: { rotulo: "Realizada", tom: "neutro" },
  cancelada: { rotulo: "Cancelada", tom: "erro" },
  sem_data: { rotulo: "Sem data", tom: "neutro" },
};

const IA: Record<IaRevisao, { rotulo: string; tom: "rel" | "aviso" | "neutro" | "erro" }> = {
  ok: { rotulo: "IA: tudo confere", tom: "rel" },
  divergente: { rotulo: "IA: achou divergência", tom: "erro" },
  incompleta: { rotulo: "IA: faltam documentos", tom: "aviso" },
  erro: { rotulo: "IA: não conseguiu revisar", tom: "neutro" },
};

const DOCS_MOSTRADOS: { tipo: TipoDocumento; um: string; varios: string }[] = [
  { tipo: "bilhete", um: "bilhete", varios: "bilhetes" },
  { tipo: "seguro", um: "seguro", varios: "seguros" },
  { tipo: "voucher", um: "voucher", varios: "vouchers" },
];

/** Inclinação "de mão" do carimbo batido: estável por viagem (não muda a cada render). */
function giro(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 9) - 6; // -6° … +2°
}

function Selo({ v, sit }: { v: Viagem; sit: Situacao }) {
  const g = grupoTipo(v.tipo);
  const batido = sit === "realizada" || sit === "em_viagem";
  const d = v.data_embarque;
  const cor = sit === "cancelada" ? "var(--ink3)" : g === "expedicao" ? "var(--pp-exp)" : "var(--pp-pac)";
  return (
    <span aria-hidden className={`pp-selo ${batido ? "pp-batido" : "pp-vazado"}`}
      style={{ color: cor, "--rot": `${batido ? giro(v.id) : 0}deg` } as CSSProperties}>
      <span className={`pp-selo-forma pp-${g}`} />
      {g === "expedicao" && batido && <span className="pp-selo-anel" />}
      <span className="pp-selo-txt">
        <span className="text-[9px] font-bold tracking-[.16em] leading-none">{d ? MESES[Number(d.slice(5, 7)) - 1].toUpperCase() : "SEM"}</span>
        <span className="text-[20px] font-extrabold leading-none tabular-nums">{d ? d.slice(8, 10) : "—"}</span>
        <span className="text-[9px] font-bold tracking-[.1em] leading-none tabular-nums">{d ? d.slice(0, 4) : "DATA"}</span>
      </span>
      {sit === "cancelada" && <span className="pp-selo-risco" />}
    </span>
  );
}

function Icone({ d }: { d: string }) {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d={d} />
    </svg>
  );
}
const AVIAO = "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z";
const PAPEL = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6";

function Linha({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>{children}</span>;
}

export default function CarimboViagem({ v, clienteId, extra, onAbrir }: {
  v: Viagem; clienteId: string; extra: ExtraViagem | undefined; onAbrir: (id: string) => void;
}) {
  const sit = situacao(v);
  const g = grupoTipo(v.tipo);
  const { principal } = nomeDestino(v);
  const titular = v.cliente_id === clienteId;
  const dias = duracaoDias(v);
  const subtitulo = [v.expedicao, v.titulo].find((t) => t && t.trim() && t.trim().toLowerCase() !== principal.toLowerCase());
  const docs = DOCS_MOSTRADOS.map((x) => ({ ...x, n: extra?.docs[x.tipo] ?? 0 })).filter((x) => x.n > 0);
  const outrosDocs = extra ? Object.entries(extra.docs).reduce((s, [t, n]) => (DOCS_MOSTRADOS.some((x) => x.tipo === t) ? s : s + (n ?? 0)), 0) : 0;
  const voo = sit === "proxima" || sit === "em_viagem" || sit === "sem_data" ? extra?.proximoVoo ?? null : null;
  const checkinAberto = voo?.checkin_em && !voo.checkin_feito && new Date(voo.checkin_em).getTime() <= Date.now();
  const comQuem = extra?.companhia ?? [];

  let quando = "";
  if (sit === "proxima" && v.dias_para_embarque != null) {
    quando = v.dias_para_embarque === 0 ? "embarca hoje" : v.dias_para_embarque === 1 ? "embarca amanhã" : `faltam ${v.dias_para_embarque} dias`;
  }

  return (
    <button type="button" onClick={() => onAbrir(v.id)} className={`pp-carimbo rel-card w-full text-left flex gap-3 sm:gap-4 p-3 sm:p-4 ${sit === "cancelada" ? "pp-cancelada" : ""}`}>
      <Selo v={v} sit={sit} />
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="flex items-start gap-2">
          <span className="flex-1 min-w-0">
            <span className={`block text-[18px] sm:text-[20px] font-extrabold leading-tight tracking-tight ${sit === "cancelada" ? "line-through" : ""}`}
              style={{ color: "var(--ink)", textDecorationColor: "var(--ink3)" }}>
              {principal}
            </span>
            {subtitulo && <span className="block text-[13px] font-medium truncate" style={{ color: "var(--ink2)" }}>{subtitulo}</span>}
          </span>
          <Etiqueta tom={SITUACAO[sit].tom}>{SITUACAO[sit].rotulo}</Etiqueta>
        </span>

        <Linha>
          <span className="inline-flex items-center gap-1 font-semibold" style={{ color: g === "expedicao" ? "var(--pp-exp)" : "var(--pp-pac)" }}>
            <MarcaTipo tipo={g} tamanho={8} />
            {g === "expedicao" ? "Expedição" : "Pacote"}
            {v.tipo !== "expedicao" && v.tipo !== "pacote" ? ` · ${TIPOS_VIAGEM[v.tipo]}` : ""}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums" style={{ color: "var(--ink2)" }}>
            {v.data_embarque
              ? v.data_retorno && v.data_retorno !== v.data_embarque
                ? <>{diaMes(v.data_embarque)} <span aria-hidden>→</span><span className="sr-only">até</span> {diaMes(v.data_retorno)} {v.data_retorno.slice(0, 4)}</>
                : <>{diaMes(v.data_embarque)} {v.data_embarque.slice(0, 4)}</>
              : "sem data de embarque"}
          </span>
          {dias != null && <><span aria-hidden>·</span><span className="tabular-nums">{dias} dia{dias === 1 ? "" : "s"}</span></>}
          {quando && <><span aria-hidden>·</span><span className="font-semibold" style={{ color: "var(--rel-ink)" }}>{quando}</span></>}
        </Linha>

        <Linha>
          {titular ? (
            <>
              <span className="font-semibold" style={{ color: "var(--ink2)" }}>Titular</span>
              {v.valor != null && v.valor > 0 && <><span aria-hidden>·</span><span className="tabular-nums">{moeda(v.valor)}</span></>}
            </>
          ) : (
            <span>
              <span className="font-semibold" style={{ color: "var(--ink2)" }}>Acompanhante</span>
              {v.cliente_nome ? <> de {v.cliente_nome.trim().split(/\s+/)[0]}</> : null}
            </span>
          )}
          {comQuem.length > 0 && (
            <><span aria-hidden>·</span><span>com {comQuem.slice(0, 3).join(", ")}{comQuem.length > 3 ? ` +${comQuem.length - 3}` : ""}</span></>
          )}
        </Linha>

        {(extra && (extra.voos > 0 || docs.length > 0 || outrosDocs > 0 || extra.ia)) && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 pt-2 border-t border-dashed" style={{ borderColor: "var(--line)" }}>
            {extra.voos > 0 && (
              <Linha>
                <Icone d={AVIAO} />
                <span className="tabular-nums">{extra.voos} voo{extra.voos === 1 ? "" : "s"}</span>
                {voo && (
                  <>
                    <span aria-hidden>·</span>
                    <span style={{ color: "var(--ink2)" }}>
                      próximo {voo.origem || "?"}<span aria-hidden> → </span><span className="sr-only"> para </span>{voo.destino || "?"} {horaCurta(voo.partida_em)}
                    </span>
                    {voo.checkin_feito ? (
                      <><span aria-hidden>·</span><span>check-in feito</span></>
                    ) : checkinAberto ? (
                      <><span aria-hidden>·</span><span className="font-semibold" style={{ color: "var(--warn-ink)" }}>check-in aberto</span></>
                    ) : voo.checkin_em ? (
                      <><span aria-hidden>·</span><span>check-in abre {horaCurta(voo.checkin_em)}</span></>
                    ) : null}
                  </>
                )}
              </Linha>
            )}
            {(docs.length > 0 || outrosDocs > 0) && (
              <Linha>
                <Icone d={PAPEL} />
                <span className="tabular-nums">
                  {[...docs.map((x) => `${x.n} ${x.n === 1 ? x.um : x.varios}`), ...(outrosDocs ? [`${outrosDocs} outro${outrosDocs === 1 ? "" : "s"}`] : [])].join(" · ")}
                </span>
              </Linha>
            )}
            {extra.ia && <Etiqueta tom={IA[extra.ia].tom}>{IA[extra.ia].rotulo}</Etiqueta>}
          </span>
        )}
      </span>
    </button>
  );
}
