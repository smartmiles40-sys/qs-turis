// src/mkt/grupos/SeletorPublico.tsx — "Público": para quais grupos vai, por cartões clicáveis
// (o AudiencePicker do SendFlow). No QS a TAG é viva: o grupo que ganhar a tag até a
// hora do envio também recebe. "Grupos específicos" marca um a um.
// Destino vazio NUNCA vira "todos" (regra do servidor) — por isso não há "Todos os grupos".
import { useMemo, useState } from "react";
import { gruposDoDestino, type Grupo, type Tag, type TagLink } from "./lib";
import { Campo, Escolha, SeloTag, cor } from "./pecas";

type Destino = { tag_ids: string[]; grupo_jids: string[] };

/** Grupos ativos (o chip ainda está) de cada tag. */
export function gruposPorTag(grupos: Grupo[], links: TagLink[]): Map<string, string[]> {
  const ativos = new Set(grupos.filter((g) => !g.saiu_em).map((g) => g.jid));
  const m = new Map<string, string[]>();
  for (const l of links) if (ativos.has(l.grupo_jid)) m.set(l.tag_id, [...(m.get(l.tag_id) || []), l.grupo_jid]);
  return m;
}

/** "Live Japão + 3 grupos" — o público em uma linha (lista, cadência). */
export function resumoPublico(d: Destino, tags: Tag[]): string {
  const nomes = tags.filter((t) => d.tag_ids.includes(t.id)).map((t) => t.nome);
  const n = d.grupo_jids.length;
  const partes = [...nomes, ...(n ? [`${n} grupo${n === 1 ? "" : "s"} escolhido${n === 1 ? "" : "s"}`] : [])];
  return partes.length ? partes.join(" + ") : "Ninguém ainda";
}

const naoRecebe = (g: Grupo) => Boolean(g.so_admins_enviam && g.eu_admin === false);

