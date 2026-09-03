// src/lib/qs/carteiraSaude.ts
// -----------------------------------------------------------------------------
// A SAUDE DA CARTEIRA — o lado do navegador.
//
// A conta em si NAO mora aqui: mora no banco, nas funcoes da migration 0074
// (`qs_carteira_saude` e `qs_carteira_saude_serie`). A razao e o teto de 1000 do
// PostgREST: a carteira do time passa de 2 mil leads, e uma media calculada em
// cima de uma lista truncada nao dá erro — dá um número errado com cara de
// certo. Agregado no banco, o teto não existe.
//
// Aqui ficam três coisas: a RÉGUA (que é configuração, não conta), as chamadas
// das funções, e a tradução de nota em faixa/cor.
//
// -- O QUE A NOTA MEDE, E O QUE ELA NÃO MEDE ---------------------------------
//
// Mede UMA coisa só, por decisão do Bruno (03/09/2026): a velocidade com que o
// SDR conclui a PRIMEIRA atividade de cada lead novo. Não é um índice
// composto. Lead de tráfego pago esfria em horas — quem responde em 40 minutos
// conversa com outra pessoa, não com o mesmo lead mais tarde.
//
// O relógio é de HORAS ÚTEIS, não de parede. Sem isso a nota mentia de um jeito
// visível: lead que chega domingo 14h e é trabalhado segunda 10h aparecia como
// 20 horas de demora, e a série mostrava um tombo em todo domingo. Punir alguém
// por um dia em que ninguém trabalha destrói a métrica na primeira semana.
//
// Ela NÃO mede volume, conversão nem qualidade da conversa. Esses números estão
// ao lado, como métricas próprias, justamente pra ninguém confundir a nota com
// "o SDR é bom".
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/qsSettings";

export const CARTEIRA_REGUA_KEY = "carteira_regua_velocidade";

/** Os quatro limites, em horas, que definem a curva da nota. */
export interface ReguaVelocidade {
  /** Até aqui é nota 100. Em horas ÚTEIS: madrugada e fim de semana não contam. */
  excelenteH: number;
  /** Até aqui a nota desce de 100 a 80. */
  bomH: number;
  /** Até aqui desce de 80 a 55. */
  aceitavelH: number;
  /** Aqui a nota chega a 0 — e leads sem nenhuma atividade concluída passados
   *  este prazo entram na média COMO ZERO (senão não tocar em ninguém daria
   *  média boa). */
  zeroH: number;
}

/**
 * O padrão saiu dos dados reais do time, não de chute — e os números são em
 * HORAS ÚTEIS (a conta desconta noite e fim de semana; ver qs_horas_uteis na
 * migration 0075). Medido em 03/09/2026, últimos 30 dias: mediana por pessoa
 * 0,6h / 0,9h / 1,3h de expediente.
 *
 * Com esta régua o time fica em 84 / 79 / 75 — todo mundo em "Boa", com o topo
 * ainda em disputa. É o ponto de equilíbrio que importa: uma régua onde todo
 * mundo já tira 95 não muda comportamento nenhum, e uma onde todo mundo tira 20
 * é ignorada na primeira semana.
 */
export const REGUA_PADRAO: ReguaVelocidade = {
  excelenteH: 0.5,
  bomH: 1,
  aceitavelH: 4,
  zeroH: 16,
};

/** Aceita lixo do banco e devolve uma régua utilizável, sempre crescente. */
export function normalizarRegua(bruto: unknown): ReguaVelocidade {
  const o = (bruto ?? {}) as Partial<ReguaVelocidade>;
  const n = (v: unknown, padrao: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : padrao;
  };
  const r: ReguaVelocidade = {
    excelenteH: n(o.excelenteH, REGUA_PADRAO.excelenteH),
    bomH: n(o.bomH, REGUA_PADRAO.bomH),
    aceitavelH: n(o.aceitavelH, REGUA_PADRAO.aceitavelH),
    zeroH: n(o.zeroH, REGUA_PADRAO.zeroH),
  };
  // Limites fora de ordem quebrariam a curva (divisão por zero ou nota subindo
  // com o atraso). Em vez de recusar, empurramos cada um pra frente do anterior.
  r.bomH = Math.max(r.bomH, r.excelenteH + 0.1);
  r.aceitavelH = Math.max(r.aceitavelH, r.bomH + 0.1);
  r.zeroH = Math.max(r.zeroH, r.aceitavelH + 0.1);
  return r;
}

