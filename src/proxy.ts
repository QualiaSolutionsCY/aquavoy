import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/session";

/**
 * Route guard (ADR-001). Every route is authenticated except a small allowlist:
 *  - `/login`                     — the login page itself
 *  - `/api/login`                 — the credential-verifying endpoint
 *  - `/api/mail/scheduled/run`    — Vercel cron runner, guarded by its own
 *                                   CRON_SECRET bearer check (run/route.ts:18)
 *  - `/api/mail/scan/run`         — Vercel cron runner (inbox scan, every 6 h),
 *                                   guarded by its own CRON_SECRET bearer check
 *  - `/api/tasks/scheduled/run`   — Vercel cron runner, guarded by its own
 *                                   CRON_SECRET bearer check (run/route.ts:18)
 *  - `/api/memory/sweep`          — Vercel cron runner, guarded by its own
 *                                   CRON_SECRET bearer check (sweep/route.ts:35)
 *  - `/api/health`                — pure liveness probe for uptime monitors;
 *                                   no secrets, no DB, no auth (M4 Handoff)
 *
 * The four cron paths above MUST stay in lock-step with `vercel.json` crons —
 * Vercel sends `Authorization: Bearer CRON_SECRET`, not a session cookie, so an
 * un-allowlisted cron path is 401'd here before its handler runs. proxy.test.ts
 * asserts every `vercel.json` cron path is a member of this allowlist.
 *
 * Unauthenticated `/api/*` requests get a 401 JSON envelope (never reach the
 * handler); unauthenticated page requests redirect to `/login`.
 *
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`. It runs on the Node.js
 * runtime by default, so `node:crypto` inside session.ts works. Do NOT set a
 * `runtime` config here — it throws.
 */

export const ALLOWLIST = new Set<string>([
  "/login",
  "/api/login",
  "/api/mail/scheduled/run",
  "/api/mail/scan/run",
  "/api/tasks/scheduled/run",
  "/api/memory/sweep",
  "/api/health",
]);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (ALLOWLIST.has(pathname)) {
    return NextResponse.next();
  }

  if (getPrincipal(request) !== null) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
