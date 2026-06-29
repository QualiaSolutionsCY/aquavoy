---
phase: 3
result: PASS
gaps: 0
security_findings: 2
security_verdict: PASS (0 critical, 0 high; 1 medium + 1 low — below blocking threshold)
correctness_findings: 1
correctness_verdict: PASS (0 critical, 0 high, 0 medium; 1 low — dead import, below blocking threshold)
---

# Phase 3 Verification

## security lens

**Lens:** Security only. Functional correctness verified by the correctness panel.

### ADR-003 Enforcement: generate_invoice_from_template is in DESTRUCTIVE; no fill/upload in the model loop

PASS.

`src/lib/agents/onedriveTools.ts:1053-1072` — `"generate_invoice_from_template"` is present in the `DESTRUCTIVE` Set with explicit comment: `"Invoice generation (ADR-007 confirm-before-write): docx fill + OneDrive upload happen only at confirm; the model loop stages extracted fields only."` The `DESTRUCTIVE.has(name)` gate at line 1145 intercepts any call in the model loop and returns a staged `confirmation_required` result — no side-effect runs.

Grep confirms `fillInvoiceTemplate` and `getInvoiceTemplate` are NOT imported or called in `onedriveTools.ts` (the model-loop file). The only `uploadFile` call in `onedriveTools.ts` is at line 1421 inside the `create_spreadsheet` case (a separate, non-destructive tool). The fill + upload path exists exclusively in `executeConfirmedAction.ts:334-354`.

### ADR-003 Enforcement: staging fails closed without a verified session principal

PASS.

`src/lib/agents/onedriveTools.ts:1146-1147` — `if (!sessionPrincipal) return JSON.stringify({ error: "no verified principal in session" });` — this guard fires for ALL members of the DESTRUCTIVE set before any staging code runs.

The `sessionPrincipal` is derived from `getPrincipal(req)` in `src/app/api/chat/route.ts:25`, which calls `verifySession()` at `src/lib/auth/session.ts` — an HMAC-SHA256 verify under `SESSION_SECRET`. The LLM cannot supply or forge the principal: the chat route passes `principal: identity` (`src/app/api/chat/route.ts:57`) where `identity` is the session-cookie-derived value, never a value from the model's message body.

The staged row's `principal` column is set from `sessionPrincipal` (the HMAC-verified identity), confirming ownership: `src/lib/agents/onedriveTools.ts:1306` — `principal: sessionPrincipal`.

The confirm route also re-derives principal from the session cookie, never from the request body: `src/app/api/actions/confirm/route.ts:19` — `const principal = getPrincipal(req);`.

### 0016_invoice_templates.sql: RLS enabled, NO policies (constitution)

PASS.

`supabase/migrations/0016_invoice_templates.sql:29` — `alter table public.invoice_templates enable row level security;` — RLS is enabled.

`supabase/migrations/0016_invoice_templates.sql` — searched in full: zero occurrences of `create policy`, `for select using`, `for all using`, `for insert`, `for update`, `for delete`. No policies exist. The table is inaccessible to anon/authenticated roles; only the service-role client can access it (via `supabaseAdmin()` in `invoiceTemplates.ts`).

The table comment at line 25-26 explicitly documents this: `'Service-role only (RLS on, no policies). Applied via CI, never hand-applied (constitution).'`

### No service_role key exposure introduced

PASS.

`src/lib/agents/invoiceTemplates.ts:1` — `import { supabaseAdmin } from "@/lib/supabase/server";` — the only Supabase accessor used is the server-side admin client. No `NEXT_PUBLIC_` prefix on the service role key anywhere in the new files.

Scanned `invoiceTemplate.ts`, `invoiceExtraction.ts`, `invoiceTemplates.ts`, `executeConfirmedAction.ts` for `NEXT_PUBLIC_` — no occurrences.

`src/lib/env.ts:60` — `SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required")` — key is validated server-side only, not prefixed.

`supabaseAdmin()` is used only in server-side API route files and server lib files, never in any `"use client"` component.

