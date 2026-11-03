// src/propostas/MontarComIa.tsx
// -----------------------------------------------------------------------------
// Passo 1 da proposta (0290, Bruno 03/11/2026): "os Closers vão subindo
// informações, como prints de voos e etc e ele preenche tudo sozinho".
// Uma área grande pra soltar/colar prints e PDFs, colar texto (WhatsApp,
// e-mail do fornecedor) e dizer o que o cliente pediu. "Montar com IA" lê tudo
// (api/proposta-ia.js) e a tela mescla no rascunho (iaMescla.ts). Dá pra subir
// mais um print e rodar de novo: o que o closer editou à mão não é trocado.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { Aviso, Botao } from "@/rel/ui";
import type { Proposta } from "./lib";
import { MODELOS } from "./modelos";
import { marcasDe } from "./iaMescla";
import { apagarInsumo, colarTexto, lerComIa, linkDoInsumo, listarInsumos, subirArquivo, type Insumo, type RespostaIa } from "./ia";

const kb = (n: number | null) => (!n ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function MontarComIa({ p, garantirId, onLido, onPular }: {
  p: Proposta;
  /** Proposta nova ainda sem id: salva o rascunho antes de subir o 1º insumo. */
  garantirId: () => Promise<string | null>;
  onLido: (r: RespostaIa, pedido: string) => void;
  onPular: () => void;
}) {
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [subindo, setSubindo] = useState(0);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [texto, setTexto] = useState("");
  const [pedido, setPedido] = useState(() => marcasDe(p)?.pedido ?? "");
  const [arrastando, setArrastando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const marcas = marcasDe(p);

  const recarregar = useCallback(async (id = p.id) => {
    if (!id) return;
    try { setInsumos(await listarInsumos(id)); } catch (e) { setErro(e instanceof Error ? e.message : "Não listou os insumos."); }
  }, [p.id]);
  useEffect(() => { void recarregar(); }, [recarregar]);

  async function subir(files: File[]) {
    if (!files.length) return;
    setErro(null);
    const id = await garantirId();
    if (!id) return;
    setSubindo((n) => n + files.length);
    const erros: string[] = [];
    await Promise.all(files.map(async (f) => {
      try { await subirArquivo(id, f); } catch (e) { erros.push(e instanceof Error ? e.message : `Não subiu "${f.name}".`); }
      finally { setSubindo((n) => n - 1); }
    }));
    if (erros.length) setErro(erros.join(" "));
    await recarregar(id);
  }
  async function adicionarTexto(t = texto) {
    if (!t.trim()) return;
    setErro(null);
    const id = await garantirId();
    if (!id) return;
    try { await colarTexto(id, t); setTexto(""); await recarregar(id); } catch (e) { setErro(e instanceof Error ? e.message : "Não guardou o texto."); }
  }
  async function tirar(i: Insumo) {
    try { await apagarInsumo(i); setInsumos((l) => l.filter((x) => x.id !== i.id)); } catch (e) { setErro(e instanceof Error ? e.message : "Não tirou."); }
  }
  async function abrir(i: Insumo) {
    const u = await linkDoInsumo(i);
    if (u) window.open(u, "_blank", "noopener");
  }
  async function montar() {
    if (!p.modelo) return;
    setErro(null); setAvisos([]);
    const id = await garantirId();
    if (!id) return;
    setLendo(true);
    try {
      const r = await lerComIa(id, p.modelo, pedido.trim());
      setAvisos(r.avisos ?? []);
      onLido(r, pedido.trim());
      void recarregar(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "A IA não conseguiu ler."); }
    finally { setLendo(false); }
  }

  // Ctrl+V com print na área de transferência → sobe; texto vai pra caixa de texto
  function colar(e: React.ClipboardEvent) {
    const files = [...e.clipboardData.files];
    if (files.length) { e.preventDefault(); void subir(files); }
  }

  const novos = insumos.filter((i) => !i.lido_em).length;
  const temAlgo = insumos.length > 0 || !!pedido.trim();
  return (
    <section className="space-y-4" onPaste={colar}>
      <div className="rel-card p-5 space-y-4">
        <div>
          <h2 className="text-[17px] font-bold" style={{ color: "var(--ink)" }}>Montar com IA</h2>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Suba os prints e PDFs da cotação ({p.modelo ? MODELOS[p.modelo].rotulo.toLowerCase() : "proposta"}): voos, hotel, passeios, seguro, tela da consolidadora.
            A IA preenche a proposta só com o que está neles — o que não achar fica vazio pra você completar.
          </p>
        </div>

        <div
          role="button" tabIndex={0} aria-label="Soltar ou escolher prints e PDFs"
          onClick={() => arquivo.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); arquivo.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); void subir([...e.dataTransfer.files]); }}
          className="rounded-xl px-6 py-10 text-center cursor-pointer transition-colors"
          style={{ border: `2px dashed ${arrastando ? "var(--rel)" : "var(--line)"}`, background: arrastando ? "var(--rel-soft)" : "var(--card2)" }}>
          <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{subindo ? `Subindo ${subindo}…` : "Solte aqui os prints e PDFs"}</p>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--ink3)" }}>ou clique pra escolher · ou cole um print com Ctrl+V · imagem ou PDF, até 10 MB cada</p>
          <input ref={arquivo} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden"
            onChange={(e) => { void subir([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>

        {insumos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {insumos.map((i) => (
              <li key={i.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] max-w-full" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
                <span aria-hidden>{i.tipo === "texto" ? "📝" : i.mime === "application/pdf" ? "📄" : "🖼️"}</span>
                {i.tipo === "arquivo"
                  ? <button type="button" className="truncate max-w-[220px] underline-offset-2 hover:underline" style={{ color: "var(--ink)" }} onClick={() => void abrir(i)}>{i.arquivo_nome}</button>
                  : <span className="truncate max-w-[260px]" style={{ color: "var(--ink)" }} title={i.texto ?? ""}>{(i.texto ?? "").slice(0, 60)}</span>}
                <span style={{ color: "var(--ink3)" }}>{i.tipo === "arquivo" ? kb(i.tamanho) : `${(i.texto ?? "").length} car.`}{i.lido_em ? " · lido" : ""}</span>
                <button type="button" onClick={() => void tirar(i)} aria-label="Tirar insumo" className="px-1" style={{ color: "var(--ink3)" }}>×</button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Colar texto (conversa do WhatsApp, e-mail do fornecedor…)</span>
            <textarea className="rel-input" rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cole aqui e clique em Adicionar" />
            <Botao className="mt-1.5" onClick={() => void adicionarTexto()} disabled={!texto.trim()}>Adicionar texto</Botao>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>O que o cliente pediu (opcional)</span>
            <textarea className="rel-input" rows={4} value={pedido} onChange={(e) => setPedido(e.target.value)}
              placeholder="Ex.: casal, Cancún all inclusive na 2ª quinzena de agosto, saindo de Fortaleza, até R$ 30 mil" />
          </label>
        </div>

        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {avisos.length > 0 && <Aviso>{avisos.map((a, n) => <span key={n} className="block">{a}</span>)}</Aviso>}

        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="primario" onClick={() => void montar()} disabled={lendo || subindo > 0 || !temAlgo || !p.modelo} style={{ padding: "10px 18px", fontSize: 14 }}>
            {lendo ? `Lendo ${insumos.length} insumo${insumos.length === 1 ? "" : "s"}… (uns 20 a 40 s)` : marcas ? `Ler de novo${novos ? ` (${novos} novo${novos === 1 ? "" : "s"})` : ""}` : "Montar com IA"}
          </Botao>
          <Botao variante="fantasma" onClick={onPular}>{marcas ? "Ir pra revisão →" : "Preencher à mão →"}</Botao>
          {marcas && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Ao ler de novo, o que você editou à mão fica como está.</span>}
        </div>
      </div>
    </section>
  );
}
