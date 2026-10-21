// Aba "Links" da expedição (app antigo: app/(app)/expedicoes/[id]/links/ — page.tsx,
// LinksGrid.tsx, LinkDrawer.tsx). Grade de links (apresentação, LP, planilha, drive,
// grupo do WhatsApp…) com copiar/editar/excluir; ao vivo. O portal /amigo lê os mesmos links.
import { useCallback, useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { Botao } from "@/rel/ui";
import { useExp } from "../../contexto";
import { Carregando, useAoVivo } from "../../ui";
import type { LinkExpedicaoRow } from "../../lib/database";
import { listarLinks, reordenarLinks } from "../../links/dados";
import { CartaoLink, GavetaLink } from "../../links/Componentes";
import type { PropsAba } from "../ExpedicaoDetalhe";

export default function AbaLinks({ exp }: PropsAba) {
  const { somenteLeitura, avisar } = useExp();
  const [links, setLinks] = useState<LinkExpedicaoRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gaveta, setGaveta] = useState<{ link: LinkExpedicaoRow | null } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const carregar = useCallback(async () => {
    try { setLinks(await listarLinks(exp.id)); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, [exp.id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "links_expedicao", filtro: `expedicao_id=eq.${exp.id}` }], carregar, 300);

  if (erro) return <p className="py-10 text-center text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>;
  if (!links) return <Carregando />;

  const fimArraste = async (ev: DragEndEvent) => {
    if (!ev.over || ev.active.id === ev.over.id) return;
    const ids = links.map((l) => l.id);
    const nova = arrayMove(ids, ids.indexOf(String(ev.active.id)), ids.indexOf(String(ev.over.id)));
    setLinks(nova.map((id, i) => ({ ...links.find((l) => l.id === id)!, ordem: i })));
    try { await reordenarLinks(nova); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar a ordem", "erro"); void carregar(); }
  };

  const gavetaEl = (
    <GavetaLink expedicaoId={exp.id} aberta={!!gaveta} link={gaveta?.link ?? null} total={links.length}
      onFechar={() => setGaveta(null)} onSalvo={() => { setGaveta(null); void carregar(); }} />
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Links da expedição</h2>
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: "#16A34A" }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#16A34A" }} />ao vivo</span>
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {links.length === 0 ? "Nenhum link ainda — adicione o primeiro." : `${links.length} link${links.length === 1 ? "" : "s"} cadastrado${links.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {!somenteLeitura && <Botao variante="primario" onClick={() => setGaveta({ link: null })}>+ Novo link</Botao>}
      </div>

      {links.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ border: "1px dashed var(--line)", background: "var(--card2)" }}>
          <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Nenhum link cadastrado</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px]" style={{ color: "var(--ink3)" }}>
            Cole aqui apresentação, landing page, planilha financeira, drive, grupo do WhatsApp — qualquer URL relevante pra essa expedição.
          </p>
          {!somenteLeitura && <Botao className="mt-4" onClick={() => setGaveta({ link: null })}>+ Adicionar primeiro link</Botao>}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={fimArraste}>
          <SortableContext items={links.map((l) => l.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {links.map((l) => <CartaoLink key={l.id} link={l} onEditar={() => setGaveta({ link: l })} onMudou={carregar} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {gavetaEl}
    </div>
  );
}
