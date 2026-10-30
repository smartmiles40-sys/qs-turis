// src/mkt/grupos/pecas.tsx
// -----------------------------------------------------------------------------
// Peças de tela dos Grupos, no MESMO desenho do SendFlow (que o time de Marketing
// já conhece): campo com rótulo + dica, botões de escolha lado a lado, chave
// liga/desliga, selo de status com bolinha, selo de tag, área de arquivo,
// editor de enquete e a prévia do WhatsApp. Cores: as do QS (magenta da área).
// -----------------------------------------------------------------------------
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { subirArquivo, type StatusCampanha, type Tag, type TipoMsg } from "./lib";
import { temMidia } from "./datas";

/** CSS próprio dos Grupos (entra uma vez, na página com abas). */
export const GRUPOS_CSS = `
@keyframes gr-pulso { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.gr-pulso { animation: gr-pulso 1.4s ease-in-out infinite; }
.gr-cartao { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.gr-cartao-clicavel { transition: border-color .15s, box-shadow .15s; }
.gr-cartao-clicavel:hover { border-color: var(--rel); }
.gr-linha:hover { background: var(--card2); }
.gr-icone-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid var(--line); background: var(--card2); color: var(--ink2); font-size: 14px; flex-shrink: 0; }
.gr-icone-btn:hover:not(:disabled) { border-color: var(--rel); color: var(--ink); }
.gr-icone-btn:disabled { opacity: .5; cursor: not-allowed; }
/* WhatsApp (claro / escuro), igual ao aplicativo */
.wa-tela { background: #efeae2; background-image: radial-gradient(rgba(0,0,0,.05) 1px, transparent 1.2px); background-size: 22px 22px; }
.wa-barra { background: #f0f2f5; color: #111b21; }
.wa-eu { background: #d9fdd3; color: #111b21; }
.wa-outro { background: #ffffff; color: #111b21; }
.wa-cinza { color: #667781; }
.wa-azul { color: #027eb5; }
.wa-dia { background: #ffffff; color: #54656f; }
html.dark .wa-tela { background-color: #0b141a; background-image: radial-gradient(rgba(255,255,255,.04) 1px, transparent 1.2px); }
html.dark .wa-barra { background: #202c33; color: #e9edef; }
html.dark .wa-eu { background: #005c4b; color: #e9edef; }
html.dark .wa-outro { background: #202c33; color: #e9edef; }
html.dark .wa-cinza { color: #8696a0; }
html.dark .wa-azul { color: #53bdeb; }
html.dark .wa-dia { background: #182229; color: #8696a0; }
`;

export const cor = {
  ink: "var(--ink)", ink2: "var(--ink2)", ink3: "var(--ink3)", line: "var(--line)", card: "var(--card)", card2: "var(--card2)",
  rel: "var(--rel)", relSoft: "var(--rel-soft)", relInk: "var(--rel-ink)",
};

// ── Campo (rótulo + dica + erro), igual ao Field do SendFlow ────────────────
export function Campo({ rotulo, dica, erro, children, className = "" }: { rotulo?: ReactNode; dica?: ReactNode; erro?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={`mb-5 last:mb-0 ${className}`}>
      {rotulo && (
        <div className="mb-2 text-[13px] font-semibold" style={{ color: cor.ink }}>
          {rotulo} {dica && <span className="font-normal" style={{ color: cor.ink3 }}>{dica}</span>}
        </div>
      )}
      {children}
      {erro && <div className="mt-1.5 text-[12px]" role="alert" style={{ color: "var(--err-ink)" }}>{erro}</div>}
    </div>
  );
}

/** Botão de escolha (segmentado): os cartões lado a lado de "Tipo de conteúdo", "Agendar / Enviar agora". */
export function Escolha({ ativo, onClick, children, title, disabled }: { ativo: boolean; onClick: () => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} title={title} disabled={disabled}
      className="min-w-0 flex-1 sm:min-w-[84px] rounded-xl px-2.5 py-2.5 text-center text-[13px] font-semibold transition-colors disabled:opacity-50"
      style={ativo
        ? { border: "1.5px solid var(--rel)", background: cor.relSoft, color: cor.relInk }
        : { border: "1px solid var(--line)", background: cor.card2, color: cor.ink2 }}>
      {children}
    </button>
  );
}

