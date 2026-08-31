// api/wa-calls.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): a porta do QS voltada PRA META (não pro Chatwoot).
//
//   GET  /api/wa-calls   → handshake de verificação do webhook
//   POST /api/wa-calls   → eventos do campo `calls` (ligação pelo WhatsApp)
//
// -- POR QUE UMA ROTA NOVA, E NÃO UM RAMO DO wa-webhook ----------------------
//
// Duas razões, e as duas são impeditivas:
//
//   1. QUEM MANDA É OUTRO. O `wa-webhook` recebe do CHATWOOT (está escrito no
//      cabeçalho dele) e se autentica por `?secret=`. Aqui quem manda é a META,
//      que assina o corpo com HMAC — e conferir HMAC exige o corpo CRU, o que
//      obriga `bodyParser: false`. Ligar isso no wa-webhook quebraria o
//      caminho do Chatwoot, que depende do corpo já parseado.
//
//   2. O TELEFONE ESTÁ TOCANDO. O `wa-webhook` roda o vigia e a fila da Glória
//      de carona a cada hit, e o próprio arquivo avisa que "o caminho do
//      webhook não pode engordar (auditoria de 20/08)". Sinalização de chamada
//      é tempo real: não pode ficar atrás de uma ronda de vigia.
//
// Esta rota faz UMA coisa: confere a assinatura, grava o evento e responde.
// Sem carona, sem ida ao n8n, sem nada que possa demorar.
//
// -- O QUE ELA AINDA NÃO FAZ ------------------------------------------------
//
// Não atende. Atender exige devolver um SDP answer (camada 2) e ter WebRTC no
// navegador (camada 3). Esta é a camada 1: fazer o evento CHEGAR.
//
// -- CONFIGURAÇÃO NA META (segundo app, assinado na mesma WABA) --------------
//
// Callback URL:  https://qs.setuforeuvouviagens.com.br/api/wa-calls
// Verify token:  META_CALLS_VERIFY_TOKEN
// Campo:         calls   (só ele — mensagem continua com o Chatwoot)
//
// ⚠️ Assinar o APP na WABA não é automático na interface nova da Meta. WABA sem
// app assinado não entrega webhook NENHUM, e não avisa. Se nada chegar aqui,
// é o primeiro lugar pra olhar.
//
// Envs: META_CALLS_VERIFY_TOKEN + META_CALLS_APP_SECRET + SUPABASE_*
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { insert } from './_supabaseAdmin.js';
import { findLeadByPhone } from './_wa.js';

// Sem isto o corpo chega parseado e a assinatura da Meta é inconferível: o HMAC
// é sobre os BYTES, e reserializar o JSON muda espaços e ordem de chaves.
export const config = { api: { bodyParser: false } };

/** Lê o corpo cru. Teto de 1 MB: SDP é texto, e o que passar disso não é nosso. */
async function corpoCru(req) {
  const partes = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 1_000_000) throw new Error('corpo grande demais');
    partes.push(c);
  }
  return Buffer.concat(partes);
}

/**
 * HMAC-SHA256 do corpo com o app secret, comparado sem vazar tempo.
 *
 * Devolve o PORQUÊ junto com o veredito. Um 401 mudo aqui é indistinguível
 * entre "secret do app errado" e "corpo chegou vazio", e as duas coisas se
 * consertam em lugares opostos — foi o que custou a noite de 31/08.
 */
function assinaturaConfere(raw, cabecalho, segredo) {
  const recebida = String(cabecalho || '').trim();
  if (!recebida) return { ok: false, motivo: 'sem-cabecalho' };
  // A Meta manda `sha256=<hex>`. Tolerar o hex pelado não custa nada e evita um
  // 401 idiota se ela mudar o formato.
  const hexRecebido = (recebida.startsWith('sha256=') ? recebida.slice(7) : recebida).toLowerCase();
  const hexEsperado = crypto.createHmac('sha256', segredo).update(raw).digest('hex');
  if (hexRecebido.length !== hexEsperado.length) {
    return { ok: false, motivo: 'formato', hexRecebido, hexEsperado };
  }
  // Buffer.from(x, 'hex') PARA no primeiro caractere que não é hex, calado. Sem
  // conferir o tamanho depois, um cabeçalho lixo derruba a rota com RangeError
  // no timingSafeEqual — 500 em vez de 401, e a Meta entra em retentativa.
  const a = Buffer.from(hexRecebido, 'hex');
  const b = Buffer.from(hexEsperado, 'hex');
  if (a.length !== b.length || a.length === 0) return { ok: false, motivo: 'nao-e-hex', hexRecebido, hexEsperado };
  const ok = crypto.timingSafeEqual(a, b);
  return { ok, motivo: ok ? null : 'digest-diferente', hexRecebido, hexEsperado };
}

