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
