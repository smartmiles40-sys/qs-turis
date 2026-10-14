// src/rel/modelos/ModelosPage.tsx
// -----------------------------------------------------------------------------
// MODELOS DE MENSAGEM do Relacionamento (Bruno, 14/10/2026: "a Tainara precisa
// criar modelos dentro do QS pra padronizar o que o time manda pros clientes").
//
// Duas abas, porque a Meta tem duas regras:
//   • Respostas prontas — texto livre, só DENTRO das 24h depois da última
//     mensagem do cliente. No Atendimento, o time chama digitando "/atalho" no
//     campo ou pelo raio ⚡. Variáveis: {nome}, {nome_completo}, {saudacao},
//     {atendente}.
//   • Modelos da Meta — os únicos que saem FORA das 24h e pra começar conversa.
//     Passam pela aprovação da Meta (componente ModelosDoNumero, o mesmo da
//     tela de conexão do WhatsApp).
//
// Quem cria e muda: a gestora ou o admin do Relacionamento (o banco confere —
// 0121; o /api/wa-config confere nos modelos da Meta). O resto do time só vê.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { carregarPainelMeta, type NumeroMeta } from "@/lib/qs/metaConexao";
import {
  apagarResposta, listarModelos, listarRespostas, preencherResposta, salvarResposta, statusDoNumero,
  type Modelo, type NumeroRel, type Resposta,
} from "../lib/whatsapp";
import { podeGerirRelacionamento } from "../equipe/permissao";
import { TextoWa, WA_CSS } from "../atendimento/waUi";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";
import ModelosDoNumero from "../whatsapp/ModelosDoNumero";

type Aba = "respostas" | "meta";
const SEM_CATEGORIA = "Sem categoria";
const msg = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const limparAtalho = (s: string) => s.toLowerCase().replace(/^\/+/, "").replace(/[^a-z0-9_-]/g, "");

const VARIAVEIS: [string, string][] = [
  ["{nome}", "primeiro nome do cliente"],
  ["{nome_completo}", "nome completo"],
  ["{saudacao}", "Bom dia / Boa tarde / Boa noite"],
  ["{atendente}", "seu primeiro nome"],
];

// Formatação do WhatsApp: envolve a seleção (igual Ctrl+B no WhatsApp Web).
const FORMATOS: { rotulo: string; marca: string; atalho: string; estilo: React.CSSProperties }[] = [
  { rotulo: "B", marca: "*", atalho: "Ctrl+B", estilo: { fontWeight: 800 } },
  { rotulo: "I", marca: "_", atalho: "Ctrl+I", estilo: { fontStyle: "italic" } },
  { rotulo: "S", marca: "~", atalho: "Ctrl+Shift+X", estilo: { textDecoration: "line-through" } },
  { rotulo: "</>", marca: "```", atalho: "Ctrl+Shift+M", estilo: { fontFamily: "monospace" } },
];

// ── Editor de uma resposta pronta ───────────────────────────────────────────

