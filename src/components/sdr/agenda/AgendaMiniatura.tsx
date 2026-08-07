// src/components/sdr/agenda/AgendaMiniatura.tsx
// -----------------------------------------------------------------------------
// A AGENDA DO ESPECIALISTA, DENTRO DO MODAL DE GANHO.
//
// O problema que ela resolve: o SDR fechava o ganho, escolhia o responsável e
// então tinha que SAIR pra conferir a agenda dele — noutra aba, noutro sistema —
// pra saber que horário oferecer. Na prática ninguém conferia: chutava um
// horário, e o choque aparecia depois (ou nunca, porque não havia trava).
//
// ── Por que SEMANA e não um dia ──────────────────────────────────────────────
// A primeira versão mostrava um dia só: o dia que estivesse no campo de data do
// formulário. Isso responde "o dia X está livre?" — mas na ligação a pergunta é
// outra: "quais horários eu tenho pra OFERECER?". Pra ver quinta, o SDR tinha
// que digitar a data no teclado com o cliente na linha, um dia por vez.
//
// Agora a semana inteira fica à vista com a contagem de livres por dia; clicar
// num dia troca a lista de horários, e clicar num horário preenche o formulário.
// O SDR lê duas ou três opções em voz alta e marca na hora.
//
// Reaproveita `computeDaySlots` (regra pura já usada pelo SlotPicker): janela de
// atendimento − reuniões − bloqueios − antecedência mínima. Uma regra só pro
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
  computeDaySlots,
  configFor,
  startOfDay,
  addDays,
  loadJanelaAgendamento,
  JANELA_AGENDAMENTO_PADRAO,
  type Slot,
  type JanelaAgendamento,
} from "@/lib/qs/closerAgenda";
import type { CloserAvailability, CloserBlock, CloserConfig, Meeting } from "../types";

