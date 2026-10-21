// src/expedicoes/paginas/_globais/ImportarCsvGlobal.tsx
// Importar passageiros por CSV em várias expedições de uma vez (app antigo:
// ImportarPassageirosDrawer modo="global" + importarPassageirosGlobal). Cada linha
// diz a expedição pelo código. Pré-visualização marca erro / duplicado / ok; só
// as válidas entram, já com os requisitos de prontidão do destino.
import { useMemo, useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../../contexto";
import { Gaveta, Selo } from "../../ui";
import { cpfDigitos, parsePassageirosCSV, type LinhaImport } from "../../lib/csv/passageiros-import";
import { formatDate } from "../../lib/utils";
import type { ExpedicaoRow } from "../../lib/database";
import { importarPassageirosGlobal } from "./pessoaAcoes";

const COLS_BASE = "nome_completo;data_nascimento;cpf;passaporte;validade_passaporte;email;telefone;tipo;status_reserva;valor_contratado;valor_pago";
const MODELO_GLOBAL = "expedicao_codigo;" + COLS_BASE + "\n" +
  "PERU-AGO2026;Maria Souza;12/05/1990;111.222.333-44;FA123456;01/01/2032;maria@email.com;11999990000;Pagante;Confirmado;18900;9450\n" +
  "PATAG-NOV2026;João Lima;03/11/1988;555.666.777-88;;;joao@email.com;11988887777;Pagante;Pré-reserva;22500;0";

type Situacao = "ok" | "duplicado" | "erro";

export function ImportarCsvGlobal({ aberta, expedicoes, onFechar, onImportou }: {
  aberta: boolean; expedicoes: ExpedicaoRow[]; onFechar: () => void; onImportou: () => void;
}) {
  const { avisar } = useExp();
  const [parse, setParse] = useState<ReturnType<typeof parsePassageirosCSV> | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const codigos = useMemo(() => new Set(expedicoes.map((e) => e.codigo)), [expedicoes]);

  const fechar = () => { setParse(null); setNomeArquivo(null); onFechar(); };
  const carregarTexto = (t: string) => setParse(t.trim() ? parsePassageirosCSV(t, { exigirObrigatorios: false, statusPadrao: "Confirmado" }) : null);

  const classificadas = useMemo(() => {
    if (!parse) return [];
    const vistos = new Set<string>();
    return parse.linhas.map((l): { linha: LinhaImport; status: Situacao; motivo: string } => {
      if (l.erros.length) return { linha: l, status: "erro", motivo: l.erros.join("; ") };
      const cod = l.dados.expedicao_codigo;
      if (!cod) return { linha: l, status: "erro", motivo: "código da expedição ausente" };
      if (!codigos.has(cod)) return { linha: l, status: "erro", motivo: `expedição "${cod}" não encontrada` };
      const cpf = cpfDigitos(l.dados.cpf);
      const chave = `${cod}|${cpf}`;
      if (cpf && vistos.has(chave)) return { linha: l, status: "duplicado", motivo: "CPF repetido para a mesma expedição neste arquivo" };
      if (cpf) vistos.add(chave);
      return { linha: l, status: "ok", motivo: "" };
    });
  }, [parse, codigos]);

  const validos = classificadas.filter((c) => c.status === "ok");
  const duplicados = classificadas.filter((c) => c.status === "duplicado").length;
  const comErro = classificadas.filter((c) => c.status === "erro").length;

  const baixarModelo = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + MODELO_GLOBAL], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "modelo-passageiros-global.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importar = async () => {
    if (!validos.length) return;
    setImportando(true);
    try {
      const r = await importarPassageirosGlobal(validos.map((c) => c.linha.dados), expedicoes);
      const extras = [r.ignorados ? `${r.ignorados} ignorado(s)` : null, r.semExpedicao ? `${r.semExpedicao} sem expedição` : null].filter(Boolean).join(" · ");
      avisar(`${r.inseridos} passageiro(s) importado(s)${extras ? ` · ${extras}` : ""}`);
      fechar(); onImportou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao importar", "erro"); }
    finally { setImportando(false); }
  };

  return (
    <Gaveta aberta={aberta} titulo="Importar passageiros (CSV)" largura={720} onFechar={fechar}
      subtitulo="Cada linha indica a expedição pelo código (coluna expedicao_codigo). Só o nome e o código da expedição são obrigatórios."
      rodape={<>
        <Botao onClick={fechar}>Cancelar</Botao>
        <Botao variante="primario" onClick={importar} disabled={importando || validos.length === 0}>{importando ? "Importando…" : `Importar ${validos.length} válido(s)`}</Botao>
      </>}>
      <div className="space-y-3">
        <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
          Colunas: código da expedição, nome completo, data de nascimento, CPF, passaporte, validade, e-mail, telefone, tipo, status, valor contratado, valor pago.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold cursor-pointer rel-linha" style={{ borderColor: "var(--line)" }}>
            <input type="file" accept=".csv,.txt,text/csv" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setNomeArquivo(f.name); carregarTexto(await f.text()); e.target.value = ""; }} />
            ⬆ Escolher arquivo CSV
          </label>
          {nomeArquivo && <span className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>{nomeArquivo}</span>}
          <button type="button" onClick={baixarModelo} className="ml-auto text-[12.5px] font-semibold hover:underline" style={{ color: "var(--rel-ink)" }}>⬇ Baixar modelo</button>
        </div>
        <label className="block">
          <span className="block text-[11.5px] mb-1" style={{ color: "var(--ink3)" }}>Ou cole o conteúdo do CSV:</span>
          <textarea rows={4} className="rel-input font-mono text-[12px]" placeholder="expedicao_codigo;nome_completo;cpf;..." onChange={(e) => carregarTexto(e.target.value)} />
        </label>

        {parse?.erroGeral && <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--err-bg)", color: "var(--err-ink)" }}>{parse.erroGeral}</div>}
        {parse && !parse.erroGeral && (
          <>
            <div className="flex flex-wrap gap-2">
              <Selo tom="ok">{validos.length} válido(s)</Selo>
              {duplicados > 0 && <Selo tom="aviso">{duplicados} duplicado(s)</Selo>}
              {comErro > 0 && <Selo tom="erro">{comErro} com erro</Selo>}
            </div>
            <div className="rounded-lg border overflow-auto max-h-[340px]" style={{ borderColor: "var(--line)" }}>
              <table className="w-full text-[12px]">
                <thead className="sticky top-0" style={{ background: "var(--card2)" }}>
                  <tr className="text-left text-[11px]" style={{ color: "var(--ink3)" }}>
                    {["#", "Expedição", "Nome", "CPF", "Nasc.", "Contratado", "Situação"].map((h) => <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {classificadas.map((c) => (
                    <tr key={c.linha.linha} className="border-t" style={{ borderColor: "var(--line)", background: c.status === "erro" ? "var(--err-bg)" : c.status === "duplicado" ? "var(--warn-bg)" : undefined }}>
                      <td className="px-2 py-1 tabular-nums" style={{ color: "var(--ink3)" }}>{c.linha.linha}</td>
                      <td className="px-2 py-1 font-mono" style={{ color: "var(--ink2)" }}>{c.linha.dados.expedicao_codigo ?? "—"}</td>
                      <td className="px-2 py-1 font-semibold">{c.linha.dados.nome_completo || "—"}</td>
                      <td className="px-2 py-1 font-mono" style={{ color: "var(--ink2)" }}>{c.linha.dados.cpf ?? "—"}</td>
                      <td className="px-2 py-1 tabular-nums">{c.linha.dados.data_nascimento ? formatDate(c.linha.dados.data_nascimento) : "—"}</td>
                      <td className="px-2 py-1 tabular-nums">{c.linha.dados.valor_contratado_brl != null ? c.linha.dados.valor_contratado_brl.toLocaleString("pt-BR") : "—"}</td>
                      <td className="px-2 py-1">
                        <Selo tom={c.status === "ok" ? "ok" : c.status === "duplicado" ? "aviso" : "erro"} titulo={c.motivo}>{c.status === "ok" ? "Importar" : c.status === "duplicado" ? "Duplicado" : "Erro"}</Selo>
                        {c.motivo && <span className="block text-[10.5px] mt-0.5" style={{ color: "var(--ink3)" }}>{c.motivo}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(duplicados > 0 || comErro > 0) && <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Linhas duplicadas ou com erro serão ignoradas. Quem já está na mesma expedição (mesmo CPF) também é pulado.</p>}
          </>
        )}
      </div>
    </Gaveta>
  );
}
