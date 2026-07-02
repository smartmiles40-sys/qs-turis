// api/_supabaseAdmin.js
// -----------------------------------------------------------------------------
// Acesso Supabase server-side via PostgREST puro (fetch), SEM o supabase-js.
// Motivo: o supabase-js instancia o cliente Realtime (WebSocket), que quebra em
// Node < 22 ("Node.js 20 detected without native WebSocket support"). Como as
// funções /api só precisam de queries/inserts, falar direto com o PostgREST é
// mais leve e portável.
//
// Usa a service_role key (ignora RLS) — só server-side, nunca no browser.
// -----------------------------------------------------------------------------

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente');
    err.code = 'CONFIG';
    throw err;
  }
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * Chamada genérica ao PostgREST. `path` é tudo depois de /rest/v1/, incluindo a
 * querystring do PostgREST (ex.: "qs_users?select=id&role=eq.sdr").
 */
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = cfg();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }

  if (!res.ok) {
    const err = new Error((json && json.message) || `PostgREST HTTP ${res.status}`);
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

/** Insere linhas e retorna as representações criadas. */
export function insert(table, rows, { returning = true } = {}) {
  return rest(table, {
    method: 'POST',
    body: rows,
    prefer: returning ? 'return=representation' : 'return=minimal',
  });
}
