// src/rel/viagens/ComentariosBitrix.tsx
// -----------------------------------------------------------------------------
// COMENTÁRIOS DO BITRIX NO CARD (0140, 16/10/2026). Bruno: "de alguns clientes
// as informações estão nos comentários". Mostra o que o time escreveu na linha
// do tempo dos negócios desta viagem e do contato de cada passageiro — o mais
// recente primeiro.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Comentario { id: string; entidade: "deal" | "contact"; entidade_id: string; criado_em: string | null; texto: string; arquivos: { nome?: string }[] }

export default function ComentariosBitrix({ viagemId, clientes }: { viagemId: string; clientes: string[] }) {
  const [lista, setLista] = useState<Comentario[] | null>(null);
  const [todos, setTodos] = useState(false);
  const chave = clientes.join(",");
  useEffect(() => {
    let vivo = true;
    const filtro = clientes.length ? `viagem_id.eq.${viagemId},cliente_id.in.(${clientes.join(",")})` : `viagem_id.eq.${viagemId}`;
    supabase.from("rel_bitrix_comentarios").select("id, entidade, entidade_id, criado_em, texto, arquivos").or(filtro)
      .order("criado_em", { ascending: false }).limit(200)
      .then(({ data }) => { if (vivo) setLista(((data ?? []) as Comentario[]).filter((c) => c.texto.trim() || c.arquivos.length)); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viagemId, chave]);

  if (lista === null) return <div className="h-16 rounded-lg animate-pulse" style={{ background: "var(--card2)" }} />;
  if (!lista.length) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum comentário no Bitrix (ou ainda não importado — a importação roda a cada 3 minutos).</p>;
  const mostra = todos ? lista : lista.slice(0, 6);
  return (
    <div>
      <ul className="space-y-2">
        {mostra.map((c) => (
          <li key={c.id} className="rounded-lg px-3 py-2" style={{ background: "var(--card2)" }}>
            <p className="text-[11px] font-semibold mb-0.5" style={{ color: "var(--ink3)" }}>
              {c.criado_em ? new Date(c.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
              {" · "}{c.entidade === "deal" ? `negócio #${c.entidade_id}` : "contato"}
            </p>
            <p className="text-[13px] whitespace-pre-wrap break-words" style={{ color: "var(--ink)" }}>{c.texto}</p>
            {c.arquivos.length > 0 && <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>📎 {c.arquivos.map((a) => a.nome || "arquivo").join(", ")} (no Bitrix)</p>}
          </li>
        ))}
      </ul>
      {lista.length > 6 && (
        <button className="mt-2 text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => setTodos((x) => !x)}>
          {todos ? "Mostrar menos" : `Ver todos os ${lista.length} comentários`}
        </button>
      )}
    </div>
  );
}
