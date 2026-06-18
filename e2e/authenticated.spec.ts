import { test, expect } from "@playwright/test";
import { authenticate } from "./helpers/session";

/**
 * Authenticated render + mobile (REQ-2 pass-through · REQ-17 / REQ-18). Needs a
 * session but NO live integration keys — a minted cookie proves "an operator is
 * signed in", which is all the proxy guard checks. The management pages render
 * their skeleton → empty/error states without ever reaching live mail/Graph.
 *
 * Skips honestly when SESSION_SECRET is unavailable (e.g. a prod run with no
 * local env), so the suite stays green rather than silently passing nothing.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("authenticated surface", () => {
  test.beforeEach(async ({ context }) => {
    const ok = await authenticate(context, baseURL);
    test.skip(!ok, "SESSION_SECRET not set — cannot mint a session for authed specs");
  });

  test("chat surface loads instead of redirecting", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$|\/\?/);
    await expect(page.getByRole("button", { name: "Start a new chat thread" })).toBeVisible({
      timeout: 15_000,
    });
  });

  const pages = [
    { path: "/emails", heading: "Aquavoy · Emails" },
    { path: "/files", heading: "OneDrive" },
    { path: "/prep", heading: "1:1 Email Prep" },
  ];

  for (const { path, heading } of pages) {
    test(`${path} renders heading (authed, not redirected)`, async ({ page }) => {
      await page.goto(path);
      expect(page.url()).not.toContain("/login");
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    });

    test(`${path} has no horizontal overflow at 375px (REQ-18)`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      // No content wider than the viewport → no horizontal scrollbar.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1); // allow sub-pixel rounding
    });
  }
});
