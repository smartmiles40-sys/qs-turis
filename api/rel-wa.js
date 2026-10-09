// api/rel-wa.js
// -----------------------------------------------------------------------------
// WHATSAPP DO RELACIONAMENTO — o envio (Fase 2, 0101, 09/10/2026).
//
//   GET  /api/rel-wa?numero=1   → o número do Relacionamento está conectado?
//   GET  /api/rel-wa?modelos=1  → modelos aprovados na conta desse número
//   POST { acao: 'texto',   conversaId, texto, respondendoA? }
//   POST { acao: 'modelo',  conversaId | clienteId, modelo: { nome, idioma, params } }
//   POST { acao: 'arquivo', conversaId, fileName, mimeType, dataBase64, legenda? }
//   POST { acao: 'lida',    conversaId }   → visto azul pro cliente
//
// Tudo sai pelo número do RELACIONAMENTO (setor = relacionamento em
// qs_wa_numeros_meta) — nunca pelo do Comercial. Só quem tem acesso ao
// Relacionamento usa. O telefone sai da CONVERSA/FICHA no banco, nunca do
// navegador, e quem assina a mensagem é a sessão.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { enviarTexto, enviarTemplate, enviarMidia, subirMidiaBytes, marcarComoLida, modelosAprovados } from './_meta.js';
import { resolverModeloMeta } from './_waSaida.js';
import { guardarMidia } from './_waMidia.js';
import { gravarRel } from './_relEntrada.js';
import { quemChama, numeroDoRelacionamento } from './_relWa.js';

const MAX_TEXTO = 4000;
const MAX_BYTES = 3 * 1024 * 1024; // a Vercel aceita ~4,5 MB de corpo; base64 infla 33%

const TIPOS_ARQUIVO = {
  'image/jpeg': 'image', 'image/png': 'image',
  'video/mp4': 'video',
  'audio/ogg': 'audio', 'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/aac': 'audio',
  'application/pdf': 'document',
};

