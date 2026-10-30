// src/rel/clientes/ficha/DocumentosViagem.tsx
// -----------------------------------------------------------------------------
// Aba Documentos › "Documentos de viagem" (0232: cad_documentos_viagem): 2º
// passaporte, visto, apólice do seguro, vacinas com data e "outro". Lista + um
// formulário pra adicionar/editar. Grava pelas RPCs (cad_pode_editar); cada
// gravação vai pra rel_auditoria. Sem a 0232: "ainda não disponível".
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Btn, Card, StatusChip } from "@/components/ui";
import { Aviso } from "../../ui";
import { formatarData } from "../../lib/clientes";
import {
  alertaSeisMeses, apagarDocViagem, linkArquivoFicha, salvarDocViagem, subirArquivoDocViagem, TIPOS_DOC_VIAGEM,
  type DocViagem, type IdaCompleta, type TipoDocViagem,
} from "./fontes";
import { dataSP, dataValida } from "./regras";

export type EstadoDocsViagem = { ativo: boolean; lista: DocViagem[]; erro?: string };

const vazio = (): Partial<DocViagem> => ({ tipo: "visto", numero: "", pais: "", emissao: "", validade: "", detalhe: "", expedicao_id: null });
const rotuloTipo = (t: TipoDocViagem) => TIPOS_DOC_VIAGEM.find((x) => x.id === t)?.rotulo ?? t;

