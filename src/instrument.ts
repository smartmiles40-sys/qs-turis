// Sentry na tela do QS: erros, desempenho (traces), logs e replay de sessão.
// Precisa ser o PRIMEIRO import do main.tsx. Sem VITE_SENTRY_DSN, fica desligado.
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn) {
  const prod = import.meta.env.PROD;
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? (prod ? "production" : "development"),
    release: (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) || undefined,
    // LGPD: sem dados do usuário, cookies, cabeçalhos, corpos e parâmetros de URL (tokens).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    integrations: [
      Sentry.browserTracingIntegration(),
      // Replay já mascara todo texto e bloqueia mídia por padrão (dados de cliente não aparecem).
      Sentry.replayIntegration(),
    ],
    // Local: tudo; produção: 10% das navegações.
    tracesSampleRate: prod ? 0.1 : 1.0,
    // Só as /api do próprio QS recebem cabeçalho de trace (Supabase/Bitrix ficam de fora).
    tracePropagationTargets: [/^\/api\//],
    replaysSessionSampleRate: prod ? 0.05 : 0,
    replaysOnErrorSampleRate: 1.0,
  });
}
