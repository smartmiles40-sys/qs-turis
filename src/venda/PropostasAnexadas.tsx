// src/venda/PropostasAnexadas.tsx
// -----------------------------------------------------------------------------
// A proposta enviada ao cliente, anexada na venda (0295):
//   · CampoPropostaVenda — o campo OBRIGATÓRIO dentro do SubirVenda;
//   · ListaPropostasAnexadas — ver/baixar no cartão do closer e na ficha.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { Botao } from "@/rel/ui";
import {
  ACEITA_PROPOSTA, LIMITE_MB, abrirProposta, listarPropostasDaVenda, problemaNoArquivo, tamanhoLegivel,
  type PropostaAnexada,
} from "./propostaAnexo";

const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function LinhaAnexo({ a, onErro }: { a: PropostaAnexada; onErro: (m: string) => void }) {
  return (
    <li className="flex items-center gap-2 text-[13px] py-1">
      <span aria-hidden>{a.mime === "application/pdf" ? "📄" : "🖼️"}</span>
      <button type="button" className="flex-1 min-w-0 truncate text-left font-semibold hover:underline" style={{ color: "var(--rel-ink)" }}
        onClick={() => { abrirProposta(a.arquivo_path).then((u) => window.open(u, "_blank", "noopener")).catch((e) => onErro(e instanceof Error ? e.message : "Não abriu.")); }}>
        {a.arquivo_nome}
      </button>
      <span className="text-[12px] flex-shrink-0" style={{ color: "var(--ink3)" }}>{[tamanhoLegivel(a.tamanho), dataBr(a.criado_em)].filter(Boolean).join(" · ")}</span>
    </li>
  );
}

/** Campo do SubirVenda: o que já foi anexado neste cartão + os arquivos escolhidos agora. */
export function CampoPropostaVenda({ jaAnexadas, novos, onNovos, obrigatorio = true }: {
  jaAnexadas: PropostaAnexada[];
  novos: File[];
  onNovos: (f: File[]) => void;
  obrigatorio?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  function escolher(lista: FileList | null) {
    setErro(null);
    const fs = Array.from(lista ?? []);
    const ruim = fs.map(problemaNoArquivo).find(Boolean);
    if (ruim) setErro(ruim);
    onNovos([...novos, ...fs.filter((f) => !problemaNoArquivo(f))]);
    if (input.current) input.current.value = "";
  }
  const nada = !jaAnexadas.length && !novos.length;
  return (
    <div className="rel-card p-4 space-y-2" style={nada && obrigatorio ? { borderColor: "var(--warn-ink, #8a5a00)" } : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Proposta enviada ao cliente{obrigatorio ? " *" : ""}</p>
        <Botao onClick={() => input.current?.click()}>📎 Anexar proposta</Botao>
      </div>
      <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
        PDF ou foto da proposta que o cliente recebeu (pode ser mais de um arquivo, até {LIMITE_MB} MB cada). Sem ela a venda não é registrada.
      </p>
      <input ref={input} type="file" multiple accept={ACEITA_PROPOSTA} className="hidden" onChange={(e) => escolher(e.target.files)} />
      {jaAnexadas.length > 0 && (
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {jaAnexadas.map((a) => <LinhaAnexo key={a.id} a={a} onErro={setErro} />)}
        </ul>
      )}
      {novos.length > 0 && (
        <ul className="space-y-1">
          {novos.map((f, n) => (
            <li key={`${f.name}-${n}`} className="flex items-center gap-2 text-[13px]">
              <span aria-hidden>{f.type === "application/pdf" ? "📄" : "🖼️"}</span>
              <span className="flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{f.name}</span>
              <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{tamanhoLegivel(f.size)} · sobe ao confirmar</span>
              <Botao variante="fantasma" onClick={() => onNovos(novos.filter((_, k) => k !== n))}>Tirar</Botao>
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
    </div>
  );
}

/** Lista só de leitura (cartão do closer, ficha do cliente). Sem anexo e sem `mostrarVazio`, não aparece. */
export function ListaPropostasAnexadas({ negocioId, vendaId, leadId, clienteId, mostrarVazio = false, versao = 0 }: {
  negocioId?: string | null; vendaId?: string | null; leadId?: string | null; clienteId?: string | null;
  mostrarVazio?: boolean;
  /** Muda pra recarregar (ex.: depois de subir a venda). */
  versao?: number;
}) {
  const [lista, setLista] = useState<PropostaAnexada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => {
    listarPropostasDaVenda({ negocioId, vendaId, leadId, clienteId }).then(setLista).catch((e) => { setLista([]); setErro(e instanceof Error ? e.message : "Não carregou."); });
  }, [negocioId, vendaId, leadId, clienteId]);
  useEffect(() => { carregar(); }, [carregar, versao]);
  if (!lista) return null;
  if (!lista.length) return mostrarVazio ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{erro ?? "Nenhuma proposta anexada ainda — ela é pedida ao registrar a venda."}</p> : null;
  return (
    <div>
      <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
        {lista.map((a) => <LinhaAnexo key={a.id} a={a} onErro={setErro} />)}
      </ul>
      {erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
    </div>
  );
}
