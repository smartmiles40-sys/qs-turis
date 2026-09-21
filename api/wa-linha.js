// api/wa-linha.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): o WHATSAPP DO PRÓPRIO SDR (0082, 21/09/2026).
//
//   GET  /api/wa-linha               → a minha linha (status, número)
//   GET  /api/wa-linha?todas=1       → todas as linhas (admin/gestor/closer)
//   POST /api/wa-linha { acao }      → acao: conectar | estado | desconectar | historico
//        (admin/gestor podem mandar `userId` pra agir na linha de outra pessoa)
//
// POR QUE O SDR PODE VER O QR AQUI, se no painel das linhas (wa-config) o QR é
// só da gestão: lá o QR é de um número COMPARTILHADO — quem lê pareia o próprio
// celular e passa a ler a conversa do time. Aqui o QR é do chip DAQUELE SDR, e
// o servidor só devolve o QR da linha de quem está logado. Nenhum SDR chega no
// QR de outro.
//
// Envs: EVOLUTION_URL + EVOLUTION_APIKEY (as mesmas de sempre) e
//       EVOLUTION_WEBHOOK_SECRET (o segredo que a Evolution manda de volta).
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';
import { getSupabaseUserId, waKey } from './_wa.js';
import {
  evo, evoConfigured, conectarInstancia, estadoInstancia, desconectarInstancia, noAr,
} from './_evolution.js';
import {
  linhaDoUsuario, atualizarLinha, nomeDaInstancia, urlDoWebhook, garantirInstancia,
  numeroDaInstancia, telefoneDoContato, ehConversaIgnorada,
} from './_waLinha.js';
import { leadDoTelefone, receberDaLinha } from './_waLinhaEntrada.js';

// Até onde o histórico volta. O time foi pro WhatsApp Web em 03/09/2026; 45
// dias cobre isso com folga sem arrastar o arquivo inteiro do chip.
const DIAS_DE_HISTORICO = 45;
// Orçamento de cada chamada da importação (a rota tem 60s na Vercel). A tela
// chama de novo com o `cursor` até `fim: true`.
const ORCAMENTO_MS = 40_000;

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

