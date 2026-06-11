import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppEnv } from "@/lib/env";
import { exchangeCodeForTokens } from "@/lib/microsoft/oauth";
import { fetchMe } from "@/lib/microsoft/graph";
import { saveConnection } from "@/lib/microsoft/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "od_oauth_state";

/** OAuth redirect target: verify state, exchange code, persist the connection. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = getAppEnv().APP_BASE_URL.replace(/\/$/, "");
  const params = req.nextUrl.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    const desc = params.get("error_description") ?? "";
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(`${oauthError}: ${desc}`)}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = (await cookies()).get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent("Invalid OAuth state")}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const user = await fetchMe(tokens.accessToken);
    const connection = await saveConnection(user, tokens);
    const res = NextResponse.redirect(`${base}/?connected=${encodeURIComponent(connection.id)}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(message)}`);
  }
}
