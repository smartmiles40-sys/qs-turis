// api/_relGruposSync.js
// -----------------------------------------------------------------------------
// LISTA, INFORMAÇÕES E PARTICIPANTES dos grupos (28/10/2026).
//
// Por que o cron estourava 60 s a cada 6 h: /group/fetchAllGroups da Evolution
// busca a FOTO de cada um dos ~185 grupos, um depois do outro, antes de
// responder — com ou sem participantes. Isso sozinho passa de 45 s.
// Agora:
//   • o cron NÃO chama mais fetchAllGroups. Ele faz um RODÍZIO: a cada rodada lê
//     poucos grupos (/group/findGroupInfos, um grupo por chamada — nome, descrição,
//     foto, ajustes e participantes), sempre os de info_em mais antigo (0219).
//     Com 4 grupos a cada 5 min, a volta inteira leva ~4 h e nunca passa do prazo;
//   • "Atualizar lista" (botão) ainda chama fetchAllGroups — é o único jeito de
//     descobrir grupo novo/saído de uma vez — mas SEM participantes, com prazo, e
//     usa o tempo que sobrar no rodízio.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { evo, inst, ehGrupo, meusIds, NUMERO } from './_relGruposEvo.js';

/** "5511…@s.whatsapp.net" → "5511…"; @lid → null. */
const telDe = (j) => (String(j || '').endsWith('@s.whatsapp.net') ? String(j).split('@')[0].split(':')[0] : null);
const enc = encodeURIComponent;

/** Grava/atualiza a linha de cada grupo, só com os campos que vieram. */
export async function atualizarGrupos(lista) {
  const linhas = (Array.isArray(lista) ? lista : [lista])
    .filter((g) => ehGrupo(g?.id))
    .map((g) => ({
      jid: g.id,
      ...(g.subject !== undefined ? { nome: g.subject } : {}),
      ...(g.desc !== undefined ? { descricao: g.desc } : {}),
      ...(g.size !== undefined ? { participantes: g.size } : {}),
      ...(g.pictureUrl !== undefined ? { foto_url: g.pictureUrl || null } : {}),
      ...(typeof g.announce === 'boolean' ? { so_admins_enviam: g.announce } : {}),
      ...(typeof g.restrict === 'boolean' ? { so_admins_editam: g.restrict } : {}),
      atualizado_em: new Date().toISOString(),
    }));
  // EM LOTE (27/10). Agrupa por CONJUNTO DE CAMPOS: num upsert em lote o
  // PostgREST usa a união das chaves, e um grupo sem `desc` teria a descrição
  // apagada se fosse no mesmo lote de quem tem.
  const porChaves = new Map();
  for (const l of linhas) {
    const k = Object.keys(l).sort().join(',');
    if (!porChaves.has(k)) porChaves.set(k, []);
    porChaves.get(k).push(l);
  }
  for (const lote of porChaves.values()) {
    for (let i = 0; i < lote.length; i += 200) {
      const parte = lote.slice(i, i + 200);
      try { await rest('rel_wa_grupos?on_conflict=jid', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: parte }); }
      catch (e) {
        // banco ainda sem a 0219: grava sem foto/ajustes em vez de perder a lista
        if (!/column|schema cache/i.test(String(e?.message || ''))) throw e;
        const velhas = parte.map(({ foto_url: _f, so_admins_enviam: _a, so_admins_editam: _b, ...resto }) => resto);
        await rest('rel_wa_grupos?on_conflict=jid', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: velhas });
      }
    }
  }
}

export async function gravarParticipantes(grupoJid, participantes, marca) {
  const linhas = (participantes || []).map((p) => {
    const id = String(p?.id || p || '');
    return { grupo_jid: grupoJid, participante: id, telefone: telDe(p?.phoneNumber) || telDe(p?.jid) || telDe(id), admin: p?.admin || null, atualizado_em: marca };
  }).filter((l) => l.participante);
  for (let i = 0; i < linhas.length; i += 500) {
    await rest('rel_wa_grupo_participantes?on_conflict=grupo_jid,participante', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: linhas.slice(i, i + 500) });
  }
  return linhas.length;
}

/** O número do Relacionamento está como admin nesta lista de participantes? */
function souAdmin(participantes, meus) {
  const num = NUMERO();
  return (participantes || []).some((p) => p?.admin && (
    meus.has(String(p.id)) || telDe(p.phoneNumber) === num || telDe(p.jid) === num || telDe(p.id) === num
  ));
}

/**
 * Lê UM grupo na Evolution e acerta tudo dele no banco: nome, descrição, foto,
 * ajustes, participantes (apaga quem saiu) e se o número é admin.
 */
