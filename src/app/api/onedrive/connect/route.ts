import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppEnv } from "@/lib/env";
import { buildAuthorizeUrl } from "@/lib/microsoft/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "od_oauth_state";

/**
 * Kick off the OAuth dance: set a CSRF state cookie, redirect to Microsoft.
 * This is a top-level browser redirect, so a failure (e.g. missing Microsoft
 * env) must surface as a graceful redirect-with-error like the callback route
 * does — NOT a raw 500 or the JSON `handle()` envelope, which would strand the
 * user mid-navigation (MED-2).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const state = crypto.randomUUID();
    const url = buildAuthorizeUrl(state);

    const res = NextResponse.redirect(url);
    (await cookies()).set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    const base = getAppEnv().APP_BASE_URL.replace(/\/$/, "");
    const message = err instanceof Error ? err.message : "Could not start OneDrive connection";
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(message)}`);
  }
}
