// src/mkt/automacoes/InstagramPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › INSTAGRAM — no jeito ManyChat (Bruno, 30/10/2026): cartões grandes
// "Comentou no post → manda DM", "Respondeu story", "Mencionou", "Palavra na DM"
// e, embaixo, cada automação como um cartão com liga/desliga e a regra em
// linguagem simples. Abas: Automações | DMs | Comentários | Conexão.
//
// VEM DESLIGADO: o webhook (api/mkt-instagram) não grava nem responde nada até
// o Bruno conectar a conta e ligar na aba Conexão. Passo a passo do painel da
// Meta em docs/MARKETING-AUTOMACOES.md.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { PaginaComAbas } from "../Abas";
import { acao, carregarEstado, salvarConfig, type EstadoMkt } from "./api";
import { AreaTexto, Aviso, Botao, COR, COR_SUAVE, COR_TEXTO, Campo, Carregando, Chip, Entrada, MKT_CSS, Modal, quando } from "./ui";
import { fraseInstagram, type GatilhoIg } from "./modelos";

type Gatilho = GatilhoIg;
interface ConfigIg { palavras?: string[]; qualquer_palavra?: boolean; posts?: string[]; respostas_publicas?: string[]; dm_texto?: string; dm_botoes?: { titulo: string; url: string }[]; tags?: string[] }
interface AutoIg { id: string; nome: string; ativo: boolean; gatilho: Gatilho; config: ConfigIg; disparos: number; ultimo_disparo_em: string | null }
interface Conta { id: string; ig_user_id: string; username: string | null; status: string; ultima_entrada_em: string | null; ultimo_erro: string | null }

const lista = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const semTabela = (m: string) => /does not exist|schema cache/i.test(m) ? "As tabelas ainda não existem no banco (migration 0244 não aplicada)." : m;
const irPara = (aba: string) => { window.location.hash = `#mkt/instagram?aba=${aba}`; };

/** Os 4 cartões grandes (+ boas-vindas) — o "começar" de cada tipo de regra. */
const TIPOS: { id: Gatilho; titulo: string; texto: string; nome: string; config: ConfigIg; icone: ReactNode }[] = [
  {
    id: "comentario", titulo: "Comentou no post → manda DM", texto: "Quem comentar a palavra no post ou reels recebe o link na DM, e o comentário ganha uma resposta pública.",
    nome: "Reels: ROTEIRO", config: { palavras: ["roteiro"], respostas_publicas: ["Te mandei no direct! 📩", "Olha a DM 😉"], dm_texto: "Oi, {{nome}}! Aqui está o roteiro que você pediu:", dm_botoes: [{ titulo: "Ver roteiro", url: "https://setuforeuvou.com.br" }] },
    icone: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></>,
  },
  {
    id: "story_resposta", titulo: "Respondeu o story", texto: "Quem responder o story (qualquer coisa ou uma palavra) recebe a DM certa.",
    nome: "Story: resposta", config: { palavras: [], dm_texto: "Oi, {{nome}}! Que bom que você respondeu 💛 Quer o roteiro completo?", dm_botoes: [] },
    icone: <><circle cx="12" cy="12" r="9" strokeDasharray="4 3" /><path d="M9 12h6" /></>,
  },
  {
    id: "story_mencao", titulo: "Mencionou no story", texto: "Quem marcar a agência no story recebe um agradecimento na DM.",
    nome: "Menção no story", config: { dm_texto: "Oi, {{nome}}! Obrigado por marcar a gente 🥰 Bora planejar a próxima viagem?", dm_botoes: [] },
    icone: <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" /></>,
  },
  {
    id: "dm_palavra", titulo: "Palavra na DM", texto: "Quem mandar a palavra na DM recebe a resposta pronta (ex.: JAPÃO → link do roteiro).",
    nome: "DM: JAPÃO", config: { palavras: ["japão", "japao"], dm_texto: "Oi, {{nome}}! Aqui está tudo sobre a expedição Japão:", dm_botoes: [{ titulo: "Ver expedição", url: "https://setuforeuvou.com.br" }] },
    icone: <><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" /></>,
  },
  {
    id: "boas_vindas", titulo: "Boas-vindas na 1ª DM", texto: "A primeira DM de alguém que nunca falou com a conta recebe um oi.",
    nome: "Boas-vindas", config: { dm_texto: "Oi, {{nome}}! Aqui é a Se Tu For, Eu Vou! ✈️ Sobre qual viagem você quer saber?", dm_botoes: [] },
    icone: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>,
  },
];
const ROT: Record<Gatilho, string> = { comentario: "Comentário", dm_palavra: "Palavra na DM", story_resposta: "Resposta ao story", story_mencao: "Menção no story", boas_vindas: "Boas-vindas" };

