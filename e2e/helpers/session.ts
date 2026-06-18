import crypto from "node:crypto";
import type { BrowserContext } from "@playwright/test";

/**
 * Mint a valid Aquavoy session cookie for a verified principal, replicating the
 * server's `signSession` (src/lib/auth/session.ts:38) — cookie value shape
 * `${principal}.${base64url-hmac-sha256(principal, SESSION_SECRET)}`.
 *
 * This lets the authenticated specs reach gated routes WITHOUT live mail/Graph
 * keys: only SESSION_SECRET is needed, and it only proves "a real operator is
 * signed in" — it does not unlock any external integration. Returns null when
 * SESSION_SECRET is absent, so the caller can `test.skip` honestly.
 */
const SESSION_COOKIE = "aq_session";

export function mintSessionCookie(principal: "Wency" | "Jeanette"): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const sig = crypto.createHmac("sha256", secret).update(principal).digest("base64url");
  return `${principal}.${sig}`;
}

/** Add the minted session cookie to a context for the given baseURL. Returns false if no secret. */
export async function authenticate(
  context: BrowserContext,
  baseURL: string,
  principal: "Wency" | "Jeanette" = "Wency",
): Promise<boolean> {
  const value = mintSessionCookie(principal);
  if (!value) return false;
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value,
      domain: hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: baseURL.startsWith("https"),
    },
  ]);
  return true;
}
