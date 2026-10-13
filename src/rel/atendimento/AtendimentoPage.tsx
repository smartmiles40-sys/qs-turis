// src/rel/atendimento/AtendimentoPage.tsx
// -----------------------------------------------------------------------------
// ATENDIMENTO PELO WHATSAPP do Relacionamento (Fase 2).
//
// Esquerda: a lista de conversas (uma só, a mais recente em cima). Quem espera
// resposta tem o relógio do prazo (minutos úteis).
// Direita: a conversa. Assumir, responder (texto, resposta pronta, arquivo,
// modelo quando a janela de 24h fechou), ligar à ficha e resolver.
//
// Atualiza sozinho (a cada poucos segundos) enquanto a aba está aberta.
//
// Sprint 13/10: no topo, duas visões — "Conversas" (o WhatsApp) e "Chamados"
// (o kanban dos protocolos). De dentro da conversa dá pra abrir um chamado já
// ligado a ela, e os chamados abertos dela aparecem logo abaixo do cabeçalho.
//
// 13/10 (Bruno): CARA DE WHATSAPP — lista, bolhas, fotos/vídeos/áudios/documentos
// dentro da conversa (peças em ./waUi), e a etiqueta "Não conta no prazo" pra
// grupos, fornecedores e equipe (0113) — fora do SLA e dos KPIs.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  assumirConversa, carregarConversa, carregarMensagens, duracao, enviarArquivo, enviarTexto,
  ligarAoCliente, listarConversas, listarRespostas, marcarLida, marcarSemSla, MOTIVOS_SEM_SLA, preencherResposta, reabrirConversa,
  resolverConversa, statusDoNumero, type Conversa, type Filtro, type Mensagem, type NumeroRel, type Resposta,
} from "../lib/whatsapp";
import { buscarClientes, formatarTelefone, type Cliente } from "../lib/clientes";
import { Aviso, Botao, Entrada, Etiqueta, Modal } from "../ui";
import BotaoWhatsApp from "../whatsapp/BotaoWhatsApp";
import ModeloModal from "./ModeloModal";
import ChamadoModal from "../chamados/ChamadoModal";
import ChamadoDetalhe from "../chamados/ChamadoDetalhe";
import ChamadosPage from "../chamados/ChamadosPage";
import { assuntoSugerido, chamadosDaConversa, type ChamadoK } from "../lib/chamados";
import { STATUS_CHAMADO, situacaoDoPrazo } from "../lib/pos";
import {
  AvatarWa, EMOJIS, MidiaDaMensagem, SemArquivo, TextoWa, Tiques, Visualizador, WA_CSS,
  ehFigurinha, ehRotuloSemArquivo, horaDaLista, previa, rotuloDoDia, type FotoDaConversa,
} from "./waUi";

// UMA lista só (Bruno, 13/10/2026: "sem Esperando e Minhas — tudo numa aba só,
// fica melhor pra responder"). Igual ao WhatsApp: a conversa mais recente em
// cima; quem está esperando resposta continua com o relógio do prazo.
const FILTRO_UNICO: Filtro = "todas";

/** Enquanto a aba está visível, roda `fn` a cada `ms`. */
function useRepetir(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    const volta = () => { if (!document.hidden) ref.current(); };
    document.addEventListener("visibilitychange", volta);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", volta); };
  }, [ms]);
}

const nomeDa = (c: Conversa) => c.cliente_nome || c.nome_contato || formatarTelefone(c.telefone);
const motivoDe = (c: Conversa) => MOTIVOS_SEM_SLA[c.sem_sla_motivo || ""] || "Outro";

function Relogio({ c }: { c: Conversa }) {
  if (!c.aguardando_desde || c.sem_sla) return null;
  const estourou = c.minutos_esperando > c.meta_min;
  const quase = !estourou && c.minutos_esperando >= c.meta_min * 0.7;
  return (
    <Etiqueta tom={estourou ? "erro" : quase ? "aviso" : "rel"}>
      ⏱ {duracao(c.minutos_esperando)}
    </Etiqueta>
  );
}

const ICONE_BUSCA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></svg>;

// ── Lista ───────────────────────────────────────────────────────────────────

