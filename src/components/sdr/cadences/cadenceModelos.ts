// src/components/sdr/cadences/cadenceModelos.ts
// -----------------------------------------------------------------------------
// Peças do criador de cadências (28/10):
//   • PASSO — a unidade que o gestor edita (dia + tipo + período + texto). No
//     banco ele vira qs_cadence_days + qs_cadence_activities, como sempre: a
//     geração de tarefas (createCadenceTasks / api/_leads.js / CSV) não muda.
//   • TIPOS DE PASSO — os canais do banco, mais o "WhatsApp modelo" (canal
//     whatsapp + step_kind "whatsapp_modelo" + template_name, migração 0216).
//   • MODELOS PRONTOS — cadências inteiras pra começar e só ajustar.
// -----------------------------------------------------------------------------

import type { AcquisitionChannel, CadenceObjective, ChannelType, OffdayPolicy, PriorityLevel } from "../types";

export type StepKind = ChannelType | "whatsapp_modelo";

export interface StepKindDef {
  kind: StepKind;
  label: string;
  /** Canal gravado em qs_cadence_activities.channel_type. */
  channel: ChannelType;
  /** Rótulo do campo de texto. */
  textoLabel: string;
  textoPlaceholder: string;
  /** Mensagem que vai pro lead (texto vazio = aviso). */
  mensagem: boolean;
}

export const STEP_KINDS: StepKindDef[] = [
  { kind: "ligacao", label: "Ligação", channel: "ligacao", textoLabel: "Roteiro da ligação", textoPlaceholder: "Ex.: Oi {{nome}}, aqui é {{sdr}} da Se Tu For, Eu Vou! Vi seu interesse em {{expedicao}}…", mensagem: false },
  { kind: "whatsapp", label: "WhatsApp texto", channel: "whatsapp", textoLabel: "Mensagem", textoPlaceholder: "Ex.: Oi {{nome}}! Aqui é {{sdr}}. Tentei te ligar sobre {{expedicao}}, quando fica bom conversarmos?", mensagem: true },
  { kind: "whatsapp_modelo", label: "WhatsApp modelo", channel: "whatsapp", textoLabel: "Observação para o SDR (opcional)", textoPlaceholder: "Ex.: usar quando o lead não responde há mais de 24h.", mensagem: false },
  { kind: "email", label: "E-mail", channel: "email", textoLabel: "Texto do e-mail", textoPlaceholder: "Ex.: Olá {{nome}}, segue o roteiro de {{expedicao}} que conversamos…", mensagem: true },
  { kind: "pesquisa", label: "Tarefa manual", channel: "pesquisa", textoLabel: "O que fazer", textoPlaceholder: "Ex.: conferir no Bitrix se o lead já foi cliente e anotar a última viagem.", mensagem: false },
  { kind: "ligacao_whatsapp", label: "Ligação WhatsApp", channel: "ligacao_whatsapp", textoLabel: "Roteiro da ligação", textoPlaceholder: "Roteiro…", mensagem: false },
  { kind: "linkedin", label: "LinkedIn", channel: "linkedin", textoLabel: "Mensagem", textoPlaceholder: "Mensagem…", mensagem: true },
  { kind: "instagram", label: "Instagram", channel: "instagram", textoLabel: "Mensagem", textoPlaceholder: "Mensagem…", mensagem: true },
  { kind: "tiktok", label: "TikTok", channel: "tiktok", textoLabel: "Mensagem", textoPlaceholder: "Mensagem…", mensagem: true },
  { kind: "youtube", label: "YouTube", channel: "youtube", textoLabel: "Mensagem", textoPlaceholder: "Mensagem…", mensagem: true },
];

/** Os 5 que aparecem como botão; o resto fica em "Outros". */
export const MAIN_KINDS: StepKind[] = ["ligacao", "whatsapp", "whatsapp_modelo", "email", "pesquisa"];

export function kindDef(kind: StepKind): StepKindDef {
  return STEP_KINDS.find((k) => k.kind === kind) ?? STEP_KINDS[0];
}

/** Variáveis que o texto aceita (preenchidas no card do SDR — fillTemplate). */
export const VARIAVEIS: { chave: string; label: string; exemplo: string }[] = [
  { chave: "{{nome}}", label: "Nome", exemplo: "Maria Souza" },
  { chave: "{{primeiro_nome}}", label: "Primeiro nome", exemplo: "Maria" },
  { chave: "{{expedicao}}", label: "Expedição", exemplo: "Japão" },
  { chave: "{{sdr}}", label: "SDR", exemplo: "Yanca" },
];

export function previewTexto(texto: string): string {
  let out = texto;
  for (const v of VARIAVEIS) out = out.split(v.chave).join(v.exemplo);
  return out.replaceAll("{nome}", "Maria Souza").replaceAll("{primeiro_nome}", "Maria");
}