### docxtemplater: no template-injection / code-exec risk

PASS.

`src/lib/agents/invoiceTemplate.ts:67-71` — docxtemplater is initialized with `{ paragraphLoop: true, linebreaks: true, nullGetter: () => "" }`. No `parser:` option is set — this means the default literal-string parser is used, which renders `{tag}` placeholders as plain text substitutions. There is no angular-parser, no expression-parser, and no `{= ... }` syntax enabled.

Searched across `src/lib/agents/invoiceTemplate.ts`, `invoiceExtraction.ts`, and `scripts/` for `angularParser`, `expressionParser`, `parser:`, `eval`, `new Function`, `{=` — all return zero results.

`nullGetter: () => ""` ensures missing fields render as empty strings rather than `undefined` or throwing, preventing any template-engine error from LLM-provided sparse data.

LLM-extracted values are passed as `InvoiceFields` (typed string fields) into `doc.render(data)`. The only code executed is docxtemplater's internal substitution logic operating on literal string values — no user-controlled code execution path.

### Output path: fixed base from Supabase row; LLM-controlled year appended

PARTIAL PASS — MEDIUM finding recorded (SEC-01).

`src/lib/agents/executeConfirmedAction.ts:311` — `const row = await getInvoiceTemplate(company);` — `row.output_folder_path` is sourced from the `invoice_templates` Supabase row, seeded by the migration to `'alle firma's/Aquavoy Ltd/Verzonden Facturen'`. This base path is not LLM-controlled.

`src/lib/agents/executeConfirmedAction.ts:345` — `const destPath = \`${row.output_folder_path}/${year}\`;` — `year` is taken from `args.targetYear` (LLM-staged value) without application-layer format validation. An adversarially crafted `targetYear` such as `2026/../../OtherFolder` could redirect the upload destination within OneDrive.

**Mitigations present:** The Graph API path construction in `src/lib/microsoft/onedrive.ts:50` applies `encodeURIComponent` to each path segment individually: `path.split("/").map(encodeURIComponent).join("/")`. This encoding converts `/` inside a segment to `%2F`, preventing actual directory separator injection at the Graph API level. Additionally, OneDrive's Graph API server-side normalizes paths. The destination upload therefore cannot escape the `/me/drive/root:/` namespace.

**Gap:** No application-layer guard validates that `targetYear` is a 4-digit year string (e.g. `/^\d{4}$/`). The same gap exists at stage time in `onedriveTools.ts:1292-1294`. A `targetYear` containing a `/` would be split into two path segments by `encodeURIComponent` at the Graph API layer — partial traversal within the OneDrive path namespace is possible if Graph path normalization does not reject it.

Severity: MEDIUM per `"hardcoded values that should be vars"` category extended to missing input validation on a path-construction parameter. Does not meet CRITICAL or HIGH threshold (no data loss possible; scope is limited to upload destination within the same OneDrive account; requires principal authentication to exploit).

### readFileSync reads template_ref from Supabase row (not LLM args)

PASS — with LOW-severity defence-in-depth note.

`src/lib/agents/executeConfirmedAction.ts:316` — `const templatePath = join(process.cwd(), row.template_ref);` — `row.template_ref` comes from the `invoice_templates` Supabase row returned by `getInvoiceTemplate(company)`, not from any LLM-supplied argument. The company selection is constrained to `"Gefo" | "Novo Porto"` (validated at line 300-302), and the Supabase query selects by that constrained value.

Seed values are `'assets/invoice-templates/gefo.docx'` and `'assets/invoice-templates/novo-porto.docx'` — both repo-relative paths without traversal segments.

The LLM has no mechanism to influence `template_ref` at runtime. Path traversal via this field would require writing to the `invoice_templates` table, which requires the service-role key (only server code holds this key).

No `..` validation is applied on `row.template_ref` before `join()` — this is defence-in-depth gap (DB row mutation could theoretically supply a traversal path), but not exploitable through the current code paths.

### Summary Table