function Lista({ busca, setBusca, conversas, selecionada, abrir, carregando }: {
  busca: string; setBusca: (s: string) => void;
  conversas: Conversa[]; selecionada: string | null; abrir: (id: string) => void; carregando: boolean;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 wa-lista">
      <div className="px-3 pt-2.5 pb-2" style={{ borderBottom: "1px solid var(--wa-line)" }}>
        <label className="flex items-center gap-2.5 px-3 h-9 rounded-lg" style={{ background: "var(--wa-head)", color: "var(--wa-meta)" }}>
          {ICONE_BUSCA}
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar nome, telefone ou mensagem" aria-label="Buscar conversas"
            className="wa-campo flex-1 min-w-0 bg-transparent text-[14px]" style={{ background: "transparent" }} />
        </label>
      </div>
      <ul className="flex-1 overflow-y-auto min-h-0" aria-busy={carregando && conversas.length === 0}>
        {conversas.length === 0 && carregando && [0, 1, 2, 3, 4].map((i) => (
          <li key={`esq${i}`} className="px-3 py-3 flex gap-3 items-center" aria-hidden>
            <span className="w-12 h-12 rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--wa-head)" }} />
            <span className="flex-1 space-y-2">
              <span className="block h-3 w-2/5 rounded animate-pulse" style={{ background: "var(--wa-head)" }} />
              <span className="block h-3 w-4/5 rounded animate-pulse" style={{ background: "var(--wa-head)" }} />
            </span>
          </li>
        ))}
        {conversas.length === 0 && !carregando && (
          <li className="p-8 text-center text-[13px]" style={{ color: "var(--wa-meta)" }}>
            {busca ? "Nenhuma conversa com essa busca." : "Nenhuma conversa ainda."}
          </li>
        )}
        {conversas.map((c) => {
          const sel = c.id === selecionada;
          const p = previa(c.ultima_mensagem);
          const nossa = !!c.ultima_saida_em && (!c.ultima_entrada_em || c.ultima_saida_em >= c.ultima_entrada_em);
          const quando = [c.ultima_entrada_em, c.ultima_saida_em].filter(Boolean).sort().pop() || c.atualizado_em;
          const naoLidas = c.nao_lidas > 0;
          return (
            <li key={c.id}>
              <button onClick={() => abrir(c.id)} aria-current={sel ? "true" : undefined}
                className="wa-item w-full text-left pl-3 flex gap-3 items-center">
                <AvatarWa nome={nomeDa(c)} tamanho={49} />
                <span className="flex-1 min-w-0 py-3 pr-3" style={{ borderBottom: "1px solid var(--wa-line)" }}>
                  <span className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[16px]" style={{ color: "var(--wa-txt)" }}>{nomeDa(c)}</span>
                    <span className="text-[12px] flex-shrink-0" style={{ color: naoLidas ? "var(--wa-green-ink)" : "var(--wa-meta)", fontWeight: naoLidas ? 600 : 400 }}>{horaDaLista(quando)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 mt-0.5">
                    <span className="flex-1 min-w-0 flex items-center gap-1 text-[14px]" style={{ color: "var(--wa-meta)" }}>
                      {nossa && <span className="flex-shrink-0"><Tiques status="delivered" /></span>}
                      {p.icone && <span aria-hidden className="flex-shrink-0">{p.icone}</span>}
                      <span className="truncate">{p.texto || "—"}</span>
                    </span>
                    {naoLidas && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[12px] font-semibold inline-flex items-center justify-center wa-verde" aria-label={`${c.nao_lidas} não lidas`}>{c.nao_lidas}</span>
                    )}
                  </span>
                  {(c.sem_sla || c.aguardando_desde || !c.cliente_id || c.atendente_nome) && (
                    <span className="flex flex-wrap items-center gap-1 mt-1">
                      <Relogio c={c} />
                      {c.sem_sla && <Etiqueta>fora do prazo · {motivoDe(c)}</Etiqueta>}
                      {!c.cliente_id && <Etiqueta>sem ficha</Etiqueta>}
                      {c.atendente_nome && <span className="text-[11.5px]" style={{ color: "var(--wa-meta)" }}>· {c.atendente_nome.split(" ")[0]}</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Mensagens ───────────────────────────────────────────────────────────────

const SELO: Partial<Record<Mensagem["origem"], string>> = { historico: "histórico", celular: "pelo celular", automatica: "automática" };

function Bolha({ m, primeira, nomeCliente, onAbrirFoto }: { m: Mensagem; primeira: boolean; nomeCliente: string; onAbrirFoto: (url: string) => void }) {
  const minha = m.direcao === "out";
  const anexos = m.anexos || [];
  const texto = m.texto || "";
  const semArquivo = !anexos.length && ehRotuloSemArquivo(texto);
  const figurinha = anexos.length === 1 && ehFigurinha(anexos[0], texto);
  const hora = (
    <>
      {SELO[m.origem] && <span style={{ fontStyle: "italic" }}>{SELO[m.origem]} ·</span>}
      <span>{new Date(m.enviada_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
      {minha && <Tiques status={m.status} />}
    </>
  );
  const autor = minha && primeira
    ? (m.origem === "qs" && m.autor_nome ? m.autor_nome.split(" ")[0] : m.origem === "celular" ? "Celular" : m.origem === "automatica" ? "Automática" : null)
    : null;

  if (figurinha) {
    return (
      <div className={`flex ${minha ? "justify-end" : "justify-start"} ${primeira ? "mt-2" : "mt-0.5"}`}>
        <span className="relative">
          <img src={anexos[0].url} alt="Figurinha" loading="lazy" className="w-36 h-36 object-contain" />
          <span className="wa-chip absolute bottom-1 right-1 rounded-md px-1.5 py-0.5 text-[11px] inline-flex gap-1 items-center">{hora}</span>
        </span>
      </div>
    );
  }

  const soMidia = anexos.length > 0 && !texto.trim();
  return (
    <div className={`flex ${minha ? "justify-end" : "justify-start"} ${primeira ? "mt-2.5" : "mt-0.5"}`}>
      <div className={`wa-bolha ${minha ? "wa-out" : "wa-in"} ${primeira ? "wa-rabo" : ""}`} style={anexos.length ? { padding: 3 } : undefined}>
        {autor && <span className="block text-[12.5px] font-semibold mb-0.5" style={{ color: "var(--wa-green-ink)", padding: anexos.length ? "3px 6px 0" : 0 }}>{autor}</span>}
        {anexos.map((a, i) => (
          <div key={i} className={i ? "mt-1" : ""}>
            <MidiaDaMensagem a={a} texto={texto} minha={minha} nome={minha ? (m.autor_nome || "Equipe") : nomeCliente} onAbrirFoto={onAbrirFoto} hora={hora} />
          </div>
        ))}
        {semArquivo && <SemArquivo texto={texto} historico={m.origem === "historico"} />}
        {(texto && !semArquivo) || !(soMidia && anexos.every((a) => a.type === "image")) ? (
          <div style={anexos.length ? { padding: "4px 6px 2px" } : undefined}>
            {texto && !semArquivo && <TextoWa texto={texto} />}
            {!(soMidia && anexos.every((a) => a.type === "image")) && <span className="wa-hora">{hora}</span>}
            <span className="block clear-both" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SeparadorDia({ iso }: { iso: string }) {
  return (
    <div className="flex justify-center my-3" role="separator">
      <span className="wa-chip rounded-lg px-3 py-1 text-[12.5px]">{rotuloDoDia(iso)}</span>
    </div>
  );
}

// ── Ligar à ficha ───────────────────────────────────────────────────────────

function LigarFicha({ aberto, conversa, onFechar, onLigado }: { aberto: boolean; conversa: Conversa; onFechar: () => void; onLigado: () => void }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) setTermo(conversa.telefone.slice(-8)); }, [aberto, conversa.telefone]);
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => { buscarClientes(termo, 10).then(setLista).catch(() => setLista([])); }, 250);
    return () => clearTimeout(t);
  }, [termo, aberto]);
  async function ligar(id: string) {
    try { await ligarAoCliente(conversa.id, id); onLigado(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  return (
    <Modal aberto={aberto} titulo="Ligar a conversa a uma ficha" onFechar={onFechar}>
      <div className="space-y-3">
        <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nome, CPF ou telefone" autoFocus />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <ul className="rel-card overflow-hidden">
          {lista.length === 0 && <li className="p-3 text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém encontrado. Crie a ficha em Clientes e volte aqui — se o telefone for o mesmo, a conversa liga sozinha.</li>}
          {lista.map((c) => (
            <li key={c.id}>
              <button onClick={() => ligar(c.id)} className="rel-linha w-full text-left px-3 py-2 text-[13px] flex justify-between gap-2" style={{ color: "var(--ink)" }}>
                <span className="font-semibold">{c.nome}</span>
                <span style={{ color: "var(--ink3)" }}>{formatarTelefone(c.telefone)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ── "Não conta no prazo" ────────────────────────────────────────────────────

function ForaDoPrazo({ aberto, conversa, onFechar, onFeito }: { aberto: boolean; conversa: Conversa; onFechar: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("grupo");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) { setMotivo(length15(conversa.telefone) ? "grupo" : "fornecedor"); setErro(null); } }, [aberto, conversa.telefone]);
  async function salvar() {
    setSalvando(true); setErro(null);
    try { await marcarSemSla(conversa.id, true, motivo); onFeito(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui marcar."); }
    finally { setSalvando(false); }
  }
  return (
    <Modal aberto={aberto} titulo="Não conta no prazo de resposta" onFechar={onFechar}
      rodape={<><Botao onClick={onFechar} disabled={salvando}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Marcando…" : "Marcar"}</Botao></>}>
      <div className="space-y-3 text-[14px]" style={{ color: "var(--ink2)" }}>
        <p>Use pra grupos, fornecedores, equipe interna e testes — conversas que não são atendimento a cliente.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Motivo">
          {Object.entries(MOTIVOS_SEM_SLA).map(([k, r]) => (
            <button key={k} role="radio" aria-checked={motivo === k} onClick={() => setMotivo(k)}
              className="rounded-lg px-3 py-2 text-[13px] font-semibold border"
              style={motivo === k ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "var(--rel)" } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{r}</button>
          ))}
        </div>
        <Aviso>Ela sai do contador de "esperando" e <b>as medições antigas dela saem dos KPIs</b> de prazo. Dá pra desfazer depois — as medições antigas não voltam.</Aviso>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
const length15 = (t: string) => t.replace(/\D/g, "").length > 15;

// ── Botão de ícone do cabeçalho ─────────────────────────────────────────────

function Icone({ rotulo, onClick, ativo, children }: { rotulo: string; onClick: () => void; ativo?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} title={rotulo} aria-label={rotulo} aria-pressed={ativo}
      className="wa-icone w-10 h-10 inline-flex items-center justify-center flex-shrink-0" style={ativo ? { color: "var(--wa-green-ink)" } : undefined}>
      {children}
    </button>
  );
}

// ── Conversa ────────────────────────────────────────────────────────────────

function Painel({ id, meuId, onVoltar, onMudou, onAbrirCliente, onAbrirViagem, onAbrirConversa }: {
  id: string; meuId: string; onVoltar: () => void; onMudou: () => void; onAbrirCliente: (id: string) => void;
  onAbrirViagem?: (id: string) => void; onAbrirConversa: (id: string) => void;
}) {
  const [c, setC] = useState<Conversa | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [verRespostas, setVerRespostas] = useState(false);
  const [verEmojis, setVerEmojis] = useState(false);
  const [modelo, setModelo] = useState(false);
  const [ligar, setLigar] = useState(false);
  const [chamado, setChamado] = useState(false);
  const [chamados, setChamados] = useState<ChamadoK[]>([]);
  const [verChamado, setVerChamado] = useState<string | null>(null);
  const [foraPrazo, setForaPrazo] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previaUrl, setPreviaUrl] = useState<string | null>(null);
  const [legenda, setLegenda] = useState("");
  const [foto, setFoto] = useState<number | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const qtdAnterior = useRef(0);

  const recarregar = useCallback(async () => {
    try {
      const [cv, ms] = await Promise.all([carregarConversa(id), carregarMensagens(id)]);
      setC(cv);
      setMsgs(ms);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar a conversa.");
    }
  }, [id]);

  useEffect(() => {
    setC(null); setMsgs([]); setTexto(""); setErro(null); setArquivo(null); setLegenda(""); setFoto(null); qtdAnterior.current = 0;
    void recarregar().then(() => { void marcarLida(id).then(onMudou); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { listarRespostas().then(setRespostas); }, []);
  const carregarChamados = useCallback(() => { chamadosDaConversa(id).then(setChamados).catch(() => setChamados([])); }, [id]);
  useEffect(() => { setChamados([]); carregarChamados(); }, [carregarChamados]);
  useRepetir(() => { void recarregar(); }, 5000);

  // Prévia do arquivo antes de enviar.
  useEffect(() => {
    if (!arquivo || !/^(image|video)\//.test(arquivo.type)) { setPreviaUrl(null); return; }
    const u = URL.createObjectURL(arquivo);
    setPreviaUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);

  // Campo cresce com o texto (até ~6 linhas).
  useEffect(() => {
    const el = campoRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [texto]);

  // Desce pro fim quando chega mensagem nova.
  useEffect(() => {
    if (msgs.length !== qtdAnterior.current) {
      fimRef.current?.scrollIntoView({ block: "end" });
      if (qtdAnterior.current && c?.nao_lidas) void marcarLida(id);
      qtdAnterior.current = msgs.length;
    }
  }, [msgs.length, c?.nao_lidas, id]);

  const nome = c ? nomeDa(c) : "";
  // Todas as fotos da conversa, em ordem — o visualizador navega entre elas.
  const fotos: FotoDaConversa[] = useMemo(() => msgs.flatMap((m) => (m.anexos || [])
    .filter((a) => a.type === "image" && !ehFigurinha(a, m.texto || ""))
    .map((a) => ({ url: a.url, legenda: m.texto || "", quando: m.enviada_em, de: m.direcao === "out" ? (m.autor_nome || "Equipe") : nome }))), [msgs, nome]);

  if (!c) return (
    <div className="flex-1 flex items-center justify-center p-6 text-[13px] wa-fundo" style={{ color: "var(--wa-meta)" }} aria-live="polite">
      {erro ? <Aviso tom="erro">{erro}</Aviso> : "Carregando a conversa…"}
    </div>
  );

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); await recarregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await enviarTexto(c!.id, t);
      setTexto("");
      await recarregar();
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não enviou.");
    } finally {
      setEnviando(false);
    }
  }

  function escolherArquivo(f: File | undefined) {
    if (arquivoRef.current) arquivoRef.current.value = "";
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { setErro("Arquivo maior que 3 MB — a Meta não aceita por aqui."); return; }
    setErro(null);
    setArquivo(f);
    setLegenda(texto.trim());
  }

  async function enviarAnexo() {
    if (!arquivo || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await enviarArquivo(c!.id, arquivo, legenda.trim());
      setArquivo(null); setLegenda(""); setTexto("");
      await recarregar(); onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Arquivo não enviado."); }
    finally { setEnviando(false); }
  }

  function porEmoji(e: string) {
    const el = campoRef.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    setTexto(texto.slice(0, ini) + e + texto.slice(fim));
    requestAnimationFrame(() => { el?.focus(); const p = ini + e.length; el?.setSelectionRange(p, p); });
  }

  const minha = c.atendente_id === meuId;
  // Assunto sugerido: a última coisa que o CLIENTE escreveu.
  const ultimaDoCliente = [...msgs].reverse().find((m) => m.direcao !== "out" && m.texto)?.texto;
  const indiceDaFoto = (url: string) => Math.max(0, fotos.findIndex((f) => f.url === url));

  return (
    <div className="flex flex-col h-full min-h-0 wa">
      {/* Cabeçalho */}
      <div className="wa-cab flex items-center gap-2 px-2 sm:px-4 h-[60px] flex-shrink-0" style={{ borderBottom: "1px solid var(--wa-line)" }}>
        <button onClick={onVoltar} className="lg:hidden wa-icone w-10 h-10 inline-flex items-center justify-center" aria-label="Voltar para a lista">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => (c.cliente_id ? onAbrirCliente(c.cliente_id) : setLigar(true))}
          title={c.cliente_id ? "Abrir a ficha do cliente" : "Ligar a uma ficha"}>
          <AvatarWa nome={nome} tamanho={40} />
          <span className="min-w-0">
            <span className="block text-[16px] truncate" style={{ color: "var(--wa-txt)" }}>{nome}</span>
            <span className="block text-[12.5px] truncate" style={{ color: "var(--wa-meta)" }}>
              {formatarTelefone(c.telefone)}
              {c.cliente_id ? " · abrir ficha" : <span style={{ color: "var(--warn-ink)", fontWeight: 600 }}> · ligar à ficha</span>}
              {c.atendente_nome && ` · com ${c.atendente_nome.split(" ")[0]}`}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-0.5">
          <Icone rotulo="Abrir chamado (pedido que não se resolve na hora)" onClick={() => setChamado(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          </Icone>
          {!minha && (
            <Icone rotulo={c.atendente_id ? `Assumir (era de ${c.atendente_nome?.split(" ")[0] ?? "outro"})` : "Assumir a conversa"} onClick={() => void acao(() => assumirConversa(c.id, meuId))}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
            </Icone>
          )}
          <Icone rotulo={c.sem_sla ? `Fora do prazo (${motivoDe(c)}) — clique pra voltar a contar` : "Não conta no prazo (grupo, fornecedor, equipe…)"} ativo={c.sem_sla}
            onClick={() => (c.sem_sla ? void acao(() => marcarSemSla(c.id, false)) : setForaPrazo(true))}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M9 2h6" />{!c.sem_sla && <line x1="3" y1="3" x2="21" y2="21" />}</svg>
          </Icone>
          {c.estado !== "resolvida"
            ? <button onClick={() => void acao(() => resolverConversa(c.id))} className="ml-1 h-9 px-3 rounded-full text-[13px] font-semibold wa-verde">Resolver</button>
            : <button onClick={() => void acao(() => reabrirConversa(c.id))} className="ml-1 h-9 px-3 rounded-full text-[13px] font-semibold border" style={{ borderColor: "var(--wa-line)", color: "var(--wa-txt)" }}>Reabrir</button>}
        </div>
      </div>

      {chamados.length > 0 && (
        <div className="px-3 sm:px-4 py-1.5 flex flex-wrap items-center gap-1.5 flex-shrink-0" style={{ background: "var(--wa-head)", borderBottom: "1px solid var(--wa-line)" }}>
          <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--wa-meta)" }}>Chamados abertos</span>
          {chamados.map((ch) => {
            const p = situacaoDoPrazo(ch.prazo, ch.status);
            return (
              <button key={ch.id} onClick={() => setVerChamado(ch.id)} className="rel-card rel-linha px-2 py-1 text-[12px] flex items-center gap-1.5 max-w-[320px]"
                style={p.tom === "erro" ? { borderColor: "var(--err-line)" } : undefined} title={ch.proximo_passo ? `Próximo passo: ${ch.proximo_passo}` : undefined}>
                <b style={{ color: "var(--ink3)" }}>#{ch.numero}</b>
                <span className="truncate" style={{ color: "var(--ink)" }}>{ch.assunto}</span>
                <span style={{ color: p.tom === "erro" ? "var(--err-ink)" : "var(--ink3)" }}>· {STATUS_CHAMADO[ch.status].split(" ")[0]}</span>
              </button>
            );
          })}
        </div>
      )}

      {c.sem_sla ? (
        <div className="px-4 py-1.5 text-[12.5px] flex flex-wrap items-center gap-2 flex-shrink-0" style={{ background: "var(--wa-head)", color: "var(--wa-meta)", borderBottom: "1px solid var(--wa-line)" }}>
          <span>⏸ <b>Não conta no prazo</b> · {motivoDe(c)} — fora do contador e dos KPIs de resposta.</span>
          <button className="underline font-semibold" style={{ color: "var(--wa-green-ink)" }} onClick={() => void acao(() => marcarSemSla(c.id, false))}>Voltar a contar</button>
        </div>
      ) : c.aguardando_desde && (
        <div className="px-4 py-1.5 text-[12.5px] flex items-center gap-2 flex-shrink-0" style={{ background: c.minutos_esperando > c.meta_min ? "var(--err-bg)" : "var(--warn-bg)", color: c.minutos_esperando > c.meta_min ? "var(--err-ink)" : "var(--warn-ink)" }}>
          ⏱ Esperando resposta há <b>{duracao(c.minutos_esperando)}</b> úteis · prazo {duracao(c.meta_min)}
          {c.minutos_esperando > c.meta_min && " — fora do prazo"}
        </div>
      )}

      {/* Mensagens */}
      <div className="wa-fundo flex-1 overflow-y-auto min-h-0 px-3 sm:px-[6%] py-3" aria-live="polite" aria-relevant="additions">
        {msgs.length === 0 && (
          <div className="flex justify-center mt-6"><span className="wa-chip rounded-lg px-3 py-1.5 text-[12.5px]">Nenhuma mensagem ainda.</span></div>
        )}
        {msgs.map((m, i) => {
          const ant = msgs[i - 1];
          const novoDia = !ant || new Date(ant.enviada_em).toDateString() !== new Date(m.enviada_em).toDateString();
          const primeira = novoDia || !ant || ant.direcao !== m.direcao || (m.direcao === "out" && ant.autor_nome !== m.autor_nome)
            || new Date(m.enviada_em).getTime() - new Date(ant.enviada_em).getTime() > 10 * 60_000;
          return (
            <div key={m.id}>
              {novoDia && <SeparadorDia iso={m.enviada_em} />}
              <Bolha m={m} primeira={primeira} nomeCliente={nome} onAbrirFoto={(u) => setFoto(indiceDaFoto(u))} />
            </div>
          );
        })}
        <div ref={fimRef} className="h-1" />
      </div>

      {/* Escrever */}
      <div className="wa-cab px-2 sm:px-3 py-2 flex-shrink-0 space-y-2">
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {!c.janela_aberta ? (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <p className="flex-1 text-[13px]" style={{ color: "var(--wa-meta)" }}>
              O cliente não escreve há mais de 24h. A Meta só deixa mandar um <b>modelo aprovado</b> — quando ele responder, a conversa libera.
            </p>
            <button onClick={() => setModelo(true)} className="h-10 px-4 rounded-full text-[14px] font-semibold wa-verde">Mandar modelo</button>
          </div>
        ) : arquivo ? (
          // Prévia do anexo antes de enviar (igual ao WhatsApp).
          <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--wa-list)" }}>
            <div className="flex items-center gap-3">
              {previaUrl && arquivo.type.startsWith("image/") && <img src={previaUrl} alt="Prévia" className="w-20 h-20 rounded-lg object-cover" />}
              {previaUrl && arquivo.type.startsWith("video/") && <video src={previaUrl} className="w-28 h-20 rounded-lg object-cover bg-black" muted />}
              {!previaUrl && <span className="w-14 h-16 rounded-md flex items-center justify-center text-[22px]" style={{ background: "var(--wa-head)" }} aria-hidden>{arquivo.type.startsWith("audio/") ? "🎤" : "📄"}</span>}
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[14px] font-semibold" style={{ color: "var(--wa-txt)" }}>{arquivo.name}</span>
                <span className="block text-[12px]" style={{ color: "var(--wa-meta)" }}>{(arquivo.size / 1024 / 1024).toFixed(arquivo.size > 1048576 ? 1 : 2)} MB</span>
              </span>
              <button onClick={() => { setArquivo(null); setLegenda(""); }} className="wa-icone w-9 h-9 inline-flex items-center justify-center" aria-label="Cancelar anexo">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex items-end gap-2">
              <input value={legenda} onChange={(e) => setLegenda(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void enviarAnexo(); } }}
                placeholder="Adicione uma legenda…" aria-label="Legenda do anexo" autoFocus
                className="wa-campo flex-1 h-10 px-3 text-[14px]" style={{ background: "var(--wa-head)" }} />
              <button onClick={() => void enviarAnexo()} disabled={enviando} aria-label="Enviar anexo"
                className="w-11 h-11 rounded-full inline-flex items-center justify-center wa-verde flex-shrink-0 disabled:opacity-60">
                {enviando ? "…" : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39 1.16L4.3 12l-2.29 7.24a1 1 0 0 0 1.39 1.16z" /></svg>}
              </button>
            </div>
          </div>
        ) : (
          <>
            {verRespostas && (
              <div className="rel-card max-h-48 overflow-y-auto">
                {respostas.length === 0 && <p className="p-3 text-[12px]" style={{ color: "var(--ink3)" }}>Nenhuma resposta pronta. Crie em Configurações.</p>}
                {respostas.map((r) => (
                  <button key={r.id}
                    onClick={() => { setTexto(preencherResposta(r.texto, c.cliente_nome || c.nome_contato)); setVerRespostas(false); campoRef.current?.focus(); }}
                    className="rel-linha w-full text-left px-3 py-2" style={{ borderBottom: "1px solid var(--line2)" }}>
                    <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{r.titulo}</span>
                    <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{r.texto}</span>
                  </button>
                ))}
              </div>
            )}
            {verEmojis && (
              <div className="rounded-xl p-2 grid grid-cols-9 sm:grid-cols-12 gap-0.5" style={{ background: "var(--wa-list)" }} role="group" aria-label="Emojis">
                {EMOJIS.map((e) => (
                  <button key={e} onClick={() => porEmoji(e)} className="wa-icone h-9 text-[20px] inline-flex items-center justify-center" aria-label={`Inserir ${e}`}>{e}</button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1">
              <Icone rotulo="Emojis" onClick={() => { setVerEmojis((v) => !v); setVerRespostas(false); }} ativo={verEmojis}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
              </Icone>
              <Icone rotulo="Respostas prontas" onClick={() => { setVerRespostas((v) => !v); setVerEmojis(false); }} ativo={verRespostas}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
              </Icone>
              <Icone rotulo="Anexar foto, vídeo, áudio ou documento (até 3 MB)" onClick={() => arquivoRef.current?.click()}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              </Icone>
              <input ref={arquivoRef} type="file" hidden accept="image/jpeg,image/png,application/pdf,video/mp4,audio/mpeg,audio/ogg" onChange={(e) => escolherArquivo(e.target.files?.[0])} />
              <textarea
                ref={campoRef}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f) { e.preventDefault(); escolherArquivo(f); } }}
                rows={1}
                placeholder="Digite uma mensagem"
                aria-label="Mensagem (Enter envia, Shift+Enter pula linha)"
                className="wa-campo flex-1 resize-none px-3 py-2.5 text-[15px] leading-5 min-h-[42px]"
              />
              <button onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar mensagem"
                className="w-11 h-11 rounded-full inline-flex items-center justify-center wa-verde flex-shrink-0 disabled:opacity-50">
                {enviando ? "…" : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39 1.16L4.3 12l-2.29 7.24a1 1 0 0 0 1.39 1.16z" /></svg>}
              </button>
            </div>
          </>
        )}
      </div>

      {foto !== null && fotos.length > 0 && <Visualizador fotos={fotos} indice={Math.min(foto, fotos.length - 1)} onFechar={() => setFoto(null)} onTrocar={setFoto} />}
      <ModeloModal
        aberto={modelo}
        alvo={{ conversaId: c.id }}
        nomeCliente={c.cliente_nome || c.nome_contato}
        onFechar={() => setModelo(false)}
        onEnviado={() => { setModelo(false); void recarregar(); onMudou(); }}
      />
      <ChamadoModal
        aberto={chamado}
        inicial={{ clienteId: c.cliente_id ?? undefined, conversaId: c.id, assunto: assuntoSugerido(ultimaDoCliente) }}
        onFechar={() => setChamado(false)}
        onSalvo={() => { setChamado(false); carregarChamados(); }}
      />
      <ChamadoDetalhe
        id={verChamado}
        onFechar={() => setVerChamado(null)}
        onMudou={carregarChamados}
        onAbrirCliente={onAbrirCliente}
        onAbrirViagem={onAbrirViagem}
        onAbrirConversa={onAbrirConversa}
      />
      <LigarFicha aberto={ligar} conversa={c} onFechar={() => setLigar(false)} onLigado={() => { setLigar(false); void recarregar(); onMudou(); }} />
      <ForaDoPrazo aberto={foraPrazo} conversa={c} onFechar={() => setForaPrazo(false)} onFeito={() => { setForaPrazo(false); void recarregar(); onMudou(); }} />
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export type VisaoAtendimento = "conversas" | "chamados";

export default function AtendimentoPage({ conversaId, abrir, onAbrirCliente, onAbrirViagem, onMudou, visao: visaoFora, onTrocarVisao, onAbrirWhatsApp }: {
  conversaId: string | null;
  abrir: (id: string | null) => void;
  onAbrirCliente: (id: string) => void;
  onAbrirViagem?: (id: string) => void;
  onMudou: () => void;
  /** Visão controlada por quem chama (ex.: rota #rel/chamados). Sem isso, a página lembra sozinha. */
  visao?: VisaoAtendimento;
  onTrocarVisao?: (v: VisaoAtendimento) => void;
  /** Tela de conexão do número (botão à vista no topo — Bruno, 13/10). */
  onAbrirWhatsApp?: () => void;
}) {
  const { currentUser } = useQsAuth();
  const [visaoLocal, setVisaoLocal] = useState<VisaoAtendimento>(() => (localStorage.getItem("rel_atend_visao") as VisaoAtendimento) || "conversas");
  // Conversa aberta pelo endereço sempre mostra as conversas.
  const visao: VisaoAtendimento = conversaId ? "conversas" : visaoFora ?? visaoLocal;
  function trocarVisao(v: VisaoAtendimento) {
    localStorage.setItem("rel_atend_visao", v);
    setVisaoLocal(v);
    if (v === "chamados" && conversaId) abrir(null);
    onTrocarVisao?.(v);
  }
  const filtro = FILTRO_UNICO;
  const [busca, setBusca] = useState("");
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [numero, setNumero] = useState<NumeroRel | null>(null);
  const meuId = currentUser?.id ?? "";

  const carregar = useCallback(async () => {
    try { setConversas(await listarConversas(filtro, meuId, busca)); }
    catch { /* mantém a lista anterior; tenta de novo no próximo ciclo */ }
    finally { setCarregando(false); }
  }, [filtro, meuId, busca]);

  useEffect(() => {
    setCarregando(true);
    const t = setTimeout(() => { void carregar(); }, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);
  useRepetir(() => { void carregar(); }, 10_000);
  useEffect(() => { statusDoNumero().then(setNumero).catch(() => setNumero(null)); }, []);

  const mudou = () => { void carregar(); onMudou(); };
  const esperando = conversas.filter((c) => c.aguardando_desde).length;

  const abas = (
    <div className="flex items-end gap-1 px-3 sm:px-4 h-11 border-b" style={{ borderColor: "var(--line)", background: "var(--card)" }} role="tablist" aria-label="Atendimento">
      {([["conversas", "Conversas"], ["chamados", "Chamados"]] as [VisaoAtendimento, string][]).map(([v, r]) => (
        <button key={v} onClick={() => trocarVisao(v)} role="tab" aria-selected={visao === v}
          className="h-11 px-3 text-[13px] font-semibold flex items-center gap-1.5 -mb-px transition-colors"
          style={visao === v
            ? { color: "var(--rel-ink)", borderBottom: "2px solid var(--rel)" }
            : { color: "var(--ink2)", borderBottom: "2px solid transparent" }}>
          {r}
          {v === "conversas" && esperando > 0 && <Etiqueta tom="aviso">{esperando}</Etiqueta>}
        </button>
      ))}
      {onAbrirWhatsApp && <div className="ml-auto self-center"><BotaoWhatsApp abrir={onAbrirWhatsApp} /></div>}
    </div>
  );

  if (visao === "chamados") {
    return (
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8">
        {abas}
        <div className="px-4 sm:px-6 lg:px-8 py-5">
          <ChamadosPage embutido onAbrirCliente={onAbrirCliente} onAbrirViagem={onAbrirViagem}
            onAbrirConversa={(id) => { trocarVisao("conversas"); abrir(id); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8 wa">
      <style>{WA_CSS}</style>
      {abas}
      {numero && !numero.conectado && (
        <div className="px-4 py-2 text-[13px] flex flex-wrap items-center gap-2" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          O número de WhatsApp do Relacionamento ainda não está conectado — as conversas não chegam.
          {onAbrirWhatsApp && <button className="underline font-semibold" onClick={onAbrirWhatsApp}>Conectar agora</button>}
        </div>
      )}
      {/* Altura da tela inteira (no celular, menos a barra do topo de 56px), menos as abas (44px). */}
      <div className="flex h-[calc(100dvh-100px)] lg:h-[calc(100dvh-44px)]">
        <aside
          className={`${conversaId ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[380px] xl:w-[420px] lg:flex-shrink-0 border-r min-h-0 wa-lista`}
          style={{ borderColor: "var(--wa-line)" }}
        >
          <Lista
            busca={busca} setBusca={setBusca}
            conversas={conversas} selecionada={conversaId} abrir={(id) => abrir(id)} carregando={carregando}
          />
        </aside>
        <section className={`${conversaId ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0 min-h-0`}>
          {conversaId ? (
            <Painel id={conversaId} meuId={meuId} onVoltar={() => abrir(null)} onMudou={mudou} onAbrirCliente={onAbrirCliente}
              onAbrirViagem={onAbrirViagem} onAbrirConversa={(id) => abrir(id)} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 wa-cab" style={{ borderBottom: "6px solid var(--wa-green)" }}>
              <span className="w-20 h-20 rounded-full inline-flex items-center justify-center mb-5" style={{ background: "var(--wa-green)", color: "#fff" }} aria-hidden>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" /></svg>
              </span>
              <h2 className="text-[22px] font-light" style={{ color: "var(--wa-txt)" }}>WhatsApp do Relacionamento</h2>
              <p className="text-[14px] mt-2 max-w-md" style={{ color: "var(--wa-meta)" }}>
                Escolha uma conversa na lista. Quem está esperando resposta tem o relógio do prazo — comece por eles.
                O número continua no celular: o que o time responder por lá também aparece aqui.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
