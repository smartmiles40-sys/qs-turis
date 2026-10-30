// src/mkt/automacoes/InstagramPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › INSTAGRAM — comentário → resposta pública + DM, resposta/menção no
// story, palavra na DM e boas-vindas. VEM DESLIGADO: o webhook (api/mkt-instagram)
// não grava nem responde nada até o Bruno conectar a conta e ligar aqui.
// O passo a passo do painel da Meta está em docs/MARKETING-AUTOMACOES.md.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { acao, carregarEstado, salvarConfig, type EstadoMkt } from "./api";
import { Abas, AreaTexto, Aviso, Botao, Campo, Carregando, Chip, Entrada, MKT_CSS, Modal, Selecao, quando } from "./ui";

type Gatilho = "comentario" | "dm_palavra" | "story_resposta" | "story_mencao" | "boas_vindas";
const ROT: Record<Gatilho, string> = {
  comentario: "Comentário no post/reels", dm_palavra: "Palavra na DM", story_resposta: "Resposta ao story", story_mencao: "Menção no story", boas_vindas: "Boas-vindas (1ª DM)",
};
interface ConfigIg { palavras?: string[]; qualquer_palavra?: boolean; posts?: string[]; respostas_publicas?: string[]; dm_texto?: string; dm_botoes?: { titulo: string; url: string }[]; tags?: string[] }
interface AutoIg { id: string; nome: string; ativo: boolean; gatilho: Gatilho; config: ConfigIg; disparos: number; ultimo_disparo_em: string | null }
interface Conta { id: string; ig_user_id: string; username: string | null; status: string; ultima_entrada_em: string | null; ultimo_erro: string | null }

const lista = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const semTabela = (m: string) => /does not exist|schema cache/i.test(m) ? "As tabelas ainda não existem no banco (migration 0244 não aplicada)." : m;