const ERRO_MODELO = {
  'modelo-nao-encontrado': 'Esse modelo não está aprovado na Meta para o número do Relacionamento.',
  'modelo-variavel-vazia': 'Preencha todas as variáveis do modelo.',
  'modelo-precisa-de-midia': 'Esse modelo tem imagem ou vídeo no topo — ainda não dá pra mandar por aqui.',
  'modelo-sem-nome': 'Modelo inválido.',
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// quemChama e numeroDoRelacionamento moram em _relWa.js (comuns com rel-disparos).

async function lerAssinatura() {
  const r = await rest('rel_config?select=valor&chave=eq.assinatura&limit=1').catch(() => null);
  return r?.[0]?.valor?.ativo !== false; // padrão: assina
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A conversa (ou a ficha, pra começar uma) → telefone + número de envio. */
async function destino({ conversaId, clienteId }, numero) {
  if (conversaId) {
    if (!UUID.test(conversaId)) return { erro: 'Conversa inválida.' };
    const c = (await rest(`rel_wa_conversas?select=id,telefone,phone_number_id,ultima_entrada_em&id=eq.${conversaId}&limit=1`))?.[0];
    if (!c) return { erro: 'Conversa não encontrada.' };
    return { telefone: c.telefone, phoneId: c.phone_number_id, ultimaEntrada: c.ultima_entrada_em, conversaId: c.id };
  }
  if (clienteId) {
    if (!UUID.test(clienteId)) return { erro: 'Cliente inválido.' };
    const cl = (await rest(`rel_clientes?select=id,telefone&id=eq.${clienteId}&mesclado_em_id=is.null&limit=1`))?.[0];
    if (!cl) return { erro: 'Ficha não encontrada.' };
    if (!cl.telefone) return { erro: 'Esta ficha não tem telefone.' };
    const c = (await rest(
      `rel_wa_conversas?select=id,ultima_entrada_em&telefone=eq.${cl.telefone}&phone_number_id=eq.${encodeURIComponent(numero.phone_number_id)}&limit=1`
    ))?.[0];
    return { telefone: cl.telefone, phoneId: numero.phone_number_id, ultimaEntrada: c?.ultima_entrada_em || null, conversaId: c?.id || null };
  }
  return { erro: 'Informe a conversa.' };
}

const janelaAberta = (ultimaEntrada) =>
  Boolean(ultimaEntrada) && Date.now() - new Date(ultimaEntrada).getTime() < 24 * 3600_000;

export default async function handler(req, res) {
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });

  const numero = await numeroDoRelacionamento();
  const conectado = numero?.status === 'conectado' && Boolean(numero.segredo_id);

  if (req.method === 'GET') {
    if (req.query?.numero) {
      return res.status(200).json({
        conectado,
        numero: numero?.numero || null,
        nome: numero?.nome_verificado || null,
        status: numero?.status || null,
      });
    }
    if (req.query?.modelos) {
      if (!conectado) return res.status(200).json({ modelos: [] });
      const lista = await modelosAprovados(numero.phone_number_id).catch(() => []);
      return res.status(200).json({ modelos: lista });
    }
    return res.status(400).json({ error: 'Pedido inválido.' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }
  if (!numero || !conectado) {
    return res.status(409).json({ error: 'O número do Relacionamento não está conectado. Peça ao admin para conectar em Configurações → WhatsApp (Meta).', motivo: 'sem-numero' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');
  const alvo = await destino({ conversaId: body.conversaId ? String(body.conversaId) : null, clienteId: body.clienteId ? String(body.clienteId) : null }, numero)
    .catch((e) => ({ erro: e?.message || 'Falha ao ler a conversa.' }));
  if (alvo.erro) return res.status(404).json({ error: alvo.erro });

  const primeiroNome = String(u.name || '').trim().split(/\s+/)[0] || 'Relacionamento';
  const assinar = async (t) => ((await lerAssinatura()) ? `*${primeiroNome}:*\n${t}` : t);
  const gravar = (extra) => gravarRel({
    phoneId: alvo.phoneId, telefone: alvo.telefone, direcao: 'out', origem: 'qs',
    autorId: u.id, autorNome: u.name, status: 'sent', ...extra,
  });

  // ── Visto azul ──
  if (acao === 'lida') {
    if (!alvo.conversaId) return res.status(200).json({ ok: true });
    const ult = (await rest(
      `rel_wa_mensagens?select=wamid&conversa_id=eq.${alvo.conversaId}&direcao=eq.in&order=enviada_em.desc&limit=1`
    ).catch(() => null))?.[0];
    if (ult?.wamid) await marcarComoLida({ wamid: ult.wamid, phoneId: alvo.phoneId }).catch(() => null);
    await rest(`rel_wa_conversas?id=eq.${alvo.conversaId}`, { method: 'PATCH', prefer: 'return=minimal', body: { nao_lidas: 0 } }).catch(() => null);
    return res.status(200).json({ ok: true });
  }

  // ── Texto livre (só dentro da janela de 24h) ──
  if (acao === 'texto') {
    const texto = String(body.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'Mensagem vazia.' });
    if (texto.length > MAX_TEXTO) return res.status(400).json({ error: `Mensagem muito longa (máx. ${MAX_TEXTO}).` });
    if (!janelaAberta(alvo.ultimaEntrada)) {
      return res.status(409).json({ error: 'O cliente não escreve há mais de 24h: a Meta só deixa mandar um MODELO aprovado.', motivo: 'janela-fechada' });
    }
    let respondendoA = null;
    if (body.respondendoA && alvo.conversaId) {
      const m = (await rest(`rel_wa_mensagens?select=wamid&id=eq.${encodeURIComponent(String(body.respondendoA))}&conversa_id=eq.${alvo.conversaId}&limit=1`).catch(() => null))?.[0];
      respondendoA = m?.wamid || null;
    }
    const final = await assinar(texto);
    const env = await enviarTexto({ para: alvo.telefone, texto: final, responderA: respondendoA, phoneId: alvo.phoneId });
    if (!env?.wamid) {
      console.warn('[rel-wa] texto recusado:', env?.erro, env?.detalhe);
      return res.status(502).json({ error: `A Meta não aceitou a mensagem${env?.detalhe ? `: ${env.detalhe}` : '.'}` });
    }
    await gravar({ wamid: env.wamid, texto: final, respondendoA });
    return res.status(200).json({ ok: true, wamid: env.wamid });
  }

  // ── Modelo aprovado (funciona com a janela fechada) ──
  if (acao === 'modelo') {
    const m = await resolverModeloMeta(body.modelo || {}, alvo.phoneId);
    if (m.error) return res.status(400).json({ error: ERRO_MODELO[m.error] || 'Modelo inválido.', variavel: m.variavel });
    const env = await enviarTemplate({ para: alvo.telefone, nome: m.nome, idioma: m.idioma, params: m.params, phoneId: alvo.phoneId });
    if (!env?.wamid) {
      console.warn('[rel-wa] modelo recusado:', env?.erro, env?.detalhe);
      return res.status(502).json({ error: `A Meta não aceitou o modelo${env?.detalhe ? `: ${env.detalhe}` : '.'}` });
    }
    const g = await gravar({ wamid: env.wamid, texto: m.texto });
    return res.status(200).json({ ok: true, wamid: env.wamid, conversaId: g.conversa || alvo.conversaId });
  }

  // ── Arquivo (voucher, roteiro em PDF, foto) ──
  if (acao === 'arquivo') {
    if (!janelaAberta(alvo.ultimaEntrada)) {
      return res.status(409).json({ error: 'Fora da janela de 24h só dá pra mandar modelo. Mande um modelo e espere o cliente responder.', motivo: 'janela-fechada' });
    }
    const mime = String(body.mimeType || '').split(';')[0].trim().toLowerCase();
    const tipo = TIPOS_ARQUIVO[mime];
    if (!tipo) return res.status(400).json({ error: 'Tipo de arquivo não aceito (use JPG, PNG, PDF, MP4 ou áudio MP3/OGG).' });
    const bytes = Buffer.from(String(body.dataBase64 || ''), 'base64');
    if (!bytes.length) return res.status(400).json({ error: 'Arquivo vazio.' });
    if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'Arquivo maior que 3 MB.' });
    const nome = String(body.fileName || 'arquivo').slice(0, 120);
    const legenda = String(body.legenda || '').trim().slice(0, 1000) || null;

    const up = await subirMidiaBytes(bytes, mime, nome, alvo.phoneId);
    if (!up?.id) return res.status(502).json({ error: `A Meta não aceitou o arquivo${up?.detalhe ? `: ${up.detalhe}` : '.'}` });
    const env = await enviarMidia({ para: alvo.telefone, tipo, mediaId: up.id, legenda, nomeArquivo: nome, phoneId: alvo.phoneId });
    if (!env?.wamid) return res.status(502).json({ error: `A Meta não enviou o arquivo${env?.detalhe ? `: ${env.detalhe}` : '.'}` });

    // Cópia no nosso bucket pra bolha mostrar o arquivo.
    const url = await guardarMidia(bytes, mime, { leadId: `rel-${alvo.telefone}`, nomeArquivo: nome }).catch(() => null);
    const tipoBolha = { image: 'image', video: 'video', audio: 'audio' }[tipo] || 'file';
    await gravar({ wamid: env.wamid, texto: legenda || '', anexos: url ? [{ type: tipoBolha, url, nome }] : [] });
    return res.status(200).json({ ok: true, wamid: env.wamid });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}
