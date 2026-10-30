// api/_mktGruposMotor.js
// -----------------------------------------------------------------------------
// O MOTOR das campanhas de grupo do Marketing (0243). Acordado pelo cron do QS
// (GET /api/mkt-grupos, Bearer CRON_SECRET — vercel.json, a cada minuto).
//
// Uma rodada, em ordem:
//   0) trava da instância (conexaoTravada): instância de outro setor = nada anda;
//   1) linha presa em "enviando" há > 5 min vira FALHA (não reenvia sozinho:
//      mensagem repetida em grupo todo mundo vê);
//   2) interruptores: MKT_GRUPOS_ENVIO=1 (Vercel, chave do Bruno) E
//      mkt_grupos_conexao.envio_ligado (tela, só admin). Qualquer um desligado:
//      a fila fica parada, nada sai;
//   3) recorrências → campanhas das próximas 24 h (idempotente no banco);
//   4) campanha agendada que venceu → monta a fila (uma linha por grupo);
//   5) janela de horário da conexão;
//   6) manda, um grupo por vez, respeitando o intervalo sorteado da campanha
//      (o "próximo envio" fica no banco: sobrevive entre rodadas);
//   7) fecha a campanha quando não sobra nada pendente.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { conexaoTravada, evoMkt } from './_mktGruposEvo.js';
import {
  linhaPresa, resolverGrupos, montarFila, resumirFila, campanhaTerminou, liberadaEm,
  dentroDaJanela, sortearIntervaloMs, intervalo, ocorrencias, campanhaDaOcorrencia,
  montarEnvio, envioDaFila, erroPermanente, traduzirErro,
} from './_mktGruposRegras.js';

const enc = encodeURIComponent;
const dormir = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
export const envioLigadoNoAmbiente = () => String(process.env.MKT_GRUPOS_ENVIO || '').trim() === '1';

async function soltarPresas(agora) {
  const limite = new Date(agora.getTime() - 5 * 60_000).toISOString();
  const presas = await rest(`mkt_grupos_envios?select=id,status,reivindicado_em&status=eq.enviando&reivindicado_em=lt.${enc(limite)}&limit=200`).catch(() => []);
  const ids = (presas || []).filter((l) => linhaPresa(l, agora)).map((l) => l.id);
  if (ids.length) {
    await rest(`mkt_grupos_envios?id=in.(${ids.join(',')})&status=eq.enviando`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { status: 'falha', erro: 'Interrompido no meio do envio. Confira no grupo antes de mandar de novo.' },
    });
  }
  return ids.length;
}

async function gerarRecorrencias(agora) {
  const recs = await rest('mkt_grupos_recorrencias?select=*&ativo=eq.true').catch(() => []);
  let criadas = 0;
  const ate = new Date(agora.getTime() + 24 * 3600_000);
  for (const rec of recs || []) {
    const de = rec.gerado_ate ? new Date(Math.max(Date.parse(rec.gerado_ate), agora.getTime() - 60_000)) : new Date(agora.getTime() - 60_000);
    const datas = ocorrencias(rec, de, ate);
    if (datas.length) {
      const linhas = datas.map((iso) => campanhaDaOcorrencia(rec, iso));
      await rest('mkt_grupos_campanhas?on_conflict=recorrencia_id,enviar_em', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: linhas,
      });
      criadas += linhas.length;
    }
    await rest(`mkt_grupos_recorrencias?id=eq.${rec.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { gerado_ate: ate.toISOString() } }).catch(() => null);
  }
  return criadas;
}

/** Os grupos e as tags, pra resolver o destino (o motor e a prévia usam igual). */
export async function lerGruposETags() {
  const [grupos, links] = await Promise.all([
    rest('mkt_grupos?select=jid,nome,saiu_em,eu_admin,so_admins_enviam&limit=5000'),
    rest('mkt_grupos_tag_links?select=tag_id,grupo_jid&limit=20000'),
  ]);
  return { grupos: grupos || [], links: links || [] };
}

async function montarFilas(agora) {
  const vencidas = await rest(`mkt_grupos_campanhas?select=*&status=eq.agendada&enviar_em=lte.${enc(agora.toISOString())}&order=enviar_em.asc&limit=20`).catch(() => []);
  if (!vencidas?.length) return 0;
  const base = await lerGruposETags();
  for (const camp of vencidas) {
    if (camp.fanout_em) { // retomada depois de pausar
      await rest(`mkt_grupos_campanhas?id=eq.${camp.id}&status=eq.agendada`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'enviando' } });
      continue;
    }
    const { grupos, avisos } = resolverGrupos({ tagIds: camp.tag_ids || [], grupoJids: camp.grupo_jids || [], ...base });
    const fila = montarFila(camp.id, grupos);
    if (fila.length) {
      await rest('mkt_grupos_envios?on_conflict=campanha_id,grupo_jid', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: fila });
    }
    await rest(`mkt_grupos_campanhas?id=eq.${camp.id}&status=eq.agendada`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: fila.length
        ? { status: 'enviando', fanout_em: agora.toISOString(), iniciado_em: agora.toISOString(), total: fila.length, avisos }
        : { status: 'erro', fanout_em: agora.toISOString(), erro: 'Nenhum grupo válido no destino.', avisos },
    });
  }
  return vencidas.length;
}

async function fecharCampanhas() {
  const abertas = await rest('mkt_grupos_campanhas?select=id&status=in.(enviando,pausada)&limit=50').catch(() => []);
  let fechadas = 0;
  for (const { id } of abertas || []) {
    const linhas = await rest(`mkt_grupos_envios?select=status&campanha_id=eq.${id}&limit=5000`).catch(() => null);
    if (!linhas) continue;
    const r = resumirFila(linhas);
    const fim = campanhaTerminou(r);
    await rest(`mkt_grupos_campanhas?id=eq.${id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { enviados: r.chegaram, falhas: r.falhas, ...(fim ? { status: 'concluida', concluido_em: new Date().toISOString() } : {}) },
    }).catch(() => null);
    if (fim) fechadas += 1;
  }
  return fechadas;
}

