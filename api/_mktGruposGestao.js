// api/_mktGruposGestao.js
// -----------------------------------------------------------------------------
// CRIAR E GERENCIAR GRUPOS pelo chip do Marketing (0342, 09/11/2026).
// Cada função recebe `evo` (padrão: evoMkt, a porta única com a TRAVA de
// instância — api/_mktGruposEvo.js). Nos testes `evo` é um falso que só anota
// as chamadas: nada vai pra Evolution de verdade.
//
// Endpoints da Evolution API v2 (conferidos no código-fonte oficial,
// github.com/EvolutionAPI/evolution-api — src/api/routes/group.router.ts,
// src/validate/group.schema.ts e whatsapp.baileys.service.ts):
//   POST   group/create/{inst}                         { subject, description?, participants[] (mín. 1) } → metadados do grupo (id)
//                                                       (profilePicture é aceito no schema mas IGNORADO no create → foto vai depois)
//   POST   group/updateGroupPicture/{inst}?groupJid=   { image: url https ou base64 }     → { update: 'success' }
//   POST   group/updateGroupSubject/{inst}?groupJid=   { subject }                         → { update: 'success' }
//   POST   group/updateGroupDescription/{inst}?groupJid= { description }                   → { update: 'success' }
//   POST   group/updateSetting/{inst}?groupJid=        { action: announcement|not_announcement|locked|unlocked }
//   POST   group/updateParticipant/{inst}?groupJid=    { action: add|remove|promote|demote, participants[] } → { updateParticipants: [{ status, jid }] }
//   GET    group/participants/{inst}?groupJid=         → { participants: [{ id, phoneNumber?, admin, name? }] }
//   GET    group/inviteCode/{inst}?groupJid=           → { inviteUrl, inviteCode }
//   POST   group/revokeInviteCode/{inst}?groupJid=     → { revoked: true, inviteCode }   (o código ANTIGO para de funcionar)
//   DELETE group/leaveGroup/{inst}?groupJid=           → { groupJid, leave: true }
// -----------------------------------------------------------------------------

import { evoMkt } from './_mktGruposEvo.js';
import { ehGrupo, digitos } from './_mktGruposRegras.js';
import { conviteDaResposta, limparNumeros } from './_mktGruposLinkRegras.js';

const enc = encodeURIComponent;
const q = (jid) => `?groupJid=${enc(jid)}`;
const URL_HTTPS = /^https:\/\/[^\s]+$/;
const PARTICIPANTE = /^[0-9]+@(s\.whatsapp\.net|lid)$/;

function exigirGrupo(jid) {
  if (!ehGrupo(jid)) throw new Error('Grupo inválido.');
}

/** Valida e normaliza os dados de um grupo novo. Devolve { dados, erros }. */
export function validarGrupoNovo(b = {}) {
  const erros = [];
  const nome = String(b.nome || '').trim();
  const descricao = String(b.descricao || '').trim();
  const fotoUrl = String(b.fotoUrl || b.foto_url || '').trim();
  if (!nome) erros.push('Dê um nome ao grupo.');
  if (nome.length > 100) erros.push('Nome com no máximo 100 letras.');
  if (descricao.length > 2048) erros.push('Descrição longa demais (máx. 2048).');
  if (fotoUrl && !URL_HTTPS.test(fotoUrl)) erros.push('Foto inválida.');
  const adm = limparNumeros(b.admins);
  const par = limparNumeros(b.participantes);
  if (adm.invalidos.length) erros.push(`Número de admin inválido: ${adm.invalidos.join(', ')}`);
  if (par.invalidos.length) erros.push(`Número inválido: ${par.invalidos.join(', ')}`);
  const todos = [...new Set([...adm.numeros, ...par.numeros])];
  if (!todos.length) erros.push('O WhatsApp exige pelo menos uma pessoa além do chip: ponha um admin.');
  if (todos.length > 200) erros.push('Ponha no máximo 200 pessoas na criação (o resto entra pelo link).');
  return {
    erros,
    dados: {
      nome, descricao, fotoUrl: fotoUrl || null, admins: adm.numeros, participantes: todos,
      soAdminsEnviam: b.soAdminsEnviam ?? b.so_admins_enviam ?? true,
      soAdminsEditam: b.soAdminsEditam ?? b.so_admins_editam ?? true,
    },
  };
}

