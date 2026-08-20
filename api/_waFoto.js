// api/_waFoto.js
// -----------------------------------------------------------------------------
// A FOTO DE PERFIL do cliente no WhatsApp.
//
// O problema que isto resolve, medido em 10/08: 566 conversas na base, 429 já
// sincronizadas e apenas 33 com foto (6%). Não era falta de sincronizar — o QS
// lia a foto do `contact.thumbnail` do Chatwoot, que está vazio em ~92% dos
// contatos porque a Evolution não empurrou a imagem quando criou o contato.
//
// Então a foto passa a vir da fonte real (a Evolution, que fala com o WhatsApp)
// e é REHOSPEDADA no Supabase Storage. Rehospedar não é capricho: a URL que o
// WhatsApp devolve (pps.whatsapp.net) é assinada e EXPIRA em poucos dias —
// guardá-la crua daria uma base inteira de fotos quebradas em uma semana. É o
// mesmo caminho que o Chatwoot faz nas 33 que funcionam hoje (active_storage).
//
// PRIVACIDADE: o bucket `wa-avatars` é público, mas o caminho do arquivo usa o
// UUID do lead — NUNCA o telefone. Um id de lead não é adivinhável e não revela
// nada sobre a pessoa, ao contrário de um arquivo chamado `5511999998888.jpg`.
//
// Nada aqui é obrigatório: sem Evolution configurada, sem foto no perfil ou com
// o Storage fora do ar, a função devolve null e o avatar cai nas iniciais
// coloridas — que é uma resposta legítima, não uma falha.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { evoConfigured, instanciaDaCaixa, fetchProfilePicture } from './_evolution.js';

const BUCKET = 'wa-avatars';
const MAX_BYTES = 2 * 1024 * 1024;   // teto do bucket; foto de perfil é ~10-40 KB

/** A foto já é nossa (rehospedada)? Então não precisa buscar de novo. */
export function fotoJaEhNossa(url) {
  return typeof url === 'string' && url.includes(`/${BUCKET}/`);
}

/**
 * Baixa a imagem e joga no bucket. Devolve a URL pública, ou null.
 *
 * `upsert` de propósito: o mesmo lead sempre grava no mesmo caminho, então
 * trocar a foto de perfil sobrescreve em vez de acumular lixo no bucket.
 */
async function rehospedar(leadId, urlOrigem) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;

  let bytes, tipo;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let r;
    try {
      r = await fetch(urlOrigem, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) return null;

    tipo = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    // Só imagem. Um HTML de erro disfarçado de foto entraria aqui sem esta trava.
    if (!/^image\/(jpeg|png|webp)$/i.test(tipo)) return null;

    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    bytes = buf;
  } catch (e) {
    console.warn('[wa-foto] download:', e?.message);
    return null;
  }

  const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg';
  const caminho = `${leadId}.${ext}`;

  try {
    const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${caminho}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': tipo,
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!up.ok) {
      console.warn('[wa-foto] upload:', up.status, (await up.text()).slice(0, 160));
      return null;
    }
  } catch (e) {
    console.warn('[wa-foto] upload:', e?.message);
    return null;
  }

  // Cache-buster pela hora: o caminho é fixo (upsert), então sem isto o
  // navegador continuaria mostrando a foto antiga depois de uma troca.
  return `${base}/storage/v1/object/public/${BUCKET}/${caminho}?v=${Date.now()}`;
}

/**
 * Garante a foto do lead e devolve a URL a gravar em qs_wa_threads.avatar_url
 * (ou null pra não mexer no que já está lá).
 *
 * Ordem das fontes, da mais barata pra mais cara:
 *   1. o que já está gravado, se for nosso  → não faz nada
 *   2. thumbnail do Chatwoot                → já é hospedada e estável
 *   3. Evolution + rehospedagem             → a fonte real
 */
export async function resolverFoto({ leadId, phone, inboxId, thumbnailChatwoot = null, forcar = false }) {
  if (!leadId) return null;

  if (!forcar && fotoJaEhNossa(thumbnailChatwoot)) return null;
  // O Chatwoot hospeda a dele (active_storage) e a URL é estável: aproveitamos
  // sem baixar nada. É de onde vêm as 33 fotos que já funcionavam.
  if (thumbnailChatwoot && /^https?:\/\//i.test(thumbnailChatwoot)) return thumbnailChatwoot;

  if (!evoConfigured()) return null;
  const instance = await instanciaDaCaixa(inboxId ?? null);
  if (!instance) return null;

  const origem = await fetchProfilePicture(instance, phone);
  if (!origem) return null;                  // sem foto ou perfil privado

  return await rehospedar(leadId, origem);
}

/**
 * Preenche as fotos que faltam, em lote. Usado pelo botão de Configurações —
 * abrir 566 conversas na mão pra popular a lista não é um plano.
 *
 * Sequencial de propósito: a Evolution é um WhatsApp de verdade do outro lado, e
 * uma rajada de consultas é exatamente o padrão que derruba número por abuso.
 */
export async function preencherFotosEmLote(limite = 25) {
  if (!evoConfigured()) return { ok: false, motivo: 'evolution-nao-configurada', preenchidas: 0, tentadas: 0 };

  let linhas;
  try {
    linhas = await rest(
      `qs_wa_threads?select=lead_id,cw_inbox_id,avatar_url,lead:qs_leads(phone)` +
      `&avatar_url=is.null&order=last_at.desc&limit=${Math.min(Number(limite) || 25, 100)}`
    );
  } catch (e) {
    console.warn('[wa-foto] lote:', e?.message);
    return { ok: false, motivo: 'consulta-falhou', preenchidas: 0, tentadas: 0 };
  }

  const lista = Array.isArray(linhas) ? linhas : [];
  let preenchidas = 0;

  for (const t of lista) {
    const phone = t.lead?.phone;
    if (!phone) continue;
    try {
      const url = await resolverFoto({ leadId: t.lead_id, phone, inboxId: t.cw_inbox_id });
      if (!url) continue;
      await rest(`qs_wa_threads?lead_id=eq.${encodeURIComponent(t.lead_id)}`, {
        method: 'PATCH',
        body: { avatar_url: url },
        prefer: 'return=minimal',
      });
      preenchidas++;
    } catch (e) {
      console.warn('[wa-foto] lote, lead', t.lead_id, e?.message);
    }
  }

  return { ok: true, preenchidas, tentadas: lista.length };
}
