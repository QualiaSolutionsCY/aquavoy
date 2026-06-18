---
name: phase-planning-and-verification
description: Workflow command scaffold for phase-planning-and-verification in aquavoy.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /phase-planning-and-verification

Use this workflow when working on **phase-planning-and-verification** in `aquavoy`.

## Goal

Defines, plans, and verifies a new project phase or milestone, including context, plan, contract, and verification documents, along with machine evaluation outputs.

## Common Files

- `.planning/phase-*-context.md`
- `.planning/phase-*-plan.md`
- `.planning/phase-*-contract.json`
- `.planning/phase-*-verification.md`
- `.planning/evals/harness-eval-*.json`
- `.planning/evals/harness-eval-*.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create or update .planning/phase-X-context.md with phase context.
- Write or update .planning/phase-X-plan.md for planning.
- Define .planning/phase-X-contract.json for contract/spec.
- Add .planning/phase-X-verification.md for verification notes.
- Record machine evaluation outputs in .planning/evals/harness-eval-*.json and .md.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.