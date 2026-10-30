// src/mkt/grupos/Compositor.tsx — peças comuns: destino (tags/grupos) e conteúdo.
import { useMemo, useState } from "react";
import { Btn, SearchInput } from "@/components/ui";
import {
  type Conteudo, type Grupo, type Tag, type TagLink, type TipoMsg,
  classeCampo, estiloCampo, gruposDoDestino, subirArquivo,
} from "./lib";

export function TagChip({ tag, ativo, onClick }: { tag: Tag; ativo?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium"
      style={{ border: `1px solid ${tag.cor}`, background: ativo ? tag.cor : "transparent", color: ativo ? "#fff" : "var(--ink)" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: ativo ? "#fff" : tag.cor }} />
      {tag.nome}
    </button>
  );
}

/** Escolher os grupos: por tag (os grupos entram na hora do envio) e/ou um a um. */
export function DestinoPicker({ valor, onChange, grupos, tags, links }: {
  valor: { tag_ids: string[]; grupo_jids: string[] };
  onChange: (v: { tag_ids: string[]; grupo_jids: string[] }) => void;
  grupos: Grupo[]; tags: Tag[]; links: TagLink[];
}) {
  const [busca, setBusca] = useState("");
  const ativos = useMemo(() => grupos.filter((g) => !g.saiu_em), [grupos]);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? ativos.filter((g) => (g.nome || g.jid).toLowerCase().includes(b)) : ativos;
  }, [ativos, busca]);
  const total = gruposDoDestino(valor, grupos, links).length;
  const alterna = <K extends "tag_ids" | "grupo_jids">(k: K, id: string) =>
    onChange({ ...valor, [k]: valor[k].includes(id) ? valor[k].filter((x) => x !== id) : [...valor[k], id] });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="qs-label mb-1.5">Por tag</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && <span className="text-[13px] qs-tone-muted">Nenhuma tag ainda — crie em Grupos.</span>}
          {tags.map((t) => <TagChip key={t.id} tag={t} ativo={valor.tag_ids.includes(t.id)} onClick={() => alterna("tag_ids", t.id)} />)}
        </div>
      </div>
      <div>
        <div className="qs-label mb-1.5">Um a um ({valor.grupo_jids.length} marcados)</div>
        <SearchInput placeholder="Buscar grupo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="mt-2 max-h-56 overflow-auto rounded-lg" style={{ border: "1px solid var(--line)" }}>
          {lista.slice(0, 300).map((g) => (
            <label key={g.jid} className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer">
              <input type="checkbox" checked={valor.grupo_jids.includes(g.jid)} onChange={() => alterna("grupo_jids", g.jid)} />
              <span className="truncate">{g.nome || g.jid}</span>
              <span className="ml-auto qs-tone-muted">{g.participantes ?? "—"}</span>
            </label>
          ))}
          {lista.length === 0 && <div className="px-3 py-2 text-[13px] qs-tone-muted">Nenhum grupo. Sincronize em Grupos.</div>}
        </div>
      </div>
      <div className="text-[13px]"><strong>{total}</strong> grupo(s) recebem hoje. Grupo de tag entra/sai conforme a tag na hora do envio.</div>
    </div>
  );
}

const TIPOS: { v: TipoMsg; r: string }[] = [
  { v: "texto", r: "Texto" }, { v: "imagem", r: "Imagem" }, { v: "video", r: "Vídeo" },
  { v: "documento", r: "Documento" }, { v: "audio", r: "Áudio" }, { v: "enquete", r: "Enquete" },
];
const ACEITA: Partial<Record<TipoMsg, string>> = { imagem: "image/*", video: "video/mp4", documento: ".pdf,application/pdf", audio: "audio/*" };

