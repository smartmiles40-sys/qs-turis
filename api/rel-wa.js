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
//   POST { acao: 'figurinha', conversaId, figurinhaId | url }   (14/10)
//   POST { acao: 'figurinha-salvar', dataBase64 | url, animada? } → biblioteca do time
//   POST { acao: 'reacao',  conversaId, mensagemId, emoji }  (emoji '' tira)
//   POST { acao: 'encaminhar', mensagemId, conversaIds: [] }
//   'modelo' também aceita { telefone } → começa conversa com um número novo
//
// Tudo sai pelo número do RELACIONAMENTO (setor = relacionamento em
// qs_wa_numeros_meta) — nunca pelo do Comercial. Só quem tem acesso ao
// Relacionamento usa. O telefone sai da CONVERSA/FICHA no banco, nunca do
// navegador, e quem assina a mensagem é a sessão.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { enviarTexto, enviarTemplate, enviarMidia, subirMidiaBytes, marcarComoLida, modelosAprovados, enviarReacao } from './_meta.js';
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

// Figurinha da Meta: WEBP 512×512, estática até 100 KB, animada até 500 KB.
const MAX_FIGURINHA = 500 * 1024;
const MIDIA_PUBLICA = () => `${String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/wa-midia/`;

/** Baixa um arquivo NOSSO (bucket wa-midia). URL de fora é recusada. Nunca lança. */
async function baixarNosso(url, max = MAX_BYTES) {
  try {
    const base = new URL(MIDIA_PUBLICA());
    const u = new URL(String(url || ''));
    // Compara já normalizado (o URL resolve %2e%2e e ..) — só o nosso bucket.
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname) || decodeURIComponent(u.pathname).includes('..')) {
      return { erro: 'Arquivo de fora do QS.' };
    }
    const r = await fetch(u.href);
    if (!r.ok) return { erro: 'Não consegui ler o arquivo guardado.' };
    if (Number(r.headers.get('content-length') || 0) > max) return { erro: 'Arquivo grande demais.' };
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > max) return { erro: 'Arquivo grande demais.' };
    const mime = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return { bytes, mime, caminho: u.pathname };
  } catch {
    return { erro: 'Não consegui ler o arquivo guardado.' };
  }
}

