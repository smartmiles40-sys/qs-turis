// src/solicitacoes/AnexosTela.tsx
// -----------------------------------------------------------------------------
// ANEXOS (0316) — peças de tela reaproveitadas na conversa do quadro, no modal
// completo (SolicitacaoDetalhe) e na criação do pedido (NovaSolicitacao):
//
//   • useFilaDeAnexos  — fila do que vai junto da próxima mensagem: clipe 📎,
//                        arrastar-e-soltar, colar print (Ctrl+V); valida (25 MB,
//                        sem programa/script) e mostra o progresso do envio.
//   • FilaDeAnexos     — os arquivos na fila (chips com barra de progresso).
//   • BotaoClipe       — o 📎 do campo de mensagem.
//   • ZonaDeSoltar     — "Solte para anexar" por cima da área.
//   • AnexosDaMensagem — os arquivos DENTRO da bolha.
//   • GaleriaAnexos    — miniaturas grandes no painel do pedido.
//   • Visualizador     — tela cheia: foto com setas, PDF embutido, outros: baixar.
//
// Tudo abre por link assinado curto (bucket privado).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { nomeCurto, progressoTotal, rotuloDoFormato, separarArquivos, tamanhoLegivel, tipoDePrevia, type AnexoSol } from "./anexos";
import { anexarNaSolicitacao, arquivoComNome, linkDoAnexo, linksAssinados, type ItemEnvio } from "./anexosApi";

// ── Links assinados ─────────────────────────────────────────────────────────
/** Links assinados pros caminhos (renova sozinho a cada 4 min). */
export function useLinks(paths: (string | null | undefined)[]): Record<string, string> {
  const chave = paths.filter(Boolean).sort().join("|");
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!chave) { setLinks({}); return; }
    let vivo = true;
    const buscar = () => { void linksAssinados(chave.split("|")).then((l) => { if (vivo) setLinks(l); }).catch(() => {}); };
    buscar();
    const t = setInterval(buscar, 240_000);
    return () => { vivo = false; clearInterval(t); };
  }, [chave]);
  return links;
}

