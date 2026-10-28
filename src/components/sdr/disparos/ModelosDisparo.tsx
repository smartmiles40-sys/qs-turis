// src/components/sdr/disparos/ModelosDisparo.tsx
// -----------------------------------------------------------------------------
// MODELOS DO DISPARO (0217): montar o texto com variáveis, ver a prévia e gerar
// o PACOTE que vai pra Meta. Esta tela NÃO submete nada: o Bruno cola o pacote
// (ou o texto) no WhatsApp Manager — passo a passo em docs/DISPARO-EM-MASSA.md —
// e, quando a Meta aprovar, marca aqui "aprovado". Só modelo aprovado aparece
// pra campanha.
// -----------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  pacoteDaMeta, problemaDoModelo, ROTULO_STATUS_MODELO, salvarModelo, variaveisDoCorpo,
  type ModeloDisparo, type SetorDisparo, type StatusModelo,
} from "@/lib/qs/disparos";
import { Bolha, Campo, INPUT, INPUT_ESTILO, Modal } from "./pecas";

const TOM: Record<StatusModelo, "ok" | "warn" | "danger" | undefined> = { rascunho: undefined, enviado: "warn", aprovado: "ok", recusado: "danger" };

const VAZIO: ModeloDisparo = { nome: "", idioma: "pt_BR", categoria: "MARKETING", corpo: "", cabecalho: "", rodape: "Se Tu For, Eu Vou! Viagens", exemplos: {}, botaoParar: true, status: "rascunho" };

