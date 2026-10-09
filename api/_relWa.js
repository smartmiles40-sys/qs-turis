// api/_relWa.js
// -----------------------------------------------------------------------------
// Peças comuns das rotas do Relacionamento que falam com o WhatsApp
// (rel-wa: atendimento; rel-disparos: campanhas e automações).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';

/** Quem chama: precisa estar ativo e ter o setor Relacionamento (ou ser admin). */
export async function quemChama(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const ok = u.role === 'admin' || (Array.isArray(u.setores) && u.setores.includes('relacionamento'));
  return ok ? u : null;
}

/** O número do Relacionamento (o mais recente conectado). */
export async function numeroDoRelacionamento() {
  const r = await rest(
    'qs_wa_numeros_meta?select=phone_number_id,numero,nome_verificado,status,segredo_id' +
    '&setor=eq.relacionamento&order=conectado_em.desc.nullslast&limit=1'
  ).catch(() => null);
  return r?.[0] || null;
}

/** Conectado de verdade = status conectado E token guardado. */
export const numeroConectado = (n) => n?.status === 'conectado' && Boolean(n?.segredo_id);
