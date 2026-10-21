// src/expedicoes/paginas/Clientes.tsx
// Clientes & compras (app antigo: app/(app)/clientes/ClientesTabela.tsx +
// lib/data/compras.ts): quem já comprou, vindo do Bitrix (compras_bitrix). Busca,
// filtro de recorrência, colunas ordenáveis, gaveta com o histórico de viagens e
// "Exportar Excel" — agora gerado no navegador (no antigo era a rota
// /api/clientes/export no servidor). Só leitura.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Botao, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { Busca, Carregando, Gaveta, Selo } from "../ui";
import { formatBRL, formatDate } from "../lib/utils";
import { listarClientesCompras, nomeCompra, type ClienteCompras } from "./_globais/compras";
import { exportarClientesXlsx } from "./_globais/excel";
import { Pilula } from "./_globais/pecas";

type ChaveOrdem = "nome" | "compras" | "total" | "ticket" | "primeira" | "ultima";
const COLS: { key: ChaveOrdem; label: string; direita?: boolean }[] = [
  { key: "nome", label: "Cliente" },
  { key: "compras", label: "Compras", direita: true },
  { key: "total", label: "Total gasto", direita: true },
  { key: "ticket", label: "Ticket médio", direita: true },
  { key: "primeira", label: "1ª compra" },
  { key: "ultima", label: "Última compra" },
];
const valorOrdem = (c: ClienteCompras, k: ChaveOrdem): string | number => {
  switch (k) {
    case "nome": return c.nome.toLowerCase();
    case "compras": return c.totalCompras;
    case "total": return c.totalGasto;
    case "ticket": return c.ticketMedio;
    case "primeira": return c.primeiraCompra ?? "";
    case "ultima": return c.ultimaCompra ?? "";
  }
};
const RECORRENCIA = [
  { id: "todos", label: "Todos", min: 0, max: Infinity },
  { id: "1", label: "1 compra", min: 1, max: 1 },
  { id: "2", label: "Recorrentes (2+)", min: 2, max: Infinity },
  { id: "5", label: "Fiéis (5+)", min: 5, max: Infinity },
  { id: "10", label: "VIP (10+)", min: 10, max: Infinity },
] as const;
const outraMoeda = (c: ClienteCompras) => c.moedas.some((m) => m && m !== "BRL");