| Check | Result | Evidence |
|---|---|---|
| ADR-003: tool in DESTRUCTIVE set | PASS | `onedriveTools.ts:1072` — `"generate_invoice_from_template"` in DESTRUCTIVE |
| ADR-003: no fill/upload in model loop | PASS | `fillInvoiceTemplate`, `getInvoiceTemplate` not imported/called in onedriveTools.ts |
| ADR-003: stage fails closed without session principal | PASS | `onedriveTools.ts:1146-1147` — sessionPrincipal guard |
| Stage row owned by HMAC session principal | PASS | `onedriveTools.ts:1306` — `principal: sessionPrincipal` |
| Confirm route re-derives principal from session cookie | PASS | `confirm/route.ts:19` — `getPrincipal(req)` not body |
| RLS enabled on invoice_templates | PASS | `0016_invoice_templates.sql:29` — `enable row level security` |
| No policies on invoice_templates | PASS | zero `create policy` occurrences in migration |
| Service-role key not NEXT_PUBLIC_ | PASS | `env.ts:60` — `SUPABASE_SERVICE_ROLE_KEY` (no prefix) |
| supabaseAdmin() in server code only | PASS | invoiceTemplates.ts server-only; no "use client" |
| docxtemplater: no angular/expression parser | PASS | `invoiceTemplate.ts:67-71` — no parser option |
| nullGetter returns empty string | PASS | `invoiceTemplate.ts:70` — `nullGetter: () => ""` |
| template_ref path sourced from DB row not LLM args | PASS | `executeConfirmedAction.ts:311-316` |
| targetYear path validation | MEDIUM (SEC-01) | `executeConfirmedAction.ts:308` — no year format guard |
| Unused import (extractInvoiceFields) | LOW (SEC-02) | `onedriveTools.ts:27` — dead import |

### Security Verdict

**PASS** — 0 CRITICAL, 0 HIGH findings. Phase 3 meets the security bar.

Two sub-threshold findings recorded in `.planning/phase-3-panel-security.json`:

- **SEC-01 (MEDIUM):** `targetYear` is LLM-supplied and appended to the OneDrive upload path without application-layer year-format validation (`executeConfirmedAction.ts:308`). The Graph API `encodeURIComponent` encoding and server-side path normalization provide runtime mitigation, so exploitation is impractical, but a `/^\d{4}$/` guard should be added in a follow-up hardening pass.
- **SEC-02 (LOW):** Unused import of `extractInvoiceFields` in `onedriveTools.ts:27` — inert dead code, no security impact.

Neither finding blocks phase completion per the Severity Rubric: CRITICAL requires "Security breach possible; data loss; auth bypass; service_role exposed client-side; crashes on happy path" and HIGH requires "Feature broken for >50% of users; no error handling on user-facing path; wiring missing." Neither condition applies here.

## correctness lens

### Contract Results

All 19 machine contracts from `.planning/phase-3-contract.json` passed at `2026-06-29T07:49:48Z` (evidence: `.planning/evidence/phase-3-contract-run.json`). Confirmed independently below.

