// src/expedicoes/rooming/RoomingBoard.tsx
// Quadro do Rooming (app antigo: app/(app)/expedicoes/[id]/rooming/RoomingBoard.tsx).
// Um bloco por hotel/trecho (hotel + datas + extensão), coluna "Sem quarto" e os
// quartos; arrasta passageiro entre quartos (@dnd-kit/core). Quem viaja junto
// (conexão) se move como um bloco e não pode ficar separado. Faixa que diz se
// está tudo alocado (libera o Excel), lista de conexões, acompanhantes indicados
// na inscrição, renomear/redatar/duplicar/excluir hotel, editar/duplicar/excluir
// quarto. Diferenças do antigo: toda escrita é atômica no banco (0168), que
// também confere capacidade e extensão; não dá pra soltar um passageiro num
// hotel de extensão que ele não contratou; os números dos quartos não mudam
// sozinhos (botão "Renumerar" fecha os buracos); o realtime de passageiro_quarto
// agora funciona (tabela entrou na publicação na 0162).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, Botao, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, Selo } from "../ui";
import { formatDate } from "../lib/utils";
import type { AlocacaoQuartoRow, PassageiroRow, QuartoRow } from "../lib/database";
import * as db from "./dados";
import type { DadosRooming } from "./dados";
import { calcularRooming, capacidade, primeiroNome, quartoCancelado, type Grupo, type GrupoTrecho, type Trecho } from "./calculos";
import { exportarRoomingExcel } from "./exportar";
import { GavetaConexao, GavetaCriarQuartos, GavetaDuplicar, GavetaEditarQuarto, type OrigemDuplicar, type PrefillHotel } from "./Gavetas";

const erroDe = (e: unknown) => (e instanceof Error ? e.message : "Algo deu errado");

// ---- ícones (traço, 24x24) ----
function Ic({ d, t = 14 }: { d: ReactNode; t?: number }) {
  return <svg width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-shrink-0">{d}</svg>;
}
const I = {
  predio: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" /></>,
  lapis: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  cal: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  copiar: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  mais: <path d="M12 5v14M5 12h14" />,
  baixar: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  varinha: <><path d="m15 4-1 1M19 8l1-1M14 2v2M22 10h-2M18 2l-1 1M5 19 17 7l-2-2L3 17Z" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  abaixo: <path d="m6 9 6 6 6-6" />,
  direita: <path d="m9 6 6 6-6 6" />,
  arrastar: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  ok: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  alerta: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  pessoas: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  cama: <><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" /></>,
  rota: <><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></>,
  ordem: <><path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4" /></>,
};

