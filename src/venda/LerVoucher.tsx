// src/venda/LerVoucher.tsx
// -----------------------------------------------------------------------------
// "Preencher pelo voucher" (Bruno 28/10/2026): arrasta o voucher (PDF ou foto)
// ou cola o e-mail → a IA lê (api/venda-voucher.js) → mostra o que leu e os
// avisos → "Usar na venda" chama onPreencher(resultado).
//
// Não grava nada: quem salva é a tela da venda (SubirVenda), depois que o
// closer confere. Arquivo grande (> 3 MB no total) não cabe no corpo da Vercel;
// nesse caso a tela pede pra mandar em partes.
// -----------------------------------------------------------------------------
import { useRef, useState, type DragEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Alert, Badge, Button } from "@/components/ui";
import { TIPOS, type TipoItem } from "@/propostas/lib";

/** Um trecho de voo lido do voucher (dados.trechos do item aéreo). */
export interface TrechoVoucher {
  sentido: "ida" | "volta" | "interno";
  conexao: boolean;
  voo_interno: boolean;
  origem: string; origem_cidade: string; destino: string; destino_cidade: string;
  data: string; hora_saida: string; chegada_data: string; hora_chegada: string;
  cia: string; voo: string; localizador: string; classe: string; bagagem: string;
  conexao_min?: number;
}
/** Item no formato de qs_venda_itens (0207). `dados` usa as chaves do catálogo (TIPOS) + extras do voucher. */
export interface ItemVoucher {
  tipo: TipoItem;
  nome: string;
  data_inicio: string;
  data_fim: string;
  dados: Record<string, unknown> & { trechos?: TrechoVoucher[]; voo_interno?: boolean };
  passageiros: { nome: string }[];
  valor: number | null;
  custo: number | null;
  fornecedor: string;
}
export interface PessoaVoucher { nome: string; cpf?: string; passaporte?: string; nascimento?: string; validade_passaporte?: string }
/** Um dia do roteiro (mesmos campos do roteiro_dias das expedições + atividades). */
export interface DiaRoteiro { dia: number; data: string; cidade: string; titulo: string; hospedagem: string; atividades: string[] }
export interface ResultadoVoucher { itens: ItemVoucher[]; pessoas: PessoaVoucher[]; roteiro: DiaRoteiro[]; avisos: string[] }

/** Converte o `dados` do voucher pro `Record<string,string>` do ItemVenda (closer/vendaItens.ts): só texto. */
export function dadosComoTexto(dados: ItemVoucher["dados"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dados)) {
    if (v == null || v === "") continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number") out[k] = String(v);
    else if (typeof v === "boolean") out[k] = v ? "sim" : "";
  }
  if (!out.voo_interno) delete out.voo_interno;
  return out;
}

const MAX_TOTAL = 3 * 1024 * 1024; // corpo da Vercel: 4,5 MB depois do base64
const ACEITA = "application/pdf,image/jpeg,image/png,image/webp";
const BR = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
const reais = (v: number | null) => (v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function base64(f: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => falha(new Error(`Não deu pra abrir ${f.name}.`));
    r.readAsDataURL(f);
  });
}

export async function lerVoucher(corpo: {
  arquivos?: ({ nome: string; mime: string; base64: string } | { bucket: string; path: string })[];
  texto?: string;
  cliente_ids?: string[];
  cadastro?: { nome: string; passaporte_validade?: string | null }[];
  viagem?: { data_inicio?: string; data_fim?: string };
}): Promise<ResultadoVoucher> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/venda-voucher", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (HTTP ${r.status}).`);
  return j as ResultadoVoucher;
}

