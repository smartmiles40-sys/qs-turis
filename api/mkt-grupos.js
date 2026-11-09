// api/mkt-grupos.js
// -----------------------------------------------------------------------------
// GRUPOS DO WHATSAPP DO MARKETING (0243, 30/10/2026) — a rota.
// Regras puras: api/_mktGruposRegras.js · porta da Evolution + trava:
// api/_mktGruposEvo.js · motor: api/_mktGruposMotor.js · guia: docs/MARKETING-GRUPOS.md
//
//   GET   (Vercel Cron, Bearer CRON_SECRET, a cada minuto)   → rodada do motor
//   POST  ?webhook=1&t=MKT_GRUPOS_SECRET (Evolution)          → estado do chip, "chegou ao grupo"
//   POST  { acao } com login (admin, marketing, gestor com área marketing):
//     estado · previa · agendar · sincronizar · info_grupo · convite
//     conversas · mensagens · enviar · reagir                (caixa "Celular")
//     configurar · ligar_envio · desconectar   (só admin)
//     qrcode · apontar_webhook   (time do Marketing, desde 04/11/2026)
//   Gerenciar grupos e link inteligente (0342, 09/11/2026):
//     criar_grupo · editar_grupo · participantes · participante · renovar_convite
//     sair_grupo · link_contar · link_criar_grupo
//   Link público /g/<slug>: api/mkt-grupos-link.js · contagem/criação: api/_mktGruposLink.js
//
// Ler grupos/tags/campanhas/fila a tela faz direto no banco (RLS 0243).
// Tags, campanhas, cadências e recorrências a tela GRAVA direto (RLS + gatilho
// que não deixa o navegador pôr a campanha em "enviando"/"concluída").
// A fila e a configuração do chip: SÓ o servidor.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import { lerConexao, conferirCandidata, travaMkt, evoMkt, ehAInstancia } from './_mktGruposEvo.js';
import { rodada, envioLigadoNoAmbiente, lerGruposETags } from './_mktGruposMotor.js';
import { criarGrupo, editarGrupo, lerParticipantes, mudarParticipantes, renovarConvite, sairDoGrupo } from './_mktGruposGestao.js';
import { rodadaLinks, criarProximoGrupo, lerLinksAtivos } from './_mktGruposLink.js';
import { lerMovimento } from './_mktGruposLinkRegras.js';
import {
  ehGrupo, ehPessoa, resolverGrupos, validarCampanha, lerGrupo, lerConversas, lerMensagens,
  montarEnvio, destinoDaCaixaPermitido, traduzirErro, digitos, semNono,
} from './_mktGruposRegras.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const enc = encodeURIComponent;
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
const BASE = () => String(process.env.QS_URL_PUBLICA || 'https://qs.setuforeuvouviagens.com.br').replace(/\/+$/, '');

async function quem(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const s = Array.isArray(u.setores) ? u.setores : [];
  const ok = u.role === 'admin' || u.role === 'marketing' || s.includes('marketing');
  return ok ? u : null;
}

