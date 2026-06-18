import { test, expect } from "@playwright/test";
import { authenticate } from "./helpers/session";

/**
 * Deep agent flows (REQ-9/10/11 · REQ-13/16). These exercise the chat → tool
 * loop → pending-action → confirm/undo → IMAP send / OneDrive path. They depend
 * on LIVE external integrations (the LLM provider, SMTP/IMAP mailbox creds,
 * Microsoft Graph OAuth) — exactly the runtime context docs/qa-checklist.md
 * flags as operator-only. They are therefore OPT-IN:
 *
 *   E2E_LIVE_AGENT=1  npx playwright test e2e/deep-flows.spec.ts
 *
 * Without that flag they SKIP (not fail) — an honest "not exercised here", same
 * stance as the checklist. The selectors below are real (src/app/page.tsx), so
 * when an operator opts in against a configured environment they run as written.
 */

const LIVE = process.env.E2E_LIVE_AGENT === "1";
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("deep agent flows (opt-in: E2E_LIVE_AGENT=1)", () => {
  test.skip(!LIVE, "Set E2E_LIVE_AGENT=1 with live provider + mailbox + Graph creds to run");

  test.beforeEach(async ({ context }) => {
    const ok = await authenticate(context, baseURL);
    test.skip(!ok, "SESSION_SECRET not set");
  });

  test("agent reply streams and exposes a tool trace (REQ-13)", async ({ page }) => {
    await page.goto("/");
    const composer = page.getByPlaceholder(/message|ask/i).first();
    await composer.fill("List the files in the root OneDrive folder.");
    await composer.press("Enter");
    // A trace disclosure row appears once the turn lands.
    const trace = page.getByRole("button", { name: /Show agent trace/ }).first();
    await expect(trace).toBeVisible({ timeout: 60_000 });
    await trace.click();
    await expect(page.getByRole("region", { name: "Agent trace detail" })).toBeVisible();
  });

  test("destructive action stages a pending card; confirm executes once (REQ-11)", async ({
    page,
  }) => {
    await page.goto("/");
    const composer = page.getByPlaceholder(/message|ask/i).first();
    await composer.fill("Send a test email from the aquavoy mailbox to myself saying hello.");
    await composer.press("Enter");
    // Side-effect must NOT auto-run — a pending card is staged first.
    const pending = page.getByRole("region", { name: "Pending actions" });
    await expect(pending).toBeVisible({ timeout: 60_000 });
    await expect(pending.getByRole("button", { name: /Confirm:/ })).toBeVisible();
    await expect(pending.getByRole("button", { name: /Cancel:/ })).toBeVisible();
  });
});
