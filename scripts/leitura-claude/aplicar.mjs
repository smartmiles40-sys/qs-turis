// scripts/leitura-claude/aplicar.mjs
// -----------------------------------------------------------------------------
// LEITURA FEITA PELO CLAUDE — passo 2: grava o que foi lido à mão e roda o
// MESMO caminho da revisão da IA (cruzar → trechos → % que bate → ia_revisao).
//
// Entrada: um JSON
//   {
//     "viagem_id": "...",
//     "leituras": { "<documento_id>": { legivel, tipo_detectado, passageiros, localizador,
//                                       segmentos: [...], seguro, observacao },
//                   "bitrix": { ...mesmo formato, lido dos campos de texto do Bitrix } },
//     "notas": ["o que os comentários do Bitrix dizem que importa", ...],
//     "divergencias": [{ "gravidade": "alta|media|baixa", "texto": "..." }]
//   }
// O formato de cada leitura é o ESQUEMA de api/rel-viagem-ia.js.
//
// Uso: node scripts/leitura-claude/aplicar.mjs <arquivo.json> [mais.json…]
// -----------------------------------------------------------------------------
import fs from 'node:fs';

for (const l of fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const { revisar } = await import('../../api/rel-viagem-ia.js');
const { rest } = await import('../../api/_supabaseAdmin.js');

const CAMPOS_SEG = ['categoria', 'origem', 'origem_codigo', 'origem_pais', 'destino', 'destino_codigo', 'destino_pais',
  'partida_local', 'partida_fuso', 'chegada_local', 'chegada_fuso', 'companhia', 'numero', 'classe', 'bagagem', 'nome_local',
  'terminal_partida', 'terminal_chegada', 'assento', 'numero_bilhete', 'passageiros', 'ponto_encontro', 'contato', 'endereco', 'observacao'];

/** Completa o que faltar com null (o agente pode omitir campo). */
function normalizar(l) {
  return {
    legivel: l.legivel !== false,
    tipo_detectado: l.tipo_detectado || 'outro',
    passageiros: Array.isArray(l.passageiros) ? l.passageiros : [],
    localizador: l.localizador ?? null,
    segmentos: (l.segmentos || []).map((s) => Object.fromEntries(CAMPOS_SEG.map((k) => [k, k === 'passageiros' ? (Array.isArray(s[k]) ? s[k] : []) : (s[k] ?? null)]))),
    seguro: l.seguro ? { seguradora: null, apolice: null, vigencia_inicio: null, vigencia_fim: null, segurados: [], cobertura: null, ...l.seguro } : null,
    observacao: l.observacao ?? null,
  };
}

for (const arq of process.argv.slice(2)) {
  try {
    const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const prontas = new Map(Object.entries(j.leituras || {}).map(([k, v]) => [k, normalizar(v)]));
    const r = await revisar(j.viagem_id, Date.now() + 10 * 60_000, prontas, 'claude (leitura manual)');
    const extrasDiv = (j.divergencias || []).filter((d) => d?.texto).map((d) => ({ gravidade: ['alta', 'media', 'baixa'].includes(d.gravidade) ? d.gravidade : 'media', texto: String(d.texto), documento_id: null }));
    const notas = (j.notas || []).filter(Boolean).map((n) => `Comentários do Bitrix: ${n}`);
    if (extrasDiv.length || notas.length) {
      const ia = r.ia_revisao;
      ia.divergencias = [...ia.divergencias, ...extrasDiv];
      ia.avisos = [...ia.avisos, ...notas];
      const status = extrasDiv.some((d) => d.gravidade !== 'baixa') ? 'divergente' : r.status;
      await rest(`rel_viagens?id=eq.${j.viagem_id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ia_revisao: ia, ia_revisao_status: status } });
      r.status = status;
    }
    console.log(`${j.viagem_id}: ${r.status} · ${r.ia_revisao.segmentos.length} trecho(s) · ${r.ia_revisao.conformidade?.pct ?? '-'}% · +${r.ia_revisao.trechos?.novos ?? 0} novos`);
  } catch (e) {
    console.log(`${arq}: ERRO ${e.message}`);
  }
}
