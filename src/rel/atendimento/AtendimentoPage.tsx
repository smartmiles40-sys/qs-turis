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
//
// 14/10 (Bruno): "IGUAL AO WHATSAPP MESMO" (0121):
//   • botão direito (ou a setinha do hover) na conversa: fixar, favoritar,
//     arquivar, silenciar, marcar como não lida — cada pessoa organiza a SUA
//     lista —, etiquetas e listas do time, salvar contato;
//   • botão direito na mensagem: reagir, responder (com citação), copiar,
//     encaminhar, fixar no topo, estrela, guardar no bloco de notas, salvar
//     figurinha, abrir chamado;
//   • todos os emojis com busca em português, figurinhas, atalhos de teclado
//     do WhatsApp Web (./atalhos), respostas prontas pelo "/" e bloco de notas
//     particular na lateral.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  assumirConversa, carregarConversa, carregarMensagens, duracao, enviarArquivo, enviarFigurinha, enviarTexto,
  favoritarMensagem, fixarMensagem, guardarMensagemNasNotas, ligarAoCliente, listarConversas, listarEtiquetas, listarListas,
  listarRespostas, marcarLida, marcarSemSla, minhasFavoritas, mudarPreferencia, MOTIVOS_SEM_SLA, preencherResposta, reabrirConversa,
  contarFixadas, reagir, resolverConversa, salvarFigurinha, statusDoNumero,
  type Conversa, type Etiqueta, type Filtro, type Lista, type Mensagem, type NumeroRel, type PrefConversa, type Resposta,
} from "../lib/whatsapp";
import { buscarClientes, formatarTelefone, type Cliente } from "../lib/clientes";
import { Aviso, Botao, Entrada, Etiqueta as EtiquetaUi, Modal } from "../ui";
import BotaoWhatsApp from "../whatsapp/BotaoWhatsApp";
import ModeloModal from "./ModeloModal";
import ChamadoModal from "../chamados/ChamadoModal";
import ChamadoDetalhe from "../chamados/ChamadoDetalhe";
import ChamadosPage from "../chamados/ChamadosPage";
import ClienteForm from "../clientes/ClienteForm";
import { assuntoSugerido, chamadosDaConversa, type ChamadoK } from "../lib/chamados";
import { STATUS_CHAMADO, situacaoDoPrazo } from "../lib/pos";
import {
  AvatarWa, MidiaDaMensagem, SemArquivo, TextoWa, Tiques, Visualizador, WA_CSS,
  ehFigurinha, ehRotuloSemArquivo, horaDaLista, previa, rotuloDoDia, type FotoDaConversa,
} from "./waUi";
import PainelExpressoes, { EMOJI_FONT_CSS, EmojiPicker } from "./PainelExpressoes";
import BlocoDeNotas from "./BlocoDeNotas";
import MenuContexto, { ICO, posicaoDoEvento, type ItemMenu, type PosicaoMenu } from "./MenuContexto";
import { AtalhosModal, atalhoDoEvento, envolver, marcaDoEvento, type AcaoAtalho } from "./atalhos";
import { EncaminharModal, EtiquetasModal, ListasModal, NovaConversaModal } from "./Organizar";

// UMA lista só (Bruno, 13/10/2026: "sem Esperando e Minhas — tudo numa aba só,
// fica melhor pra responder"). Igual ao WhatsApp: a conversa mais recente em
// cima; quem está esperando resposta continua com o relógio do prazo. Os chips
// do topo (14/10) só filtram o que já está na tela.
const FILTRO_UNICO: Filtro = "todas";

/** As 6 reações rápidas do WhatsApp. */
const REACOES = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
/** WhatsApp deixa fixar no máximo 3 conversas. */
const MAX_FIXADAS = 3;

/** O que a página manda pro painel da conversa quando é um atalho dele. */
const EVENTO_ATALHO = "rel-wa-atalho";

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
const naoLida = (c: Conversa) => c.nao_lidas > 0 || !!c.marcada_nao_lida;

// Peças visuais que só o atendimento usa (o resto mora no WA_CSS).
const EXTRA_CSS = `
.wa-menu { background: var(--wa-list); box-shadow: 0 2px 5px rgba(11,20,26,.26), 0 2px 10px rgba(11,20,26,.16); }
.wa-seta { opacity: 0; transition: opacity .12s; }
.wa-item:hover .wa-seta, .wa-item:focus-within .wa-seta, .wa-bolha:hover .wa-seta, .wa-fig:hover .wa-seta { opacity: 1; }
.wa-chipf { height: 32px; padding: 0 12px; border-radius: 999px; font-size: 14px; background: var(--wa-head); color: var(--wa-meta); white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.wa-chipf[aria-pressed="true"] { background: #D9FDD3; color: #008069; }
html.dark .wa-chipf[aria-pressed="true"] { background: #0A332C; color: #00A884; }
.wa-reacao { background: var(--wa-list); box-shadow: 0 1px 2px rgba(11,20,26,.2); border-radius: 999px; padding: 1px 6px; font-size: 14px; display: inline-flex; gap: 3px; align-items: center; }
.wa-cita { border-left: 4px solid var(--wa-green); background: var(--wa-doc); border-radius: 6px; padding: 4px 8px; margin-bottom: 4px; cursor: pointer; }
.wa-achada .wa-bolha { box-shadow: 0 0 0 2px #FFBC38; }
.wa-piscar .wa-bolha { animation: waPisca 1.2s ease-out 1; }
@keyframes waPisca { 0%,40% { box-shadow: 0 0 0 3px var(--wa-green); } 100% { box-shadow: none; } }
.wa-sug[aria-selected="true"] { background: var(--wa-hover); }
@media (prefers-reduced-motion: reduce) { .wa-piscar .wa-bolha { animation: none; } }
`;

function Relogio({ c }: { c: Conversa }) {
  if (!c.aguardando_desde || c.sem_sla) return null;
  const estourou = c.minutos_esperando > c.meta_min;
  const quase = !estourou && c.minutos_esperando >= c.meta_min * 0.7;
  return (
    <EtiquetaUi tom={estourou ? "erro" : quase ? "aviso" : "rel"}>
      ⏱ {duracao(c.minutos_esperando)}
    </EtiquetaUi>
  );
}

const ICONE_BUSCA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></svg>;
const ICONE_SETA = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>;
const PINO = <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M16 3a1 1 0 0 1 .7 1.7L15 6.4v4.2l2.8 2.8A1 1 0 0 1 17 15h-4v5l-1 1-1-1v-5H7a1 1 0 0 1-.7-1.7L9 10.6V6.4L7.3 4.7A1 1 0 0 1 8 3z" /></svg>;
const MUDO = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>;
const ESTRELA = <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" /></svg>;

// ── Lista ───────────────────────────────────────────────────────────────────

type Chip = "tudo" | "nao_lidas" | "favoritas" | "esperando" | `lista:${string}` | `etq:${string}`;