/**
 * Cria o grupo e deixa ele pronto: foto, "só admins mandam/editam", admins
 * promovidos e o link de convite. Só a criação é obrigatória: se um passo
 * depois falhar o grupo JÁ EXISTE — vira aviso (não tenta criar de novo).
 */
export async function criarGrupo(b, { evo = evoMkt } = {}) {
  const { dados, erros } = validarGrupoNovo(b);
  if (erros.length) { const e = new Error(erros.join(' ')); e.status = 400; throw e; }
  const criado = await evo('group/create', {
    method: 'POST', timeoutMs: 45_000,
    body: { subject: dados.nome, ...(dados.descricao ? { description: dados.descricao } : {}), participants: dados.participantes },
  });
  const jid = String(criado?.id || criado?.groupJid || '');
  if (!ehGrupo(jid)) throw new Error('A Evolution não devolveu o grupo criado. Confira no WhatsApp antes de tentar de novo.');
  const avisos = [];
  const passo = async (rotulo, f) => { try { return await f(); } catch (e) { avisos.push(`${rotulo}: ${String(e?.message || e).slice(0, 160)}`); return null; } };
  if (dados.fotoUrl) await passo('Foto', () => evo('group/updateGroupPicture', { method: 'POST', sufixo: q(jid), body: { image: dados.fotoUrl }, timeoutMs: 30_000 }));
  await passo('Quem manda mensagem', () => evo('group/updateSetting', { method: 'POST', sufixo: q(jid), body: { action: dados.soAdminsEnviam ? 'announcement' : 'not_announcement' } }));
  await passo('Quem edita o grupo', () => evo('group/updateSetting', { method: 'POST', sufixo: q(jid), body: { action: dados.soAdminsEditam ? 'locked' : 'unlocked' } }));
  if (dados.admins.length) await passo('Admins', () => evo('group/updateParticipant', { method: 'POST', sufixo: q(jid), body: { action: 'promote', participants: dados.admins } }));
  const conv = await passo('Link de convite', () => evo('group/inviteCode', { sufixo: q(jid) }));
  return {
    jid, nome: dados.nome, descricao: dados.descricao || null, foto_url: dados.fotoUrl,
    convite: conviteDaResposta(conv), so_admins_enviam: Boolean(dados.soAdminsEnviam), so_admins_editam: Boolean(dados.soAdminsEditam),
    participantes: Array.isArray(criado?.participants) ? criado.participants.length : dados.participantes.length + 1,
    avisos,
  };
}

/** Edita só o que veio: nome, descrição, foto, só admins mandam / editam. */
export async function editarGrupo(jid, b = {}, { evo = evoMkt } = {}) {
  exigirGrupo(jid);
  const feito = {};
  if (b.nome !== undefined) {
    const nome = String(b.nome || '').trim();
    if (!nome || nome.length > 100) throw new Error('Nome do grupo: de 1 a 100 letras.');
    await evo('group/updateGroupSubject', { method: 'POST', sufixo: q(jid), body: { subject: nome } });
    feito.nome = nome;
  }
  if (b.descricao !== undefined) {
    const descricao = String(b.descricao || '').trim();
    if (descricao.length > 2048) throw new Error('Descrição longa demais (máx. 2048).');
    // a Evolution recusa descrição vazia (isNotEmpty): apagar = um espaço
    await evo('group/updateGroupDescription', { method: 'POST', sufixo: q(jid), body: { description: descricao || ' ' } });
    feito.descricao = descricao || null;
  }
  if (b.fotoUrl !== undefined || b.foto_url !== undefined) {
    const url = String(b.fotoUrl ?? b.foto_url ?? '').trim();
    if (!URL_HTTPS.test(url)) throw new Error('Foto inválida.');
    await evo('group/updateGroupPicture', { method: 'POST', sufixo: q(jid), body: { image: url }, timeoutMs: 30_000 });
    feito.foto_url = url;
  }
  if (typeof b.soAdminsEnviam === 'boolean') {
    await evo('group/updateSetting', { method: 'POST', sufixo: q(jid), body: { action: b.soAdminsEnviam ? 'announcement' : 'not_announcement' } });
    feito.so_admins_enviam = b.soAdminsEnviam;
  }
  if (typeof b.soAdminsEditam === 'boolean') {
    await evo('group/updateSetting', { method: 'POST', sufixo: q(jid), body: { action: b.soAdminsEditam ? 'locked' : 'unlocked' } });
    feito.so_admins_editam = b.soAdminsEditam;
  }
  if (!Object.keys(feito).length) throw new Error('Nada para mudar.');
  return feito;
}

