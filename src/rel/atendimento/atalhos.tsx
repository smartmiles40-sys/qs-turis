// src/rel/atendimento/atalhos.tsx
// -----------------------------------------------------------------------------
// ATALHOS DE TECLADO do WhatsApp Web, no Atendimento (14/10/2026).
//
// As combinações são as MESMAS do WhatsApp Web/Desktop — quem já usa não
// precisa aprender nada. As poucas que são só do QS (bloco de notas, resolver)
// estão marcadas.
//
// Pegadinha do teclado ABNT2: Ctrl+Alt vira AltGr no Windows e muda a tecla
// que chega (Ctrl+Alt+E pode chegar como "€"). Por isso o casamento olha a
// tecla FÍSICA (e.code) além do caractere.
// -----------------------------------------------------------------------------
import { Modal } from "../ui";

export type AcaoAtalho =
  | "nova" | "naoLida" | "silenciar" | "arquivar" | "fixar" | "buscar" | "buscarNaConversa"
  | "proxima" | "anterior" | "emojis" | "figurinhas" | "ficha" | "notas" | "resolver" | "ajuda";

interface Def { acao: AcaoAtalho; teclas: string; rotulo: string; doQs?: boolean; ctrl: boolean; alt: boolean; shift: boolean; codes: string[]; keys: string[] }

const d = (acao: AcaoAtalho, teclas: string, rotulo: string, codes: string[], keys: string[], doQs = false): Def => ({
  acao, teclas, rotulo, doQs, codes, keys,
  ctrl: teclas.includes("Ctrl"), alt: teclas.includes("Alt"), shift: teclas.includes("Shift"),
});

export const ATALHOS: Def[] = [
  d("nova", "Ctrl+Alt+N", "Nova conversa", ["KeyN"], ["n"]),
  d("buscar", "Ctrl+Alt+/", "Pesquisar conversas", ["Slash", "IntlRo", "NumpadDivide"], ["/"]),
  d("buscarNaConversa", "Ctrl+Alt+Shift+F", "Pesquisar na conversa", ["KeyF"], ["f"]),
  d("proxima", "Ctrl+Alt+Shift+]", "Próxima conversa", ["BracketRight", "Backslash"], ["]", "}"]),
  d("anterior", "Ctrl+Alt+Shift+[", "Conversa anterior", ["BracketLeft"], ["[", "{"]),
  d("fixar", "Ctrl+Alt+Shift+P", "Fixar / desafixar conversa", ["KeyP"], ["p"]),
  d("naoLida", "Ctrl+Alt+Shift+U", "Marcar como não lida / lida", ["KeyU"], ["u"]),
  d("silenciar", "Ctrl+Alt+Shift+M", "Silenciar / reativar", ["KeyM"], ["m"]),
  d("arquivar", "Ctrl+Alt+Shift+E", "Arquivar / desarquivar", ["KeyE"], ["e"]),
  d("emojis", "Ctrl+Alt+E", "Painel de emojis", ["KeyE"], ["e"]),
  d("figurinhas", "Ctrl+Alt+S", "Painel de figurinhas", ["KeyS"], ["s"]),
  d("ficha", "Ctrl+Alt+P", "Abrir a ficha do cliente", ["KeyP"], ["p"]),
  d("notas", "Ctrl+Alt+B", "Bloco de notas", ["KeyB"], ["b"], true),
  d("resolver", "Ctrl+Alt+Shift+R", "Resolver / reabrir conversa", ["KeyR"], ["r"], true),
  d("ajuda", "Ctrl+/", "Lista de atalhos", ["Slash", "IntlRo", "NumpadDivide"], ["/"]),
];

