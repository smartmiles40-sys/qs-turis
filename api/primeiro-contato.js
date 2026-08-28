// api/primeiro-contato.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/primeiro-contato
//   header x-lead-secret: <PRIMEIRO_CONTATO_SECRET ou LEAD_INBOUND_SECRET>
//   { telefone: "5511...", lead_id?, origem? }
//
// A MENSAGEM AUTOMATICA DE PRIMEIRO CONTATO. Quem cai na etapa "primeiro
// contato" no Bitrix recebe o video de apresentacao. Nao tem IA nenhuma aqui:
// e template aprovado da Meta, disparado pelo QS.
//
// -- O QUE ELA SUBSTITUI ----------------------------------------------------
//
// Antes isso era um workflow do n8n mandando pelo ChatApp. Tres defeitos que
// morrem com a mudanca:
//
//   1. SEM DEDUPE. Automacao de Bitrix repete, e o lead recebia o video duas
//      vezes. Aqui o dedupe e a chave primaria de `qs_primeiro_contato`.
//   2. SEM RASTRO. Saia pelo ChatApp e sumia: nao havia como saber quem tinha
//      recebido, nem quando, nem se falhou. Agora ha uma linha por lead e uma
//      nota no card.
//   3. TELEFONE INVALIDO PASSAVA. O n8n calculava `telefone_invalido` e ninguem
//      lia. Aqui numero torto e 400, dito com todas as letras.
//
// -- POR QUE O ENVIO NAO PASSA PELO CHATWOOT --------------------------------
//
// O resto do QS manda WhatsApp pelo Chatwoot de proposito, pra mensagem cair na
// conversa e aparecer na tela do SDR. Este disparo e a excecao, por duas razoes
// que so valem pra ele:
//
//   1. O video NAO precisa aparecer pra equipe (Bruno, 28/08). E disparo, nao
//      conversa. A conversa comeca quando o lead responde — e a resposta entra
//      pelo caminho normal, via wa-webhook.
//   2. O Chatwoot NAO entrega template com cabecalho de midia: a issue #13159
//      (aberta desde 29/12/2025) mostra que ele monta payload invalido pra Meta
//      e a mensagem fica presa em "sending", sem erro.
//
// De quebra isso libera o `media_id`: o video sobe UMA vez e vale 30 dias, em
// vez de a Meta baixar 5,7 MB do bucket a cada lead.
//
// -- A CONFIGURACAO MORA NA TELA, NAO AQUI ----------------------------------
//
// `qs_settings.primeiro_contato_auto` guarda qual template, qual video, quais
// variaveis, o teto do dia e o liga/desliga. Trocar a mensagem e mexer na tela
// (Configuracoes -> Mensagem Automatica), sem deploy e sem tocar no n8n.
//
// -- ORDEM DAS TRAVAS, E POR QUE ESSA ---------------------------------------
//
// O dedupe e RESERVADO ANTES do envio, nao depois. Se viesse depois, uma falha
// de rede no meio deixaria o lead sem registro e o proximo retry do Bitrix
// mandaria de novo. Reservar antes troca "mandou duas vezes" (que vira bloqueio
// no WhatsApp) por "pode nao ter mandado" (que fica registrado como falhou).
//
// Envs: PRIMEIRO_CONTATO_SECRET (ou LEAD_INBOUND_SECRET) + CHATWOOT_* + SUPABASE_*
// (CHATWOOT_* ainda e usado: as credenciais da Meta sao lidas de la.)
// -----------------------------------------------------------------------------

import { findLeadByPhone } from './_wa.js';
import { enviarTemplate, subirMidiaPorUrl } from './_meta.js';
import { rest, insert, segredoConfere } from './_supabaseAdmin.js';

const CHAVE = 'primeiro_contato_auto';
const TETO_PADRAO = 200;
/** Dias antes de re-subir a midia. A Meta guarda por 30; 25 da folga. */
const MIDIA_VALIDA_DIAS = 25;

/**
 * Normaliza para E.164 BR de celular. Mesma regra do `Code` que rodava no n8n,
 * trazida pra ca de proposito: validacao que mora no encanamento e validacao
 * que ninguem le — foi exatamente assim que o disparo antigo saia com o
 * telefone vazio sem ninguem notar.
 */
function normalizarCelular(bruto) {
  const candidatos = String(bruto || '')
    .split(/[,;/|]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);

  for (const c of candidatos) {
    let d = c;
    if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
    if (!d.startsWith('55')) continue;
    const ddd = d.slice(2, 4);
    let num = d.slice(4);
    // Celular antigo de 8 digitos ganha o 9 que a Meta exige.
    if (num.length === 8 && /^[6-9]/.test(num)) num = '9' + num;
    // Fixo nao recebe WhatsApp. Barrar aqui e melhor que a Meta recusar depois.
    if (num.length !== 9 || num[0] !== '9') continue;
    return '55' + ddd + num;
  }
  return null;
}

