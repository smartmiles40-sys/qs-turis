// src/lib/qs/waDesconhecidos.ts
// -----------------------------------------------------------------------------
// Quem escreveu no WhatsApp da empresa e não é lead do QS.
//
// O webhook registra cada mensagem que não achou dono em `qs_wa_descartadas`
// (migration 0038). Até a 0047 essa tabela era um LOG: 312 linhas em uma semana
// e nenhuma tela do app lendo. Log que ninguém abre não avisa ninguém.
//
// Aqui ela vira FILA DE TRABALHO. O que medi na base em 13/08, nos 50 números
// reais que estavam lá:
//
//   32 → era CORRIDA (o lead nasceu segundos depois). Isso o servidor resolve
//        sozinho agora, no resgate pendurado na criação do lead — não chega a
//        esta tela.
//   13 → existem no Bitrix mas não no QS: cliente antigo, pós-venda e três
//        números do próprio time.
//    5 → gente nova de verdade, que nunca falou com a agência.
//
// Por isso a triagem é MANUAL e não vira lead automático: dos 18 que sobram,
// vários não são oportunidade nenhuma, e um card de prospecção pra cada colega
// de trabalho ensinaria o time a ignorar a tela inteira.
//
// O CONTEÚDO da mensagem não é guardado aqui — a decisão de LGPD da 0038
// continua valendo. A tela mostra quem, quando e por qual número; o texto está
// no Chatwoot pra quem precisar abrir.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { notifyError } from "@/lib/qs/notify";

/** Um NÚMERO que escreveu — as várias mensagens dele vêm agrupadas. */
export interface Desconhecido {
  /** Ids das linhas de descarte deste número (é o que se carimba ao tratar). */
  ids: number[];
  phone: string;
  nome: string | null;
  inboxId: number | null;
  mensagens: number;
  primeira: string;
  ultima: string;
  /**
   * Preenchido quando o lead JÁ existe e só a conversa nunca foi puxada. Aqui a
   * saída não é criar lead (duplicaria a pessoa — e a base já tem 68 casos
   * assim), é trazer a conversa.
   */
  leadId: string | null;
}

export interface ListaDesconhecidos {
  itens: Desconhecido[];
  /** true = a 0047 ainda não foi colada; a tela explica em vez de mentir "0". */
  precisaMigration: boolean;
}

interface LinhaBruta {
  id: number;
  phone: string | null;
  contato_nome: string | null;
  inbox_id: number | null;
  created_at: string;
  lead_id: string | null;
}

/**
 * Agrupa por telefone: a tabela tem uma linha por MENSAGEM, e a pessoa que
 * mandou cinco mensagens é uma pessoa só — cinco linhas iguais na tela dariam a
 * impressão de cinco oportunidades.
 */
function agrupar(linhas: LinhaBruta[]): Desconhecido[] {
  const mapa = new Map<string, Desconhecido>();
  for (const l of linhas) {
    const phone = (l.phone || "").trim();
    if (!phone) continue;
    const atual = mapa.get(phone);
    if (!atual) {
      mapa.set(phone, {
        ids: [l.id],
        phone,
        nome: l.contato_nome || null,
        inboxId: l.inbox_id ?? null,
        mensagens: 1,
        primeira: l.created_at,
        ultima: l.created_at,
        leadId: l.lead_id || null,
      });
      continue;
    }
    atual.ids.push(l.id);
    atual.mensagens += 1;
    // A consulta vem do mais novo pro mais antigo.
    atual.primeira = l.created_at;
    if (!atual.nome && l.contato_nome) atual.nome = l.contato_nome;
    if (!atual.leadId && l.lead_id) atual.leadId = l.lead_id;
  }
  return [...mapa.values()].sort((a, b) => (a.ultima < b.ultima ? 1 : -1));
}

export async function listDesconhecidos(limite = 500): Promise<ListaDesconhecidos> {
  const { data, error } = await supabase
    .from("qs_wa_descartadas")
    .select("id, phone, contato_nome, inbox_id, created_at, lead_id")
    .eq("situacao", "pendente")
    .eq("motivo", "sem-lead-correspondente")
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) {
    // 42703/PGRST204 = a coluna `situacao` não existe ainda. Sem ela não dá pra
    // separar o que já foi tratado do que não foi, e mostrar a lista inteira
    // faria a triagem nascer com 32 casos já resolvidos dentro.
    if (/situacao|42703|PGRST204/i.test(`${error.code} ${error.message}`)) {
      return { itens: [], precisaMigration: true };
    }
    console.warn("[wa] desconhecidos:", error);
    notifyError("Não foi possível carregar quem escreveu sem lead.");
    return { itens: [], precisaMigration: false };
  }

  return { itens: agrupar((data as LinhaBruta[]) || []), precisaMigration: false };
}

/** Quantos números esperam triagem (para o selo na aba de WhatsApp). */
export async function countDesconhecidos(): Promise<number> {
  const { itens } = await listDesconhecidos(500);
  return itens.length;
}

async function carimbar(
  ids: number[],
  patch: { situacao: "ignorada" | "virou_lead" | "resgatada"; lead_id?: string | null }
): Promise<boolean> {
  const { data: sessao } = await supabase.auth.getUser();
  const { error, data } = await supabase
    .from("qs_wa_descartadas")
    .update({ ...patch, tratado_em: new Date().toISOString(), tratado_por: sessao?.user?.id ?? null })
    .in("id", ids)
    .select("id");

  if (error) {
    console.warn("[wa] carimbar descarte:", error);
    notifyError("Não foi possível registrar a decisão. Tente de novo.");
    return false;
  }
  // A RLS só deixa a gestão tratar. Sem esta checagem, um SDR veria o item
  // sumir da tela e voltar no próximo carregamento, sem erro nenhum.
  if (!data || data.length === 0) {
    notifyError("Sem permissão para tratar esta lista (só gestão).");
    return false;
  }
  return true;
}

/** Não é oportunidade: colega de trabalho, engano, robô. Some da fila. */
export function ignorarDesconhecido(ids: number[]): Promise<boolean> {
  return carimbar(ids, { situacao: "ignorada" });
}

/** Virou lead: a linha sai da fila apontando pro lead criado. */
export function vincularDesconhecido(ids: number[], leadId: string): Promise<boolean> {
  return carimbar(ids, { situacao: "virou_lead", lead_id: leadId });
}

/** O lead já existia e a conversa acabou de ser puxada pra ele. */
export function marcarResgatado(ids: number[], leadId: string): Promise<boolean> {
  return carimbar(ids, { situacao: "resgatada", lead_id: leadId });
}
