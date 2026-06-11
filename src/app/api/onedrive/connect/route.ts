import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthorizeUrl } from "@/lib/microsoft/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "od_oauth_state";

/** Kick off the OAuth dance: set a CSRF state cookie, redirect to Microsoft. */
export async function GET(): Promise<NextResponse> {
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
}
