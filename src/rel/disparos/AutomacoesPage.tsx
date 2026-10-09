// src/rel/disparos/AutomacoesPage.tsx
// -----------------------------------------------------------------------------
// AUTOMAÇÕES do Relacionamento (Fase 4): mensagens que saem sozinhas, todo dia
// às 10h, nas datas que importam — aniversário, véspera do embarque, volta da
// viagem, 1 ano da viagem. Toda automação NASCE DESLIGADA: quem liga é o time,
// depois de olhar "quem receberia hoje".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  apagarAutomacao, envios, GATILHOS, ligarAutomacao, listarAutomacoes, rodarAutomacoesAgora, salvarAutomacao,
  testarAutomacao, type Automacao, type Envio, type Gatilho, type MapaVariaveis,
} from "../lib/disparos";
import { formatarTelefone } from "../lib/clientes";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import ModeloEVariaveis, { mapaCompleto, useModelos } from "./ModeloEVariaveis";

type Rascunho = { id?: string; nome: string; gatilho: Gatilho; dias: number; modelo_nome: string; modelo_idioma: string; params: MapaVariaveis };

// Sugestões prontas: preenchem o formulário; o modelo é a pessoa que escolhe.
const SUGESTOES: { rotulo: string; r: Omit<Rascunho, "modelo_nome" | "modelo_idioma"> }[] = [
  { rotulo: "Feliz aniversário", r: { nome: "Feliz aniversário", gatilho: "aniversario", dias: 0, params: { "1": { fonte: "nome" } } } },
  { rotulo: "Boa viagem", r: { nome: "Boa viagem", gatilho: "antes_embarque", dias: 1, params: { "1": { fonte: "nome" }, "2": { fonte: "destino" } } } },
  { rotulo: "Pesquisa pós-viagem", r: { nome: "Pesquisa pós-viagem", gatilho: "apos_retorno", dias: 2, params: { "1": { fonte: "nome" }, "2": { fonte: "link_pesquisa" } } } },
  { rotulo: "Saudade da viagem", r: { nome: "Saudade da viagem", gatilho: "aniversario_viagem", dias: 0, params: { "1": { fonte: "nome" }, "2": { fonte: "destino" } } } },
];

const vazio = (): Rascunho => ({ nome: "", gatilho: "antes_embarque", dias: 1, modelo_nome: "", modelo_idioma: "", params: {} });

