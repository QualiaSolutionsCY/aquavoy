import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import { refreshTokens } from "./oauth";
import type { MicrosoftUser, TokenSet } from "./types";

/**
 * Persistence + freshness for OneDrive connections. A "connection" is one
 * Microsoft account that has granted us delegated access. Tokens live in
 * Supabase (`onedrive_connections`), readable only by the service role.
 *
 * This is the single place that decides "is this access token still good?" —
 * callers ask for `getValidAccessToken(connectionId)` and never touch expiry.
 */

const TABLE = "onedrive_connections";
// Refresh a little early to avoid races with in-flight requests.
const EXPIRY_SKEW_MS = 60_000;

export interface Connection {
  id: string;
  msUserId: string;
  displayName: string | null;
  userPrincipalName: string | null;
}

interface ConnectionRow {
  id: string;
  ms_user_id: string;
  ms_user_principal_name: string | null;
  display_name: string | null;
  access_token: string;
  refresh_token: string;
  scope: string | null;
  token_type: string | null;
  expires_at: string;
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    msUserId: row.ms_user_id,
    displayName: row.display_name,
    userPrincipalName: row.ms_user_principal_name,
  };
}

/** Upsert a connection after a successful auth-code exchange. */
export async function saveConnection(user: MicrosoftUser, tokens: TokenSet): Promise<Connection> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        ms_user_id: user.id,
        ms_user_principal_name: user.userPrincipalName,
        display_name: user.displayName,
        // Encrypt at rest; legacy plaintext rows self-heal to ciphertext on next save/refresh.
        access_token: encryptSecret(tokens.accessToken),
        refresh_token: encryptSecret(tokens.refreshToken),
        scope: tokens.scope,
        token_type: tokens.tokenType,
        expires_at: new Date(tokens.expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ms_user_id" },
    )
    .select()
    .single();
  if (error) throw new Error(`Failed to save connection: ${error.message}`);
  return toConnection(data as ConnectionRow);
}

/** Public list for UI account pickers — never returns tokens. */
export async function listConnections(): Promise<Connection[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("id, ms_user_id, ms_user_principal_name, display_name")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to list connections: ${error.message}`);
  return (data as ConnectionRow[]).map(toConnection);
}

async function loadRow(connectionId: string): Promise<ConnectionRow> {
  const db = supabaseAdmin();
  const { data, error } = await db.from(TABLE).select("*").eq("id", connectionId).single();
  if (error || !data) throw new Error(`Connection not found: ${connectionId}`);
  return data as ConnectionRow;
}

/** Resolve a connection id, defaulting to the most recently used one. */
export async function resolveConnectionId(connectionId?: string | null): Promise<string> {
  if (connectionId) return connectionId;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to resolve connection: ${error.message}`);
  if (!data) throw new Error("No OneDrive account is connected yet.");
  return (data as { id: string }).id;
}

/**
 * Return a valid access token for a connection, transparently refreshing and
 * persisting a new token set when the current one is within the skew window.
 */
export async function getValidAccessToken(connectionId: string): Promise<string> {
  const row = await loadRow(connectionId);
  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() < expiresAt - EXPIRY_SKEW_MS) {
    return decryptSecret(row.access_token);
  }
  const next = await refreshTokens(decryptSecret(row.refresh_token));
  const db = supabaseAdmin();
  const { error } = await db
    .from(TABLE)
    .update({
      access_token: encryptSecret(next.accessToken),
      refresh_token: encryptSecret(next.refreshToken),
      scope: next.scope,
      token_type: next.tokenType,
      expires_at: new Date(next.expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
  if (error) throw new Error(`Failed to persist refreshed token: ${error.message}`);
  return next.accessToken;
}
