// src/components/sdr/cadences/CadenceCreatePage.tsx
// -----------------------------------------------------------------------------
// CRIADOR DE CADÊNCIAS (refeito em 28/10 — pedido do Bruno: "mais completo e
// mais simples para novas criações").
//
// Quatro etapas: Começo (modelo pronto / duplicar / em branco + nome e
// objetivo) → Passos (lista arrastável, dia a dia) → Regras (dias, SDRs, teto
// de entrada, fim) → Revisar (calendário, avisos, e — na edição — se a mudança
// vale só para novos leads ou também para quem já está na cadência).
//
// O que NÃO mudou (de propósito): o banco continua qs_cadences + qs_cadence_days
// + qs_cadence_activities; a geração de tarefas (createCadenceTasks, api/_leads,
// importação de CSV) lê exatamente as mesmas colunas. As colunas novas da 0216
// (teto_entrada_dia, step_kind, template_name) são opcionais: sem a migração,
// o criador salva sem elas e avisa.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { fetchQsUsers } from "@/lib/qs/queries";
import { fetchEnabledChannels } from "@/lib/qs/channels";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { aplicarPlanoNosLeads, contarLeadsAtivos, type ResultadoSync } from "@/lib/qs/cadenceSync";
import { listarModelosAdmin, type WaModeloAdmin } from "@/lib/qs/waInbox";
import { loadWorkHours, scheduleWeekdays, planCadenceDates, nextWorkMoment, DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/workHours";
import { peekDuplicateSource, clearDuplicateSource } from "./duplicateSource";
import StepsEditor from "./StepsEditor";
import CalendarPreview from "./CalendarPreview";
import {
  MODELOS_PRONTOS, kindDef, novoId, ordenarPassos, passosParaDias, diasParaPassos,
  type ModeloPronto, type Passo,
} from "./cadenceModelos";
import type {
  ChannelType, AcquisitionChannel, CadenceObjective, CadenceStatus, PriorityLevel,
  ExecutionMode, DistributionMode, OffdayPolicy, SdrUser,
} from "../types";
import {
  ACQUISITION_LABELS, CADENCE_STATUS_LABELS, OBJECTIVE_LABELS, PRIORITY_LABELS, WEEKDAY_LABELS,
} from "../types";

interface CadenceCreatePageProps {
  cadenceId: string | null; // null = criar, string = editar
  onBack: () => void;
}

// ── Ícones ──────────────────────────────────────────────────────────────────

function IconBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Etapas ──────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Começo", sublabel: "Modelo, nome e objetivo" },
  { id: 2, label: "Passos", sublabel: "O que fazer, dia a dia" },
  { id: 3, label: "Regras", sublabel: "Dias, SDRs e limites" },
  { id: 4, label: "Revisar", sublabel: "Conferir e salvar" },
];

// ── Formulário ──────────────────────────────────────────────────────────────

interface FormState {
  execution_mode: ExecutionMode;
  objective: CadenceObjective;
  name: string;
  description: string;
  acquisition_channel: AcquisitionChannel;
  priority: PriorityLevel;
  status: CadenceStatus;
  auto_loss_enabled: boolean;
  auto_loss_days: number;
  redirect_cadence_id: string;
  passos: Passo[];
  weekdays: number[];
  distribution_mode: DistributionMode;
  offday_policy: OffdayPolicy;
  owner_ids: string[];
  teto_enabled: boolean;
  teto_entrada_dia: number;
}