function Editor({ inicial, onFechar, onSalvo }: { inicial: Rascunho | null; onFechar: () => void; onSalvo: () => void }) {
  const { modelos, erro: erroModelos } = useModelos();
  const [r, setR] = useState<Rascunho>(vazio());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (inicial) { setR(inicial); setErro(null); } }, [inicial]);

  const g = GATILHOS.find((x) => x.id === r.gatilho)!;
  const corpo = modelos?.find((m) => m.nome === r.modelo_nome && m.idioma === r.modelo_idioma)?.corpo;
  const proibidas = r.gatilho === "aniversario" ? (["destino", "data_embarque", "link_pesquisa"] as const) : [];
  const usaProibida = Object.values(r.params).some((p) => (proibidas as readonly string[]).includes(p.fonte));

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try { await salvarAutomacao(r); onSalvo(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal
      aberto={!!inicial}
      titulo={r.id ? "Editar automação" : "Nova automação"}
      onFechar={onFechar}
      largura={620}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando || r.nome.trim().length < 2 || !mapaCompleto(corpo, r.params) || usaProibida} onClick={salvar}>
          {salvando ? "Salvando…" : "Salvar"}
        </Botao>
      </>}
    >
      <div className="space-y-4">
        {!r.id && (
          <div className="flex flex-wrap gap-1.5">
            {SUGESTOES.map((s) => (
              <button key={s.rotulo} type="button" onClick={() => setR((x) => ({ ...x, ...s.r }))}
                className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>
                {s.rotulo}
              </button>
            ))}
          </div>
        )}
        <Campo rotulo="Nome (só o time vê)"><Entrada value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} placeholder="Ex.: Boa viagem" /></Campo>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
          <Campo rotulo="Quando">
            <select className="rel-input" value={r.gatilho} onChange={(e) => setR({ ...r, gatilho: e.target.value as Gatilho })}>
              {GATILHOS.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
            </select>
          </Campo>
          {g.usaDias && (
            <Campo rotulo="Dias"><Entrada type="number" min={0} max={365} value={r.dias} onChange={(e) => setR({ ...r, dias: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} /></Campo>
          )}
        </div>
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Sai às 10h, {g.frase(r.dias)}.</p>
        <ModeloEVariaveis
          modelos={modelos} erro={erroModelos}
          modeloNome={r.modelo_nome} modeloIdioma={r.modelo_idioma}
          mapa={r.params}
          onModelo={(m) => setR((x) => ({ ...x, modelo_nome: m.nome, modelo_idioma: m.idioma }))}
          onMapa={(params) => setR((x) => ({ ...x, params }))}
          fontesProibidas={[...proibidas]}
        />
        {usaProibida && <Aviso tom="erro">Aniversário não tem viagem ligada: troque destino/data/link da pesquisa por outra fonte.</Aviso>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {!r.id && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Nasce desligada. Confira "Quem receberia hoje" antes de ligar.</p>}
      </div>
    </Modal>
  );
}

function QuemRecebe({ automacao, onFechar }: { automacao: Automacao | null; onFechar: () => void }) {
  const [alvos, setAlvos] = useState<{ nome: string; telefone: string | null; motivo: string | null }[] | null>(null);
  const [hist, setHist] = useState<Envio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!automacao) return;
    setAlvos(null); setErro(null);
    testarAutomacao(automacao.id).then((r) => setAlvos(r.alvos)).catch((e) => { setAlvos([]); setErro(e instanceof Error ? e.message : "Falhou."); });
    envios({ automacaoId: automacao.id }, 30).then(setHist).catch(() => setHist([]));
  }, [automacao]);
  return (
    <Modal aberto={!!automacao} titulo={automacao?.nome ?? ""} onFechar={onFechar} largura={600}>
      <div className="space-y-4">
        <section>
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>Quem receberia hoje</p>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {alvos === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Calculando…</p>
            : alvos.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém hoje.</p>
            : (
              <ul className="space-y-1">
                {alvos.map((a, i) => (
                  <li key={i} className="text-[13px] flex gap-2" style={{ color: a.motivo ? "var(--ink3)" : "var(--ink)" }}>
                    <span className="font-semibold">{a.nome}</span>
                    <span>{formatarTelefone(a.telefone)}</span>
                    {a.motivo && <span>— fica de fora ({a.motivo})</span>}
                  </li>
                ))}
              </ul>
            )}
        </section>
        <section>
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>Últimos envios</p>
          {hist.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum ainda.</p> : (
            <ul className="space-y-1">
              {hist.map((e) => (
                <li key={e.id} className="text-[13px] flex flex-wrap gap-2 items-center" style={{ color: "var(--ink)" }}>
                  <span style={{ color: "var(--ink3)" }}>{new Date(e.criado_em).toLocaleDateString("pt-BR")}</span>
                  <span className="font-semibold">{e.cliente?.nome ?? "—"}</span>
                  <Etiqueta tom={e.status === "enviado" ? "rel" : e.status === "falhou" ? "erro" : "neutro"}>{e.status}</Etiqueta>
                  {e.motivo && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{e.motivo}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

export default function AutomacoesPage() {
  const { currentUser } = useQsAuth();
  const podeRodar = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const [lista, setLista] = useState<Automacao[] | null>(null);
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [vendo, setVendo] = useState<Automacao | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    try { setLista(await listarAutomacoes()); }
    catch (e) { setLista([]); setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function alternar(a: Automacao) {
    try { await ligarAutomacao(a.id, !a.ativo); await carregar(); }
    catch (e) { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); }
  }

  async function rodarAgora() {
    setRodando(true);
    setMsg(null);
    try {
      const r = await rodarAutomacoesAgora();
      const soma = r.automacoes.reduce((s, a) => s + a.enviados, 0);
      setMsg({ tom: "ok", t: r.automacoes.length ? `Rodou ${r.automacoes.length} automação(ões): ${soma} mensagem(ns) enviada(s). Quem já recebeu hoje não recebe de novo.` : "Nenhuma automação ligada." });
      await carregar();
    } catch (e) {
      setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." });
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Automações</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Mensagens que saem sozinhas todo dia às 10h, nas datas que importam.</p>
        </div>
        <div className="flex gap-2">
          {podeRodar && <Botao disabled={rodando} onClick={rodarAgora}>{rodando ? "Rodando…" : "Rodar agora"}</Botao>}
          <Botao variante="primario" onClick={() => setEditando(vazio())}>+ Nova automação</Botao>
        </div>
      </div>

      {msg && <Aviso tom={msg.tom}>{msg.t}</Aviso>}

      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="rel-card">
          <Vazio titulo="Nenhuma automação" texto="Comece por uma sugestão: Feliz aniversário, Boa viagem, Pesquisa pós-viagem ou Saudade da viagem."
            acao={<Botao variante="primario" onClick={() => setEditando(vazio())}>Criar</Botao>} />
        </div>
      ) : (
        <ul className="space-y-2">
          {lista.map((a) => {
            const g = GATILHOS.find((x) => x.id === a.gatilho);
            return (
              <li key={a.id} className="rel-card p-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer" title={a.ativo ? "Desligar" : "Ligar"}>
                  <input type="checkbox" checked={a.ativo} onChange={() => void alternar(a)} />
                  <Etiqueta tom={a.ativo ? "rel" : "neutro"}>{a.ativo ? "ligada" : "desligada"}</Etiqueta>
                </label>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{a.nome}</p>
                  <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                    {g?.frase(a.dias)} · modelo {a.modelo_nome}
                    {a.ultima_execucao && ` · rodou ${new Date(a.ultima_execucao).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                <Botao variante="fantasma" onClick={() => setVendo(a)}>Quem receberia hoje</Botao>
                <Botao variante="fantasma" onClick={() => setEditando({ id: a.id, nome: a.nome, gatilho: a.gatilho, dias: a.dias, modelo_nome: a.modelo_nome, modelo_idioma: a.modelo_idioma, params: a.params })}>Editar</Botao>
                <Botao variante="fantasma" onClick={async () => { await apagarAutomacao(a.id).catch(() => null); void carregar(); }}>Apagar</Botao>
              </li>
            );
          })}
        </ul>
      )}

      <Editor inicial={editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void carregar(); }} />
      <QuemRecebe automacao={vendo} onFechar={() => setVendo(null)} />
    </div>
  );
}