export function SeletorPublico({ valor, onChange, grupos, tags, links, erro }: {
  valor: Destino; onChange: (v: Destino) => void; grupos: Grupo[]; tags: Tag[]; links: TagLink[]; erro?: string | null;
}) {
  const [modo, setModo] = useState<"tags" | "grupos">(valor.grupo_jids.length && !valor.tag_ids.length ? "grupos" : "tags");
  const [busca, setBusca] = useState("");
  const porTag = useMemo(() => gruposPorTag(grupos, links), [grupos, links]);
  const ativos = useMemo(() => grupos.filter((g) => !g.saiu_em), [grupos]);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? ativos.filter((g) => (g.nome || g.jid).toLowerCase().includes(b) || g.jid.includes(b)) : ativos;
  }, [ativos, busca]);
  const total = gruposDoDestino(valor, grupos, links).length;
  const alternaTag = (id: string) => onChange({ ...valor, tag_ids: valor.tag_ids.includes(id) ? valor.tag_ids.filter((x) => x !== id) : [...valor.tag_ids, id] });
  const alternaGrupo = (jid: string) => onChange({ ...valor, grupo_jids: valor.grupo_jids.includes(jid) ? valor.grupo_jids.filter((x) => x !== jid) : [...valor.grupo_jids, jid] });
  const podeMarcar = lista.filter((g) => !naoRecebe(g));
  const todosMarcados = podeMarcar.length > 0 && podeMarcar.every((g) => valor.grupo_jids.includes(g.jid));

  /** "Marcar por tag" dentro de Grupos específicos: marca (ou desmarca) os grupos da tag, um a um. */
  function marcarDaTag(id: string) {
    const daTag = porTag.get(id) || [];
    const todos = daTag.every((j) => valor.grupo_jids.includes(j));
    onChange({ ...valor, grupo_jids: todos ? valor.grupo_jids.filter((j) => !daTag.includes(j)) : [...new Set([...valor.grupo_jids, ...daTag])] });
  }

  return (
    <Campo rotulo="Público" dica="· para quais grupos vai" erro={erro}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Escolha ativo={modo === "tags"} onClick={() => setModo("tags")}>🏷 Por tag {valor.tag_ids.length ? `(${valor.tag_ids.length})` : ""}</Escolha>
        <Escolha ativo={modo === "grupos"} onClick={() => setModo("grupos")}>✅ Grupos específicos {valor.grupo_jids.length ? `(${valor.grupo_jids.length})` : ""}</Escolha>
      </div>

      {modo === "tags" && (
        tags.length === 0 ? (
          <div className="rounded-xl px-3.5 py-3 text-[13px]" style={{ border: "1px solid var(--line)", background: cor.card2, color: cor.ink3 }}>
            Nenhuma tag ainda. Crie em <b>Grupos → Tags</b> (ex.: “Live Japão”, “Turma Peru 2027”) e marque os grupos.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {tags.map((t) => {
                const on = valor.tag_ids.includes(t.id);
                const n = porTag.get(t.id)?.length ?? 0;
                return (
                  <button key={t.id} type="button" aria-pressed={on} onClick={() => alternaTag(t.id)}
                    className="gr-cartao-clicavel flex items-center gap-3 rounded-xl px-3.5 py-3 text-left"
                    style={on ? { border: `1.5px solid ${t.cor}`, background: `${t.cor}1f` } : { border: "1px solid var(--line)", background: cor.card2 }}>
                    <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: t.cor }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold" style={{ color: cor.ink }}>{t.nome}</span>
                      <span className="block text-[12px]" style={{ color: cor.ink3 }}>{n} grupo{n === 1 ? "" : "s"} hoje</span>
                    </span>
                    <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[12px] text-white"
                      style={on ? { background: t.cor } : { border: "1.5px solid var(--line)" }}>{on ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px]" style={{ color: cor.ink3 }}>Tag é viva: grupo que ganhar ou perder a tag até a hora do envio entra ou sai.</p>
          </>
        )
      )}

      {modo === "grupos" && (
        <div>
          <input className="rel-input mb-3" aria-label="Buscar grupo pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar grupo pelo nome…" />
          {tags.some((t) => porTag.get(t.id)?.length) && (
            <div className="mb-3">
              <div className="mb-1.5 text-[12px]" style={{ color: cor.ink3 }}>Marcar por tag:</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.filter((t) => porTag.get(t.id)?.length).map((t) => {
                  const daTag = porTag.get(t.id) || [];
                  return <SeloTag key={t.id} tag={t} contagem={daTag.length} ativo={daTag.every((j) => valor.grupo_jids.includes(j))}
                    onClick={() => marcarDaTag(t.id)} titulo={`Marca os ${daTag.length} grupos com esta tag`} />;
                })}
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-auto rounded-xl" style={{ border: "1px solid var(--line)" }}>
            {ativos.length === 0 ? (
              <div className="px-3.5 py-6 text-[13px]" style={{ color: cor.ink3 }}>Nenhum grupo ainda. Puxe os grupos na aba Grupos.</div>
            ) : lista.length === 0 ? (
              <div className="px-3.5 py-6 text-[13px]" style={{ color: cor.ink3 }}>Nenhum grupo encontrado para “{busca}”.</div>
            ) : (
              <>
                <button type="button" onClick={() => onChange({ ...valor, grupo_jids: todosMarcados ? valor.grupo_jids.filter((j) => !podeMarcar.some((g) => g.jid === j)) : [...new Set([...valor.grupo_jids, ...podeMarcar.map((g) => g.jid)])] })}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[12px]" style={{ color: cor.ink3, borderBottom: "1px solid var(--line)" }}>
                  <Caixinha marcada={todosMarcados} /> {todosMarcados ? "Desmarcar" : "Marcar"} os {podeMarcar.length} da lista
                </button>
                {lista.slice(0, 400).map((g) => {
                  const bloq = naoRecebe(g);
                  const on = valor.grupo_jids.includes(g.jid);
                  return (
                    <button key={g.jid} type="button" disabled={bloq} onClick={() => alternaGrupo(g.jid)} aria-pressed={on}
                      className="gr-linha flex w-full items-center gap-3 px-3.5 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ borderTop: "1px solid var(--line)" }}>
                      <Caixinha marcada={on} />
                      {g.foto_url ? <img src={g.foto_url} alt="" width={28} height={28} className="shrink-0 rounded-full" />
                        : <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px]" style={{ background: cor.relSoft, color: cor.relInk }}>👥</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium" style={{ color: cor.ink }}>{g.nome || g.jid}</span>
                        <span className="block text-[12px]" style={{ color: cor.ink3 }}>{g.participantes ?? "—"} participantes</span>
                      </span>
                      {bloq
                        ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ border: "1px solid var(--line)", color: cor.ink3 }}>só admins mandam</span>
                        : g.eu_admin ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ background: cor.relSoft, color: cor.relInk }}>chip é admin</span> : null}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-2.5 text-[13px]" style={{ color: cor.ink3 }}>
        {valor.tag_ids.length || valor.grupo_jids.length ? (
          <><b style={{ color: cor.ink }}>{total} grupo{total === 1 ? "" : "s"}</b> recebem hoje · {resumoPublico(valor, tags)}</>
        ) : "Nenhum grupo marcado — escolha uma tag ou os grupos."}
      </div>
    </Campo>
  );
}

function Caixinha({ marcada }: { marcada: boolean }) {
  return (
    <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[12px] text-white transition-colors"
      style={marcada ? { background: "var(--rel)", border: "1px solid var(--rel)" } : { border: "1.5px solid var(--line)" }}>{marcada ? "✓" : ""}</span>
  );
}
