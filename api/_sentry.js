// api/_sentry.js
// -----------------------------------------------------------------------------
// SENTRY NAS FUNÇÕES /api (24/11/2026).
//
// Cada função exporta `comSentry(handler)`. O embrulho:
//   - abre um trace por chamada (continua o trace que veio da tela do QS);
//   - manda pro Sentry todo erro que ESCAPAR do handler (e devolve 500);
//   - manda também toda resposta 5xx que o handler devolveu "tratada"
//     (o QS costuma pegar o erro e responder 500 com { error });
//   - console.warn/error viram Logs no Sentry;
//   - envia tudo DEPOIS da resposta (waitUntil), sem atrasar quem chamou.
//
// Sem SENTRY_DSN no ambiente, o embrulho só chama o handler.
// -----------------------------------------------------------------------------

import * as Sentry from '@sentry/node';
import { waitUntil } from '@vercel/functions';

const dsn = String(process.env.SENTRY_DSN || '').trim();
const prod = process.env.VERCEL_ENV === 'production';

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    // LGPD: sem dados do usuário, cookies, cabeçalhos, corpos (telefone/CPF) e query (tokens).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
    tracesSampleRate: prod ? 0.1 : 1.0,
  });
}

function nomeDaRota(req) {
  const caminho = String(req.url || '').split('?')[0] || '/api';
  return `${req.method || 'GET'} ${caminho}`;
}

function vigiar5xx(res, rota, marcar) {
  const json = res.json?.bind(res);
  if (!json) return;
  res.json = (corpo) => {
    if (res.statusCode >= 500 && !res.__sentryJaFoi) {
      const msg = corpo && typeof corpo === 'object' ? String(corpo.error || corpo.erro || corpo.message || '') : '';
      Sentry.captureMessage(`${rota} respondeu ${res.statusCode}${msg ? `: ${msg.slice(0, 200)}` : ''}`, 'error');
      marcar();
    }
    return json(corpo);
  };
}

export function comSentry(handler) {
  if (!dsn) return handler;
  return async function handlerComSentry(req, res) {
    const rota = nomeDaRota(req);
    let enviou = false;
    try {
      return await Sentry.withIsolationScope(() =>
        Sentry.continueTrace(
          { sentryTrace: req.headers?.['sentry-trace'], baggage: req.headers?.baggage },
          () =>
            Sentry.startSpan({ name: rota, op: 'http.server', forceTransaction: true }, async (span) => {
              Sentry.getIsolationScope().setTransactionName(rota);
              vigiar5xx(res, rota, () => { enviou = true; });
              try {
                const saida = await handler(req, res);
                span.setAttribute('http.response.status_code', res.statusCode);
                return saida;
              } catch (e) {
                res.__sentryJaFoi = true;
                Sentry.captureException(e, { mechanism: { type: 'vercel_function', handled: false } });
                enviou = true;
                throw e;
              }
            }),
        ),
      );
    } finally {
      // Traces e logs também ficam na fila: sempre esvazia, mas depois da resposta.
      waitUntil(Sentry.flush(enviou ? 3000 : 1500).catch(() => {}));
    }
  };
}
