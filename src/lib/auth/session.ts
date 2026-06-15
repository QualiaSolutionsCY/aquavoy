import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getAuthEnv } from "@/lib/env";
import { PRINCIPALS, type Principal } from "@/lib/openrouter/client";

/**
 * Auth seam (ADR-001). The verified principal is carried in a signed, httpOnly
 * session cookie; everything server-side reads it through here. This is the
 * single adapter to swap when migrating to Supabase Auth later — the route-level
 * "get principal from session" contract stays the same.
 *
 * Cookie value shape: `${principal}.${base64url-hmac(principal)}`.
 * Server-only — reads SESSION_SECRET and the operator credential map, neither of
 * which may reach the browser bundle.
 */

export const SESSION_COOKIE = "aq_session";

const PRINCIPAL_SET = new Set<string>(PRINCIPALS);

/** HMAC-SHA256 of the principal under SESSION_SECRET, base64url-encoded. */
function principalHmac(principal: string): string {
  return crypto
    .createHmac("sha256", getAuthEnv().SESSION_SECRET)
    .update(principal)
    .digest("base64url");
}

/** Constant-time equality of two strings, length-guarded (timingSafeEqual throws on length mismatch). */
function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Sign a verified principal into the cookie value. */
export function signSession(principal: Principal): string {
  return `${principal}.${principalHmac(principal)}`;
}

/**
 * Verify a cookie value and return the principal it encodes, or null if the
 * token is missing, malformed, tampered, or names an unknown principal.
 */
export function verifySession(token: string | undefined): Principal | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const principal = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (!PRINCIPAL_SET.has(principal)) return null;
  if (!safeEqualStr(sig, principalHmac(principal))) return null;

  return principal as Principal;
}

/** Read the signed session cookie off a request and return the verified principal. */
export function getPrincipal(req: NextRequest): Principal | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Verify an operator's password against the stored scrypt hash. Credentials live
 * in OPERATOR_CREDENTIALS as a JSON map principal → "saltHex:hashHex".
 * Constant-time comparison; unknown principal or malformed entry returns false.
 */
export function verifyCredential(principal: string, password: string): boolean {
  if (!PRINCIPAL_SET.has(principal)) return false;

  let map: Record<string, string>;
  try {
    map = JSON.parse(getAuthEnv().OPERATOR_CREDENTIALS) as Record<string, string>;
  } catch {
    return false;
  }

  const stored = map[principal];
  if (typeof stored !== "string") return false;

  const sep = stored.indexOf(":");
  if (sep <= 0) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const derived = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