async function usuario(userId) {
  const rows = await rest(`qs_users?select=id,name,role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

const ehGestao = (u) => u?.role === 'admin' || u?.role === 'gestor';

export default async function handler(req, res) {
  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const eu = await usuario(userId).catch(() => null);
  if (!eu || eu.is_active === false) return res.status(403).json({ error: 'Seu usuário está inativo — fale com o gestor.' });
  if (eu.role === 'marketing') return res.status(403).json({ error: 'Este perfil não conecta WhatsApp.' });

  if (!evoConfigured()) {
    return res.status(503).json({ error: 'O servidor de WhatsApp (Evolution) não está configurado no QS.', motivo: 'sem-evolution' });
  }

  // ── Leitura ───────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      if (req.query?.todas && (ehGestao(eu) || eu.role === 'closer')) {
        const linhas = await rest(
          'qs_wa_linhas?select=user_id,instancia,numero,status,status_em,conectado_em,historico_em,' +
          'usuario:qs_users(name,role)&order=criado_em.asc'
        );
        return res.status(200).json({ linhas: Array.isArray(linhas) ? linhas : [] });
      }
      return res.status(200).json({ linha: await linhaDoUsuario(userId) });
    } catch (e) {
      if (/qs_wa_linhas|PGRST205|42P01/i.test(String(e?.message))) {
        return res.status(503).json({ error: 'Falta aplicar a migration 0082 no banco.', motivo: 'sem-migration' });
      }
      console.error('[wa-linha] leitura:', e?.message);
      return res.status(500).json({ error: 'Não consegui ler o seu WhatsApp.' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '').toLowerCase();

  // De quem é a linha. Só a gestão mexe na dos outros.
  let alvo = eu;
  if (body.userId && body.userId !== userId) {
    if (!ehGestao(eu)) return res.status(403).json({ error: 'Só administrador ou gestor mexe no WhatsApp de outra pessoa.' });
    alvo = await usuario(String(body.userId)).catch(() => null);
    if (!alvo) return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  try {
    let linha = await linhaDoUsuario(alvo.id);

    // ── CONECTAR: cria o número na Evolution (1ª vez) e devolve o QR ────────
    if (acao === 'conectar') {
      const webhook = urlDoWebhook(req);
      if (!webhook) {
        return res.status(503).json({
          error: 'Falta a variável EVOLUTION_WEBHOOK_SECRET na Vercel — sem ela as mensagens não voltariam pro QS.',
          motivo: 'sem-segredo-do-webhook',
        });
      }
      const nome = linha?.instancia || nomeDaInstancia(alvo);
      await garantirInstancia(nome, webhook);
      if (!linha) {
        await insert('qs_wa_linhas', { user_id: alvo.id, instancia: nome, status: 'connecting' }, { returning: false });
        linha = { user_id: alvo.id, instancia: nome };
      }
      const qr = await conectarInstancia(nome);
      if (qr.jaConectada) {
        const numero = await numeroDaInstancia(nome);
        await atualizarLinha(alvo.id, { status: 'open', status_em: new Date().toISOString(), ...(numero ? { numero } : {}) });
        return res.status(200).json({ ok: true, jaConectada: true, estado: 'open', numero });
      }
      if (!qr.base64 && !qr.pairingCode) {
        return res.status(502).json({ error: 'O servidor de WhatsApp não devolveu o QR. Tente de novo em alguns segundos.', motivo: 'sem-qr' });
      }
      await atualizarLinha(alvo.id, { status: 'connecting', status_em: new Date().toISOString() });
      return res.status(200).json({ ok: true, base64: qr.base64, pairingCode: qr.pairingCode });
    }

    if (!linha) return res.status(404).json({ error: 'Você ainda não conectou o seu WhatsApp.', motivo: 'sem-linha' });

    // ── ESTADO: a tela pergunta a cada 3s enquanto o QR está aberto ──────────
    if (acao === 'estado') {
      const estado = await estadoInstancia(linha.instancia);
      let numero = linha.numero;
      if (estado !== 'desconhecido' && estado !== linha.status) {
        const patch = { status: estado, status_em: new Date().toISOString() };
        if (noAr(estado)) {
          patch.conectado_em = patch.status_em;
          numero = (await numeroDaInstancia(linha.instancia)) || numero;
          if (numero) patch.numero = numero;
        }
        await atualizarLinha(alvo.id, patch);
      }
      return res.status(200).json({ ok: true, estado, numero, historicoEm: linha.historico_em });
    }

    // ── DESCONECTAR: troca de chip/aparelho ─────────────────────────────────
    if (acao === 'desconectar') {
      try {
        await desconectarInstancia(linha.instancia);
      } catch (e) {
        // Já deslogada é o resultado que a pessoa queria.
        console.warn('[wa-linha] logout:', e?.message);
      }
      await atualizarLinha(alvo.id, { status: 'close', status_em: new Date().toISOString() });
      return res.status(200).json({ ok: true, estado: 'close' });
    }

    // ── HISTÓRICO: puxa pro QS o que foi conversado pelo WhatsApp Web ────────
    if (acao === 'historico') {
      if (!noAr(await estadoInstancia(linha.instancia))) {
        return res.status(409).json({ error: 'Conecte o WhatsApp antes de importar o histórico.', motivo: 'numero-desconectado' });
      }
      // `telefone`: só a conversa de UMA pessoa (a triagem, depois de criar o
      // lead de quem escreveu sem ser lead). Não conta como importação completa.
      const telefone = body.telefone ? String(body.telefone) : null;
      const r = await importarHistorico(linha, Number(body.cursor) || 0, { telefone });
      if (r.fim && !telefone && !r.aindaSincronizando) await atualizarLinha(alvo.id, { historico_em: new Date().toISOString() });
      return res.status(200).json({ ok: true, ...r });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error(`[wa-linha] ${acao}:`, e?.message, e?.body ? JSON.stringify(e.body).slice(0, 300) : '');
    if (/qs_wa_linhas|PGRST205|42P01/i.test(String(e?.message))) {
      return res.status(503).json({ error: 'Falta aplicar a migration 0082 no banco.', motivo: 'sem-migration' });
    }
    return res.status(502).json({ error: 'O servidor de WhatsApp não respondeu. Tente de novo.', detalhe: e?.message });
  }
}

/**
 * As conversas do chip, na ordem, a partir do `cursor`. Só entram conversas
 * com quem É LEAD (decisão do Bruno, 21/09): conversa com número que não está
 * no QS fica só no celular. Idempotente: rodar de novo não duplica nada (a
 * chave é o id da mensagem no WhatsApp).
 */
async function importarHistorico(linha, cursor, { telefone: soEste = null } = {}) {
  const chaveAlvo = soEste ? waKey(soEste) : null;
  const inicio = Date.now();
  const desde = Date.now() - DIAS_DE_HISTORICO * 86_400_000;
  const inst = encodeURIComponent(linha.instancia);

  const bruto = await evo(`/chat/findChats/${inst}`, {}, { timeoutMs: 25_000 });
  const todas = Array.isArray(bruto) ? bruto : [];
  const chats = todas
    .filter((c) => !ehConversaIgnorada(c?.remoteJid))
    .filter((c) => {
      const t = Date.parse(c?.updatedAt || '') || 0;
      return !t || t >= desde;
    })
    .sort((a, b) => String(a.remoteJid).localeCompare(String(b.remoteJid)));

  // O que aconteceu com cada conversa. Vai pro log da Vercel e pra tela: a 1ª
  // versão respondia "terminei" sem dizer POR QUE não trouxe nada (21/09).
  const conta = { conversas: chats.length, semTelefone: 0, semLead: 0, comLead: 0, lid: 0 };

  let i = cursor;
  let importadas = 0;
  let leads = 0;
  for (; i < chats.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const chat = chats[i];
    const ehLid = String(chat.remoteJid || '').endsWith('@lid');
    if (ehLid) conta.lid += 1;

    let telefone = telefoneDoContato({
      remoteJid: chat.remoteJid,
      remoteJidAlt: chat.remoteJidAlt || chat.lastMessage?.key?.remoteJidAlt,
      senderPn: chat.lastMessage?.key?.senderPn,
    });

    // Primeira página já lida aqui quando o telefone não veio no chat: conversa
    // @lid cuja ÚLTIMA mensagem não traz o número real. Alguma das outras traz
    // (remoteJidAlt/senderPn) — é a mesma página que seria importada depois.
    let primeiraPagina = null;
    if (!telefone && ehLid) {
      primeiraPagina = await evo(`/chat/findMessages/${inst}`, {
        where: { key: { remoteJid: chat.remoteJid } }, page: 1, offset: 50,
      }, { timeoutMs: 20_000 }).catch(() => null);
      const regs = primeiraPagina?.messages?.records || [];
      for (const r of regs) {
        telefone = telefoneDoContato(r?.key || {});
        if (telefone) break;
      }
    }
    if (!telefone) { conta.semTelefone += 1; continue; }
    if (chaveAlvo && waKey(telefone) !== chaveAlvo) continue;
    const lead = await leadDoTelefone(telefone, linha.user_id);
    if (!lead) { conta.semLead += 1; continue; }
    conta.comLead += 1;

    let achouAlguma = false;
    for (let pagina = 1; pagina <= 10; pagina++) {
      const out = pagina === 1 && primeiraPagina
        ? primeiraPagina
        : await evo(`/chat/findMessages/${inst}`, {
          where: { key: { remoteJid: chat.remoteJid } }, page: pagina, offset: 50,
        }, { timeoutMs: 20_000 });
      const registros = out?.messages?.records || (Array.isArray(out) ? out : []);
      if (!registros.length) break;
      let passouDoLimite = false;
      for (const item of registros) {
        const ts = Number(item?.messageTimestamp) * 1000;
        if (ts && ts < desde) { passouDoLimite = true; continue; }
        // Mídia só enquanto sobra tempo; o que ficar sem arquivo entra com o
        // rótulo ("📷 imagem") e ganha o arquivo se a importação rodar de novo.
        const comArquivo = Date.now() - inicio < ORCAMENTO_MS * 0.75;
        const r = await receberDaLinha(linha, item, { aoVivo: false, baixarArquivos: comArquivo, lead });
        if (r?.novo) importadas += 1;
        achouAlguma = true;
      }
      const totalPaginas = Number(out?.messages?.pages) || 1;
      if (passouDoLimite || pagina >= totalPaginas) break;
    }
    if (achouAlguma) leads += 1;
  }

  const fim = i >= chats.length;
  console.log(`[wa-linha] histórico ${linha.instancia}: cursor ${cursor}→${i} · brutas ${todas.length}`,
    JSON.stringify({ ...conta, importadas, leads, fim }));

  // Cedo demais? O WhatsApp manda o histórico em lotes nos primeiros minutos
  // depois do QR. Importar aos 17 segundos (foi o que aconteceu em 21/09) acha
  // meia dúzia de conversas e diz "pronto". Aqui a tela avisa pra esperar.
  const conectouHaMin = linha.conectado_em ? (Date.now() - Date.parse(linha.conectado_em)) / 60_000 : 999;
  const aindaSincronizando = fim && cursor === 0 && conectouHaMin < 10 && todas.length < 30;

  return { cursor: i, total: chats.length, importadas, leads, fim, aindaSincronizando, resumo: conta };
}
