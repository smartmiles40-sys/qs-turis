// src/mkt/automacoes/AutomacoesPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › AUTOMAÇÕES — a casa do "igual ManyChat" no número do Marketing.
// Abas: Fluxos (lista + editor) · Respostas básicas · Palavras-chave ·
// Links e anúncios · Webhook/LP · Campos personalizados · Número e robô.
//
// Os gatilhos de todas as abas moram na MESMA tabela (mkt_fluxo_gatilhos) — cada
// aba só filtra pelos tipos dela. Quem escolhe qual gatilho vence é o servidor
// (api/_mktAutoRegras.js escolherGatilho: ref > anúncio > palavra > boas-vindas > padrão).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { carregarPainelMeta, conectarPelaMeta } from "@/lib/qs/metaConexao";
import {
  ROTULO_GATILHO, grafoInicial, linkDeReferencia,
  type CampoPersonalizado, type Fluxo, type Gatilho, type GatilhoConfig, type TipoGatilho,
} from "./tipos";
import {
  apagarCampo, apagarFluxo, apagarGatilho, carregarEstado, criarCampo, criarFluxo, criarGatilho, duplicarFluxo,
  listarCampos, listarFluxos, listarGatilhos, mudarGatilho, novoToken, salvarConfig, salvarFluxo, type EstadoMkt,
} from "./api";
import { Abas, Aviso, Botao, COR, Campo, Carregando, Chip, Entrada, MKT_CSS, Modal, Selecao, quando } from "./ui";
import EditorFluxo from "./EditorFluxo";

type Aba = "fluxos" | "respostas" | "palavras" | "links" | "webhook" | "campos" | "numero";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "fluxos", rotulo: "Fluxos" }, { id: "respostas", rotulo: "Respostas básicas" }, { id: "palavras", rotulo: "Palavras-chave" },
  { id: "links", rotulo: "Links e anúncios" }, { id: "webhook", rotulo: "Webhook / LP" }, { id: "campos", rotulo: "Campos personalizados" },
  { id: "numero", rotulo: "Número e robô" },
];

const erroMsg = (e: unknown, padrao: string) => {
  const m = e instanceof Error ? e.message : "";
  if (/relation .*mkt_|does not exist|schema cache/i.test(m)) return "As tabelas das automações ainda não existem no banco (migration 0244 não aplicada).";
  return m || padrao;
};