export default async function handler(req, res) {
  // ── Handshake: a Meta chama uma vez, ao salvar a URL ──────────────────────
  if (req.method === 'GET') {
    const token = String(process.env.META_CALLS_VERIFY_TOKEN || '').trim();
    const q = req.query || {};
    if (token && q['hub.mode'] === 'subscribe' && String(q['hub.verify_token']) === token) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(q['hub.challenge'] ?? ''));
    }
    // 403 é o que a Meta espera quando o token não bate — e o log diz qual dos
    // dois lados está faltando, que é a única dúvida real nessa hora.
    console.warn(`[wa-calls] handshake recusado (token no servidor: ${token ? 'sim' : 'NAO'})`);
    return res.status(403).send('forbidden');
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const segredo = String(process.env.META_CALLS_APP_SECRET || '').trim();
  if (!segredo) {
    console.error('[wa-calls] META_CALLS_APP_SECRET ausente — rota desligada');
    return res.status(503).json({ error: 'Webhook de chamadas nao configurado' });
  }

  let raw;
  try {
    raw = await corpoCru(req);
  } catch (e) {
    console.warn('[wa-calls] corpo ilegivel:', e?.message);
    return res.status(400).json({ error: 'corpo invalido' });
  }

  // ── REDE DE SEGURANÇA: O RUNTIME PODE TER BEBIDO O STREAM PRIMEIRO ─────────
  //
  // `bodyParser: false` é o jeito documentado de manter o corpo cru numa função
  // Node da Vercel. Mas se por qualquer razão ele não valer (mudança de
  // runtime, a rota servida por outro caminho), o parser lê o stream ANTES do
  // handler e o `for await` acima devolve ZERO byte — e aí o HMAC é calculado
  // sobre nada e o 401 é garantido, com o app secret certíssimo.
  //
  // Reserializar o `req.body` recupera os mesmos bytes na esmagadora maioria
  // dos casos (o JSON da Meta não tem espaço sobrando e o JSON.parse preserva a
  // ordem das chaves). Não é a fonte da verdade — é o plano B, e ele se anuncia
  // no log pra ninguém depurar o mistério errado.
  let deOnde = 'stream';
  if (!raw.length && req.body != null) {
    raw = Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8');
    deOnde = 'req.body (stream ja consumido)';
  }

  const conf = assinaturaConfere(raw, req.headers['x-hub-signature-256'], segredo);
  if (!conf.ok) {
    // O digest NÃO é segredo (a Meta manda o dela no cabeçalho, aberto). Os 12
    // primeiros caracteres dos dois lados dizem, de um olhar, se é secret
    // trocado (digests diferentes) ou corpo vazio (tamanho 0 acima).
    console.warn(
      `[wa-calls] assinatura nao confere — motivo: ${conf.motivo}, corpo: ${raw.length}b de ${deOnde}, ` +
      `esperado ${String(conf.hexEsperado || '').slice(0, 12)}…, recebido ${String(conf.hexRecebido || '').slice(0, 12)}…`
    );
    return res.status(401).json({ error: 'assinatura invalida' });
  }
  if (deOnde !== 'stream') console.warn(`[wa-calls] assinatura OK, mas o corpo veio do ${deOnde}`);

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'json invalido' });
  }

  // ── Extração BEST-EFFORT ─────────────────────────────────────────────────
  // Os nomes de campo abaixo não foram conferidos contra um evento real — até
  // agora nenhum chegou. Por isso o `payload` cru vai junto em toda linha: se
  // eu errei um nome, o dado continua aqui e o conserto é uma migration, não
  // "liga de novo pra eu ver".
  const eventos = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (ch?.field !== 'calls') continue;
      const value = ch.value || {};
      const lista = Array.isArray(value.calls) ? value.calls : [];

      // ── `statuses`: a OUTRA lista, que só aparece na ligação de saída ──────
      // RINGING / ACCEPTED / REJECTED vêm num array separado, com outro formato
      // (`recipient_id` no lugar de `to`). Sem tratar aqui, o "o cliente está
      // tocando" cairia como evento desconhecido — e é justamente o que a tela
      // do SDR precisa mostrar enquanto ninguém atende.
      for (const st of Array.isArray(value.statuses) ? value.statuses : []) {
        eventos.push({
          payload: { ...value, statuses: [st] },
          call_id: st.id ?? null,
          evento: st.status ?? null,          // RINGING | ACCEPTED | REJECTED
          direcao: 'BUSINESS_INITIATED',
          para: st.recipient_id ?? null,
          de: value?.metadata?.display_phone_number ?? null,
        });
      }

      // Evento sem lista de chamadas ainda vale registro: é assim que se
      // descobre um formato diferente do esperado, em vez de descartar calado.
      if (!lista.length) { if (!Array.isArray(value.statuses) || !value.statuses.length) eventos.push({ payload: value }); continue; }
      for (const c of lista) {
        eventos.push({
          payload: { ...value, calls: [c] },
          call_id: c.id ?? c.call_id ?? null,
          evento: c.event ?? c.status ?? null,
          direcao: c.direction ?? null,
          de: c.from ?? null,
          para: c.to ?? value?.metadata?.display_phone_number ?? null,
          sdp: c.session?.sdp ?? c.sdp ?? null,
          sdp_tipo: c.session?.sdp_type ?? null,
        });
      }
    }
  }

  if (!eventos.length) {
    // Não é erro: a Meta manda outros campos por este mesmo endereço se alguém
    // assinar mais coisa. Registrar o corpo inteiro é o que permite descobrir.
    try {
      await insert('qs_wa_calls', { payload: body, evento: 'desconhecido' }, { returning: false });
    } catch (e) { console.warn('[wa-calls] evento desconhecido nao gravado:', e?.message); }
    return res.status(200).json({ ok: true, gravados: 0, motivo: 'sem-evento-de-chamada' });
  }

  let gravados = 0;
  for (const ev of eventos) {
    // O dono do telefone, quando existe. Chamada de número desconhecido NÃO é
    // descartada: `lead_id` fica nulo e a RLS deixa ver assim mesmo — esconder
    // até saber de quem é seria o mesmo que não atender.
    // De quem é o telefone do CLIENTE muda com a direção: na ligação que ele
    // faz, é o `de`; na que nós fazemos, é o `para` — e o `de` é a empresa.
    // Procurar sempre pelo `de` amarraria toda ligação de saída no lead errado
    // (ou em nenhum), e a RLS esconderia a chamada de quem a fez.
    const foneDoCliente = String(ev.direcao || '').toUpperCase() === 'BUSINESS_INITIATED'
      ? ev.para
      : ev.de;
    let leadId = null;
    try {
      if (foneDoCliente) leadId = (await findLeadByPhone(foneDoCliente))?.id ?? null;
    } catch (e) { console.warn('[wa-calls] lead nao resolvido:', e?.message); }

    try {
      await insert('qs_wa_calls', { ...ev, lead_id: leadId }, { returning: false });
      gravados++;
    } catch (e) {
      console.error('[wa-calls] evento nao gravado:', e?.message);
    }
  }

  console.log(`[wa-calls] ${gravados} evento(s): ${eventos.map((e) => e.evento || '?').join(', ')}`);
  // 200 sempre que a assinatura conferiu: webhook que recebe erro entra em
  // retentativa e a Meta pode suspender a inscrição. O que falhou está no log.
  return res.status(200).json({ ok: true, gravados });
}