export default function InstagramPage() {
  const [aba, setAba] = useState<"situacao" | "automacoes" | "comentarios" | "conversas">("situacao");
  const [estado, setEstado] = useState<EstadoMkt | null>(null);
  const [contas, setContas] = useState<Conta[] | null>(null);

  const carregar = useCallback(async () => {
    carregarEstado().then(setEstado).catch(() => setEstado(null));
    const { data, error } = await supabase.from("mkt_ig_contas").select("id,ig_user_id,username,status,ultima_entrada_em,ultimo_erro").order("criado_em");
    if (error) notifyError(semTabela(error.message));
    setContas((data ?? []) as Conta[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className="mkt-raiz p-4 md:p-6 max-w-[1200px] mx-auto">
      <style>{MKT_CSS}</style>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Instagram</h1>
        {estado && <Chip cor={estado.instagram.ligado ? "#059669" : "#6B7280"}>{estado.instagram.ligado ? "ligado" : "desligado"}</Chip>}
      </div>
      <p className="text-[13px] mb-3" style={{ color: "var(--ink3)" }}>Comentou a palavra → responde no post e manda DM. Respondeu ao story → DM. Sem fluxo em blocos (a API do Instagram é mais simples): cada automação é uma regra.</p>
      <Abas abas={[{ id: "situacao", rotulo: "Situação" }, { id: "automacoes", rotulo: "Automações" }, { id: "comentarios", rotulo: "Comentários" }, { id: "conversas", rotulo: "DMs" }]} atual={aba} onTrocar={setAba} />
      <div className="mt-4">
        {aba === "situacao" && <Situacao estado={estado} contas={contas} onMudou={carregar} />}
        {aba === "automacoes" && <Automacoes />}
        {aba === "comentarios" && <Comentarios />}
        {aba === "conversas" && <Dms />}
      </div>
    </div>
  );
}

function Situacao({ estado, contas, onMudou }: { estado: EstadoMkt | null; contas: Conta[] | null; onMudou: () => void }) {
  const [igId, setIgId] = useState("");
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (!estado || !contas) return <Carregando />;
  const conectada = contas.some((c) => c.status === "conectada");

  async function conectar() {
    setOcupado(true);
    try { const r = await acao<{ username?: string }>({ acao: "ig-conectar", igUserId: igId, token }); notifySuccess(`Conta conectada${r.username ? `: @${r.username}` : ""}.`); setToken(""); onMudou(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }
  async function ligar(ligado: boolean) {
    if (ligado && !window.confirm("Ligar as automações do Instagram? A partir daqui, comentários e DMs que combinarem com uma regra recebem resposta de verdade.")) return;
    try { await salvarConfig("instagram", { ligado }); notifySuccess(ligado ? "Instagram ligado." : "Instagram desligado."); onMudou(); }
    catch (e) { notifyError(semTabela(e instanceof Error ? e.message : "Falhou.")); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <section className="mkt-card p-4 space-y-2">
        <h2 className="font-bold text-[14px]" style={{ color: "var(--ink)" }}>1. Painel da Meta (uma vez, pelo Bruno)</h2>
        <ol className="list-decimal pl-5 text-[13px] space-y-1" style={{ color: "var(--ink2)" }}>
          <li>No app da Meta, produto <b>Instagram</b> › “API com login do Instagram”. Permissões: <code>instagram_business_basic</code>, <code>instagram_business_manage_messages</code>, <code>instagram_business_manage_comments</code>.</li>
          <li>Webhook: URL <code className="break-all">{estado.instagram.webhook ?? "https://<domínio do QS>/api/mkt-instagram"}</code> e o token de verificação = valor de <code>MKT_IG_VERIFY_TOKEN</code> na Vercel {estado.instagram.verifyToken ? <Chip cor="#059669">configurado</Chip> : <Chip cor="#DC2626">falta na Vercel</Chip>}.</li>
          <li>Assinar os campos <code>comments</code>, <code>messages</code> e <code>mentions</code> (e <code>messaging_postbacks</code>).</li>
          <li>Gerar o token da conta (Business/Creator) e colar abaixo junto com o ID da conta.</li>
        </ol>
      </section>
      <section className="mkt-card p-4 space-y-2">
        <h2 className="font-bold text-[14px]" style={{ color: "var(--ink)" }}>2. Conta</h2>
        {contas.map((c) => (
          <div key={c.id} className="text-[13px]" style={{ color: "var(--ink2)" }}>
            <b>@{c.username ?? c.ig_user_id}</b> · <Chip cor={c.status === "conectada" ? "#059669" : "#DC2626"}>{c.status}</Chip> · última entrada {quando(c.ultima_entrada_em)}
            {c.ultimo_erro && <div className="text-[12px]" style={{ color: "#B91C1C" }}>{c.ultimo_erro}</div>}
          </div>
        ))}
        <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-2 items-end">
          <Campo rotulo="ID da conta (IG user id)"><Entrada value={igId} onChange={(e) => setIgId(e.target.value.replace(/\D/g, ""))} /></Campo>
          <Campo rotulo="Token (vai para o cofre; não volta para a tela)"><Entrada type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></Campo>
          <Botao onClick={() => void conectar()} disabled={ocupado || !igId || token.length < 20}>Conectar</Botao>
        </div>
      </section>
      <section className="mkt-card p-4 space-y-2">
        <h2 className="font-bold text-[14px]" style={{ color: "var(--ink)" }}>3. Ligar</h2>
        {estado.instagram.ligado
          ? <Botao variante="perigo" onClick={() => void ligar(false)}>Desligar o Instagram</Botao>
          : <Botao variante="primario" onClick={() => void ligar(true)} disabled={!conectada} title={conectada ? "" : "Conecte a conta primeiro"}>Ligar o Instagram</Botao>}
        <Aviso>Desligado, o webhook só responde 200 para a Meta e descarta — não grava comentário nem DM.</Aviso>
      </section>
    </div>
  );
}

function Automacoes() {
  const [itens, setItens] = useState<AutoIg[] | null>(null);
  const [form, setForm] = useState<Partial<AutoIg> & { config: ConfigIg } | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_ig_automacoes").select("*").order("criado_em", { ascending: false });
    if (error) notifyError(semTabela(error.message));
    setItens((data ?? []) as AutoIg[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function salvar() {
    if (!form) return;
    const c = form.config;
    if (!form.nome?.trim()) { notifyError("Dê um nome."); return; }
    if (!c.dm_texto?.trim()) { notifyError("Escreva a DM."); return; }
    if ((form.gatilho === "comentario" || form.gatilho === "dm_palavra") && !c.qualquer_palavra && !(c.palavras ?? []).length) { notifyError("Escreva as palavras (ou marque “qualquer comentário”)."); return; }
    const linha = { nome: form.nome.trim(), gatilho: form.gatilho, ativo: form.ativo ?? true, config: c };
    const r = form.id ? await supabase.from("mkt_ig_automacoes").update(linha).eq("id", form.id) : await supabase.from("mkt_ig_automacoes").insert(linha);
    if (r.error) { notifyError(semTabela(r.error.message)); return; }
    setForm(null); void carregar();
  }
  if (!itens) return <Carregando />;
  const c = form?.config ?? {};
  const setC = (p: ConfigIg) => form && setForm({ ...form, config: { ...form.config, ...p } });

  return (
    <div>
      <Botao variante="primario" onClick={() => setForm({ nome: "", gatilho: "comentario", ativo: true, config: { palavras: [], respostas_publicas: ["Te mandei no direct! 📩"], dm_texto: "Oi {{nome}}! Aqui está o link: ", dm_botoes: [] } })}>+ Nova automação</Botao>
      <div className="mt-3 space-y-2">
        {!itens.length && <Aviso>Nenhuma automação ainda.</Aviso>}
        {itens.map((a) => (
          <div key={a.id} className="mkt-card p-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2"><strong className="text-[13.5px]" style={{ color: "var(--ink)" }}>{a.nome}</strong><Chip>{ROT[a.gatilho]}</Chip>{!a.ativo && <Chip cor="#6B7280">desligada</Chip>}</div>
              <div className="text-[12px]" style={{ color: "var(--ink3)" }}>{a.config.qualquer_palavra ? "qualquer texto" : (a.config.palavras ?? []).join(", ")} · {a.disparos} disparos · último {quando(a.ultimo_disparo_em)}</div>
            </div>
            <Botao variante="fantasma" onClick={() => void supabase.from("mkt_ig_automacoes").update({ ativo: !a.ativo }).eq("id", a.id).then(() => carregar())}>{a.ativo ? "Desligar" : "Ligar"}</Botao>
            <Botao onClick={() => setForm({ ...a, config: { ...a.config } })}>Editar</Botao>
            <Botao variante="perigo" onClick={() => { if (window.confirm("Apagar?")) void supabase.from("mkt_ig_automacoes").delete().eq("id", a.id).then(() => carregar()); }}>Apagar</Botao>
          </div>
        ))}
      </div>
      <Modal aberto={!!form} titulo={form?.id ? "Editar automação" : "Nova automação"} onFechar={() => setForm(null)} largura={620}
        rodape={<><Botao onClick={() => setForm(null)}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()}>Salvar</Botao></>}>
        {form && (
          <div className="space-y-3">
            <Campo rotulo="Nome"><Entrada value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Reels Japão: ROTEIRO" /></Campo>
            <Campo rotulo="Quando">
              <Selecao value={form.gatilho} onChange={(e) => setForm({ ...form, gatilho: e.target.value as Gatilho })}>
                {(Object.keys(ROT) as Gatilho[]).map((g) => <option key={g} value={g}>{ROT[g]}</option>)}
              </Selecao>
            </Campo>
            {(form.gatilho === "comentario" || form.gatilho === "dm_palavra") && (
              <>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!c.qualquer_palavra} onChange={(e) => setC({ qualquer_palavra: e.target.checked })} /> Qualquer {form.gatilho === "comentario" ? "comentário" : "mensagem"}</label>
                {!c.qualquer_palavra && <Campo rotulo="Palavras (vírgula)"><Entrada value={(c.palavras ?? []).join(", ")} onChange={(e) => setC({ palavras: lista(e.target.value) })} placeholder="roteiro, quero, link" /></Campo>}
              </>
            )}
            {form.gatilho === "comentario" && (
              <>
                <Campo rotulo="Só nestes posts (IDs, vírgula; vazio = todos)"><Entrada value={(c.posts ?? []).join(", ")} onChange={(e) => setC({ posts: lista(e.target.value) })} /></Campo>
                <Campo rotulo="Respostas públicas (uma por linha; sorteia)" dica="Responder em público ajuda o alcance. Vazio = só DM.">
                  <AreaTexto value={(c.respostas_publicas ?? []).join("\n")} onChange={(e) => setC({ respostas_publicas: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
                </Campo>
              </>
            )}
            <Campo rotulo="DM" dica="Marcadores: {{nome}}, {{usuario}}"><AreaTexto rows={4} value={c.dm_texto ?? ""} onChange={(e) => setC({ dm_texto: e.target.value })} /></Campo>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Botões de link (até 3)</div>
              {(c.dm_botoes ?? []).map((b, i) => (
                <div key={i} className="flex gap-1.5">
                  <Entrada value={b.titulo} onChange={(e) => setC({ dm_botoes: (c.dm_botoes ?? []).map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)) })} placeholder="Ver roteiro" />
                  <Entrada value={b.url} onChange={(e) => setC({ dm_botoes: (c.dm_botoes ?? []).map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" />
                  <Botao variante="fantasma" onClick={() => setC({ dm_botoes: (c.dm_botoes ?? []).filter((_, j) => j !== i) })}>×</Botao>
                </div>
              ))}
              {(c.dm_botoes ?? []).length < 3 && <Botao variante="fantasma" onClick={() => setC({ dm_botoes: [...(c.dm_botoes ?? []), { titulo: "", url: "" }] })}>+ botão</Botao>}
            </div>
            <Campo rotulo="Tags na conversa (vírgula)"><Entrada value={(c.tags ?? []).join(", ")} onChange={(e) => setC({ tags: lista(e.target.value) })} /></Campo>
            <Aviso>Comentário: a Meta deixa mandar UMA DM por comentário (resposta privada) em até 7 dias. Depois, só se a pessoa responder.</Aviso>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Comentarios() {
  const [itens, setItens] = useState<Record<string, any>[] | null>(null);
  useEffect(() => {
    void supabase.from("mkt_ig_comentarios").select("id,from_username,texto,media_id,respondido_dm_em,respondido_publico_em,erro,criado_em,mkt_ig_automacoes(nome)").order("criado_em", { ascending: false }).limit(100)
      .then(({ data, error }) => { if (error) notifyError(semTabela(error.message)); setItens(data ?? []); });
  }, []);
  if (!itens) return <Carregando />;
  if (!itens.length) return <Aviso>Nenhum comentário recebido (o Instagram está desligado ou nada chegou ainda).</Aviso>;
  return (
    <div className="mkt-card divide-y">
      {itens.map((c) => (
        <div key={c.id} className="p-3 text-[13px]" style={{ borderColor: "var(--line)" }}>
          <b>@{c.from_username ?? "?"}</b> <span style={{ color: "var(--ink3)" }}>{quando(c.criado_em)}</span>
          <div style={{ color: "var(--ink)" }}>{c.texto}</div>
          <div className="text-[12px] mt-0.5 flex gap-2 flex-wrap" style={{ color: "var(--ink3)" }}>
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
  if (!convs.length) return <Aviso>Nenhuma DM recebida.</Aviso>;
  const janela = aberta?.ultima_entrada_em && Date.now() - new Date(aberta.ultima_entrada_em).getTime() < 24 * 3_600_000;
  return (
    <div className="flex gap-3" style={{ minHeight: 400 }}>
      <aside className="mkt-card w-72 shrink-0 overflow-y-auto">
        {convs.map((c) => (
          <button key={c.id} type="button" onClick={() => setAberta(c)} className="w-full text-left px-3 py-2 border-b text-[13px]" style={{ borderColor: "var(--line)" }}>
            <b>@{c.username ?? c.nome ?? "?"}</b> <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{quando(c.ultima_mensagem_em)}</span>
            <div className="truncate text-[12px]" style={{ color: "var(--ink2)" }}>{c.ultima_previa}</div>
          </button>
        ))}
      </aside>
      {aberta && (
        <section className="mkt-card flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : ""}`}>
                <div className="rounded-xl px-3 py-1.5 text-[13px] max-w-[75%] whitespace-pre-wrap" style={m.direcao === "saida" ? { background: "#EDE9FE", color: "#111" } : { background: "var(--card2)", color: "var(--ink)" }}>
                  {m.texto || `[${m.tipo}]`}<div className="text-[10.5px] opacity-60 text-right">{m.origem} · {quando(m.criado_em)}{m.erro ? ` · ${m.erro}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
          <form className="p-2 border-t flex gap-2" style={{ borderColor: "var(--line)" }} onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
            <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!janela} placeholder={janela ? "Responder…" : "Fora da janela de 24 h do Instagram"} />
            <Botao type="submit" variante="primario" disabled={!janela || !texto.trim()}>Enviar</Botao>
          </form>
        </section>
      )}
    </div>
  );
}
