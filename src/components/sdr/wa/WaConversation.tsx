// src/components/sdr/wa/WaConversation.tsx
// -----------------------------------------------------------------------------
// A conversa de WhatsApp de UM lead, renderizada pelo próprio QS.
//
// Lê as mensagens direto do Supabase (a RLS de 0024/0025 garante que só aparecem
// as dos leads deste SDR) e escuta o realtime pra mensagem nova cair na tela sem
// F5. Ao abrir, sincroniza com o Chatwoot pra trazer o histórico recente.
//
// Escrever manda por /api/wa-send; áudio/imagem/arquivo por /api/wa-send-media.
// Nenhum dos dois confia no navegador: o servidor revalida a posse do lead.
// -----------------------------------------------------------------------------

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { lazyPagina } from "@/lib/qs/lazyPagina";
import ErroDeParte from "../ErroDeParte";
import {
  listMessages, markThreadRead, sendWaMessage, sendWaMedia, subscribeToMessages, syncThread,
  listCanned, preencherCanned, comprimirImagem, downloadHistory, listWaNumeros, getThreadInbox,
  reagirMensagem, salvarFigurinha, enviarFigurinha, apagarMensagem,
  listWaModelos, sendWaTemplate, janelaFechaEm, humanizarJanela,
  type WaMessage, type CannedResponse, type WaNumero, type Figurinha, type WaReacao, type WaModelo,
} from "@/lib/qs/waInbox";
import WaMenuContexto, { IconeMenu, PATHS, useToqueLongo, type ItemMenu, type PosMenu } from "./WaMenuContexto";
import { confirmar } from "@/lib/qs/confirmar";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { loadSignatureName } from "@/lib/qs/waSignature";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { WaAudio, WaAvatar, WaSeloNumero } from "./WaBits";
import { WaTexto, tamanhoEmojiSolto, waPlain } from "./waFormat";

// O seletor carrega junto com a lista de emojis, e só quando a SDR abre pela
// primeira vez — não é peso que todo mundo paga pra ver a conversa.
const WaEmojiPicker = lazyPagina(() => import("./WaEmojiPicker"));
// Mesma regra pra galeria de figurinhas.
const WaFigurinhas = lazyPagina(() => import("./WaFigurinhas"));
// E pro painel de modelos da Meta (só quem atende pelo número oficial abre).
const WaModelos = lazyPagina(() => import("./WaModelos"));

// As seis do WhatsApp — reagir de novo com a mesma troca por remoção.
const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** É uma figurinha? (um anexo de imagem .webp, sem texto junto) */
function urlDeFigurinha(m: WaMessage): string | null {
  if (m.content || m.attachments?.length !== 1) return null;
  const a = m.attachments[0];
  if (a.type !== "image" || !/\.webp($|\?)/i.test(a.url)) return null;
  return a.url;
}

/** Agrupa por emoji pra "pill": 👍 2 (com os nomes no title). */
function agruparReacoes(rs: WaReacao[]) {
  const mapa = new Map<string, { emoji: string; n: number; nomes: string[] }>();
  for (const r of rs) {
    const g = mapa.get(r.emoji) ?? { emoji: r.emoji, n: 0, nomes: [] };
    g.n += 1;
    g.nomes.push(r.nome || (r.autor === "lead" ? "Cliente" : "SDR"));
    mapa.set(r.emoji, g);
  }
  return [...mapa.values()];
}


interface Props {
  leadId: string;
  leadName?: string | null;
  phone?: string | null;
  /** Roteiro da atividade da cadência, quando o SDR veio de uma tarefa. */
  initialText?: string | null;
}

/**
 * O recibo do WhatsApp (✓ enviada, ✓✓ entregue, ✓✓ azul lida, ⚠ falhou).
 *
 * Só em mensagem NOSSA — no WhatsApp o recibo da mensagem do outro não existe.
 * `null` quando o banco ainda não tem a coluna (migration 0045) ou quando o
 * Chatwoot não informou: melhor nada do que inventar um estado.
 *
 * O "falhou" é o que mais importa e o que menos aparece: hoje uma mensagem
 * recusada (fora da janela de 24h no número oficial, por exemplo) fica na tela
 * exatamente igual a uma entregue.
 */
function Recibo({ status }: { status?: string | null }) {
  if (!status) return null;

  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: "var(--red)" }}
            title="Não foi entregue. Fora da janela de 24h no número oficial é a causa mais comum.">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M12 8v5M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />
        </svg>
        falhou
      </span>
    );
  }

  const lida = status === "read";
  const duplo = lida || status === "delivered";
  const titulo = lida ? "Lida" : status === "delivered" ? "Entregue no aparelho" : "Enviada";

  return (
    <span title={titulo} aria-label={titulo} className="inline-flex shrink-0"
          style={{ color: lida ? "var(--wa-bright)" : "currentColor", opacity: lida ? 1 : 0.75 }}>
      <svg width={duplo ? 16 : 12} height="12" viewBox={duplo ? "0 0 20 14" : "0 0 14 14"}
           fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"
           strokeLinejoin="round" aria-hidden>
        <path d="M1 7.5 4.5 11 11 3" />
        {duplo && <path d="M8 7.5 11.5 11 18 3" />}
      </svg>
    </span>
  );
}

