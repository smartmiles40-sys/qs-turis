// src/components/sdr/wa/WaEmojiPicker.tsx
// -----------------------------------------------------------------------------
// O seletor de emojis do painel de atendimento.
//
// Decisões que valem a pena estar escritas:
//
//  • Ele abre EM FLUXO, empurrando a conversa pra cima — não flutuando por cima
//    dela. O dock pode ser arrastado até 340px; um popover ancorado nessa
//    largura ou vaza pra fora da tela ou cobre a mensagem que a SDR está
//    respondendo. É a mesma escolha já feita pela lista de respostas prontas,
//    logo acima do campo de escrever.
//
//  • Escolher um emoji NÃO fecha o painel e NÃO rouba o foco de onde ele está.
//    Quem manda "🔥🔥🔥" clica três vezes; quem buscou "aviao" quer continuar no
//    campo de busca. Roubar o foco pro textarea a cada clique quebraria os dois.
//    O cursor no textarea é lembrado por fora (caretRef, no WaConversation).
//
//  • Setas do teclado andam pela grade. Não é enfeite de acessibilidade: sem
//    isso, chegar no último emoji exige ~60 Tabs.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIAS, buscarEmojis, guardarRecente, lerRecentes } from "@/lib/qs/waEmojis";

interface Props {
  /** Chamado a cada escolha. O painel continua aberto de propósito. */
  onPick: (emoji: string) => void;
  onClose: () => void;
}

const COLUNAS_MIN = 34;   // largura mínima de cada célula, em px

