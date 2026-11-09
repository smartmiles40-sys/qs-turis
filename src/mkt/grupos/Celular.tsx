// src/mkt/grupos/Celular.tsx — aba "Celular": o que está no aparelho do chip do Marketing,
// ao vivo, com a cara do WhatsApp Web (lista à esquerda, conversa à direita).
// Lê direto da Evolution pelo servidor (conversas/mensagens). Responder e reagir saem pelo
// chip, SÓ em grupo: conversa particular do número não aparece aqui (09/11/2026).
//   #mkt/grupos?aba=celular&jid=<jid>   → abre a conversa direto
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, gruposDoDestino, lerCampanhas, type Campanha } from "./lib";
import { partesSP, quandoSP } from "./datas";
import { useBases } from "./useBases";
import { irNaAba, useParam } from "./navegar";
import { Avatar, DadosDoGrupo } from "./Grupos";
import { BotaoGrande, Nota, SeloTag, cor } from "./pecas";

interface Conversa { jid: string; grupo: boolean; nome: string; foto_url: string | null; nao_lidas: number; ultima_em: string | null; previa: string }
interface Msg { id: string; de_mim: boolean; autor: string | null; autor_nome: string | null; tipo: string; texto: string; quando: string | null }
type Filtro = "mkt" | "grupos";

const REACOES = ["👍", "❤️", "😂", "😮", "🙏", "🎉"];

function horaCurta(iso: string | null): string {
  if (!iso) return "";
  const p = partesSP(iso), hoje = partesSP(Date.now());
  return p.data === hoje.data ? p.hora : p.data.split("-").reverse().slice(0, 2).join("/");
}
function rotuloDia(iso: string): string {
  const p = partesSP(iso), hoje = partesSP(Date.now()), ontem = partesSP(Date.now() - 86_400_000);
  if (p.data === hoje.data) return "Hoje";
  if (p.data === ontem.data) return "Ontem";
  return p.data.split("-").reverse().join("/");
}

