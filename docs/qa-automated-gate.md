# Automated QA Gate

This is the **automated** half of Aquavoy's QA. It runs entirely offline — no live
agent session, no OneDrive/Microsoft Graph credentials, no email inbox required. The
agent and CI can run it on every change, and the client can re-run it before any future
deploy.

For the **operator-run live QA** (real agent session, OneDrive sync, email send/receive,
confirm/undo flows) see [`qa-checklist.md`](./qa-checklist.md). That checklist covers the
behaviors this gate cannot — anything needing a live session or external service. The two
are complementary: this gate proves the code compiles and the logic is correct in
isolation; the live checklist proves the wired system behaves end to end.

## The gate: two commands

### 1. Typecheck — the whole TypeScript project compiles

```bash
npm run typecheck
```

Runs `tsc --noEmit` across the entire TypeScript project. Compiles every file under the
project's `tsconfig.json` without emitting output — it only verifies types. Catches broken
imports, type mismatches, missing fields, and signature drift before they reach runtime.

**Expected:** exit code `0`, no diagnostics printed.

**Last observed (2026-06-17):** exit `0`, clean — no type errors.

### 2. Tests — the unit/integration suite passes

```bash
npm run test
```

Runs `vitest run` (Vitest 4.1.9) — a single non-watch pass over the whole suite. Covers
the parsing, agent-action, gating/confirm-undo, and adapter logic that can be exercised
without a live session.

**Expected:** exit code `0`, all test files and all tests pass.

**Last observed (2026-06-17):**

```
 Test Files  12 passed (12)
      Tests  59 passed (59)
   Duration  ~2.0s
```

12 test files, 59 tests, all passing.

## Run both before every deploy

Run `npm run typecheck && npm run test` and confirm **both** exit `0` before shipping any
change to production — this is the minimum bar that does not require a live environment.

After both pass, complete the live operator flows in
[`qa-checklist.md`](./qa-checklist.md) to validate the parts this gate cannot reach.