/** Que atalho essa tecla é (ou null). Ctrl e Cmd valem igual. */
export function atalhoDoEvento(e: KeyboardEvent): AcaoAtalho | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return null;
  const k = e.key.toLowerCase();
  // AltGr do ABNT2 chega como Ctrl+Alt: AltGr+Q digita "/", AltGr+E e AltGr+/
  // digitam "°". Isso é DIGITAÇÃO, não atalho.
  if (e.altKey && e.code === "KeyQ") return null;
  const imprimivel = e.key.length === 1;
  for (const a of ATALHOS) {
    if (a.ctrl !== ctrl || a.alt !== e.altKey || a.shift !== e.shiftKey) continue;
    // Veio um caractere: ele manda (no ABNT2 o "[" fica na tecla física do "]"
    // americano). Não veio (tecla morta/AltGr estranho): vale a tecla física.
    if (imprimivel ? a.keys.includes(k) : a.codes.includes(e.code)) return a.acao;
  }
  return null;
}

/** Formatação do campo de texto (iguais ao WhatsApp): Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+Shift+M. */
export function marcaDoEvento(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string; key: string }): string | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (!e.shiftKey && (e.code === "KeyB" || k === "b")) return "*";
  if (!e.shiftKey && (e.code === "KeyI" || k === "i")) return "_";
  if (e.shiftKey && (e.code === "KeyX" || k === "x")) return "~";
  if (e.shiftKey && (e.code === "KeyM" || k === "m")) return "```";
  return null;
}

/** Envolve a seleção do campo com a marca (ou tira, se já está envolvida). */
export function envolver(el: HTMLTextAreaElement | HTMLInputElement, texto: string, marca: string): { texto: string; ini: number; fim: number } {
  const ini = el.selectionStart ?? texto.length;
  const fim = el.selectionEnd ?? texto.length;
  const sel = texto.slice(ini, fim);
  const n = marca.length;
  if (sel && texto.slice(ini - n, ini) === marca && texto.slice(fim, fim + n) === marca) {
    return { texto: texto.slice(0, ini - n) + sel + texto.slice(fim + n), ini: ini - n, fim: fim - n };
  }
  return { texto: texto.slice(0, ini) + marca + sel + marca + texto.slice(fim), ini: ini + n, fim: fim + n };
}

const DO_CAMPO: [string, string][] = [
  ["Enter", "Enviar"],
  ["Shift+Enter", "Pular linha"],
  ["Ctrl+B", "Negrito"],
  ["Ctrl+I", "Itálico"],
  ["Ctrl+Shift+X", "Tachado"],
  ["Ctrl+Shift+M", "Monoespaçado"],
  ["/", "Respostas prontas (no começo do campo)"],
  ["Esc", "Fechar painel / cancelar resposta"],
];

function Tecla({ t }: { t: string }) {
  return (
    <span className="inline-flex flex-wrap gap-1 justify-end">
      {t.split("+").map((p, i) => (
        <kbd key={i} className="px-1.5 h-6 min-w-[24px] inline-flex items-center justify-center rounded text-[11.5px] font-semibold"
          style={{ background: "var(--line2, #F0F2F5)", border: "1px solid var(--line, #E9EDEF)", color: "var(--ink2)" }}>{p}</kbd>
      ))}
    </span>
  );
}

export function AtalhosModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  return (
    <Modal aberto={aberto} titulo="Atalhos do teclado" onFechar={onFechar}>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-[13.5px]" style={{ color: "var(--ink)" }}>
        {ATALHOS.filter((a) => a.acao !== "ajuda").map((a) => (
          <div key={a.acao + a.teclas} className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid var(--line2)" }}>
            <span>{a.rotulo}{a.doQs && <span className="ml-1 text-[11px]" style={{ color: "var(--ink3)" }}>(QS)</span>}</span>
            <Tecla t={a.teclas} />
          </div>
        ))}
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide mt-5 mb-1" style={{ color: "var(--ink3)" }}>No campo de mensagem</p>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-[13.5px]" style={{ color: "var(--ink)" }}>
        {DO_CAMPO.map(([t, r]) => (
          <div key={t} className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid var(--line2)" }}>
            <span>{r}</span><Tecla t={t} />
          </div>
        ))}
      </div>
      <p className="text-[12px] mt-4" style={{ color: "var(--ink3)" }}>No Mac, use ⌘ no lugar de Ctrl. Clique com o botão direito numa conversa ou mensagem pra ver todas as opções.</p>
    </Modal>
  );
}