export default function CelularAba() {
  const bases = useBases();
  const [jid, setJid] = useParam("jid");
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("mkt");
  const [tag, setTag] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [lendoMsgs, setLendoMsgs] = useState(false);
  const [texto, setTexto] = useState("");
  const [citando, setCitando] = useState<Msg | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [agendadas, setAgendadas] = useState<Campanha[]>([]);
  const [verDados, setVerDados] = useState(false);
  const fim = useRef<HTMLDivElement | null>(null);

  const carregarConversas = useCallback(async () => {
    setErro(null); setCarregando(true);
    try { const r = await api<{ conversas: Conversa[] }>("conversas"); setConversas(r.conversas); }
    catch (e) { setErro((e as Error).message); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => {
    void carregarConversas();
    lerCampanhas().then((cs) => setAgendadas(cs.filter((c) => c.status === "agendada" || c.status === "enviando"))).catch(() => null);
  }, [carregarConversas]);

  const carregarMsgs = useCallback(async (j: string) => {
    setLendoMsgs(true); setErro(null);
    try { const r = await api<{ mensagens: Msg[] }>("mensagens", { jid: j }); setMsgs(r.mensagens); }
    catch (e) { setErro((e as Error).message); }
    finally { setLendoMsgs(false); }
  }, []);
  useEffect(() => { setMsgs([]); setCitando(null); setTexto(""); if (jid) void carregarMsgs(jid); }, [jid, carregarMsgs]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const doMkt = useMemo(() => new Set(bases.grupos.filter((g) => !g.saiu_em).map((g) => g.jid)), [bases.grupos]);
  const jidsDaTag = useMemo(() => (tag ? new Set(bases.links.filter((l) => l.tag_id === tag).map((l) => l.grupo_jid)) : null), [tag, bases.links]);
  const contagem = useMemo(() => ({
    mkt: conversas.filter((c) => c.grupo && doMkt.has(c.jid)).length,
    grupos: conversas.filter((c) => c.grupo).length,
    tudo: conversas.length,
  }), [conversas, doMkt]);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return conversas.filter((c) => {
      if (filtro === "mkt" && !(c.grupo && doMkt.has(c.jid))) return false;
      if (filtro === "grupos" && !c.grupo) return false;
      if (jidsDaTag && !jidsDaTag.has(c.jid)) return false;
      return !b || c.nome.toLowerCase().includes(b);
    });
  }, [conversas, filtro, busca, doMkt, jidsDaTag]);

  const aberta: Conversa | null = jid
    ? conversas.find((c) => c.jid === jid) || (() => {
      const g = bases.grupos.find((x) => x.jid === jid);
      return { jid, grupo: jid.endsWith("@g.us"), nome: g?.nome || jid, foto_url: g?.foto_url || null, nao_lidas: 0, ultima_em: null, previa: "" };
    })()
    : null;
  const grupoDb = aberta ? bases.grupos.find((g) => g.jid === aberta.jid) || null : null;
  const tagsDoGrupo = aberta ? bases.tags.filter((t) => bases.links.some((l) => l.tag_id === t.id && l.grupo_jid === aberta.jid)) : [];
  const podeResponder = aberta ? aberta.grupo : false;
  const agendadasAqui = useMemo(() => (aberta?.grupo
    ? agendadas.filter((c) => gruposDoDestino(c, bases.grupos, bases.links).some((g) => g.jid === aberta.jid))
      .sort((a, b) => String(a.enviar_em).localeCompare(String(b.enviar_em)))
    : []), [aberta?.grupo, aberta?.jid, agendadas, bases.grupos, bases.links]);

  async function enviar() {
    if (!aberta || !texto.trim() || enviando) return;
    setErro(null); setEnviando(true);
    try {
      await api("enviar", { jid: aberta.jid, texto, ...(citando ? { citar: { id: citando.id, fromMe: citando.de_mim, participant: citando.autor, texto: citando.texto } } : {}) });
      setTexto(""); setCitando(null);
      await carregarMsgs(aberta.jid);
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }
  async function reagir(m: Msg, emoji: string) {
    if (!aberta) return;
    try { await api("reagir", { jid: aberta.jid, msg: { id: m.id, fromMe: m.de_mim, participant: m.autor }, emoji }); }
    catch (e) { setErro((e as Error).message); }
  }

  const FILTROS: { v: Filtro; r: string }[] = [
    { v: "mkt", r: "Grupos do Marketing" }, { v: "grupos", r: "Todos os grupos" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold" style={{ color: cor.ink }}>Celular do Marketing</h2>
          <p className="mt-1 text-[14px]" style={{ color: cor.ink3 }}>O que está no aparelho do chip, ao vivo. Responder e reagir saem pelo chip do Marketing.</p>
        </div>
        <BotaoGrande pequeno variante="secundario" disabled={carregando} onClick={() => void carregarConversas()}>{carregando ? "Lendo…" : "🔄 Atualizar"}</BotaoGrande>
      </div>
      {erro && <div className="mb-4"><Nota tom="erro" icone="⚠️">{erro}</Nota></div>}

      <div className="grid overflow-hidden rounded-[14px] md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" style={{ border: "1px solid var(--line)", height: "min(76vh, 760px)", minHeight: 480 }}>
        {/* Lista */}
        <div className={`${aberta ? "hidden md:flex" : "flex"} min-h-0 flex-col`} style={{ background: cor.card, borderRight: "1px solid var(--line)" }}>
          <div className="flex flex-col gap-2 p-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <input className="rel-input" type="search" placeholder="🔍 Buscar conversa" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversa" />
            <div className="flex flex-wrap gap-1.5">
              {FILTROS.map((x) => (
                <button key={x.v} type="button" onClick={() => setFiltro(x.v)} aria-pressed={filtro === x.v}
                  className="whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium"
                  style={filtro === x.v ? { background: cor.relSoft, color: cor.relInk, border: "1.5px solid var(--rel)" } : { background: cor.card2, color: cor.ink2, border: "1px solid var(--line)" }}>
                  {x.r} <span style={{ opacity: 0.6 }}>{contagem[x.v]}</span>
                </button>
              ))}
            </div>
            {bases.tags.length > 0 && (
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {bases.tags.map((t) => <SeloTag key={t.id} tag={t} pequeno ativo={tag === t.id} onClick={() => setTag(tag === t.id ? null : t.id)} />)}
              </div>
            )}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {lista.map((c) => (
              <li key={c.jid}>
                <button type="button" onClick={() => setJid(c.jid)} className="gr-linha flex w-full items-center gap-3 px-3 py-2.5 text-left"
                  style={{ background: jid === c.jid ? cor.card2 : undefined, borderBottom: "1px solid var(--line)" }}>
                  <Avatar grupo={{ nome: c.nome, foto_url: c.foto_url }} tamanho={42} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <b className="truncate text-[14px]" style={{ color: cor.ink }}>{c.nome}</b>
                      <span className="shrink-0 text-[11px]" style={{ color: c.nao_lidas ? "var(--rel-ink)" : cor.ink3 }}>{horaCurta(c.ultima_em)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: cor.ink3 }}>{c.previa || "—"}</span>
                      {c.nao_lidas > 0 && <span className="shrink-0 rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: "var(--rel)" }}>{c.nao_lidas}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!lista.length && <li className="px-4 py-6 text-center text-[13px]" style={{ color: cor.ink3 }}>{carregando ? "Lendo o aparelho…" : "Nenhuma conversa neste filtro."}</li>}
          </ul>
        </div>

        {/* Conversa */}
        <div className={`${aberta ? "flex" : "hidden md:flex"} min-h-0 flex-col`}>
          {!aberta ? (
            <div className="wa-tela flex flex-1 flex-col items-center justify-center p-6 text-center">
              <span className="text-[40px]" aria-hidden>📱</span>
              <p className="wa-cinza mt-2 text-[14px]">Escolha uma conversa à esquerda.</p>
            </div>
          ) : (
            <>
              <div className="wa-barra flex items-center gap-2.5 px-3 py-2.5">
                <button type="button" className="text-[20px] md:hidden" aria-label="Voltar para a lista" onClick={() => setJid(null)}>‹</button>
                <Avatar grupo={{ nome: aberta.nome, foto_url: aberta.foto_url }} tamanho={38} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => aberta.grupo && setVerDados(true)} disabled={!aberta.grupo}>
                  <div className="truncate text-[15px] font-semibold">{aberta.nome}</div>
                  <div className="wa-cinza truncate text-[12px]">
                    {aberta.grupo ? `${grupoDb?.participantes ?? "?"} participantes · toque para ver os dados` : "conversa individual"}
                  </div>
                </button>
                <button type="button" className="gr-icone-btn" aria-label="Recarregar a conversa" title="Recarregar" onClick={() => void carregarMsgs(aberta.jid)}>⟳</button>
              </div>
              {(tagsDoGrupo.length > 0 || agendadasAqui.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-[12px]" style={{ background: cor.card, borderBottom: "1px solid var(--line)", color: cor.ink3 }}>
                  {tagsDoGrupo.map((t) => <SeloTag key={t.id} tag={t} pequeno />)}
                  {agendadasAqui.length > 0 && (
                    <button type="button" className="ml-auto font-semibold" style={{ color: cor.relInk }}
                      onClick={() => irNaAba("campanhas", { campanha: agendadasAqui[0].id })}>
                      📅 {agendadasAqui.length} agendada{agendadasAqui.length === 1 ? "" : "s"} para este grupo · próxima {quandoSP(agendadasAqui[0].enviar_em)} ›
                    </button>
                  )}
                </div>
              )}
              <div className="wa-tela min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
                {lendoMsgs && !msgs.length && <p className="wa-cinza text-center text-[13px]">Lendo as mensagens…</p>}
                {!lendoMsgs && !msgs.length && <p className="wa-cinza text-center text-[13px]">Sem mensagens carregadas.</p>}
                {msgs.map((m, i) => {
                  const dia = m.quando ? rotuloDia(m.quando) : null;
                  const novoDia = dia && (i === 0 || (msgs[i - 1].quando ? rotuloDia(msgs[i - 1].quando as string) : null) !== dia);
                  return (
                    <div key={m.id}>
                      {novoDia && <div className="my-3 text-center"><span className="wa-dia inline-block rounded-lg px-3 py-1 text-[12px] shadow-sm">{dia}</span></div>}
                      <div className={`group mb-1.5 flex ${m.de_mim ? "justify-end" : "justify-start"}`}>
                        <div className={`${m.de_mim ? "wa-eu rounded-tr-[2px]" : "wa-outro rounded-tl-[2px]"} max-w-[82%] rounded-[10px] px-2.5 pb-1.5 pt-1.5 text-[14px] leading-[1.4] shadow-sm`}>
                          {!m.de_mim && aberta.grupo && <div className="wa-azul text-[12.5px] font-semibold">{m.autor_nome || m.autor}</div>}
                          {m.tipo !== "texto" && <div className="wa-cinza text-[12px]">[{m.tipo}]</div>}
                          {m.texto && <div className="whitespace-pre-wrap break-words">{m.texto}</div>}
                          <div className="mt-0.5 flex items-center gap-1.5">
                            {podeResponder && (
                              <span className="flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                                <button type="button" className="wa-cinza text-[13px]" onClick={() => setCitando(m)} aria-label="Responder citando" title="Responder">↩</button>
                                {REACOES.map((e) => <button key={e} type="button" className="text-[13px]" onClick={() => void reagir(m, e)} aria-label={`Reagir ${e}`}>{e}</button>)}
                              </span>
                            )}
                            <span className="wa-cinza ml-auto text-[10.5px]">{m.quando ? partesSP(m.quando).hora : ""}{m.de_mim ? " ✓✓" : ""}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={fim} />
              </div>
              {podeResponder ? (
                <form className="wa-barra flex flex-col gap-2 px-3 py-2.5" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
                  {citando && (
                    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]" style={{ background: "rgba(0,0,0,.06)", borderLeft: "3px solid var(--rel)" }}>
                      <span className="min-w-0 flex-1 truncate">Respondendo: {citando.texto || `[${citando.tipo}]`}</span>
                      <button type="button" onClick={() => setCitando(null)} aria-label="Cancelar resposta">✕</button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea rows={1} className="rel-input min-w-0 flex-1 resize-none" value={texto} maxLength={4096} aria-label="Mensagem"
                      onChange={(e) => setTexto(e.target.value)} placeholder="Mensagem (Enter envia · Shift+Enter quebra linha)"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} />
                    <BotaoGrande pequeno type="submit" disabled={!texto.trim() || enviando}>{enviando ? "…" : "Enviar ➤"}</BotaoGrande>
                  </div>
                </form>
              ) : (
                <div className="wa-barra px-4 py-3 text-center text-[13px]">
                  Pelo chip do Marketing só sai mensagem em grupo. Pra falar com a pessoa, use a API oficial.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {verDados && aberta?.grupo && (
        <DadosDoGrupo jid={aberta.jid} grupo={grupoDb} tags={tagsDoGrupo} onFechar={() => setVerDados(false)} onMudou={bases.recarregar} />
      )}
    </div>
  );
}
