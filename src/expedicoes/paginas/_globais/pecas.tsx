// src/expedicoes/paginas/_globais/pecas.tsx
// Peças pequenas das telas globais: pílula de número (StatPill do app antigo),
// avatar com foto do viajante (arquivo do bucket via link assinado) e o hook que
// assina os links das fotos de uma lista inteira de uma vez.
import { useEffect, useState } from "react";
import { Avatar } from "@/rel/ui";
import { lerPorIds, supabase } from "../../lib/banco";

export function Pilula({ rotulo, valor, cor }: { rotulo: string; valor: number | string; cor?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 px-3 py-1 rounded-full border text-[12.5px]" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
      <b className="tabular-nums" style={{ color: cor ?? "var(--ink)" }}>{valor}</b><span style={{ color: "var(--ink3)" }}>{rotulo}</span>
    </span>
  );
}

export function FotoAvatar({ nome, url, tamanho = 36 }: { nome: string; url?: string | null; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) return <Avatar nome={nome} tamanho={tamanho} />;
  return <img src={url} alt="" onError={() => setFalhou(true)} className="rounded-full object-cover flex-shrink-0" style={{ width: tamanho, height: tamanho }} />;
}

/** id do arquivo → link assinado (1 h). Links pedidos em lote; ids repetidos não pedem de novo. */
export function useLinksDeArquivos(ids: (string | null | undefined)[]): Record<string, string> {
  const [links, setLinks] = useState<Record<string, string>>({});
  const chave = [...new Set(ids.filter((x): x is string => !!x))].sort().join(",");
  useEffect(() => {
    const faltam = chave ? chave.split(",").filter((id) => !links[id]) : [];
    if (faltam.length === 0) return;
    let vivo = true;
    (async () => {
      try {
        const arqs = await lerPorIds<{ id: string; storage_path: string }>("arquivos", "id", faltam, "id, storage_path");
        if (!arqs.length) return;
        const { data } = await supabase.storage.from("arquivos-expedicoes").createSignedUrls(arqs.map((a) => a.storage_path), 3600);
        const porCaminho = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
        const novos: Record<string, string> = {};
        for (const a of arqs) { const u = porCaminho.get(a.storage_path); if (u) novos[a.id] = u; }
        if (vivo) setLinks((l) => ({ ...l, ...novos }));
      } catch { /* sem foto, fica a inicial */ }
    })();
    return () => { vivo = false; };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  return links;
}