| Task | Check | Result | Evidence |
|------|-------|--------|---------|
| T1 | gefo.docx exists | PASS | `assets/invoice-templates/gefo.docx` — file present |
| T1 | novo-porto.docx exists | PASS | `assets/invoice-templates/novo-porto.docx` — file present |
| T1 | deps installed | PASS | `package.json` contains "docxtemplater" |
| T1 | templates render without tag errors | PASS | `node -e "...RENDER_OK"` → `RENDER_OK` (verified live) |
| T2 | fill adapter wired to docxtemplater | PASS | `src/lib/agents/invoiceTemplate.ts:82` — `return doc.toBuffer()` |
| T2 | extraction schema-validated | PASS | `src/lib/agents/invoiceExtraction.ts:105` — `ExtractedInvoiceSchema.parse(parsed)` |
| T2 | seam tests pass | PASS | 12/12 pass (invoiceTemplate.test.ts + invoiceExtraction.test.ts, verified live) |
| T2 | tsc clean | PASS | `npx tsc --noEmit` → 0 errors |
| T3 | migration exists with RLS | PASS | `supabase/migrations/0016_invoice_templates.sql:29` — `alter table public.invoice_templates enable row level security` |
| T3 | no policies | PASS | `grep -c "create policy" ...` → 0 |
| T3 | both companies seeded + accessor | PASS | `invoiceTemplates.ts:26` — `getInvoiceTemplate` exported; migration seeds Gefo + Novo Porto rows |
| T4 | tool staged not executed in loop | PASS | `onedriveTools.ts:1072` — in DESTRUCTIVE; `onedriveTools.ts:1279` — stage branch (no fill/upload) |
| T4 | confirm path + undo wired | PASS | `executeConfirmedAction.ts:299`; `pendingActions.ts:360` |
| T4 | fillInvoiceTemplate in confirm path | PASS | `executeConfirmedAction.ts:334` — `fillInvoiceTemplate(templateBuffer, fields)` |
| T4 | getInvoiceTemplate in confirm path | PASS | `executeConfirmedAction.ts:311` — `await getInvoiceTemplate(company)` |
| T4 | reversible in both UI surfaces | PASS | `src/app/page.tsx:70`; `src/app/finance/page.tsx:70` |
| T4 | tsc clean | PASS | 0 errors (verified live) |
| T4 | full suite pass | PASS | 168/168 tests, 23 test files (verified live) |
| T4 | E2E confirm path proven (behavioral) | PASS | see executeConfirmedAction.test.ts:664-701 below |

### 3-Level Correctness Checks

#### Criterion 1 — extractInvoiceFields returns Zod-validated fields

**Truths:** `extractInvoiceFields(pdfText)` returns `ExtractedInvoice` with `company: "Gefo" | "Novo Porto"`, recipient fields, amounts as "X.XX" strings, `currency` defaulting to "EUR". Missing optional amounts default to `"0.00"`. Invalid company throws a validation error naming the field.

**Artifacts:**
- `src/lib/agents/invoiceExtraction.ts:26-40` — `ExtractedInvoiceSchema` with `company: z.enum(["Gefo","Novo Porto"])`, `moneyString` coercion, `currency: z.string().default("EUR")`, optional amount fields `.default("0.00")`.
- `src/lib/agents/invoiceExtraction.ts:105` — `return ExtractedInvoiceSchema.parse(parsed)`.
- `src/lib/agents/invoiceExtraction.ts:107-112` — ZodError caught, re-thrown with field-level issue descriptions.

**Wiring:**
- `src/lib/agents/onedriveTools.ts:27` — `import { extractInvoiceFields } from "@/lib/agents/invoiceExtraction"` — imported but NOT called in the agent execution path. The LLM model extracts fields natively from PDF text (system prompt 5f step 2) and passes them as tool arguments. `extractInvoiceFields()` is a dead import. LOW finding C-001 (see below).
- Seam tests (12 passing) exercise `extractInvoiceFields` directly and cover all schema branches.

**Scores:** Correctness 5, Completeness 4, Wiring 4 (extraction function exists and tested; dead import in onedriveTools — agent path uses LLM-native extraction instead), Quality 4.

#### Criterion 2 — generate_invoice_from_template stages without executing (confirm-before-write gate)

**Truths:** Tool returns `{ status: "confirmation_required", action_id, summary }` in the loop. No `uploadFile` called at stage time. Gate fails closed without `sessionPrincipal`.

**Artifacts:**
- `src/lib/agents/onedriveTools.ts:1072` — `"generate_invoice_from_template"` in `DESTRUCTIVE` set.
- `src/lib/agents/onedriveTools.ts:1145-1147` — principal guard before any staging code.
- `src/lib/agents/onedriveTools.ts:1279-1334` — stage branch: validates `invoice_number` + `company`, builds human-readable summary, calls `stagePendingAction`, returns `confirmation_required`.
- `src/lib/agents/onedriveTools.ts:1114-1121` — `summarizeAction` case produces: `Generate ${company} invoice ${invoiceNumber} for ${recipientName} → Verzonden Facturen/${year}`.

