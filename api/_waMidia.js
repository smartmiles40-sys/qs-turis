// api/_waMidia.js
// -----------------------------------------------------------------------------
// Peças do WhatsApp que NÃO dependem de transporte nenhum: guardar arquivo no
// bucket, o rótulo de uma mídia sem arquivo e achar o lead de um telefone.
//
// Moravam em `_waLinha.js`/`_waLinhaEntrada.js`, que eram o WhatsApp do SDR pela
// Evolution. Quando a Evolution saiu do QS (23/09/2026 — era ela que derrubava
// os números), a entrada da Meta continuava importando estas três de lá. Aqui
// elas ficam sozinhas, sem arrastar a Evolution junto.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { waKey } from './_wa.js';

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
  'audio/webm': 'weba', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

/**
 * Guarda o arquivo no bucket `wa-midia` e devolve a URL pública. O caminho leva
 * um pedaço aleatório: público, mas ninguém chega nele chutando.
 */
export async function guardarMidia(bytes, mime, { leadId, nomeArquivo } = {}) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave || !bytes?.length) return null;

  const tipo = String(mime || 'application/octet-stream').split(';')[0].trim();
  const extDoNome = String(nomeArquivo || '').match(/\.([a-z0-9]{1,5})$/i)?.[1];
  const ext = EXT[tipo] || extDoNome || 'bin';
  const sorteio = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const caminho = `${leadId || 'sem-lead'}/${Date.now()}-${sorteio}.${ext}`;

  const up = await fetch(`${base}/storage/v1/object/wa-midia/${caminho}`, {
    method: 'POST',
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': tipo },
    body: bytes,
  });
  if (!up.ok) {
    console.warn('[wa-midia] upload:', up.status, (await up.text()).slice(0, 160));
    return null;
  }
  return `${base}/storage/v1/object/public/wa-midia/${caminho}`;
}

export function rotuloDaMidia(tipo) {
  return { image: '📷 imagem', audio: '🎤 áudio', video: '🎬 vídeo' }[tipo] || '📎 arquivo';
}

const LEAD_COLS = 'id,owner_id,full_name,first_name,phone';

/**
 * O lead deste telefone. Com telefone repetido em dois cards (existem ~68),
 * prefere o card do `donoPreferido` quando vier; senão, o mais recente.
 */
export async function leadDoTelefone(phone, donoPreferido = null) {
  const key = waKey(phone);
  if (!key) return null;
  const rows = await rest(
    `qs_leads?select=${LEAD_COLS}&phone=ilike.*${encodeURIComponent(key.slice(-8))}*&order=updated_at.desc&limit=20`
  );
  const mesmos = (Array.isArray(rows) ? rows : []).filter((l) => waKey(l.phone) === key);
  return (donoPreferido && mesmos.find((l) => l.owner_id === donoPreferido)) || mesmos[0] || null;
}
