// src/mkt/grupos/CelularPage.tsx — a caixa ao vivo do chip do Marketing.
// Lê direto da Evolution (findChats/findMessages): é o que está NO aparelho.
// Responder: em grupo sempre; com pessoa só se MKT_GRUPOS_PRIVADO=1 e ela escreveu primeiro.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Btn, FilterPill, Page, PageHeader, SearchInput } from "@/components/ui";
import { api, classeCampo, estiloCampo, lerEstado, quando } from "./lib";

interface Conversa { jid: string; grupo: boolean; nome: string; foto_url: string | null; nao_lidas: number; ultima_em: string | null; previa: string }
interface Msg { id: string; de_mim: boolean; autor: string | null; autor_nome: string | null; tipo: string; texto: string; quando: string | null }

const REACOES = ["👍", "❤️", "😂", "😮", "🙏", "🎉"];

export default function CelularPage() {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [filtro, setFiltro] = useState<"grupos" | "todas">("grupos");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<Conversa | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [citando, setCitando] = useState<Msg | null>(null);
  const [privado, setPrivado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const fim = useRef<HTMLDivElement | null>(null);

  const carregarConversas = useCallback(async () => {
    setErro(null); setCarregando(true);
    try { const r = await api<{ conversas: Conversa[] }>("conversas"); setConversas(r.conversas); }
    catch (e) { setErro((e as Error).message); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { void carregarConversas(); lerEstado().then((s) => setPrivado(s.privado)).catch(() => null); }, [carregarConversas]);

  const abrir = useCallback(async (c: Conversa) => {
    setAberta(c); setMsgs([]); setCitando(null); setErro(null);
    try { const r = await api<{ mensagens: Msg[] }>("mensagens", { jid: c.jid }); setMsgs(r.mensagens); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return conversas.filter((c) => (filtro === "todas" || c.grupo) && (!b || c.nome.toLowerCase().includes(b)));
  }, [conversas, filtro, busca]);

  const podeResponder = aberta ? aberta.grupo || privado : false;

  async function enviar() {
    if (!aberta || !texto.trim()) return;
    setErro(null);
    try {
      await api("enviar", { jid: aberta.jid, texto, ...(citando ? { citar: { id: citando.id, fromMe: citando.de_mim, participant: citando.autor, texto: citando.texto } } : {}) });
      setTexto(""); setCitando(null);
      await abrir(aberta);
    } catch (e) { setErro((e as Error).message); }
  }
  async function reagir(m: Msg, emoji: string) {
    if (!aberta) return;
    try { await api("reagir", { jid: aberta.jid, msg: { id: m.id, fromMe: m.de_mim, participant: m.autor }, emoji }); }
    catch (e) { setErro((e as Error).message); }
  }

  return (
    <Page wide>
      <PageHeader crumb="Marketing · Grupos" title="Celular do Marketing"
        subtitle="O que está no aparelho do chip, ao vivo. Responder e reagir saem pelo chip do Marketing."
        actions={<Btn onClick={() => void carregarConversas()} disabled={carregando}>{carregando ? "Lendo…" : "Atualizar"}</Btn>} />
      {erro && <div className="mb-3"><Alert tone="danger">{erro}</Alert></div>}
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,320px) minmax(0,1fr)", minHeight: 520 }}>
        <div className="flex flex-col gap-2">
          <SearchInput placeholder="Buscar conversa" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="flex gap-2">
            <FilterPill active={filtro === "grupos"} onClick={() => setFiltro("grupos")}>Grupos</FilterPill>
            <FilterPill active={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas</FilterPill>
          </div>
          <ul className="flex flex-col overflow-auto" style={{ maxHeight: 640, border: "1px solid var(--line)", borderRadius: 10 }}>
            {lista.map((c) => (
              <li key={c.jid}>
                <button type="button" onClick={() => void abrir(c)} className="w-full text-left px-3 py-2 flex gap-2 items-center"
                  style={{ background: aberta?.jid === c.jid ? "var(--card2)" : undefined, borderBottom: "1px solid var(--line)" }}>
                  {c.foto_url ? <img src={c.foto_url} alt="" width={32} height={32} style={{ borderRadius: 99 }} /> : <span aria-hidden style={{ width: 32, height: 32, borderRadius: 99, background: "var(--line)", flex: "none" }} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2 text-[14px]"><strong className="truncate">{c.nome}</strong><span className="qs-tone-muted text-[11px]">{quando(c.ultima_em)}</span></span>
                    <span className="block truncate text-[12px] qs-tone-muted">{c.previa || "—"}</span>
                  </span>
                  {c.nao_lidas > 0 && <span className="qs-pill__n">{c.nao_lidas}</span>}
                </button>
              </li>
            ))}
            {!lista.length && <li className="px-3 py-2 text-[13px] qs-tone-muted">{carregando ? "Lendo o aparelho…" : "Nada aqui."}</li>}
          </ul>
        </div>

        <div className="flex flex-col rounded-lg" style={{ border: "1px solid var(--line)" }}>
          {!aberta ? <div className="p-6 text-[14px] qs-tone-muted">Escolha uma conversa.</div> : (
            <>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--line)" }}>
                <strong className="truncate">{aberta.nome}</strong>
                <span className="text-[12px] qs-tone-muted">{aberta.grupo ? "grupo" : "conversa individual"}</span>
                <Btn size="sm" variant="ghost" className="ml-auto" onClick={() => void abrir(aberta)}>Recarregar</Btn>
              </div>
              <div className="flex-1 overflow-auto p-4 flex flex-col gap-2" style={{ maxHeight: 560 }}>
                {msgs.map((m) => (
                  <div key={m.id} className={`group max-w-[78%] rounded-lg px-3 py-2 text-[14px] ${m.de_mim ? "self-end" : "self-start"}`}
                    style={{ background: m.de_mim ? "var(--card2)" : "transparent", border: "1px solid var(--line)" }}>
                    {!m.de_mim && aberta.grupo && <div className="text-[12px] font-semibold">{m.autor_nome || m.autor}</div>}
                    {m.tipo !== "texto" && <div className="text-[12px] qs-tone-muted">[{m.tipo}]</div>}
                    <div className="whitespace-pre-wrap break-words">{m.texto}</div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] qs-tone-muted">
                      <span>{quando(m.quando)}</span>
                      {podeResponder && (
                        <span className="ml-auto flex gap-0.5">
                          <button type="button" onClick={() => setCitando(m)} aria-label="Responder citando">↩</button>
                          {REACOES.map((e) => <button key={e} type="button" onClick={() => void reagir(m, e)} aria-label={`Reagir ${e}`}>{e}</button>)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {!msgs.length && <span className="text-[13px] qs-tone-muted">Sem mensagens carregadas.</span>}
                <div ref={fim} />
              </div>
              {podeResponder ? (
                <form className="p-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--line)" }} onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
                  {citando && (
                    <div className="flex items-center gap-2 text-[12px] px-2 py-1 rounded" style={{ background: "var(--card2)" }}>
                      <span className="truncate">Respondendo: {citando.texto || `[${citando.tipo}]`}</span>
                      <button type="button" className="ml-auto" onClick={() => setCitando(null)} aria-label="Cancelar citação">✕</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea rows={2} className={classeCampo} style={estiloCampo} value={texto} maxLength={4096}
                      onChange={(e) => setTexto(e.target.value)} placeholder="Escreva… (Enter envia, Shift+Enter quebra linha)"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} />
                    <Btn type="submit" variant="primary" disabled={!texto.trim()}>Enviar</Btn>
                  </div>
                </form>
              ) : (
                <div className="p-3 text-[13px] qs-tone-muted" style={{ borderTop: "1px solid var(--line)" }}>
                  Pelo chip do Marketing só sai mensagem em grupo. Pra falar com a pessoa, use a API oficial.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
