```markdown
# aquavoy Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns, coding conventions, and collaborative workflows used in the `aquavoy` TypeScript codebase. It covers how to plan and verify project phases, introduce new features through architecture decision records (ADRs), implement robust API endpoints (with confirmation/undo logic), and maintain high-quality test coverage. The repository emphasizes structured planning, clear commit practices, and test-driven development to ensure reliability and traceability.

## Coding Conventions

- **File Naming:**  
  Use `camelCase` for file names.  
  _Example:_  
  ```
  pendingActions.ts
  executeConfirmedAction.ts
  ```

- **Import Style:**  
  Use aliases for imports.  
  _Example:_  
  ```typescript
  import { executeConfirmedAction } from '@/lib/agents/executeConfirmedAction';
  ```

- **Export Style:**  
  Prefer named exports.  
  _Example:_  
  ```typescript
  export function executeConfirmedAction(...) { ... }
  ```

- **Commit Messages:**  
  - Mixed types, often prefixed with: `feat`, `scope`, `test`, `harden`, `verify`
  - Aim for concise, descriptive messages (average ~76 characters).

## Workflows

### Phase Planning and Verification
**Trigger:** When starting or completing a new milestone or project phase (e.g., durable memory, document understanding, confirm/undo).  
**Command:** `/plan-phase`

1. Create or update `.planning/phase-X-context.md` with phase context.
2. Write or update `.planning/phase-X-plan.md` for planning details.
3. Define `.planning/phase-X-contract.json` for contract/specification.
4. Add `.planning/phase-X-verification.md` for verification notes.
5. Record machine evaluation outputs in `.planning/evals/harness-eval-*.json` and `.md`.
6. Update `.planning/evidence/phase-X-contract-run.json` with contract run results.
7. Update `.planning/qualia/state.jsonl` with the current state.

_Example file structure:_
```
.planning/
  phase-2-context.md
  phase-2-plan.md
  phase-2-contract.json
  phase-2-verification.md
  evals/
    harness-eval-2024-06.json
    harness-eval-2024-06.md
  evidence/
    phase-2-contract-run.json
  qualia/
    state.jsonl
```

---

### ADR-Driven Feature Scope and Implementation
**Trigger:** When designing and implementing a new major feature or architectural change.  
**Command:** `/new-adr-feature`

1. Write an ADR in `.planning/decisions/ADR-XXX-*.md`.
2. Update `.planning/CONTEXT.md` and relevant phase context files.
3. Implement or update feature code in `src/lib/agents/*.ts` and related files.
4. If needed, add or update migration SQL in `supabase/migrations/XXXX_*.sql`.
5. Add or update API endpoints in `src/app/api/*/route.ts`.
6. Write or update tests in `src/lib/agents/*.test.ts` and `src/app/api/*/route.test.ts`.

_Example ADR file:_
```
.planning/decisions/ADR-005-durable-memory.md
```

_Example migration:_
```
supabase/migrations/20240601_add_confirmed_actions.sql
```

---

### API Endpoint Implementation with Confirmation Logic
**Trigger:** When adding or modifying API endpoints for user-triggered actions (e.g., confirm, cancel, undo).  
**Command:** `/new-api-endpoint`

1. Add or update route handler files in `src/app/api/actions/*/route.ts`.
2. Implement or update business logic in `src/lib/agents/*.ts` (e.g., `pendingActions.ts`, `executeConfirmedAction.ts`).
3. Update or add types in `src/lib/microsoft/types.ts` or similar.
4. Write or update tests for endpoints and logic in `src/app/api/actions/*/route.test.ts` and `src/lib/agents/*.test.ts`.

_Example endpoint:_
```typescript
// src/app/api/actions/confirm/route.ts
import { executeConfirmedAction } from '@/lib/agents/executeConfirmedAction';

export async function POST(req: Request) {
  // ...confirmation logic...
}
```

---

### Test-Driven Feature Verification
**Trigger:** When verifying a new capability, fix, or closing a gap in test coverage.  
**Command:** `/add-tests`

1. Write or update tests in `src/lib/agents/*.test.ts` for agent logic.
2. Write or update tests in `src/app/api/*/route.test.ts` for API endpoints.
3. Add or update test setup/configuration files as needed (e.g., `vitest.setup.ts`).
4. Update planning/evidence or verification documents to reflect test results.

_Example test:_
```typescript
// src/lib/agents/executeConfirmedAction.test.ts
import { executeConfirmedAction } from './executeConfirmedAction';
import { describe, it, expect } from 'vitest';

describe('executeConfirmedAction', () => {
  it('should execute action when confirmed', async () => {
    // ...test logic...
  });
});
```

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test File Pattern:** Files end with `.test.ts`, placed alongside implementation files.
- **Test Structure:** Use `describe`, `it`, and `expect` for test suites and assertions.
- **Setup:** Common setup can go in `vitest.setup.ts`.
- **Test Coverage:** Tests are written for both agent logic and API endpoints.

_Example test file:_
```
src/lib/agents/pendingActions.test.ts
src/app/api/actions/confirm/route.test.ts
```

## Commands

| Command           | Purpose                                                     |
|-------------------|-------------------------------------------------------------|
| /plan-phase       | Start or verify a new project phase/milestone               |
| /new-adr-feature  | Propose and implement a new feature with ADR and migrations |
| /new-api-endpoint | Add or update API endpoints with confirmation logic         |
| /add-tests        | Add or update automated tests for features or fixes         |
```
