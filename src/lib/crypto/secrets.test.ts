import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/crypto/secrets";

/**
 * Seam test for the at-rest crypto adapter — runs against the REAL module with
 * the ENCRYPTION_KEY from vitest.setup.ts (a genuine 32-byte key, so AES-256-GCM
 * actually executes). Asserts round-trip fidelity and that ciphertext is opaque.
 */
describe("crypto/secrets", () => {
  it("round-trips a non-empty secret: decrypt(encrypt(x)) === x", () => {
    const plaintext = "super-secret-mailbox-password-123";
    const stored = encryptSecret(plaintext);
    expect(decryptSecret(stored)).toBe(plaintext);
  });

  it("ciphertext differs from plaintext and is in the 3-segment GCM shape", () => {
    const plaintext = "another-secret-value";
    const stored = encryptSecret(plaintext);
    expect(stored).not.toBe(plaintext);
    expect(stored.split(":")).toHaveLength(3);
    expect(isEncrypted(stored)).toBe(true);
  });

  it("produces a fresh IV per encryption (same input -> different ciphertext)", () => {
    const plaintext = "deterministic-input";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("returns legacy plaintext verbatim (not in GCM shape) on decrypt", () => {
    const legacy = "plain-legacy-password";
    expect(isEncrypted(legacy)).toBe(false);
    expect(decryptSecret(legacy)).toBe(legacy);
  });
});
