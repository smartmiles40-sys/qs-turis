// src/expedicoes/ui.tsx
// Peças das telas de Expedições (por cima do kit do Relacionamento, @/rel/ui):
// anel de progresso, pílula de status, célula editável estilo planilha, gaveta
// lateral, botão de excluir com confirmação, abas e o "ao vivo" (realtime).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Botao, Modal } from "@/rel/ui";
import { supabase } from "./lib/banco";
import { esquecer } from "./lib/cache";
import { useExp } from "./contexto";

export const COR_STATUS_EXP: Record<string, { fundo: string; texto: string }> = {
  Planejamento: { fundo: "#EDE9FE", texto: "#5B21B6" },
  "Vendas Abertas": { fundo: "#DCFCE7", texto: "#166534" },
  "Em andamento": { fundo: "#FFEDD5", texto: "#9A3412" },
  Concluída: { fundo: "var(--card2)", texto: "var(--ink2)" },
  Cancelada: { fundo: "var(--err-bg)", texto: "var(--err-ink)" },
};

export function PilulaStatus({ status }: { status: string }) {
  const c = COR_STATUS_EXP[status] ?? COR_STATUS_EXP.Concluída;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap" style={{ background: c.fundo, color: c.texto }}>{status}</span>;
}

export type Tom = "ok" | "aviso" | "erro" | "neutro" | "lista";
export const COR_TOM: Record<Tom, { fundo: string; texto: string }> = {
  ok: { fundo: "#DCFCE7", texto: "#166534" },
  aviso: { fundo: "var(--warn-bg)", texto: "var(--warn-ink)" },
  erro: { fundo: "var(--err-bg)", texto: "var(--err-ink)" },
  neutro: { fundo: "var(--card2)", texto: "var(--ink2)" },
  lista: { fundo: "#EDE9FE", texto: "#5B21B6" },
};
export function Selo({ tom = "neutro", children, titulo }: { tom?: Tom; children: ReactNode; titulo?: string }) {
  const c = COR_TOM[tom];
  return <span title={titulo} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={{ background: c.fundo, color: c.texto }}>{children}</span>;
}

/** Anel de progresso (0..1). cor: "auto" = verde se 100%, laranja senão, cinza se sem total. */
export function Anel({ fracao, tamanho = 44, cor = "auto", vazio = false, children }: {
  fracao: number; tamanho?: number; cor?: "auto" | string; vazio?: boolean; children?: ReactNode;
}) {
  const r = (tamanho - 6) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fracao || 0));
  const traco = vazio ? "var(--line)" : cor === "auto" ? (f >= 1 ? "#16A34A" : "#EA580C") : cor;
  return (
    <span className="relative inline-flex items-center justify-center flex-shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke={traco} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
      </svg>
      <span className="absolute text-[10.5px] font-bold" style={{ color: "var(--ink)" }}>{children ?? `${Math.round(f * 100)}%`}</span>
    </span>
  );
}

/** Gaveta lateral (no celular vira folha de baixo). */
export function Gaveta({ aberta, titulo, subtitulo, onFechar, children, rodape, largura = 560 }: {
  aberta: boolean; titulo: string; subtitulo?: ReactNode; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largura?: number;
}) {
  useEffect(() => {
    if (!aberta) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberta, onFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0" style={{ background: "rgba(15, 20, 26, .45)" }} onClick={onFechar} />
      <aside className="relative h-full w-full flex flex-col shadow-xl" style={{ maxWidth: largura, background: "var(--card)", borderLeft: "1px solid var(--line)" }}>
        <header className="flex items-start gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--line)" }}>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold truncate" style={{ color: "var(--ink)" }}>{titulo}</h2>
            {subtitulo && <div className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>{subtitulo}</div>}
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="p-1 rounded-md" style={{ color: "var(--ink3)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <footer className="flex justify-end gap-2 px-5 py-3.5 border-t" style={{ borderColor: "var(--line)" }}>{rodape}</footer>}
      </aside>
    </div>
  );
}

/** Botão de excluir com confirmação. Some no modo leitura. */
export function BotaoExcluir({ titulo, descricao, onConfirmar, rotulo, icone = true, sucesso }: {
  titulo: string; descricao?: ReactNode; onConfirmar: () => Promise<void>; rotulo?: string; icone?: boolean; sucesso?: string;
}) {
  const { somenteLeitura, avisar } = useExp();
  const [aberto, setAberto] = useState(false);
  const [indo, setIndo] = useState(false);
  if (somenteLeitura) return null;
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setAberto(true); }} title={rotulo ?? "Excluir"} aria-label={rotulo ?? "Excluir"}
        className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[12px] font-semibold hover:opacity-80" style={{ color: "var(--err-ink)" }}>
        {icone && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>}
        {rotulo && !icone ? rotulo : null}
      </button>
      <Modal aberto={aberto} titulo={titulo} onFechar={() => setAberto(false)} largura={440}
        rodape={<>
          <Botao onClick={() => setAberto(false)}>Cancelar</Botao>
          <Botao variante="perigo" disabled={indo} onClick={async () => {
            setIndo(true);
            try { await onConfirmar(); setAberto(false); if (sucesso) avisar(sucesso); }
            catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível excluir", "erro"); }
            finally { setIndo(false); }
          }}>{indo ? "Excluindo…" : "Excluir"}</Botao>
        </>}>
        <div className="text-[13.5px]" style={{ color: "var(--ink2)" }}>{descricao ?? "Essa ação não pode ser desfeita."}</div>
      </Modal>
    </>
  );
}

/**
 * Célula editável estilo planilha: clique edita, Enter/Tab/sair salva, Esc cancela.
 * No modo leitura vira texto. Vazio salva null.
 */
