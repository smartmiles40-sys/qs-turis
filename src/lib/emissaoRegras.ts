// src/lib/emissaoRegras.ts — carregar/salvar as regras de emissão futura
// (qs_settings "rel_regras_emissao"). Separado de emissao.ts pra que o cálculo
// fique puro (testável sem banco). Sem nada salvo, valem as REGRAS_PADRAO.
import { getSetting, setSetting } from "./qsSettings";
import { CHAVE_REGRAS, REGRAS_PADRAO, type RegraEmissao } from "./emissao";

let cache: RegraEmissao[] | null = null;

export async function carregarRegras(forcar = false): Promise<RegraEmissao[]> {
  if (cache && !forcar) return cache;
  const salvas = await getSetting<RegraEmissao[]>(CHAVE_REGRAS);
  cache = Array.isArray(salvas) && salvas.length ? salvas : REGRAS_PADRAO;
  return cache;
}

/** Só a gestão grava (policy de qs_settings). false = não salvou. */
export async function salvarRegras(regras: RegraEmissao[]): Promise<boolean> {
  const ok = await setSetting(CHAVE_REGRAS, regras);
  if (ok) cache = regras;
  return ok;
}