// ── Período (= prioridade da tarefa no FUP) ─────────────────────────────────

export const PERIODS = [
  { key: "manha", label: "Manhã", time: "09:00" as string | null, hint: "Prioridade alta" },
  { key: "tarde", label: "Tarde", time: "12:30" as string | null, hint: "Prioridade média" },
  { key: "dia_todo", label: "Dia todo", time: null as string | null, hint: "Prioridade baixa" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export function periodOf(time: string | null): PeriodKey {
  if (!time) return "dia_todo";
  return time >= "12:30" ? "tarde" : "manha";
}

// ── Passo ───────────────────────────────────────────────────────────────────

export interface Passo {
  id: string;
  dia: number;
  kind: StepKind;
  /** scheduled_time como está no banco (09:00 / 12:30 / null / outro horário antigo). */
  hora: string | null;
  texto: string;
  /** Nome do modelo da Meta (só no kind whatsapp_modelo). */
  modelo: string;
}

let _seq = 0;
export function novoId(): string {
  _seq += 1;
  return `p-${Date.now().toString(36)}-${_seq}`;
}

/** Ordena por dia mantendo a ordem relativa dentro do dia (sort estável). */
export function ordenarPassos(passos: Passo[]): Passo[] {
  return passos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.dia - b.p.dia || a.i - b.i)
    .map((x) => x.p);
}

/** Passos → estrutura do banco (dias com atividades, na ordem da lista). */
export function passosParaDias(passos: Passo[]) {
  const porDia = new Map<number, Passo[]>();
  for (const p of ordenarPassos(passos)) {
    const arr = porDia.get(p.dia) ?? [];
    arr.push(p);
    porDia.set(p.dia, arr);
  }
  return Array.from(porDia.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day_number, ps]) => ({
      day_number,
      activities: ps.map((p, idx) => ({
        channel_type: kindDef(p.kind).channel,
        scheduled_time: p.hora,
        order_index: idx,
        script_text: p.texto.trim() || null,
        step_kind: p.kind === "whatsapp_modelo" ? "whatsapp_modelo" : null,
        template_name: p.kind === "whatsapp_modelo" ? p.modelo.trim() || null : null,
      })),
    }));
}

