// src/expedicoes/rooming/exportar.ts
// Excel do rooming (app antigo: exportarExcel em RoomingBoard.tsx, spec 2.10).
// Mesmo layout: rooming.xlsx, uma aba por hotel, título/datas no topo, cabeçalho
// azul na linha 4, uma linha por hóspede, separador duplo entre quartos, faixa
// de grupo (G1/G2) quando há divisão e a coluna que confere o acompanhante.
// Única diferença: quarto cancelado não entra.
import { conferirAcompanhante } from "../lib/rooming/acompanhante";
import { formatDate } from "../lib/utils";
import type { PassageiroRow } from "../lib/database";
import { quartoCancelado, type Grupo, type Rooming } from "./calculos";

function rotuloGrupo(g: Grupo | "misto" | null): string {
  return g === "G1" ? "Grupo 1 (G1)" : g === "G2" ? "Grupo 2 (G2)" : g === "misto" ? "Grupo misto" : "Sem grupo definido";
}

export async function exportarRoomingExcel(r: Rooming): Promise<void> {
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema de Expedições";

  const AZUL = "FF2563EB";
  const borda = { style: "thin" as const, color: { argb: "FFE2E8F0" } };
  const todasBordas = { top: borda, left: borda, bottom: borda, right: borda };
  const separador = { style: "double" as const, color: { argb: "FF334155" } };
  const NCOL = 9;

  const usados = new Set<string>();
  const nomeAba = (base: string) => {
    const limpo = (base || "Hotel").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "Hotel";
    let cand = limpo;
    let i = 2;
    while (usados.has(cand.toLowerCase())) cand = `${limpo} ${i++}`.slice(0, 31);
    usados.add(cand.toLowerCase());
    return cand;
  };

  for (const t of r.trechos) {
    const ws = wb.addWorksheet(nomeAba(t.hotel_cidade ?? "Hotel"));
    ws.columns = [16, 16, 34, 12, 18, 16, 18, 18, 34].map((width) => ({ width }));

    ws.mergeCells("A1:I1");
    const titulo = ws.getCell("A1");
    const ext = t.extensao_id ? ` (Extensão: ${r.nomeExtensao.get(t.extensao_id) ?? "extensão"})` : "";
    titulo.value = `Rooming — ${t.hotel_cidade ?? "Hotel"}${ext}`;
    titulo.font = { bold: true, size: 14 };

    ws.mergeCells("A2:I2");
    const sub = ws.getCell("A2");
    sub.value = `Check-in: ${t.check_in ? formatDate(t.check_in) : "—"}    •    Check-out: ${t.check_out ? formatDate(t.check_out) : "—"}`;
    sub.font = { italic: true, color: { argb: "FF64748B" } };

    const head = ws.getRow(4);
    head.values = ["Quarto", "Tipo do quarto", "Passageiro", "Tipo", "Data de nascimento", "Nº passaporte", "Venc. passaporte", "CPF", "Acompanhante indicado (confere?)"];
    head.height = 18;
    for (let col = 1; col <= NCOL; col++) {
      const c = head.getCell(col);
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
      c.alignment = { vertical: "middle" };
      c.border = todasBordas;
    }

    let linha = 5;
    let grupoAtual: number | null = null;
    for (const q of r.quartosOrdenados(t).filter((x) => !quartoCancelado(x))) {
      if (r.temGrupos) {
        const g = r.grupoDoQuarto(q);
        const pr = g === "G1" ? 0 : g === "G2" ? 1 : 2;
        if (pr !== grupoAtual) {
          grupoAtual = pr;
          ws.mergeCells(`A${linha}:I${linha}`);
          const gc = ws.getRow(linha).getCell(1);
          gc.value = rotuloGrupo(g);
          gc.font = { bold: true, color: { argb: "FF1E293B" } };
          gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
          gc.alignment = { vertical: "middle" };
          for (let col = 1; col <= NCOL; col++) ws.getRow(linha).getCell(col).border = todasBordas;
          linha++;
        }
      }
      const ocup = (r.ocupantesPorQuarto.get(q.id) ?? []).map((id) => r.paxById.get(id)).filter(Boolean) as PassageiroRow[];
      const linhas: (PassageiroRow | null)[] = ocup.length ? ocup : [null];
      linhas.forEach((p, i) => {
        const ultima = i === linhas.length - 1;
        const row = ws.getRow(linha);
        row.getCell(1).value = i === 0 ? `Quarto ${q.numero}` : "";
        row.getCell(2).value = i === 0 ? q.tipo : "";
        row.getCell(3).value = p ? p.nome_completo : "(vazio)";
        row.getCell(4).value = p ? p.tipo : "";
        row.getCell(5).value = p?.data_nascimento ? formatDate(p.data_nascimento) : "";
        row.getCell(6).value = p?.passaporte ?? "";
        row.getCell(7).value = p?.validade_passaporte ? formatDate(p.validade_passaporte) : "";
        row.getCell(8).value = p?.cpf ?? "";
        for (let col = 1; col <= NCOL; col++) {
          const c = row.getCell(col);
          c.border = { top: borda, left: borda, bottom: ultima ? separador : borda, right: borda };
          if (col <= 2 && i === 0) c.font = { bold: true };
          if (!p) c.font = { italic: true, color: { argb: "FF94A3B8" } };
        }
        if (p && p.acompanhante_nome?.trim()) {
          const companheiros = ocup.filter((x) => x.id !== p.id).map((x) => x.nome_completo);
          const st = conferirAcompanhante(p.acompanhante_nome, companheiros);
          const c9 = row.getCell(9);
          if (st === "bate") {
            c9.value = `✓ ${p.acompanhante_nome.trim()}`;
            c9.font = { color: { argb: "FF16A34A" } };
          } else if (st === "nao_bate") {
            c9.value = `⚠ DIVERGE — indicou ${p.acompanhante_nome.trim()}`;
            c9.font = { bold: true, color: { argb: "FF92400E" } };
            c9.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
          }
        }
        linha++;
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rooming.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
