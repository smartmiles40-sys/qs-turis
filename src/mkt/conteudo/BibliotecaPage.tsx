// src/mkt/conteudo/BibliotecaPage.tsx
// -----------------------------------------------------------------------------
// BIBLIOTECA DE CONTEÚDOS (0240): tudo que foi aprovado (e o que já saiu no ar),
// com filtro por destino, formato e tema. O Tráfego acha o que serve e clica
// "Reaproveitar para tráfego" — vira um card novo ligado ao original.
// -----------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { Aviso, Botao, Entrada, Vazio } from "@/rel/ui";
import { irMkt, useRotaMkt } from "../navegacao";
import CardDetalhe from "./CardDetalhe";
import { distintos, filtrarBiblioteca, dataCurta, hojeSP, type FiltroBiblioteca } from "./regras";
import { NOME_TIPO, TIPOS, type TipoConteudo } from "./tipos";
import { Cabecalho, ChipOrigem, ChipTipo, useQuadro } from "./ui";

export default function BibliotecaPage() {
  const rota = useRotaMkt();
  const { colunas, cards, carregando, erro, recarregar } = useQuadro();
  const [f, setF] = useState<FiltroBiblioteca>({ busca: "", tipo: "todos", destino: "todos", tag: "todas" });
  const hoje = hojeSP();
  const aprovados = useMemo(() => filtrarBiblioteca(cards, { busca: "", tipo: "todos", destino: "todos", tag: "todas" }), [cards]);
  const lista = useMemo(() => filtrarBiblioteca(cards, f).sort((a, b) => (b.aprovado_em ?? "").localeCompare(a.aprovado_em ?? "")), [cards, f]);
  const destinos = useMemo(() => distintos(aprovados.map((c) => c.destino)), [aprovados]);
  const tags = useMemo(() => distintos(aprovados.flatMap((c) => c.tags)), [aprovados]);
  const reaproveitados = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) if (c.original_id) m.set(c.original_id, (m.get(c.original_id) ?? 0) + 1);
    return m;
  }, [cards]);

  if (carregando) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  const sel = "rel-input !py-1.5 !text-[13px] !w-auto";

  return (
    <div className="max-w-6xl mx-auto">
      <Cabecalho titulo="Biblioteca de conteúdos" texto={`${aprovados.length} conteúdo(s) aprovado(s). Abra um pra ver os arquivos e reaproveitar no tráfego.`} />
      <div className="flex flex-wrap gap-2 mb-4">
        <Entrada placeholder="Buscar…" value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} className="!py-1.5 !text-[13px] sm:!w-64" aria-label="Buscar" />
        <select className={sel} aria-label="Destino" value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })}>
          <option value="todos">Todos os destinos</option>{destinos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className={sel} aria-label="Formato" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoConteudo | "todos" })}>
          <option value="todos">Todos os formatos</option>{TIPOS.map((t) => <option key={t} value={t}>{NOME_TIPO[t]}</option>)}
        </select>
        <select className={sel} aria-label="Tema" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}>
          <option value="todas">Todos os temas</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo={aprovados.length ? "Nada com esses filtros" : "A Biblioteca ainda está vazia"} texto="Tudo que o gestor aprovar no quadro entra aqui sozinho." /></div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((c) => (
            <li key={c.id} className="rel-card overflow-hidden flex flex-col">
              <button type="button" className="text-left flex-1" onClick={() => irMkt("biblioteca", c.id)}>
                {c.thumb ? <img src={c.thumb} alt="" loading="lazy" className="w-full h-36 object-cover" />
                  : <div className="w-full h-24 flex items-center justify-center text-[12px] font-semibold" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>{NOME_TIPO[c.tipo]}</div>}
                <div className="p-3">
                  <p className="text-[14px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>{c.titulo}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5"><ChipOrigem origem={c.origem} /><ChipTipo tipo={c.tipo} /></div>
                  <p className="text-[12px] mt-1.5" style={{ color: "var(--ink3)" }}>
                    {[c.destino, ...c.tags].filter(Boolean).join(" · ")}
                    {c.aprovado_em ? ` · aprovado ${dataCurta(c.aprovado_em.slice(0, 10), hoje)}` : ""}
                    {reaproveitados.get(c.id) ? ` · reaproveitado ${reaproveitados.get(c.id)}×` : ""}
                  </p>
                </div>
              </button>
              <div className="px-3 pb-3 flex gap-2">
                {c.link_publicacao && <a href={c.link_publicacao} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold underline self-center" style={{ color: "var(--rel-ink)" }}>Ver no ar</a>}
                <Botao className="ml-auto" onClick={() => irMkt("biblioteca", c.id)}>Reaproveitar…</Botao>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rota.id && <CardDetalhe key={rota.id} id={rota.id} colunas={colunas} onAbrir={(id) => irMkt("quadro", id)} onFechar={() => irMkt("biblioteca")} onMudou={() => void recarregar()} />}
    </div>
  );
}
