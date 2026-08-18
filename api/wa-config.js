// api/wa-config.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-config
//
// Devolve, numa chamada só, as listas que o painel de atendimento precisa
// ao abrir:
//   • respostas — as respostas prontas do Chatwoot (/atalho)
//   • inboxes   — os NÚMEROS que existem de verdade, pro SDR escolher por qual
//                 falar. Vem do Chatwoot (não da configuração) porque só existe
//                 caixa quando o número está conectado: assim o número oficial
//                 aparece sozinho no seletor no dia em que entrar no ar.
//   • modelos   — os templates APROVADOS na Meta (número oficial). O Chatwoot
//                 já sincroniza os templates de cada caixa Channel::Whatsapp;
//                 aqui só filtramos os aprovados e entregamos o corpo + as
//                 variáveis. É com eles que se abre conversa nova ou se fala
//                 fora da janela de 24h — texto livre a Meta recusa.
//
// Por que uma rota só em vez de duas: o plano da Vercel limita o projeto a 12
// funções, e nós estamos no teto. Fundir as duas consultas — que o front fazia
// lado a lado de qualquer jeito — devolve a folga e ainda corta uma ida ao
// servidor. Se um dia precisar de mais rotas, o caminho é consolidar as wa-*
// num despachante único (ou subir o plano), não espremer mais.
//
// Nenhuma das duas é crítica: falhou, devolve lista vazia. Sem atalhos e sem
// seletor o SDR ainda conversa normalmente.
// -----------------------------------------------------------------------------

import { getSupabaseUserId, cwConfigured, cw, defaultInboxId } from './_wa.js';
import { listarModelos, criarModelo, excluirModelo } from './_meta.js';
import { rest } from './_supabaseAdmin.js';

/** Só admin/gestor mexe nos modelos: eles vão pra análise da Meta em nome da
 *  empresa, e modelo reprovado sujando a conta afeta o número inteiro. */
async function ehAdmin(userId) {
  try {
    const u = await rest(`qs_users?select=role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`);
    const r = Array.isArray(u) && u[0];
    return !!r && r.is_active !== false && (r.role === 'admin' || r.role === 'gestor');
  } catch { return false; }
}

async function buscarRespostas() {
  try {
    const data = await cw('/canned_responses');
    const list = Array.isArray(data) ? data : (data?.payload || []);
    return list
      .map((c) => ({ atalho: String(c.short_code || ''), texto: String(c.content || '') }))
      .filter((c) => c.atalho && c.texto);
  } catch (e) {
    console.warn('[wa-config] canned_responses:', e?.message);
    return [];
  }
}

async function buscarInboxes() {
  try {
    const data = await cw('/inboxes');
    const list = Array.isArray(data?.payload) ? data.payload : [];
    const inboxes = list
      // Com a lista de caixas de WhatsApp configurada, ela manda. Sem ela,
      // devolvemos todas — melhor oferecer demais que travar o envio.
      // Só canais de WHATSAPP entram no seletor — a env virou atalho, não
      // requisito (mesma regra do inboxAceita): caixa de e-mail/site nunca deve
      // aparecer como "número pra falar", e a oficial nunca deve sumir por
      // alguém ter esquecido de somar o id na env.
      .filter((i) => /whatsapp|::api$/i.test(String(i.channel_type || '')))
      .map((i) => ({
        id: Number(i.id),
        nome: String(i.name || `Caixa ${i.id}`),
        canal: String(i.channel_type || ''),
        // O número em si, quando o Chatwoot sabe (as caixas da API oficial
        // trazem; as da Evolution vêm sem, e aí vale o nome da caixa). É o que
        // deixa o SDR ver "11 4863-6051" em vez de decorar nome de caixa.
        telefone: i.phone_number ? String(i.phone_number) : null,
      }));
    return { inboxes, modelos: extrairModelos(list) };
  } catch (e) {
    console.warn('[wa-config] inboxes:', e?.message);
    return { inboxes: [], modelos: [] };
  }
}

/**
 * Os templates que a Meta aprovou, já mastigados pro front: corpo com os
 * {{buracos}}, lista de variáveis na ordem, cabeçalho/rodapé quando são texto.
 * Só entram os APROVADOS — rascunho e rejeitado não podem ser enviados.
 */
function extrairModelos(inboxList) {
  const modelos = [];
  for (const i of inboxList) {
    if (!String(i.channel_type || '').includes('Channel::Whatsapp')) continue;
    for (const t of (Array.isArray(i.message_templates) ? i.message_templates : [])) {
      if (String(t.status || '').toLowerCase() !== 'approved') continue;
      const comp = Array.isArray(t.components) ? t.components : [];
      const corpo = comp.find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '';
      if (!corpo) continue;
      const header = comp.find((c) => String(c.type).toUpperCase() === 'HEADER');
      // Só oferecemos template de cabeçalho TEXTO: os de mídia exigem anexar um
      // arquivo no envio, e oferecer pra depois falhar é pior que não oferecer.
      if (header && String(header.format || 'TEXT').toUpperCase() !== 'TEXT') continue;
      modelos.push({
        inboxId: Number(i.id),
        nome: String(t.name || ''),
        idioma: String(t.language || 'pt_BR'),
        categoria: String(t.category || ''),
        cabecalho: header?.text || null,
        corpo,
        rodape: comp.find((c) => String(c.type).toUpperCase() === 'FOOTER')?.text || null,
        variaveis: [...corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]),
      });
    }
  }
  return modelos;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  // ── PORTAL DE MODELOS (só admin/gestor) ───────────────────────────────────
  // Vive nesta rota, e não numa nova, pela mesma razão do resto do arquivo: o
  // projeto está no teto prático de funções da Vercel.
  const querModelos = req.method === 'POST' || req.query?.modelos === 'todos';
  if (querModelos) {
    if (!(await ehAdmin(userId))) {
      return res.status(403).json({ error: 'Só administrador ou gestor gerencia os modelos.' });
    }
    if (!cwConfigured()) return res.status(503).json({ error: 'Atendimento não configurado.' });

    if (req.method === 'GET') {
      const r = await listarModelos();
      if (r.erro) return res.status(503).json({ error: 'Não achei o número oficial no atendimento.', motivo: r.erro });
      return res.status(200).json({ modelos: r.modelos });
    }

    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    if (body.acao === 'excluir') {
      const r = await excluirModelo(String(body.nome || ''));
      if (r.erro) return res.status(r.erro === 'sem-caixa-oficial' ? 503 : 400).json({ error: r.mensagem || 'Não consegui excluir.' });
      return res.status(200).json({ ok: true });
    }
    if (body.acao === 'criar') {
      const r = await criarModelo({
        nome: body.nome, categoria: body.categoria, idioma: body.idioma,
        corpo: body.corpo, cabecalho: body.cabecalho, rodape: body.rodape,
      });
      if (r.erro) return res.status(r.erro === 'sem-caixa-oficial' ? 503 : 400).json({ error: r.mensagem || 'Não consegui criar o modelo.' });
      return res.status(200).json({ ok: true, id: r.id, status: r.status });
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  if (!cwConfigured()) {
    return res.status(200).json({ respostas: [], inboxes: [], modelos: [], padrao: null });
  }

  const [respostas, caixas] = await Promise.all([buscarRespostas(), buscarInboxes()]);

  // Cache curto: as listas mudam raríssimo e o painel consulta a cada abertura.
  res.setHeader('Cache-Control', 'private, max-age=180');
  return res.status(200).json({
    respostas,
    inboxes: caixas.inboxes,
    modelos: caixas.modelos,
    padrao: defaultInboxId(),
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
