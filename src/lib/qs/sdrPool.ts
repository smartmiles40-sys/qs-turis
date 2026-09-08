// src/lib/qs/sdrPool.ts
// -----------------------------------------------------------------------------
// Helper do front pra tela "Números do WhatsApp".
//
// Tudo passa por /api/sdr-pool porque as funções que mexem no pool são
// SECURITY DEFINER e só respondem pra service_role — a anon key do bundle não
// executa nenhuma delas. O access_token da sessão vai no corpo, e o servidor
// confere que quem pediu é admin ou gestor.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export interface CardSdr {
  sdr_id: string;
  nome: string;
  email: string;
  pool_id: string | null;
  /** Só dígitos, com DDI: 5511999999999. Nulo quando o SDR está sem chip. */
  numero: string | null;
  status: "ativo" | "sem-numero";
  desde: string | null;
  leads_7d: number;
  reservas_7d: number;
}

export interface NumeroReserva {
  id: string;
  numero: string;
  created_at: string;
}

export interface NumeroQueimado {
  id: string;
  numero: string;
  sdr_nome: string | null;
  updated_at: string;
}

export interface PainelNumeros {
  ok: true;
  dias: number;
  sdrs: CardSdr[];
  /** Quem leva o próximo lead que entrar por uma LP. */
  proximo_sdr_id: string | null;
  reservas: NumeroReserva[];
  queimados: NumeroQueimado[];
}

type Acao = "listar" | "desativar" | "trocar";

async function chamar(action: Acao, sdr_id?: string): Promise<PainelNumeros> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão expirada. Entre de novo para gerenciar os números.");
  }
  const res = await fetch("/api/sdr-pool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: session.access_token, action, sdr_id }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || "Não consegui falar com o servidor.");
  }
  return json as PainelNumeros;
}

export const carregarNumeros = () => chamar("listar");

/** Tira o chip do ar. O SDR sai do rodízio das LPs na chamada seguinte. */
export const desativarNumero = (sdrId: string) => chamar("desativar", sdrId);

/** Queima o chip atual e promove a reserva mais antiga (a mais aquecida). */
export const trocarPorReserva = (sdrId: string) => chamar("trocar", sdrId);

/**
 * 5511987654321 -> +55 (11) 98765-4321
 *
 * A tela mostra formatado porque é gente do comercial conferindo se o número na
 * tela é o mesmo do chip na mão. Mas o que trafega e o que fica gravado é
 * sempre só dígito — máscara em banco é o começo de todo bug de telefone.
 */
export function numeroBonito(n: string | null | undefined): string {
  const d = String(n ?? "").replace(/\D/g, "");
  if (d.length < 12 || d.length > 13) return d || "—";
  const ddi = d.slice(0, 2);
  const ddd = d.slice(2, 4);
  const resto = d.slice(4);
  const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
  const fim = resto.length === 9 ? resto.slice(5) : resto.slice(4);
  return `+${ddi} (${ddd}) ${meio}-${fim}`;
}
