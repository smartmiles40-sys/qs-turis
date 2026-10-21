// src/rel/clientes/ArquivosDasExpedicoes.tsx
// -----------------------------------------------------------------------------
// CADASTRO ÚNICO (0172) na ficha: os arquivos que o Operações guardou nas idas
// da pessoa (tabela `arquivos`, bucket privado arquivos-expedicoes) — passaporte,
// vacina, seguro, bilhetes… direto da fonte, com link assinado gerado no clique.
// A importação de 13/10 tinha COPIADO parte deles pro rel_documentos
// (ref_externa 'exp-arq:<id>'): enquanto o original existe, a cópia some da
// seção "Documentos" (a ficha avisa via onCopias) e o status de conferência
// dela aparece aqui, no original.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import type { IdaEmExpedicao } from "@/clientes/cadastroUnico";
import { arquivosDasIdas, copiasDosArquivos, type ArquivoDaIda } from "@/clientes/idasDetalhe";
import { linkDoArquivo } from "@/expedicoes/lib/banco";
import { Aviso, Etiqueta } from "../ui";

const tamanho = (b: number | null) => (!b ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function ArquivosDasExpedicoes({ idas, onCopias }: {
  idas: IdaEmExpedicao[];
  /** Ids (rel_documentos) das cópias de 13/10 cujo original aparece aqui — a seção Documentos esconde. */
  onCopias?: (ids: Set<string>) => void;
}) {
  const [lista, setLista] = useState<ArquivoDaIda[] | null>(null);
  const [copias, setCopias] = useState<Map<string, { id: string; status: string }>>(new Map());
  const [erro, setErro] = useState<string | null>(null);

  const chave = idas.map((i) => i.id).join(",");
  useEffect(() => {
    let atual = true;
    setLista(null); setErro(null);
    if (!idas.length) { setLista([]); onCopias?.(new Set()); return; }
    arquivosDasIdas(idas.map((i) => i.id))
      .then(async (l) => {
        if (!atual) return;
        setLista(l);
        const c = await copiasDosArquivos(l.map((a) => a.id));
        if (!atual) return;
        setCopias(c);
        onCopias?.(new Set([...c.values()].map((x) => x.id)));
      })
      .catch((e) => { if (atual) { setErro(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "erro"); setLista([]); } });
    return () => { atual = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  // nome da expedição de cada arquivo (pela ida, ou pela própria expedição do arquivo)
  const nomeExp = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of idas) if (i.expedicao) m.set(i.expedicao_id, `${i.expedicao.nome}${i.expedicao.codigo ? ` (${i.expedicao.codigo})` : ""}`);
    return m;
  }, [idas]);
  const grupos = useMemo(() => {
    const g = new Map<string, ArquivoDaIda[]>();
    for (const a of lista ?? []) {
      const k = a.expedicao_id ?? "";
      const arr = g.get(k); if (arr) arr.push(a); else g.set(k, [a]);
    }
    return [...g.entries()];
  }, [lista]);

  async function abrir(a: ArquivoDaIda, baixar = false) {
    const aba = baixar ? null : window.open("", "_blank");
    try {
      const url = await linkDoArquivo(a.storage_path, baixar ? (a.nome ?? "arquivo") : undefined);
      if (aba) { aba.opener = null; aba.location.href = url; } else window.location.assign(url);
    } catch (e) {
      aba?.close();
      setErro(e instanceof Error ? e.message : "Não consegui abrir o arquivo.");
    }
  }

  if (!idas.length) return null;
  return (
    <section className="rel-card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Arquivos das expedições</h2>
        {lista && lista.length > 0 && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{lista.length}</span>}
      </div>
      <p className="text-[12px] mb-2" style={{ color: "var(--ink3)" }}>
        Direto do Operações (só leitura aqui). Os documentos que o Relacionamento recebeu ficam em "Documentos".
      </p>
      {erro && <div className="mb-2"><Aviso tom="erro">{erro}</Aviso></div>}
      {lista === null ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhum arquivo guardado nas expedições desta pessoa.</p>
      ) : grupos.map(([expId, arqs]) => (
        <div key={expId || "sem"} className="mt-2">
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Expedição: {nomeExp.get(expId) ?? "outra expedição"}</p>
          {arqs.map((a) => {
            const copia = copias.get(a.id);
            return (
              <div key={a.id} className="flex items-center gap-3 py-1.5">
                <span className="text-[10px] font-bold uppercase w-10 text-center py-1 rounded flex-shrink-0" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
                  {(a.nome?.split(".").pop() || "arq").slice(0, 4)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] truncate" style={{ color: "var(--ink)" }} title={a.nome ?? ""}>{a.descricao || a.nome || "arquivo"}</span>
                  <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>
                    {[a.categoria, a.descricao && a.nome ? a.nome : null, new Date(a.created_at).toLocaleDateString("pt-BR"), tamanho(a.tamanho_bytes)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {copia?.status === "aprovado" && <Etiqueta tom="rel">conferido</Etiqueta>}
                {copia?.status === "recusado" && <Etiqueta tom="erro">recusado</Etiqueta>}
                <button type="button" onClick={() => void abrir(a)} className="text-[12px] font-semibold underline min-h-[32px] px-1" style={{ color: "var(--rel-ink)" }}>Abrir</button>
                <button type="button" onClick={() => void abrir(a, true)} className="text-[12px] font-semibold underline min-h-[32px] px-1" style={{ color: "var(--rel-ink)" }}>Baixar</button>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