export function CelulaEditavel({ valor, onSalvar, tipo = "text", placeholder = "—", formatar, largura }: {
  valor: string | number | null | undefined;
  onSalvar: (v: string | number | null) => Promise<void>;
  tipo?: "text" | "number" | "date";
  placeholder?: string;
  formatar?: (v: string | number) => ReactNode;
  largura?: number;
}) {
  const { somenteLeitura, avisar } = useExp();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const exibir = valor == null || valor === "" ? <span style={{ color: "var(--ink3)" }}>{placeholder}</span> : formatar ? formatar(valor) : String(valor);
  if (somenteLeitura) return <span>{exibir}</span>;
  if (!editando) {
    return (
      <button type="button" className="text-left w-full min-h-[24px] px-1 -mx-1 rounded hover:bg-[var(--card2)]" style={{ maxWidth: largura }}
        onClick={(e) => { e.stopPropagation(); setRascunho(valor == null ? "" : String(valor)); setEditando(true); setTimeout(() => ref.current?.select(), 0); }}>
        {salvando ? <span style={{ color: "var(--ink3)" }}>salvando…</span> : exibir}
      </button>
    );
  }
  const salvar = async () => {
    setEditando(false);
    const t = rascunho.trim();
    let novo: string | number | null = t === "" ? null : rascunho;
    if (tipo === "number" && novo != null) {
      const n = Number(String(novo).replace(",", "."));
      if (Number.isNaN(n)) { avisar("Valor inválido", "erro"); return; }
      novo = n;
    }
    if ((novo ?? null) === (valor ?? null) || String(novo ?? "") === String(valor ?? "")) return;
    setSalvando(true);
    try { await onSalvar(novo); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); } finally { setSalvando(false); }
  };
  return (
    <input ref={ref} autoFocus type={tipo} value={rascunho} className="rel-input" style={{ padding: "4px 8px", maxWidth: largura }}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={salvar}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditando(false); }} />
  );
}

/** Célula de escolha (status, tipo…). No modo leitura só mostra. */
export function CelulaEscolha<T extends string>({ valor, opcoes, onSalvar, render, rotulo }: {
  valor: T | null; opcoes: readonly T[]; onSalvar: (v: T) => Promise<void>; render?: (v: T | null) => ReactNode; rotulo?: string;
}) {
  const { somenteLeitura, avisar } = useExp();
  const exibir = render ? render(valor) : (valor ?? "—");
  if (somenteLeitura) return <>{exibir}</>;
  return (
    <span className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      {exibir}
      <select aria-label={rotulo ?? "Mudar"} value={valor ?? ""} className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={async (e) => { try { await onSalvar(e.target.value as T); } catch (er) { avisar(er instanceof Error ? er.message : "Erro ao salvar", "erro"); } }}>
        {valor == null && <option value="">—</option>}
        {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </span>
  );
}

export function Abas<T extends string>({ abas, ativa, onTrocar }: { abas: { id: T; rotulo: string; badge?: number }[]; ativa: T; onTrocar: (t: T) => void }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b -mx-1 px-1" style={{ borderColor: "var(--line)" }} role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={a.id === ativa} onClick={() => onTrocar(a.id)}
          className="px-3 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px"
          style={{ borderColor: a.id === ativa ? "var(--rel)" : "transparent", color: a.id === ativa ? "var(--rel-ink)" : "var(--ink2)" }}>
          {a.rotulo}{a.badge ? <span className="ml-1.5 text-[11px] px-1.5 rounded-full" style={{ background: "var(--err-bg)", color: "var(--err-ink)" }}>{a.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return <p className="py-10 text-center text-[13px]" style={{ color: "var(--ink3)" }}>{texto}</p>;
}

export function Cartao({ titulo, acao, children, className = "" }: { titulo?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rel-card p-4 ${className}`}>
      {(titulo || acao) && (
        <div className="flex items-center gap-2 mb-3">
          {titulo && <h3 className="flex-1 text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h3>}
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Realtime: chama `onMudar` (com espera de 400ms) quando qualquer tabela da lista muda.
 * Ex.: useAoVivo([{ tabela: "passageiros", filtro: `expedicao_id=eq.${id}` }], recarregar)
 * Tabela SEM filtro (avisa de edição em qualquer expedição): use espera ≥ 2000ms,
 * pra rajada de edições virar uma recarga só.
 */
export function useAoVivo(assinaturas: { tabela: string; filtro?: string }[], onMudar: () => void, espera = 400) {
  const cb = useRef(onMudar);
  cb.current = onMudar;
  const chave = assinaturas.map((a) => `${a.tabela}|${a.filtro ?? ""}`).join(",");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    // 22/10: a mudança derruba NA HORA o que estava guardado dessa tabela (lib/cache.ts),
    // pra recarga que vem depois da espera já ler do banco.
    const disparar = (tabela: string) => { esquecer(tabela); clearTimeout(t); t = setTimeout(() => cb.current(), espera); };
    const canal = supabase.channel(`exp:${chave}:${Math.random().toString(36).slice(2, 8)}`);
    for (const a of assinaturas) {
      canal.on("postgres_changes" as never, { event: "*", schema: "public", table: a.tabela, ...(a.filtro ? { filter: a.filtro } : {}) } as never, () => disparar(a.tabela));
    }
    canal.subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(canal); };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Caixa de busca com atalho "/". */
export function Busca({ valor, onMudar, placeholder }: { valor: string; onMudar: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) && !alvo.isContentEditable) { e.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return <input ref={ref} type="search" className="rel-input" placeholder={placeholder} value={valor} onChange={(e) => onMudar(e.target.value)} />;
}