const ehWebp = (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
// WEBP animado tem o bloco "ANIM" logo no começo (cabeçalho VP8X).
const ehAnimada = (b) => b.subarray(0, 64).includes(Buffer.from('ANIM'));
/** Figurinha válida pra Meta: WEBP, estática ≤100 KB, animada ≤500 KB. */
function conferirFigurinha(b) {
  if (!ehWebp(b)) return 'Figurinha precisa ser WEBP.';
  if (!ehAnimada(b) && b.length > 100 * 1024) return 'Figurinha estática maior que 100 KB (limite da Meta).';
  if (b.length > MAX_FIGURINHA) return 'Figurinha maior que 500 KB.';
  return null;
}

/** Telefone digitado → só dígitos. Sem "+" e com 10–11 dígitos = Brasil (ganha 55). */
function normalizarTelefone(t) {
  const bruto = String(t || '').trim();
  let d = bruto.replace(/\D/g, '');
  if (!bruto.startsWith('+') && (d.length === 10 || d.length === 11)) d = `55${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** Celular BR com e sem o nono dígito (a Meta às vezes grava o wa_id sem ele). */
function variantesBr(d) {
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [d, `${d.slice(0, 4)}9${d.slice(4)}`];
  return [d];
}

// Os rótulos que ficam no lugar de mídia que não baixou ("📷 imagem"…).
const ROTULOS_SEM_ARQUIVO = new Set(['📷 imagem', '🎤 áudio', '🎬 vídeo', '📎 arquivo']);

/** A conversa (ou a ficha, pra começar uma) → telefone + número de envio. */
async function destino({ conversaId, clienteId, telefone }, numero) {
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
  if (telefone) {
    const fone = normalizarTelefone(telefone);
    if (!fone) return { erro: 'Telefone inválido. Use DDD + número (ou +DDI).' };
    const c = (await rest(
      `rel_wa_conversas?select=id,telefone,ultima_entrada_em&telefone=in.(${variantesBr(fone).join(',')})&phone_number_id=eq.${encodeURIComponent(numero.phone_number_id)}&order=ultima_entrada_em.desc.nullslast&limit=1`
    ))?.[0];
    // Já existe conversa (com ou sem o 9): usa o telefone dela, senão nasce outra.
    return { telefone: c?.telefone || fone, phoneId: numero.phone_number_id, ultimaEntrada: c?.ultima_entrada_em || null, conversaId: c?.id || null };
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
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  // ── Guardar figurinha na biblioteca do time (não precisa do número) ──
  if (acao === 'figurinha-salvar') {
    let url = null;
    let animada = false;
    if (body.url) {
      const b = await baixarNosso(body.url, MAX_FIGURINHA);
      if (b.erro) return res.status(400).json({ error: b.erro });
      const ruim = conferirFigurinha(b.bytes);
      if (ruim) return res.status(400).json({ error: ruim });
      animada = ehAnimada(b.bytes);
      url = String(body.url);
    } else {
      const bytes = Buffer.from(String(body.dataBase64 || ''), 'base64');
      if (!bytes.length) return res.status(400).json({ error: 'Figurinha vazia.' });
      const ruim = conferirFigurinha(bytes);
      if (ruim) return res.status(400).json({ error: ruim });
      animada = ehAnimada(bytes);
      url = await guardarMidia(bytes, 'image/webp', { leadId: 'rel-figurinhas', nomeArquivo: 'figurinha.webp' }).catch(() => null);
      if (!url) return res.status(502).json({ error: 'Não consegui guardar a figurinha.' });
    }
    const r = await rest('rel_wa_figurinhas?on_conflict=url', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      body: { url, animada, criado_por: u.id },
    }).catch((e) => ({ erro: e?.message }));
    if (r?.erro) return res.status(500).json({ error: 'Não salvei a figurinha.' });
    return res.status(200).json({ ok: true, figurinha: Array.isArray(r) ? r[0] : null });
  }

  if (!numero || !conectado) {
    return res.status(409).json({ error: 'O número do Relacionamento não está conectado. Peça ao admin para conectar em Configurações → WhatsApp (Meta).', motivo: 'sem-numero' });
  }

  // ── Encaminhar: uma mensagem pra até 5 conversas ──
  if (acao === 'encaminhar') {
    const msgId = String(body.mensagemId || '');
    const alvos = (Array.isArray(body.conversaIds) ? body.conversaIds : []).map(String).filter((x) => UUID.test(x)).slice(0, 5);
    if (!UUID.test(msgId) || !alvos.length) return res.status(400).json({ error: 'Escolha a mensagem e pra quem encaminhar.' });
    const m = (await rest(`rel_wa_mensagens?select=texto,anexos&id=eq.${msgId}&limit=1`).catch(() => null))?.[0];
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const semAnexo = !(Array.isArray(m.anexos) && m.anexos.length);
    if (semAnexo && ROTULOS_SEM_ARQUIVO.has(String(m.texto || '').trim())) {
      return res.status(400).json({ error: 'O arquivo dessa mensagem não foi guardado no QS — não dá pra encaminhar.' });
    }
    const resultado = [];
    for (const cid of alvos) {
      const a = await destino({ conversaId: cid }, numero).catch((e) => ({ erro: e?.message }));
      if (a.erro) { resultado.push({ conversaId: cid, ok: false, erro: a.erro }); continue; }
      if (!janelaAberta(a.ultimaEntrada)) { resultado.push({ conversaId: cid, ok: false, erro: 'janela de 24h fechada' }); continue; }
      const gravarAqui = (extra) => gravarRel({ phoneId: a.phoneId, telefone: a.telefone, direcao: 'out', origem: 'qs', autorId: u.id, autorNome: u.name, status: 'sent', ...extra });
      try {
        const anexos = Array.isArray(m.anexos) ? m.anexos : [];
        if (anexos.length) {
          for (const [i, ax] of anexos.entries()) {
            const b = await baixarNosso(ax.url);
            if (b.erro) throw new Error(b.erro);
            // Figurinha = WEBP mandado sem legenda (foto WEBP comum vai como imagem não aceita → documento).
            const figurinha = b.mime === 'image/webp' && !String(m.texto || '').trim() && !conferirFigurinha(b.bytes);
            const tipo = figurinha ? 'sticker' : (TIPOS_ARQUIVO[b.mime] || 'document');
            const up = await subirMidiaBytes(b.bytes, b.mime || 'application/octet-stream', ax.nome || 'arquivo', a.phoneId);
            if (!up?.id) throw new Error(up?.detalhe || 'a Meta não aceitou o arquivo');
            const legenda = i === 0 && !figurinha ? (m.texto || null) : null;
            const env = await enviarMidia({ para: a.telefone, tipo, mediaId: up.id, legenda, nomeArquivo: ax.nome || null, phoneId: a.phoneId });
            if (!env?.wamid) throw new Error(env?.detalhe || 'a Meta não enviou');
            await gravarAqui({ wamid: env.wamid, texto: legenda || '', anexos: [ax] });
          }
        } else {
          const t = String(m.texto || '').trim();
          if (!t) throw new Error('mensagem vazia');
          const env = await enviarTexto({ para: a.telefone, texto: t, phoneId: a.phoneId });
          if (!env?.wamid) throw new Error(env?.detalhe || 'a Meta não aceitou');
          await gravarAqui({ wamid: env.wamid, texto: t });
        }
        resultado.push({ conversaId: cid, ok: true });
      } catch (e) {
        resultado.push({ conversaId: cid, ok: false, erro: e?.message || 'falhou' });
      }
    }
    return res.status(200).json({ ok: resultado.every((r) => r.ok), resultado });
  }

  const alvo = await destino({
    conversaId: body.conversaId ? String(body.conversaId) : null,
    clienteId: body.clienteId ? String(body.clienteId) : null,
    telefone: body.telefone && acao === 'modelo' ? String(body.telefone) : null,
  }, numero)
    .catch((e) => ({ erro: e?.message || 'Falha ao ler a conversa.' }));
  if (alvo.erro) return res.status(404).json({ error: alvo.erro });

  const primeiroNome = String(u.name || '').trim().split(/\s+/)[0] || 'Relacionamento';
  // Assinatura = o NOME COMPLETO cadastrado na tela Equipe (Bruno, 14/10: "se
  // colocar Tainara Vasconcelos, sempre manda com o nome cadastrado lá").
  // O primeiro nome fica só pra reação.
  const nomeAssinatura = String(u.name || '').trim().replace(/\s+/g, ' ') || 'Relacionamento';
  const assinar = async (t) => ((await lerAssinatura()) ? `*${nomeAssinatura}:*\n${t}` : t);
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

  // ── Reação (emoji vazio tira) ──
  if (acao === 'reacao') {
    if (!janelaAberta(alvo.ultimaEntrada)) return res.status(409).json({ error: 'Fora da janela de 24h a Meta não deixa reagir.', motivo: 'janela-fechada' });
    const emoji = String(body.emoji ?? '').slice(0, 16);
    const m = (await rest(`rel_wa_mensagens?select=wamid&id=eq.${encodeURIComponent(String(body.mensagemId || ''))}&conversa_id=eq.${alvo.conversaId}&limit=1`).catch(() => null))?.[0];
    if (!m?.wamid) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const env = await enviarReacao({ para: alvo.telefone, wamid: m.wamid, emoji, phoneId: alvo.phoneId });
    if (!env?.wamid) return res.status(502).json({ error: `A Meta não aceitou a reação${env?.detalhe ? `: ${env.detalhe}` : '.'}` });
    await rest('rpc/rel_wa_reagir', { method: 'POST', body: { p_wamid: m.wamid, p_de: u.id, p_nome: primeiroNome, p_emoji: emoji } }).catch(() => null);
    return res.status(200).json({ ok: true });
  }

  // ── Figurinha ──
  if (acao === 'figurinha') {
    if (!janelaAberta(alvo.ultimaEntrada)) return res.status(409).json({ error: 'Fora da janela de 24h só dá pra mandar modelo.', motivo: 'janela-fechada' });
    let url = body.url ? String(body.url) : null;
    if (body.figurinhaId) {
      const f = (await rest(`rel_wa_figurinhas?select=url&id=eq.${encodeURIComponent(String(body.figurinhaId))}&limit=1`).catch(() => null))?.[0];
      url = f?.url || null;
    }
    if (!url) return res.status(400).json({ error: 'Escolha a figurinha.' });
    const b = await baixarNosso(url, MAX_FIGURINHA);
    if (b.erro) return res.status(400).json({ error: b.erro });
    const ruim = conferirFigurinha(b.bytes);
    if (ruim) return res.status(400).json({ error: ruim });
    const up = await subirMidiaBytes(b.bytes, 'image/webp', 'figurinha.webp', alvo.phoneId);
    if (!up?.id) return res.status(502).json({ error: `A Meta não aceitou a figurinha${up?.detalhe ? `: ${up.detalhe}` : '.'}` });
    const env = await enviarMidia({ para: alvo.telefone, tipo: 'sticker', mediaId: up.id, phoneId: alvo.phoneId });
    if (!env?.wamid) return res.status(502).json({ error: `A Meta não enviou a figurinha${env?.detalhe ? `: ${env.detalhe}` : '.'}` });
    await gravar({ wamid: env.wamid, texto: '', anexos: [{ type: 'image', url, nome: 'figurinha.webp' }] });
    return res.status(200).json({ ok: true, wamid: env.wamid });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}
