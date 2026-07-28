// src/components/sdr/settings/CloserAgendaSettings.tsx
// -----------------------------------------------------------------------------
// Configurações → AGENDA DOS CLOSERS. É aqui que se define o que a aba "Agenda"
// oferece como horário livre:
//
//   • Janelas de atendimento da semana (almoço = duas janelas no mesmo dia)
//   • Parâmetros: duração do slot, intervalo entre reuniões, antecedência
//     mínima, teto por dia, cor no calendário e link fixo de sala
//   • Bloqueios pontuais: férias, feriado, compromisso — somem da grade
//
// Sem esta tela a agenda roda só com a semente da migration 0027 (seg–sex,
// 09:00–12:00 e 13:30–18:00, 60 min, 2h de antecedência) e não haveria como
// lançar férias pela interface.
//
// Permissão: gestor/admin mexem em qualquer closer; o closer mexe só na dele.
// A RLS da 0027 é quem manda — a tela só evita a tentativa inútil.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  CLOSER_COLORS,
  configFor,
  createBlock,
  deleteBlock,
  fetchAvailability,
  fetchBlocks,
  fetchClosers,
  fetchCloserConfigs,
  saveAvailability,
  saveCloserConfig,
} from "@/lib/qs/closerAgenda";
import type { CloserBlock, CloserConfig, SdrUser } from "../types";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const inputClass =
  "px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700 focus:outline-none focus:border-blue-400";

/** Janela na tela: "HH:MM" (o banco guarda "HH:MM:SS"). */
interface Window {
  weekday: number;
  start: string;
  end: string;
}

function toHHMM(hms: string): string {
  return (hms || "").slice(0, 5);
}

/** Fim do dia local em ISO — bloqueio de "dia inteiro" cobre até 23:59:59. */
function endOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}

function startOfDayLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function formatBlock(b: CloserBlock): string {
  const s = new Date(b.starts_at);
  const e = new Date(b.ends_at);
  const dia = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const hora = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return dia(s) === dia(e) ? `${dia(s)} · ${hora(s)}–${hora(e)}` : `${dia(s)} ${hora(s)} → ${dia(e)} ${hora(e)}`;
}