export default function DocumentosViagem({ clienteId, estado, idas, bloqueado, voltaProxima, onMudou }: {
  clienteId: string; estado: EstadoDocsViagem | null; idas: IdaCompleta[]; bloqueado: boolean; voltaProxima: string | null; onMudou: () => void;
}) {
  const [form, setForm] = useState<Partial<DocViagem> | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  if (!estado) return <Card title="Documentos de viagem"><p className="fc-p">Carregando…</p></Card>;
  if (!estado.ativo) return <Card title="Documentos de viagem"><p className="fc-p">Visto, seguro, vacinas e 2º passaporte: ainda não disponível (migration 0232).</p></Card>;

  const hoje = dataSP();
  const viagens = idas.filter((i) => i.expedicao && i.status_reserva !== "Cancelado");
  const det = TIPOS_DOC_VIAGEM.find((x) => x.id === form?.tipo)?.detalhe ?? "Detalhe";
  const set = (k: keyof DocViagem, v: string | null) => setForm((f) => ({ ...(f ?? {}), [k]: v }));

  async function salvar() {
    if (!form) return;
    for (const k of ["emissao", "validade"] as const) {
      const v = form[k];
      if (v && !dataValida(v)) { setMsg({ tom: "erro", texto: `${k === "emissao" ? "Emissão" : "Validade"}: data incompleta.` }); return; }
    }
    setOcupado(true); setMsg(null);
    try {
      const arquivo_path = arquivo ? await subirArquivoDocViagem(clienteId, arquivo) : undefined;
      await salvarDocViagem(clienteId, { ...form, ...(arquivo_path ? { arquivo_path } : {}) });
      setForm(null); setArquivo(null);
      setMsg({ tom: "ok", texto: "Documento salvo na ficha." });
      onMudou();
    } catch (e) { setMsg({ tom: "erro", texto: e instanceof Error ? e.message : "Não salvou." }); }
    finally { setOcupado(false); }
  }

  async function apagar(d: DocViagem) {
    if (!window.confirm(`Apagar ${rotuloTipo(d.tipo).toLowerCase()}${d.numero ? ` ${d.numero}` : ""}? Fica no histórico da ficha.`)) return;
    setOcupado(true); setMsg(null);
    try { await apagarDocViagem(d.id); onMudou(); }
    catch (e) { setMsg({ tom: "erro", texto: e instanceof Error ? e.message : "Não apagou." }); }
    finally { setOcupado(false); }
  }

  async function abrir(path: string) {
    try { window.open(await linkArquivoFicha(path), "_blank", "noopener"); }
    catch (e) { setMsg({ tom: "erro", texto: e instanceof Error ? e.message : "Não abriu." }); }
  }

  const selo = (d: DocViagem) => {
    if (!d.validade) return null;
    if (d.tipo === "passaporte") { const a = alertaSeisMeses(d.validade, voltaProxima); return a && a.tom !== "ok" ? <StatusChip tone={a.tom}>{a.texto}</StatusChip> : null; }
    return d.validade < hoje ? <StatusChip tone="danger">Vencido</StatusChip> : null;
  };

  return (
    <Card title="Documentos de viagem" action={!bloqueado && !form ? <Btn size="sm" onClick={() => { setMsg(null); setForm(vazio()); }}>Adicionar</Btn> : undefined}>
      {estado.erro && <Aviso tom="erro">Não carregou ({estado.erro}).</Aviso>}
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      {estado.lista.length === 0 && !form ? (
        <p className="fc-p">Nenhum visto, seguro, vacina ou 2º passaporte registrado.</p>
      ) : (
        <ul className="fc-pessoas" aria-label="Documentos de viagem">
          {estado.lista.map((d) => {
            const exp = viagens.find((i) => i.expedicao_id === d.expedicao_id)?.expedicao?.nome;
            return (
              <li key={d.id} className="fc-dl__r" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ display: "flex", flexDirection: "column", flex: "1 1 220px", minWidth: 0 }}>
                  <span className="fc-bloco__t">{rotuloTipo(d.tipo)}{d.numero ? ` · ${d.numero}` : ""}{d.pais ? ` · ${d.pais}` : ""}</span>
                  <span className="fc-bloco__s">
                    {[d.detalhe, d.emissao ? `emitido ${formatarData(d.emissao)}` : null, d.validade ? `vale até ${formatarData(d.validade)}` : null, exp ? `viagem: ${exp}` : null]
                      .filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                {selo(d)}
                {d.arquivo_path && <button type="button" className="fc-link fc-link--btn" onClick={() => void abrir(d.arquivo_path!)}>Abrir arquivo</button>}
                {!bloqueado && <>
                  <button type="button" className="fc-link fc-link--btn" disabled={ocupado} onClick={() => { setMsg(null); setForm({ ...d }); }}>Editar</button>
                  <button type="button" className="fc-link fc-link--btn" disabled={ocupado} onClick={() => void apagar(d)}>Apagar</button>
                </>}
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <form className="fc-tel__grupo" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          <div className="fc-tel__grade">
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-tipo">Tipo</label>
              <select id="dv-tipo" className="fc-input" value={form.tipo ?? "visto"} onChange={(e) => set("tipo", e.target.value)} autoFocus>
                {TIPOS_DOC_VIAGEM.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
              </select>
            </div>
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-num">{form.tipo === "seguro" ? "Nº da apólice" : form.tipo === "vacina" ? "Lote / nº do certificado" : "Número"}</label>
              <input id="dv-num" className="fc-input" value={form.numero ?? ""} onChange={(e) => set("numero", e.target.value)} />
            </div>
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-det">{det}</label>
              <input id="dv-det" className="fc-input" value={form.detalhe ?? ""} onChange={(e) => set("detalhe", e.target.value)} />
            </div>
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-pais">País</label>
              <input id="dv-pais" className="fc-input" value={form.pais ?? ""} onChange={(e) => set("pais", e.target.value)} />
            </div>
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-em">{form.tipo === "vacina" ? "Data da vacina" : "Emissão"}</label>
              <input id="dv-em" className="fc-input" type="date" value={form.emissao ?? ""} onChange={(e) => set("emissao", e.target.value)} />
            </div>
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-val">Validade</label>
              <input id="dv-val" className="fc-input" type="date" value={form.validade ?? ""} onChange={(e) => set("validade", e.target.value)} />
            </div>
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-exp">Viagem (opcional)</label>
              <select id="dv-exp" className="fc-input" value={form.expedicao_id ?? ""} onChange={(e) => set("expedicao_id", e.target.value || null)}>
                <option value="">—</option>
                {viagens.map((i) => <option key={i.id} value={i.expedicao_id}>{i.expedicao!.nome}</option>)}
              </select>
            </div>
            <div className="fc-tel__campo">
              <label className="fc-label" htmlFor="dv-arq">Arquivo (opcional)</label>
              <input id="dv-arq" className="fc-input" type="file" accept="application/pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <div className="fc-acoes" style={{ marginTop: 10 }}>
            <Btn size="sm" variant="primary" type="submit" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</Btn>
            <Btn size="sm" variant="ghost" type="button" disabled={ocupado} onClick={() => { setForm(null); setArquivo(null); }}>Cancelar</Btn>
          </div>
        </form>
      )}
    </Card>
  );
}
