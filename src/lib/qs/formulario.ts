// src/lib/qs/formulario.ts
// -----------------------------------------------------------------------------
// AS RESPOSTAS QUE O CLIENTE DEU NO FORMULÁRIO DA LP.
//
// Quem tem o dado é o card do Bitrix; quem sabe falar com o Bitrix é o servidor
// (`/api/lead-formulario`) — o token do portal não pode entrar no bundle. Este
// arquivo é só a ponte, com duas proteções que a tela do SDR exige:
//
//   1. CACHE POR LEAD na memória da aba. O mesmo lead aparece no card da fila e
//      na página dele; sem cache seriam duas idas ao servidor pra um dado que
//      não muda durante o atendimento.
//   2. DEDUPE DE CHAMADA EM VOO. O card e a página podem montar no mesmo
//      instante; sem isto, os dois disparariam o mesmo fetch.
//
// Falha NUNCA vira erro na tela: sem respostas, o bloco simplesmente não
// aparece. Este dado ajuda a conduzir a ligação — não pode atrapalhá-la.
// -----------------------------------------------------------------------------

import { authHeaders } from "@/lib/qs/waInbox";

export interface RespostaFormulario {
  /** O `UF_CRM_*` de origem — só diagnóstico, a tela não mostra. */
  campo: string;
  /** A pergunta, como está escrita no Bitrix hoje. */
  rotulo: string;
  /** A resposta já traduzida (lista do Bitrix guarda id, não texto). */
  valor: string;
}

export interface RespostasDoLead {
  respostas: RespostaFormulario[];
  atualizadoEm: string | null;
  /** "sem_card", "bitrix_indisponivel", "card_inexistente"… — vazio = tudo certo. */
  motivo: string | null;
}

const VAZIO: RespostasDoLead = { respostas: [], atualizadoEm: null, motivo: null };

const cache = new Map<string, RespostasDoLead>();
const emVoo = new Map<string, Promise<RespostasDoLead>>();

/** O que já foi lido nesta aba, pra primeira pintura não piscar. */
export function respostasEmCache(leadId: string): RespostasDoLead | null {
  return cache.get(leadId) ?? null;
}

export async function carregarRespostasDoFormulario(
  leadId: string,
  opcoes: { recarregar?: boolean } = {}
): Promise<RespostasDoLead> {
  if (!leadId) return VAZIO;
  if (!opcoes.recarregar) {
    const guardado = cache.get(leadId);
    if (guardado) return guardado;
    const andando = emVoo.get(leadId);
    if (andando) return andando;
  }

  const busca = (async (): Promise<RespostasDoLead> => {
    try {
      const url = `/api/lead-formulario?lead_id=${encodeURIComponent(leadId)}${opcoes.recarregar ? "&fresh=1" : ""}`;
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) {
        // 403/404 são respostas DEFINITIVAS (lead de outro SDR, lead apagado):
        // guardar o vazio evita que a pré-carga da fila pergunte de novo a cada
        // atualização da lista. Erro de servidor não é guardado — esse merece
        // nova tentativa.
        if (res.status === 403 || res.status === 404) cache.set(leadId, VAZIO);
        return VAZIO;
      }
      const data = (await res.json()) as {
        answers?: RespostaFormulario[];
        atualizado_em?: string | null;
        motivo?: string;
      };
      const resultado: RespostasDoLead = {
        respostas: Array.isArray(data.answers)
          ? data.answers.filter((r) => r && typeof r.rotulo === "string" && typeof r.valor === "string")
          : [],
        atualizadoEm: data.atualizado_em ?? null,
        motivo: data.motivo ?? null,
      };
      cache.set(leadId, resultado);
      return resultado;
    } catch {
      // Sem rede: não guarda no cache: a próxima montagem tenta de novo.
      return VAZIO;
    } finally {
      emVoo.delete(leadId);
    }
  })();

  emVoo.set(leadId, busca);
  return busca;
}