/** Chave liga/desliga. */
export function Chave({ ligada, onChange, rotulo, disabled }: { ligada: boolean; onChange: (v: boolean) => void; rotulo: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={ligada} aria-label={rotulo} disabled={disabled} onClick={() => onChange(!ligada)}
      className="relative h-6 w-[42px] shrink-0 rounded-full transition-colors disabled:opacity-60"
      style={{ background: ligada ? "var(--rel)" : "var(--line2, #cbd2dc)" }}>
      <span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all" style={{ left: ligada ? 21 : 3 }} />
    </button>
  );
}

/** Linha "Mencionar todos  [chave]" do SendFlow. */
export function LinhaChave({ titulo, texto, ligada, onChange }: { titulo: string; texto: string; ligada: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3" style={{ border: "1px solid var(--line)", background: cor.card2 }}>
      <span className="text-[14px]" style={{ color: cor.ink }}>
        <span className="font-semibold">{titulo}</span>
        <span className="mt-0.5 block text-[13px]" style={{ color: cor.ink3 }}>{texto}</span>
      </span>
      <Chave ligada={ligada} onChange={onChange} rotulo={titulo} />
    </div>
  );
}

// ── Selo de status (bolinha colorida; "Enviando…" pisca) ────────────────────
const STATUS: Record<StatusCampanha, { rotulo: string; fundo: string; bolinha: string; pulso?: boolean }> = {
  rascunho: { rotulo: "Rascunho", fundo: "var(--card2)", bolinha: "var(--ink3)" },
  agendada: { rotulo: "Agendada", fundo: "rgba(59,130,246,.13)", bolinha: "var(--blue, #3b82f6)" },
  enviando: { rotulo: "Enviando…", fundo: "rgba(245,158,11,.16)", bolinha: "var(--amber, #f59e0b)", pulso: true },
  pausada: { rotulo: "Pausada", fundo: "rgba(245,158,11,.16)", bolinha: "var(--orange, #f97316)" },
  concluida: { rotulo: "Enviada", fundo: "rgba(34,197,94,.14)", bolinha: "var(--green, #16a34a)" },
  cancelada: { rotulo: "Cancelada", fundo: "var(--card2)", bolinha: "var(--ink3)" },
  erro: { rotulo: "Erro", fundo: "var(--err-bg)", bolinha: "var(--red, #dc2626)" },
};
export function SeloStatus({ status, detalhe }: { status: StatusCampanha; detalhe?: string }) {
  const s = STATUS[status] ?? STATUS.rascunho;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: s.fundo, color: cor.ink }}>
      <span aria-hidden className={`h-[7px] w-[7px] shrink-0 rounded-full ${s.pulso ? "gr-pulso" : ""}`} style={{ background: s.bolinha }} />
      {s.rotulo}
      {detalhe ? <span className="tabular-nums">{detalhe}</span> : null}
    </span>
  );
}

/** Selo genérico com bolinha (chip do Marketing, "ativa/pausada"…). */
export function SeloBolinha({ tom, children, pulso }: { tom: "ok" | "aviso" | "erro" | "neutro"; children: ReactNode; pulso?: boolean }) {
  const c = {
    ok: { fundo: "rgba(34,197,94,.14)", bolinha: "var(--green, #16a34a)" },
    aviso: { fundo: "rgba(245,158,11,.16)", bolinha: "var(--amber, #f59e0b)" },
    erro: { fundo: "var(--err-bg)", bolinha: "var(--red, #dc2626)" },
    neutro: { fundo: "var(--card2)", bolinha: "var(--ink3)" },
  }[tom];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: c.fundo, color: cor.ink }}>
      <span aria-hidden className={`h-[7px] w-[7px] shrink-0 rounded-full ${pulso ? "gr-pulso" : ""}`} style={{ background: c.bolinha }} />
      {children}
    </span>
  );
}

