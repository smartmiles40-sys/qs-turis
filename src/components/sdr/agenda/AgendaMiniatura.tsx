// src/components/sdr/agenda/AgendaMiniatura.tsx
// -----------------------------------------------------------------------------
// A AGENDA DO ESPECIALISTA, DENTRO DO MODAL DE GANHO.
//
// O problema que ela resolve: o SDR fechava o ganho, escolhia o responsável e
// então tinha que SAIR pra conferir a agenda dele — noutra aba, noutro sistema —
// pra saber que horário oferecer. Na prática ninguém conferia: chutava um
// horário, e o choque aparecia depois (ou nunca, porque não havia trava).
//
// Aqui o dia do especialista aparece na hora, e o horário livre é CLICÁVEL: um
// clique preenche a data/hora do formulário. O SDR para de digitar horário e
// para de errar agenda.
//
// Reaproveita o `computeDaySlots` (regra pura já usada pelo SlotPicker): janela
// de atendimento − reuniões − bloqueios − antecedência mínima. Uma regra só pro
// sistema inteiro; se mudar lá, muda aqui.
//
// Degrada com elegância, e isso importa: sem especialista escolhido, sem
// cadastro de closer ou sem janela configurada, ela some ou explica o motivo —
// nunca impede o SDR de agendar na mão.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCloserConfigs,
  fetchAvailability,
  fetchBlocks,
  fetchMeetingsInRange,
  findUserIdByName,
  computeDaySlots,
  configFor,
  startOfDay,
  addDays,
  type Slot,
} from "@/lib/qs/closerAgenda";
import type { CloserAvailability, CloserBlock, CloserConfig, Meeting } from "../types";

