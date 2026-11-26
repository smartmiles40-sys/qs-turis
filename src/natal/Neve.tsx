// src/natal/Neve.tsx — neve caindo de leve (só no Clima de Natal).
// Poucos flocos, pequenos e translúcidos; não pega clique (pointer-events: none)
// e some pra quem pede menos movimento no sistema (natal.css).
import { useNatal } from "./natal";

// Posições fixas (sem Math.random a cada render): x %, duração s, atraso s, tamanho px.
const FLOCOS: Array<[number, number, number, number]> = [
  [3, 14, 0, 10], [9, 18, 6, 7], [15, 12, 3, 12], [22, 20, 10, 8], [28, 15, 1, 9],
  [34, 17, 8, 11], [41, 13, 4, 7], [47, 19, 12, 10], [53, 16, 2, 8], [59, 14, 9, 12],
  [65, 21, 5, 7], [71, 15, 11, 9], [77, 18, 0, 11], [83, 13, 7, 8], [89, 20, 3, 10],
  [95, 16, 13, 7], [12, 22, 15, 9], [38, 19, 17, 8], [62, 17, 16, 10], [86, 21, 14, 7],
];

export function Neve() {
  const { ligado } = useNatal();
  if (!ligado) return null;
  return (
    <div className="qs-neve" aria-hidden>
      {FLOCOS.map(([x, d, atraso, t], i) => (
        <span key={i} style={{ left: `${x}%`, fontSize: t, animationDuration: `${d}s`, animationDelay: `-${atraso}s` }}>{"❄︎"}</span>
      ))}
    </div>
  );
}
