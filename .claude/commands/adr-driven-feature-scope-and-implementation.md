---
name: adr-driven-feature-scope-and-implementation
description: Workflow command scaffold for adr-driven-feature-scope-and-implementation in aquavoy.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /adr-driven-feature-scope-and-implementation

Use this workflow when working on **adr-driven-feature-scope-and-implementation** in `aquavoy`.

## Goal

Introduces a new architecture decision (ADR), scopes the feature, and implements the corresponding code and database changes.

## Common Files

- `.planning/decisions/ADR-*-*.md`
- `.planning/CONTEXT.md`
- `.planning/phase-*-context.md`
- `supabase/migrations/*.sql`
- `src/lib/agents/*.ts`
- `src/lib/agents/*.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Write an ADR in .planning/decisions/ADR-XXX-*.md.
- Update .planning/CONTEXT.md and related phase context files.
- Implement or update feature code in src/lib/agents/*.ts and related files.
- If needed, add or update migration SQL in supabase/migrations/XXXX_*.sql.
- Add or update API endpoints in src/app/api/*/route.ts.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.