/** Texto, mídia, enquete, @todos e intervalo entre grupos. */
export function ConteudoEditor({ valor, onChange }: { valor: Conteudo; onChange: (v: Conteudo) => void }) {
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = (p: Partial<Conteudo>) => onChange({ ...valor, ...p });
  const opcoes = valor.enquete_opcoes ?? ["", ""];
  const comMidia = ["imagem", "video", "documento", "audio"].includes(valor.tipo);

  async function escolher(f: File | undefined) {
    if (!f) return;
    setErro(null); setSubindo(true);
    try { const r = await subirArquivo(f); set({ midia_url: r.url, midia_nome: r.nome }); }
    catch (e) { setErro((e as Error).message); }
    finally { setSubindo(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {TIPOS.map((t) => (
          <Btn key={t.v} size="sm" variant={valor.tipo === t.v ? "primary" : "secondary"}
            onClick={() => set({ tipo: t.v, ...(t.v === "enquete" && !valor.enquete_opcoes ? { enquete_opcoes: ["", ""] } : {}) })}>{t.r}</Btn>
        ))}
      </div>
      {comMidia && (
        <div className="flex flex-col gap-1.5">
          <input type="file" accept={ACEITA[valor.tipo]} disabled={subindo} onChange={(e) => escolher(e.target.files?.[0])} />
          {subindo && <span className="text-[13px] qs-tone-muted">Subindo…</span>}
          {valor.midia_url && <a href={valor.midia_url} target="_blank" rel="noreferrer" className="text-[13px] underline truncate">{valor.midia_nome || valor.midia_url}</a>}
          {erro && <span className="text-[13px] qs-tone-danger">{erro}</span>}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="qs-label">{valor.tipo === "enquete" ? "Pergunta" : comMidia ? "Legenda (opcional)" : "Mensagem"}</span>
        <textarea rows={valor.tipo === "texto" ? 6 : 3} maxLength={4096} className={classeCampo} style={estiloCampo}
          value={valor.texto} onChange={(e) => set({ texto: e.target.value })}
          placeholder={valor.tipo === "texto" ? "*negrito*, _itálico_ — igual ao WhatsApp" : ""} />
      </label>
      {valor.tipo === "enquete" && (
        <div className="flex flex-col gap-1.5">
          <span className="qs-label">Opções (2 a 12)</span>
          {opcoes.map((o, i) => (
            <div key={i} className="flex gap-1.5">
              <input className={classeCampo} style={estiloCampo} value={o} maxLength={100}
                onChange={(e) => set({ enquete_opcoes: opcoes.map((x, j) => (j === i ? e.target.value : x)) })} />
              {opcoes.length > 2 && <Btn size="sm" variant="ghost" onClick={() => set({ enquete_opcoes: opcoes.filter((_, j) => j !== i) })}>✕</Btn>}
            </div>
          ))}
          {opcoes.length < 12 && <Btn size="sm" onClick={() => set({ enquete_opcoes: [...opcoes, ""] })}>+ opção</Btn>}
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={valor.enquete_multipla} onChange={(e) => set({ enquete_multipla: e.target.checked })} />
            Permitir várias respostas
          </label>
        </div>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={valor.mencionar_todos} onChange={(e) => set({ mencionar_todos: e.target.checked })} />
        Mencionar todos (@todos — todo mundo recebe notificação)
      </label>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        Intervalo entre um grupo e outro: de
        <input type="number" min={5} className="w-20 px-2 py-1 rounded-lg" style={estiloCampo}
          value={valor.intervalo_min_seg ?? ""} placeholder="20" onChange={(e) => set({ intervalo_min_seg: e.target.value ? Number(e.target.value) : null })} />
        a
        <input type="number" min={5} className="w-20 px-2 py-1 rounded-lg" style={estiloCampo}
          value={valor.intervalo_max_seg ?? ""} placeholder="45" onChange={(e) => set({ intervalo_max_seg: e.target.value ? Number(e.target.value) : null })} />
        segundos (vazio = o padrão do chip).
      </div>
    </div>
  );
}