/** Quantos JA sairam hoje, no fuso de Sao Paulo (o do time, nao o do UTC). */
async function enviadosHoje() {
  const agora = new Date();
  const emSP = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const meiaNoite = new Date(emSP); meiaNoite.setHours(0, 0, 0, 0);
  const desde = new Date(agora.getTime() - (emSP.getTime() - meiaNoite.getTime())).toISOString();
  try {
    const r = await rest(
      `qs_primeiro_contato?select=lead_id&status=eq.enviado` +
      `&criado_em=gte.${encodeURIComponent(desde)}&limit=2000`
    );
    return Array.isArray(r) ? r.length : 0;
  } catch (e) {
    // Na duvida, o numero que TRAVA. Teto que falha aberto nao e teto.
    console.warn('[primeiro-contato] nao consegui contar os de hoje:', e?.message);
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Grava o desfecho na linha ja reservada. Best-effort: nunca derruba o envio. */
async function fecharRegistro(leadId, patch) {
  try {
    await rest(`qs_primeiro_contato?lead_id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { ...patch, atualizado_em: new Date().toISOString() },
    });
  } catch (e) {
    console.warn('[primeiro-contato] registro nao fechou:', e?.message);
  }
}

/**
 * Devolve a midia pronta pro envio: `{ id }` quando ha upload valido, `{ url }`
 * como plano B. Grava o id novo na configuracao pro proximo disparo.
 */
async function prepararMidia(cfg) {
  if (!cfg.midia?.url) return null;

  const idade = cfg.midia.subido_em
    ? (Date.now() - new Date(cfg.midia.subido_em).getTime()) / 86400000
    : Infinity;
  if (cfg.midia.media_id && idade < MIDIA_VALIDA_DIAS) return { id: cfg.midia.media_id };

  const up = await subirMidiaPorUrl(cfg.midia.url);
  if (up.erro) {
    // Nao e fatal: da pra mandar por link. Perde a economia, nao o lead.
    console.warn(`[primeiro-contato] upload da midia falhou (${up.erro}); indo por link`);
    return { url: cfg.midia.url };
  }

  try {
    await rest(`qs_settings?key=eq.${CHAVE}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        value: {
          ...cfg,
          midia: { ...cfg.midia, media_id: up.id, subido_em: new Date().toISOString() },
        },
      },
    });
  } catch (e) {
    // Se nao gravou, o pior que acontece e subir de novo no proximo disparo.
    console.warn('[primeiro-contato] media_id nao gravado:', e?.message);
  }
  return { id: up.id };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  // Segredo proprio quando existir; senao o mesmo do lead-inbound, que vem do
  // mesmo n8n e do mesmo nivel de confianca. Assim ligar isto nao depende de
  // cadastrar variavel nova na Vercel.
  const segredo = String(process.env.PRIMEIRO_CONTATO_SECRET || process.env.LEAD_INBOUND_SECRET || '').trim();
  if (!segredo) return res.status(500).json({ error: 'Segredo nao configurado no servidor' });
  if (!segredoConfere(req.headers['x-lead-secret'], segredo)) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const origem = String(body.origem || 'bitrix').slice(0, 40);

  // ── A configuracao da tela ────────────────────────────────────────────────
  let cfg = null;
  try {
    const rows = await rest(`qs_settings?select=value&key=eq.${CHAVE}&limit=1`);
    cfg = rows?.[0]?.value || null;
  } catch (e) {
    console.error('[primeiro-contato] nao li a configuracao:', e?.message);
    return res.status(503).json({ error: 'Nao consegui ler a configuracao' });
  }
  if (!cfg || cfg.ativo !== true) {
    return res.status(200).json({ ok: false, motivo: 'desligado', detalhe: 'Ligue em Configuracoes -> Mensagem Automatica.' });
  }
  if (!cfg.template?.nome) {
    return res.status(200).json({ ok: false, motivo: 'sem_template', detalhe: 'Escolha o modelo aprovado na tela.' });
  }

  // ── O telefone ────────────────────────────────────────────────────────────
  const telefone = normalizarCelular(body.telefone ?? body.phone ?? body.Telefone);
  if (!telefone) {
    return res.status(400).json({
      ok: false, motivo: 'telefone_invalido',
      error: 'Telefone nao e um celular brasileiro valido (fixo ou numero incompleto nao recebe WhatsApp).',
    });
  }

  try {
    // ── O lead ──────────────────────────────────────────────────────────────
    // Tem que existir: quem cria lead e o `lead-inbound`. Sem card, a resposta
    // do cliente cairia em lugar nenhum.
    const lead = body.lead_id
      ? await buscarPorId(String(body.lead_id))
      : await findLeadByPhone(telefone);
    if (!lead) {
      return res.status(404).json({
        ok: false, motivo: 'lead_inexistente',
        error: 'Nao existe lead com esse telefone no QS. Confira se o lead-inbound rodou antes.',
      });
    }

    // ── DEDUPE: reserva ANTES de enviar (ver cabecalho) ─────────────────────
    let reservou = false;
    try {
      const r = await rest('qs_primeiro_contato', {
        method: 'POST',
        prefer: 'return=representation,resolution=ignore-duplicates',
        body: {
          lead_id: lead.id, telefone, template: cfg.template.nome,
          status: 'pendente', origem,
        },
      });
      reservou = Array.isArray(r) && r.length > 0;
    } catch (e) {
      console.error('[primeiro-contato] reserva falhou:', e?.message);
      return res.status(503).json({ error: 'Nao consegui reservar o disparo' });
    }
    if (!reservou) {
      // Ja existe linha pra este lead: ou ja recebeu, ou esta em andamento.
      return res.status(200).json({ ok: false, motivo: 'ja_enviado', lead_id: lead.id });
    }

    // ── O teto do dia ───────────────────────────────────────────────────────
    const teto = Number(cfg.teto_dia ?? TETO_PADRAO);
    const hoje = await enviadosHoje();
    if (Number.isFinite(teto) && teto > 0 && hoje >= teto) {
      await fecharRegistro(lead.id, { status: 'bloqueado', motivo: `teto_do_dia (${hoje}/${teto})` });
      return res.status(200).json({ ok: false, motivo: 'teto_do_dia', hoje, teto, lead_id: lead.id });
    }

    // ── A midia: sobe uma vez, reusa por 30 dias ────────────────────────────
    const midia = await prepararMidia(cfg);
    const formatoMidia = String(cfg.midia?.tipo || 'video').toUpperCase();

    // ── O ENVIO, DIRETO NA CLOUD API (ver cabecalho) ────────────────────────
    const params = montarParams(cfg.template.params || {}, lead);
    const r = await enviarTemplate({
      para: telefone,
      nome: cfg.template.nome,
      idioma: cfg.template.idioma || 'pt_BR',
      params,
      midia,
      formatoMidia,
    });

    if (r.erro) {
      const humano = {
        'sem-caixa-oficial': 'Nao achei o numero oficial no atendimento.',
        'sem-phone-number-id': 'A caixa oficial esta sem phone_number_id no Chatwoot.',
        'meta-recusou': `A Meta recusou: ${r.detalhe || 'sem detalhe'}`,
      }[r.erro] || r.erro;
      console.error(`[primeiro-contato] envio falhou lead=${lead.id} :: ${humano}`);
      await fecharRegistro(lead.id, { status: 'falhou', motivo: String(humano).slice(0, 300) });
      return res.status(502).json({ ok: false, motivo: r.erro, error: humano, codigo: r.codigo });
    }

    // ── DAQUI PRA BAIXO A MENSAGEM JA SAIU ──────────────────────────────────
    // Nada abaixo pode virar "nao consegui enviar": o cliente ja recebeu, e um
    // erro aqui faria alguem reenviar.
    await fecharRegistro(lead.id, {
      status: 'enviado',
      motivo: r.wamid ? `wamid: ${r.wamid}` : null,
    });

    // O video nao entra na thread (decisao de 28/08), mas o CARD precisa contar
    // que ele saiu — senao o SDR abre um lead que respondeu "quanto custa?" sem
    // saber o que a pessoa viu antes.
    try {
      await insert('qs_notes', {
        lead_id: lead.id,
        author_id: null,
        body: `📹 Video de apresentacao enviado automaticamente (primeiro contato).\nModelo: ${cfg.template.nome}`,
        tags: ['primeiro-contato', 'automatico'],
      }, { returning: false });
    } catch (e) {
      console.warn('[primeiro-contato] nota nao criada:', e?.message);
    }

    return res.status(200).json({
      ok: true, lead_id: lead.id, telefone,
      template: cfg.template.nome,
      midia: midia?.id ? 'media_id' : (midia?.url ? 'link' : 'sem_midia'),
      wamid: r.wamid,
      enviados_hoje: hoje + 1, teto,
    });
  } catch (err) {
    console.error('[primeiro-contato]', err?.message || err);
    return res.status(500).json({ error: 'Falha no disparo' });
  }
}

/**
 * Traduz os apelidos escolhidos na tela. A lista PRECISA bater com a do card:
 * apelido que so existe de um lado vira variavel vazia, e variavel vazia a Meta
 * recusa o template inteiro.
 */
function montarParams(mapa, lead) {
  const nome = String(lead?.full_name || lead?.first_name || '').trim();
  const primeiro = (lead?.first_name || nome.split(/\s+/)[0] || '').trim();
  const apelidos = {
    nome: nome || primeiro,
    primeiro_nome: primeiro,
    expedicao: String(lead?.segment || '').trim(),
    empresa: 'Se Tu For, Eu Vou',
  };
  const saida = {};
  for (const [chave, bruto] of Object.entries(mapa)) {
    const v = String(bruto ?? '');
    const ref = v.match(/^\s*\{\{\s*([a-z_]+)\s*\}\}\s*$/i);
    saida[chave] = ref ? String(apelidos[ref[1].toLowerCase()] ?? '').trim() : v;
  }
  return saida;
}

async function buscarPorId(id) {
  const rows = await rest(
    `qs_leads?select=id,owner_id,full_name,first_name,last_name,phone,status,segment&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return (Array.isArray(rows) && rows[0]) || null;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
