// src/mkt/trafego/ui.tsx — peças e formatos da tela de Meta Ads (0265).
import type { ReactNode } from "react";
import type { Situacao } from "./tipos";

export const brl = (v: number | null | undefined, casas = 0) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
export const brl2 = (v: number | null | undefined) => brl(v, 2);
export const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));
export const pct = (v: number | null | undefined, casas = 0) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`);
export const dataBr = (dia: string | null | undefined) => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : "—");
export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";

export function haQuanto(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

/** Custo com o caso "gastou e não teve nenhum" escrito por extenso. */
export function custo(v: number | null, gasto: number) {
  if (v != null) return brl(v);
  return gasto > 0 ? <span style={{ color: "var(--err-ink)" }}>nenhum ainda</span> : "—";
}

export function Numero({ rotulo, valor, dica, tom }: { rotulo: string; valor: ReactNode; dica?: ReactNode; tom?: "erro" | "aviso" | "ok" }) {
  const cor = tom === "erro" ? "var(--err-ink)" : tom === "aviso" ? "var(--warn-ink)" : tom === "ok" ? "var(--rel-ink)" : "var(--ink)";
  return (
    <div className="rel-card px-4 py-3">
      <p className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{rotulo}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums" style={{ color: cor }}>{valor}</p>
      {dica && <p className="mt-1 text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>{dica}</p>}
    </div>
  );
}

/**
 * Barra da verba: quanto já foi (cheio) × onde deveria estar pelo tempo (marca).
 * Passou da marca = gastando mais rápido que o ritmo ideal.
 */
export function BarraVerba({ pctVerba, pctTempo }: { pctVerba: number; pctTempo: number }) {
  const cheio = Math.min(100, Math.max(0, pctVerba));
  const adiantado = pctVerba > pctTempo + 2;
  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}
        role="img" aria-label={`${pctVerba.toFixed(0)}% da verba gasta com ${pctTempo.toFixed(0)}% do período passado`}>
        <div className="h-full rounded-full" style={{ width: `${cheio}%`, background: pctVerba >= 100 ? "var(--red)" : adiantado ? "#D97706" : "var(--rel)" }} />
        <div className="absolute top-[-3px] bottom-[-3px] w-[2px]" style={{ left: `calc(${Math.min(100, pctTempo)}% - 1px)`, background: "var(--ink)" }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[12px]" style={{ color: "var(--ink3)" }}>
        <span>{pctVerba.toFixed(0)}% da verba gasta</span>
        <span>▏ {pctTempo.toFixed(0)}% do período passou</span>
      </div>
    </div>
  );
}

const SIT: Record<Situacao, { rotulo: string; bg: string; cor: string }> = {
  ok: { rotulo: "Dentro", bg: "var(--rel-soft)", cor: "var(--rel-ink)" },
  alerta: { rotulo: "Perto do limite", bg: "var(--warn-bg)", cor: "var(--warn-ink)" },
  disparou: { rotulo: "Passou do limite", bg: "var(--err-bg)", cor: "var(--err-ink)" },
  amostra_pequena: { rotulo: "Amostra pequena", bg: "var(--card2)", cor: "var(--ink2)" },
  sem_dado: { rotulo: "Sem dado", bg: "var(--card2)", cor: "var(--ink3)" },
  desligada: { rotulo: "Desligada", bg: "var(--card2)", cor: "var(--ink3)" },
};
export function ChipSituacao({ s }: { s: Situacao }) {
  const c = SIT[s] ?? SIT.sem_dado;
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: c.bg, color: c.cor }}>{c.rotulo}</span>;
}

export function StatusMeta({ s }: { s: string | null }) {
  const ativo = s === "ACTIVE";
  const rot = ({ ACTIVE: "No ar", PAUSED: "Pausada", CAMPAIGN_PAUSED: "Campanha pausada", ADSET_PAUSED: "Conjunto pausado", ARCHIVED: "Arquivada", WITH_ISSUES: "Com problema", IN_PROCESS: "Processando", PENDING_REVIEW: "Em revisão", DISAPPROVED: "Reprovada" } as Record<string, string>)[s ?? ""] ?? (s || "—");
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap" style={{ color: ativo ? "var(--rel-ink)" : "var(--ink3)" }}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: ativo ? "#16A34A" : "var(--line)" }} />{rot}
    </span>
  );
}

/** Tabela com rolagem lateral só nela (a página não rola de lado no celular). */
export function Tabela({ children }: { children: ReactNode }) {
  return (
    <div className="rel-card overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">{children}</table>
    </div>
  );
}
export const TH = "px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide whitespace-nowrap";
export const TD = "px-3 py-2 whitespace-nowrap tabular-nums";
