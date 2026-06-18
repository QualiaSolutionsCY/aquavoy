import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * E2E config (M4 Handoff). Two run modes, switched by `E2E_BASE_URL`:
 *
 *  - unset  → run against a locally-booted `next dev` on :3000. Playwright
 *             starts and tears down the server (webServer block below).
 *  - set    → run against that URL (e.g. https://aquavoy.vercel.app) and do
 *             NOT start a local server. Used for the live prod smoke pass.
 *
 * `.env.local` is loaded so the session-minting helper (e2e/helpers/session.ts)
 * can read SESSION_SECRET when exercising auth-gated routes locally. No secret
 * value is ever written to disk or logged by the suite.
 */
// Match Next.js env precedence: `.env.development.local` > `.env.local`. dotenv
// won't override an already-set key, so load the lower-priority file first and
// let the more-specific dev file override (where `.env.local` ships empty
// placeholders for SESSION_SECRET / OPERATOR_CREDENTIALS).
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development.local", override: true });

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isLocal = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  ...(isLocal
    ? {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:3000/api/health",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
});