**Wiring:**
- `src/lib/agents/executeConfirmedAction.test.ts:746-756` — invalid company → `getInvoiceTemplateMock` and `uploadFileMock` not called (asserted).
- `src/lib/agents/executeConfirmedAction.test.ts:758-768` — missing invoice_number → upload not called.

**Scores:** Correctness 5, Completeness 5, Wiring 5, Quality 5.

#### Criterion 3 — On confirm: getInvoiceTemplate → readFileSync → fillInvoiceTemplate → uploadFile to Verzonden Facturen/{year} → undo_data.uploadedItemId

**Truths:** `getInvoiceTemplate(company)` → `readFileSync(join(process.cwd(), row.template_ref))` → `fillInvoiceTemplate(templateBuffer, fields)` → `uploadFile(connId, { path: destPath }, filename, filledBuffer, DOCX_MIME)` → `{ result: { generated: true, itemId, name, webUrl }, undo_data: { uploadedItemId: item.id } }`. Gefo filename includes "Invoice Aquavoy - Gefo"; Novo Porto includes "Aquavoy Ltd - Novo Porto Scheepvaart BV".

**Artifacts:**
- `src/lib/agents/executeConfirmedAction.ts:5,14,16-17` — imports: `uploadFile`, `readFileSync`, `getInvoiceTemplate`, `fillInvoiceTemplate`.
- `src/lib/agents/executeConfirmedAction.ts:311` — `const row = await getInvoiceTemplate(company)`.
- `src/lib/agents/executeConfirmedAction.ts:316-317` — `const templatePath = join(process.cwd(), row.template_ref); const templateBuffer = readFileSync(templatePath)`.
- `src/lib/agents/executeConfirmedAction.ts:334` — `const filledBuffer = fillInvoiceTemplate(templateBuffer, fields)`.
- `src/lib/agents/executeConfirmedAction.ts:339-342` — per-company filename construction (Gefo: "Invoice Aquavoy - Gefo ... voyage.docx"; Novo Porto: "Aquavoy Ltd - Novo Porto Scheepvaart BV ...docx").
- `src/lib/agents/executeConfirmedAction.ts:345` — `const destPath = \`${row.output_folder_path}/${year}\`` (e.g. `alle firma's/Aquavoy Ltd/Verzonden Facturen/2026`).
- `src/lib/agents/executeConfirmedAction.ts:348-354` — `uploadFile(connId, { path: destPath }, filename, filledBuffer, DOCX_MIME)`.
- `src/lib/agents/executeConfirmedAction.ts:363` — `undo_data: { uploadedItemId: item.id }`.

**Wiring:**
- `src/lib/agents/executeConfirmedAction.test.ts:688-698` — asserts `uploadFileMock` called with `{ path: "alle firma's/Aquavoy Ltd/Verzonden Facturen/2026" }` and `undo_data = { uploadedItemId: "drive-inv-1" }`.
- `src/lib/agents/executeConfirmedAction.test.ts:704-727` — Gefo filename convention: `filename` matches `/Invoice Aquavoy - Gefo/`.
- `src/lib/agents/executeConfirmedAction.test.ts:729-744` — year defaults to current year.

**Scores:** Correctness 5, Completeness 5, Wiring 5, Quality 5.

#### Criterion 4 — E2E path proven by seam tests

**Artifacts:**
- `src/lib/agents/executeConfirmedAction.test.ts:617-769` — 5 tests: happy path (year-suffixed path, undo_data), Gefo filename, year default, invalid company rejection, missing invoice_number rejection.
- `src/lib/agents/invoiceTemplate.test.ts` — 3 tests: gefo.docx → non-empty Buffer with PK magic bytes; novo-porto.docx renders; bad-tag template throws readable error naming `"unclosed"`.
- `src/lib/agents/invoiceExtraction.test.ts` — 9 tests: valid JSON parse, code-fence stripping, optional amount defaulting, ZodError on missing total, ZodError on invalid company.

