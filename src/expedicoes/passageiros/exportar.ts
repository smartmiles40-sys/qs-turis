// src/expedicoes/passageiros/exportar.ts
// "Exportar" da aba Passageiros. O app antigo baixava um CSV cuja coluna Quarto lia
// o campo LEGADO quarto_id (quase sempre vazio). Aqui é .xlsx e o quarto vem da
// alocação real do Rooming (passageiro_quarto), um por hotel/trecho.
import { formatDate } from "../lib/utils";
import type { ExpedicaoRow, GrupoExpedicaoRow, PassageiroRow, QuartoRow, AlocacaoQuartoRow } from "../lib/database";
import type { ResultadoProntidao } from "../lib/prontidao/regras";
import { preencheuFormulario } from "./dados";

export async function exportarPassageiros(o: {
  exp: ExpedicaoRow; pax: PassageiroRow[]; quartos: QuartoRow[]; alocacoes: AlocacaoQuartoRow[]; grupos: GrupoExpedicaoRow[];
  prontidao: Map<string, ResultadoProntidao>;
}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Passageiros");
  const quarto = new Map(o.quartos.map((q) => [q.id, q]));
  const grupo = new Map(o.grupos.map((g) => [g.id, g.nome]));
  ws.columns = [
    { header: "Nome", key: "nome", width: 34 }, { header: "Tipo", key: "tipo", width: 11 }, { header: "Grupo", key: "grupo", width: 8 },
    { header: "CPF", key: "cpf", width: 16 }, { header: "Passaporte", key: "passaporte", width: 14 }, { header: "Validade", key: "validade", width: 12 },
    { header: "Nascimento", key: "nasc", width: 12 }, { header: "Email", key: "email", width: 30 }, { header: "Telefone", key: "tel", width: 17 },
    { header: "Status", key: "status", width: 13 }, { header: "Prontidão", key: "pront", width: 12 }, { header: "Quarto", key: "quarto", width: 40 },
    { header: "Acompanhante indicado", key: "acomp", width: 28 }, { header: "Formulário", key: "form", width: 12 },
  ];
  for (const p of o.pax) {
    const qs = o.alocacoes.filter((a) => a.passageiro_id === p.id).map((a) => quarto.get(a.quarto_id)).filter((q): q is QuartoRow => !!q)
      .sort((a, b) => (a.check_in ?? "").localeCompare(b.check_in ?? ""));
    ws.addRow({
      nome: p.nome_completo, tipo: p.tipo, grupo: p.grupo_id ? grupo.get(p.grupo_id) ?? "" : "", cpf: p.cpf ?? "", passaporte: p.passaporte ?? "",
      validade: p.validade_passaporte ? formatDate(p.validade_passaporte) : "", nasc: p.data_nascimento ? formatDate(p.data_nascimento) : "",
      email: p.email ?? "", tel: p.telefone ?? "", status: p.status_reserva, pront: o.prontidao.get(p.id)?.prontidao ?? "",
      quarto: qs.map((q) => `${q.hotel_cidade || "Hotel"}: Quarto ${q.numero} (${q.tipo})`).join(" · "),
      acomp: p.acompanhante_nome ?? "", form: preencheuFormulario(p) ? "Preencheu" : "Pendente",
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `passageiros-${o.exp.codigo || o.exp.id}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}