// ── Selo de tag (a cor só na bolinha e na borda: o texto fica sempre legível) ─
export function SeloTag({ tag, contagem, ativo, onClick, pequeno, titulo }: {
  tag: Pick<Tag, "nome" | "cor">; contagem?: number; ativo?: boolean; onClick?: () => void; pequeno?: boolean; titulo?: string;
}) {
  const estilo: CSSProperties = {
    borderColor: ativo ? tag.cor : `${tag.cor}66`,
    background: ativo ? `${tag.cor}33` : `${tag.cor}14`,
    color: cor.ink,
    borderWidth: ativo ? 1.5 : 1,
    borderStyle: "solid",
  };
  const cls = `inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors ${pequeno ? "px-2 py-0.5 text-[11.5px]" : "px-3 py-1 text-[12.5px]"}`;
  const miolo = (
    <>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: tag.cor }} />
      <span className="truncate">{tag.nome}</span>
      {typeof contagem === "number" && <span style={{ opacity: 0.6 }}>{contagem}</span>}
    </>
  );
  if (!onClick) return <span className={cls} style={estilo} title={titulo}>{miolo}</span>;
  return <button type="button" onClick={onClick} aria-pressed={ativo} className={cls} style={estilo} title={titulo}>{miolo}</button>;
}

