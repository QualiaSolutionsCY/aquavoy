---
phase: 2
goal: "The agent reads and reasons over a OneDrive document within a single turn."
tasks: 1
waves: 1
---

# Phase 2: Inline Document Understanding

**Goal:** The agent reads and reasons over a OneDrive document (Word/PDF/Excel/text) within a single turn.
**Why this phase:** Operators ask "summarize the latest invoice in Verzonden Facturen" and expect an answer in one turn. Per `@.planning/phase-2-context.md`, the capability is ALREADY shipped (`read_file` + `extractText`); the phase's real deliverable is closing the verification + automated-test gap so the capability cannot silently regress.

> Grounded reality (see `@.planning/phase-2-context.md`): `read_file` (`src/lib/agents/onedriveTools.ts:94`) + `extractText` (`:487`) already fetch a drive item, extract Word/PDF/Excel/text, truncate large files, report unsupported binaries, and are wired into the tool registry + system prompt (`src/lib/openrouter/client.ts:77-79`). Per MVP/locality rules we do NOT add a redundant `read_document` tool. Live OneDrive smoke is ENV-GATED and deferred.

---

## Task 1 — Verify pre-existing document-read capability + add extraction test net
**Wave:** 1
**Persona:** backend
**Files:** `src/lib/agents/onedriveTools.test.ts` (modify — add `read_file` extraction tests)
**Depends on:** none

**Why:** The `read_file` document-extraction path had zero automated coverage (the seam test only covered `send_email`/`recall_memory`). Without tests, a refactor of `extractText`/`read_file` could silently break inline document understanding — the phase goal. This task pins the behavior.

**Acceptance Criteria:**
- `read_file` over a mocked text download returns `{ fileName, content }` with the decoded text (AC1).
- When the download response has no `content-disposition`, the filename falls back to `getItem(...).name` (AC2).
- An unsupported binary extension returns the clean "Cannot extract text" message, not a crash (AC3).
- Content longer than the 12000-char cap is truncated and ends with "(truncated)" (AC4).
- Missing `itemId` returns `{ error: "itemId is required" }` with no download attempted (AC5).
- `.docx`/`.pdf`/`.xlsx` filenames route to the matching parser branch, verified with the parser modules mocked (AC6).
- `npx tsc --noEmit` exits 0; `npx vitest run` passes (AC7).

**Action:**
1. In `src/lib/agents/onedriveTools.test.ts`, add `vi.mock` for `mammoth`, `pdf-parse`, `xlsx` returning fixed text (test OUR dispatch, not the vendor libs — `rules/architecture.md` §6).
2. Import the already-mocked `downloadContent`/`getItem` from `@/lib/microsoft/onedrive`; add a `fileResponse(body, fileName?)` helper building a `Response` with an optional `content-disposition` header.
3. Add a `describe("read_file …")` block covering AC1–AC6 by calling `executeTool("read_file", { itemId }, "conn-1")` with the download mock configured per case.

**Validation:** (builder self-check)
- `npx tsc --noEmit` → exits 0 (no `error TS`)
- `grep -c "read_file — inline document understanding" src/lib/agents/onedriveTools.test.ts` → `1`
- `npx vitest run src/lib/agents/onedriveTools.test.ts` → passes (incl. the new read_file cases)

**Context:** Read @src/lib/agents/onedriveTools.ts @src/lib/agents/onedriveTools.test.ts @src/lib/openrouter/client.ts @.planning/phase-2-context.md

---

## Success Criteria
- [ ] A tool fetches a drive item, extracts Word/PDF/Excel/text, and returns content the agent reasons over in the same turn. (pre-existing `read_file` + `extractText`, confirmed by contract)
- [ ] Size/type guards: large files truncated with a note; unsupported types reported cleanly. (pre-existing `truncate` + unsupported branch, confirmed by tests AC3/AC4)
- [ ] Wired into the tool registry and the system-prompt capability list. (confirmed by contract greps)
- [ ] Automated extraction test net exists and passes; `tsc` 0, full suite green. (Task 1)

## Verification Contract

### Contract for Task 1 — read_file tool exists in registry
**Check type:** grep-match
**Command:** `grep -c 'name: "read_file"' src/lib/agents/onedriveTools.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the document-read tool is not registered

### Contract for Task 1 — extractText handles Word/PDF/Excel
**Check type:** command-exit
**Command:** `grep -c "mammoth" src/lib/agents/onedriveTools.ts; grep -c "pdf-parse" src/lib/agents/onedriveTools.ts; grep -c "xlsx" src/lib/agents/onedriveTools.ts`
**Expected:** each Non-zero (≥ 1)
**Fail if:** any parser branch missing — a document type cannot be read

### Contract for Task 1 — read_file wired into system prompt
**Check type:** grep-match
**Command:** `grep -c "read_file" src/lib/openrouter/client.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the model is not told the capability exists

### Contract for Task 1 — extraction test net present
**Check type:** grep-match
**Command:** `grep -c "read_file — inline document understanding" src/lib/agents/onedriveTools.test.ts`
**Expected:** `1`
**Fail if:** Returns 0 — no automated coverage for document extraction

### Contract for Task 1 — suite + types green
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"; npx vitest run 2>&1 | grep -cE "failed"`
**Expected:** `0` and `0`
**Fail if:** Any TypeScript error or any failing test
