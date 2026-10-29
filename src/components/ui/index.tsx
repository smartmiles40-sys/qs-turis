// src/components/ui/index.tsx
// -----------------------------------------------------------------------------
// Peças base do redesign (out/2026) — ver qs-redesign/HANDOFF.md, "Componentes".
// Criadas uma vez e reutilizadas em toda tela nova. Só tokens (ui.css); a cor
// entra apenas por `tone`, que é sempre um STATUS (danger/warn/ok/info), nunca
// decoração.
// -----------------------------------------------------------------------------
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import "./ui.css";
import { iniciaisDe } from "./nomeCliente";

export { parseClientName, nomeLimpo, iniciaisDe, type NomeCliente } from "./nomeCliente";
// Peças da spec da Ficha/Solicitações (29/10): StatCard, StatusChip, SectorDot/Chip,
// SegmentedControl, FilterPill, Timeline, ChecklistItem, ProgressRing, Menu, Card.
export * from "./qs";

export type Tone = "danger" | "warn" | "ok" | "info";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ── Button ───────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export function Button({
  variant = "secondary", size, icon, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm"; icon?: ReactNode }) {
  return (
    <button type="button" {...rest}
      className={cx("qs-btn", variant !== "secondary" && `qs-btn--${variant}`, size && `qs-btn--${size}`, !children && "qs-btn--icon", className)}>
      {icon}{children}
    </button>
  );
}

// ── Badge / StatusDot ────────────────────────────────────────────────────────
export function Badge({ tone, dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx("qs-badge", tone && `qs-badge--${tone}`, className)}>
      {dot && <span className={cx("qs-dot", tone && `qs-dot--${tone}`)} aria-hidden />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, size = 7, label }: { tone?: Tone | "text"; size?: number; label?: string }) {
  return (
    <span className={cx("qs-dot", tone && `qs-dot--${tone}`)} style={{ width: size, height: size }}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}

// ── PageHeader ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, crumb, actions }: { title: ReactNode; subtitle?: ReactNode; crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="qs-header">
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        {crumb && <span className="qs-header__crumb">{crumb}</span>}
        <h1 className="qs-header__h1">{title}</h1>
        {subtitle && <p className="qs-header__sub">{subtitle}</p>}
      </div>
      {actions && <div className="qs-header__acts">{actions}</div>}
    </header>
  );
}

/** Moldura de página: padding + largura máxima (wide = boards, agenda, conversas). */
export function Page({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return <div className="qs-page"><div className={cx("qs-page__wrap", wide && "qs-page__wrap--wide")}>{children}</div></div>;
}

// ── KpiCard ──────────────────────────────────────────────────────────────────
/** Card neutro; só o NÚMERO ganha cor quando pede ação. Com onClick vira botão. */
export function KpiCard({ label, value, hint, tone, onClick }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone; onClick?: () => void }) {
  const corpo = (
    <>
      <span className="qs-label">{label}</span>
      <span className={cx("qs-kpi__v", tone && `qs-tone-${tone}`)}>{value}</span>
      {hint && <span className="qs-kpi__hint">{hint}</span>}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="qs-card qs-kpi">{corpo}</button>
    : <div className="qs-card qs-kpi">{corpo}</div>;
}

// ── Segmented ────────────────────────────────────────────────────────────────
export interface SegOption<T extends string> { value: T; label: ReactNode; count?: number }
export function Segmented<T extends string>({ options, value, onChange, label }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="qs-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}{o.count != null && <span className="qs-seg__n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Nome da spec (29/10) pro mesmo controle: abas tipo "Quadro | Lista | Prazos". */
export { Segmented as SegmentedControl };

// ── SearchInput ──────────────────────────────────────────────────────────────
export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="qs-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" {...props} />
    </label>
  );
}

// ── DataTable ────────────────────────────────────────────────────────────────
export interface Column<R> { key: string; header: ReactNode; render: (row: R) => ReactNode; align?: "right" }
export function DataTable<R>({ columns, rows, rowKey, onRowClick, empty, footer, minWidth }: {
  columns: Column<R>[]; rows: R[]; rowKey: (r: R) => string; onRowClick?: (r: R) => void;
  empty?: ReactNode; footer?: ReactNode; minWidth?: number;
}) {
  if (!rows.length && empty) return <div className="qs-card">{empty}</div>;
  return (
    <div className="qs-card" style={{ overflow: "hidden" }}>
      <div className="qs-table-wrap">
        <table className="qs-table" style={{ minWidth }}>
          <thead><tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align }}>{c.header}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} data-click={onRowClick ? "" : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.key} style={{ textAlign: c.align }}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="qs-table__foot">{footer}</div>}
    </div>
  );
}

