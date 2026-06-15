# Aquavoy — Code Style & Conventions

Derived from sampling ~14 files across `src/app/`, `src/components/`, `src/lib/agents/`, `src/lib/microsoft/`, `src/lib/mail/`, `src/lib/openrouter/`, and `src/app/api/`. Every claim is cited `file:line`.

Stack: Next.js (App Router), React 19, TypeScript `strict`, Zod for env validation, Supabase (service-role only), OpenRouter/Gemini for AI. `tsconfig.json` sets `strict: true`, `moduleResolution: "bundler"`, path alias `@/*` → `./src/*`.

---

## 1. Naming

- **Files**: camelCase for lib modules (`src/lib/http.ts`, `src/lib/microsoft/onedriveTools.ts`, `src/lib/mail/imap.ts`). React components are PascalCase (`src/components/Nav.tsx`, `src/components/Footer.tsx`). App Router files use the framework's lowercase convention (`page.tsx`, `route.ts`, `layout.tsx`).
- **Functions**: camelCase verbs — `graphJson`, `graphRaw`, `fetchMe` (`graph.ts:59,67,73`), `getValidAccessToken`, `resolveConnectionId`, `saveConnection` (`connections.ts:108,90,47`), `streamChatWithTools`, `complete` (`client.ts:264,159`).
- **Types/interfaces**: PascalCase — `DriveItem`, `TokenSet`, `MicrosoftUser`, `GraphDriveItem` (`microsoft/types.ts:7,28,37,44`); `ChatMessage`, `ChatProvider`, `ChatOptions` (`client.ts:18,196,46`); `EmailSummary`, `EmailDetail`, `FolderInfo` (`imap.ts:208,217,201`).
- **React components**: PascalCase, `default export` — `export default function Nav()` (`Nav.tsx:12`). Note the chat root component is named `Home` even though it lives at `page.tsx` (`files/page.tsx:38`).
- **Constants**: SCREAMING_SNAKE for module-level config — `GRAPH_BASE` (`graph.ts:9`), `MAX_TOOL_ITERATIONS`, `OPENROUTER_URL`, `PRINCIPALS`, `SYSTEM_PROMPT`, `TOOL_DEFINITIONS` (`client.ts:13,16,43,56`; `onedriveTools.ts:52`), `BODY_CAP`, `DEFAULT_COUNT`, `MAX_COUNT` (`imap.ts:21-23`), `TABLE`, `EXPIRY_SKEW_MS` (`connections.ts:14,16`). Numeric literals use underscore separators: `12_000`, `60_000` (`imap.ts:21`, `connections.ts:16`).
- **DB rows**: snake_case (DB-native) mapped to camelCase domain types via a `toX` mapper — `ConnectionRow` (snake) → `Connection` (camel) via `toConnection` (`connections.ts:25-44`). Same pattern in mail accounts (`AccountRow` → `MailAccount`, `accounts.ts:32,15`).

## 2. Component patterns

- **Client by default for interactive pages**: every page sampled opens with `"use client"` — `page.tsx:1`, `files/page.tsx:1`, `Nav.tsx:1`. State via `useState`/`useCallback`/`useEffect`/`useRef` hooks (`files/page.tsx:3,39-48`).
- **No server-component data fetching observed**: pages fetch client-side through a local typed `api<T>()` helper that unwraps the `{ ok, data }` envelope and throws `json.error` on failure (`files/page.tsx:17-24`).
- **`layout.tsx` is the server component** — imports `Metadata`, Google fonts (`Instrument_Sans`, `JetBrains_Mono`), `Nav`, `Footer`, and global CSS; no `"use client"` (`layout.tsx:1-5`).
- **Prop typing**: local `interface` for component-internal shapes (`Connection`, `Crumb` in `files/page.tsx:6-15`; `Msg`, `SessionSummary` in `page.tsx:8-15`). Shared domain types imported from lib (`import type { DriveItem } from "@/lib/microsoft/types"`, `files/page.tsx:4`).
- **Static link/data tables** declared as `const X = [...] as const` outside the component (`Nav.tsx:5-10`).
- **Accessibility is present**: `aria-label`, `aria-current`, `aria-hidden`, empty `alt=""` on decorative logo (`Nav.tsx:16-19,33`).

## 3. API route patterns

- **Route segment config**: handlers declare `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` (`onedrive/files/route.ts:6-7`, `chat/route.ts:5-6`).
- **Two distinct handler styles**, by need:
  - **Envelope routes** wrap the body in `handle(async () => ok(...))` from `lib/http.ts` — concise, uniform errors. `GET` returns `Promise<NextResponse>`, reads params off `req.nextUrl.searchParams` (`onedrive/files/route.ts:14-22`).
  - **Streaming/custom routes** (chat) hand-roll the try/catch and return a raw `Response` with SSE headers (`chat/route.ts:16-63`).
