// src/mkt/disparos/ContatosPage.tsx
// -----------------------------------------------------------------------------
// CONTATOS DO MARKETING (0242) — a base do SendFlow dentro do QS.
//   • importar CSV (telefone com DDI e 9º dígito, acento no cabeçalho, repetido
//     no arquivo e no banco — regras em ./regras.ts e mkt_importar_contatos);
//   • listas, tags, opt-out (WhatsApp e e-mail);
//   • ficha do contato com a linha do tempo (mkt_contato_eventos).
// Tudo direto no banco: a RLS da 0242 deixa o Marketing escrever só nas mkt_*.
// -----------------------------------------------------------------------------
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, EmptyState, ProgressBar, SearchInput, Segmented } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { Campo, INPUT, INPUT_ESTILO, Modal } from "@/components/sdr/disparos/pecas";
import {
  anotar, apagarContatos, apagarLista, importarContatos, lerContato, listarContatos, listarListas, mudarOptout, mudarTags,
  porNaLista, POR_PAGINA, ROTULO_EVENTO, salvarContato, salvarLista, tagsEmUso, tirarDaLista,
  type Contato, type EventoContato, type FiltroContatos, type Lista, type ResultadoImportacao,
} from "./api";
import { formatarTelefone, lerCsvDeContatos, mapearColunas, normalizarEmail, normalizarTelefone, parseCsv, separarTags, type MapaColunas, type ResultadoCsv } from "./regras";

// 04/11/2026: em Brasília, não no fuso do navegador.
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

// ── Importar CSV ────────────────────────────────────────────────────────────