interface Props {
  /** Nome escolhido no select "Responsável pela reunião" (só exibição). */
  responsavel: string;
  /** ID do closer — vem direto do select do Ganho, que é montado a partir dos
   *  closers reais. (A tradução por nome que existia aqui morreu junto com a
   *  lista de nomes em texto.) */
  closerId: string | null;
  /** Dia do formulário. `null` = campo vazio ou pela metade — a agenda NÃO
   *  salta pra lugar nenhum; fica onde o SDR estava navegando. */
  dia: Date | null;
  /** Clique num horário livre — devolve o início escolhido. */
  onEscolher: (inicio: Date) => void;
  /** Horário já escolhido no formulário, pra destacar. */
  selecionado?: Date | null;
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function diaLongo(d: Date): string {
  const s = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Segunda-feira da semana de `d` (a operação pensa a semana começando na segunda). */
function inicioDaSemana(d: Date): Date {
  const base = startOfDay(d);
  const diff = (base.getDay() + 6) % 7; // domingo (0) vira 6
  return addDays(base, -diff);
}

function rotuloDaSemana(inicio: Date, fim: Date): string {
  const dia = (x: Date) => String(x.getDate()).padStart(2, "0");
  const mes = (x: Date) => x.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return inicio.getMonth() === fim.getMonth()
    ? `${dia(inicio)} a ${dia(fim)} de ${mes(inicio)}`
    : `${dia(inicio)} ${mes(inicio)} a ${dia(fim)} ${mes(fim)}`;
}

export default function AgendaMiniatura({ responsavel, closerId, dia, onEscolher, selecionado }: Props) {
  const [configs, setConfigs] = useState<CloserConfig[]>([]);
  const [availability, setAvailability] = useState<CloserAvailability[]>([]);
  const [blocks, setBlocks] = useState<CloserBlock[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  // Só a PRIMEIRA carga mostra texto de carregamento (ver o efeito abaixo).
  const [carregando, setCarregando] = useState(true);
  // Horário comercial da grade — o mesmo que o SlotPicker usa, para as duas
  // telas de agendamento nunca mostrarem horários diferentes.
  const [janela, setJanela] = useState<JanelaAgendamento>(JANELA_AGENDAMENTO_PADRAO);

  // ── Por que NÚMERO e não Date ──────────────────────────────────────────────
  // O pai monta `dia={new Date(...)}` no JSX, ou seja: OBJETO NOVO a cada render
  // dele — e ele re-renderiza a cada tecla digitada no formulário do Ganho. Com
  // o Date na lista de dependências, cada tecla invalidava o useMemo, que
  // invalidava o useCallback, que disparava o efeito: uma recarga completa (4
  // consultas) POR TECLA. Medido: 50 requisições em 6 segundos.
  //
  // O timestamp é um número: só muda quando o DIA muda de verdade. E quando o
  // campo está vazio/pela metade, `dia` vem null → NaN → a agenda fica parada
  // onde o SDR a deixou, em vez de saltar pra semana de hoje no meio da digitação.
  const diaMs = dia ? startOfDay(dia).getTime() : Number.NaN;

  // Dia aberto na lista de horários. Começa no dia do formulário e passa a ser
  // do usuário assim que ele navega — trocar de dia aqui NÃO mexe no formulário
  // (só o clique num horário mexe), senão navegar já marcaria reunião sem querer.
  const [diaSelMs, setDiaSelMs] = useState(() => (Number.isNaN(diaMs) ? startOfDay(new Date()).getTime() : diaMs));
  useEffect(() => { if (!Number.isNaN(diaMs)) setDiaSelMs(diaMs); }, [diaMs]);

  const diaSel = useMemo(() => new Date(diaSelMs), [diaSelMs]);
  const semanaIni = useMemo(() => inicioDaSemana(new Date(diaSelMs)), [diaSelMs]);
  const semanaIniMs = semanaIni.getTime();

  const carregar = useCallback(async () => {
    // Data pela metade ("2026-08-0") enquanto o SDR digita vira Invalid Date, e
    // `toISOString()` mais abaixo ESTOURA — a promessa era rejeitada em silêncio e
    // a caixa ficava presa no estado anterior. Sai fora e espera a data ficar boa.
    if (Number.isNaN(semanaIniMs)) { setCarregando(false); return; }
    if (!closerId) {
      // Nome que não casa com usuário do QS: não há o que carregar, e o estado
      // PRECISA sair de "carregando" — senão a caixa fica presa no texto de
      // carregamento em vez de explicar que o responsável não está cadastrado.
      setCarregando(false);
      return;
    }
    // A SEMANA inteira numa ida só: a contagem de livres por dia precisa dos
    // compromissos dos 7 dias, e buscar por dia seria 7× mais consultas.
    const de = new Date(semanaIniMs);
    const ate = addDays(de, 7);
    const [cfg, av, bl, mt, jan] = await Promise.all([
      fetchCloserConfigs(),
      fetchAvailability([closerId]),
      fetchBlocks(de, ate, [closerId]),
      fetchMeetingsInRange(de, ate, [closerId]),
      loadJanelaAgendamento(),
    ]);
    setConfigs(cfg);
    setAvailability(av);
    setBlocks(bl);
    setMeetings(mt);
    setJanela(jan);
    setCarregando(false);
  }, [closerId, semanaIniMs]);

  useEffect(() => {
    // "Carregando" só na PRIMEIRA vez. Numa recarga (trocou a semana ou o
    // especialista), a lista antiga fica na tela até a nova chegar — trocar por
    // um texto de carregamento faz a tela saltar e o alvo do clique sumir
    // debaixo do dedo.
    void carregar();
  }, [carregar]);

  const entrada = useMemo(
    () => (closerId ? { closerId, config: configFor(closerId, configs), availability, blocks, meetings } : null),
    [closerId, configs, availability, blocks, meetings]
  );

  // Os 7 dias da semana com a contagem de livres. Dias em que o closer não
  // atende continuam à vista, marcados com "—": some da grade daria a impressão
  // de que a semana é mais curta do que é.
  const semana = useMemo(() => {
    if (!entrada || Number.isNaN(semanaIniMs)) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(new Date(semanaIniMs), i);
      const slots = computeDaySlots(entrada, d, { janela });
      return { dia: d, livres: slots.filter((s) => s.available).length, atende: slots.length > 0 };
    });
  }, [entrada, semanaIniMs, janela]);

  // Fim de semana sem NENHUM atendimento configurado é ruído: se o closer não
  // trabalha sábado nem domingo, esses dois quadradinhos só ocupam espaço.
  const diasVisiveis = useMemo(() => {
    const fds = semana.filter((d) => d.dia.getDay() === 0 || d.dia.getDay() === 6);
    return fds.some((d) => d.atende) ? semana : semana.filter((d) => d.dia.getDay() !== 0 && d.dia.getDay() !== 6);
  }, [semana]);

  const slots: Slot[] = useMemo(() => {
    if (!entrada || Number.isNaN(diaSelMs)) return [];
    return computeDaySlots(entrada, diaSel, { janela });
  }, [entrada, diaSel, diaSelMs, janela]);

  // Sem responsável escolhido não há agenda pra mostrar — e o select do Ganho
  // sempre entrega os dois juntos (nome + id), então basta uma das checagens.
  if (!responsavel.trim() || !closerId) return null;

  const moldura = "mt-2 rounded-xl border p-2.5";
  const estiloMoldura = { borderColor: "var(--line)", background: "var(--card2)" };

  if (carregando && slots.length === 0) {
    return (
      <div className={moldura} style={estiloMoldura}>
        <p className="text-xs text-gray-400">Carregando a agenda de {responsavel}…</p>
      </div>
    );
  }

  const hojeMs = startOfDay(new Date()).getTime();
  const semanaFim = addDays(semanaIni, 6);
  const selMs = selecionado ? selecionado.getTime() : null;
  const livresNoDia = slots.filter((s) => s.available).length;

  return (
    <div className={moldura} style={estiloMoldura}>
      {/* ── Navegação da semana ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setDiaSelMs(addDays(new Date(diaSelMs), -7).getTime())}
          className="grid h-6 w-6 place-items-center rounded-md text-gray-500 hover:bg-black/5"
          aria-label="Semana anterior"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <p className="text-xs font-bold" style={{ color: "var(--ink2)" }}>
          {rotuloDaSemana(semanaIni, semanaFim)}
        </p>
        <button
          type="button"
          onClick={() => setDiaSelMs(addDays(new Date(diaSelMs), 7).getTime())}
          className="grid h-6 w-6 place-items-center rounded-md text-gray-500 hover:bg-black/5"
          aria-label="Próxima semana"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      {/* ── Os dias, com quantos horários livres cada um tem ─────────────── */}
      <div className="mt-2 flex gap-1">
        {diasVisiveis.map(({ dia: d, livres, atende }) => {
          const ms = startOfDay(d).getTime();
          const escolhido = ms === startOfDay(diaSel).getTime();
          const hoje = ms === hojeMs;
          const vazio = livres === 0;
          return (
            <button
              key={ms}
              type="button"
              disabled={!atende}
              onClick={() => setDiaSelMs(ms)}
              className={`flex-1 rounded-lg border px-0.5 py-1 text-center transition ${atende ? "hover:brightness-95" : "cursor-default"}`}
              style={{
                borderColor: escolhido ? "var(--green)" : "var(--line)",
                background: escolhido ? "rgba(18,161,138,.14)" : atende ? "var(--card)" : "transparent",
                opacity: atende ? 1 : 0.45,
              }}
            >
              <span className="block text-[10px] leading-tight text-gray-500">{DIAS_CURTOS[d.getDay()]}</span>
              <span
                className="block text-[13px] font-bold leading-tight tabular-nums"
                style={{ color: hoje ? "var(--blue)" : "var(--ink)" }}
              >
                {String(d.getDate()).padStart(2, "0")}
              </span>
              <span
                className="block text-[10px] font-semibold leading-tight tabular-nums"
                style={{ color: vazio ? "var(--ink3)" : "var(--green)" }}
              >
                {atende ? (vazio ? "0" : livres) : "—"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[10px] text-gray-400">horários livres por dia</p>

      {/* ── Horários do dia aberto ───────────────────────────────────────── */}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs font-bold" style={{ color: "var(--ink2)" }}>
          {diaLongo(diaSel)}
        </p>
        <span className="text-[11px] text-gray-400">{livresNoDia} horário(s) livre(s)</span>
      </div>

      {slots.length === 0 ? (
        <p className="mt-1.5 text-xs text-gray-400">
          <b>{responsavel.split(" ")[0]}</b> não atende em {diaLongo(diaSel)}. Escolha outro dia acima
          — ou preencha a data e a hora na mão.
        </p>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