- **`lib/http.ts` is the response contract** (`http.ts`):
  - `ok<T>(data)` → `{ ok: true, data }` (line 5).
  - `fail(message, status=400)` → `{ ok: false, error }` (line 10).
  - `handle(fn)` wraps a handler: `GraphError` keeps its HTTP status (502 floor), messages prefixed `"BadRequest:"` become 400, everything else 500 (lines 19-30).
- **Input validation**: routes do manual whitelisting rather than Zod at the boundary — chat filters `messages` by an allowed-`role` `Set` and whitelists `identity` against `PRINCIPAL_SET`, explicitly "never trust it raw into the prompt" (`chat/route.ts:8-9,24-31`). Zod is reserved for env (see §4). Malformed JSON → manual `{ ok: false, error }` 400 (`chat/route.ts:32-34`).
- **Param resolution helpers** live in lib, not the route — `resolveConnectionId(p.get("connectionId"))` defaults to the most-recent connection (`onedrive/files/route.ts:17`, `connections.ts:90`).

## 4. lib subsystem patterns (adapters at seams)

The codebase strictly follows "adapter is the only file that imports the vendor SDK," documented in each adapter's header comment:

- **`microsoft/graph.ts`** — "Thin transport over Microsoft Graph. Owns the base URL, auth header, and error envelope" (`graph.ts:4-8`). Defines `GraphError extends Error` with `status`/`code`/`message` (lines 11-20). `rawFetch` is private; `graphJson<T>`/`graphRaw` are public and resolve a fresh token via `getValidAccessToken` before each call (lines 32,59,67). 204 → `undefined as T` (line 62).
- **`mail/imap.ts`** — "the ONLY file in the project that imports imapflow or mailparser" (`imap.ts:14-19`). A `withClient<T>(email, fn)` higher-order helper owns connect → run → logout, and classifies errors by regex into auth/timeout/generic messages (lines 40-71).
- **`mail/smtp.ts`** — "the ONLY file in the project that imports [nodemailer]" (`smtp.ts:4-7`); same regex-based error classification (`smtp.ts:38-40`).
- **`openrouter/client.ts`** — "only this module knows OpenRouter's wire format, headers, and base URL" (`client.ts:4-12`). Provider abstraction `chatProvider()` transparently swaps OpenRouter ↔ direct Gemini based on `GOOGLE_API_KEY`, both OpenAI-wire-compatible (lines 196-226).
- **`microsoft/types.ts`** — shared domain types live here; the file documents that `DriveItem` is "intentionally a SUBSET of the raw Microsoft Graph DriveItem" so the app never couples to Graph field names (`types.ts:1-6`). Raw vendor shape (`GraphDriveItem`) and internal shape (`DriveItem`) are both declared here and mapped in the adapter.
- **`microsoft/connections.ts`** — persistence/freshness adapter; "the single place that decides 'is this access token still good?'" (`connections.ts:5-12`). Token refresh + persist is hidden behind `getValidAccessToken` (lines 108-129).

- **`lib/env.ts`** — env access is centralized and **validated lazily, per-feature** with Zod, so one subsystem's missing config doesn't break another (`env.ts:3-10`). Pattern: one `z.object` schema + a memoized cache + a `getXEnv()` accessor per subsystem (`getAppEnv`, `getOpenRouterEnv`, `getMicrosoftEnv`, `getSupabaseEnv`, `getTavilyEnv` — `env.ts:28,41,53,63,72`). A shared `validate()` formats Zod issues into a readable error (lines 12-21). Caching idiom: `(cache ??= validate(...))` (e.g. line 29). Direct `process.env` reads are used only for soft/optional flags (`GOOGLE_API_KEY`, `OPENROUTER_FALLBACK_MODELS` in `client.ts:210,234`).

- **Agent tools** (`agents/onedriveTools.ts`): tool definitions are an exported `TOOL_DEFINITIONS` array of OpenAI function-calling JSON schemas with `type: "function" as const` (lines 52-55), paired with an `executeTool(name, args)` dispatcher. Tools delegate to the lib adapters above — the agent layer orchestrates, adapters do IO (imports at `onedriveTools.ts:1-16`). The agent layer never touches a vendor SDK directly.

## 5. Import style