export default function WaEmojiPicker({ onPick, onClose }: Props) {
  const [busca, setBusca] = useState("");
  const [recentes, setRecentes] = useState<string[]>(() => lerRecentes());
  // Abre nos recentes quando já existem: na prática a SDR reusa os mesmos oito
  // o dia todo, e "Rostos" a obrigaria a caçar o 👍 numa grade de 68 caras.
  const [catId, setCatId] = useState<string>(() => (lerRecentes().length ? "recentes" : CATEGORIAS[0].id));

  const raizRef = useRef<HTMLDivElement>(null);
  const gradeRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  // Abre com o cursor na busca: é o caminho mais curto até o emoji certo, e
  // digitar duas letras vence qualquer navegação por categoria.
  useEffect(() => { buscaRef.current?.focus(); }, []);

  // Clique fora fecha. O botão que abre o painel carrega data-wa-emoji-toggle
  // pra não cair aqui — senão o clique fecharia e o onClick reabriria na mesma
  // vez, e o painel pareceria travado.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (!alvo) return;
      if (raizRef.current?.contains(alvo)) return;
      if (alvo.closest("[data-wa-emoji-toggle]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const buscando = busca.trim().length > 0;

  const lista = useMemo(() => {
    if (buscando) return buscarEmojis(busca);
    if (catId === "recentes") return recentes;
    return (CATEGORIAS.find((c) => c.id === catId) ?? CATEGORIAS[0]).itens.map(([e]) => e);
  }, [buscando, busca, catId, recentes]);

  const escolher = useCallback((emoji: string) => {
    onPick(emoji);
    setRecentes(guardarRecente(emoji));
  }, [onPick]);

  // Navegação por setas dentro da grade. Descobre as colunas medindo o DOM em
  // vez de assumir um número: a grade é auto-fill e muda com a largura do dock.
  const onGradeKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const teclas = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!teclas.includes(e.key)) return;
    const grade = gradeRef.current;
    if (!grade) return;
    const botoes = Array.from(grade.querySelectorAll<HTMLButtonElement>("button[data-emoji]"));
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
    if (atual < 0) return;
    e.preventDefault();

    const larguraCelula = botoes[0]?.offsetWidth || COLUNAS_MIN;
    const colunas = Math.max(1, Math.round(grade.clientWidth / larguraCelula));

    let alvo = atual;
    if (e.key === "ArrowRight") alvo = atual + 1;
    else if (e.key === "ArrowLeft") alvo = atual - 1;
    else if (e.key === "ArrowDown") alvo = atual + colunas;
    else if (e.key === "ArrowUp") alvo = atual - colunas;
    else if (e.key === "Home") alvo = 0;
    else if (e.key === "End") alvo = botoes.length - 1;

    // Subir além da primeira linha volta pra busca — é o caminho natural de
    // quem errou a palavra e quer corrigir.
    if (alvo < 0) { buscaRef.current?.focus(); return; }
    botoes[Math.min(alvo, botoes.length - 1)]?.focus();
  }, []);

  const onBuscaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (lista[0]) escolher(lista[0]);      // buscou "aviao", Enter manda o ✈️
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      gradeRef.current?.querySelector<HTMLButtonElement>("button[data-emoji]")?.focus();
    }
  };

  const abas = useMemo(() => {
    const base = CATEGORIAS.map((c) => ({ id: c.id, nome: c.nome, icone: c.icone }));
    return recentes.length ? [{ id: "recentes", nome: "Recentes", icone: "🕘" }, ...base] : base;
  }, [recentes.length]);

  const tituloLista = buscando
    ? (lista.length ? `${lista.length} resultado${lista.length > 1 ? "s" : ""}` : "Nada encontrado")
    : (abas.find((a) => a.id === catId)?.nome ?? "");

  return (
    <div
      ref={raizRef}
      role="dialog"
      aria-label="Escolher emoji"
      className="shrink-0 border-t"
      style={{ borderColor: "var(--line)", background: "var(--card)" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    >
      {/* Busca */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <div className="relative flex-1 min-w-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.1" strokeLinecap="round"
               className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
               style={{ color: "var(--ink3)" }}>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={onBuscaKeyDown}
            placeholder="Buscar emoji… (aviao, praia, joia)"
            aria-label="Buscar emoji"
            className="w-full rounded-lg pl-8 pr-2 h-8 text-[12.5px] outline-none"
            style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }}
          />
        </div>
        <button onClick={onClose} aria-label="Fechar emojis" title="Fechar (Esc)"
                className="wa-icon-btn shrink-0 w-8 h-8 grid place-items-center rounded-lg">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.1" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Categorias — some durante a busca, que já é uma seleção por si */}
      {!buscando && (
        <div className="flex gap-0.5 px-2 pt-1.5 overflow-x-auto" role="tablist" aria-label="Categorias">
          {abas.map((a) => (
            <button key={a.id} role="tab" aria-selected={catId === a.id} title={a.nome}
                    onClick={() => setCatId(a.id)}
                    className="wa-emoji-cat shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[16px] leading-none">
              <span aria-hidden>{a.icone}</span>
              <span className="sr-only">{a.nome}</span>
            </button>
          ))}
        </div>
      )}

      <p className="px-3 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wide"
         style={{ color: "var(--ink3)" }} aria-live="polite">
        {tituloLista}
      </p>

      {/* Grade */}
      <div
        ref={gradeRef}
        onKeyDown={onGradeKeyDown}
        className="overflow-y-auto px-2 pb-2"
        style={{ height: 176, display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${COLUNAS_MIN}px, 1fr))`, alignContent: "start" }}
      >
        {lista.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            data-emoji={emoji}
            onClick={() => escolher(emoji)}
            title={emoji}
            className="wa-emoji-btn grid place-items-center rounded-lg text-[20px] leading-none"
            style={{ height: COLUNAS_MIN }}
          >
            <span aria-hidden>{emoji}</span>
          </button>
        ))}
        {!lista.length && (
          <p className="col-span-full text-[12px] px-1 pt-3" style={{ color: "var(--ink3)" }}>
            {buscando
              ? "Tente outra palavra — a busca é por assunto (praia, festa, dinheiro)."
              : "Os emojis que você mais usa vão aparecer aqui."}
          </p>
        )}
      </div>
    </div>
  );
}