export default function AutomacoesPage() {
  const [aba, setAba] = useState<Aba>("fluxos");
  const [editando, setEditando] = useState<string | null>(null);
  const [fluxos, setFluxos] = useState<Fluxo[] | null>(null);
  const [estado, setEstado] = useState<EstadoMkt | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try { setFluxos(await listarFluxos()); setErro(null); }
    catch (e) { setErro(erroMsg(e, "Não consegui carregar os fluxos.")); setFluxos([]); }
  }, []);
  useEffect(() => { void recarregar(); carregarEstado().then(setEstado).catch(() => setEstado(null)); }, [recarregar]);
  const voltar = useCallback(() => { setEditando(null); void recarregar(); }, [recarregar]);

  return (
    <div className="mkt-raiz p-4 md:p-6 max-w-[1500px] mx-auto">
      <style>{MKT_CSS}</style>
      {editando ? <EditorFluxo fluxoId={editando} onVoltar={voltar} /> : (
        <>
          <header className="mb-4">
            <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Automações</h1>
            <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
              Fluxos no WhatsApp do Marketing{estado?.numero?.numero ? ` (${estado.numero.numero})` : ""}: palavra-chave, link, anúncio e LP disparam; o robô responde.
            </p>
          </header>
          {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
          {estado && !estado.numero?.conectado && <div className="mb-3"><Aviso tom="alerta">Nenhum número com setor Marketing conectado na Meta — os fluxos podem ser montados e simulados, mas nada sai nem chega. Veja a aba “Número e robô”.</Aviso></div>}
          <Abas abas={ABAS} atual={aba} onTrocar={setAba} />
          <div className="mt-4">
            {aba === "fluxos" && <AbaFluxos fluxos={fluxos} onAbrir={setEditando} onMudou={recarregar} />}
            {aba === "respostas" && <AbaGatilhos fluxos={fluxos ?? []} tipos={["boas_vindas", "padrao"]} estado={estado}
              explica="Boas-vindas: a PRIMEIRA mensagem de alguém que nunca falou com o número. Resposta padrão: quando nada mais combinou (no máximo uma vez a cada X horas por pessoa)." />}
            {aba === "palavras" && <AbaGatilhos fluxos={fluxos ?? []} tipos={["palavra_chave"]} estado={estado}
              explica="A pessoa manda a palavra → começa o fluxo. Acento e maiúscula não importam. A de maior prioridade ganha quando duas combinam." />}
            {aba === "links" && <AbaGatilhos fluxos={fluxos ?? []} tipos={["link_ref", "anuncio"]} estado={estado}
              explica="Link de referência: um wa.me com um código escondido no texto — cada link (bio, story, QR do evento) começa um fluxo. Anúncio: a 1ª mensagem que vem de um anúncio clique-para-WhatsApp com aquele ID." />}
            {aba === "webhook" && <AbaGatilhos fluxos={fluxos ?? []} tipos={["webhook", "tag_adicionada"]} estado={estado}
              explica="Webhook: a LP (ou o n8n) faz um POST com o telefone e o fluxo começa — comece por um TEMPLATE, porque a pessoa ainda não escreveu. Tag adicionada: quando a tag entra na pessoa (por outro fluxo ou à mão)." />}
            {aba === "campos" && <AbaCampos />}
            {aba === "numero" && <AbaNumero estado={estado} onMudou={() => carregarEstado().then(setEstado).catch(() => null)} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── Fluxos ──────────────────────────────────────────────────────────────────
function AbaFluxos({ fluxos, onAbrir, onMudou }: { fluxos: Fluxo[] | null; onAbrir: (id: string) => void; onMudou: () => void }) {
  const [novo, setNovo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  if (!fluxos) return <Carregando />;
  const lista = fluxos.filter((f) => !busca || f.nome.toLowerCase().includes(busca.toLowerCase()));

  async function criar() {
    if (!novo?.trim()) return;
    try { const f = await criarFluxo(novo.trim(), grafoInicial()); setNovo(null); onAbrir(f.id); }
    catch (e) { notifyError(erroMsg(e, "Não consegui criar.")); }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <Entrada className="!w-64" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar fluxo…" />
        <span className="flex-1" />
        <Botao variante="primario" onClick={() => setNovo("")}>+ Novo fluxo</Botao>
      </div>
      {!lista.length ? <Aviso>Nenhum fluxo ainda. Comece por um de boas-vindas: “Oi! Sobre qual viagem você quer saber?” com 3 botões.</Aviso> : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((f) => (
            <div key={f.id} className="mkt-card p-3 flex flex-col gap-2">
              <button type="button" className="text-left" onClick={() => onAbrir(f.id)}>
                <div className="flex items-center gap-2">
                  <strong className="text-[14px]" style={{ color: "var(--ink)" }}>{f.nome}</strong>
                  <Chip cor={f.status === "ativo" ? "#059669" : f.status === "pausado" ? "#D97706" : "#6B7280"}>{f.status}</Chip>
                </div>
                <div className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>
                  {f.grafo?.nos?.length ?? 0} blocos · {f.execucoes_total ?? 0} iniciados · {f.concluidas_total ?? 0} concluídos · mudou {quando(f.atualizado_em)}
                </div>
              </button>
              <div className="flex gap-1.5">
                <Botao onClick={() => onAbrir(f.id)}>Editar</Botao>
                {f.status === "ativo"
                  ? <Botao variante="fantasma" onClick={() => void salvarFluxo(f.id, { status: "pausado" }).then(onMudou).catch((e) => notifyError(erroMsg(e, "Falhou.")))}>Pausar</Botao>
                  : null}
                <Botao variante="fantasma" onClick={() => void duplicarFluxo(f).then(() => { notifySuccess("Duplicado (como rascunho)."); onMudou(); }).catch((e) => notifyError(erroMsg(e, "Falhou.")))}>Duplicar</Botao>
                <span className="flex-1" />
                <Botao variante="perigo" onClick={() => {
                  if (!window.confirm(`Apagar o fluxo “${f.nome}”? Os gatilhos dele também somem; quem estiver no meio para.`)) return;
                  void apagarFluxo(f.id).then(onMudou).catch((e) => notifyError(erroMsg(e, "Não consegui apagar.")));
                }}>Apagar</Botao>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal aberto={novo !== null} titulo="Novo fluxo" onFechar={() => setNovo(null)}
        rodape={<><Botao onClick={() => setNovo(null)}>Cancelar</Botao><Botao variante="primario" onClick={() => void criar()} disabled={!novo?.trim()}>Criar e abrir</Botao></>}>
        <Campo rotulo="Nome"><Entrada autoFocus value={novo ?? ""} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void criar()} placeholder="ex.: Boas-vindas · Japão 2027" /></Campo>
      </Modal>
    </div>
  );
}

// ── Gatilhos (as abas Respostas / Palavras / Links / Webhook) ─────────────────
function resumoGatilho(g: Gatilho, estado: EstadoMkt | null): string {
  const c = g.config;
  switch (g.tipo) {
    case "palavra_chave": return `${(c.palavras ?? []).join(", ")} · ${c.modo === "exata" ? "palavra exata" : c.modo === "comeca" ? "começa com" : "contém"}`;
    case "padrao": return `no máximo 1× a cada ${c.intervalo_horas ?? 24} h por pessoa`;
    case "link_ref": return estado?.numero?.numero ? linkDeReferencia(estado.numero.numero, c.codigo ?? "", c.texto) : `código ${c.codigo}`;
    case "anuncio": return (c.ad_ids ?? []).length ? `anúncios ${(c.ad_ids ?? []).join(", ")}` : "qualquer anúncio";
    case "tag_adicionada": return `tag “${c.tag ?? ""}”`;
    case "webhook": return estado?.lpBase && c.token ? `${estado.lpBase}${c.token}` : "token gerado";
    default: return "";
  }
}

function AbaGatilhos({ fluxos, tipos, estado, explica }: { fluxos: Fluxo[]; tipos: TipoGatilho[]; estado: EstadoMkt | null; explica: string }) {
  const [lista, setLista] = useState<Gatilho[] | null>(null);
  const [form, setForm] = useState<{ id?: string; tipo: TipoGatilho; fluxo_id: string; prioridade: number; config: GatilhoConfig } | null>(null);
  const chaveTipos = tipos.join(",");
  const carregar = useCallback(async () => {
    try { setLista(await listarGatilhos(chaveTipos.split(",") as TipoGatilho[])); }
    catch (e) { notifyError(erroMsg(e, "Não consegui carregar.")); setLista([]); }
  }, [chaveTipos]);
  useEffect(() => { void carregar(); }, [carregar]);
  const nomeFluxo = useMemo(() => new Map(fluxos.map((f) => [f.id, f])), [fluxos]);

  function abrirNovo(tipo: TipoGatilho) {
    const config: GatilhoConfig = tipo === "palavra_chave" ? { palavras: [], modo: "contem" } : tipo === "padrao" ? { intervalo_horas: 24 }
      : tipo === "link_ref" ? { codigo: Math.random().toString(36).slice(2, 8), texto: "Olá! Quero saber mais" } : tipo === "anuncio" ? { ad_ids: [] }
      : tipo === "webhook" ? { token: novoToken() } : tipo === "tag_adicionada" ? { tag: "" } : {};
    setForm({ tipo, fluxo_id: fluxos[0]?.id ?? "", prioridade: 0, config });
  }

  async function salvar() {
    if (!form) return;
    if (!form.fluxo_id) { notifyError("Escolha o fluxo."); return; }
    const c = form.config;
    if (form.tipo === "palavra_chave" && !(c.palavras ?? []).length) { notifyError("Escreva pelo menos uma palavra."); return; }
    if (form.tipo === "link_ref" && !/^[a-z0-9_-]{3,40}$/i.test(c.codigo ?? "")) { notifyError("Código: 3 a 40 letras, números, - ou _."); return; }
    if (form.tipo === "tag_adicionada" && !c.tag?.trim()) { notifyError("Escreva a tag."); return; }
    try {
      if (form.id) await mudarGatilho(form.id, { fluxo_id: form.fluxo_id, prioridade: form.prioridade, config: c });
      else await criarGatilho({ fluxo_id: form.fluxo_id, tipo: form.tipo, prioridade: form.prioridade, config: c });
      setForm(null); void carregar();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      notifyError(/duplicate|unique/i.test(m) ? "Esse código/token já existe em outro gatilho." : erroMsg(e, "Não consegui salvar."));
    }
  }

  const copiar = (t: string) => { void navigator.clipboard?.writeText(t).then(() => notifySuccess("Copiado.")); };
  if (!lista) return <Carregando />;
  const c = form?.config ?? {};
  const setC = (patch: GatilhoConfig) => form && setForm({ ...form, config: { ...form.config, ...patch } });

  return (
    <div>
      <div className="mb-3"><Aviso>{explica}</Aviso></div>
      <div className="flex flex-wrap gap-2 mb-3">
        {tipos.map((t) => <Botao key={t} variante="primario" onClick={() => abrirNovo(t)} disabled={!fluxos.length}>+ {ROTULO_GATILHO[t]}</Botao>)}
        {!fluxos.length && <span className="text-[12.5px] self-center" style={{ color: "var(--ink3)" }}>Crie um fluxo primeiro.</span>}
      </div>
      {!lista.length ? <Aviso>Nada aqui ainda.</Aviso> : (
        <div className="mkt-card divide-y" style={{ borderColor: "var(--line)" }}>
          {lista.map((g) => {
            const f = nomeFluxo.get(g.fluxo_id);
            const r = resumoGatilho(g, estado);
            return (
              <div key={g.id} className="p-3 flex flex-wrap items-center gap-2" style={{ borderColor: "var(--line)" }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip>{ROTULO_GATILHO[g.tipo]}</Chip>
                    <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>→ {f?.nome ?? "(fluxo apagado)"}</span>
                    {f && f.status !== "ativo" && <Chip cor="#D97706">fluxo {f.status}</Chip>}
                    {!g.ativo && <Chip cor="#6B7280">desligado</Chip>}
                    <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{g.disparos ?? 0} disparos{g.prioridade ? ` · prioridade ${g.prioridade}` : ""}</span>
                  </div>
                  <div className="text-[12px] mt-0.5 break-all" style={{ color: "var(--ink2)" }}>{r}</div>
                </div>
                {(g.tipo === "link_ref" || g.tipo === "webhook") && <Botao variante="fantasma" onClick={() => copiar(r)}>Copiar</Botao>}
                <Botao variante="fantasma" onClick={() => void mudarGatilho(g.id, { ativo: !g.ativo }).then(carregar).catch((e) => notifyError(erroMsg(e, "Falhou.")))}>{g.ativo ? "Desligar" : "Ligar"}</Botao>
                <Botao onClick={() => setForm({ id: g.id, tipo: g.tipo, fluxo_id: g.fluxo_id, prioridade: g.prioridade ?? 0, config: { ...g.config } })}>Editar</Botao>
                <Botao variante="perigo" onClick={() => { if (window.confirm("Apagar este gatilho?")) void apagarGatilho(g.id).then(carregar).catch((e) => notifyError(erroMsg(e, "Falhou."))); }}>Apagar</Botao>
              </div>
            );
          })}
        </div>
      )}

      <Modal aberto={!!form} titulo={form ? `${form.id ? "Editar" : "Novo"}: ${ROTULO_GATILHO[form.tipo]}` : ""} onFechar={() => setForm(null)}
        rodape={<><Botao onClick={() => setForm(null)}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()}>Salvar</Botao></>}>
        {form && (
          <div className="space-y-3">
            <Campo rotulo="Começa o fluxo">
              <Selecao value={form.fluxo_id} onChange={(e) => setForm({ ...form, fluxo_id: e.target.value })}>
                {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.status !== "ativo" ? ` (${f.status})` : ""}</option>)}
              </Selecao>
            </Campo>
            {form.tipo === "palavra_chave" && (
              <>
                <Campo rotulo="Palavras" dica="Separe por vírgula. Ex.: japão, japao, roteiro japão">
                  <Entrada value={(c.palavras ?? []).join(", ")} onChange={(e) => setC({ palavras: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </Campo>
                <Campo rotulo="Combinar quando a mensagem">
                  <Selecao value={c.modo ?? "contem"} onChange={(e) => setC({ modo: e.target.value as GatilhoConfig["modo"] })}>
                    <option value="contem">contém a palavra</option><option value="exata">é exatamente a palavra</option><option value="comeca">começa com a palavra</option>
                  </Selecao>
                </Campo>
              </>
            )}
            {form.tipo === "padrao" && (
              <Campo rotulo="Responder no máximo uma vez a cada (horas)">
                <Entrada type="number" min={1} value={c.intervalo_horas ?? 24} onChange={(e) => setC({ intervalo_horas: Math.max(1, Number(e.target.value) || 24) })} />
              </Campo>
            )}
            {form.tipo === "link_ref" && (
              <>
                <Campo rotulo="Código (vai escondido no texto)"><Entrada value={c.codigo ?? ""} onChange={(e) => setC({ codigo: e.target.value.trim() })} /></Campo>
                <Campo rotulo="Texto que já vem escrito"><Entrada value={c.texto ?? ""} onChange={(e) => setC({ texto: e.target.value })} /></Campo>
                {estado?.numero?.numero
                  ? <Aviso tom="ok"><span className="break-all">{linkDeReferencia(estado.numero.numero, c.codigo ?? "", c.texto)}</span><br />Para QR Code: cole este link num gerador de QR (o QS ainda não gera a imagem).</Aviso>
                  : <Aviso tom="alerta">O link aparece quando o número do Marketing estiver conectado.</Aviso>}
              </>
            )}
            {form.tipo === "anuncio" && (
              <Campo rotulo="IDs dos anúncios (vazio = qualquer anúncio)" dica="O ID do anúncio no Gerenciador da Meta. Separe por vírgula.">
                <Entrada value={(c.ad_ids ?? []).join(", ")} onChange={(e) => setC({ ad_ids: e.target.value.split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean) })} />
              </Campo>
            )}
            {form.tipo === "tag_adicionada" && <Campo rotulo="Tag"><Entrada value={c.tag ?? ""} onChange={(e) => setC({ tag: e.target.value })} placeholder="ex.: quer-japao" /></Campo>}
            {form.tipo === "webhook" && (
              <>
                <Campo rotulo="Endereço (o token é a senha — não publique)">
                  <div className="flex gap-1.5">
                    <Entrada readOnly value={estado?.lpBase && c.token ? `${estado.lpBase}${c.token}` : c.token ?? ""} />
                    <Botao variante="fantasma" onClick={() => setC({ token: novoToken() })} title="Gera outro (o antigo para de funcionar)">Trocar</Botao>
                  </div>
                </Campo>
                <Aviso>POST com JSON: <code>{`{ "telefone": "5511999998888", "nome": "Ana", "email": "...", "tags": ["lp-japao"], "campos": { "destino": "Japão" } }`}</code></Aviso>
              </>
            )}
            {(form.tipo === "palavra_chave" || form.tipo === "link_ref" || form.tipo === "anuncio") && (
              <Campo rotulo="Prioridade" dica="Maior ganha quando dois gatilhos do mesmo tipo combinam.">
                <Entrada type="number" value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: Number(e.target.value) || 0 })} />
              </Campo>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Campos personalizados ───────────────────────────────────────────────────
function AbaCampos() {
  const [lista, setLista] = useState<CampoPersonalizado[] | null>(null);
  const [novo, setNovo] = useState<{ rotulo: string; chave: string; tipo: CampoPersonalizado["tipo"] }>({ rotulo: "", chave: "", tipo: "texto" });
  const carregar = useCallback(() => listarCampos().then(setLista).catch((e) => { notifyError(erroMsg(e, "Falhou.")); setLista([]); }), []);
  useEffect(() => { void carregar(); }, [carregar]);
  const chaveDe = (r: string) => r.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

  async function criar() {
    const chave = novo.chave || chaveDe(novo.rotulo);
    if (!novo.rotulo.trim() || !/^[a-z][a-z0-9_]{0,39}$/.test(chave)) { notifyError("Nome inválido (a chave precisa começar por letra)."); return; }
    if (["nome", "email", "telefone", "primeiro_nome"].includes(chave)) { notifyError("Esse nome já é do cadastro."); return; }
    try { await criarCampo({ rotulo: novo.rotulo.trim(), chave, tipo: novo.tipo, descricao: null }); setNovo({ rotulo: "", chave: "", tipo: "texto" }); void carregar(); }
    catch (e) { notifyError(/duplicate|unique/i.test(e instanceof Error ? e.message : "") ? "Já existe um campo com essa chave." : erroMsg(e, "Falhou.")); }
  }
  if (!lista) return <Carregando />;
  return (
    <div className="max-w-3xl">
      <div className="mb-3"><Aviso>Campos guardam o que a pessoa respondeu (bloco Pergunta) ou o que um fluxo definiu. Use no texto como <code>{"{{chave}}"}</code>. Ficam no cadastro do contato do Marketing.</Aviso></div>
      <div className="mkt-card p-3 grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto] items-end mb-3">
        <Campo rotulo="Nome"><Entrada value={novo.rotulo} onChange={(e) => setNovo({ ...novo, rotulo: e.target.value })} placeholder="Destino de interesse" /></Campo>
        <Campo rotulo="Chave"><Entrada value={novo.chave || chaveDe(novo.rotulo)} onChange={(e) => setNovo({ ...novo, chave: chaveDe(e.target.value) })} /></Campo>
        <Campo rotulo="Tipo">
          <Selecao value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value as CampoPersonalizado["tipo"] })}>
            <option value="texto">Texto</option><option value="numero">Número</option><option value="data">Data</option>
            <option value="sim_nao">Sim/Não</option><option value="email">E-mail</option><option value="telefone">Telefone</option>
          </Selecao>
        </Campo>
        <Botao variante="primario" onClick={() => void criar()}>Adicionar</Botao>
      </div>
      {lista.map((c) => (
        <div key={c.id} className="flex items-center gap-2 py-2 border-b text-[13px]" style={{ borderColor: "var(--line)" }}>
          <strong style={{ color: "var(--ink)" }}>{c.rotulo}</strong>
          <code className="text-[12px]" style={{ color: COR }}>{`{{${c.chave}}}`}</code>
          <span style={{ color: "var(--ink3)" }}>{c.tipo}</span>
          <span className="flex-1" />
          <Botao variante="perigo" onClick={() => { if (window.confirm(`Apagar o campo “${c.rotulo}”? Os valores guardados nos contatos ficam, mas somem da lista.`)) void apagarCampo(c.id).then(carregar).catch((e) => notifyError(erroMsg(e, "Falhou."))); }}>Apagar</Botao>
        </div>
      ))}
    </div>
  );
}

// ── Número e robô ───────────────────────────────────────────────────────────
function AbaNumero({ estado, onMudou }: { estado: EstadoMkt | null; onMudou: () => void }) {
  const [horas, setHoras] = useState(estado?.robo.pausa_manual_horas ?? 12);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setHoras(estado?.robo.pausa_manual_horas ?? 12); }, [estado]);
  if (!estado) return <Carregando />;

  async function guardarRobo(patch: Partial<EstadoMkt["robo"]>) {
    setOcupado(true);
    try { await salvarConfig("robo", { ...estado!.robo, ...patch }); notifySuccess("Salvo."); onMudou(); }
    catch (e) { notifyError(erroMsg(e, "Não consegui salvar.")); }
    finally { setOcupado(false); }
  }

  async function conectar() {
    setOcupado(true);
    try {
      const p = await carregarPainelMeta();
      if (!p.cadastro.appId || !p.cadastro.configId) { notifyError("O cadastro da Meta (App ID e configuração) não está pronto — veja Configurações › WhatsApp oficial."); return; }
      if (!window.confirm("Vai abrir a janela da Meta para conectar o número NOVO do Marketing (setor Marketing). Não escolha o número do Comercial nem o do Relacionamento. Continuar?")) return;
      const r = await conectarPelaMeta({ appId: p.cadastro.appId, configId: p.cadastro.configId, userId: null, setor: "marketing" });
      notifySuccess(`Conectado${r.numero ? `: ${r.numero}` : ""}.`);
      r.avisos.forEach((a) => notifyError(a));
      onMudou();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não consegui conectar."); }
    finally { setOcupado(false); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <section className="mkt-card p-4 space-y-2">
        <h2 className="font-bold text-[14px]" style={{ color: "var(--ink)" }}>Número do Marketing</h2>
        {estado.numero?.conectado
          ? <Aviso tom="ok">Conectado: <b>{estado.numero.numero}</b>{estado.numero.nome ? ` · ${estado.numero.nome}` : ""}. Só o que chega NESTE número passa pelas automações — Comercial e Relacionamento seguem como antes.</Aviso>
          : <Aviso tom="alerta">Nenhum número com setor Marketing. Conectar exige perfil admin ou gestor (é o mesmo cadastro da Meta do Comercial, só que marcado como Marketing).</Aviso>}
        <Botao onClick={() => void conectar()} disabled={ocupado}>{estado.numero?.conectado ? "Reconectar pela Meta" : "Conectar pela Meta"}</Botao>
      </section>
      <section className="mkt-card p-4 space-y-3">
        <h2 className="font-bold text-[14px]" style={{ color: "var(--ink)" }}>Robô</h2>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={estado.robo.ligado} disabled={ocupado} onChange={(e) => void guardarRobo({ ligado: e.target.checked })} />
          Robô ligado (desligado: as mensagens chegam nas Conversas, mas nenhum fluxo começa ou continua)
        </label>
        <Campo rotulo="Quando alguém do time responde à mão, o robô fica quieto por (horas)">
          <div className="flex gap-2">
            <Entrada type="number" min={1} max={168} className="!w-28" value={horas} onChange={(e) => setHoras(Math.max(1, Math.min(168, Number(e.target.value) || 12)))} />
            <Botao onClick={() => void guardarRobo({ pausa_manual_horas: horas })} disabled={ocupado || horas === estado.robo.pausa_manual_horas}>Salvar</Botao>
          </div>
        </Campo>
        <Aviso>“PARAR” (e os outros pedidos de saída que o Comercial já reconhece) descadastra a pessoa do WhatsApp do Marketing na hora — nenhum fluxo manda mais nada para ela.</Aviso>
      </section>
    </div>
  );
}
