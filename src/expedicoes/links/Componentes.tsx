// src/expedicoes/links/Componentes.tsx
// Cartão do link e gaveta de criar/editar (app antigo: LinksGrid.tsx + LinkDrawer.tsx).
// Novo no QS: arrastar o cartão pra mudar a ordem (o antigo aceitava `ordem` mas não tinha tela).
import { useEffect, useState, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, Gaveta } from "../ui";
import type { LinkExpedicaoRow } from "../lib/database";
import { SUGESTOES_LINK, atualizarLink, criarLink, excluirLink, iconeDoLink, urlBonita, validarLink, type TipoIcone } from "./dados";

const SVG: Record<TipoIcone, ReactNode> = {
  planilha: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>,
  apresentacao: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  pasta: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  video: <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M22 7l-5 5 5 5z" /></>,
  chat: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z" />,
  globo: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
};

function Icone({ tipo, tamanho = 18 }: { tipo: TipoIcone; tamanho?: number }) {
  return <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{SVG[tipo]}</svg>;
}

export function CartaoLink({ link, onEditar, onMudou }: { link: LinkExpedicaoRow; onEditar: () => void; onMudou: () => void }) {
  const { somenteLeitura, avisar } = useExp();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: link.id, disabled: somenteLeitura });
  const copiar = async () => {
    try { await navigator.clipboard.writeText(link.url); avisar("URL copiada"); } catch { avisar("Não foi possível copiar", "erro"); }
  };
  const tipo = iconeDoLink(link.label, link.url);
  return (
    <div ref={setNodeRef} className="group relative rel-card" style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 p-3.5 pr-4 rounded-[14px] hover:bg-[var(--card2)]">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}><Icone tipo={tipo} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>
            <span className="truncate">{link.label}</span>
            <span className="opacity-0 group-hover:opacity-60 flex-shrink-0" aria-hidden>↗</span>
          </span>
          <span className="block truncate font-mono text-[11.5px] mt-0.5" style={{ color: "var(--ink3)" }}>{urlBonita(link.url)}</span>
        </span>
      </a>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-lg px-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
        style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
        {!somenteLeitura && (
          <button {...attributes} {...listeners} aria-label="Arrastar pra reordenar" title="Arrastar pra reordenar" className="cursor-grab px-1.5 py-1 text-[13px]" style={{ color: "var(--ink3)" }}>⠿</button>
        )}
        <Acao titulo="Copiar URL" onClick={copiar}>⧉</Acao>
        {!somenteLeitura && <Acao titulo="Editar" onClick={onEditar}>✎</Acao>}
        <BotaoExcluir titulo={`Excluir "${link.label}"?`} descricao="O link some daqui e do portal do viajante. Essa ação não pode ser desfeita." sucesso="Link excluído"
          onConfirmar={async () => { await excluirLink(link.id); onMudou(); }} />
      </div>
    </div>
  );
}

function Acao({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={titulo} aria-label={titulo} onClick={onClick} className="px-1.5 py-1 rounded-md text-[13px] hover:bg-[var(--card2)]" style={{ color: "var(--ink2)" }}>{children}</button>;
}

export function GavetaLink({ expedicaoId, aberta, link, total, onFechar, onSalvo }: {
  expedicaoId: string; aberta: boolean; link: LinkExpedicaoRow | null; total: number; onFechar: () => void; onSalvo: () => void;
}) {
  const { avisar } = useExp();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [erros, setErros] = useState<{ label?: string; url?: string }>({});
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberta) { setLabel(link?.label ?? ""); setUrl(link?.url ?? ""); setErros({}); } }, [aberta, link]);

  const salvar = async () => {
    const e = validarLink(label, url);
    setErros(e);
    if (e.label || e.url) return;
    setSalvando(true);
    try {
      if (link) {
        const mud: { label?: string; url?: string } = {};
        if (label.trim() !== link.label) mud.label = label.trim();
        if (url.trim() !== link.url) mud.url = url.trim();
        if (Object.keys(mud).length) { await atualizarLink(link.id, mud); avisar("Link atualizado"); }
      } else {
        await criarLink(expedicaoId, label, url, total);
        avisar("Link adicionado");
      }
      onSalvo();
    } catch (er) { avisar(er instanceof Error ? er.message : "Erro ao salvar", "erro"); }
    finally { setSalvando(false); }
  };

  return (
    <Gaveta aberta={aberta} titulo={link ? "Editar link" : "Novo link"} largura={460} onFechar={onFechar}
      subtitulo="Aparece aqui e no portal do viajante (ExpedAmigo)."
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : link ? "Salvar" : "Adicionar"}</Botao></>}>
      <div className="space-y-3.5">
        <Campo rotulo="Nome" erro={erros.label}>
          <Entrada autoFocus value={label} maxLength={80} placeholder="Ex.: Apresentação" aria-invalid={!!erros.label} onChange={(e) => setLabel(e.target.value)} />
        </Campo>
        {!link && (
          <div className="flex flex-wrap gap-1.5 -mt-1.5">
            {SUGESTOES_LINK.map((s) => (
              <button key={s} type="button" onClick={() => setLabel(s)} className="px-2 py-0.5 rounded-full text-[11.5px] font-semibold"
                style={label === s ? { background: "var(--rel)", color: "#fff" } : { background: "var(--card2)", color: "var(--ink2)", border: "1px solid var(--line)" }}>{s}</button>
            ))}
          </div>
        )}
        <Campo rotulo="URL" erro={erros.url}>
          <Entrada value={url} placeholder="https://..." inputMode="url" aria-invalid={!!erros.url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void salvar(); }} />
        </Campo>
      </div>
    </Gaveta>
  );
}
