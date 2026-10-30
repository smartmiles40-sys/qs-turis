// src/mkt/automacoes/ConversasPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › CONVERSAS — o "live chat" do número do Marketing.
// Lista as conversas (mkt_wa_conversas, leitura pela RLS da 0244) e, na conversa
// aberta, as mensagens. Escrever passa pelo servidor (acao 'responder'), que
// confere a janela de 24 h e PAUSA o robô (12 h, ou o que estiver na config).
// Atualiza a cada 10 s enquanto a aba está visível (sem Realtime — menos egress).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { janelaAberta, type Fluxo } from "./tipos";
import { acao, listarFluxos, listarModelos, type ModeloMkt } from "./api";
import { Aviso, Botao, COR, COR_SUAVE, Carregando, Chip, Entrada, MKT_CSS, Modal, Selecao, quando } from "./ui";

interface Conversa {
  id: string; wa_id: string; nome_perfil: string | null; contato_id: string | null;
  ultima_entrada_em: string | null; ultima_mensagem_em: string | null; ultima_previa: string | null; nao_lidas: number;
  automacao_pausada_ate: string | null; precisa_humano_em: string | null; atendente_id: string | null; status: string;
  mkt_contatos?: { nome: string | null; tags: string[] | null; optout_whatsapp_em: string | null } | null;
}
interface Mensagem { id: string; direcao: "in" | "out"; tipo: string; texto: string | null; status: string | null; erro: string | null; origem: string | null; criado_em: string }

const pausado = (c: Conversa) => Boolean(c.automacao_pausada_ate && new Date(c.automacao_pausada_ate).getTime() > Date.now());
const nomeDe = (c: Conversa) => c.mkt_contatos?.nome || c.nome_perfil || `+${c.wa_id}`;
const ROT_ORIGEM: Record<string, string> = { fluxo: "robô", manual: "time", teste: "teste", eco: "celular" };