function Icone({ d }: { d: ReactNode }) {
  return (
    <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: COR_SUAVE, color: COR_TEXTO }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
    </span>
  );
}

function Interruptor({ ligado, onMudar, rotulo, desabilitado }: { ligado: boolean; onMudar: (v: boolean) => void; rotulo: string; desabilitado?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} title={rotulo} disabled={desabilitado} onClick={() => onMudar(!ligado)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50" style={{ background: ligado ? COR : "var(--line)" }}>
      <span aria-hidden className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: `translateX(${ligado ? 22 : 2}px)` }} />
    </button>
  );
}

/** Conta conectada? Instagram ligado? (pra mostrar "o que falta" em vez de erro). */
function useSituacao() {
  const [estado, setEstado] = useState<EstadoMkt | null>(null);
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    // 04/11/2026: a falha do estado era engolida e a aba Conexão ficava em "Carregando…" pra sempre.
    const pEstado = carregarEstado().then((e) => { setEstado(e); return null; }).catch((e: unknown) => (e instanceof Error ? e.message : "Não consegui ler o estado."));
    const { data, error } = await supabase.from("mkt_ig_contas").select("id,ig_user_id,username,status,ultima_entrada_em,ultimo_erro").order("criado_em");
    const erroEstado = await pEstado;
    setErro(error ? semTabela(error.message) : erroEstado);
    setContas((data ?? []) as Conta[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  return { estado, contas, erro, carregar };
}

export default function InstagramPage() {
  return (
    <div className="mkt-raiz">
      <style>{MKT_CSS}</style>
      <PaginaComAbas titulo="Instagram" subtitulo="Comentou, respondeu o story ou mandou a palavra na DM → a resposta sai sozinha."
        abas={[
          { id: "automacoes", rotulo: "Automações", componente: AbaAutomacoes },
          { id: "dms", rotulo: "DMs", componente: Dms },
          { id: "comentarios", rotulo: "Comentários", componente: Comentarios },
          { id: "conexao", rotulo: "Conexão", componente: Conexao },
        ]} />
    </div>
  );
}

// ── Automações ──────────────────────────────────────────────────────────────

function OQueFalta({ estado, contas }: { estado: EstadoMkt | null; contas: Conta[] | null }) {
  if (!contas) return null;
  const conectada = contas.some((c) => c.status === "conectada");
  const ligado = !!estado?.instagram.ligado;
  if (conectada && ligado) return null;
  return (
    <div className="mkt-card p-4">
      <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Falta pouco pro Instagram responder sozinho</p>
      <ol className="mt-1.5 space-y-1 text-[13px]" style={{ color: "var(--ink2)" }}>
        <li>{conectada ? "✓" : "1."} Conectar a conta do Instagram da agência {conectada ? <Chip cor="#059669">feito</Chip> : null}</li>
        <li>{ligado ? "✓" : "2."} Ligar as automações do Instagram</li>
      </ol>
      <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink3)" }}>Dá pra montar as regras já. Enquanto estiver desligado, nada é gravado nem respondido.</p>
      <div className="mt-2"><Botao variante="primario" onClick={() => irPara("conexao")}>Ir para Conexão</Botao></div>
    </div>
  );
}

type Form = Partial<AutoIg> & { gatilho: Gatilho; config: ConfigIg };

function AbaAutomacoes() {
  const { estado, contas, erro } = useSituacao();
  const [itens, setItens] = useState<AutoIg[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_ig_automacoes").select("*").order("criado_em", { ascending: false });
    if (error) notifyError(semTabela(error.message));
    setItens((data ?? []) as AutoIg[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const novo = (g: Gatilho) => {
    const t = TIPOS.find((x) => x.id === g)!;
    setForm({ nome: t.nome, gatilho: g, ativo: true, config: JSON.parse(JSON.stringify(t.config)) as ConfigIg });
  };
  async function ligar(a: AutoIg, v: boolean) {
    const { error } = await supabase.from("mkt_ig_automacoes").update({ ativo: v }).eq("id", a.id);
    if (error) notifyError(semTabela(error.message)); else void carregar();
  }

  return (
    <div className="flex flex-col gap-5">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <OQueFalta estado={estado} contas={contas} />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>Criar uma automação</h2>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Escolha o que a pessoa faz no Instagram. O texto já vem pronto pra ajustar.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TIPOS.filter((t) => t.id !== "boas_vindas").map((t) => (
            <button key={t.id} type="button" onClick={() => novo(t.id)} className="mkt-card flex flex-col gap-2 p-4 text-left transition-shadow hover:shadow-md">
              <Icone d={t.icone} />
              <span className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{t.titulo}</span>
              <span className="text-[12.5px] leading-snug" style={{ color: "var(--ink3)" }}>{t.texto}</span>
              <span className="mt-auto text-[12.5px] font-semibold" style={{ color: COR_TEXTO }}>Criar →</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => novo("boas_vindas")} className="self-start text-[13px] font-semibold underline-offset-2 hover:underline" style={{ color: COR_TEXTO }}>
          + Boas-vindas na primeira DM
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>Suas automações</h2>
        {!itens ? <Carregando /> : !itens.length ? (
          <div className="mkt-card p-5 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma ainda. Comece pelo “Comentou no post → manda DM”: é o que mais traz contato.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {itens.map((a) => {
              const f = fraseInstagram(a.gatilho, a.config);
              return (
                <article key={a.id} className="mkt-card flex flex-col gap-2.5 p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[14px] font-bold" style={{ color: "var(--ink)" }}>{a.nome}</h3>
                      <Chip>{ROT[a.gatilho]}</Chip>
                    </div>
                    <Interruptor ligado={a.ativo} onMudar={(v) => void ligar(a, v)} rotulo={a.ativo ? "Desligar automação" : "Ligar automação"} />
                  </div>
                  <div className="rounded-lg px-3 py-2 text-[13px] leading-snug" style={{ background: "var(--card2)", color: "var(--ink)" }}>
                    <span className="font-semibold">{f.quando}</span><span aria-hidden style={{ color: COR_TEXTO }}> → </span><span className="sr-only">, então </span>
                    <span style={{ color: "var(--ink2)" }}>{f.entao}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Botao onClick={() => setForm({ ...a, config: { ...a.config } })}>Editar</Botao>
                    <Botao variante="fantasma" onClick={() => { if (window.confirm(`Apagar “${a.nome}”?`)) void supabase.from("mkt_ig_automacoes").delete().eq("id", a.id).then(({ error }) => { if (error) notifyError(semTabela(error.message)); void carregar(); }); }}>Apagar</Botao>{/* 04/11/2026: erro do apagar era ignorado */}
                    <span className="flex-1" />
                    <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{a.disparos} disparos{a.ultimo_disparo_em ? ` · último ${quando(a.ultimo_disparo_em)}` : ""}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {form && <ModalAutomacao form={form} setForm={setForm} onSalvo={() => { setForm(null); void carregar(); }} />}
    </div>
  );
}

function ModalAutomacao({ form, setForm, onSalvo }: { form: Form; setForm: (f: Form | null) => void; onSalvo: () => void }) {
  const c = form.config;
  const setC = (p: ConfigIg) => setForm({ ...form, config: { ...form.config, ...p } });
  const comPalavras = form.gatilho === "comentario" || form.gatilho === "dm_palavra" || form.gatilho === "story_resposta";
  const frase = fraseInstagram(form.gatilho, c);

  async function salvar() {
    if (!form.nome?.trim()) { notifyError("Dê um nome."); return; }
    if (!c.dm_texto?.trim()) { notifyError("Escreva a DM."); return; }
    if ((form.gatilho === "comentario" || form.gatilho === "dm_palavra") && !c.qualquer_palavra && !(c.palavras ?? []).length) { notifyError("Escreva as palavras (ou marque “qualquer”)."); return; }
    if ((c.dm_botoes ?? []).some((b) => (b.titulo || b.url) && !/^https:\/\//i.test(b.url))) { notifyError("O botão de link precisa de um endereço https://."); return; }
    const config = { ...c, dm_botoes: (c.dm_botoes ?? []).filter((b) => b.titulo.trim() && b.url.trim()) };
    const linha = { nome: form.nome.trim(), gatilho: form.gatilho, ativo: form.ativo ?? true, config };
    const r = form.id ? await supabase.from("mkt_ig_automacoes").update(linha).eq("id", form.id) : await supabase.from("mkt_ig_automacoes").insert(linha);
    if (r.error) { notifyError(semTabela(r.error.message)); return; }
    notifySuccess("Automação salva.");
    onSalvo();
  }

  return (
    <Modal aberto titulo={form.id ? "Editar automação" : TIPOS.find((t) => t.id === form.gatilho)?.titulo ?? "Nova automação"} onFechar={() => setForm(null)} largura={900}
      rodape={<>
        <label className="mr-auto flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <Interruptor ligado={form.ativo ?? true} onMudar={(v) => setForm({ ...form, ativo: v })} rotulo="Ligada" /> Ligada
        </label>
        <Botao onClick={() => setForm(null)}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()}>Salvar</Botao>
      </>}>
      <div className="grid gap-5 md:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: COR_SUAVE, color: COR_TEXTO }}><b>{frase.quando}</b> → {frase.entao}</div>
          <Campo rotulo="Nome (só o time vê)"><Entrada value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Reels Japão: ROTEIRO" /></Campo>
          {comPalavras && (
            <>
              <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
                <input type="checkbox" checked={!!c.qualquer_palavra} onChange={(e) => setC({ qualquer_palavra: e.target.checked })} />
                Qualquer {form.gatilho === "comentario" ? "comentário" : form.gatilho === "dm_palavra" ? "mensagem" : "resposta"}
              </label>
              {!c.qualquer_palavra && (
                <Campo rotulo="Palavras" dica={form.gatilho === "story_resposta" ? "Vazio = qualquer resposta ao story. Separe por vírgula." : "Separe por vírgula. Acento e maiúscula não importam."}>
                  <Entrada value={(c.palavras ?? []).join(", ")} onChange={(e) => setC({ palavras: lista(e.target.value) })} placeholder="roteiro, quero, link" />
                </Campo>
              )}
            </>
          )}
          {form.gatilho === "comentario" && (
            <>
              <Campo rotulo="Só nestes posts (IDs, vírgula; vazio = todos)"><Entrada value={(c.posts ?? []).join(", ")} onChange={(e) => setC({ posts: lista(e.target.value) })} /></Campo>
              <Campo rotulo="Resposta pública no comentário (uma por linha; sorteia)" dica="Responder em público ajuda o alcance. Vazio = só DM.">
                <AreaTexto value={(c.respostas_publicas ?? []).join("\n")} onChange={(e) => setC({ respostas_publicas: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
              </Campo>
            </>
          )}
          <Campo rotulo="DM" dica="Marcadores: {{nome}}, {{usuario}}"><AreaTexto rows={4} value={c.dm_texto ?? ""} onChange={(e) => setC({ dm_texto: e.target.value })} /></Campo>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Botões de link na DM (até 3)</div>
            {(c.dm_botoes ?? []).map((b, i) => (
              <div key={i} className="flex gap-1.5">
                <Entrada value={b.titulo} onChange={(e) => setC({ dm_botoes: (c.dm_botoes ?? []).map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)) })} placeholder="Ver roteiro" />
                <Entrada value={b.url} onChange={(e) => setC({ dm_botoes: (c.dm_botoes ?? []).map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" />
                <Botao variante="fantasma" aria-label="Tirar botão" onClick={() => setC({ dm_botoes: (c.dm_botoes ?? []).filter((_, j) => j !== i) })}>×</Botao>
              </div>
            ))}
            {(c.dm_botoes ?? []).length < 3 && <Botao variante="fantasma" onClick={() => setC({ dm_botoes: [...(c.dm_botoes ?? []), { titulo: "", url: "" }] })}>+ botão</Botao>}
          </div>
          <Campo rotulo="Tags na conversa (vírgula)"><Entrada value={(c.tags ?? []).join(", ")} onChange={(e) => setC({ tags: lista(e.target.value) })} /></Campo>
          {form.gatilho === "comentario" && <Aviso>A Meta deixa mandar UMA DM por comentário, em até 7 dias. Depois, só se a pessoa responder.</Aviso>}
        </div>
        <PreviaDm form={form} />
      </div>
    </Modal>
  );
}

/** Prévia da DM no Instagram: o que a pessoa fez à esquerda, a resposta à direita. */
function PreviaDm({ form }: { form: Form }) {
  const c = form.config;
  const pessoa = form.gatilho === "comentario" ? `comentou: ${(c.palavras ?? [])[0] ?? "Quero!"}` : form.gatilho === "story_mencao" ? "mencionou você no story" : form.gatilho === "story_resposta" ? `respondeu o story: ${(c.palavras ?? [])[0] ?? "😍"}` : (c.palavras ?? [])[0] ?? "Oi!";
  const dm = (c.dm_texto ?? "").replace(/\{\{\s*nome\s*\}\}/gi, "Ana").replace(/\{\{\s*usuario\s*\}\}/gi, "@ana.viaja");
  return (
    <figure className="m-0" aria-label="Prévia da DM">
      <figcaption className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink3)" }}>Prévia da DM</figcaption>
      <div className="flex min-h-[260px] flex-col gap-2 rounded-[20px] border p-3" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <div className="mb-1 flex items-center gap-2 border-b pb-2" style={{ borderColor: "var(--line)" }}>
          <span aria-hidden className="h-7 w-7 rounded-full" style={{ background: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>ana.viaja</span>
        </div>
        <span className="max-w-[85%] self-start rounded-2xl px-3 py-1.5 text-[13px]" style={{ background: "var(--card2)", color: "var(--ink)" }}>{pessoa}</span>
        {dm.trim() && <span className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[13px] text-white" style={{ background: "#3797F0" }}>{dm}</span>}
        {(c.dm_botoes ?? []).filter((b) => b.titulo).map((b, i) => (
          <span key={i} className="max-w-[85%] self-end rounded-xl border px-3 py-1.5 text-center text-[13px] font-semibold" style={{ borderColor: "var(--line)", color: "#0095F6" }}>{b.titulo}</span>
        ))}
        {form.gatilho === "comentario" && (c.respostas_publicas ?? [])[0] && (
          <p className="mt-auto text-[11.5px]" style={{ color: "var(--ink3)" }}>No post: “{(c.respostas_publicas ?? [])[0]}”</p>
        )}
      </div>
    </figure>
  );
}

// ── Conexão ─────────────────────────────────────────────────────────────────

function Conexao() {
  const { estado, contas, erro, carregar } = useSituacao();
  const [igId, setIgId] = useState("");
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (!estado || !contas) return erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />;
  const conectada = contas.some((c) => c.status === "conectada");

  async function conectar() {
    setOcupado(true);
    try { const r = await acao<{ username?: string }>({ acao: "ig-conectar", igUserId: igId, token }); notifySuccess(`Conta conectada${r.username ? `: @${r.username}` : ""}.`); setToken(""); void carregar(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }
  async function ligar(ligado: boolean) {
    if (ligado && !window.confirm("Ligar as automações do Instagram? A partir daqui, comentários e DMs que combinarem com uma regra recebem resposta de verdade.")) return;
    try { await salvarConfig("instagram", { ligado }); notifySuccess(ligado ? "Instagram ligado." : "Instagram desligado."); void carregar(); }
    catch (e) { notifyError(semTabela(e instanceof Error ? e.message : "Falhou.")); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <section className="mkt-card space-y-2 p-4">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[14px] font-bold" style={{ color: "var(--ink)" }}>Automações do Instagram</h2>
          <span className="text-[13px]" style={{ color: "var(--ink2)" }}>{estado.instagram.ligado ? "ligadas" : "desligadas"}</span>
          <Interruptor ligado={estado.instagram.ligado} onMudar={(v) => void ligar(v)} rotulo="Ligar ou desligar o Instagram" desabilitado={!conectada && !estado.instagram.ligado} />
        </div>
        {!conectada && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Conecte a conta aqui embaixo pra poder ligar.</p>}
        <Aviso>Desligado, o webhook só responde 200 para a Meta e descarta — não grava comentário nem DM.</Aviso>
      </section>
      <section className="mkt-card space-y-2 p-4">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Conta</h2>
        {!contas.length && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma conta conectada ainda.</p>}
        {contas.map((c) => (
          <div key={c.id} className="text-[13px]" style={{ color: "var(--ink2)" }}>
            <b>@{c.username ?? c.ig_user_id}</b> · <Chip cor={c.status === "conectada" ? "#059669" : "#DC2626"}>{c.status}</Chip> · última entrada {quando(c.ultima_entrada_em)}
            {c.ultimo_erro && <div className="text-[12px]" style={{ color: "#B91C1C" }}>{c.ultimo_erro}</div>}
          </div>
        ))}
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Campo rotulo="ID da conta (IG user id)"><Entrada value={igId} onChange={(e) => setIgId(e.target.value.replace(/\D/g, ""))} /></Campo>
          <Campo rotulo="Token (vai para o cofre; não volta para a tela)"><Entrada type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></Campo>
          <Botao onClick={() => void conectar()} disabled={ocupado || !igId || token.length < 20}>Conectar</Botao>
        </div>
      </section>
      <details className="mkt-card p-4">
        <summary className="cursor-pointer text-[14px] font-bold" style={{ color: "var(--ink)" }}>Painel da Meta (uma vez, pelo Bruno)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]" style={{ color: "var(--ink2)" }}>
          <li>No app da Meta, produto <b>Instagram</b> › “API com login do Instagram”. Permissões: <code>instagram_business_basic</code>, <code>instagram_business_manage_messages</code>, <code>instagram_business_manage_comments</code>.</li>
          <li>Webhook: URL <code className="break-all">{estado.instagram.webhook ?? "https://<domínio do QS>/api/mkt-instagram"}</code> e o token de verificação = valor de <code>MKT_IG_VERIFY_TOKEN</code> na Vercel {estado.instagram.verifyToken ? <Chip cor="#059669">configurado</Chip> : <Chip cor="#DC2626">falta na Vercel</Chip>}.</li>
          <li>Assinar os campos <code>comments</code>, <code>messages</code> e <code>mentions</code> (e <code>messaging_postbacks</code>).</li>
          <li>Gerar o token da conta (Business/Creator) e colar acima junto com o ID da conta.</li>
        </ol>
      </details>
    </div>
  );
}

// ── Comentários e DMs ───────────────────────────────────────────────────────

function Comentarios() {
  const [itens, setItens] = useState<Record<string, any>[] | null>(null);
  useEffect(() => {
    void supabase.from("mkt_ig_comentarios").select("id,from_username,texto,media_id,respondido_dm_em,respondido_publico_em,erro,criado_em,mkt_ig_automacoes(nome)").order("criado_em", { ascending: false }).limit(100)
      .then(({ data, error }) => { if (error) notifyError(semTabela(error.message)); setItens(data ?? []); });
  }, []);
  if (!itens) return <Carregando />;
  if (!itens.length) return <div className="mkt-card p-5 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum comentário recebido ainda. Eles aparecem aqui quando o Instagram estiver conectado e ligado.</div>;
  return (
    <div className="mkt-card divide-y">
      {itens.map((c) => (
        <div key={c.id} className="p-3 text-[13px]" style={{ borderColor: "var(--line)" }}>
          <b>@{c.from_username ?? "?"}</b> <span style={{ color: "var(--ink3)" }}>{quando(c.criado_em)}</span>
          <div style={{ color: "var(--ink)" }}>{c.texto}</div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[12px]" style={{ color: "var(--ink3)" }}>
            {c.mkt_ig_automacoes?.nome ? <span>regra: {c.mkt_ig_automacoes.nome}</span> : <span>nenhuma regra</span>}
            {c.respondido_publico_em && <Chip cor="#059669">respondido no post</Chip>}
            {c.respondido_dm_em && <Chip cor="#059669">DM enviada</Chip>}
            {c.erro && <span style={{ color: "#B91C1C" }}>{c.erro}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Dms() {
  const [convs, setConvs] = useState<Record<string, any>[] | null>(null);
  const [aberta, setAberta] = useState<Record<string, any> | null>(null);
  const [msgs, setMsgs] = useState<Record<string, any>[]>([]);
  const [texto, setTexto] = useState("");
  const carregar = useCallback(() => supabase.from("mkt_ig_conversas").select("id,username,nome,ultima_entrada_em,ultima_mensagem_em,ultima_previa,nao_lidas,automacao_pausada_ate").order("ultima_mensagem_em", { ascending: false, nullsFirst: false }).limit(200)
    .then(({ data, error }) => { if (error) notifyError(semTabela(error.message)); setConvs(data ?? []); }), []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    if (!aberta) return;
    void supabase.from("mkt_ig_mensagens").select("id,direcao,texto,tipo,origem,status,erro,criado_em").eq("conversa_id", aberta.id).order("criado_em").limit(200).then(({ data }) => setMsgs(data ?? []));
  }, [aberta]);
  async function enviar() {
    if (!aberta || !texto.trim()) return;
    try { await acao({ acao: "ig-responder", conversaId: aberta.id, texto }); setTexto(""); setAberta({ ...aberta }); notifySuccess("Enviado (automação pausada 12 h nesta conversa)."); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
  }
  if (!convs) return <Carregando />;
  if (!convs.length) return <div className="mkt-card p-5 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma DM recebida ainda. Elas aparecem aqui quando o Instagram estiver conectado e ligado.</div>;
  const janela = aberta?.ultima_entrada_em && Date.now() - new Date(aberta.ultima_entrada_em).getTime() < 24 * 3_600_000;
  return (
    <div className="flex gap-3" style={{ minHeight: 400 }}>
      <aside className="mkt-card w-72 shrink-0 overflow-y-auto">
        {convs.map((c) => (
          <button key={c.id} type="button" onClick={() => setAberta(c)} className="w-full border-b px-3 py-2 text-left text-[13px]" style={{ borderColor: "var(--line)", background: aberta?.id === c.id ? COR_SUAVE : undefined }}>
            <b>@{c.username ?? c.nome ?? "?"}</b> <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{quando(c.ultima_mensagem_em)}</span>
            <div className="truncate text-[12px]" style={{ color: "var(--ink2)" }}>{c.ultima_previa}</div>
          </button>
        ))}
      </aside>
      {aberta ? (
        <section className="mkt-card flex flex-1 flex-col">
          <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : ""}`}>
                <div className="max-w-[75%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-[13px]" style={m.direcao === "saida" ? { background: "var(--rel-soft)", color: "var(--ink)" } : { background: "var(--card2)", color: "var(--ink)" }}>
                  {m.texto || `[${m.tipo}]`}<div className="text-right text-[10.5px] opacity-60">{m.origem} · {quando(m.criado_em)}{m.erro ? ` · ${m.erro}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
          <form className="flex gap-2 border-t p-2" style={{ borderColor: "var(--line)" }} onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
            <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!janela} placeholder={janela ? "Responder…" : "Fora da janela de 24 h do Instagram"} />
            <Botao type="submit" variante="primario" disabled={!janela || !texto.trim()}>Enviar</Botao>
          </form>
        </section>
      ) : <div className="mkt-card hidden flex-1 items-center justify-center text-[13px] md:flex" style={{ color: "var(--ink3)" }}>Escolha uma conversa.</div>}
    </div>
  );
}
