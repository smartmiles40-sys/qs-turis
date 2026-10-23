// src/clientes/ComprasDoCliente.tsx
// Aba "Compras" da ficha (23/10 — cadastro único): o que a pessoa comprou, vindo do
// Bitrix (compras_bitrix, alimentada pelo n8n). Antes isso só existia na tela
// "Clientes & compras" das Expedições, separada da ficha. Casa pelo contato do
// Bitrix da ficha OU pelo CPF. Mesma limpeza da tela antiga (tira venda zerada e o
// mesmo negócio importado 2x).
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Etiqueta } from "@/rel/ui";
import { limparComprasBitrix, nomeCompra, type CompraBitrix } from "@/expedicoes/paginas/_globais/compras";

const moeda = (v: number, m?: string | null) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: m && m.length === 3 ? m : "BRL", maximumFractionDigits: 0 });
const data = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

export async function comprasDoCliente(c: { bitrix_contato_id: string | null; cpf: string | null }): Promise<CompraBitrix[]> {
  const filtros: string[] = [];
  if (c.bitrix_contato_id) filtros.push(`bitrix_contact_id.eq.${c.bitrix_contato_id}`);
  const cpf = (c.cpf ?? "").replace(/\D/g, "");
  if (cpf.length === 11) {
    filtros.push(`cpf.eq.${cpf}`, `cpf.eq.${cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`);
  }
  if (!filtros.length) return [];
  const { data: linhas, error } = await supabase.from("compras_bitrix")
    .select("id,bitrix_deal_id,bitrix_contact_id,cpf,nome_contato,titulo,produto,data_compra,valor,moeda,funil,etapa")
    .or(filtros.join(",")).order("data_compra", { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw new Error(error.message);
  return limparComprasBitrix((linhas ?? []) as CompraBitrix[])
    .sort((a, b) => (b.data_compra ?? "").localeCompare(a.data_compra ?? ""));
}

export default function ComprasDoCliente({ cliente }: { cliente: { id: string; bitrix_contato_id: string | null; cpf: string | null } }) {
  const [compras, setCompras] = useState<CompraBitrix[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setCompras(null); setErro(null);
    comprasDoCliente(cliente).then(setCompras).catch((e) => setErro(e instanceof Error ? e.message : "erro"));
  }, [cliente.id, cliente.bitrix_contato_id, cliente.cpf]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <Aviso tom="erro">As compras não carregaram ({erro}).</Aviso>;
  if (!compras) return <div className="rel-card h-32 animate-pulse" aria-busy="true" />;
  if (!cliente.bitrix_contato_id && (cliente.cpf ?? "").replace(/\D/g, "").length !== 11) {
    return <Aviso>A ficha não tem contato do Bitrix nem CPF — sem isso não dá pra achar as compras. Complete o cadastro.</Aviso>;
  }

  const emReais = compras.filter((c) => !c.moeda || c.moeda === "BRL");
  const total = emReais.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const ticket = emReais.length ? total / emReais.length : 0;

  return (
    <section className="rel-card p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide flex-1" style={{ color: "var(--ink2)" }}>Compras no Bitrix</h2>
        <Etiqueta>{compras.length} compra{compras.length === 1 ? "" : "s"}</Etiqueta>
        {total > 0 && <Etiqueta tom="rel">Total {moeda(total)}</Etiqueta>}
        {emReais.length > 1 && <Etiqueta>Ticket médio {moeda(ticket)}</Etiqueta>}
      </div>
      {compras.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhuma compra no Bitrix com o contato ou o CPF desta ficha.</p>
      ) : (
        <ol className="divide-y" style={{ borderColor: "var(--line)" }}>
          {compras.map((c) => (
            <li key={c.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[12px] w-20 flex-shrink-0" style={{ color: "var(--ink3)" }}>{data(c.data_compra)}</span>
              <span className="flex-1 min-w-[160px] text-[13.5px]" style={{ color: "var(--ink)" }}>
                {nomeCompra(c)}
                <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>
                  {[c.funil, c.etapa, `negócio #${c.bitrix_deal_id}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-[13.5px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{moeda(Number(c.valor ?? 0), c.moeda)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
