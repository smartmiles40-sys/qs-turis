// src/components/ui/qs.tsx
// -----------------------------------------------------------------------------
// Peças compartilhadas da spec "Ficha do Cliente e Solicitações" (29/10,
// docs/ref/qs-redesign-ficha-solicitacoes.md, seção 2). A spec pede a pasta
// components/qs/ — ficam aqui, junto das peças base do redesign, e saem pelo
// mesmo `@/components/ui`. Só tokens (tokens.css / ui.css): cor só para STATUS
// e para o pontinho/chip de setor, nunca decoração. Funciona no modo noite.
// -----------------------------------------------------------------------------
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ── Setor ────────────────────────────────────────────────────────────────────
/** Os 4 setores do QS (mesmos ids de components/sdr/types → Setor). */
export type SetorQs = "comercial" | "relacionamento" | "financeiro" | "operacional";
const NOME_SETOR_QS: Record<SetorQs, string> = {
  comercial: "Comercial", relacionamento: "Relacionamento", financeiro: "Financeiro", operacional: "Operações",
};
/** Nome do token de cor do setor (o de Operações se chama "operacoes" nos tokens). */
const TOKEN_SETOR: Record<SetorQs, string> = {
  comercial: "comercial", relacionamento: "relacionamento", financeiro: "financeiro", operacional: "operacoes",
};

export function SectorDot({ setor, size = 8, label }: { setor: SetorQs; size?: number; label?: string }) {
  return (
    <span className="qs-dot" style={{ width: size, height: size, background: `var(--sector-${TOKEN_SETOR[setor]})` }}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}

export function SectorChip({ setor, children, dot = true }: { setor: SetorQs; children?: ReactNode; dot?: boolean }) {
  const t = TOKEN_SETOR[setor];
  return (
    <span className="qs-chip" style={{ background: `var(--sector-${t}-bg)`, color: `var(--sector-${t}-fg)`, borderColor: "transparent" }}>
      {dot && <SectorDot setor={setor} size={6} />}
      {children ?? NOME_SETOR_QS[setor]}
    </span>
  );
}

// ── StatusChip ───────────────────────────────────────────────────────────────
export type ChipTone = "warn" | "danger" | "ok" | "info" | "neutral";
/** Chip de status (raio 6px). `sector` vira SectorChip. */
export function StatusChip({ tone = "neutral", sector, icon, children, className }: {
  tone?: ChipTone; sector?: SetorQs; icon?: ReactNode; children: ReactNode; className?: string;
}) {
  if (sector) return <SectorChip setor={sector}>{children}</SectorChip>;
  return <span className={cx("qs-chip", tone !== "neutral" && `qs-chip--${tone}`, className)}>{icon}{children}</span>;
}

// ── StatCard ─────────────────────────────────────────────────────────────────
export type StatTone = "default" | "warn" | "ok" | "danger";
/** Indicador: rótulo, valor grande e subtítulo. Com onClick vira botão. */
export function StatCard({ label, value, sub, tone = "default", onClick }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: StatTone; onClick?: () => void;
}) {
  const corpo = (
    <>
      <span className="qs-stat__l">{label}</span>
      <span className={cx("qs-stat__v", tone !== "default" && `qs-tone-${tone}`)}>{value}</span>
      {sub && <span className="qs-stat__s">{sub}</span>}
    </>
  );
  const cls = cx("qs-stat", tone !== "default" && `qs-stat--${tone}`);
  return onClick
    ? <button type="button" className={cls} onClick={onClick}>{corpo}</button>
    : <div className={cls}>{corpo}</div>;
}

// ── FilterPill ───────────────────────────────────────────────────────────────
export function FilterPill({ active, count, countTone, onClick, children, role = "button", controls }: {
  active?: boolean; count?: number | null; countTone?: "warn" | "danger"; onClick?: () => void; children: ReactNode;
  /** "tab" quando as pílulas trocam de aba (role=tablist no pai). */
  role?: "button" | "tab"; controls?: string;
}) {
  return (
    <button type="button" className="qs-pill" onClick={onClick} role={role === "tab" ? "tab" : undefined}
      aria-selected={role === "tab" ? !!active : undefined} aria-pressed={role === "button" ? !!active : undefined}
      aria-controls={controls} data-active={active ? "" : undefined}>
      {children}
      {count != null && count > 0 && <span className={cx("qs-pill__n", countTone && `qs-pill__n--${countTone}`)}>{count}</span>}
    </button>
  );
}

