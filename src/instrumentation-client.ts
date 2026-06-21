import * as Sentry from "@sentry/nextjs";

/**
 * Sentry browser initialization (Next.js App Router client instrumentation).
 * Captures unhandled client-side errors. Session Replay is off by default
 * (privacy + payload); raise the sample rates if you want it later.
 */
Sentry.init({
  dsn: "https://04164201782c506ac91592f4cc3a0e8a@o4511603915554816.ingest.de.sentry.io/4511603920928848",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

// Required by the App Router so client navigations are instrumented.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
