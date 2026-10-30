// src/rel/clientes/ficha/AbaContratos.tsx
// -----------------------------------------------------------------------------
// Aba "Contratos": TODOS os contratos emitidos com a pessoa, de qualquer origem
// (Bruno, 30/10), com status e link do PDF:
//   ZapSign / manual (PDF)  qs_contratos via cad_contratos_do_cliente (0228)
//   cartão do closer        qs_closer_negocios.status_contrato (via 0228)
//   PDF guardado            rel_documentos tipo 'contrato' ou nome com "contrat" — NÃO conta
//                           como assinado (tom neutro): quem confere é quem abre o PDF
//   do Bitrix               rel_bitrix_comentarios que citam contrato/ZapSign/Clicksign (link)
//   expedição / pacote      passageiros.contrato_assinado (marcado pelo Operações); ida
//                           ainda "Lead" não aparece como "não assinado"
// Sem a 0228 a lista sai sem os envios do closer — a tela avisa.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Card, EmptyState, StatusChip } from "@/components/ui";
import { Aviso } from "../../ui";
import { formatarData } from "../../lib/clientes";
import { linkArquivoFicha, type ContratoDaFicha, type contratosDoCliente } from "./fontes";
import type { AbrirExpedicao } from "../ExpedicoesDaFicha";

const ORIGEM: Record<ContratoDaFicha["origem"], string> = {
  zapsign: "ZapSign", manual: "Manual (PDF)", cartao: "Cartão do closer", arquivo: "Arquivo", expedicao: "Expedição / pacote", bitrix: "Comentário do Bitrix",
};

export type EstadoContratos = Awaited<ReturnType<typeof contratosDoCliente>>;

/** A ficha carrega (contratosDoCliente) e passa — a linha do tempo usa os mesmos dados. */
export default function AbaContratos({ r, onAbrirExpedicao }: { r: EstadoContratos | null; onAbrirExpedicao?: AbrirExpedicao }) {
  const [erroAbrir, setErroAbrir] = useState<string | null>(null);

  async function abrir(c: ContratoDaFicha) {
    setErroAbrir(null);
    try {
      const url = c.url ?? (c.arquivoPath ? await linkArquivoFicha(c.arquivoPath) : null);
      if (url) window.open(url, "_blank", "noopener");
    } catch (e) { setErroAbrir(e instanceof Error ? e.message : "Não abriu."); }
  }

  if (!r) return <Card as="div"><p className="fc-p">Carregando contratos…</p></Card>;
  const assinados = r.lista.filter((c) => c.tom === "ok").length;

  return (
    <div className="fc-main">
      {!r.rpcAtiva && (
        <Aviso>
          Os contratos enviados pelo closer (ZapSign / PDF manual) só aparecem aqui depois da migration 0228. Abaixo: arquivos de contrato guardados e o "contrato assinado" das expedições.
        </Aviso>
      )}
      {r.erro && <Aviso tom="erro">Parte dos contratos não carregou ({r.erro}).</Aviso>}
      {erroAbrir && <Aviso tom="erro">{erroAbrir}</Aviso>}
      <Card title="Contratos" action={<span className="qs-num qs-tone-subtle" style={{ fontSize: 13 }}>{r.lista.length} registro{r.lista.length === 1 ? "" : "s"} · {assinados} assinado{assinados === 1 ? "" : "s"}</span>}>
        {r.lista.length === 0 ? (
          <EmptyState title="Nenhum contrato encontrado"
            description="Contratos do ZapSign, PDFs gerados pelo closer, arquivos de contrato, comentários do Bitrix sobre contrato e o contrato de cada expedição aparecem aqui." />
        ) : (
          <ul className="fc-pessoas" aria-label="Contratos da pessoa">
            {r.lista.map((c) => (
              <li key={c.chave} className="fc-dl__r" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 220px" }}>
                  <span className="fc-bloco__t">{c.titulo}</span>
                  <span className="fc-bloco__s">{[ORIGEM[c.origem], c.em ? formatarData(c.em) : null, c.detalhe].filter(Boolean).join(" · ")}</span>
                </span>
                <StatusChip tone={c.tom}>{c.status}</StatusChip>
                {(c.url || c.arquivoPath) && (
                  <button type="button" className="fc-link fc-link--btn" onClick={() => void abrir(c)}>{c.origem === "bitrix" ? "Abrir link" : c.origem === "zapsign" && !c.url?.includes("pdf") ? "Abrir" : "Abrir PDF"}</button>
                )}
                {c.ida && onAbrirExpedicao && (
                  <button type="button" className="fc-link fc-link--btn" onClick={() => onAbrirExpedicao(c.ida!.expedicaoId, c.ida!.tipo, c.ida!.passageiroId)}>Abrir na expedição</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
