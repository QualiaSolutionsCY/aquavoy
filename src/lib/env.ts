import { z } from "zod";

/**
 * Environment contract, validated lazily and PER FEATURE so that one subsystem's
 * missing config doesn't break another. The chat (OpenRouter) must work even
 * before the OneDrive (Microsoft/Supabase) credentials are filled in.
 *
 * Server-only — reads secrets (service-role key, client secret, OpenRouter key)
 * that must never reach the browser bundle.
 */

function validate<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} configuration:\n${issues}`);
  }
  return parsed.data;
}

// ── App (shared) ──────────────────────────────────────────
const appSchema = z.object({
  APP_BASE_URL: z.string().url(),
});
let appCache: z.infer<typeof appSchema> | null = null;
export function getAppEnv() {
  return (appCache ??= validate(appSchema, "app"));
}
export function redirectUri(): string {
  return `${getAppEnv().APP_BASE_URL.replace(/\/$/, "")}/api/onedrive/callback`;
}

// ── OpenRouter (conversational AI) ────────────────────────
const openRouterSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().min(1).default("google/gemini-3.5-flash"),
});
let orCache: z.infer<typeof openRouterSchema> | null = null;
export function getOpenRouterEnv() {
  return (orCache ??= validate(openRouterSchema, "OpenRouter"));
}

// ── Microsoft Graph / OneDrive ────────────────────────────
const microsoftSchema = z.object({
  MICROSOFT_CLIENT_ID: z.string().min(1, "MICROSOFT_CLIENT_ID is required"),
  MICROSOFT_CLIENT_SECRET: z.string().min(1, "MICROSOFT_CLIENT_SECRET is required"),
  MICROSOFT_TENANT_ID: z.string().min(1).default("common"),
  MICROSOFT_SCOPES: z.string().min(1).default("offline_access User.Read Files.ReadWrite.All Mail.ReadWrite Mail.Send"),
});
let msCache: z.infer<typeof microsoftSchema> | null = null;
export function getMicrosoftEnv() {
  return (msCache ??= validate(microsoftSchema, "Microsoft"));
}

// ── Supabase (token storage) ──────────────────────────────
const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
});
let sbCache: z.infer<typeof supabaseSchema> | null = null;
export function getSupabaseEnv() {
  return (sbCache ??= validate(supabaseSchema, "Supabase"));
}

// ── Auth (signed session + per-operator credentials) ─────
// SESSION_SECRET signs the principal HMAC; OPERATOR_CREDENTIALS is a JSON map
// of principal → "saltHex:hashHex" scrypt hashes. Both server-only.
const authSchema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),
  OPERATOR_CREDENTIALS: z
    .string()
    .min(1, "OPERATOR_CREDENTIALS is required")
    .refine(
      (raw) => {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed !== "object" || parsed === null) return false;
          return Object.values(parsed as Record<string, unknown>).every(
            (v) => typeof v === "string" && /^[0-9a-f]+:[0-9a-f]+$/i.test(v),
          );
        } catch {
          return false;
        }
      },
      'OPERATOR_CREDENTIALS must be a JSON map of principal → "saltHex:hashHex"',
    ),
});
let authCache: z.infer<typeof authSchema> | null = null;
export function getAuthEnv() {
  return (authCache ??= validate(authSchema, "Auth"));
}

// ── Tavily (web research) ────────────────────────────────
const tavilySchema = z.object({
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is required"),
});
let tavilyCache: z.infer<typeof tavilySchema> | null = null;
export function getTavilyEnv() {
  return (tavilyCache ??= validate(tavilySchema, "Tavily"));
}

// ── Crypto (at-rest secret encryption) ───────────────────
// ENCRYPTION_KEY is the AES-256-GCM master key: exactly 32 bytes, base64-encoded.
// Used by src/lib/crypto/secrets.ts to encrypt mailbox passwords / OAuth tokens
// at rest. Server-only.
const cryptoSchema = z.object({
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY is required")
    .refine(
      (v) => {
        try {
          return Buffer.from(v, "base64").length === 32;
        } catch {
          return false;
        }
      },
      "ENCRYPTION_KEY must be 32 bytes, base64-encoded",
    ),
});
let cryptoCache: z.infer<typeof cryptoSchema> | null = null;
export function getCryptoEnv() {
  return (cryptoCache ??= validate(cryptoSchema, "crypto"));
}