function BotaoIcone({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={titulo} aria-label={titulo} onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--card2)]" style={{ color: "var(--ink3)" }}>
      {children}
    </button>
  );
}
function BotaoPequeno({ onClick, children, titulo }: { onClick: () => void; children: ReactNode; titulo?: string }) {
  return (
    <button type="button" onClick={onClick} title={titulo}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold hover:opacity-80"
      style={{ border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" }}>
      {children}
    </button>
  );
}

const COR_GRUPO: Record<string, { fundo: string; texto: string }> = {
  G1: { fundo: "#DBEAFE", texto: "#1D4ED8" },
  G2: { fundo: "#EDE9FE", texto: "#5B21B6" },
  misto: { fundo: "var(--warn-bg)", texto: "var(--warn-ink)" },
};
function SeloGrupo({ g, titulo }: { g: Exclude<GrupoTrecho, null>; titulo?: string }) {
  const c = COR_GRUPO[g];
  return <span title={titulo} className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold flex-shrink-0" style={{ background: c.fundo, color: c.texto }}>{g === "misto" ? "G1+G2" : g}</span>;
}

// ---------------------------------------------------------------------------

export default function RoomingBoard({ expId, dados, recarregar }: { expId: string; dados: DadosRooming; recarregar: () => Promise<void> }) {
  const { somenteLeitura, avisar } = useExp();
  const [localAloc, setLocalAloc] = useState<AlocacaoQuartoRow[]>(dados.alocacoes);
  useEffect(() => setLocalAloc(dados.alocacoes), [dados.alocacoes]);
  const r = useMemo(() => calcularRooming(dados, localAloc), [dados, localAloc]);

  const [criar, setCriar] = useState<{ modo: "novo" | "auto"; prefill: PrefillHotel | null } | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [duplicar, setDuplicar] = useState<OrigemDuplicar | null>(null);
  const [conexaoGaveta, setConexaoGaveta] = useState<string[] | null>(null);
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [conexoesAberto, setConexoesAberto] = useState(false);
  const [acompAberto, setAcompAberto] = useState(false);
  const [escolhaAcomp, setEscolhaAcomp] = useState<Record<string, string>>({});
  const [exportando, setExportando] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const quartoEditando = editandoId ? r.quartoById.get(editandoId) ?? null : null;
  const depois = useCallback(() => { void recarregar(); }, [recarregar]);

  // ---------- alocação (otimista, com volta se der erro) ----------
  async function alocar(paxId: string, quartoId: string) {
    const quarto = r.quartoById.get(quartoId);
    if (!quarto) return;
    if (quartoCancelado(quarto)) { avisar("Este quarto está cancelado. Reative-o antes de alocar.", "erro"); return; }
    let membros = r.membrosConexaoByPax.get(paxId) ?? [paxId];
    const trecho = r.trechoDoQuarto.get(quartoId);
    if (trecho?.extensao_id) {
      // hotel de extensão: só quem contratou (da conexão, vão juntos só os que contrataram)
      const relevantes = new Set(r.paxRelevantes(trecho).map((p) => p.id));
      if (!relevantes.has(paxId)) { avisar(`${r.paxById.get(paxId)?.nome_completo ?? "Este passageiro"} não contratou a extensão deste hotel.`, "erro"); return; }
      membros = membros.filter((id) => relevantes.has(id));
    }
    const cap = capacidade(quarto.tipo);
    const fixos = (r.ocupantesPorQuarto.get(quartoId) ?? []).filter((id) => !membros.includes(id)).length;
    if (fixos + membros.length > cap) {
      avisar(membros.length > 1
        ? `A conexão não cabe junta: são ${membros.length} pessoas que viajam juntas e o quarto (${quarto.tipo}) comporta ${cap}. Use um quarto maior ou desfaça a conexão.`
        : `Quarto cheio: ${quarto.tipo} comporta no máximo ${cap} ${cap === 1 ? "pessoa" : "pessoas"}.`, "erro");
      return;
    }
    const idsTrecho = new Set(trecho ? trecho.quartos.map((q) => q.id) : [quartoId]);
    const anterior = localAloc;
    setLocalAloc((prev) => [
      ...prev.filter((a) => !(membros.includes(a.passageiro_id) && idsTrecho.has(a.quarto_id))),
      ...membros.map((pid) => ({ id: `tmp-${pid}-${quartoId}`, passageiro_id: pid, quarto_id: quartoId, created_at: "9999" })),
    ]);
    try { await db.alocar(membros, quartoId); depois(); }
    catch (e) { setLocalAloc(anterior); avisar(`Erro ao alocar: ${erroDe(e)}`, "erro"); }
  }

  async function tirarDoQuarto(paxId: string, trecho: Trecho) {
    const membros = r.membrosConexaoByPax.get(paxId) ?? [paxId]; // juntos saem juntos
    const idsTrecho = trecho.quartos.map((q) => q.id);
    const set = new Set(idsTrecho);
    if (!localAloc.some((a) => membros.includes(a.passageiro_id) && set.has(a.quarto_id))) return;
    const anterior = localAloc;
    setLocalAloc((prev) => prev.filter((a) => !(membros.includes(a.passageiro_id) && set.has(a.quarto_id))));
    try { await db.desalocar(membros, idsTrecho); depois(); }
    catch (e) { setLocalAloc(anterior); avisar(`Erro ao remover do quarto: ${erroDe(e)}`, "erro"); }
  }

  async function juntarConexao(membros: PassageiroRow[], quartoId: string) {
    try { await db.alocar(membros.map((m) => m.id), quartoId); avisar("Conexão alocada no mesmo quarto"); depois(); }
    catch (e) { avisar(`Não foi possível juntar: ${erroDe(e)}`, "erro"); }
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const paxId = String(active.id).split("::")[1];
    const overId = String(over.id);
    if (overId.startsWith("sem::")) {
      const t = r.trechos.find((x) => x.key === overId.slice(5));
      if (t) void tirarDoQuarto(paxId, t);
    } else {
      // já está nesse quarto? nada a fazer
      if ((r.ocupantesPorQuarto.get(overId) ?? []).includes(paxId)) return;
      void alocar(paxId, overId);
    }
  }

  async function exportar() {
    if (!r.completo) {
      avisar(r.conexoesSeparadas.length
        ? "Rooming incompleto: há pessoas que viajam juntas em quartos diferentes. Junte-as antes de exportar."
        : "Rooming incompleto: aloque todos os passageiros em todos os hotéis antes de exportar.", "erro");
      return;
    }
    setExportando(true);
    try { await exportarRoomingExcel(r); avisar("Rooming exportado (.xlsx)"); }
    catch (e) { avisar(`Não foi possível gerar o Excel: ${erroDe(e)}`, "erro"); }
    finally { setExportando(false); }
  }

  async function vincular(paxId: string, ids: string[]) {
    const alvos = [...new Set(ids.filter(Boolean))].filter((id) => id !== paxId);
    if (!alvos.length) return;
    try {
      await db.salvarConexao(expId, [], [paxId, ...alvos]);
      avisar(alvos.length > 1 ? "Grupo vinculado como 'viajam juntas'" : "Vinculados como 'viajam juntas'");
      depois();
    } catch (e) { avisar(`Não foi possível vincular: ${erroDe(e)}`, "erro"); }
  }

  const alternar = (k: string) => setRecolhidos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Rooming list</h2>
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              {r.trechos.length} hotel(éis) · {dados.quartos.length} quartos · {r.paxAtivos.length} passageiros{somenteLeitura ? "" : " · arraste para alocar"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Botao onClick={exportar} disabled={!r.completo || exportando}
              title={r.completo ? "Exportar rooming" : "Aloque todos em todos os hotéis para liberar a exportação"}>
              <Ic d={I.baixar} /> {exportando ? "Gerando…" : "Exportar Excel"}
            </Botao>
            {!somenteLeitura && (
              <>
                <Botao onClick={() => setCriar({ modo: "auto", prefill: null })}><Ic d={I.varinha} /> Criar quartos automáticos</Botao>
                <Botao variante="primario" onClick={() => setCriar({ modo: "novo", prefill: null })}><Ic d={I.mais} /> Novo quarto</Botao>
              </>
            )}
          </div>
        </div>

        {/* Faixa da obrigatoriedade */}
        {r.trechos.length > 0 && <FaixaStatus r={r} />}

        {/* Viajam juntas */}
        <Painel aberto={conexoesAberto} onAlternar={() => setConexoesAberto((v) => !v)} icone={I.pessoas}
          titulo="Viajam juntas" sub="ficam no mesmo quarto" contagem={r.conexoes.length}
          acao={!somenteLeitura && <BotaoPequeno onClick={() => setConexaoGaveta([])}><Ic d={I.link} t={12} /> Nova conexão</BotaoPequeno>}>
          {r.conexoes.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              Marque pessoas que viajam juntas (casal, família). Elas são tratadas como bloco: ao alocar uma, todas vão para o mesmo quarto — e o sistema <strong>impede</strong> deixá-las em quartos separados.
            </p>
          ) : (
            <div className="space-y-1.5">
              {r.conexoes.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.cor }} />
                  <span className="text-[12.5px] truncate flex-1" style={{ color: "var(--ink)" }}>{c.membros.map((m) => m.nome_completo).join(" · ")}</span>
                  <Selo>{c.membros.length}</Selo>
                  {!somenteLeitura && (
                    <button type="button" onClick={() => setConexaoGaveta(c.membros.map((m) => m.id))}
                      className="text-[11.5px] font-semibold px-1.5 py-0.5 rounded hover:bg-[var(--card2)]" style={{ color: "var(--ink2)" }}>Editar</button>
                  )}
                  <BotaoExcluir icone={false} rotulo="Desfazer" titulo="Desfazer esta conexão?"
                    descricao="As pessoas deixam de ser tratadas como grupo de quarto. As alocações atuais de quarto não mudam."
                    sucesso="Conexão desfeita" onConfirmar={async () => { await db.desfazerConexao(expId, c.id); depois(); }} />
                </div>
              ))}
            </div>
          )}
        </Painel>

        {/* Acompanhantes indicados */}
        {r.acompanhantes.length > 0 && (
          <Painel aberto={acompAberto} onAlternar={() => setAcompAberto((v) => !v)} icone={I.cama}
            titulo="Acompanhantes indicados" sub="informado na inscrição" contagem={r.acompanhantes.length}>
            <div className="space-y-1.5">
              {r.acompanhantes.map(({ pax, partes, jaConectados }) => {
                const escolha = (i: number) => escolhaAcomp[`${pax.id}:${i}`] ?? partes[i]?.candidato?.id ?? "";
                const escolhidos = [...new Set(partes.map((_, i) => escolha(i)).filter(Boolean))].filter((id) => id !== pax.id);
                const multi = partes.length > 1;
                return (
                  <div key={pax.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
                    <span className="text-[12.5px]" style={{ color: "var(--ink)" }}>
                      <strong>{primeiroNome(pax.nome_completo)}</strong> quer viajar com <strong>{pax.acompanhante_nome}</strong>
                    </span>
                    {pax.acompanhante_divide_quarto && <Selo tom="lista">{pax.acompanhante_divide_quarto}</Selo>}
                    <span className="flex-1" />
                    {jaConectados ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: "#16A34A" }}><Ic d={I.ok} t={12} /> vinculados</span>
                    ) : somenteLeitura ? (
                      <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{partes.map((p) => p.candidato?.nome_completo).filter(Boolean).join(", ") || "—"}</span>
                    ) : (
                      <div className="flex w-full flex-col gap-1 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                        {partes.map((parte, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            {multi && <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--ink3)" }}>{parte.nome}:</span>}
                            <select className="rel-input" style={{ padding: "4px 8px", maxWidth: 230, fontSize: 12 }} value={escolha(i)}
                              title={`Passageiro correspondente a "${parte.nome}"`}
                              onChange={(e) => setEscolhaAcomp((s) => ({ ...s, [`${pax.id}:${i}`]: e.target.value }))}>
                              <option value="">{multi ? "— ignorar —" : "Escolher passageiro…"}</option>
                              {r.paxOrdenados.filter((o) => o.id !== pax.id).map((o) => (
                                <option key={o.id} value={o.id}>{o.nome_completo}{o.id === parte.candidato?.id ? " (sugerido)" : ""}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                        <BotaoPequeno onClick={() => void vincular(pax.id, escolhidos)}>
                          <Ic d={I.link} t={12} /> {multi ? `Vincular (${escolhidos.length})` : "Vincular"}
                        </BotaoPequeno>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Painel>
        )}

        {/* Hotéis */}
        {r.trechos.length === 0 ? (
          <div className="rounded-2xl" style={{ border: "1px dashed var(--line)", background: "var(--card)" }}>
            <Vazio titulo="Monte o rooming por hotel"
              texto="Crie os quartos (com hotel e datas de check-in/out) e depois arraste os passageiros para distribuí-los. O jeito rápido é gerar vários de uma vez."
              acao={somenteLeitura ? undefined : <Botao variante="primario" onClick={() => setCriar({ modo: "auto", prefill: null })}><Ic d={I.varinha} /> Criar quartos automáticos</Botao>} />
          </div>
        ) : (
          r.itens.map((item) =>
            item.tipo === "cabecalho" ? (
              <div key={item.key} className="flex items-center gap-2 pt-2">
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-bold" style={{ background: COR_GRUPO[item.grupo].fundo, color: COR_GRUPO[item.grupo].texto }}>
                  {item.grupo === "G1" ? "Grupo 1" : item.grupo === "G2" ? "Grupo 2" : "Ambos os grupos"}
                </span>
                <span className="h-px flex-1" style={{ background: "var(--line)" }} />
              </div>
            ) : (
              <BlocoHotel key={item.t.key} t={item.t} r={r} expId={expId} recolhido={recolhidos.has(item.t.key)} onAlternar={() => alternar(item.t.key)}
                onAdicionar={() => setCriar({ modo: "auto", prefill: { hotel_cidade: item.t.hotel_cidade ?? "", check_in: item.t.check_in ?? "", check_out: item.t.check_out ?? "", extensao_id: item.t.extensao_id } })}
                onDuplicar={(o) => setDuplicar(o)} onEditarQuarto={setEditandoId} onJuntar={juntarConexao} depois={depois} />
            ),
          )
        )}

        <GavetaCriarQuartos modo={criar?.modo ?? null} prefill={criar?.prefill ?? null} expId={expId} extensoes={dados.extensoes} onFechar={() => setCriar(null)} onSalvo={depois} />
        <GavetaEditarQuarto quarto={quartoEditando} ocupantes={quartoEditando ? (r.ocupantesPorQuarto.get(quartoEditando.id) ?? []).length : 0}
          extensoes={dados.extensoes} onFechar={() => setEditandoId(null)} onSalvo={depois} />
        <GavetaDuplicar expId={expId} origem={duplicar} onFechar={() => setDuplicar(null)} onSalvo={depois} />
        <GavetaConexao expId={expId} passageiros={r.paxAtivos} membrosIniciais={conexaoGaveta} onFechar={() => setConexaoGaveta(null)} onSalvo={depois} />
      </div>
    </DndContext>
  );
}

type R = ReturnType<typeof calcularRooming>;

function FaixaStatus({ r }: { r: R }) {
  const tom = r.completo ? { fundo: "#DCFCE7", texto: "#166534" } : r.conexoesSeparadas.length ? { fundo: "var(--err-bg)", texto: "var(--err-ink)" } : { fundo: "var(--warn-bg)", texto: "var(--warn-ink)" };
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12.5px]" style={{ background: tom.fundo, color: tom.texto }}>
      <span className="mt-0.5"><Ic d={r.completo ? I.ok : I.alerta} t={16} /></span>
      {r.completo ? (
        <span>Todos os passageiros estão alocados em todos os hotéis. Exportação liberada. ✅</span>
      ) : (
        <div className="space-y-1.5">
          {r.conexoesSeparadas.length > 0 && (
            <div>
              <strong>Quem viaja junto não pode ficar em quartos separados.</strong> Junte antes de exportar:
              <ul className="mt-1 list-disc list-inside">
                {r.conexoesSeparadas.map(({ trecho, conexao }) => (
                  <li key={`${trecho.key}-${conexao.id}`}>{trecho.hotel_cidade ?? "—"}: {conexao.membros.map((m) => primeiroNome(m.nome_completo)).join(" + ")} em quartos diferentes</li>
                ))}
              </ul>
            </div>
          )}
          {r.totalFaltam > 0 && (
            <div>
              <strong>Faltam alocar {r.totalFaltam} no total.</strong> A exportação fica bloqueada até todos terem quarto em cada hotel:
              <ul className="mt-1 list-disc list-inside">
                {r.pendencias.filter((p) => p.faltam > 0).map((p) => <li key={p.trecho.key}>{p.trecho.hotel_cidade ?? "—"}: {p.faltam} sem quarto</li>)}
              </ul>
            </div>
          )}
          {r.paxAtivos.length === 0 && <div>Nenhum passageiro ativo nesta expedição.</div>}
        </div>
      )}
    </div>
  );
}

