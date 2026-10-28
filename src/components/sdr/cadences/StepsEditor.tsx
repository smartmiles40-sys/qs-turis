// src/components/sdr/cadences/StepsEditor.tsx
// -----------------------------------------------------------------------------
// Editor de passos da cadência (28/10): uma LISTA, na ordem em que acontece.
// Arrastar um passo pra cima de outro coloca ele antes daquele, no mesmo dia.
// Cada passo diz o dia, o tipo, o período (= prioridade no FUP) e o texto.
// -----------------------------------------------------------------------------

import { useRef, useState } from "react";
import type { ChannelType } from "../types";
import type { WaModeloAdmin } from "@/lib/qs/waInbox";
import {
  MAIN_KINDS, PERIODS, STEP_KINDS, VARIAVEIS, kindDef, novoId, ordenarPassos, periodOf, previewTexto,
  type Passo, type StepKind,
} from "./cadenceModelos";

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function fmtData(d: Date | undefined): string {
  if (!d) return "";
  return `${DIAS_SEMANA[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface Props {
  passos: Passo[];
  onChange: (next: Passo[]) => void;
  /** Canais ligados em Configurações (null = ainda carregando → mostra todos). */
  enabledChannels: Set<ChannelType> | null;
  /** Data de cada "Dia N" para um lead que entrasse hoje (prévia). */
  datasPorDia: Map<number, Date>;
  modelosMeta: WaModeloAdmin[] | null;
  modelosErro: string | null;
  onPrecisaModelos: () => void;
  /** Ids com erro (destacados em vermelho). */
  comErro: Set<string>;
}

export default function StepsEditor({ passos, onChange, enabledChannels, datasPorDia, modelosMeta, modelosErro, onPrecisaModelos, comErro }: Props) {
  const lista = ordenarPassos(passos);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  // Só a alça arrasta: com o cartão inteiro "draggable", selecionar texto no
  // roteiro virava arrasto do passo.
  const [pegando, setPegando] = useState<string | null>(null);
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());

  function atualizar(id: string, mud: Partial<Passo>) {
    onChange(lista.map((p) => (p.id === id ? { ...p, ...mud } : p)));
  }

  function remover(id: string) {
    const p = lista.find((x) => x.id === id);
    if (p && p.texto.trim() && !window.confirm("Excluir este passo? O texto dele será perdido.")) return;
    onChange(lista.filter((x) => x.id !== id));
  }

  function duplicar(id: string) {
    const idx = lista.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const copia = { ...lista[idx], id: novoId() };
    onChange([...lista.slice(0, idx + 1), copia, ...lista.slice(idx + 1)]);
  }

  /** Move o passo `id` pra antes de `antesDe` (null = fim), assumindo o dia do vizinho. */
  function mover(id: string, antesDe: string | null) {
    if (id === antesDe) return;
    const p = lista.find((x) => x.id === id);
    if (!p) return;
    const resto = lista.filter((x) => x.id !== id);
    if (antesDe === null) {
      const ultimo = resto[resto.length - 1];
      onChange([...resto, { ...p, dia: ultimo ? Math.max(ultimo.dia, p.dia) : p.dia }]);
      return;
    }
    const idx = resto.findIndex((x) => x.id === antesDe);
    if (idx < 0) return;
    onChange([...resto.slice(0, idx), { ...p, dia: resto[idx].dia }, ...resto.slice(idx)]);
  }

  function subir(id: string) {
    const idx = lista.findIndex((x) => x.id === id);
    if (idx <= 0) {
      // Primeiro da lista: só dá pra antecipar o dia.
      const p = lista[idx];
      if (p && p.dia > 1) atualizar(id, { dia: p.dia - 1 });
      return;
    }
    mover(id, lista[idx - 1].id);
  }

  function descer(id: string) {
    const idx = lista.findIndex((x) => x.id === id);
    if (idx < 0) return;
    if (idx >= lista.length - 1) { atualizar(id, { dia: lista[idx].dia + 1 }); return; }
    const prox = lista[idx + 1];
    const depois = lista[idx + 2];
    // Pula o próximo: fica depois dele, no dia dele.
    const p = lista[idx];
    const resto = lista.filter((x) => x.id !== id);
    const pos = depois ? resto.findIndex((x) => x.id === depois.id) : resto.length;
    onChange([...resto.slice(0, pos), { ...p, dia: prox.dia }, ...resto.slice(pos)]);
  }

  function adicionar(mesmoDia: boolean) {
    const ultimo = lista[lista.length - 1];
    const dia = !ultimo ? 1 : mesmoDia ? ultimo.dia : ultimo.dia + 1;
    onChange([...lista, { id: novoId(), dia, kind: ultimo?.kind === "ligacao" ? "whatsapp" : "ligacao", hora: "09:00", texto: "", modelo: "" }]);
  }

  function inserirVariavel(id: string, chave: string) {
    const el = textareas.current.get(id);
    const p = lista.find((x) => x.id === id);
    if (!p) return;
    const ini = el?.selectionStart ?? p.texto.length;
    const fim = el?.selectionEnd ?? p.texto.length;
    const texto = p.texto.slice(0, ini) + chave + p.texto.slice(fim);
    atualizar(id, { texto });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(ini + chave.length, ini + chave.length);
    });
  }

  function escolherTipo(id: string, kind: StepKind) {
    atualizar(id, { kind });
    if (kind === "whatsapp_modelo") onPrecisaModelos();
  }

  const visivel = (k: StepKind) => {
    const ch = kindDef(k).channel;
    return !enabledChannels || enabledChannels.has(ch);
  };
  const outros = STEP_KINDS.filter((k) => !MAIN_KINDS.includes(k.kind));
  const aprovados = (modelosMeta ?? []).filter((m) => m.status === "APPROVED" && !m.cabecalhoMidia);

  return (
    <div className="space-y-2">
      {lista.length === 0 && (
        <div className="p-6 rounded-xl border-2 border-dashed border-gray-200 text-center text-sm text-gray-500">
          Nenhum passo ainda. Comece pela primeira ligação ou mensagem.
        </div>
      )}

      {lista.map((p, i) => {
        const def = kindDef(p.kind);
        const novoDia = i === 0 || lista[i - 1].dia !== p.dia;
        const periodo = periodOf(p.hora);
        const horaFora = p.hora && p.hora !== "09:00" && p.hora !== "12:30";
        const temVar = /\{\{?\s*\w+\s*\}?\}/.test(p.texto);
        const data = datasPorDia.get(p.dia);
        const fimDeSemana = data && (data.getDay() === 0 || data.getDay() === 6);
        const erro = comErro.has(p.id);
        return (
          <div key={p.id}>
            {novoDia && (
              <div className="flex items-center gap-2 pt-3 pb-1">
                <span className="text-xs font-bold text-gray-900">Dia {p.dia}</span>
                {data && (
                  <span className={`text-[11px] ${fimDeSemana ? "text-amber-700 font-semibold" : "text-gray-400"}`}>
                    {fmtData(data)}{fimDeSemana ? " · fim de semana" : ""}
                  </span>
                )}
                <span className="flex-1 border-t border-gray-100" />
              </div>
            )}

            <div
              draggable={pegando === p.id}
              onDragStart={(e) => { setArrastando(p.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { setArrastando(null); setAlvo(null); setPegando(null); }}
              onDragOver={(e) => { if (arrastando && arrastando !== p.id) { e.preventDefault(); setAlvo(p.id); } }}
              onDragLeave={() => setAlvo((a) => (a === p.id ? null : a))}
              onDrop={(e) => { e.preventDefault(); if (arrastando) mover(arrastando, p.id); setArrastando(null); setAlvo(null); }}
              className={`relative rounded-xl border bg-white p-3 transition ${
                erro ? "border-red-300 bg-red-50/40" : "border-gray-100"
              } ${arrastando === p.id ? "opacity-40" : ""} ${alvo === p.id ? "ring-2 ring-[#0147FF]/40" : ""}`}
            >
              {alvo === p.id && <span className="absolute -top-1 left-3 right-3 h-0.5 rounded bg-[#0147FF]" />}

              <div className="flex items-start gap-2">
                {/* Alça + subir/descer (teclado/celular, onde arrastar é ruim) */}
                <div className="flex flex-col items-center gap-0.5 pt-1 text-gray-300">
                  <span
                    onMouseDown={() => setPegando(p.id)}
                    onMouseUp={() => setPegando(null)}
                    className="cursor-grab select-none text-base leading-none px-1" title="Arraste para reordenar" aria-hidden>⠿</span>
                  <button type="button" onClick={() => subir(p.id)} className="text-[10px] text-gray-400 hover:text-[#0147FF]" title="Subir" aria-label="Subir passo">▲</button>
                  <button type="button" onClick={() => descer(p.id)} className="text-[10px] text-gray-400 hover:text-[#0147FF]" title="Descer" aria-label="Descer passo">▼</button>
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Dia */}
                    <div className="inline-flex items-center rounded-lg border border-gray-200 overflow-hidden">
                      <button type="button" onClick={() => atualizar(p.id, { dia: Math.max(1, p.dia - 1) })} className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-50" aria-label="Dia anterior">−</button>
                      <label className="px-1 text-[11px] text-gray-500">Dia</label>
                      <input
                        type="number" min={1} value={p.dia}
                        onChange={(e) => atualizar(p.id, { dia: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                        className="w-10 py-1 text-center text-xs font-bold focus:outline-none"
                      />
                      <button type="button" onClick={() => atualizar(p.id, { dia: p.dia + 1 })} className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-50" aria-label="Próximo dia">+</button>
                    </div>

                    {/* Tipo */}
                    <div className="flex flex-wrap gap-1">
                      {MAIN_KINDS.filter((k) => visivel(k) || p.kind === k).map((k) => {
                        const on = p.kind === k;
                        return (
                          <button key={k} type="button" onClick={() => escolherTipo(p.id, k)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                              on ? "bg-[#0147FF] text-white border-[#0147FF]" : "bg-white text-gray-600 border-gray-200 hover:border-[#0147FF]/50"
                            }`}>
                            {kindDef(k).label}
                          </button>
                        );
                      })}
                      <select
                        value={MAIN_KINDS.includes(p.kind) ? "" : p.kind}
                        onChange={(e) => e.target.value && escolherTipo(p.id, e.target.value as StepKind)}
                        className={`px-2 py-1 rounded-lg text-[11px] border bg-white ${MAIN_KINDS.includes(p.kind) ? "border-gray-200 text-gray-500" : "border-[#0147FF] text-[#0147FF] font-semibold"}`}
                        aria-label="Outros canais"
                      >
                        <option value="">Outros…</option>
                        {outros.filter((k) => visivel(k.kind) || p.kind === k.kind).map((k) => (
                          <option key={k.kind} value={k.kind}>{k.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Ações */}
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => duplicar(p.id)} className="px-2 py-1 rounded-lg text-[11px] text-gray-500 hover:bg-gray-50" title="Duplicar passo">Duplicar</button>
                      <button type="button" onClick={() => remover(p.id)} className="px-2 py-1 rounded-lg text-[11px] text-gray-400 hover:text-red-600 hover:bg-red-50" title="Excluir passo">Excluir</button>
                    </div>
                  </div>

                  {/* Período */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PERIODS.map((per) => {
                      const on = periodo === per.key;
                      return (
                        <button key={per.key} type="button" title={per.hint}
                          onClick={() => atualizar(p.id, { hora: per.time })}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                            on ? "bg-[#0147FF]/10 text-[#0147FF] border-[#0147FF]/40" : "bg-white text-gray-500 border-gray-200"
                          }`}>
                          {per.label}
                        </button>
                      );
                    })}
                    <span className="text-[10.5px] text-gray-400">
                      {PERIODS.find((x) => x.key === periodo)?.hint}{horaFora ? ` · horário salvo ${p.hora}` : ""}
                    </span>
                  </div>

                  {/* Modelo da Meta */}
                  {p.kind === "whatsapp_modelo" && (
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-gray-600">Modelo aprovado da Meta</label>
                      {modelosMeta === null && !modelosErro ? (
                        <p className="text-[11px] text-gray-400">Carregando modelos…</p>
                      ) : aprovados.length > 0 ? (
                        <select value={p.modelo} onChange={(e) => atualizar(p.id, { modelo: e.target.value })}
                          className={`w-full px-3 py-1.5 rounded-lg border text-xs bg-white ${!p.modelo ? "border-red-300" : "border-gray-200"}`}>
                          <option value="">Escolha o modelo…</option>
                          {p.modelo && !aprovados.some((m) => m.nome === p.modelo) && (
                            <option value={p.modelo}>{p.modelo} (não está aprovado agora)</option>
                          )}
                          {aprovados.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                        </select>
                      ) : (
                        <input value={p.modelo} onChange={(e) => atualizar(p.id, { modelo: e.target.value })}
                          placeholder="Nome do modelo (ex.: retomada_expedicao)"
                          className={`w-full px-3 py-1.5 rounded-lg border text-xs ${!p.modelo ? "border-red-300" : "border-gray-200"}`} />
                      )}
                      {modelosErro && <p className="text-[10.5px] text-amber-700">Não consegui listar os modelos ({modelosErro}). Digite o nome exato.</p>}
                      {(() => {
                        const m = aprovados.find((x) => x.nome === p.modelo);
                        return m ? <p className="text-[11px] text-gray-500 whitespace-pre-wrap rounded-lg bg-[#F8F9FA] px-3 py-2">{m.corpo}</p> : null;
                      })()}
                    </div>
                  )}

                  {/* Texto */}
                  <div>
                    <div className="flex flex-wrap items-center gap-1 mb-1">
                      <span className="text-[11px] font-medium text-gray-600 mr-1">{def.textoLabel}</span>
                      {VARIAVEIS.map((v) => (
                        <button key={v.chave} type="button" onClick={() => inserirVariavel(p.id, v.chave)}
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-gray-100 text-gray-600 hover:bg-[#0147FF]/10 hover:text-[#0147FF]"
                          title={`Inserir ${v.label}`}>
                          {v.chave}
                        </button>
                      ))}
                    </div>
                    <textarea
                      ref={(el) => { if (el) textareas.current.set(p.id, el); else textareas.current.delete(p.id); }}
                      value={p.texto}
                      onChange={(e) => atualizar(p.id, { texto: e.target.value })}
                      placeholder={def.textoPlaceholder}
                      rows={2}
                      className={`w-full px-3 py-2 rounded-lg border text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#0147FF] resize-y bg-white ${
                        def.mensagem && !p.texto.trim() ? "border-amber-300" : "border-gray-200"
                      }`}
                    />
                    {def.mensagem && !p.texto.trim() && (
                      <p className="text-[10.5px] text-amber-700">Sem mensagem: o SDR vai abrir o WhatsApp/e-mail em branco.</p>
                    )}
                    {temVar && p.texto.trim() && (
                      <p className="text-[11px] text-gray-500 mt-1">
                        <span className="font-semibold text-gray-400">Fica assim: </span>{previewTexto(p.texto)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Soltar no fim */}
      {arrastando && (
        <div
          onDragOver={(e) => { e.preventDefault(); setAlvo("__fim"); }}
          onDragLeave={() => setAlvo(null)}
          onDrop={(e) => { e.preventDefault(); mover(arrastando, null); setArrastando(null); setAlvo(null); }}
          className={`h-10 rounded-xl border-2 border-dashed text-[11px] flex items-center justify-center ${alvo === "__fim" ? "border-[#0147FF] text-[#0147FF]" : "border-gray-200 text-gray-400"}`}
        >
          Soltar no fim
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" onClick={() => adicionar(true)} disabled={lista.length === 0}
          className="px-3 py-2 rounded-lg text-xs font-medium text-[#0147FF] border border-dashed border-[#0147FF]/40 hover:bg-[#0147FF]/5 disabled:opacity-40">
          + Passo no mesmo dia
        </button>
        <button type="button" onClick={() => adicionar(false)}
          className="px-3 py-2 rounded-lg text-xs font-medium text-white bg-[#0147FF] hover:bg-[#0139D6]">
          + Passo no dia seguinte
        </button>
      </div>
    </div>
  );
}
