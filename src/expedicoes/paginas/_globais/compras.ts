// src/expedicoes/paginas/_globais/compras.ts
// Base de clientes vinda do Bitrix (tabela compras_bitrix, alimentada pelo n8n).
// Porte de lib/data/compras.ts do app antigo: tira vendas zeradas, deduplica o
// mesmo negócio importado 2x ("#NNN" no título) e agrupa por pessoa.
// Correção: o CPF agora casa só pelos dígitos (no antigo comparava o texto cru,
// e "111.222.333-44" e "11122233344" viravam duas pessoas).
import { lerTudo } from "../../lib/banco";

export type CompraBitrix = {
  id: string;
  bitrix_deal_id: string;
  bitrix_contact_id: string | null;
  cpf: string | null;
  nome_contato: string | null;
  titulo: string | null;
  /** Nome real da expedição/pacote (Bitrix via n8n). Fallback: titulo. */
  produto: string | null;
  data_compra: string | null;
  valor: number | null;
  moeda: string | null;
  funil: string | null;
  etapa: string | null;
};

export type ClienteCompras = {
  chave: string;
  nome: string;
  cpf: string | null;
  bitrix_contact_id: string | null;
  totalCompras: number;
  totalGasto: number;
  ticketMedio: number;
  moedas: string[];
  funis: string[];
  primeiraCompra: string | null;
  ultimaCompra: string | null;
  compras: CompraBitrix[];
};

export const normTexto = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** O que a pessoa comprou: nome real (produto) quando houver, senão o título do deal. */
export function nomeCompra(c: Pick<CompraBitrix, "produto" | "titulo">): string {
  return c.produto?.trim() || c.titulo?.trim() || "Negócio sem título";
}

function chave(c: CompraBitrix): string {
  const cpf = digitos(c.cpf);
  if (cpf.length >= 11) return `cpf:${cpf}`;
  if (c.bitrix_contact_id) return `bx:${c.bitrix_contact_id}`;
  return `nome:${normTexto(c.nome_contato)}`;
}

function numeroNegocio(titulo: string | null): string | null {
  const m = /#\s*(\d+)/.exec(titulo ?? "");
  return m ? m[1] : null;
}

/** Sem vendas zeradas e sem o mesmo negócio duas vezes (fica o canônico, senão o de maior valor / mais recente). */
export function limparComprasBitrix(compras: CompraBitrix[]): CompraBitrix[] {
  const comValor = compras.filter((c) => c.valor != null && Number(c.valor) !== 0);
  const grupos = new Map<string, CompraBitrix[]>();
  const resultado: CompraBitrix[] = [];
  for (const c of comValor) {
    const n = numeroNegocio(c.titulo);
    if (!n) { resultado.push(c); continue; }
    const arr = grupos.get(n) ?? [];
    arr.push(c);
    grupos.set(n, arr);
  }
  for (const [num, arr] of grupos) {
    if (arr.length === 1) { resultado.push(arr[0]); continue; }
    resultado.push(arr.find((c) => String(c.bitrix_deal_id) === num)
      ?? [...arr].sort((a, b) => Number(b.valor) - Number(a.valor) || (b.data_compra ?? "").localeCompare(a.data_compra ?? ""))[0]);
  }
  return resultado;
}

export async function listarClientesCompras(): Promise<ClienteCompras[]> {
  const compras = limparComprasBitrix(await lerTudo<CompraBitrix>("compras_bitrix"));
  const porChave = new Map<string, ClienteCompras>();
  for (const c of compras) {
    const k = chave(c);
    let cli = porChave.get(k);
    if (!cli) {
      cli = { chave: k, nome: c.nome_contato ?? "Sem nome", cpf: c.cpf, bitrix_contact_id: c.bitrix_contact_id, totalCompras: 0, totalGasto: 0, ticketMedio: 0, moedas: [], funis: [], primeiraCompra: null, ultimaCompra: null, compras: [] };
      porChave.set(k, cli);
    }
    cli.compras.push(c);
    cli.totalCompras += 1;
    if (c.valor != null) cli.totalGasto += Number(c.valor);
    if (c.moeda && !cli.moedas.includes(c.moeda)) cli.moedas.push(c.moeda);
    if (c.funil && !cli.funis.includes(c.funil)) cli.funis.push(c.funil);
    if (c.nome_contato && cli.nome === "Sem nome") cli.nome = c.nome_contato;
    if (!cli.cpf && c.cpf) cli.cpf = c.cpf;
    if (!cli.bitrix_contact_id && c.bitrix_contact_id) cli.bitrix_contact_id = c.bitrix_contact_id;
    if (c.data_compra && (!cli.ultimaCompra || c.data_compra > cli.ultimaCompra)) cli.ultimaCompra = c.data_compra;
    if (c.data_compra && (!cli.primeiraCompra || c.data_compra < cli.primeiraCompra)) cli.primeiraCompra = c.data_compra;
  }
  const lista = [...porChave.values()];
  for (const cli of lista) {
    cli.compras.sort((a, b) => (b.data_compra ?? "").localeCompare(a.data_compra ?? ""));
    cli.ticketMedio = cli.totalCompras > 0 ? cli.totalGasto / cli.totalCompras : 0;
  }
  lista.sort((a, b) => b.totalGasto - a.totalGasto || b.totalCompras - a.totalCompras);
  return lista;
}