/**
 * Uma rodada do motor. `prazoMs` = quanto tempo pode gastar (a função tem 60 s).
 */
export async function rodada({ prazoMs = 45_000 } = {}) {
  const inicio = Date.now();
  const resto = () => prazoMs - (Date.now() - inicio);
  const agora = new Date();
  let c;
  try { c = await conexaoTravada(); } catch (e) { return { parado: e.message }; }

  const presas = await soltarPresas(agora);
  if (!envioLigadoNoAmbiente()) return { parado: 'MKT_GRUPOS_ENVIO desligado na Vercel — nada sai.', presas };
  if (!c.envio_ligado) return { parado: 'Envio pausado na tela (Conexão do chip).', presas };

  const recorrencias = await gerarRecorrencias(agora).catch((e) => { console.error('[mkt-grupos] recorrências:', e?.message); return 0; });
  const filas = await montarFilas(agora).catch((e) => { console.error('[mkt-grupos] fila:', e?.message); return 0; });
  if (!dentroDaJanela(agora, c.janela_inicio, c.janela_fim)) {
    return { parado: `Fora da janela (${c.janela_inicio}–${c.janela_fim}).`, presas, recorrencias, filas, fechadas: await fecharCampanhas() };
  }
  if (c.estado && c.estado !== 'open') return { parado: `Chip ${c.estado}.`, presas, recorrencias, filas };

  let proximo = c.proximo_envio_em;
  let enviados = 0; let falhas = 0;
  const campanhas = new Map();
  while (resto() > 15_000) {
    if (!liberadaEm(proximo)) {
      const espera = Date.parse(proximo) - Date.now();
      if (espera > resto() - 15_000) break;
      await dormir(espera);
    }
    // A RPC confere a trava DE NOVO no banco antes de entregar a linha.
    const linha = (await rest('rpc/mkt_grupos_reivindicar', { method: 'POST', body: { p_instancia: c.instancia, p_limite: 1 } }))?.[0];
    if (!linha) break;
    let camp = campanhas.get(linha.campanha_id);
    if (!camp) {
      camp = (await rest(`mkt_grupos_campanhas?select=*&id=eq.${linha.campanha_id}&limit=1`))?.[0];
      campanhas.set(linha.campanha_id, camp);
    }
    try {
      const { caminho, corpo } = montarEnvio(c.instancia, envioDaFila(linha, camp));
      const rota = caminho.split('/').slice(1, 3).join('/');
      const r = await evoMkt(rota, { method: 'POST', body: corpo, timeoutMs: 40_000, conexao: c });
      const msgId = r?.key?.id || null;
      await rest(`mkt_grupos_envios?id=eq.${linha.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: msgId ? 'enviado' : 'falha', msg_id: msgId, enviado_em: new Date().toISOString(), erro: msgId ? null : 'A Evolution não devolveu o id da mensagem.' },
      });
      enviados += 1;
    } catch (e) {
      falhas += 1;
      const msg = String(e?.message || e);
      // Trava no meio da rodada: devolve a linha e PARA tudo.
      if (e?.trava) {
        await rest(`mkt_grupos_envios?id=eq.${linha.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pendente', erro: msg.slice(0, 300) } }).catch(() => null);
        return { parado: msg, enviados, falhas };
      }
      const desiste = erroPermanente(msg) || Number(linha.tentativas) >= 3;
      await rest(`mkt_grupos_envios?id=eq.${linha.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: desiste ? 'falha' : 'pendente', erro: traduzirErro(msg) },
      }).catch(() => null);
    }
    const { min, max } = intervalo(camp, { min: c.intervalo_min_seg ?? 20, max: c.intervalo_max_seg ?? 45 });
    proximo = new Date(Date.now() + sortearIntervaloMs(min, max)).toISOString();
    await rest('mkt_grupos_conexao?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { proximo_envio_em: proximo } }).catch(() => null);
  }
  const fechadas = await fecharCampanhas();
  return { presas, recorrencias, filas, enviados, falhas, fechadas };
}
