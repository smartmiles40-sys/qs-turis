// tests/ts-loader.mjs
// O projeto não tem vitest/jest e o Node daqui (20) não lê TypeScript sozinho.
// Este gancho transpila os .ts na hora com o `typescript` que já está no
// node_modules (só tira os tipos — não checa nada; quem checa é o `tsc -b`).
// Uso:  node --import ./tests/registrar-ts.mjs --test tests/expedicoes/*.test.ts
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);
  const fonte = await readFile(new URL(url), "utf8");
  const { outputText } = ts.transpileModule(fonte, {
    fileName: new URL(url).pathname,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true, sourceMap: false },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
