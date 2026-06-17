---
phase: 2
milestone: 2
archetype: ai-agent
profile: standard
scoped_by: Moayad
scoped_at: 2026-06-16
---

# Phase 2 — Inline Document Understanding · Scope

**Goal:** The agent reads and reasons over a OneDrive document within a single turn.

## Reality check (grounded 2026-06-16) — the capability ALREADY EXISTS

The ROADMAP premise ("reading a file's content into the conversation is not a first-class
tool") is **stale**. The capability is shipped and wired:

- `read_file` tool — def `src/lib/agents/onedriveTools.ts:94-119`, executor `:598-612`. Takes a
  Graph `itemId`, downloads via `downloadContent`, resolves filename (content-disposition →
  `getItem` fallback), returns `{ fileName, content }`.
- `extractText` `src/lib/agents/onedriveTools.ts:487-535` — `.docx` (mammoth), `.pdf`
  (pdf-parse v2), `.xlsx/.xls` (xlsx → CSV per sheet), text-like (UTF-8 decode), and a clean
  "cannot extract" message for unsupported binaries.
- **Size guard:** `truncate()` caps at `TEXT_CAP` (~12000 chars) with a "(truncated)" note (`:45-47`).
- **Wired:** in `TOOL_DEFINITIONS`, in the `ONEDRIVE_TOOLS` connection set (`:554`), and in the
  system-prompt capability list (`src/lib/openrouter/client.ts:77-79`: "read_file … Supports
  text, PDF, Word, and Excel files").

### Decision: do NOT rebuild. Verify + close the test gap.

Per MVP-first + locality (don't duplicate working code), Phase 2 does not add a redundant
`read_document` tool — `read_file` already satisfies the success criteria. The naming
difference (`read_file` vs the ROADMAP's `read_document`) is cosmetic and not worth the churn.

## v1 capability set — status

1. Tool fetches a drive item, extracts Word/PDF/Excel/text, returns content for same-turn reasoning. → ✅ pre-existing (`read_file` + `extractText`).
2. Size/type guards: large files truncated with a note; unsupported types reported cleanly. → ✅ pre-existing (`truncate`, unsupported-binary branch).
3. Wired into the tool registry + system-prompt capability list. → ✅ pre-existing.
4. **Automated test coverage for document extraction.** → ❌ GAP — this is Phase 2's real deliverable.

## Acceptance criteria (testable)

- **AC1 — Text extraction path:** `executeTool("read_file", { itemId }, conn)` over a stubbed
  `downloadContent` returning text bytes returns `{ fileName, content }` with the decoded text.
- **AC2 — Filename resolution:** when the download response has no `content-disposition`, the
  tool falls back to `getItem(...).name` for the filename.
- **AC3 — Unsupported binary:** an unsupported extension (e.g. `.png`) returns the clean
  "cannot extract" message, not a crash.
- **AC4 — Size guard:** content longer than `TEXT_CAP` is truncated and ends with "(truncated)".
- **AC5 — Missing itemId:** returns `{ error: "itemId is required" }`, no download attempted.
- **AC6 — Parser dispatch:** a `.docx`/`.pdf`/`.xlsx` filename routes to the matching parser
  branch (verified with the parser module mocked — we test OUR dispatch, not the vendor lib,
  per `rules/architecture.md` §6 "test the seam, not the function").
- **AC7 — tsc + suite green:** `npx tsc --noEmit` exits 0; `npx vitest run` passes.

## Gate

- [x] v1 capability set scoped (capability pre-exists; gap = test net)
- [x] zero `[NEEDS CLARIFICATION]` markers
- [x] DoD resolved — no rebuild; verification + regression tests close the phase
