import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALLOWLIST } from "@/proxy";

/**
 * Regression test (ADR-001 route guard). Vercel crons authenticate with
 * `Authorization: Bearer CRON_SECRET`, not a session cookie, so every cron path
 * declared in vercel.json MUST be in the proxy ALLOWLIST — otherwise the proxy
 * 401s the request before the handler (which self-guards on CRON_SECRET) ever
 * runs. This locks vercel.json crons and the allowlist in lock-step: adding a
 * cron without allowlisting it fails here.
 */

interface VercelCron {
  path: string;
  schedule: string;
}

const vercelJsonPath = fileURLToPath(new URL("../vercel.json", import.meta.url));
const cronPaths: string[] = (
  JSON.parse(readFileSync(vercelJsonPath, "utf8")).crons as VercelCron[]
).map((c) => c.path);

describe("proxy ALLOWLIST vs vercel.json crons", () => {
  it("declares at least one cron in vercel.json", () => {
    expect(cronPaths.length).toBeGreaterThan(0);
  });

  it.each(cronPaths)("allowlists cron path %s", (path) => {
    expect(ALLOWLIST.has(path)).toBe(true);
  });
});
