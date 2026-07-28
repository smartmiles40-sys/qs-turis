// src/components/sdr/wa/waFormat.tsx
// -----------------------------------------------------------------------------
// A formatação do WhatsApp, desenhada na tela do QS.
//
// O WhatsApp não usa Markdown. Lá o negrito é UM asterisco (`*Victor Hugo*`),
// não dois — `**assim**` faria o cliente ver os asteriscos sobrando. Como o QS
// mostrava o texto cru, o SDR via `*Victor Hugo*` com os sinais aparecendo,
// enquanto o cliente recebia o nome em negrito de verdade. Isto aqui alinha as
// duas telas: o SDR passa a ver exatamente o que o cliente vê.
//
//   *negrito*   _itálico_   ~riscado~   ```mono```   `mono`
//
// Escrito como varredura em vez de regex de propósito: a regra do WhatsApp
// depende de "não tem espaço colado no delimitador" (senão `2 * 3 * 4` viraria
// itálico), e isso em regex exige lookbehind — que Safari antigo não engole.
// -----------------------------------------------------------------------------

import type { ReactNode } from "react";

const DELIMITADORES: Record<string, "b" | "i" | "s" | "code"> = {
  "*": "b",
  _: "i",
  "~": "s",
  "`": "code",
};

/** Um trecho já classificado. `marcas` é a pilha de estilos ativos. */
interface Trecho {
  texto: string;
  marcas: Set<"b" | "i" | "s" | "code">;
}

/**
 * Quebra o texto em trechos com seus estilos. Um delimitador só abre formatação
 * se houver um par de fechamento NA MESMA LINHA e sem espaço colado por dentro —
 * é o que evita que uma multiplicação ou um `_` de nome de arquivo virem estilo.
 */
function varrer(texto: string, herdadas = new Set<"b" | "i" | "s" | "code">()): Trecho[] {
  const saida: Trecho[] = [];
  let buffer = "";

  const despeja = () => {
    if (buffer) {
      saida.push({ texto: buffer, marcas: new Set(herdadas) });
      buffer = "";
    }
  };

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    const estilo = DELIMITADORES[ch];

    // Já estamos dentro deste estilo? Então este caractere é literal — senão
    // `*a*b*` entraria em recursão sem fim.
    if (!estilo || herdadas.has(estilo)) {
      buffer += ch;
      continue;
    }

    // Bloco de código do WhatsApp: ```...```
    if (ch === "`" && texto.startsWith("```", i)) {
      const fim = texto.indexOf("```", i + 3);
      if (fim > i + 2) {
        despeja();
        saida.push({ texto: texto.slice(i + 3, fim), marcas: new Set([...herdadas, "code"]) });
        i = fim + 2;
        continue;
      }
    }

    const depois = texto[i + 1];
    if (depois === undefined || depois === " " || depois === "\n") {
      buffer += ch;
      continue;
    }

    // Procura o fechamento na mesma linha, sem espaço imediatamente antes dele.
    let fim = -1;
    for (let j = i + 1; j < texto.length; j++) {
      if (texto[j] === "\n") break;
      if (texto[j] === ch && texto[j - 1] !== " " && j > i + 1) { fim = j; break; }
    }
    if (fim === -1) {
      buffer += ch;
      continue;
    }

    despeja();
    const dentro = texto.slice(i + 1, fim);
    saida.push(...varrer(dentro, new Set([...herdadas, estilo])));
    i = fim;
  }

  despeja();
  return saida;
}

/** O texto sem os sinais de formatação — pro preview da lista de conversas. */
export function waPlain(texto: string | null | undefined): string {
  if (!texto) return "";
  return varrer(texto).map((t) => t.texto).join("");
}

/**
 * Renderiza o texto da mensagem com a formatação do WhatsApp aplicada.
 * Não usa dangerouslySetInnerHTML: o conteúdo vem do cliente, então vira
 * elemento React, nunca HTML.
 */
export function WaTexto({ texto }: { texto: string }) {
  const trechos = varrer(texto);
  return (
    <>
      {trechos.map((t, i) => {
        let node: ReactNode = t.texto;
        if (t.marcas.has("code")) {
          node = <code key={`c${i}`} className="px-1 rounded text-[13px]" style={{ background: "rgba(127,127,127,.18)" }}>{node}</code>;
        }
        if (t.marcas.has("s")) node = <s key={`s${i}`}>{node}</s>;
        if (t.marcas.has("i")) node = <i key={`i${i}`}>{node}</i>;
        if (t.marcas.has("b")) node = <b key={`b${i}`}>{node}</b>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}
