import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/session";

/**
 * Route guard (ADR-001). Every route is authenticated except a small allowlist:
 *  - `/login`                     — the login page itself
 *  - `/api/login`                 — the credential-verifying endpoint
 *  - `/api/mail/scheduled/run`    — Vercel cron runner, guarded by its own
 *                                   CRON_SECRET bearer check (run/route.ts:18)
 *  - `/api/health`                — pure liveness probe for uptime monitors;
 *                                   no secrets, no DB, no auth (M4 Handoff)
 *
 * Unauthenticated `/api/*` requests get a 401 JSON envelope (never reach the
 * handler); unauthenticated page requests redirect to `/login`.
 *
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`. It runs on the Node.js
 * runtime by default, so `node:crypto` inside session.ts works. Do NOT set a
 * `runtime` config here — it throws.
 */

const ALLOWLIST = new Set<string>(["/login", "/api/login", "/api/mail/scheduled/run", "/api/health"]);

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