// ── Ícones ──────────────────────────────────────────────────────────────────
export function IconeClipe({ tam = 16 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function IconeArquivo({ nome }: { nome: string }) {
  const pdf = tipoDePrevia({ nome }) === "pdf";
  return (
    <span className="solq-arq__ic" data-pdf={pdf ? "" : undefined} aria-hidden>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
      <b>{rotuloDoFormato(nome)}</b>
    </span>
  );
}

// ── Fila de envio ───────────────────────────────────────────────────────────
export interface FilaDeAnexosApi {
  fila: File[];
  itens: ItemEnvio[];
  erros: string[];
  enviando: boolean;
  adicionar: (lista: FileList | File[] | null | undefined) => void;
  remover: (i: number) => void;
  limpar: () => void;
  fecharErros: () => void;
  /** Sobe a fila e grava a mensagem (texto opcional). Devolve true se deu certo. */
  enviar: (solId: string, texto: string | null) => Promise<boolean>;
  /** Pra colar print no campo de texto (Ctrl+V de imagem). */
  aoColar: (e: ClipboardEvent<HTMLElement>) => void;
  /** Pra pôr no input escondido do clipe. */
  inputRef: RefObject<HTMLInputElement>;
}

export function useFilaDeAnexos(): FilaDeAnexosApi {
  const [fila, setFila] = useState<File[]>([]);
  const [itens, setItens] = useState<ItemEnvio[]>([]);
  const [erros, setErros] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filaRef = useRef(fila); filaRef.current = fila;

  const adicionar = useCallback((lista: FileList | File[] | null | undefined) => {
    const arr = Array.from(lista ?? []).map(arquivoComNome);
    if (!arr.length) return;
    const { ok, erros: e } = separarArquivos(arr, filaRef.current.length);
    setErros(e);
    if (ok.length) {
      setFila((f) => [...f, ...ok]);
      setItens((it) => [...it, ...ok.map((a, k) => ({ chave: `${Date.now()}-${k}-${a.name}`, nome: a.name, tamanho: a.size, estado: "fila" as const, fracao: 0 }))]);
    }
  }, []);
  const remover = useCallback((i: number) => {
    setFila((f) => f.filter((_, k) => k !== i));
    setItens((it) => it.filter((_, k) => k !== i));
  }, []);
  const limpar = useCallback(() => { setFila([]); setItens([]); setErros([]); }, []);

  const enviar = useCallback(async (solId: string, texto: string | null) => {
    const arqs = filaRef.current;
    if (!arqs.length) return true;
    setEnviando(true); setErros([]);
    setItens((it) => it.map((x) => ({ ...x, estado: "fila", fracao: 0, erro: undefined })));
    try {
      await anexarNaSolicitacao(solId, texto, arqs, (i, p) => setItens((it) => it.map((x, k) => (k === i ? { ...x, ...p } : x))));
      setFila([]); setItens([]);
      return true;
    } catch (e) {
      setErros([e instanceof Error ? e.message : "Os arquivos não subiram."]);
      setItens((it) => it.map((x) => (x.estado === "erro" ? x : { ...x, estado: "fila", fracao: 0 })));
      return false;
    } finally { setEnviando(false); }
  }, []);

  const aoColar = useCallback((e: ClipboardEvent<HTMLElement>) => {
    const arqs = Array.from(e.clipboardData?.files ?? []);
    if (!arqs.length) return; // texto comum: deixa colar
    e.preventDefault();
    adicionar(arqs);
  }, [adicionar]);

  return { fila, itens, erros, enviando, adicionar, remover, limpar, fecharErros: () => setErros([]), enviar, aoColar, inputRef };
}

/** O 📎 + o input escondido (aceita vários). */
export function BotaoClipe({ api, disabled, rotulo = "Anexar arquivos", className = "solq-clipe", texto }: { api: FilaDeAnexosApi; disabled?: boolean; rotulo?: string; className?: string; texto?: string }) {
  return (
    <>
      <button type="button" className={className} aria-label={rotulo} title={`${rotulo} (ou arraste / cole um print)`} disabled={disabled || api.enviando}
        onClick={() => api.inputRef.current?.click()}>
        <IconeClipe />{texto}
      </button>
      <input ref={api.inputRef} type="file" multiple hidden tabIndex={-1}
        onChange={(e) => { api.adicionar(e.target.files); e.target.value = ""; }} />
    </>
  );
}

/** Os arquivos esperando envio, com barra de progresso total e por arquivo. */
export function FilaDeAnexos({ api }: { api: FilaDeAnexosApi }) {
  if (!api.itens.length && !api.erros.length) return null;
  const total = progressoTotal(api.itens);
  return (
    <div className="solq-fila">
      {api.erros.map((e, i) => (
        <p key={i} className="solq-fila__erro" role="alert">
          <span>{e}</span>
          {i === 0 && <button type="button" className="solq-link" onClick={api.fecharErros}>ok</button>}
        </p>
      ))}
      {api.itens.length > 0 && (
        <>
          {api.enviando && (
            <div className="solq-prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={total} aria-label="Enviando anexos">
              <span style={{ width: `${total}%` }} />
              <small>Enviando {api.itens.length === 1 ? "o arquivo" : `${api.itens.length} arquivos`}… {total}%</small>
            </div>
          )}
          <ul className="solq-fila__l">
            {api.itens.map((it, i) => (
              <li key={it.chave} className="solq-fila__i" data-estado={it.estado}>
                <IconeClipe tam={12} />
                <span className="solq-fila__n" title={it.nome}>{nomeCurto(it.nome, 28)}</span>
                <small>{it.estado === "subindo" ? `${Math.round(it.fracao * 100)}%` : it.estado === "ok" ? "enviado" : it.estado === "erro" ? "falhou" : tamanhoLegivel(it.tamanho)}</small>
                {!api.enviando && (
                  <button type="button" className="solq-fila__x" aria-label={`Tirar ${it.nome}`} onClick={() => api.remover(i)}>×</button>
                )}
                {it.estado === "subindo" && <span className="solq-fila__barra" style={{ width: `${Math.round(it.fracao * 100)}%` }} aria-hidden />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Área que aceita arquivo arrastado (mostra "Solte para anexar"). */
export function ZonaDeSoltar({ api, children, className, desligada }: { api: FilaDeAnexosApi; children: ReactNode; className?: string; desligada?: boolean }) {
  const [em, setEm] = useState(false);
  const cont = useRef(0);
  const temArquivo = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  if (desligada) return <div className={className}>{children}</div>;
  return (
    <div className={className} data-soltar={em ? "" : undefined}
      onDragEnter={(e) => { if (!temArquivo(e)) return; e.preventDefault(); cont.current++; setEm(true); }}
      onDragOver={(e) => { if (!temArquivo(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={() => { cont.current = Math.max(0, cont.current - 1); if (!cont.current) setEm(false); }}
      onDrop={(e) => { if (!temArquivo(e)) return; e.preventDefault(); cont.current = 0; setEm(false); api.adicionar(e.dataTransfer.files); }}>
      {children}
      {em && <div className="solq-soltar" aria-hidden><IconeClipe tam={22} /> Solte para anexar</div>}
    </div>
  );
}

// ── Miniaturas ──────────────────────────────────────────────────────────────
function Miniatura({ a, links, grande }: { a: AnexoSol; links: Record<string, string>; grande?: boolean }) {
  const tipo = tipoDePrevia(a);
  const url = tipo === "imagem" ? links[a.miniatura ?? ""] ?? (grande || !a.miniatura ? links[a.path] : undefined) : undefined;
  if (url) return <img src={url} alt="" loading="lazy" className="solq-mini__img" />;
  return <IconeArquivo nome={a.nome} />;
}

/** Os arquivos dentro da bolha da mensagem. */
export function AnexosDaMensagem({ anexos, links, onAbrir }: { anexos: AnexoSol[]; links: Record<string, string>; onAbrir: (a: AnexoSol) => void }) {
  if (!anexos.length) return null;
  const fotos = anexos.filter((a) => tipoDePrevia(a) === "imagem");
  const outros = anexos.filter((a) => tipoDePrevia(a) !== "imagem");
  return (
    <div className="solq-anx">
      {fotos.length > 0 && (
        <div className="solq-anx__fotos" data-n={Math.min(fotos.length, 4)}>
          {fotos.slice(0, 4).map((a, i) => (
            <button key={a.id} type="button" className="solq-anx__foto" onClick={() => onAbrir(a)} aria-label={`Ver ${a.nome}`}>
              <Miniatura a={a} links={links} />
              {i === 3 && fotos.length > 4 && <span className="solq-anx__mais">+{fotos.length - 4}</span>}
            </button>
          ))}
        </div>
      )}
      {outros.map((a) => (
        <button key={a.id} type="button" className="solq-arq" onClick={() => onAbrir(a)} aria-label={`Abrir ${a.nome}`}>
          <IconeArquivo nome={a.nome} />
          <span className="solq-arq__tx"><span title={a.nome}>{nomeCurto(a.nome, 34)}</span><small>{tamanhoLegivel(a.tamanho)}</small></span>
        </button>
      ))}
    </div>
  );
}

/** Galeria do pedido: miniaturas grandes + contagem. */
export function GaleriaAnexos({ anexos, links, onAbrir, vazio }: { anexos: AnexoSol[]; links: Record<string, string>; onAbrir: (a: AnexoSol) => void; vazio?: ReactNode }) {
  if (!anexos.length) return <>{vazio ?? null}</>;
  return (
    <ul className="solq-gal">
      {anexos.map((a) => (
        <li key={a.id}>
          <button type="button" className="solq-gal__i" onClick={() => onAbrir(a)} aria-label={`Abrir ${a.nome}`} data-tipo={tipoDePrevia(a)}>
            <span className="solq-gal__m"><Miniatura a={a} links={links} grande /></span>
            <span className="solq-gal__n" title={a.nome}>{nomeCurto(a.nome, 24)}</span>
            <small>{tamanhoLegivel(a.tamanho)}{a.enviado_nome ? ` · ${a.enviado_nome.split(" ")[0]}` : ""}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Visualizador em tela cheia ──────────────────────────────────────────────
export function Visualizador({ anexos, inicial, onFechar, onApagar, podeApagar }: {
  anexos: AnexoSol[];
  inicial: string;
  onFechar: () => void;
  onApagar?: (a: AnexoSol) => Promise<void>;
  podeApagar?: (a: AnexoSol) => boolean;
}) {
  const [i, setI] = useState(() => Math.max(0, anexos.findIndex((a) => a.id === inicial)));
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const a = anexos[Math.min(i, anexos.length - 1)];
  const tipo = a ? tipoDePrevia(a) : "outro";
  const n = anexos.length;
  const ir = useCallback((d: 1 | -1) => setI((x) => (x + d + n) % n), [n]);

  useEffect(() => {
    if (!a) return;
    let vivo = true;
    setUrl(null); setErro(null);
    if (tipo === "outro") return;
    linkDoAnexo(a.path).then((u) => { if (vivo) setUrl(u); }).catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : "Não abriu."); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.path, tipo]);

  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    caixa.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onFechar(); }
      else if (e.key === "ArrowRight" && n > 1) { e.preventDefault(); e.stopPropagation(); ir(1); }
      else if (e.key === "ArrowLeft" && n > 1) { e.preventDefault(); e.stopPropagation(); ir(-1); }
    };
    window.addEventListener("keydown", tecla, true); // captura: o modal de trás não fecha junto
    return () => { window.removeEventListener("keydown", tecla, true); antes?.focus?.(); };
  }, [ir, n, onFechar]);

  if (!a) return null;
  const baixar = async () => {
    try { window.open(await linkDoAnexo(a.path, a.nome), "_blank", "noopener"); } catch (e) { setErro(e instanceof Error ? e.message : "Não baixou."); }
  };

  return createPortal(
    <div className="solq-lb" role="dialog" aria-modal="true" aria-label={`Anexo: ${a.nome}`} ref={caixa} tabIndex={-1}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <header className="solq-lb__h">
        <span className="solq-lb__t"><b title={a.nome}>{a.nome}</b><small>{tamanhoLegivel(a.tamanho)}{a.enviado_nome ? ` · enviado por ${a.enviado_nome.split(" ")[0]}` : ""}{n > 1 ? ` · ${i + 1} de ${n}` : ""}</small></span>
        <button type="button" className="solq-lb__b" onClick={() => void baixar()}>Baixar</button>
        {url && tipo === "pdf" && <a className="solq-lb__b" href={url} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a>}
        {onApagar && podeApagar?.(a) && (
          <button type="button" className="solq-lb__b" data-perigo="" disabled={apagando}
            onClick={() => {
              if (!window.confirm(`Apagar "${a.nome}" do pedido? Não dá pra desfazer.`)) return;
              setApagando(true);
              void onApagar(a).then(() => { if (n <= 1) onFechar(); else setI((x) => Math.max(0, Math.min(x, n - 2))); })
                .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não apagou."))
                .finally(() => setApagando(false));
            }}>{apagando ? "Apagando…" : "Apagar"}</button>
        )}
        <button type="button" className="solq-lb__x" aria-label="Fechar" onClick={onFechar}>×</button>
      </header>
      <div className="solq-lb__corpo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
        {n > 1 && <button type="button" className="solq-lb__seta" data-lado="e" aria-label="Anterior" onClick={() => ir(-1)}>‹</button>}
        {erro ? <p className="solq-lb__msg">{erro}</p>
          : tipo === "outro" ? (
            <div className="solq-lb__msg">
              <IconeArquivo nome={a.nome} />
              <p>Esse formato não tem prévia aqui.</p>
              <button type="button" className="solq-btn solq-btn--pri" onClick={() => void baixar()}>Baixar {rotuloDoFormato(a.nome)}</button>
            </div>
          ) : !url ? <p className="solq-lb__msg">Abrindo…</p>
          : tipo === "imagem" ? <img key={a.id} src={url} alt={a.nome} className="solq-lb__img" />
          : <iframe key={a.id} src={url} title={a.nome} className="solq-lb__pdf" />}
        {n > 1 && <button type="button" className="solq-lb__seta" data-lado="d" aria-label="Próximo" onClick={() => ir(1)}>›</button>}
      </div>
    </div>,
    document.body,
  );
}

/** Estado do visualizador (qual anexo está aberto). */
export function useVisualizador() {
  const [aberto, setAberto] = useState<string | null>(null);
  return useMemo(() => ({ aberto, abrir: (a: AnexoSol) => setAberto(a.id), fechar: () => setAberto(null) }), [aberto]);
}
