// src/mkt/drive/Navegador.tsx
// -----------------------------------------------------------------------------
// O coração do Drive do Marketing: pastas com migalhas, grade/lista com
// miniatura, busca + filtros (no índice local, que tem as tags do QS), envio
// com barra de progresso e nova pasta. Usado pela tela "Drive" (modo "tela") e
// pelo DrivePicker (modo "escolha", em que clicar num arquivo seleciona).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigDrive, FiltrosBusca, ItemDrive, Migalha } from "./tipos";
import { FILTROS_VAZIOS } from "./tipos";
import * as api from "./api";
import { corpoBusca, formatarData, formatarDuracao, formatarTamanho, temFiltro } from "./formato";
import { Botao, Chip, COR, COR_SUAVE, Ic, IconeTipo, Miniatura, Modal, estiloEntrada } from "./ui";

type Visao = "grade" | "lista";
interface Envio { chave: string; nome: string; enviados: number; total: number; estado: "enviando" | "feito" | "erro"; erro?: string; cancelar: AbortController }

function lerVisao(): Visao {
  try { return localStorage.getItem("mkt-drive-visao") === "lista" ? "lista" : "grade"; } catch { return "grade"; }
}

export function Navegador({ modo, config, selecionados, onAlternar, onAbrir, versao = 0 }: {
  modo: "tela" | "escolha";
  config: ConfigDrive | null;
  selecionados?: Set<string>;
  onAlternar?: (item: ItemDrive) => void;
  onAbrir?: (item: ItemDrive, irPara: (pastaId: string | null) => void) => void;
  /** Muda pra forçar recarregar a pasta (ex.: depois de renomear no visualizador). */
  versao?: number;
}) {
  const [pastaId, setPastaId] = useState<string | null>(null);
  const [caminho, setCaminho] = useState<Migalha[]>([]);
  const [itens, setItens] = useState<ItemDrive[]>([]);
  const [proxima, setProxima] = useState<string | null>(null);
  const [proximoOffset, setProximoOffset] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosBusca>(FILTROS_VAZIOS);
  const [textoDigitado, setTextoDigitado] = useState("");
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [visao, setVisao] = useState<Visao>(lerVisao);
  const [aoVivo, setAoVivo] = useState(false); // busca direto no Drive (índice ainda vazio)
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [novaPasta, setNovaPasta] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const pedido = useRef(0);

  const buscando = temFiltro(filtros);

  // Digitação → filtro, com respiro de 350 ms.
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.texto === textoDigitado ? f : { ...f, texto: textoDigitado })), 350);
    return () => clearTimeout(t);
  }, [textoDigitado]);

  const carregar = useCallback(async (mais = false) => {
    const meu = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      if (buscando && aoVivo) {
        const r = await api.buscarNoDrive(filtros.texto, mais ? proxima : null);
        if (meu !== pedido.current) return;
        setItens((v) => (mais ? [...v, ...r.itens] : r.itens));
        setProxima(r.proximaPagina);
        setProximoOffset(null);
      } else if (buscando) {
        const r = await api.buscarIndice(corpoBusca(filtros, pastaId, mais ? proximoOffset ?? 0 : 0));
        if (meu !== pedido.current) return;
        setItens((v) => (mais ? [...v, ...r.itens] : r.itens));
        setProximoOffset(r.proximoOffset);
        setProxima(null);
      } else {
        const r = await api.listarPasta(pastaId, mais ? proxima : null);
        if (meu !== pedido.current) return;
        setItens((v) => (mais ? [...v, ...r.itens] : r.itens));
        if (r.caminho) setCaminho(r.caminho);
        setProxima(r.proximaPagina);
        setProximoOffset(null);
      }
    } catch (e) {
      if (meu === pedido.current) setErro((e as Error).message);
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [buscando, aoVivo, filtros, pastaId, proxima, proximoOffset]);

  // Recarrega quando muda pasta/filtro/versão (não quando muda só o cursor).
  const chaveCarga = JSON.stringify([pastaId, filtros, aoVivo, versao, config?.configurado]);
  useEffect(() => {
    if (!config?.configurado) return;
    void carregar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveCarga]);

  useEffect(() => { setAoVivo(false); }, [filtros]);

  const irPara = useCallback((id: string | null) => {
    setPastaId(id);
    setFiltros(FILTROS_VAZIOS);
    setTextoDigitado("");
  }, []);

  const trocarVisao = (v: Visao) => {
    setVisao(v);
    try { localStorage.setItem("mkt-drive-visao", v); } catch { /* sem armazenamento: tudo bem */ }
  };

  // ── Envio ──
  const enviar = useCallback(async (arquivos: FileList | File[]) => {
    const lista = Array.from(arquivos);
    for (const arq of lista) {
      const chave = `${arq.name}-${arq.size}-${Date.now()}-${Math.random()}`;
      const cancelar = new AbortController();
      setEnvios((v) => [...v, { chave, nome: arq.name, enviados: 0, total: arq.size, estado: "enviando", cancelar }]);
      const mudar = (p: Partial<Envio>) => setEnvios((v) => v.map((e) => (e.chave === chave ? { ...e, ...p } : e)));
      try {
        const item = await api.enviarArquivo(arq, {
          pastaId,
          onProgresso: (enviados, total) => mudar({ enviados, total }),
          sinal: cancelar.signal,
        });
        mudar({ estado: "feito", enviados: arq.size });
        if (!buscando) setItens((v) => (v.some((i) => i.id === item.id) ? v : [...v, item]));
      } catch (e) {
        mudar({ estado: "erro", erro: (e as Error).message });
      }
    }
  }, [pastaId, buscando]);

  // 04/11/2026: o erro ia pra trás do modal (ninguém via) e 2 cliques criavam 2 pastas.
  const [criandoPasta, setCriandoPasta] = useState(false);
  const [erroPasta, setErroPasta] = useState<string | null>(null);
  const fecharNovaPasta = () => { setNovaPasta(null); setErroPasta(null); };
  const criarPasta = async () => {
    const nome = (novaPasta || "").trim();
    if (!nome || criandoPasta) return;
    setCriandoPasta(true); setErroPasta(null);
    try {
      const { item } = await api.criarPasta(nome, pastaId);
      setNovaPasta(null);
      setItens((v) => [item, ...v]);
    } catch (e) {
      setErroPasta((e as Error).message);
    } finally { setCriandoPasta(false); }
  };

  const clicar = (i: ItemDrive) => {
    if (i.tipo === "pasta") return irPara(i.id);
    if (modo === "escolha") return onAlternar?.(i);
    onAbrir?.(i, irPara);
  };

  const pastas = useMemo(() => itens.filter((i) => i.tipo === "pasta"), [itens]);
  const arquivos = useMemo(() => itens.filter((i) => i.tipo !== "pasta"), [itens]);
  const temMais = buscando && !aoVivo ? proximoOffset != null : !!proxima;
  const enviosAtivos = envios;

  if (config && !config.configurado) {
    return (
      <div className="rounded-xl p-5 text-[13.5px]" style={{ background: "var(--warn-bg)", border: "1px solid var(--warn-line)", color: "var(--warn-ink)" }}>
        <p className="font-bold mb-1">O Drive do Marketing ainda não está ligado.</p>
        <p>{config.falta}</p>
        <p className="mt-2">O passo a passo está em <code>docs/MARKETING-DRIVE.md</code> (Drive compartilhado, conta de serviço e as variáveis na Vercel).</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 min-w-0"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastando(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setArrastando(false); void enviar(e.dataTransfer.files); } }}
    >
      {/* Migalhas */}
      <nav aria-label="Pastas" className="flex items-center flex-wrap gap-0.5 text-[13px] min-w-0">
        {(caminho.length ? caminho : [{ id: "", nome: config?.raiz?.nome || "Marketing" }]).map((m, i, arr) => (
          <span key={m.id || "raiz"} className="inline-flex items-center gap-0.5 min-w-0">
            {i > 0 && <span style={{ color: "var(--ink3)" }}>{Ic.seta()}</span>}
            <button
              type="button"
              onClick={() => irPara(i === 0 ? null : m.id)}
              className="px-1.5 py-0.5 rounded-md truncate max-w-[180px] hover:underline"
              style={{ color: i === arr.length - 1 && !buscando ? "var(--ink)" : "var(--ink2)", fontWeight: i === arr.length - 1 ? 700 : 500 }}
              aria-current={i === arr.length - 1 ? "page" : undefined}
            >
              {m.nome}
            </button>
          </span>
        ))}
        {buscando && <span className="ml-1 text-[12px]" style={{ color: "var(--ink3)" }}>· resultados da busca</span>}
      </nav>

      {/* Barra */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[180px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--ink3)" }}>{Ic.busca()}</span>
          <input
            type="search"
            value={textoDigitado}
            onChange={(e) => setTextoDigitado(e.target.value)}
            placeholder="Buscar por nome, tag ou observação"
            aria-label="Buscar no Drive"
            style={{ ...estiloEntrada, paddingLeft: 32 }}
          />
        </label>
        <Botao onClick={() => setMostrarFiltros((v) => !v)} aria-expanded={mostrarFiltros} style={mostrarFiltros ? { background: COR_SUAVE } : undefined}>
          {Ic.filtro()} <span className="hidden sm:inline">Filtros</span>
        </Botao>
        <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }} role="group" aria-label="Visualização">
          {(["grade", "lista"] as Visao[]).map((v) => (
            <button key={v} type="button" onClick={() => trocarVisao(v)} aria-pressed={visao === v} aria-label={v === "grade" ? "Grade" : "Lista"}
              className="px-2.5 py-2" style={{ background: visao === v ? COR_SUAVE : "var(--card)", color: visao === v ? "var(--ink)" : "var(--ink3)" }}>
              {v === "grade" ? Ic.grade() : Ic.lista()}
            </button>
          ))}
        </div>
        <Botao onClick={() => inputArquivo.current?.click()} variante={modo === "tela" ? "primario" : "secundario"}>
          {Ic.subir()} <span className="hidden sm:inline">Subir</span>
        </Botao>
        {modo === "tela" && (
          <Botao onClick={() => setNovaPasta("")}>{Ic.novaPasta()} <span className="hidden sm:inline">Nova pasta</span></Botao>
        )}
        <input ref={inputArquivo} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void enviar(e.target.files); e.target.value = ""; }} />
      </div>

      {/* Filtros */}
      {mostrarFiltros && (
        <div className="rounded-xl p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
          <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
            Tipo
            <select value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value as FiltrosBusca["tipo"] })} style={{ ...estiloEntrada, marginTop: 4 }}>
              <option value="">Todos</option>
              <option value="video">Vídeos</option>
              <option value="imagem">Imagens</option>
              <option value="audio">Áudios</option>
              <option value="pdf">PDFs</option>
              <option value="documento">Documentos Google</option>
              <option value="pasta">Pastas</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
            Expedição / destino
            <select value={filtros.expedicaoId} onChange={(e) => setFiltros({ ...filtros, expedicaoId: e.target.value })} style={{ ...estiloEntrada, marginTop: 4 }}>
              <option value="">Todas</option>
              {(config?.expedicoes || []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
            Modificado desde
            <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} style={{ ...estiloEntrada, marginTop: 4 }} />
          </label>
          <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
            Até
            <input type="date" value={filtros.ate} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })} style={{ ...estiloEntrada, marginTop: 4 }} />
          </label>
          {!!config?.tags.length && (
            <div className="sm:col-span-2 lg:col-span-4">
              <span className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Tags (precisa ter todas as marcadas)</span>
              <div className="flex flex-wrap gap-1.5">
                {config.tags.slice(0, 40).map((t) => {
                  const ativo = filtros.tags.includes(t.tag);
                  return (
                    <Chip key={t.tag} ativo={ativo} onClick={() => setFiltros({ ...filtros, tags: ativo ? filtros.tags.filter((x) => x !== t.tag) : [...filtros.tags, t.tag] })}>
                      #{t.tag} <span style={{ opacity: 0.7 }}>{t.quantos}</span>
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
              <input type="checkbox" checked={filtros.soNestaPasta} onChange={(e) => setFiltros({ ...filtros, soNestaPasta: e.target.checked })} />
              Só nesta pasta (e subpastas)
            </label>
            <Botao variante="fantasma" onClick={() => { setFiltros(FILTROS_VAZIOS); setTextoDigitado(""); }}>Limpar filtros</Botao>
          </div>
        </div>
      )}

      {/* Envios em andamento */}
      {enviosAtivos.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Envios">
          {enviosAtivos.map((e) => {
            const pct = e.total ? Math.round((e.enviados / e.total) * 100) : 0;
            return (
              <li key={e.chave} className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold" style={{ color: "var(--ink)" }}>{e.nome}</span>
                  <span className="flex-shrink-0 flex items-center gap-2" style={{ color: e.estado === "erro" ? "var(--err-ink)" : "var(--ink3)" }}>
                    {e.estado === "enviando" && `${pct}% · ${formatarTamanho(e.enviados)} de ${formatarTamanho(e.total)}`}
                    {e.estado === "feito" && "Enviado"}
                    {e.estado === "erro" && e.erro}
                    {e.estado === "enviando"
                      ? <button type="button" className="underline" onClick={() => e.cancelar.abort()}>Cancelar</button>
                      : <button type="button" aria-label="Tirar da lista" onClick={() => setEnvios((v) => v.filter((x) => x.chave !== e.chave))}>×</button>}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Envio de ${e.nome}`}>
                  <div className="h-full transition-[width]" style={{ width: `${e.estado === "feito" ? 100 : pct}%`, background: e.estado === "erro" ? "var(--red)" : COR }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {arrastando && (
        <div className="rounded-xl p-6 text-center text-[13.5px] font-semibold" style={{ border: `2px dashed ${COR}`, background: COR_SUAVE, color: "var(--ink)" }}>
          Solte aqui pra subir em “{caminho[caminho.length - 1]?.nome || "Marketing"}”
        </div>
      )}

      {erro && <p className="text-[13px] rounded-lg px-3 py-2" role="alert" style={{ background: "var(--err-bg)", color: "var(--err-ink)" }}>{erro}</p>}

      {/* Conteúdo */}
      {!carregando && !erro && itens.length === 0 && (
        <div className="rounded-xl p-8 text-center text-[13.5px]" style={{ border: "1px dashed var(--line)", color: "var(--ink3)" }}>
          {buscando ? (
            <>
              <p>Nada encontrado no índice com esses filtros.</p>
              {filtros.texto && !aoVivo && (
                <Botao className="mt-3" onClick={() => setAoVivo(true)}>{Ic.busca()} Buscar “{filtros.texto}” direto no Drive</Botao>
              )}
            </>
          ) : (
            <p>Pasta vazia. Arraste arquivos pra cá ou use “Subir”.</p>
          )}
        </div>
      )}

      {visao === "grade" ? (
        <div className="flex flex-col gap-3">
          {pastas.length > 0 && (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {pastas.map((p) => (
                <button key={p.id} type="button" onClick={() => clicar(p)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold min-w-0 hover:shadow-sm"
                  style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}>
                  <IconeTipo tipo="pasta" /> <span className="truncate">{p.nome}</span>
                </button>
              ))}
            </div>
          )}
          {arquivos.length > 0 && (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {arquivos.map((a) => {
                const sel = !!selecionados?.has(a.id);
                const dur = formatarDuracao(a.duracaoMs);
                return (
                  <button key={a.id} type="button" onClick={() => clicar(a)} aria-pressed={modo === "escolha" ? sel : undefined}
                    className="group text-left rounded-xl overflow-hidden min-w-0 hover:shadow-md transition-shadow"
                    style={{ background: "var(--card)", border: `${sel ? 2 : 1}px solid ${sel ? COR : "var(--line)"}` }}>
                    <div className="relative aspect-video">
                      <Miniatura url={a.miniaturaUrl} tipo={a.tipo} alt="" className="w-full h-full" />
                      {dur && <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[11px] font-semibold" style={{ background: "rgba(0,0,0,.7)", color: "#fff" }}>{dur}</span>}
                      {modo === "escolha" && (
                        <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-md flex items-center justify-center" style={{ background: sel ? COR : "rgba(255,255,255,.9)", color: "#fff", border: sel ? "none" : "1px solid var(--line)" }}>
                          {sel && Ic.check()}
                        </span>
                      )}
                    </div>
                    <div className="px-2.5 py-2">
                      <p className="text-[12.5px] font-semibold truncate" style={{ color: "var(--ink)" }} title={a.nome}>{a.nome}</p>
                      <p className="text-[11px] truncate" style={{ color: "var(--ink3)" }}>
                        {formatarData(a.modificadoEm)}{a.tamanho ? ` · ${formatarTamanho(a.tamanho)}` : ""}
                      </p>
                      {a.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 overflow-hidden">{a.tags.slice(0, 3).map((t) => <Chip key={t}>#{t}</Chip>)}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        itens.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
            <ul>
              {itens.map((a) => {
                const sel = !!selecionados?.has(a.id);
                return (
                  <li key={a.id} className="border-b last:border-b-0" style={{ borderColor: "var(--line2)" }}>
                    <button type="button" onClick={() => clicar(a)} aria-pressed={modo === "escolha" && a.tipo !== "pasta" ? sel : undefined}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--card2)]"
                      style={sel ? { background: COR_SUAVE } : undefined}>
                      <Miniatura url={a.tipo === "pasta" ? null : a.miniaturaUrl} tipo={a.tipo} alt="" className="w-14 h-9 rounded flex-shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{a.nome}</span>
                        <span className="block text-[11.5px] truncate sm:hidden" style={{ color: "var(--ink3)" }}>{formatarData(a.modificadoEm)}</span>
                        {a.tags.length > 0 && <span className="block text-[11px] truncate" style={{ color: "var(--ink3)" }}>{a.tags.map((t) => `#${t}`).join(" ")}</span>}
                      </span>
                      <span className="hidden sm:block w-20 text-[12px] text-right" style={{ color: "var(--ink3)" }}>{a.tipo === "pasta" ? "" : formatarDuracao(a.duracaoMs) || formatarTamanho(a.tamanho)}</span>
                      <span className="hidden sm:block w-24 text-[12px] text-right" style={{ color: "var(--ink3)" }}>{formatarData(a.modificadoEm)}</span>
                      {modo === "escolha" && a.tipo !== "pasta" && <span style={{ color: sel ? COR : "var(--line)" }}>{Ic.check()}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}

      {carregando && <p className="text-[13px] py-4 text-center" style={{ color: "var(--ink3)" }} aria-live="polite">Carregando…</p>}
      {!carregando && temMais && (
        <div className="flex justify-center"><Botao onClick={() => void carregar(true)}>Carregar mais</Botao></div>
      )}

      <Modal aberto={novaPasta !== null} titulo="Nova pasta" onFechar={fecharNovaPasta} largura={420}
        rodape={<><Botao onClick={fecharNovaPasta}>Cancelar</Botao><Botao variante="primario" onClick={() => void criarPasta()} disabled={!novaPasta?.trim() || criandoPasta}>{criandoPasta ? "Criando…" : "Criar"}</Botao></>}>
        {erroPasta && <p className="text-[12.5px] mb-2" role="alert" style={{ color: "var(--err-ink)" }}>{erroPasta}</p>}
        <label className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
          Nome da pasta (dentro de “{caminho[caminho.length - 1]?.nome || "Marketing"}”)
          <input autoFocus value={novaPasta ?? ""} onChange={(e) => setNovaPasta(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void criarPasta(); }}
            style={{ ...estiloEntrada, marginTop: 6 }} maxLength={250} />
        </label>
      </Modal>
    </div>
  );
}
