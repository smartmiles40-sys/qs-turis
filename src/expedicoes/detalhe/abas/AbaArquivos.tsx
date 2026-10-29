// src/expedicoes/detalhe/abas/AbaArquivos.tsx
// -----------------------------------------------------------------------------
// ABA "ARQUIVOS" DO COCKPIT (redesign 29/10, spec §3.2). Junta o Drive da
// expedição (que ficava em "Documentos") e a aba "Links":
//   • grade das 10 pastas com contagem (pasta vazia tracejada); clicar filtra o Drive
//   • aviso quando mais da metade dos arquivos está em "Outros" (mal arquivados)
//   • o Drive de sempre embaixo (enviar, renomear, mover de pasta, excluir)
//   • os Links da expedição (o portal /amigo lê os mesmos)
// O status de documentos POR PASSAGEIRO foi pra aba Passageiros (StatusDocumentosPax).
// ?secao=drive|links rola até o bloco.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Drive from "../../drive/Drive";
import { IconeCategoria } from "../../drive/icones";
import { CATEGORIA_ARQUIVO, type CategoriaArquivo } from "../../lib/constants";
import type { ArquivoRow } from "../../lib/database";
import type { PropsAba } from "../ExpedicaoDetalhe";
import AbaLinks from "./AbaLinks";

export default function AbaArquivos(props: PropsAba) {
  const { exp, cockpit } = props;
  const [pasta, setPasta] = useState<CategoriaArquivo | "Todos">("Todos");
  const [arquivos, setArquivos] = useState<ArquivoRow[] | null>(null);
  const secao = cockpit?.secao ?? null;

  useEffect(() => {
    if (secao !== "drive" && secao !== "links") return;
    const t = window.setTimeout(() => document.getElementById(`ck-sec-${secao}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return () => window.clearTimeout(t);
  }, [secao]);

  const contagem = new Map<string, number>();
  for (const a of arquivos ?? []) contagem.set(a.categoria, (contagem.get(a.categoria) ?? 0) + 1);
  const total = arquivos?.length ?? 0;
  const outros = contagem.get("Outros") ?? 0;
  const malArquivados = total >= 4 && outros / total > 0.5;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section id="ck-sec-drive" className="ck-card" aria-label="Arquivos da expedição">
        <div className="ck-card__h">
          <h3 className="ck-h3">Arquivos da expedição</h3>
          <span className="ck-nota">{arquivos ? `${total} arquivo${total === 1 ? "" : "s"}` : "carregando…"}{pasta !== "Todos" ? ` · pasta ${pasta}` : ""}</span>
        </div>

        {malArquivados && (
          <div className="ck-banner" role="status">
            <div className="ck-banner__tx">
              <b>{outros} de {total} arquivos estão em “Outros”</b>
              <span>Mova cada um pra pasta certa (lápis → Pasta). O portal e a prontidão só enxergam o que está na pasta certa.</span>
            </div>
          </div>
        )}

        <div className="ck-pastas" role="group" aria-label="Pastas">
          <button type="button" className="ck-pasta" aria-pressed={pasta === "Todos"} onClick={() => setPasta("Todos")}>
            <b>Todos</b><span className="ck-nota">{total} arquivo{total === 1 ? "" : "s"}</span>
          </button>
          {CATEGORIA_ARQUIVO.map((c) => {
            const qtd = contagem.get(c) ?? 0;
            return (
              <button key={c} type="button" className="ck-pasta" aria-pressed={pasta === c}
                data-vazia={qtd === 0 ? "true" : undefined} data-outros={c === "Outros" && malArquivados ? "true" : undefined}
                onClick={() => setPasta(pasta === c ? "Todos" : c)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconeCategoria categoria={c} /><b>{c}</b></span>
                <span className="ck-nota">{qtd ? `${qtd} arquivo${qtd === 1 ? "" : "s"}` : "vazia"}</span>
              </button>
            );
          })}
        </div>

        <Drive expedicaoId={exp.id} pasta={pasta} onPasta={setPasta} ocultarPastas onArquivos={setArquivos}
          onMudou={() => cockpit?.recarregarResumo()} />
      </section>

      <section id="ck-sec-links" className="ck-card" aria-label="Links">
        <h3 className="ck-h3">Links</h3>
        <AbaLinks {...props} />
      </section>
    </div>
  );
}