function Editor({ inicial, setor, onFechar, onSalvo }: { inicial: ModeloDisparo | null; setor: SetorDisparo; onFechar: () => void; onSalvo: () => void }) {
  const [m, setM] = useState<ModeloDisparo>(inicial ?? { ...VAZIO, setor });
  const [salvando, setSalvando] = useState(false);
  const vars = useMemo(() => variaveisDoCorpo(m.corpo), [m.corpo]);
  const problema = problemaDoModelo(m);
  const pacote = useMemo(() => JSON.stringify(pacoteDaMeta(m), null, 2), [m]);
  const set = <K extends keyof ModeloDisparo>(k: K, v: ModeloDisparo[K]) => setM((x) => ({ ...x, [k]: v }));
  const prevista = m.corpo.replace(/{{\s*(\d+)\s*}}/g, (_, n: string) => m.exemplos?.[n] || `[${n}]`);

  async function salvar() {
    setSalvando(true);
    try { await salvarModelo(setor, m); notifySuccess("Modelo salvo."); onSalvo(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={inicial ? `Modelo · ${inicial.nome}` : "Novo modelo"} onFechar={onFechar} largura={860}
      rodape={<>
        <Button variant="ghost" onClick={onFechar}>Fechar</Button>
        <Button variant="primary" disabled={!!problema || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <Campo rotulo="Nome na Meta" dica="Minúsculas, números e _. Ex.: retomada_lead_frio">
            <input className={INPUT} style={INPUT_ESTILO} value={m.nome} disabled={!!inicial} onChange={(e) => set("nome", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Categoria">
              <select className={INPUT} style={INPUT_ESTILO} value={m.categoria} onChange={(e) => set("categoria", e.target.value as ModeloDisparo["categoria"])}>
                <option value="MARKETING">Marketing (oferta, retomada)</option>
                <option value="UTILITY">Utilidade (aviso de quem já é cliente)</option>
              </select>
            </Campo>
            <Campo rotulo="Situação">
              <select className={INPUT} style={INPUT_ESTILO} value={m.status} onChange={(e) => set("status", e.target.value as StatusModelo)}>
                {(Object.keys(ROTULO_STATUS_MODELO) as StatusModelo[]).map((s) => <option key={s} value={s}>{ROTULO_STATUS_MODELO[s]}</option>)}
              </select>
            </Campo>
          </div>
          <Campo rotulo="Título (opcional, até 60)">
            <input className={INPUT} style={INPUT_ESTILO} maxLength={60} value={m.cabecalho ?? ""} onChange={(e) => set("cabecalho", e.target.value)} />
          </Campo>
          <Campo rotulo="Texto" dica="Variáveis: {{1}}, {{2}}… Não comece nem termine com variável.">
            <textarea className={INPUT} style={{ ...INPUT_ESTILO, minHeight: 150 }} maxLength={1024} value={m.corpo} onChange={(e) => set("corpo", e.target.value)} />
          </Campo>
          {vars.length > 0 && (
            <div className="space-y-2">
              <p className="qs-label">Exemplo de cada variável (o revisor da Meta lê)</p>
              {vars.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <span className="w-10 text-[13px] qs-num" style={{ color: "var(--muted)" }}>{`{{${v}}}`}</span>
                  <input className={INPUT} style={INPUT_ESTILO} value={m.exemplos?.[v] ?? ""} placeholder="Ex.: Maria"
                         onChange={(e) => set("exemplos", { ...(m.exemplos ?? {}), [v]: e.target.value })} />
                </div>
              ))}
            </div>
          )}
          <Campo rotulo="Rodapé (opcional, até 60)">
            <input className={INPUT} style={INPUT_ESTILO} maxLength={60} value={m.rodape ?? ""} onChange={(e) => set("rodape", e.target.value)} />
          </Campo>
          <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text)" }}>
            <input type="checkbox" checked={m.botaoParar !== false} onChange={(e) => set("botaoParar", e.target.checked)} />
            Botão "Parar de receber" (protege a qualidade do número)
          </label>
        </div>
        <div className="space-y-3">
          <p className="qs-label">Como chega no celular</p>
          <Bolha titulo={m.cabecalho} texto={prevista} rodape={m.rodape} botao={m.botaoParar !== false ? "Parar de receber" : null} />
          {problema && <p className="text-[13px] qs-tone-danger">{problema}</p>}
          <div className="flex items-center justify-between">
            <p className="qs-label">Pacote pra Meta (POST /{"{waba}"}/message_templates)</p>
            <Button size="sm" onClick={() => { void navigator.clipboard.writeText(pacote); notifySuccess("Pacote copiado."); }}>Copiar</Button>
          </div>
          <pre className="max-h-[300px] overflow-auto rounded-lg p-3 text-[11.5px]" style={{ background: "var(--surface-2)", color: "var(--text)" }}>{pacote}</pre>
          <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
            O QS não manda isto pra Meta. Crie o modelo no WhatsApp Manager de CADA número que vai disparar (cada SDR tem a conta dele) e, quando aprovar, mude a situação pra "aprovado".
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default function ModelosDisparo({ setor, modelos, podeEditar, onMudou }: {
  setor: SetorDisparo; modelos: ModeloDisparo[]; podeEditar: boolean; onMudou: () => void;
}) {
  const [editando, setEditando] = useState<ModeloDisparo | null | "novo">(null);
  const lista = modelos.filter((m) => !m.setor || m.setor === setor);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>Monte o texto, copie o pacote, aprove na Meta e marque como aprovado.</p>
        {podeEditar && <Button variant="primary" onClick={() => setEditando("novo")}>+ Novo modelo</Button>}
      </div>
      {lista.length === 0 ? (
        <div className="qs-card"><EmptyState title="Nenhum modelo ainda" description="Sugestões prontas em docs/DISPARO-EM-MASSA.md (lead frio, pós-live, recompra, convite pro grupo)." /></div>
      ) : (
        <ul className="space-y-2">
          {lista.map((m) => (
            <li key={`${m.nome}:${m.idioma}`} className="qs-card p-4 flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>{m.nome}</p>
                <p className="text-[12.5px] line-clamp-2" style={{ color: "var(--muted)" }}>{m.corpo}</p>
              </div>
              <Badge tone={TOM[m.status]}>{ROTULO_STATUS_MODELO[m.status]}</Badge>
              {podeEditar && <Button size="sm" onClick={() => setEditando(m)}>Abrir</Button>}
              {podeEditar && m.status !== "aprovado" && (
                <Button size="sm" variant="destructive" onClick={async () => {
                  if (!window.confirm(`Apagar o modelo ${m.nome}?`)) return;
                  try { await salvarModelo(setor, m, true); onMudou(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
                }}>Apagar</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <Editor inicial={editando === "novo" ? null : editando} setor={setor} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); onMudou(); }} />
      )}
    </div>
  );
}
