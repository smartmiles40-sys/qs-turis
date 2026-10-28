// src/rel/disparos/AutomacoesPage.tsx
// -----------------------------------------------------------------------------
// AUTOMAÇÕES do Relacionamento (Fase 4 + 0218): mensagens automáticas pros
// clientes, todo dia às 10h, nas datas que importam — aniversário, X dias antes
// do embarque, dia do embarque, volta da viagem + N dias, 1 ano da viagem.
//
// Dois canais (0218):
//   • WhatsApp oficial: modelo aprovado pela Meta, com as variáveis ligadas
//     a dados do cliente/viagem;
//   • Tarefa: a mensagem pronta cai no sino de quem cuida da viagem, que manda
//     à mão e marca "Mandei".
//
// MODO SIMULAÇÃO por padrão: o WhatsApp NÃO sai — cada mensagem fica na "Fila
// de hoje" com o texto exato que sairia. O envio real precisa de duas chaves
// (a da tela, admin, e REL_AUTOMACOES_ENVIO_REAL=1 no servidor); o motor
// oficial de disparo é de outra frente (ver api/_relAutomacoes.js).
//
// Toda automação NASCE DESLIGADA: quem liga é o time, depois de olhar "quem
// receberia hoje".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  apagarAutomacao, envios, filaDasAutomacoes, GATILHOS, lerEnvioReal, ligarAutomacao, listarAutomacoes, marcarTarefaFeita,
  mudarEnvioReal, rodarAutomacoesAgora, salvarAutomacao, testarAutomacao, VARIAVEIS_TAREFA,
  type Automacao, type CanalAutomacao, type Envio, type Gatilho, type MapaVariaveis,
} from "../lib/disparos";
import { formatarTelefone } from "../lib/clientes";
import { equipeRelacionamento } from "../lib/pos";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import { podeGerirRelacionamento } from "../equipe/permissao";
import { usePode } from "../equipe/usePode";
import ModeloEVariaveis, { mapaCompleto, useModelos } from "./ModeloEVariaveis";

type Rascunho = {
  id?: string; nome: string; gatilho: Gatilho; dias: number; canal: CanalAutomacao;
  modelo_nome: string; modelo_idioma: string; params: MapaVariaveis; texto: string; tarefa_para: string;
};

// Sugestões prontas: preenchem o formulário; o modelo (ou o texto) é a pessoa que escolhe.
const SUGESTOES: { rotulo: string; r: Partial<Rascunho> }[] = [
  { rotulo: "Feliz aniversário", r: { nome: "Feliz aniversário", gatilho: "aniversario", dias: 0, params: { "1": { fonte: "nome" } },
    texto: "Oi, {nome}! Hoje é seu dia e a gente não podia deixar passar: feliz aniversário! Que venham muitas viagens pela frente. 🎉" } },
  { rotulo: "Boa viagem (véspera)", r: { nome: "Boa viagem", gatilho: "antes_embarque", dias: 1, params: { "1": { fonte: "nome" }, "2": { fonte: "destino" } },
    texto: "Oi, {nome}! Amanhã começa {destino}. Qualquer coisa na viagem, é só chamar aqui. Boa viagem!" } },
  { rotulo: "Dia do embarque", r: { nome: "Dia do embarque", gatilho: "antes_embarque", dias: 0, params: { "1": { fonte: "nome" }, "2": { fonte: "destino" } },
    texto: "Bom dia, {nome}! Hoje é o dia: {destino} te espera. Estamos por aqui se precisar de qualquer coisa." } },
  { rotulo: "Pesquisa pós-viagem", r: { nome: "Pesquisa pós-viagem", gatilho: "apos_retorno", dias: 2, params: { "1": { fonte: "nome" }, "2": { fonte: "link_pesquisa" } },
    texto: "Oi, {nome}! Bem-vindo(a) de volta. Conta pra gente como foi? Leva 1 minuto: {link_pesquisa}" } },
  { rotulo: "Saudade da viagem", r: { nome: "Saudade da viagem", gatilho: "aniversario_viagem", dias: 0, params: { "1": { fonte: "nome" }, "2": { fonte: "destino" } },
    texto: "Oi, {nome}! Faz 1 ano que você embarcou pra {destino}. Bateu saudade? Já pensou no próximo destino?" } },
];

const vazio = (): Rascunho => ({ nome: "", gatilho: "antes_embarque", dias: 1, canal: "tarefa", modelo_nome: "", modelo_idioma: "", params: {}, texto: "", tarefa_para: "" });

const STATUS_FILA: Record<Envio["status"], { t: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  simulado: { t: "simulado (não enviado)", tom: "neutro" },
  tarefa: { t: "tarefa: mandar à mão", tom: "aviso" },
  enviado: { t: "enviado", tom: "rel" },
  pendente: { t: "na fila", tom: "neutro" },
  pulado: { t: "pulado", tom: "neutro" },
  falhou: { t: "falhou", tom: "erro" },
};

