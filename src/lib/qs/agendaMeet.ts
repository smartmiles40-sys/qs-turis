// src/lib/qs/agendaMeet.ts
// -----------------------------------------------------------------------------
// Ponte do QS com o Google Calendar (via /api/agenda-meet → n8n).
//
// Três ações, um endpoint só: criar, reagendar e cancelar.
//
// A regra mais importante do contrato, e a mais fácil de errar: **o webhook
// SEMPRE responde HTTP 200**. Quem diz se deu certo é o campo `ok` do corpo.
// Tratar 200 como sucesso faria o QS gravar link vazio e dar reunião por
// marcada quando o Google recusou.
//
// E nada aqui derruba o fluxo de quem chamou: a reserva no Supabase já
// aconteceu antes. Google fora do ar vira aviso, nunca exceção — a reunião
// existe, só está sem sala, e o job de reconciliação recria depois.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";

export interface RespostaAgenda {
  ok: boolean;
  /** Link da sala do Meet, quando o Google devolveu um. */
  meetLink?: string | null;
  htmlLink?: string | null;
  eventId?: string | null;
  /** Motivo curto pra mostrar ao usuário (só quando ok = false). */
  aviso?: string;
  /** A integração nem está ligada — ausência, não falha. */
  desligado?: boolean;
  /** O evento sumiu do Google: quem chamou deve recriar com "criar". */
  precisaRecriar?: boolean;
  /** O evento já existia (clique duplo). Sucesso: o link devolvido é o mesmo. */
  duplicado?: boolean;
  /** Evento criado, mas o Google não devolveu sala. Mostrar reunião sem link. */
  semMeet?: boolean;
  /** E-mails malformados que o n8n descartou — vale avisar quem agendou. */
  convidadosDescartados?: string[];
}

type Acao = "criar" | "reagendar" | "cancelar";

interface Entrada {
  meetingId: string;
  eventId?: string | null;
  titulo?: string;
  descricao?: string;
  inicio?: string;
  fim?: string;
  convidados?: string[];
}

async function chamar(acao: Acao, dados: Entrada): Promise<RespostaAgenda> {
  try {
    const { data: sessao } = await supabase.auth.getSession();
    const token = sessao?.session?.access_token;
    if (!token) return { ok: false, aviso: "sessão expirada" };

    const r = await fetch("/api/agenda-meet", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ access_token: token, acao, ...dados }),
    });

    // 501 = N8N_AGENDA_URL não configurada. Silêncio: quem não ligou a
    // integração não precisa ver erro toda vez que agenda.
    if (r.status === 501) return { ok: false, desligado: true };

    const json = await r.json().catch(() => null);
    if (!json) return { ok: false, aviso: `resposta ilegível (HTTP ${r.status})` };

    if (!json.ok) {
      return {
        ok: false,
        aviso: json.erro || json.error || `falha ${json.codigo ?? r.status}`,
        // "nao_encontrado" no reagendar = evento apagado no Google por fora.
        precisaRecriar: json.codigo === "nao_encontrado",
      };
    }

    return {
      ok: true,
      eventId: json.event_id ?? null,
      meetLink: json.meet_link ?? null,
      htmlLink: json.html_link ?? null,
      duplicado: json.duplicado === true,
      semMeet: json.sem_meet === true,
      convidadosDescartados: Array.isArray(json.convidados_descartados) ? json.convidados_descartados : [],
    };
  } catch (e) {
    return { ok: false, aviso: e instanceof Error ? e.message : "falha de rede" };
  }
}

/** Cria o evento com sala do Meet. Idempotente pelo meeting_id (409 → mesma sala). */
export function criarEvento(dados: Entrada): Promise<RespostaAgenda> {
  return chamar("criar", dados);
}

/**
 * Move o evento de horário mantendo a MESMA sala — o cliente que já tem o link
 * continua com o link certo, e o Google reenvia o convite sozinho.
 * Se o evento tiver sumido do Google, recria automaticamente.
 */
export async function reagendarEvento(dados: Entrada): Promise<RespostaAgenda> {
  const r = await chamar("reagendar", dados);
  if (r.precisaRecriar) {
    // Contrato do n8n: "nao_encontrado" → o QS deve chamar criar com o mesmo
    // meeting_id e gravar o event_id novo. Fazer isso aqui evita que cada tela
    // tenha que lembrar dessa regra.
    return criarEvento({ ...dados, eventId: null });
  }
  return r;
}

/** Apaga o evento. Idempotente: evento inexistente também é sucesso. */
export function cancelarEvento(dados: Entrada): Promise<RespostaAgenda> {
  return chamar("cancelar", dados);
}