export async function lerInfoDoGrupo(jid) {
  if (!ehGrupo(jid)) throw new Error('Não é grupo.');
  const info = await evo(`/group/findGroupInfos/${inst()}?groupJid=${enc(jid)}`, { timeoutMs: 15000 });
  if (!info?.id) throw new Error('A Evolution não devolveu o grupo.');
  const agora = new Date().toISOString();
  await atualizarGrupos([info]);
  const parts = Array.isArray(info.participants) ? info.participants : [];
  if (parts.length) {
    await gravarParticipantes(jid, parts, agora);
    await rest(`rel_wa_grupo_participantes?grupo_jid=eq.${enc(jid)}&atualizado_em=lt.${enc(agora)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
  }
  const meus = await meusIds();
  await rest(`rel_wa_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { eu_admin: souAdmin(parts, meus), info_em: agora } });
  return { ...info, eu_admin: souAdmin(parts, meus) };
}

/** Rodízio: lê os `quantos` grupos com info mais antiga, 2 de cada vez, até o prazo. */
export async function rodizioInfo({ quantos = 4, prazo = Date.now() + 30_000 } = {}) {
  const fila = (await rest(`rel_wa_grupos?select=jid&saiu_em=is.null&order=info_em.asc.nullsfirst&limit=${Math.max(1, Math.min(quantos, 200))}`).catch(() => [])) || [];
  let lidos = 0;
  let falhas = 0;
  for (let i = 0; i < fila.length; i += 2) {
    if (Date.now() > prazo - 16000) break; // cada leitura pode levar até 15 s
    await Promise.all(fila.slice(i, i + 2).map(async (g) => {
      try { await lerInfoDoGrupo(g.jid); lidos += 1; }
      catch (e) {
        falhas += 1;
        console.warn('[rel-grupos] info', g.jid, e?.message);
        // anda a fila mesmo assim, senão um grupo com problema trava o rodízio
        await rest(`rel_wa_grupos?jid=eq.${enc(g.jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { info_em: new Date().toISOString() } }).catch(() => null);
      }
    }));
  }
  return { lidos, falhas };
}

/** PATCH em lote por jid (in.(…) com aspas — o jid tem @ e ponto). */
async function patchJids(jids, body) {
  for (let i = 0; i < jids.length; i += 50) {
    const lista = jids.slice(i, i + 50).map((j) => `"${j}"`).join(',');
    await rest(`rel_wa_grupos?jid=in.(${enc(lista)})`, { method: 'PATCH', prefer: 'return=minimal', body });
  }
}

/**
 * "Atualizar lista": todos os grupos do número (sem participantes), marca os
 * que o número saiu e usa o tempo que sobra no rodízio de informações.
 */
export async function sincronizarGrupos({ orcamentoMs = 50_000 } = {}) {
  const prazo = Date.now() + orcamentoMs;
  let grupos = null;
  let aviso = null;
  try {
    const lista = await evo(`/group/fetchAllGroups/${inst()}?getParticipants=false`, { timeoutMs: Math.max(10_000, orcamentoMs - 8000) });
    grupos = (Array.isArray(lista) ? lista : []).filter((g) => ehGrupo(g?.id));
  } catch (e) {
    aviso = `A lista completa não veio (${String(e?.message || '').slice(0, 80)}). Atualizei os grupos um a um.`;
  }
  let sairam = 0;
  let voltaram = 0;
  if (grupos) {
    await atualizarGrupos(grupos);
    // Grupo que sumiu da lista = o número saiu. Volta se reaparecer.
    // Trava: lista vazia ou "saiu de mais da metade" é soluço da Evolution, não saída.
    const ids = new Set(grupos.map((g) => g.id));
    const nossos = (await rest('rel_wa_grupos?select=jid,saiu_em').catch(() => [])) || [];
    const fora = nossos.filter((g) => !ids.has(g.jid) && !g.saiu_em).map((g) => g.jid);
    const dentro = nossos.filter((g) => ids.has(g.jid) && g.saiu_em).map((g) => g.jid);
    const ativos = nossos.filter((g) => !g.saiu_em).length;
    if (grupos.length && fora.length <= Math.max(5, ativos / 2)) {
      await patchJids(fora, { saiu_em: new Date().toISOString() });
      sairam = fora.length;
    } else if (fora.length) {
      aviso = `A Evolution mandou uma lista estranha (${grupos.length} grupos) — não marquei ninguém como "saiu".`;
    }
    await patchJids(dentro, { saiu_em: null });
    voltaram = dentro.length;
  }
  const r = await rodizioInfo({ quantos: 40, prazo });
  return { grupos: grupos ? grupos.length : null, sairam, voltaram, lidos: r.lidos, ...(aviso ? { aviso } : {}) };
}
