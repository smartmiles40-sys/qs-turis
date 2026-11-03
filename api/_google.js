// api/_google.js
// -----------------------------------------------------------------------------
// O ACESSO AO GOOGLE, SEM n8n E SEM BIBLIOTECA (03/11/2026).
//
// Até aqui quem falava com o Google era o n8n, porque a credencial OAuth morava
// lá. Com o corte do n8n, o QS passa a trocar o refresh token por um access
// token sozinho — e isso é UM POST em https://oauth2.googleapis.com/token. Não
// vale puxar `googleapis` (dezenas de MB no bundle da função) pra isso.
//
// DE ONDE VEM A CREDENCIAL
//   Hoje: env da Vercel — GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e
//   GOOGLE_REFRESH_TOKEN (da conta que ORGANIZA as reuniões: é na agenda dela
//   que o evento nasce e é ela que precisa enxergar o livre/ocupado dos
//   closers). Passo a passo em docs/GOOGLE-AGENDA-SEM-N8N.md.
//
//   Depois (planejado): botão "Conectar Google" em Configurações, gravando o
//   refresh token numa tabela. O desenho já prevê: `carregarCredencial()` é o
//   ÚNICO lugar que sabe de onde a credencial vem. Trocar a fonte = mexer só
//   nela (tabela primeiro, env de reserva). Quem chama não muda nada.
//
// CACHE: o access token vale ~1h. Função "quente" da Vercel reaproveita o
// mesmo processo, então guardar em memória poupa uma ida ao Google em quase
// toda chamada — e é o que deixa o freeBusy (4,5 s de prazo TOTAL) caber.
// Renova 2 min antes de vencer: token que vence no meio da chamada vira 401.
//
// NUNCA loga o token, o refresh token nem o client secret. Nem pedaço.
// -----------------------------------------------------------------------------

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Margem antes do vencimento: renova antes de o Google recusar. */
const MARGEM_MS = 120_000;
const TOKEN_TIMEOUT_MS = 5_000;

/** As envs de que a agenda depende. Exportado pra tela de saúde e mensagens. */
export const ENVS_GOOGLE = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];

let cache = { chave: null, token: null, venceEm: 0 };

/** Erro com código, pra quem chama decidir a mensagem sem ler texto. */
export class ErroGoogle extends Error {
  constructor(codigo, mensagem, status = null) {
    super(mensagem);
    this.name = 'ErroGoogle';
    this.codigo = codigo;
    this.status = status;
  }
}

const limpo = (v) => String(v || '').trim();

/**
 * A credencial OAuth (client + refresh token). ÚNICO ponto que sabe a origem.
 *
 * O .trim() não é enfeite: valor colado no painel da Vercel vem com espaço ou
 * quebra de linha invisível com frequência alta demais (foi isso que derrubou
 * a agenda por 5 dias em agosto, e o Realtime do Dashboard em outubro).
 *
 * Quando existir o "Conectar Google": ler a tabela aqui (service_role) e cair
 * na env só se a tabela estiver vazia. Fica async desde já por isso.
 */
export async function carregarCredencial(env = process.env) {
  return {
    clientId: limpo(env.GOOGLE_CLIENT_ID),
    clientSecret: limpo(env.GOOGLE_CLIENT_SECRET),
    refreshToken: limpo(env.GOOGLE_REFRESH_TOKEN),
    origem: 'env',
  };
}

/** Quais envs faltam (lista vazia = configurado). Síncrono: serve pra GET barato. */
export function envsGoogleFaltando(env = process.env) {
  return ENVS_GOOGLE.filter((k) => !limpo(env[k]));
}

export function googleConfigurado(env = process.env) {
  return envsGoogleFaltando(env).length === 0;
}

/** Frase única de "não configurado", pra todo lugar dizer a mesma coisa. */
export function motivoNaoConfigurado(env = process.env) {
  const faltam = envsGoogleFaltando(env);
  return faltam.length ? `agenda do Google não configurada (${faltam.join(', ')} ausente)` : null;
}

/**
 * fetch com prazo, que também respeita um sinal de fora (prazo TOTAL de quem
 * chamou). Regra do projeto: o prazo do fetch tem que ser MENOR que o
 * maxDuration da rota, senão a Vercel mata a função antes do abort agir.
 */
export async function fetchComPrazo(url, init = {}, { timeoutMs = 10_000, signal = null } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const repassar = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', repassar, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', repassar);
  }
}

/** Traduz o erro do endpoint de token pra algo que se resolve lendo. */
export function motivoDoErroDeToken(corpo, status) {
  const e = corpo && corpo.error;
  if (e === 'invalid_grant') {
    return 'o Google recusou o refresh token (revogado, expirado ou de outro client) — gere outro e troque GOOGLE_REFRESH_TOKEN';
  }
  if (e === 'invalid_client' || e === 'unauthorized_client') {
    return 'o Google não reconheceu o client OAuth — confira GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (e se o refresh token foi gerado com ESTE client)';
  }
  const desc = corpo && (corpo.error_description || corpo.error);
  return `token do Google: HTTP ${status}${desc ? ` · ${String(desc).slice(0, 160)}` : ''}`;
}

/**
 * Um access token válido. Lança ErroGoogle (`nao_configurado`, `google_auth`,
 * `google_timeout`, `google_rede`) — quem chama transforma em resposta.
 */
export async function obterTokenGoogle({ timeoutMs = TOKEN_TIMEOUT_MS, signal = null, credencial = null, agora = Date.now() } = {}) {
  const cred = credencial || (await carregarCredencial());
  if (!cred.clientId || !cred.clientSecret || !cred.refreshToken) {
    throw new ErroGoogle('nao_configurado', motivoNaoConfigurado() || 'agenda do Google não configurada');
  }

  // A chave do cache inclui o refresh token: trocar a env (ou, no futuro,
  // reconectar outra conta) não pode reaproveitar o token da conta anterior.
  const chave = `${cred.clientId}|${cred.refreshToken}`;
  if (cache.chave === chave && cache.token && agora < cache.venceEm - MARGEM_MS) return cache.token;

  let r;
  try {
    r = await fetchComPrazo(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cred.clientId,
        client_secret: cred.clientSecret,
        refresh_token: cred.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    }, { timeoutMs, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new ErroGoogle('google_timeout', 'o Google não respondeu a tempo (token)');
    throw new ErroGoogle('google_rede', `não consegui falar com o Google (token): ${e?.message || e}`);
  }

  const corpo = await r.json().catch(() => null);
  if (!r.ok || !corpo?.access_token) {
    // Token recusado: limpa o cache pra próxima chamada não insistir no velho.
    cache = { chave: null, token: null, venceEm: 0 };
    throw new ErroGoogle('google_auth', motivoDoErroDeToken(corpo, r.status), r.status);
  }

  const segundos = Number(corpo.expires_in) || 3600;
  cache = { chave, token: corpo.access_token, venceEm: Date.now() + segundos * 1000 };
  return cache.token;
}

/** Só pra teste: esquece o token em memória. */
export function _limparCacheToken() {
  cache = { chave: null, token: null, venceEm: 0 };
}