// ── Webhook da Evolution (só da instância do Marketing) ─────────────────────
async function webhook(req, res) {
  if (!segredoConfere(req.query?.t, process.env.MKT_GRUPOS_SECRET)) return res.status(401).json({ error: 'segredo' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const c = await lerConexao();
  // Sem instância no corpo ou de outra instância: ignora (nunca mexe em nada de outro setor).
  if (!ehAInstancia(c, body.instance)) return res.status(200).json({ ok: true, ignorado: 'instancia' });
  const evento = String(body.event || '').toLowerCase().replace(/[_-]/g, '.');
  const itens = Array.isArray(body.data) ? body.data : [body.data].filter(Boolean);
  try {
    if (evento === 'connection.update') {
      const estado = String(body.data?.state || '');
      if (estado) {
        await rest('mkt_grupos_conexao?id=eq.1', {
          method: 'PATCH', prefer: 'return=minimal',
          body: { estado, estado_em: new Date().toISOString(), ...(estado === 'open' ? { conectado_em: new Date().toISOString() } : {}) },
        });
      }
      return res.status(200).json({ ok: true });
    }
    // "Chegou ao grupo": a Evolution confirmou (eco da nossa mensagem ou SERVER_ACK).
    // Lido por participante em grupo NÃO existe (a Evolution não repassa — SendFlow 18/09).
    if (evento === 'messages.update' || evento === 'send.message' || evento === 'messages.upsert') {
      const ids = itens
        .filter((d) => (d?.key?.fromMe ?? d?.fromMe) && ehGrupo(d?.key?.remoteJid || d?.remoteJid))
        .filter((d) => evento !== 'messages.update' || ['SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'].includes(String(d?.status || '').toUpperCase()))
        .map((d) => String(d?.key?.id || d?.keyId || ''))
        .filter((x) => /^[A-Za-z0-9]{8,64}$/.test(x));
      if (ids.length) {
        await rest(`mkt_grupos_envios?msg_id=in.(${ids.join(',')})&status=eq.enviado`, {
          method: 'PATCH', prefer: 'return=minimal', body: { status: 'chegou', chegou_em: new Date().toISOString() },
        });
      }
      return res.status(200).json({ ok: true, chegou: ids.length });
    }
    // 0342: entrou/saiu gente do grupo -> entradas e saídas do dia (relatório do link).
    if (evento === 'group.participants.update') {
      let n = 0;
      for (const d of itens) {
        const m = lerMovimento(d);
        if (!m) continue;
        await rest('rpc/mkt_grupos_membros_mov', { method: 'POST', body: { p_grupo: m.grupo, p_entradas: m.entradas, p_saidas: m.saidas } }).catch(() => null);
        n += 1;
      }
      return res.status(200).json({ ok: true, movimentos: n });
    }
    if (evento === 'groups.update' || evento === 'groups.upsert') {
      for (const g of itens) {
        if (!ehGrupo(g?.id)) continue;
        const campos = {};
        if (g.subject !== undefined) campos.nome = g.subject;
        if (g.desc !== undefined) campos.descricao = g.desc;
        if (typeof g.announce === 'boolean') campos.so_admins_enviam = g.announce;
        if (typeof g.restrict === 'boolean') campos.so_admins_editam = g.restrict;
        if (Object.keys(campos).length) await rest(`mkt_grupos?jid=eq.${enc(g.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: campos }).catch(() => null);
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(200).json({ ok: true, ignorado: evento });
  } catch (e) {
    console.error('[mkt-grupos] webhook:', e?.message);
    return res.status(200).json({ ok: false });
  }
}

// ── Ações ───────────────────────────────────────────────────────────────────

async function sincronizar() {
  const c = await travaMkt();
  const r = await evoMkt('group/fetchAllGroups', { sufixo: '?getParticipants=false', timeoutMs: 55_000, conexao: c });
  const lista = Array.isArray(r) ? r : Array.isArray(r?.groups) ? r.groups : [];
  const agora = new Date().toISOString();
  const linhas = lista.filter((g) => ehGrupo(g?.id)).map((g) => ({
    jid: g.id, nome: g.subject ?? null, descricao: g.desc ?? null, foto_url: g.pictureUrl || null,
    participantes: typeof g.size === 'number' ? g.size : null,
    so_admins_enviam: typeof g.announce === 'boolean' ? g.announce : null,
    so_admins_editam: typeof g.restrict === 'boolean' ? g.restrict : null,
    dono: g.owner || null, instancia: c.instancia, sincronizado_em: agora, saiu_em: null,
  }));
  for (let i = 0; i < linhas.length; i += 200) {
    await rest('mkt_grupos?on_conflict=jid', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: linhas.slice(i, i + 200) });
  }
  // Quem não veio = o número saiu. Trava igual à do Rel: lista vazia ou
  // "saiu de mais da metade" não marca ninguém (é mais provável a Evolution ter falhado).
  const antes = await rest('mkt_grupos?select=jid&saiu_em=is.null&limit=5000').catch(() => []);
  const veio = new Set(linhas.map((l) => l.jid));
  const sairam = (antes || []).filter((g) => !veio.has(g.jid)).map((g) => g.jid);
  let marcados = 0;
  if (linhas.length && sairam.length && sairam.length <= Math.max(1, (antes || []).length / 2)) {
    for (let i = 0; i < sairam.length; i += 100) {
      await rest(`mkt_grupos?jid=in.(${sairam.slice(i, i + 100).map((j) => `"${j}"`).join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { saiu_em: agora } });
    }
    marcados = sairam.length;
  }
  return { grupos: linhas.length, sairam: marcados, saida_suspeita: sairam.length > marcados ? sairam.length : 0 };
}

async function infoGrupo(jid) {
  if (!ehGrupo(jid)) throw new Error('Não é grupo.');
  const c = await travaMkt();
  const info = await evoMkt('group/findGroupInfos', { sufixo: `?groupJid=${enc(jid)}`, conexao: c });
  if (!info?.id) throw new Error('A Evolution não devolveu o grupo.');
  const campos = lerGrupo(info, c.numero);
  await rest('mkt_grupos?on_conflict=jid', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { ...campos, instancia: c.instancia, info_em: new Date().toISOString(), saiu_em: null },
  });
  return campos;
}

/** Link de convite: só LÊ (GET inviteCode). Gerar link novo: acao 'renovar_convite' (0342, com confirmação na tela). */
async function convite(jid) {
  if (!ehGrupo(jid)) throw new Error('Não é grupo.');
  const r = await evoMkt('group/inviteCode', { sufixo: `?groupJid=${enc(jid)}` });
  const link = r?.inviteUrl || (r?.inviteCode ? `https://chat.whatsapp.com/${r.inviteCode}` : null);
  if (link) await rest(`mkt_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { link_convite: link, link_em: new Date().toISOString() } }).catch(() => null);
  return link;
}

async function agendar(campanhaId) {
  if (!UUID.test(String(campanhaId || ''))) throw new Error('Campanha inválida.');
  const camp = (await rest(`mkt_grupos_campanhas?select=*&id=eq.${campanhaId}&limit=1`))?.[0];
  if (!camp) throw new Error('Campanha não encontrada.');
  if (!['rascunho', 'pausada', 'agendada'].includes(camp.status)) throw new Error(`Campanha ${camp.status} não pode ser agendada.`);
  const erros = validarCampanha(camp, { exigirData: !camp.fanout_em });
  if (erros.length) return { ok: false, erros };
  if (!camp.fanout_em) {
    const { grupos, avisos } = resolverGrupos({ tagIds: camp.tag_ids || [], grupoJids: camp.grupo_jids || [], ...(await lerGruposETags()) });
    if (!grupos.length) return { ok: false, erros: ['Nenhum grupo válido no destino.', ...avisos] };
  }
  if (camp.status !== 'agendada') await rest(`mkt_grupos_campanhas?id=eq.${campanhaId}&status=eq.${camp.status}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'agendada' } });
  return { ok: true };
}

// ── Gerenciar grupos (0342) ────────────────────────────────────────────────
async function grupoDoMarketing(jid) {
  if (!ehGrupo(jid)) throw new Error('Grupo inválido.');
  const g = (await rest(`mkt_grupos?select=jid,nome,saiu_em&jid=eq.${enc(jid)}&limit=1`))?.[0];
  if (!g) throw new Error('Grupo fora da lista do Marketing — puxe os grupos antes.');
  if (g.saiu_em) throw new Error('O chip não está mais nesse grupo.');
  return g;
}

async function acaoCriarGrupo(b, u) {
  const c = await travaMkt();
  const evo = (rota, o) => evoMkt(rota, { ...o, conexao: c });
  const g = await criarGrupo(b, { evo });
  const agora = new Date().toISOString();
  await rest('mkt_grupos?on_conflict=jid', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      jid: g.jid, nome: g.nome, descricao: g.descricao, foto_url: g.foto_url, participantes: g.participantes,
      so_admins_enviam: g.so_admins_enviam, so_admins_editam: g.so_admins_editam, eu_admin: true,
      link_convite: g.convite, link_em: g.convite ? agora : null, instancia: c.instancia, sincronizado_em: agora, contado_em: agora, saiu_em: null,
    },
  });
  // já entra no link escolhido (opcional)
  if (UUID.test(String(b.link_id || ''))) {
    const atuais = await rest(`mkt_grupos_link_grupos?select=ordem&link_id=eq.${b.link_id}`).catch(() => []);
    const ordem = Math.max(0, ...(atuais || []).map((x) => Number(x.ordem) || 0)) + 1;
    await rest('mkt_grupos_link_grupos?on_conflict=link_id,grupo_jid', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { link_id: b.link_id, grupo_jid: g.jid, ordem } });
  }
  console.log(`[mkt-grupos] grupo criado por ${u.name}: ${g.jid}`);
  return g;
}