export default function CloserAgendaSettings() {
  const { currentUser } = useQsAuth();
  const isManager = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [closerId, setCloserId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [config, setConfig] = useState<CloserConfig | null>(null);
  const [windows, setWindows] = useState<Window[]>([]);
  const [blocks, setBlocks] = useState<CloserBlock[]>([]);

  const [savingConfig, setSavingConfig] = useState(false);
  const [savingWindows, setSavingWindows] = useState(false);

  // Novo bloqueio
  const [blockFrom, setBlockFrom] = useState("");
  const [blockTo, setBlockTo] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);

  // Um closer só enxerga a própria agenda aqui; o gestor escolhe na lista.
  const editable = isManager || closerId === currentUser?.id;

  useEffect(() => {
    void (async () => {
      const list = await fetchClosers();
      setClosers(list);
      const inicial =
        currentUser?.role === "closer" && currentUser.id ? currentUser.id : list[0]?.id ?? "";
      setCloserId(inicial);
      if (!inicial) setLoading(false);
    })();
    // currentUser só muda no login — carregar a lista uma vez basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    const hoje = new Date();
    const daqui180 = new Date(hoje.getTime() + 180 * 86_400_000);
    const [configs, avail, blks] = await Promise.all([
      fetchCloserConfigs(),
      fetchAvailability([id]),
      fetchBlocks(hoje, daqui180, [id]),
    ]);
    setConfig(configFor(id, configs));
    setWindows(
      avail
        .filter((a) => a.closer_id === id)
        .map((a) => ({ weekday: a.weekday, start: toHHMM(a.start_time), end: toHHMM(a.end_time) }))
    );
    setBlocks(blks);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (closerId) void load(closerId);
  }, [closerId, load]);

  const porDia = useMemo(() => {
    const mapa: Record<number, Window[]> = {};
    for (let d = 0; d < 7; d++) mapa[d] = windows.filter((w) => w.weekday === d);
    return mapa;
  }, [windows]);

  function addWindow(weekday: number) {
    const existentes = porDia[weekday];
    const nova: Window =
      existentes.length === 0
        ? { weekday, start: "09:00", end: "12:00" }
        : { weekday, start: "13:30", end: "18:00" };
    setWindows((prev) => [...prev, nova]);
  }

  function updateWindow(index: number, patch: Partial<Window>) {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function removeWindow(index: number) {
    setWindows((prev) => prev.filter((_, i) => i !== index));
  }

  /** Copia a grade de um dia útil pros outros dias úteis (seg–sex). */
  function replicarDiasUteis(origem: number) {
    const modelo = porDia[origem];
    if (!modelo.length) {
      notifyError("Esse dia está sem janela para copiar.");
      return;
    }
    setWindows((prev) => [
      ...prev.filter((w) => w.weekday === 0 || w.weekday === 6 || w.weekday === origem),
      ...[1, 2, 3, 4, 5]
        .filter((d) => d !== origem)
        .flatMap((d) => modelo.map((w) => ({ ...w, weekday: d }))),
    ]);
  }

  async function handleSaveWindows() {
    // Janela invertida ou zerada trava o cálculo de slots — barra antes de gravar.
    const invalida = windows.find((w) => !w.start || !w.end || w.end <= w.start);
    if (invalida) {
      notifyError(`${WEEKDAYS[invalida.weekday]}: o fim precisa ser depois do início.`);
      return;
    }
    setSavingWindows(true);
    const res = await saveAvailability(
      closerId,
      windows.map((w) => ({ weekday: w.weekday, start_time: `${w.start}:00`, end_time: `${w.end}:00` }))
    );
    setSavingWindows(false);
    if (!res.ok) {
      notifyError(res.error ?? "Não foi possível salvar os horários.");
      return;
    }
    notifySuccess("Horários de atendimento salvos.");
    void load(closerId);
  }

  async function handleSaveConfig() {
    if (!config) return;
    setSavingConfig(true);
    const res = await saveCloserConfig(config);
    setSavingConfig(false);
    if (!res.ok) {
      notifyError(res.error ?? "Não foi possível salvar a configuração.");
      return;
    }
    notifySuccess("Configuração do closer salva.");
  }

  async function handleAddBlock() {
    if (!blockFrom || !blockTo) {
      notifyError("Informe o começo e o fim do bloqueio.");
      return;
    }
    const inicio = startOfDayLocal(blockFrom);
    const fim = endOfDay(blockTo);
    if (fim <= inicio) {
      notifyError("O fim do bloqueio precisa ser depois do começo.");
      return;
    }
    setSavingBlock(true);
    const res = await createBlock(closerId, inicio, fim, blockReason.trim() || null, currentUser?.id ?? null);
    setSavingBlock(false);
    if (!res.ok) {
      notifyError(res.error ?? "Não foi possível criar o bloqueio.");
      return;
    }
    setBlockFrom("");
    setBlockTo("");
    setBlockReason("");
    notifySuccess("Bloqueio criado — esses horários somem da agenda.");
    void load(closerId);
  }

  async function handleDeleteBlock(id: string) {
    const res = await deleteBlock(id);
    if (!res.ok) {
      notifyError(res.error ?? "Não foi possível remover o bloqueio.");
      return;
    }
    void load(closerId);
  }

  if (!closers.length && !loading) {
    return (
      <div className="max-w-3xl space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Agenda dos Closers</h2>
          <p className="text-sm text-gray-500 mt-1">Horários de atendimento, bloqueios e regras de agendamento.</p>
        </div>
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <p className="text-sm font-semibold text-gray-700">Nenhum closer ativo cadastrado.</p>
          <p className="text-sm text-gray-500 mt-1">
            Crie os closers em <b>Usuários e Permissões</b> (papel <b>Closer</b>) — a agenda é organizada por eles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Agenda dos Closers</h2>
        <p className="text-sm text-gray-500 mt-1">
          Define o que a aba <b>Agenda</b> oferece como horário livre pro SDR. O que estiver fora
          das janelas, ocupado ou bloqueado simplesmente não aparece como opção.
        </p>
      </div>

      {/* Closer */}
      <div className="rounded-xl border border-gray-200 p-4">
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Closer</label>
        <select
          value={closerId}
          onChange={(e) => setCloserId(e.target.value)}
          disabled={!isManager}
          className={`${inputClass} w-full disabled:opacity-60`}
        >
          {closers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {!isManager && (
          <p className="mt-1.5 text-[11px] text-gray-400">
            Você só edita a sua própria agenda. Para mexer na de outro closer, fale com o gestor.
          </p>
        )}
      </div>

      {loading || !config ? (
        <p className="text-sm text-gray-400">Carregando…</p>
      ) : (
        <>
          {/* Parâmetros */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-gray-800">Regras de agendamento</h3>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={config.is_bookable}
                  onChange={(e) => setConfig({ ...config, is_bookable: e.target.checked })}
                  disabled={!editable}
                />
                Aceita agendamento
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Duração (min)</label>
                <input
                  type="number" min={5} max={480} step={5}
                  value={config.slot_minutes}
                  onChange={(e) => setConfig({ ...config, slot_minutes: Number(e.target.value) || 60 })}
                  disabled={!editable}
                  className={`${inputClass} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Intervalo (min)</label>
                <input
                  type="number" min={0} max={240} step={5}
                  value={config.buffer_minutes}
                  onChange={(e) => setConfig({ ...config, buffer_minutes: Number(e.target.value) || 0 })}
                  disabled={!editable}
                  className={`${inputClass} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Antecedência (min)</label>
                <input
                  type="number" min={0} step={30}
                  value={config.min_notice_minutes}
                  onChange={(e) => setConfig({ ...config, min_notice_minutes: Number(e.target.value) || 0 })}
                  disabled={!editable}
                  className={`${inputClass} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Teto por dia</label>
                <input
                  type="number" min={1}
                  value={config.max_per_day ?? ""}
                  placeholder="sem teto"
                  onChange={(e) =>
                    setConfig({ ...config, max_per_day: e.target.value ? Number(e.target.value) : null })
                  }
                  disabled={!editable}
                  className={`${inputClass} w-full`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Link fixo da sala</label>
                <input
                  type="text"
                  value={config.default_link ?? ""}
                  onChange={(e) => setConfig({ ...config, default_link: e.target.value || null })}
                  placeholder="https://meet.google.com/..."
                  disabled={!editable}
                  className={`${inputClass} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Cor no calendário</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {CLOSER_COLORS.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      onClick={() => editable && setConfig({ ...config, color: cor })}
                      title={cor}
                      className={`w-7 h-7 rounded-full border-2 transition ${
                        config.color === cor ? "border-gray-800 scale-110" : "border-transparent"
                      }`}
                      style={{ background: cor }}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => editable && setConfig({ ...config, color: null })}
                    className="text-[11px] text-gray-500 hover:underline ml-1"
                  >
                    automática
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-gray-400">
              <b>Intervalo</b> é o respiro entre uma reunião e a seguinte. <b>Antecedência</b> é o quanto
              antes o SDR precisa agendar (120 = ninguém marca pra daqui a 1h).
            </p>

            <button
              onClick={handleSaveConfig}
              disabled={savingConfig || !editable}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#2563EB" }}
            >
              {savingConfig ? "Salvando..." : "Salvar regras"}
            </button>
          </div>

          {/* Janelas da semana */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-800">Horário de atendimento</h3>
            <p className="text-[11px] text-gray-400 -mt-1">
              Intervalo de almoço não é um campo: são duas janelas no mesmo dia (ex.: 09:00–12:00 e 13:30–18:00).
            </p>

            <div className="space-y-2">
              {WEEKDAYS.map((nome, dia) => (
                <div key={dia} className="flex items-start gap-3 py-1.5 border-b border-gray-50 last:border-0">
                  <span className="w-20 shrink-0 text-sm font-medium text-gray-700 pt-2">{nome}</span>
                  <div className="flex-1 space-y-1.5">
                    {porDia[dia].length === 0 && (
                      <span className="text-xs text-gray-400 inline-block pt-2">Não atende</span>
                    )}
                    {porDia[dia].map((w) => {
                      const index = windows.indexOf(w);
                      return (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={w.start}
                            onChange={(e) => updateWindow(index, { start: e.target.value })}
                            disabled={!editable}
                            className={inputClass}
                          />
                          <span className="text-gray-400 text-sm">até</span>
                          <input
                            type="time"
                            value={w.end}
                            onChange={(e) => updateWindow(index, { end: e.target.value })}
                            disabled={!editable}
                            className={inputClass}
                          />
                          <button
                            type="button"
                            onClick={() => removeWindow(index)}
                            disabled={!editable}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                            title="Remover janela"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-col items-end gap-1 pt-1.5">
                    <button
                      type="button"
                      onClick={() => addWindow(dia)}
                      disabled={!editable}
                      className="text-[11px] font-semibold text-[#0147FF] hover:underline disabled:opacity-40"
                    >
                      + janela
                    </button>
                    {dia >= 1 && dia <= 5 && porDia[dia].length > 0 && (
                      <button
                        type="button"
                        onClick={() => replicarDiasUteis(dia)}
                        disabled={!editable}
                        className="text-[11px] text-gray-400 hover:text-gray-600 hover:underline disabled:opacity-40"
                        title="Copiar este dia para segunda a sexta"
                      >
                        aplicar seg–sex
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSaveWindows}
              disabled={savingWindows || !editable}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#2563EB" }}
            >
              {savingWindows ? "Salvando..." : "Salvar horários"}
            </button>
          </div>

          {/* Bloqueios */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-800">Bloqueios (férias, feriado, compromisso)</h3>
            <p className="text-[11px] text-gray-400 -mt-1">
              O período bloqueado some dos horários livres. Reuniões <b>já marcadas</b> continuam de pé —
              bloquear não cancela nada; remarque pela agenda se precisar.
            </p>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">De</label>
                <input type="date" value={blockFrom} onChange={(e) => setBlockFrom(e.target.value)} disabled={!editable} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Até</label>
                <input type="date" value={blockTo} onChange={(e) => setBlockTo(e.target.value)} disabled={!editable} className={inputClass} />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Motivo</label>
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Férias, feriado, treinamento..."
                  disabled={!editable}
                  className={`${inputClass} w-full`}
                />
              </div>
              <button
                onClick={handleAddBlock}
                disabled={savingBlock || !editable}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#2563EB" }}
              >
                {savingBlock ? "Salvando..." : "Bloquear"}
              </button>
            </div>

            {blocks.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhum bloqueio nos próximos 6 meses.</p>
            ) : (
              <div className="space-y-1.5">
                {blocks.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{formatBlock(b)}</p>
                      {b.reason && <p className="text-xs text-gray-500 truncate">{b.reason}</p>}
                    </div>
                    <button
                      onClick={() => handleDeleteBlock(b.id)}
                      disabled={!editable}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 shrink-0"
                      title="Remover bloqueio"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
