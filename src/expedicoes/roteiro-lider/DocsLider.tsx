// src/expedicoes/roteiro-lider/DocsLider.tsx
// "Documentos da Área do Líder" (app antigo: roteiro-lider/DocsLiderPanel.tsx).
// PDFs da expedição pros líderes (ex.: manual). Contrato com o /lider (app
// antigo): linha em `arquivos` SEM passageiro, categoria "Outros" e descricao
// exatamente "Documento do líder"; mime e tamanho_bytes preenchidos (o modo
// offline do líder soma o tamanho). Só aqui eles podem ser removidos — o Drive
// da aba Documentos trava esses arquivos.
import { useCallback, useEffect, useRef, useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, Cartao, useAoVivo } from "../ui";
import { supabase, erroOuDados } from "../lib/banco";
import { MARCADOR_DOC_LIDER } from "../lib/constants";
import type { ArquivoRow } from "../lib/database";
import { abrirArquivo, enviarArquivo, excluirArquivo, formatarTamanho } from "../drive/arquivos";
import { IconeSvg } from "../drive/icones";

export default function DocsLider({ expedicaoId }: { expedicaoId: string }) {
  const { somenteLeitura, avisar } = useExp();
  const [docs, setDocs] = useState<ArquivoRow[]>([]);
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try {
      setDocs(erroOuDados(await supabase.from("arquivos").select("*").eq("expedicao_id", expedicaoId)
        .is("passageiro_id", null).eq("descricao", MARCADOR_DOC_LIDER).order("created_at", { ascending: true })) as ArquivoRow[]);
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao carregar documentos", "erro"); }
  }, [expedicaoId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "arquivos", filtro: `expedicao_id=eq.${expedicaoId}` }], carregar);

  async function enviar(f: File | undefined) {
    if (!f) return;
    setEnviando(true);
    try {
      await enviarArquivo({ expedicaoId, categoria: "Outros", descricao: MARCADOR_DOC_LIDER, arquivo: f });
      avisar("Documento adicionado — já aparece na Área do Líder.");
      await carregar();
    } catch (e) { avisar(e instanceof Error ? e.message : "Falha no envio", "erro"); }
    finally { setEnviando(false); if (ref.current) ref.current.value = ""; }
  }

  return (
    <Cartao titulo={<span className="inline-flex items-center gap-2"><IconeSvg nome="livro" /> Documentos da Área do Líder</span>}>
      <p className="text-[12px] -mt-1 mb-3" style={{ color: "var(--ink3)" }}>
        PDFs da expedição para os líderes (ex.: manual do líder). Aparecem na seção “Documentos da expedição” do portal do líder e ficam disponíveis offline.
      </p>
      {docs.length > 0 ? (
        <ul className="mb-3 rounded-lg border divide-y" style={{ borderColor: "var(--line)" }}>
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <span style={{ color: "var(--ink3)" }}><IconeSvg nome="documento" /></span>
              <span className="min-w-0 flex-1 truncate text-[13px]" title={d.nome} style={{ color: "var(--ink)" }}>{d.nome}</span>
              <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{formatarTamanho(d.tamanho_bytes)}</span>
              <button type="button" className="text-[12px] font-semibold hover:underline" style={{ color: "var(--rel-ink)" }}
                onClick={() => abrirArquivo(d.storage_path).catch((e) => avisar(e instanceof Error ? e.message : "Erro ao abrir", "erro"))}>Ver</button>
              <BotaoExcluir titulo={`Remover "${d.nome}" da Área do Líder?`} sucesso="Documento removido"
                onConfirmar={async () => { await excluirArquivo(d.id); await carregar(); }} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 rounded-lg border border-dashed p-3 text-[12px]" style={{ borderColor: "var(--line)", color: "var(--ink3)" }}>Nenhum documento ainda.</p>
      )}
      {!somenteLeitura && (
        <>
          <Botao onClick={() => ref.current?.click()} disabled={enviando}><IconeSvg nome="upload" /> {enviando ? "Enviando…" : "Adicionar PDF"}</Botao>
          <input ref={ref} type="file" accept="application/pdf,image/*" hidden onChange={(e) => void enviar(e.target.files?.[0])} />
        </>
      )}
    </Cartao>
  );
}