function Painel({ aberto, onAlternar, icone, titulo, sub, contagem, acao, children }: {
  aberto: boolean; onAlternar: () => void; icone: ReactNode; titulo: string; sub: string; contagem: number; acao?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
      <header className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--card2)", borderBottom: aberto ? "1px solid var(--line)" : undefined }}>
        <button type="button" onClick={onAlternar} aria-expanded={aberto} className="flex items-center gap-2 min-w-0 flex-1 text-left" style={{ color: "var(--ink)" }}>
          <span style={{ color: "var(--ink3)" }}><Ic d={aberto ? I.abaixo : I.direita} t={16} /></span>
          <span style={{ color: "var(--ink3)" }}><Ic d={icone} /></span>
          <span className="font-bold text-[13px]">{titulo}</span>
          <span className="text-[11.5px] hidden sm:inline" style={{ color: "var(--ink3)" }}>{sub}</span>
          {contagem > 0 && <Selo>{contagem}</Selo>}
        </button>
        {acao}
      </header>
      {aberto && <div className="p-3">{children}</div>}
    </section>
  );
}

function BlocoHotel({ t, r, expId, recolhido, onAlternar, onAdicionar, onDuplicar, onEditarQuarto, onJuntar, depois }: {
  t: Trecho; r: R; expId: string; recolhido: boolean; onAlternar: () => void; onAdicionar: () => void;
  onDuplicar: (o: OrigemDuplicar) => void; onEditarQuarto: (id: string) => void; onJuntar: (m: PassageiroRow[], q: string) => void; depois: () => void;
}) {
  const { somenteLeitura, avisar } = useExp();
  const [modo, setModo] = useState<"nome" | "datas" | null>(null);
  const [nome, setNome] = useState("");
  const [ci, setCi] = useState("");
  const [co, setCo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ids = t.quartos.map((q) => q.id);
  const sem = r.semQuarto(t);
  const relevantes = r.paxRelevantes(t).length;
  const grupo = r.grupoDoTrecho(t);
  const quartos = r.quartosOrdenados(t);
  const temBuraco = t.quartos.some((q) => !/^\d+$/.test(String(q.numero))) ||
    [...t.quartos].map((q) => Number(q.numero)).sort((a, b) => a - b).some((n, i) => n !== i + 1);

  async function salvarNome() {
    if (!nome.trim()) { avisar("Informe o nome do hotel.", "erro"); return; }
    setSalvando(true);
    try { await db.renomearHotel(expId, ids, nome); setModo(null); avisar("Hotel renomeado"); depois(); }
    catch (e) { avisar(`Erro ao renomear: ${erroDe(e)}`, "erro"); } finally { setSalvando(false); }
  }
  async function salvarDatas() {
    if (ci && co && co < ci) { avisar("O check-out não pode ser antes do check-in.", "erro"); return; }
    setSalvando(true);
    try { await db.redatarHotel(expId, ids, ci, co); setModo(null); avisar("Datas do hotel atualizadas"); depois(); }
    catch (e) { avisar(`Erro ao atualizar datas: ${erroDe(e)}`, "erro"); } finally { setSalvando(false); }
  }
  async function renumerar() {
    try { const n = await db.renumerarHotel(expId, ids); avisar(n ? `Quartos renumerados (${n} mudaram)` : "A numeração já estava em ordem"); depois(); }
    catch (e) { avisar(`Erro ao renumerar: ${erroDe(e)}`, "erro"); }
  }
  const teclas = (salvar: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); salvar(); }
    if (e.key === "Escape") setModo(null);
  };

  return (
    <section className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
      <header className="flex items-center justify-between gap-2 px-3 py-2 flex-wrap" style={{ background: "var(--card2)", borderBottom: recolhido ? undefined : "1px solid var(--line)" }}>
        {modo === "nome" ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span style={{ color: "var(--ink3)" }}><Ic d={I.predio} t={16} /></span>
            <input autoFocus className="rel-input" style={{ padding: "4px 8px", maxWidth: 360 }} value={nome} disabled={salvando}
              placeholder="Nome do hotel" onChange={(e) => setNome(e.target.value)} onKeyDown={teclas(salvarNome)} />
            <Botao variante="primario" className="!px-2.5 !py-1 !text-[12px]" disabled={salvando} onClick={salvarNome}>{salvando ? "Salvando…" : "Salvar"}</Botao>
            <Botao className="!px-2.5 !py-1 !text-[12px]" disabled={salvando} onClick={() => setModo(null)}>Cancelar</Botao>
          </div>
        ) : modo === "datas" ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span style={{ color: "var(--ink3)" }}><Ic d={I.cal} t={16} /></span>
            <label className="flex items-center gap-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>
              Check-in <input type="date" autoFocus className="rel-input" style={{ padding: "4px 8px" }} value={ci} disabled={salvando} onChange={(e) => setCi(e.target.value)} onKeyDown={teclas(salvarDatas)} />
            </label>
            <label className="flex items-center gap-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>
              Check-out <input type="date" className="rel-input" style={{ padding: "4px 8px" }} value={co} min={ci || undefined} disabled={salvando} onChange={(e) => setCo(e.target.value)} onKeyDown={teclas(salvarDatas)} />
            </label>
            <Botao variante="primario" className="!px-2.5 !py-1 !text-[12px]" disabled={salvando} onClick={salvarDatas}>{salvando ? "Salvando…" : "Salvar"}</Botao>
            <Botao className="!px-2.5 !py-1 !text-[12px]" disabled={salvando} onClick={() => setModo(null)}>Cancelar</Botao>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <button type="button" onClick={onAlternar} aria-expanded={!recolhido} title={recolhido ? "Expandir hotel" : "Recolher hotel"}
              className="flex items-center gap-2 min-w-0 text-left rounded-md px-1 py-0.5 -mx-1 hover:bg-[var(--card)]">
              <span style={{ color: "var(--ink3)" }}><Ic d={recolhido ? I.direita : I.abaixo} t={16} /></span>
              <span style={{ color: "var(--ink3)" }}><Ic d={I.predio} /></span>
              <span className="font-bold text-[13px] truncate" style={{ color: "var(--ink)" }}>{t.hotel_cidade ?? "Hotel"}</span>
              <span className="text-[11.5px] whitespace-nowrap" style={{ color: "var(--ink3)" }}>
                {t.check_in ? formatDate(t.check_in) : "?"} → {t.check_out ? formatDate(t.check_out) : "?"}
              </span>
              {recolhido && <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>· {t.quartos.length} quarto(s)</span>}
              {grupo && <SeloGrupo g={grupo} titulo={grupo === "misto" ? "Hotel com pax dos dois grupos" : `Hotel do ${grupo === "G1" ? "Grupo 1" : "Grupo 2"}`} />}
              {t.extensao_id && (
                <span title="Hotel de extensão — só quem contratou entra na alocação" className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold flex-shrink-0" style={{ background: "#EDE9FE", color: "#5B21B6" }}>
                  <Ic d={I.rota} t={10} />{r.nomeExtensao.get(t.extensao_id) ?? "Extensão"}
                </span>
              )}
            </button>
            {!somenteLeitura && (
              <>
                <BotaoIcone titulo="Renomear hotel" onClick={() => { setNome(t.hotel_cidade ?? ""); setModo("nome"); }}><Ic d={I.lapis} /></BotaoIcone>
                <BotaoIcone titulo="Editar datas (check-in / check-out)" onClick={() => { setCi((t.check_in ?? "").slice(0, 10)); setCo((t.check_out ?? "").slice(0, 10)); setModo("datas"); }}><Ic d={I.cal} /></BotaoIcone>
              </>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Selo tom={sem.length === 0 ? "ok" : "aviso"}>{relevantes - sem.length}/{relevantes} alocados</Selo>
          {!somenteLeitura && (
            <>
              <BotaoPequeno onClick={onAdicionar} titulo="Adicionar quartos a este hotel (mesmas datas)"><Ic d={I.mais} t={12} /> Adicionar quarto</BotaoPequeno>
              <BotaoPequeno onClick={() => onDuplicar({ quartoIds: ids, hotelOrigem: t.hotel_cidade })} titulo="Duplicar todos os quartos deste hotel (com os mesmos pax) para outro hotel">
                <Ic d={I.copiar} t={12} /> Duplicar hotel
              </BotaoPequeno>
              {temBuraco && (
                <BotaoPequeno onClick={() => void renumerar()} titulo="Deixa os números 1, 2, 3… sem buracos, mantendo a ordem atual dos quartos">
                  <Ic d={I.ordem} t={12} /> Renumerar
                </BotaoPequeno>
              )}
            </>
          )}
          <BotaoExcluir icone={false} rotulo="Excluir hotel" titulo={`Excluir a reserva de "${t.hotel_cidade ?? "Hotel"}"?`}
            descricao={`Serão excluídos os ${t.quartos.length} quarto(s) deste hotel e todas as alocações de passageiros neles. Esta ação não pode ser desfeita.`}
            sucesso="Reserva do hotel excluída" onConfirmar={async () => { await db.excluirQuartos(expId, ids); depois(); }} />
        </div>
      </header>

      {!recolhido && (
        <>
          {r.conexoes.length > 0 && (
            <div className="px-3 py-2 space-y-1" style={{ borderBottom: "1px solid var(--line)" }}>
              {r.conexoes.map((c) => {
                const membros = t.extensao_id ? c.membros.filter((m) => r.paxRelevantes(t).some((p) => p.id === m.id)) : c.membros;
                if (membros.length < 2) return null;
                const st = r.conexaoNoTrecho(membros, t);
                const ancora = st.quartoAncora ? r.quartoById.get(st.quartoAncora)?.numero : null;
                return (
                  <div key={c.id} className="flex items-center gap-2 text-[11.5px] flex-wrap">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.cor }} />
                    <span className="truncate" style={{ color: "var(--ink2)" }}>{membros.map((m) => primeiroNome(m.nome_completo)).join(" + ")}</span>
                    {st.juntos ? <Selo tom="ok">juntos{ancora ? ` · Quarto ${ancora}` : ""}</Selo>
                      : st.porQuarto.size === 0 ? <span style={{ color: "var(--ink3)" }}>a alocar</span>
                        : (
                          <>
                            {st.porQuarto.size > 1 ? <Selo tom="erro">separados</Selo> : <Selo tom="aviso">incompleto</Selo>}
                            {st.quartoAncora && !somenteLeitura && (
                              <button type="button" onClick={() => onJuntar(membros, st.quartoAncora!)} className="font-semibold hover:underline" style={{ color: "var(--rel-ink)" }}>
                                Juntar no Quarto {ancora}
                              </button>
                            )}
                          </>
                        )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3">
            <ZonaSoltar id={`sem::${t.key}`} estilo={{ border: "1px solid var(--line)", background: "var(--card2)" }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Sem quarto</h3>
                <Selo tom={sem.length === 0 ? "ok" : "aviso"}>{sem.length}</Selo>
              </div>
              <div className="space-y-1.5 min-h-[40px]">
                {sem.length === 0
                  ? <p className="text-[11.5px] py-2" style={{ color: "var(--ink3)" }}>Todos alocados neste hotel 👌</p>
                  : sem.map((p) => <CartaoPax key={p.id} p={p} trechoKey={t.key} conexao={r.conexaoByPax.get(p.id)} grupo={r.grupoDoPax(p)} />)}
              </div>
            </ZonaSoltar>

            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {quartos.map((q) => (
                <CartaoQuarto key={q.id} q={q} t={t} r={r} expId={expId} onEditar={() => onEditarQuarto(q.id)}
                  onDuplicar={() => onDuplicar({ quartoIds: [q.id], hotelOrigem: q.hotel_cidade })} depois={depois} />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CartaoQuarto({ q, t, r, expId, onEditar, onDuplicar, depois }: {
  q: QuartoRow; t: Trecho; r: R; expId: string; onEditar: () => void; onDuplicar: () => void; depois: () => void;
}) {
  const { somenteLeitura } = useExp();
  const ocup = r.ocupantesPorQuarto.get(q.id) ?? [];
  const cap = capacidade(q.tipo);
  const cancelado = quartoCancelado(q);
  const g = r.grupoDoQuarto(q);
  const tomOcup = ocup.length >= cap ? "ok" : ocup.length > 0 ? "aviso" : "neutro";
  return (
    <ZonaSoltar id={q.id} desligada={cancelado} estilo={{ border: "1px solid var(--line)", background: "var(--card)", opacity: cancelado ? 0.6 : 1 }}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="font-bold text-[13px] truncate" style={{ color: "var(--ink)" }}>Quarto {q.numero}</span>
          <Selo tom="lista">{q.tipo}</Selo>
          {g && <SeloGrupo g={g as Grupo} titulo={g === "G1" ? "Quarto do Grupo 1" : "Quarto do Grupo 2"} />}
          {cancelado && <Selo tom="erro">cancelado</Selo>}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Selo tom={tomOcup}>{ocup.length}/{cap}</Selo>
          {!somenteLeitura && <BotaoIcone titulo="Editar quarto" onClick={onEditar}><Ic d={I.lapis} /></BotaoIcone>}
          {!somenteLeitura && <BotaoIcone titulo="Duplicar este quarto (com os mesmos pax) para outro hotel" onClick={onDuplicar}><Ic d={I.copiar} /></BotaoIcone>}
          <BotaoExcluir titulo={`Excluir quarto ${q.numero}?`} rotulo="Excluir quarto"
            descricao={ocup.length > 0 ? `Há ${ocup.length} passageiro(s) alocado(s). Eles serão desvinculados deste quarto.` : "Esta ação não pode ser desfeita."}
            sucesso="Quarto excluído" onConfirmar={async () => { await db.excluirQuartos(expId, [q.id]); depois(); }} />
        </div>
      </div>
      {q.observacoes && <p className="text-[11px] mb-1.5 italic" style={{ color: "var(--ink3)" }}>{q.observacoes}</p>}
      <div className="space-y-1.5 min-h-[40px]">
        {ocup.length === 0 ? (
          <p className="text-[11.5px] italic py-2" style={{ color: "var(--ink3)" }}>{cancelado ? "Quarto cancelado — não recebe passageiros" : somenteLeitura ? "Vazio" : "Arraste passageiros aqui"}</p>
        ) : ocup.map((id) => {
          const p = r.paxById.get(id);
          return p ? <CartaoPax key={id} p={p} trechoKey={t.key} conexao={r.conexaoByPax.get(p.id)} grupo={r.grupoDoPax(p)} /> : null;
        })}
      </div>
    </ZonaSoltar>
  );
}

function ZonaSoltar({ id, estilo, desligada, children }: { id: string; estilo: React.CSSProperties; desligada?: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: desligada });
  return (
    <div ref={setNodeRef} className="rounded-lg p-3"
      style={{ ...estilo, ...(isOver ? { outline: "2px solid var(--rel)", outlineOffset: 1 } : null) }}>
      {children}
    </div>
  );
}

function CartaoPax({ p, trechoKey, conexao, grupo }: { p: PassageiroRow; trechoKey: string; conexao?: { cor: string; companheiros: string }; grupo: Grupo | null }) {
  const { somenteLeitura } = useExp();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${trechoKey}::${p.id}`, disabled: somenteLeitura });
  const style: React.CSSProperties = {
    border: "1px solid var(--line)", background: "var(--card)",
    ...(transform ? { transform: CSS.Translate.toString(transform), zIndex: 50, position: "relative" } : null),
    ...(isDragging ? { opacity: 0.6, boxShadow: "0 8px 20px rgba(0,0,0,.15)" } : null),
  };
  return (
    <div ref={setNodeRef} style={style} {...(somenteLeitura ? {} : listeners)} {...(somenteLeitura ? {} : attributes)}
      className={`flex items-center gap-2 rounded-lg p-2 select-none ${somenteLeitura ? "cursor-default" : "cursor-grab active:cursor-grabbing touch-none"}`}>
      {!somenteLeitura && <span style={{ color: "var(--ink3)" }}><Ic d={I.arrastar} t={13} /></span>}
      {conexao && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: conexao.cor }} title={`Viaja com: ${conexao.companheiros}`} />}
      <Avatar nome={p.nome_completo} tamanho={22} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold truncate" style={{ color: "var(--ink)" }}>{p.nome_completo}</div>
        <div className="text-[10.5px]" style={{ color: "var(--ink3)" }}>{p.tipo}</div>
      </div>
      {grupo && <SeloGrupo g={grupo} titulo={grupo === "G1" ? "Grupo 1" : "Grupo 2"} />}
    </div>
  );
}
