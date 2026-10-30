// src/mkt/automacoes/AutomacoesPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › WHATSAPP › AUTOMAÇÕES — "igual ManyChat" (Bruno, 30/10/2026:
// "visual e simples para configurar as coisas").
//
//   1. Respostas básicas: Boas-vindas e Resposta padrão num formulário simples
//      (texto + botão de link), sem abrir o editor.
//   2. Suas automações: um CARTÃO por gatilho, com liga/desliga, a regra em
//      linguagem simples ("Quando alguém mandar “JAPÃO” → responde com…") e
//      quantas vezes disparou. O editor de fluxo fica no "Editar fluxo".
//   3. Comece por um modelo: automações prontas de agência de viagens
//      (src/mkt/automacoes/modelos.ts) que já criam o fluxo preenchido.
//   Número, robô e campos personalizados ficam no botão "Configurações".
//
// Os gatilhos moram TODOS em mkt_fluxo_gatilhos; quem escolhe qual vence é o
// servidor (api/_mktAutoRegras.js escolherGatilho: link > anúncio > palavra >
// boas-vindas > padrão; dentro do tipo, maior prioridade). PARAR é do servidor.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { carregarPainelMeta, conectarPelaMeta } from "@/lib/qs/metaConexao";
import {
  ROTULO_GATILHO, grafoInicial, linkDeReferencia, validarGrafo,
  type CampoPersonalizado, type Fluxo, type Gatilho, type GatilhoConfig, type Grafo, type TipoGatilho,
} from "./tipos";
import {
  apagarCampo, apagarFluxo, apagarGatilho, carregarEstado, criarCampo, criarFluxo, criarGatilho, duplicarFluxo,
  listarCampos, listarFluxos, listarGatilhos, listarUsuarios, mudarGatilho, novoToken, salvarConfig, salvarFluxo, type EstadoMkt,
} from "./api";
import { AreaTexto, Aviso, Botao, COR, COR_SUAVE, COR_TEXTO, Campo, Carregando, Chip, Entrada, MKT_CSS, Modal, Selecao } from "./ui";
import EditorFluxo from "./EditorFluxo";
import {
  MODELOS_AUTOMACAO, faltandoNoModelo, fraseDaResposta, fraseDoGatilho, grafoDeRespostaSimples, lerRespostaSimples, montarModelo, paramsPadrao,
  type IdModelo, type ModeloAutomacao, type ParamsModelo, type RespostaSimples,
} from "./modelos";
import PreviaWhatsApp, { type BalaoPrevia } from "../disparos/PreviaWhatsApp";

const erroMsg = (e: unknown, padrao: string) => {
  const m = e instanceof Error ? e.message : "";
  if (/relation .*mkt_|does not exist|schema cache/i.test(m)) return "As tabelas das automações ainda não existem no banco (migration 0244 não aplicada).";
  return m || padrao;
};

const BASICAS: TipoGatilho[] = ["boas_vindas", "padrao"];
/** Gatilhos que dá pra criar "do zero" aqui. Webhook/LP fica de fora: seria primeiro contato automático com lead. */
const DO_ZERO: TipoGatilho[] = ["palavra_chave", "link_ref", "anuncio", "tag_adicionada"];

/** Liga uma automação: o fluxo precisa estar sem erro grave. */
async function ligarAutomacao(fluxo: Fluxo, gatilho: Gatilho | null) {
  const graves = validarGrafo(fluxo.grafo).filter((p) => p.grave);
  if (graves.length) throw new Error(`Antes de ligar, arrume no “Editar fluxo”: ${graves[0].mensagem}`);
  if (fluxo.status !== "ativo") await salvarFluxo(fluxo.id, { status: "ativo" });
  if (gatilho && !gatilho.ativo) await mudarGatilho(gatilho.id, { ativo: true });
}