function Importar({ listas, onFechar, onFeito }: { listas: Lista[]; onFechar: () => void; onFeito: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState("");
  const [colunas, setColunas] = useState<MapaColunas | null>(null);
  const [lista, setLista] = useState("");
  const [novaLista, setNovaLista] = useState("");
  const [tags, setTags] = useState("");
  const [andando, setAndando] = useState<number | null>(null);
  const [fim, setFim] = useState<ResultadoImportacao | null>(null);
  const cabecalho = useMemo(() => (texto ? parseCsv(texto)[0] ?? [] : []), [texto]);
  const leitura: ResultadoCsv | null = useMemo(() => (texto && colunas ? lerCsvDeContatos(texto, colunas) : null), [texto, colunas]);

  async function ler(f: File) {
    const t = await f.text();
    setArquivo(f.name); setTexto(t); setFim(null);
    setColunas(mapearColunas(parseCsv(t)[0] ?? []));
  }
  const escolher = (campo: "nome" | "telefone" | "email" | "tags", i: string) => {
    if (!colunas) return;
    const n = i === "" ? null : Number(i);
    const fixos = new Set([...(["nome", "telefone", "email", "tags"] as const).filter((k) => k !== campo).map((k) => colunas[k]), n]);
    const extras = cabecalho.map((c, idx) => ({ chave: c.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""), indice: idx }))
      .filter((e) => e.chave && !fixos.has(e.indice));
    setColunas({ ...colunas, [campo]: n, extras });
  };

  async function importar() {
    if (!leitura?.contatos.length) return;
    try {
      let alvo = lista || null;
      if (!alvo && novaLista.trim()) alvo = (await salvarLista(null, novaLista.trim(), `Importada de ${arquivo}`)).id;
      setAndando(0);
      const r = await importarContatos(leitura.contatos, { lista: alvo, tags: separarTags(tags), origem: `csv:${arquivo}`.slice(0, 120) }, setAndando);
      setFim(r); onFeito();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não importou."); }
    finally { setAndando(null); }
  }

  return (
    <Modal aberto titulo="Importar contatos (CSV)" onFechar={onFechar} largura={820}
      rodape={<>
        <Button variant="ghost" onClick={onFechar}>{fim ? "Fechar" : "Cancelar"}</Button>
        {!fim && <Button variant="primary" disabled={!leitura?.contatos.length || andando !== null} onClick={() => void importar()}>
          {andando !== null ? `Importando… ${andando}/${leitura?.contatos.length}` : `Importar ${leitura?.contatos.length ?? 0}`}
        </Button>}
      </>}>
      {fim ? (
        <div className="space-y-2 text-[14px]" style={{ color: "var(--text)" }}>
          <p><b className="qs-num">{fim.novos}</b> novos · <b className="qs-num">{fim.atualizados}</b> já existiam (completados, tags somadas) · <b className="qs-num">{fim.ignorados}</b> ignorados no banco</p>
          {fim.conflitos > 0 && (
            <Alert tone="warn">
              {fim.conflitos} linha(s) com telefone de uma ficha e e-mail de OUTRA — não juntei sozinho. Ex.: {fim.exemplos_conflito.slice(0, 5).map((c) => `${c.telefone ?? "—"} / ${c.email ?? "—"}`).join("; ")}
            </Alert>
          )}
        </div>
      ) : (
        <>
          <Campo rotulo="Arquivo" dica="CSV do Excel (; ou ,), Google Planilhas ou exportado de outro sistema. Primeira linha = cabeçalho.">
            <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); }} />
          </Campo>
          {colunas && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                {(["nome", "telefone", "email", "tags"] as const).map((k) => (
                  <Campo key={k} rotulo={k === "email" ? "E-mail" : k[0].toUpperCase() + k.slice(1)}>
                    <select className={INPUT} style={INPUT_ESTILO} value={colunas[k] ?? ""} onChange={(e) => escolher(k, e.target.value)}>
                      <option value="">— nenhuma —</option>
                      {cabecalho.map((c, i) => <option key={i} value={i}>{c || `coluna ${i + 1}`}</option>)}
                    </select>
                  </Campo>
                ))}
              </div>
              <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
                Viram campos do contato (dá pra usar no disparo): {colunas.extras.map((e) => e.chave).join(", ") || "nenhuma coluna"}.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo rotulo="Pôr na lista">
                  <select className={INPUT} style={INPUT_ESTILO} value={lista} onChange={(e) => setLista(e.target.value)}>
                    <option value="">— nenhuma / nova —</option>
                    {listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
                </Campo>
                {!lista && <Campo rotulo="…ou criar a lista"><input className={INPUT} style={INPUT_ESTILO} value={novaLista} onChange={(e) => setNovaLista(e.target.value)} placeholder="Ex.: Live Japão 28/10" /></Campo>}
                <Campo rotulo="Tags pra todos"><input className={INPUT} style={INPUT_ESTILO} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="live-japao, 2027" /></Campo>
              </div>
            </>
          )}
          {leitura && (
            <div className="qs-card p-3 space-y-2">
              <p className="text-[14px]" style={{ color: "var(--text)" }}>
                <b className="qs-num">{leitura.contatos.length}</b> de {leitura.total} linhas prontas · {leitura.contatos.filter((c) => c.telefone).length} com WhatsApp · {leitura.contatos.filter((c) => c.email).length} com e-mail
              </p>
              {leitura.ignoradas.length > 0 && (
                <details>
                  <summary className="text-[12.5px] cursor-pointer" style={{ color: "var(--muted)" }}>{leitura.ignoradas.length} linha(s) ficam de fora — ver por quê</summary>
                  <ul className="max-h-[160px] overflow-y-auto text-[12.5px]" style={{ color: "var(--muted)" }}>
                    {leitura.ignoradas.slice(0, 300).map((i) => <li key={i.linha}>Linha {i.linha}: {i.motivo}</li>)}
                  </ul>
                </details>
              )}
              <ul className="text-[12.5px]" style={{ color: "var(--subtle)" }}>
                {leitura.contatos.slice(0, 5).map((c, i) => <li key={i}>{c.nome ?? "—"} · {c.telefone ? formatarTelefone(c.telefone) : "sem WhatsApp"} · {c.email ?? "sem e-mail"}{c.tags.length ? ` · ${c.tags.join(", ")}` : ""}</li>)}
              </ul>
            </div>
          )}
          {andando !== null && <ProgressBar value={((andando || 0) / Math.max(1, leitura?.contatos.length ?? 1)) * 100} label="Importando" />}
        </>
      )}
    </Modal>
  );
}

// ── Ficha do contato ────────────────────────────────────────────────────────

