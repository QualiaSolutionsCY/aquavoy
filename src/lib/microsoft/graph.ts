import { getValidAccessToken } from "./connections";
import type { MicrosoftUser } from "./types";

/**
 * Thin transport over Microsoft Graph. Owns the base URL, auth header, and
 * error envelope. Everything above it (onedrive.ts) speaks in resource paths
 * and gets parsed JSON or a thrown GraphError.
 */
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

interface GraphRequest {
  method?: string;
  /** Path beginning with "/", appended to GRAPH_BASE. */
  path: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  /** When false, returns the raw Response instead of parsing JSON. */
  parseJson?: boolean;
}

async function rawFetch(accessToken: string, req: GraphRequest): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...req.headers,
  };
  // 30s timeout: a hung Graph upstream must not pin the serverless function.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}${req.path}`, {
      method: req.method ?? "GET",
      headers,
      body: req.body ?? undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GraphError(504, "timeout", "Microsoft Graph request timed out after 30s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = res.statusText;
    try {
      const err = (await res.json()) as { error?: { code?: string; message?: string } };
      code = err.error?.code ?? code;
      message = err.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new GraphError(res.status, code, message);
  }
  return res;
}

/** Resolve a fresh token for the connection, then perform a JSON Graph call. */
export async function graphJson<T>(connectionId: string, req: GraphRequest): Promise<T> {
  const token = await getValidAccessToken(connectionId);
  const res = await rawFetch(token, req);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Same as graphJson but returns the raw Response (for streaming downloads). */
export async function graphRaw(connectionId: string, req: GraphRequest): Promise<Response> {
  const token = await getValidAccessToken(connectionId);
  return rawFetch(token, { ...req, parseJson: false });
}

/** Fetch the signed-in Microsoft user — used right after token exchange. */
export async function fetchMe(accessToken: string): Promise<MicrosoftUser> {
  const res = await rawFetch(accessToken, { path: "/me?$select=id,displayName,userPrincipalName" });
  const json = (await res.json()) as {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
  };
  return {
    id: json.id,
    displayName: json.displayName ?? null,
    userPrincipalName: json.userPrincipalName ?? null,
  };
}
