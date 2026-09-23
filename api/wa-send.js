// api/wa-send.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-send
//   { leadId, text, respondendoA? }                   → texto (janela de 24h)
//   { leadId, modelo: { nome, idioma, params, midia? } } → MODELO aprovado
//
// Manda pelo número OFICIAL, direto na Cloud API da Meta (23/09/2026). Até
// 22/09 o envio passava pelo Chatwoot (e pelo chip do SDR na Evolution); os
// dois saíram do QS — a Evolution era a suspeita de derrubar os números.
//
// O SDR nunca escreve pra lead que não é dele: o telefone sai do LEAD, depois
// de o servidor confirmar a posse. E quem assina a mensagem é a sessão, não o
// navegador.
// -----------------------------------------------------------------------------

import {
  assertCanAccessLead, getSupabaseUserId, completeWhatsAppTask, assinarComoUsuario, toE164BR,
} from './_wa.js';
import { enviarTexto, enviarTemplate, subirMidiaPorUrl } from './_meta.js';
import {
  janelaAberta, registrarSaida, resolverModeloMeta, mensagemCitada,
} from './_waSaida.js';
import { pediuParaParar } from './_waOptout.js';

const MAX_LEN = 4000;

const ERRO_MODELO = {
  'modelo-nao-encontrado': 'Esse modelo não está aprovado na Meta (ou foi removido).',
  'modelo-variavel-vazia': 'Preencha todas as variáveis do modelo.',
  'modelo-precisa-de-midia': 'Esse modelo tem imagem/vídeo no topo — ele só pode ser enviado pela tela de disparo.',
  'modelo-sem-nome': 'Modelo inválido.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const leadId = String(body.leadId || '').trim();
  const text = String(body.text || '').trim();
  const modelo = body.modelo && typeof body.modelo === 'object' ? body.modelo : null;
  const respondendoA = String(body.respondendoA || '').trim();

  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
  if (!modelo && !text) return res.status(400).json({ error: 'Mensagem vazia' });
  if (text.length > MAX_LEN) return res.status(400).json({ error: `Mensagem muito longa (máx. ${MAX_LEN})` });

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-send] checagem de acesso:', e?.message);
    return res.status(500).json({ error: 'Falha ao validar o lead' });
  }
  if (!auth.ok) {
    const status = auth.reason === 'lead-de-outro-sdr' ? 403 : 404;
    return res.status(status).json({ error: 'Sem acesso a este lead', motivo: auth.reason });
  }
  const telefone = auth.lead?.phone;
  if (!telefone) return res.status(409).json({ error: 'Este lead não tem telefone.', motivo: 'sem-telefone' });

  // Quem pediu para parar (0087) não recebe mais nada — nem modelo.
  if (await pediuParaParar(leadId).catch(() => false)) {
    return res.status(409).json({
      error: 'Este cliente pediu para não receber mais mensagens.',
      motivo: 'optout',
    });
  }

  try {
    let r;
    let textoDaBolha;
    let citada = { wamid: null, trecho: null };

    if (modelo) {
      const m = await resolverModeloMeta(modelo);
      if (m.error) {
        const msg = m.error === 'modelo-variavel-vazia'
          ? `Preencha a variável {{${m.variavel}}} do modelo.`
          : (ERRO_MODELO[m.error] || 'Não consegui usar esse modelo.');
        return res.status(400).json({ error: msg, motivo: m.error });
      }
      let midia = null;
      if (m.midia?.url) {
        const up = await subirMidiaPorUrl(m.midia.url);
        midia = up.id ? { id: up.id } : { url: m.midia.url };
      }
      r = await enviarTemplate({
        para: String(toE164BR(telefone) || '').replace(/\D/g, ''),
        nome: m.nome, idioma: m.idioma, params: m.params, midia, formatoMidia: m.formatoMidia || 'VIDEO',
      });
      // Modelo NÃO leva assinatura: o texto tem que sair idêntico ao aprovado.
      textoDaBolha = m.texto;
    } else {
      if (!(await janelaAberta(leadId))) {
        return res.status(409).json({
          error: 'O cliente não fala com a gente há mais de 24h. Pelo número oficial, ' +
                 'a Meta só entrega MODELO aprovado — use um modelo para reabrir a conversa.',
          motivo: 'fora-da-janela-24h',
        });
      }
      citada = await mensagemCitada(leadId, respondendoA);
      textoDaBolha = await assinarComoUsuario(text, auth.user);
      r = await enviarTexto({ para: telefone, texto: textoDaBolha, responderA: citada.wamid });
    }

    if (r.erro) {
      console.warn(`[wa-send] a Meta recusou (${r.erro}${r.codigo ? ' ' + r.codigo : ''}): ${r.detalhe || ''}`);
      // 131047 = janela de 24h fechada do lado da Meta (nosso banco não sabia).
      if (r.codigo === 131047) {
        return res.status(409).json({
          error: 'A Meta diz que a janela de 24h está fechada. Use um modelo aprovado.',
          motivo: 'fora-da-janela-24h',
        });
      }
      if (r.erro === 'sem-caixa-oficial') {
        return res.status(503).json({ error: 'O número oficial não está configurado (META_CALLS_TOKEN / META_PHONE_NUMBER_ID).' });
      }
      return res.status(502).json({ error: r.detalhe || 'A Meta não aceitou a mensagem.', motivo: r.erro, codigo: r.codigo });
    }

    // ⚠️ DAQUI PRA BAIXO A MENSAGEM JÁ SAIU PRO CLIENTE: nada pode virar erro.
    await registrarSaida({
      leadId, wamid: r.wamid, texto: textoDaBolha, remetente: auth.user?.name || null,
      respondendoA: citada.wamid, trechoCitado: citada.trecho,
    });

    let tarefa = null;
    try {
      tarefa = await completeWhatsAppTask(leadId, auth.lead?.owner_id ?? null);
    } catch (e) {
      console.warn('[wa-send] não consegui concluir a atividade:', e?.message);
    }
    return res.status(200).json({ ok: true, wamid: r.wamid, tarefaConcluida: tarefa });
  } catch (e) {
    console.error('[wa-send]', e?.message);
    return res.status(502).json({ error: 'Não consegui enviar a mensagem. Tente de novo.' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