export default function LerVoucher({ onPreencher, cadastro, clienteIds, viagem }: {
  onPreencher: (r: ResultadoVoucher) => void;
  /** Nomes que já estão na venda — a IA avisa quando o voucher difere. */
  cadastro?: { nome: string; passaporte_validade?: string | null }[];
  clienteIds?: string[];
  viagem?: { data_inicio?: string; data_fim?: string };
}) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [res, setRes] = useState<ResultadoVoucher | null>(null);
  const [sobre, setSobre] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const total = arquivos.reduce((s, f) => s + f.size, 0);
  const grande = total > MAX_TOTAL;

  function adicionar(lista: FileList | null) {
    if (!lista) return;
    const novos = Array.from(lista).filter((f) => ACEITA.split(",").includes(f.type));
    if (novos.length < lista.length) setErro("Só PDF ou foto (JPG, PNG, WebP).");
    else setErro("");
    setArquivos((a) => [...a, ...novos].slice(0, 6));
    setRes(null);
  }
  function soltar(e: DragEvent) { e.preventDefault(); setSobre(false); adicionar(e.dataTransfer.files); }

  async function ler() {
    setErro(""); setRes(null); setLendo(true);
    try {
      const anexos = await Promise.all(arquivos.map(async (f) => ({ nome: f.name, mime: f.type, base64: await base64(f) })));
      setRes(await lerVoucher({ arquivos: anexos, texto: texto.trim() || undefined, cadastro, cliente_ids: clienteIds, viagem }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falhou a leitura.");
    } finally {
      setLendo(false);
    }
  }

  return (
    <div className="qs-card" style={{ padding: 16, display: "grid", gap: 12 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={soltar}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
        style={{
          border: `1.5px dashed var(${sobre ? "--primary" : "--border"})`, borderRadius: "var(--radius-md)",
          padding: "20px 16px", textAlign: "center", cursor: "pointer", background: sobre ? "var(--surface-2)" : "transparent",
        }}
      >
        <div style={{ fontWeight: 600 }}>Arraste o voucher aqui</div>
        <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>PDF ou foto do bilhete, hotel, seguro… (ou clique pra escolher)</div>
        <input ref={input} type="file" accept={ACEITA} multiple hidden onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
      </div>

      {arquivos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {arquivos.map((f, i) => (
            <Badge key={`${f.name}-${i}`}>
              {f.name}
              <button type="button" aria-label={`Tirar ${f.name}`} onClick={() => setArquivos((a) => a.filter((_, j) => j !== i))}
                style={{ marginLeft: 6, background: "none", border: 0, cursor: "pointer", color: "inherit" }}>×</button>
            </Badge>
          ))}
        </div>
      )}

      <textarea
        value={texto} onChange={(e) => setTexto(e.target.value)} rows={3}
        placeholder="Ou cole aqui o e-mail de confirmação / texto do voucher"
        style={{ width: "100%", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 8, background: "var(--surface)", color: "var(--text)", font: "inherit" }}
      />

      {grande && <Alert tone="warn">Os arquivos passam de 3 MB juntos. Mande em partes (um de cada vez).</Alert>}
      {erro && <Alert tone="danger">{erro}</Alert>}

      <div>
        <Button variant="primary" disabled={lendo || grande || (!arquivos.length && !texto.trim())} onClick={ler}>
          {lendo ? "Lendo o voucher…" : "Ler com a IA"}
        </Button>
      </div>

      {res && (
        <div style={{ display: "grid", gap: 10 }}>
          {res.avisos.map((a, i) => <Alert key={i} tone={/^Soma dos valores|já separados/.test(a) ? "info" : "warn"}>{a}</Alert>)}
          <div style={{ display: "grid", gap: 6 }}>
            {res.itens.length === 0 && <div style={{ color: "var(--muted)" }}>A IA não achou nenhum item no voucher.</div>}
            {res.itens.map((it, i) => (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 10px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{TIPOS[it.tipo]?.emoji}</span>
                  <strong>{it.nome}</strong>
                  {it.dados.voo_interno === true && <Badge tone="info">voo interno</Badge>}
                  <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
                    {[BR(it.data_inicio), BR(it.data_fim)].filter(Boolean).join(" → ")}
                  </span>
                  {it.valor != null && <span style={{ marginLeft: "auto" }}>{reais(it.valor)}</span>}
                </div>
                {it.dados.trechos && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "var(--text-sm)", color: "var(--subtle)" }}>
                    {it.dados.trechos.map((t, j) => (
                      <li key={j}>
                        {t.conexao ? "↳ " : ""}{t.origem} → {t.destino} · {BR(t.data)} {t.hora_saida}{t.hora_chegada ? `–${t.hora_chegada}` : ""} · {t.voo}
                        {t.voo_interno ? " · interno" : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {it.passageiros.length > 0 && (
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 4 }}>{it.passageiros.map((p) => p.nome).join(", ")}</div>
                )}
              </div>
            ))}
          </div>
          {res.roteiro.length > 0 && (
            <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              Roteiro: {res.roteiro.length} dias ({BR(res.roteiro[0].data)} a {BR(res.roteiro[res.roteiro.length - 1].data)}),
              {" "}{res.pessoas.length} pessoa(s).
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" disabled={!res.itens.length} onClick={() => onPreencher(res)}>Usar na venda</Button>
            <Button variant="ghost" onClick={() => setRes(null)}>Descartar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