**Wiring:** All 168 tests pass (23 test files; verified live).

**Scores:** Correctness 5, Completeness 5, Wiring 5, Quality 5.

#### Criterion 5 — Undo deletes the uploaded invoice; reversible in both UI surfaces

**Artifacts:**
- `src/lib/agents/pendingActions.ts:357-366` — `case "save_email_attachment": case "generate_invoice_from_template":` fall-through; reads `undo.uploadedItemId`; calls `deleteItemOnDrive(connId, uploadedItemId)`.
- `src/app/page.tsx:70` — `"generate_invoice_from_template"` in `REVERSIBLE_TOOLS`.
- `src/app/finance/page.tsx:70` — `"generate_invoice_from_template"` in `REVERSIBLE_TOOLS`.

**Scores:** Correctness 5, Completeness 5, Wiring 5, Quality 5.

#### Criterion 6 — No regression (vitest green; tsc clean)

- `npx tsc --noEmit` → 0 errors (verified live 2026-06-29).
- `npx vitest run` → 168/168 tests, 23 test files, 0 failures (verified live 2026-06-29).

**Scores:** Correctness 5, Completeness 5, Wiring 5, Quality 5.

### Scores Summary

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| extractInvoiceFields Zod-validated | 5 | 4 | 4 | 4 | PASS |
| stage without execute (confirm gate) | 5 | 5 | 5 | 5 | PASS |
| confirm path: fill + upload + undo_data | 5 | 5 | 5 | 5 | PASS |
| E2E path proven by seam tests | 5 | 5 | 5 | 5 | PASS |
| undo + reversible in both UI surfaces | 5 | 5 | 5 | 5 | PASS |
| no regression (tsc + vitest) | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** No score below 3. All criteria pass.

### Correctness Findings

**C-001 (LOW):** `src/lib/agents/onedriveTools.ts:27` — `import { extractInvoiceFields } from "@/lib/agents/invoiceExtraction"` — dead import; `extractInvoiceFields()` is never called in the agent execution path. The agent flow uses LLM-native field extraction (system prompt 5f step 2) and passes the fields directly as tool arguments. The function exists and is well-tested; it is simply not called programmatically. No user-visible impact.

Severity criterion: LOW — "console.log in prod; naming inconsistency; minor perf (no user-visible impact)" (rules/grounding.md Severity Rubric). Weighted sum: 0×8 + 0×4 + 0×2 + 1×1 = 1 → category score 5.

### Code Quality
- TypeScript: PASS (`npx tsc --noEmit` → 0 errors)
- Stubs found: 0 (no TODO/FIXME/placeholder in new files)
- Empty handlers: 0
- Unused imports: 1 (`extractInvoiceFields` in `onedriveTools.ts:27` — LOW severity)
- Full vitest suite: 168/168 PASS

### Correctness Verdict

PASS — Phase 3 goal achieved under the correctness lens. All 6 success criteria verified at Correctness ≥ 4, Completeness ≥ 4, Wiring ≥ 4, Quality ≥ 4. No score below 3. The confirm path reads the per-company template (via `getInvoiceTemplate`), fills it (via `fillInvoiceTemplate`), uploads to `Verzonden Facturen/{year}` (via `uploadFile`), and captures `undo_data.uploadedItemId` — all proven by the seam tests (37 tests in executeConfirmedAction.test.ts alone, all passing).

One LOW-severity dead import (`extractInvoiceFields` in `onedriveTools.ts:27`) is noted in `.planning/phase-3-panel-correctness.json`. The function is well-built and tested; the agent flow simply uses LLM-native extraction rather than a programmatic call.

Design Verification: N/A (no frontend tasks in this phase — pure backend tool addition).

### follow-up — RESOLVED
SEC-01 (targetYear path guard) fixed in executeConfirmedAction.ts + onedriveTools.ts (4-digit-year regex). C-001/SEC-02 dead import removed from onedriveTools.ts.