async function acaoEditarGrupo(b) {
  const jid = String(b.jid || '');
  await grupoDoMarketing(jid);
  const feito = await editarGrupo(jid, b);
  await rest(`mkt_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: feito }).catch(() => null);
  return { ok: true, feito };
}

async function acaoParticipantes(b) {
  const jid = String(b.jid || '');
  await grupoDoMarketing(jid);
  const lista = await lerParticipantes(jid);
  const c = await lerConexao();
  const meu = semNono(c?.numero);
  const eu = meu ? lista.find((p) => p.telefone && semNono(p.telefone) === meu) : null;
  const agora = new Date().toISOString();
  await rest(`mkt_grupos?jid=eq.${enc(jid)}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: {
      participantes: lista.length, contado_em: agora, info_em: agora,
      participantes_lista: lista.map(({ id, telefone, admin }) => ({ id, telefone, admin })),
      admins: lista.filter((p) => p.admin).map(({ id, telefone, admin }) => ({ id, telefone, admin })),
      ...(eu ? { eu_admin: Boolean(eu.admin) } : {}),
    },
  }).catch(() => null);
  return { participantes: lista, eu_admin: eu ? Boolean(eu.admin) : null };
}

async function caixaEnviar(b, u) {
  const jid = String(b.jid || '');
  const texto = String(b.texto || '').trim();
  if (!texto) throw new Error('Escreva a mensagem.');
  if (texto.length > 4096) throw new Error('Texto longo demais.');
  let pessoaJaEscreveu = false;
  if (ehPessoa(jid) && String(process.env.MKT_GRUPOS_PRIVADO || '') === '1') {
    const r = await evoMkt('chat/findMessages', { method: 'POST', body: { where: { key: { remoteJid: jid, fromMe: false } }, page: 1, offset: 1 } });
    pessoaJaEscreveu = (r?.messages?.records || []).length > 0;
  }
  const bloqueio = destinoDaCaixaPermitido(jid, { privadoLigado: String(process.env.MKT_GRUPOS_PRIVADO || '') === '1', pessoaJaEscreveu });
  if (bloqueio) throw new Error(bloqueio);
  if (ehGrupo(jid)) {
    const g = (await rest(`mkt_grupos?select=jid,saiu_em&jid=eq.${enc(jid)}&limit=1`))?.[0];
    if (!g) throw new Error('Grupo fora da lista do Marketing — sincronize antes.');
    if (g.saiu_em) throw new Error('O número não está mais nesse grupo.');
  }
  const c = await travaMkt();
  const citar = b.citar?.id ? { id: String(b.citar.id), fromMe: Boolean(b.citar.fromMe), participant: b.citar.participant || null, texto: b.citar.texto || null } : null;
  const { caminho, corpo } = montarEnvio(c.instancia, { destino: jid, tipo: 'texto', texto, citar });
  console.log(`[mkt-grupos] caixa: ${u.name} → ${jid}`);
  const r = await evoMkt(caminho.split('/').slice(1, 3).join('/'), { method: 'POST', body: corpo, conexao: c });
  return { msgId: r?.key?.id || null };
}