function Editor({ inicial, onFechar, onSalvo }: { inicial: Rascunho | null; onFechar: () => void; onSalvo: () => void }) {
  const { modelos, erro: erroModelos } = useModelos();
  const [r, setR] = useState<Rascunho>(vazio());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [time, setTime] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (inicial) { setR(inicial); setErro(null); } }, [inicial]);
  useEffect(() => { equipeRelacionamento().then(setTime).catch(() => setTime([])); }, []);

  const g = GATILHOS.find((x) => x.id === r.gatilho)!;
  const tarefa = r.canal === "tarefa";
  const corpo = modelos?.find((m) => m.nome === r.modelo_nome && m.idioma === r.modelo_idioma)?.corpo;
  const proibidas = r.gatilho === "aniversario" ? (["destino", "data_embarque", "link_pesquisa"] as const) : [];
  const usaProibida = tarefa
    ? proibidas.some((k) => r.texto.includes(`{${k}}`))
    : Object.values(r.params).some((p) => (proibidas as readonly string[]).includes(p.fonte));
  const completo = tarefa ? r.texto.trim().length >= 5 : mapaCompleto(corpo, r.params);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await salvarAutomacao({ ...r, modelo_corpo: corpo ?? null, texto: r.texto, tarefa_para: r.tarefa_para || null });
      onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
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
        <Botao variante="primario" disabled={salvando || r.nome.trim().length < 2 || !completo || usaProibida} onClick={salvar}>
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
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Roda às 10h, {g.frase(r.dias)}.</p>

        <Campo rotulo="Como a mensagem chega">
          <div className="grid sm:grid-cols-2 gap-2">
            {([
              ["tarefa", "Tarefa pro atendente", "A mensagem pronta vai pro sino de quem cuida da viagem; a pessoa manda à mão."],
              ["whatsapp", "WhatsApp oficial", "Modelo aprovado pela Meta. Por enquanto em simulação: registra, não envia."],
            ] as const).map(([v, t, d]) => (
              <button key={v} type="button" onClick={() => setR({ ...r, canal: v })} className="rel-card p-3 text-left"
                style={r.canal === v ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : undefined}>
                <span className="block text-[13px] font-bold" style={{ color: "var(--ink)" }}>{t}</span>
                <span className="block text-[11.5px] mt-0.5" style={{ color: "var(--ink3)" }}>{d}</span>
              </button>
            ))}
          </div>
        </Campo>

        {tarefa ? (
          <>
            <Campo rotulo="Mensagem" dica={<>Use: {VARIAVEIS_TAREFA.map((v) => (
              <button key={v.chave} type="button" className="underline mr-2" onClick={() => setR((x) => ({ ...x, texto: `${x.texto}{${v.chave}}` }))}>{`{${v.chave}}`}</button>
            ))}</>}>
              <textarea className="rel-input" rows={4} value={r.texto} onChange={(e) => setR({ ...r, texto: e.target.value })}
                placeholder="Oi, {nome}! Amanhã começa {destino}…" />
            </Campo>
            <Campo rotulo="Quem recebe a tarefa" dica="Vai pra quem cuida da viagem. Sem responsável (ou aniversário), vai pra esta pessoa.">
              <select className="rel-input" value={r.tarefa_para} onChange={(e) => setR({ ...r, tarefa_para: e.target.value })}>
                <option value="">Quem criou a automação</option>
                {time.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Campo>
          </>
        ) : (
          <ModeloEVariaveis
            modelos={modelos} erro={erroModelos}
            modeloNome={r.modelo_nome} modeloIdioma={r.modelo_idioma}
            mapa={r.params}
            onModelo={(m) => setR((x) => ({ ...x, modelo_nome: m.nome, modelo_idioma: m.idioma }))}
            onMapa={(params) => setR((x) => ({ ...x, params }))}
            fontesProibidas={[...proibidas]}
          />
        )}
        {usaProibida && <Aviso tom="erro">Aniversário não tem viagem ligada: tire destino, data e link da pesquisa da mensagem.</Aviso>}
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
  const tarefa = automacao?.canal === "tarefa";
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
                {alvos.map((a, i) => {
                  // tarefa sem telefone ainda vale (a atendente pode achar o contato)
                  const motivo = tarefa && a.motivo === "sem telefone" ? null : a.motivo;
                  return (
                    <li key={i} className="text-[13px] flex gap-2" style={{ color: motivo ? "var(--ink3)" : "var(--ink)" }}>
                      <span className="font-semibold">{a.nome}</span>
                      <span>{formatarTelefone(a.telefone)}</span>
                      {motivo && <span>— fica de fora ({motivo})</span>}
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
        <section>
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>Últimos registros</p>
          {hist.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum ainda.</p> : (
            <ul className="space-y-1">
              {hist.map((e) => (
                <li key={e.id} className="text-[13px] flex flex-wrap gap-2 items-center" style={{ color: "var(--ink)" }}>
                  <span style={{ color: "var(--ink3)" }}>{new Date(e.criado_em).toLocaleDateString("pt-BR")}</span>
                  <span className="font-semibold">{e.cliente?.nome ?? "—"}</span>
                  <Etiqueta tom={STATUS_FILA[e.status]?.tom ?? "neutro"}>{STATUS_FILA[e.status]?.t ?? e.status}</Etiqueta>
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

/** O que as automações registraram hoje: simulações, tarefas a mandar, enviados. */
function FilaDeHoje({ nomes, versao, eu }: { nomes: Map<string, string>; versao: number; eu: string }) {
  const [fila, setFila] = useState<Envio[] | null>(null);
  const [soMinhas, setSoMinhas] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const carregar = useCallback(() => { filaDasAutomacoes(1).then(setFila).catch(() => setFila([])); }, []);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const lista = (fila ?? []).filter((e) => !soMinhas || e.responsavel_id === eu);
  const tarefas = lista.filter((e) => e.status === "tarefa").length;
  return (
    <section className="rel-card overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide flex-1" style={{ color: "var(--ink2)" }}>
          Fila de hoje {fila && `(${lista.length})`} {tarefas > 0 && <Etiqueta tom="aviso">{tarefas} pra mandar à mão</Etiqueta>}
        </h2>
        <label className="text-[12px] flex items-center gap-1.5" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} /> só as minhas tarefas
        </label>
      </div>
      {fila === null ? <p className="px-4 pb-4 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : lista.length === 0 ? <p className="px-4 pb-4 text-[13px]" style={{ color: "var(--ink3)" }}>Nada registrado nas últimas 24 horas.</p>
        : (
          <ul>
            {lista.map((e) => (
              <li key={e.id} className="px-4 py-3" style={{ borderTop: "1px solid var(--line2)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{e.cliente?.nome ?? "—"}</span>
                  <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{formatarTelefone(e.telefone)}</span>
                  <Etiqueta tom={STATUS_FILA[e.status]?.tom ?? "neutro"}>{STATUS_FILA[e.status]?.t ?? e.status}</Etiqueta>
                  <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                    {e.automacao_id && nomes.get(e.automacao_id)}{e.responsavel_id && e.status === "tarefa" ? ` · ${e.responsavel_id === eu ? "sua" : "de outra pessoa"}` : ""}
                  </span>
                  <span className="flex-1" />
                  {e.texto && (
                    <Botao variante="fantasma" onClick={() => { void navigator.clipboard?.writeText(e.texto ?? ""); setCopiado(e.id); setTimeout(() => setCopiado(null), 1500); }}>
                      {copiado === e.id ? "Copiado" : "Copiar texto"}
                    </Botao>
                  )}
                  {e.status === "tarefa" && (
                    <Botao variante="primario" onClick={() => { void marcarTarefaFeita(e.id).then(carregar).catch(() => undefined); }}>Mandei</Botao>
                  )}
                </div>
                {e.texto && <p className="text-[12.5px] mt-1 whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>{e.texto}</p>}
                {e.motivo && e.status !== "simulado" && <p className="text-[11.5px] mt-0.5" style={{ color: "var(--ink3)" }}>{e.motivo}</p>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export default function AutomacoesPage() {
  const { currentUser } = useQsAuth();
  // admin ou gestor(a) do Relacionamento (o servidor confere de novo)
  const podeRodar = podeGerirRelacionamento(currentUser);
  // Criar/mudar automação: conforme o cargo (0135); o banco confere.
  const podeEditar = usePode("relacionamento.disparos") !== false;
  const [lista, setLista] = useState<Automacao[] | null>(null);
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [vendo, setVendo] = useState<Automacao | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [rodando, setRodando] = useState(false);
  const [real, setReal] = useState<boolean | null>(null);
  const [versaoFila, setVersaoFila] = useState(0);

  const carregar = useCallback(async () => {
    try { setLista(await listarAutomacoes()); }
    catch (e) { setLista([]); setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); }
    lerEnvioReal().then(setReal).catch(() => setReal(false));
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
      const soma = (k: "enviados" | "simulados" | "tarefas") => r.automacoes.reduce((s, a) => s + (a[k] ?? 0), 0);
      setMsg({
        tom: r.erroEnvio ? "erro" : "ok",
        t: !r.automacoes.length ? "Nenhuma automação ligada."
          : `Rodou ${r.automacoes.length} automação(ões): ${soma("simulados")} simulada(s), ${soma("tarefas")} tarefa(s), ${soma("enviados")} enviada(s). Quem já entrou na fila hoje não entra de novo.${r.erroEnvio ? ` ${r.erroEnvio}` : ""}`,
      });
      await carregar();
      setVersaoFila((v) => v + 1);
    } catch (e) {
      setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." });
    } finally {
      setRodando(false);
    }
  }

  async function trocarModo() {
    if (!currentUser || real === null) return;
    const ligar = !real;
    if (ligar && !window.confirm("Liberar o envio REAL do WhatsApp nas automações? Ele só acontece se o servidor também estiver liberado (REL_AUTOMACOES_ENVIO_REAL=1).")) return;
    try { await mudarEnvioReal(ligar, currentUser.id); setReal(ligar); }
    catch (e) { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); }
  }

  const nomes = new Map((lista ?? []).map((a) => [a.id, a.nome]));

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Automações</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Mensagens automáticas pros clientes, todo dia às 10h, nas datas que importam.</p>
        </div>
        <div className="flex gap-2">
          {podeRodar && <Botao disabled={rodando} onClick={rodarAgora}>{rodando ? "Rodando…" : "Rodar agora"}</Botao>}
          {podeEditar && <Botao variante="primario" onClick={() => setEditando(vazio())}>+ Nova automação</Botao>}
        </div>
      </div>

      {real === false && (
        <Aviso>
          <b>Modo simulação.</b> Nenhum WhatsApp sai daqui por enquanto: cada mensagem fica registrada na <b>Fila de hoje</b> com o texto exato que
          sairia. Automações do tipo <b>tarefa</b> já funcionam: a mensagem vai pro sino de quem cuida da viagem.
          {currentUser?.role === "admin" && <> <button type="button" className="underline font-semibold" onClick={() => void trocarModo()}>Liberar envio real</button></>}
        </Aviso>
      )}
      {real === true && (
        <Aviso tom="erro">
          <b>Envio real liberado na tela.</b> O WhatsApp sai de verdade se o servidor também estiver liberado.
          {currentUser?.role === "admin" && <> <button type="button" className="underline font-semibold" onClick={() => void trocarModo()}>Voltar pra simulação</button></>}
        </Aviso>
      )}
      {msg && <Aviso tom={msg.tom}>{msg.t}</Aviso>}

      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="rel-card">
          <Vazio titulo="Nenhuma automação" texto="Comece por uma sugestão: Feliz aniversário, Boa viagem, Dia do embarque, Pesquisa pós-viagem ou Saudade da viagem."
            acao={podeEditar ? <Botao variante="primario" onClick={() => setEditando(vazio())}>Criar</Botao> : undefined} />
        </div>
      ) : (
        <ul className="space-y-2">
          {lista.map((a) => {
            const g = GATILHOS.find((x) => x.id === a.gatilho);
            const tarefa = a.canal === "tarefa";
            return (
              <li key={a.id} className="rel-card p-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer" title={a.ativo ? "Desligar" : "Ligar"}>
                  <input type="checkbox" checked={a.ativo} disabled={!podeEditar} onChange={() => void alternar(a)} />
                  <Etiqueta tom={a.ativo ? "rel" : "neutro"}>{a.ativo ? "ligada" : "desligada"}</Etiqueta>
                </label>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{a.nome}</p>
                  <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                    {g?.frase(a.dias)} · {tarefa ? "tarefa pro atendente" : `WhatsApp, modelo ${a.modelo_nome}`}
                    {a.ultima_execucao && ` · rodou ${new Date(a.ultima_execucao).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                <Botao variante="fantasma" onClick={() => setVendo(a)}>Quem receberia hoje</Botao>
                {podeEditar && (
                  <>
                    <Botao variante="fantasma" onClick={() => setEditando({
                      id: a.id, nome: a.nome, gatilho: a.gatilho, dias: a.dias, canal: a.canal ?? "whatsapp",
                      modelo_nome: a.modelo_nome, modelo_idioma: a.modelo_idioma, params: a.params, texto: a.texto ?? "", tarefa_para: a.tarefa_para ?? "",
                    })}>Editar</Botao>
                    <Botao variante="fantasma" onClick={async () => {
                      if (!window.confirm(`Apagar a automação "${a.nome}"? O histórico dela vai junto.`)) return;
                      await apagarAutomacao(a.id).catch(() => null); void carregar();
                    }}>Apagar</Botao>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <FilaDeHoje nomes={nomes} versao={versaoFila} eu={currentUser?.id ?? ""} />

      <Editor inicial={editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void carregar(); }} />
      <QuemRecebe automacao={vendo} onFechar={() => setVendo(null)} />
    </div>
  );
}
