// src/mkt/grupos/GruposPage.tsx — grupos do chip do MKT: lista, filtros, tags e dados do grupo.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Btn, Card, FilterPill, Page, PageHeader, SearchInput, StatusChip } from "@/components/ui";
import { TagChip } from "./Compositor";
import {
  api, aplicarTag, apagarTag, classeCampo, CORES, criarTag, estiloCampo, lerGrupos, lerLinks, lerTags, quando,
  type Grupo, type Tag, type TagLink,
} from "./lib";

type Filtro = "todos" | "sem_tag" | "admin" | "nao_admin" | "saiu";

export default function GruposPage() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [links, setLinks] = useState<TagLink[]>([]);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [tagFiltro, setTagFiltro] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [novaTag, setNovaTag] = useState({ nome: "", cor: CORES[5] });
  const [tagMassa, setTagMassa] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [g, t, l] = await Promise.all([lerGrupos(), lerTags(), lerLinks()]);
      setGrupos(g); setTags(t); setLinks(l);
    } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const tagsDe = useMemo(() => {
    const m = new Map<string, Tag[]>();
    const porId = new Map(tags.map((t) => [t.id, t]));
    for (const l of links) { const t = porId.get(l.tag_id); if (t) m.set(l.grupo_jid, [...(m.get(l.grupo_jid) || []), t]); }
    return m;
  }, [tags, links]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return grupos.filter((g) => {
      if (filtro === "saiu" ? !g.saiu_em : g.saiu_em) return false;
      if (filtro === "sem_tag" && (tagsDe.get(g.jid) || []).length) return false;
      if (filtro === "admin" && !g.eu_admin) return false;
      if (filtro === "nao_admin" && g.eu_admin !== false) return false;
      if (tagFiltro && !(tagsDe.get(g.jid) || []).some((t) => t.id === tagFiltro)) return false;
      return !b || (g.nome || "").toLowerCase().includes(b) || (g.descricao || "").toLowerCase().includes(b);
    });
  }, [grupos, busca, filtro, tagFiltro, tagsDe]);

  async function acao<T>(f: () => Promise<T>, sucesso?: (r: T) => string) {
    setOcupado(true); setErro(null); setMsg(null);
    try { const r = await f(); if (sucesso) setMsg(sucesso(r)); await carregar(); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  const alternar = (jid: string) => setMarcados((s) => { const n = new Set(s); if (n.has(jid)) n.delete(jid); else n.add(jid); return n; });
  const todosMarcados = lista.length > 0 && lista.every((g) => marcados.has(g.jid));
  const ativos = grupos.filter((g) => !g.saiu_em);

  return (
    <Page wide>
      <PageHeader crumb="Marketing · Grupos" title="Grupos do WhatsApp"
        subtitle={`${ativos.length} grupos no chip do Marketing`}
        actions={<Btn variant="primary" disabled={ocupado} onClick={() => void acao(() => api<{ grupos: number; sairam: number; saida_suspeita: number }>("sincronizar"),
          (r) => `${r.grupos} grupos lidos${r.sairam ? ` · ${r.sairam} marcados como "saiu"` : ""}${r.saida_suspeita ? ` · ${r.saida_suspeita} sumiram mas NÃO foram marcados (suspeito — confira)` : ""}.`)}>
          {ocupado ? "Aguarde…" : "Sincronizar com o WhatsApp"}</Btn>} />
      <div className="flex flex-col gap-4">
        {erro && <Alert tone="danger">{erro}</Alert>}
        {msg && <Alert tone="ok">{msg}</Alert>}

        <Card title="Tags de grupo">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1">
                <TagChip tag={t} ativo={tagFiltro === t.id} onClick={() => setTagFiltro(tagFiltro === t.id ? null : t.id)} />
                <button type="button" aria-label={`Apagar a tag ${t.nome}`} className="text-[12px] qs-tone-muted"
                  onClick={() => { if (confirm(`Apagar a tag "${t.nome}"? Os grupos continuam; só a etiqueta sai.`)) void acao(() => apagarTag(t.id)); }}>✕</button>
              </span>
            ))}
            {!tags.length && <span className="text-[13px] qs-tone-muted">Crie tags pra agrupar (ex.: “Live Japão”, “Expedição Peru 2027”).</span>}
          </div>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (novaTag.nome.trim()) void acao(() => criarTag(novaTag.nome, novaTag.cor), () => "Tag criada.").then(() => setNovaTag({ ...novaTag, nome: "" })); }}>
            <input className={classeCampo} style={{ ...estiloCampo, maxWidth: 240 }} maxLength={40} placeholder="Nova tag" value={novaTag.nome} onChange={(e) => setNovaTag({ ...novaTag, nome: e.target.value })} />
            <div className="flex gap-1">
              {CORES.map((c) => (
                <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setNovaTag({ ...novaTag, cor: c })}
                  style={{ width: 22, height: 22, borderRadius: 99, background: c, outline: novaTag.cor === c ? "2px solid var(--ink)" : "none", outlineOffset: 2 }} />
              ))}
            </div>
            <Btn type="submit" size="sm" disabled={ocupado}>Criar</Btn>
          </form>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <div style={{ minWidth: 240, flex: "1 1 240px" }}><SearchInput placeholder="Buscar por nome ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          {([["todos", "Todos"], ["sem_tag", "Sem tag"], ["admin", "Sou admin"], ["nao_admin", "Não sou admin"], ["saiu", "Saí"]] as [Filtro, string][]).map(([v, r]) => (
            <FilterPill key={v} active={filtro === v} onClick={() => setFiltro(v)}>{r}</FilterPill>
          ))}
        </div>

        {marcados.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
            <strong className="text-[14px]">{marcados.size} marcados</strong>
            <select className="px-2 py-1.5 rounded-lg text-[14px]" style={estiloCampo} value={tagMassa} onChange={(e) => setTagMassa(e.target.value)}>
              <option value="">Escolha a tag…</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <Btn size="sm" disabled={!tagMassa || ocupado} onClick={() => void acao(() => aplicarTag(tagMassa, [...marcados]), () => "Tag aplicada.")}>Aplicar tag</Btn>
            <Btn size="sm" disabled={!tagMassa || ocupado} onClick={() => void acao(() => aplicarTag(tagMassa, [...marcados], true), () => "Tag tirada.")}>Tirar tag</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setMarcados(new Set())}>Limpar seleção</Btn>
          </div>
        )}

        <div className="grid gap-4" style={{ gridTemplateColumns: aberto ? "minmax(0,1fr) minmax(0,420px)" : "minmax(0,1fr)" }}>
          <div className="qs-table-wrap">
            <table className="qs-table">
              <thead><tr>
                <th style={{ width: 32 }}><input type="checkbox" aria-label="Marcar todos" checked={todosMarcados}
                  onChange={() => setMarcados(todosMarcados ? new Set() : new Set(lista.map((g) => g.jid)))} /></th>
                <th>Grupo</th><th>Tags</th><th style={{ textAlign: "right" }}>Pessoas</th><th>Admin</th>
              </tr></thead>
              <tbody>
                {lista.map((g) => (
                  <tr key={g.jid} onClick={() => setAberto(g.jid)} style={{ cursor: "pointer", background: aberto === g.jid ? "var(--card2)" : undefined }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Marcar ${g.nome || g.jid}`} checked={marcados.has(g.jid)} onChange={() => alternar(g.jid)} /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        {g.foto_url ? <img src={g.foto_url} alt="" width={28} height={28} style={{ borderRadius: 99 }} /> : <span aria-hidden style={{ width: 28, height: 28, borderRadius: 99, background: "var(--line)", display: "inline-block" }} />}
                        <span className="truncate">{g.nome || g.jid}</span>
                      </div>
                    </td>
                    <td><div className="flex flex-wrap gap-1">{(tagsDe.get(g.jid) || []).map((t) => (
                      <span key={t.id} className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: t.cor, color: "#fff" }}>{t.nome}</span>))}</div></td>
                    <td style={{ textAlign: "right" }} className="qs-num">{g.participantes ?? "—"}</td>
                    <td>{g.eu_admin ? "sim" : g.eu_admin === false ? "não" : "—"}</td>
                  </tr>
                ))}
                {!lista.length && <tr><td colSpan={5} className="qs-tone-muted">Nenhum grupo {grupos.length ? "neste filtro" : "— clique em Sincronizar"}.</td></tr>}
              </tbody>
            </table>
          </div>
          {aberto && <DadosDoGrupo jid={aberto} grupo={grupos.find((g) => g.jid === aberto) || null} onFechar={() => setAberto(null)} onMudou={carregar} />}
        </div>
      </div>
    </Page>
  );
}

function DadosDoGrupo({ jid, grupo, onFechar, onMudou }: { jid: string; grupo: Grupo | null; onFechar: () => void; onMudou: () => Promise<void> }) {
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [link, setLink] = useState<string | null>(grupo?.link_convite || null);
  useEffect(() => { setLink(grupo?.link_convite || null); setErro(null); }, [jid, grupo?.link_convite]);

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
    <Card title={grupo?.nome || jid} action={<Btn size="sm" variant="ghost" onClick={onFechar}>Fechar</Btn>}>
      <div className="flex flex-col gap-3 text-[14px]">
        {grupo?.foto_url && <img src={grupo.foto_url} alt={`Foto do grupo ${grupo.nome || ""}`} width={96} height={96} style={{ borderRadius: 12 }} />}
        {erro && <Alert tone="danger">{erro}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" disabled={lendo} onClick={() => void atualizar()}>{lendo ? "Lendo…" : "Ler dados no WhatsApp"}</Btn>
          <Btn size="sm" onClick={() => void verLink()}>Ver link de convite</Btn>
        </div>
        {link && (
          <div className="flex items-center gap-2">
            <code className="truncate text-[13px]">{link}</code>
            <Btn size="sm" onClick={() => void navigator.clipboard.writeText(link)}>Copiar</Btn>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {grupo?.saiu_em && <StatusChip tone="danger">O número saiu em {quando(grupo.saiu_em)}</StatusChip>}
          {grupo?.eu_admin && <StatusChip tone="ok">Chip é admin</StatusChip>}
          {grupo?.so_admins_enviam && <StatusChip tone="warn">Só admins mandam</StatusChip>}
          {grupo?.so_admins_editam && <StatusChip>Só admins editam</StatusChip>}
        </div>
        <div><div className="qs-label">Descrição</div><p className="whitespace-pre-wrap">{grupo?.descricao || "—"}</p></div>
        <div>
          <div className="qs-label">Admins ({grupo?.admins?.length || 0})</div>
          <ul className="text-[13px]">{(grupo?.admins || []).map((a) => <li key={a.id}>{a.telefone ? `+${a.telefone}` : a.id} · {a.admin}</li>)}</ul>
        </div>
        <div>
          <div className="qs-label">Participantes ({grupo?.participantes ?? parts.length})</div>
          {parts.length ? (
            <ul className="text-[13px] max-h-64 overflow-auto">{parts.map((p) => <li key={p.id}>{p.telefone ? `+${p.telefone}` : p.id}{p.admin ? " · admin" : ""}</li>)}</ul>
          ) : <p className="text-[13px] qs-tone-muted">Clique em “Ler dados no WhatsApp” pra ver a lista.</p>}
        </div>
        <p className="text-[12px] qs-tone-muted">Lido em {quando(grupo?.info_em || null)} · sincronizado em {quando(grupo?.sincronizado_em || null)}</p>
      </div>
    </Card>
  );
}