export default function AutomacoesPage() {
  const [editando, setEditando] = useState<string | null>(null);
  const [fluxos, setFluxos] = useState<Fluxo[] | null>(null);
  const [gatilhos, setGatilhos] = useState<Gatilho[] | null>(null);
  const [estado, setEstado] = useState<EstadoMkt | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modelo, setModelo] = useState<IdModelo | null>(null);
  const [basica, setBasica] = useState<TipoGatilho | null>(null);
  const [formGatilho, setFormGatilho] = useState<FormGatilho | null>(null);
  const [config, setConfig] = useState(false);
  const [galeria, setGaleria] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      const [f, g] = await Promise.all([listarFluxos(), listarGatilhos()]);
      setFluxos(f); setGatilhos(g); setErro(null);
    } catch (e) { setErro(erroMsg(e, "Não consegui carregar as automações.")); setFluxos([]); setGatilhos([]); }
  }, []);
  const recarregarEstado = useCallback(() => { carregarEstado().then(setEstado).catch(() => setEstado(null)); }, []);
  useEffect(() => { void recarregar(); recarregarEstado(); }, [recarregar, recarregarEstado]);
  const voltar = useCallback(() => { setEditando(null); void recarregar(); }, [recarregar]);

  const porFluxo = useMemo(() => new Map((fluxos ?? []).map((f) => [f.id, f])), [fluxos]);
  const cartoes = (gatilhos ?? []).filter((g) => !BASICAS.includes(g.tipo));
  const comGatilho = new Set((gatilhos ?? []).map((g) => g.fluxo_id));
  const soltos = (fluxos ?? []).filter((f) => !comGatilho.has(f.id));

  if (editando) {
    return (
      <div className="mkt-raiz">
        <style>{MKT_CSS}</style>
        <EditorFluxo fluxoId={editando} onVoltar={voltar} />
      </div>
    );
  }

  const carregando = fluxos === null || gatilhos === null;
  const abrirModelo = (id: IdModelo) => {
    setGaleria(false);
    if (id === "boas_vindas" || id === "resposta_padrao") { setBasica(id === "boas_vindas" ? "boas_vindas" : "padrao"); return; }
    setModelo(id);
  };

  return (
    <div className="mkt-raiz flex flex-col gap-5">
      <style>{MKT_CSS}</style>
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <BarraSituacao estado={estado} onConfig={() => setConfig(true)} onMudou={recarregarEstado} />

      {carregando ? <Carregando /> : (
        <>
          <Secao titulo="Respostas básicas" texto="O que o número responde sozinho, sem palavra-chave nenhuma.">
            <div className="grid gap-3 md:grid-cols-2">
              {(["boas_vindas", "padrao"] as const).map((t) => {
                const g = (gatilhos ?? []).find((x) => x.tipo === t) ?? null;
                return <CartaoBasica key={t} tipo={t} gatilho={g} fluxo={g ? porFluxo.get(g.fluxo_id) ?? null : null}
                  onEditar={() => setBasica(t)} onEditarFluxo={(id) => setEditando(id)} onMudou={recarregar} />;
              })}
            </div>
          </Secao>

          <Secao titulo="Suas automações" texto="Cada cartão é uma regra: quando acontece X, o robô faz Y."
            acao={<Botao variante="primario" onClick={() => setGaleria(true)}>+ Nova automação</Botao>}>
            {!cartoes.length && !soltos.length ? (
              <div className="mkt-card p-5 text-center">
                <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Nenhuma automação ainda</p>
                <p className="mt-1 text-[13px]" style={{ color: "var(--ink3)" }}>Comece por um modelo aqui embaixo: em 1 minuto a palavra da live já responde com o roteiro.</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {cartoes.map((g) => (
                  <CartaoAutomacao key={g.id} gatilho={g} fluxo={porFluxo.get(g.fluxo_id) ?? null} estado={estado}
                    onEditarFluxo={(id) => setEditando(id)} onEditarGatilho={() => setFormGatilho(formDe(g))} onMudou={recarregar} />
                ))}
                {soltos.map((f) => (
                  <CartaoAutomacao key={f.id} gatilho={null} fluxo={f} estado={estado}
                    onEditarFluxo={(id) => setEditando(id)} onEditarGatilho={() => setFormGatilho(formNovo("palavra_chave", f.id))} onMudou={recarregar} />
                ))}
              </div>
            )}
          </Secao>

          <Secao titulo="Comece por um modelo" texto="Automações prontas de agência de viagens. Escolha, ajuste o texto e ligue.">
            <GaleriaModelos onEscolher={abrirModelo} onDoZero={() => setFormGatilho(formNovo("palavra_chave", NOVO))} />
          </Secao>
        </>
      )}

      {galeria && (
        <Modal aberto titulo="Nova automação" onFechar={() => setGaleria(false)} largura={860}>
          <p className="mb-3 text-[13px]" style={{ color: "var(--ink3)" }}>Comece por um modelo pronto (recomendado) ou do zero.</p>
          <GaleriaModelos onEscolher={abrirModelo} onDoZero={() => { setGaleria(false); setFormGatilho(formNovo("palavra_chave", NOVO)); }} />
        </Modal>
      )}
      {modelo && (
        <ModalModelo id={modelo} onFechar={() => setModelo(null)}
          onCriado={(fluxoId, abrirEditor) => { setModelo(null); void recarregar(); if (abrirEditor) setEditando(fluxoId); }} />
      )}
      {basica && (
        <ModalBasica tipo={basica} gatilho={(gatilhos ?? []).find((x) => x.tipo === basica) ?? null}
          fluxo={(() => { const g = (gatilhos ?? []).find((x) => x.tipo === basica); return g ? porFluxo.get(g.fluxo_id) ?? null : null; })()}
          onFechar={() => setBasica(null)} onSalvo={() => { setBasica(null); void recarregar(); }} />
      )}
      {formGatilho && (
        <ModalGatilho form={formGatilho} setForm={setFormGatilho} fluxos={fluxos ?? []} estado={estado}
          onSalvo={(fluxoNovo) => { setFormGatilho(null); void recarregar(); if (fluxoNovo) setEditando(fluxoNovo); }} />
      )}
      {config && (
        <Modal aberto titulo="Configurações das automações" onFechar={() => setConfig(false)} largura={760}>
          <div className="space-y-5">
            <AbaNumero estado={estado} onMudou={recarregarEstado} />
            <div>
              <h2 className="mb-2 text-[14px] font-bold" style={{ color: "var(--ink)" }}>Campos personalizados</h2>
              <AbaCampos />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Peças da página ─────────────────────────────────────────────────────────

function Secao({ titulo, texto, acao, children }: { titulo: string; texto?: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h2>
          {texto && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{texto}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Liga/desliga no jeito ManyChat (role="switch"). */
export function Interruptor({ ligado, onMudar, rotulo, desabilitado }: { ligado: boolean; onMudar: (v: boolean) => void; rotulo: string; desabilitado?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} title={rotulo} disabled={desabilitado}
      onClick={() => onMudar(!ligado)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{ background: ligado ? COR : "var(--line)" }}>
      <span aria-hidden className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: `translateX(${ligado ? 22 : 2}px)` }} />
    </button>
  );
}

function BarraSituacao({ estado, onConfig, onMudou }: { estado: EstadoMkt | null; onConfig: () => void; onMudou: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  if (!estado) return null;
  const conectado = !!estado.numero?.conectado;
  async function robo(ligado: boolean) {
    setOcupado(true);
    try { await salvarConfig("robo", { ...estado!.robo, ligado }); notifySuccess(ligado ? "Robô ligado." : "Robô desligado: as mensagens chegam nas Conversas, mas nenhum fluxo começa."); onMudou(); }
    catch (e) { notifyError(erroMsg(e, "Não consegui salvar.")); }
    finally { setOcupado(false); }
  }
  return (
    <div className="flex flex-col gap-3">
      {!conectado && (
        <div className="mkt-card p-4" style={{ borderColor: "var(--warn-line, #FCD34D)" }}>
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Falta um passo pra funcionar de verdade</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[13px]" style={{ color: "var(--ink2)" }}>
            <li>Conectar o número do Marketing na Meta (setor <b>Marketing</b> — nunca o número do Comercial nem o do Relacionamento).</li>
            <li>Ligar o robô.</li>
          </ol>
          <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink3)" }}>Enquanto isso dá pra montar as automações e testar no “Editar fluxo” → Simular. Nada sai nem chega.</p>
          <div className="mt-2"><Botao variante="primario" onClick={onConfig}>Conectar o número</Botao></div>
        </div>
      )}
      <div className="mkt-card flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full" aria-hidden style={{ background: conectado ? "#059669" : "#9CA3AF" }} />
        <span className="text-[13px]" style={{ color: "var(--ink)" }}>
          {conectado ? <>Número do Marketing <b>{estado.numero?.numero}</b></> : "Sem número do Marketing"}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          Robô {estado.robo.ligado ? "ligado" : "desligado"}
          <Interruptor ligado={estado.robo.ligado} onMudar={(v) => void robo(v)} rotulo="Ligar ou desligar o robô" desabilitado={ocupado} />
        </label>
        <Botao variante="fantasma" onClick={onConfig}>Configurações</Botao>
      </div>
    </div>
  );
}

function CartaoBasica({ tipo, gatilho, fluxo, onEditar, onEditarFluxo, onMudou }: {
  tipo: "boas_vindas" | "padrao"; gatilho: Gatilho | null; fluxo: Fluxo | null;
  onEditar: () => void; onEditarFluxo: (id: string) => void; onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const ligado = !!gatilho?.ativo && fluxo?.status === "ativo";
  const simples = lerRespostaSimples(fluxo?.grafo);
  const titulo = tipo === "boas_vindas" ? "Boas-vindas" : "Resposta padrão";
  const explica = tipo === "boas_vindas" ? "Quem escreve pela primeira vez recebe:" : "Quando nada mais combinar, responde:";
  async function mudar(v: boolean) {
    if (!gatilho || !fluxo) { onEditar(); return; }
    setOcupado(true);
    try { if (v) await ligarAutomacao(fluxo, gatilho); else await mudarGatilho(gatilho.id, { ativo: false }); onMudou(); }
    catch (e) { notifyError(erroMsg(e, "Falhou.")); }
    finally { setOcupado(false); }
  }
  return (
    <article className="mkt-card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <IconeModelo id={tipo === "boas_vindas" ? "boas_vindas" : "resposta_padrao"} />
        <h3 className="flex-1 text-[14px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h3>
        <Interruptor ligado={ligado} onMudar={(v) => void mudar(v)} rotulo={`${ligado ? "Desligar" : "Ligar"} ${titulo}`} desabilitado={ocupado} />
      </div>
      <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{explica}</p>
      {gatilho && fluxo ? (
        <p className="line-clamp-3 rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--card2)", color: "var(--ink)" }}>
          {simples ? simples.texto : fraseDaResposta(fluxo.grafo).replace(/^responde com /, "")}
        </p>
      ) : (
        <p className="rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--card2)", color: "var(--ink3)" }}>Ainda não configurada.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {simples || !fluxo ? <Botao onClick={onEditar}>{gatilho ? "Editar texto" : "Configurar"}</Botao> : <Botao onClick={() => onEditarFluxo(fluxo.id)}>Editar fluxo</Botao>}
        {simples && fluxo && <Botao variante="fantasma" onClick={() => onEditarFluxo(fluxo.id)}>Editar fluxo (avançado)</Botao>}
        <span className="flex-1" />
        {gatilho && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{gatilho.disparos ?? 0} disparos</span>}
      </div>
    </article>
  );
}

function CartaoAutomacao({ gatilho, fluxo, estado, onEditarFluxo, onEditarGatilho, onMudou }: {
  gatilho: Gatilho | null; fluxo: Fluxo | null; estado: EstadoMkt | null;
  onEditarFluxo: (id: string) => void; onEditarGatilho: () => void; onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const ligado = !!fluxo && fluxo.status === "ativo" && (gatilho ? gatilho.ativo : true);
  const quandoTxt = gatilho ? fraseDoGatilho(gatilho.tipo, gatilho.config) : "Sem gatilho: só começa pela Conversa (“Iniciar fluxo”) ou por outro fluxo";
  const entao = fluxo ? fraseDaResposta(fluxo.grafo) : "o fluxo foi apagado";
  const link = gatilho?.tipo === "link_ref" && estado?.numero?.numero ? linkDeReferencia(estado.numero.numero, gatilho.config.codigo ?? "", gatilho.config.texto) : null;
  const webhook = gatilho?.tipo === "webhook" && estado?.lpBase && gatilho.config.token ? `${estado.lpBase}${gatilho.config.token}` : null;

  async function mudar(v: boolean) {
    if (!fluxo) return;
    setOcupado(true);
    try {
      if (v) await ligarAutomacao(fluxo, gatilho);
      else if (gatilho) await mudarGatilho(gatilho.id, { ativo: false });
      else await salvarFluxo(fluxo.id, { status: "pausado" });
      onMudou();
    } catch (e) { notifyError(erroMsg(e, "Falhou.")); }
    finally { setOcupado(false); }
  }
  const copiar = (t: string) => { void navigator.clipboard?.writeText(t).then(() => notifySuccess("Copiado.")); };

  return (
    <article className="mkt-card flex flex-col gap-2.5 p-4" style={{ opacity: ligado ? 1 : 0.92 }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-bold" style={{ color: "var(--ink)" }}>{fluxo?.nome ?? "(fluxo apagado)"}</h3>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {gatilho && <Chip>{ROTULO_GATILHO[gatilho.tipo]}</Chip>}
            {fluxo?.status === "rascunho" && <Chip cor="#6B7280">rascunho</Chip>}
          </div>
        </div>
        <Interruptor ligado={ligado} onMudar={(v) => void mudar(v)} rotulo={ligado ? "Desligar automação" : "Ligar automação"} desabilitado={ocupado || !fluxo} />
      </div>
      <div className="rounded-lg px-3 py-2 text-[13px] leading-snug" style={{ background: "var(--card2)", color: "var(--ink)" }}>
        <span className="font-semibold">{quandoTxt}</span>
        <span aria-hidden style={{ color: COR_TEXTO }}> → </span>
        <span className="sr-only">, então </span>
        <span style={{ color: "var(--ink2)" }}>{entao}</span>
      </div>
      {link && (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>{link}</code>
          <Botao variante="fantasma" onClick={() => copiar(link)}>Copiar link</Botao>
        </div>
      )}
      {webhook && (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>{webhook}</code>
          <Botao variante="fantasma" onClick={() => copiar(webhook)}>Copiar</Botao>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {fluxo && <Botao onClick={() => onEditarFluxo(fluxo.id)}>Editar fluxo</Botao>}
        <Botao variante="fantasma" onClick={onEditarGatilho}>{gatilho ? "Mudar gatilho" : "+ Gatilho"}</Botao>
        <span className="flex-1" />
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
          {gatilho ? `${gatilho.disparos ?? 0} disparos` : `${fluxo?.execucoes_total ?? 0} iniciados`}
        </span>
        <MenuMais itens={[
          ...(fluxo ? [{ rotulo: "Duplicar", acao: () => void duplicarFluxo(fluxo).then(() => { notifySuccess("Duplicado (como rascunho)."); onMudou(); }).catch((e) => notifyError(erroMsg(e, "Falhou."))) }] : []),
          ...(gatilho ? [{ rotulo: "Apagar só o gatilho", acao: () => { if (window.confirm("Apagar este gatilho? O fluxo continua.")) void apagarGatilho(gatilho.id).then(onMudou).catch((e) => notifyError(erroMsg(e, "Falhou."))); } }] : []),
          ...(fluxo ? [{ rotulo: "Apagar automação", perigo: true, acao: () => {
            if (!window.confirm(`Apagar “${fluxo.nome}”? Os gatilhos dele também somem; quem estiver no meio para.`)) return;
            void apagarFluxo(fluxo.id).then(onMudou).catch((e) => notifyError(erroMsg(e, "Não consegui apagar.")));
          } }] : []),
        ]} />
      </div>
    </article>
  );
}

function MenuMais({ itens }: { itens: { rotulo: string; acao: () => void; perigo?: boolean }[] }) {
  const [aberto, setAberto] = useState(false);
  if (!itens.length) return null;
  return (
    <div className="relative">
      <button type="button" aria-label="Mais ações" aria-expanded={aberto} onClick={() => setAberto(!aberto)}
        className="rounded-md px-2 py-1 text-[16px] leading-none" style={{ color: "var(--ink3)" }}>⋯</button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div role="menu" className="mkt-card absolute right-0 z-20 mt-1 min-w-[180px] py-1 shadow-lg">
            {itens.map((i) => (
              <button key={i.rotulo} type="button" role="menuitem" onClick={() => { setAberto(false); i.acao(); }}
                className="block w-full px-3 py-1.5 text-left text-[13px]" style={{ color: i.perigo ? "var(--err-ink, #B91C1C)" : "var(--ink)" }}>{i.rotulo}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Galeria de modelos ──────────────────────────────────────────────────────

const ICONE_PATH: Record<IdModelo | "zero", ReactNode> = {
  boas_vindas: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>,
  resposta_padrao: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  palavra_expedicao: <><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></>,
  anuncio: <><path d="M3 11l18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
  link_bio: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  pedido_humano: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  parar: <><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" /><line x1="8" y1="12" x2="16" y2="12" /></>,
  zero: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
};

function IconeModelo({ id }: { id: IdModelo | "zero" }) {
  return (
    <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: COR_SUAVE, color: COR_TEXTO }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONE_PATH[id]}</svg>
    </span>
  );
}

function GaleriaModelos({ onEscolher, onDoZero }: { onEscolher: (id: IdModelo) => void; onDoZero: () => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {MODELOS_AUTOMACAO.map((m) => {
        const info = m.gatilho === null;
        return (
          <button key={m.id} type="button" disabled={info} onClick={() => onEscolher(m.id)}
            className="mkt-card flex flex-col gap-2 p-4 text-left transition-shadow enabled:hover:shadow-md disabled:cursor-default">
            <div className="flex items-center gap-2">
              <IconeModelo id={m.id} />
              <span className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{m.titulo}</span>
            </div>
            <span className="text-[12.5px] leading-snug" style={{ color: "var(--ink3)" }}>{m.descricao}</span>
            <span className="mt-auto text-[12.5px] font-semibold" style={{ color: info ? "#047857" : COR_TEXTO }}>{info ? "Já está ligado" : "Usar modelo →"}</span>
          </button>
        );
      })}
      <button type="button" onClick={onDoZero} className="mkt-card flex flex-col gap-2 border-dashed p-4 text-left transition-shadow hover:shadow-md">
        <div className="flex items-center gap-2"><IconeModelo id="zero" /><span className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Do zero</span></div>
        <span className="text-[12.5px] leading-snug" style={{ color: "var(--ink3)" }}>Escolha o gatilho (palavra, link, anúncio ou tag) e desenhe o fluxo no editor.</span>
        <span className="mt-auto text-[12.5px] font-semibold" style={{ color: COR_TEXTO }}>Começar em branco →</span>
      </button>
    </div>
  );
}

/** Os balões da prévia a partir de um grafo (primeira resposta + botão de link). */
function baloesDoGrafo(g: Grafo, gatilho?: string): BalaoPrevia[] {
  const out: BalaoPrevia[] = [];
  if (gatilho) out.push({ texto: gatilho, daPessoa: true });
  for (const n of g.nos) {
    if (n.tipo !== "mensagem") continue;
    const t = n.dados.blocos.find((b) => b.tipo === "texto");
    const it = n.dados.interacao;
    out.push({
      texto: t && t.tipo === "texto" ? t.texto : "",
      botoes: it.tipo === "link" ? [it.rotulo] : it.tipo === "botoes" ? it.botoes.map((b) => b.titulo) : undefined,
    });
  }
  return out;
}

function exemploDoGatilho(m: ModeloAutomacao, p: ParamsModelo): string | undefined {
  const lista = Array.isArray(p.palavras) ? p.palavras : String(p.palavras ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (m.gatilho === "palavra_chave") return lista[0] ? lista[0].toUpperCase() : undefined;
  if (m.gatilho === "link_ref") return String(p.texto_link || "Olá!");
  if (m.gatilho === "anuncio") return "Olá! Tenho interesse e queria mais informações.";
  return "Oi!";
}

function ModalModelo({ id, onFechar, onCriado }: { id: IdModelo; onFechar: () => void; onCriado: (fluxoId: string, abrirEditor: boolean) => void }) {
  const m = MODELOS_AUTOMACAO.find((x) => x.id === id)!;
  const [p, setP] = useState<ParamsModelo>(() => paramsPadrao(id));
  const [ligar, setLigar] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [usuarios, setUsuarios] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (m.campos.some((c) => c.tipo === "usuarios")) listarUsuarios().then(setUsuarios).catch(() => setUsuarios([])); }, [m]);
  const falta = faltandoNoModelo(id, p);
  const montado = montarModelo(id, p);
  const previa = "erro" in montado ? [] : baloesDoGrafo(montado.grafo, exemploDoGatilho(m, p));

  async function criar(abrirEditor: boolean) {
    if ("erro" in montado) { notifyError(montado.erro); return; }
    setSalvando(true);
    try {
      const f = await criarFluxo(montado.nome, montado.grafo);
      await criarGatilho({ fluxo_id: f.id, tipo: montado.gatilho.tipo, config: montado.gatilho.config, prioridade: montado.gatilho.prioridade });
      if (ligar) await salvarFluxo(f.id, { status: "ativo" });
      notifySuccess(ligar ? "Automação criada e ligada." : "Automação criada (desligada).");
      onCriado(f.id, abrirEditor);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      notifyError(/duplicate|unique/i.test(msg) ? "Esse código de link já existe em outra automação." : erroMsg(e, "Não consegui criar."));
    } finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={`Modelo: ${m.titulo}`} onFechar={onFechar} largura={920}
      rodape={<>
        <label className="mr-auto flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <Interruptor ligado={ligar} onMudar={setLigar} rotulo="Ligar ao criar" /> Ligar ao criar
        </label>
        <Botao onClick={() => void criar(true)} disabled={salvando || falta.length > 0}>Criar e editar fluxo</Botao>
        <Botao variante="primario" onClick={() => void criar(false)} disabled={salvando || falta.length > 0}>{salvando ? "Criando…" : "Criar automação"}</Botao>
      </>}>
      <div className="grid gap-5 md:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{m.descricao}</p>
          {m.campos.map((c) => <CampoDoModelo key={c.chave} c={c} valor={p[c.chave]} usuarios={usuarios} onMudar={(v) => setP({ ...p, [c.chave]: v })} />)}
          {falta.length > 0 && <Aviso tom="alerta">Falta: {falta.join(", ")}.</Aviso>}
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Use <code>{"{{primeiro_nome}}"}</code> pra pôr o nome da pessoa. Quem mandou PARAR nunca recebe.</p>
        </div>
        <PreviaWhatsApp baloes={previa} />
      </div>
    </Modal>
  );
}

function CampoDoModelo({ c, valor, usuarios, onMudar }: { c: ModeloAutomacao["campos"][number]; valor: string | string[] | undefined; usuarios: { id: string; name: string }[]; onMudar: (v: string | string[]) => void }) {
  const rotulo = c.obrigatorio ? `${c.rotulo} *` : c.rotulo;
  if (c.tipo === "usuarios") {
    const sel = Array.isArray(valor) ? valor : [];
    return (
      <Campo rotulo={rotulo} dica="Recebem o aviso no sininho do QS com o link da conversa.">
        <div className="flex flex-wrap gap-1.5">
          {!usuarios.length && <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Carregando o time…</span>}
          {usuarios.map((u) => {
            const on = sel.includes(u.id);
            return (
              <button key={u.id} type="button" aria-pressed={on} onClick={() => onMudar(on ? sel.filter((x) => x !== u.id) : [...sel, u.id])}
                className="rounded-full border px-2.5 py-1 text-[12.5px]"
                style={on ? { background: COR_SUAVE, color: COR_TEXTO, borderColor: COR } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{u.name}</button>
            );
          })}
        </div>
      </Campo>
    );
  }
  if (c.tipo === "texto_longo") return <Campo rotulo={rotulo} dica={c.dica}><AreaTexto rows={4} value={String(valor ?? "")} onChange={(e) => onMudar(e.target.value)} /></Campo>;
  if (c.tipo === "palavras") {
    return <Campo rotulo={rotulo} dica={c.dica}><Entrada value={Array.isArray(valor) ? valor.join(", ") : String(valor ?? "")} onChange={(e) => onMudar(e.target.value.split(",").map((s) => s.trimStart()))} /></Campo>;
  }
  return <Campo rotulo={rotulo} dica={c.dica}><Entrada type={c.tipo === "link" ? "url" : "text"} value={String(valor ?? "")} onChange={(e) => onMudar(e.target.value)} placeholder={c.tipo === "link" ? "https://…" : undefined} /></Campo>;
}

// ── Respostas básicas (formulário simples) ─────────────────────────────────

function ModalBasica({ tipo, gatilho, fluxo, onFechar, onSalvo }: { tipo: TipoGatilho; gatilho: Gatilho | null; fluxo: Fluxo | null; onFechar: () => void; onSalvo: () => void }) {
  const modeloId: IdModelo = tipo === "boas_vindas" ? "boas_vindas" : "resposta_padrao";
  const atual = lerRespostaSimples(fluxo?.grafo);
  const padrao = paramsPadrao(modeloId);
  const [texto, setTexto] = useState(atual?.texto ?? String(padrao.texto ?? ""));
  const [rotulo, setRotulo] = useState(atual ? atual.link?.rotulo ?? "" : String(padrao.link_rotulo ?? ""));
  const [url, setUrl] = useState(atual ? atual.link?.url ?? "" : String(padrao.link_url ?? ""));
  const [horas, setHoras] = useState(Number(gatilho?.config.intervalo_horas ?? 24));
  const [salvando, setSalvando] = useState(false);
  const titulo = tipo === "boas_vindas" ? "Boas-vindas" : "Resposta padrão";
  const linkOk = !rotulo.trim() || (/^https?:\/\//i.test(url.trim()) && rotulo.trim().length <= 20);
  const resposta: RespostaSimples = { texto, link: rotulo.trim() && url.trim() ? { rotulo: rotulo.trim(), url: url.trim() } : null };

  async function salvar() {
    setSalvando(true);
    try {
      const grafo = grafoDeRespostaSimples(resposta);
      const config: GatilhoConfig = tipo === "padrao" ? { intervalo_horas: Math.max(1, Math.min(720, Math.round(horas) || 24)) } : {};
      if (gatilho && fluxo) {
        await salvarFluxo(fluxo.id, { grafo, status: "ativo" });
        await mudarGatilho(gatilho.id, { config, ativo: true });
      } else {
        const f = await criarFluxo(titulo, grafo);
        await criarGatilho({ fluxo_id: f.id, tipo, config, prioridade: 0 });
        await salvarFluxo(f.id, { status: "ativo" });
      }
      notifySuccess(`${titulo} salva e ligada.`);
      onSalvo();
    } catch (e) { notifyError(erroMsg(e, "Não consegui salvar.")); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={titulo} onFechar={onFechar} largura={860}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()} disabled={salvando || !texto.trim() || !linkOk}>{salvando ? "Salvando…" : "Salvar e ligar"}</Botao></>}>
      <div className="grid gap-5 md:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            {tipo === "boas_vindas" ? "Vai para quem manda a PRIMEIRA mensagem para o número do Marketing." : "Vai quando nenhuma palavra-chave, link ou anúncio combinou."}
          </p>
          <Campo rotulo="Mensagem" dica="Use {{primeiro_nome}} pra pôr o nome."><AreaTexto rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Botão de link (opcional)" dica="Até 20 letras."><Entrada value={rotulo} maxLength={20} onChange={(e) => setRotulo(e.target.value)} placeholder="Ver expedições" /></Campo>
            <Campo rotulo="Endereço"><Entrada type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Campo>
          </div>
          {tipo === "padrao" && (
            <Campo rotulo="Responder a mesma pessoa no máximo uma vez a cada (horas)">
              <Entrada type="number" min={1} max={720} className="!w-28" value={horas} onChange={(e) => setHoras(Number(e.target.value) || 24)} />
            </Campo>
          )}
          {!linkOk && <Aviso tom="alerta">O botão de link precisa de um endereço que comece com https://.</Aviso>}
          {gatilho && fluxo && !atual && <Aviso tom="alerta">Este fluxo foi mudado no editor avançado. Salvar aqui troca tudo por esta mensagem simples.</Aviso>}
        </div>
        <PreviaWhatsApp baloes={[{ texto: tipo === "boas_vindas" ? "Oi!" : "Vocês fazem viagem pra Grécia?", daPessoa: true }, { texto, botoes: resposta.link ? [resposta.link.rotulo] : undefined }]} />
      </div>
    </Modal>
  );
}

// ── Gatilho (editar / do zero) ──────────────────────────────────────────────

const NOVO = "__novo__";
interface FormGatilho { id?: string; tipo: TipoGatilho; fluxo_id: string; nomeNovo: string; prioridade: number; config: GatilhoConfig }

function configInicial(tipo: TipoGatilho): GatilhoConfig {
  return tipo === "palavra_chave" ? { palavras: [], modo: "contem" } : tipo === "padrao" ? { intervalo_horas: 24 }
    : tipo === "link_ref" ? { codigo: Math.random().toString(36).slice(2, 8), texto: "Olá! Quero saber mais" } : tipo === "anuncio" ? { ad_ids: [] }
    : tipo === "webhook" ? { token: novoToken() } : tipo === "tag_adicionada" ? { tag: "" } : {};
}
const formNovo = (tipo: TipoGatilho, fluxo_id: string): FormGatilho => ({ tipo, fluxo_id, nomeNovo: "", prioridade: 0, config: configInicial(tipo) });
const formDe = (g: Gatilho): FormGatilho => ({ id: g.id, tipo: g.tipo, fluxo_id: g.fluxo_id, nomeNovo: "", prioridade: g.prioridade ?? 0, config: { ...g.config } });

function ModalGatilho({ form, setForm, fluxos, estado, onSalvo }: {
  form: FormGatilho; setForm: (f: FormGatilho | null) => void; fluxos: Fluxo[]; estado: EstadoMkt | null; onSalvo: (fluxoNovo: string | null) => void;
}) {
  const c = form.config;
  const setC = (patch: GatilhoConfig) => setForm({ ...form, config: { ...form.config, ...patch } });
  const novo = form.fluxo_id === NOVO;
  const tiposPossiveis = form.id ? [form.tipo] : DO_ZERO;

  async function salvar() {
    if (novo && form.nomeNovo.trim().length < 2) { notifyError("Dê um nome para a automação."); return; }
    if (!novo && !form.fluxo_id) { notifyError("Escolha o fluxo."); return; }
    if (form.tipo === "palavra_chave" && !(c.palavras ?? []).length) { notifyError("Escreva pelo menos uma palavra."); return; }
    if (form.tipo === "link_ref" && !/^[a-z0-9_-]{2,40}$/i.test(c.codigo ?? "")) { notifyError("Código: 2 a 40 letras, números, - ou _."); return; }
    if (form.tipo === "tag_adicionada" && !c.tag?.trim()) { notifyError("Escreva a tag."); return; }
    try {
      let fluxoId = form.fluxo_id;
      if (novo) fluxoId = (await criarFluxo(form.nomeNovo.trim(), grafoInicial())).id;
      if (form.id) await mudarGatilho(form.id, { fluxo_id: fluxoId, prioridade: form.prioridade, config: c });
      else await criarGatilho({ fluxo_id: fluxoId, tipo: form.tipo, prioridade: form.prioridade, config: c });
      onSalvo(novo ? fluxoId : null);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      notifyError(/duplicate|unique/i.test(m) ? "Esse código/token já existe em outro gatilho." : erroMsg(e, "Não consegui salvar."));
    }
  }

  return (
    <Modal aberto titulo={form.id ? `Gatilho: ${ROTULO_GATILHO[form.tipo]}` : novo ? "Automação do zero" : "Novo gatilho"} onFechar={() => setForm(null)} largura={620}
      rodape={<><Botao onClick={() => setForm(null)}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()}>{novo ? "Criar e abrir o editor" : "Salvar"}</Botao></>}>
      <div className="space-y-3">
        {!form.id && (
          <Campo rotulo="Quando começa">
            <div className="grid gap-2 sm:grid-cols-2">
              {tiposPossiveis.map((t) => (
                <button key={t} type="button" aria-pressed={form.tipo === t} onClick={() => setForm({ ...form, tipo: t, config: configInicial(t) })}
                  className="rounded-lg border px-3 py-2 text-left text-[13px] font-semibold"
                  style={form.tipo === t ? { background: COR_SUAVE, color: COR_TEXTO, borderColor: COR } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
                  {ROTULO_GATILHO[t]}
                </button>
              ))}
            </div>
          </Campo>
        )}
        {novo ? (
          <Campo rotulo="Nome da automação"><Entrada autoFocus value={form.nomeNovo} onChange={(e) => setForm({ ...form, nomeNovo: e.target.value })} placeholder="ex.: Live Japão — roteiro" /></Campo>
        ) : (
          <Campo rotulo="Começa o fluxo">
            <Selecao value={form.fluxo_id} onChange={(e) => setForm({ ...form, fluxo_id: e.target.value })}>
              {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.status !== "ativo" ? ` (${f.status})` : ""}</option>)}
            </Selecao>
          </Campo>
        )}
        {form.tipo === "palavra_chave" && (
          <>
            <Campo rotulo="Palavras" dica="Separe por vírgula. Ex.: japão, japao, roteiro japão. Acento e maiúscula não importam.">
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
              ? <Aviso tom="ok"><span className="break-all">{linkDeReferencia(estado.numero.numero, c.codigo ?? "", c.texto)}</span><br />Para QR Code: cole este link num gerador de QR.</Aviso>
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
            <Aviso tom="alerta">Gatilho antigo: a LP chama este endereço e o fluxo começa sozinho com a pessoa. O QS não cria gatilho novo assim — primeiro contato automático com lead não é feito.</Aviso>
          </>
        )}
        {(form.tipo === "palavra_chave" || form.tipo === "link_ref" || form.tipo === "anuncio") && (
          <Campo rotulo="Prioridade" dica="Maior ganha quando duas regras do mesmo tipo combinam.">
            <Entrada type="number" className="!w-28" value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: Number(e.target.value) || 0 })} />
          </Campo>
        )}
      </div>
    </Modal>
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
    <div>
      <p className="mb-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>Guardam o que a pessoa respondeu (bloco Pergunta) ou o que um fluxo definiu. Use no texto como <code>{"{{chave}}"}</code>.</p>
      <div className="mkt-card mb-3 grid items-end gap-2 p-3 sm:grid-cols-[1fr_1fr_140px_auto]">
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
        <div key={c.id} className="flex items-center gap-2 border-b py-2 text-[13px]" style={{ borderColor: "var(--line)" }}>
          <strong style={{ color: "var(--ink)" }}>{c.rotulo}</strong>
          <code className="text-[12px]" style={{ color: COR_TEXTO }}>{`{{${c.chave}}}`}</code>
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
    <div className="space-y-4">
      <section className="mkt-card space-y-2 p-4">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Número do Marketing</h2>
        {estado.numero?.conectado
          ? <Aviso tom="ok">Conectado: <b>{estado.numero.numero}</b>{estado.numero.nome ? ` · ${estado.numero.nome}` : ""}. Só o que chega NESTE número passa pelas automações — Comercial e Relacionamento seguem como antes.</Aviso>
          : <Aviso tom="alerta">Nenhum número com setor Marketing ainda. Conectar exige perfil admin ou gestor (é o mesmo cadastro da Meta do Comercial, só que marcado como Marketing).</Aviso>}
        <Botao onClick={() => void conectar()} disabled={ocupado}>{estado.numero?.conectado ? "Reconectar pela Meta" : "Conectar pela Meta"}</Botao>
      </section>
      <section className="mkt-card space-y-3 p-4">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Robô</h2>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <Interruptor ligado={estado.robo.ligado} onMudar={(v) => void guardarRobo({ ligado: v })} rotulo="Robô ligado" desabilitado={ocupado} />
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

