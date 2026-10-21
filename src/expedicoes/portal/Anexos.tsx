// src/expedicoes/portal/Anexos.tsx
// Anexo de 1 arquivo num item do portal (voucher de voo/passeio, PDF 1/2 da
// informação, voucher da hospedagem da extensão) e o voucher geral da
// hospedagem. App antigo: VoucherAnexo / VoucherHospedagem do PortalEditor.
// Trocar = Remover + Anexar (como no antigo); remover apaga o arquivo também.
import { useRef, useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../contexto";
import { Cartao } from "../ui";
import type { CategoriaArquivo } from "../lib/constants";
import type { ArquivoRow } from "../lib/database";
import { abrirArquivo, enviarArquivo, excluirArquivo } from "../drive/arquivos";
import { IconeSvg } from "../drive/icones";
import { atualizarItem, definirVoucherHospedagem, type TabelaPortal } from "./dados";

export function VoucherAnexo({ tabela, expedicaoId, itemId, arquivo, arquivoId, rotulo = "Voucher", categoria = "Vouchers", campo = "arquivo_id", labelCampo, labelValor, onMudou }: {
  tabela: TabelaPortal; expedicaoId: string; itemId: string;
  arquivo: ArquivoRow | undefined; arquivoId: string | null;
  rotulo?: string; categoria?: CategoriaArquivo; campo?: string;
  labelCampo?: string; labelValor?: string | null; onMudou: () => void;
}) {
  const { avisar } = useExp();
  const [ocupado, setOcupado] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function enviar(f: File | undefined) {
    if (!f) return;
    setOcupado(true);
    try {
      const a = await enviarArquivo({ expedicaoId, categoria, descricao: rotulo, arquivo: f });
      try { await atualizarItem(tabela, itemId, { [campo]: a.id }); }
      catch (e) { await excluirArquivo(a.id).catch(() => {}); throw e; }
      avisar(`${rotulo} anexado`);
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Falha no envio", "erro"); }
    finally { setOcupado(false); if (ref.current) ref.current.value = ""; }
  }
  async function remover() {
    if (!arquivoId) return;
    setOcupado(true);
    try {
      await atualizarItem(tabela, itemId, { [campo]: null });
      await excluirArquivo(arquivoId).catch(() => {});
      avisar(`${rotulo} removido`);
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Falha ao remover", "erro"); }
    finally { setOcupado(false); }
  }
  async function salvarLabel(v: string) {
    if (!labelCampo || (v.trim() || null) === (labelValor ?? null)) return;
    try { await atualizarItem(tabela, itemId, { [labelCampo]: v.trim() || null }); onMudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-bold" style={{ color: "var(--ink)" }}>{rotulo} (1 arquivo)</div>
      {arquivoId ? (
        <>
          <Anexado nome={arquivo?.nome} ocupado={ocupado} onVer={arquivo ? () => abrirArquivo(arquivo.storage_path).catch((e) => avisar(e.message, "erro")) : undefined} onRemover={() => void remover()} />
          {labelCampo && (
            <input type="text" className="rel-input" style={{ padding: "6px 10px", fontSize: 12.5 }} defaultValue={labelValor ?? ""}
              placeholder='Nome do link (ex.: "Baixar visto")' onBlur={(e) => void salvarLabel(e.target.value)} />
          )}
        </>
      ) : (
        <Botao onClick={() => ref.current?.click()} disabled={ocupado}><IconeSvg nome="upload" /> {ocupado ? "Enviando…" : `Anexar ${rotulo.toLowerCase()}`}</Botao>
      )}
      <input ref={ref} type="file" accept="image/*,application/pdf" hidden onChange={(e) => void enviar(e.target.files?.[0])} />
      <p className="text-[11px]" style={{ color: "var(--ink3)" }}>Imagem ou PDF — fica disponível para o passageiro baixar.</p>
    </div>
  );
}

function Anexado({ nome, ocupado, onVer, onRemover }: { nome?: string; ocupado: boolean; onVer?: () => void; onRemover: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: "#DCFCE7", border: "1px solid #86EFAC" }}>
      <span className="flex-1 min-w-0 truncate text-[13px] font-semibold" style={{ color: "#166534" }} title={nome}>✓ Anexado{nome ? ` · ${nome}` : ""}</span>
      {onVer && <button type="button" onClick={onVer} className="text-[12px] font-semibold hover:underline" style={{ color: "#166534" }}>Ver</button>}
      <button type="button" onClick={onRemover} disabled={ocupado} className="text-[12px] font-semibold hover:underline disabled:opacity-50" style={{ color: "#B91C1C" }}>Remover</button>
    </div>
  );
}

/** Voucher ÚNICO da hospedagem (expedicoes.hospedagem_voucher_arquivo_id) — mesmo hotel pra todos. */
export function VoucherHospedagem({ expedicaoId, arquivoId, arquivo, onMudou }: { expedicaoId: string; arquivoId: string | null; arquivo: ArquivoRow | undefined; onMudou: () => void }) {
  const { avisar } = useExp();
  const [ocupado, setOcupado] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function enviar(f: File | undefined) {
    if (!f) return;
    setOcupado(true);
    try {
      const a = await enviarArquivo({ expedicaoId, categoria: "Vouchers", descricao: "Voucher hospedagem", arquivo: f });
      try { await definirVoucherHospedagem(expedicaoId, a.id); }
      catch (e) { await excluirArquivo(a.id).catch(() => {}); throw e; }
      avisar("Voucher da hospedagem anexado");
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Falha no envio", "erro"); }
    finally { setOcupado(false); if (ref.current) ref.current.value = ""; }
  }
  async function remover() {
    if (!arquivoId) return;
    setOcupado(true);
    try {
      await definirVoucherHospedagem(expedicaoId, null);
      await excluirArquivo(arquivoId).catch(() => {});
      avisar("Voucher removido");
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Falha ao remover", "erro"); }
    finally { setOcupado(false); }
  }

  return (
    <Cartao titulo={<Titulo icone="cama" titulo="Voucher da hospedagem" texto="Um arquivo só, vale para todos os passageiros (mesmo hotel)." />}>
      {arquivoId ? (
        <Anexado nome={arquivo?.nome} ocupado={ocupado} onVer={arquivo ? () => abrirArquivo(arquivo.storage_path).catch((e) => avisar(e.message, "erro")) : undefined} onRemover={() => void remover()} />
      ) : (
        <>
          <Botao onClick={() => ref.current?.click()} disabled={ocupado}><IconeSvg nome="upload" /> {ocupado ? "Enviando…" : "Anexar voucher (PDF/foto)"}</Botao>
          <input ref={ref} type="file" accept="image/*,application/pdf" hidden onChange={(e) => void enviar(e.target.files?.[0])} />
        </>
      )}
    </Cartao>
  );
}

/** Cabeçalho de seção com ícone, título e descrição. */
export function Titulo({ icone, titulo, texto }: { icone: Parameters<typeof IconeSvg>[0]["nome"]; titulo: string; texto?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0" style={{ background: "var(--card2)", color: "var(--ink)" }}><IconeSvg nome={icone} /></span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold leading-tight" style={{ color: "var(--ink)" }}>{titulo}</span>
        {texto && <span className="block text-[11.5px] font-normal mt-0.5" style={{ color: "var(--ink3)" }}>{texto}</span>}
      </span>
    </span>
  );
}