function Ficha({ id, listas, onFechar, onMudou }: { id: string | "novo"; listas: Lista[]; onFechar: () => void; onMudou: () => void }) {
  const [c, setC] = useState<Contato | null>(null);
  const [eventos, setEventos] = useState<EventoContato[]>([]);
  const [minhas, setMinhas] = useState<string[]>([]);
  const [form, setForm] = useState({ nome: "", telefone: "", email: "", tags: "" });
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (id === "novo") return;
    try {
      const r = await lerContato(id);
      setC(r.contato); setEventos(r.eventos); setMinhas(r.listas);
      setForm({ nome: r.contato.nome ?? "", telefone: r.contato.telefone ?? "", email: r.contato.email ?? "", tags: r.contato.tags.join(", ") });
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não abriu."); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  const tel = form.telefone ? normalizarTelefone(form.telefone) : "";
  const telInvalido = !!form.telefone && !tel;

  async function salvar() {
    setSalvando(true);
    try {
      const salvo = await salvarContato(id === "novo" ? null : id, {
        nome: form.nome.trim() || null, telefone: tel || null, email: normalizarEmail(form.email) || null, tags: separarTags(form.tags),
      });
      notifySuccess("Contato salvo."); onMudou();
      if (id === "novo") onFechar(); else { setC(salvo); void carregar(); }
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  const resumo = (ev: EventoContato) => {
    const d = ev.dados ?? {};
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    return s("texto") ?? s("lista") ?? s("campanha") ?? s("origem") ?? null;
  };

  return (
    <Modal aberto titulo={id === "novo" ? "Novo contato" : (c?.nome || (c?.telefone ? formatarTelefone(c.telefone) : c?.email) || "Contato")} onFechar={onFechar} largura={860}
      rodape={<>
        <Button variant="ghost" onClick={onFechar}>Fechar</Button>
        <Button variant="primary" disabled={salvando || telInvalido || (!tel && !form.email.trim())} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <Campo rotulo="Nome"><input className={INPUT} style={INPUT_ESTILO} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Campo>
          <Campo rotulo="WhatsApp" dica={telInvalido ? <span className="qs-tone-danger">Telefone inválido</span> : tel ? formatarTelefone(tel) : "Com DDD; o 55 e o 9º dígito o QS põe sozinho"}>
            <input className={INPUT} style={INPUT_ESTILO} value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
          </Campo>
          <Campo rotulo="E-mail"><input className={INPUT} style={INPUT_ESTILO} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Campo>
          <Campo rotulo="Tags" dica="Separe por vírgula"><input className={INPUT} style={INPUT_ESTILO} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Campo>
          {c && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={c.optout_whatsapp_em ? "primary" : "secondary"} onClick={async () => { try { await mudarOptout(c.id, "whatsapp", !c.optout_whatsapp_em); void carregar(); onMudou(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>
                  {c.optout_whatsapp_em ? "Voltar a receber WhatsApp" : "Não mandar mais WhatsApp"}
                </Button>
                <Button size="sm" variant={c.optout_email_em ? "primary" : "secondary"} onClick={async () => { try { await mudarOptout(c.id, "email", !c.optout_email_em); void carregar(); onMudou(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>
                  {c.optout_email_em ? "Voltar a receber e-mail" : "Não mandar mais e-mail"}
                </Button>
              </div>
              {c.optout_whatsapp_em && <Alert tone="warn">Pediu pra não receber WhatsApp em {quando(c.optout_whatsapp_em)}. Só volte se a PESSOA pedir.</Alert>}
              <Campo rotulo="Listas">
                <div className="flex flex-wrap gap-1.5">
                  {listas.map((l) => {
                    const on = minhas.includes(l.id);
                    return (
                      <button key={l.id} type="button" aria-pressed={on} className="rounded-full border px-2.5 py-1 text-[12.5px]"
                        style={on ? { background: "var(--text)", color: "var(--surface)", borderColor: "var(--text)" } : { background: "var(--surface)", color: "var(--muted)", borderColor: "var(--border)" }}
                        onClick={async () => { try { if (on) await tirarDaLista(l.id, [c.id]); else await porNaLista(l.id, [c.id]); void carregar(); onMudou(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>
                        {l.nome}
                      </button>
                    );
                  })}
                  {!listas.length && <span className="text-[12.5px]" style={{ color: "var(--subtle)" }}>Nenhuma lista.</span>}
                </div>
              </Campo>
              {Object.keys(c.campos ?? {}).length > 0 && (
                <Campo rotulo="Campos">
                  <dl className="text-[12.5px] grid grid-cols-[auto_1fr] gap-x-3" style={{ color: "var(--text)" }}>
                    {Object.entries(c.campos).map(([k, v]) => <Fragment key={k}><dt style={{ color: "var(--muted)" }}>{k}</dt><dd>{String(v)}</dd></Fragment>)}
                  </dl>
                </Campo>
              )}
              <p className="text-[12px]" style={{ color: "var(--subtle)" }}>Origem: {c.origem ?? "—"} · score {c.score} · entrou {quando(c.criado_em)}</p>
            </>
          )}
        </div>
        {c && (
          <div className="space-y-2">
            <p className="qs-label">Linha do tempo</p>
            <div className="flex gap-2">
              <input className={INPUT} style={INPUT_ESTILO} value={nota} placeholder="Escrever uma nota…" onChange={(e) => setNota(e.target.value)} />
              <Button size="sm" disabled={!nota.trim()} onClick={async () => { try { await anotar(c.id, nota.trim()); setNota(""); void carregar(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>Anotar</Button>
            </div>
            {eventos.length === 0 ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Nada ainda.</p> : (
              <ol className="max-h-[420px] overflow-y-auto space-y-1.5">
                {eventos.map((ev) => (
                  <li key={ev.id} className="text-[13px]" style={{ color: "var(--text)" }}>
                    <span style={{ color: "var(--subtle)" }}>{quando(ev.criado_em)}</span> · {ROTULO_EVENTO[ev.tipo] ?? ev.tipo}
                    {resumo(ev) && <span style={{ color: "var(--muted)" }}> — {resumo(ev)}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

type Aba = "contatos" | "listas";

export default function ContatosPage() {
  const [aba, setAba] = useState<Aba>("contatos");
  const [f, setF] = useState<FiltroContatos>({ pagina: 0, optout: "" });
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Contato[] | null>(null);
  const [total, setTotal] = useState(0);
  const [listas, setListas] = useState<Lista[]>([]);
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [importando, setImportando] = useState(false);
  const [abrindo, setAbrindo] = useState<string | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lote, setLote] = useState({ lista: "", tag: "" });

  const carregarApoio = useCallback(async () => {
    const [l, t] = await Promise.all([listarListas().catch(() => []), tagsEmUso().catch(() => [])]);
    setListas(l); setTags(t);
  }, []);
  const carregar = useCallback(async () => {
    try { const r = await listarContatos(f); setLinhas(r.linhas); setTotal(r.total); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); setLinhas([]); }
  }, [f]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { void carregarApoio(); }, [carregarApoio]);
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, busca, pagina: 0 })), 350); return () => clearTimeout(t); }, [busca]);

  const tudo = () => { void carregar(); void carregarApoio(); };
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const todosMarcados = !!linhas?.length && linhas.every((c) => marcados.includes(c.id));

  async function emLote(acao: "lista" | "tag" | "tirar_tag" | "apagar") {
    if (!marcados.length) return;
    try {
      if (acao === "lista" && lote.lista) await porNaLista(lote.lista, marcados);
      if (acao === "tag" && lote.tag.trim()) await mudarTags(marcados, separarTags(lote.tag));
      if (acao === "tirar_tag" && lote.tag.trim()) await mudarTags(marcados, [], separarTags(lote.tag));
      if (acao === "apagar") {
        if (!window.confirm(`Apagar ${marcados.length} contato(s)? A linha do tempo vai junto. Quem pediu PARAR deixa de ser lembrado.`)) return;
        await apagarContatos(marcados);
      }
      notifySuccess("Feito."); setMarcados([]); tudo();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>A base do Marketing: importe planilhas, organize em listas e tags e use no disparo.</p>
        <div className="flex gap-2"><Button onClick={() => setAbrindo("novo")}>+ Contato</Button><Button variant="primary" onClick={() => setImportando(true)}>Importar CSV</Button></div>
      </div>
      {erro && <Alert tone="danger">{erro}</Alert>}
      <Segmented options={[{ value: "contatos" as Aba, label: "Contatos", count: total }, { value: "listas" as Aba, label: "Listas", count: listas.length }]} value={aba} onChange={setAba} label="Seções" />

      {aba === "contatos" && (
        <>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="min-w-[220px] flex-1"><SearchInput placeholder="Nome, e-mail ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
            <select className={INPUT} style={{ ...INPUT_ESTILO, width: 200 }} value={f.lista ?? ""} onChange={(e) => setF({ ...f, lista: e.target.value || undefined, pagina: 0 })}>
              <option value="">Todas as listas</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.nome} ({l.total})</option>)}
            </select>
            <select className={INPUT} style={{ ...INPUT_ESTILO, width: 180 }} value={f.tag ?? ""} onChange={(e) => setF({ ...f, tag: e.target.value || undefined, pagina: 0 })}>
              <option value="">Todas as tags</option>{tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
            </select>
            <select className={INPUT} style={{ ...INPUT_ESTILO, width: 190 }} value={f.optout ?? ""} onChange={(e) => setF({ ...f, optout: e.target.value as FiltroContatos["optout"], pagina: 0 })}>
              <option value="">Recebe e não recebe</option><option value="nao">Recebe WhatsApp</option><option value="sim">Pediu pra parar</option>
            </select>
          </div>

          {marcados.length > 0 && (
            <div className="qs-card p-3 flex flex-wrap items-center gap-2">
              <span className="text-[13px]" style={{ color: "var(--text)" }}><b>{marcados.length}</b> marcado(s):</span>
              <select className={INPUT} style={{ ...INPUT_ESTILO, width: 180 }} value={lote.lista} onChange={(e) => setLote({ ...lote, lista: e.target.value })}>
                <option value="">Lista…</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
              <Button size="sm" disabled={!lote.lista} onClick={() => void emLote("lista")}>Pôr na lista</Button>
              {f.lista && <Button size="sm" onClick={async () => { try { await tirarDaLista(f.lista!, marcados); setMarcados([]); tudo(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>Tirar desta lista</Button>}
              <input className={INPUT} style={{ ...INPUT_ESTILO, width: 150 }} placeholder="tag" value={lote.tag} onChange={(e) => setLote({ ...lote, tag: e.target.value })} />
              <Button size="sm" disabled={!lote.tag.trim()} onClick={() => void emLote("tag")}>+ Tag</Button>
              <Button size="sm" disabled={!lote.tag.trim()} onClick={() => void emLote("tirar_tag")}>− Tag</Button>
              <Button size="sm" variant="destructive" onClick={() => void emLote("apagar")}>Apagar</Button>
            </div>
          )}

          {linhas === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p>
            : linhas.length === 0 ? (
              // 04/11/2026: filtro "Pediu pra parar"/"Recebe" sem ninguém dizia "A base está vazia".
              <div className="qs-card"><EmptyState title={f.busca || f.lista || f.tag || f.optout ? "Ninguém com esse filtro" : "A base está vazia"}
                description="Importe a planilha da live, do formulário ou de outro sistema. Telefone, e-mail e repetidos o QS acerta sozinho."
                action={<Button variant="primary" onClick={() => setImportando(true)}>Importar CSV</Button>} /></div>
            ) : (
              <div className="qs-card qs-table-wrap">
                <table className="qs-table">
                  <thead><tr>
                    <th><input type="checkbox" aria-label="Marcar todos" checked={todosMarcados} onChange={() => setMarcados(todosMarcados ? [] : linhas.map((c) => c.id))} /></th>
                    <th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>Tags</th><th>Origem</th><th>Entrou</th>
                  </tr></thead>
                  <tbody>
                    {linhas.map((c) => (
                      <tr key={c.id} className="cursor-pointer" onClick={() => setAbrindo(c.id)}>
                        <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Marcar ${c.nome ?? ""}`} checked={marcados.includes(c.id)} onChange={() => setMarcados(marcados.includes(c.id) ? marcados.filter((x) => x !== c.id) : [...marcados, c.id])} /></td>
                        <td>{c.nome ?? "—"}</td>
                        <td className="qs-num">{c.telefone ? formatarTelefone(c.telefone) : "—"}{c.optout_whatsapp_em && <> <Badge tone="danger">parou</Badge></>}</td>
                        <td>{c.email ?? "—"}{c.optout_email_em && <> <Badge tone="danger">parou</Badge></>}</td>
                        <td className="text-[12px]">{c.tags.slice(0, 4).join(", ")}{c.tags.length > 4 ? "…" : ""}</td>
                        <td className="text-[12px]">{c.origem ?? "—"}</td>
                        <td className="text-[12px]">{new Date(c.criado_em).toLocaleDateString("pt-BR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {paginas > 1 && (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--muted)" }}>
              <Button size="sm" disabled={(f.pagina ?? 0) === 0} onClick={() => setF({ ...f, pagina: (f.pagina ?? 0) - 1 })}>‹</Button>
              Página {(f.pagina ?? 0) + 1} de {paginas} · {total} contatos
              <Button size="sm" disabled={(f.pagina ?? 0) + 1 >= paginas} onClick={() => setF({ ...f, pagina: (f.pagina ?? 0) + 1 })}>›</Button>
            </div>
          )}
        </>
      )}

      {aba === "listas" && <Listas listas={listas} onMudou={tudo} onVer={(id) => { setF({ pagina: 0, lista: id, optout: "" }); setAba("contatos"); }} />}

      {importando && <Importar listas={listas} onFechar={() => setImportando(false)} onFeito={tudo} />}
      {abrindo && <Ficha id={abrindo} listas={listas} onFechar={() => setAbrindo(null)} onMudou={tudo} />}
    </div>
  );
}

function Listas({ listas, onMudou, onVer }: { listas: Lista[]; onMudou: () => void; onVer: (id: string) => void }) {
  const [editando, setEditando] = useState<Lista | "nova" | null>(null);
  const [nome, setNome] = useState("");
  const [desc, setDesc] = useState("");
  const abrir = (l: Lista | "nova") => { setEditando(l); setNome(l === "nova" ? "" : l.nome); setDesc(l === "nova" ? "" : l.descricao ?? ""); };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" onClick={() => abrir("nova")}>+ Nova lista</Button></div>
      {listas.length === 0 ? <div className="qs-card"><EmptyState title="Nenhuma lista" description="Ex.: Live Japão 28/10, Formulário China, Clientes VIP." /></div> : (
        <ul className="space-y-2">
          {listas.map((l) => (
            <li key={l.id} className="qs-card p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>{l.nome}</p>
                {l.descricao && <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{l.descricao}</p>}
              </div>
              <span className="qs-num text-[13px]" style={{ color: "var(--muted)" }}>{l.total} contato(s)</span>
              <Button size="sm" onClick={() => onVer(l.id)}>Ver contatos</Button>
              <Button size="sm" variant="ghost" onClick={() => abrir(l)}>Renomear</Button>
              <Button size="sm" variant="destructive" onClick={async () => {
                if (!window.confirm(`Apagar a lista "${l.nome}"? Os contatos continuam na base.`)) return;
                try { await apagarLista(l.id); onMudou(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
              }}>Apagar</Button>
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <Modal aberto titulo={editando === "nova" ? "Nova lista" : `Lista · ${editando.nome}`} onFechar={() => setEditando(null)} largura={480}
          rodape={<>
            <Button variant="ghost" onClick={() => setEditando(null)}>Fechar</Button>
            <Button variant="primary" disabled={nome.trim().length < 2} onClick={async () => {
              try { await salvarLista(editando === "nova" ? null : editando.id, nome.trim(), desc.trim() || null); setEditando(null); onMudou(); }
              catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
            }}>Salvar</Button>
          </>}>
          <Campo rotulo="Nome"><input className={INPUT} style={INPUT_ESTILO} value={nome} autoFocus onChange={(e) => setNome(e.target.value)} /></Campo>
          <Campo rotulo="Descrição (opcional)"><input className={INPUT} style={INPUT_ESTILO} value={desc} onChange={(e) => setDesc(e.target.value)} /></Campo>
        </Modal>
      )}
    </div>
  );
}