interface Props {
  /** Nome escolhido no select "Responsável pela reunião". */
  responsavel: string;
  /** Dia mostrado (vem do campo de data/hora do formulário). */
  dia: Date;
  /** Clique num horário livre — devolve o início escolhido. */
  onEscolher: (inicio: Date) => void;
  /** Horário já escolhido no formulário, pra destacar. */
  selecionado?: Date | null;
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function diaLongo(d: Date): string {
  const s = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AgendaMiniatura({ responsavel, dia, onEscolher, selecionado }: Props) {
  const [closerId, setCloserId] = useState<string | null>(null);
  const [resolvendo, setResolvendo] = useState(false);
  const [configs, setConfigs] = useState<CloserConfig[]>([]);
  const [availability, setAvailability] = useState<CloserAvailability[]>([]);
  const [blocks, setBlocks] = useState<CloserBlock[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  // Só a PRIMEIRA carga mostra texto de carregamento (ver o efeito abaixo).
  const [carregando, setCarregando] = useState(true);

  // O select do Ganho guarda o NOME (a "Equipe da Reunião" é texto), então o
  // primeiro passo é descobrir de qual usuário se trata. Nome que não casa com
  // ninguém cadastrado = sem agenda pra mostrar, e tudo bem.
  useEffect(() => {
    let vivo = true;
    if (!responsavel.trim()) { setCloserId(null); return; }
    setResolvendo(true);
    void findUserIdByName(responsavel).then((id) => {
      if (!vivo) return;
      setCloserId(id);
      setResolvendo(false);
    });
    return () => { vivo = false; };
  }, [responsavel]);

  // ── Por que NÚMERO e não Date ──────────────────────────────────────────────
  // O pai monta `dia={new Date(...)}` no JSX, ou seja: OBJETO NOVO a cada render
  // dele — e ele re-renderiza a cada tecla digitada no formulário do Ganho. Com
  // o Date na lista de dependências, cada tecla invalidava o useMemo, que
  // invalidava o useCallback, que disparava o efeito: uma recarga completa (4
  // consultas) POR TECLA. Medido: 50 requisições em 6 segundos.
  //
  // O sintoma pro SDR era a tela piscando e o horário fugindo do clique, porque
  // a lista era substituída por "Carregando…" a cada letra.
  //
  // O timestamp é um número: só muda quando o DIA muda de verdade.
  const diaMs = startOfDay(dia).getTime();
  const diaBase = useMemo(() => new Date(diaMs), [diaMs]);

  const carregar = useCallback(async () => {
    if (!closerId) {
      // Nome que não casa com usuário do QS: não há o que carregar, e o estado
      // PRECISA sair de "carregando" — senão a caixa fica presa no texto de
      // carregamento em vez de explicar que o responsável não está cadastrado.
      setCarregando(false);
      return;
    }
    const de = new Date(diaMs);
    const ate = addDays(de, 1);
    const [cfg, av, bl, mt] = await Promise.all([
      fetchCloserConfigs(),
      fetchAvailability(),
      fetchBlocks(de, ate),
      fetchMeetingsInRange(de, ate),
    ]);
    setConfigs(cfg);
    setAvailability(av);
    setBlocks(bl);
    setMeetings(mt);
    setCarregando(false);
  }, [closerId, diaMs]);

  useEffect(() => {
    // "Carregando" só na PRIMEIRA vez. Numa recarga (trocou o dia ou o
    // especialista), a lista antiga fica na tela até a nova chegar — trocar por
    // um texto de carregamento faz a tela saltar e o alvo do clique sumir
    // debaixo do dedo.
    void carregar();
  }, [carregar]);

  const slots: Slot[] = useMemo(() => {
    if (!closerId) return [];
    return computeDaySlots(
      { closerId, config: configFor(closerId, configs), availability, blocks, meetings },
      diaBase
    );
  }, [closerId, configs, availability, blocks, meetings, diaBase]);

  if (!responsavel.trim()) return null;

  const moldura = "mt-2 rounded-xl border p-2.5";
  const estiloMoldura = { borderColor: "var(--line)", background: "var(--card2)" };

  if ((resolvendo || carregando) && slots.length === 0) {
    return (
      <div className={moldura} style={estiloMoldura}>
        <p className="text-xs text-gray-400">Carregando a agenda de {responsavel}…</p>
      </div>
    );
  }

  if (!closerId) {
    return (
      <div className={moldura} style={estiloMoldura}>
        <p className="text-xs text-gray-400">
          <b>{responsavel}</b> não está cadastrado como usuário do QS, então não dá pra mostrar a
          agenda dele. Preencha a data e hora na mão.
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className={moldura} style={estiloMoldura}>
        <p className="text-xs text-gray-400">
          <b>{responsavel}</b> não tem horário de atendimento configurado para {diaLongo(diaBase)}.
          Configure em <b>Configurações → Agenda dos Closers</b>, ou preencha a data e hora na mão.
        </p>
      </div>
    );
  }

  const selMs = selecionado ? selecionado.getTime() : null;

  return (
    <div className={moldura} style={estiloMoldura}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold" style={{ color: "var(--ink2)" }}>
          Agenda de {responsavel.split(" ")[0]} · {diaLongo(diaBase)}
        </p>
        <span className="text-[11px] text-gray-400">
          {slots.filter((s) => s.available).length} horário(s) livre(s)
        </span>
      </div>

      {/* Rolagem: um dia cheio tem 10+ faixas e o modal não pode virar uma página. */}
      <div className="mt-2 max-h-[168px] space-y-1 overflow-y-auto pr-0.5">
        {slots.map((s) => {
          const ocupado = !s.available;
          const escolhido = selMs !== null && s.start.getTime() === selMs;
          const rotulo = ocupado
            ? s.reason === "ocupado"
              ? s.meeting?.lead_name ?? s.meeting?.lead?.full_name ?? "Reunião"
              : s.reason === "bloqueio"
                ? s.block?.reason ?? "Bloqueado"
                : s.reason === "antecedencia"
                  ? "cedo demais"
                  : s.reason === "passado"
                    ? "já passou"
                    : "indisponível"
            : "livre";

          return (
            <button
              key={s.start.toISOString()}
              type="button"
              disabled={ocupado}
              onClick={() => onEscolher(s.start)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                ocupado ? "cursor-default" : "hover:brightness-95"
              }`}
              style={{
                borderColor: escolhido ? "var(--green)" : ocupado ? "transparent" : "var(--line)",
                background: escolhido
                  ? "rgba(18,161,138,.14)"
                  : ocupado
                    ? "var(--line2)"
                    : "var(--card)",
                color: ocupado ? "var(--ink3)" : "var(--ink)",
              }}
            >
              <span className="w-11 shrink-0 font-bold tabular-nums">{hhmm(s.start)}</span>
              <span className={`truncate ${ocupado ? "" : "font-semibold"}`}>{rotulo}</span>
              {escolhido && (
                <span className="ml-auto shrink-0 text-[10px] font-bold" style={{ color: "var(--green)" }}>
                  escolhido
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-1.5 text-[11px] text-gray-400">
        Clique num horário livre para preencher a data e a hora.
      </p>
    </div>
  );
}
