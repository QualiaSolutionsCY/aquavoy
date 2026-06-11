import { getMicrosoftEnv, redirectUri } from "@/lib/env";
import type { TokenSet } from "./types";

/**
 * Microsoft identity platform (v2.0) OAuth — authorization code flow with a
 * confidential client (server-side client secret). This module owns the wire
 * format of the token endpoint; nothing else in the app should construct these
 * requests.
 */

function authority(): string {
  return `https://login.microsoftonline.com/${getMicrosoftEnv().MICROSOFT_TENANT_ID}`;
}

/** Build the URL we redirect the user to in order to grant consent. */
export function buildAuthorizeUrl(state: string): string {
  const env = getMicrosoftEnv();
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: env.MICROSOFT_SCOPES,
    state,
    // Force a fresh refresh token on reconnect.
    prompt: "select_account",
  });
  return `${authority()}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(
      `Microsoft token endpoint error: ${json.error ?? res.status} — ${json.error_description ?? "unknown"}`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

/** Exchange an authorization code (from the callback) for a token set. */
export function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const env = getMicrosoftEnv();
  return postToken(
    new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      scope: env.MICROSOFT_SCOPES,
    }),
  );
}

/** Trade a refresh token for a new access (and rolling refresh) token. */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const env = getMicrosoftEnv();
  const next = await postToken(
    new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: env.MICROSOFT_SCOPES,
    }),
  );
  // Microsoft sometimes omits a new refresh token; keep the old one if so.
  if (!next.refreshToken) next.refreshToken = refreshToken;
  return next;
}
