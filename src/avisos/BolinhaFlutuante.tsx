// src/avisos/BolinhaFlutuante.tsx
// -----------------------------------------------------------------------------
// A BOLINHA FLUTUANTE (0196): o que aparece dentro da janelinha "sempre por
// cima" (Document Picture-in-Picture, Chrome/Edge 116+). A pessoa arrasta a
// janelinha pela barra de cima, pra qualquer canto da tela.
//
// A janelinha é OUTRO documento: não tem o Tailwind nem as cores do QS. Por isso
// aqui é tudo estilo próprio (CSS_BOLINHA, injetado pelo AvisosProvider).
// -----------------------------------------------------------------------------
import type { Aviso } from "./lib";
import { COR_TIPO } from "./lib";

export const CSS_BOLINHA = `
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { background: #0F172A; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         display: flex; align-items: center; justify-content: center; overflow: hidden; user-select: none; }
  .qs-b { all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 6px; width: 100%; height: 100%; padding: 8px; text-align: center; }
  .qs-b:focus-visible { outline: 2px solid #93C5FD; outline-offset: -4px; }
  .qs-c { position: relative; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 24px; line-height: 1; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .qs-c.zero { background: #334155; color: #CBD5E1; font-size: 13px; font-weight: 700; }
  .qs-c.tem { background: #0147FF; color: #fff; }
  .qs-onda { position: absolute; inset: 0; border-radius: 50%; border: 3px solid #60A5FA; opacity: 0; pointer-events: none; }
  .qs-onda.vai { animation: qs-onda 1.1s ease-out 3; }
  @keyframes qs-onda { 0% { transform: scale(1); opacity: .9; } 100% { transform: scale(1.55); opacity: 0; } }
  .qs-c.vai { animation: qs-pula .45s ease-in-out 3; }
  @keyframes qs-pula { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }
  .qs-t { font-size: 11px; line-height: 1.25; color: #E2E8F0; max-width: 100%; overflow: hidden;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .qs-t.vazio { color: #94A3B8; }
  .qs-tipo { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  @media (prefers-reduced-motion: reduce) { .qs-onda.vai, .qs-c.vai { animation: none; } }
`;

export default function BolinhaFlutuante({ total, mais, pulso, ultimo, onClicar }: {
  total: number;
  mais: boolean;
  /** Muda a cada aviso novo — reinicia a animação. */
  pulso: number;
  ultimo: Aviso | null;
  onClicar: () => void;
}) {
  const numero = mais ? `${total}+` : String(total);
  return (
    <button className="qs-b" onClick={onClicar}
      title={ultimo ? `${ultimo.titulo} — clique pra abrir no QS` : "Sem avisos novos — clique pra ir pro QS"}
      aria-label={total ? `${numero} avisos novos. Abrir o QS` : "Nenhum aviso novo. Abrir o QS"}>
      <span key={pulso} className={`qs-c ${total ? "tem" : "zero"} ${pulso && total ? "vai" : ""}`}>
        {total ? numero : "QS"}
        <span className={`qs-onda ${pulso && total ? "vai" : ""}`} />
      </span>
      <span className={`qs-t ${ultimo ? "" : "vazio"}`}>
        {ultimo ? (
          <>
            <span className="qs-tipo" style={{ background: COR_TIPO[ultimo.tipo] ?? "#60A5FA" }} aria-hidden />
            {ultimo.titulo}
          </>
        ) : "Tudo em dia"}
      </span>
    </button>
  );
}