/** Botão principal / secundário no tamanho do SendFlow. */
export function BotaoGrande({ variante = "primario", pequeno, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "perigo"; pequeno?: boolean }) {
  const estilo: CSSProperties = variante === "primario"
    ? { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" }
    : variante === "perigo"
      ? { background: "transparent", color: "var(--err-ink)", border: "1px solid transparent" }
      : { background: "var(--card)", color: cor.ink, border: "1px solid var(--line)" };
  return (
    <button type="button" {...rest}
      className={`rounded-xl font-semibold ${pequeno ? "px-3.5 py-2 text-[13px]" : "px-5 py-3 text-[14px]"} transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${rest.className ?? ""}`}
      style={{ ...estilo, ...rest.style }}>
      {children}
    </button>
  );
}

/** Caixa de aviso no tom do SendFlow ("⏱️ O envio respeita…"). */
export function Nota({ icone, children, tom = "rel" }: { icone?: string; children: ReactNode; tom?: "rel" | "aviso" | "erro" }) {
  const c = {
    rel: { background: cor.relSoft, color: cor.ink, border: "1px solid transparent" },
    aviso: { background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" },
    erro: { background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" },
  }[tom];
  return (
    <div className="flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed" style={c} role={tom === "erro" ? "alert" : undefined}>
      {icone && <span aria-hidden>{icone}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// ── Tipos de conteúdo ───────────────────────────────────────────────────────
export const TIPOS: { v: TipoMsg; r: string }[] = [
  { v: "texto", r: "Só texto" }, { v: "imagem", r: "Imagem" }, { v: "video", r: "Vídeo" },
  { v: "documento", r: "PDF" }, { v: "audio", r: "Áudio" }, { v: "enquete", r: "📊 Enquete" },
];
export const ICONE_TIPO: Record<TipoMsg, string> = { texto: "💬", imagem: "🖼️", video: "🎬", documento: "📄", audio: "🎤", enquete: "📊" };
export const ROTULO_TIPO: Record<TipoMsg, string> = {
  texto: "Só texto", imagem: "Imagem + texto", video: "Vídeo + legenda", documento: "PDF + texto", audio: "Áudio", enquete: "Enquete",
};
const ACEITA: Partial<Record<TipoMsg, string>> = { imagem: "image/jpeg,image/png,image/webp", video: "video/mp4", documento: ".pdf,application/pdf", audio: "audio/*" };
const FORMATOS: Partial<Record<TipoMsg, string>> = { imagem: "JPEG, PNG ou WebP", video: "MP4", documento: "PDF", audio: "MP3, OGG ou M4A" };

function tamanho(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Área de arquivo tracejada ("📎 Clique para enviar"). Sobe pro bucket mkt-grupos. */
export function CampoArquivo({ tipo, url, nome, onSubiu, erro, compacto }: {
  tipo: TipoMsg; url: string | null; nome: string | null; onSubiu: (r: { url: string | null; nome: string | null }) => void; erro?: string | null; compacto?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [meta, setMeta] = useState<number | null>(null);
  if (!temMidia(tipo)) return null;
  async function escolher(f: File | undefined) {
    if (!f) return;
    setFalha(null); setSubindo(true);
    try { const r = await subirArquivo(f); setMeta(f.size); onSubiu({ url: r.url, nome: r.nome }); }
    catch (e) { setFalha((e as Error).message); }
    finally { setSubindo(false); if (ref.current) ref.current.value = ""; }
  }
  const rotulo = nome || (url ? decodeURIComponent(url.split("/").pop() || "Arquivo anexado").replace(/^[0-9a-f-]{36}-/, "") : null);
  return (
    <div>
      <input ref={ref} type="file" accept={ACEITA[tipo]} className="hidden" onChange={(e) => void escolher(e.target.files?.[0])} />
      <button type="button" onClick={() => ref.current?.click()} disabled={subindo}
        className={`block w-full rounded-xl text-center text-[13px] transition-colors disabled:cursor-wait ${compacto ? "px-3 py-2.5" : "px-4 py-[18px]"}`}
        style={{ border: "1.5px dashed var(--line)", background: cor.card2, color: cor.ink3 }}>
        {subindo ? "Enviando arquivo…" : rotulo ? (
          <>
            <span className="font-semibold" style={{ color: "var(--green, #16a34a)" }}>✓ {rotulo}</span>
            {!compacto && <><br /><span className="text-[12px]">{meta ? `${tamanho(meta)} · ` : ""}clique para trocar</span></>}
          </>
        ) : (
          <>
            📎 <b style={{ color: cor.relInk }}>Clique para enviar</b>
            {!compacto && <><br /><span className="text-[12px]">{FORMATOS[tipo]} · até 64 MB</span></>}
          </>
        )}
      </button>
      {(falha || erro) && <p className="mt-1.5 text-[12px]" role="alert" style={{ color: "var(--err-ink)" }}>{falha || erro}</p>}
    </div>
  );
}

// ── Enquete: opções + "várias respostas" ────────────────────────────────────
export function EditorEnquete({ opcoes, onOpcoes, multipla, onMultipla, erro }: {
  opcoes: string[]; onOpcoes: (o: string[]) => void; multipla: boolean; onMultipla: (v: boolean) => void; erro?: string | null;
}) {
  const lista = opcoes.length ? opcoes : ["", ""];
  const mudar = (i: number, v: string) => onOpcoes(lista.map((x, j) => (j === i ? v : x)));
  return (
    <>
      <Campo rotulo="Opções" dica="· de 2 a 12" erro={erro}>
        <div className="flex flex-col gap-2">
          {lista.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-[12px] tabular-nums" style={{ color: cor.ink3 }}>{i + 1}</span>
              <input className="rel-input" value={o} maxLength={100} aria-label={`Opção ${i + 1}`}
                placeholder={i === 0 ? "Ex.: Sim, vou!" : i === 1 ? "Ex.: Não consigo" : `Opção ${i + 1}`}
                onChange={(e) => mudar(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && i === lista.length - 1 && lista.length < 12) { e.preventDefault(); onOpcoes([...lista, ""]); } }} />
              <button type="button" aria-label={`Remover opção ${i + 1}`} disabled={lista.length <= 2}
                onClick={() => onOpcoes(lista.filter((_, j) => j !== i))}
                className="shrink-0 rounded-lg px-2.5 py-2 disabled:invisible" style={{ color: cor.ink3 }}>×</button>
            </div>
          ))}
        </div>
        {lista.length < 12 && (
          <button type="button" onClick={() => onOpcoes([...lista, ""])} className="ml-7 mt-2.5 text-[13px] font-semibold" style={{ color: cor.relInk }}>+ Adicionar opção</button>
        )}
      </Campo>
      <Campo>
        <LinhaChave titulo="Permitir várias respostas" texto="desligado, cada pessoa marca só uma opção" ligada={multipla} onChange={onMultipla} />
      </Campo>
    </>
  );
}

// ── Prévia no WhatsApp (atualiza enquanto digita) ───────────────────────────
/** Negrito/itálico/riscado do WhatsApp na prévia. */
function formatar(texto: string): ReactNode[] {
  const partes = texto.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return partes.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
    if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    if (/^~[^~]+~$/.test(p)) return <s key={i}>{p.slice(1, -1)}</s>;
    return <span key={i}>{p}</span>;
  });
}

export function PreviaWhatsApp({ tipo, texto, midiaUrl, midiaNome, mencionarTodos, enqueteOpcoes = [], enqueteMultipla = false, grupo }: {
  tipo: TipoMsg; texto: string; midiaUrl: string | null; midiaNome?: string | null; mencionarTodos: boolean;
  enqueteOpcoes?: string[] | null; enqueteMultipla?: boolean; grupo?: { nome: string; participantes?: number | null } | null;
}) {
  const visiveis = (enqueteOpcoes || []).filter((o) => o.trim());
  return (
    <div>
      <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: cor.ink3 }}>Prévia no WhatsApp</div>
      <div className="overflow-hidden rounded-[22px] shadow-lg" style={{ border: "1px solid var(--line)" }}>
        <div className="wa-barra flex items-center gap-2.5 px-3.5 py-3">
          <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[15px]" style={{ background: "var(--rel)", color: "#fff" }}>👥</span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">{grupo?.nome || "Live Japão — Turma Outubro"}</div>
            <div className="wa-cinza text-[11px]">você{grupo?.participantes ? `, +${Math.max(0, grupo.participantes - 1)} participantes` : ", +47 participantes"}</div>
          </div>
        </div>
        <div className="wa-tela min-h-[340px] px-3 py-4">
          <div className="wa-eu ml-auto max-w-[86%] rounded-[10px] rounded-tr-[2px] px-2 pb-2 pt-1.5 text-[13.5px] leading-[1.42] shadow-sm">
            {temMidia(tipo) && (
              <div className="relative mb-1.5 overflow-hidden rounded-[7px]">
                {tipo === "imagem" && midiaUrl ? (
                  <img src={midiaUrl} alt="" className="block w-full" />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1 py-9" style={{ background: "rgba(0,0,0,.08)" }}>
                    <span className="text-2xl">{ICONE_TIPO[tipo]}</span>
                    <span className="wa-cinza max-w-[200px] truncate text-[11px]">
                      {midiaUrl ? midiaNome || "Arquivo anexado" : tipo === "imagem" ? "Sua imagem aparece aqui" : `${ROTULO_TIPO[tipo]} · anexe o arquivo`}
                    </span>
                  </div>
                )}
              </div>
            )}
            {tipo === "enquete" ? (
              <div className="min-w-[210px]">
                <div className="break-words font-semibold">{texto.trim() || <span className="wa-cinza font-normal">sua pergunta…</span>}</div>
                <div className="wa-cinza mb-2 mt-0.5 text-[11.5px]">{enqueteMultipla ? "Selecione uma ou mais opções" : "Selecione uma opção"}</div>
                {(visiveis.length ? visiveis : ["Opção 1", "Opção 2"]).map((o, i) => (
                  <div key={i} className="mb-2 flex items-center gap-2.5" style={{ opacity: visiveis.length ? 1 : 0.5 }}>
                    <span className={`h-[18px] w-[18px] shrink-0 border-2 ${enqueteMultipla ? "rounded-[4px]" : "rounded-full"}`} style={{ borderColor: "#8696a0" }} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{o}</span>
                      <span className="mt-1 block h-[5px] rounded-full" style={{ background: "rgba(0,0,0,.1)" }} />
                    </span>
                  </div>
                ))}
                {mencionarTodos && <div className="wa-azul text-[12px]">@todos marcados</div>}
                <div className="wa-azul mt-1 pt-1.5 text-center text-[13px] font-semibold" style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>Ver votos</div>
              </div>
            ) : (
              <>
                {mencionarTodos && <span className="wa-azul">@todos </span>}
                {texto ? <span className="whitespace-pre-wrap break-words">{formatar(texto)}</span> : <span className="wa-cinza">{temMidia(tipo) ? "legenda (opcional)…" : "sua mensagem…"}</span>}
              </>
            )}
            <div className="wa-cinza mt-1 text-right text-[10px]">agora ✓✓</div>
          </div>
        </div>
      </div>
      <div className="mt-2.5 text-center text-[11.5px]" style={{ color: cor.ink3 }}>Atualiza conforme você digita · igual chega no grupo</div>
    </div>
  );
}
