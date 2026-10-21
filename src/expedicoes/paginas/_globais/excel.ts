// src/expedicoes/paginas/_globais/excel.ts
// Planilhas .xlsx geradas no navegador (exceljs carregado só na hora):
//  - Passageiros (app antigo: PassageirosGlobalTabela.tsx → exportarExcel), mesmas colunas;
//  - Clientes & compras (app antigo: GET /api/clientes/export, que rodava no servidor
//    com service role — aqui lê com a sessão do usuário, o RLS já libera a leitura).
import { lerTudo } from "../../lib/banco";
import { formatDate } from "../../lib/utils";
import type { PessoaAgregada } from "../../lib/pessoas";
import { digitos, nomeCompra, normTexto, type ClienteCompras } from "./compras";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const hojeIsoLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

async function carregarExcel() {
  const mod = await import("exceljs");
  return ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
}

function baixar(buf: ArrayBuffer, nome: string) {
  const url = URL.createObjectURL(new Blob([buf], { type: XLSX_MIME }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Idade em anos a partir do nascimento (mesma conta do app antigo). */
export function idadeDe(nascimentoIso: string | null): number | null {
  if (!nascimentoIso) return null;
  const nasc = new Date(nascimentoIso.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(nasc.getTime())) return null;
  return Math.floor((Date.now() - nasc.getTime()) / 86400000 / 365.25);
}

export async function exportarPassageirosXlsx(pessoas: PessoaAgregada[]): Promise<void> {
  const ExcelJS = await carregarExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema de Expedições";
  const ws = wb.addWorksheet("Passageiros");
  ws.columns = [
    { header: "Nome completo", key: "nome", width: 30 },
    { header: "CPF", key: "cpf", width: 16 },
    { header: "Nascimento", key: "nasc", width: 12 },
    { header: "Idade", key: "idade", width: 7 },
    { header: "Passaporte", key: "passaporte", width: 14 },
    { header: "Validade passaporte", key: "validade", width: 16 },
    { header: "E-mail", key: "email", width: 28 },
    { header: "Telefone", key: "telefone", width: 16 },
    { header: "Contato emergência", key: "emnome", width: 22 },
    { header: "Fone emergência", key: "emfone", width: 16 },
    { header: "Restrições alimentares", key: "rest", width: 24 },
    { header: "Condições médicas", key: "med", width: 24 },
    { header: "Nº expedições", key: "qtd", width: 12 },
    { header: "Já participou", key: "passadas", width: 44 },
    { header: "Vai participar", key: "futuras", width: 44 },
  ];
  const head = ws.getRow(1);
  head.height = 18;
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF09282B" } };
    c.alignment = { vertical: "middle" };
  });
  const hoje = hojeIsoLocal();
  const fmtExp = (e: PessoaAgregada["expedicoes"][number]) => `${e.nome} — ${e.data_embarque ? formatDate(e.data_embarque) : "sem data"} (${e.status_reserva})`;
  for (const p of pessoas) {
    const ativos = p.expedicoes.filter((e) => e.status_reserva !== "Cancelado");
    const i = idadeDe(p.data_nascimento);
    ws.addRow({
      nome: p.nome_completo, cpf: p.cpf ?? "", nasc: p.data_nascimento ? formatDate(p.data_nascimento) : "", idade: i ?? "",
      passaporte: p.passaporte ?? "", validade: p.validade_passaporte ? formatDate(p.validade_passaporte) : "",
      email: p.email ?? "", telefone: p.telefone ?? "", emnome: p.contato_emergencia_nome ?? "", emfone: p.contato_emergencia_fone ?? "",
      rest: p.restricoes_alimentares ?? "", med: p.condicoes_medicas ?? "", qtd: p.totalExpedicoes,
      passadas: ativos.filter((e) => (e.data_embarque ?? "").slice(0, 10) < hoje).map(fmtExp).join("\n"),
      futuras: ativos.filter((e) => (e.data_embarque ?? "").slice(0, 10) >= hoje).map(fmtExp).join("\n"),
    });
  }
  for (const key of ["passadas", "futuras", "rest", "med"]) ws.getColumn(key).alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  baixar(await wb.xlsx.writeBuffer() as ArrayBuffer, `passageiros-${hoje}.xlsx`);
}

const maskCpf = (v: string | null) => { const d = digitos(v); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (v ?? ""); };
const brDate = (iso: string | null) => { if (!iso) return ""; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };

/** Base completa (não o filtro da tela), como o /api/clientes/export do antigo. */
export async function exportarClientesXlsx(clientes: ClienteCompras[]): Promise<void> {
  // Enriquecimento por CPF: contato (telefone/e-mail) + expedições no sistema.
  const [exps, pax] = await Promise.all([
    lerTudo<{ id: string; nome: string }>("expedicoes", undefined, "id, nome"),
    lerTudo<{ id: string; cpf: string | null; email: string | null; telefone: string | null; expedicao_id: string | null; status_reserva: string | null }>(
      "passageiros", undefined, "id, cpf, email, telefone, expedicao_id, status_reserva"),
  ]);
  const expNome = new Map(exps.map((e) => [e.id, e.nome]));
  type Ct = { email: string | null; telefone: string | null; exps: Set<string> };
  const contatoPorCpf = new Map<string, Ct>();
  for (const p of pax) {
    const cpf = digitos(p.cpf);
    if (cpf.length !== 11) continue;
    let e = contatoPorCpf.get(cpf);
    if (!e) { e = { email: null, telefone: null, exps: new Set() }; contatoPorCpf.set(cpf, e); }
    if (!e.email && p.email) e.email = p.email;
    if (!e.telefone && p.telefone) e.telefone = p.telefone;
    if (p.expedicao_id && (p.status_reserva ?? "").toLowerCase() !== "cancelado") { const n = expNome.get(p.expedicao_id); if (n) e.exps.add(n); }
  }

  const ExcelJS = await carregarExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Se Tu For, Eu Vou";
  wb.created = new Date();
  const estiloCabecalho = (row: import("exceljs").Row) => {
    row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    row.alignment = { vertical: "middle" };
    row.height = 20;
  };

  const wsC = wb.addWorksheet("Clientes", { views: [{ state: "frozen", ySplit: 1 }] });
  wsC.columns = [
    { header: "Nome", key: "nome", width: 34 }, { header: "CPF", key: "cpf", width: 16 }, { header: "Telefone", key: "tel", width: 18 },
    { header: "E-mail", key: "email", width: 30 }, { header: "Nº de compras", key: "n", width: 14 }, { header: "Total gasto (R$)", key: "total", width: 18 },
    { header: "Ticket médio (R$)", key: "ticket", width: 18 }, { header: "1ª compra", key: "primeira", width: 13 }, { header: "Última compra", key: "ultima", width: 14 },
    { header: "Funis", key: "funis", width: 34 }, { header: "Expedições no sistema", key: "exps", width: 50 },
  ];
  estiloCabecalho(wsC.getRow(1));
  for (const cli of clientes) {
    const ct = cli.cpf ? contatoPorCpf.get(digitos(cli.cpf)) : null;
    wsC.addRow({
      nome: cli.nome, cpf: cli.cpf ? maskCpf(cli.cpf) : "", tel: ct?.telefone ?? "", email: ct?.email ?? "", n: cli.totalCompras,
      total: Math.round(cli.totalGasto * 100) / 100, ticket: Math.round(cli.ticketMedio * 100) / 100,
      primeira: brDate(cli.primeiraCompra), ultima: brDate(cli.ultimaCompra), funis: cli.funis.join(" | "), exps: ct ? [...ct.exps].join(" | ") : "",
    });
  }
  wsC.getColumn("total").numFmt = "#,##0.00";
  wsC.getColumn("ticket").numFmt = "#,##0.00";
  wsC.autoFilter = { from: "A1", to: "K1" };
  wsC.eachRow((row, i) => { if (i > 1 && i % 2 === 0) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } }; }); });

  const wsD = wb.addWorksheet("Compras (detalhado)", { views: [{ state: "frozen", ySplit: 1 }] });
  wsD.columns = [
    { header: "Nome", key: "nome", width: 34 }, { header: "CPF", key: "cpf", width: 16 }, { header: "Produto (expedição)", key: "produto", width: 36 },
    { header: "Data", key: "data", width: 13 }, { header: "Valor", key: "valor", width: 15 }, { header: "Moeda", key: "moeda", width: 9 },
    { header: "Funil", key: "funil", width: 30 }, { header: "Etapa", key: "etapa", width: 18 }, { header: "Título (Bitrix)", key: "titulo", width: 34 },
    { header: "Deal ID", key: "deal", width: 12 },
  ];
  estiloCabecalho(wsD.getRow(1));
  const linhas = clientes.flatMap((cli) => cli.compras)
    .sort((a, b) => normTexto(a.nome_contato).localeCompare(normTexto(b.nome_contato)) || (b.data_compra ?? "").localeCompare(a.data_compra ?? ""));
  for (const c of linhas) {
    wsD.addRow({
      nome: c.nome_contato ?? "", cpf: c.cpf ? maskCpf(c.cpf) : "", produto: nomeCompra(c), data: brDate(c.data_compra),
      valor: c.valor != null ? Math.round(Number(c.valor) * 100) / 100 : null, moeda: c.moeda ?? "", funil: c.funil ?? "",
      etapa: c.etapa ?? "", titulo: c.titulo ?? "", deal: c.bitrix_deal_id ?? "",
    });
  }
  wsD.getColumn("valor").numFmt = "#,##0.00";
  wsD.autoFilter = { from: "A1", to: "J1" };

  baixar(await wb.xlsx.writeBuffer() as ArrayBuffer, `Clientes_e_Compras_${hojeIsoLocal()}.xlsx`);
}