export default function Clientes() {
  const { avisar } = useExp();
  const [clientes, setClientes] = useState<ClienteCompras[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<ChaveOrdem>("total");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [rec, setRec] = useState<(typeof RECORRENCIA)[number]["id"]>("todos");
  const [aberto, setAberto] = useState<ClienteCompras | null>(null);
  const [exportando, setExportando] = useState(false);

  const carregar = useCallback(async () => {
    try { setClientes(await listarClientesCompras()); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const trocarOrdem = (k: ChaveOrdem) => {
    if (k === ordem) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setOrdem(k); setDir(k === "nome" ? "asc" : "desc"); }
  };

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const r = RECORRENCIA.find((x) => x.id === rec)!;
    const mult = dir === "asc" ? 1 : -1;
    return (clientes ?? [])
      .filter((c) => !termo || [c.nome, c.cpf, ...c.compras.map(nomeCompra)].filter(Boolean).join(" ").toLowerCase().includes(termo))
      .filter((c) => c.totalCompras >= r.min && c.totalCompras <= r.max)
      .sort((a, b) => {
        const va = valorOrdem(a, ordem), vb = valorOrdem(b, ordem);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
        return String(va).localeCompare(String(vb), "pt-BR") * mult;
      });
  }, [clientes, busca, rec, ordem, dir]);

  const totalGeral = lista.reduce((s, c) => s + c.totalGasto, 0);
  const totalCompras = lista.reduce((s, c) => s + c.totalCompras, 0);
  const temOutraMoeda = (clientes ?? []).some(outraMoeda);

  const exportar = async () => {
    if (!clientes?.length) return;
    setExportando(true);
    try { await exportarClientesXlsx(clientes); avisar("Planilha gerada (.xlsx)"); }
    catch { avisar("Falha ao gerar o arquivo", "erro"); }
    finally { setExportando(false); }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>Clientes & compras</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Quem já comprou (Bitrix). Clique nas colunas pra ordenar — quem gastou mais, quem tem maior ticket, etc.</p>
        </div>
        <div className="w-full sm:w-72"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar por nome, CPF ou viagem…  [/]" /></div>
        {(clientes?.length ?? 0) > 0 && (
          <Botao onClick={exportar} disabled={exportando} title="Baixar a base completa em Excel (Clientes + Compras)">{exportando ? "Gerando…" : "⬇ Exportar Excel"}</Botao>
        )}
      </header>

      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!clientes ? <Carregando /> : clientes.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhuma compra importada ainda" texto="Assim que o n8n enviar as vendas do Bitrix pra cá, a base de clientes aparece aqui — com total gasto, ticket médio e histórico de viagens." /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Pilula rotulo={rec === "todos" ? "clientes" : "no filtro"} valor={lista.length} />
            <Pilula rotulo="compras" valor={totalCompras} />
            <Pilula rotulo="faturado (soma)" valor={formatBRL(totalGeral)} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide mr-1" style={{ color: "var(--ink3)" }}>Recorrência:</span>
            {RECORRENCIA.map((r) => (
              <button key={r.id} onClick={() => setRec(r.id)} aria-pressed={rec === r.id} className="px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                style={rec === r.id ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
                {r.label}
              </button>
            ))}
          </div>

          {lista.length === 0 ? (
            <div className="rel-card py-10 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum cliente com esses filtros.</div>
          ) : (
            <div className="rel-card overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                    <th className="px-3 py-2 text-left font-semibold">#</th>
                    {COLS.map((c) => (
                      <th key={c.key} className={`px-3 py-2 font-semibold whitespace-nowrap ${c.direita ? "text-right" : "text-left"}`} aria-sort={ordem === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                        <button onClick={() => trocarOrdem(c.key)} className="inline-flex items-center gap-1 hover:underline" style={{ color: ordem === c.key ? "var(--ink)" : undefined }} title="Ordenar">
                          {c.label}<span aria-hidden>{ordem === c.key ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c, i) => (
                    <tr key={c.chave} onClick={() => setAberto(c)} className="border-t rel-linha cursor-pointer" style={{ borderColor: "var(--line)" }} title="Ver histórico de compras">
                      <td className="px-3 py-2 text-[11.5px] tabular-nums" style={{ color: "var(--ink3)" }}>{i + 1}</td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <Avatar nome={c.nome} tamanho={26} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}>{c.nome}{c.totalCompras >= 10 && <Selo tom="aviso">VIP</Selo>}</span>
                            {c.cpf && <span className="block font-mono text-[10.5px]" style={{ color: "var(--ink3)" }}>{c.cpf}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.totalCompras}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{formatBRL(c.totalGasto)}{outraMoeda(c) && <span className="ml-0.5" style={{ color: "#EA580C" }}>*</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: "var(--ink2)" }}>{formatBRL(c.ticketMedio)}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: "var(--ink2)" }}>{c.primeiraCompra ? formatDate(c.primeiraCompra) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: "var(--ink2)" }}>{c.ultimaCompra ? formatDate(c.ultimaCompra) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {temOutraMoeda && <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>* Cliente tem compras em outra moeda; o total soma os valores como estão.</p>}
        </>
      )}

      <Gaveta aberta={!!aberto} titulo={aberto?.nome ?? ""} onFechar={() => setAberto(null)}
        subtitulo={aberto ? `${aberto.cpf ? `CPF ${aberto.cpf}` : "sem CPF"} · ${aberto.totalCompras} compra${aberto.totalCompras === 1 ? "" : "s"}` : undefined}
        rodape={<Botao onClick={() => setAberto(null)}>Fechar</Botao>}>
        {aberto && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Resumo rotulo="Total gasto" valor={formatBRL(aberto.totalGasto)} destaque />
              <Resumo rotulo="Ticket médio" valor={formatBRL(aberto.ticketMedio)} />
              <Resumo rotulo="1ª compra" valor={aberto.primeiraCompra ? formatDate(aberto.primeiraCompra) : "—"} />
              <Resumo rotulo="Última" valor={aberto.ultimaCompra ? formatDate(aberto.ultimaCompra) : "—"} />
            </div>
            {aberto.funis.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Funis:</span>
                {aberto.funis.map((f) => <Selo key={f} tom="lista">{f}</Selo>)}
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Histórico de viagens ({aberto.compras.length})</p>
              <ul className="space-y-1.5">
                {aberto.compras.map((co) => (
                  <li key={co.id} className="rounded-lg border p-2.5 flex items-start gap-2" style={{ borderColor: "var(--line)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{nomeCompra(co)}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "var(--ink3)" }}>
                        {co.data_compra && <span>{formatDate(co.data_compra)}</span>}
                        {co.funil && <Selo tom="lista">{co.funil}</Selo>}
                        {co.moeda && co.moeda !== "BRL" && <span>{co.moeda}</span>}
                      </div>
                    </div>
                    <span className="flex-shrink-0 font-semibold tabular-nums text-[13px]">{co.valor != null ? formatBRL(Number(co.valor)) : "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Gaveta>
    </div>
  );
}

function Resumo({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
      <div className="text-[10.5px] uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</div>
      <div className={`tabular-nums ${destaque ? "text-[15px] font-bold" : "text-[13px] font-semibold"}`} style={{ color: "var(--ink)" }}>{valor}</div>
    </div>
  );
}