// ── Card (raio 16, borda 1px, sem sombra) ────────────────────────────────────
export function Card({ title, action, children, className, as = "section", label }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; as?: "section" | "div"; label?: string;
}) {
  const T = as;
  return (
    <T className={cx("qs-card2", className)} aria-label={label}>
      {(title || action) && (
        <div className="qs-card2__h">
          {title && <h3 className="qs-card2__t">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </T>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
export interface TimelineItem {
  id: string;
  when: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** Cor do ponto: um status ou um setor. Sem nada = neutro. */
  tone?: "ok" | "warn" | "danger" | "info";
  setor?: SetorQs;
}
export function Timeline({ items, empty = "Nada registrado ainda." }: { items: TimelineItem[]; empty?: ReactNode }) {
  if (!items.length) return <p className="qs-tl__empty">{empty}</p>;
  return (
    <ol className="qs-tl">
      {items.map((ev) => (
        <li key={ev.id} className="qs-tl__i">
          <span className="qs-tl__rail" aria-hidden>
            <span className="qs-tl__dot" style={{ background: ev.setor ? `var(--sector-${TOKEN_SETOR[ev.setor]})` : ev.tone ? `var(--${ev.tone})` : "var(--subtle)" }} />
            <span className="qs-tl__line" />
          </span>
          <span className="qs-tl__tx">
            <span className="qs-tl__w">{ev.when}</span>
            <span className="qs-tl__t">{ev.title}</span>
            {ev.sub && <span className="qs-tl__s">{ev.sub}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── ChecklistItem ────────────────────────────────────────────────────────────
/** Item preenchido (✓ + valor resumido) ou faltando (○ + dica + ação "Pedir"). */
export function ChecklistItem({ label, done, value, hint, action }: {
  label: ReactNode; done: boolean; value?: ReactNode; hint?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={cx("qs-chk", !done && "qs-chk--falta")}>
      {done
        ? <span className="qs-chk__ic qs-chk__ic--ok" role="img" aria-label="Preenchido">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          </span>
        : <span className="qs-chk__ic qs-chk__ic--falta" role="img" aria-label="Faltando" />}
      <span className="qs-chk__tx">
        <span className="qs-chk__l">{label}</span>
        {(done ? value : hint) && <span className="qs-chk__h">{done ? value : hint}</span>}
      </span>
      {!done && action}
    </div>
  );
}

// ── ProgressRing ─────────────────────────────────────────────────────────────
export function ProgressRing({ value, size = 64, label }: { value: number; size?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const tone = pct >= 100 ? "var(--ok)" : pct >= 70 ? "var(--text)" : "var(--warn)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${pct}% completo`} className="qs-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.22} fontWeight={700} fill="var(--text)">{pct}%</text>
    </svg>
  );
}

// ── Menu (dropdown agrupado) ─────────────────────────────────────────────────
export interface MenuGrupo { titulo: string; itens: { rotulo: ReactNode; onClick: () => void; disabled?: boolean; dica?: string }[] }
/** Botão + lista agrupada. Fecha com Esc, clique fora ou ao escolher; foco volta pro botão. */
export function Menu({ rotulo, grupos, alinhar = "direita", variante = "secondary" }: {
  rotulo: ReactNode; grupos: MenuGrupo[]; alinhar?: "direita" | "esquerda"; variante?: "secondary" | "primary";
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setAberto(false); botao.current?.focus(); } };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    // foco no primeiro item ao abrir
    raiz.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);
  const grupoVisivel = grupos.filter((g) => g.itens.length);
  return (
    <div className="qs-menu" ref={raiz}>
      <button ref={botao} type="button" className={cx("qs-btn2", variante === "primary" && "qs-btn2--primary")} aria-haspopup="menu" aria-expanded={aberto}
        aria-controls={id} onClick={() => setAberto((a) => !a)}>
        {rotulo}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {aberto && (
        <div id={id} role="menu" className={cx("qs-menu__pop", alinhar === "esquerda" && "qs-menu__pop--esq")}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const itens = [...(raiz.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
            const i = itens.indexOf(document.activeElement as HTMLButtonElement);
            itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length]?.focus();
          }}>
          {grupoVisivel.map((g) => (
            <div key={g.titulo} role="group" aria-label={g.titulo}>
              <div className="qs-menu__g">{g.titulo}</div>
              {g.itens.map((it, i) => (
                <button key={i} type="button" role="menuitem" className="qs-menu__i" disabled={it.disabled} title={it.dica}
                  onClick={() => { setAberto(false); it.onClick(); }}>
                  {it.rotulo}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Botão da ficha (raio 10, alvo de toque 44px) ─────────────────────────────
export function Btn({ variant = "secondary", size, icon, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "positive" | "ghost"; size?: "sm"; icon?: ReactNode }) {
  return (
    <button type="button" {...rest}
      className={cx("qs-btn2", variant !== "secondary" && `qs-btn2--${variant}`, size && `qs-btn2--${size}`, !children && "qs-btn2--icon", className)}>
      {icon}{children}
    </button>
  );
}