function useVisivel(cb: () => void, ms: number) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Lê ?c=<id> do hash (#mkt/conversas?c=…), que é o link do aviso "avisar humano". */
function conversaDoLink(): string | null {
  const m = /[?&]c=([0-9a-f-]{36})/i.exec(window.location.hash || window.location.search);
  return m ? m[1] : null;
}

export default function ConversasPage() {
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(conversaDoLink);
  const [filtro, setFiltro] = useState<"todas" | "humano" | "pausadas" | "nao_lidas">("todas");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_wa_conversas")
      .select("id,wa_id,nome_perfil,contato_id,ultima_entrada_em,ultima_mensagem_em,ultima_previa,nao_lidas,automacao_pausada_ate,precisa_humano_em,atendente_id,status,mkt_contatos(nome,tags,optout_whatsapp_em)")
      .order("ultima_mensagem_em", { ascending: false, nullsFirst: false }).limit(300);
    if (error) { setErro(/does not exist|schema cache/i.test(error.message) ? "As tabelas das automações ainda não existem no banco (migration 0244 não aplicada)." : error.message); setConversas([]); return; }
    setErro(null); setConversas((data ?? []) as unknown as Conversa[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useVisivel(() => void carregar(), 10_000);

  const lista = useMemo(() => (conversas ?? []).filter((c) => {
    if (filtro === "humano" && !c.precisa_humano_em) return false;
    if (filtro === "pausadas" && !pausado(c)) return false;
    if (filtro === "nao_lidas" && !c.nao_lidas) return false;
    if (busca) { const b = busca.toLowerCase(); return nomeDe(c).toLowerCase().includes(b) || c.wa_id.includes(b.replace(/\D/g, "") || "#"); }
    return true;
  }), [conversas, filtro, busca]);
  const atual = conversas?.find((c) => c.id === aberta) ?? null;

  return (
    <div className="mkt-raiz p-4 md:p-6 max-w-[1500px] mx-auto">
      <style>{MKT_CSS}</style>
      <h1 className="text-xl font-bold mb-3" style={{ color: "var(--ink)" }}>Conversas · WhatsApp do Marketing</h1>
      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      <div className="flex gap-3" style={{ height: "calc(100vh - 170px)", minHeight: 420 }}>
        <aside className={`mkt-card flex flex-col w-full md:w-[340px] shrink-0 ${atual ? "hidden md:flex" : "flex"}`}>
          <div className="p-2 space-y-2 border-b" style={{ borderColor: "var(--line)" }}>
            <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou número…" />
            <div className="flex gap-1 flex-wrap">
              {([["todas", "Todas"], ["humano", "Pediram humano"], ["pausadas", "Robô pausado"], ["nao_lidas", "Não lidas"]] as const).map(([id, r]) => (
                <button key={id} type="button" onClick={() => setFiltro(id)} className="px-2 py-0.5 rounded-full text-[11.5px] font-semibold" style={filtro === id ? { background: COR_SUAVE, color: COR } : { color: "var(--ink3)" }}>{r}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!conversas ? <Carregando /> : !lista.length ? <div className="p-4 text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma conversa.</div> : lista.map((c) => (
              <button key={c.id} type="button" onClick={() => setAberta(c.id)} className="w-full text-left px-3 py-2.5 border-b"
                style={{ borderColor: "var(--line)", background: c.id === aberta ? COR_SUAVE : undefined }}>
                <div className="flex items-center gap-1.5">
                  <strong className="text-[13px] truncate" style={{ color: "var(--ink)" }}>{nomeDe(c)}</strong>
                  {c.precisa_humano_em && <Chip cor="#DC2626">humano</Chip>}
                  {pausado(c) && <Chip cor="#D97706">pausado</Chip>}
                  <span className="ml-auto text-[11px]" style={{ color: "var(--ink3)" }}>{quando(c.ultima_mensagem_em)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[12px] truncate flex-1" style={{ color: "var(--ink2)" }}>{c.ultima_previa ?? ""}</span>
                  {c.nao_lidas > 0 && <span className="text-[10.5px] font-bold rounded-full px-1.5 text-white" style={{ background: COR }}>{c.nao_lidas}</span>}
                </div>
              </button>
            ))}
          </div>
        </aside>
        {atual ? <Conversa c={atual} onVoltar={() => setAberta(null)} onMudou={carregar} />
          : <div className="mkt-card flex-1 hidden md:flex items-center justify-center text-[13px]" style={{ color: "var(--ink3)" }}>Escolha uma conversa.</div>}
      </div>
    </div>
  );
}

function Conversa({ c, onVoltar, onMudou }: { c: Conversa; onVoltar: () => void; onMudou: () => void }) {
  const [msgs, setMsgs] = useState<Mensagem[] | null>(null);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [novaTag, setNovaTag] = useState("");
  const [modal, setModal] = useState<"fluxo" | "modelo" | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const janela = janelaAberta(c.ultima_entrada_em);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("mkt_wa_mensagens").select("id,direcao,tipo,texto,status,erro,origem,criado_em").eq("conversa_id", c.id).order("criado_em", { ascending: false }).limit(200);
    setMsgs(((data ?? []) as Mensagem[]).reverse());
  }, [c.id]);
  useEffect(() => {
    setMsgs(null); void carregar();
    if (c.nao_lidas) void acao({ acao: "lida", conversaId: c.id }).then(onMudou).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  useVisivel(() => void carregar(), 10_000);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  async function rodar(corpo: Record<string, unknown>, ok?: string) {
    setOcupado(true);
    try { await acao({ ...corpo, conversaId: c.id }); if (ok) notifySuccess(ok); void carregar(); onMudou(); return true; }
    catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); return false; }
    finally { setOcupado(false); }
  }
  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    if (await rodar({ acao: "responder", texto: t })) setTexto("");
  }
  const tags = c.mkt_contatos?.tags ?? [];

  return (
    <section className="mkt-card flex-1 flex flex-col min-w-0">
      <header className="p-3 border-b flex flex-wrap items-center gap-2" style={{ borderColor: "var(--line)" }}>
        <button type="button" className="md:hidden text-[13px] font-semibold" style={{ color: COR }} onClick={onVoltar}>←</button>
        <div className="min-w-0">
          <div className="font-bold text-[14px] truncate" style={{ color: "var(--ink)" }}>{nomeDe(c)}</div>
          <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>+{c.wa_id} · {janela ? "janela de 24 h aberta" : "janela fechada — só modelo"}{c.mkt_contatos?.optout_whatsapp_em ? " · DESCADASTRADO" : ""}</div>
        </div>
        <span className="flex-1" />
        {pausado(c)
          ? <Botao onClick={() => void rodar({ acao: "pausar", horas: 0 }, "Robô de volta nesta conversa.")} disabled={ocupado} title={`Pausado até ${quando(c.automacao_pausada_ate)}`}>Devolver ao robô</Botao>
          : <Botao onClick={() => void rodar({ acao: "pausar", horas: 12 }, "Robô pausado por 12 h.")} disabled={ocupado}>Pausar robô 12 h</Botao>}
        <Botao onClick={() => setModal("fluxo")} disabled={ocupado}>Iniciar fluxo</Botao>
      </header>
      <div className="px-3 py-2 border-b flex flex-wrap items-center gap-1.5" style={{ borderColor: "var(--line)" }}>
        {tags.filter((t) => !t.startsWith("lista:")).map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px]" style={{ background: COR_SUAVE, color: COR }}>
            {t}<button type="button" aria-label={`Tirar ${t}`} onClick={() => void rodar({ acao: "tags", remover: [t] })}>×</button>
          </span>
        ))}
        {tags.filter((t) => t.startsWith("lista:")).map((t) => <Chip key={t} cor="#0891B2">{t.slice(6)}</Chip>)}
        {c.contato_id && (
          <form className="inline-flex gap-1" onSubmit={(e) => { e.preventDefault(); if (novaTag.trim()) void rodar({ acao: "tags", adicionar: [novaTag.trim()] }).then(() => setNovaTag("")); }}>
            <input className="mkt-input !py-0.5 !w-32 !text-[12px]" value={novaTag} onChange={(e) => setNovaTag(e.target.value)} placeholder="+ tag" />
          </form>
        )}
        {c.precisa_humano_em && <span className="ml-auto text-[11.5px] font-semibold" style={{ color: "#DC2626" }}>Pediu humano {quando(c.precisa_humano_em)}</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5" style={{ background: "var(--bg)" }}>
        {!msgs ? <Carregando /> : msgs.map((m) => (
          <div key={m.id} className={`flex ${m.direcao === "out" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[75%] rounded-xl px-3 py-1.5 text-[13px] whitespace-pre-wrap break-words"
              style={m.direcao === "out" ? { background: "#DCF8C6", color: "#111" } : { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}>
              {m.texto || <i style={{ opacity: 0.6 }}>[{m.tipo}]</i>}
              <div className="text-[10.5px] mt-0.5 text-right" style={{ opacity: 0.6 }}>
                {m.direcao === "out" && m.origem ? `${ROT_ORIGEM[m.origem] ?? m.origem} · ` : ""}{quando(m.criado_em)}{m.status ? ` · ${m.status}` : ""}
              </div>
              {m.erro && <div className="text-[11px]" style={{ color: "#B91C1C" }}>{m.erro}</div>}
            </div>
          </div>
        ))}
        <div ref={fim} />
      </div>
      <footer className="p-2 border-t" style={{ borderColor: "var(--line)" }}>
        {janela ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
            <textarea className="mkt-input flex-1 resize-none" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} placeholder="Responder (o robô pausa nesta conversa)…" />
            <Botao type="submit" variante="primario" disabled={ocupado || !texto.trim()}>Enviar</Botao>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] flex-1" style={{ color: "var(--ink3)" }}>Passaram 24 h desde a última mensagem da pessoa: só dá para mandar um modelo aprovado.</span>
            <Botao variante="primario" onClick={() => setModal("modelo")} disabled={ocupado}>Mandar modelo</Botao>
          </div>
        )}
      </footer>
      {modal === "fluxo" && <ModalFluxo onFechar={() => setModal(null)} onEscolher={(id) => void rodar({ acao: "iniciar", fluxoId: id }, "Fluxo iniciado.").then((ok) => ok && setModal(null))} />}
      {modal === "modelo" && <ModalModelo onFechar={() => setModal(null)} onEnviar={(m) => void rodar({ acao: "responder", modelo: m }, "Modelo enviado.").then((ok) => ok && setModal(null))} />}
    </section>
  );
}

function ModalFluxo({ onFechar, onEscolher }: { onFechar: () => void; onEscolher: (id: string) => void }) {
  const [fluxos, setFluxos] = useState<Fluxo[] | null>(null);
  const [sel, setSel] = useState("");
  useEffect(() => { listarFluxos().then((f) => { const a = f.filter((x) => x.status === "ativo"); setFluxos(a); setSel(a[0]?.id ?? ""); }).catch(() => setFluxos([])); }, []);
  return (
    <Modal aberto titulo="Iniciar um fluxo nesta conversa" onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={!sel} onClick={() => onEscolher(sel)}>Iniciar</Botao></>}>
      {!fluxos ? <Carregando /> : !fluxos.length ? <Aviso>Nenhum fluxo ativo.</Aviso> : (
        <Selecao value={sel} onChange={(e) => setSel(e.target.value)}>{fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</Selecao>
      )}
      <div className="mt-2"><Aviso>Manda de verdade. Com a janela fechada, só funciona se o fluxo começar por um Template.</Aviso></div>
    </Modal>
  );
}

function ModalModelo({ onFechar, onEnviar }: { onFechar: () => void; onEnviar: (m: { nome: string; idioma: string; variaveis: Record<string, string> }) => void }) {
  const [modelos, setModelos] = useState<ModeloMkt[] | null>(null);
  const [sel, setSel] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  useEffect(() => { listarModelos().then((r) => setModelos(r.modelos ?? [])).catch(() => setModelos([])); }, []);
  const m = modelos?.find((x) => `${x.nome}|${x.idioma}` === sel);
  return (
    <Modal aberto titulo="Mandar modelo aprovado" onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={!m} onClick={() => m && onEnviar({ nome: m.nome, idioma: m.idioma, variaveis: vars })}>Enviar</Botao></>}>
      {!modelos ? <Carregando /> : !modelos.length ? <Aviso tom="alerta">Nenhum modelo aprovado no número do Marketing.</Aviso> : (
        <div className="space-y-2">
          <Selecao value={sel} onChange={(e) => { setSel(e.target.value); setVars({}); }}>
            <option value="">(escolha)</option>
            {modelos.map((x) => <option key={`${x.nome}|${x.idioma}`} value={`${x.nome}|${x.idioma}`}>{x.nome} · {x.idioma}</option>)}
          </Selecao>
          {m && <div className="rounded-lg p-2 whitespace-pre-wrap text-[12.5px]" style={{ background: "var(--card2)" }}>{m.corpo}</div>}
          {m && Array.from({ length: m.variaveis }, (_, i) => String(i + 1)).map((k) => (
            <Entrada key={k} value={vars[k] ?? ""} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} placeholder={`{{${k}}} — aceita {{primeiro_nome}}`} />
          ))}
        </div>
      )}
    </Modal>
  );
}
