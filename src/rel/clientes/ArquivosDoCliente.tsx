// src/rel/clientes/ArquivosDoCliente.tsx
// -----------------------------------------------------------------------------
// "Arquivos e fotos" da ficha: imagens e arquivos soltos do cliente (foto da
// viagem, print de conversa, comprovante avulso…). Fica no bucket PRIVADO
// rel-documentos — as miniaturas usam link assinado de 10 minutos, renovado
// sozinho a cada 8 (e quando uma imagem falha); "Abrir"/"Baixar" geram um
// link novo na hora do clique, então a ficha aberta por horas não quebra.
// Documento de viagem (passaporte, visto, vacina) continua em "Documentos".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { apagarArquivo, linkNaHora, linksAssinados, listarArquivos, subirArquivo, type Arquivo } from "../lib/clientes";
import { Aviso, Botao } from "../ui";

/** HEIC/HEIF (foto do iPhone): o navegador não desenha — mostra como arquivo. */
const semPrevia = (a: Arquivo) => /heic|heif/i.test(a.mime ?? "") || /.(heic|heif)$/i.test(a.arquivo_nome ?? "");

const tamanho = (b: number | null) => (!b ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function ArquivosDoCliente({ clienteId, bloqueado }: { clienteId: string; bloqueado?: boolean }) {
  const [lista, setLista] = useState<Arquivo[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [subindo, setSubindo] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [ver, setVer] = useState<Arquivo | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const renovadoEm = useRef(0);

  // Renova os links das miniaturas (vencem em 10 min).
  const renovarLinks = useCallback(async (l: Arquivo[]) => {
    renovadoEm.current = Date.now();
    try { setLinks(await linksAssinados(l.filter((a) => a.tipo === "foto" && !semPrevia(a)).map((a) => a.arquivo_path))); }
    catch { /* miniatura sem link vira "sem prévia"; Abrir/Baixar geram link próprio */ }
  }, []);

  const carregar = useCallback(async () => {
    try {
      const l = await listarArquivos(clienteId);
      setLista(l);
      await renovarLinks(l);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar os arquivos.");
      setLista([]);
    }
  }, [clienteId, renovarLinks]);

  useEffect(() => { setLista(null); void carregar(); }, [carregar]);

  useEffect(() => {
    if (!lista?.length) return;
    const t = window.setInterval(() => { void renovarLinks(lista); }, 8 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [lista, renovarLinks]);

  /** Imagem que não carregou (link venceu): renova, no máximo 1x a cada 30s. */
  function imagemFalhou() {
    if (lista && Date.now() - renovadoEm.current > 30_000) void renovarLinks(lista);
  }

  /** Abre ou baixa com link novo. A aba abre ANTES do await pra não cair no bloqueio de pop-up. */
  async function abrir(a: Arquivo, baixar = false) {
    const aba = baixar ? null : window.open("", "_blank");
    try {
      const url = await linkNaHora(a.arquivo_path, baixar ? (a.arquivo_nome ?? "arquivo") : undefined);
      if (aba) { aba.opener = null; aba.location.href = url; } else window.location.assign(url);
    } catch (e) {
      aba?.close();
      setErro(e instanceof Error ? e.message : "Não consegui abrir o arquivo.");
    }
  }

  async function subir(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setErro(null);
    setSubindo(arr.length);
    const falhas: string[] = [];
    for (const f of arr) {
      try { await subirArquivo(clienteId, f); } catch (e) { falhas.push(e instanceof Error ? e.message : f.name); }
      setSubindo((n) => n - 1);
    }
    if (falhas.length) setErro(falhas.join(" · "));
    await carregar();
  }

  async function apagar(a: Arquivo) {
    if (!window.confirm(`Apagar "${a.arquivo_nome ?? "arquivo"}"? Não dá pra desfazer.`)) return;
    try { await apagarArquivo(a); setVer(null); await carregar(); } catch (e) { setErro(e instanceof Error ? e.message : "Não apagou."); }
  }

  // Esc fecha a foto grande (igual ao Modal).
  useEffect(() => {
    if (!ver) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setVer(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [ver]);

  const fotos = (lista ?? []).filter((a) => a.tipo === "foto" && !semPrevia(a));
  const outros = (lista ?? []).filter((a) => a.tipo !== "foto" || semPrevia(a));

  return (
    <section
      className="rel-card p-4 sm:p-5"
      onDragOver={(e) => { if (bloqueado) return; e.preventDefault(); setArrastando(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastando(false); }}
      onDrop={(e) => { if (bloqueado) return; e.preventDefault(); setArrastando(false); void subir(e.dataTransfer.files); }}
      style={arrastando ? { outline: "2px dashed var(--rel)", outlineOffset: -4, background: "var(--rel-soft)" } : undefined}
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Arquivos e fotos</h2>
        {!bloqueado && (
          <>
            <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} disabled={subindo > 0} onClick={() => input.current?.click()}>
              {subindo > 0 ? `Subindo ${subindo}…` : "+ Adicionar"}
            </Botao>
            <input ref={input} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" className="hidden"
              onChange={(e) => { if (e.target.files) void subir(e.target.files); e.target.value = ""; }} />
          </>
        )}
      </div>
      {erro && <div className="mb-2"><Aviso tom="erro">{erro}</Aviso></div>}

      {lista === null ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>
          Nenhum arquivo ainda. Clique em "+ Adicionar" ou arraste imagens e arquivos pra cá.
        </p>
      ) : (
        <>
          {fotos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
              {fotos.map((a) => (
                <button key={a.id} onClick={() => setVer(a)} className="group relative aspect-square rounded-lg overflow-hidden flex items-center justify-center"
                  style={{ background: "var(--card2)", border: "1px solid var(--line)" }} title={a.arquivo_nome ?? ""} aria-label={`Ver foto ${a.arquivo_nome ?? ""}`}>
                  {links[a.arquivo_path]
                    ? <img src={links[a.arquivo_path]} alt="" loading="lazy" onError={imagemFalhou} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" style={{ transitionTimingFunction: "cubic-bezier(.25,1,.5,1)" }} />
                    : <span className="text-[11px]" style={{ color: "var(--ink3)" }}>sem prévia</span>}
                </button>
              ))}
            </div>
          )}
          {outros.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-1.5">
              <span className="text-[10px] font-bold uppercase w-10 text-center py-1 rounded" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
                {(a.arquivo_nome?.split(".").pop() || "arq").slice(0, 4)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] truncate" style={{ color: "var(--ink)" }}>{a.arquivo_nome}</span>
                <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>
                  {new Date(a.enviado_em).toLocaleDateString("pt-BR")} · {tamanho(a.tamanho)}
                </span>
              </span>
              <button type="button" onClick={() => void abrir(a)} className="text-[12px] font-semibold underline min-h-[32px] px-1" style={{ color: "var(--rel-ink)" }}>Abrir</button>
              <button type="button" onClick={() => void abrir(a, true)} className="text-[12px] font-semibold underline min-h-[32px] px-1" style={{ color: "var(--rel-ink)" }}>Baixar</button>
              {!bloqueado && <Botao variante="fantasma" onClick={() => apagar(a)} aria-label={`Apagar ${a.arquivo_nome ?? "arquivo"}`}>Apagar</Botao>}
            </div>
          ))}
        </>
      )}

      {/* Foto em tamanho grande */}
      {ver && links[ver.arquivo_path] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Foto">
          <div className="absolute inset-0" style={{ background: "rgba(15,20,26,.8)" }} onClick={() => setVer(null)} />
          <div className="relative max-w-4xl w-full flex flex-col items-center gap-3">
            <img src={links[ver.arquivo_path]} alt={ver.arquivo_nome ?? "foto"} onError={imagemFalhou} className="max-h-[78vh] max-w-full rounded-lg" />
            <div className="flex gap-2">
              <button type="button" onClick={() => void abrir(ver, true)}
                className="inline-flex items-center justify-center px-3.5 py-2 rounded-lg text-[13px] font-semibold hover:opacity-90"
                style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}>
                Baixar
              </button>
              {!bloqueado && <Botao variante="perigo" onClick={() => apagar(ver)}>Apagar</Botao>}
              <Botao onClick={() => setVer(null)} autoFocus>Fechar</Botao>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