export async function getRegua(): Promise<ReguaVelocidade> {
  const bruto = await getSetting<unknown>(CARTEIRA_REGUA_KEY);
  return bruto == null ? REGUA_PADRAO : normalizarRegua(bruto);
}

export async function setRegua(r: ReguaVelocidade): Promise<boolean> {
  return setSetting(CARTEIRA_REGUA_KEY, normalizarRegua(r));
}

/** Uma linha da Saúde da Carteira — um SDR. */
export interface SaudeSdr {
  owner_id: string;
  nome: string | null;
  papel: string;
  /** 0–100, ou null quando não houve lead medido na janela. */
  nota: number | null;
  leads_medidos: number;
  /** Mediana de horas entre o lead chegar e a 1ª atividade ser concluída. */
  horas_mediana: number | null;
  leads_ativos: number;
  leads_trabalhando: number;
  leads_esquecidos: number;
  atividades_abertas: number;
  atividades_atrasadas: number;
  concluidas_hoje: number;
}

export interface PontoSerie {
  owner_id: string;
  dia: string;
  nota: number | null;
  leads: number;
}

function paramsDaRegua(r: ReguaVelocidade) {
  return {
    p_excelente: r.excelenteH,
    p_bom: r.bomH,
    p_aceitavel: r.aceitavelH,
    p_zero: r.zeroH,
  };
}

/** Números decimais chegam como string do PostgREST (numeric). */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchSaude(regua: ReguaVelocidade, dias = 30): Promise<SaudeSdr[]> {
  const { data, error } = await supabase.rpc("qs_carteira_saude", {
    p_dias: dias,
    ...paramsDaRegua(regua),
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    owner_id: String(r.owner_id),
    nome: (r.nome as string) ?? null,
    papel: String(r.papel ?? ""),
    nota: num(r.nota),
    leads_medidos: Number(r.leads_medidos ?? 0),
    horas_mediana: num(r.horas_mediana),
    leads_ativos: Number(r.leads_ativos ?? 0),
    leads_trabalhando: Number(r.leads_trabalhando ?? 0),
    leads_esquecidos: Number(r.leads_esquecidos ?? 0),
    atividades_abertas: Number(r.atividades_abertas ?? 0),
    atividades_atrasadas: Number(r.atividades_atrasadas ?? 0),
    concluidas_hoje: Number(r.concluidas_hoje ?? 0),
  }));
}

export async function fetchSerie(regua: ReguaVelocidade, dias = 14): Promise<PontoSerie[]> {
  const { data, error } = await supabase.rpc("qs_carteira_saude_serie", {
    p_dias: dias,
    ...paramsDaRegua(regua),
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    owner_id: String(r.owner_id),
    dia: String(r.dia),
    nota: num(r.nota),
    leads: Number(r.leads ?? 0),
  }));
}

export interface FaixaNota {
  rotulo: string;
  cor: string;
  fundo: string;
}

/**
 * A faixa da nota. Os cortes são os mesmos das cores do QS (verde/âmbar/vermelho)
 * e existem pra tela dizer o que fazer, não só qual é o número: 62 e 84 são
 * ambos "amarelos" num degradê contínuo, mas só um deles merece uma conversa.
 */
export function faixaDaNota(nota: number | null): FaixaNota {
  if (nota === null) return { rotulo: "Sem dados", cor: "#64748B", fundo: "rgba(100,116,139,.10)" };
  if (nota >= 85) return { rotulo: "Excelente", cor: "#0E7C6A", fundo: "rgba(18,161,138,.13)" };
  if (nota >= 70) return { rotulo: "Boa", cor: "#0147FF", fundo: "rgba(1,71,255,.10)" };
  if (nota >= 50) return { rotulo: "Atenção", cor: "#B45309", fundo: "rgba(180,83,9,.12)" };
  return { rotulo: "Crítica", cor: "#DC2626", fundo: "rgba(220,38,38,.12)" };
}

/** "1.8" → "1h48". Tempo em horas decimais é ilegível pra quem não é analista. */
export function horasHumanas(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  const horas = Math.floor(h);
  const min = Math.round((h - horas) * 60);
  if (horas >= 24) {
    const d = Math.floor(horas / 24);
    return `${d}d ${horas % 24}h`;
  }
  return min > 0 ? `${horas}h${String(min).padStart(2, "0")}` : `${horas}h`;
}
