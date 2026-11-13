// api/_mktPlanRegras.js — regras PURAS do planejamento de conteúdo (0395).
// A MESMA regra mora em três lugares: aqui (rota da agência), em
// src/mkt/planejamento/regras.ts (tela) e em mkt_plan_item_faltas() (banco, a
// trava de verdade). tests/mkt-planejamento/regras.test.ts confere aqui x tela.

export const FORMATOS = ['reels', 'carrossel', 'estatico', 'story', 'video_longo', 'outro'];

export const NOME_FALTA = {
  titulo: 'título',
  formato: 'formato',
  referencia: 'referência (link)',
  adaptacao: 'como vai ser adaptado para a nossa marca',
  perfil: 'onde vai ser postado (perfil)',
  data: 'data de postagem',
  data_fora: 'data fora do período do planejamento',
  horario: 'horário',
  sem_itens: 'nenhum conteúdo no planejamento',
};

const LINK = /^https?:\/\/\S+$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * O que falta num conteúdo.
 * @param {{titulo?:string, formato?:string|null, referencias?:string[], adaptacao?:string|null,
 *          perfil_ids?:string[], data_postagem?:string|null, horario?:string|null}} item
 * @param {{periodo_inicio:string, periodo_fim:string}} plan
 * @param {string[]} perfisAtivos ids dos perfis ativos
 * @returns {string[]}
 */
export function faltasDoItem(item, plan, perfisAtivos) {
  const f = [];
  if (String(item.titulo ?? '').trim().length < 3) f.push('titulo');
  if (!item.formato || !FORMATOS.includes(item.formato)) f.push('formato');
  if (!(item.referencias ?? []).some((r) => LINK.test(String(r).trim()))) f.push('referencia');
  if (String(item.adaptacao ?? '').trim().length < 20) f.push('adaptacao');
  const perfis = item.perfil_ids ?? [];
  if (perfis.length === 0 || perfis.some((p) => !perfisAtivos.includes(p))) f.push('perfil');
  const d = item.data_postagem ?? '';
  if (!DATA.test(d)) f.push('data');
  else if (d < plan.periodo_inicio || d > plan.periodo_fim) f.push('data_fora');
  if (!HORA.test(String(item.horario ?? ''))) f.push('horario');
  return f;
}

/** Pendências do planejamento inteiro (mesmo formato de mkt_plan_faltas()). */
export function faltasDoPlanejamento(plan, itens, perfisAtivos) {
  if (!itens.length) return [{ item_id: null, faltas: ['sem_itens'] }];
  return itens
    .map((i, n) => ({ item_id: i.id ?? null, ordem: i.ordem ?? n, titulo: i.titulo ?? '', faltas: faltasDoItem(i, plan, perfisAtivos) }))
    .filter((x) => x.faltas.length > 0);
}

/** Frase curta pra devolver à agência: "Conteúdo 3 (ALTO EM): falta horário, perfil". */
export function textoDasFaltas(pendencias) {
  return pendencias.map((p) => {
    if (p.faltas.includes('sem_itens')) return NOME_FALTA.sem_itens;
    const nome = p.titulo ? ` (${String(p.titulo).slice(0, 60)})` : '';
    return `Conteúdo ${Number(p.ordem ?? 0) + 1}${nome}: falta ${p.faltas.map((x) => NOME_FALTA[x] ?? x).join(', ')}`;
  });
}

/** Período válido pra periodicidade: semanal até 7 dias, diário 1 dia, mensal até 31. */
export function periodoValido(periodicidade, inicio, fim) {
  if (!DATA.test(inicio ?? '') || !DATA.test(fim ?? '') || fim < inicio) return 'Período inválido.';
  const dias = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86_400_000) + 1;
  if (periodicidade === 'diario' && dias !== 1) return 'Planejamento diário é de um dia só.';
  if (periodicidade === 'semanal' && dias > 7) return 'Planejamento semanal tem no máximo 7 dias.';
  if (periodicidade === 'mensal' && dias > 31) return 'Planejamento mensal tem no máximo 31 dias.';
  return null;
}

/** Link do Google Docs → endereço de exportar em PDF (só funciona se estiver "qualquer pessoa com o link"). */
export function exportarGoogleDocs(link) {
  const m = String(link ?? '').match(/^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? `https://docs.google.com/document/d/${m[1]}/export?format=pdf` : null;
}

/** Normaliza o que a IA devolveu (nunca confia no formato). */
export function normalizarItemIa(x, perfis) {
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const refs = Array.isArray(x?.referencias) ? x.referencias.map((r) => s(r, 500)).filter((r) => LINK.test(r)).slice(0, 5) : [];
  const nomes = Array.isArray(x?.perfis) ? x.perfis.map((p) => s(p, 60).toLowerCase()) : [];
  const perfil_ids = perfis.filter((p) => nomes.includes(p.nome.toLowerCase())).map((p) => p.id);
  const data = s(x?.data_postagem, 10);
  const hora = s(x?.horario, 5);
  return {
    titulo: s(x?.titulo, 200),
    formato: FORMATOS.includes(x?.formato) ? x.formato : null,
    referencias: refs,
    adaptacao: s(x?.adaptacao, 4000) || null,
    perfil_ids,
    data_postagem: DATA.test(data) ? data : null,
    horario: HORA.test(hora) ? hora : null,
  };
}
