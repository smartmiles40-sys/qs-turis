// src/expedicoes/drive/Drive.tsx
// Drive de arquivos (app antigo: components/arquivos/Drive.tsx). Usado na aba
// Documentos (arquivos da expedição, sem passageiro) e no perfil do passageiro
// (arquivos daquele pax). Pastas = categorias de `arquivos`. Sobe arrastando ou
// escolhendo (imagem é comprimida antes), abre/baixa por link assinado, e — o
// que o antigo não tinha — renomeia e move de pasta. Arquivos de sistema lidos
// pelo /amigo e /lider ("Documento do líder", "Ingresso Machu Picchu") não podem
// ser apagados por aqui.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Botao, Campo, Entrada, Modal } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, Carregando, Selo, useAoVivo } from "../ui";
import { supabase, lerTudo, traduzirErro } from "../lib/banco";
import { CATEGORIA_ARQUIVO, type CategoriaArquivo } from "../lib/constants";
import type { ArquivoRow } from "../lib/database";
import { formatDate } from "../lib/utils";
import { abrirArquivo, arquivoProtegido, baixarArquivo, enviarArquivo, excluirArquivo, formatarTamanho, linksEmLote, usadoNoPortal } from "./arquivos";
import { IconeCategoria, IconeSvg } from "./icones";

export interface PropsDrive {
  expedicaoId: string;
  /** quando vem, mostra só as pastas/arquivos desse passageiro */
  passageiroId?: string | null;
  /** esconde upload/renomear/excluir */
  somenteLeitura?: boolean;
  /** pasta aberta ao montar (ex.: "Bilhetes") */
  pastaInicial?: string;
  /** pastas que aparecem (padrão: todas) */
  categorias?: readonly CategoriaArquivo[];
  /** avisa quem usa o Drive que algo mudou (ex.: recalcular prontidão) */
  onMudou?: () => void;
}

type Pasta = CategoriaArquivo | "Todos";