async function caixaReagir(b) {
  const jid = String(b.jid || '');
  if (!ehGrupo(jid) && !ehPessoa(jid)) throw new Error('Destino inválido.');
  const id = String(b.msg?.id || '');
  if (!/^[A-Za-z0-9]{8,64}$/.test(id)) throw new Error('Mensagem inválida.');
  const emoji = String(b.emoji ?? '');
  if ([...emoji].length > 4) throw new Error('Um emoji só.');
  await evoMkt('message/sendReaction', {
    method: 'POST',
    body: { key: { remoteJid: jid, fromMe: Boolean(b.msg.fromMe), id, ...(b.msg.participant ? { participant: String(b.msg.participant) } : {}) }, reaction: emoji },
  });
  return { ok: true };
}

export default async function handler(req, res) {
  // ── Cron ──
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    try {
      // 0342: contagem de membros dos links (intervalo próprio por grupo) ANTES do
      // motor — só lê a Evolution (e cria grupo se o link pedir + MKT_GRUPOS_LINK_AUTO=1).
      // Não envia mensagem: o envio continua só no motor, com as duas chaves.
      const links = await rodadaLinks({ prazoMs: 12_000 }).catch((e) => ({ erro: String(e?.message || e).slice(0, 200) }));
      const r = await rodada({ prazoMs: 40_000 });
      console.log(`[mkt-grupos] cron: ${JSON.stringify({ ...r, links })}`);
      return res.status(200).json({ ...r, links });
    } catch (e) {
      console.error('[mkt-grupos] cron:', e?.message);
      return res.status(502).json({ error: 'falhou' });
    }
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Use GET ou POST' }); }
  if (req.query?.webhook) return webhook(req, res);

  const u = await quem(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso aos grupos do Marketing.' });
  const b = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const admin = u.role === 'admin';
  const soAdmin = () => { if (!admin) { const e = new Error('Só o admin mexe na conexão do chip.'); e.status = 403; throw e; } };

  try {
    switch (b.acao) {
      case 'estado': {
        const c = await lerConexao();
        let estado = c?.estado || null; let erro = null;
        if (c?.instancia) {
          try {
            const r = await evoMkt('instance/connectionState', { timeoutMs: 8000 });
            estado = String(r?.instance?.state || r?.state || 'desconhecido');
            if (estado !== c.estado) await rest('mkt_grupos_conexao?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { estado, estado_em: new Date().toISOString() } }).catch(() => null);
          } catch (e) { erro = String(e?.message || e).slice(0, 200); }
        }
        return res.status(200).json({ conexao: c, estado, erro, envioAmbiente: envioLigadoNoAmbiente(), privado: String(process.env.MKT_GRUPOS_PRIVADO || '') === '1', admin });
      }
      case 'configurar': {
        soAdmin();
        const instancia = String(b.instancia || '').trim();
        const numero = digitos(b.numero);
        const motivo = await conferirCandidata(instancia, numero);
        if (motivo) return res.status(400).json({ error: motivo });
        const corpo = { id: 1, instancia, numero: numero || null, configurado_por: u.id, estado: 'desconhecido', envio_ligado: false };
        // ↑ trocar a instância sempre DESLIGA o envio: alguém liga de novo conferindo.
        if (b.janela_inicio != null) { if (!HHMM.test(b.janela_inicio)) throw new Error('Janela: use HH:MM.'); corpo.janela_inicio = b.janela_inicio; }
        if (b.janela_fim != null) { if (!HHMM.test(b.janela_fim)) throw new Error('Janela: use HH:MM.'); corpo.janela_fim = b.janela_fim; }
        if (b.intervalo_min_seg != null) corpo.intervalo_min_seg = Math.max(5, Number(b.intervalo_min_seg) || 20);
        if (b.intervalo_max_seg != null) corpo.intervalo_max_seg = Math.max(corpo.intervalo_min_seg || 5, Number(b.intervalo_max_seg) || 45);
        // O gatilho do banco confere a MESMA trava e recusa se não passar.
        await rest('mkt_grupos_conexao?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: corpo });
        return res.status(200).json({ ok: true });
      }
      case 'ligar_envio': {
        soAdmin();
        await travaMkt();
        await rest('mkt_grupos_conexao?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { envio_ligado: Boolean(b.ligado) } });
        return res.status(200).json({ ok: true, envioAmbiente: envioLigadoNoAmbiente() });
      }
      case 'qrcode': {
        // 04/11/2026 (acesso completo do time): reconectar o chip que caiu é
        // rotina do Marketing — ler o QR só reconecta a instância que o admin
        // já configurou (a trava do banco segue valendo). Trocar a instância,
        // ligar o envio e desconectar continuam só admin.
        const r = await evoMkt('instance/connect', { timeoutMs: 40_000 });
        const qr = r?.qrcode || r;
        const base64 = typeof qr?.base64 === 'string' ? (qr.base64.startsWith('data:') ? qr.base64 : `data:image/png;base64,${qr.base64}`) : null;
        return res.status(200).json({ base64, pairingCode: qr?.pairingCode || null, estado: r?.instance?.state || null });
      }
      case 'apontar_webhook': {
        // 04/11/2026: idempotente (só aponta a instância do Marketing pro QS) — o time pode.
        const segredo = String(process.env.MKT_GRUPOS_SECRET || '');
        if (segredo.length < 16) throw new Error('Defina MKT_GRUPOS_SECRET (16+ caracteres) na Vercel antes.');
        await evoMkt('webhook/set', {
          method: 'POST',
          body: { webhook: { enabled: true, url: `${BASE()}/api/mkt-grupos?webhook=1&t=${enc(segredo)}`, byEvents: false, base64: false, events: ['CONNECTION_UPDATE', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'GROUPS_UPSERT', 'GROUP_UPDATE', 'GROUP_PARTICIPANTS_UPDATE'] } },
        });
        return res.status(200).json({ ok: true });
      }
      case 'desconectar': {
        soAdmin();
        await evoMkt('instance/logout', { method: 'DELETE' });
        await rest('mkt_grupos_conexao?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { estado: 'close', estado_em: new Date().toISOString() } });
        return res.status(200).json({ ok: true });
      }
      case 'sincronizar': return res.status(200).json(await sincronizar());
      case 'info_grupo': return res.status(200).json({ grupo: await infoGrupo(String(b.jid || '')) });
      case 'convite': return res.status(200).json({ link: await convite(String(b.jid || '')) });
      case 'previa': {
        const r = resolverGrupos({ tagIds: (b.tag_ids || []).filter((x) => UUID.test(x)), grupoJids: (b.grupo_jids || []).filter(ehGrupo), ...(await lerGruposETags()) });
        return res.status(200).json({ grupos: r.grupos.map((g) => ({ jid: g.jid, nome: g.nome })), avisos: r.avisos });
      }
      case 'agendar': return res.status(200).json(await agendar(b.campanhaId));
      case 'conversas': {
        const r = await evoMkt('chat/findChats', { method: 'POST', body: {}, timeoutMs: 30_000 });
        const lista = lerConversas(r).sort((a, z) => String(z.ultima_em || '').localeCompare(String(a.ultima_em || ''))).slice(0, 300);
        return res.status(200).json({ conversas: lista });
      }
      case 'mensagens': {
        const jid = String(b.jid || '');
        if (!ehGrupo(jid) && !ehPessoa(jid)) throw new Error('Conversa inválida.');
        const pagina = Math.max(1, Math.min(50, Number(b.pagina) || 1));
        const r = await evoMkt('chat/findMessages', { method: 'POST', body: { where: { key: { remoteJid: jid } }, page: pagina, offset: 40 }, timeoutMs: 30_000 });
        return res.status(200).json({ mensagens: lerMensagens(r?.messages?.records).reverse(), paginas: Number(r?.messages?.pages) || 1 });
      }
      case 'enviar': return res.status(200).json(await caixaEnviar(b, u));
      // ── 0342: criar e gerenciar grupos ──
      case 'criar_grupo': return res.status(200).json({ grupo: await acaoCriarGrupo(b, u) });
      case 'editar_grupo': return res.status(200).json(await acaoEditarGrupo(b));
      case 'participantes': return res.status(200).json(await acaoParticipantes(b));
      case 'participante': {
        const jid = String(b.jid || '');
        await grupoDoMarketing(jid);
        const r = await mudarParticipantes(jid, String(b.tipo || ''), b.pessoas);
        console.log(`[mkt-grupos] participantes (${b.tipo}) por ${u.name} em ${jid}: ${r.resultado.length}`);
        return res.status(200).json(r);
      }
      case 'renovar_convite': {
        const jid = String(b.jid || '');
        await grupoDoMarketing(jid);
        const link = await renovarConvite(jid);
        await rest(`mkt_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { link_convite: link, link_em: new Date().toISOString() } });
        return res.status(200).json({ link });
      }
      case 'sair_grupo': {
        const jid = String(b.jid || '');
        const g = await grupoDoMarketing(jid);
        if (String(b.confirmar || '').trim().toLowerCase() !== 'sair') throw new Error('Para sair, digite SAIR na confirmação.');
        await sairDoGrupo(jid);
        await rest(`mkt_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { saiu_em: new Date().toISOString() } });
        console.log(`[mkt-grupos] chip saiu do grupo ${g.nome || jid} (pedido de ${u.name})`);
        return res.status(200).json({ ok: true });
      }
      // ── 0342: link inteligente ──
      case 'link_contar': {
        // "Contar agora": zera o contado_em dos grupos do link e roda a contagem (mesmo limite do cron).
        if (!UUID.test(String(b.link_id || ''))) throw new Error('Link inválido.');
        const jids = ((await rest(`mkt_grupos_link_grupos?select=grupo_jid&link_id=eq.${b.link_id}`).catch(() => [])) || []).map((x) => x.grupo_jid);
        if (jids.length) await rest(`mkt_grupos?jid=in.(${jids.map((j) => `"${j}"`).join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { contado_em: null } });
        return res.status(200).json(await rodadaLinks({ prazoMs: 40_000 }));
      }
      case 'link_criar_grupo': {
        if (!UUID.test(String(b.link_id || ''))) throw new Error('Link inválido.');
        const { links, itens } = await lerLinksAtivos();
        const link = links.find((l) => l.id === b.link_id);
        if (!link) throw new Error('Link não encontrado ou pausado.');
        const c = await travaMkt();
        const g = await criarProximoGrupo(link, itens.filter((i) => i.link_id === link.id), { conexao: c, automatico: false });
        return res.status(200).json({ grupo: g });
      }
      case 'reagir': return res.status(200).json(await caixaReagir(b));
      default: return res.status(400).json({ error: 'Ação desconhecida.' });
    }
  } catch (e) {
    const msg = traduzirErro(String(e?.message || e));
    return res.status(e?.status === 403 ? 403 : e?.trava ? 423 : 400).json({ error: msg });
  }
}
