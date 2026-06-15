import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

/**
 * Seam test for the auth session adapter (ADR-001) — runs against the REAL
 * module with the SESSION_SECRET from vitest.setup.ts. Asserts the sign->verify
 * round-trip and rejection of tampered / unknown tokens.
 */
describe("auth/session", () => {
  it("round-trips a valid principal: verify(sign('Wency')) === 'Wency'", () => {
    expect(verifySession(signSession("Wency"))).toBe("Wency");
    expect(verifySession(signSession("Jeanette"))).toBe("Jeanette");
  });

  it("rejects a garbage token", () => {
    expect(verifySession("garbage.token")).toBeNull();
  });

  it("rejects undefined / empty / dotless tokens", () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("")).toBeNull();
    expect(verifySession("Wency")).toBeNull();
  });

  it("rejects a tampered signature on a real principal", () => {
    const valid = signSession("Wency");
    const tampered = valid.slice(0, valid.lastIndexOf(".")) + ".0000";
    expect(verifySession(tampered)).toBeNull();
  });

  it("rejects an unknown principal even with a syntactically valid shape", () => {
    expect(verifySession("Mallory.somesignature")).toBeNull();
  });
});