function Lista({ busca, setBusca, buscaRef, conversas, selecionada, abrir, carregando, chip, setChip, listas, etiquetas, arquivadas, verArquivadas, setVerArquivadas, onMenu, onNova, onNotas, notasAbertas, onAtalhos, onListas }: {
  busca: string; setBusca: (s: string) => void; buscaRef: React.RefObject<HTMLInputElement>;
  conversas: Conversa[]; selecionada: string | null; abrir: (id: string) => void; carregando: boolean;
  chip: Chip; setChip: (c: Chip) => void; listas: Lista[]; etiquetas: Map<string, Etiqueta>;
  arquivadas: Conversa[]; verArquivadas: boolean; setVerArquivadas: (v: boolean) => void;
  onMenu: (c: Conversa, pos: PosicaoMenu) => void;
  onNova: () => void; onNotas: () => void; notasAbertas: boolean; onAtalhos: () => void; onListas: () => void;
}) {
  const chips: [Chip, ReactNode][] = [
    ["tudo", "Tudo"], ["nao_lidas", "Não lidas"], ["favoritas", "Favoritas"], ["esperando", "Esperando"],
    ...listas.map((l) => [`lista:${l.id}`, l.nome] as [Chip, ReactNode]),
    ...[...etiquetas.values()].map((e) => [`etq:${e.id}`, <><span className="w-2.5 h-2.5 rounded-full" style={{ background: e.cor }} aria-hidden />{e.nome}</>] as [Chip, ReactNode]),
  ];
  const arqNaoLidas = arquivadas.filter(naoLida).length;
  return (
    <div className="flex flex-col h-full min-h-0 wa-lista">
      {/* Barra do topo da lista: igual ao WhatsApp Web */}
      <div className="flex items-center justify-between pl-4 pr-2 h-[52px] flex-shrink-0">
        <span className="text-[19px] font-bold" style={{ color: "var(--wa-txt)" }}>{verArquivadas ? "Arquivadas" : "Conversas"}</span>
        <span className="flex items-center gap-0.5">
          <Icone rotulo="Nova conversa (Ctrl+Alt+N)" onClick={onNova}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /><line x1="12" y1="8" x2="12" y2="15" /><line x1="8.5" y1="11.5" x2="15.5" y2="11.5" /></svg>
          </Icone>
          <Icone rotulo="Bloco de notas — só você vê (Ctrl+Alt+B)" onClick={onNotas} ativo={notasAbertas}>{ICO.nota}</Icone>
          <Icone rotulo="Listas de conversas" onClick={onListas}>{ICO.lista}</Icone>
          <Icone rotulo="Atalhos do teclado (Ctrl+/)" onClick={onAtalhos}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="12" rx="2" /><line x1="6" y1="10" x2="6.01" y2="10" /><line x1="10" y1="10" x2="10.01" y2="10" /><line x1="14" y1="10" x2="14.01" y2="10" /><line x1="18" y1="10" x2="18.01" y2="10" /><line x1="8" y1="14" x2="16" y2="14" /></svg>
          </Icone>
        </span>
      </div>
      <div className="px-3 pb-2">
        <label className="flex items-center gap-2.5 px-3 h-9 rounded-lg" style={{ background: "var(--wa-head)", color: "var(--wa-meta)" }}>
          {ICONE_BUSCA}
          <input ref={buscaRef} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar nome, telefone ou mensagem" aria-label="Buscar conversas (Ctrl+Alt+/)"
            onKeyDown={(e) => { if (e.key === "Escape" && busca) { e.stopPropagation(); setBusca(""); } }}
            className="wa-campo flex-1 min-w-0 bg-transparent text-[14px]" style={{ background: "transparent" }} />
        </label>
      </div>
      {!verArquivadas && (
        <div className="px-3 pb-2 flex gap-1.5 overflow-x-auto flex-shrink-0" role="toolbar" aria-label="Filtros" style={{ scrollbarWidth: "none", borderBottom: "1px solid var(--wa-line)" }}>
          {chips.map(([k, r]) => (
            <button key={k} className="wa-chipf" aria-pressed={chip === k} onClick={() => setChip(chip === k && k !== "tudo" ? "tudo" : k)}>{r}</button>
          ))}
        </div>
      )}
      <ul className="flex-1 overflow-y-auto min-h-0" aria-busy={carregando && conversas.length === 0}>
        {/* Arquivadas: a linha do topo, igual ao WhatsApp */}
        {(verArquivadas || arquivadas.length > 0) && (
          <li>
            <button onClick={() => setVerArquivadas(!verArquivadas)} className="wa-item w-full text-left pl-6 pr-4 h-[49px] flex items-center gap-6" style={{ color: "var(--wa-green-ink)" }}>
              {verArquivadas
                ? <><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg><span className="text-[15px] font-semibold">Voltar às conversas</span></>
                : <><span aria-hidden>{ICO.arquivar}</span><span className="flex-1 text-[16px]" style={{ color: "var(--wa-txt)" }}>Arquivadas</span>
                  <span className="text-[12px] font-semibold">{arqNaoLidas || arquivadas.length}</span></>}
            </button>
          </li>
        )}
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
            {busca ? "Nenhuma conversa com essa busca." : verArquivadas ? "Nenhuma conversa arquivada." : chip !== "tudo" ? "Nenhuma conversa neste filtro." : "Nenhuma conversa ainda."}
          </li>
        )}
        {conversas.map((c) => {
          const sel = c.id === selecionada;
          const p = previa(c.ultima_mensagem);
          const nossa = !!c.ultima_saida_em && (!c.ultima_entrada_em || c.ultima_saida_em >= c.ultima_entrada_em);
          const quando = [c.ultima_entrada_em, c.ultima_saida_em].filter(Boolean).sort().pop() || c.atualizado_em;
          const nl = naoLida(c);
          const etqs = (c.etiquetas || []).map((id) => etiquetas.get(id)).filter(Boolean) as Etiqueta[];
          const menu = (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); onMenu(c, posicaoDoEvento(e)); };
          return (
            <li key={c.id} className="wa-item relative" onContextMenu={menu} aria-current={sel ? "true" : undefined}>
              <button onClick={() => abrir(c.id)} aria-current={sel ? "true" : undefined}
                className="w-full text-left pl-3 flex gap-3 items-center"
                onKeyDown={(e) => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onMenu(c, { x: r.right - 220, y: r.top + 30 }); } }}>
                <AvatarWa nome={nomeDa(c)} tamanho={49} />
                <span className="flex-1 min-w-0 py-3 pr-3" style={{ borderBottom: "1px solid var(--wa-line)" }}>
                  <span className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[16px]" style={{ color: "var(--wa-txt)" }}>{nomeDa(c)}</span>
                    <span className="text-[12px] flex-shrink-0" style={{ color: nl && !c.silenciada ? "var(--wa-green-ink)" : "var(--wa-meta)", fontWeight: nl ? 600 : 400 }}>{horaDaLista(quando)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 mt-0.5">
                    <span className="flex-1 min-w-0 flex items-center gap-1 text-[14px]" style={{ color: "var(--wa-meta)" }}>
                      {nossa && <span className="flex-shrink-0"><Tiques status="delivered" /></span>}
                      {p.icone && <span aria-hidden className="flex-shrink-0 wa-emoji">{p.icone}</span>}
                      <span className="truncate wa-emoji">{p.texto || "—"}</span>
                    </span>
                    <span className="flex items-center gap-1 flex-shrink-0" style={{ color: "var(--wa-meta)" }}>
                      {c.favorita && <span title="Favorita" style={{ color: "#FFBC38" }}>{ESTRELA}</span>}
                      {c.silenciada && <span title="Silenciada">{MUDO}</span>}
                      {nl && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[12px] font-semibold inline-flex items-center justify-center"
                          style={c.silenciada ? { background: "var(--wa-meta)", color: "#fff" } : { background: "var(--wa-green)", color: "#fff" }}
                          aria-label={c.nao_lidas ? `${c.nao_lidas} não lidas` : "Marcada como não lida"}>{c.nao_lidas || ""}</span>
                      )}
                      {c.fixada_em && <span title="Fixada" className="ml-0.5">{PINO}</span>}
                      {/* espaço da setinha do menu */}
                      <span className="w-5" aria-hidden />
                    </span>
                  </span>
                  {(c.sem_sla || c.aguardando_desde || !c.cliente_id || c.atendente_nome || etqs.length > 0) && (
                    <span className="flex flex-wrap items-center gap-1 mt-1">
                      <Relogio c={c} />
                      {etqs.slice(0, 3).map((e) => (
                        <span key={e.id} className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[11px] font-semibold" style={{ background: `${e.cor}22`, color: "var(--wa-txt)" }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: e.cor }} aria-hidden />{e.nome}
                        </span>
                      ))}
                      {etqs.length > 3 && <span className="text-[11px]" style={{ color: "var(--wa-meta)" }}>+{etqs.length - 3}</span>}
                      {c.sem_sla && <EtiquetaUi>fora do prazo · {motivoDe(c)}</EtiquetaUi>}
                      {!c.cliente_id && <EtiquetaUi>sem ficha</EtiquetaUi>}
                      {c.atendente_nome && <span className="text-[11.5px]" style={{ color: "var(--wa-meta)" }}>· {c.atendente_nome.split(" ")[0]}</span>}
                    </span>
                  )}
                </span>
              </button>
              <button onClick={menu} aria-label={`Opções da conversa com ${nomeDa(c)}`} title="Opções"
                className="wa-seta absolute right-2 top-[34px] w-6 h-6 inline-flex items-center justify-center rounded" style={{ color: "var(--wa-meta)" }}>
                {ICONE_SETA}
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

function trecho(m: Mensagem) {
  const t = (m.texto || "").trim();
  if (t) return t.length > 120 ? `${t.slice(0, 120)}…` : t;
  const a = m.anexos?.[0];
  if (!a) return "Mensagem";
  if (ehFigurinha(a, "")) return "Figurinha";
  return { image: "📷 Foto", video: "🎬 Vídeo", audio: "🎤 Áudio", file: `📄 ${a.nome || "Documento"}` }[a.type];
}

function Reacoes({ m, meuId }: { m: Mensagem; meuId: string }) {
  const lista = m.reacoes || [];
  if (!lista.length) return null;
  const grupos = new Map<string, string[]>();
  for (const r of lista) grupos.set(r.emoji, [...(grupos.get(r.emoji) || []), r.de === meuId ? "Você" : r.nome || (r.de === "cliente" ? "Cliente" : "Equipe")]);
  return (
    <span className="wa-reacao wa-emoji" title={[...grupos.entries()].map(([e, n]) => `${e} ${n.join(", ")}`).join("\n")}>
      {[...grupos.keys()].slice(0, 3).map((e) => <span key={e}>{e}</span>)}
      {lista.length > 1 && <span className="text-[12px]" style={{ color: "var(--wa-meta)" }}>{lista.length}</span>}
    </span>
  );
}

function Bolha({ m, primeira, nomeCliente, citada, favorita, meuId, onAbrirFoto, onMenu, onIrPara }: {
  m: Mensagem; primeira: boolean; nomeCliente: string; citada: Mensagem | null; favorita: boolean; meuId: string;
  onAbrirFoto: (url: string) => void; onMenu: (m: Mensagem, pos: PosicaoMenu) => void; onIrPara: (id: string) => void;
}) {
  const minha = m.direcao === "out";
  const anexos = m.anexos || [];
  const texto = m.texto || "";
  const semArquivo = !anexos.length && ehRotuloSemArquivo(texto);
  const figurinha = anexos.length === 1 && ehFigurinha(anexos[0], texto);
  const menu = (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); onMenu(m, posicaoDoEvento(e)); };
  const hora = (
    <>
      {favorita && <span title="Com estrela">{ESTRELA}</span>}
      {SELO[m.origem] && <span style={{ fontStyle: "italic" }}>{SELO[m.origem]} ·</span>}
      <span>{new Date(m.enviada_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
      {minha && <Tiques status={m.status} />}
    </>
  );
  const autor = minha && primeira
    ? (m.origem === "qs" && m.autor_nome ? m.autor_nome.split(" ")[0] : m.origem === "celular" ? "Celular" : m.origem === "automatica" ? "Automática" : null)
    : null;
  const seta = (
    <button onClick={menu} aria-label="Opções da mensagem" title="Opções"
      className="wa-seta absolute top-0.5 right-0.5 w-6 h-6 inline-flex items-center justify-center rounded-full z-[1]"
      style={{ color: "var(--wa-meta)", background: minha ? "var(--wa-out)" : "var(--wa-in)" }}>{ICONE_SETA}</button>
  );
  const reacoes = (m.reacoes?.length ?? 0) > 0 && (
    <div className={`flex ${minha ? "justify-end pr-2" : "justify-start pl-2"} -mt-1.5 mb-1 relative z-[1]`}><Reacoes m={m} meuId={meuId} /></div>
  );

  if (figurinha) {
    return (
      <>
        <div className={`flex ${minha ? "justify-end" : "justify-start"} ${primeira ? "mt-2" : "mt-0.5"}`} onContextMenu={menu}>
          <span className="relative wa-fig">
            {seta}
            <img src={anexos[0].url} alt="Figurinha" loading="lazy" className="w-36 h-36 object-contain" />
            <span className="wa-chip absolute bottom-1 right-1 rounded-md px-1.5 py-0.5 text-[11px] inline-flex gap-1 items-center">{hora}</span>
          </span>
        </div>
        {reacoes}
      </>
    );
  }

  const soMidia = anexos.length > 0 && !texto.trim();
  return (
    <>
      <div className={`flex ${minha ? "justify-end" : "justify-start"} ${primeira ? "mt-2.5" : "mt-0.5"}`} onContextMenu={menu}>
        <div className={`wa-bolha relative ${minha ? "wa-out" : "wa-in"} ${primeira ? "wa-rabo" : ""}`} style={anexos.length ? { padding: 3 } : undefined}>
          {seta}
          {autor && <span className="block text-[12.5px] font-semibold mb-0.5" style={{ color: "var(--wa-green-ink)", padding: anexos.length ? "3px 6px 0" : 0 }}>{autor}</span>}
          {citada && (
            <div className="wa-cita" role="button" tabIndex={0} onClick={() => onIrPara(citada.id)} onKeyDown={(e) => { if (e.key === "Enter") onIrPara(citada.id); }}
              style={anexos.length ? { margin: "3px 3px 4px" } : undefined} title="Ir para a mensagem">
              <span className="block text-[12.5px] font-semibold" style={{ color: "var(--wa-green-ink)" }}>
                {citada.direcao === "out" ? (citada.autor_nome?.split(" ")[0] || "Equipe") : nomeCliente}
              </span>
              <span className="block text-[13px] line-clamp-2 wa-emoji" style={{ color: "var(--wa-meta)" }}>{trecho(citada)}</span>
            </div>
          )}
          {anexos.map((a, i) => (
            <div key={i} className={i ? "mt-1" : ""}>
              <MidiaDaMensagem a={a} texto={texto} minha={minha} nome={minha ? (m.autor_nome || "Equipe") : nomeCliente} onAbrirFoto={onAbrirFoto} hora={hora} />
            </div>
          ))}
          {semArquivo && <SemArquivo texto={texto} historico={m.origem === "historico"} />}
          {(texto && !semArquivo) || !(soMidia && anexos.every((a) => a.type === "image")) ? (
            <div className="wa-emoji" style={anexos.length ? { padding: "4px 6px 2px" } : undefined}>
              {texto && !semArquivo && <TextoWa texto={texto} />}
              {!(soMidia && anexos.every((a) => a.type === "image")) && <span className="wa-hora">{hora}</span>}
              <span className="block clear-both" />
            </div>
          ) : null}
        </div>
      </div>
      {reacoes}
    </>
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

function LigarFicha({ conversa, onFechar, onLigado, onCriar }: { conversa: Conversa | null; onFechar: () => void; onLigado: () => void; onCriar: (c: Conversa) => void }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const aberto = !!conversa;
  useEffect(() => { if (conversa) { setTermo(conversa.telefone.slice(-8)); setErro(null); } }, [conversa]);
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => { buscarClientes(termo, 10).then(setLista).catch(() => setLista([])); }, 250);
    return () => clearTimeout(t);
  }, [termo, aberto]);
  if (!conversa) return null;
  async function ligar(id: string) {
    try { await ligarAoCliente(conversa!.id, id); onLigado(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  return (
    <Modal aberto={aberto} titulo="Ligar a conversa a uma ficha" onFechar={onFechar}>
      <div className="space-y-3">
        <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nome, CPF ou telefone" autoFocus />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <ul className="rel-card overflow-hidden">
          {lista.length === 0 && <li className="p-3 text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém encontrado com essa busca.</li>}
          {lista.map((c) => (
            <li key={c.id}>
              <button onClick={() => ligar(c.id)} className="rel-linha w-full text-left px-3 py-2 text-[13px] flex justify-between gap-2" style={{ color: "var(--ink)" }}>
                <span className="font-semibold">{c.nome}</span>
                <span style={{ color: "var(--ink3)" }}>{formatarTelefone(c.telefone)}</span>
              </button>
            </li>
          ))}
        </ul>
        <Botao onClick={() => onCriar(conversa)}>+ Criar ficha nova com este número</Botao>
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

function Icone({ rotulo, onClick, ativo, children }: { rotulo: string; onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void; ativo?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} title={rotulo} aria-label={rotulo} aria-pressed={ativo}
      className="wa-icone w-10 h-10 inline-flex items-center justify-center flex-shrink-0" style={ativo ? { color: "var(--wa-green-ink)" } : undefined}>
      {children}
    </button>
  );
}

// ── Conversa ────────────────────────────────────────────────────────────────

function Painel({ id, meuId, meuNome, conversas, onVoltar, onMudou, onAbrirCliente, onAbrirViagem, onAbrirConversa, onMenuConversa, onLigarFicha, onNotaGuardada, avisar }: {
  id: string; meuId: string; meuNome: string; conversas: Conversa[];
  onVoltar: () => void; onMudou: () => void; onAbrirCliente: (id: string) => void;
  onAbrirViagem?: (id: string) => void; onAbrirConversa: (id: string) => void;
  onMenuConversa: (c: Conversa, pos: PosicaoMenu) => void; onLigarFicha: (c: Conversa) => void;
  onNotaGuardada: () => void; avisar: (t: string) => void;
}) {
  const [c, setC] = useState<Conversa | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [verRespostas, setVerRespostas] = useState(false);
  const [expressoes, setExpressoes] = useState<"emoji" | "figurinha" | null>(null);
  const [modelo, setModelo] = useState(false);
  const [chamado, setChamado] = useState<string | null>(null); // assunto
  const [chamados, setChamados] = useState<ChamadoK[]>([]);
  const [verChamado, setVerChamado] = useState<string | null>(null);
  const [foraPrazo, setForaPrazo] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previaUrl, setPreviaUrl] = useState<string | null>(null);
  const [legenda, setLegenda] = useState("");
  const [foto, setFoto] = useState<number | null>(null);
  const [respondendo, setRespondendo] = useState<Mensagem | null>(null);
  const [favoritas, setFavoritas] = useState<Set<string>>(new Set());
  const [menuMsg, setMenuMsg] = useState<{ m: Mensagem; pos: PosicaoMenu } | null>(null);
  const [reagirMais, setReagirMais] = useState<{ m: Mensagem; pos: PosicaoMenu } | null>(null);
  const [encaminhando, setEncaminhando] = useState<Mensagem | null>(null);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [buscaMsg, setBuscaMsg] = useState("");
  const [achadaIdx, setAchadaIdx] = useState(0);
  const [fixadaIdx, setFixadaIdx] = useState(0);
  const [sugIdx, setSugIdx] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const [piscando, setPiscando] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const buscaMsgRef = useRef<HTMLInputElement>(null);
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
    setRespondendo(null); setExpressoes(null); setBuscaAberta(false); setBuscaMsg(""); setFixadaIdx(0);
    void recarregar().then(() => { void marcarLida(id).then(onMudou); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { listarRespostas().then(setRespostas); minhasFavoritas().then(setFavoritas).catch(() => undefined); }, []);
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
      if (!buscaAberta) fimRef.current?.scrollIntoView({ block: "end" });
      if (qtdAnterior.current && c?.nao_lidas) void marcarLida(id);
      qtdAnterior.current = msgs.length;
    }
  }, [msgs.length, c?.nao_lidas, id, buscaAberta]);

  // "/" no começo do campo = respostas prontas pelo atalho (WhatsApp Business).
  const slash = /^\/(\S*)$/.exec(texto);
  const sugestoes = useMemo(() => {
    if (!slash || slashOff) return [];
    const t = slash[1].toLowerCase();
    return respostas.filter((r) => !t || (r.atalho || "").toLowerCase().startsWith(t) || r.titulo.toLowerCase().includes(t)).slice(0, 8);
  }, [slash, slashOff, respostas]);
  useEffect(() => { setSugIdx(0); if (!texto.startsWith("/")) setSlashOff(false); }, [texto]);

  // Busca dentro da conversa.
  const achadas = useMemo(() => {
    const t = buscaMsg.trim().toLowerCase();
    if (!t) return [];
    return msgs.filter((m) => (m.texto || "").toLowerCase().includes(t)).map((m) => m.id).reverse();
  }, [buscaMsg, msgs]);
  useEffect(() => { setAchadaIdx(0); }, [buscaMsg]);
  useEffect(() => {
    const alvo = achadas[achadaIdx];
    if (alvo) document.getElementById(`msg-${alvo}`)?.scrollIntoView({ block: "center" });
  }, [achadas, achadaIdx]);

  const porWamid = useMemo(() => new Map(msgs.map((m) => [m.wamid, m])), [msgs]);
  const fixadas = useMemo(() => msgs.filter((m) => m.fixada_em).sort((a, b) => (b.fixada_em || "").localeCompare(a.fixada_em || "")), [msgs]);

  const nome = c ? nomeDa(c) : "";
  // Todas as fotos da conversa, em ordem — o visualizador navega entre elas.
  const fotos: FotoDaConversa[] = useMemo(() => msgs.flatMap((m) => (m.anexos || [])
    .filter((a) => a.type === "image" && !ehFigurinha(a, m.texto || ""))
    .map((a) => ({ url: a.url, legenda: m.texto || "", quando: m.enviada_em, de: m.direcao === "out" ? (m.autor_nome || "Equipe") : nome }))), [msgs, nome]);

  // Atalhos que a página repassa pra cá (./atalhos).
  const atalhoRef = useRef<(a: AcaoAtalho) => void>(() => undefined);
  useEffect(() => {
    const ouvir = (e: Event) => atalhoRef.current((e as CustomEvent<AcaoAtalho>).detail);
    window.addEventListener(EVENTO_ATALHO, ouvir);
    return () => window.removeEventListener(EVENTO_ATALHO, ouvir);
  }, []);

  if (!c) {
    // Sem conversa carregada, atalho nenhum age (senão resolveria a anterior).
    atalhoRef.current = () => undefined;
    return (
    <div className="flex-1 flex items-center justify-center p-6 text-[13px] wa-fundo" style={{ color: "var(--wa-meta)" }} aria-live="polite">
      {erro ? <Aviso tom="erro">{erro}</Aviso> : "Carregando a conversa…"}
    </div>
    );
  }

  atalhoRef.current = (a) => {
    if (a === "emojis") setExpressoes((x) => (x === "emoji" ? null : "emoji"));
    if (a === "figurinhas") setExpressoes((x) => (x === "figurinha" ? null : "figurinha"));
    if (a === "buscarNaConversa") { setBuscaAberta(true); requestAnimationFrame(() => buscaMsgRef.current?.focus()); }
    if (a === "ficha") { if (c.cliente_id) onAbrirCliente(c.cliente_id); else onLigarFicha(c); }
    if (a === "resolver") void acao(() => (c.estado !== "resolvida" ? resolverConversa(c.id) : reabrirConversa(c.id)));
  };

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
      await enviarTexto(c!.id, t, respondendo?.id);
      setTexto(""); setRespondendo(null);
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

  function usarResposta(r: Resposta) {
    setTexto(preencherResposta(r.texto, c!.cliente_nome || c!.nome_contato, meuNome));
    setVerRespostas(false);
    requestAnimationFrame(() => { const el = campoRef.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); });
  }

  function irPara(msgId: string) {
    const el = document.getElementById(`msg-${msgId}`);
    if (!el) { avisar("Essa mensagem é antiga — não está entre as 300 carregadas."); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setPiscando(msgId);
    setTimeout(() => setPiscando((p) => (p === msgId ? null : p)), 1300);
  }

  async function reagirEm(m: Mensagem, emoji: string) {
    try { await reagir(c!.id, m.id, emoji); await recarregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não reagiu."); }
  }

  const deQuem = (m: Mensagem) => (m.direcao === "out" ? (m.autor_nome || "Equipe") : nome);

  function itensDaMensagem(m: Mensagem): ItemMenu[] {
    const minhaReacao = (m.reacoes || []).find((r) => r.de === meuId)?.emoji ?? null;
    const fav = favoritas.has(m.id);
    const fig = (m.anexos || []).length === 1 && ehFigurinha(m.anexos[0], m.texto || "");
    const itens: ItemMenu[] = [];
    if (c!.janela_aberta) itens.push({ tipo: "reacoes", emojis: REACOES, atual: minhaReacao, onEscolher: (e) => void reagirEm(m, e), onMais: () => setReagirMais({ m, pos: menuMsg?.pos ?? { x: 200, y: 200 } }) });
    if (c!.janela_aberta) itens.push({ rotulo: "Responder", icone: ICO.responder, onClick: () => { setRespondendo(m); campoRef.current?.focus(); } });
    if (m.texto) itens.push({ rotulo: "Copiar", icone: ICO.copiar, onClick: () => { void navigator.clipboard?.writeText(m.texto).then(() => avisar("Mensagem copiada.")); } });
    if (!(!(m.anexos || []).length && ehRotuloSemArquivo(m.texto || ""))) itens.push({ rotulo: "Encaminhar", icone: ICO.encaminhar, onClick: () => setEncaminhando(m) });
    itens.push({ rotulo: m.fixada_em ? "Desafixar" : "Fixar no topo da conversa", icone: ICO.fixar, onClick: () => void acao(() => fixarMensagem(m.id, !m.fixada_em)) });
    itens.push({
      rotulo: fav ? "Tirar a estrela" : "Marcar com estrela", icone: ICO.estrela, onClick: () => {
        setFavoritas((s) => { const n = new Set(s); if (fav) n.delete(m.id); else n.add(m.id); return n; });
        void favoritarMensagem(m.id, !fav).catch((e) => setErro(e instanceof Error ? e.message : "Falhou."));
      },
    });
    itens.push({ tipo: "separador" });
    itens.push({
      rotulo: "Guardar no bloco de notas", icone: ICO.nota, onClick: () => {
        void guardarMensagemNasNotas(m, c!, deQuem(m)).then(() => { onNotaGuardada(); avisar("Guardada no seu bloco de notas."); })
          .catch((e) => setErro(e instanceof Error ? e.message : "Não guardou."));
      },
    });
    if (fig) itens.push({ rotulo: "Salvar nas figurinhas do time", icone: ICO.figurinha, onClick: () => { void salvarFigurinha({ url: m.anexos[0].url }).then(() => avisar("Figurinha salva.")).catch((e) => setErro(e instanceof Error ? e.message : "Não salvou.")); } });
    itens.push({ rotulo: "Abrir chamado com esta mensagem", icone: ICO.chamado, onClick: () => setChamado(assuntoSugerido(m.texto || undefined)) });
    return itens;
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Respostas prontas pelo "/".
    if (sugestoes.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSugIdx((i) => (i + 1) % sugestoes.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSugIdx((i) => (i - 1 + sugestoes.length) % sugestoes.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); usarResposta(sugestoes[sugIdx]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSlashOff(true); return; }
    }
    const marca = marcaDoEvento(e);
    if (marca) {
      e.preventDefault();
      const r = envolver(e.currentTarget, texto, marca);
      setTexto(r.texto);
      requestAnimationFrame(() => campoRef.current?.setSelectionRange(r.ini, r.fim));
      return;
    }
    if (e.key === "Escape") {
      if (expressoes || verRespostas || respondendo) { e.preventDefault(); e.stopPropagation(); setExpressoes(null); setVerRespostas(false); setRespondendo(null); }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); }
  }

  const minha = c.atendente_id === meuId;
  // Assunto sugerido: a última coisa que o CLIENTE escreveu.
  const ultimaDoCliente = [...msgs].reverse().find((m) => m.direcao !== "out" && m.texto)?.texto;
  const indiceDaFoto = (url: string) => Math.max(0, fotos.findIndex((f) => f.url === url));
  const fixadaAtual = fixadas[fixadaIdx % Math.max(1, fixadas.length)];
  const porCategoria = respostas.reduce((m, r) => { const k = r.categoria || "Geral"; m.set(k, [...(m.get(k) || []), r]); return m; }, new Map<string, Resposta[]>());

  return (
    <div className="flex flex-col h-full min-h-0 wa">
      {/* Cabeçalho */}
      <div className="wa-cab flex items-center gap-2 px-2 sm:px-4 h-[60px] flex-shrink-0" style={{ borderBottom: "1px solid var(--wa-line)" }}>
        <button onClick={onVoltar} className="lg:hidden wa-icone w-10 h-10 inline-flex items-center justify-center" aria-label="Voltar para a lista">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => (c.cliente_id ? onAbrirCliente(c.cliente_id) : onLigarFicha(c))}
          title={c.cliente_id ? "Abrir a ficha do cliente (Ctrl+Alt+P)" : "Ligar a uma ficha"}>
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
          <Icone rotulo="Pesquisar na conversa (Ctrl+Alt+Shift+F)" onClick={() => { setBuscaAberta((v) => !v); requestAnimationFrame(() => buscaMsgRef.current?.focus()); }} ativo={buscaAberta}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></svg>
          </Icone>
          <Icone rotulo="Abrir chamado (pedido que não se resolve na hora)" onClick={() => setChamado(assuntoSugerido(ultimaDoCliente))}>
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
          <Icone rotulo="Mais opções da conversa" onClick={(e) => onMenuConversa(c, posicaoDoEvento(e))}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
          </Icone>
          {c.estado !== "resolvida"
            ? <button onClick={() => void acao(() => resolverConversa(c.id))} className="ml-1 h-9 px-3 rounded-full text-[13px] font-semibold wa-verde" title="Resolver (Ctrl+Alt+Shift+R)">Resolver</button>
            : <button onClick={() => void acao(() => reabrirConversa(c.id))} className="ml-1 h-9 px-3 rounded-full text-[13px] font-semibold border" style={{ borderColor: "var(--wa-line)", color: "var(--wa-txt)" }}>Reabrir</button>}
        </div>
      </div>

      {buscaAberta && (
        <div className="px-3 sm:px-4 py-2 flex items-center gap-2 flex-shrink-0 wa-cab" style={{ borderBottom: "1px solid var(--wa-line)" }}>
          <input ref={buscaMsgRef} value={buscaMsg} onChange={(e) => setBuscaMsg(e.target.value)} placeholder="Pesquisar mensagens…" aria-label="Pesquisar nesta conversa"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (achadas.length) setAchadaIdx((i) => (e.shiftKey ? (i - 1 + achadas.length) : (i + 1)) % achadas.length); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setBuscaAberta(false); setBuscaMsg(""); }
            }}
            className="wa-campo flex-1 h-9 px-3 text-[14px]" style={{ background: "var(--wa-head)" }} />
          <span className="text-[12.5px] w-16 text-center" style={{ color: "var(--wa-meta)" }} aria-live="polite">{buscaMsg ? (achadas.length ? `${achadaIdx + 1} de ${achadas.length}` : "nada") : ""}</span>
          <button className="wa-icone w-8 h-8" aria-label="Anterior" disabled={!achadas.length} onClick={() => setAchadaIdx((i) => (i + 1) % achadas.length)}>▲</button>
          <button className="wa-icone w-8 h-8" aria-label="Próxima" disabled={!achadas.length} onClick={() => setAchadaIdx((i) => (i - 1 + achadas.length) % achadas.length)}>▼</button>
          <button className="wa-icone w-8 h-8" aria-label="Fechar a busca" onClick={() => { setBuscaAberta(false); setBuscaMsg(""); }}>✕</button>
        </div>
      )}

      {fixadaAtual && (
        <div className="px-3 sm:px-4 h-12 flex items-center gap-3 flex-shrink-0 wa-cab" style={{ borderBottom: "1px solid var(--wa-line)" }}>
          {fixadas.length > 1 && (
            <span className="flex flex-col gap-0.5 self-stretch py-2" aria-hidden>
              {fixadas.map((f, i) => <span key={f.id} className="w-[3px] flex-1 rounded" style={{ background: i === fixadaIdx % fixadas.length ? "var(--wa-green)" : "var(--wa-line)" }} />)}
            </span>
          )}
          <span style={{ color: "var(--wa-meta)" }}>{PINO}</span>
          <button className="flex-1 min-w-0 text-left text-[13.5px] truncate wa-emoji" style={{ color: "var(--wa-txt)" }}
            onClick={() => { irPara(fixadaAtual.id); setFixadaIdx((i) => i + 1); }} title={fixadas.length > 1 ? "Ir pra mensagem (clique de novo pra próxima fixada)" : "Ir pra mensagem"}>
            {trecho(fixadaAtual)}
          </button>
          <button className="wa-icone w-8 h-8 inline-flex items-center justify-center" aria-label="Desafixar" title="Desafixar" onClick={() => void acao(() => fixarMensagem(fixadaAtual.id, false))}>✕</button>
        </div>
      )}

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
          const classe = achadas[achadaIdx] === m.id ? "wa-achada" : piscando === m.id ? "wa-piscar" : "";
          return (
            <div key={m.id} id={`msg-${m.id}`} className={classe}>
              {novoDia && <SeparadorDia iso={m.enviada_em} />}
              <Bolha m={m} primeira={primeira} nomeCliente={nome} meuId={meuId}
                citada={m.respondendo_a ? porWamid.get(m.respondendo_a) ?? null : null}
                favorita={favoritas.has(m.id)}
                onAbrirFoto={(u) => setFoto(indiceDaFoto(u))}
                onMenu={(mm, pos) => setMenuMsg({ m: mm, pos })}
                onIrPara={irPara} />
            </div>
          );
        })}
        <div ref={fimRef} className="h-1" />
      </div>

      {/* Escrever */}
      <div className="wa-cab px-2 sm:px-3 py-2 flex-shrink-0 space-y-2 relative">
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
            {sugestoes.length > 0 && (
              <ul className="rounded-xl overflow-hidden wa-menu max-h-64 overflow-y-auto" role="listbox" aria-label="Respostas prontas">
                {sugestoes.map((r, i) => (
                  <li key={r.id} role="option" aria-selected={i === sugIdx} className="wa-sug">
                    <button onMouseEnter={() => setSugIdx(i)} onClick={() => usarResposta(r)} className="w-full text-left px-3 py-2 flex gap-3 items-baseline">
                      <span className="text-[13px] font-bold flex-shrink-0" style={{ color: "var(--wa-green-ink)" }}>{r.atalho ? `/${r.atalho}` : "—"}</span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold" style={{ color: "var(--wa-txt)" }}>{r.titulo}</span>
                        <span className="block text-[12.5px] truncate" style={{ color: "var(--wa-meta)" }}>{r.texto}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {verRespostas && (
              <div className="rel-card max-h-60 overflow-y-auto">
                {respostas.length === 0 && <p className="p-3 text-[12px]" style={{ color: "var(--ink3)" }}>Nenhuma resposta pronta. A gestora cria em Atendimento → Modelos.</p>}
                {[...porCategoria.entries()].map(([cat, rs]) => (
                  <div key={cat}>
                    {porCategoria.size > 1 && <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{cat}</p>}
                    {rs.map((r) => (
                      <button key={r.id} onClick={() => usarResposta(r)} className="rel-linha w-full text-left px-3 py-2" style={{ borderBottom: "1px solid var(--line2)" }}>
                        <span className="flex gap-2 items-baseline">
                          <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{r.titulo}</span>
                          {r.atalho && <span className="text-[11.5px] font-bold" style={{ color: "var(--wa-green-ink)" }}>/{r.atalho}</span>}
                        </span>
                        <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{r.texto}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {expressoes && (
              <PainelExpressoes aba={expressoes} onAba={setExpressoes} onEmoji={porEmoji}
                onFigurinha={(f) => {
                  setExpressoes(null);
                  void enviarFigurinha(c.id, { figurinhaId: f.id }).then(() => recarregar().then(onMudou))
                    .catch((e) => setErro(e instanceof Error ? e.message : "Figurinha não enviada."));
                }} />
            )}
            {respondendo && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: "var(--wa-list)" }}>
                <div className="wa-cita flex-1 min-w-0 !mb-0">
                  <span className="block text-[12.5px] font-semibold" style={{ color: "var(--wa-green-ink)" }}>Respondendo a {respondendo.direcao === "out" ? (respondendo.autor_nome?.split(" ")[0] || "Equipe") : nome}</span>
                  <span className="block text-[13px] truncate wa-emoji" style={{ color: "var(--wa-meta)" }}>{trecho(respondendo)}</span>
                </div>
                <button className="wa-icone w-8 h-8 inline-flex items-center justify-center" aria-label="Cancelar resposta" onClick={() => setRespondendo(null)}>✕</button>
              </div>
            )}
            <div className="flex items-end gap-1">
              <Icone rotulo="Emojis (Ctrl+Alt+E)" onClick={() => { setExpressoes((v) => (v === "emoji" ? null : "emoji")); setVerRespostas(false); }} ativo={expressoes === "emoji"}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
              </Icone>
              <Icone rotulo="Figurinhas (Ctrl+Alt+S)" onClick={() => { setExpressoes((v) => (v === "figurinha" ? null : "figurinha")); setVerRespostas(false); }} ativo={expressoes === "figurinha"}>
                {ICO.figurinha}
              </Icone>
              <Icone rotulo="Respostas prontas (ou digite /)" onClick={() => { setVerRespostas((v) => !v); setExpressoes(null); }} ativo={verRespostas}>
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
                onKeyDown={aoTeclar}
                onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f) { e.preventDefault(); escolherArquivo(f); } }}
                rows={1}
                placeholder="Digite uma mensagem ou / pra resposta pronta"
                aria-label="Mensagem (Enter envia, Shift+Enter pula linha, Ctrl+B negrito, / respostas prontas)"
                className="wa-campo wa-emoji flex-1 resize-none px-3 py-2.5 text-[15px] leading-5 min-h-[42px]"
              />
              <button onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar mensagem"
                className="w-11 h-11 rounded-full inline-flex items-center justify-center wa-verde flex-shrink-0 disabled:opacity-50">
                {enviando ? "…" : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39 1.16L4.3 12l-2.29 7.24a1 1 0 0 0 1.39 1.16z" /></svg>}
              </button>
            </div>
          </>
        )}
      </div>

      <MenuContexto pos={menuMsg?.pos ?? null} itens={menuMsg ? itensDaMensagem(menuMsg.m) : []} onFechar={() => setMenuMsg(null)} rotulo="Opções da mensagem" />
      {reagirMais && (
        <div className="fixed inset-0 z-[1001]" onMouseDown={() => setReagirMais(null)} onKeyDown={(e) => { if (e.key === "Escape") setReagirMais(null); }}>
          <div className="wa wa-menu absolute rounded-xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}
            style={{ left: Math.min(reagirMais.pos.x, window.innerWidth - 340), top: Math.min(reagirMais.pos.y, window.innerHeight - 380) }}>
            <EmojiPicker compacto autoFocus onEscolher={(e) => { const m = reagirMais.m; setReagirMais(null); void reagirEm(m, e); }} />
          </div>
        </div>
      )}
      <EncaminharModal mensagem={encaminhando} conversas={conversas} onFechar={() => setEncaminhando(null)}
        onFeito={(t) => { setEncaminhando(null); avisar(t); onMudou(); }} />
      {foto !== null && fotos.length > 0 && <Visualizador fotos={fotos} indice={Math.min(foto, fotos.length - 1)} onFechar={() => setFoto(null)} onTrocar={setFoto} />}
      <ModeloModal
        aberto={modelo}
        alvo={{ conversaId: c.id }}
        nomeCliente={c.cliente_nome || c.nome_contato}
        onFechar={() => setModelo(false)}
        onEnviado={() => { setModelo(false); void recarregar(); onMudou(); }}
      />
      <ChamadoModal
        aberto={chamado !== null}
        inicial={{ clienteId: c.cliente_id ?? undefined, conversaId: c.id, assunto: chamado ?? "" }}
        onFechar={() => setChamado(null)}
        onSalvo={() => { setChamado(null); carregarChamados(); }}
      />
      <ChamadoDetalhe
        id={verChamado}
        onFechar={() => setVerChamado(null)}
        onMudou={carregarChamados}
        onAbrirCliente={onAbrirCliente}
        onAbrirViagem={onAbrirViagem}
        onAbrirConversa={onAbrirConversa}
      />
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
  const [chip, setChip] = useState<Chip>("tudo");
  const [verArquivadas, setVerArquivadas] = useState(false);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [listas, setListas] = useState<Lista[]>([]);
  const [menuConv, setMenuConv] = useState<{ c: Conversa; pos: PosicaoMenu } | null>(null);
  const [etiquetando, setEtiquetando] = useState<Conversa | null>(null);
  const [listando, setListando] = useState<{ c: Conversa | null } | null>(null);
  const [ligando, setLigando] = useState<Conversa | null>(null);
  const [salvandoContato, setSalvandoContato] = useState<Conversa | null>(null);
  const [nova, setNova] = useState(false);
  const [modeloPara, setModeloPara] = useState<string | null>(null);
  const [verAtalhos, setVerAtalhos] = useState(false);
  const [notas, setNotas] = useState(() => localStorage.getItem("rel_notas_abertas") === "1");
  const [sinalNotas, setSinalNotas] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const meuId = currentUser?.id ?? "";
  const meuNome = currentUser?.name ?? "";

  const carregar = useCallback(async () => {
    try { setConversas(await listarConversas(filtro, meuId, busca)); }
    catch { /* mantém a lista anterior; tenta de novo no próximo ciclo */ }
    finally { setCarregando(false); }
  }, [filtro, meuId, busca]);
  const carregarOrganizacao = useCallback(() => {
    listarEtiquetas().then(setEtiquetas).catch(() => undefined);
    listarListas().then(setListas).catch(() => undefined);
  }, []);

  useEffect(() => {
    setCarregando(true);
    const t = setTimeout(() => { void carregar(); }, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);
  useRepetir(() => { void carregar(); }, 10_000);
  useEffect(() => { statusDoNumero().then(setNumero).catch(() => setNumero(null)); carregarOrganizacao(); }, [carregarOrganizacao]);
  useEffect(() => { localStorage.setItem("rel_notas_abertas", notas ? "1" : "0"); }, [notas]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3200); return () => clearTimeout(t); }, [aviso]);

  const mudou = () => { void carregar(); onMudou(); };
  const esperando = conversas.filter((c) => c.aguardando_desde && !c.arquivada).length;
  const mapaEtq = useMemo(() => new Map(etiquetas.map((e) => [e.id, e])), [etiquetas]);

  // O que aparece na lista: arquivadas à parte, chip do topo, fixadas em cima.
  const arquivadas = useMemo(() => conversas.filter((c) => c.arquivada), [conversas]);
  const visiveis = useMemo(() => {
    const base = conversas.filter((c) => (verArquivadas ? c.arquivada : !c.arquivada)).filter((c) => {
      if (verArquivadas || chip === "tudo") return true;
      if (chip === "nao_lidas") return naoLida(c);
      if (chip === "favoritas") return c.favorita;
      if (chip === "esperando") return !!c.aguardando_desde;
      if (chip.startsWith("lista:")) return (c.listas || []).includes(chip.slice(6));
      if (chip.startsWith("etq:")) return (c.etiquetas || []).includes(chip.slice(4));
      return true;
    });
    return [...base].sort((a, b) => (b.fixada_em || "").localeCompare(a.fixada_em || ""));
  }, [conversas, verArquivadas, chip]);
  // Chip de uma lista/etiqueta que foi apagada volta pro "Tudo".
  useEffect(() => {
    if (chip.startsWith("lista:") && !listas.some((l) => `lista:${l.id}` === chip)) setChip("tudo");
    if (chip.startsWith("etq:") && !etiquetas.some((e) => `etq:${e.id}` === chip)) setChip("tudo");
  }, [chip, listas, etiquetas]);

  async function pref(c: Conversa, campos: PrefConversa, msg?: string) {
    if (campos.fixada_em && (await contarFixadas(meuId)) >= MAX_FIXADAS) {
      setAviso(`Dá pra fixar no máximo ${MAX_FIXADAS} conversas (igual ao WhatsApp).`);
      return;
    }
    // Arquivar solta o "fixar" (o WhatsApp faz igual).
    const final: PrefConversa = campos.arquivada ? { ...campos, fixada_em: null } : campos;
    setConversas((l) => l.map((x) => (x.id === c.id ? { ...x, ...final } : x)));
    try { await mudarPreferencia(c.id, meuId, final); if (msg) setAviso(msg); }
    catch (e) { setAviso(e instanceof Error ? e.message : "Não salvou."); }
    void carregar();
  }

  function abrirConversa(id: string | null) {
    if (id) {
      const c = conversas.find((x) => x.id === id);
      if (c?.marcada_nao_lida) void pref(c, { marcada_nao_lida: false });
    }
    abrir(id);
  }

  function itensDaConversa(c: Conversa): ItemMenu[] {
    const nl = naoLida(c);
    return [
      { rotulo: c.arquivada ? "Desarquivar conversa" : "Arquivar conversa", icone: ICO.arquivar, atalho: "Ctrl+Alt+Shift+E",
        onClick: () => { void pref(c, { arquivada: !c.arquivada }, c.arquivada ? "Conversa desarquivada." : "Conversa arquivada."); if (!c.arquivada && c.id === conversaId) abrir(null); } },
      { rotulo: c.silenciada ? "Reativar notificações" : "Silenciar notificações", icone: c.silenciada ? ICO.som : ICO.silenciar, atalho: "Ctrl+Alt+Shift+M", onClick: () => void pref(c, { silenciada: !c.silenciada }) },
      { rotulo: c.fixada_em ? "Desafixar conversa" : "Fixar conversa", icone: ICO.fixar, atalho: "Ctrl+Alt+Shift+P", onClick: () => void pref(c, { fixada_em: c.fixada_em ? null : new Date().toISOString() }) },
      { rotulo: nl ? "Marcar como lida" : "Marcar como não lida", icone: nl ? ICO.lida : ICO.naoLida, atalho: "Ctrl+Alt+Shift+U",
        onClick: () => { if (nl) { void pref(c, { marcada_nao_lida: false }); void marcarLida(c.id).then(() => carregar()); } else void pref(c, { marcada_nao_lida: true }); } },
      { rotulo: c.favorita ? "Tirar dos favoritos" : "Adicionar aos favoritos", icone: ICO.estrela, onClick: () => void pref(c, { favorita: !c.favorita }) },
      { tipo: "separador" },
      { rotulo: "Etiquetar…", icone: ICO.etiqueta, onClick: () => setEtiquetando(c) },
      { rotulo: "Adicionar a uma lista…", icone: ICO.lista, onClick: () => setListando({ c }) },
      { tipo: "separador" },
      c.cliente_id
        ? { rotulo: "Abrir a ficha do cliente", icone: ICO.ficha, atalho: "Ctrl+Alt+P", onClick: () => onAbrirCliente(c.cliente_id!) }
        : { rotulo: "Salvar contato (criar ficha)", icone: ICO.contato, onClick: () => setSalvandoContato(c) },
      ...(!c.cliente_id ? [{ rotulo: "Ligar a uma ficha que já existe", icone: ICO.ficha, onClick: () => setLigando(c) } as ItemMenu] : []),
      c.estado !== "resolvida"
        ? { rotulo: "Resolver conversa", icone: ICO.resolver, atalho: "Ctrl+Alt+Shift+R", onClick: () => { void resolverConversa(c.id).then(mudou).catch((e) => setAviso(e instanceof Error ? e.message : "Falhou.")); } }
        : { rotulo: "Reabrir conversa", icone: ICO.resolver, onClick: () => { void reabrirConversa(c.id).then(mudou).catch((e) => setAviso(e instanceof Error ? e.message : "Falhou.")); } },
    ];
  }

  // Atalhos de teclado do WhatsApp Web (./atalhos).
  const atalhoRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  atalhoRef.current = (e: KeyboardEvent) => {
    if (visao !== "conversas") return;
    const a = atalhoDoEvento(e);
    if (!a) return;
    // Com janela aberta (modelo, chamado, ficha…) os atalhos ficam quietos — trocar
    // de conversa por baixo mandaria o modelo pro cliente errado.
    if (document.querySelector('[aria-modal="true"]') && a !== "ajuda") return;
    e.preventDefault();
    e.stopPropagation();
    const atual = conversas.find((c) => c.id === conversaId) || null;
    switch (a) {
      case "nova": setNova(true); break;
      case "buscar": setVerArquivadas(false); buscaRef.current?.focus(); buscaRef.current?.select(); break;
      case "ajuda": setVerAtalhos(true); break;
      case "notas": setNotas((v) => !v); break;
      case "proxima": case "anterior": {
        if (!visiveis.length) break;
        const i = visiveis.findIndex((c) => c.id === conversaId);
        const n = a === "proxima" ? (i + 1) % visiveis.length : i <= 0 ? visiveis.length - 1 : i - 1;
        abrirConversa(visiveis[n].id);
        break;
      }
      case "fixar": if (atual) void pref(atual, { fixada_em: atual.fixada_em ? null : new Date().toISOString() }); break;
      case "naoLida": if (atual) { if (naoLida(atual)) void pref(atual, { marcada_nao_lida: false }); else { void pref(atual, { marcada_nao_lida: true }); abrir(null); } } break;
      case "silenciar": if (atual) void pref(atual, { silenciada: !atual.silenciada }, atual.silenciada ? "Notificações reativadas." : "Conversa silenciada."); break;
      case "arquivar": if (atual) { void pref(atual, { arquivada: !atual.arquivada }, atual.arquivada ? "Conversa desarquivada." : "Conversa arquivada."); if (!atual.arquivada) abrir(null); } break;
      default: window.dispatchEvent(new CustomEvent(EVENTO_ATALHO, { detail: a }));
    }
  };
  useEffect(() => {
    const ouvir = (e: KeyboardEvent) => atalhoRef.current(e);
    window.addEventListener("keydown", ouvir, true);
    return () => window.removeEventListener("keydown", ouvir, true);
  }, []);

  const conversaAtual = conversas.find((c) => c.id === conversaId) || null;

  const abas = (
    <div className="flex items-end gap-1 px-3 sm:px-4 h-11 border-b" style={{ borderColor: "var(--line)", background: "var(--card)" }} role="tablist" aria-label="Atendimento">
      {([["conversas", "Conversas"], ["chamados", "Chamados"]] as [VisaoAtendimento, string][]).map(([v, r]) => (
        <button key={v} onClick={() => trocarVisao(v)} role="tab" aria-selected={visao === v}
          className="h-11 px-3 text-[13px] font-semibold flex items-center gap-1.5 -mb-px transition-colors"
          style={visao === v
            ? { color: "var(--rel-ink)", borderBottom: "2px solid var(--rel)" }
            : { color: "var(--ink2)", borderBottom: "2px solid transparent" }}>
          {r}
          {v === "conversas" && esperando > 0 && <EtiquetaUi tom="aviso">{esperando}</EtiquetaUi>}
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
      <style>{EMOJI_FONT_CSS}</style>
      <style>{WA_CSS + EXTRA_CSS}</style>
      {abas}
      {numero && !numero.conectado && (
        <div className="px-4 py-2 text-[13px] flex flex-wrap items-center gap-2" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          O número de WhatsApp do Relacionamento ainda não está conectado — as conversas não chegam.
          {onAbrirWhatsApp && <button className="underline font-semibold" onClick={onAbrirWhatsApp}>Conectar agora</button>}
        </div>
      )}
      {/* Altura da tela inteira (no celular, menos a barra do topo de 56px), menos as abas (44px). */}
      <div className="flex h-[calc(100dvh-100px)] lg:h-[calc(100dvh-44px)] relative">
        <aside
          className={`${conversaId ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[380px] xl:w-[420px] lg:flex-shrink-0 border-r min-h-0 wa-lista`}
          style={{ borderColor: "var(--wa-line)" }}
        >
          <Lista
            busca={busca} setBusca={setBusca} buscaRef={buscaRef}
            conversas={visiveis} selecionada={conversaId} abrir={abrirConversa} carregando={carregando}
            chip={chip} setChip={setChip} listas={listas} etiquetas={mapaEtq}
            arquivadas={arquivadas} verArquivadas={verArquivadas} setVerArquivadas={setVerArquivadas}
            onMenu={(c, pos) => setMenuConv({ c, pos })}
            onNova={() => setNova(true)} onNotas={() => setNotas((v) => !v)} notasAbertas={notas}
            onAtalhos={() => setVerAtalhos(true)} onListas={() => setListando({ c: null })}
          />
        </aside>
        <section className={`${conversaId ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0 min-h-0`}>
          {conversaId ? (
            <Painel key={conversaId} id={conversaId} meuId={meuId} meuNome={meuNome} conversas={conversas}
              onVoltar={() => abrir(null)} onMudou={mudou} onAbrirCliente={onAbrirCliente}
              onAbrirViagem={onAbrirViagem} onAbrirConversa={(id) => abrirConversa(id)}
              onMenuConversa={(c, pos) => setMenuConv({ c, pos })} onLigarFicha={setLigando}
              onNotaGuardada={() => { setSinalNotas((n) => n + 1); }} avisar={setAviso} />
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
              <p className="text-[12.5px] mt-4" style={{ color: "var(--wa-meta)" }}>
                Clique com o botão direito numa conversa ou mensagem pra ver as opções · <button className="underline" onClick={() => setVerAtalhos(true)}>atalhos do teclado</button> (Ctrl+/)
              </p>
            </div>
          )}
        </section>
        {notas && (
          <aside className="absolute inset-0 lg:static lg:inset-auto lg:w-[360px] lg:flex-shrink-0 border-l min-h-0 z-20 wa-lista" style={{ borderColor: "var(--wa-line)" }}>
            <BlocoDeNotas conversaAtual={conversaAtual ? { id: conversaAtual.id, nome: nomeDa(conversaAtual) } : null}
              onAbrirConversa={(id) => abrirConversa(id)} onFechar={() => setNotas(false)} sinal={sinalNotas} />
          </aside>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1100] px-4 py-2.5 rounded-lg text-[14px] shadow-lg" role="status"
          style={{ background: "#3B4A54", color: "#fff" }}>{aviso}</div>
      )}

      <MenuContexto pos={menuConv?.pos ?? null} itens={menuConv ? itensDaConversa(menuConv.c) : []} onFechar={() => setMenuConv(null)} rotulo="Opções da conversa" />
      <EtiquetasModal aberto={!!etiquetando} conversa={etiquetando && (conversas.find((x) => x.id === etiquetando.id) || etiquetando)} etiquetas={etiquetas}
        onFechar={() => setEtiquetando(null)} onMudou={() => { carregarOrganizacao(); void carregar(); }} />
      <ListasModal aberto={!!listando} conversa={listando?.c ? (conversas.find((x) => x.id === listando.c!.id) || listando.c) : null} listas={listas}
        onFechar={() => setListando(null)} onMudou={() => { carregarOrganizacao(); void carregar(); }} />
      <LigarFicha conversa={ligando} onFechar={() => setLigando(null)} onLigado={() => { setLigando(null); mudou(); }}
        onCriar={(c) => { setLigando(null); setSalvandoContato(c); }} />
      <ClienteForm aberto={!!salvandoContato} cliente={null}
        inicial={salvandoContato ? { nome: salvandoContato.nome_contato, telefone: salvandoContato.telefone } : undefined}
        onFechar={() => setSalvandoContato(null)}
        onSalvo={(cl) => {
          const c = salvandoContato;
          setSalvandoContato(null);
          // Telefone igual já liga sozinho; se não ligou (número diferente), liga aqui.
          if (c) void ligarAoCliente(c.id, cl.id).catch(() => undefined).then(mudou);
          setAviso("Contato salvo e ligado à conversa.");
        }}
        onAbrirFicha={onAbrirCliente} />
      <NovaConversaModal aberto={nova} conversas={conversas} onFechar={() => setNova(false)}
        onAbrir={(id) => { setNova(false); setVerArquivadas(false); abrirConversa(id); }}
        onModelo={(fone) => { setNova(false); setModeloPara(fone); }} />
      <ModeloModal aberto={!!modeloPara} alvo={{ telefone: modeloPara ?? undefined }} nomeCliente={null}
        onFechar={() => setModeloPara(null)}
        onEnviado={(id) => { setModeloPara(null); setAviso("Modelo enviado. Quando a pessoa responder, a conversa libera."); void carregar().then(() => { if (id) abrirConversa(id); }); }} />
      <AtalhosModal aberto={verAtalhos} onFechar={() => setVerAtalhos(false)} />
    </div>
  );
}