// ── ListRow ──────────────────────────────────────────────────────────────────
export function ListRow({ tone, title, meta, due, dueTone, action, onClick }: {
  tone?: Tone | "text"; title: ReactNode; meta?: ReactNode; due?: ReactNode; dueTone?: Tone; action?: ReactNode; onClick?: () => void;
}) {
  return (
    <div className="qs-row" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      {tone && <StatusDot tone={tone} />}
      <span className="qs-row__tx"><span className="qs-row__t">{title}</span>{meta && <span className="qs-row__m">{meta}</span>}</span>
      {due && <span className={cx("qs-num", dueTone ? `qs-tone-${dueTone}` : "qs-tone-subtle")} style={{ fontSize: 13 }}>{due}</span>}
      {action}
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────
export function Board({ children }: { children: ReactNode }) {
  return <div className="qs-board">{children}</div>;
}
export function BoardColumn({ title, count, hint, empty = "Nada aqui", children }: { title: ReactNode; count?: number; hint?: ReactNode; empty?: ReactNode; children?: ReactNode }) {
  const vazio = !children || (Array.isArray(children) && children.length === 0);
  return (
    <section className="qs-bcol">
      <div className="qs-bcol__h">{title}{count != null && <span className="qs-num qs-tone-subtle" style={{ fontWeight: 500, fontSize: 12 }}>{count}</span>}</div>
      {hint && <div className="qs-bcol__hint">{hint}</div>}
      {vazio ? <div className="qs-bcol__empty">{empty}</div> : children}
    </section>
  );
}
export function BoardCard({ number, origin, title, client, due, dueTone, owner, onClick }: {
  number?: ReactNode; origin?: ReactNode; title: ReactNode; client?: ReactNode; due?: ReactNode; dueTone?: Tone; owner?: string | null; onClick?: () => void;
}) {
  return (
    <button type="button" className="qs-card qs-bcard" onClick={onClick}>
      {(number || origin) && <span className="qs-bcard__top">{number && <span className="qs-num">{number}</span>}{origin && <span>· {origin}</span>}</span>}
      <span style={{ fontWeight: 600 }}>{title}</span>
      {client && <span style={{ fontSize: 13, color: "var(--muted)" }}>{client}</span>}
      <span className="qs-bcard__foot">
        <span className={cx("qs-num", dueTone ? `qs-tone-${dueTone}` : "qs-tone-subtle")}>{due}</span>
        <span className={owner ? "qs-tone-muted" : "qs-tone-danger"}>{owner || "Sem dono"}</span>
      </span>
    </button>
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────────
export function ProgressBar({ value, tone, label }: { value: number; tone?: Tone; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="qs-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="qs-bar__fill" style={{ width: `${pct}%`, background: tone ? `var(--${tone})` : undefined }} />
    </div>
  );
}

// ── Stepper (esteira do Relacionamento) ──────────────────────────────────────
export const ETAPAS_ESTEIRA = ["Bastão", "Revisão", "D-30", "D-7", "D-3", "Check-in", "Em viagem", "Retorno"] as const;
export function Stepper({ steps = ETAPAS_ESTEIRA as readonly string[], current }: { steps?: readonly string[]; current: number }) {
  return (
    <ol className="qs-steps" aria-label="Etapas">
      {steps.map((s, i) => (
        <li key={s} className={cx("qs-step", i < current && "qs-step--done", i === current && "qs-step--now")} aria-current={i === current ? "step" : undefined}>
          {i > 0 && <span className="qs-step__sep" aria-hidden />}
          <span className="qs-step__c" aria-hidden>{i < current ? "✓" : i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────
/** Iniciais pelo nome limpo: "[V4] (STFV) Roselene Pereira" → "RP" (antes saía "[("). */
export function iniciais(nome: string) { return iniciaisDe(nome); }
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return <span className="qs-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden>{iniciais(name)}</span>;
}

// ── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="qs-empty">
      <span className="qs-empty__ic" aria-hidden>{icon ?? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m5 12 5 5 9-10" /></svg>}</span>
      <span className="qs-empty__t">{title}</span>
      {description && <span className="qs-empty__d">{description}</span>}
      {action}
    </div>
  );
}

// ── Alert (faixa de uma linha) ───────────────────────────────────────────────
export function Alert({ tone, children, action }: { tone: Tone; children: ReactNode; action?: ReactNode }) {
  return <div className={`qs-alert qs-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}><span className="qs-alert__tx">{children}</span>{action}</div>;
}
