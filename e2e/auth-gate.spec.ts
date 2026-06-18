import { test, expect } from "@playwright/test";

/**
 * Auth gate (ADR-001 · REQ-1 / REQ-2 / REQ-20). These flows need NO live
 * secrets and NO session — they prove the trust boundary itself. Runnable
 * against local dev OR production (E2E_BASE_URL=https://aquavoy.vercel.app).
 *
 * Mirrors docs/qa-checklist.md §1, but executes the runtime behavior the
 * checklist could previously only cite by file:line.
 */

test.describe("auth gate — unauthenticated", () => {
  test("protected page redirects to /login", async ({ page }) => {
    const res = await page.goto("/");
    expect(page.url()).toContain("/login");
    // Login surface is actually rendered, not a blank redirect target.
    await expect(page.getByRole("heading", { name: "Aquavoy", level: 1 })).toBeVisible();
    expect(res?.status() ?? 200).toBeLessThan(400);
  });

  for (const path of ["/emails", "/files", "/prep"]) {
    test(`management page ${path} redirects to /login`, async ({ page }) => {
      await page.goto(path);
      expect(page.url()).toContain("/login");
    });
  }

  for (const path of ["/api/chat", "/api/mail/send", "/api/recipients"]) {
    test(`protected API ${path} returns 401 JSON, handler never runs`, async ({ request }) => {
      const res = await request.post(path, { data: {}, failOnStatusCode: false });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
    });
  }

  test("health probe is allowlisted (200, no auth)", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data?.status).toBe("ok");
  });
});

test.describe("login page", () => {
  test("renders both operator choices + password field", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("img", { name: "Aquavoy Shipping Ltd" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Wency", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jeanette", exact: true })).toBeVisible();
    await expect(page.getByLabel(/Password for/)).toBeVisible();
  });

  test("rejects an invalid credential with an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/Password for/).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Scope to the app's own alert (Next injects a second role="alert" route-announcer).
    await expect(page.locator("p.notice.err")).toContainText(/Invalid credentials|Sign-in failed/);
    // Still on the login page — no session was granted.
    expect(page.url()).toContain("/login");
  });
});
