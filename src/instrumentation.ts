import * as Sentry from "@sentry/nextjs";

/**
 * Sentry server + edge initialization (Next.js instrumentation hook). Runs once
 * at server start. The DSN is public by design (it identifies the project, grants
 * no access) so it is safe to commit; move it to NEXT_PUBLIC_SENTRY_DSN if you
 * later want per-environment control.
 *
 * `onRequestError` below auto-captures unhandled errors thrown in Server
 * Components, route handlers, and src/proxy.ts (the Node-runtime middleware).
 * Errors that are CAUGHT (try/catch) are not seen here — those call
 * Sentry.captureException explicitly (see src/lib/openrouter/client.ts + crons).
 */
const DSN =
  "https://04164201782c506ac91592f4cc3a0e8a@o4511603915554816.ingest.de.sentry.io/4511603920928848";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: DSN,
      // Full perf tracing in dev, 10% in prod — tune to traffic.
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      enableLogs: true,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