function DiaSeparador({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
            style={{ color: "var(--ink3)", background: "var(--card2)" }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
    </div>
  );
}

function diaLabel(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mmss(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function Anexo({ a, meu }: { a: { type: string; url: string }; meu: boolean }) {
  if (a.type === "image") {
    // minHeight reserva o espaço: sem isso a imagem empurra a conversa ao
    // carregar, e o auto-scroll joga o SDR pra cima justo quando chega foto.
    return (
      <a href={a.url} target="_blank" rel="noreferrer"
         className="block mb-1 rounded-xl overflow-hidden"
         style={{ background: "var(--card2)", minHeight: 120, maxWidth: 240 }}>
        <img src={a.url} alt="Imagem enviada na conversa" loading="lazy" decoding="async"
             className="block w-full h-auto max-h-56 object-cover" />
      </a>
    );
  }
  if (a.type === "audio") return <WaAudio url={a.url} meu={meu} />;
  if (a.type === "video") {
    return <video src={a.url} controls preload="none" className="mb-1 rounded-xl max-h-56" />;
  }
  return (
    <a href={a.url} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1.5 mb-1 text-[12px] font-semibold underline"
       style={{ color: meu ? "var(--wa-ink)" : "var(--wa)" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
      </svg>
      Abrir anexo
    </a>
  );
}

export default function WaConversation({ leadId, leadName, phone, initialText }: Props) {
  const { currentUser } = useQsAuth();
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semConversa, setSemConversa] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Nome com que este SDR assina. Quem carimba é o /api/wa-send; isto aqui é só
  // pra ele não descobrir depois, olhando a conversa do cliente.
  const [assinatura, setAssinatura] = useState("");

  // Respostas prontas (/atalho)
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [mostrarCanned, setMostrarCanned] = useState(false);

  // Emojis
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  // Figurinhas (galeria) e reações
  const [mostrarFigurinhas, setMostrarFigurinhas] = useState(false);
  // Qual mensagem está com a paleta de reação aberta (id) — uma por vez.
  const [reagindoA, setReagindoA] = useState<string | null>(null);
  // Onde estava o cursor no campo de escrever. Precisa ser lembrado por fora
  // porque escolher um emoji NÃO devolve o foco pro textarea — quem clicou em
  // três emojis seguidos, ou buscou "aviao", perderia o lugar a cada clique.
  const caretRef = useRef<number | null>(null);

  // Por qual dos NOSSOS números esta conversa acontece. É informação, não
  // escolha: quem decide é a conversa que já existe no Chatwoot. O SDR precisa
  // saber disso antes de escrever, porque é o número que o cliente vê chegando.
  const [numeros, setNumeros] = useState<WaNumero[]>([]);
  const [inboxAtual, setInboxAtual] = useState<number | null>(null);
  const [avatarLead, setAvatarLead] = useState<string | null>(null);

  // Modelos da Meta + o relógio da janela de 24h (só valem no número oficial).
  const [modelos, setModelos] = useState<WaModelo[]>([]);
  const [mostrarModelos, setMostrarModelos] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  // O `enviar` nasce antes do cálculo da janela — o ref carrega o valor até lá.
  const soModeloRef = useRef(false);

  // Gravação de áudio
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  // Espelho em ref: o onstop do MediaRecorder é criado uma vez e enxergaria o
  // `segundos` congelado em 0 — todo áudio seria descartado como "muito curto".
  const segundosRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelarRef = useRef(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Só rola sozinho se o SDR já estava no fim — senão atrapalha quem está lendo
  // uma mensagem antiga lá em cima.
  const stickToBottom = useRef(true);

  const recarregar = useCallback(async () => {
    const list = await listMessages(leadId);
    setMessages(list);
    return list;
  }, [leadId]);

  // ── Menu do botão direito + responder citando ─────────────────────────────
  const [menu, setMenu] = useState<{ pos: PosMenu; m: WaMessage } | null>(null);
  const [respondendo, setRespondendo] = useState<WaMessage | null>(null);
  const alvoToque = useRef<WaMessage | null>(null);
  const toque = useToqueLongo(useCallback((pos: PosMenu) => {
    if (alvoToque.current) setMenu({ pos, m: alvoToque.current });
  }, []));

  const apagar = useCallback(async (m: WaMessage) => {
    const ok = await confirmar({
      titulo: "Apagar esta mensagem no WhatsApp do cliente?",
      mensagem: "Ela some do aparelho dele e não dá pra desfazer. Aqui no QS a mensagem CONTINUA no histórico, marcada como apagada.",
      confirmarLabel: "Apagar no WhatsApp",
      recusarLabel: "Manter",
    });
    if (!ok) return;
    const r = await apagarMensagem(leadId, m.id);
    if (!r.ok) { notifyError(r.error || "Não consegui apagar."); return; }
    // Otimista: só a marca. O conteúdo fica — o QS é o arquivo da conversa.
    setMessages((prev) => prev.map((x) =>
      x.id === m.id ? { ...x, deleted_at: new Date().toISOString() } : x
    ));
    notifySuccess("Apagada no WhatsApp do cliente. Continua aqui no histórico.");
  }, [leadId]);

  const copiar = useCallback(async (m: WaMessage) => {
    const t = waPlain(m.content) || "";
    if (!t) { notifyError("Esta mensagem não tem texto para copiar."); return; }
    try {
      await navigator.clipboard.writeText(t);
      notifySuccess("Mensagem copiada.");
    } catch {
      notifyError("O navegador bloqueou a cópia.");
    }
  }, []);

  const itensMenu = useCallback((m: WaMessage): ItemMenu[] => {
    const apagada = Boolean(m.deleted_at);
    return [
      {
        id: "responder",
        label: "Responder",
        icone: <IconeMenu d={PATHS.responder} />,
        escondido: apagada,
        onClick: () => { setRespondendo(m); taRef.current?.focus(); },
      },
      {
        id: "reagir",
        label: "Reagir",
        icone: <IconeMenu d={PATHS.reagir} />,
        // Reagir e responder dependem da mensagem existir no aparelho do
        // cliente — apagada lá fora, o WhatsApp não teria em que pendurar.
        escondido: apagada,
        // Abre a MESMA paleta do hover: quem usa mouse continua no atalho
        // rápido, e quem está no celular chega nela pelo menu.
        onClick: () => setReagindoA(m.id),
      },
      {
        id: "copiar",
        label: "Copiar texto",
        icone: <IconeMenu d={PATHS.copiar} />,
        // Copiar continua valendo em mensagem apagada: o texto segue aqui, e
        // copiar é operação local — não toca no WhatsApp de ninguém.
        escondido: !m.content,
        onClick: () => void copiar(m),
      },
      {
        id: "apagar",
        label: "Apagar no WhatsApp",
        icone: <IconeMenu d={PATHS.apagar} />,
        perigo: true,
        // O WhatsApp só deixa apagar o que é NOSSO. Esconder é mais honesto do
        // que oferecer e devolver erro depois do clique.
        escondido: apagada || m.direction !== "out",
        onClick: () => void apagar(m),
      },
    ];
  }, [apagar, copiar]);

  useEffect(() => { listCanned().then(setCanned); }, []);
  useEffect(() => { listWaNumeros().then(setNumeros); }, []);
  useEffect(() => { listWaModelos().then(setModelos); }, []);
  useEffect(() => { void loadSignatureName(currentUser).then(setAssinatura); }, [currentUser]);

  // Carga inicial + sincronização com o Chatwoot.
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    setAviso(null);
    setSemConversa(false);
    setMostrarEmojis(false);
    setMostrarFigurinhas(false);
    setMostrarModelos(false);
    setReagindoA(null);
    stickToBottom.current = true;
    caretRef.current = null;
    setText(initialText || "");

    (async () => {
      const local = await listMessages(leadId);
      if (!vivo) return;
      setMessages(local);
      setLoading(false);

      setSyncing(true);
      const r = await syncThread(leadId);
      if (!vivo) return;
      setSyncing(false);
      if (r.importadas > 0) await recarregar();
      if (!r.conversationId && local.length === 0) setSemConversa(true);
      markThreadRead(leadId);
      // Depois do sync, porque é ele que descobre/grava a caixa da conversa.
      getThreadInbox(leadId).then((m) => {
        if (!vivo) return;
        setInboxAtual(m.inbox);
        setAvatarLead(m.avatar);
      });
    })();

    return () => { vivo = false; };
  }, [leadId, recarregar, initialText]);

  // Realtime: mensagem nova (dos dois lados) entra sem recarregar — e mudança
  // numa mensagem que já está na tela (reação que chegou/saiu) atualiza a bolha.
  useEffect(() => {
    const off = subscribeToMessages(
      leadId,
      (nova) => {
        setMessages((prev) => (prev.some((m) => m.id === nova.id) ? prev : [...prev, nova]));
        markThreadRead(leadId);
      },
      (mudou) => {
        setMessages((prev) => prev.map((m) => (m.id === mudou.id ? { ...m, ...mudou } : m)));
      }
    );
    return off;
  }, [leadId]);

  // Paleta de reação fecha ao clicar em qualquer outro lugar (ou com Esc, no
  // handler do teclado). Tudo que pertence à paleta carrega data-wa-react.
  useEffect(() => {
    if (!reagindoA) return;
    const fechar = (ev: PointerEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el?.closest?.("[data-wa-react]")) return;
      setReagindoA(null);
    };
    document.addEventListener("pointerdown", fechar);
    return () => document.removeEventListener("pointerdown", fechar);
  }, [reagindoA]);

  // ── Rede de segurança do tempo real ────────────────────────────────────────
  // O realtime funciona (testado de ponta a ponta), mas ele é um WEBSOCKET numa
  // aba que fica aberta o dia inteiro: notebook que dorme, wi-fi que troca,
  // proxy que derruba conexão ociosa. Quando isso acontece, o socket volta mas
  // as mensagens do intervalo NÃO chegam — elas não são reenviadas.
  //
  // Por isso: recarrega quando a aba volta ao foco e a cada 45s enquanto a
  // conversa está aberta e visível. É barato (uma consulta, filtrada por lead) e
  // transforma "sumiu uma mensagem" em "apareceu 45 segundos depois".
  useEffect(() => {
    let parado = false;

    const sincronizar = async () => {
      if (parado || document.hidden) return;
      const list = await listMessages(leadId);
      if (parado) return;
      // Só mexe no estado se algo mudou — senão a lista re-renderiza à toa e o
      // scroll pode saltar debaixo de quem está lendo.
      setMessages((prev) => (prev.length === list.length && prev[prev.length - 1]?.id === list[list.length - 1]?.id ? prev : list));
    };

    const aoVoltar = () => { if (!document.hidden) void sincronizar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    const t = setInterval(() => void sincronizar(), 45_000);

    return () => {
      parado = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [leadId]);

  useLayoutEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Cresce com o texto. Zera a altura antes de medir, senão o campo só aumenta
  // e nunca volta ao encolher.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [text]);

  // Solta o microfone se o componente sumir no meio de uma gravação.
  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const enviar = useCallback(async () => {
    const corpo = text.trim();
    if (!corpo || sending) return;
    // Janela de 24h fechada no número oficial: a Meta vai recusar texto livre.
    // Barrar AQUI, com o caminho certo aberto, é melhor que "enviar" e a
    // mensagem morrer no meio sem o SDR saber.
    if (soModeloRef.current) {
      setErro("A janela de 24h fechou — pela API oficial, agora só sai modelo aprovado. Escolha um abaixo.");
      setMostrarModelos(true);
      return;
    }
    setSending(true);
    setErro(null);
    const r = await sendWaMessage(leadId, corpo, undefined, respondendo?.id ?? null);
    setSending(false);
    if (!r.ok) { setErro(r.error || "Não consegui enviar."); return; }
    setText("");
    setRespondendo(null);
    setMostrarCanned(false);
    setMostrarEmojis(false);
    caretRef.current = null;
    setSemConversa(false);
    stickToBottom.current = true;
    await recarregar();
  }, [text, sending, leadId, recarregar, respondendo?.id]);

  const enviarMidia = useCallback(async (blob: Blob, nome: string, legenda = "", notaDeVoz = false) => {
    setSending(true);
    setErro(null);
    const r = await sendWaMedia(leadId, blob, nome, legenda, notaDeVoz);
    setSending(false);
    if (!r.ok) { setErro(r.error || "Não consegui enviar o arquivo."); return; }
    setSemConversa(false);
    stickToBottom.current = true;
    await recarregar();
  }, [leadId, recarregar]);

  const escolherArquivo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";              // permite escolher o mesmo arquivo de novo
    if (!f) return;
    // Figurinha (.webp) vai SEM legenda: sticker não carrega texto no WhatsApp —
    // uma legenda forçaria o envio como imagem comum. O que o SDR digitou fica
    // no campo, intacto, pra sair como mensagem separada se ele quiser.
    const ehFigurinha = f.type === "image/webp";
    const blob = await comprimirImagem(f);
    const nome = blob === f ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg";
    await enviarMidia(blob, nome, ehFigurinha ? "" : text.trim());
    if (!ehFigurinha) setText("");
  }, [enviarMidia, text]);

  // Ctrl+V de imagem direto no campo — print de tela, foto copiada de outro
  // app. Era o jeito nº 1 de mandar imagem no WhatsApp Web e aqui não existia:
  // o SDR tinha que salvar o print em arquivo só pra anexar.
  const aoColar = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
    if (!item) return;                 // texto colado segue o fluxo normal
    const f = item.getAsFile();
    if (!f) return;
    e.preventDefault();
    const blob = await comprimirImagem(f);
    const nome = f.name && f.name !== "image.png" ? f.name : `colada-${Date.now()}.${blob.type.includes("png") ? "png" : "jpg"}`;
    await enviarMidia(blob, blob === f ? nome : nome.replace(/\.[^.]+$/, "") + ".jpg", text.trim());
    setText("");
  }, [enviarMidia, text]);

  // ── Reações ────────────────────────────────────────────────────────────────
  // Uma por pessoa, como no WhatsApp: reagir de novo troca; o mesmo emoji
  // remove. A resposta do servidor traz a lista pronta — nada de adivinhar.
  const reagir = useCallback(async (m: WaMessage, emoji: string) => {
    setReagindoA(null);
    const minha = (m.reactions ?? []).find((r) => r.autor === currentUser?.id);
    const alvo = minha?.emoji === emoji ? "" : emoji;
    const r = await reagirMensagem(leadId, m.id, alvo);
    if (!r.ok) { setErro(r.error || "Não consegui reagir."); return; }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: r.reactions ?? [] } : x)));
    // Honestidade: reação que ficou só no QS não pode passar por entregue.
    if (alvo && r.entregue === false) {
      setAviso(r.motivo === "evolution-nao-configurada"
        ? "Reação registrada no QS. Pra ela chegar no WhatsApp do cliente, falta ligar a Evolution (Config)."
        : "Reação registrada no QS, mas não chegou no WhatsApp do cliente.");
      window.setTimeout(() => setAviso(null), 6000);
    }
  }, [leadId, currentUser?.id]);

  // ── Figurinhas ─────────────────────────────────────────────────────────────
  const salvarFig = useCallback(async (url: string) => {
    const r = await salvarFigurinha(url);
    if (!r.ok) { setErro(r.error || "Não consegui salvar a figurinha."); return; }
    setErro(null);
    setAviso("Figurinha salva na sua galeria.");
    window.setTimeout(() => setAviso(null), 3000);
  }, []);

  const mandarFigurinha = useCallback(async (fig: Figurinha) => {
    setMostrarFigurinhas(false);
    setSending(true);
    setErro(null);
    const r = await enviarFigurinha(leadId, fig);
    setSending(false);
    if (!r.ok) { setErro(r.error || "Não consegui enviar a figurinha."); return; }
    setSemConversa(false);
    stickToBottom.current = true;
    await recarregar();
  }, [leadId, recarregar]);

  // ── Áudio ──────────────────────────────────────────────────────────────────
  const pararGravacao = useCallback((cancelar: boolean) => {
    cancelarRef.current = cancelar;
    recorderRef.current?.stop();
  }, []);

  const iniciarGravacao = useCallback(async () => {
    setErro(null);
    try {
      // Mono não é capricho: nota de voz em estéreo é causa clássica de áudio
      // que chega e não toca no WhatsApp.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      // OGG primeiro: é o formato que o WhatsApp entende como nota de voz. Só o
      // Firefox grava OGG nativo; Chrome/Edge/Safari caem no WebM, e aí quem
      // converte é o ffmpeg da Evolution (por isso a extensão certa importa —
      // ver nomeComExtensaoCerta em api/wa-send-media.js).
      const preferidos = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mime = preferidos.find((t) => MediaRecorder.isTypeSupported?.(t));
      const mr = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 32000,   // voz mono: 3 min ≈ 720 KB, longe do teto de 3 MB
      });

      chunksRef.current = [];
      cancelarRef.current = false;
      mr.ondataavailable = (ev) => { if (ev.data?.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setGravando(false);
        const dur = segundosRef.current;
        setSegundos(0);
        segundosRef.current = 0;
        if (cancelarRef.current) return;
        // Alguns navegadores reportam "video/webm" num stream que só tem áudio;
        // normaliza pra não ser recusado como tipo inválido no servidor.
        let tipo = (mr.mimeType || "audio/webm").split(";")[0].trim();
        if (tipo === "video/webm") tipo = "audio/webm";

        const blob = new Blob(chunksRef.current, { type: tipo });
        if (blob.size < 1200 || dur < 1) { setErro("Áudio muito curto."); return; }

        // ".weba" (e não ".webm") é o que faz a Evolution tratar como ÁUDIO e
        // converter pra nota de voz. O servidor reforça isso de qualquer jeito.
        const ext = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : "weba";
        await enviarMidia(blob, `audio-${Date.now()}.${ext}`, "", true);
      };

      recorderRef.current = mr;
      mr.start();
      setGravando(true);
      setSegundos(0);
      segundosRef.current = 0;
      timerRef.current = window.setInterval(() => {
        segundosRef.current += 1;
        setSegundos(segundosRef.current);
        if (segundosRef.current >= 180) pararGravacao(false);   // teto de 3 min
      }, 1000);
    } catch {
      setErro("Não consegui acessar o microfone. Autorize o acesso no navegador.");
    }
  }, [enviarMidia, pararGravacao]);

  // ── Respostas prontas ─────────────────────────────────────────────────────
  const cannedFiltradas = useMemo(() => {
    if (!mostrarCanned) return [];
    const q = text.startsWith("/") ? text.slice(1).toLowerCase().trim() : "";
    return canned.filter((c) => !q || c.atalho.toLowerCase().includes(q)).slice(0, 6);
  }, [canned, text, mostrarCanned]);

  // Qual dos nossos números atende esta conversa. Sem conversa ainda, mostra por
  // onde ela VAI sair (o padrão do servidor) — é a mesma pergunta do SDR.
  const numeroDaConversa = useMemo(() => {
    if (!numeros.length) return null;
    if (inboxAtual != null) {
      return numeros.find((n) => n.id === inboxAtual) ?? null;
    }
    return numeros.find((n) => n.padrao) ?? (numeros.length === 1 ? numeros[0] : null);
  }, [numeros, inboxAtual]);

  // ── Janela de 24h (só no número oficial da Meta) ──────────────────────────
  // A âncora é a ÚLTIMA mensagem que o CLIENTE mandou: é dela que a Meta conta
  // as 24h de texto livre. Sem mensagem dele, a janela nunca abriu — primeira
  // abordagem é por modelo, sempre.
  const ehOficial = numeroDaConversa?.tipo === "api";

  const ultimaDoCliente = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === "in") return messages[i].sent_at;
    }
    return null;
  }, [messages]);

  const janela = useMemo(() => {
    if (!ehOficial) return null;
    const fecha = janelaFechaEm(ultimaDoCliente);
    if (!fecha) return { estado: "nunca-abriu" as const, restante: 0 };
    const restante = fecha.getTime() - agora;
    if (restante <= 0) return { estado: "fechada" as const, restante: 0 };
    return { estado: (restante < 3 * 3600_000 ? "fechando" : "aberta") as "fechando" | "aberta", restante };
  }, [ehOficial, ultimaDoCliente, agora]);

  const soModelo = janela != null && janela.estado !== "aberta" && janela.estado !== "fechando";
  soModeloRef.current = soModelo;

  // O cronômetro só precisa de precisão de minuto — e só gira na conversa oficial.
  useEffect(() => {
    if (!ehOficial) return;
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [ehOficial]);

  const enviarModelo = useCallback(async (m: WaModelo, valores: Record<string, string>) => {
    if (sending) return;
    setSending(true);
    setErro(null);
    const r = await sendWaTemplate(leadId, m, valores);
    setSending(false);
    if (!r.ok) { setErro(r.error || "Não consegui enviar o modelo."); return; }
    setMostrarModelos(false);
    setSemConversa(false);
    stickToBottom.current = true;
    await recarregar();
  }, [sending, leadId, recarregar]);

  const aplicarCanned = useCallback((c: CannedResponse) => {
    setText(preencherCanned(c.texto, { nome: leadName }));
    setMostrarCanned(false);
    caretRef.current = null;   // o texto trocou inteiro; o cursor velho não vale mais
  }, [leadName]);

  // ── Emojis ────────────────────────────────────────────────────────────────
  // Entra ONDE O CURSOR ESTÁ, não no fim: emoji quase sempre é no meio da frase
  // ("bom dia 👋, tudo bem?"). Se o campo estiver focado, o cursor volta pra
  // depois do emoji — senão o navegador o jogaria pro fim do texto.
  const inserirEmoji = useCallback((emoji: string) => {
    const el = taRef.current;
    const focado = !!el && document.activeElement === el;
    const ini = Math.min(focado ? el.selectionStart ?? text.length : caretRef.current ?? text.length, text.length);
    const fim = Math.min(focado ? el.selectionEnd ?? ini : ini, text.length);
    const depois = ini + emoji.length;
    caretRef.current = depois;
    setText(text.slice(0, ini) + emoji + text.slice(Math.max(ini, fim)));
    if (focado) requestAnimationFrame(() => el.setSelectionRange(depois, depois));
  }, [text]);

  // Os painéis dividem o mesmo espaço acima do campo; abrir um fecha os outros.
  const alternarEmojis = useCallback(() => {
    setMostrarEmojis((v) => !v);
    setMostrarCanned(false);
    setMostrarFigurinhas(false);
    setMostrarModelos(false);
  }, []);

  const alternarFigurinhas = useCallback(() => {
    setMostrarFigurinhas((v) => !v);
    setMostrarEmojis(false);
    setMostrarCanned(false);
    setMostrarModelos(false);
  }, []);

  const marcarCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    caretRef.current = e.currentTarget.selectionStart;
  };

  const aoDigitar = (v: string) => {
    setText(v);
    const abreCanned = v.startsWith("/") && canned.length > 0;
    setMostrarCanned(abreCanned);
    if (abreCanned) { setMostrarEmojis(false); setMostrarFigurinhas(false); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && mostrarCanned) { setMostrarCanned(false); return; }
    if (e.key === "Escape" && mostrarEmojis) { setMostrarEmojis(false); return; }
    if (e.key === "Escape" && mostrarFigurinhas) { setMostrarFigurinhas(false); return; }
    if (e.key === "Escape" && reagindoA) { setReagindoA(null); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (mostrarCanned && cannedFiltradas.length === 1) { aplicarCanned(cannedFiltradas[0]); return; }
      enviar();
    }
  };

  const baixarTudo = useCallback(async () => {
    setAviso("baixando histórico…");
    const r = await downloadHistory(leadId);
    if (r.error) { setAviso(null); setErro(r.error); return; }
    await recarregar();
    // `completo === false` = a função bateu no teto de segurança do servidor
    // (~400 msgs por chamada) — o clique seguinte CONTINUA de onde parou.
    const aindaTem = r.completo === false;
    setAviso(r.importadas > 0
      ? `${r.importadas} ${r.importadas > 1 ? "mensagens trazidas" : "mensagem trazida"} do histórico.${aindaTem ? " Ainda tem mais — clique de novo pra continuar." : ""}`
      : aindaTem
        ? "Histórico parcial — clique de novo pra continuar."
        : "Nada novo no histórico.");
    window.setTimeout(() => setAviso(null), aindaTem ? 7000 : 4000);
  }, [leadId, recarregar]);

  let ultimoDia = "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Mensagens */}
      <div ref={scrollRef} onScroll={onScroll}
           className="flex-1 min-h-0 overflow-y-auto px-3 py-3" style={{ background: "var(--bg)" }}>
        {/* Trazer tudo que já foi conversado com este cliente */}
        {!loading && (
          <div className="text-center mb-3">
            <button onClick={baixarTudo}
                    className="wa-chip text-[11px] font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: "transparent", color: "var(--ink3)", border: "1px solid var(--line)" }}>
              Baixar histórico completo
            </button>
          </div>
        )}

        {loading ? (
          // Esqueleto no formato das bolhas: carregar mostra a FORMA do
          // conteúdo, não a palavra "carregando".
          <div className="space-y-2 pt-2">
            {[62, 44, 70, 38].map((w, i) => (
              <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                <span className="wa-sk rounded-2xl" style={{ width: `${w}%`, height: i % 2 ? 34 : 48 }} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 px-6">
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink2)" }}>
              {semConversa ? "Nenhuma conversa ainda" : "Sem mensagens"}
            </p>
            <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: "var(--ink3)" }}>
              {semConversa
                ? "Mande a primeira mensagem aqui embaixo — ela abre a conversa no WhatsApp."
                : "As mensagens aparecem aqui assim que chegarem."}
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const dia = diaLabel(m.sent_at);
            const mostraDia = dia !== ultimoDia;
            ultimoDia = dia;
            const meu = m.direction === "out";

            // Agrupamento: mensagens seguidas do mesmo lado, dentro de 5 min,
            // formam um bloco. É o que faz parecer conversa em vez de lista de
            // itens — só a ÚLTIMA do bloco tem rabinho, hora e avatar.
            // Mensagem que é só emoji sai da bolha e cresce, como no celular.
            const emojiPx = !m.attachments?.length && m.content ? tamanhoEmojiSolto(m.content) : null;
            // Figurinha também sai da bolha: imagem solta, como no celular.
            const figurinha = urlDeFigurinha(m);
            const semBolha = Boolean(emojiPx) || Boolean(figurinha);

            const reacoes = Array.isArray(m.reactions) ? m.reactions : [];
            const grupos = reacoes.length ? agruparReacoes(reacoes) : [];

            const prox = messages[i + 1];
            const fimDoBloco =
              !prox ||
              prox.direction !== m.direction ||
              diaLabel(prox.sent_at) !== dia ||
              Math.abs(+new Date(prox.sent_at) - +new Date(m.sent_at)) > 5 * 60_000;

            // A "pill" de reação invade o rodapé da bolha — a linha precisa de
            // um respiro a mais embaixo pra não cobrir a mensagem seguinte.
            const respiro = grupos.length ? "mb-5" : fimDoBloco ? "mb-3" : "mb-[3px]";

            const botaoReagir = (
              <button
                data-wa-react
                onClick={() => setReagindoA((v) => (v === m.id ? null : m.id))}
                aria-label="Reagir a esta mensagem" title="Reagir"
                className="wa-icon-btn shrink-0 w-7 h-7 grid place-items-center rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity self-center">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <circle cx="10.5" cy="11.5" r="7.75" />
                  <path d="M7.6 13.4a3.7 3.7 0 0 0 5.8 0" />
                  <path d="M8.4 9.6h.01M12.6 9.6h.01" strokeWidth="2.3" />
                  <path d="M18.5 4.5v5M16 7h5" />
                </svg>
              </button>
            );

            return (
              <div key={m.id}>
                {mostraDia && <DiaSeparador label={dia} />}
                <div className={`group flex items-end gap-2 ${meu ? "justify-end" : "justify-start"} ${respiro}`}>
                  {!meu && (
                    fimDoBloco
                      ? <WaAvatar nome={leadName || "Lead"} url={avatarLead} size={26} />
                      : <span className="w-[26px] shrink-0" />   /* alinha o bloco */
                  )}
                  {meu && botaoReagir}
                  {/* 78% da coluna, com TETO de 34rem. A porcentagem sozinha
                      bastava no dock (78% de 440px = 343px), mas na aba em tela
                      cheia esticava a bolha pra ~780px — linha comprida demais
                      pra ler. No dock o min() continua escolhendo os 78%, então
                      lá nada muda. */}
                  <div className={`relative ${semBolha ? "max-w-[min(78%,34rem)] px-1 py-0.5" : "max-w-[min(78%,34rem)] px-3 py-2"}`}
                       onContextMenu={(e) => { e.preventDefault(); setMenu({ pos: { x: e.clientX, y: e.clientY }, m }); }}
                       onTouchStart={(e) => { alvoToque.current = m; toque.onTouchStart(e); }}
                       onTouchMove={toque.onTouchMove}
                       onTouchEnd={toque.onTouchEnd}
                       onTouchCancel={toque.onTouchCancel}
                       style={semBolha ? { color: "var(--ink)" } : {
                         background: meu ? "var(--wa-soft)" : "var(--card)",
                         color: meu ? "var(--wa-ink)" : "var(--ink)",
                         border: meu ? "none" : "1px solid var(--line)",
                         borderRadius: 16,
                         borderBottomRightRadius: meu && fimDoBloco ? 5 : 16,
                         borderBottomLeftRadius: !meu && fimDoBloco ? 5 : 16,
                       }}>
                    {/* Paleta de reação — em cima da bolha, no lado certo. */}
                    {reagindoA === m.id && (
                      <div data-wa-react
                           className={`absolute -top-11 ${meu ? "right-0" : "left-0"} z-20 flex gap-0.5 px-1.5 py-1 rounded-full`}
                           style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "0 6px 18px rgba(0,0,0,.16)" }}>
                        {REACOES_RAPIDAS.map((e) => {
                          const minha = reacoes.some((r) => r.autor === currentUser?.id && r.emoji === e);
                          return (
                            <button key={e} onClick={() => void reagir(m, e)}
                                    aria-label={minha ? `Remover reação ${e}` : `Reagir com ${e}`}
                                    className="w-8 h-8 grid place-items-center rounded-full text-[19px] leading-none transition-transform hover:scale-125"
                                    style={minha ? { background: "var(--wa-soft)" } : undefined}>
                              {e}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Citação: o trechinho da mensagem respondida, como no
                        WhatsApp. Vem do reply_preview gravado junto — a citada
                        pode ser anterior ao que o QS importou, e aí não haveria
                        de onde ler o texto. */}
                    {m.reply_preview && (
                      <p className="mb-1.5 pl-2 py-1 rounded text-[12px] leading-snug line-clamp-3 break-words"
                         style={{
                           borderLeft: "3px solid var(--wa-bright)",
                           background: meu ? "rgba(0,0,0,.06)" : "var(--card2)",
                           color: meu ? "var(--wa-ink)" : "var(--ink2)",
                           opacity: .9,
                         }}>
                        {waPlain(m.reply_preview)}
                      </p>
                    )}

                    {/* Apagada = SUMIU DO CELULAR DO CLIENTE, não daqui. O QS é
                        o arquivo da conversa: é dele que sai a auditoria do que
                        foi combinado, e ela não pode ter buraco. Fica a marca —
                        o atendente precisa saber que o outro lado não vê mais
                        essa mensagem (não dá pra cobrar algo invisível). */}
                    {m.deleted_at && (
                      <p className="flex items-center gap-1 mb-1 text-[11px] font-semibold"
                         style={{ opacity: .75, color: meu ? "var(--wa-ink)" : "var(--ink3)" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" strokeLinecap="round" aria-hidden>
                          <path d="M4.9 4.9 19 19M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />
                        </svg>
                        {meu ? "apagada para o cliente" : "o cliente apagou"} · só você vê
                      </p>
                    )}

                    {figurinha ? (
                      // Figurinha: imagem solta (sem bolha), com o "salvar" no hover.
                      <span className="relative block">
                        <img src={figurinha} alt="Figurinha" loading="lazy" decoding="async"
                             className="block h-auto" style={{ width: 150 }} />
                        <button onClick={() => void salvarFig(figurinha)}
                                aria-label="Salvar figurinha na galeria" title="Salvar figurinha"
                                className="absolute top-1 right-1 w-7 h-7 grid place-items-center rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink2)", boxShadow: "0 1px 4px rgba(0,0,0,.15)" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.5 21 12 17.2 6.5 21V5.3A2.3 2.3 0 0 1 8.8 3h6.4a2.3 2.3 0 0 1 2.3 2.3z" />
                          </svg>
                        </button>
                      </span>
                    ) : (
                      m.attachments?.map((a, k) => <Anexo key={k} a={a} meu={meu} />)
                    )}
                    {m.content && (
                      <p className="whitespace-pre-wrap break-words"
                         style={emojiPx
                           ? { fontSize: emojiPx, lineHeight: 1.15 }
                           : { fontSize: 14, lineHeight: 1.45 }}>
                        {/* Com a formatação do WhatsApp aplicada: o SDR vê a
                            mensagem como ela chega no celular do cliente — a
                            assinatura em negrito, e não `*Victor Hugo*` cru. */}
                        <WaTexto texto={m.content} />
                      </p>
                    )}
                    {fimDoBloco && (
                      <p className="text-[11px] mt-1 flex items-center justify-end gap-1 tabular-nums"
                         style={semBolha
                           ? { color: "var(--ink3)" }
                           : { color: meu ? "var(--wa-ink)" : "var(--ink3)", opacity: meu ? .65 : 1 }}>
                        {hora(m.sent_at)}
                        {/* Só na nossa: no WhatsApp o recibo da mensagem do
                            outro não existe. Apagada também não tem recibo. */}
                        {meu && !m.deleted_at && <Recibo status={m.status} />}
                      </p>
                    )}

                    {/* Reações penduradas na bolha, como no WhatsApp. Clicar na
                        própria remove; numa que ainda não é sua, adere. */}
                    {grupos.length > 0 && (
                      <div className={`absolute -bottom-3.5 ${meu ? "right-1" : "left-1"} z-10 flex gap-1`}>
                        {grupos.map((g) => (
                          <button key={g.emoji} onClick={() => void reagir(m, g.emoji)}
                                  title={g.nomes.join(", ")}
                                  aria-label={`Reação ${g.emoji} de ${g.nomes.join(", ")}`}
                                  className="flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[13px] leading-[18px]"
                                  style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "0 1px 3px rgba(0,0,0,.10)" }}>
                            <span>{g.emoji}</span>
                            {g.n > 1 && (
                              <span className="text-[10px] font-bold tabular-nums" style={{ color: "var(--ink3)" }}>{g.n}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!meu && botaoReagir}
                </div>
              </div>
            );
          })
        )}
        {syncing && (
          <p className="text-center text-[11px] py-2" style={{ color: "var(--ink3)" }}>Buscando histórico…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {aviso && (
        <div className="px-3 py-1.5 text-[11.5px] font-bold" style={{ background: "var(--wa-ok-bg)", color: "var(--wa)" }}>
          {aviso}
        </div>
      )}
      {erro && (
        <div className="px-3 py-2 text-[12px] font-semibold" style={{ background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }}>
          {erro}
        </div>
      )}

      {/* Respostas prontas */}
      {mostrarCanned && cannedFiltradas.length > 0 && (
        <div className="shrink-0 border-t max-h-40 overflow-y-auto"
             style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          {cannedFiltradas.map((c) => (
            <button key={c.atalho} onClick={() => aplicarCanned(c)}
                    className="wa-row wa-row-btn w-full text-left px-3 py-2">
              <span className="text-[12px] font-semibold" style={{ color: "var(--wa)" }}>/{c.atalho}</span>
              <span className="block text-[12px] truncate mt-0.5" style={{ color: "var(--ink3)" }}>{c.texto}</span>
            </button>
          ))}
        </div>
      )}

      {/* Emojis. Fica gravando de fora: durante uma nota de voz o campo de
          escrever nem existe, e o painel ficaria pendurado sem dono. */}
      {mostrarEmojis && !gravando && (
        // Cerca PRÓPRIA, por dentro da conversa: o seletor carrega sob demanda e,
        // numa aba anterior ao último deploy, o arquivo dele não existe mais.
        // Suspense cobre a espera, não a falha — sem esta cerca o erro subia e
        // levava a tela inteira junto. Aqui o pior caso é ficar sem emoji.
        <ErroDeParte parte="o seletor de emoji" modo="discreto">
          <Suspense fallback={
            <div className="shrink-0 border-t" style={{ borderColor: "var(--line)", background: "var(--card)", height: 248 }}>
              <div className="grid gap-1.5 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(34px, 1fr))" }}>
                {Array.from({ length: 24 }, (_, i) => <span key={i} className="wa-sk rounded-lg" style={{ height: 34 }} />)}
              </div>
            </div>
          }>
            <WaEmojiPicker onPick={inserirEmoji} onClose={() => setMostrarEmojis(false)} />
          </Suspense>
        </ErroDeParte>
      )}

      {/* Figurinhas — mesmo espaço e mesma cerca do seletor de emoji. */}
      {mostrarFigurinhas && !gravando && (
        <ErroDeParte parte="a galeria de figurinhas" modo="discreto">
          <Suspense fallback={
            <div className="shrink-0 border-t" style={{ borderColor: "var(--line)", background: "var(--card)", height: 248 }}>
              <div className="grid gap-2 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
                {Array.from({ length: 8 }, (_, i) => <span key={i} className="wa-sk rounded-xl" style={{ height: 72 }} />)}
              </div>
            </div>
          }>
            <WaFigurinhas onEnviar={(f) => void mandarFigurinha(f)} onClose={() => setMostrarFigurinhas(false)} />
          </Suspense>
        </ErroDeParte>
      )}

      {/* Modelos da Meta — mesmo espaço dos outros painéis. Abre pelo botão do
          composer ou sozinho quando o SDR tenta texto livre com a janela fechada. */}
      {mostrarModelos && !gravando && (
        <ErroDeParte parte="os modelos da Meta" modo="discreto">
          <Suspense fallback={
            <div className="shrink-0 border-t" style={{ borderColor: "var(--line)", background: "var(--card)", height: 160 }}>
              <div className="grid gap-2 p-3">
                {Array.from({ length: 2 }, (_, i) => <span key={i} className="wa-sk rounded-xl" style={{ height: 56 }} />)}
              </div>
            </div>
          }>
            <WaModelos
              modelos={modelos}
              leadName={leadName}
              enviando={sending}
              onEnviar={(m, valores) => void enviarModelo(m, valores)}
              onClose={() => setMostrarModelos(false)}
            />
          </Suspense>
        </ErroDeParte>
      )}

      {/* De qual WhatsApp esta conversa é — informação, não escolha.
          O cliente vê a mensagem chegando DESTE número; o SDR precisa saber
          disso antes de escrever, e não pode trocar sem querer. */}
      {numeroDaConversa && !gravando && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 pt-2" style={{ background: "var(--card)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" style={{ color: "var(--ink3)" }}>
            <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
          </svg>
          <span className="text-[11px] min-w-0 truncate" style={{ color: "var(--ink3)" }}>
            {inboxAtual == null ? "Vai sair pelo " : "Conversa pelo "}
            <b style={{ color: "var(--ink2)" }}>{numeroDaConversa.nome}</b>
          </span>
          {/* A bolinha verde: nuvem = número oficial (mora na Meta), aparelho =
              WhatsApp comum. Mostra o telefone quando o Chatwoot informa. */}
          <WaSeloNumero
            tipo={numeroDaConversa.tipo}
            nome={numeroDaConversa.nome}
            numero={numeroDaConversa.numero}
          />
          {/* O cronômetro da janela de 24h. Verde = tranquilo; âmbar piscando =
              menos de 3h; vermelho = fechou (ou o cliente nunca respondeu) e
              texto livre a Meta recusa — daqui em diante é modelo. */}
          {janela && (
            <span
              className={"shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums" +
                (janela.estado === "fechando" ? " animate-pulse" : "")}
              style={
                janela.estado === "aberta"
                  ? { background: "var(--wa-ok-bg)", color: "var(--wa-ok-ink)" }
                  : janela.estado === "fechando"
                    ? { background: "#FFF7ED", color: "#9A3412" }
                    : { background: "#FEF2F2", color: "#B91C1C" }
              }
              title={
                janela.estado === "nunca-abriu"
                  ? "O cliente ainda não respondeu — a primeira mensagem pela API oficial sai por modelo aprovado."
                  : janela.estado === "fechada"
                    ? "Passaram 24h desde a última mensagem do cliente — agora só sai modelo aprovado."
                    : "Tempo restante pra responder com texto livre (24h desde a última mensagem do cliente)."
              }
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.4" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
              {janela.estado === "nunca-abriu" ? "só modelo"
                : janela.estado === "fechada" ? "janela fechada"
                : `fecha em ${humanizarJanela(janela.restante)}`}
            </span>
          )}
          {/* Como o cliente vai ver quem está falando. O carimbo é feito no
              servidor no momento do envio — aqui é só o SDR saber de antemão. */}
          {assinatura && (
            <span className="shrink-0 text-[11px] truncate" style={{ color: "var(--ink3)" }}>
              · assina como <b style={{ color: "var(--ink2)" }}>{assinatura}</b>
            </span>
          )}
        </div>
      )}

      {/* Escrever */}
      <div className="wa-composer shrink-0 border-t px-3 py-2.5" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        {/* Respondendo a alguém: o trecho citado fica ACIMA do campo, com um X
            pra desistir — mesmo lugar e mesmo gesto do WhatsApp. Sem esta faixa
            o atendente não teria como saber que a próxima mensagem vai citar. */}
        {respondendo && (
          <div className="flex items-start gap-2 mb-2 pl-2 pr-1 py-1.5 rounded-lg"
               style={{ background: "var(--card2)", borderLeft: "3px solid var(--wa-bright)" }}>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold" style={{ color: "var(--wa)" }}>
                {respondendo.direction === "out" ? "Você" : (leadName || "Cliente")}
              </p>
              <p className="text-[12px] truncate" style={{ color: "var(--ink2)" }}>
                {waPlain(respondendo.content) || (respondendo.attachments?.length ? "Anexo" : "Mensagem")}
              </p>
            </div>
            <button onClick={() => setRespondendo(null)} aria-label="Cancelar resposta"
                    className="wa-icon-btn shrink-0 w-7 h-7 grid place-items-center rounded-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}
        {gravando ? (
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "var(--red)" }} />
            <span className="text-[14px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
              Gravando {mmss(segundos)}
            </span>
            <button onClick={() => pararGravacao(true)}
                    className="wa-chip ml-auto px-3 h-9 rounded-lg text-[13px] font-semibold"
                    style={{ background: "transparent", color: "var(--ink2)", border: "1px solid var(--line)" }}>
              Cancelar
            </button>
            <button onClick={() => pararGravacao(false)}
                    className="wa-send px-4 h-9 rounded-lg text-white text-[13px] font-semibold">
              Enviar
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <input ref={fileRef} type="file" className="hidden" onChange={escolherArquivo}
                   accept="image/*,audio/*,video/mp4,application/pdf" />
            <button onClick={alternarEmojis} disabled={sending}
                    data-wa-emoji-toggle
                    aria-expanded={mostrarEmojis} aria-label="Emojis"
                    title="Emojis" data-aberto={mostrarEmojis || undefined}
                    className="wa-icon-btn wa-emoji-toggle shrink-0 w-9 h-9 grid place-items-center rounded-lg">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <circle cx="12" cy="12" r="9.25" />
                <path d="M8.6 14.2a4.3 4.3 0 0 0 6.8 0" />
                <path d="M9.2 9.4h.01M14.8 9.4h.01" strokeWidth="2.4" />
              </svg>
            </button>
            <button onClick={alternarFigurinhas} disabled={sending}
                    aria-expanded={mostrarFigurinhas} aria-label="Figurinhas"
                    title="Figurinhas" data-aberto={mostrarFigurinhas || undefined}
                    className="wa-icon-btn wa-emoji-toggle shrink-0 w-9 h-9 grid place-items-center rounded-lg">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19.5 13V8.2A3.7 3.7 0 0 0 15.8 4.5H8.2A3.7 3.7 0 0 0 4.5 8.2v7.6a3.7 3.7 0 0 0 3.7 3.7H13" />
                <path d="M19.5 13a6.5 6.5 0 0 1-6.5 6.5V15a2 2 0 0 1 2-2z" />
              </svg>
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={sending}
                    title="Enviar imagem, figurinha ou arquivo" aria-label="Anexar"
                    className="wa-icon-btn shrink-0 w-9 h-9 grid place-items-center rounded-lg">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
              </svg>
            </button>
            {/* Modelos da Meta — só faz sentido na conversa do número oficial.
                Ganha destaque quando é o ÚNICO caminho (janela fechada). */}
            {ehOficial && (
              <button onClick={() => setMostrarModelos((v) => !v)} disabled={sending}
                      aria-expanded={mostrarModelos} aria-label="Modelos aprovados"
                      title={soModelo ? "Janela de 24h fechada — enviar modelo aprovado" : "Modelos aprovados da Meta"}
                      data-aberto={mostrarModelos || undefined}
                      className="wa-icon-btn wa-emoji-toggle shrink-0 w-9 h-9 grid place-items-center rounded-lg"
                      style={soModelo ? { color: "#B91C1C" } : undefined}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3.5h8a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 18V6A2.5 2.5 0 0 1 8 3.5z" />
                  <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
                </svg>
              </button>
            )}
            <button onClick={iniciarGravacao} disabled={sending}
                    title="Gravar áudio" aria-label="Gravar áudio"
                    className="wa-icon-btn shrink-0 w-9 h-9 grid place-items-center rounded-lg">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
              </svg>
            </button>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => aoDigitar(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => void aoColar(e)}
              onSelect={marcarCaret}
              rows={1}
              placeholder={`Mensagem para ${leadName || formatPhoneDisplay(phone) || "o lead"}…  (/ para atalhos)`}
              className="flex-1 min-w-0 resize-none rounded-xl px-3 py-2 text-[14px] leading-[1.45] outline-none"
              style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)", maxHeight: 128 }}
            />
            {/* Com o dock estreito a palavra "Enviar" some e sobra o ícone —
                ver .wa-composer no index.css. */}
            <button onClick={enviar} disabled={!text.trim() || sending} title="Enviar (Enter)" aria-label="Enviar"
                    className="wa-send wa-send-btn shrink-0 h-9 rounded-xl text-white text-[13px] font-semibold grid place-items-center">
              {sending
                ? <span className="w-4 h-4 rounded-full animate-spin"
                        style={{ border: "2px solid rgba(255,255,255,.35)", borderTopColor: "#fff" }}
                        aria-label="enviando" />
                : (
                  <>
                    <span className="wa-send-label">Enviar</span>
                    <svg className="wa-send-icone" width="17" height="17" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 12 3 4.5l3 7.5-3 7.5z" /><path d="M6 12h15.5" />
                    </svg>
                  </>
                )}
            </button>
          </div>
        )}
      </div>

      <WaMenuContexto
        pos={menu?.pos ?? null}
        itens={menu ? itensMenu(menu.m) : []}
        onFechar={() => setMenu(null)}
      />
    </div>
  );
}