/** Linha do Supabase (days → activities aninhados) → passos. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function diasParaPassos(days: any[]): Passo[] {
  return (days ?? [])
    .slice()
    .sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0))
    .flatMap((d) =>
      (d.activities ?? [])
        .slice()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any): Passo => ({
          id: novoId(),
          dia: Math.max(1, Number(d.day_number) || 1),
          kind: a.step_kind === "whatsapp_modelo" ? "whatsapp_modelo" : (a.channel_type as ChannelType),
          hora: a.scheduled_time ?? null,
          texto: a.script_text ?? "",
          modelo: a.template_name ?? "",
        }))
    );
}

// ── Modelos prontos ─────────────────────────────────────────────────────────

export interface ModeloPronto {
  id: string;
  nome: string;
  resumo: string;
  form: {
    name: string;
    description: string;
    acquisition_channel: AcquisitionChannel;
    objective: CadenceObjective;
    priority: PriorityLevel;
    weekdays: number[];
    offday_policy: OffdayPolicy;
    auto_loss_days: number | null;
    teto_entrada_dia: number | null;
  };
  passos: Omit<Passo, "id">[];
}

const M = "09:00", T = "12:30", D = null;

function p(dia: number, kind: StepKind, hora: string | null, texto: string, modelo = ""): Omit<Passo, "id"> {
  return { dia, kind, hora, texto, modelo };
}

export const MODELOS_PRONTOS: ModeloPronto[] = [
  {
    id: "trafego",
    nome: "Lead novo de tráfego",
    resumo: "Pediu informação agora. Ligação rápida, WhatsApp logo depois e 10 dias de insistência.",
    form: {
      name: "Lead novo de tráfego",
      description: "Lead que acabou de chegar do anúncio. Objetivo: falar no mesmo dia e marcar a reunião.",
      acquisition_channel: "levantada_de_mao",
      objective: "agendar_reuniao",
      priority: "alta",
      weekdays: [1, 2, 3, 4, 5],
      offday_policy: "aguardar_proximo_dia",
      auto_loss_days: 14,
      teto_entrada_dia: null,
    },
    passos: [
      p(1, "ligacao", M, "Oi {{nome}}, aqui é {{sdr}} da Se Tu For, Eu Vou! Vi que você se interessou por {{expedicao}}. Tem 2 minutinhos?"),
      p(1, "whatsapp", M, "Oi {{primeiro_nome}}! Aqui é {{sdr}}, da Se Tu For, Eu Vou. Acabei de te ligar sobre {{expedicao}}. Qual o melhor horário pra gente conversar?"),
      p(1, "ligacao", T, "Segunda tentativa do dia, em outro horário."),
      p(2, "ligacao", M, "Ligação de manhã."),
      p(2, "whatsapp", M, "{{primeiro_nome}}, separei as datas de {{expedicao}} pra te mostrar. Posso te ligar hoje?"),
      p(4, "ligacao", T, "Ligação num horário diferente do Dia 2."),
      p(4, "whatsapp", T, "Olha só como foi a última turma de {{expedicao}}: (mande foto ou depoimento)"),
      p(6, "ligacao", D, "Ligação manhã ou almoço."),
      p(8, "whatsapp", T, "{{primeiro_nome}}, as vagas de {{expedicao}} estão acabando. Quer que eu segure uma pra você enquanto conversamos?"),
      p(10, "whatsapp", D, "{{primeiro_nome}}, vou parar de te chamar por aqui pra não incomodar. Se ainda quiser viajar para {{expedicao}}, é só me responder."),
    ],
  },
  {
    id: "pos_live",
    nome: "Pós-live",
    resumo: "Assistiu a live. Contato no dia seguinte, com o assunto da live, e 5 dias curtos.",
    form: {
      name: "Pós-live",
      description: "Quem se inscreveu ou assistiu a live. Aproveitar o calor do conteúdo e levar pra reunião.",
      acquisition_channel: "levantada_de_mao",
      objective: "agendar_reuniao",
      priority: "alta",
      weekdays: [1, 2, 3, 4, 5],
      offday_policy: "aguardar_proximo_dia",
      auto_loss_days: 10,
      teto_entrada_dia: 40,
    },
    passos: [
      p(1, "whatsapp", M, "Oi {{primeiro_nome}}! Aqui é {{sdr}}, da Se Tu For, Eu Vou. Que bom que você esteve na live de {{expedicao}}! Ficou alguma dúvida?"),
      p(1, "ligacao", T, "Ligação pra entender o que mais chamou atenção na live."),
      p(2, "ligacao", M, "Segunda tentativa."),
      p(3, "whatsapp", T, "{{primeiro_nome}}, a condição especial da live de {{expedicao}} vale só até esta semana. Quer que eu te explique?"),
      p(5, "ligacao", D, "Último toque: oferecer a reunião com o especialista."),
    ],
  },
  {
    id: "resgate",
    nome: "Resgate base fria",
    resumo: "Base antiga, já perdida. Poucos toques, ângulo novo e teto de 30 leads/dia por SDR.",
    form: {
      name: "Resgate — base fria",
      description: "Leads antigos que não fecharam. Retomar com uma novidade, sem insistir demais.",
      acquisition_channel: "resgate",
      objective: "agendar_reuniao",
      priority: "media",
      weekdays: [1, 2, 3, 4, 5],
      offday_policy: "aguardar_proximo_dia",
      auto_loss_days: 14,
      teto_entrada_dia: 30,
    },
    passos: [
      p(1, "whatsapp_modelo", M, "Primeiro toque por modelo (a pessoa não fala com a gente há mais de 24h)."),
      p(2, "ligacao", D, "Ligação curta. Descobrir se o motivo de antes (tempo, orçamento) mudou."),
      p(5, "whatsapp", M, "{{primeiro_nome}}, abriu turma nova de {{expedicao}} com datas que talvez encaixem melhor pra você. Quer ver?"),
      p(7, "ligacao", T, "Último toque. Sem resposta, o lead volta a perdido sozinho."),
    ],
  },
  {
    id: "reengajamento",
    nome: "Reengajamento",
    resumo: "Lead que sumiu no meio da conversa. 3 toques em uma semana pra retomar.",
    form: {
      name: "Reengajamento",
      description: "Lead que já conversou com a gente e parou de responder.",
      acquisition_channel: "levantada_de_mao",
      objective: "agendar_reuniao",
      priority: "media",
      weekdays: [1, 2, 3, 4, 5],
      offday_policy: "aguardar_proximo_dia",
      auto_loss_days: 10,
      teto_entrada_dia: null,
    },
    passos: [
      p(1, "whatsapp", M, "Oi {{primeiro_nome}}! Aqui é {{sdr}}. Ficou alguma dúvida sobre {{expedicao}}? Posso te ajudar com isso agora."),
      p(3, "ligacao", T, "Ligar e retomar do ponto em que a conversa parou."),
      p(6, "whatsapp", D, "{{primeiro_nome}}, ainda faz sentido pra você viajar para {{expedicao}}? Se não for o momento, me avisa que eu te chamo mais pra frente."),
    ],
  },
];