export default function Drive({ expedicaoId, passageiroId = null, somenteLeitura: soLerProp, pastaInicial, categorias = CATEGORIA_ARQUIVO, onMudou }: PropsDrive) {
  const { somenteLeitura: soLerCtx, avisar } = useExp();
  const soLer = soLerCtx || Boolean(soLerProp);
  const inicial = (categorias as readonly string[]).includes(pastaInicial ?? "") ? (pastaInicial as CategoriaArquivo) : "Todos";
  const [pasta, setPasta] = useState<Pasta>(inicial);
  const [arquivos, setArquivos] = useState<ArquivoRow[] | null>(null);
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState<{ feitos: number; total: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [preview, setPreview] = useState<{ arq: ArquivoRow; url: string } | null>(null);
  const [editando, setEditando] = useState<ArquivoRow | null>(null);
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try {
      const lista = await lerTudo<ArquivoRow>("arquivos", (q) => {
        const base = q.eq("expedicao_id", expedicaoId);
        return passageiroId ? base.eq("passageiro_id", passageiroId) : base.is("passageiro_id", null);
      });
      lista.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setArquivos(lista);
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao carregar arquivos", "erro"); setArquivos([]); }
  }, [expedicaoId, passageiroId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "arquivos", filtro: `expedicao_id=eq.${expedicaoId}` }], carregar);

  // Miniaturas das imagens visíveis (link assinado de 1h).
  useEffect(() => {
    const faltam = (arquivos ?? []).filter((a) => a.mime?.startsWith("image/") && !miniaturas[a.storage_path]).map((a) => a.storage_path);
    if (!faltam.length) return;
    linksEmLote(faltam).then((m) => setMiniaturas((s) => ({ ...s, ...m }))).catch(() => {});
  }, [arquivos]); // eslint-disable-line react-hooks/exhaustive-deps

  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of arquivos ?? []) m.set(a.categoria, (m.get(a.categoria) ?? 0) + 1);
    return m;
  }, [arquivos]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (arquivos ?? []).filter((a) => (pasta === "Todos" || a.categoria === pasta) && (!t || a.nome.toLowerCase().includes(t) || (a.descricao ?? "").toLowerCase().includes(t)));
  }, [arquivos, pasta, busca]);

  async function subir(lista: FileList | File[]) {
    const fs = Array.from(lista);
    if (!fs.length || soLer) return;
    const categoria: CategoriaArquivo = pasta === "Todos" ? "Outros" : pasta;
    let ok = 0;
    const falhas: string[] = [];
    setEnviando({ feitos: 0, total: fs.length });
    for (const [i, f] of fs.entries()) {
      try { await enviarArquivo({ expedicaoId, passageiroId, categoria, arquivo: f }); ok++; }
      catch (e) { falhas.push(e instanceof Error ? e.message : `Falhou: ${f.name}`); }
      setEnviando({ feitos: i + 1, total: fs.length });
    }
    setEnviando(null);
    if (falhas.length) avisar(`${ok} enviado(s), ${falhas.length} com erro — ${falhas[0]}`, "erro");
    else avisar(`${ok} arquivo${ok > 1 ? "s" : ""} enviado${ok > 1 ? "s" : ""} em ${categoria}`);
    await carregar();
    onMudou?.();
  }

  async function verImagem(a: ArquivoRow) {
    try {
      const url = miniaturas[a.storage_path] ?? (await linksEmLote([a.storage_path]))[a.storage_path];
      if (!url) throw new Error("Não foi possível abrir a imagem.");
      setPreview({ arq: a, url });
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao abrir", "erro"); }
  }
  async function abrir(a: ArquivoRow) {
    if (a.mime?.startsWith("image/")) return verImagem(a);
    try { await abrirArquivo(a.storage_path); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao abrir", "erro"); }
  }
  async function baixar(a: ArquivoRow) {
    try { await baixarArquivo(a.storage_path, a.nome); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao baixar", "erro"); }
  }

  return (
    <div className="space-y-3">
      {/* Pastas */}
      <div className="flex flex-wrap gap-1.5 items-center" role="tablist" aria-label="Pastas">
        <ChipPasta rotulo="Todos" ativa={pasta === "Todos"} n={arquivos?.length ?? 0} onClick={() => setPasta("Todos")} />
        {categorias.map((c) => (
          <ChipPasta key={c} rotulo={c} ativa={pasta === c} n={contagem.get(c) ?? 0} onClick={() => setPasta(c)} icone={<IconeCategoria categoria={c} />} />
        ))}
      </div>

      {/* Envio */}
      {!soLer && (
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); if (e.dataTransfer.files.length) void subir(e.dataTransfer.files); }}
          className="rounded-xl border-2 border-dashed p-3.5 transition-colors"
          style={{ borderColor: arrastando ? "var(--rel)" : "var(--line)", background: arrastando ? "var(--rel-soft)" : "var(--card2)", opacity: enviando ? 0.7 : 1 }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
              <IconeSvg nome="upload" />
              {enviando ? <>Enviando {enviando.feitos}/{enviando.total}…</> : <>Arraste arquivos aqui ou clique pra selecionar</>}
              <span style={{ color: "var(--ink3)" }}>· vai para a pasta <strong style={{ color: "var(--ink)" }}>{pasta === "Todos" ? "Outros" : pasta}</strong></span>
            </div>
            <Botao variante="primario" onClick={() => inputRef.current?.click()} disabled={Boolean(enviando)}>
              {enviando ? "Enviando…" : "Selecionar arquivos"}
            </Botao>
            <input ref={inputRef} type="file" multiple className="hidden"
              onChange={(e) => { if (e.target.files) void subir(e.target.files); e.target.value = ""; }} />
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: "var(--ink3)" }}>PDF, imagem, Word, Excel ou CSV · até 15 MB · fotos grandes são reduzidas automaticamente.</p>
        </div>
      )}

      {(arquivos?.length ?? 0) > 8 && (
        <input type="search" className="rel-input" placeholder="Procurar arquivo pelo nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      )}

      {/* Lista */}
      {arquivos === null ? <Carregando /> : visiveis.length === 0 ? (
        <div className="text-center text-[12.5px] py-8 rounded-xl border border-dashed" style={{ color: "var(--ink3)", borderColor: "var(--line)" }}>
          {busca ? "Nenhum arquivo com esse nome." : pasta === "Todos" ? "Nenhum arquivo ainda." : `Nenhum arquivo em ${pasta}.`}
        </div>
      ) : (
        <ul className="rounded-xl border overflow-hidden divide-y" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          {visiveis.map((a) => {
            const img = a.mime?.startsWith("image/") ?? false;
            const protegido = arquivoProtegido(a);
            const portal = usadoNoPortal(a);
            return (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 rel-linha" style={{ borderColor: "var(--line)" }}>
                {img && miniaturas[a.storage_path] ? (
                  <button type="button" onClick={() => void verImagem(a)} className="w-9 h-9 rounded-md overflow-hidden flex-shrink-0" style={{ border: "1px solid var(--line)" }} title="Ver imagem">
                    <img src={miniaturas[a.storage_path]} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </button>
                ) : (
                  <span className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
                    <IconeCategoria categoria={a.categoria} />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <button type="button" onClick={() => void abrir(a)} className="block max-w-full truncate text-left text-[13px] font-semibold hover:underline" style={{ color: "var(--ink)" }} title={a.nome}>
                    {a.nome}
                  </button>
                  <div className="text-[11px] flex flex-wrap items-center gap-x-1.5 gap-y-0.5" style={{ color: "var(--ink3)" }}>
                    <span>{a.categoria}</span>
                    {a.tamanho_bytes != null && <span>· {formatarTamanho(a.tamanho_bytes)}</span>}
                    <span>· {formatDate(a.created_at)}</span>
                    {a.descricao && <Selo tom={protegido ? "aviso" : portal ? "lista" : "neutro"} titulo={protegido ?? (portal ? "Usado no portal do viajante (ExpedAmigo)" : undefined)}>{a.descricao}</Selo>}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <BotaoIcone titulo={img ? "Ver" : "Abrir"} onClick={() => void abrir(a)} icone="olho" />
                  <BotaoIcone titulo="Baixar" onClick={() => void baixar(a)} icone="baixar" />
                  {!soLer && <BotaoIcone titulo="Renomear / mover de pasta" onClick={() => setEditando(a)} icone="lapis" />}
                  {!soLer && (protegido ? (
                    <span title={protegido} className="px-1.5 py-1" style={{ color: "var(--ink3)" }}><IconeSvg nome="cadeado" /></span>
                  ) : (
                    <BotaoExcluir titulo={`Apagar "${a.nome}"?`} sucesso="Arquivo apagado"
                      descricao={portal ? "Este arquivo está anexado no portal do viajante (ExpedAmigo) — ao apagar, ele some de lá também. Não dá pra desfazer." : undefined}
                      onConfirmar={async () => { await excluirArquivo(a.id); await carregar(); onMudou?.(); }} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Imagem ampliada */}
      <Modal aberto={preview !== null} titulo={preview?.arq.nome ?? ""} onFechar={() => setPreview(null)} largura={900}
        rodape={preview ? <><Botao onClick={() => void baixar(preview.arq)}>Baixar</Botao><Botao onClick={() => setPreview(null)}>Fechar</Botao></> : undefined}>
        {preview && (
          <div className="flex items-center justify-center rounded-lg overflow-hidden" style={{ background: "var(--card2)" }}>
            <img src={preview.url} alt={preview.arq.nome} className="max-h-[70vh] w-auto object-contain" />
          </div>
        )}
      </Modal>

      {editando && <EditarArquivo arq={editando} categorias={categorias} onFechar={() => setEditando(null)} onSalvo={async () => { setEditando(null); await carregar(); onMudou?.(); }} />}
    </div>
  );
}

function EditarArquivo({ arq, categorias, onFechar, onSalvo }: { arq: ArquivoRow; categorias: readonly CategoriaArquivo[]; onFechar: () => void; onSalvo: () => void }) {
  const { avisar } = useExp();
  // Separa a extensão pra não sumir sem querer ao renomear.
  const m = /^(.*?)(\.[A-Za-z0-9]{1,6})?$/.exec(arq.nome);
  const [base, setBase] = useState(m?.[1] || arq.nome);
  const ext = m?.[2] ?? "";
  const [categoria, setCategoria] = useState<CategoriaArquivo>(arq.categoria);
  const [salvando, setSalvando] = useState(false);
  const protegido = arquivoProtegido(arq);
  const opcoes = (categorias as readonly string[]).includes(arq.categoria) ? categorias : [arq.categoria, ...categorias];

  async function salvar() {
    const nome = `${base.trim()}${ext}`;
    if (!base.trim()) { avisar("O nome não pode ficar vazio", "erro"); return; }
    setSalvando(true);
    const { error } = await supabase.from("arquivos").update({ nome, categoria }).eq("id", arq.id);
    setSalvando(false);
    if (error) { avisar(traduzirErro(error.message), "erro"); return; }
    avisar(categoria !== arq.categoria ? `Movido para ${categoria}` : "Nome atualizado");
    onSalvo();
  }

  return (
    <Modal aberto titulo="Renomear / mover arquivo" onFechar={onFechar} largura={460}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="space-y-3">
        <Campo rotulo="Nome do arquivo" dica={ext ? `A extensão ${ext} é mantida.` : undefined}>
          <Entrada value={base} onChange={(e) => setBase(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") void salvar(); }} />
        </Campo>
        <Campo rotulo="Pasta" dica={protegido ? "Arquivo de sistema: trocar a pasta pode tirá-lo do portal." : undefined}>
          <select className="rel-input" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaArquivo)}>
            {opcoes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
      </div>
    </Modal>
  );
}

function ChipPasta({ rotulo, ativa, n, onClick, icone }: { rotulo: string; ativa: boolean; n: number; onClick: () => void; icone?: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={ativa} onClick={onClick}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold transition-colors"
      style={ativa ? { background: "var(--ink)", color: "var(--bg)", border: "1px solid var(--ink)" } : { background: "var(--card)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
      {icone}{rotulo}
      {n > 0 && <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full text-[10px] font-bold px-1"
        style={ativa ? { background: "rgba(255,255,255,.2)", color: "var(--bg)" } : { background: "var(--card2)", color: "var(--ink2)" }}>{n}</span>}
    </button>
  );
}

function BotaoIcone({ titulo, onClick, icone }: { titulo: string; onClick: () => void; icone: Parameters<typeof IconeSvg>[0]["nome"] }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo} className="p-1.5 rounded-md hover:bg-[var(--card2)]" style={{ color: "var(--ink2)" }}>
      <IconeSvg nome={icone} />
    </button>
  );
}
