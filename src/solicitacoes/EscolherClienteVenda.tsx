// src/solicitacoes/EscolherClienteVenda.tsx
// -----------------------------------------------------------------------------
// Amarra o pedido a um CLIENTE e, se tiver, à VENDA (0150, Bruno 20/10: "devem
// ficar marcadas dentro da ficha daquele cliente … e amarrar a qual venda é").
// Busca por nome, telefone, CPF ou e-mail; escolhido o cliente, lista as vendas
// dele (as que vão acontecer primeiro) + "sem venda específica".
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Entrada } from "@/rel/ui";
import { SERVICOS, type Servico } from "@/rel/lib/viagens";
import { acharClientes, textoVenda, vendasDoCliente, type ClienteAchado, type VendaDoCliente } from "./lib";

export interface Escolha { clienteId: string; clienteNome: string; viagemId: string | null; vendaTexto: string | null }

export default function EscolherClienteVenda({ valor, onMudar, buscaInicial = "", travarCliente = false }: {
  valor: Escolha | null;
  onMudar: (e: Escolha | null) => void;
  buscaInicial?: string;
  /** Veio de dentro da ficha/viagem: o cliente já está certo, só escolhe a venda. */
  travarCliente?: boolean;
}) {
  const [termo, setTermo] = useState(buscaInicial);
  const [achados, setAchados] = useState<ClienteAchado[] | null>(null);
  const [vendas, setVendas] = useState<VendaDoCliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Busca enquanto digita (espera 300ms parar).
  useEffect(() => {
    if (valor) return;
    const t = termo.trim();
    if (t.length < 2) { setAchados(null); return; }
    const h = setTimeout(() => { acharClientes(t).then(setAchados).catch((e) => setErro(e instanceof Error ? e.message : "Não buscou.")); }, 300);
    return () => clearTimeout(h);
  }, [termo, valor]);

  const clienteId = valor?.clienteId ?? null;
  useEffect(() => {
    setVendas(null);
    if (clienteId) vendasDoCliente(clienteId).then(setVendas).catch(() => setVendas([]));
  }, [clienteId]);

  if (!valor) {
    return (
      <div className="space-y-1.5">
        <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nome, telefone, CPF ou e-mail do cliente" aria-label="Buscar cliente" />
        {erro && <p className="text-[12px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
        {achados && achados.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhum cliente com isso. Confira o nome ou busque pelo telefone.</p>}
        {achados && achados.length > 0 && (
          <ul className="rel-card max-h-56 overflow-y-auto divide-y" style={{ borderColor: "var(--line)" }}>
            {achados.map((c) => (
              <li key={c.id}>
                <button type="button" className="rel-linha w-full text-left px-3 py-2 text-[13.5px] flex items-center gap-2"
                  onClick={() => onMudar({ clienteId: c.id, clienteNome: c.nome, viagemId: null, vendaTexto: null })}>
                  <span className="font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{c.nome}</span>
                  <span className="text-[12px] whitespace-nowrap" style={{ color: "var(--ink3)" }}>
                    {c.telefone_fim ? `tel •${c.telefone_fim}` : c.email_mascarado ?? ""} · {c.vendas} venda{c.vendas === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[13.5px]">
        <span className="font-semibold" style={{ color: "var(--ink)" }}>{valor.clienteNome}</span>
        {!travarCliente && (
          <button type="button" className="underline text-[12px]" style={{ color: "var(--ink3)" }} onClick={() => { onMudar(null); setTermo(""); }}>trocar cliente</button>
        )}
      </div>
      <label className="block">
        <span className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Qual venda?</span>
        <select className="rel-input" value={valor.viagemId ?? ""} disabled={vendas === null}
          onChange={(e) => {
            const v = vendas?.find((x) => x.id === e.target.value) ?? null;
            onMudar({ ...valor, viagemId: v?.id ?? null, vendaTexto: v ? textoVenda(v) : null });
          }}>
          <option value="">{vendas === null ? "Carregando vendas…" : "Sem venda específica (só o cliente)"}</option>
          {(vendas ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {textoVenda(v)}{v.servico && SERVICOS[v.servico as Servico] ? ` · ${SERVICOS[v.servico as Servico]}` : ""}{v.comprador ? "" : " · como passageiro"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