function EditorResposta({ aberto, inicial, categorias, atendente, onFechar, onSalvo }: {
  aberto: boolean; inicial: Resposta | null; categorias: string[]; atendente: string;
  onFechar: () => void; onSalvo: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [atalho, setAtalho] = useState("");
  const [categoria, setCategoria] = useState("");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setTitulo(inicial?.titulo || "");
    setAtalho(inicial?.atalho || "");
    setCategoria(inicial?.categoria || "");
    setTexto(inicial?.texto || "");
    setErro(null);
  }, [aberto, inicial]);

  function inserir(antes: string, depois = "") {
    const el = campo.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const novo = texto.slice(0, ini) + antes + texto.slice(ini, fim) + depois + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      el?.focus();
      if (fim > ini) el?.setSelectionRange(ini + antes.length, fim + antes.length);
      else { const p = ini + antes.length; el?.setSelectionRange(p, p); }
    });
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.code;
    const f = !e.shiftKey && k === "KeyB" ? "*" : !e.shiftKey && k === "KeyI" ? "_"
      : e.shiftKey && k === "KeyX" ? "~" : e.shiftKey && k === "KeyM" ? "```" : null;
    if (!f) return;
    e.preventDefault();
    inserir(f, f);
  }

  async function salvar() {
    if (!titulo.trim()) { setErro("Dê um título."); return; }
    if (!texto.trim()) { setErro("Escreva o texto."); return; }
    setSalvando(true);
    setErro(null);
    try {
      await salvarResposta({ id: inicial?.id, titulo: titulo.trim(), texto: texto.trim(), atalho: limparAtalho(atalho) || null, categoria: categoria.trim() || null });
      onSalvo();
    } catch (e) {
      setErro(msg(e, "Não salvei."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={inicial ? "Editar resposta pronta" : "Nova resposta pronta"} largura={860} onFechar={() => !salvando && onFechar()}
      rodape={<>
        <Botao disabled={salvando} onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao>
      </>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Campo rotulo="Título">
            <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Boas-vindas pós-venda" autoFocus />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Atalho" dica={atalho ? `No campo, digite /${limparAtalho(atalho)}` : "Ex.: boasvindas"}>
              <div className="flex items-center rel-input w-full p-0 overflow-hidden">
                <span className="pl-3 font-mono" style={{ color: "var(--ink3)" }}>/</span>
                <input value={atalho} onChange={(e) => setAtalho(limparAtalho(e.target.value))} placeholder="boasvindas" aria-label="Atalho"
                  className="flex-1 min-w-0 bg-transparent px-1 py-2 font-mono text-[13px] outline-none" />
              </div>
            </Campo>
            <Campo rotulo="Categoria">
              <Entrada value={categoria} onChange={(e) => setCategoria(e.target.value)} list="rel-resp-categorias" placeholder="Embarque" />
              <datalist id="rel-resp-categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
            </Campo>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1 mb-1.5" role="toolbar" aria-label="Formatação e variáveis">
              {FORMATOS.map((f) => (
                <button key={f.marca} type="button" onClick={() => inserir(f.marca, f.marca)} title={`${f.atalho} — envolve com ${f.marca}`}
                  className="rel-card rel-linha w-8 h-8 text-[13px] inline-flex items-center justify-center" style={{ ...f.estilo, color: "var(--ink)" }}>
                  {f.rotulo}
                </button>
              ))}
              <span className="w-px h-5 mx-1" style={{ background: "var(--line)" }} aria-hidden />
              {VARIAVEIS.map(([v, d]) => (
                <button key={v} type="button" onClick={() => inserir(v)} title={d}
                  className="rel-card rel-linha h-8 px-2 text-[12px] font-mono" style={{ color: "var(--rel-ink)" }}>{v}</button>
              ))}
            </div>
            <textarea ref={campo} className="rel-input w-full" rows={9} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={teclas}
              placeholder={"{saudacao}, {nome}! Aqui é {atendente}, do Relacionamento da Se Tu For, Eu Vou!"} aria-label="Texto da resposta" />
          </div>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </div>
        <div>
          <p className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--ink3)" }}>Prévia (cliente "Maria Silva")</p>
          <div className="wa rounded-xl p-3 min-h-[220px] wa-fundo">
            {texto.trim() ? (
              <div className="flex justify-end">
                <div className="wa-bolha wa-out wa-rabo">
                  <TextoWa texto={preencherResposta(texto, "Maria Silva", atendente)} />
                  <span className="wa-hora">{new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="block clear-both" />
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-center mt-16" style={{ color: "var(--wa-meta)" }}>Escreva o texto pra ver como chega no WhatsApp.</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Aba: respostas prontas ──────────────────────────────────────────────────

function AbaRespostas({ pode, atendente }: { pode: boolean; atendente: string }) {
  const [lista, setLista] = useState<Resposta[] | null>(null);
  const [busca, setBusca] = useState("");
  const [editar, setEditar] = useState<Resposta | null | "nova">(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = () => listarRespostas().then(setLista).catch(() => setLista([]));
  useEffect(() => { void carregar(); }, []);

  const categorias = useMemo(() => Array.from(new Set((lista || []).map((r) => r.categoria?.trim()).filter(Boolean) as string[])).sort(), [lista]);
  const grupos = useMemo(() => {
    const t = busca.trim().toLowerCase().replace(/^\//, "");
    const filtradas = (lista || []).filter((r) => !t
      || r.titulo.toLowerCase().includes(t) || r.texto.toLowerCase().includes(t)
      || (r.atalho || "").includes(t) || (r.categoria || "").toLowerCase().includes(t));
    const m = new Map<string, Resposta[]>();
    for (const r of filtradas) {
      const c = r.categoria?.trim() || SEM_CATEGORIA;
      m.set(c, [...(m.get(c) || []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === SEM_CATEGORIA ? 1 : b === SEM_CATEGORIA ? -1 : a.localeCompare(b)));
  }, [lista, busca]);

  async function apagar(id: string) {
    setConfirmar(null);
    setErro(null);
    try { await apagarResposta(id); await carregar(); }
    catch (e) { setErro(msg(e, "Não apaguei.")); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título, texto, /atalho ou categoria" aria-label="Buscar respostas prontas" />
        </div>
        {pode && <Botao variante="primario" onClick={() => setEditar("nova")}>+ Nova resposta pronta</Botao>}
      </div>
      <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
        Valem só <b>dentro das 24h</b> depois da última mensagem do cliente. No Atendimento, digite <b className="font-mono">/</b> no campo (ou <b className="font-mono">/atalho</b>) ou clique no raio ⚡.
      </p>
      {!pode && <Aviso>Só a gestora ou o admin cria e muda — peça pra Tainara.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {lista === null ? <div className="rel-card h-32 animate-pulse" /> : grupos.length === 0 ? (
        <div className="rel-card p-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>
          {busca ? "Nenhuma resposta com essa busca." : "Nenhuma resposta pronta ainda."}
        </div>
      ) : grupos.map(([cat, itens]) => (
        <section key={cat}>
          <h3 className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink3)" }}>{cat} · {itens.length}</h3>
          <ul className="rel-card overflow-hidden divide-y" style={{ borderColor: "var(--line)" }}>
            {itens.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{r.titulo}</span>
                    {r.atalho && <Etiqueta tom="rel"><span className="font-mono">/{r.atalho}</span></Etiqueta>}
                  </div>
                  <p className="text-[13px] mt-0.5 whitespace-pre-wrap line-clamp-3" style={{ color: "var(--ink2)" }}>{r.texto}</p>
                </div>
                {pode && (confirmar === r.id ? (
                  <span className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[12px]" style={{ color: "var(--err-ink)" }}>Apagar?</span>
                    <Botao variante="perigo" onClick={() => void apagar(r.id)}>Sim</Botao>
                    <Botao variante="fantasma" onClick={() => setConfirmar(null)}>Não</Botao>
                  </span>
                ) : (
                  <span className="flex gap-1 flex-shrink-0">
                    <Botao variante="fantasma" onClick={() => setEditar(r)}>Editar</Botao>
                    <Botao variante="fantasma" aria-label={`Apagar ${r.titulo}`} onClick={() => setConfirmar(r.id)}>Apagar</Botao>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <EditorResposta
        aberto={editar !== null}
        inicial={editar === "nova" ? null : editar}
        categorias={categorias}
        atendente={atendente}
        onFechar={() => setEditar(null)}
        onSalvo={() => { setEditar(null); void carregar(); }}
      />
    </div>
  );
}

// ── Aba: modelos da Meta ────────────────────────────────────────────────────

function AbaMeta({ pode }: { pode: boolean }) {
  const [numeroRel, setNumeroRel] = useState<NumeroRel | null>(null);
  const [numeros, setNumeros] = useState<NumeroMeta[] | null>(null);
  const [aprovados, setAprovados] = useState<Modelo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    statusDoNumero().then(setNumeroRel).catch(() => setNumeroRel(null));
    if (pode) {
      carregarPainelMeta()
        .then((p) => setNumeros(p.numeros.filter((n) => n.setor === "relacionamento" && n.status === "conectado")))
        .catch((e) => { setErro(msg(e, "Não consegui carregar o número.")); setNumeros([]); });
    } else {
      // Quem não gere vê só os aprovados (o /api/rel-wa libera pro time todo).
      listarModelos().then(setAprovados).catch(() => setAprovados([]));
    }
  }, [pode]);

  const explicacao = (
    <div className="rel-card p-4 text-[13px] space-y-1.5" style={{ color: "var(--ink2)" }}>
      <p><b>Quando usar:</b> pra falar com o cliente <b>depois de 24h</b> sem resposta dele, ou pra começar uma conversa. É o único jeito que a Meta deixa.</p>
      <p><b>Utilidade</b> = aviso sobre a viagem que ele comprou (documentos, embarque, voo). Aprova mais fácil e custa menos.</p>
      <p><b>Marketing</b> = oferta, convite, aniversário, data especial. Custa mais por mensagem.</p>
      <p>A Meta analisa cada modelo — leva de alguns minutos a algumas horas.</p>
    </div>
  );

  if (numeroRel && !numeroRel.conectado) {
    return (
      <div className="space-y-3">
        {explicacao}
        <Aviso>O número de WhatsApp do Relacionamento ainda não está conectado. Conecte em Atendimento → WhatsApp e volte aqui pra criar os modelos.</Aviso>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {explicacao}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {pode ? (
        numeros === null ? <div className="rel-card h-32 animate-pulse" /> :
          numeros.length === 0 ? <Aviso>Nenhum número do Relacionamento conectado agora.</Aviso> :
            numeros.map((n) => <ModelosDoNumero key={n.phoneId} n={n} />)
      ) : (
        <>
          <Aviso>Só a gestora ou o admin cria e muda — peça pra Tainara. Abaixo, os modelos já aprovados que você pode mandar.</Aviso>
          {aprovados === null ? <div className="rel-card h-24 animate-pulse" /> : aprovados.length === 0 ? (
            <div className="rel-card p-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum modelo aprovado ainda.</div>
          ) : (
            <ul className="rel-card overflow-hidden divide-y" style={{ borderColor: "var(--line)" }}>
              {aprovados.map((m) => (
                <li key={`${m.nome}-${m.idioma}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{m.nome}</span>
                    <Etiqueta tom="rel">Aprovado</Etiqueta>
                    {m.categoria && <Etiqueta>{m.categoria === "MARKETING" ? "Marketing" : m.categoria === "UTILITY" ? "Utilidade" : m.categoria}</Etiqueta>}
                  </div>
                  <p className="text-[13px] mt-1 whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>{m.corpo}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function ModelosPage() {
  const { currentUser } = useQsAuth();
  const pode = podeGerirRelacionamento(currentUser);
  const [aba, setAba] = useState<Aba>(() => (localStorage.getItem("rel_modelos_aba") as Aba) || "respostas");
  function trocar(a: Aba) { localStorage.setItem("rel_modelos_aba", a); setAba(a); }

  return (
    <div className="max-w-5xl space-y-4">
      <style>{WA_CSS}</style>
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Modelos de mensagem</h1>
        <p className="text-[13px] mt-0.5" style={{ color: "var(--ink3)" }}>
          Os textos padrão do Relacionamento — todo mundo do time fala do mesmo jeito com o cliente.
        </p>
      </div>
      <div className="flex items-end gap-1 border-b" style={{ borderColor: "var(--line)" }} role="tablist" aria-label="Tipo de modelo">
        {([["respostas", "Respostas prontas (dentro das 24h)"], ["meta", "Modelos da Meta (fora das 24h)"]] as [Aba, string][]).map(([a, r]) => (
          <button key={a} role="tab" aria-selected={aba === a} onClick={() => trocar(a)}
            className="h-10 px-3 text-[13px] font-semibold -mb-px"
            style={aba === a ? { color: "var(--rel-ink)", borderBottom: "2px solid var(--rel)" } : { color: "var(--ink2)", borderBottom: "2px solid transparent" }}>
            {r}
          </button>
        ))}
      </div>
      {aba === "respostas" ? <AbaRespostas pode={pode} atendente={currentUser?.name || ""} /> : <AbaMeta pode={pode} />}
    </div>
  );
}
