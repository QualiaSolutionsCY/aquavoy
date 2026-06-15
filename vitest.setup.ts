/**
 * Test environment bootstrap. Stubs the env vars that server modules read at
 * import/use time so the lazy validators in src/lib/env.ts pass without a real
 * .env. No test ever reaches a live vendor — every adapter is mocked per file.
 *
 * ENCRYPTION_KEY is a real, randomly-generated 32-byte base64 value so the
 * AES-256-GCM round-trip in secrets.test.ts exercises the actual crypto path.
 */

// 32 random bytes, base64-encoded — satisfies the ENCRYPTION_KEY validator.
process.env.ENCRYPTION_KEY = "NRmECADxOXH4CwZMPBWc6IMzoDOwI0MEPygL/vl3c4M=";

// Session signing secret — must be >= 32 chars.
process.env.SESSION_SECRET = "test-session-secret-0123456789-abcdefghij";

// Operator credential map — valid JSON of principal -> "saltHex:hashHex".
process.env.OPERATOR_CREDENTIALS = JSON.stringify({
  Wency: "deadbeef:cafebabe",
  Jeanette: "0a0b0c0d:1a2b3c4d",
});

// Supabase service-role config — present so getSupabaseEnv() validates; the
// client itself is always mocked in tests that touch it.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