function getDefaultForm(): FormState {
  return {
    execution_mode: "manual",
    objective: "agendar_reuniao",
    name: "",
    description: "",
    acquisition_channel: "levantada_de_mao",
    priority: "media",
    status: "rascunho",
    auto_loss_enabled: false,
    auto_loss_days: 14,
    redirect_cadence_id: "",
    passos: [{ id: novoId(), dia: 1, kind: "ligacao", hora: "09:00", texto: "", modelo: "" }],
    weekdays: [1, 2, 3, 4, 5],
    distribution_mode: "alternado",
    offday_policy: "aguardar_proximo_dia",
    owner_ids: [],
    teto_enabled: false,
    teto_entrada_dia: 30,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCadenceToForm(c: any): FormState {
  const teto = Number(c.teto_entrada_dia);
  return {
    execution_mode: c.execution_mode ?? "manual",
    objective: c.objective ?? "agendar_reuniao",
    name: c.name ?? "",
    description: c.description ?? "",
    acquisition_channel: c.acquisition_channel ?? "levantada_de_mao",
    priority: c.priority ?? "media",
    status: c.status ?? "rascunho",
    auto_loss_enabled: c.auto_loss_days !== null && c.auto_loss_days !== undefined,
    auto_loss_days: c.auto_loss_days ?? 14,
    redirect_cadence_id: c.redirect_cadence_id ?? "",
    passos: diasParaPassos(c.days ?? []),
    weekdays: c.execution_weekdays ?? [1, 2, 3, 4, 5],
    distribution_mode: c.distribution_mode ?? "alternado",
    offday_policy: c.offday_policy ?? "aguardar_proximo_dia",
    owner_ids: ((c.owners ?? []) as { user_id: string }[]).map((o) => o.user_id),
    teto_enabled: Number.isFinite(teto) && teto >= 1,
    teto_entrada_dia: Number.isFinite(teto) && teto >= 1 ? teto : 30,
  };
}

function formDoModelo(m: ModeloPronto): FormState {
  const base = getDefaultForm();
  return {
    ...base,
    name: m.form.name,
    description: m.form.description,
    acquisition_channel: m.form.acquisition_channel,
    objective: m.form.objective,
    priority: m.form.priority,
    weekdays: [...m.form.weekdays],
    offday_policy: m.form.offday_policy,
    auto_loss_enabled: m.form.auto_loss_days != null,
    auto_loss_days: m.form.auto_loss_days ?? 14,
    teto_enabled: m.form.teto_entrada_dia != null,
    teto_entrada_dia: m.form.teto_entrada_dia ?? 30,
    passos: m.passos.map((p) => ({ ...p, id: novoId() })),
  };
}

/** Coluna que ainda não existe no banco (0216 não aplicada). */
function colunaFaltando(err: { code?: string; message?: string } | null, coluna: string): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (err.code === "PGRST204" || err.code === "42703") && msg.includes(coluna);
}

interface Problema { msg: string; etapa: number; ids?: string[] }

// ── Componente ──────────────────────────────────────────────────────────────

export default function CadenceCreatePage({ cadenceId, onBack }: CadenceCreatePageProps) {
  const isEdit = cadenceId !== null;
  // DUPLICAÇÃO a partir do card da lista (ver duplicateSource.ts — peek no
  // inicializador por causa do StrictMode; limpa uma vez no effect).
  const [dupSourceId] = useState<string | null>(() => (cadenceId === null ? peekDuplicateSource() : null));
  useEffect(() => { if (dupSourceId) clearDuplicateSource(); }, [dupSourceId]);

  const [activeStep, setActiveStep] = useState(1);
  const [form, setForm] = useState<FormState>(getDefaultForm);
  /** De onde a cadência nova começou (rótulo exibido no topo do Começo). */
  const [origem, setOrigem] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit || dupSourceId !== null);
  // Falha ao carregar na EDIÇÃO: salvar fica bloqueado (senão um esqueleto
  // vazio sobrescreveria o plano real).
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sdrs, setSdrs] = useState<SdrUser[]>([]);
  const [otherCadences, setOtherCadences] = useState<{ id: string; name: string; status: CadenceStatus }[]>([]);
  const [enabledChannels, setEnabledChannels] = useState<Set<ChannelType> | null>(null);
  const [wh, setWh] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  const [entrada, setEntrada] = useState<Date>(() => new Date());
  const [modelosMeta, setModelosMeta] = useState<WaModeloAdmin[] | null>(null);
  const [modelosErro, setModelosErro] = useState<string | null>(null);
  const [leadsAtivos, setLeadsAtivos] = useState<number | null>(null);
  // Edição: impacto da mudança nos leads em andamento + a escolha explícita.
  const [sim, setSim] = useState<ResultadoSync | "carregando" | null>(null);
  const [aplicarEmAndamento, setAplicarEmAndamento] = useState<boolean | null>(null);

  useEffect(() => { fetchEnabledChannels().then(setEnabledChannels); }, []);
  useEffect(() => { loadWorkHours().then(setWh).catch(() => {}); }, []);
  useEffect(() => {
    fetchQsUsers().then((all) => setSdrs(all.filter((u) => u.role === "sdr" || u.role === "closer")));
    supabase.from("qs_cadences").select("id, name, status").order("name").then(({ data }) => {
      setOtherCadences(((data ?? []) as { id: string; name: string; status: CadenceStatus }[]).filter((c) => c.id !== cadenceId));
    });
  }, [cadenceId]);
  useEffect(() => { if (cadenceId) contarLeadsAtivos(cadenceId).then(setLeadsAtivos); }, [cadenceId]);

  const precisaModelos = useCallback(() => {
    if (modelosMeta !== null || modelosErro) return;
    listarModelosAdmin().then(({ modelos, error }) => {
      setModelosMeta(modelos);
      if (error) setModelosErro(error);
    });
  }, [modelosMeta, modelosErro]);
  useEffect(() => {
    if (form.passos.some((p) => p.kind === "whatsapp_modelo")) precisaModelos();
  }, [form.passos, precisaModelos]);

  // Carrega uma cadência existente como CÓPIA (card "Duplicar" ou seletor do Começo).
  const carregarCopia = useCallback(async (id: string) => {
    const { data: cad, error } = await supabase
      .from("qs_cadences")
      .select("*, days:qs_cadence_days(*, activities:qs_cadence_activities(*)), owners:qs_cadence_owners(user_id)")
      .eq("id", id)
      .single();
    if (error || !cad) {
      console.warn("Erro ao carregar cadência para duplicar:", error);
      notifyError("Não foi possível carregar a cadência de origem.");
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = cad as any;
    setForm({ ...mapCadenceToForm(c), name: `Cópia de ${c.name ?? "cadência"}`, status: "rascunho" });
    setOrigem(`Cópia de "${c.name ?? "cadência"}"`);
    return true;
  }, []);

  useEffect(() => {
    if (!dupSourceId) return;
    let cancelled = false;
    carregarCopia(dupSourceId).then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dupSourceId, carregarCopia]);

  const loadCadence = useCallback(async () => {
    if (!cadenceId) return;
    setLoading(true);
    setLoadError(false);
    const { data: cad, error } = await supabase
      .from("qs_cadences")
      .select("*, days:qs_cadence_days(*, activities:qs_cadence_activities(*)), owners:qs_cadence_owners(user_id)")
      .eq("id", cadenceId)
      .single();
    if (error || !cad) {
      console.warn("Erro ao buscar cadência para edição:", error);
      setLoadError(true);
      setLoading(false);
      return;
    }
    setForm(mapCadenceToForm(cad));
    setLoading(false);
  }, [cadenceId]);

  useEffect(() => { loadCadence(); }, [loadCadence]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleWeekday(day: number) {
    setForm((prev) => {
      const has = prev.weekdays.includes(day);
      return { ...prev, weekdays: has ? prev.weekdays.filter((d) => d !== day) : [...prev.weekdays, day].sort() };
    });
  }

  function usarModelo(m: ModeloPronto | null) {
    const temTrabalho = form.name.trim() || form.passos.some((p) => p.texto.trim());
    if (temTrabalho && !window.confirm("Trocar o ponto de partida apaga o que você já preencheu. Continuar?")) return;
    setForm(m ? formDoModelo(m) : getDefaultForm());
    setOrigem(m ? `Modelo "${m.nome}"` : "Em branco");
  }

  async function duplicarDaqui(id: string) {
    if (!id) return;
    const temTrabalho = form.name.trim() || form.passos.some((p) => p.texto.trim());
    if (temTrabalho && !window.confirm("Duplicar apaga o que você já preencheu. Continuar?")) return;
    await carregarCopia(id);
  }

  // ── Prévia de datas ─────────────────────────────────────────────────────
  const permitidos = useMemo(() => scheduleWeekdays(wh, form.weekdays), [wh, form.weekdays]);
  const diasDoPlano = useMemo(() => Array.from(new Set(form.passos.map((p) => p.dia))).sort((a, b) => a - b), [form.passos]);
  const datasPorDia = useMemo(
    () => planCadenceDates(diasDoPlano, permitidos, form.offday_policy, nextWorkMoment(wh, entrada)),
    [diasDoPlano, permitidos, form.offday_policy, wh, entrada]
  );

  // ── Validação ───────────────────────────────────────────────────────────
  const { erros, avisos } = useMemo(() => {
    const erros: Problema[] = [];
    const avisos: Problema[] = [];
    if (!form.name.trim()) erros.push({ msg: "Dê um nome para a cadência.", etapa: 1 });
    if (form.passos.length === 0) erros.push({ msg: "A cadência precisa de pelo menos 1 passo.", etapa: 2 });
    const semModelo = form.passos.filter((p) => p.kind === "whatsapp_modelo" && !p.modelo.trim());
    if (semModelo.length) erros.push({ msg: `${semModelo.length} passo(s) de WhatsApp modelo sem o modelo escolhido.`, etapa: 2, ids: semModelo.map((p) => p.id) });
    if (form.weekdays.length === 0) erros.push({ msg: "Marque pelo menos um dia da semana para a cadência rodar.", etapa: 3 });
    if (form.objective === "redirecionar" && !form.redirect_cadence_id) {
      erros.push({ msg: 'O objetivo é "Redirecionar", mas falta escolher a cadência de destino (Regras → Fim da cadência).', etapa: 3 });
    }

    const semTexto = form.passos.filter((p) => kindDef(p.kind).mensagem && !p.texto.trim());
    if (semTexto.length) avisos.push({ msg: `${semTexto.length} passo(s) de mensagem sem texto: o SDR vai escrever do zero.`, etapa: 2, ids: semTexto.map((p) => p.id) });

    const fds = form.weekdays.filter((d) => d === 0 || d === 6);
    if (fds.length) {
      const nomes = fds.map((d) => (d === 0 ? "domingo" : "sábado")).join(" e ");
      const fechado = fds.filter((d) => !permitidos.includes(d));
      avisos.push({
        msg: `A cadência está marcada para rodar no ${nomes}.` +
          (fechado.length ? " Como a empresa não abre nesse dia (Horário de Trabalho), nada vai cair nele de verdade." : " Confira se o time trabalha nesse dia."),
        etapa: 3,
      });
    }
    const noFds = Array.from(datasPorDia.entries()).filter(([, d]) => d.getDay() === 0 || d.getDay() === 6).map(([n]) => n);
    if (noFds.length && !fds.length) avisos.push({ msg: `Dia ${noFds.join(", ")} cai em fim de semana na prévia (por causa de "Iniciar imediatamente").`, etapa: 3 });

    // Mesma chave dia+canal duas vezes: ao aplicar nos leads em andamento, o
    // QS reconhece as duas como uma (cadenceSync.ts compara dia|canal).
    const vistos = new Map<string, number>();
    for (const p of form.passos) {
      const k = `${p.dia}|${kindDef(p.kind).channel}`;
      vistos.set(k, (vistos.get(k) ?? 0) + 1);
    }
    const repetidos = Array.from(vistos.entries()).filter(([, n]) => n > 1).map(([k]) => k.split("|")[0]);
    if (repetidos.length && isEdit) {
      avisos.push({ msg: `O Dia ${Array.from(new Set(repetidos)).join(", ")} tem dois passos do mesmo canal. Para leads novos tudo certo; ao aplicar nos leads em andamento, eles contam como um só.`, etapa: 2 });
    }

    if (!form.teto_enabled && (form.acquisition_channel === "resgate" || form.acquisition_channel === "outbound")) {
      avisos.push({ msg: "Cadência de base (resgate/outbound) sem limite de leads novos por dia. Uma importação grande cai inteira na fila do SDR no mesmo dia.", etapa: 3 });
    }
    if (!form.redirect_cadence_id && !form.auto_loss_enabled) {
      avisos.push({ msg: "Sem perda automática nem redirecionamento: quem terminar os passos sem desfecho fica parado até alguém mexer.", etapa: 3 });
    }
    if (form.owner_ids.length === 0) {
      avisos.push({ msg: "Nenhum SDR marcado: os leads caem na distribuição geral (quem tem menos leads).", etapa: 3 });
    }
    return { erros, avisos };
  }, [form, permitidos, datasPorDia, isEdit]);

  const idsComErro = useMemo(() => new Set(erros.flatMap((e) => e.ids ?? [])), [erros]);

  // ── Impacto nos leads em andamento (só edição, etapa Revisar) ───────────
  const assinaturaPlano = useMemo(
    () => JSON.stringify([passosParaDias(form.passos).map((d) => [d.day_number, d.activities.map((a) => [a.channel_type, a.scheduled_time])]), form.weekdays, form.offday_policy]),
    [form.passos, form.weekdays, form.offday_policy]
  );
  useEffect(() => {
    if (!cadenceId || activeStep !== 4 || loadError) return;
    let cancel = false;
    setSim("carregando");
    setAplicarEmAndamento(null);
    aplicarPlanoNosLeads(cadenceId, true, {
      days: passosParaDias(form.passos),
      execution_weekdays: form.weekdays,
      offday_policy: form.offday_policy,
    }).then((r) => { if (!cancel) setSim(r); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadenceId, activeStep, assinaturaPlano, loadError]);

  const simMexe = sim && sim !== "carregando" && !sim.erro && (sim.criadas > 0 || sim.encerradas > 0);
  const precisaEscolher = isEdit && !!simMexe && aplicarEmAndamento === null;

  // ── Salvar ──────────────────────────────────────────────────────────────
  async function handleSave() {
    if (isEdit && loadError) {
      notifyError("Os dados da cadência não carregaram — salvar agora apagaria os passos reais. Clique em \"Tentar de novo\".");
      return;
    }
    if (erros.length > 0) {
      notifyError(erros[0].msg);
      setActiveStep(erros[0].etapa);
      return;
    }
    if (precisaEscolher) {
      notifyError("Escolha se a mudança vale só para novos leads ou também para os que já estão na cadência.");
      return;
    }

    setSaving(true);
    const avisosFinais: string[] = [];

    const cadencePayload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description || null,
      acquisition_channel: form.acquisition_channel,
      objective: form.objective,
      execution_mode: form.execution_mode,
      priority: form.priority,
      status: form.status,
      execution_weekdays: form.weekdays,
      auto_loss_days: form.auto_loss_enabled ? form.auto_loss_days : null,
      redirect_cadence_id: form.redirect_cadence_id || null,
      distribution_mode: form.distribution_mode,
      offday_policy: form.offday_policy,
      teto_entrada_dia: form.teto_enabled ? Math.max(1, Math.round(form.teto_entrada_dia)) : null,
    };

    let savedCadenceId = cadenceId;

    if (isEdit && cadenceId) {
      let { error } = await supabase.from("qs_cadences").update(cadencePayload).eq("id", cadenceId);
      if (colunaFaltando(error, "teto_entrada_dia")) {
        delete cadencePayload.teto_entrada_dia;
        if (form.teto_enabled) avisosFinais.push("o limite de leads novos por dia NÃO foi gravado (falta aplicar a migração 0216)");
        ({ error } = await supabase.from("qs_cadences").update(cadencePayload).eq("id", cadenceId));
      }
      if (error) { console.warn("Erro ao atualizar cadência:", error); notifyError("Não foi possível salvar a cadência — tente novamente."); setSaving(false); return; }

      // Edição = apaga os dias e regrava (sem transação — ver backlog de 13/07).
      // Se a limpeza falhar, NÃO insere: o plano novo empilharia sobre o antigo.
      const { error: delErr } = await supabase.from("qs_cadence_days").delete().eq("cadence_id", cadenceId);
      if (delErr) {
        console.warn("Erro ao limpar o plano antigo:", delErr);
        notifyError("Não foi possível regravar os passos (a limpeza do plano antigo falhou). Tente salvar de novo.");
        setSaving(false);
        return;
      }
    } else {
      let { data, error } = await supabase.from("qs_cadences").insert(cadencePayload).select("id").single();
      if (colunaFaltando(error, "teto_entrada_dia")) {
        delete cadencePayload.teto_entrada_dia;
        if (form.teto_enabled) avisosFinais.push("o limite de leads novos por dia NÃO foi gravado (falta aplicar a migração 0216)");
        ({ data, error } = await supabase.from("qs_cadences").insert(cadencePayload).select("id").single());
      }
      if (error || !data) { console.warn("Erro ao criar cadência:", error); notifyError("Não foi possível criar a cadência — tente novamente."); setSaving(false); return; }
      savedCadenceId = data.id;
    }

    // Dias e atividades. Falha parcial nunca é silenciosa.
    let planFailures = 0;
    let semColunasDePasso = false;
    for (const day of passosParaDias(form.passos)) {
      const { data: dayData, error: dayErr } = await supabase
        .from("qs_cadence_days")
        .insert({ cadence_id: savedCadenceId, day_number: day.day_number })
        .select("id")
        .single();
      if (dayErr || !dayData) { console.warn("Erro ao criar dia:", dayErr); planFailures++; continue; }

      let acts: Record<string, unknown>[] = day.activities.map((a) => ({ ...a, cadence_day_id: dayData.id }));
      if (semColunasDePasso) acts = acts.map(({ step_kind: _sk, template_name: _tn, ...rest }) => rest);
      let { error: actErr } = await supabase.from("qs_cadence_activities").insert(acts);
      if (!semColunasDePasso && (colunaFaltando(actErr, "step_kind") || colunaFaltando(actErr, "template_name"))) {
        semColunasDePasso = true;
        acts = acts.map(({ step_kind: _sk, template_name: _tn, ...rest }) => rest);
        ({ error: actErr } = await supabase.from("qs_cadence_activities").insert(acts));
      }
      if (actErr) { console.warn("Erro ao criar atividades:", actErr); planFailures++; }
    }
    if (semColunasDePasso && form.passos.some((p) => p.kind === "whatsapp_modelo")) {
      avisosFinais.push("os passos de WhatsApp modelo foram salvos como WhatsApp comum (falta aplicar a migração 0216)");
    }
    if (planFailures > 0) {
      notifyError(`Parte dos passos (${planFailures} dia(s)) NÃO foi gravada — reabra a cadência e salve de novo: salvar regrava tudo.`);
    }

    // Donos (rodízio). Substitui o conjunto.
    if (savedCadenceId) {
      await supabase.from("qs_cadence_owners").delete().eq("cadence_id", savedCadenceId);
      if (form.owner_ids.length > 0) {
        const { error: ownErr } = await supabase.from("qs_cadence_owners").insert(
          form.owner_ids.map((userId) => ({ cadence_id: savedCadenceId, user_id: userId, rr_pointer: false }))
        );
        if (ownErr) { console.warn("Erro ao salvar os SDRs da cadência:", ownErr); notifyError("Cadência salva, mas os SDRs responsáveis NÃO foram gravados — reabra e tente de novo."); }
      }
    }

    if (avisosFinais.length) notifyError(`Cadência salva, mas ${avisosFinais.join("; ")}.`);

    // ── Leads que já estão na cadência ──────────────────────────────────────
    // Desde 19/08 a edição aplicava o plano novo em todo mundo automaticamente.
    // Agora a escolha é explícita, com o número na tela (etapa Revisar):
    // "só novos" não toca em nenhuma tarefa já gerada. "Aplicar também" usa o
    // mesmo motor de antes — não mexe no que já foi feito nem em avulsas, e
    // nada nasce atrasado.
    if (savedCadenceId && cadenceId) {
      if (aplicarEmAndamento) {
        const r = await aplicarPlanoNosLeads(savedCadenceId);
        if (r.erro) {
          notifyError(`A cadência foi salva, mas não consegui aplicar nos leads em andamento: ${r.erro}`);
        } else {
          notifySuccess(
            `Cadência salva e aplicada em ${r.leads} lead(s): ${r.criadas} atividade(s) criada(s)` +
            (r.paraHoje > 0 ? ` (${r.paraHoje} para hoje)` : "") + `, ${r.encerradas} encerrada(s).`
          );
        }
      } else if (simMexe) {
        notifySuccess("Cadência salva. Vale para os próximos leads — quem já está nela segue o plano antigo.");
      } else {
        notifySuccess("Cadência salva.");
      }
    } else {
      notifySuccess("Cadência criada.");
    }

    setSaving(false);
    onBack();
  }

  // ── Etapa 1: Começo ─────────────────────────────────────────────────────
  function renderComeco() {
    return (
      <div className="space-y-8">
        {!isEdit && (
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <label className="block text-sm font-semibold text-gray-800">Por onde começar?</label>
              {origem && <span className="text-[11px] text-gray-500">Começou de: <b>{origem}</b></span>}
            </div>
            <p className="text-xs text-gray-500 mb-3">Escolha um modelo pronto e só ajuste. Ele preenche passos, textos e regras.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MODELOS_PRONTOS.map((m) => (
                <button key={m.id} type="button" onClick={() => usarModelo(m)}
                  className={`text-left p-3 rounded-xl border-2 transition hover:border-[#0147FF]/60 ${origem === `Modelo "${m.nome}"` ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200 bg-white"}`}>
                  <span className="block text-sm font-bold text-gray-900">{m.nome}</span>
                  <span className="block text-[11.5px] text-gray-500 mt-0.5">{m.resumo}</span>
                  <span className="block text-[10.5px] text-gray-400 mt-1">
                    {m.passos.length} passos · {Math.max(...m.passos.map((p) => p.dia))} dias{m.form.teto_entrada_dia ? ` · até ${m.form.teto_entrada_dia} leads/dia por SDR` : ""}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select defaultValue="" onChange={(e) => { duplicarDaqui(e.target.value); e.target.value = ""; }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs bg-white">
                <option value="">Duplicar uma cadência existente…</option>
                {otherCadences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" onClick={() => usarModelo(null)} className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50">
                Começar em branco
              </button>
            </div>
          </div>
        )}

        {isEdit && leadsAtivos !== null && leadsAtivos > 0 && (
          <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
            Esta cadência tem <b>{leadsAtivos} lead(s) em andamento</b>. Mudar os passos não mexe na fila deles sem você pedir: no fim (Revisar) você escolhe se vale só para novos leads ou também para eles.
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Nome da cadência</label>
            <input type="text" value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="Ex.: Japão — lead novo de tráfego"
              className="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#0147FF] focus:ring-2 focus:ring-[#0147FF]/10" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Para que serve (opcional)</label>
            <textarea value={form.description} onChange={(e) => updateForm("description", e.target.value)} rows={2}
              placeholder="Quem entra nesta cadência e o que a gente quer com ela."
              className="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#0147FF] resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Objetivo</label>
              <select value={form.objective} onChange={(e) => updateForm("objective", e.target.value as CadenceObjective)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                {(Object.keys(OBJECTIVE_LABELS) as CadenceObjective[]).map((o) => <option key={o} value={o}>{OBJECTIVE_LABELS[o]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">De onde vêm os leads</label>
              <select value={form.acquisition_channel} onChange={(e) => updateForm("acquisition_channel", e.target.value as AcquisitionChannel)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                {(Object.keys(ACQUISITION_LABELS) as AcquisitionChannel[]).map((ch) => <option key={ch} value={ch}>{ACQUISITION_LABELS[ch]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Prioridade da cadência</label>
            <div className="flex gap-2">
              {(Object.keys(PRIORITY_LABELS) as PriorityLevel[]).map((p) => (
                <button key={p} type="button" onClick={() => updateForm("priority", p)}
                  className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition ${form.priority === p ? "border-[#0147FF] bg-[#0147FF]/5 text-[#0147FF]" : "border-gray-200 bg-white text-gray-500"}`}>
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Etapa 2: Passos ─────────────────────────────────────────────────────
  function renderPassos() {
    const total = form.passos.length;
    const ultimo = diasDoPlano[diasDoPlano.length - 1] ?? 0;
    return (
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="px-3 py-1 rounded-full bg-[#0147FF]/10 text-xs font-medium text-[#0147FF]">{total} passo{total === 1 ? "" : "s"} em {ultimo} dia{ultimo === 1 ? "" : "s"}</span>
            <span className="text-[11px] text-gray-400">Arraste para reordenar. O período define a prioridade da tarefa na fila.</span>
          </div>
          <StepsEditor
            passos={form.passos}
            onChange={(next) => updateForm("passos", next)}
            enabledChannels={enabledChannels}
            datasPorDia={datasPorDia}
            modelosMeta={modelosMeta}
            modelosErro={modelosErro}
            onPrecisaModelos={precisaModelos}
            comErro={idsComErro}
          />
        </div>
        <div className="xl:sticky xl:top-4 bg-white border border-gray-100 rounded-xl p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-2">Como fica no calendário</h3>
          <CalendarPreview passos={form.passos} datasPorDia={datasPorDia} entrada={entrada} onEntrada={setEntrada} permitidos={permitidos} />
        </div>
      </div>
    );
  }

  // ── Etapa 3: Regras ─────────────────────────────────────────────────────
  function renderRegras() {
    return (
      <div className="space-y-8">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Dias em que a cadência roda</label>
          <p className="text-xs text-gray-500 mb-2">Passo que cairia num dia desmarcado vai para o próximo dia marcado.</p>
          <div className="flex gap-2 flex-wrap">
            {WEEKDAY_LABELS.map((label, idx) => {
              const active = form.weekdays.includes(idx);
              const fds = idx === 0 || idx === 6;
              return (
                <button key={idx} type="button" onClick={() => toggleWeekday(idx)}
                  className={`w-11 h-10 rounded-lg text-xs font-bold border-2 transition ${
                    active ? (fds ? "border-amber-500 bg-amber-500 text-white" : "border-[#0147FF] bg-[#0147FF] text-white") : "border-gray-200 bg-white text-gray-400"
                  }`}>
                  {label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 space-y-2">
            {(["aguardar_proximo_dia", "iniciar_imediato"] as OffdayPolicy[]).map((policy) => (
              <label key={policy} className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="radio" checked={form.offday_policy === policy} onChange={() => updateForm("offday_policy", policy)} className="mt-0.5" />
                <span>
                  <b className="text-gray-800">{policy === "iniciar_imediato" ? "Começar no dia em que o lead entra" : "Esperar o próximo dia marcado"}</b>
                  {policy === "iniciar_imediato"
                    ? " — mesmo fora dos dias marcados, mas sempre dentro do Horário de Trabalho da empresa."
                    : " — lead que entra no sábado começa na segunda (padrão)."}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* TETO DE ENTRADA (0216) */}
        <div className={`p-4 rounded-xl border-2 ${form.teto_enabled ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200 bg-white"}`}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={form.teto_enabled} onChange={(e) => updateForm("teto_enabled", e.target.checked)} className="mt-1" />
            <span>
              <span className="block text-sm font-bold text-gray-900">Limite de leads novos por dia, por SDR</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Quando entram mais leads do que isso no mesmo dia (importação, vínculo em massa), os que passarem começam nos próximos dias.
                Eles já ficam com o SDR; o que se espalha são as atividades. Lead que chega pelo site não espera.
              </span>
            </span>
          </label>
          {form.teto_enabled && (
            <div className="flex items-center gap-2 mt-3 pl-7">
              <span className="text-xs text-gray-500">No máximo</span>
              <input type="number" min={1} max={1000} value={form.teto_entrada_dia}
                onChange={(e) => updateForm("teto_entrada_dia", Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
                className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-center tabular-nums" />
              <span className="text-xs text-gray-500">leads novos por dia para cada SDR</span>
            </div>
          )}
          {form.teto_enabled && (() => {
            const porLead = form.passos.filter((p) => p.dia === (diasDoPlano[0] ?? 1)).length;
            return (
              <p className="text-[11px] text-gray-500 mt-2 pl-7">
                Com {form.teto_entrada_dia} leads, o 1º dia gera no máximo {form.teto_entrada_dia * porLead} atividade(s) por SDR.
                Ex.: 459 leads de uma vez → começam ao longo de {Math.ceil(459 / form.teto_entrada_dia)} dia(s) de execução.
              </p>
            );
          })()}
        </div>

        {/* SDRs */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">SDRs que recebem os leads</label>
          <p className="text-xs text-gray-500 mb-3">
            Os leads são divididos entre os marcados, sempre para quem tem menos leads ativos nesta cadência. Sem ninguém marcado, vale a distribuição geral.
          </p>
          {sdrs.length === 0 ? (
            <div className="p-4 rounded-xl border-2 border-dashed border-amber-200 bg-amber-50 text-[13px] text-amber-800">
              Nenhum SDR cadastrado ainda. Crie em <b>Configurações → Usuários</b>.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sdrs.map((u) => {
                const on = form.owner_ids.includes(u.id);
                return (
                  <button key={u.id} type="button"
                    onClick={() => updateForm("owner_ids", on ? form.owner_ids.filter((id) => id !== u.id) : [...form.owner_ids, u.id])}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border-2 text-sm font-medium transition"
                    style={on ? { borderColor: "#0147FF", background: "#0147FF", color: "#fff" } : { borderColor: "var(--line)", background: "var(--card)", color: "var(--ink2)" }}>
                    {u.name}
                    {on && <IconCheck />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Fim */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Fim da cadência</label>
          <p className="text-xs text-gray-500 mb-3">O que acontece com quem termina todos os passos sem virar ganho nem perdido.</p>
          <div className="space-y-3">
            <div className={`p-4 rounded-xl border-2 ${form.redirect_cadence_id ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200 bg-white"}`}>
              <span className="text-sm font-bold text-gray-900 block mb-1">Mandar para outra cadência</span>
              <select value={form.redirect_cadence_id} onChange={(e) => updateForm("redirect_cadence_id", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                <option value="">Não mandar</option>
                {otherCadences.filter((c) => c.status === "disponivel" || c.id === form.redirect_cadence_id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.status !== "disponivel" ? ` (${CADENCE_STATUS_LABELS[c.status].toLowerCase()} — não recebe leads)` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className={`p-4 rounded-xl border-2 ${form.auto_loss_enabled ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200 bg-white"}`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.auto_loss_enabled} onChange={(e) => updateForm("auto_loss_enabled", e.target.checked)} className="mt-1" />
                <span>
                  <span className="block text-sm font-bold text-gray-900">Perda automática</span>
                  <span className="block text-xs text-gray-500 mt-0.5">Terminou os passos e passou dos dias abaixo sem desfecho → vira perdido sozinho (e vai pro Bitrix).</span>
                </span>
              </label>
              {form.auto_loss_enabled && (
                <div className="flex items-center gap-2 mt-3 pl-7">
                  <span className="text-xs text-gray-500">Perder após</span>
                  <input type="number" min={1} max={365} value={form.auto_loss_days}
                    onChange={(e) => updateForm("auto_loss_days", Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-center tabular-nums" />
                  <span className="text-xs text-gray-500">dias na cadência</span>
                </div>
              )}
            </div>
            {form.redirect_cadence_id && form.auto_loss_enabled && (
              <p className="text-[11.5px] text-gray-500">Com os dois ligados, o redirecionamento vence.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Etapa 4: Revisar ────────────────────────────────────────────────────
  function renderRevisar() {
    const lista = ordenarPassos(form.passos);
    const statusOpcoes: CadenceStatus[] = isEdit ? ["rascunho", "disponivel", "congelada"] : ["rascunho", "disponivel"];
    return (
      <div className="space-y-6">
        {erros.length > 0 && (
          <div className="p-4 rounded-xl border border-red-200 bg-red-50 space-y-1">
            <p className="text-sm font-bold text-red-800">Falta resolver antes de salvar</p>
            {erros.map((e, i) => (
              <button key={i} type="button" onClick={() => setActiveStep(e.etapa)} className="block text-left text-xs text-red-700 underline decoration-dotted">
                {e.msg}
              </button>
            ))}
          </div>
        )}
        {avisos.length > 0 && (
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-1">
            <p className="text-sm font-bold text-amber-800">Vale conferir</p>
            {avisos.map((a, i) => (
              <button key={i} type="button" onClick={() => setActiveStep(a.etapa)} className="block text-left text-xs text-amber-800">
                • {a.msg}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
            <div>
              <h3 className="text-base font-bold text-gray-900">{form.name || "Sem nome"}</h3>
              <p className="text-xs text-gray-500">
                {OBJECTIVE_LABELS[form.objective]} · {ACQUISITION_LABELS[form.acquisition_channel]} · roda {form.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ") || "nenhum dia"}
              </p>
              <p className="text-xs text-gray-500">
                {form.teto_enabled ? `Até ${form.teto_entrada_dia} leads novos/dia por SDR` : "Sem limite de leads novos por dia"} ·{" "}
                {form.owner_ids.length ? `${form.owner_ids.length} SDR(s)` : "distribuição geral"} ·{" "}
                {form.redirect_cadence_id ? "redireciona no fim" : form.auto_loss_enabled ? `perde após ${form.auto_loss_days} dias` : "sem fim automático"}
              </p>
            </div>
            <ol className="space-y-1">
              {lista.map((p) => {
                const d = datasPorDia.get(p.dia);
                return (
                  <li key={p.id} className="flex gap-2 text-xs">
                    <span className="w-14 shrink-0 font-semibold text-gray-700">Dia {p.dia}</span>
                    <span className="w-28 shrink-0 text-gray-600">{kindDef(p.kind).label}{p.kind === "whatsapp_modelo" && p.modelo ? ` (${p.modelo})` : ""}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-400">{p.texto || "—"}</span>
                    {d && <span className={`shrink-0 ${d.getDay() === 0 || d.getDay() === 6 ? "text-amber-700" : "text-gray-400"}`}>{["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]} {d.getDate()}/{d.getMonth() + 1}</span>}
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <CalendarPreview passos={form.passos} datasPorDia={datasPorDia} entrada={entrada} onEntrada={setEntrada} permitidos={permitidos} />
          </div>
        </div>

        {/* Leads em andamento (edição) */}
        {isEdit && (
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-1">E quem já está na cadência?</h3>
            {sim === "carregando" || sim === null ? (
              <p className="text-xs text-gray-500">Calculando o impacto nos leads em andamento…</p>
            ) : sim.erro ? (
              <p className="text-xs text-amber-700">Não consegui calcular o impacto ({sim.erro}). Por segurança, a mudança vale só para novos leads.</p>
            ) : !simMexe ? (
              <p className="text-xs text-gray-500">Nada muda para os {leadsAtivos ?? 0} lead(s) em andamento — os passos deles continuam iguais.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Os passos mudaram. Escolha para quem vale:</p>
                <label className={`flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer ${aplicarEmAndamento === false ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200"}`}>
                  <input type="radio" checked={aplicarEmAndamento === false} onChange={() => setAplicarEmAndamento(false)} className="mt-0.5" />
                  <span className="text-xs">
                    <b className="text-gray-900">Só para novos leads</b>
                    <span className="block text-gray-500">Nenhuma tarefa já gerada é tocada. Quem já está na cadência termina o plano antigo.</span>
                  </span>
                </label>
                <label className={`flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer ${aplicarEmAndamento === true ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200"}`}>
                  <input type="radio" checked={aplicarEmAndamento === true} onChange={() => setAplicarEmAndamento(true)} className="mt-0.5" />
                  <span className="text-xs">
                    <b className="text-gray-900">Aplicar também em {sim.leads} lead(s) em andamento</b>
                    <span className="block text-gray-500">
                      Cria {sim.criadas} atividade(s){sim.paraHoje > 0 ? ` (${sim.paraHoje} para hoje)` : ""} e encerra {sim.encerradas} que saíram do plano.
                      O que já foi feito e as atividades avulsas não são tocados; nada nasce atrasado.
                    </span>
                    {sim.paraHoje > 100 && <span className="block text-amber-700 font-semibold mt-1">Atenção: {sim.paraHoje} atividades novas para hoje.</span>}
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-2">Situação ao salvar</h3>
          <div className="flex flex-wrap gap-2">
            {statusOpcoes.map((s) => (
              <button key={s} type="button" onClick={() => updateForm("status", s)}
                className={`px-3 py-2 rounded-lg border-2 text-xs font-semibold ${form.status === s ? "border-[#0147FF] bg-[#0147FF]/5 text-[#0147FF]" : "border-gray-200 text-gray-500"}`}>
                {s === "rascunho" ? "Rascunho (ainda não recebe leads)" : s === "disponivel" ? "Disponível (já recebe leads)" : "Congelada"}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderStep() {
    switch (activeStep) {
      case 1: return renderComeco();
      case 2: return renderPassos();
      case 3: return renderRegras();
      case 4: return renderRevisar();
      default: return null;
    }
  }

  // ── Render principal ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#F8F9FA] items-center justify-center">
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  if (isEdit && loadError) {
    return (
      <div className="flex min-h-screen bg-[#F8F9FA] items-center justify-center px-4">
        <div className="bg-white border border-gray-100 rounded-xl p-8 max-w-md w-full text-center">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Não foi possível carregar a cadência</h2>
          <p className="text-sm text-gray-500 mb-6">
            Os passos desta cadência não carregaram. Para proteger os dados, a edição fica bloqueada — salvar agora apagaria os passos reais.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={onBack} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Voltar</button>
            <button onClick={loadCadence} className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#0147FF] hover:bg-[#0139D6]">Tentar de novo</button>
          </div>
        </div>
      </div>
    );
  }

  const errosPorEtapa = (id: number) => erros.filter((e) => e.etapa === id).length;

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#F8F9FA]">
      <div className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-gray-100 bg-white md:min-h-screen">
        <div className="p-4 md:p-6">
          <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 mb-6">
            <IconBack /> Voltar
          </button>
          <h2 className="text-lg font-bold text-gray-900 mb-1">{isEdit ? "Editar cadência" : "Nova cadência"}</h2>
          <p className="text-xs text-gray-500 mb-6">{isEdit ? form.name : "4 etapas rápidas"}</p>
          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            {STEPS.map((step) => {
              const isActive = activeStep === step.id;
              const nErr = activeStep === 4 || step.id < activeStep ? errosPorEtapa(step.id) : 0;
              return (
                <button key={step.id} onClick={() => setActiveStep(step.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left shrink-0 ${isActive ? "bg-[#0147FF]/5" : ""}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    nErr ? "bg-red-50 text-red-600" : isActive ? "bg-[#0147FF] text-white" : step.id < activeStep ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
                  }`}>
                    {nErr ? "!" : step.id < activeStep ? <IconCheck /> : step.id}
                  </div>
                  <div className="min-w-0">
                    <span className={`block text-sm font-medium ${isActive ? "text-[#0147FF]" : "text-gray-700"}`}>{step.label}</span>
                    <span className="hidden md:block text-[11px] text-gray-400">{step.sublabel}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center flex-wrap gap-y-3 justify-between px-4 md:px-8 py-4 bg-white border-b border-gray-100">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{STEPS[activeStep - 1].label}</h1>
            <p className="text-sm text-gray-500 mt-0.5">Etapa {activeStep} de {STEPS.length} · {STEPS[activeStep - 1].sublabel}</p>
          </div>
          <div className="flex items-center gap-3">
            {activeStep > 1 && (
              <button onClick={() => setActiveStep((s) => s - 1)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Anterior
              </button>
            )}
            {activeStep < STEPS.length ? (
              <button onClick={() => setActiveStep((s) => s + 1)} className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#0147FF] hover:bg-[#0139D6]">
                Próximo
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving || erros.length > 0 || precisaEscolher || sim === "carregando"}
                title={erros[0]?.msg ?? (precisaEscolher ? "Escolha para quem vale a mudança" : undefined)}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#0147FF] hover:bg-[#0139D6] disabled:opacity-50">
                <IconCheck /> {saving ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar cadência"}
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          <div className={activeStep === 2 || activeStep === 4 ? "max-w-6xl mx-auto" : "max-w-2xl mx-auto"}>{renderStep()}</div>
        </div>
      </div>
    </div>
  );
}
