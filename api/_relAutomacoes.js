// api/_relAutomacoes.js
// -----------------------------------------------------------------------------
// AUTOMAÇÕES DO RELACIONAMENTO SEM ENVIO REAL (0218, 28/10/2026).
//
// Dois caminhos que NÃO falam com a Meta:
//   • canal 'tarefa'  → a mensagem pronta vira tarefa: linha 'tarefa' na fila
//     (rel_envios) + aviso no sino de quem cuida da viagem. A atendente manda
//     à mão e marca "Mandei" (rel_envio_tarefa_feita).
//   • canal 'whatsapp' em MODO SIMULAÇÃO → linha 'simulado' na fila, com o
//     texto exato que sairia. Nada é enviado.
//
// Modo real só quando as DUAS chaves estão ligadas:
//   rel_rotinas_config.automacoes_envio_real = true  (a tela, admin)
//   REL_AUTOMACOES_ENVIO_REAL=1                      (env na Vercel)
// TODO(frente "disparo"): quando o motor oficial de disparo existir, o envio
// real das automações passa a ser ENFILEIRAR nele (status 'pendente' aqui +
// chamada do motor) em vez do enviarUm() direto de api/rel-disparos.js. O
// ponto de troca é o `if (real)` de rodarAutomacoes() lá.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

/** As duas chaves do envio real. Qualquer dúvida (erro de leitura) = simulação. */
export async function envioRealLigado() {
  if (String(process.env.REL_AUTOMACOES_ENVIO_REAL || '').trim() !== '1') return false;
  const cfg = (await rest('rel_rotinas_config?select=automacoes_envio_real&id=eq.true&limit=1').catch(() => null))?.[0];
  return cfg?.automacoes_envio_real === true;
}

const cache = new Map();
async function viagem(id) {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  const v = (await rest(`rel_viagens?select=id,titulo,destino,data_embarque,responsavel_id&id=eq.${id}&limit=1`).catch(() => null))?.[0] || null;
  cache.set(id, v);
  return v;
}

/** Valores das variáveis SEM criar nada (links viram um aviso entre colchetes). */
async function valores(alvo) {
  const vg = await viagem(alvo.viagem_id);
  return {
    nome: String(alvo.nome || '').trim().split(/\s+/)[0] || '',
    destino: vg?.destino || vg?.titulo || '',
    data_embarque: dataBR(vg?.data_embarque),
    link_documentos: '[link de documentos — criado no envio]',
    link_pesquisa: '[link da pesquisa — criado no envio]',
  };
}

/** Modelo da Meta ({{1}}, {{2}}…) com o mapa de fontes da automação. */
export async function textoDoModelo(a, alvo) {
  const corpo = String(a.modelo_corpo || '');
  const v = await valores(alvo);
  if (!corpo) return `[modelo ${a.modelo_nome}] ` + Object.entries(a.params || {}).map(([k, cfg]) => `{{${k}}}=${cfg?.fonte === 'texto' ? cfg?.valor || '' : v[cfg?.fonte] || ''}`).join(' · ');
  return corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => {
    const cfg = a.params?.[k];
    if (!cfg) return `[${k}]`;
    return cfg.fonte === 'texto' ? String(cfg.valor || '') : (v[cfg.fonte] ?? `[${k}]`);
  });
}

/** Texto livre da tarefa: {nome}, {destino}, {data_embarque}, {link_pesquisa}, {link_documentos}. */
export async function textoDaTarefa(a, alvo) {
  const v = await valores(alvo);
  return String(a.texto || '').replace(/\{\s*(nome|destino|data_embarque|link_pesquisa|link_documentos)\s*\}/g, (_, k) => v[k] || '');
}

/**
 * Processa UMA automação sem envio real (tarefa, ou WhatsApp em simulação).
 * Grava cada alvo na fila com a mesma `chave` do envio real — rodar de novo
 * no mesmo dia não duplica. Devolve o resumo no formato de rodarAutomacoes().
 */
export async function processarSemEnvio(a, alvos, { hoje, prazo }) {
  cache.clear();
  const r = { id: a.id, nome: a.nome, novos: 0, enviados: 0, pulados: 0, falhas: 0, simulados: 0, tarefas: 0 };
  const tarefa = a.canal === 'tarefa';
  for (const alvo of alvos) {
    if (Date.now() > prazo) { r.cortado = true; break; }
    const chave = `aut:${a.id}:${alvo.cliente_id}:${alvo.viagem_id || '-'}:${hoje}`;
    const motivoPulo = !tarefa && !alvo.telefone ? 'sem telefone' : alvo.optout ? 'pediu para não receber' : null;
    let texto = null;
    try { texto = tarefa ? await textoDaTarefa(a, alvo) : await textoDoModelo(a, alvo); } catch { texto = null; }
    const resp = tarefa ? ((await viagem(alvo.viagem_id))?.responsavel_id || a.tarefa_para || a.criado_por || null) : null;
    const status = motivoPulo ? 'pulado' : tarefa ? 'tarefa' : 'simulado';
    const novo = await rest('rel_envios?on_conflict=chave', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: {
        automacao_id: a.id, cliente_id: alvo.cliente_id, viagem_id: alvo.viagem_id, telefone: alvo.telefone, chave,
        status, motivo: motivoPulo || (tarefa ? null : 'modo simulação: não enviado'), texto, responsavel_id: resp,
        enviado_em: status === 'simulado' ? new Date().toISOString() : null,
      },
    }).catch(() => null);
    const envio = novo?.[0];
    if (!envio) continue; // já registrado hoje
    r.novos++;
    if (status === 'pulado') r.pulados++;
    else if (status === 'tarefa') {
      r.tarefas++;
      if (resp) {
        await rest('qs_avisos?on_conflict=user_id,chave', {
          method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
          body: {
            user_id: resp, tipo: 'tarefa', area: 'relacionamento',
            titulo: `Mandar mensagem: ${String(alvo.nome || 'cliente').split(/\s+/)[0]} (${a.nome})`.slice(0, 200),
            texto: String(texto || '').slice(0, 400), link: '#rel/automacoes',
            origem: 'rel_envio', origem_id: envio.id, chave: `rel-tarefa:${envio.id}`,
          },
        }).catch(() => null);
      }
    } else r.simulados++;
  }
  await rest(`rel_automacoes?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_execucao: new Date().toISOString() } }).catch(() => null);
  return r;
}
