// src/mkt/grupos/Grupos.tsx — aba "Grupos": os grupos em que o chip do Marketing está,
// com as TAGS (o jeito de escolher para quem vai). Igual à tela de Grupos do SendFlow:
// busca, filtro por tag em pílulas, marcar vários e pôr/tirar tag de uma vez.
// No QS os grupos vêm do WhatsApp ("Puxar grupos"); não se cadastra grupo à mão.
import { useMemo, useState } from "react";
import { Modal, Vazio } from "@/rel/ui";
import { api, aplicarTag, apagarTag, CORES, criarTag, mudarTag, quando, type Grupo, type Tag } from "./lib";
import { useBases } from "./useBases";
import { irNaAba } from "./navegar";
import { BotaoGrande, Campo, Nota, SeloBolinha, SeloTag, cor } from "./pecas";

type Filtro = { tag: string | null; semTag: boolean; admin: boolean; sairam: boolean };

export default function GruposAba() {
  const bases = useBases();
  const { grupos, tags, links, recarregar } = bases;
  const [busca, setBusca] = useState("");
  const [f, setF] = useState<Filtro>({ tag: null, semTag: false, admin: false, sairam: false });
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [tagEmMassa, setTagEmMassa] = useState<string>("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tom: "rel" | "erro"; texto: string } | null>(null);
  const [tagsDoGrupo, setTagsDoGrupo] = useState<string | null>(null);
  const [dados, setDados] = useState<string | null>(null);

  const tagsPorGrupo = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) m.set(l.grupo_jid, [...(m.get(l.grupo_jid) || []), l.tag_id]);
    return m;
  }, [links]);
  const contagemTag = useMemo(() => {
    const ativos = new Set(grupos.filter((g) => !g.saiu_em).map((g) => g.jid));
    const m = new Map<string, number>();
    for (const l of links) if (ativos.has(l.grupo_jid)) m.set(l.tag_id, (m.get(l.tag_id) || 0) + 1);
    return m;
  }, [grupos, links]);

  const ativos = grupos.filter((g) => !g.saiu_em);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return grupos.filter((g) => {
      if (f.sairam ? !g.saiu_em : g.saiu_em) return false;
      if (f.admin && !g.eu_admin) return false;
      const ts = tagsPorGrupo.get(g.jid) || [];
      if (f.tag && !ts.includes(f.tag)) return false;
      if (f.semTag && ts.length) return false;
      return !b || (g.nome || g.jid).toLowerCase().includes(b);
    });
  }, [grupos, busca, f, tagsPorGrupo]);

  const tagPorId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const semTag = ativos.filter((g) => !(tagsPorGrupo.get(g.jid) || []).length).length;
  const todosMarcados = lista.length > 0 && lista.every((g) => marcados.has(g.jid));

  async function puxar() {
    setOcupado(true); setMsg(null);
    try {
      const r = await api<{ grupos: number; sairam: number; saida_suspeita: number }>("sincronizar");
      await recarregar();
      setMsg({ tom: "rel", texto: `${r.grupos} grupos lidos do WhatsApp${r.sairam ? ` · ${r.sairam} marcados como “saiu”` : ""}${r.saida_suspeita ? ` · ${r.saida_suspeita} sumiram mas NÃO foram marcados (suspeito — confira)` : ""}.` });
    } catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  async function emMassa(tirar: boolean) {
    if (!tagEmMassa || !marcados.size) return;
    setOcupado(true); setMsg(null);
    try {
      await aplicarTag(tagEmMassa, [...marcados], tirar);
      await recarregar();
      const t = tagPorId.get(tagEmMassa);
      setMsg({ tom: "rel", texto: `${tirar ? "Tirei" : "Pus"} a tag “${t?.nome}” ${tirar ? "de" : "em"} ${marcados.size} grupo(s).` });
      setMarcados(new Set());
    } catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  function alternarMarcado(jid: string) {
    const s = new Set(marcados);
    if (s.has(jid)) s.delete(jid); else s.add(jid);
    setMarcados(s);
  }

  const grupoAberto = (jid: string | null) => (jid ? grupos.find((g) => g.jid === jid) || null : null);

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold" style={{ color: cor.ink }}>Grupos</h2>
          <p className="mt-1 text-[14px]" style={{ color: cor.ink3 }}>
            {ativos.length} grupos em que o chip do Marketing está. Ponha <b>tags</b> (ex.: “Live Japão”) para escolher rápido para quem cada campanha vai.
          </p>
        </div>
        <BotaoGrande disabled={ocupado} onClick={() => void puxar()}>{ocupado ? "Lendo o WhatsApp…" : "🔄 Puxar grupos do WhatsApp"}</BotaoGrande>
      </div>

      {(bases.erro || msg) && <div className="mb-5"><Nota tom={bases.erro || msg?.tom === "erro" ? "erro" : "rel"} icone={bases.erro || msg?.tom === "erro" ? "⚠️" : "✅"}>{bases.erro || msg?.texto}</Nota></div>}

      <GerenciarTags tags={tags} contagem={contagemTag} onMudou={recarregar} />

      <div className="mb-3">
        <input className="rel-input" type="search" placeholder="🔍 Buscar grupo pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar grupo" />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Pilula ativo={!f.tag && !f.semTag && !f.admin && !f.sairam} onClick={() => setF({ tag: null, semTag: false, admin: false, sairam: false })}>Todos <span style={{ opacity: 0.6 }}>{ativos.length}</span></Pilula>
        {tags.map((t) => <SeloTag key={t.id} tag={t} contagem={contagemTag.get(t.id) || 0} ativo={f.tag === t.id} onClick={() => setF({ ...f, tag: f.tag === t.id ? null : t.id, semTag: false })} />)}
        <Pilula ativo={f.semTag} onClick={() => setF({ ...f, semTag: !f.semTag, tag: null })}>Sem tag <span style={{ opacity: 0.6 }}>{semTag}</span></Pilula>
        <Pilula ativo={f.admin} onClick={() => setF({ ...f, admin: !f.admin })}>👑 Sou admin</Pilula>
        <Pilula ativo={f.sairam} onClick={() => setF({ ...f, sairam: !f.sairam })}>🚪 Saí do grupo</Pilula>
      </div>

      {!bases.pronto ? (
        <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando grupos…</div>
      ) : lista.length === 0 ? (
        <div className="gr-cartao">
          <Vazio titulo={grupos.length ? "Nenhum grupo neste filtro" : "Nenhum grupo ainda"}
            texto={grupos.length ? "Troque o filtro ou a busca." : "Toque em “Puxar grupos do WhatsApp” para trazer os grupos em que o chip do Marketing está."} />
        </div>
      ) : (
        <div className="gr-cartao overflow-hidden">
          <div className="flex items-center gap-3 px-3.5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ borderBottom: "1px solid var(--line)", color: cor.ink3 }}>
            <Marcador marcado={todosMarcados} rotulo="Marcar todos da lista"
              onClick={() => setMarcados(todosMarcados ? new Set() : new Set(lista.map((g) => g.jid)))} />
            <span className="flex-1">{lista.length} grupo{lista.length === 1 ? "" : "s"}{marcados.size ? ` · ${marcados.size} marcados` : ""}</span>
            <span className="hidden w-[90px] text-right sm:block">Pessoas</span>
            <span className="w-[108px]" />
          </div>
          {lista.map((g) => {
            const ts = (tagsPorGrupo.get(g.jid) || []).map((id) => tagPorId.get(id)).filter(Boolean) as Tag[];
            const bloqueado = Boolean(g.so_admins_enviam && g.eu_admin === false);
            return (
              <div key={g.jid} className="gr-linha flex items-center gap-3 px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--line)", opacity: g.saiu_em ? 0.6 : 1 }}>
                <Marcador marcado={marcados.has(g.jid)} rotulo={`Marcar ${g.nome || g.jid}`} onClick={() => alternarMarcado(g.jid)} />
                <Avatar grupo={g} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold" style={{ color: cor.ink }}>{g.nome || g.jid}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {ts.map((t) => <SeloTag key={t.id} tag={t} pequeno />)}
                    {g.eu_admin && <span className="text-[11.5px]" style={{ color: cor.ink3 }}>👑 admin</span>}
                    {bloqueado && <span className="text-[11.5px] font-semibold" style={{ color: "var(--warn-ink)" }}>🔒 só admins mandam — não recebe campanha</span>}
                    {g.saiu_em && <span className="text-[11.5px] font-semibold" style={{ color: "var(--err-ink)" }}>🚪 o chip saiu em {quando(g.saiu_em)}</span>}
                    {!ts.length && !g.eu_admin && !bloqueado && !g.saiu_em && <span className="text-[11.5px]" style={{ color: cor.ink3 }}>sem tag</span>}
                  </div>
                </div>
                <span className="hidden w-[90px] text-right text-[13px] tabular-nums sm:block" style={{ color: cor.ink2 }}>{g.participantes ?? "—"}</span>
                <div className="flex w-[108px] justify-end gap-1">
                  <button type="button" className="gr-icone-btn" title="Tags do grupo" aria-label="Tags do grupo" onClick={() => setTagsDoGrupo(g.jid)}>🏷</button>
                  <button type="button" className="gr-icone-btn" title="Abrir a conversa no Celular" aria-label="Abrir a conversa" onClick={() => irNaAba("celular", { jid: g.jid })}>💬</button>
                  <button type="button" className="gr-icone-btn" title="Dados do grupo" aria-label="Dados do grupo" onClick={() => setDados(g.jid)}>ℹ</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Barra das ações em massa (aparece quando marca algum grupo) */}
      {marcados.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6">
          <div className="gr-cartao mx-auto flex max-w-[860px] flex-wrap items-center gap-2.5 px-4 py-3 shadow-2xl">
            <b className="text-[14px]" style={{ color: cor.ink }}>{marcados.size} marcados</b>
            <select className="rel-input min-w-0 flex-1" style={{ maxWidth: 260 }} value={tagEmMassa} onChange={(e) => setTagEmMassa(e.target.value)} aria-label="Tag">
              <option value="">Escolha a tag…</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <BotaoGrande pequeno disabled={!tagEmMassa || ocupado} onClick={() => void emMassa(false)}>🏷 Pôr a tag</BotaoGrande>
            <BotaoGrande pequeno variante="secundario" disabled={!tagEmMassa || ocupado} onClick={() => void emMassa(true)}>Tirar a tag</BotaoGrande>
            <BotaoGrande pequeno variante="perigo" onClick={() => setMarcados(new Set())}>Desmarcar</BotaoGrande>
          </div>
        </div>
      )}

      {tagsDoGrupo && grupoAberto(tagsDoGrupo) && (
        <TagsDoGrupo grupo={grupoAberto(tagsDoGrupo) as Grupo} tags={tags} atuais={tagsPorGrupo.get(tagsDoGrupo) || []}
          onFechar={() => setTagsDoGrupo(null)} onMudou={recarregar} />
      )}
      {dados && <DadosDoGrupo grupo={grupoAberto(dados)} jid={dados} tags={(tagsPorGrupo.get(dados) || []).map((id) => tagPorId.get(id)).filter(Boolean) as Tag[]}
        onFechar={() => setDados(null)} onMudou={recarregar} />}
    </div>
  );
}

function Pilula({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-medium"
      style={ativo ? { border: "1.5px solid var(--rel)", background: cor.relSoft, color: cor.relInk } : { border: "1px solid var(--line)", background: cor.card2, color: cor.ink2 }}>
      {children}
    </button>
  );
}

function Marcador({ marcado, onClick, rotulo }: { marcado: boolean; onClick: () => void; rotulo: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={marcado} aria-label={rotulo} onClick={onClick}
      className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-[12px] font-bold text-white"
      style={marcado ? { background: "var(--rel)", border: "1.5px solid var(--rel)" } : { border: "1.5px solid var(--line)", background: cor.card }}>
      {marcado ? "✓" : ""}
    </button>
  );
}

export function Avatar({ grupo, tamanho = 36 }: { grupo: Pick<Grupo, "nome" | "foto_url">; tamanho?: number }) {
  if (grupo.foto_url) return <img src={grupo.foto_url} alt="" width={tamanho} height={tamanho} className="shrink-0 rounded-full object-cover" style={{ width: tamanho, height: tamanho }} />;
  const ini = (grupo.nome || "?").trim().charAt(0).toUpperCase();
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full text-[14px] font-semibold"
      style={{ width: tamanho, height: tamanho, background: cor.relSoft, color: cor.relInk }}>{ini}</span>
  );
}

/** "Gerenciar tags": criar, renomear, trocar a cor e apagar. Fica fechado até precisar. */
function GerenciarTags({ tags, contagem, onMudou }: { tags: Tag[]; contagem: Map<string, number>; onMudou: () => Promise<void> }) {
  const [nome, setNome] = useState("");
  const [corNova, setCorNova] = useState(CORES[5]);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({ nome: "", cor: "" });
  const [apagando, setApagando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar(f: () => Promise<unknown>) {
    setErro(null);
    try { await f(); await onMudou(); } catch (e) { setErro((e as Error).message); }
  }
  return (
    <details className="gr-cartao mb-5 px-4 py-3">
      <summary className="cursor-pointer select-none text-[14px] font-semibold" style={{ color: cor.ink }}>🏷 Gerenciar tags <span className="font-normal" style={{ color: cor.ink3 }}>· {tags.length} tags</span></summary>
      <div className="pt-4">
        <Campo rotulo="Nova tag" erro={erro}>
          <div className="flex flex-wrap items-center gap-2">
            <input className="rel-input min-w-0 flex-1" style={{ maxWidth: 280 }} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Live Japão"
              onKeyDown={(e) => { if (e.key === "Enter" && nome.trim()) void rodar(async () => { await criarTag(nome, corNova); setNome(""); }); }} />
            <Cores valor={corNova} onChange={setCorNova} />
            <BotaoGrande pequeno disabled={!nome.trim()} onClick={() => void rodar(async () => { await criarTag(nome, corNova); setNome(""); })}>+ Criar</BotaoGrande>
          </div>
        </Campo>
        <div className="flex flex-col">
          {tags.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2.5 py-2" style={{ borderTop: "1px solid var(--line)" }}>
              {editando === t.id ? (
                <>
                  <input className="rel-input min-w-0 flex-1" style={{ maxWidth: 240 }} value={rascunho.nome} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} aria-label="Nome da tag" />
                  <Cores valor={rascunho.cor} onChange={(c) => setRascunho({ ...rascunho, cor: c })} />
                  <BotaoGrande pequeno disabled={!rascunho.nome.trim()} onClick={() => void rodar(async () => { await mudarTag(t.id, { nome: rascunho.nome.trim(), cor: rascunho.cor }); setEditando(null); })}>Salvar</BotaoGrande>
                  <BotaoGrande pequeno variante="secundario" onClick={() => setEditando(null)}>Cancelar</BotaoGrande>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1"><SeloTag tag={t} contagem={contagem.get(t.id) || 0} /></span>
                  {apagando === t.id ? (
                    <>
                      <span className="text-[12.5px]" style={{ color: cor.ink3 }}>Sai de {contagem.get(t.id) || 0} grupo(s) e das campanhas que usam ela.</span>
                      <BotaoGrande pequeno variante="perigo" onClick={() => void rodar(async () => { await apagarTag(t.id); setApagando(null); })}>Sim, apagar</BotaoGrande>
                      <BotaoGrande pequeno variante="secundario" onClick={() => setApagando(null)}>Não</BotaoGrande>
                    </>
                  ) : (
                    <>
                      <button type="button" className="gr-icone-btn" aria-label={`Editar ${t.nome}`} title="Editar" onClick={() => { setEditando(t.id); setRascunho({ nome: t.nome, cor: t.cor }); }}>✏️</button>
                      <button type="button" className="gr-icone-btn" aria-label={`Apagar ${t.nome}`} title="Apagar" onClick={() => setApagando(t.id)}>🗑</button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function Cores({ valor, onChange }: { valor: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Cor da tag">
      {CORES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={valor === c} aria-label={`Cor ${c}`} onClick={() => onChange(c)}
          className="h-6 w-6 rounded-full" style={{ background: c, outline: valor === c ? "2px solid var(--ink)" : "none", outlineOffset: 2 }} />
      ))}
    </div>
  );
}

/** As tags de UM grupo: tocar liga/desliga. */
function TagsDoGrupo({ grupo, tags, atuais, onFechar, onMudou }: { grupo: Grupo; tags: Tag[]; atuais: string[]; onFechar: () => void; onMudou: () => Promise<void> }) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  async function alternar(t: Tag) {
    setOcupado(t.id); setErro(null);
    try { await aplicarTag(t.id, [grupo.jid], atuais.includes(t.id)); await onMudou(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }
  return (
    <Modal aberto titulo={`Tags de “${grupo.nome || grupo.jid}”`} onFechar={onFechar} largura={480}
      rodape={<BotaoGrande pequeno onClick={onFechar}>Pronto</BotaoGrande>}>
      {tags.length === 0 ? (
        <p className="text-[14px]" style={{ color: cor.ink3 }}>Nenhuma tag criada. Abra “Gerenciar tags” para criar a primeira.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => <span key={t.id} style={{ opacity: ocupado === t.id ? 0.5 : 1 }}><SeloTag tag={t} ativo={atuais.includes(t.id)} onClick={() => void alternar(t)} titulo={atuais.includes(t.id) ? "Tocar para tirar" : "Tocar para pôr"} /></span>)}
        </div>
      )}
      <p className="mt-3 text-[12px]" style={{ color: cor.ink3 }}>A tag vale na hora: as campanhas agendadas para ela já incluem (ou tiram) este grupo.</p>
      {erro && <p className="mt-2 text-[14px]" role="alert" style={{ color: "var(--err-ink)" }}>{erro}</p>}
    </Modal>
  );
}

/** Os dados do grupo lidos do WhatsApp: foto, descrição, admins, participantes e link de convite. Só leitura. */
export function DadosDoGrupo({ jid, grupo, tags, onFechar, onMudou }: { jid: string; grupo: Grupo | null; tags: Tag[]; onFechar: () => void; onMudou: () => Promise<void> }) {
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [link, setLink] = useState<string | null>(grupo?.link_convite || null);
  const [copiado, setCopiado] = useState(false);
  async function atualizar() {
    setLendo(true); setErro(null);
    try { await api("info_grupo", { jid }); await onMudou(); } catch (e) { setErro((e as Error).message); } finally { setLendo(false); }
  }
  async function verLink() {
    setErro(null);
    try { const r = await api<{ link: string | null }>("convite", { jid }); setLink(r.link); } catch (e) { setErro((e as Error).message); }
  }
  const parts = grupo?.participantes_lista || [];
  return (
    <Modal aberto titulo={grupo?.nome || jid} onFechar={onFechar} largura={560}
      rodape={<BotaoGrande pequeno variante="secundario" onClick={onFechar}>Fechar</BotaoGrande>}>
      <div className="flex flex-col gap-4 text-[14px]" style={{ color: cor.ink }}>
        <div className="flex items-center gap-3">
          <Avatar grupo={grupo || { nome: jid, foto_url: null }} tamanho={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              {grupo?.saiu_em && <SeloBolinha tom="erro">O chip saiu em {quando(grupo.saiu_em)}</SeloBolinha>}
              {grupo?.eu_admin && <SeloBolinha tom="ok">Chip é admin</SeloBolinha>}
              {grupo?.so_admins_enviam && <SeloBolinha tom="aviso">Só admins mandam</SeloBolinha>}
              {grupo?.so_admins_editam && <SeloBolinha tom="neutro">Só admins editam</SeloBolinha>}
            </div>
            {tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{tags.map((t) => <SeloTag key={t.id} tag={t} pequeno />)}</div>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <BotaoGrande pequeno variante="secundario" disabled={lendo} onClick={() => void atualizar()}>{lendo ? "Lendo…" : "🔄 Ler dados no WhatsApp"}</BotaoGrande>
          <BotaoGrande pequeno variante="secundario" onClick={() => void verLink()}>🔗 Link de convite</BotaoGrande>
        </div>
        {link && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: cor.card2, border: "1px solid var(--line)" }}>
            <code className="min-w-0 flex-1 truncate text-[13px]">{link}</code>
            {/* 04/11/2026: clipboard bloqueado rejeitava calado — agora avisa. */}
            <BotaoGrande pequeno onClick={() => { void navigator.clipboard.writeText(link).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }, () => setErro("Não consegui copiar — selecione o link e copie à mão.")); }}>{copiado ? "Copiado ✓" : "Copiar"}</BotaoGrande>
          </div>
        )}
        {erro && <Nota tom="erro" icone="⚠️">{erro}</Nota>}
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: cor.ink3 }}>Descrição</div>
          <p className="whitespace-pre-wrap break-words" style={{ color: cor.ink2 }}>{grupo?.descricao || "—"}</p>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: cor.ink3 }}>Admins ({grupo?.admins?.length || 0})</div>
          <ul className="text-[13px]" style={{ color: cor.ink2 }}>{(grupo?.admins || []).map((a) => <li key={a.id}>{a.telefone ? `+${a.telefone}` : a.id} · {a.admin}</li>)}</ul>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: cor.ink3 }}>Participantes ({grupo?.participantes ?? parts.length})</div>
          {parts.length ? (
            <ul className="max-h-56 overflow-auto text-[13px]" style={{ color: cor.ink2 }}>{parts.map((p) => <li key={p.id}>{p.telefone ? `+${p.telefone}` : p.id}{p.admin ? " · admin" : ""}</li>)}</ul>
          ) : <p className="text-[13px]" style={{ color: cor.ink3 }}>Toque em “Ler dados no WhatsApp” para ver a lista.</p>}
        </div>
        <p className="text-[12px]" style={{ color: cor.ink3 }}>
          Lido em {quando(grupo?.info_em || null)} · sincronizado em {quando(grupo?.sincronizado_em || null)}. Nome, foto e descrição se mudam no próprio WhatsApp.
        </p>
      </div>
    </Modal>
  );
}