- **Path alias `@/`** for cross-subsystem imports — `import { handle, ok } from "@/lib/http"`, `import type { DriveItem } from "@/lib/microsoft/types"` (`onedrive/files/route.ts:2`, `files/page.tsx:4`).
- **Relative imports within the same subsystem** — `microsoft/graph.ts` imports `./connections`, `./types` (lines 1-2); `mail/imap.ts` imports `./accounts` (line 9).
- **`import type { ... }`** used for type-only imports throughout (`graph.ts:2`, `files/page.tsx:4`, `smtp.ts:2`).
- **Ordering** (observed convention): external/framework packages first (`next/server`, `imapflow`, `nodemailer`, `zod`), then `@/`-aliased internal modules, then relative `./` modules (`onedrive/files/route.ts:1-4`, `imap.ts:1-12`).

## 6. Type style

- **`interface` is the default** for object shapes (domain types, props, row shapes, request shapes) — `DriveItem`, `TokenSet` (`types.ts:7,28`), `ChatMessage` (`client.ts:18`), `GraphRequest` (`graph.ts:22`), `Connection`/`ConnectionRow` (`connections.ts:18,25`).
- **`type` reserved for unions, literals, and derived types** — `Principal = (typeof PRINCIPALS)[number]` (`client.ts:44`), `Envelope<T> = { ok: true; data: T } | { ok: false; error: string }` (`files/page.tsx:17`), `Principal = "Wency" | "Jeanette"` (`page.tsx:5`).
- **Shared/domain types live in the subsystem's `types.ts`** (`microsoft/types.ts`); subsystem-local public types (e.g. `EmailSummary`) are exported from the adapter that produces them (`imap.ts:208`); component-only shapes stay local to the component file.
- **Const tuples for enums**: `export const PRINCIPALS = ["Wency","Jeanette"] as const` then a derived union type (`client.ts:43-44`) — preferred over TS `enum`.
- **JSDoc `/** ... */` comments** annotate exported functions, fields, and modules heavily (e.g. every field in `types.ts:7-26`, module headers everywhere).

## 7. Error handling

- **Adapters throw typed/readable `Error`s; routes convert to the envelope.** Vendor errors are caught and re-thrown with classified, human-readable messages (regex on the message → auth/timeout/generic) in `imap.ts:55-70` and `smtp.ts:38-40`.
- **`GraphError`** carries `status`/`code` so `lib/http.ts`'s `handle()` can map it back to an HTTP status (`graph.ts:11-20`, `http.ts:23-24`).
- **`err instanceof Error ? err.message : <fallback>`** is the universal narrowing idiom (`http.ts:26`, `chat/route.ts:60`, `imap.ts:56`, `smtp.ts:38`).
- **Soft-fail with `.catch(() => null)`** for non-critical enrichment — automatic memory recall "soft-fails silently" (`chat/route.ts:46`).
- **`force-dynamic` + `cache: "no-store"`** on all external fetches to avoid stale data (`graph.ts:41`).
- **Supabase calls** check `{ data, error }` and throw `new Error(\`Failed to ...: ${error.message}\`)` (`connections.ts:67,78,99,127`).
- **`try/finally` for resource cleanup** — IMAP `withClient` always logs out (or `.close()`) in `finally` (`imap.ts:64-70`).

## 8. Commit format

Conventional-commit-style prefixes, lowercase, with an em-dash for elaboration. From `git log --oneline`:
- `feat:` — new capability (e.g. `feat: full mailbox read access — IMAP list/read/search...`, `feat: scheduled email sending — queue table runner, cron, agent tools...`).
- `fix:` — bug fix (`fix: latest-file questions — expose lastModified...`).
- `polish:` / `polish(app):` — visual/UX refinement, optionally scoped (`polish: real Aquavoy Shipping logo...`, `polish(app): loading states...`).
- `docs:` — documentation (`docs: initialize project README`).
Pattern: `<type>(<optional scope>): <short summary> — <detail>`. Type is the leading verb-noun; the em-dash clause expands on what shipped.

---

## Summary for builders

Write **camelCase lib files / PascalCase components**, `"use client"` on every interactive page, and fetch through a local typed `api<T>()` helper that unwraps the `{ ok, data }` envelope. New API routes should be thin: declare `runtime="nodejs"` + `dynamic="force-dynamic"`, wrap the body in `handle(() => ok(...))` from `@/lib/http`, and push business logic into `lib/`. **Every external dependency gets exactly one adapter file** that owns the vendor SDK, throws classified readable errors, and exposes project-internal types (declared in `types.ts`, kept a deliberate subset of the vendor shape). Read env only through the lazy per-feature Zod accessors in `lib/env.ts`. Prefer `interface` for shapes, `type` for unions, `import type` for type-only imports, `@/` for cross-subsystem and `./` within a subsystem. Commit with conventional prefixes (`feat:`/`fix:`/`polish:`/`docs:`) and an em-dash detail clause.
