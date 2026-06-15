import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { getCryptoEnv } from "@/lib/env";

/**
 * Server-only AES-256-GCM secret crypto.
 *
 * The single seam through which at-rest secrets (mailbox passwords, OAuth
 * tokens) are encrypted / decrypted. AES-256-GCM is *authenticated*: a tampered
 * ciphertext fails `final()` with an auth error rather than silently decrypting
 * to garbage.
 *
 * Stored format: `iv:authTag:ciphertext` — three base64 segments joined by ":".
 *   - iv:        12 random bytes (GCM nonce), fresh per encryption
 *   - authTag:   16 bytes from `cipher.getAuthTag()`
 *   - ciphertext: the AES-256-GCM output (>= 1 byte)
 *
 * Reads are tolerant: a value that is NOT in the 3-segment GCM shape (e.g. a
 * legacy plaintext password or a raw JWT, which contain ":" or "." but won't
 * decode to the exact IV/tag byte lengths) is returned verbatim by
 * `decryptSecret`. This lets callers migrate stores incrementally.
 *
 * Server-only: imports `getCryptoEnv()`, which reads `ENCRYPTION_KEY`. Never
 * import this from a client component.
 *
 * Key rotation: rotation means setting a new `ENCRYPTION_KEY` and performing a
 * one-time re-encrypt of every stored value. That tooling is future work and is
 * intentionally NOT implemented here.
 */

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function key(): Buffer {
  return Buffer.from(getCryptoEnv().ENCRYPTION_KEY, "base64");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const [ivB64, tagB64, ctB64] = stored.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  // A tampered ciphertext / auth tag makes `final()` throw — by design.
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncrypted(stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  try {
    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");
    return (
      iv.length === IV_BYTES &&
      authTag.length === AUTH_TAG_BYTES &&
      ciphertext.length >= 1
    );
  } catch {
    return false;
  }
}