const telDe = (s) => { const d = digitos(String(s || '').split('@')[0].split(':')[0]); return d.length >= 10 && d.length <= 15 ? d : null; };

/** Participantes (lidos ao vivo). */
export async function lerParticipantes(jid, { evo = evoMkt } = {}) {
  exigirGrupo(jid);
  const r = await evo('group/participants', { sufixo: q(jid), timeoutMs: 30_000 });
  const lista = Array.isArray(r?.participants) ? r.participants : [];
  return lista.map((p) => ({
    id: String(p?.id || ''),
    telefone: telDe(p?.phoneNumber) || (String(p?.id || '').endsWith('@s.whatsapp.net') ? telDe(p?.id) : null),
    admin: p?.admin || null,
    nome: p?.name || null,
  })).filter((p) => p.id);
}

const ACOES = { add: 'adicionar', remove: 'remover', promote: 'tornar admin', demote: 'tirar de admin' };

/** O que cada código de updateParticipants quer dizer (WhatsApp). */
export function lerResultadoParticipantes(r) {
  const itens = Array.isArray(r?.updateParticipants) ? r.updateParticipants : [];
  const frase = {
    200: 'feito', 403: 'a pessoa não deixa ser adicionada (privacidade) — mande o link de convite',
    408: 'saiu há pouco e não pode voltar agora — mande o link', 409: 'já está no grupo',
    404: 'número sem WhatsApp', 401: 'o chip não é admin',
  };
  return itens.map((i) => {
    const codigo = Number(i?.status) || 0;
    return { id: String(i?.jid || ''), telefone: telDe(i?.jid), ok: codigo === 200, codigo, motivo: frase[codigo] || (codigo ? `código ${codigo}` : 'sem resposta') };
  });
}

/**
 * Adicionar / remover / promover / rebaixar. `pessoas`: números (adicionar) ou os
 * ids que vieram de lerParticipantes (…@s.whatsapp.net / …@lid).
 */
export async function mudarParticipantes(jid, acao, pessoas, { evo = evoMkt } = {}) {
  exigirGrupo(jid);
  if (!ACOES[acao]) throw new Error('Ação inválida.');
  const lista = Array.isArray(pessoas) ? pessoas : String(pessoas || '').split(/[\s,;]+/);
  const ids = []; const ruins = [];
  for (const p of lista) {
    const s = String(p || '').trim();
    if (!s) continue;
    if (PARTICIPANTE.test(s)) { if (!ids.includes(s)) ids.push(s); continue; }
    const { numeros } = limparNumeros([s]);
    if (numeros.length) { if (!ids.includes(numeros[0])) ids.push(numeros[0]); } else ruins.push(s);
  }
  if (ruins.length) throw new Error(`Número inválido: ${ruins.join(', ')}`);
  if (!ids.length) throw new Error('Diga quem.');
  if (ids.length > 50) throw new Error('No máximo 50 pessoas por vez.');
  const r = await evo('group/updateParticipant', { method: 'POST', sufixo: q(jid), body: { action: acao, participants: ids }, timeoutMs: 40_000 });
  return { acao: ACOES[acao], resultado: lerResultadoParticipantes(r) };
}

/** Link de convite atual (só lê). */
export async function lerConvite(jid, { evo = evoMkt } = {}) {
  exigirGrupo(jid);
  return conviteDaResposta(await evo('group/inviteCode', { sufixo: q(jid) }));
}

/** Gera um link NOVO (o antigo para de funcionar) e devolve o novo. */
export async function renovarConvite(jid, { evo = evoMkt } = {}) {
  exigirGrupo(jid);
  const r = await evo('group/revokeInviteCode', { method: 'POST', sufixo: q(jid) });
  const novo = conviteDaResposta(r) || (await lerConvite(jid, { evo }));
  if (!novo) throw new Error('A Evolution não devolveu o link novo.');
  return novo;
}

/** O chip SAI do grupo (não volta sem convite). */
export async function sairDoGrupo(jid, { evo = evoMkt } = {}) {
  exigirGrupo(jid);
  await evo('group/leaveGroup', { method: 'DELETE', sufixo: q(jid) });
  return { ok: true };
}
